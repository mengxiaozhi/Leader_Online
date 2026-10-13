const CHECKLIST_PHOTO_MIN_COUNT = 2;

function resolveChecklistPhotoLimit(value) {
  const count = Number(value);
  return Number.isInteger(count) && count > 0
    ? Math.max(CHECKLIST_PHOTO_MIN_COUNT, count)
    : 6;
}

function checklistPhotoCountMeetsMinimum(count) {
  return Number.isInteger(Number(count)) && Number(count) >= CHECKLIST_PHOTO_MIN_COUNT;
}

function checklistHasMinimumPhotos(checklist) {
  if (!checklist) return false;
  const count = checklist.photoCount ?? (Array.isArray(checklist.photos) ? checklist.photos.length : 0);
  return checklistPhotoCountMeetsMinimum(count);
}

module.exports = {
  CHECKLIST_PHOTO_MIN_COUNT,
  resolveChecklistPhotoLimit,
  checklistPhotoCountMeetsMinimum,
  checklistHasMinimumPhotos,
};
