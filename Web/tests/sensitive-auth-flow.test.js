import test from 'node:test'
import assert from 'node:assert/strict'
import {
  captureSensitiveAuthToken,
  cleanSensitiveTokenUrl,
  clearSensitiveAuthFlow,
  hasPendingSensitiveAuthFlow,
  loadSensitiveAuthToken,
  notifySensitiveAuthFlowComplete,
  SENSITIVE_AUTH_FLOW_EVENT,
  shouldDeferServiceWorkerReload,
} from '../src/utils/sensitiveAuthFlow.js'

const createStorage = () => {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('registration fragment token is saved before it is removed from the URL', () => {
  const storage = createStorage()
  let replaced = ''
  const token = captureSensitiveAuthToken({
    flow: 'registration',
    hash: '#token=registration-secret',
    href: 'https://spono.tw/register/complete#token=registration-secret',
    aliases: ['token'],
    storage,
    history: { replaceState: (_state, _title, url) => { replaced = url } },
    title: '完成註冊',
  })

  assert.equal(token, 'registration-secret')
  assert.equal(loadSensitiveAuthToken('registration', storage), 'registration-secret')
  assert.equal(replaced, '/register/complete')
  assert.equal(hasPendingSensitiveAuthFlow(storage), true)
})

test('URL token is retained when session storage cannot persist it', () => {
  let replaced = ''
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error('storage blocked') },
    removeItem() {},
  }
  const token = captureSensitiveAuthToken({
    flow: 'registration',
    hash: '#token=registration-secret',
    href: 'https://spono.tw/register/complete#token=registration-secret',
    aliases: ['token'],
    storage,
    history: { replaceState: (_state, _title, url) => { replaced = url } },
  })

  assert.equal(token, 'registration-secret')
  assert.equal(replaced, '')
})

test('reset supports query and fragment aliases while preserving unrelated URL state', () => {
  assert.equal(
    cleanSensitiveTokenUrl('https://spono.tw/reset?token=secret&first=1#reset_token=old&source=mail', ['token', 'reset_token']),
    '/reset?first=1#source=mail',
  )
})

test('service worker reload is deferred on sensitive routes and while a token is pending', () => {
  const storage = createStorage()
  assert.equal(shouldDeferServiceWorkerReload({ pathname: '/reset', storage }), true)
  assert.equal(shouldDeferServiceWorkerReload({ pathname: '/register/complete', storage }), true)
  assert.equal(shouldDeferServiceWorkerReload({ pathname: '/store', storage }), false)

  captureSensitiveAuthToken({
    flow: 'reset',
    queryToken: 'reset-secret',
    href: 'https://spono.tw/reset?token=reset-secret',
    storage,
    history: { replaceState() {} },
  })
  assert.equal(shouldDeferServiceWorkerReload({ pathname: '/store', storage }), true)
  clearSensitiveAuthFlow('reset', storage)
  assert.equal(shouldDeferServiceWorkerReload({ pathname: '/store', storage }), false)
})

test('terminal token states clear session data and notify the service worker gate', () => {
  const storage = createStorage()
  let dispatched = null
  captureSensitiveAuthToken({
    flow: 'registration',
    queryToken: 'used-token',
    href: 'https://spono.tw/register/complete?token=used-token',
    storage,
    history: { replaceState() {} },
  })

  notifySensitiveAuthFlowComplete({
    flow: 'registration',
    storage,
    target: { dispatchEvent: (event) => { dispatched = event } },
  })

  assert.equal(loadSensitiveAuthToken('registration', storage), '')
  assert.equal(hasPendingSensitiveAuthFlow(storage), false)
  assert.equal(dispatched?.type, SENSITIVE_AUTH_FLOW_EVENT)
})
