import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../src/pages/wallet.vue', import.meta.url), 'utf8')
const start = source.indexOf('const canTransferReservation =')
const end = source.indexOf('const startReservationTransferEmail =', start)
assert.ok(start >= 0 && end > start)
const canTransferReservation = runInNewContext(`${source.slice(start, end)}\ncanTransferReservation`)

test('wallet transfer controls follow backend eligibility in every reservation status', () => {
  for (const status of ['', 'pending', 'service_booking', 'pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup', 'done', 'cancelled']) {
    assert.equal(canTransferReservation({ status, transferable: true }), true, status)
    assert.equal(canTransferReservation({ status, transferable: false }), false, status)
  }
  assert.equal(canTransferReservation(undefined), false)
  assert.equal(canTransferReservation({ status: 'done' }), false)
})
