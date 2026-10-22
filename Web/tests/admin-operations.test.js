import test from 'node:test'
import assert from 'node:assert/strict'
import { groupRecentReservationStores, readSummaryCount } from '../src/utils/adminOperations.js'

test('unavailable statistics are not reported as zero or inferred from a partial page', () => {
  assert.equal(readSummaryCount(null), null)
  assert.equal(readSummaryCount({ total: null }), null)
  assert.equal(readSummaryCount({ total: 120, byStatus: { done: 0 } }, 'done'), 0)
  assert.equal(readSummaryCount({ total: 120 }, 'pre_dropoff'), null)
  assert.equal(readSummaryCount({ total: '120' }), 120)
  assert.equal(readSummaryCount({ done: '8' }, 'done'), 8)
  assert.equal(readSummaryCount({ total: -1 }), null)
  for (const total of [false, {}, [], '  ', 0.5]) assert.equal(readSummaryCount({ total }), null)
})

test('recent store counts deduplicate reservations and keep cancellation separate from completion', () => {
  const records = [
    { id: 1, store: '甲', status: 'pre_dropoff' },
    { id: '1', store: '甲', status: 'pre_dropoff' },
    { id: 2, store: '甲', status: 'post_pickup' },
    { id: 3, store: '甲', status: 'cancelled' },
    { id: 4, store: '甲', status: 'done' },
    { id: 5, store: null, status: 'service_booking' },
  ]
  const result = groupRecentReservationStores(records)
  assert.deepEqual(result, [
    { name: '甲', total: 4, dropoff: 1, pickup: 1, done: 1, other: 1 },
    { name: '交車點待確認', total: 1, dropoff: 0, pickup: 0, done: 0, other: 1 },
  ])
  assert.equal(records.length, 6)
})
