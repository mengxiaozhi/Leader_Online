import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = async (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('password login submits legacy short passwords without trimming or an eight-character gate', async () => {
  const login = await source('../src/pages/login.vue')
  assert.match(login, /v-model="form\.password"/)
  assert.doesNotMatch(login, /v-model\.trim="form\.password"/)
  assert.doesNotMatch(login, /form\.password\.length\s*<\s*8/)
  assert.match(login, /passwordUpgradeRequired/)
})

test('current-password verification fields preserve the exact existing password', async () => {
  const account = await source('../src/pages/account.vue')
  assert.match(account, /v-model="pwd\.current"/)
  assert.match(account, /v-model="exportPwd"/)
  assert.match(account, /v-model="deletePwd"/)
  assert.doesNotMatch(account, /v-model\.trim="(?:pwd\.current|exportPwd|deletePwd)"/)
})

test('admin account creation requires exact password confirmation', async () => {
  const admin = await source('../src/pages/admin.vue')
  assert.match(admin, /newDriver\.passwordConfirmation/)
  assert.match(admin, /newUser\.passwordConfirmation/)
  assert.match(admin, /passwordConfirmationError\(newDriver\.password, newDriver\.passwordConfirmation\)/)
  assert.match(admin, /passwordConfirmationError\(newUser\.password, newUser\.passwordConfirmation\)/)
})

test('password prompts and upgrade navigation preserve the no-trim contract', async () => {
  const sheetHost = await source('../src/components/AppSheetHost.vue')
  const sheet = await source('../src/utils/sheet.js')
  const login = await source('../src/pages/login.vue')
  assert.match(sheetHost, /v-model="state\.input"/)
  assert.doesNotMatch(sheetHost, /v-model\.trim="state\.input"/)
  assert.match(sheet, /sheetState\.inputType === 'password'/)
  assert.match(login, /query:\s*\{\s*tab:\s*'profile'\s*\}/)
})

test('sensitive token fragments bypass anchor-selector scrolling', async () => {
  const router = await source('../src/router/router.js')
  assert.match(router, /hashParams\.has\('token'\)/)
  assert.match(router, /hashParams\.has\('reset_token'\)/)
})

test('development builds do not register a cacheable service worker', async () => {
  const serviceWorker = await source('../src/pwa/registerServiceWorker.js')
  assert.match(serviceWorker, /if \(!import\.meta\.env\.PROD\) return/)
})

test('registration terminal token states clear the session token and release deferred PWA updates', async () => {
  const completion = await source('../src/pages/register-complete.vue')
  const serviceWorker = await source('../src/pwa/registerServiceWorker.js')
  assert.match(completion, /REGISTRATION_TOKEN_USED/)
  assert.match(completion, /notifySensitiveAuthFlowComplete\(\{ flow: 'registration' \}\)/)
  assert.match(serviceWorker, /reloadWhenSafe\(\{ completedFlow: true \}\)/)
})
