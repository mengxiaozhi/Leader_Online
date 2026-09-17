import test from 'node:test'
import assert from 'node:assert/strict'
import { handoverTime, handoverWindow, handoverDraft, handoverPayload } from '../src/utils/handoverSchedule.js'

test('handover dates stay in Taipei regardless of browser timezone', () => {
  assert.equal(handoverTime('2026-10-01T12:00:00Z'), '2026-10-01T20:00')
  assert.equal(handoverTime('2026-10-01T16:00:00Z'), '2026-10-02T00:00')
  assert.equal(handoverTime('bad'), '')
})
test('unpublished stages have no invented times', () => {
  assert.equal(handoverWindow(null), '時間待公布')
  const draft = handoverDraft(null)
  assert.deepEqual(Object.values(handoverPayload(draft)), [null, null, null, null])
})
test('complete cross-midnight windows submit with explicit timezone', () => {
  const draft = handoverDraft(null)
  draft.pre_dropoff = { startsAt: '2026-10-01T20:00', endsAt: '2026-10-02T09:00' }
  assert.equal(handoverPayload(draft).pre_dropoff.startsAt, '2026-10-01T20:00+08:00')
})
test('partial and reversed windows are rejected before sending', () => {
  const draft = handoverDraft(null)
  draft.pre_pickup.startsAt = '2026-10-01T09:00'
  assert.throws(() => handoverPayload(draft), /完整/)
  draft.pre_pickup.endsAt = '2026-10-01T08:00'
  assert.throws(() => handoverPayload(draft), /必須晚於/)
})
