'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID, createHash, randomBytes, createCipheriv, createDecipheriv } = require('crypto');
const { assertSchema } = require('./schema');
const { recordOutcomes } = require('./outcomes');
const { actionFor } = require('./actions');
const { resolveJwtSecret } = require('../../security/runtime-security');
const jwt = require('jsonwebtoken');
let auditSecret;
function configureSecret(secret) { auditSecret = secret; }
function secret() { return auditSecret || (auditSecret = resolveJwtSecret()); }
const local = new AsyncLocalStorage();
const staffRoles = new Set(['ADMIN', 'EDITOR', 'SERVICE_PROVIDER', 'STORE', 'COACH', 'DRIVER', 'DELIVERY_POINT']);
function unavailable() {
  return Object.assign(new Error('操作日誌暫時無法寫入，未提交本次異動'), { code: 'AUDIT_LOG_UNAVAILABLE', statusCode: 503 });
}
function authPath(path) {
  return /^\/(?:login|logout)$/.test(path) || /^\/auth\/.*(?:callback|verify)$/.test(path)
    || /^\/(?:oauth|line|google)\//.test(path) || ['/email-verifications/validate', '/auth/magic_link', '/confirm-email-change', '/reset-password'].includes(path);
}
function managedPath(path) { return /^\/(?:admin|provider|driver|delivery-point|coach)(?:\/|$)/.test(path); }
function operationFor(method, path, actorIsStaff = false) {
  if (path.startsWith('/admin/audit-logs')) return false;
  if (authPath(path)) return true;
  if (/\/(?:export|download)(?:\/|$)/.test(path)) return managedPath(path) || actorIsStaff;
  return !['GET', 'HEAD', 'OPTIONS'].includes(method) && (managedPath(path) || actorIsStaff);
}
function moduleFor(path) {
  if (authPath(path)) return 'auth';
  if (path.includes('/courses/')) return 'courses';
  return path.split('/').filter(Boolean).find(part => !['admin', 'provider', 'driver', 'delivery-point', 'me'].includes(part)) || 'account';
}
function authenticatedActor(user) {
  const state = local.getStore();
  if (state && !state.actor && user?.id) state.actor = { id: user.id, username: user.username || null, role: user.role || 'USER' };
}
function current() { return local.getStore(); }
function afterCommit(callback) {
  const state = current();
  if (!state) return false;
  if (state.closed || state.poisoned) throw unavailable();
  state.afterCommit.push(callback);
  return true;
}
function seal(value) {
  const key = createHash('sha256').update('leader-audit-jobs:' + secret()).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
function unseal(value) {
  const key = createHash('sha256').update('leader-audit-jobs:' + secret()).digest();
  const data = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
}
async function deferEffect(kind, payload) {
  const state = local.getStore();
  if (!state) return false;
  if (state.closed || state.poisoned) throw unavailable();
  try {
    await state.connection.query('INSERT INTO admin_audit_jobs(request_id,kind,payload) VALUES (?,?,?)',
      [state.id, kind, seal(payload)]);
    if (kind === 'file-write') state.hasFileWrite = true;
    return true;
  } catch (error) { state.poisoned = true; throw unavailable(); }
}
function wrapEffect(target, method, kind, pack, queuedResult) {
  if (!target?.[method]) return;
  const original = target[method].bind(target);
  target[method] = async (...args) => {
    if (await deferEffect(kind, pack(args))) return queuedResult(...args);
    return original(...args);
  };
  return original;
}
function installAudit(pool) {
  const raw = { query: pool.query.bind(pool), execute: pool.execute.bind(pool), getConnection: pool.getConnection.bind(pool) };
  let ready = false;
  let tables = new Map();
  let workerRunning = false;
  let timer;
  const effects = {};
  let stagingRoot;
  async function check() {
    ready = false;
    try { tables = await assertSchema(raw); ready = true; }
    catch (error) { console.error('AUDIT_SCHEMA_NOT_READY:', error.message); }
    return ready;
  }
  async function execute(state, method, args) {
    if (state.closed || state.poisoned) throw unavailable();
    const sql = String(typeof args[0] === 'object' ? args[0].sql : args[0]).trim();
    // Legacy lazy schema guards must never implicitly commit the audited transaction.
    // Deployment installs schema ahead of traffic; CREATE IF NOT EXISTS can be a no-op.
    if (/^(?:CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/i.test(sql)) {
      const create = sql.match(/^CREATE TABLE IF NOT EXISTS\s+`?(\w+)/i);
      if (create && tables.has(create[1])) return [{ affectedRows: 0 }, []];
      const alter = sql.match(/^ALTER TABLE\s+`?(\w+)`?\s+ADD\s+(?:COLUMN\s+)?`?(\w+)/i);
      if (alter && tables.get(alter[1])?.some(c => c.COLUMN_NAME === alter[2])) {
        throw Object.assign(new Error('Column already exists'), { code: 'ER_DUP_FIELDNAME' });
      }
      // Existing index additions are safe no-ops only after checking their names.
      const index = sql.match(/^ALTER TABLE\s+`?(\w+)`?\s+ADD\s+(?:UNIQUE\s+)?(?:INDEX|KEY)\s+`?(\w+)/i);
      if (index) {
        const [rows] = await state.connection.query('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?', [index[1], index[2]]);
        if (rows.length) throw Object.assign(new Error('Index already exists'), { code: 'ER_DUP_KEYNAME' });
      }
      state.poisoned = true;
      throw unavailable();
    }
    if (/^(?:COMMIT|ROLLBACK|START\s+TRANSACTION|SET\s+autocommit|CALL)\b/i.test(sql)) {
      state.poisoned = true;
      throw unavailable();
    }
    const mutation = sql.match(/^(?:INSERT(?: IGNORE)? INTO|REPLACE INTO|UPDATE(?: IGNORE)?|DELETE FROM)\s+`?(\w+)/i);
    if (mutation && !tables.has(mutation[1]) && !mutation[1].startsWith('admin_audit_')) {
      state.poisoned = true;
      throw unavailable();
    }
    try { return await state.connection[method](...args); }
    catch (error) {
      if (String(error.message).includes('AUDIT_LOG_UNAVAILABLE')) { state.poisoned = true; throw unavailable(); }
      throw error;
    }
  }
  for (const method of ['query', 'execute']) {
    pool[method] = (...args) => {
      const state = local.getStore();
      return state ? execute(state, method, args) : raw[method](...args);
    };
  }
  pool.getConnection = async () => {
    const state = local.getStore();
    if (!state) return raw.getConnection();
    let savepoint;
    let released = false;
    return {
      query: (...args) => execute(state, 'query', args),
      execute: (...args) => execute(state, 'execute', args),
      async beginTransaction() {
        if (released || savepoint) throw new Error('Invalid audit transaction lease');
        savepoint = `audit_sp_${++state.savepoint}`;
        await execute(state, 'query', [`SAVEPOINT ${savepoint}`]);
      },
      async commit() {
        if (savepoint) await execute(state, 'query', [`RELEASE SAVEPOINT ${savepoint}`]);
        savepoint = null;
      },
      async rollback() {
        if (savepoint && !state.closed) {
          await state.connection.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await state.connection.query(`RELEASE SAVEPOINT ${savepoint}`);
        }
        savepoint = null;
      },
      release() { released = true; },
      destroy() { released = true; state.poisoned = true; state.connection.destroy(); },
    };
  };
  async function actorFromRequest(req, ctx) {
    const token = ctx.extractToken(req);
    if (!token) return null;
    let payload;
    try { payload = jwt.verify(token, secret()); } catch (_) { return null; }
    const [rows] = await raw.query('SELECT id,username,role FROM users WHERE id=? LIMIT 1', [payload.id]);
    return rows[0] || null;
  }
  async function recordRejected(req, error, ctx) {
    if (current()) return true; // The response gate already owns this attempt.
    try {
      const actor = await actorFromRequest(req, ctx);
      let isStaff = actor && staffRoles.has(String(actor.role).toUpperCase());
      if (actor && !isStaff && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const [members] = await raw.query("SELECT 1 FROM course_staff_memberships WHERE user_id=? AND status='active' LIMIT 1", [actor.id]);
        isStaff = members.length > 0;
      }
      if (!operationFor(req.method, req.path, isStaff)) return true;
      const subject = authPath(req.path) && req.path !== '/logout' ? null : actor;
      const requestId = randomUUID();
      await raw.query(`INSERT INTO admin_audit_requests
        (request_id,actor_id,actor_name,actor_role,module,action,method,route,status,http_status,error_code,source_ip,completed_at)
        VALUES(?,?,?,?,?,?,?,'unmatched','failed',500,?,?,NOW(3))`,
      [requestId, subject?.id || null, subject?.username || null, subject?.role || null,
        moduleFor(req.path), actionFor(req.method, req.path), req.method,
        safeErrorCode(error?.code) || (error?.type === 'entity.parse.failed' ? 'INVALID_JSON' : 'UNHANDLED'), String(req.ip || '').slice(0, 64)]);
      return true;
    } catch (failure) { console.error('AUDIT_REJECTED_REQUEST_WRITE_FAILED', failure.code); return false; }
  }
  function middleware(ctx) {
    return async (req, res, next) => {
      if (req.method === 'OPTIONS' || req.path.startsWith('/admin/audit-logs')) return next();
      let actor;
      try { actor = await actorFromRequest(req, ctx); }
      catch (error) {
        console.error('AUDIT_IDENTITY_LOOKUP_FAILED', moduleFor(req.path), error.code);
        if (managedPath(req.path) || authPath(req.path) || !['GET', 'HEAD'].includes(req.method)) {
          return res.status(503).json({ ok: false, code: 'AUDIT_LOG_UNAVAILABLE', message: '操作日誌暫時無法使用' });
        }
        return next();
      }
      let isStaff = actor && staffRoles.has(String(actor.role).toUpperCase());
      if (actor && !isStaff && !['GET', 'HEAD'].includes(req.method)) {
        try {
          const [rows] = await raw.query("SELECT 1 FROM course_staff_memberships WHERE user_id=? AND status='active' LIMIT 1", [actor.id]);
          isStaff = rows.length > 0;
        } catch (error) {
          if (error.code !== 'ER_NO_SUCH_TABLE') return res.status(503).json({ ok: false, code: 'AUDIT_LOG_UNAVAILABLE' });
        }
      }
      if (!operationFor(req.method, req.path, isStaff)) return next();
      if (!ready) return res.status(503).json({ ok: false, code: 'AUDIT_LOG_UNAVAILABLE', message: '操作日誌尚未就緒，請聯絡管理員' });
      const state = { id: null, actor: authPath(req.path) && req.path !== '/logout' ? null : actor, savepoint: 0, afterCommit: [], rollbackCleanup: [], closed: false, poisoned: false, connection: null };
      const requestId = randomUUID();
      try {
        const [insert] = await raw.query(`INSERT INTO admin_audit_requests
          (request_id,actor_id,actor_name,actor_role,module,action,method,route,source_ip)
          VALUES(?,?,?,?,?,?,?,?,?)`, [requestId, state.actor?.id || null, state.actor?.username || null, state.actor?.role || null,
          moduleFor(req.path), actionFor(req.method, req.path), req.method, '/', String(req.ip || '').slice(0, 64)]);
        state.id = insert.insertId;
        state.connection = await raw.getConnection();
        await state.connection.query('SET @leader_audit_request = ?', [state.id]);
        await state.connection.beginTransaction();
      } catch (error) {
        if (state.connection) { state.connection.destroy(); }
        console.error('AUDIT_LOG_UNAVAILABLE', requestId, error.code);
        return res.status(503).json({ ok: false, code: 'AUDIT_LOG_UNAVAILABLE', message: '操作日誌暫時無法寫入' });
      }
      res.setHeader('X-Request-Id', requestId);
      const originalEnd = res.end.bind(res);
      const originalWrite = res.write.bind(res);
      const originalWriteHead = res.writeHead.bind(res);
      res.writeHead = (status, message, headers) => {
        res.statusCode = status;
        if (typeof message === 'string') res.statusMessage = message;
        const values = typeof message === 'object' ? message : headers;
        if (Array.isArray(values)) { for (let i = 0; i < values.length; i += 2) res.setHeader(values[i], values[i + 1]); }
        else if (values) for (const [name, value] of Object.entries(values)) res.setHeader(name, value);
        return res;
      };
      const chunks = [];
      let ending = false;
      let commitAttempted = false;
      let committed = false;
      const append = (chunk, encoding) => {
        if (chunk == null) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined);
        chunks.push(buffer);
      };
      res.write = (chunk, encoding, callback) => { append(chunk, encoding); (typeof encoding === 'function' ? encoding : callback)?.(); return true; };
      res.flushHeaders = () => {}; // Never release cookies/export headers before commit.
      async function cleanup() {
        state.closed = true;
        try { await state.connection.query('SET @leader_audit_request = NULL'); state.connection.release(); }
        catch (_) { state.connection.destroy(); }
      }
      res.on('close', () => {
        if (!ending && !state.closed) {
          ending = true;
          state.closed = true;
          state.connection.rollback().then(() => rollbackFiles(state)).finally(cleanup).catch(() => {});
          // Leave durable request pending: disconnected does not prove an outcome.
        }
      });
      res.end = (chunk, encoding, callback) => {
        if (ending) return res;
        ending = true;
        append(chunk, encoding);
        const body = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
        let json;
        try { json = JSON.parse(body.toString('utf8')); } catch (_) {}
        const finalize = async () => {
          try {
            if (state.poisoned) throw unavailable();
            const failed = res.statusCode >= 400 || json?.ok === false;
            const retainAuthAttempt = req.path === '/auth/email-code/verify' && ['EMAIL_CODE_INVALID', 'ACCOUNT_NOT_FOUND'].includes(json?.code);
            if (failed && !retainAuthAttempt) { await state.connection.rollback(); await rollbackFiles(state); await state.connection.beginTransaction(); }
            await recordOutcomes(state.connection, tables, state.id, req, json, failed);
            const route = String(req.route?.path || 'unmatched').slice(0, 255);
            const result = failed ? 'failed' : batchStatus(json?.data);
            const executor = state.connection;
            await executor.query(`UPDATE admin_audit_requests SET actor_id=?,actor_name=?,actor_role=?,
              route=?,action=?,status=?,http_status=?,error_code=?,completed_at=NOW(3) WHERE id=?`,
            [state.actor?.id || null, state.actor?.username || null, state.actor?.role || null,
              route, actionFor(req.method, req.route?.path || req.path, { action: req.params?.action || req.body?.action }), result, res.statusCode,
              safeErrorCode(json?.code), state.id]);
            commitAttempted = true; await state.connection.commit(); committed = true;
            if (!failed && state.hasFileWrite) await flushFileWrites(state.connection, state.id);
            if (!failed) for (const callback of state.afterCommit) {
              try { callback(); } catch (error) { console.error('AUDIT_POST_COMMIT_CACHE_FAILED', error.code); }
            }
            await cleanup();
            res.write = originalWrite;
            res.writeHead = originalWriteHead;
            originalEnd(body, typeof encoding === 'string' ? encoding : undefined, typeof encoding === 'function' ? encoding : callback);
          } catch (error) {
            try { await state.connection.rollback(); } catch (_) {}
            if (!commitAttempted) await rollbackFiles(state);
            const failureCode = committed ? 'AUDIT_EXTERNAL_EFFECT_FAILED' : commitAttempted ? 'AUDIT_COMMIT_UNCONFIRMED' : 'AUDIT_LOG_UNAVAILABLE';
            try { await state.connection.query("UPDATE admin_audit_requests SET status=?,error_code=?,http_status=503,completed_at=NOW(3) WHERE id=?", [committed ? 'partial' : commitAttempted ? 'pending' : 'failed', failureCode, state.id]); } catch (_) {}
            await cleanup();
            console.error(failureCode, requestId, error.code);
            res.statusCode = 503;
            for (const header of ['Set-Cookie', 'Content-Length', 'Content-Disposition', 'ETag', 'Location', 'Content-Encoding']) res.removeHeader(header);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.writeHead = originalWriteHead;
            originalEnd(JSON.stringify({ ok: false, code: failureCode, ...(committed ? { committed: true } : {}), message: committed ? '資料已提交，但檔案處理失敗或尚未確認，請查看操作日誌' : '操作日誌寫入或提交確認失敗，請重新查詢操作結果' }));
          }
        };
        // Keep the request context out of completion/worker bookkeeping.
        local.exit(() => { finalize().catch(error => { console.error('AUDIT_FINALIZE_FAILED', requestId, error.code); res.destroy(); }); });
        return res;
      };
      local.run(state, next);
    };
  }
  function registerEffects(ctx) {
    effects.mail = wrapEffect(ctx.transporter, 'sendMail', 'mail', args => args[0], () => ({ queued: true }));
    stagingRoot = path.join(ctx.storage.STORAGE_ROOT, '.audit-staging');
    effects['file-write'] = ctx.storage.writeBuffer.bind(ctx.storage);
    ctx.storage.writeBuffer = async (target, buffer, options) => {
      const state = current();
      if (!state) return effects['file-write'](target, buffer, options);
      if (state.closed || state.poisoned) throw unavailable();
      if (!Buffer.isBuffer(buffer)) throw new TypeError('buffer must be a Buffer');
      // Stage privately before commit; the published path is written only after
      // commit. Do not put multi-megabyte media into an SQL packet/outbox row.
      const stage = randomUUID();
      await fs.mkdir(stagingRoot, { recursive: true, mode: 0o700 });
      const stagedPath = path.join(stagingRoot, stage);
      const discard = () => fs.rm(stagedPath, { force: true });
      await fs.writeFile(stagedPath, buffer, { flag: 'wx', mode: 0o600 });
      state.rollbackCleanup.push(discard);
      try {
        await deferEffect('file-write', { path: target, stage, checksum: createHash('sha256').update(buffer).digest('hex'), options });
        return ctx.storage.resolveStoragePath(target);
      } catch (error) { await discard(); throw error; }
    };
    effects['file-delete'] = wrapEffect(ctx.storage, 'deleteFile', 'file-delete', ([path]) => ({ path }), () => true);
    effects['line-push'] = payload => ctx.httpsPostJson('https://api.line.me/v2/bot/message/push', payload, { Authorization: `Bearer ${process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN}` });
  }
  async function rollbackFiles(state) {
    for (const remove of state.rollbackCleanup.splice(0)) {
      try { await remove(); } catch (error) { console.error('AUDIT_STAGE_CLEANUP_FAILED', error.code); }
    }
  }
  async function deliverJob(db, job) {
    if (job.kind === 'file-delete') {
      const [unfinished] = await db.query("SELECT 1 FROM admin_audit_jobs WHERE request_id=? AND kind='file-write' AND status<>'success' LIMIT 1", [job.request_id]);
      if (unfinished.length) return false; // Preserve the old file if replacement failed.
    }
    const [claim] = await db.query("UPDATE admin_audit_jobs SET status='processing',started_at=NOW(3) WHERE id=? AND status='pending'", [job.id]);
    if (!claim.affectedRows) return false;
    let stagedPath;
    try {
      const payload = unseal(job.payload);
      if (job.kind === 'file-write') {
        if (!/^[0-9a-f-]{36}$/.test(payload.stage || '')) throw new Error('Invalid staging key');
        stagedPath = path.join(stagingRoot, payload.stage);
        const buffer = await fs.readFile(stagedPath);
        if (createHash('sha256').update(buffer).digest('hex') !== payload.checksum) throw new Error('Staged file checksum mismatch');
        await effects[job.kind](payload.path, buffer, payload.options);
      } else if (job.kind === 'file-delete') await effects[job.kind](payload.path);
      else if (effects[job.kind]) await effects[job.kind](payload);
      else throw new Error('Unsupported audit effect');
    } catch (error) {
      await db.query("UPDATE admin_audit_jobs SET status='failed',error_code=?,payload=NULL,completed_at=NOW(3) WHERE id=?", [safeErrorCode(error.code) || 'EXTERNAL_EFFECT_FAILED', job.id]);
      if (stagedPath) await fs.rm(stagedPath, { force: true }).catch(() => {});
      console.error('AUDIT_EXTERNAL_EFFECT_FAILED', job.id, job.kind);
      return false;
    }
    // If completion persistence fails, retain processing/unknown and the staged
    // file. An already delivered effect must not be automatically resent.
    await db.query("UPDATE admin_audit_jobs SET status='success',payload=NULL,completed_at=NOW(3) WHERE id=?", [job.id]);
    if (stagedPath) await fs.rm(stagedPath, { force: true }).catch(() => {});
    return true;
  }
  async function flushFileWrites(db, requestId) {
    const [jobs] = await db.query("SELECT id,kind,payload,status,request_id FROM admin_audit_jobs WHERE request_id=? AND kind='file-write' ORDER BY id", [requestId]);
    for (const job of jobs) {
      if (job.status === 'pending') await deliverJob(db, job);
      let finished = false;
      for (let poll = 0; poll < 100; poll++) {
        const [rows] = await db.query('SELECT status FROM admin_audit_jobs WHERE id=?', [job.id]);
        if (rows[0]?.status === 'success') { finished = true; break; }
        if (rows[0]?.status !== 'processing') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!finished) throw Object.assign(new Error('File effect incomplete'), { code: 'AUDIT_EXTERNAL_EFFECT_FAILED' });
    }
  }
  async function runJobs() {
    if (!ready || workerRunning) return;
    workerRunning = true;
    try {
      const [rows] = await raw.query("SELECT j.id,j.kind,j.payload,j.request_id FROM admin_audit_jobs j WHERE j.status='pending' AND (j.kind <> 'file-delete' OR NOT EXISTS (SELECT 1 FROM admin_audit_jobs w WHERE w.request_id=j.request_id AND w.kind='file-write' AND w.status <> 'success')) ORDER BY j.id LIMIT 20");
      for (const job of rows) await deliverJob(raw, job);
    } finally { workerRunning = false; }
  }
  function startWorker() {
    timer = setInterval(() => local.exit(() => runJobs().catch(error => console.error('AUDIT_WORKER_FAILED', error.code))), 1000);
    timer.unref?.();
  }
  return { raw, check, recordRejected, middleware, registerEffects, runJobs, startWorker, stop: () => clearInterval(timer), get tables() { return tables; } };
}
function safeErrorCode(value) { return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(value) ? value : null; }
function batchStatus(value) {
  if (!hasPartialFailure(value)) return 'success';
  const items = Array.isArray(value?.items) ? value.items : Array.isArray(value?.results) ? value.results : [];
  if (items.length && items.every(item => item?.ok === false || item?.success === false)) return 'failed';
  if (Number(value?.summary?.succeeded) === 0 && Number(value?.summary?.failed) > 0) return 'failed';
  return 'partial';
}
function hasPartialFailure(value) {
  if (!value || typeof value !== 'object') return false;
  return (Array.isArray(value.failed) && value.failed.length > 0) || Number(value.failedCount) > 0 || Number(value.summary?.failed) > 0
    || (Array.isArray(value.items) && value.items.some(item => item?.ok === false || item?.success === false))
    || (Array.isArray(value.results) && value.results.some(item => item?.ok === false || item?.success === false));
}
module.exports = { configureSecret, installAudit, authenticatedActor, current, afterCommit, deferEffect, operationFor, moduleFor, safeErrorCode, batchStatus, hasPartialFailure, seal, unseal };
