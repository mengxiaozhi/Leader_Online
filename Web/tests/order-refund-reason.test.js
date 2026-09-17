import test from 'node:test'
import assert from 'node:assert/strict'
import { ORDER_REFUND_REASONS, sheetState, sheetResolve, sheetReject, closeSheet, showOrderRefundReason, showPrompt } from '../src/utils/sheet.js'

test('each refund reason works without a handwritten explanation, including other', async () => {
  for (const reason of ORDER_REFUND_REASONS) {
    const pending = showOrderRefundReason()
    sheetState.selectedReason = reason
    sheetResolve()
    assert.equal(await pending, reason)
    assert.equal(sheetState.open, false)
  }
})

test('refund reason includes optional notes and stays within the audit field length', async () => {
  const pending = showOrderRefundReason(3)
  assert.match(sheetState.message, /3 筆訂單/)
  sheetState.selectedReason = '其他'
  sheetState.input = '  客戶更改行程  '
  sheetResolve()
  assert.equal(await pending, '其他：客戶更改行程')

  const longNote = showOrderRefundReason()
  sheetState.selectedReason = ORDER_REFUND_REASONS[0]
  sheetState.input = '字'.repeat(600)
  sheetResolve()
  assert.ok((await longNote).length <= 500)
})

test('refund reason needs a dropdown selection even when a note is entered', async () => {
  const pending = showOrderRefundReason()
  const cancelled = assert.rejects(pending, /CANCELLED/)
  sheetState.input = '補充說明'
  sheetResolve()
  assert.equal(sheetState.open, true)
  sheetState.selectedReason = 'invalid'
  sheetResolve()
  assert.equal(sheetState.open, true)
  sheetReject()
  await cancelled
})

test('closing the refund form cancels and clears the previous reason and note', async () => {
  const pending = showOrderRefundReason()
  const cancelled = assert.rejects(pending, /CANCELLED/)
  sheetState.selectedReason = '其他'
  sheetState.input = '先前原因'
  closeSheet()
  await cancelled
  const next = showOrderRefundReason()
  const nextCancelled = assert.rejects(next, /CANCELLED/)
  assert.equal(sheetState.selectedReason, '')
  assert.equal(sheetState.input, '')
  closeSheet()
  await nextCancelled
})

test('regular prompt and password values keep their existing behavior', async () => {
  const prompt = showPrompt('原因')
  sheetState.input = '  原因  '
  sheetResolve()
  assert.equal(await prompt, '原因')
  const password = showPrompt('密碼', { inputType: 'password' })
  sheetState.input = '  password  '
  sheetResolve()
  assert.equal(await password, '  password  ')
})
