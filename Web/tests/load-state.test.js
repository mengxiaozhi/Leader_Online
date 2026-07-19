import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveLoadState } from '../src/utils/loadState.js'

test('load-state mapping never turns an API error into a normal empty state', () => {
  assert.deepEqual(resolveLoadState({ loading: false, error: 'Network Error', items: [] }), {
    status: 'error',
    message: 'Network Error',
  })
  assert.equal(resolveLoadState({ loading: false, error: '', items: [] }).status, 'empty')
})

test('loading wins over stale error or data and success requires data', () => {
  assert.equal(resolveLoadState({ loading: true, error: 'old', items: [1] }).status, 'loading')
  assert.equal(resolveLoadState({ items: [{ id: 1 }] }).status, 'success')
})
