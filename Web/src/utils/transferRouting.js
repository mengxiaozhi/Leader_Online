const normalizeTransferCode = (value) => String(value || '').replace(/\s+/g, '').toUpperCase()

export const resolveTransferCodeType = (value) => {
  const code = normalizeTransferCode(value)
  if (code.startsWith('RSV-')) return 'reservation'
  if (code.startsWith('CTK-')) return 'course'
  if (code.startsWith('CBK-')) return 'course_booking'
  return 'ticket'
}

export const transferClaimEndpoint = (value) => {
  const type = resolveTransferCodeType(value)
  if (type === 'reservation') return '/reservations/transfers/claim_code'
  if (type === 'course') return '/courses/tickets/transfers/claim_code'
  if (type === 'course_booking') return null
  return '/tickets/transfers/claim_code'
}

export const transferClaimSuccessText = (value) => {
  const type = resolveTransferCodeType(value)
  if (type === 'reservation') return '已認領預約'
  if (type === 'course') return '已認領課程票券'
  if (type === 'course_booking') return '這是課程核銷碼，請交由課程工作人員掃描'
  return '已認領票券'
}
