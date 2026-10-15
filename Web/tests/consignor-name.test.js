import test from 'node:test'
import assert from 'node:assert/strict'
import { formatConsignorName, resolveConsignorName } from '../src/utils/consignorName.js'

test('historical empty names are neutral and never presented as an unfinished shipment', () => {
  for (const value of [undefined, null, '', '  ']) {
    assert.equal(formatConsignorName(value), '未提供（不影響託運）')
  }
  assert.equal(formatConsignorName(' 林   小明 '), '林 小明')
})

test('missing or cleared consignors default to the buyer account name', () => {
  for (const value of [undefined, null, '', '  ']) {
    assert.equal(resolveConsignorName(value, ' 林   小明 '), '林 小明')
  }
  assert.equal(resolveConsignorName(' 實際   託運者 ', '購買者'), '實際 託運者')
  assert.equal(resolveConsignorName('', undefined), '')
})
