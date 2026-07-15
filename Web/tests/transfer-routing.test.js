import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveTransferCodeType,
  transferClaimEndpoint,
  transferClaimSuccessText,
} from '../src/utils/transferRouting.js'

test('transfer codes route reservation, course, and general tickets independently', () => {
  assert.equal(resolveTransferCodeType('RSV-123'), 'reservation')
  assert.equal(resolveTransferCodeType(' ctk-ab12 '), 'course')
  assert.equal(resolveTransferCodeType('CBK-AABBCCDDEEFF0011'), 'course_booking')
  assert.equal(resolveTransferCodeType('ABC123'), 'ticket')
  assert.equal(transferClaimEndpoint('RSV-123'), '/reservations/transfers/claim_code')
  assert.equal(transferClaimEndpoint('CTK-AB12'), '/courses/tickets/transfers/claim_code')
  assert.equal(transferClaimEndpoint('CBK-AABBCCDDEEFF0011'), null)
  assert.equal(transferClaimEndpoint('ABC123'), '/tickets/transfers/claim_code')
})

test('transfer claim messages match the routed record type', () => {
  assert.equal(transferClaimSuccessText('RSV-123'), '已認領預約')
  assert.equal(transferClaimSuccessText('CTK-AB12'), '已認領課程票券')
  assert.equal(transferClaimSuccessText('CBK-AABBCCDDEEFF0011'), '這是課程核銷碼，請交由課程工作人員掃描')
  assert.equal(transferClaimSuccessText('ABC123'), '已認領票券')
})
