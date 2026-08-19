import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('canonical course tasks are hosted by the existing Store frame without nested landmarks', async () => {
  const [store, courses] = await Promise.all([
    read('../src/pages/store.vue'),
    read('../src/pages/courses.vue'),
  ])

  assert.match(store, /courseTask: \{ type: String, default: '' \}/)
  assert.match(store, /const activeCourseTask = computed/)
  assert.match(store, /v-for="task in publicCourseTasks"/)
  assert.match(store, /:aria-current="activeCourseTask === task\.key \? 'page' : undefined"/)
  assert.match(store, /<CourseStorePanel[\s\S]*:initial-task="activeCourseTask"[\s\S]*embedded/)
  assert.match(store, /router\.push\(\{ path: '\/store', query: \{ tab: key \} \}\)/)

  assert.match(courses, /embedded: \{ type: Boolean, default: false \}/)
  assert.match(courses, /props\.initialTask && !props\.embedded \? CourseCenterShell : 'div'/)
  assert.match(courses, /v-if="!props\.initialTask && !props\.embedded" class="ops-header/)
  assert.match(courses, /const standaloneTabbed = computed\(\(\) => !props\.initialTask && !props\.embedded\)/)
  assert.equal((courses.match(/<main\b/g) || []).length, 0)
})

test('embedded course catalog preserves Store controls, cards and server-owned decisions', async () => {
  const source = await read('../src/pages/courses.vue')

  for (const contract of [
    'AppSearchInput', 'AppBottomSheet', 'AdminPagination', 'courseCartOpen',
    'productFilters', 'sessionFilters', 'COURSE_V2_ENDPOINTS.productPreview',
    'COURSE_V2_ENDPOINTS.sessionEligibility', 'buildCourseTicketMutationHeaders',
    'loadFixedClasses', 'courseTermPath',
  ]) assert.match(source, new RegExp(contract.replaceAll('.', '\\.')))

  assert.match(source, /grid gap-4 sm:grid-cols-2 xl:grid-cols-3/)
  assert.match(source, /ticket-card flex min-h-full flex-col overflow-hidden p-0/)
  assert.match(source, /grid gap-4 md:grid-cols-2 xl:grid-cols-3/)
  assert.match(source, /const requestId = \+\+fixedClassesRequestId/)
  assert.match(source, /if \(requestId !== fixedClassesRequestId\) return/)
  assert.match(source, /productRequestId \+= 1/)
  assert.match(source, /sessionRequestId \+= 1/)
})

test('fixed-term detail and checkout use one Store landmark while retaining 052 and 053 contracts', async () => {
  const source = await read('../src/pages/course-term.vue')

  assert.equal((source.match(/<main\b/g) || []).length, 1)
  assert.equal((source.match(/<h1\b/g) || []).length, 1)
  assert.doesNotMatch(source, /CourseCenterShell/)
  assert.match(source, /<main class="ops-page"/)
  assert.match(source, /<header class="ops-header"/)
  assert.match(source, /ops-toolbar material-chrome sticky/)
  assert.match(source, /aria-label="購票中心分類"/)
  assert.match(source, /aria-label="課程商店分類"/)
  assert.match(source, /role="alert"/)
  assert.match(source, /role="status"/)

  for (const contract of [
    'termEligibility', 'termPaymentOptions', 'termQuote', 'termCheckout',
    'termWaitlist', 'orderPaymentSubmission', 'reviewTermRules',
    'X-Course-Ticket-If-Match', 'Idempotency', 'BANK_TRANSFER',
    'COURSE_TICKET', 'TRIAL_DISCOUNT', 'remittanceMutationKey',
  ]) assert.match(source, new RegExp(contract))

  assert.match(source, /paymentOptionsUnavailable/)
  assert.match(source, /進階付款工具尚未開放，目前可繼續使用銀行匯款報名/)
  assert.match(source, /const requestId = \+\+termRequestId/)
  assert.match(source, /parentRequestId !== termRequestId/)
  assert.match(source, /generation !== actionGeneration/)
  assert.match(source, /watch\(\[termId, \(\) => props\.checkoutMode\]/)
})
