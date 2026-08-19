import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('canonical member course tasks render inside the Wallet shell without a second page landmark', async () => {
  const [wallet, account] = await Promise.all([
    read('../src/pages/wallet.vue'),
    read('../src/pages/course-account.vue'),
  ])

  assert.match(wallet, /courseTask: \{ type: String, default: '' \}/)
  assert.match(wallet, /const memberCourseTasks = MEMBER_COURSE_TASKS/)
  assert.match(wallet, /:productized-task="activeCourseTask\.key"[\s\S]{0,160}\bembedded\b/)
  assert.match(account, /embedded: \{ type: Boolean, default: false \}/)
  assert.match(account, /const productizedContainer = computed\(\(\) => props\.embedded \? 'div' : CourseCenterShell\)/)
  assert.equal((wallet.match(/<main\b/g) || []).length, 1)
  assert.doesNotMatch(account, /props\.embedded \? 'main'/)
})

test('passes and orders reuse their existing shared record panels and retain ticket operations', async () => {
  const wallet = await read('../src/pages/wallet.vue')
  const account = await read('../src/pages/course-account.vue')

  assert.match(wallet, /const coursePassesSurface = computed/)
  assert.match(wallet, /const courseOrdersSharedLink = courseRecordDeepLink\('orders'\)/)
  assert.match(wallet, /<CourseAccountPanel[\s\S]{0,180}mode="orders" embedded/)
  assert.match(wallet, /mode="tickets"[\s\S]{0,220}@attendance-qr="showCourseAttendanceQr"/)
  for (const contract of [
    'resumeTicket', 'partialTransferAvailable', 'openTicketAttendanceQr',
    'requestTermLeave', 'bookMakeup', 'checkoutMakeupInsurance',
    'startRenewal', 'actOnWaitlistOffer', 'markNotificationRead',
  ]) assert.match(account, new RegExp(contract))
})

test('productized member requests are task-scoped, cancellable and keep stale content out', async () => {
  const account = await read('../src/pages/course-account.vue')
  const loadSection = account.slice(
    account.indexOf('function cancelProductizedRequest'),
    account.indexOf('function productizedStatus('),
  )

  assert.match(loadSection, /const requestedTask = memberTask\.value/)
  assert.match(loadSection, /const currentRequest = \+\+productizedRequestId/)
  assert.match(loadSection, /new AbortController\(\)/)
  assert.match(loadSection, /currentRequest !== productizedRequestId \|\| memberTask\.value\.key !== requestedTask\.key/)
  assert.match(loadSection, /productizedRequestCancelled\(error\)/)
  assert.doesNotMatch(loadSection, /catch \(error\) \{[\s\S]*?productizedItems\.value = \[\]/)
  assert.match(account, /watch\(\(\) => props\.productizedTask[\s\S]*?cancelProductizedRequest\(\)/)
  assert.match(account, /onBeforeUnmount\(\(\) => \{[\s\S]*?cancelProductizedRequest\(\)/)
})

test('Wallet course navigation remains responsive and exposes current state to assistive technology', async () => {
  const [wallet, account] = await Promise.all([
    read('../src/pages/wallet.vue'),
    read('../src/pages/course-account.vue'),
  ])

  assert.match(wallet, /aria-label="會員課程功能"/)
  assert.match(wallet, /overflow-x-auto/)
  assert.match(wallet, /min-h-11/)
  assert.match(wallet, /:aria-current="task\.key === activeCourseTask\.key \? 'page' : undefined"/)
  assert.match(wallet, /querySelector\('\[aria-current="page"\]'\)/)
  assert.match(wallet, /v-if="courseApiSurface"[\s\S]{0,320}:productized-task="activeCourseTask\.key"/)
  assert.match(account, /<CourseResourceState/)
  assert.match(account, /:role="productizedActionTone === 'error' \? 'alert' : 'status'"/)
  assert.match(account, /:aria-live="productizedActionTone === 'error' \? 'assertive' : 'polite'"/)
})
