import { toDate } from './datetime'

export const CHECKLIST_STAGE_KEYS = ['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup']
export const PICKUP_STAGE_KEYS = ['pre_pickup', 'post_pickup']

export const RESERVATION_STATUS_LIST = [
    { key: 'pre_dropoff', shortLabel: '出貨前交付', label: '出貨前交付', color: 'bg-yellow-100 text-yellow-700' },
    { key: 'pre_pickup', shortLabel: '出貨前取貨', label: '出貨前取貨', color: 'bg-blue-100 text-blue-700' },
    { key: 'post_dropoff', shortLabel: '到貨後交付', label: '到貨後交付', color: 'bg-indigo-100 text-indigo-700' },
    { key: 'post_pickup', shortLabel: '到貨後取貨', label: '到貨後取貨', color: 'bg-blue-100 text-blue-700' },
    { key: 'done', shortLabel: '完成', label: '完成', color: 'bg-green-100 text-green-700' }
]
export const RESERVATION_STATUS_LABEL_MAP = Object.fromEntries(RESERVATION_STATUS_LIST.map(s => [s.key, s.label]))
export const RESERVATION_STATUS_COLOR_MAP = Object.fromEntries(RESERVATION_STATUS_LIST.map(s => [s.key, s.color]))

export const DEFAULT_STAGE_CHECKLIST_DEFINITIONS = Object.freeze({
    pre_dropoff: {
        title: '出貨前交付檢核表',
        description: '交付貨物前請與人員確認托運內容並完成點交紀錄。',
        items: [
            '貨物與配件與預約資訊相符',
            '托運文件、標籤與聯絡方式已確認',
            '完成貨況拍照（含外觀、特殊要求）'
        ],
        confirmText: '檢核完成，顯示 QR Code'
    },
    pre_pickup: {
        title: '出貨前取貨檢核表',
        description: '請與人員逐項確認貨物與文件，完成後即可出示 QR Code。',
        items: [
            '貨物外觀與包裝無異常',
            '托運文件與隨附物品已領取',
            '與人員完成貨況紀錄或拍照存證'
        ],
        confirmText: '檢核完成，顯示 QR Code'
    },
    post_dropoff: {
        title: '到貨後交付檢核表',
        description: '到貨後交付時，請與人員再次確認貨況與交付資訊。',
        items: [
            '貨物完整停放於指定區域並妥善固定',
            '與人員核對到貨後貨況與隨附物品',
            '拍攝交付現場與貨況照片備查'
        ],
        confirmText: '檢核完成，顯示 QR Code'
    },
    post_pickup: {
        title: '到貨後取貨檢核表',
        description: '確認到貨後貨況與點交內容，完成後才會顯示 QR Code。',
        items: [
            '貨物外觀無新增損傷與污漬',
            '出貨前寄存的隨附物品已領回',
            '與人員完成到貨後貨況點交紀錄'
        ],
        confirmText: '檢核完成，顯示 QR Code'
    }
})

export const toOptionalNumber = (value) => {
    if (value === null || value === undefined || value === '') return null
    const n = Number(value)
    return Number.isFinite(n) ? n : null
}

export const toStageCodeString = (value) => {
    if (value === undefined || value === null) return null
    const text = String(value).trim()
    return text || null
}

export const buildStageCodeMap = (record = {}) => {
    const base = {
        pre_dropoff: null,
        pre_pickup: null,
        post_dropoff: null,
        post_pickup: null
    }
    if (!record || typeof record !== 'object') return base
    const existing = (record.stageCodes && typeof record.stageCodes === 'object') ? record.stageCodes : {}
    return {
        pre_dropoff: toStageCodeString(existing.pre_dropoff ?? record.verify_code_pre_dropoff),
        pre_pickup: toStageCodeString(existing.pre_pickup ?? record.verify_code_pre_pickup),
        post_dropoff: toStageCodeString(existing.post_dropoff ?? record.verify_code_post_dropoff),
        post_pickup: toStageCodeString(existing.post_pickup ?? record.verify_code_post_pickup)
    }
}

export const getReservationStageCode = (reservation, stageOverride = null) => {
    if (!reservation) return null
    const stage = stageOverride || reservation.status
    if (!stage) return null
    const codes = buildStageCodeMap(reservation)
    if (codes[stage]) return codes[stage]
    const fallbackList = Object.values(codes).filter(Boolean)
    if (fallbackList.length) return fallbackList[0]
    return toStageCodeString(reservation.verifyCode || reservation.verify_code)
}

export const phaseLabel = (status) => (String(status || '').includes('pickup') ? '取貨' : '交付')
export const reservationActionLabel = (status) => {
    const value = String(status || '')
    if (value === 'done') return '已完成'
    if (value.includes('pickup')) return '我要取貨'
    if (value.includes('dropoff')) return '我要交付'
    return '查看詳情'
}

export const isPickupStage = (stage) => PICKUP_STAGE_KEYS.includes(stage)
export const requiresChecklistBeforeQr = (stage) => CHECKLIST_STAGE_KEYS.includes(stage)
export const checklistFriendlyName = (stage) => {
    const map = {
        pre_dropoff: '出貨前交付檢核',
        pre_pickup: '出貨前取貨檢核',
        post_dropoff: '到貨後交付檢核',
        post_pickup: '到貨後取貨檢核'
    }
    return map[stage] || '檢核'
}

export const normalizeStageDefinition = (stage, input = {}, defaults = DEFAULT_STAGE_CHECKLIST_DEFINITIONS) => {
    const fallback = defaults[stage] || {}
    const source = input && typeof input === 'object' ? input : {}
    const title = typeof source.title === 'string' && source.title.trim() ? source.title.trim() : (fallback.title || '')
    const description = typeof source.description === 'string' && source.description.trim() ? source.description.trim() : (fallback.description || '')
    const confirmText = typeof source.confirmText === 'string' && source.confirmText.trim() ? source.confirmText.trim() : (fallback.confirmText || '')
    const items = Array.isArray(source.items)
        ? source.items.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
        : (Array.isArray(fallback.items) ? [...fallback.items] : [])
    return {
        title,
        description,
        confirmText,
        items: items.length ? items : (Array.isArray(fallback.items) ? [...fallback.items] : [])
    }
}

export const cloneStageChecklistDefinitions = (source = DEFAULT_STAGE_CHECKLIST_DEFINITIONS) => {
    const result = {}
    CHECKLIST_STAGE_KEYS.forEach(stage => {
        result[stage] = normalizeStageDefinition(stage, source[stage], DEFAULT_STAGE_CHECKLIST_DEFINITIONS)
    })
    return result
}

export const ensureChecklistHasPhotos = (data) => {
    if (!data) return false
    if (typeof data.photoCount === 'number') return data.photoCount > 0
    return Array.isArray(data?.photos) && data.photos.length > 0
}

const coerceChecklistBoolean = (value) => {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value > 0 : false
    if (value instanceof Date) return true
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (!normalized) return false
        const positive = ['1', 'true', 'yes', 'y', 'done', 'completed', 'complete', 'finished', 'ok', 'pass', 'passed', '已完成', '完成', '已檢核', '已檢查']
        const negative = ['0', 'false', 'no', 'n', 'pending', 'incomplete', 'todo', 'none', 'null', 'undefined', '未完成', '尚未完成', '待處理', '未檢核', '未檢查']
        if (positive.includes(normalized)) return true
        if (negative.includes(normalized)) return false
        if (/^\d+$/.test(normalized)) return Number(normalized) > 0
        return true
    }
    return !!value
}

export const detectStageChecklistStatus = (record, stage) => {
    if (!record || !stage) return { found: false, completed: false }
    const stageSnake = String(stage || '').toLowerCase()
    const stagePlain = stageSnake.replace(/_/g, '')
    const keys = Object.keys(record || {})
    for (const key of keys) {
        const lower = key.toLowerCase()
        const matchesStage = lower.includes(stageSnake) || lower.includes(stagePlain)
        if (!matchesStage) continue
        const matchesCategory = ['check', 'inspect', 'verify', 'confirm'].some(marker => lower.includes(marker))
        if (!matchesCategory) continue
        const val = record[key]
        if (val === undefined || val === null || val === '') continue
        if (typeof val === 'object') continue
        return { found: true, completed: coerceChecklistBoolean(val) }
    }
    return { found: false, completed: false }
}

export const normalizeStageChecklist = (stage, raw = {}, options = {}) => {
    const definitions = options.definitions || DEFAULT_STAGE_CHECKLIST_DEFINITIONS
    const def = definitions[stage] || { items: [] }
    const base = raw && typeof raw === 'object' ? raw : {}
    const items = Array.isArray(base.items) ? base.items : []
    const defItems = Array.isArray(def.items) ? def.items : []
    const normalizedItems = defItems.length
        ? defItems.map(label => {
            const existed = items.find(item => item && item.label === label)
            return { label, checked: !!existed?.checked }
        })
        : items
            .map(item => ({ label: item?.label || String(item?.text || ''), checked: !!item?.checked }))
            .filter(item => item.label)

    const photos = Array.isArray(base.photos) ? base.photos.map(photo => ({
        id: photo.id,
        url: photo.url,
        storagePath: photo.storagePath || null,
        mime: photo.mime,
        originalName: photo.originalName,
        uploadedAt: photo.uploadedAt,
        size: photo.size,
        stage: photo.stage,
        reservationId: photo.reservationId,
        legacy: photo.legacy,
        dataUrl: photo.dataUrl
    })).filter(photo => photo.id) : []
    const photoCount = typeof base.photoCount === 'number' ? base.photoCount : photos.length
    return {
        items: normalizedItems,
        photos,
        completed: !!base.completed,
        completedAt: base.completedAt || null,
        photoCount
    }
}

export const isStageChecklistCompleted = (reservation, stage) => {
    if (!reservation || !stage) return false
    const stageInfo = reservation.stageChecklist?.[stage]
    const checklist = reservation.checklists?.[stage]
    const completed = !!(stageInfo?.completed || checklist?.completed)
    if (!completed) return false
    const stagePhotoCount = typeof stageInfo?.photoCount === 'number' ? stageInfo.photoCount : 0
    const hasPhotos = stagePhotoCount > 0 || ensureChecklistHasPhotos(checklist)
    return hasPhotos
}

export const parseReservationDate = (value) => toDate(value)
export const reservationSortTimestamp = (reservation) => {
    const reservedAt = parseReservationDate(reservation?.reservedAt || reservation?.reserved_at)
    if (reservedAt) return reservedAt.getTime()
    const idNum = Number(reservation?.id)
    return Number.isFinite(idNum) ? idNum : 0
}
export const sortReservationsByLatest = (list = []) => [...list].sort((a, b) => reservationSortTimestamp(b) - reservationSortTimestamp(a))
