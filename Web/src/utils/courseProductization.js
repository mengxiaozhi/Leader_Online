const text = value => String(value ?? '').trim()

export const COURSE_CANONICAL_PATHS = Object.freeze({
  public: Object.freeze({ passes: '/courses/passes', classes: '/courses/classes', sessions: '/courses/sessions' }),
  member: Object.freeze({
    schedule: '/courses/me/schedule',
    passes: '/courses/me/passes',
    enrollments: '/courses/me/enrollments',
    makeup: '/courses/me/makeup',
    renewals: '/courses/me/renewals',
    orders: '/courses/me/orders',
    notifications: '/courses/me/notifications',
  }),
  admin: Object.freeze({
    catalog: '/admin/courses/catalog',
    redeemContexts: '/admin/courses/redeem-contexts',
    classes: '/admin/courses/classes',
    schedule: '/admin/courses/schedule',
    operations: '/admin/courses/operations',
    enrollments: '/admin/courses/enrollments',
    students: '/admin/courses/students',
    reports: '/admin/courses/reports',
    settings: '/admin/courses/settings',
  }),
  coach: Object.freeze({ session: '/coach/courses/sessions/:sessionId', checkIn: '/coach/courses/sessions/:sessionId/check-in' }),
})

export const courseTermPath = termId => `${COURSE_CANONICAL_PATHS.public.classes}/${encodeURIComponent(text(termId))}`
export const courseTermCheckoutPath = termId => `${courseTermPath(termId)}/checkout`

export const COURSE_PRODUCTIZATION_ENDPOINTS = Object.freeze({
  publicPasses: '/courses/products',
  publicClasses: '/courses/terms',
  publicClass: termId => `/courses/terms/${encodeURIComponent(text(termId))}`,
  termEligibility: termId => `/courses/terms/${encodeURIComponent(text(termId))}/eligibility`,
  termQuote: termId => `/courses/terms/${encodeURIComponent(text(termId))}/quote`,
  termPaymentOptions: termId => `/courses/terms/${encodeURIComponent(text(termId))}/payment-options`,
  termCheckout: '/courses/terms/checkout',
  termWaitlist: termId => `/courses/terms/${encodeURIComponent(text(termId))}/waitlist`,
  orderPaymentSubmission: orderId => `/courses/orders/${encodeURIComponent(text(orderId))}/payment-submissions`,
  publicSessions: '/courses/sessions',
  memberSchedule: '/courses/me/schedule',
  memberEnrollments: '/courses/me/enrollments',
  memberMakeup: '/courses/me/makeup-credits',
  memberRenewals: '/courses/me/renewal-options',
  memberWaitlistOffers: '/courses/me/waitlist-offers',
  memberWaitlistOfferAction: (offerId, action) => `/courses/waitlist-offers/${encodeURIComponent(text(offerId))}/${action === 'accept' ? 'accept' : 'decline'}`,
  renewalEligibility: ruleId => `/courses/renewals/${encodeURIComponent(text(ruleId))}/eligibility`,
  renewalQuote: ruleId => `/courses/renewals/${encodeURIComponent(text(ruleId))}/quote`,
  memberNotifications: '/courses/me/notifications',
  memberNotificationRead: notificationId => `/courses/me/notifications/${encodeURIComponent(text(notificationId))}/read`,
  termLeave: entitlementId => `/courses/term-entitlements/${encodeURIComponent(text(entitlementId))}/leave`,
  termLeaveCancel: leaveId => `/courses/term-leaves/${encodeURIComponent(text(leaveId))}/cancel`,
  makeupBook: makeupId => `/courses/makeup/${encodeURIComponent(text(makeupId))}/book`,
  makeupInsuranceCheckout: makeupId => `/courses/makeup/${encodeURIComponent(text(makeupId))}/insurance-checkout`,
  adminClasses: '/admin/courses/terms',
  adminFixedTermCatalog: '/admin/courses/catalog/fixed-terms',
  adminPrograms: '/admin/courses/programs',
  adminLevelSchemes: '/admin/courses/level-schemes',
  adminLevels: '/admin/courses/levels',
  adminTermSessions: termId => `/admin/courses/terms/${encodeURIComponent(text(termId))}/sessions`,
  adminTermPricingRules: termId => `/admin/courses/terms/${encodeURIComponent(text(termId))}/pricing-rules`,
  adminTermReadiness: termId => `/admin/courses/terms/${encodeURIComponent(text(termId))}/readiness`,
  adminTermPublish: termId => `/admin/courses/terms/${encodeURIComponent(text(termId))}/publish`,
  adminEnrollments: '/admin/courses/enrollments',
  adminEnrollmentComplete: enrollmentId => `/admin/courses/enrollments/${encodeURIComponent(text(enrollmentId))}/complete`,
  adminTermWaitlist: termId => `/admin/courses/terms/${encodeURIComponent(text(termId))}/waitlist`,
  adminTermWaitlistOffers: termId => `/admin/courses/terms/${encodeURIComponent(text(termId))}/waitlist/offers`,
  adminStudents: '/admin/courses/students',
  adminStudentLevel: studentId => `/admin/courses/students/${encodeURIComponent(text(studentId))}/level`,
  adminTermEntitlementAttendance: (entitlementId, action) => `/admin/courses/term-entitlements/${encodeURIComponent(text(entitlementId))}/${action === 'attend' ? 'attend' : 'absent'}`,
  adminMakeupBookings: '/admin/courses/makeup-bookings',
  adminMakeupBookingAttendance: (bookingId, action) => `/admin/courses/makeup-bookings/${encodeURIComponent(text(bookingId))}/${action === 'attend' ? 'attend' : 'no-show'}`,
  adminMakeupRoutes: '/admin/courses/makeup-routes',
  adminMakeupRoute: routeId => `/admin/courses/makeup-routes/${encodeURIComponent(text(routeId))}`,
  adminRenewalRules: '/admin/courses/renewal-rules',
  adminRenewalRule: ruleId => `/admin/courses/renewal-rules/${encodeURIComponent(text(ruleId))}`,
  adminMakeupInsurancePolicies: '/admin/courses/makeup-insurance-policies',
  adminMakeupInsurancePolicy: policyId => `/admin/courses/makeup-insurance-policies/${encodeURIComponent(text(policyId))}`,
  coachSession: sessionId => `/courses/coach/sessions/${encodeURIComponent(text(sessionId))}`,
})

export const PUBLIC_COURSE_TASKS = Object.freeze([
  { key: 'passes', label: '計次方案', description: '選購堂數票與體驗折抵方案。', icon: 'ticket', path: COURSE_CANONICAL_PATHS.public.passes, endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.publicPasses },
  { key: 'classes', label: '固定班', description: '查看固定期班、程度門檻與候補狀態。', icon: 'calendar', path: COURSE_CANONICAL_PATHS.public.classes, endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.publicClasses },
  { key: 'sessions', label: '開放場次', description: '使用計次票預約單堂場次。', icon: 'clock', path: COURSE_CANONICAL_PATHS.public.sessions, endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.publicSessions },
])

export const MEMBER_COURSE_TASKS = Object.freeze([
  { key: 'schedule', label: '我的課表', description: '按時間查看即將上課與請假狀態。', icon: 'calendar', path: COURSE_CANONICAL_PATHS.member.schedule, endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.memberSchedule },
  { key: 'passes', label: '計次票', description: '查看可用、保留、暫停與轉讓。', icon: 'ticket', path: COURSE_CANONICAL_PATHS.member.passes, sharedRecord: 'tickets' },
  { key: 'enrollments', label: '固定班', description: '管理報名、候補與限時名額。', icon: 'user', path: COURSE_CANONICAL_PATHS.member.enrollments, endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.memberEnrollments },
  { key: 'makeup', label: '請假／補課', description: '使用補課權益與處理保險付款。', icon: 'refresh', path: COURSE_CANONICAL_PATHS.member.makeup, endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.memberMakeup },
  { key: 'renewals', label: '續報', description: '驗證資格並鎖定續報價格。', icon: 'check', path: COURSE_CANONICAL_PATHS.member.renewals, endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.memberRenewals },
  { key: 'orders', label: '課程訂單', description: '追蹤付款、審核與履約狀態。', icon: 'orders', path: COURSE_CANONICAL_PATHS.member.orders, sharedRecord: 'orders' },
  { key: 'notifications', label: '通知', description: '集中查看候補、補課與轉讓通知。', icon: 'info', path: COURSE_CANONICAL_PATHS.member.notifications, endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.memberNotifications },
])

export const ADMIN_COURSE_TASKS = Object.freeze([
  { key: 'catalog', label: '商品目錄', group: '商品', legacyTab: 'products' },
  { key: 'redeem-contexts', label: '票種／核銷情境', group: '商品', legacyTab: 'course-v2' },
  { key: 'classes', label: '固定班', group: '排課', legacyTab: 'term-classes', endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.adminFixedTermCatalog },
  { key: 'schedule', label: '課程表', group: '排課', legacyTab: 'sessions' },
  { key: 'operations', label: '課務中心', group: '營運', legacyTab: 'bookings' },
  { key: 'enrollments', label: '報名／候補', group: '營運', legacyTab: 'term-enrollments', endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.adminEnrollments },
  { key: 'students', label: '學員／程度', group: '營運', legacyTab: 'term-students', endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.adminStudents },
  { key: 'reports', label: '報表', group: '分析', legacyTab: 'course-v2' },
  { key: 'settings', label: '設定', group: '系統', legacyTab: 'course-v2' },
])

export function resolveCoursePublicTask(value = '') {
  const key = text(value).toLowerCase()
  return PUBLIC_COURSE_TASKS.find(item => item.key === key) || PUBLIC_COURSE_TASKS[0]
}

export function resolveCourseMemberTask(value = '') {
  const key = text(value).toLowerCase()
  return MEMBER_COURSE_TASKS.find(item => item.key === key) || MEMBER_COURSE_TASKS[0]
}

export function resolveCourseAdminTask(value = '') {
  const key = text(value).toLowerCase()
  return ADMIN_COURSE_TASKS.find(item => item.key === key) || ADMIN_COURSE_TASKS[0]
}

export function courseRecordDeepLink(kind, highlight = '') {
  const query = kind === 'orders'
    ? { tab: 'courses', orders: '1', category: 'course' }
    : { tab: 'tickets', category: 'course' }
  if (highlight) query[kind === 'orders' ? 'order' : 'ticket'] = text(highlight)
  return { path: kind === 'orders' ? '/store' : '/wallet', query }
}

export function courseCapacityLabel(source = {}) {
  const availability = source.seatAvailability || source.seat_availability || {}
  const rawCapacity = source.capacity ?? source.capacityTotal ?? source.capacity_total ?? availability.capacity
  if (rawCapacity === null || rawCapacity === undefined || rawCapacity === '') return '不限名額'
  const capacity = Number(rawCapacity)
  if (!Number.isFinite(capacity) || capacity <= 0) return '不限名額'
  const held = Math.max(0, Number(source.heldCount ?? source.held_count ?? source.pendingPaymentCount ?? 0) || 0)
  const allocated = Math.max(0, Number(availability.allocated ?? 0) || 0)
  const confirmed = Math.max(0, Number(source.confirmedCount ?? source.confirmed_count ?? source.enrolledCount ?? allocated) || 0)
  const available = Number.isFinite(Number(availability.available))
    ? Math.max(0, Number(availability.available))
    : Math.max(0, capacity - held - confirmed)
  return `剩餘 ${available}／${capacity} 席${held ? `（${held} 席付款保留中）` : ''}`
}

export function isCourseTermFull(source = {}) {
  const availability = source.seatAvailability || source.seat_availability || {}
  if (typeof availability.full === 'boolean') return availability.full
  const rawCapacity = source.capacity ?? availability.capacity
  if (rawCapacity === null || rawCapacity === undefined || rawCapacity === '') return false
  const capacity = Number(rawCapacity)
  const available = Number(availability.available)
  if (Number.isFinite(available)) return available <= 0
  return Number.isFinite(capacity) && capacity > 0
    && Number(availability.allocated || 0) >= capacity
}

export function normalizeCourseTermPaymentOptions(data) {
  const payload = data?.data ?? data ?? {}
  const items = Array.isArray(payload) ? payload : (Array.isArray(payload.items) ? payload.items : [])
  return items.map(item => ({
    ...item,
    ticketId: Number(item.ticketId ?? item.ticket_id),
    ticketCode: text(item.ticketCode ?? item.ticket_code),
    ticketProductName: text(item.ticketProductName ?? item.ticket_product_name),
    instrumentType: text(item.instrumentType ?? item.instrument_type).toUpperCase(),
    discountAmount: Number(item.discountAmount ?? item.discount_amount ?? 0) || 0,
    availableUses: item.availableUses ?? item.available_uses ?? null,
    rowVersion: Number(item.rowVersion ?? item.row_version ?? 1) || 1,
  })).filter(item => item.ticketId > 0 && ['COURSE_TICKET', 'TRIAL_DISCOUNT'].includes(item.instrumentType))
}

export function normalizeCourseCenterPayload(data, keys = []) {
  const payload = data?.data ?? data ?? {}
  if (Array.isArray(payload)) return payload
  for (const key of ['items', ...keys]) if (Array.isArray(payload?.[key])) return payload[key]
  return []
}

export function courseDeadlineState(value, now = Date.now()) {
  const deadlineMs = value instanceof Date ? value.getTime() : Date.parse(text(value))
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) {
    return { valid: false, expired: false, remainingMs: null, tone: 'neutral', label: '未設定期限' }
  }
  const remainingMs = deadlineMs - nowMs
  if (remainingMs <= 0) return { valid: true, expired: true, remainingMs: 0, tone: 'danger', label: '已到期' }
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000))
  if (minutes < 60) return { valid: true, expired: false, remainingMs, tone: 'danger', label: `剩餘 ${minutes} 分鐘` }
  const hours = Math.ceil(minutes / 60)
  if (hours < 24) return { valid: true, expired: false, remainingMs, tone: 'warning', label: `剩餘 ${hours} 小時` }
  const days = Math.ceil(hours / 24)
  return { valid: true, expired: false, remainingMs, tone: days <= 3 ? 'warning' : 'info', label: `剩餘 ${days} 天` }
}

export function courseCenterErrorMessage(error, fallback = '課程資料載入失敗') {
  if (Number(error?.response?.status || 0) === 404) return '此功能正在等候 Course Center API 上線。既有計次票與課程訂單仍可正常使用。'
  return text(error?.response?.data?.message || error?.message) || fallback
}
