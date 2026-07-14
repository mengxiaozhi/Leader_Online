import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildUserRecordCategoryOptions,
  resolveUserRecordCategory,
  resolveWalletRecordLocation,
} from '../src/utils/userRecordCategories.js'

const keys = (kind) => buildUserRecordCategoryOptions(kind).map(option => option.key)
const labels = (kind) => buildUserRecordCategoryOptions(kind).map(option => option.label)

test('user record categories cover tickets, reservations, and orders', () => {
  assert.deepEqual(keys('tickets'), ['general', 'course'])
  assert.deepEqual(labels('tickets'), ['一般票券', '課程票券'])
  assert.deepEqual(keys('reservations'), ['general', 'course'])
  assert.deepEqual(labels('reservations'), ['一般預約', '課程預約'])
  assert.deepEqual(keys('orders'), ['general', 'course'])
  assert.deepEqual(labels('orders'), ['一般訂單', '課程訂單'])
})

test('record category restoration accepts known categories and rejects invalid values', () => {
  for (const kind of ['tickets', 'reservations', 'orders']) {
    assert.equal(resolveUserRecordCategory(kind, 'course'), 'course')
    assert.equal(resolveUserRecordCategory(kind, 'general'), 'general')
    assert.equal(resolveUserRecordCategory(kind, 'unknown'), 'general')
  }
})

test('legacy course wallet tab migrates to the course ticket category', () => {
  assert.deepEqual(resolveWalletRecordLocation('courses', ''), {
    tab: 'tickets',
    category: 'course',
    migratedLegacyCourseTab: true,
  })
})

test('wallet location keeps valid tabs and falls back safely for invalid input', () => {
  assert.deepEqual(resolveWalletRecordLocation('reservations', 'course'), {
    tab: 'reservations',
    category: 'course',
    migratedLegacyCourseTab: false,
  })
  assert.deepEqual(resolveWalletRecordLocation('logs', 'course'), {
    tab: 'logs',
    category: '',
    migratedLegacyCourseTab: false,
  })
  assert.deepEqual(resolveWalletRecordLocation('not-a-tab', 'course'), {
    tab: 'tickets',
    category: 'general',
    migratedLegacyCourseTab: false,
  })
})
