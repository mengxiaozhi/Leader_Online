import test from 'node:test'
import assert from 'node:assert/strict'
import { handoverTime, handoverWindow, handoverDraft, handoverPayload, handoverReminderDraft, handoverReminderPayload, handoverReminderAt, handoverReminderLabel } from '../src/utils/handoverSchedule.js'

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

test('reminders default to 24h but preserve disabled stages and normalize day/hour/minute units', () => {
  const defaults = handoverReminderDraft(null)
  assert.deepEqual(defaults.pre_dropoff, [{ value: 24, unit: 60 }])
  const settings = { pre_dropoff: [4320, 1440, 90], pre_pickup: [], post_dropoff: [1], post_pickup: [43200] }
  assert.deepEqual(handoverReminderPayload(handoverReminderDraft(settings)), settings)
  assert.equal(handoverReminderLabel(4320), '提前 3 天')
  assert.equal(handoverReminderLabel(1440), '提前 24 小時')
})

test('invalid, duplicated and excessive reminders fail before API submission', () => {
  for (const rows of [[{ value: '', unit: 60 }], [{ value: -1, unit: 60 }], [{ value: 1.5, unit: 60 }], [{ value: 31, unit: 1440 }], [{ value: 1, unit: 7 }], [{ value: 1, unit: 1440 }, { value: 24, unit: 60 }], Array(6).fill({ value: 1, unit: 60 })]) {
    assert.throws(() => handoverReminderPayload({ ...handoverReminderDraft(null), pre_dropoff: rows }), /提醒/)
  }
})

test('reminder previews cross midnight in Taipei and use the edited start time', () => {
  assert.equal(handoverReminderAt('2026-10-03T01:00', { value: 2, unit: 60 }), '2026-10-02 23:00')
  assert.equal(handoverReminderAt('2026-10-03T01:00', { value: 3, unit: 1440 }), '2026-09-30 01:00')
  assert.equal(handoverReminderAt('2026-10-04T01:00+08:00', { value: 2, unit: 60 }), '2026-10-03 23:00')
  assert.equal(handoverReminderAt('', { value: 2, unit: 60 }), '')
  assert.equal(handoverReminderAt('2026-10-03T01:00', { value: '', unit: 60 }), '')
})
