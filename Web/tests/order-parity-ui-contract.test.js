import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('general admin uses canonical single and bulk actions with server capabilities', async () => {
  const source = await read('../src/pages/admin.vue')
  const actionSection = source.slice(source.indexOf('async function performOrderAction'), source.indexOf('async function createProduct'))

  assert.match(source, /hasOrderCapability\(o, 'edit'\)/)
  assert.match(source, /orderActionsFor\(o\)/)
  assert.match(actionSection, /\/admin\/orders\/\$\{order\.id\}\/actions\/\$\{action\}/)
  assert.match(actionSection, /\/admin\/orders\/bulk-actions/)
  assert.match(actionSection, /rowVersion: order\.rowVersion/)
  assert.match(actionSection, /orderMutationHeaders\(order, attempt\.key\)/)
  assert.match(actionSection, /'Idempotency-Key': attempt\.key/)
  assert.match(actionSection, /data\?\.data\?\.items/)
  assert.doesNotMatch(actionSection, /axios\.patch\([^\n]+\/status/)
})

test('general and course product forms share the server purchase limit', async () => {
  const general = await read('../src/pages/admin.vue')
  const course = await read('../src/pages/course-admin.vue')

  for (const source of [general, course]) {
    assert.match(source, /maxPurchaseQuantity/)
    assert.match(source, /max="99"/)
  }
  assert.match(general, /max_purchase_quantity: purchaseLimit/)
  assert.match(course, /maxPurchaseQuantity: maxPurchaseQuantity\(product\)/)
})

test('course cart and batch checkout keep preview hash and idempotent submission', async () => {
  const source = await read('../src/pages/courses.vue')

  assert.match(source, /axios\.get\(`\$\{API\}\/courses\/cart`\)/)
  assert.match(source, /axios\.put\(`\$\{API\}\/courses\/cart`/)
  assert.match(source, /\/courses\/orders\/batch\/preview/)
  assert.match(source, /\/courses\/orders\/batch`/)
  assert.match(source, /checkoutHash: courseBatchPreview\.value\.checkoutHash/)
  assert.match(source, /'Idempotency-Key': courseBatchIdempotencyKey\.value/)
  assert.match(source, /shouldRetainIdempotencyKey\(error\)/)
  assert.match(source, /分服務商匯款資訊/)
  assert.match(source, /courseBatchPreview\.value\.paymentGroups/)
})

test('general member edits and cancellation send row versions and stable retry keys', async () => {
  const store = await read('../src/pages/store.vue')
  const booking = await read('../src/pages/booking.vue')

  assert.match(store, /orderMutationHeaders\(order, memberOrderMutationKeys\.get\(mutationKeyId\)\)/)
  assert.match(store, /axios\.post\(`\$\{API\}\/orders\/\$\{order\.id\}\/cancel`, \{\}, \{/)
  assert.match(booking, /editingOrderRowVersion\.value = order\.rowVersion \?\? order\.row_version/)
  assert.match(booking, /orderMutationHeaders\([\s\S]*editingOrderMutationKey\.value/)
})

test('course member edit and cancel send versioned idempotent mutations', async () => {
  const source = await read('../src/pages/course-account.vue')
  const mutationSection = source.slice(source.indexOf('function mutationConfig'), source.indexOf('watch(query'))

  assert.match(source, /hasOrderCapability\(order, 'edit'\)/)
  assert.match(source, /hasOrderCapability\(order, 'cancel'\)/)
  assert.match(mutationSection, /buildCourseMutationHeaders\(record/)
  assert.match(mutationSection, /axios\.patch\(`\$\{API\}\/courses\/orders\/\$\{selectedOrder\.value\.id\}`/)
  assert.match(mutationSection, /axios\.post\(`\$\{API\}\/courses\/orders\/\$\{order\.id\}\/cancel`/)
  assert.match(mutationSection, /shouldRetainIdempotencyKey\(error\)/)
})

test('course admin refunds send a distinct operations reference', async () => {
  const source = await read('../src/pages/course-admin.vue')
  const actions = source.slice(source.indexOf('function orderRefundReference'), source.indexOf('async function saveTicket'))

  assert.match(actions, /refundReference \? \{ refundReference \} : \{\}/)
  assert.doesNotMatch(actions, /note: refundReference/)
})

test('general checkout does not accept a client-selected initial status and wallet blocks voided tickets', async () => {
  const store = await read('../src/pages/store.vue')
  const wallet = await read('../src/pages/wallet.vue')
  const checkout = store.slice(store.indexOf('const checkout = async'), store.indexOf('const checkSession'))

  assert.doesNotMatch(checkout, /status:\s*['"]待匯款['"]/) 
  assert.match(wallet, /filterTickets\('voided'\)/)
  assert.match(wallet, /ticket\.voided \? '已作廢'/)
  assert.match(wallet, /!ticket\.voided && !ticket\.used && !ticket\.expired/)
  assert.match(wallet, /Boolean\(ticket\?\.uuid\) && !ticket\?\.voided/)
  assert.match(wallet, /raw\.voidedAt \?\? raw\.voided_at/)
})
