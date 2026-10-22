import test from 'node:test'
import assert from 'node:assert/strict'
import { handoverTimelineProgress, handoverTimelineWindow } from '../src/utils/handoverTimeline.js'

test('handover progress follows the next pending stage, not a completed checklist', () => {
  const pickup = handoverTimelineProgress('pre_pickup')
  assert.equal(pickup.summary, '下一步：賽前取車')
  assert.deepEqual(pickup.steps.map(step => step.state), ['complete', 'current', 'upcoming', 'upcoming'])
  assert.equal(pickup.steps[1].stateLabel, '目前待執行')
  assert.deepEqual(handoverTimelineProgress('post_pickup').steps.map(step => step.state), ['complete', 'complete', 'complete', 'current'])
})

test('legacy statuses retain their pending handover and preview never invents progress', () => {
  for (const status of [null, '', 'pending', 'service_booking', 'pre_dropoff']) {
    assert.equal(handoverTimelineProgress(status).steps[0].state, 'current')
  }
  assert.deepEqual(handoverTimelineProgress('pickup'), handoverTimelineProgress('pre_pickup'))
  for (const status of [null, 'pre_pickup', 'done']) {
    const preview = handoverTimelineProgress(status, 'preview')
    assert.equal(preview.summary, '')
    assert.ok(preview.steps.every(step => step.state === 'planned' && !step.stateLabel))
  }
})

test('cancelled and unknown reservations have no inferred completed or current steps', () => {
  assert.ok(handoverTimelineProgress('done').steps.every(step => step.state === 'complete'))
  assert.ok(handoverTimelineProgress('cancelled').steps.every(step => step.state === 'cancelled'))
  const unknown = handoverTimelineProgress('unrecognized')
  assert.equal(unknown.summary, '進度待確認')
  assert.ok(unknown.steps.every(step => step.state === 'unknown'))
})

test('planned times use Taipei dates and preserve cross-day ranges', () => {
  assert.equal(handoverTimelineWindow({ startsAt: '2026-10-22T01:00:00Z', endsAt: '2026-10-22T10:00:00Z' }), '2026/10/22 09:00 ～ 18:00')
  assert.equal(handoverTimelineWindow({ startsAt: '2026-10-22T15:00:00Z', endsAt: '2026-10-22T17:00:00Z' }), '2026/10/22 23:00 ～ 2026/10/23 01:00')
  for (const window of [null, {}, { startsAt: 'bad', endsAt: 'bad' }, { startsAt: '2026-10-22' }, { startsAt: '2026-10-22', endsAt: '2026-10-21' }]) {
    assert.equal(handoverTimelineWindow(window), '時間待公布')
  }
})
