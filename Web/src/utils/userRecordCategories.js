const CATEGORY_LABELS = {
  tickets: {
    general: '一般票券',
    course: '課程票券',
  },
  reservations: {
    general: '一般預約',
    course: '課程預約',
  },
  orders: {
    general: '一般訂單',
    course: '課程訂單',
  },
}

const WALLET_TABS = new Set(['tickets', 'reservations', 'logs'])

const normalizeKind = (kind = '') => String(kind || '').trim().toLowerCase()
const normalizeCategory = (category = '') => String(category || '').trim().toLowerCase()

export const buildUserRecordCategoryOptions = (kind) => {
  const labels = CATEGORY_LABELS[normalizeKind(kind)]
  if (!labels) return []
  return [
    { key: 'general', label: labels.general },
    { key: 'course', label: labels.course },
  ]
}

export const resolveUserRecordCategory = (kind, preferred = '') => {
  const options = buildUserRecordCategoryOptions(kind)
  const requested = normalizeCategory(preferred)
  if (options.some(option => option.key === requested)) return requested
  return options[0]?.key || ''
}

export const resolveWalletRecordLocation = (tab = '', category = '') => {
  const requestedTab = String(tab || '').trim().toLowerCase()
  if (requestedTab === 'courses') {
    return { tab: 'tickets', category: 'course', migratedLegacyCourseTab: true }
  }

  if (requestedTab === 'logs') {
    return { tab: 'logs', category: '', migratedLegacyCourseTab: false }
  }

  if (!WALLET_TABS.has(requestedTab)) {
    return { tab: 'tickets', category: 'general', migratedLegacyCourseTab: false }
  }

  const kind = requestedTab === 'reservations' ? 'reservations' : 'tickets'
  return {
    tab: requestedTab,
    category: resolveUserRecordCategory(kind, category),
    migratedLegacyCourseTab: false,
  }
}
