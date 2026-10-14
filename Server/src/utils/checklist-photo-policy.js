const CHECKLIST_PHOTO_MIN_COUNT = 2;
const CHECKLIST_PHOTO_RULE_EFFECTIVE_FROM = '2026-10-13T17:42:31+08:00';

function checklistPhotoMinimumForOrder(createdAt) {
  const text = typeof createdAt === 'string' ? createdAt.trim() : '';
  const localDate = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text);
  const timestamp = createdAt instanceof Date
    ? createdAt.getTime()
    : Date.parse(localDate ? `${text.replace(' ', 'T')}+08:00` : text);
  // Undated legacy/orphan records retain the original one-photo rule.
  return Number.isFinite(timestamp) && timestamp >= Date.parse(CHECKLIST_PHOTO_RULE_EFFECTIVE_FROM)
    ? CHECKLIST_PHOTO_MIN_COUNT
    : 1;
}

async function reservationChecklistPhotoMinimum(queryable, reservation) {
  if (Object.prototype.hasOwnProperty.call(reservation || {}, 'order_created_at')) {
    return checklistPhotoMinimumForOrder(reservation.order_created_at);
  }
  if (!reservation?.order_id) return 1;
  const [[order]] = await queryable.query('SELECT created_at FROM orders WHERE id = ? LIMIT 1', [reservation.order_id]);
  return checklistPhotoMinimumForOrder(order?.created_at);
}

function resolveChecklistPhotoLimit(value) {
  const count = Number(value);
  return Number.isInteger(count) && count > 0
    ? Math.max(CHECKLIST_PHOTO_MIN_COUNT, count)
    : 6;
}

function checklistPhotoCountMeetsMinimum(count, minimum = CHECKLIST_PHOTO_MIN_COUNT) {
  return Number.isInteger(Number(count)) && Number(count) >= minimum;
}

function checklistHasMinimumPhotos(checklist) {
  if (!checklist) return false;
  const count = checklist.photoCount ?? (Array.isArray(checklist.photos) ? checklist.photos.length : 0);
  return checklistPhotoCountMeetsMinimum(count, checklist.minPhotoCount ?? CHECKLIST_PHOTO_MIN_COUNT);
}

module.exports = {
  CHECKLIST_PHOTO_MIN_COUNT,
  CHECKLIST_PHOTO_RULE_EFFECTIVE_FROM,
  checklistPhotoMinimumForOrder,
  reservationChecklistPhotoMinimum,
  resolveChecklistPhotoLimit,
  checklistPhotoCountMeetsMinimum,
  checklistHasMinimumPhotos,
};
