import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeHttpUrl, normalizeLocalPath } from '../src/utils/safeUrl.js'

const createStorage = () => {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('normalizeLocalPath keeps local paths and rejects protocol-relative redirects', () => {
  assert.equal(normalizeLocalPath('/wallet?tab=logs#latest'), '/wallet?tab=logs#latest')
  assert.equal(normalizeLocalPath('//evil.example/path', '/store'), '/store')
  assert.equal(normalizeLocalPath('/\\evil.example', '/store'), '/store')
})

test('normalizeHttpUrl only permits HTTP and HTTPS schemes', () => {
  assert.equal(normalizeHttpUrl('javascript:alert(1)'), '')
  assert.equal(normalizeHttpUrl('data:text/html,test'), '')
  assert.equal(normalizeHttpUrl('https://example.com/help'), 'https://example.com/help')
})

test('auth session keeps bearer in session storage and strips it from profile', async () => {
  global.window = { localStorage: createStorage(), sessionStorage: createStorage() }
  const { getBearerToken, setAuthSession } = await import('../src/utils/authSession.js')

  setAuthSession({ id: 7, role: 'USER', token: 'secret-token' })

  assert.equal(getBearerToken(), 'secret-token')
  assert.equal(window.localStorage.getItem('auth_bearer'), null)
  assert.deepEqual(JSON.parse(window.localStorage.getItem('user_info')), { id: 7, role: 'USER' })
  delete global.window
})
