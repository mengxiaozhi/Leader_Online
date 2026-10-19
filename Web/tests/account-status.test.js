import test from 'node:test'
import assert from 'node:assert/strict'
import { accountStatusMessages } from '../src/utils/accountStatus.js'
import { normalizeCourseProduct, normalizeCourseTicket } from '../src/utils/courseV2.js'
import { normalizeOrderRecord } from '../src/utils/orderParity.js'

test('notices name the deleted relation and distinguish accounts that no longer exist', () => {
  assert.deepEqual(accountStatusMessages({ accountRelations: [
    { relation: 'account', status: 'deleted' }, { relation: 'provider', status: 'deleted' },
    { relation: 'driver', status: 'missing' }, { relation: 'coach', status: 'deleted' },
  ] }), ['帳號已刪除', '服務商帳號已刪除', '司機帳號已不存在', '教練帳號已刪除'])
})

test('active and unlinked records remain quiet and historical email snapshots are never interpreted', () => {
  for (const record of [{}, { ownerEmail: 'deleted+old@example.invalid' }, { accountRelations: [{ relation: 'account', status: 'active' }] }]) {
    assert.deepEqual(accountStatusMessages(record), [])
  }
  assert.deepEqual(accountStatusMessages({ accountDeleted: true }), ['帳號已刪除'])
  assert.deepEqual(accountStatusMessages({ accountRelations: [null, {}, { relation: 'owner', status: 'deleted' }, { relation: 'owner', status: 'deleted' }] }), ['所屬帳號已刪除'])
})

test('course product, ticket and order normalization retain authoritative account relations', () => {
  const record = { id: 1, accountRelations: [{ relation: 'account', status: 'deleted' }] }
  for (const normalize of [normalizeCourseProduct, normalizeCourseTicket, normalizeOrderRecord]) {
    assert.deepEqual(normalize(record).accountRelations, record.accountRelations)
  }
})
