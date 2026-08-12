'use strict';

function ticketPolicyError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function assertGeneralTicketManager({ actor, ownerUserId, isAdmin } = {}) {
  if (typeof isAdmin === 'function' && isAdmin(actor?.role)) return true;
  const actorUserId = String(actor?.id || '').trim();
  const normalizedOwnerUserId = String(ownerUserId || '').trim();
  if (!actorUserId || !normalizedOwnerUserId || actorUserId !== normalizedOwnerUserId) {
    throw ticketPolicyError('FORBIDDEN', '無權限操作其他服務商的票券', 403);
  }
  return true;
}

module.exports = {
  assertGeneralTicketManager,
};
