const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  assertCourseOrderAction,
  assertCoursePurchaseQuantity,
  courseCheckoutHash,
  courseOrderCapabilities,
  courseOrderEditableFields,
  deriveCourseOrderStatuses,
  legacyCourseOrderStatus,
  normalizeCourseCartItems,
  normalizeCourseOrderAction,
  resolveCourseOrderQuote,
} = require('../src/services/course-order-workflow');

test('course cart merges duplicate products deterministically and enforces strict limits', () => {
  assert.deepEqual(normalizeCourseCartItems([
    { productId: 7, quantity: 2 },
    { product_id: 3, qty: 1 },
    { id: 7, quantity: 3 },
  ]), [
    { productId: 3, quantity: 1 },
    { productId: 7, quantity: 5 },
  ]);

  assert.equal(assertCoursePurchaseQuantity(4, { max_purchase_quantity: 4 }), 4);
  assert.throws(
    () => assertCoursePurchaseQuantity(5, { maxPurchaseQuantity: 4 }),
    (error) => error.code === 'COURSE_ORDER_QUANTITY_EXCEEDED'
      && error.details.maxPurchaseQuantity === 4
  );
  for (const quantity of [0, -1, 1.5, '2.5', '']) {
    assert.throws(
      () => normalizeCourseCartItems([{ productId: 1, quantity }]),
      (error) => error.code === 'COURSE_ORDER_QUANTITY_INVALID'
    );
  }
  assert.throws(
    () => normalizeCourseCartItems([
      { productId: 9, quantity: 60 },
      { productId: 9, quantity: 40 },
    ]),
    (error) => error.code === 'COURSE_ORDER_QUANTITY_EXCEEDED'
  );
  assert.throws(
    () => normalizeCourseCartItems([
      { productId: 1, quantity: 1 },
      { productId: 2, quantity: 1 },
    ], { maxItems: 1 }),
    (error) => error.code === 'COURSE_CART_TOO_LARGE'
  );
});

test('course checkout hash is order-independent but includes payment-group remittance', () => {
  const quote = (productId, providerUserId, quantity, totalAmount) => ({
    productId,
    productName: `Course ${productId}`,
    providerUserId,
    providerName: providerUserId,
    quantity,
    maxPurchaseQuantity: 10,
    rowVersion: 3,
    lineItems: [{
      shopProductId: productId,
      ticketProductId: productId + 100,
      itemType: 'primary',
      quantity,
      unitPrice: totalAmount / quantity,
      lineTotal: totalAmount,
    }],
    totalAmount,
  });
  const quotes = [quote(8, 'provider-b', 2, 1200), quote(3, 'provider-a', 1, 500)];
  const paymentGroups = [{
    providerUserId: 'provider-b',
    productIds: [8],
    totalAmount: 1200,
    remittance: {
      bankCode: '012',
      bankAccount: '222222',
      accountName: 'B Provider',
      bankName: 'Bank B',
      info: 'B account',
    },
  }, {
    providerUserId: 'provider-a',
    productIds: [3],
    totalAmount: 500,
    remittance: {
      bankCode: '013',
      bankAccount: '111111',
      accountName: 'A Provider',
      bankName: 'Bank A',
      info: 'A account',
    },
  }];

  const hash = courseCheckoutHash(quotes, paymentGroups);
  assert.equal(
    hash,
    courseCheckoutHash([...quotes].reverse(), [...paymentGroups].reverse())
  );
  assert.notEqual(
    hash,
    courseCheckoutHash(quotes, paymentGroups.map((group) => (
      group.providerUserId === 'provider-a'
        ? { ...group, remittance: { ...group.remittance, bankAccount: 'changed' } }
        : group
    )))
  );
  assert.notEqual(hash, courseCheckoutHash([
    quote(8, 'provider-b', 3, 1800),
    quotes[1],
  ], paymentGroups));
});

test('course order states expose legal edit and administrative action capabilities', () => {
  const pending = { status: 'pending', payment_status: 'pending', fulfillment_status: 'pending' };
  assert.deepEqual(deriveCourseOrderStatuses(pending), {
    paymentStatus: 'pending',
    fulfillmentStatus: 'pending',
  });
  assert.deepEqual(courseOrderEditableFields(pending), [
    'quantity',
    'contact',
    'remittanceLast5',
  ]);
  assert.deepEqual(courseOrderCapabilities(pending), {
    edit: true,
    cancel: true,
    markPaymentReview: true,
    markReviewing: true,
    confirmPayment: true,
    refund: false,
    retryFulfillment: false,
  });
  assert.equal(assertCourseOrderAction('mark-payment-review', pending), 'mark-reviewing');
  assert.equal(normalizeCourseOrderAction('MARK-PAYMENT-REVIEW'), 'mark-reviewing');

  const reviewing = { payment_status: 'payment_review', fulfillment_status: 'pending' };
  assert.equal(assertCourseOrderAction('confirm-payment', reviewing), 'confirm-payment');
  assert.equal(assertCourseOrderAction('cancel', reviewing), 'cancel');
  assert.throws(
    () => assertCourseOrderAction('mark-reviewing', reviewing),
    (error) => error.code === 'COURSE_ORDER_ACTION_NOT_ALLOWED' && error.statusCode === 409
  );

  const paidPending = { payment_status: 'paid', fulfillment_status: 'pending' };
  assert.equal(courseOrderCapabilities(paidPending).retryFulfillment, true);
  assert.equal(assertCourseOrderAction('retry-fulfillment', paidPending), 'retry-fulfillment');

  const paidFulfilled = { payment_status: 'paid', fulfillment_status: 'fulfilled' };
  assert.equal(courseOrderCapabilities(paidFulfilled).refund, true);
  assert.equal(assertCourseOrderAction('refund', paidFulfilled), 'refund');
  assert.deepEqual(courseOrderEditableFields(paidFulfilled), []);
  assert.equal(legacyCourseOrderStatus('paid', 'fulfilled'), 'issued');
  assert.deepEqual(deriveCourseOrderStatuses({ status: 'issued', quantity: 2 }), {
    paymentStatus: 'paid',
    fulfillmentStatus: 'fulfilled',
  });
});

test('fixed-term bank transfer capabilities require a member payment submission', () => {
  const pending = {
    payment_status: 'pending',
    fulfillment_status: 'pending',
    order_purpose: 'TERM_ENROLLMENT',
    payment_method: 'BANK_TRANSFER',
  };
  assert.equal(courseOrderCapabilities(pending).edit, false);
  assert.equal(courseOrderCapabilities(pending).markPaymentReview, false);
  assert.equal(courseOrderCapabilities(pending).confirmPayment, false);
  assert.equal(courseOrderCapabilities({ ...pending, payment_status: 'reviewing' }).confirmPayment, true);
  assert.equal(courseOrderCapabilities({
    ...pending,
    order_purpose: 'MAKEUP_INSURANCE',
  }).edit, false);
});

test('course routes keep cart, batch checkout, concurrency, and atomic fulfillment contracts', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/courses.js'), 'utf8');

  for (const route of [
    /router\.get\('\/courses\/cart'/,
    /router\.put\('\/courses\/cart'/,
    /router\.delete\('\/courses\/cart'/,
    /router\.post\('\/courses\/orders\/batch\/preview'/,
    /router\.post\('\/courses\/orders\/batch'/,
    /router\.post\('\/admin\/courses\/orders\/bulk-actions'/,
    /router\.post\('\/admin\/courses\/orders\/:id\/actions\/:action'/,
    /router\.post\('\/admin\/courses\/tickets\/:id\/actions\/:action'/,
  ]) assert.match(source, route);

  const memberUpdate = source.slice(
    source.indexOf("router.patch('/courses/orders/:id'"),
    source.indexOf("router.post('/courses/orders/:id/cancel'")
  );
  assert.match(memberUpdate, /courseIdempotencyKeyFromRequest\(req\)/);
  assert.match(memberUpdate, /COURSE_ROW_VERSION_REQUIRED/);
  assert.match(memberUpdate, /AND row_version = \?/);
  assert.match(memberUpdate, /course-customer:update/);
  assert.match(memberUpdate, /DELETE FROM course_order_items WHERE order_id = \?/);

  const memberCancel = source.slice(
    source.indexOf("router.post('/courses/orders/:id/cancel'"),
    source.indexOf("router.post('/courses/sessions/:id/book'")
  );
  assert.match(memberCancel, /courseIdempotencyKeyFromRequest\(req\)/);
  assert.match(memberCancel, /COURSE_ROW_VERSION_REQUIRED/);
  assert.match(memberCancel, /course-customer:cancel/);
  assert.match(memberCancel, /AND row_version = \?/);

  const batchCheckout = source.slice(
    source.indexOf("router.post('/courses/orders/batch'"),
    source.indexOf("router.post('/courses/orders'", source.indexOf("router.post('/courses/orders/batch'") + 1)
  );
  assert.match(batchCheckout, /claimCourseCheckoutBatch/);
  assert.match(batchCheckout, /resolveCoursePaymentGroups/);
  assert.match(batchCheckout, /submittedCheckoutHash !== preview\.checkoutHash/);
  assert.match(batchCheckout, /checkoutBatchId: claim\.batchId/);
  assert.match(batchCheckout, /DELETE FROM course_carts WHERE user_id = \?/);
  assert.match(batchCheckout, /completeCourseCheckoutBatch/);
  assert.match(batchCheckout, /await conn\.commit\(\)/);

  const actionEngine = source.slice(
    source.indexOf('async function performCourseOrderAction'),
    source.indexOf('async function recordCourseTicketLifecycle')
  );
  assert.match(actionEngine, /normalizedAction === 'confirm-payment'[\s\S]*await fulfillCourseOrder/);
  assert.match(actionEngine, /await completeCourseOrderAction\(conn/);
  assert.match(actionEngine, /await conn\.commit\(\)[\s\S]*sendCourseNotificationEmail/);
  assert.match(actionEngine, /refundReference: text\(refundReference, 128\)/);
  assert.match(actionEngine, /COURSE_ORDER_REFUND_REFERENCE_REQUIRED/);
  assert.match(
    actionEngine,
    /normalizedAction === 'confirm-payment'[\s\S]*course_payment_submissions[\s\S]*COURSE_PAYMENT_SUBMISSION_REQUIRED/
  );

  assert.doesNotMatch(source, /operation:\s*'order\.update-status'/);
  assert.match(source, /product_class_count_snapshot = \?[\s\S]{0,900}\n\s*remainingUses,/);
  assert.match(source, /COURSE_TICKET_NOTIFICATION_PERSIST_FAIL/);
});

test('fixed-term and insurance order actions use the durable outbox instead of duplicate direct mail', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/courses.js'), 'utf8');
  const action = source.slice(
    source.indexOf('async function executeCourseOrderAction'),
    source.indexOf("router.get('/admin/courses/orders", source.indexOf('async function executeCourseOrderAction'))
  );
  assert.match(action, /durableCourseNotification[\s\S]*TERM_ENROLLMENT[\s\S]*MAKEUP_INSURANCE/);
  assert.match(action, /if \(durableCourseNotification\) return \{ data, replayed: false \}/);
});

test('count-pass quote rejects inactive primary and bundle TicketProducts', async () => {
  const quotePool = (componentStatus = null, primaryStatus = 'active') => ({
    async query(sql) {
      if (sql.includes('FROM course_products p') && sql.includes('provider_name')) {
        return [[{
          id: 8,
          owner_user_id: 'provider-1',
          ticket_product_id: 80,
          ticket_product_code: 'PASS-80',
          ticket_product_name: 'Primary pass',
          ticket_product_status: primaryStatus,
          name: 'Shop product',
          price: 1200,
          status: 'published',
          row_version: 1,
          max_purchase_quantity: 10,
          require_addon_for_new: 0,
        }]];
      }
      if (sql.includes('FROM course_product_returning_requirements')) return [[]];
      if (sql.includes('FROM course_product_required_addons')) return [[]];
      if (sql.includes('FROM course_shop_product_components')) {
        return componentStatus == null ? [[]] : [[{
          shop_product_id: 8,
          ticket_product_id: 81,
          component_role: 'included',
          component_quantity: 1,
          sort_order: 0,
          code: 'PASS-81',
          name: 'Included pass',
          owner_user_id: 'provider-1',
          ticket_product_status: componentStatus,
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });

  await assert.rejects(
    resolveCourseOrderQuote(quotePool(null, 'draft'), {
      productId: 8,
      quantity: 1,
      userId: 'member-1',
      courseV2Enabled: true,
    }),
    (error) => error.code === 'COURSE_TICKET_PRODUCT_INACTIVE'
  );
  await assert.rejects(
    resolveCourseOrderQuote(quotePool('inactive'), {
      productId: 8,
      quantity: 1,
      userId: 'member-1',
      courseV2Enabled: true,
    }),
    (error) => error.code === 'COURSE_TICKET_PRODUCT_INACTIVE'
      && error.details.ticketProductId === 81
  );
});

test('count-pass publish and readiness validate every bundle TicketProduct', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/courses.js'), 'utf8');
  const v2Routes = fs.readFileSync(path.join(__dirname, '../src/routes/course-v2.js'), 'utf8');
  assert.match(routes, /assertSalesPlanTicketProductsActive\(conn, links\)/);
  assert.match(routes, /assertSalesPlanTicketProductsActive\(v2Conn, links\)/);
  assert.match(routes, /course_shop_product_components[\s\S]*ticketProduct\.status/);
  assert.match(v2Routes, /BUNDLE_TICKET_PRODUCT_INACTIVE/);
  assert.match(v2Routes, /course_product_required_addons[\s\S]*addon_component\.ticket_product_id/);
});
