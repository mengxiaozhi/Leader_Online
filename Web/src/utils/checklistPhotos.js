export const CHECKLIST_PHOTO_MIN_COUNT = 2

export const checklistHasMinimumPhotos = (checklist, minCount = CHECKLIST_PHOTO_MIN_COUNT) => {
    if (!checklist) return false
    const count = Number(checklist.photoCount ?? (Array.isArray(checklist.photos) ? checklist.photos.length : 0))
    return Number.isInteger(count) && count >= Math.max(CHECKLIST_PHOTO_MIN_COUNT, Number(minCount) || CHECKLIST_PHOTO_MIN_COUNT)
}
