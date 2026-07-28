import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = async (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('reservation details expose the official Google Wallet save button and checklist status', async () => {
  const wallet = await source('../src/pages/wallet.vue')

  assert.match(wallet, /selectedReservationChecklistStatus/)
  assert.match(wallet, /src="\/google-wallet\/zhTW_add_to_google_wallet_wallet-button\.svg"/)
  assert.match(wallet, /axios\.post\(`\$\{API\}\/reservations\/\$\{reservationId\}\/google-wallet`\)/)
  assert.match(wallet, /const saveUrl = normalizeGoogleWalletSaveUrl\(data\?\.data\?\.saveUrl\)/)
  assert.match(wallet, /將目前托運階段與檢核入口儲存到 Google 錢包/)
  assert.match(wallet, /:disabled="addingReservationToGoogleWallet"/)
})

test('checklist uploads use multipart data and the server photo policy', async () => {
  const wallet = await source('../src/pages/wallet.vue')

  assert.match(wallet, /applyChecklistPhotoPolicy\(payload\?\.photoPolicy \|\| \{\}\)/)
  assert.match(wallet, /:accept="checklistPhotoAcceptValue"/)
  assert.match(wallet, /validateChecklistPhoto\(file, checklistPhotoPolicy\)/)
  assert.match(wallet, /const formData = new FormData\(\)/)
  assert.match(wallet, /formData\.append\('photo', file, file\.name\)/)
  assert.match(wallet, /checklistPhotoPolicy\.maxCount/)
  assert.match(wallet, /checklistPhotoPolicy\.maxBytes/)
  assert.doesNotMatch(wallet, /readAsDataURL/)
  assert.doesNotMatch(wallet, /CHECKLIST_PHOTO_LIMIT/)
  assert.doesNotMatch(wallet, /CHECKLIST_PHOTO_MAX_BYTES/)
})

test('checklist deep links resolve only against owned reservations and consume action parameters', async () => {
  const [wallet, router, login] = await Promise.all([
    source('../src/pages/wallet.vue'),
    source('../src/router/router.js'),
    source('../src/pages/login.vue'),
  ])

  assert.match(wallet, /resolveReservationChecklistDeepLink\(route\.query\)/)
  assert.match(wallet, /await loadReservations\(\{[\s\S]*throwOnError: true/)
  assert.match(wallet, /reservations\.value\.find\(reservation => resolveReservationId\(reservation\) === deepLink\.reservationId\)/)
  assert.match(wallet, /String\(currentUser\.value\?\.id \|\| currentUser\.value\?\.email \|\| ''\)/)
  assert.match(wallet, /reservations\.value = \[\]/)
  assert.match(wallet, /const requestedFullPath = route\.fullPath/)
  assert.match(wallet, /const requestedIdentity = reservationIdentity\(\)/)
  assert.match(wallet, /route\.path === '\/wallet'[\s\S]*route\.fullPath === requestedFullPath[\s\S]*reservationIdentity\(\) === requestedIdentity/)
  assert.match(wallet, /const loadGeneration = \+\+reservationLoadGeneration/)
  assert.match(wallet, /loadGeneration === reservationLoadGeneration[\s\S]*requestedIdentity === reservationIdentity\(\)/)
  assert.match(wallet, /reservationLoadGeneration \+= 1/)
  assert.match(wallet, /query: \{ redirect: requestedFullPath \}/)
  assert.match(wallet, /if \(shouldConsume && routeIsStillCurrent\(\)\) await consumeReservationDeepLink\(\)/)
  assert.match(wallet, /identityChanged[\s\S]*pendingDeepLink\.requested[\s\S]*nextTick\(\(\) => openReservationChecklistDeepLink\(\)\)/)
  assert.match(wallet, /\(\) => \[route\.path, route\.query\.reservation, route\.query\.action, loadingReservations\.value\]/)
  assert.match(wallet, /delete query\.reservation/)
  assert.match(wallet, /delete query\.action/)
  assert.match(wallet, /無法開啟此預約，請確認登入帳號與連結後再試。/)
  assert.doesNotMatch(wallet, /無法開啟預約 \$\{deepLink\.reservationId\}/)
  assert.match(router, /query: \{ redirect: to\.fullPath \}/)
  assert.match(login, /normalizeLocalPath\(route\.query\.redirect, '\/store'\)/)
})
