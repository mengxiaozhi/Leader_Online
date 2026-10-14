export const CHECKLIST_PHOTO_MIN_COUNT = 2

export const checklistPhotoMinimum = (checklist, fallback = CHECKLIST_PHOTO_MIN_COUNT) => {
    const minimum = Number(checklist?.minPhotoCount ?? fallback)
    return Number.isInteger(minimum) && minimum > 0 ? minimum : CHECKLIST_PHOTO_MIN_COUNT
}

export const checklistHasMinimumPhotos = (checklist, minCount = CHECKLIST_PHOTO_MIN_COUNT) => {
    if (!checklist) return false
    const count = Number(checklist.photoCount ?? (Array.isArray(checklist.photos) ? checklist.photos.length : 0))
    return Number.isInteger(count) && count >= checklistPhotoMinimum(checklist, minCount)
}
