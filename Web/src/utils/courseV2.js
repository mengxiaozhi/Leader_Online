const COURSE_TIME_ZONE = 'Asia/Taipei'

const asNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const asArray = value => Array.isArray(value) ? value : []

const firstDefined = (...values) => values.find(value => value !== undefined && value !== null)
const optionalNumber = value => value === '' || value === undefined || value === null
  ? null
  : asNumber(value)

export const COURSE_V2_ENDPOINTS = Object.freeze({
  productPreview: productId => `/courses/products/${encodeURIComponent(productId)}/preview`,
  sessionEligibility: sessionId => `/courses/sessions/${encodeURIComponent(sessionId)}/eligibility`,
  adminSessionEligibility: sessionId => `/admin/courses/sessions/${encodeURIComponent(sessionId)}/eligibility`,
  staffMe: '/courses/staff/me',
  attendanceInvitePreview: '/courses/attendance-invites/preview',
  ticketTransferPreview: '/courses/tickets/transfers/claim_code/preview',
  partialTransfers: '/courses/tickets/transfers',
  partialTransferPreview: ticketId => `/courses/tickets/${encodeURIComponent(ticketId)}/transfers/preview`,
  partialTransferInitiate: ticketId => `/courses/tickets/${encodeURIComponent(ticketId)}/transfers`,
  partialTransferAction: (transferId, action) => `/courses/tickets/transfers/${encodeURIComponent(transferId)}/${action}`,
  ticketLedger: ticketId => `/courses/tickets/${encodeURIComponent(ticketId)}/ledger`,
  ticketProducts: '/admin/courses/ticket-products',
  scenarios: '/admin/courses/scenarios',
  settings: '/admin/courses/settings',
  staffMemberships: '/admin/courses/staff-memberships',
  coachProfiles: '/admin/courses/coach-profiles',
  attendanceInvites: '/admin/courses/attendance-invites',
  reports: '/admin/courses/reports',
  reportStudents: '/admin/courses/reports/students',
  reportAnomalies: '/admin/courses/reports/anomalies',
  bookingAction: (bookingId, action) => `/admin/courses/bookings/${encodeURIComponent(bookingId)}/${action}`,
  walkIns: sessionId => `/admin/courses/sessions/${encodeURIComponent(sessionId)}/walk-ins`,
  sessionInvites: sessionId => `/admin/courses/sessions/${encodeURIComponent(sessionId)}/attendance-invites`,
})

export function toCourseTaipeiDate(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  if (typeof value === 'number') {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
  }
  const text = String(value || '').trim()
  if (!text) return null
  const taipeiDateTime = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/)
  if (taipeiDateTime) {
    const seconds = taipeiDateTime[3] || '00'
    const milliseconds = taipeiDateTime[4] ? `.${taipeiDateTime[4].padEnd(3, '0')}` : ''
    const date = new Date(`${taipeiDateTime[1]}T${taipeiDateTime[2]}:${seconds}${milliseconds}+08:00`)
    return Number.isFinite(date.getTime()) ? date : null
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00+08:00`)
    return Number.isFinite(date.getTime()) ? date : null
  }
  const date = new Date(text)
  return Number.isFinite(date.getTime()) ? date : null
}

export function courseTaipeiTimestamp(value) {
  return toCourseTaipeiDate(value)?.getTime() ?? Number.NaN
}

export function unwrapCoursePayload(response, legacyKey = '') {
  const root = response?.data ?? response ?? {}
  const payload = root?.data ?? root
  if (legacyKey && payload && !Array.isArray(payload) && payload[legacyKey] !== undefined) {
    return payload[legacyKey]
  }
  return payload
}

export function createCourseIdempotencyKey(prefix = 'course') {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 128)
}

export function courseRowVersion(record = {}) {
  const value = firstDefined(record.rowVersion, record.row_version, record.version, record.lockVersion)
  if (value === undefined) return ''
  return String(value).trim()
}

export function courseTicketRowVersion(record = {}) {
  const value = firstDefined(
    record.ticketRowVersion,
    record.ticket_row_version,
    record.ticket?.rowVersion,
    record.ticket?.row_version
  )
  if (value === undefined) return ''
  return String(value).trim()
}

export function normalizeCoursePartialTransfer(source = {}) {
  const sourceTicket = source.sourceTicket || source.source_ticket || {}
  const childTicket = source.childTicket || source.child_ticket || null
  const counterparty = source.counterparty || {}
  const provider = source.provider || {}
  return {
    ...source,
    id: asNumber(firstDefined(source.id, source.transferId, source.transfer_id)),
    rowVersion: courseRowVersion(source),
    transferMode: String(firstDefined(source.transferMode, source.transfer_mode, 'PARTIAL')).toUpperCase(),
    direction: String(source.direction || '').toLowerCase(),
    quantity: asNumber(source.quantity),
    status: String(source.status || '').toLowerCase(),
    expiresAt: firstDefined(source.expiresAt, source.expires_at, null),
    createdAt: firstDefined(source.createdAt, source.created_at, null),
    provider: {
      userId: firstDefined(provider.userId, provider.user_id, null),
      displayName: String(firstDefined(provider.displayName, provider.display_name, '') || ''),
      isPlatform: Boolean(firstDefined(provider.isPlatform, provider.is_platform, false)),
    },
    counterparty: {
      userId: firstDefined(counterparty.userId, counterparty.user_id, null),
      displayName: String(firstDefined(counterparty.displayName, counterparty.display_name, '') || ''),
      email: firstDefined(counterparty.email, null),
    },
    sourceTicket: {
      id: asNumber(firstDefined(sourceTicket.id, sourceTicket.ticketId, sourceTicket.ticket_id)),
      code: String(sourceTicket.code || ''),
      productName: String(firstDefined(sourceTicket.productName, sourceTicket.product_name, '') || ''),
      rowVersion: courseRowVersion(sourceTicket),
    },
    childTicket: childTicket ? {
      id: asNumber(firstDefined(childTicket.id, childTicket.ticketId, childTicket.ticket_id)),
      code: String(childTicket.code || ''),
      productName: String(firstDefined(childTicket.productName, childTicket.product_name, '') || ''),
      rowVersion: courseRowVersion(childTicket),
    } : null,
    capabilities: {
      accept: Boolean(source.capabilities?.accept),
      decline: Boolean(source.capabilities?.decline),
      cancel: Boolean(source.capabilities?.cancel),
    },
  }
}

export function buildCourseMutationHeaders(record = {}, options = {}) {
  const headers = {
    'Idempotency-Key': String(
      options.idempotencyKey || createCourseIdempotencyKey(options.prefix || 'course-mutation')
    ),
  }
  const version = firstDefined(options.rowVersion, courseRowVersion(record))
  if (version !== undefined && String(version).trim()) headers['If-Match'] = String(version).trim()
  return headers
}

export function buildCourseTicketMutationHeaders(record = {}, ticket = {}, options = {}) {
  const headers = buildCourseMutationHeaders(record, options)
  const ticketVersion = String(firstDefined(
    options.ticketRowVersion,
    courseRowVersion(ticket)
  ) || '').trim()
  if (ticketVersion) {
    headers['X-Ticket-If-Match'] = ticketVersion
    headers['X-Course-Ticket-If-Match'] = ticketVersion
  }
  return headers
}

export function normalizeCourseProduct(source = {}) {
  const normalizeIds = value => asArray(value)
    .map(item => firstDefined(
      item?.productId,
      item?.product_id,
      item?.shopProductId,
      item?.shop_product_id,
      item?.id,
      item
    ))
    .filter(value => value !== undefined && value !== null && String(value).trim())
  return {
    ...source,
    ticketProductId: firstDefined(source.ticketProductId, source.ticket_product_id, null),
    returningStudentOnly: Boolean(firstDefined(
      source.returningStudentOnly,
      source.returning_student_only,
      false
    )),
    requireAddonForNew: Boolean(firstDefined(
      source.requireAddonForNew,
      source.require_addon_for_new,
      false
    )),
    returningProductIds: normalizeIds(firstDefined(
      source.returningProductIds,
      source.returning_product_ids,
      source.returningProducts,
      source.returning_products,
      []
    )),
    requiredAddonProductIds: normalizeIds(firstDefined(
      source.requiredAddonProductIds,
      source.required_addon_product_ids,
      source.requiredAddOns,
      source.required_add_ons,
      []
    )),
    rowVersion: courseRowVersion(source),
  }
}

export function buildCourseTicketProductPayload(source = {}) {
  const currentPolicy = source.redemptionPolicy || source.redemption_policy || {}
  const usageMode = String(firstDefined(
    source.usageMode,
    source.usage_mode,
    'finite'
  )).trim().toLowerCase() === 'unlimited' ? 'unlimited' : 'finite'
  return {
    code: String(source.code || '').trim(),
    name: String(source.name || '').trim(),
    description: String(source.description || ''),
    productType: String(firstDefined(source.productType, source.product_type, 'count_pass')),
    usageMode,
    classCount: asNumber(source.classCount, 1),
    activationDays: asNumber(source.activationDays, 0),
    validDays: asNumber(source.validDays, 1),
    transferable: Boolean(source.transferable),
    maxTransfers: asNumber(source.maxTransfers, 0),
    maxTransferOperations: asNumber(firstDefined(
      source.maxTransferOperations,
      source.max_transfer_operations,
      source.maxTransfers,
      1
    ), 1),
    pauseMaxOperations: asNumber(firstDefined(
      source.pauseMaxOperations,
      source.pause_max_operations,
      1
    ), 1),
    pauseMaxDays: asNumber(firstDefined(
      source.pauseMaxDays,
      source.pause_max_days,
      365
    ), 365),
    termsText: String(source.termsText || ''),
    redemptionPolicy: {
      ...currentPolicy,
      redeemOpenMinutesBefore: optionalNumber(firstDefined(
        source.redeemOpenMinutesBefore,
        source.redeem_open_minutes_before,
        currentPolicy.redeemOpenMinutesBefore,
        currentPolicy.redeem_open_minutes_before
      )),
      redeemCloseMinutesAfter: optionalNumber(firstDefined(
        source.redeemCloseMinutesAfter,
        source.redeem_close_minutes_after,
        currentPolicy.redeemCloseMinutesAfter,
        currentPolicy.redeem_close_minutes_after
      )),
    },
    status: String(source.status || 'draft'),
  }
}

export function buildCourseScenarioPayload(source = {}) {
  return {
    ...source,
    redeemOpenMinutesBefore: optionalNumber(source.redeemOpenMinutesBefore),
    redeemCloseMinutesAfter: optionalNumber(source.redeemCloseMinutesAfter),
    allowedProducts: asArray(source.allowedProductIds).map(ticketProductId => ({
      ticketProductId: asNumber(ticketProductId),
      priority: asNumber(source.priorities?.[ticketProductId], 1),
      redeemOpenMinutesBefore: optionalNumber(
        source.edgePolicies?.[ticketProductId]?.redeemOpenMinutesBefore
      ),
      redeemCloseMinutesAfter: optionalNumber(
        source.edgePolicies?.[ticketProductId]?.redeemCloseMinutesAfter
      ),
    })),
  }
}

export function buildCourseSettingsPayload(source = {}) {
  return {
    timezone: String(firstDefined(source.timezone, 'Asia/Taipei')),
    bookingOpenMinutesBefore: asNumber(source.bookingOpenMinutesBefore),
    bookingCloseMinutesBefore: asNumber(source.bookingCloseMinutesBefore),
    cancelCloseMinutesBefore: asNumber(source.cancelCloseMinutesBefore),
    redeemOpenMinutesBefore: asNumber(source.redeemOpenMinutesBefore),
    redeemCloseMinutesAfter: asNumber(source.redeemCloseMinutesAfter),
    attendanceInviteExpiresMinutes: asNumber(firstDefined(
      source.attendanceInviteExpiresMinutes,
      source.inviteExpiresMinutes
    )),
    attendanceInviteExpiryAction: String(firstDefined(
      source.attendanceInviteExpiryAction,
      source.attendance_invite_expiry_action,
      'release'
    )),
    autoNoShow: Boolean(source.autoNoShow),
    bankTransferHoldHours: asNumber(firstDefined(source.bankTransferHoldHours, 24), 24),
    pauseMaxOperations: asNumber(firstDefined(source.pauseMaxOperations, 1), 1),
    pauseMaxDays: asNumber(firstDefined(source.pauseMaxDays, 365), 365),
    pushPlanMaxAvailableUses: asNumber(firstDefined(source.pushPlanMaxAvailableUses, 3), 3),
    expiringTicketDays: asNumber(firstDefined(source.expiringTicketDays, 30), 30),
    dormantStudentDays: asNumber(firstDefined(source.dormantStudentDays, 90), 90),
    countCardParityEnabled: Boolean(source.countCardParityEnabled),
    fixedTermEnabled: Boolean(source.fixedTermEnabled),
    advancedPaymentsEnabled: Boolean(source.advancedPaymentsEnabled),
  }
}

export function buildCourseSessionPolicyPayload(source = {}) {
  return {
    scenarioId: source.scenarioId ? asNumber(source.scenarioId) : null,
    cancelCloseMinutesBefore: source.cancelCloseMinutesBefore === ''
      ? null
      : asNumber(source.cancelCloseMinutesBefore),
    redeemOpenAt: source.redeemOpenAt || null,
    redeemOpenMinutesBefore: source.redeemOpenMinutesBefore === ''
      ? null
      : asNumber(source.redeemOpenMinutesBefore),
    redeemCloseAt: source.redeemCloseAt || null,
    redeemCloseMinutesAfter: source.redeemCloseMinutesAfter === ''
      ? null
      : asNumber(source.redeemCloseMinutesAfter),
  }
}

export function buildCourseTicketAdjustmentPayload(deltaUses, reason = '') {
  return {
    deltaUses: asNumber(deltaUses),
    reason: String(reason || '').trim(),
  }
}

export function isCourseVersionConflict(error) {
  return [409, 412].includes(Number(error?.response?.status || 0))
}

export function normalizeCourseTicket(source = {}) {
  const usageMode = String(firstDefined(
    source.usageMode,
    source.usage_mode,
    source.usageModeSnapshot,
    source.usage_mode_snapshot,
    'finite'
  ) || 'finite').trim().toLowerCase() === 'unlimited' ? 'unlimited' : 'finite'
  const unlimited = usageMode === 'unlimited' || Boolean(firstDefined(
    source.unlimited,
    source.isUnlimited,
    source.is_unlimited,
    false
  ))
  const remainingUses = Math.max(0, asNumber(firstDefined(
    source.remainingUses,
    source.remaining_uses,
    source.balance?.remainingUses,
    source.balance?.remaining
  )))
  const heldUses = Math.max(0, asNumber(firstDefined(
    source.heldUses,
    source.held_uses,
    source.activeHoldUses,
    source.active_hold_uses,
    source.balance?.heldUses,
    source.balance?.held
  )))
  const availableUses = unlimited ? null : Math.max(0, asNumber(firstDefined(
    source.availableUses,
    source.available_uses,
    source.balance?.availableUses,
    source.balance?.available
  ), remainingUses - heldUses))
  const totalUses = unlimited ? null : Math.max(0, asNumber(firstDefined(
    source.totalUses,
    source.total_uses,
    source.issuedUses,
    source.issued_uses,
    source.ticketProduct?.classCount
  )))
  const ledger = asArray(firstDefined(source.ledger, source.usageEvents, source.usage_events))
    .map(normalizeCourseUsageEvent)
  return {
    ...source,
    id: firstDefined(source.id, source.ticketId, source.ticket_id),
    code: String(firstDefined(source.code, source.ticketCode, source.ticket_code, '') || ''),
    productName: String(firstDefined(
      source.productName,
      source.product_name,
      source.ticketProductName,
      source.ticket_product_name,
      source.ticketProduct?.name,
      ''
    ) || ''),
    usageMode,
    unlimited,
    remainingUses,
    heldUses,
    availableUses,
    totalUses,
    ledger,
    rowVersion: courseRowVersion(source),
  }
}

export function normalizeCourseUsageEvent(source = {}) {
  const delta = asNumber(firstDefined(
    source.delta,
    source.deltaUses,
    source.delta_uses,
    source.unitsDelta,
    source.units_delta
  ))
  return {
    ...source,
    id: firstDefined(source.id, source.eventId, source.event_id),
    type: String(firstDefined(source.type, source.eventType, source.event_type, 'adjustment')).toLowerCase(),
    delta,
    balanceAfter: firstDefined(source.balanceAfter, source.balance_after),
    occurredAt: firstDefined(source.occurredAt, source.occurred_at, source.createdAt, source.created_at),
    note: String(firstDefined(source.note, source.reason, source.description, '') || ''),
  }
}

export function normalizeCourseEligibility(source = {}) {
  const payload = source?.eligibility || source || {}
  const candidates = asArray(firstDefined(
    payload.tickets,
    payload.candidates,
    payload.eligibleTickets,
    payload.eligible_tickets
  )).map(candidate => {
    const ticket = normalizeCourseTicket(candidate.ticket || candidate)
    const eligibleForBooking = Boolean(firstDefined(
      candidate.eligibleForBooking,
      candidate.eligible_for_booking,
      candidate.bookable,
      candidate.eligible,
      candidate.applicable,
      candidate.redeemable,
      false
    ))
    const redeemableNow = Boolean(firstDefined(
      candidate.redeemableNow,
      candidate.redeemable_now,
      candidate.redeemable,
      false
    ))
    const explicitAttendanceEligibility = firstDefined(
      candidate.eligibleForAttendance,
      candidate.eligible_for_attendance,
      candidate.holdEligible,
      candidate.hold_eligible
    )
    const eligibleForAttendance = explicitAttendanceEligibility === undefined
      ? Boolean(firstDefined(candidate.applicable, candidate.eligible, false))
        && (ticket.unlimited || ticket.availableUses > 0)
      : Boolean(explicitAttendanceEligibility)
    return {
      ...ticket,
      eligible: eligibleForBooking,
      eligibleForBooking,
      eligibleForAttendance,
      redeemable: redeemableNow,
      redeemableNow,
      selected: Boolean(firstDefined(candidate.selected, candidate.autoSelected, candidate.auto_selected, false)),
      reason: String(firstDefined(
        candidate.reason,
        candidate.bookingReason,
        candidate.booking_reason,
        candidate.reasonLabel,
        candidate.reason_label,
        Array.isArray(candidate.reasons) ? candidate.reasons.join('、') : undefined,
        eligibleForBooking ? '伺服器判定可預約' : '此票券目前不符合預約規則'
      )),
      redeemableReason: String(firstDefined(
        candidate.redeemableReason,
        candidate.redeemable_reason,
        redeemableNow ? '目前可核銷' : ''
      )),
      priority: asNumber(firstDefined(candidate.priority, candidate.scenarioPriority, candidate.scenario_priority), 999999),
    }
  })
  const selectedTicketId = firstDefined(
    payload.selectedTicketId,
    payload.selected_ticket_id,
    payload.recommendedTicketId,
    payload.recommended_ticket_id,
    candidates.find(candidate => candidate.selected)?.id
  )
  return {
    redeemable: Boolean(firstDefined(
      payload.redeemableNow,
      payload.redeemable_now,
      payload.redeemable,
      candidates.some(candidate => candidate.redeemableNow),
      false
    )),
    eligibleForBooking: Boolean(firstDefined(
      payload.eligibleForBooking,
      payload.eligible_for_booking,
      payload.bookable,
      payload.eligible,
      candidates.some(candidate => candidate.eligibleForBooking),
      false
    )),
    reason: String(firstDefined(
      payload.reason,
      payload.reasonLabel,
      payload.reason_label,
      candidates.length ? '' : '目前沒有可用票券'
    )),
    selectedTicketId: selectedTicketId == null ? null : Number(selectedTicketId),
    cancellationDeadline: firstDefined(
      payload.cancellationDeadline,
      payload.cancellation_deadline,
      payload.cancelBefore,
      payload.cancel_before
    ),
    policy: payload.policy || payload.resolvedPolicy || payload.resolved_policy || {},
    session: payload.session || {},
    redeemQuantity: Math.max(1, asNumber(firstDefined(
      payload.redeemQuantity,
      payload.redeem_quantity,
      payload.session?.redeemQuantity,
      payload.session?.redeem_quantity,
      candidates[0]?.redeemQuantity,
      candidates[0]?.redeem_quantity,
      1
    ), 1)),
    tickets: candidates,
  }
}

export function normalizeCourseOrderPreview(source = {}, fallbackProduct = {}) {
  const payload = source?.preview || source || {}
  const returningEligible = firstDefined(
    payload.returningEligible,
    payload.returning_eligible,
    payload.qualifiesAsReturning,
    payload.qualifies_as_returning
  )
  const returningStudent = Boolean(firstDefined(
    payload.returningStudent,
    payload.returning_student,
    payload.isReturningStudent,
    payload.is_returning_student,
    returningEligible,
    false
  ))
  const requireAddonForNew = Boolean(firstDefined(
    payload.requireAddonForNew,
    payload.require_addon_for_new,
    fallbackProduct.requireAddonForNew,
    fallbackProduct.require_addon_for_new,
    false
  ))
  const primaryItem = payload.primaryItem || payload.primary_item || {
    productId: fallbackProduct.id,
    name: fallbackProduct.name,
    quantity: payload.quantity || 1,
    unitPrice: fallbackProduct.price,
  }
  const addOns = asArray(firstDefined(
    payload.requiredAddOns,
    payload.required_add_ons,
    payload.addOns,
    payload.add_ons
  ))
  const items = asArray(payload.items).length
    ? payload.items
    : [primaryItem, ...addOns].filter(item => item && (item.productId || item.id || item.name))
  const normalizedItems = items.map(item => {
    const quantity = Math.max(1, asNumber(item.quantity, 1))
    const unitPrice = Math.max(0, asNumber(firstDefined(item.unitPrice, item.unit_price, item.price)))
    return {
      ...item,
      productId: firstDefined(item.productId, item.product_id, item.shopProductId, item.shop_product_id, item.id),
      ticketProductId: firstDefined(item.ticketProductId, item.ticket_product_id),
      name: String(firstDefined(item.name, item.productName, item.product_name, '課程商品')),
      quantity,
      unitPrice,
      subtotal: Math.max(0, asNumber(firstDefined(item.subtotal, item.lineTotal, item.line_total), quantity * unitPrice)),
      required: Boolean(firstDefined(
        item.required,
        item.isRequired,
        item.is_required,
        ['required_addon', 'required_add_on'].includes(String(firstDefined(item.kind, item.itemType, item.item_type, '')).toLowerCase()),
        false
      )),
      kind: String(firstDefined(item.kind, item.itemType, item.item_type, 'primary')),
    }
  })
  const returningStudentOnly = Boolean(firstDefined(
    payload.returningStudentOnly,
    payload.returning_student_only,
    false
  ))
  const eligible = firstDefined(
    payload.eligible,
    payload.purchasable,
    payload.canPurchase,
    payload.can_purchase,
    true
  )
  return {
    eligible: Boolean(eligible),
    reason: String(firstDefined(payload.reason, payload.message, '')),
    returningStudent,
    returningEligible,
    returningStudentOnly,
    requireAddonForNew,
    returningStudentLabel: String(firstDefined(
      payload.returningStudentLabel,
      payload.returning_student_label,
      returningStudent
        ? (requireAddonForNew ? '符合舊生資格・免強制加購' : '符合舊生資格')
        : (requireAddonForNew ? '非舊生・含強制加購' : '一般購買資格')
    )),
    items: normalizedItems,
    requiredAddOns: normalizedItems.filter(item => (
      item.required
      || ['required_addon', 'required_add_on'].includes(String(item.kind).toLowerCase())
    )),
    totalAmount: Math.max(0, asNumber(
      firstDefined(payload.totalAmount, payload.total_amount),
      normalizedItems.reduce((total, item) => total + item.subtotal, 0)
    )),
    version: courseRowVersion(payload),
  }
}

export function normalizeCourseStaffAccess(source = {}, options = {}) {
  const payload = source?.data?.data ?? source?.data ?? source ?? {}
  const platformRole = typeof options === 'string' ? options : options?.platformRole
  const normalizedPlatformRole = String(platformRole || '').trim().toUpperCase()
  const legacyManager = payload.enabled === false
    && ['ADMIN', 'SERVICE_PROVIDER', 'STORE'].includes(normalizedPlatformRole)
  const capabilities = payload.capabilities && typeof payload.capabilities === 'object'
    ? payload.capabilities
    : {}
  const read = (camel, snake) => Boolean(firstDefined(
    capabilities[camel],
    capabilities[snake],
    payload[camel],
    payload[snake],
    false
  ))
  const normalized = {
    manageCatalog: legacyManager || read('manageCatalog', 'manage_catalog'),
    manageSettings: read('manageSettings', 'manage_settings'),
    manageStaff: read('manageStaff', 'manage_staff'),
    manageAttendance: legacyManager || read('manageAttendance', 'manage_attendance'),
    viewReports: read('viewReports', 'view_reports'),
  }
  return {
    ...payload,
    ownerUserId: firstDefined(payload.ownerUserId, payload.owner_user_id, null),
    membershipRole: String(firstDefined(
      payload.membershipRole,
      payload.membership_role,
      payload.membership?.role,
      ''
    ) || '').toLowerCase(),
    capabilities: normalized,
    hasCourseAccess: Object.values(normalized).some(Boolean),
  }
}

export function classifyCourseStaffAccessError(error) {
  const status = Number(error?.response?.status || 0)
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  return 'unavailable'
}

export function normalizeCourseCapabilities(source = {}) {
  const payload = source?.capabilities || source || {}
  const values = Array.isArray(payload)
    ? payload
    : Object.entries(payload).filter(([, enabled]) => Boolean(enabled)).map(([key]) => key)
  const normalized = new Set(values.map(value => String(value).trim().toLowerCase().replace(/_/g, '-')))
  const has = (...keys) => keys.some(key => normalized.has(String(key).toLowerCase().replace(/_/g, '-')))
  return {
    raw: [...normalized],
    attend: has('attend', 'success', 'redeem'),
    undo: has('undo', 'undo-attend', 'reverse'),
    excusedLeave: has('excused-leave', 'leave', 'cancel'),
    noShow: has('no-show', 'noshow'),
    makeupRedeem: has('makeup-redeem', 'makeup'),
    walkIn: has('walk-in', 'walkin'),
    attendanceInvite: has('attendance-invite', 'invite'),
  }
}

export function courseActionDefinition(action) {
  return ({
    attend: { endpoint: 'attend', label: '確認出席', tone: 'primary' },
    undo: { endpoint: 'undo', label: '撤銷核銷', tone: 'outline' },
    excusedLeave: { endpoint: 'excused-leave', label: '臨時請假', tone: 'outline' },
    noShow: { endpoint: 'no-show', label: '標記未到（NO SHOW）', tone: 'outline' },
    makeupRedeem: { endpoint: 'makeup-redeem', label: '事後補登', tone: 'primary' },
  })[action] || null
}

export function courseActionReason(source = {}) {
  return String(firstDefined(
    source.redeemableReason,
    source.redeemable_reason,
    source.reason,
    source.capabilityReason,
    source.capability_reason,
    ''
  ))
}

export function formatCourseTaipeiDateTime(value, options = {}) {
  if (!value) return ''
  const date = toCourseTaipeiDate(value)
  if (!date) return ''
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: COURSE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...options,
  }).format(date)
}

export function formatCourseTaipeiDate(value) {
  if (!value) return ''
  const date = toCourseTaipeiDate(value)
  if (!date) return ''
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: COURSE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function formatCourseDelta(delta) {
  const value = asNumber(delta)
  return `${value > 0 ? '+' : ''}${value} 堂`
}

export { COURSE_TIME_ZONE }
