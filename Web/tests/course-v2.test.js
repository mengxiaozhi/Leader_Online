import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCourseMutationHeaders,
  buildCourseScenarioPayload,
  buildCourseSessionPolicyPayload,
  buildCourseSettingsPayload,
  buildCourseTicketAdjustmentPayload,
  buildCourseTicketMutationHeaders,
  buildCourseTicketProductPayload,
  COURSE_V2_ENDPOINTS,
  courseTaipeiTimestamp,
  courseTicketRowVersion,
  formatCourseTaipeiDateTime,
  normalizeCourseCapabilities,
  normalizeCourseEligibility,
  normalizeCourseOrderPreview,
  normalizeCourseProduct,
  normalizeCourseStaffAccess,
  normalizeCourseTicket,
} from '../src/utils/courseV2.js'

test('course ticket DTO exposes immutable-ledger balance dimensions', () => {
  const ticket = normalizeCourseTicket({
    id: 7,
    remaining_uses: 5,
    active_hold_uses: 2,
    total_uses: 10,
    usage_events: [{ event_type: 'success', deltaUses: -1, balance_after: 5 }],
  })
  assert.equal(ticket.remainingUses, 5)
  assert.equal(ticket.heldUses, 2)
  assert.equal(ticket.availableUses, 3)
  assert.equal(ticket.totalUses, 10)
  assert.equal(ticket.ledger[0].type, 'success')
  assert.equal(ticket.ledger[0].delta, -1)
})

test('session eligibility preserves server ordering, selection and reasons', () => {
  const eligibility = normalizeCourseEligibility({
    redeemable: true,
    selected_ticket_id: 12,
    cancellation_deadline: '2026-07-30 08:00:00',
    candidates: [
      { ticketId: 12, ticketCode: 'CTK-12', ticketProductName: '十堂票', available_uses: 2, eligible_for_booking: true, eligibleForAttendance: true, redeemable_now: false, reason: 'Scenario priority 1' },
      { id: 11, available_uses: 0, redeemable: false, reason: '已有 active hold' },
    ],
  })
  assert.equal(eligibility.selectedTicketId, 12)
  assert.equal(eligibility.tickets[0].reason, 'Scenario priority 1')
  assert.equal(eligibility.tickets[0].id, 12)
  assert.equal(eligibility.tickets[0].code, 'CTK-12')
  assert.equal(eligibility.tickets[0].productName, '十堂票')
  assert.equal(eligibility.tickets[0].eligibleForBooking, true)
  assert.equal(eligibility.tickets[0].eligibleForAttendance, true)
  assert.equal(eligibility.tickets[0].redeemableNow, false)
  assert.equal(eligibility.tickets[1].redeemable, false)
  assert.equal(eligibility.cancellationDeadline, '2026-07-30 08:00:00')
})

test('course product keeps new-student add-on policy distinct from returning-only eligibility', () => {
  const product = normalizeCourseProduct({
    returning_student_only: true,
    require_addon_for_new: true,
    returning_product_ids: [3],
    required_addon_product_ids: [4],
    row_version: 8,
  })
  assert.equal(product.returningStudentOnly, true)
  assert.equal(product.requireAddonForNew, true)
  assert.deepEqual(product.returningProductIds, [3])
  assert.deepEqual(product.requiredAddonProductIds, [4])
  assert.equal(product.rowVersion, '8')
})

test('order preview supports all returning-history and forced-add-on combinations', () => {
  const primary = { shopProductId: 1, name: '主票', quantity: 1, unitPrice: 3000, lineTotal: 3000 }
  const addOn = { shopProductId: 2, name: '保險', quantity: 1, unitPrice: 200, lineTotal: 200, itemType: 'required_addon' }
  const cases = [
    { returningEligible: false, requireAddonForNew: true, items: [primary, addOn], expectedReturning: false, expectedAddOns: 1, expectedTotal: 3200 },
    { returningEligible: true, requireAddonForNew: true, items: [primary], expectedReturning: true, expectedAddOns: 0, expectedTotal: 3000 },
    { returningEligible: false, requireAddonForNew: false, items: [primary], expectedReturning: false, expectedAddOns: 0, expectedTotal: 3000 },
    { returningEligible: true, requireAddonForNew: false, items: [primary], expectedReturning: true, expectedAddOns: 0, expectedTotal: 3000 },
  ]
  for (const scenario of cases) {
    const preview = normalizeCourseOrderPreview({
      eligible: true,
      returningEligible: scenario.returningEligible,
      requireAddonForNew: scenario.requireAddonForNew,
      items: scenario.items,
      totalAmount: scenario.expectedTotal,
    })
    assert.equal(preview.eligible, true)
    assert.equal(preview.returningStudent, scenario.expectedReturning)
    assert.equal(preview.requireAddonForNew, scenario.requireAddonForNew)
    assert.equal(preview.requiredAddOns.length, scenario.expectedAddOns)
    assert.equal(preview.totalAmount, scenario.expectedTotal)
  }
})

test('order preview uses explicit server eligibility instead of returning-only inference', () => {
  const allowed = normalizeCourseOrderPreview({
    eligible: true,
    returningStudentOnly: true,
    returningEligible: false,
    items: [],
  })
  const denied = normalizeCourseOrderPreview({
    eligible: false,
    returningStudentOnly: false,
    returningEligible: true,
    reason: '伺服器拒絕此方案',
    items: [],
  })
  assert.equal(allowed.eligible, true)
  assert.equal(denied.eligible, false)
  assert.equal(denied.reason, '伺服器拒絕此方案')
})

test('course mutations carry idempotency and optimistic row version headers', () => {
  const headers = buildCourseMutationHeaders({ row_version: 9 }, { idempotencyKey: 'course-test-1' })
  assert.deepEqual(headers, {
    'Idempotency-Key': 'course-test-1',
    'If-Match': '9',
  })
})

test('course transfer DTO keeps ticket row version separate from transfer row version', () => {
  assert.equal(courseTicketRowVersion({ ticketRowVersion: 7, rowVersion: 99 }), '7')
  assert.equal(courseTicketRowVersion({ ticket_row_version: 8, row_version: 100 }), '8')
  assert.equal(courseTicketRowVersion({ ticket: { row_version: 9 }, rowVersion: 101 }), '9')
  assert.equal(courseTicketRowVersion({ rowVersion: 102 }), '')
  assert.equal(COURSE_V2_ENDPOINTS.ticketTransferPreview, '/courses/tickets/transfers/claim_code/preview')
})

test('booking mutation carries both session and selected ticket versions', () => {
  const headers = buildCourseTicketMutationHeaders(
    { rowVersion: 3 },
    { rowVersion: 8 },
    { idempotencyKey: 'course-booking-test' }
  )
  assert.deepEqual(headers, {
    'Idempotency-Key': 'course-booking-test',
    'If-Match': '3',
    'X-Ticket-If-Match': '8',
    'X-Course-Ticket-If-Match': '8',
  })
})

test('admin mutation payloads use backend canonical field names', () => {
  const ticketProduct = buildCourseTicketProductPayload({
    code: 'TEN',
    name: '十堂票',
    classCount: 10,
    activationDays: 30,
    validDays: 365,
    transferable: true,
    maxTransfers: 1,
    termsText: '條款',
    redeemOpenMinutesBefore: 90,
    redeemCloseMinutesAfter: 180,
    status: 'active',
  })
  assert.equal(ticketProduct.maxTransfers, 1)
  assert.equal(ticketProduct.termsText, '條款')
  assert.deepEqual(ticketProduct.redemptionPolicy, {
    redeemOpenMinutesBefore: 90,
    redeemCloseMinutesAfter: 180,
  })
  assert.equal('transferLimit' in ticketProduct, false)
  assert.equal('terms' in ticketProduct, false)

  const scenario = buildCourseScenarioPayload({
    name: '團練',
    redeemOpenMinutesBefore: 120,
    redeemCloseMinutesAfter: 60,
    allowedProductIds: ['7'],
    priorities: { 7: 2 },
    edgePolicies: {
      7: {
        redeemOpenMinutesBefore: 30,
        redeemCloseMinutesAfter: 15,
      },
    },
  })
  assert.equal(scenario.redeemOpenMinutesBefore, 120)
  assert.equal(scenario.redeemCloseMinutesAfter, 60)
  assert.deepEqual(scenario.allowedProducts, [{
    ticketProductId: 7,
    priority: 2,
    redeemOpenMinutesBefore: 30,
    redeemCloseMinutesAfter: 15,
  }])

  const settings = buildCourseSettingsPayload({
    bookingOpenMinutesBefore: 43200,
    bookingCloseMinutesBefore: 0,
    cancelCloseMinutesBefore: 60,
    redeemOpenMinutesBefore: 120,
    redeemCloseMinutesAfter: 1440,
    inviteExpiresMinutes: 1440,
    autoNoShow: false,
  })
  assert.equal(settings.cancelCloseMinutesBefore, 60)
  assert.equal(settings.attendanceInviteExpiresMinutes, 1440)
  assert.equal('cancelMinutesBefore' in settings, false)

  const policy = buildCourseSessionPolicyPayload({
    scenarioId: '9',
    cancelCloseMinutesBefore: 30,
    redeemOpenAt: '2026-07-30 08:00:00',
    redeemOpenMinutesBefore: 120,
    redeemCloseAt: '2026-07-30 12:00:00',
    redeemCloseMinutesAfter: 60,
  })
  assert.equal(policy.scenarioId, 9)
  assert.equal(policy.cancelCloseMinutesBefore, 30)
  assert.equal('cancelMinutesBefore' in policy, false)

  assert.deepEqual(
    buildCourseTicketAdjustmentPayload(-1, '退款補償'),
    { deltaUses: -1, reason: '退款補償' }
  )
})

test('Taiwan DATETIME is interpreted as Asia/Taipei independent of process timezone', () => {
  assert.equal(courseTaipeiTimestamp('2026-07-30 09:00:00'), Date.parse('2026-07-30T09:00:00+08:00'))
  assert.match(formatCourseTaipeiDateTime('2026-07-30 09:00:00'), /2026\/07\/30.*09:00/)
})

test('attendance capabilities normalize snake case and do not invent unavailable actions', () => {
  const capabilities = normalizeCourseCapabilities({ attend: true, no_show: true, walk_in: false })
  assert.equal(capabilities.attend, true)
  assert.equal(capabilities.noShow, true)
  assert.equal(capabilities.walkIn, false)
  assert.equal(capabilities.undo, false)
})

test('tenant course access is granted only by server capabilities', () => {
  const denied = normalizeCourseStaffAccess({ membership: { role: 'coach' }, capabilities: {} })
  assert.equal(denied.hasCourseAccess, false)
  const allowed = normalizeCourseStaffAccess({
    ownerUserId: 'provider-1',
    membership: { role: 'coach' },
    capabilities: { manageAttendance: true },
  })
  assert.equal(allowed.hasCourseAccess, true)
  assert.equal(allowed.capabilities.manageAttendance, true)
  assert.equal(allowed.capabilities.manageCatalog, false)
})

test('course V2 endpoints keep member confirm and admin attendance paths stable', () => {
  assert.equal(COURSE_V2_ENDPOINTS.bookingAction(42, 'no-show'), '/admin/courses/bookings/42/no-show')
  assert.equal(COURSE_V2_ENDPOINTS.sessionEligibility('SES-1'), '/courses/sessions/SES-1/eligibility')
  assert.equal(COURSE_V2_ENDPOINTS.staffMe, '/courses/staff/me')
})
