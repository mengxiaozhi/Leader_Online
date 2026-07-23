const COURSE_MANAGER_ROLES = new Set(['ADMIN', 'SERVICE_PROVIDER'])
const GENERAL_ORDER_ROLES = new Set(['ADMIN', 'SERVICE_PROVIDER'])
const GENERAL_TICKET_ROLES = new Set(['ADMIN'])

const normalizeRole = (role = '') => {
  const normalized = String(role || '').trim().toUpperCase()
  if (normalized === 'STORE' || normalized === 'COACH') return 'SERVICE_PROVIDER'
  return normalized
}

export const buildAdminRecordCategoryOptions = (kind, role = '') => {
  const normalizedRole = normalizeRole(role)
  const options = []
  if (kind === 'orders' && GENERAL_ORDER_ROLES.has(normalizedRole)) {
    options.push({ key: 'general', label: '一般訂單' })
  }
  if (kind === 'tickets' && GENERAL_TICKET_ROLES.has(normalizedRole)) {
    options.push({ key: 'general', label: '一般票券' })
  }
  if (COURSE_MANAGER_ROLES.has(normalizedRole)) {
    options.push({ key: 'course', label: kind === 'orders' ? '課程訂單' : '課程票券' })
  }
  return options
}

export const resolveAdminRecordCategory = (kind, role, preferred = '') => {
  const options = buildAdminRecordCategoryOptions(kind, role)
  const requested = String(preferred || '').trim().toLowerCase()
  if (options.some(option => option.key === requested)) return requested
  return options[0]?.key || ''
}
