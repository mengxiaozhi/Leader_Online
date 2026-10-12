// The consignor is a shipment contact, independent of the account/order owner.
function normalizeConsignorName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function requireConsignorName(value) {
  const name = normalizeConsignorName(value);
  if (!name || name.length > 50) {
    throw Object.assign(new Error('請填寫 1 至 50 個字的託運者姓名'), {
      code: 'CONSIGNOR_NAME_INVALID', statusCode: 400,
    });
  }
  return name;
}

module.exports = { normalizeConsignorName, requireConsignorName };
