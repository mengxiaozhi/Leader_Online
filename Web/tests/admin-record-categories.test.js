import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAdminRecordCategoryOptions,
  resolveAdminRecordCategory,
} from '../src/utils/adminRecordCategories.js'

const keys = (kind, role) => buildAdminRecordCategoryOptions(kind, role).map(option => option.key)

test('admin can switch between general and course records', () => {
  assert.deepEqual(keys('orders', 'ADMIN'), ['general', 'course'])
  assert.deepEqual(keys('tickets', 'ADMIN'), ['general', 'course'])
})

test('course managers only receive general categories they may access', () => {
  assert.deepEqual(keys('orders', 'SERVICE_PROVIDER'), ['general', 'course'])
  assert.deepEqual(keys('tickets', 'SERVICE_PROVIDER'), ['course'])
  assert.deepEqual(keys('orders', 'STORE'), ['general', 'course'])
  assert.deepEqual(keys('tickets', 'COACH'), ['course'])
  assert.deepEqual(keys('orders', 'EDITOR'), [])
  assert.deepEqual(keys('tickets', 'EDITOR'), [])
})

test('category restoration rejects unavailable or unknown categories', () => {
  assert.equal(resolveAdminRecordCategory('tickets', 'SERVICE_PROVIDER', 'general'), 'course')
  assert.equal(resolveAdminRecordCategory('orders', 'EDITOR', 'course'), '')
  assert.equal(resolveAdminRecordCategory('orders', 'ADMIN', 'course'), 'course')
  assert.equal(resolveAdminRecordCategory('orders', 'DRIVER', 'course'), '')
})
