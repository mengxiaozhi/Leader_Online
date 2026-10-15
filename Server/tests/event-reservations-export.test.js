const test = require('node:test');
const assert = require('node:assert/strict');
const buildReservationRoutes = require('../src/routes/reservations');
const { buildCsv } = require('../src/utils/csv');

const exportPath = '/admin/events/:id/reservations/export';

function rosterRecords(csv) {
  const rows = csv.slice(1).trimEnd().split('\r\n').map(line =>
    [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replace(/""/g, '"')));
  const [headers, ...records] = rows;
  return records.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

function harness({ rows = [], ticketTransfers = [], event = { id: 42, title: '鐵人託運', owner_user_id: 'provider' }, deliveryPointId = 7, queryError, ticketTransferQueryError } = {}) {
  const queries = [];
  const eventReads = [];
  const middleware = (_req, _res, next) => next();
  const guard = (req, res, next) => {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED' });
    if (!['ADMIN', 'SERVICE_PROVIDER', 'DELIVERY_POINT'].includes(req.user.role)) return res.status(403).json({ code: 'FORBIDDEN' });
    return next();
  };
  const context = new Proxy({
    reservationManagerOnly: guard,
    getEventById: async (id, options) => { eventReads.push({ id, options }); return event; },
    normalizeRole: role => role,
    isADMIN: role => role === 'ADMIN',
    isSTORE: role => role === 'SERVICE_PROVIDER',
    isDELIVERY_POINT: role => role === 'DELIVERY_POINT',
    getDeliveryPointIdByUserId: async () => deliveryPointId,
    zhReservationStatus: status => ({ pre_dropoff: '賽前交車', cancelled: '已取消' })[status] || status,
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
    pool: { query: async (sql, params) => {
      queries.push({ sql, params });
      if (queryError) throw queryError;
      if (sql.includes('FROM ticket_transfers tt')) {
        if (ticketTransferQueryError) throw ticketTransferQueryError;
        return [ticketTransfers];
      }
      return [rows];
    } },
    MAX_CHECKLIST_IMAGE_BYTES: 1024,
  }, { get: (target, key) => target[key] ?? middleware });
  const route = buildReservationRoutes(context).stack.find(layer => layer.route?.path === exportPath).route;
  return {
    queries, eventReads,
    async request({ id = '42', user = { id: 'admin', role: 'ADMIN' } } = {}) {
      const res = {
        statusCode: 200, headers: {},
        status(code) { this.statusCode = code; return this; },
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        json(value) { this.body = value; return this; },
        send(value) { this.body = value; return this; },
      };
      for (const layer of route.stack) {
        let next = false;
        await layer.handle({ params: { id }, user }, res, () => { next = true; });
        if (!next) break;
      }
      return res;
    },
  };
}

test('CSV preserves Unicode, quotes, multiline cells, nulls and leading-zero phone numbers', () => {
  const csv = buildCsv([['姓名', '電話', '備註'], ['王,"小明"\n測試', '0912345678', null]]);
  assert.equal(csv, '\uFEFF"姓名","電話","備註"\r\n"王,""小明""\n測試","\'0912345678",""\r\n');
  assert.deepEqual([...Buffer.from(csv).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('CSV neutralizes spreadsheet formulas including whitespace prefixes', () => {
  for (const value of ['=1+1', '+886912345678', '-1+2', '@SUM(1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1']) {
    assert.equal(buildCsv([[value]]), `\uFEFF"'${value}"\r\n`);
  }
});

test('exports all reservations beyond page limits, with cancellation labels and only roster columns', async () => {
  const rows = Array.from({ length: 251 }, (_, i) => ({
    id: i + 1, order_code: 'ORDER-01', event: '鐵人託運', store: '台北交車點', ticket_type: '來回',
    username: '王小明', phone: '0912345678', email: 'qa@example.test', status: i === 250 ? 'cancelled' : 'pre_dropoff',
    linked_order_id: 10, payment_status: 'paid', order_details: { total: 1200, addOn: { material: false } },
    reserved_at: '2026-09-22 09:00:00', verify_code: 'SECRET-CODE',
  }));
  const h = harness({ rows });
  const res = await h.request();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.equal(res.headers['content-disposition'], 'attachment; filename="event_42_reservations.csv"');
  assert.equal(res.body.split('\r\n').length, 253);
  assert.ok(res.body.includes('"251","ORDER-01"'));
  assert.ok(res.body.includes('"已取消"'));
  assert.ok(!res.body.includes('SECRET-CODE'));
  assert.deepEqual(h.eventReads, [{ id: 42, options: { useCache: false } }]);
  assert.deepEqual(h.queries[0].params, [42, '鐵人託運', 42, '鐵人託運']);
  assert.match(h.queries[0].sql, /r\.event_id = \? OR \(r\.event_id IS NULL/);
  assert.match(h.queries[0].sql, /SELECT MAX\(e\.id\)/);
  assert.match(h.queries[0].sql, /o\.id AS linked_order_id, o\.payment_status, o\.details AS order_details/);
  assert.match(h.queries[0].sql, /LEFT JOIN orders o ON o\.id = r\.order_id/);
  assert.match(h.queries[0].sql, /LEFT JOIN reservation_transfers rt ON rt\.id = \(/);
  assert.match(h.queries[0].sql, /SELECT MAX\(incoming\.id\)/);
  assert.match(h.queries[0].sql, /incoming\.reservation_id = r\.id AND incoming\.to_user_id = r\.user_id/);
  assert.match(h.queries[0].sql, /incoming\.status = 'accepted'/);
  assert.doesNotMatch(h.queries[0].sql, /LIMIT|OFFSET|r\.\*/);
  assert.doesNotMatch(h.queries[0].sql, /(?:r\.status|o\.payment_status)\s*=/);
});

test('payment states are explicit and only confirmed payments count as currently paid', async () => {
  const cases = [
    ['pending', '未付款（待匯款）', '未付款', '0'],
    ['reviewing', '付款待審核', '付款待審核，尚未確認入帳', '0'],
    ['paid', '已付款', '', '1250.5'],
    ['cancelled', '已取消', '訂單已取消', '0'],
    ['refunded', '已退款', '訂單已退款', '0'],
  ];
  const rows = cases.map(([payment_status], index) => ({
    id: index + 1, linked_order_id: index + 10, payment_status, status: 'pre_dropoff',
    order_details: JSON.stringify({ status: '已付款', total: '1250.50', addOn: { material: false } }),
  }));
  const res = await harness({ rows }).request();
  assert.equal(res.statusCode, 200);
  const records = rosterRecords(res.body);
  cases.forEach(([, label, note, paid], index) => {
    assert.equal(records[index]['付款狀態'], label);
    assert.equal(records[index]['名單註記'], note);
    assert.equal(records[index]['訂單應付金額（元）'], '1250.5');
    assert.equal(records[index]['訂單目前已確認付款金額（元）'], paid);
  });
});

test('cancelled reservations remain marked even when their order is paid or still pending', async () => {
  const rows = ['paid', 'pending'].map((payment_status, index) => ({
    linked_order_id: index + 10, payment_status, status: 'cancelled', order_details: { total: 800 },
  }));
  const records = rosterRecords((await harness({ rows }).request()).body);
  assert.equal(records[0]['託運狀態'], '已取消');
  assert.equal(records[0]['付款狀態'], '已付款');
  assert.equal(records[0]['名單註記'], '託運已取消');
  assert.equal(records[0]['訂單目前已確認付款金額（元）'], '800');
  assert.equal(records[1]['名單註記'], '託運已取消；未付款');
});

test('legacy payment labels use the same lifecycle mapping as the order list', async () => {
  const cases = [
    ['待匯款', '未付款（待匯款）', '0'], ['處理中', '付款待審核', '0'],
    ['已付款', '已付款', '600'], ['已完成', '已付款', '600'], ['待指派', '已付款', '600'],
    ['已取消', '已取消', '0'], ['已退款', '已退款', '0'],
  ];
  const rows = cases.map(([status], index) => ({ linked_order_id: index + 10, payment_status: null, order_details: { status, total: 600 } }));
  const records = rosterRecords((await harness({ rows }).request()).body);
  cases.forEach(([, label, amount], index) => {
    assert.equal(records[index]['付款狀態'], label);
    assert.equal(records[index]['訂單目前已確認付款金額（元）'], amount);
  });
});

test('packaging exports the selection, order quantity and saved cost including manual prices', async () => {
  const cases = [
    [{ material: true, materialCount: 3, materialUnitPrice: 12.5 }, 37.5, '是', '3', '37.5'],
    [{ material: false, materialCount: 3 }, 300, '否', '0', '0'],
    [{ material: true, materialCount: 2 }, 0, '是', '2', '0'],
    [undefined, 100, '未記錄', '', ''],
    [{ material: true, materialCount: 1.5 }, undefined, '是', '', ''],
  ];
  const rows = cases.map(([addOn, addOnCost], index) => ({
    linked_order_id: index + 10, payment_status: 'paid', order_details: { total: 1000, addOn, addOnCost },
  }));
  const records = rosterRecords((await harness({ rows }).request()).body);
  cases.forEach(([, , selected, count, cost], index) => {
    assert.equal(records[index]['加購包材（訂單）'], selected);
    assert.equal(records[index]['包材數量（訂單）'], count);
    assert.equal(records[index]['包材金額（元；訂單）'], cost);
  });
});

test('older packaging orders use their saved pricing line or material unit price', async () => {
  const rows = [
    { addOn: { material: true, materialCount: 2 }, pricing: { lines: [{ key: 'material', subtotal: 30 }] } },
    { addOn: { material: true, materialCount: 2, materialUnitPrice: 25 } },
    { addOn: { material: true, materialCount: 2 } },
  ].map((details, index) => ({ linked_order_id: index + 10, payment_status: 'paid', order_details: { ...details, total: 900 } }));
  const records = rosterRecords((await harness({ rows }).request()).body);
  assert.deepEqual(records.map(record => record['包材金額（元；訂單）']), ['30', '50', '200']);
});

test('exports saved final order amounts without reconstructing discounts or multiplying by reservation count', async () => {
  const details = {
    total: 345.67, subtotal: 2000, discount: 1800, addOnCost: 100,
    pricing: { totalOverride: 345.67, total: 345.67 },
    addOn: { material: true, materialCount: 1 },
    contactSnapshot: { remittanceLast5: 'SECRET-BANK' }, bankAccount: 'SECRET-ACCOUNT',
  };
  const rows = [1, 2].map(id => ({ id, order_code: 'SAME-ORDER', linked_order_id: 10, payment_status: 'paid', order_details: details }));
  rows.push({ id: 3, linked_order_id: 11, payment_status: 'paid', order_details: { total: 0, addOn: { material: false } } });
  const res = await harness({ rows }).request();
  const records = rosterRecords(res.body);
  assert.deepEqual(records.map(record => record['訂單應付金額（元）']), ['345.67', '', '0']);
  assert.deepEqual(records.map(record => record['訂單目前已確認付款金額（元）']), ['345.67', '', '0']);
  assert.deepEqual(records.map(record => record['包材數量（訂單）']), ['1', '', '0']);
  assert.deepEqual(records.map(record => record['包材金額（元；訂單）']), ['100', '', '0']);
  assert.match(records[0]['名單註記'], /本名單同訂單共 2 筆託運/);
  assert.match(records[0]['名單註記'], /整單合計.*僅計一次.*非單台分配/);
  assert.match(records[1]['名單註記'], /合計見預約 #1.*本列不重複計入/);
  assert.doesNotMatch(res.body, /SECRET-BANK|SECRET-ACCOUNT|totalOverride|contactSnapshot/);
});

for (const materialCount of [2, 1]) {
  test(`two shipment rows with ${materialCount} packaging units count the order once without inventing per-bike allocation`, async () => {
    const details = { total: 2000 + materialCount * 100, addOnCost: materialCount * 100,
      addOn: { material: true, materialCount } };
    const rows = [101, 102].map(id => ({ id, order_code: 'ORDER-A', linked_order_id: 10,
      username: '同一會員', payment_status: 'paid', order_details: details }));
    const records = rosterRecords((await harness({ rows }).request()).body);
    assert.equal(records.length, 2);
    assert.deepEqual(records.map(record => record['訂單編號']), ['ORDER-A', 'ORDER-A']);
    assert.deepEqual(records.map(record => record['加購包材（訂單）']), ['是', '是']);
    assert.deepEqual(records.map(record => record['包材數量（訂單）']), [String(materialCount), '']);
    assert.equal(records.reduce((sum, record) => sum + Number(record['包材數量（訂單）']), 0), materialCount);
    assert.equal(records.reduce((sum, record) => sum + Number(record['包材金額（元；訂單）']), 0), materialCount * 100);
    assert.equal(records.reduce((sum, record) => sum + Number(record['訂單應付金額（元）']), 0), details.total);
    assert.equal(records.reduce((sum, record) => sum + Number(record['訂單目前已確認付款金額（元）']), 0), details.total);
    assert.match(records[0]['名單註記'], /非單台分配/);
    assert.match(records[1]['名單註記'], /合計見預約 #101/);
  });
}

test('order grouping spans nonadjacent rows, uses order IDs and retains cancellation and gift notes', async () => {
  const firstOrder = { total: 1500, addOnCost: 75, addOn: { material: true, materialCount: 1 } };
  const secondOrder = { total: 2500, addOnCost: 200, addOn: { material: true, materialCount: 2 } };
  const records = rosterRecords((await harness({ rows: [
    { id: 101, linked_order_id: 10, order_code: 'SAME-CODE', username: '同一會員', store: '交車點 A', payment_status: 'paid', order_details: firstOrder },
    { id: 201, linked_order_id: 11, order_code: 'SAME-CODE', username: '同一會員', store: '交車點 A', payment_status: 'paid', order_details: secondOrder },
    { id: 102, linked_order_id: '10', order_code: 'SAME-CODE', username: '接收會員', store: '交車點 B', payment_status: 'paid', order_details: firstOrder,
      status: 'cancelled', reservation_transfer_id: 5, transfer_from_name: '原持有人' },
    { id: 202, linked_order_id: 11, order_code: 'SAME-CODE', username: '同一會員', store: '交車點 B', payment_status: 'paid', order_details: secondOrder },
  ] }).request()).body);
  assert.deepEqual(records.map(record => record['包材數量（訂單）']), ['1', '2', '', '']);
  assert.deepEqual(records.map(record => record['包材金額（元；訂單）']), ['75', '200', '', '']);
  assert.deepEqual(records.map(record => record['訂單應付金額（元）']), ['1500', '2500', '', '']);
  assert.deepEqual(records.map(record => record['付款狀態']), ['已付款', '已付款', '已付款', '已付款']);
  assert.equal(records[2]['託運狀態'], '已取消');
  assert.match(records[2]['名單註記'], /^託運已取消；.*合計見預約 #101.*接受預約轉贈／分票/);
  assert.match(records[3]['名單註記'], /合計見預約 #201/);
  assert.equal(records[2]['來源類型'], '接受預約轉贈／分票');
});

test('a scoped export counts the order on its first visible reservation', async () => {
  const h = harness({ rows: [{ id: 999, linked_order_id: 10, payment_status: 'paid',
    order_details: { total: 2200, addOnCost: 200, addOn: { material: true, materialCount: 2 } } }] });
  const [record] = rosterRecords((await h.request({ user: { id: 'point-user', role: 'DELIVERY_POINT' } })).body);
  assert.equal(record['包材數量（訂單）'], '2');
  assert.equal(record['訂單應付金額（元）'], '2200');
  assert.doesNotMatch(record['名單註記'], /合計見預約/);
  assert.match(h.queries[0].sql, /AND r\.delivery_point_id = \?/);
});

test('unlinked historical reservations retain unknown payment and packaging rather than invented zeroes', async () => {
  const rows = [{ linked_order_id: null }, { status: 'cancelled' }];
  const records = rosterRecords((await harness({ rows }).request()).body);
  for (const record of records) {
    assert.equal(record['付款狀態'], '未確認');
    assert.match(record['名單註記'], /查無關聯訂單，付款與包材待確認/);
    assert.equal(record['訂單應付金額（元）'], '');
    assert.equal(record['訂單目前已確認付款金額（元）'], '');
    assert.equal(record['加購包材（訂單）'], '未記錄');
    assert.equal(record['包材數量（訂單）'], '');
    assert.equal(record['包材金額（元；訂單）'], '');
  }
  assert.match(records[1]['名單註記'], /^託運已取消；/);
});

test('missing or invalid stored amounts remain blank and do not break the download', async () => {
  const totals = [null, undefined, '', ' ', -100, -0.001, 'invalid', Infinity, NaN, true];
  const rows = totals.map((total, index) => ({ linked_order_id: index + 10, payment_status: 'paid', order_details: { total } }));
  rows.push({ linked_order_id: 30, payment_status: 'paid', order_details: '{invalid JSON' });
  rows.push({ linked_order_id: 31, payment_status: 'paid', order_details: { pricing: { total: 250 } } });
  const res = await harness({ rows }).request();
  assert.equal(res.statusCode, 200);
  const records = rosterRecords(res.body);
  for (const record of records.slice(0, -1)) {
    assert.equal(record['訂單應付金額（元）'], '');
    assert.equal(record['訂單目前已確認付款金額（元）'], '');
    assert.equal(record['名單註記'], '訂單金額未記錄');
  }
  assert.equal(records.at(-1)['訂單應付金額（元）'], '250');
});

test('incomplete historical pricing lines do not prevent an otherwise valid roster export', async () => {
  const rows = [[null, { key: 'material', subtotal: 40 }], { find: 'invalid' }].map((lines, index) => ({
    linked_order_id: index + 10, payment_status: 'paid',
    order_details: { total: 500, addOn: { material: true, materialCount: 2 }, pricing: { lines } },
  }));
  const res = await harness({ rows }).request();
  assert.equal(res.statusCode, 200);
  const records = rosterRecords(res.body);
  assert.deepEqual(records.map(record => record['包材金額（元；訂單）']), ['40', '200']);
});

test('an empty roster still downloads the column headers', async () => {
  const res = await harness().request();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.split('\r\n').length, 2);
  assert.ok(res.body.startsWith('\uFEFF"預約編號"'));
  assert.ok(res.body.includes('"付款狀態","名單註記"'));
  assert.ok(res.body.includes('"加購包材（訂單）","包材數量（訂單）"'));
});

test('roster exports member and consignor separately, keeping historical consignors blank', async () => {
  const h = harness({ rows: [
    { id: 1, username: '訂購會員', consignor_name: '實際託運者' },
    { id: 2, username: '另一會員', consignor_name: null },
  ] });
  const res = await h.request();
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('"會員姓名","託運者姓名"'));
  assert.ok(res.body.includes('"訂購會員","實際託運者"'));
  assert.ok(res.body.includes('"另一會員",""'));
  assert.match(h.queries[0].sql, /r\.consignor_name/);
});

test('accepted reservation gifts identify the sender and original order member separately from the current holder', async () => {
  const h = harness({ rows: [{
    id: 123, user_id: 'recipient', username: '接收會員', email: 'recipient@example.test', consignor_name: '實際託運者',
    linked_order_id: 10, order_user_id: 'buyer', order_member_name: '原訂購會員', order_member_email: 'buyer@example.test',
    payment_status: 'paid', order_details: { total: 1200 },
    reservation_transfer_id: 7, transfer_from_name: '上一位持有人', transfer_from_email: 'sender@example.test',
    reservation_transferred_at: '2026-10-12 09:00:00',
  }] });
  const res = await h.request();
  assert.equal(res.statusCode, 200);
  const [record] = rosterRecords(res.body);
  assert.equal(record['會員姓名'], '接收會員');
  assert.equal(record['託運者姓名'], '實際託運者');
  assert.equal(record['原訂購會員姓名'], '原訂購會員');
  assert.equal(record['原訂購會員信箱'], 'buyer@example.test');
  assert.equal(record['來源類型'], '接受預約轉贈／分票');
  assert.match(record['轉贈／分票來源'], /上一位持有人（sender@example\.test）/);
  assert.match(record['轉贈／分票來源'], /來源預約：123；轉入時間：2026-10-12 09:00:00/);
  assert.match(record['名單註記'], /接受預約轉贈／分票/);
  assert.match(h.queries[0].sql, /LEFT JOIN users order_member ON order_member\.id = o\.user_id/);
  assert.match(h.queries[0].sql, /LEFT JOIN users transfer_from ON transfer_from\.id = rt\.from_user_id/);
  assert.equal(h.queries.length, 1);
});

test('gift source notes coexist with unpaid and cancelled annotations, including unlinked legacy gifts', async () => {
  const rows = [
    { id: 1, linked_order_id: 10, payment_status: 'pending', order_details: { total: 500 }, status: 'cancelled' },
    { id: 2, linked_order_id: null },
  ].map(row => ({ ...row, reservation_transfer_id: 5, transfer_from_email: 'sender@example.test' }));
  const res = await harness({ rows }).request();
  const records = rosterRecords(res.body);
  assert.match(records[0]['名單註記'], /^託運已取消；未付款；接受預約轉贈／分票/);
  assert.match(records[1]['名單註記'], /^查無關聯訂單，付款與包材待確認；接受預約轉贈／分票/);
  assert.equal(records[1]['來源類型'], '接受預約轉贈／分票');
  assert.equal(records[1]['訂單目前已確認付款金額（元）'], '');
});

test('ticket gifts used for booking are fetched once and explicitly labelled as order-level sources', async () => {
  const rows = [1, 2].map(id => ({
    id, user_id: 'redeemer', order_user_id: 'redeemer', linked_order_id: 10, payment_status: 'paid',
    order_updated_at: '2026-10-12 12:00:00',
    order_details: JSON.stringify({ total: 0, ticketsUsed: [55, '56', 55, -1, 'invalid', true, null] }),
  }));
  const h = harness({ rows, ticketTransfers: [
    { id: 7, ticket_id: 55, to_user_id: 'redeemer', from_name: '分票會員', from_email: 'donor@example.test', source_order_code: 'ORIGINAL-ORDER', transferred_at: '2026-10-11 09:00:00' },
    { id: 8, ticket_id: 56, to_user_id: 'redeemer', from_name: '另一來源', from_email: 'second@example.test', transferred_at: '2026-10-11 10:00:00' },
  ] });
  const res = await h.request();
  assert.equal(res.statusCode, 200);
  for (const [index, record] of rosterRecords(res.body).entries()) {
    assert.equal(record['來源類型'], '訂單使用轉贈／分票票券');
    assert.match(record['轉贈／分票來源'], /票券 #55，來自：分票會員（donor@example\.test）；原購票訂單：ORIGINAL-ORDER/);
    assert.match(record['轉贈／分票來源'], /票券 #56，來自：另一來源/);
    assert.equal(record['訂單目前已確認付款金額（元）'], index === 0 ? '0' : '');
  }
  assert.equal(h.queries.length, 2);
  assert.deepEqual(h.queries[1].params, [55, 56]);
  assert.match(h.queries[1].sql, /tt\.status = 'accepted' AND tt\.ticket_id IN \(\?,\?\)/);
  assert.match(h.queries[1].sql, /ORDER BY tt\.updated_at DESC, tt\.id DESC/);
  assert.doesNotMatch(h.queries[1].sql, /tt\.code|ticket\.uuid|LIMIT|OFFSET/);
});

test('ticket source follows the original redeemer through subsequent reservation gifts and ignores future transfers', async () => {
  const h = harness({ rows: [{
    id: 123, user_id: 'current-holder', order_user_id: 'original-redeemer', linked_order_id: 10,
    order_updated_at: '2026-10-12 12:00:00', payment_status: 'paid', order_details: { total: 0, ticketsUsed: [55] },
    reservation_transfer_id: 5, transfer_from_name: '預約來源', transfer_from_email: 'reservation-sender@example.test',
  }], ticketTransfers: [
    { id: 9, ticket_id: 55, to_user_id: 'original-redeemer', from_name: '後來才轉入', transferred_at: '2026-10-13 12:00:00' },
    { id: 8, ticket_id: 55, to_user_id: 'other-user', from_name: '其他會員來源', transferred_at: '2026-10-11 12:00:00' },
    { id: 7, ticket_id: 55, to_user_id: 'original-redeemer', from_name: '原始票券來源', transferred_at: '2026-10-10 12:00:00' },
    { id: 6, ticket_id: 55, to_user_id: 'original-redeemer', from_name: '更早的來源', transferred_at: '2026-10-09 12:00:00' },
  ] });
  const [record] = rosterRecords((await h.request()).body);
  assert.equal(record['來源類型'], '接受預約轉贈／分票；訂單使用轉贈／分票票券');
  assert.match(record['轉贈／分票來源'], /預約來源/);
  assert.match(record['轉贈／分票來源'], /原始票券來源/);
  assert.doesNotMatch(record['轉贈／分票來源'], /後來才轉入|其他會員來源|更早的來源/);
});

test('ordinary bookings and tickets without accepted gifts never invent a transfer source', async () => {
  const rows = [
    { id: 1, user_id: 'buyer', order_user_id: 'buyer', linked_order_id: 10, order_details: { total: 500 } },
    { id: 2, user_id: 'buyer', order_user_id: 'buyer', linked_order_id: 10, order_details: { total: 0, ticketsUsed: [55] } },
    { id: 3, user_id: 'other', order_user_id: 'buyer', linked_order_id: 10, order_details: { total: 500 } },
    { id: 4, linked_order_id: null },
  ];
  const res = await harness({ rows }).request();
  const records = rosterRecords(res.body);
  assert.deepEqual(records.map(record => record['來源類型']), ['一般預約', '一般預約', '來源待確認', '來源待確認']);
  assert.equal(records[0]['轉贈／分票來源'], '');
  assert.equal(records[1]['轉贈／分票來源'], '');
  assert.equal(records[2]['轉贈／分票來源'], '持有人與原訂購會員不同，轉贈／分票來源未記錄');
  assert.equal(records[3]['轉贈／分票來源'], '');
});

test('transfer-source query failures return an error instead of an incomplete roster', async () => {
  const h = harness({ rows: [{
    linked_order_id: 10, order_user_id: 'redeemer', order_details: { ticketsUsed: [55] },
  }], ticketTransferQueryError: new Error('Source lookup unavailable') });
  const res = await h.request();
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, 'EVENT_RESERVATIONS_EXPORT_FAIL');
  assert.equal(res.headers['content-type'], undefined);
});

test('source identities keep CSV escaping and formula protection without leaking transfer codes', async () => {
  const h = harness({ rows: [{
    id: 123, linked_order_id: 10, order_details: { total: 0 },
    reservation_transfer_id: 5, transfer_from_name: '王,"小明"', transfer_from_email: 'sender@example.test',
    order_member_name: '=SUM(1)', order_member_email: 'buyer@example.test', reservation_transfer_code: 'SECRET-TRANSFER',
  }] });
  const res = await h.request();
  const [record] = rosterRecords(res.body);
  assert.match(record['轉贈／分票來源'], /王,"小明"/);
  assert.equal(record['原訂購會員姓名'], "'=SUM(1)");
  assert.doesNotMatch(res.body, /SECRET-TRANSFER/);
  assert.doesNotMatch(h.queries[0].sql, /rt\.code|verify_code/);
});

test('provider export requires current event ownership', async () => {
  const h = harness();
  const denied = await h.request({ user: { id: 'other-provider', role: 'SERVICE_PROVIDER' } });
  assert.equal(denied.statusCode, 403);
  assert.equal(h.queries.length, 0);
  const allowed = await h.request({ user: { id: 'provider', role: 'SERVICE_PROVIDER' } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(h.queries.length, 1);
});

test('delivery points can only export their assigned reservations', async () => {
  const h = harness();
  const user = { id: 'point-user', role: 'DELIVERY_POINT' };
  assert.equal((await h.request({ user })).statusCode, 200);
  assert.match(h.queries[0].sql, /AND r\.delivery_point_id = \?/);
  assert.equal(h.queries[0].params.at(-1), 7);
  const unbound = harness({ deliveryPointId: null });
  assert.equal((await unbound.request({ user })).statusCode, 403);
  assert.equal(unbound.queries.length, 0);
});

test('unauthenticated users, members, editors and drivers cannot download the roster', async () => {
  const h = harness();
  for (const user of [null, { role: 'USER' }, { role: 'EDITOR' }, { role: 'DRIVER' }]) {
    assert.equal((await h.request({ user })).statusCode, user ? 403 : 401);
  }
  assert.equal(h.eventReads.length, 0);
  assert.equal(h.queries.length, 0);
});

test('invalid IDs, missing events and database failures return errors instead of CSV', async () => {
  const h = harness();
  for (const id of ['bad', '-1', '0', '1.5', '9007199254740992']) {
    assert.equal((await h.request({ id })).statusCode, 400);
  }
  assert.equal(h.eventReads.length, 0);
  assert.equal((await harness({ event: null }).request()).statusCode, 404);
  const failure = await harness({ queryError: new Error('Database unavailable') }).request();
  assert.equal(failure.statusCode, 500);
  assert.equal(failure.body.code, 'EVENT_RESERVATIONS_EXPORT_FAIL');
  assert.equal(failure.headers['content-type'], undefined);
});
