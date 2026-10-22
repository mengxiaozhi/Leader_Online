import test from 'node:test'
import assert from 'node:assert/strict'
import { handoverTime, handoverWindow, handoverDraft, handoverPayload, handoverLocationsDraft, handoverLocationsPayload, handoverLocation, reservationHandoverLocation, reservationHandoverRoute, handoverReminderDraft, handoverReminderPayload, handoverReminderAt, handoverReminderLabel, reservationDropoffLockReason } from '../src/utils/handoverSchedule.js'

const dropoffStart = '2026-10-13T09:00:00+08:00'
const dropoffEnd = '2026-10-13T12:00:00+08:00'
const dropoffReservation = (status, window, extra = {}) => ({
  status,
  handoverSchedule: { available: true, stages: { [status]: window }, ...extra },
})

test('both dropoff stages stay locked until their own published start, including the exact boundary', () => {
  const start = new Date(dropoffStart).getTime()
  for (const status of ['pre_dropoff', 'post_dropoff']) {
    const reservation = dropoffReservation(status, { startsAt: dropoffStart, endsAt: dropoffEnd })
    assert.match(reservationDropoffLockReason(reservation, start - 1), /2026-10-13 09:00 起開放/)
    assert.equal(reservationDropoffLockReason(reservation, start), '')
    assert.equal(reservationDropoffLockReason(reservation, start + 1), '')
    assert.equal(reservationDropoffLockReason(reservation, new Date(dropoffEnd).getTime() + 1), '')
  }
})

test('missing, unavailable, incomplete, and invalid schedules lock dropoff without borrowing another stage', () => {
  assert.match(reservationDropoffLockReason({ status: 'pre_dropoff' }), /尚未公布/)
  for (const window of [null, {}, { startsAt: dropoffStart }, { startsAt: 'bad', endsAt: dropoffEnd }, { startsAt: dropoffStart, endsAt: dropoffStart }]) {
    assert.match(reservationDropoffLockReason(dropoffReservation('pre_dropoff', window)), /尚未公布/)
  }
  assert.match(reservationDropoffLockReason(dropoffReservation('pre_dropoff', { startsAt: dropoffStart, endsAt: dropoffEnd }, { available: false })), /無法載入/)
  const reservation = dropoffReservation('pre_dropoff', { startsAt: dropoffStart, endsAt: dropoffEnd })
  reservation.status = 'post_dropoff'
  assert.match(reservationDropoffLockReason(reservation), /尚未公布/)
})

test('pickup and reservation details remain accessible without dropoff times', () => {
  for (const status of ['pre_pickup', 'post_pickup', 'done', 'cancelled']) {
    assert.equal(reservationDropoffLockReason({ status }), '')
  }
})

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

const locationReservation = (extra = {}) => ({
  event: '鐵人賽', event_address: '比賽會場 A', store: '台北門市', store_address: '台北地址 B',
  handoverSchedule: { locations: { pre_pickup: '賽前取車位置 C', post_dropoff: '賽後交車位置 D' }, stages: {} },
  ...extra,
})

test('onsite locations are independent of times, the venue and each other', () => {
  const reservation = locationReservation()
  assert.equal(reservationHandoverLocation(reservation, 'pre_dropoff'), '台北門市／台北地址 B')
  assert.equal(reservationHandoverLocation(reservation, 'pre_pickup'), '賽前取車位置 C')
  assert.equal(reservationHandoverLocation(reservation, 'post_dropoff'), '賽後交車位置 D')
  assert.equal(reservationHandoverLocation(reservation, 'post_pickup'), '台北門市／台北地址 B')
  assert.equal(reservationHandoverLocation(reservation, 'pickup'), '賽前取車位置 C')
  const otherStore = locationReservation({ store: '台中門市', handoverSchedule: { locations: { pre_pickup: '位置 E', post_dropoff: '位置 F' } } })
  assert.equal(reservationHandoverLocation(otherStore, 'pre_pickup'), '位置 E')
  assert.equal(reservationHandoverLocation(reservation, 'pre_pickup'), '賽前取車位置 C')
})

test('missing, cleared and legacy onsite locations never borrow the venue, store or another stage', () => {
  for (const locations of [undefined, {}, { pre_pickup: null, post_dropoff: '另一階段' }, { pre_pickup: '  ', post_dropoff: '另一階段' }]) {
    const reservation = locationReservation({ handoverSchedule: { locations } })
    assert.equal(reservationHandoverLocation(reservation, 'pre_pickup'), '地點待公布')
  }
  assert.equal(reservationHandoverLocation(locationReservation({ handoverSchedule: null }), 'post_dropoff'), '地點待公布')
  assert.equal(handoverLocation(null, 'pre_dropoff'), '地點待公布')
  assert.equal(handoverLocation(null, 'post_pickup', ' 門市 ', ' 地址 '), '門市／地址')
})

test('transport routes use pre-pickup for outbound and post-dropoff for return', () => {
  for (const status of ['pre_dropoff', 'pre_pickup', 'pickup']) {
    const route = reservationHandoverRoute(locationReservation({ status }))
    assert.deepEqual(route, { origin: { name: '台北門市', address: '台北地址 B' }, destination: { name: '鐵人賽', address: '賽前取車位置 C' } })
  }
  for (const status of ['post_dropoff', 'post_pickup', 'done']) {
    const route = reservationHandoverRoute(locationReservation({ status }))
    assert.deepEqual(route, { origin: { name: '鐵人賽', address: '賽後交車位置 D' }, destination: { name: '台北門市', address: '台北地址 B' } })
  }
  assert.equal(reservationHandoverRoute(locationReservation({ handoverSchedule: null })).destination.address, '地點待公布')
})

test('location drafts round-trip independently of unset times and preserve explicit clearing', () => {
  assert.deepEqual(handoverLocationsDraft(null), { pre_pickup: '', post_dropoff: '' })
  const draft = handoverLocationsDraft({ locations: { pre_pickup: ' 集合位置 C ', post_dropoff: null } })
  assert.deepEqual(handoverLocationsPayload(draft), { pre_pickup: '集合位置 C', post_dropoff: null })
  assert.deepEqual(Object.values(handoverPayload(handoverDraft(null))), [null, null, null, null])
  assert.deepEqual(handoverLocationsPayload({ pre_pickup: '  ', post_dropoff: null }), { pre_pickup: null, post_dropoff: null })
})

test('location payload validates format and length before submission', () => {
  assert.equal(handoverLocationsPayload({ pre_pickup: '址'.repeat(255), post_dropoff: '' }).pre_pickup.length, 255)
  for (const value of ['址'.repeat(256), {}, 12, undefined]) {
    assert.throws(() => handoverLocationsPayload({ pre_pickup: value, post_dropoff: '' }), /地點/)
  }
})
