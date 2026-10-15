// The consignor is a shipment contact, independent of the account/order owner.
function normalizeConsignorName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function requireConsignorName(value, buyerName) {
  const blank = value == null || (typeof value === 'string' && !normalizeConsignorName(value));
  const name = normalizeConsignorName(blank ? buyerName : value);
  if (!name || name.length > 50) {
    throw Object.assign(new Error('請填寫 1 至 50 個字的託運者姓名'), {
      code: 'CONSIGNOR_NAME_INVALID', statusCode: 400,
    });
  }
  return name;
}

function applyEditableConsignorName(details, previousDetails = {}, input = details, buyerName) {
  const previousName = normalizeConsignorName(previousDetails?.consignorName);
  if (Object.prototype.hasOwnProperty.call(input, 'consignorName')) {
    details.consignorName = requireConsignorName(input.consignorName, buyerName);
  } else if (previousName) details.consignorName = previousName;
  else details.consignorName = requireConsignorName(undefined, buyerName);
  return details;
}

function formatConsignorName(value) {
  return normalizeConsignorName(value) || '未提供（不影響託運）';
}

module.exports = { normalizeConsignorName, requireConsignorName, applyEditableConsignorName, formatConsignorName };
