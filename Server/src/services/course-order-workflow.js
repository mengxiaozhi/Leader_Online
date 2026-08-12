const { createHash } = require('crypto');
const {
  shouldIncludeRequiredAddons,
  isBundleIssuableShopProductStatus,
  resolveReturningEligibility,
} = require('./course-v2-sales');

const COURSE_ORDER_SOURCE = 'course';
const COURSE_PAYMENT_STATUSES = new Set([
  'pending',
  'reviewing',
  'paid',
  'cancelled',
  'refunded',
]);
const COURSE_FULFILLMENT_STATUSES = new Set([
  'pending',
  'fulfilled',
  'voided',
]);
const COURSE_ORDER_ACTIONS = new Set([
  'mark-reviewing',
  'mark-payment-review',
  'confirm-payment',
  'cancel',
  'refund',
  'retry-fulfillment',
]);

function workflowError(code, message, statusCode = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function strictPositiveInteger(value, field = 'quantity') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw workflowError(
      field === 'productId' ? 'COURSE_PRODUCT_ID_INVALID' : 'COURSE_ORDER_QUANTITY_INVALID',
      field === 'productId' ? '課程商品編號不正確' : '購買數量必須是正整數',
      400
    );
  }
  return parsed;
}

function courseProductPurchaseLimit(product = {}) {
  const raw = Number(product.max_purchase_quantity ?? product.maxPurchaseQuantity ?? 10);
  if (!Number.isInteger(raw) || raw < 1) return 10;
  return Math.min(raw, 99);
}

function normalizeCourseOrderAction(action) {
  const normalized = String(action || '').trim().toLowerCase();
  return normalized === 'mark-payment-review' ? 'mark-reviewing' : normalized;
}

function assertCoursePurchaseQuantity(value, product = {}) {
  const quantity = strictPositiveInteger(value);
  const maxPurchaseQuantity = courseProductPurchaseLimit(product);
  if (quantity > maxPurchaseQuantity) {
    throw workflowError(
      'COURSE_ORDER_QUANTITY_EXCEEDED',
      `此課程每筆最多可購買 ${maxPurchaseQuantity} 張票券`,
      400,
      { maxPurchaseQuantity }
    );
  }
  return quantity;
}

function normalizeCourseCartItems(value, { maxItems = 100 } = {}) {
  if (!Array.isArray(value)) {
    throw workflowError('COURSE_CART_ITEMS_REQUIRED', '課程購物車 items 必須是陣列', 400);
  }
  const quantities = new Map();
  for (const raw of value) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const productId = strictPositiveInteger(
      item.productId ?? item.product_id ?? item.id,
      'productId'
    );
    const quantity = strictPositiveInteger(item.quantity ?? item.qty ?? 1);
    const next = Number(quantities.get(productId) || 0) + quantity;
    if (next > 99) {
      throw workflowError(
        'COURSE_ORDER_QUANTITY_EXCEEDED',
        '同一課程商品合併後的購買數量不得超過 99',
        400,
        { productId, maxPurchaseQuantity: 99 }
      );
    }
    quantities.set(productId, next);
  }
  if (quantities.size > maxItems) {
    throw workflowError('COURSE_CART_TOO_LARGE', `課程購物車最多可放入 ${maxItems} 種商品`, 400);
  }
  return [...quantities.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((left, right) => left.productId - right.productId);
}

function queryLock(forUpdate) {
  return forUpdate ? ' FOR UPDATE' : '';
}

async function loadShopProductComponents(queryable, shopProductIds, { forUpdate = false } = {}) {
  const ids = [...new Set(shopProductIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return new Map();
  const [rows] = await queryable.query(
    `SELECT component.shop_product_id, component.ticket_product_id,
            component.component_role, component.quantity AS component_quantity,
            component.sort_order, tp.code, tp.name, tp.owner_user_id,
            tp.status AS ticket_product_status
       FROM course_shop_product_components component
       JOIN course_ticket_products tp ON tp.id = component.ticket_product_id
      WHERE component.shop_product_id IN (${ids.map(() => '?').join(',')})
      ORDER BY component.shop_product_id, component.sort_order, component.ticket_product_id${queryLock(forUpdate)}`,
    ids
  );
  const grouped = new Map();
  for (const row of rows) {
    const id = Number(row.shop_product_id);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  return grouped;
}

function componentLines({
  shopProduct,
  components,
  quantity,
  itemType = 'primary',
  requiredByProductId = null,
  requiredQuantity = 1,
}) {
  const source = components?.length
    ? components
    : [{
      ticket_product_id: shopProduct.ticket_product_id,
      component_role: itemType,
      component_quantity: 1,
      code: shopProduct.ticket_product_code || shopProduct.code,
      name: shopProduct.ticket_product_name || shopProduct.name,
      owner_user_id: shopProduct.owner_user_id,
      ticket_product_status: shopProduct.ticket_product_status,
    }];
  if (source.some((component) => !component.ticket_product_id)) {
    throw workflowError(
      'COURSE_TICKET_PRODUCT_REQUIRED',
      '銷售方案尚未設定票券產品',
      409,
      { productId: Number(shopProduct.id) }
    );
  }
  if (source.some((component) => (
    String(component.owner_user_id || '') !== String(shopProduct.owner_user_id || '')
  ))) {
    throw workflowError(
      'COURSE_ORDER_COMPONENT_OWNER_CHANGED',
      '銷售方案票券元件的服務商歸屬已變更',
      409,
      { productId: Number(shopProduct.id) }
    );
  }
  const inactiveTicketProduct = source.find((component) => (
    String(component.ticket_product_status || '').trim().toLowerCase() !== 'active'
  ));
  if (inactiveTicketProduct) {
    throw workflowError(
      'COURSE_TICKET_PRODUCT_INACTIVE',
      '銷售方案含有尚未啟用的票券產品',
      409,
      {
        productId: Number(shopProduct.id),
        ticketProductId: Number(inactiveTicketProduct.ticket_product_id),
      }
    );
  }
  const paidLineTotal = Number(shopProduct.price || 0) * quantity * requiredQuantity;
  return source.map((component, index) => {
    const componentQuantity = strictPositiveInteger(component.component_quantity || 1);
    const lineQuantity = quantity * requiredQuantity * componentQuantity;
    const role = String(component.component_role || itemType || 'primary').trim() || 'primary';
    const isRequiredAddon = itemType === 'required_addon';
    return {
      shopProductId: Number(shopProduct.id),
      ticketProductId: Number(component.ticket_product_id),
      itemType: isRequiredAddon ? 'required_addon' : role,
      code: component.code || shopProduct.code || '',
      name: component.name || shopProduct.name || '',
      quantity: lineQuantity,
      unitPrice: index === 0 ? Number(shopProduct.price || 0) : 0,
      lineTotal: index === 0 ? paidLineTotal : 0,
      required: isRequiredAddon,
      kind: isRequiredAddon ? 'required_add_on' : 'component',
      metadata: {
        componentRole: role,
        ...(requiredByProductId ? { requiredByProductId: Number(requiredByProductId) } : {}),
      },
    };
  });
}

async function resolveCourseOrderQuote(queryable, {
  productId,
  quantity,
  userId,
  courseV2Enabled = false,
  publishedOnly = true,
  forUpdate = false,
} = {}) {
  const normalizedProductId = strictPositiveInteger(productId, 'productId');
  const statusSql = publishedOnly ? " AND p.status = 'published'" : '';
  const [productRows] = await queryable.query(
    courseV2Enabled
      ? `SELECT p.*, provider.username AS provider_name,
                tp.code AS ticket_product_code, tp.name AS ticket_product_name,
                tp.status AS ticket_product_status
           FROM course_products p
           JOIN course_ticket_products tp ON tp.id = p.ticket_product_id
           LEFT JOIN users provider ON provider.id = p.owner_user_id
          WHERE p.id = ?${statusSql} LIMIT 1${queryLock(forUpdate)}`
      : `SELECT p.*, provider.username AS provider_name
           FROM course_products p
           LEFT JOIN users provider ON provider.id = p.owner_user_id
          WHERE p.id = ?${statusSql} LIMIT 1${queryLock(forUpdate)}`,
    [normalizedProductId]
  );
  const product = productRows[0];
  if (!product) {
    throw workflowError('COURSE_PRODUCT_NOT_FOUND', '找不到可購買的課程商品', 404, {
      productId: normalizedProductId,
    });
  }
  if (String(product.external_purchase_url || '').trim()) {
    throw workflowError('COURSE_EXTERNAL_PURCHASE_REQUIRED', '此課程需前往服務商網站購買', 409, {
      productId: normalizedProductId,
    });
  }
  const normalizedQuantity = assertCoursePurchaseQuantity(quantity, product);
  if (!courseV2Enabled) {
    const lineItems = [{
      shopProductId: Number(product.id),
      ticketProductId: null,
      itemType: 'primary',
      code: product.code || '',
      name: product.name || '',
      quantity: normalizedQuantity,
      unitPrice: Number(product.price || 0),
      lineTotal: Number(product.price || 0) * normalizedQuantity,
      required: false,
      kind: 'main',
      metadata: { componentRole: 'primary' },
    }];
    return {
      product,
      productId: Number(product.id),
      productName: product.name || '',
      providerUserId: product.owner_user_id || null,
      providerName: product.provider_name || '',
      quantity: normalizedQuantity,
      maxPurchaseQuantity: courseProductPurchaseLimit(product),
      rowVersion: Number(product.row_version || 1),
      returningEligible: null,
      requireAddonForNew: false,
      lineItems,
      totalAmount: lineItems[0].lineTotal,
    };
  }

  const returningEligible = await resolveReturningEligibility(queryable, {
    productId: product.id,
    userId,
    forUpdate,
  });
  const requireAddonForNew = Boolean(Number(product.require_addon_for_new || 0));
  const includeRequiredAddons = shouldIncludeRequiredAddons(
    requireAddonForNew,
    returningEligible
  );
  const [addonRows] = await queryable.query(
    `SELECT requirement.quantity AS required_quantity,
            addon.*, provider.username AS provider_name,
            tp.code AS ticket_product_code, tp.name AS ticket_product_name,
            tp.status AS ticket_product_status
       FROM course_product_required_addons requirement
       JOIN course_products addon ON addon.id = requirement.addon_product_id
       JOIN course_ticket_products tp ON tp.id = addon.ticket_product_id
       LEFT JOIN users provider ON provider.id = addon.owner_user_id
      WHERE requirement.product_id = ?
      ORDER BY requirement.sort_order, addon.id${queryLock(forUpdate)}`,
    [product.id]
  );
  if (includeRequiredAddons && !addonRows.length) {
    throw workflowError(
      'COURSE_REQUIRED_ADDON_UNAVAILABLE',
      '此銷售方案要求新生加購，但尚未設定可發行的必要加購品',
      409,
      { productId: Number(product.id) }
    );
  }
  const selectedAddons = includeRequiredAddons ? addonRows : [];
  for (const addon of selectedAddons) {
    if (!isBundleIssuableShopProductStatus(addon.status)
      || String(addon.owner_user_id || '') !== String(product.owner_user_id || '')) {
      throw workflowError(
        'COURSE_REQUIRED_ADDON_UNAVAILABLE',
        '必要加購品已下架或租戶已變更',
        409,
        { productId: Number(product.id), addonProductId: Number(addon.id) }
      );
    }
  }
  const componentMap = await loadShopProductComponents(
    queryable,
    [product.id, ...selectedAddons.map((addon) => addon.id)],
    { forUpdate }
  );
  const lineItems = componentLines({
    shopProduct: product,
    components: componentMap.get(Number(product.id)),
    quantity: normalizedQuantity,
  });
  for (const addon of selectedAddons) {
    lineItems.push(...componentLines({
      shopProduct: addon,
      components: componentMap.get(Number(addon.id)),
      quantity: normalizedQuantity,
      itemType: 'required_addon',
      requiredByProductId: product.id,
      requiredQuantity: strictPositiveInteger(addon.required_quantity || 1),
    }));
  }
  return {
    product,
    productId: Number(product.id),
    productName: product.name || '',
    providerUserId: product.owner_user_id || null,
    providerName: product.provider_name || '',
    quantity: normalizedQuantity,
    maxPurchaseQuantity: courseProductPurchaseLimit(product),
    rowVersion: Number(product.row_version || 1),
    returningEligible,
    requireAddonForNew,
    lineItems,
    totalAmount: lineItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0),
  };
}

function publicCourseOrderQuote(quote = {}) {
  return {
    productId: Number(quote.productId),
    productName: quote.productName || '',
    providerUserId: quote.providerUserId || null,
    providerName: quote.providerName || '',
    quantity: Number(quote.quantity || 0),
    maxPurchaseQuantity: Number(quote.maxPurchaseQuantity || 10),
    rowVersion: Number(quote.rowVersion || 1),
    returningEligible: quote.returningEligible,
    requireAddonForNew: Boolean(quote.requireAddonForNew),
    lineItems: Array.isArray(quote.lineItems) ? quote.lineItems : [],
    totalAmount: Number(quote.totalAmount || 0),
  };
}

function courseCheckoutHash(quotes = [], paymentGroups = []) {
  const canonical = quotes
    .map(publicCourseOrderQuote)
    .sort((left, right) => left.productId - right.productId)
    .map((quote) => ({
      productId: quote.productId,
      quantity: quote.quantity,
      providerUserId: quote.providerUserId,
      rowVersion: quote.rowVersion,
      totalAmount: quote.totalAmount,
      lineItems: quote.lineItems.map((item) => ({
        shopProductId: item.shopProductId,
        ticketProductId: item.ticketProductId,
        itemType: item.itemType,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
    }));
  const canonicalPaymentGroups = (Array.isArray(paymentGroups) ? paymentGroups : [])
    .map((group) => ({
      providerUserId: group.providerUserId || null,
      productIds: [...(group.productIds || [])].map(Number).sort((a, b) => a - b),
      totalAmount: Number(group.totalAmount || 0),
      remittance: {
        info: String(group.remittance?.info || ''),
        bankCode: String(group.remittance?.bankCode || ''),
        bankAccount: String(group.remittance?.bankAccount || ''),
        accountName: String(group.remittance?.accountName || ''),
        bankName: String(group.remittance?.bankName || ''),
      },
    }))
    .sort((left, right) => String(left.providerUserId || '')
      .localeCompare(String(right.providerUserId || '')));
  return createHash('sha256')
    .update(stableStringify({ orders: canonical, paymentGroups: canonicalPaymentGroups }))
    .digest('hex');
}

function deriveCourseOrderStatuses(row = {}) {
  const legacyStatus = String(row.status || '').trim().toLowerCase();
  const rawPaymentStatus = String(row.payment_status || '').trim().toLowerCase();
  let paymentStatus = rawPaymentStatus === 'payment_review' ? 'reviewing' : rawPaymentStatus;
  if (!COURSE_PAYMENT_STATUSES.has(paymentStatus)) {
    if (legacyStatus === 'issued' || legacyStatus === 'paid') paymentStatus = 'paid';
    else if (legacyStatus === 'refunded') paymentStatus = 'refunded';
    else if (legacyStatus === 'cancelled') paymentStatus = 'cancelled';
    else if (legacyStatus === 'payment_review') paymentStatus = 'reviewing';
    else paymentStatus = 'pending';
  }
  const rawFulfillmentStatus = String(row.fulfillment_status || '').trim().toLowerCase();
  let fulfillmentStatus = rawFulfillmentStatus === 'issued'
    ? 'fulfilled'
    : ['refunded', 'cancelled'].includes(rawFulfillmentStatus)
      ? 'voided'
      : rawFulfillmentStatus;
  if (!COURSE_FULFILLMENT_STATUSES.has(fulfillmentStatus)) {
    const issuedTicketCount = Number(row.issued_ticket_count || 0);
    const expectedTicketCount = Array.isArray(row.items) && row.items.length
      ? row.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
      : Number(row.quantity || 0);
    if (legacyStatus === 'issued'
      || (expectedTicketCount > 0 && issuedTicketCount === expectedTicketCount)) {
      fulfillmentStatus = 'fulfilled';
    } else if (legacyStatus === 'refunded') {
      fulfillmentStatus = 'voided';
    } else {
      fulfillmentStatus = 'pending';
    }
  }
  return { paymentStatus, fulfillmentStatus };
}

function legacyCourseOrderStatus(paymentStatus, fulfillmentStatus) {
  if (paymentStatus === 'refunded') return 'refunded';
  if (paymentStatus === 'cancelled') return 'cancelled';
  if (fulfillmentStatus === 'fulfilled') return 'issued';
  if (paymentStatus === 'paid') return 'paid';
  if (paymentStatus === 'reviewing') return 'payment_review';
  return 'pending';
}

function courseOrderCapabilities(row = {}) {
  const { paymentStatus, fulfillmentStatus } = deriveCourseOrderStatuses(row);
  const unpaid = ['pending', 'reviewing'].includes(paymentStatus)
    && fulfillmentStatus === 'pending';
  const purpose = String(row.order_purpose || row.orderPurpose || 'COUNT_PASS').trim().toUpperCase();
  const countPassOrder = !purpose || purpose === 'COUNT_PASS';
  const paymentMethod = String(row.payment_method || row.paymentMethod || '').trim().toUpperCase();
  const bankTransferSubmissionRequired = !countPassOrder && paymentMethod === 'BANK_TRANSFER';
  return {
    edit: unpaid && countPassOrder,
    cancel: unpaid,
    markPaymentReview: !bankTransferSubmissionRequired
      && paymentStatus === 'pending' && fulfillmentStatus === 'pending',
    markReviewing: !bankTransferSubmissionRequired
      && paymentStatus === 'pending' && fulfillmentStatus === 'pending',
    confirmPayment: (bankTransferSubmissionRequired
      ? paymentStatus === 'reviewing'
      : ['pending', 'reviewing'].includes(paymentStatus))
      && fulfillmentStatus === 'pending',
    refund: paymentStatus === 'paid'
      && fulfillmentStatus === 'fulfilled',
    retryFulfillment: paymentStatus === 'paid'
      && fulfillmentStatus === 'pending',
  };
}

function courseOrderEditableFields(row = {}) {
  const capabilities = courseOrderCapabilities(row);
  if (!capabilities.edit) return [];
  return ['quantity', 'contact', 'remittanceLast5'];
}

function assertCourseOrderAction(action, row = {}) {
  const normalized = normalizeCourseOrderAction(action);
  if (!COURSE_ORDER_ACTIONS.has(normalized)) {
    throw workflowError('COURSE_ORDER_ACTION_INVALID', '不支援的課程訂單操作', 400);
  }
  const capabilities = courseOrderCapabilities(row);
  const allowed = {
    'mark-reviewing': capabilities.markPaymentReview,
    'confirm-payment': capabilities.confirmPayment,
    cancel: capabilities.cancel,
    refund: capabilities.refund,
    'retry-fulfillment': capabilities.retryFulfillment,
  }[normalized];
  if (!allowed) {
    throw workflowError(
      'COURSE_ORDER_ACTION_NOT_ALLOWED',
      '目前訂單狀態不允許此操作',
      409,
      { action: normalized, ...deriveCourseOrderStatuses(row) }
    );
  }
  return normalized;
}

module.exports = {
  COURSE_ORDER_ACTIONS,
  COURSE_ORDER_SOURCE,
  assertCourseOrderAction,
  assertCoursePurchaseQuantity,
  courseCheckoutHash,
  courseOrderCapabilities,
  courseOrderEditableFields,
  courseProductPurchaseLimit,
  deriveCourseOrderStatuses,
  legacyCourseOrderStatus,
  normalizeCourseCartItems,
  normalizeCourseOrderAction,
  publicCourseOrderQuote,
  resolveCourseOrderQuote,
  stableStringify,
  workflowError,
};
