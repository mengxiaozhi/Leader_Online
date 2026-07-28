import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = async (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('course ticket cards expose only booked CBK redemption bookings', async () => {
  const account = await source('../src/pages/course-account.vue')

  assert.match(account, /ticket\?\.redemptionBookings/)
  assert.match(account, /booking\?\.status !== 'booked'/)
  assert.match(account, /\/\^CBK-\[A-F0-9\]\{16,32\}\$\//)
  assert.match(account, /ticketRedemptionCount\(ticket\) === 1/)
  assert.match(account, /選擇場次出示 QR（\$\{ticketRedemptionCount\(ticket\)\} 場）/)
  assert.match(account, /sm:col-span-2/)
})

test('one booking emits immediately while multiple bookings use the shared selector', async () => {
  const account = await source('../src/pages/course-account.vue')

  assert.match(account, /if \(bookings\.length === 1\) return requestAttendanceQr\(bookings\[0\]\)/)
  assert.match(account, /v-model="attendanceSelectorOpen"/)
  assert.match(account, /title="選擇核銷場次"/)
  assert.match(account, /booking\.sessionTitle/)
  assert.match(account, /formatRange\(booking\.startsAt, booking\.endsAt\)/)
  assert.match(account, /booking\.location \|\| '地點待公告'/)
  assert.match(account, /@after-close="emitPendingAttendanceQr"/)
  assert.match(account, /emit\('attendance-qr', booking\)/)
})

test('wallet ticket and booking panels reuse the existing attendance QR sheet', async () => {
  const wallet = await source('../src/pages/wallet.vue')

  assert.match(wallet, /mode="tickets"[\s\S]*?@attendance-qr="showCourseAttendanceQr"/)
  assert.match(wallet, /mode="bookings" @attendance-qr="showCourseAttendanceQr"/)
  assert.match(wallet, /type: 'course_attendance',\s+bookingId: resolveCourseBookingId\(booking\)/)
  assert.equal((wallet.match(/:value="qrSheet\.code"/g) || []).length, 1)
  assert.match(wallet, /確認出席後才會扣除 1 堂/)
})

test('course attendance QR can save the selected booking to Google Wallet', async () => {
  const wallet = await source('../src/pages/wallet.vue')

  assert.match(wallet, /v-if="qrSheet\.type === 'course_attendance' && qrSheet\.bookingId"/)
  assert.match(wallet, /src="\/google-wallet\/zhTW_add_to_google_wallet_wallet-button\.svg"/)
  assert.match(wallet, /將此場課程核銷 QR Code 儲存到 Google 錢包/)
  assert.match(wallet, /const bookingId = Number\(qrSheet\.value\.bookingId\)/)
  assert.match(wallet, /qrSheet\.value\.type !== 'course_attendance'/)
  assert.match(wallet, /:disabled="addingCourseBookingToGoogleWallet"/)
  assert.match(wallet, /\|\| addingCourseBookingToGoogleWallet\.value/)
  assert.match(wallet, /axios\.post\(`\$\{API\}\/courses\/bookings\/\$\{bookingId\}\/google-wallet`\)/)
})

test('Google Wallet navigation only accepts the official save URL origin and path', async () => {
  const wallet = await source('../src/pages/wallet.vue')

  assert.match(wallet, /url\.origin !== 'https:\/\/pay\.google\.com'/)
  assert.match(wallet, /!url\.pathname\.startsWith\('\/gp\/v\/save\/'\)/)
  assert.match(wallet, /const saveUrl = normalizeGoogleWalletSaveUrl\(data\?\.data\?\.saveUrl\)/)
  assert.match(wallet, /if \(!data\?\.ok \|\| !saveUrl\)/)
  assert.match(wallet, /const requestSheet = qrSheet\.value/)
  assert.match(wallet, /qrSheet\.value !== requestSheet/)
  assert.match(wallet, /!qrSheet\.value\.open/)
  assert.match(wallet, /Number\(qrSheet\.value\.bookingId\) !== bookingId/)
  assert.match(wallet, /window\.location\.assign\(saveUrl\)/)
  assert.match(wallet, /\{ title: '無法加入 Google 錢包' \}/)
})
