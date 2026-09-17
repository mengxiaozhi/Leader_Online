import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTableDensity, tableScrollState } from '../src/utils/adminTable.js'

test('horizontal controls follow the viewport edges, including subpixel rounding', () => {
  const dimensions = { clientWidth: 600, scrollWidth: 1200 }
  assert.deepEqual(tableScrollState(dimensions), {
    overflow: true, verticalOverflow: false, canScrollLeft: false, canScrollRight: true,
  })
  assert.equal(tableScrollState({ ...dimensions, scrollLeft: 300 }).canScrollLeft, true)
  assert.equal(tableScrollState({ ...dimensions, scrollLeft: 300 }).canScrollRight, true)
  assert.equal(tableScrollState({ ...dimensions, scrollLeft: 599.5 }).canScrollRight, false)
  assert.equal(tableScrollState({ ...dimensions, scrollLeft: -1 }).canScrollLeft, false)
  assert.equal(tableScrollState({ clientWidth: 600, scrollWidth: 601 }).overflow, false)
})

test('hidden and resized tables do not expose horizontal controls unnecessarily', () => {
  assert.deepEqual(tableScrollState({ clientWidth: 0, scrollWidth: 1200 }), {
    overflow: false, verticalOverflow: false, canScrollLeft: false, canScrollRight: false,
  })
  assert.equal(tableScrollState({ clientWidth: 1400, scrollWidth: 1400 }).overflow, false)
  assert.equal(tableScrollState({ clientHeight: 480, scrollHeight: 1200 }).verticalOverflow, true)
  assert.equal(tableScrollState({ clientHeight: 480, scrollHeight: 481 }).verticalOverflow, false)
})

test('missing or obsolete density preferences retain the readable default', () => {
  for (const value of [null, undefined, '', 'legacy', 'comfortable']) {
    assert.equal(normalizeTableDensity(value), 'comfortable')
  }
  assert.equal(normalizeTableDensity('compact'), 'compact')
})
