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

function applyEditableConsignorName(details, previousDetails = {}, input = details) {
  const previousName = normalizeConsignorName(previousDetails?.consignorName);
  if (Object.prototype.hasOwnProperty.call(input, 'consignorName')) {
    const value = input.consignorName;
    const blank = value == null || (typeof value === 'string' && !normalizeConsignorName(value));
    // Historical orders never captured this identity. Empty legacy form values
    // must not prevent editing, and must not infer a consignor from the member.
    if (blank && !previousName) delete details.consignorName;
    else details.consignorName = requireConsignorName(value);
  } else if (previousName) details.consignorName = previousName;
  else delete details.consignorName;
  return details;
}

function formatConsignorName(value) {
  return normalizeConsignorName(value) || '未提供（不影響託運）';
}

module.exports = { normalizeConsignorName, requireConsignorName, applyEditableConsignorName, formatConsignorName };
