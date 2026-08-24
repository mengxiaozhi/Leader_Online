import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  ADMIN_COURSE_TASKS,
  COURSE_CANONICAL_PATHS,
  COURSE_PRODUCTIZATION_ENDPOINTS,
  MEMBER_COURSE_TASKS,
  PUBLIC_COURSE_TASKS,
  courseCapacityLabel,
  courseDeadlineState,
  courseRecordDeepLink,
  courseTermCheckoutPath,
  courseTermPath,
  isCourseTermFull,
  normalizeCourseTermPaymentOptions,
  resolveCourseAdminTask,
  resolveCourseMemberTask,
  resolveCoursePublicTask,
} from '../src/utils/courseProductization.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('course center exposes stable public, member and admin task maps', () => {
  assert.deepEqual(PUBLIC_COURSE_TASKS.map(item => item.key), ['passes', 'classes', 'sessions'])
  assert.deepEqual(MEMBER_COURSE_TASKS.map(item => item.key), ['schedule', 'passes', 'enrollments', 'makeup', 'renewals', 'orders', 'notifications'])
  assert.deepEqual(ADMIN_COURSE_TASKS.map(item => item.key), ['catalog', 'redeem-contexts', 'classes', 'schedule', 'operations', 'enrollments', 'students', 'reports', 'settings', 'staff'])
  assert.equal(resolveCoursePublicTask('unknown').key, 'passes')
  assert.equal(resolveCourseMemberTask('makeup').path, COURSE_CANONICAL_PATHS.member.makeup)
  assert.equal(resolveCourseMemberTask('notifications').endpoint, '/courses/me/notifications')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.memberNotificationRead(12), '/courses/me/notifications/12/read')
  assert.equal(resolveCourseAdminTask('students').group, '營運')
  assert.equal(resolveCourseAdminTask('reports').capability, 'viewReports')
  assert.equal(resolveCourseAdminTask('staff').path, COURSE_CANONICAL_PATHS.admin.staff)
  assert.ok(PUBLIC_COURSE_TASKS.every(item => item.host === 'store' && item.path && item.readiness))
  assert.ok(MEMBER_COURSE_TASKS.every(item => item.host === 'wallet' && item.path && item.readiness))
  assert.ok(ADMIN_COURSE_TASKS.every(item => item.host === 'admin' && item.path && item.capability && item.readiness))
})

test('orders and tickets remain categorized shared records', () => {
  assert.deepEqual(courseRecordDeepLink('orders', 'CO-1'), { path: '/store', query: { tab: 'courses', orders: '1', category: 'course', order: 'CO-1' } })
  assert.deepEqual(courseRecordDeepLink('tickets', 'CTK-1'), { path: '/wallet', query: { tab: 'tickets', category: 'course', ticket: 'CTK-1' } })
})

test('capacity label includes pending payment holds without inventing a counter', () => {
  assert.equal(courseCapacityLabel({ capacity: 12, confirmedCount: 7, heldCount: 2 }), '剩餘 3／12 席（2 席付款保留中）')
  assert.equal(courseCapacityLabel({ capacity: 0 }), '不限名額')
  assert.equal(courseCapacityLabel({ capacity: 12, seatAvailability: { allocated: 8, available: 4, full: false } }), '剩餘 4／12 席')
  assert.equal(isCourseTermFull({ seatAvailability: { full: true } }), true)
})

test('deadline state gives stable urgency without inventing business status', () => {
  const now = Date.parse('2026-08-13T00:00:00.000Z')
  assert.deepEqual(courseDeadlineState('not-a-date', now), { valid: false, expired: false, remainingMs: null, tone: 'neutral', label: '未設定期限' })
  assert.equal(courseDeadlineState('2026-08-13T00:20:00.000Z', now).label, '剩餘 20 分鐘')
  assert.equal(courseDeadlineState('2026-08-13T12:00:00.000Z', now).tone, 'warning')
  assert.equal(courseDeadlineState('2026-08-18T00:00:00.000Z', now).tone, 'info')
  assert.equal(courseDeadlineState('2026-08-12T23:59:59.000Z', now).expired, true)
})

test('fixed-term paths and payment instruments are canonical and typed', () => {
  assert.equal(courseTermPath('term 1'), '/courses/classes/term%201')
  assert.equal(courseTermCheckoutPath(42), '/courses/classes/42/checkout')
  assert.deepEqual(normalizeCourseTermPaymentOptions({ data: { items: [
    { ticket_id: 8, ticket_code: 'CTK-8', instrument_type: 'course_ticket', available_uses: 2, row_version: 3 },
    { ticketId: 9, instrumentType: 'TRIAL_DISCOUNT', discountAmount: 500, rowVersion: 4 },
    { ticketId: 10, instrumentType: 'OTHER' },
  ] } }).map(item => [item.ticketId, item.instrumentType, item.rowVersion]), [
    [8, 'COURSE_TICKET', 3],
    [9, 'TRIAL_DISCOUNT', 4],
  ])
})

test('fixed-term admin endpoints cover catalog, publishing and attendance operations', () => {
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminFixedTermReadiness, '/admin/courses/fixed-term/readiness')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminFixedTermCatalog, '/admin/courses/catalog/fixed-terms')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminPrograms, '/admin/courses/programs')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminLevelSchemes, '/admin/courses/level-schemes')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminLevels, '/admin/courses/levels')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminTermSessions(7), '/admin/courses/terms/7/sessions')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminTermPricingRules(7), '/admin/courses/terms/7/pricing-rules')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminTermReadiness(7), '/admin/courses/terms/7/readiness')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminTermPublish(7), '/admin/courses/terms/7/publish')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminEnrollmentComplete(8), '/admin/courses/enrollments/8/complete')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminTermWaitlist(7), '/admin/courses/terms/7/waitlist')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminTermWaitlistOffers(7), '/admin/courses/terms/7/waitlist/offers')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminStudentLevel(9), '/admin/courses/students/9/level')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminTermEntitlementAttendance(10, 'attend'), '/admin/courses/term-entitlements/10/attend')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminTermEntitlementAttendance(10, 'absent'), '/admin/courses/term-entitlements/10/absent')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminMakeupBookings, '/admin/courses/makeup-bookings')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminMakeupBookingAttendance(11, 'attend'), '/admin/courses/makeup-bookings/11/attend')
  assert.equal(COURSE_PRODUCTIZATION_ENDPOINTS.adminMakeupBookingAttendance(11, 'no-show'), '/admin/courses/makeup-bookings/11/no-show')
})

test('router declares canonical course productization routes and staff surfaces', async () => {
  const source = await read('../src/router/router.js')
  for (const path of [
    '/courses/passes', '/courses/classes', '/courses/sessions',
    '/courses/classes/:id', '/courses/classes/:id/checkout',
    '/courses/me/schedule', '/courses/me/passes', '/courses/me/enrollments', '/courses/me/makeup', '/courses/me/renewals', '/courses/me/orders', '/courses/me/notifications',
    '/me/courses', '/me/courses/schedule', '/me/courses/passes', '/me/courses/enrollments', '/me/courses/makeup', '/me/courses/renewals', '/me/courses/orders', '/me/courses/notifications',
    '/admin/courses/catalog', '/admin/courses/redeem-contexts', '/admin/courses/classes', '/admin/courses/schedule', '/admin/courses/operations', '/admin/courses/enrollments', '/admin/courses/students', '/admin/courses/reports', '/admin/courses/staff', '/admin/courses/settings',
    '/coach/courses/sessions/:sessionId', '/coach/courses/sessions/:sessionId/check-in',
  ]) assert.match(source, new RegExp(path.replaceAll('/', '\\/').replace(':sessionId', ':sessionId')))
  assert.match(source, /courseStaffSurface/)
  assert.match(source, /requiresAuth: true/)
  assert.match(source, /const publicCourseSurface = task => \(\{[\s\S]*?import\('\.\.\/pages\/store\.vue'\)[\s\S]*?props: \{ courseTask: task \}/)
  assert.match(source, /const memberCourseSurface = task => \(\{[\s\S]*?import\('\.\.\/pages\/wallet\.vue'\)[\s\S]*?props: \{ courseTask: task \}/)
  assert.match(source, /const adminCourseSurface = task => \(\{[\s\S]*?import\('\.\.\/pages\/admin\.vue'\)[\s\S]*?props: \{ courseTask: task \}/)
})

test('member course aliases terminate at component routes without redirect loops', async () => {
  const source = await read('../src/router/router.js')
  const aliases = {
    '/me/courses': '/courses/me/schedule',
    '/me/courses/schedule': '/courses/me/schedule',
    '/me/courses/passes': '/courses/me/passes',
    '/me/courses/enrollments': '/courses/me/enrollments',
    '/me/courses/makeup': '/courses/me/makeup',
    '/me/courses/renewals': '/courses/me/renewals',
    '/me/courses/orders': '/courses/me/orders',
    '/me/courses/notifications': '/courses/me/notifications',
  }
  for (const [alias, target] of Object.entries(aliases)) {
    assert.notEqual(alias, target)
    assert.equal(Object.hasOwn(aliases, target), false)
    assert.ok(source.includes(`{ path: '${alias}', redirect: '${target}' }`))
    assert.ok(source.includes(`path: '${target}', ...memberCourseSurface(`))
  }
})

test('course surfaces render fixed-term, waitlist, payment, makeup and insurance contracts', async () => {
  const [store, detail, account, admin] = await Promise.all([
    read('../src/pages/courses.vue'),
    read('../src/pages/course-term.vue'),
    read('../src/pages/course-account.vue'),
    read('../src/pages/course-admin.vue'),
  ])
  assert.match(store, /程度門檻/)
  assert.match(store, /候補資格/)
  assert.match(store, /提前請假後保留補課權益/)
  assert.match(detail, /termEligibility/)
  assert.match(detail, /termPaymentOptions/)
  assert.match(detail, /termQuote/)
  assert.match(detail, /X-Course-Ticket-If-Match/)
  assert.match(detail, /體驗折抵可與匯款併用，不可與課程券同時使用/)
  assert.match(detail, /24 小時匯款席位保留/)
  assert.match(detail, /orderPaymentSubmission/)
  assert.match(detail, /remittanceMutationKey/)
  assert.match(detail, /shouldRetainIdempotencyKey/)
  assert.match(account, /逾期會自動釋出並推進候補/)
  assert.match(account, /開放水域場次若需保險/)
  assert.match(account, /termLeaveCancel/)
  assert.match(account, /makeupBook/)
  assert.match(account, /makeupInsuranceCheckout/)
  assert.match(account, /item\.targetSessions/)
  assert.match(account, /目前沒有可預約場次/)
  assert.doesNotMatch(account, /輸入場次 ID/)
  assert.match(account, /hasSelectedMakeupTarget/)
  assert.match(account, /selectedMakeupTarget/)
  assert.match(account, /session\.requiresInsurance/)
  assert.match(account, /交易性重新驗證/)
  assert.match(account, /memberNotificationRead/)
  assert.match(account, /markNotificationRead/)
  assert.match(account, /normalizeLocalPath/)
  assert.match(account, /驗證資格並鎖定續報價/)
  assert.match(account, /renewalEligibility/)
  assert.match(account, /renewalQuote/)
  assert.match(account, /memberWaitlistOffers/)
  assert.match(account, /orderPaymentSubmission/)
  assert.match(account, /makeup-insurance-payment:/)
  assert.match(account, /shouldRetainIdempotencyKey/)
  assert.match(account, /ticketReadinessLabel/)
  assert.match(account, /不限/)
  assert.match(admin, /體驗折抵與課程券支付/)
  assert.match(admin, /候補 offer、人工匯款與插班共用限時 seat allocation/)
  assert.match(admin, /有效請假鎖定後補課權益仍保留/)
})

test('public course surfaces embed in Store wayfinding and keep a staged mobile checkout', async () => {
  const [store, detail] = await Promise.all([
    read('../src/pages/courses.vue'),
    read('../src/pages/course-term.vue'),
  ])

  assert.match(store, /import CourseCenterShell from ['"]\.\.\/components\/CourseCenterShell\.vue['"]/)
  assert.match(store, /embedded: \{ type: Boolean, default: false \}/)
  assert.match(store, /const courseFrameComponent = computed\(\(\) => props\.initialTask && !props\.embedded \? CourseCenterShell : 'div'\)/)
  assert.match(store, /v-if="!props\.initialTask && !props\.embedded" class="flex rounded-lg[^\n]+role="tablist"/)
  assert.match(store, /const canonicalTab = publicTask\.value === 'sessions' \? 'sessions' : 'products'/)
  assert.match(store, /import AppBottomSheet from ['"]\.\.\/components\/AppBottomSheet\.vue['"]/)
  assert.match(store, /mobileProductFilters/)
  assert.match(store, /applyMobileFilters/)
  assert.match(store, /grid gap-4 sm:grid-cols-2 xl:grid-cols-3/)
  assert.match(store, /ticket-card flex min-h-full flex-col/)

  assert.doesNotMatch(detail, /CourseCenterShell/)
  assert.match(detail, /<main class="ops-page" aria-labelledby="course-term-title">/)
  assert.match(detail, /PUBLIC_COURSE_TASKS/)
  assert.match(detail, /aria-label="購票中心分類"/)
  assert.match(detail, /min-h-\[44px\][\s\S]{0,240}回到固定班列表/)
  assert.match(detail, /order-first lg:order-last lg:sticky/)
  assert.match(detail, /checkoutSteps/)
  assert.match(detail, /aria-current="checkoutStage === step\.index \? 'step' : undefined"/)
  assert.match(detail, /import LegalReviewDrawer from ['"]\.\.\/components\/LegalReviewDrawer\.vue['"]/)
  assert.match(detail, /reviewTermRules/)
  assert.match(detail, /pageSlugs: \['terms'\]/)
})

test('fixed-term admin surface exposes scoped mutations and recoverable conflicts', async () => {
  const source = await read('../src/pages/course-admin.vue')
  for (const contract of [
    'adminFixedTermReadiness', 'adminFixedTermCatalog', 'adminPrograms', 'adminLevelSchemes', 'adminLevels',
    'adminTermSessions', 'adminTermPricingRules', 'adminTermReadiness', 'adminTermPublish',
    'adminStudentLevel', 'adminEnrollmentComplete', 'adminTermWaitlist', 'adminTermWaitlistOffers',
    'adminTermEntitlementAttendance', 'adminMakeupBookings', 'adminMakeupBookingAttendance',
    'adminMakeupRoutes', 'adminMakeupRoute', 'adminRenewalRules', 'adminRenewalRule',
    'adminMakeupInsurancePolicies', 'adminMakeupInsurancePolicy',
  ]) assert.match(source, new RegExp(`COURSE_PRODUCTIZATION_ENDPOINTS\\.${contract}`))
  assert.match(source, /productizedOwnerUserId/)
  assert.match(source, /to="\/admin\/courses\/classes"/)
  assert.match(source, /固定班任務不會被靜默隱藏/)
  assert.match(source, /fixedTermAdminActive/)
  assert.match(source, /fixedTermPaymentsActive/)
  assert.match(source, /首波付款限制：只開放銀行匯款/)
  assert.match(source, /保險規則載入失敗；固定班 catalog 與補課路由仍可管理/)
  assert.match(source, /ownerUserId: productizedOwnerUserId\.value/)
  assert.match(source, /\/whoami/)
  assert.match(source, /\/courses\/staff\/me/)
  assert.match(source, /buildCourseMutationHeaders/)
  assert.match(source, /\[409, 412, 428\]\.includes/)
  assert.match(source, /status: 'BOOKED'/)
  assert.match(source, /productizedCatalog = reactive\(\{[^}]*sessions: \[\]/)
  assert.match(source, /makeupRoutes: \[\]/)
  assert.match(source, /sessionsForTerm\(term\.id\)/)
  assert.match(source, /已排場次/)
  assert.match(source, /判定理由/)
  assert.match(source, /productizedMakeupReasons\[booking\.id\]/)
  assert.doesNotMatch(source, /productizedMakeupAction/)
  for (const label of ['新增課程計畫', '新增程度方案', '新增程度', '新增班期', '新增場次', '新增定價', '發布檢查', '新增補課路由', '編輯補課路由', '更新程度評估', '標記結業', '釋出下一位', '補課已出席', '補課未到']) {
    assert.match(source, new RegExp(label))
  }
})
