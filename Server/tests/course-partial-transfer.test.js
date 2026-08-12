const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createCourseV2Domain,
  partialTransferBlockReason,
} = require('../src/services/course-v2-domain');
const { registerCourseV2Routes } = require('../src/routes/course-v2');

const SOURCE_USER = '11111111-1111-1111-1111-111111111111';
const RECIPIENT_USER = '22222222-2222-2222-2222-222222222222';

function normalized(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function activeRuntimeRows(sql) {
  const query = normalized(sql);
  if (query.startsWith('SELECT version, applied_at FROM course_schema_versions')) {
    return [[{ version: '049_course_count_card_normalization' }]];
  }
  if (query.startsWith('SELECT state, schema_version, maintenance_mode')) {
    return [[{
      state: 'active',
      schema_version: '049_course_count_card_normalization',
      maintenance_mode: 0,
    }]];
  }
  if (query.startsWith('SELECT version FROM course_schema_versions WHERE version = ?')) {
    return [[{ version: '051_course_count_card_operational_parity' }]];
  }
  if (query.startsWith('SELECT * FROM course_settings')) {
    return [[{
      scope: 'provider',
      scope_key: 'provider:provider-1',
      count_card_parity_enabled: 1,
    }]];
  }
  return null;
}

test('partial transfer eligibility is finite-only, subtracts active holds, and treats zero max as unlimited', () => {
  const base = {
    status: 'active',
    usage_mode: 'finite',
    product_transferable_snapshot: 1,
    max_transfer_operations_snapshot: 0,
  };
  assert.equal(partialTransferBlockReason(base, {
    quantity: 3,
    remainingUses: 5,
    heldUses: 2,
    acceptedOperations: 99,
  }), '');
  assert.equal(partialTransferBlockReason(base, {
    quantity: 4,
    remainingUses: 5,
    heldUses: 2,
  }), '可轉讓堂數不足');
  assert.equal(partialTransferBlockReason({
    ...base,
    usage_mode: 'unlimited',
  }, {
    quantity: 1,
    remainingUses: 0,
    heldUses: 0,
  }), '無限次票不可由會員自助轉讓');
  assert.equal(partialTransferBlockReason({
    ...base,
    max_transfer_operations_snapshot: 1,
  }, {
    quantity: 1,
    remainingUses: 5,
    heldUses: 0,
    acceptedOperations: 1,
  }), '此票券已達轉讓操作次數上限');
});

test('partial transfer feature is fail-closed until the 051 runtime flag is enabled', async () => {
  const domain = createCourseV2Domain({
    pool: { async query() { throw new Error('disabled feature must not query'); } },
    enabled: true,
    countCardParityEnabled: false,
  });
  await assert.rejects(
    domain.assertCountCardParity(),
    (error) => error.code === 'COURSE_COUNT_CARD_PARITY_DISABLED' && error.statusCode === 503
  );
});

test('member partial-transfer list remains visible after provider rollback and returns directional DTOs', async () => {
  const observed = [];
  const pool = {
    async query(sql, params = []) {
      const runtime = activeRuntimeRows(sql);
      if (runtime) return runtime;
      const query = normalized(sql);
      observed.push({ query, params });
      if (query.startsWith('SELECT tr.id, tr.ticket_id AS source_ticket_id')) {
        return [[
          {
            id: 71,
            source_ticket_id: 9,
            child_ticket_id: null,
            from_user_id: SOURCE_USER,
            to_user_id: RECIPIENT_USER,
            from_email: 'sender@example.com',
            to_email: 'recipient@example.com',
            from_username: '原持有人',
            to_username: '受讓人',
            quantity: 2,
            status: 'pending',
            expires_at: '2026-08-20 12:00:00',
            row_version: 3,
            source_ticket_code: 'CTK-SOURCE',
            source_ticket_row_version: 8,
            source_product_name: '游泳 10 堂',
            provider_owner_user_id: 'provider-1',
            provider_name: '游泳教室',
          },
          {
            id: 72,
            source_ticket_id: 10,
            child_ticket_id: 20,
            from_user_id: RECIPIENT_USER,
            to_user_id: SOURCE_USER,
            from_email: 'recipient@example.com',
            to_email: 'sender@example.com',
            from_username: '受讓人',
            to_username: '原持有人',
            quantity: 1,
            status: 'accepted',
            row_version: 2,
            source_ticket_code: 'CTK-PARENT',
            source_ticket_row_version: 5,
            source_product_name: '小鐵人',
            child_ticket_code: 'CTK-CHILD',
            child_ticket_row_version: 1,
            child_product_name: '小鐵人',
            provider_owner_user_id: null,
            provider_name: '',
          },
        ]];
      }
      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
  const domain = createCourseV2Domain({
    pool,
    enabled: true,
    countCardParityEnabled: true,
  });
  const result = await domain.listMemberPartialTransfers({
    userId: SOURCE_USER,
    limit: 50,
  });

  assert.equal(result.outgoing.length, 1);
  assert.equal(result.incoming.length, 1);
  assert.deepEqual(result.outgoing[0], {
    id: 71,
    rowVersion: 3,
    transferMode: 'PARTIAL',
    direction: 'outgoing',
    quantity: 2,
    status: 'pending',
    expiresAt: '2026-08-20 12:00:00',
    createdAt: null,
    updatedAt: null,
    acceptedAt: null,
    declinedAt: null,
    cancelledAt: null,
    provider: { userId: 'provider-1', displayName: '游泳教室', isPlatform: false },
    counterparty: {
      userId: RECIPIENT_USER,
      displayName: '受讓人',
      email: 'recipient@example.com',
    },
    sourceTicket: {
      id: 9,
      code: 'CTK-SOURCE',
      productName: '游泳 10 堂',
      rowVersion: 8,
    },
    childTicket: null,
    capabilities: { accept: false, decline: false, cancel: true },
  });
  assert.equal(result.incoming[0].childTicket.code, 'CTK-CHILD');
  assert.equal(result.incoming[0].counterparty.displayName, '受讓人');
  assert.equal(result.incoming[0].capabilities.accept, false);
  assert.match(observed[0].query, /tr\.transfer_mode = 'PARTIAL'/);
  assert.doesNotMatch(observed[0].query, /provider_settings\.count_card_parity_enabled/);
  assert.doesNotMatch(observed[0].query, /platform_settings\.count_card_parity_enabled/);
  assert.deepEqual(observed[0].params, [SOURCE_USER, SOURCE_USER, 50]);
});

test('member partial-transfer route probes the 049 runtime and 051 gate before listing', async () => {
  const routes = new Map();
  const router = {};
  for (const method of ['get', 'post', 'patch']) {
    router[method] = (routePath, ...handlers) => routes.set(`${method.toUpperCase()} ${routePath}`, handlers);
  }
  const calls = [];
  const domain = {
    enabled: true,
    async assertSchema(options) { calls.push(['schema', options]); return { state: 'active' }; },
    async assertCountCardParity() { calls.push(['count-card']); return true; },
    async listMemberPartialTransfers(options) {
      calls.push(['list', options]);
      return { incoming: [], outgoing: [] };
    },
  };
  const ctx = {
    pool: {},
    authRequired(_req, _res, next) { return next?.(); },
    ok(res, data) { return res.status(200).json({ ok: true, data }); },
    fail(res, code, message, status) { return res.status(status).json({ ok: false, code, message }); },
  };
  registerCourseV2Routes({ router, ctx, domain });
  const handlers = routes.get('GET /courses/tickets/transfers');
  assert.ok(handlers, 'member partial-transfer list route is registered');
  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };
  await handlers.at(-1)({ user: { id: SOURCE_USER }, query: { limit: '25' } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.data, { incoming: [], outgoing: [] });
  assert.deepEqual(calls, [
    ['schema', { requireActive: true }],
    ['count-card'],
    ['list', { userId: SOURCE_USER, limit: '25' }],
  ]);
});

test('partial transfer initiation creates an equal TRANSFER hold and is idempotent', async () => {
  const queries = [];
  const ticket = {
    id: 9,
    code: 'TK-9',
    user_id: SOURCE_USER,
    student_id: 19,
    product_id: null,
    ticket_product_id: 3,
    status: 'active',
    frozen_at: null,
    expires_at: '2099-01-01',
    row_version: 7,
    usage_mode: 'finite',
    product_transferable_snapshot: 1,
    max_transfer_operations_snapshot: 0,
    resolved_max_transfer_operations: 0,
    accepted_transfer_operations: 4,
    provider_owner_user_id: 'provider-1',
    resolved_product_name: '游泳計次卡',
    total_uses: 6,
  };
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      const query = normalized(sql);
      queries.push({ query, params });
      const runtime = activeRuntimeRows(query);
      if (runtime) return runtime;
      if (query.startsWith('SELECT id, username, email FROM users WHERE id IN')) {
        return [[
          { id: SOURCE_USER, username: '原持有人', email: 'source@example.com' },
          { id: RECIPIENT_USER, username: '受讓人', email: 'recipient@example.com' },
        ]];
      }
      if (query.startsWith('INSERT IGNORE INTO course_mutation_commands')) {
        return [{ affectedRows: 1, insertId: 80 }];
      }
      if (query.startsWith('SELECT t.*, COALESCE(t.usage_mode_snapshot')) return [[ticket]];
      if (query.startsWith('SELECT t.id, t.user_id, t.student_id')) return [[ticket]];
      if (query.startsWith('SELECT COALESCE(SUM(delta_uses)')) return [[{ balance: 6 }]];
      if (query.startsWith('SELECT COALESCE(SUM(quantity)')) return [[{ active_holds: 1 }]];
      if (query.startsWith('INSERT INTO course_ticket_transfers')) {
        return [{ affectedRows: 1, insertId: 55 }];
      }
      if (query.startsWith('INSERT INTO course_ticket_holds')) return [{ affectedRows: 1, insertId: 66 }];
      if (query.startsWith('UPDATE course_tickets SET row_version')) return [{ affectedRows: 1 }];
      if (query.startsWith('UPDATE course_ticket_transfers SET hold_id')) return [{ affectedRows: 1 }];
      if (query.startsWith('UPDATE course_mutation_commands')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
  const pool = {
    getConnection: async () => conn,
    async query(sql, params = []) {
      const query = normalized(sql);
      const runtime = activeRuntimeRows(query);
      if (runtime) return runtime;
      if (query.startsWith('SELECT id, username, email FROM users')) {
        assert.deepEqual(params, [RECIPIENT_USER]);
        return [[{ id: RECIPIENT_USER, username: '受讓人', email: 'recipient@example.com' }]];
      }
      throw new Error(`Unexpected pool SQL: ${query}`);
    },
  };
  const domain = createCourseV2Domain({ pool, enabled: true, countCardParityEnabled: true });
  const result = await domain.initiatePartialTransfer({
    ticketId: 9,
    actorUserId: SOURCE_USER,
    recipientUserId: RECIPIENT_USER,
    quantity: 2,
    idempotencyKey: 'partial-init-0009',
    expectedRowVersion: 7,
  });
  assert.equal(result.transferId, 55);
  assert.equal(result.holdId, 66);
  assert.equal(result.quantity, 2);
  assert.equal(result.availableUses, 3);
  assert.equal(result.ticketRowVersion, 8);
  const holdInsert = queries.find(({ query }) => query.startsWith('INSERT INTO course_ticket_holds'));
  assert.equal(holdInsert.params[3], 2);
  assert.equal(holdInsert.params[4], 'TRANSFER');
  assert.equal(holdInsert.params[5], 'partial_transfer');
  assert.equal(holdInsert.params[6], '55');

  const replayResponse = { ...result, replayed: undefined };
  const replayConn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql) {
      const query = normalized(sql);
      const runtime = activeRuntimeRows(query);
      if (runtime) return runtime;
      if (query.startsWith('SELECT id, username, email FROM users WHERE id IN')) {
        return [[
          { id: SOURCE_USER, username: '原持有人', email: 'source@example.com' },
          { id: RECIPIENT_USER, username: '受讓人', email: 'recipient@example.com' },
        ]];
      }
      if (query.startsWith('INSERT IGNORE INTO course_mutation_commands')) return [{ affectedRows: 0 }];
      if (query.startsWith('SELECT id, request_hash, status, response_json')) {
        const { requestHash } = require('../src/services/course-v2-domain');
        return [[{
          id: 80,
          request_hash: requestHash({
            ticketId: 9,
            recipientUserId: RECIPIENT_USER,
            quantity: 2,
            expectedRowVersion: 7,
          }),
          status: 'completed',
          response_json: JSON.stringify(replayResponse),
        }]];
      }
      throw new Error(`Replay reached unexpected SQL: ${query}`);
    },
  };
  pool.getConnection = async () => replayConn;
  const replayed = await domain.initiatePartialTransfer({
    ticketId: 9,
    actorUserId: SOURCE_USER,
    recipientUserId: RECIPIENT_USER,
    quantity: 2,
    idempotencyKey: 'partial-init-0009',
    expectedRowVersion: 7,
  });
  assert.equal(replayed.transferId, 55);
  assert.equal(replayed.replayed, true);
});

test('partial transfer preview rejects a shop product whose provider scope changed', async () => {
  const ticket = {
    id: 9,
    user_id: SOURCE_USER,
    product_id: 8,
    status: 'active',
    row_version: 3,
    usage_mode: 'finite',
    product_transferable_snapshot: 1,
    max_transfer_operations_snapshot: 0,
    accepted_transfer_operations: 0,
    provider_owner_user_id: 'provider-a',
    total_uses: 4,
  };
  const pool = {
    async query(sql) {
      const query = normalized(sql);
      const runtime = activeRuntimeRows(query);
      if (runtime) return runtime;
      if (query.startsWith('SELECT t.*, COALESCE(t.usage_mode_snapshot')) return [[ticket]];
      if (query.startsWith('SELECT t.id, t.user_id, t.student_id')) return [[ticket]];
      if (query.startsWith('SELECT COALESCE(SUM(delta_uses)')) return [[{ balance: 4 }]];
      if (query.startsWith('SELECT COALESCE(SUM(quantity)')) return [[{ active_holds: 0 }]];
      if (query.startsWith('SELECT id, username, email FROM users')) {
        return [[{ id: RECIPIENT_USER, username: '受讓人', email: 'recipient@example.com' }]];
      }
      if (query.startsWith('SELECT id, owner_user_id, require_addon_for_new FROM course_products')) {
        return [[]];
      }
      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
  const domain = createCourseV2Domain({ pool, enabled: true, countCardParityEnabled: true });
  await assert.rejects(
    domain.previewPartialTransfer({
      ticketId: 9,
      actorUserId: SOURCE_USER,
      recipientUserId: RECIPIENT_USER,
      quantity: 1,
    }),
    (error) => error.code === 'COURSE_TRANSFER_PROVIDER_SCOPE_CONFLICT'
  );
});

test('partial transfer preview revalidates required add-ons for the recipient account', async () => {
  const ticket = {
    id: 9,
    user_id: SOURCE_USER,
    product_id: 8,
    status: 'active',
    row_version: 3,
    usage_mode: 'finite',
    product_transferable_snapshot: 1,
    max_transfer_operations_snapshot: 0,
    accepted_transfer_operations: 0,
    provider_owner_user_id: 'provider-1',
    total_uses: 4,
  };
  const pool = {
    async query(sql) {
      const query = normalized(sql);
      const runtime = activeRuntimeRows(query);
      if (runtime) return runtime;
      if (query.startsWith('SELECT t.*, COALESCE(t.usage_mode_snapshot')) return [[ticket]];
      if (query.startsWith('SELECT t.id, t.user_id, t.student_id')) return [[ticket]];
      if (query.startsWith('SELECT COALESCE(SUM(delta_uses)')) return [[{ balance: 4 }]];
      if (query.startsWith('SELECT COALESCE(SUM(quantity)')) return [[{ active_holds: 0 }]];
      if (query.startsWith('SELECT id, username, email FROM users')) {
        return [[{ id: RECIPIENT_USER, username: '受讓人', email: 'recipient@example.com' }]];
      }
      if (query.startsWith('SELECT id, owner_user_id, require_addon_for_new FROM course_products')) {
        return [[{ id: 8, owner_user_id: 'provider-1', require_addon_for_new: 1 }]];
      }
      if (query.startsWith('SELECT previous.id FROM course_product_returning_requirements')) return [[]];
      if (query.startsWith('SELECT DISTINCT COALESCE(component.ticket_product_id')) {
        return [[{ ticket_product_id: 99 }]];
      }
      if (query.startsWith('SELECT DISTINCT owned.ticket_product_id')) return [[]];
      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
  const domain = createCourseV2Domain({ pool, enabled: true, countCardParityEnabled: true });
  await assert.rejects(
    domain.previewPartialTransfer({
      ticketId: 9,
      actorUserId: SOURCE_USER,
      recipientUserId: RECIPIENT_USER,
      quantity: 1,
    }),
    (error) => error.code === 'COURSE_TRANSFER_ADDON_REQUIRED'
  );
});

test('accepting a partial transfer atomically creates a child ticket and paired ledger facts', async () => {
  let transferOutWritten = false;
  let transferInWritten = false;
  let holdConsumed = false;
  const transfer = {
    id: 55,
    ticket_id: 9,
    transfer_mode: 'PARTIAL',
    quantity: 2,
    hold_id: 66,
    child_ticket_id: null,
    from_user_id: SOURCE_USER,
    to_user_id: RECIPIENT_USER,
    from_email: 'source@example.com',
    to_email: 'recipient@example.com',
    status: 'pending',
    expires_at: '2099-01-01 00:00:00',
    row_version: 1,
  };
  const sourceTicket = {
    id: 9,
    code: 'TK-9',
    user_id: SOURCE_USER,
    student_id: 19,
    product_id: null,
    ticket_product_id: 3,
    status: 'active',
    activated_at: '2026-01-01 00:00:00',
    activation_deadline: '2026-12-31',
    expires_at: '2027-12-31',
    frozen_at: null,
    row_version: 8,
    usage_mode: 'finite',
    product_transferable_snapshot: 1,
    transferable: 1,
    max_transfer_operations_snapshot: 0,
    resolved_max_transfer_operations: 0,
    accepted_transfer_operations: 0,
    provider_owner_user_id: 'provider-1',
    provider_name_snapshot: '服務商',
    resolved_product_name: '游泳計次卡',
    product_code_snapshot: 'SWIM',
    product_name_snapshot: '游泳計次卡',
    product_class_count_snapshot: 10,
    product_type_snapshot: 'count_pass',
    usage_notice_scope_snapshot: 'product',
    product_valid_days_snapshot: 120,
    product_activation_days_snapshot: 120,
    product_max_transfers_snapshot: 1,
    pause_max_operations_snapshot: 1,
    pause_max_days_snapshot: 365,
    total_uses: 10,
  };
  const childTicket = {
    id: 70,
    user_id: RECIPIENT_USER,
    student_id: 29,
    total_uses: 2,
    status: 'active',
    activated_at: sourceTicket.activated_at,
    expires_at: sourceTicket.expires_at,
    row_version: 1,
    usage_mode: 'finite',
  };
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      const query = normalized(sql);
      const runtime = activeRuntimeRows(query);
      if (runtime) return runtime;
      if (query.startsWith('SELECT id, username, email FROM users WHERE id IN')) {
        return [[
          { id: SOURCE_USER, username: '原持有人', email: transfer.from_email },
          { id: RECIPIENT_USER, username: '受讓人', email: transfer.to_email },
        ]];
      }
      if (query.startsWith('INSERT IGNORE INTO course_mutation_commands')) {
        return [{ affectedRows: 1, insertId: 81 }];
      }
      if (query.startsWith('SELECT tr.* FROM course_ticket_transfers')) return [[transfer]];
      if (query.startsWith('SELECT t.*, COALESCE(t.usage_mode_snapshot')) return [[sourceTicket]];
      if (query.startsWith('SELECT t.id, t.user_id, t.student_id')) {
        return [[Number(params[0]) === 70 ? childTicket : sourceTicket]];
      }
      if (query.startsWith('SELECT COALESCE(SUM(delta_uses)')) {
        if (Number(params[0]) === 70) return [[{ balance: transferInWritten ? 2 : 0 }]];
        return [[{ balance: transferOutWritten ? 3 : 5 }]];
      }
      if (query.startsWith('SELECT COALESCE(SUM(quantity)')) {
        return [[{ active_holds: Number(params[0]) === 9 && !holdConsumed ? 2 : 0 }]];
      }
      if (query.startsWith('SELECT * FROM course_ticket_holds')) {
        return [[{
          id: 66,
          ticket_id: 9,
          purpose: 'TRANSFER',
          quantity: 2,
          status: 'active',
        }]];
      }
      if (query.startsWith('SELECT * FROM course_students')) {
        return [[{
          id: 29,
          user_id: RECIPIENT_USER,
          email_normalized: transfer.to_email,
        }]];
      }
      if (query.startsWith('UPDATE course_students')) return [{ affectedRows: 1 }];
      if (query.startsWith('SELECT id FROM course_tickets WHERE code')) return [[]];
      if (query.startsWith('INSERT INTO course_tickets')) {
        const placeholders = (query.match(/\?/g) || []).length;
        assert.equal(placeholders, params.length, 'child ticket INSERT placeholder count');
        return [{ affectedRows: 1, insertId: 70 }];
      }
      if (query.startsWith('INSERT INTO course_usage_events')) {
        const placeholders = (query.match(/\?/g) || []).length;
        assert.equal(placeholders, params.length, 'usage event INSERT placeholder count');
        const eventType = params[7];
        if (eventType === 'TRANSFER_OUT') transferOutWritten = true;
        if (eventType === 'TRANSFER_IN') transferInWritten = true;
        return [{ affectedRows: 1, insertId: eventType === 'TRANSFER_OUT' ? 100 : 101 }];
      }
      if (query.startsWith('SELECT t.status, t.activated_at')) {
        return [[Number(params[0]) === 70 ? childTicket : sourceTicket]];
      }
      if (query.startsWith('UPDATE course_tickets SET remaining_uses_cache')) return [{ affectedRows: 1 }];
      if (query.startsWith('UPDATE course_ticket_holds')) {
        holdConsumed = true;
        assert.equal(params[0], 'consumed');
        assert.equal(params[3], 100);
        return [{ affectedRows: 1 }];
      }
      if (query.startsWith('UPDATE course_ticket_transfers SET status =')) return [{ affectedRows: 1 }];
      if (query.startsWith('INSERT IGNORE INTO course_ticket_transfer_logs')) return [{ affectedRows: 2 }];
      if (query.startsWith('UPDATE course_mutation_commands')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
  const pool = {
    getConnection: async () => conn,
    async query(sql) {
      const query = normalized(sql);
      const runtime = activeRuntimeRows(query);
      if (runtime) return runtime;
      if (query.startsWith('SELECT tr.* FROM course_ticket_transfers')) return [[transfer]];
      throw new Error(`Unexpected pool SQL: ${query}`);
    },
  };
  const domain = createCourseV2Domain({ pool, enabled: true, countCardParityEnabled: true });
  const result = await domain.acceptPartialTransfer({
    transferId: 55,
    actorUserId: RECIPIENT_USER,
    idempotencyKey: 'partial-accept-0055',
    expectedRowVersion: 1,
  });
  assert.equal(result.status, 'accepted');
  assert.equal(result.childTicketId, 70);
  assert.equal(result.transferOutEventId, 100);
  assert.equal(result.transferInEventId, 101);
  assert.equal(transferOutWritten, true);
  assert.equal(transferInWritten, true);
  assert.equal(holdConsumed, true);
});

test('decline and expiry release the TRANSFER hold without writing usage', async () => {
  const transfer = {
    id: 55,
    ticket_id: 9,
    transfer_mode: 'PARTIAL',
    quantity: 2,
    hold_id: 66,
    from_user_id: SOURCE_USER,
    to_user_id: RECIPIENT_USER,
    status: 'pending',
    expires_at: '2099-01-01 00:00:00',
    row_version: 1,
  };
  let usageWrites = 0;
  let holdReleases = 0;
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql) {
      const query = normalized(sql);
      const runtime = activeRuntimeRows(query);
      if (runtime) return runtime;
      if (query.startsWith('SELECT id FROM users WHERE id IN')) return [[{ id: SOURCE_USER }, { id: RECIPIENT_USER }]];
      if (query.startsWith('INSERT IGNORE INTO course_mutation_commands')) return [{ affectedRows: 1, insertId: 90 }];
      if (query.startsWith('SELECT tr.* FROM course_ticket_transfers')) return [[transfer]];
      if (query.startsWith('SELECT * FROM course_ticket_holds')) {
        return [[{ id: 66, ticket_id: 9, purpose: 'TRANSFER', quantity: 2, status: 'active' }]];
      }
      if (query.startsWith('UPDATE course_ticket_holds')) {
        holdReleases += 1;
        return [{ affectedRows: 1 }];
      }
      if (query.startsWith('UPDATE course_tickets SET row_version')) return [{ affectedRows: 1 }];
      if (query.startsWith('UPDATE course_ticket_transfers SET status')) return [{ affectedRows: 1 }];
      if (query.startsWith('UPDATE course_mutation_commands')) return [{ affectedRows: 1 }];
      if (query.startsWith('INSERT INTO course_usage_events')) {
        usageWrites += 1;
        return [{ insertId: 1 }];
      }
      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
  const pool = {
    getConnection: async () => conn,
    async query(sql) {
      const query = normalized(sql);
      const runtime = activeRuntimeRows(query);
      if (runtime) return runtime;
      if (query.startsWith('SELECT tr.* FROM course_ticket_transfers')) return [[transfer]];
      throw new Error(`Unexpected pool SQL: ${query}`);
    },
  };
  const domain = createCourseV2Domain({ pool, enabled: true, countCardParityEnabled: true });
  const declined = await domain.resolvePartialTransfer({
    transferId: 55,
    actorUserId: RECIPIENT_USER,
    action: 'decline',
    idempotencyKey: 'partial-decline-0055',
    expectedRowVersion: 1,
  });
  assert.equal(declined.status, 'declined');
  assert.equal(holdReleases, 1);
  assert.equal(usageWrites, 0);

  transfer.id = 56;
  transfer.hold_id = 67;
  transfer.expires_at = '2020-01-01 00:00:00';
  conn.query = async (sql) => {
    const query = normalized(sql);
    const runtime = activeRuntimeRows(query);
    if (runtime) return runtime;
    if (
      query.startsWith('SELECT tr.*, COALESCE(t.provider_user_id_snapshot')
      && query.includes('FOR UPDATE SKIP LOCKED')
    ) {
      return [[{ ...transfer, provider_owner_user_id: 'provider-1' }]];
    }
    if (query.startsWith('SELECT * FROM course_ticket_holds')) {
      return [[{ id: 67, ticket_id: 9, purpose: 'TRANSFER', quantity: 2, status: 'active' }]];
    }
    if (query.startsWith('UPDATE course_ticket_holds')) {
      holdReleases += 1;
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith('UPDATE course_tickets SET row_version')) return [{ affectedRows: 1 }];
    if (query.startsWith('UPDATE course_ticket_transfers SET status')) return [{ affectedRows: 1 }];
    if (query.startsWith('INSERT INTO course_usage_events')) usageWrites += 1;
    throw new Error(`Unexpected expiry SQL: ${query}`);
  };
  const expired = await domain.processDuePartialTransfers({ limit: 10 });
  assert.deepEqual(expired.map((item) => item.status), ['expired']);
  assert.equal(holdReleases, 2);
  assert.equal(usageWrites, 0);
});

test('a competing accept observes the locked non-pending state and rolls back', async () => {
  const candidate = {
    id: 55,
    ticket_id: 9,
    transfer_mode: 'PARTIAL',
    quantity: 2,
    hold_id: 66,
    from_user_id: SOURCE_USER,
    to_user_id: RECIPIENT_USER,
    status: 'pending',
    expires_at: '2099-01-01 00:00:00',
    row_version: 1,
  };
  let rolledBack = false;
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() { rolledBack = true; },
    release() {},
    async query(sql) {
      const query = normalized(sql);
      const runtime = activeRuntimeRows(query);
      if (runtime) return runtime;
      if (query.startsWith('SELECT id, username, email FROM users WHERE id IN')) {
        return [[
          { id: SOURCE_USER, email: 'source@example.com' },
          { id: RECIPIENT_USER, email: 'recipient@example.com' },
        ]];
      }
      if (query.startsWith('INSERT IGNORE INTO course_mutation_commands')) return [{ affectedRows: 1, insertId: 91 }];
      if (query.startsWith('SELECT tr.* FROM course_ticket_transfers')) {
        return [[{ ...candidate, status: 'accepted', child_ticket_id: 70, row_version: 2 }]];
      }
      throw new Error(`Unexpected competition SQL: ${query}`);
    },
  };
  const pool = {
    getConnection: async () => conn,
    async query(sql) {
      const query = normalized(sql);
      const runtime = activeRuntimeRows(query);
      if (runtime) return runtime;
      if (query.startsWith('SELECT tr.* FROM course_ticket_transfers')) return [[candidate]];
      throw new Error(`Unexpected pool SQL: ${query}`);
    },
  };
  const domain = createCourseV2Domain({ pool, enabled: true, countCardParityEnabled: true });
  await assert.rejects(
    domain.acceptPartialTransfer({
      transferId: 55,
      actorUserId: RECIPIENT_USER,
      idempotencyKey: 'partial-race-accept-55',
      expectedRowVersion: 1,
    }),
    (error) => error.code === 'COURSE_TRANSFER_CONFLICT'
  );
  assert.equal(rolledBack, true);
});

test('partial transfer routes preserve WHOLE_LEGACY delegation and enforce mutation headers', () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, '../src/routes/course-v2.js'),
    'utf8'
  );
  const domainSource = fs.readFileSync(
    path.join(__dirname, '../src/services/course-v2-domain.js'),
    'utf8'
  );
  const legacySource = fs.readFileSync(
    path.join(__dirname, '../src/routes/courses.js'),
    'utf8'
  );
  assert.match(routeSource, /\/courses\/tickets\/:id\/transfers\/preview/);
  assert.match(routeSource, /router\.get\('\/courses\/tickets\/transfers'/);
  assert.match(routeSource, /COURSE_PARTIAL_TRANSFERS_LIST_FAIL/);
  assert.match(routeSource, /listMemberPartialTransfers/);
  assert.match(routeSource, /\/courses\/tickets\/:id\/transfers'/);
  assert.match(routeSource, /\/courses\/tickets\/transfers\/:id\/accept/);
  assert.match(routeSource, /String\(context\.transfer_mode\) !== 'PARTIAL'\) return next\(\)/);
  assert.match(routeSource, /withMutation\([\s\S]*initiatePartialTransfer/);
  assert.match(domainSource, /requireRowVersion\(expectedRowVersion, '轉讓'\)/);
  assert.match(domainSource, /eventType: 'TRANSFER_OUT'[\s\S]*eventType: 'TRANSFER_IN'/);
  assert.match(domainSource, /parent_ticket_id, transfer_root_ticket_id/);
  const incomingLegacySection = legacySource.slice(
    legacySource.indexOf("router.get('/courses/tickets/transfers/incoming'"),
    legacySource.indexOf("router.post('/courses/tickets/transfers/cancel_pending'")
  );
  assert.match(incomingLegacySection, /legacyWholeTransferFilter\(pool, 'tr'\)/);
  assert.match(legacySource, /COURSE_COUNT_CARD_PARITY_SCHEMA_REQUIRED[\s\S]*COALESCE\(\$\{prefix\}transfer_mode, 'WHOLE_LEGACY'\) = 'WHOLE_LEGACY'/);
});
