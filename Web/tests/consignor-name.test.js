import test from 'node:test'
import assert from 'node:assert/strict'
import { formatConsignorName, isConsignorNameRequired } from '../src/utils/consignorName.js'

test('historical empty names are neutral and never presented as an unfinished shipment', () => {
  for (const value of [undefined, null, '', '  ']) {
    assert.equal(formatConsignorName(value), '未提供（不影響託運）')
    assert.equal(isConsignorNameRequired({ editing: true, previousName: value }), false)
  }
  assert.equal(formatConsignorName(' 林   小明 '), '林 小明')
})

test('new checkout and edits of a known consignor still require a name', () => {
  assert.equal(isConsignorNameRequired(), true)
  assert.equal(isConsignorNameRequired({ editing: true, previousName: '實際託運者' }), true)
  assert.equal(formatConsignorName('', { required: true }), '尚未填寫')
})
