'use strict';

// Historical tickets use 0 for a full service redemption. Positive values are
// fixed TWD face values, consumed once and capped separately for each service.
function ticketFaceValue(value = 0) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))
      || !Number.isSafeInteger(Number(value)) || Number(value) > 99999999) {
    throw Object.assign(new Error('票券抵免金額須為 0 至 99,999,999 的整數'), {
      code: 'TICKET_DISCOUNT_INVALID', statusCode: 400,
    });
  }
  return Number(value);
}

function redemptionDiscount(unitPrice, redemptions) {
  const unitCents = Math.round(Number(unitPrice) * 100);
  return redemptions.reduce((sum, ticket) => {
    const face = ticketFaceValue(ticket.faceValue);
    return sum + (face === 0 ? unitCents : Math.min(unitCents, face * 100));
  }, 0) / 100;
}

module.exports = { ticketFaceValue, redemptionDiscount };
