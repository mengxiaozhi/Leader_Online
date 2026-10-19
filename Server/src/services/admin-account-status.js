'use strict';

// Use current account rows and immutable IDs. Order/contact/email snapshots may
// belong to a deleted account even when that email has since been registered again.
function isDeletedAccount(user = {}) {
  return /^deleted\+.+@example\.invalid$/i.test(String(user.email || '').trim())
    || String(user.username || '').trim() === 'Deleted User';
}

const RELATIONS = [
  ['account', ['user_id', 'userId', 'accountUserId', 'memberUserId', 'buyerUserId']],
  ['owner', ['owner_user_id', 'ownerUserId']],
  ['provider', ['provider_user_id', 'providerUserId', 'provider_id', 'providerId', 'binding_provider_user_id', 'provider_user_id_snapshot']],
  ['driver', ['driver_id', 'driverId']],
  ['coach', ['coach_user_id', 'coachUserId']],
];
const NESTED_RELATIONS = [
  ['account', 'user', ['id']],
  ['account', 'student', ['user_id', 'userId']],
  ['provider', 'provider', ['id', 'user_id', 'userId']],
  ['deliveryPoint', 'delivery_point', ['owner_user_id', 'ownerUserId']],
  ['driver', 'driver', ['id', 'userId']],
  ['coach', 'coach', ['user_id', 'userId']],
];
const SNAPSHOTS = new Set(['details', 'contactSnapshot', 'contact_snapshot', 'metadata', 'lifecycle', 'accountRelations']);
const idText = value => value == null ? '' : String(value).trim();
const isObject = value => value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

function isAdminAccountStatusRequest(req = {}) {
  if (req.method !== 'GET' || !req.user?.id) return false;
  return /^\/admin\/(?:users|products|events|store_templates|tickets|reservations|orders|delivery-points|delivery-point-bindings|courses)(?:\/|$)/.test(req.path || '')
    || /^\/provider\/(?:drivers|delivery-point-bindings)(?:\/|$)/.test(req.path || '')
    || /^\/delivery-point\/(?:events\/available|services|me|providers|provider-bindings)(?:\/|$)/.test(req.path || '')
    || /^\/driver\/reservations(?:\/|$)/.test(req.path || '')
    || (req.path === '/tasks/me' && ['ADMIN', 'SERVICE_PROVIDER', 'DRIVER', 'DELIVERY_POINT', 'STORE', 'EDITOR'].includes(String(req.user.role || '').toUpperCase()));
}

async function attachAdminAccountStatuses(pool, data, { path = '' } = {}) {
  const nodes = [];
  const ids = new Set();
  const rootUsers = /^\/(?:admin\/users|provider\/drivers|delivery-point\/providers)$/.test(path);
  const rootDriver = path === '/provider/drivers';
  const seen = new WeakSet();
  function visit(value, key = '', isRootRecord = false) {
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, key, isRootRecord));
      return;
    }
    if (!isObject(value) || seen.has(value)) return;
    seen.add(value);
    const refs = [];
    const addRef = (relation, rawId) => {
      const id = idText(rawId);
      if (!id || refs.some(ref => ref.id === id && ref.relation === relation)) return;
      refs.push({ relation, id });
      ids.add(id);
    };
    if (rootUsers && isRootRecord) addRef(rootDriver ? 'driver' : 'account', value.id);
    for (const [relation, fields] of RELATIONS) {
      const field = fields.find(field => idText(value[field]));
      if (field) addRef(relation, value[field]);
    }
    for (const [relation, field, idFields] of NESTED_RELATIONS) {
      const nested = value[field];
      if (!isObject(nested)) continue;
      const idField = idFields.find(idField => idText(nested[idField]));
      if (idField) addRef(relation, nested[idField]);
    }
    if (refs.length) nodes.push({ value, refs });
    for (const [childKey, child] of Object.entries(value)) {
      if (SNAPSHOTS.has(childKey)) continue;
      visit(child, childKey, rootUsers && childKey === 'items');
    }
  }
  // Clone the response only. Never mutate cached catalogs or persisted records.
  const result = structuredClone(data);
  visit(result, '', Array.isArray(result) || (rootUsers && isObject(result) && 'id' in result));
  if (!ids.size) return result;
  const states = new Map();
  const accountIds = [...ids];
  for (let offset = 0; offset < accountIds.length; offset += 200) {
    const batch = accountIds.slice(offset, offset + 200);
    const [rows] = await pool.query(
      `SELECT id, username, email FROM users WHERE id IN (${batch.map(() => '?').join(',')})`,
      batch
    );
    for (const row of rows) states.set(idText(row.id), isDeletedAccount(row) ? 'deleted' : 'active');
  }
  for (const { value, refs } of nodes) {
    const warnings = [];
    const warnedIds = new Set();
    for (const { relation, id } of refs) {
      const status = states.get(id) || 'missing';
      if (status === 'active' || warnedIds.has(id)) continue;
      warnings.push({ relation, status });
      warnedIds.add(id);
    }
    value.accountRelations = warnings;
    if (refs.some(ref => ref.relation === 'account')) {
      value.accountDeleted = refs.some(ref => ref.relation === 'account' && states.get(ref.id) === 'deleted');
    }
  }
  return result;
}

function withAdminAccountStatuses(ctx) {
  return {
    ...ctx,
    ok: async (res, data, ...args) => {
      if (!isAdminAccountStatusRequest(res.req)) return ctx.ok(res, data, ...args);
      try {
        return ctx.ok(res, await attachAdminAccountStatuses(ctx.pool, data, { path: res.req.path }), ...args);
      } catch (error) {
        console.error('[admin-account-status] lookup failed', error?.code || error?.name || 'UNKNOWN');
        return ctx.fail(res, 'ACCOUNT_STATUS_LOOKUP_FAIL', '關聯帳號狀態暫時無法確認，請稍後重新載入', 500);
      }
    },
  };
}

module.exports = { isDeletedAccount, isAdminAccountStatusRequest, attachAdminAccountStatuses, withAdminAccountStatuses };
