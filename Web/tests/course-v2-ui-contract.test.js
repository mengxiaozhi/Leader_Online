import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createSSRApp, h, nextTick, ref, watch } from 'vue'
import { renderToString } from '@vue/server-renderer'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('course store delegates purchase and booking decisions to server previews', async () => {
  const source = await read('../src/pages/courses.vue')
  assert.match(source, /COURSE_V2_ENDPOINTS\.productPreview/)
  assert.match(source, /COURSE_V2_ENDPOINTS\.sessionEligibility/)
  assert.match(source, /buildCourseTicketMutationHeaders/)
  assert.match(source, /ticketRowVersion/)
  assert.match(source, /Course V2 已啟用，但訂單預覽 API 不可用/)
  assert.match(source, /預約只保留 1 堂；SUCCESS 或 NO SHOW 才扣堂/)
  assert.doesNotMatch(source, /session\.productId && Number\(session\.productId\)/)
})

test('wallet attendance invite deep link confirms without persisting its token', async () => {
  const source = await read('../src/pages/wallet.vue')
  assert.match(source, /\/courses\/attendance-invites\/confirm/)
  assert.match(source, /COURSE_V2_ENDPOINTS\.attendanceInvitePreview/)
  assert.match(source, /query: \{ redirect: route\.fullPath \}/)
  assert.match(source, /delete query\.token/)
  assert.match(source, /delete query\.version/)
  assert.match(source, /expectedRowVersion/)
  assert.match(source, /clearAttendanceInviteDeepLink/)
  const inviteSection = source.slice(source.indexOf('const ATTENDANCE_INVITE_ACTIONS'), source.indexOf('const categoryForTab'))
  assert.doesNotMatch(inviteSection, /localStorage\.setItem|console\./)
})

test('wallet course transfers send idempotency and ticket-version preconditions', async () => {
  const source = await read('../src/pages/wallet.vue')
  const transferSection = source.slice(
    source.indexOf('const ticketTransferApiBase'),
    source.indexOf('// 預約資料')
  )
  const incomingSection = source.slice(
    source.indexOf('const loadIncomingTransfers'),
    source.indexOf('// ===== 掃描轉贈')
  )
  const claimSection = source.slice(
    source.indexOf('const claimCode'),
    source.indexOf('const claimByCode')
  )

  assert.match(transferSection, /buildCourseMutationHeaders/)
  assert.match(transferSection, /\[409, 428\]/)
  assert.match(transferSection, /if \(transferType !== 'course'\) return axios\.post\(endpoint, body\)/)
  assert.match(transferSection, /action: 'initiate-email'/)
  assert.match(transferSection, /action: 'initiate-qr'/)
  assert.match(transferSection, /action: 'cancel'/)
  assert.match(transferSection, /courseRowVersion\(courseTransferResponsePayload\(cancelResponse\)\)/)

  assert.match(incomingSection, /ticketRowVersion: courseTicketRowVersion\(item\)/)
  assert.match(incomingSection, /action: 'accept'/)
  assert.match(incomingSection, /action: 'decline'/)
  assert.match(incomingSection, /rowVersion: courseTicketRowVersion\(it\)/)
  assert.match(incomingSection, /reloadCourseTransferState\(\{ incomingTransfers: true \}\)/)

  const previewIndex = claimSection.indexOf('COURSE_V2_ENDPOINTS.ticketTransferPreview')
  const claimPostIndex = claimSection.indexOf('postTicketTransferMutation')
  assert.ok(previewIndex >= 0 && claimPostIndex > previewIndex)
  assert.match(claimSection, /ticketRowVersion: courseTicketRowVersion\(preview\)/)
  assert.match(claimSection, /action: 'claim'/)
  assert.match(claimSection, /courseTransferClaimContexts/)
})

test('course account progressively enhances partial transfers and preserves legacy fallback', async () => {
  const source = await read('../src/pages/course-account.vue')
  const util = await read('../src/utils/courseV2.js')
  const partialSection = source.slice(
    source.indexOf('function isPartialTransferUnavailable'),
    source.indexOf('function normalizeAttendanceBooking')
  )

  assert.match(source, /COURSE_V2_ENDPOINTS\.partialTransfers/)
  assert.match(source, /partialTransferAvailable && canPartialTransferTicket\(ticket\)/)
  assert.match(source, /v-else-if="!partialTransferAvailable && canTransferTicket\(ticket\)"/)
  assert.match(source, /requestTransferEmail\(ticket\)/)
  assert.match(source, /requestTransferQr\(ticket\)/)
  assert.match(source, /partialTransfers\.incoming/)
  assert.match(source, /partialTransfers\.outgoing/)
  assert.match(source, /partialTransferPreview/)
  assert.match(source, /recipientEmail/)
  assert.match(source, /availableAfterTransfer/)
  assert.match(partialSection, /COURSE_V2_ENDPOINTS\.partialTransferPreview/)
  assert.match(partialSection, /COURSE_V2_ENDPOINTS\.partialTransferInitiate/)
  assert.match(partialSection, /COURSE_V2_ENDPOINTS\.partialTransferAction/)
  assert.match(partialSection, /mutationConfig\(partialTransferTicket\.value/)
  assert.match(partialSection, /mutationConfig\(transfer, `partial-transfer-\$\{action\}`\)/)
  assert.match(partialSection, /\[404, 501, 503\]/)
  assert.match(partialSection, /partialTransferAvailable\.value = false/)
  assert.match(util, /partialTransfers: '\/courses\/tickets\/transfers'/)
  assert.match(util, /normalizeCoursePartialTransfer/)
})

test('store bridges legacy attendance invite links to wallet without persisting token', async () => {
  const source = await read('../src/pages/courses.vue')
  assert.match(source, /bridgeAttendanceInviteDeepLink/)
  assert.match(source, /action: 'attendance-invite'/)
  const bridge = source.slice(source.indexOf('function bridgeAttendanceInviteDeepLink'), source.indexOf('watch(search'))
  assert.doesNotMatch(bridge, /localStorage|console\./)
})

test('desktop and mobile scanner surfaces share the review and preserve course attendance actions', async () => {
  const source = await read('../src/pages/admin.vue')
  const review = await read('../src/components/AdminScanReview.vue')
  assert.equal((source.match(/<AdminScanReview\b/g) || []).length, 2)
  assert.match(review, /<CourseAttendanceActions\b/)
  assert.match(review, /:capabilities="booking\.capabilities"/)
  assert.match(review, /busy-action="attend"/)
  assert.match(review, /primary-only/)
  assert.match(review, /@action="confirm"/)
  assert.match(source, /@confirm="confirmScanReview"/)
  assert.match(source, /@preview="previewChecklistPhoto"/)
  assert.match(source, /buildCourseMutationHeaders/)
})

const compiledVueModules = new Map()
async function compiledVueUrl(url) {
  if (compiledVueModules.has(url.href)) return compiledVueModules.get(url.href)
  const source = await readFile(url, 'utf8')
  const filename = fileURLToPath(url)
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  let { content } = compileScript(descriptor, { id: filename, inlineTemplate: true })
  const specifiers = [...content.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map(match => match[1])
  for (const specifier of new Set(specifiers)) {
    let target
    if (specifier.startsWith('.')) {
      target = new URL(specifier, url)
      if (!existsSync(target) && existsSync(`${fileURLToPath(target)}.js`)) target = new URL(`${target.href}.js`)
      target = target.pathname.endsWith('.vue') ? await compiledVueUrl(target) : target.href
    } else target = import.meta.resolve(specifier)
    content = content.replaceAll(`from '${specifier}'`, `from '${target}'`).replaceAll(`from "${specifier}"`, `from "${target}"`)
  }
  const result = `data:text/javascript;base64,${Buffer.from(content).toString('base64')}`
  compiledVueModules.set(url.href, result)
  return result
}

async function renderScanReview(review, confirming = false) {
  const url = await compiledVueUrl(new URL('../src/components/AdminScanReview.vue', import.meta.url))
  const { default: component } = await import(url)
  return renderToString(createSSRApp({ render: () => h(component, { review, confirming, photoSrc: () => '/fixture-photo' }) }))
}

const shipmentReview = (overrides = {}) => ({
  stage: 'pre_dropoff',
  nextStage: 'pre_pickup',
  reservation: { id: 1, username: '測試會員', consignor_name: '測試託運者', event: '測試活動', store: '測試交車點' },
  checklistReady: true,
  checklist: { items: [{ label: '已確認項目', checked: true }, { label: '未確認項目', checked: false }], photos: [], photoCount: 2, minPhotoCount: 2 },
  ...overrides,
})

const confirmButton = html => {
  const button = html.match(/<button\b[^>]*class="[^"]*scan-review-confirm[^>]*>/)?.[0]
  assert.ok(button, 'shipment confirmation action must render')
  return button
}

test('shipment review uses actual item states and keeps consignor separate from member', async () => {
  const html = await renderScanReview(shipmentReview({ reservation: { id: 1, username: '測試會員', consignor_name: '' } }))
  assert.match(html, /未提供（不影響託運）/)
  assert.match(html, /測試會員/)
  assert.match(html, /未勾選：/)
  assert.match(html, /is-unchecked/)
  assert.match(html, /aria-current="step"/)
  assert.doesNotMatch(confirmButton(html), /\bdisabled\b/)
})

test('shipment review describes the next pending state while course labels stay unchanged', async () => {
  for (const [nextStage, expected] of [['pre_pickup', '待賽前取車'], ['post_dropoff', '待賽後交車'], ['post_pickup', '待賽後取車'], ['done', '已完成']]) {
    const html = await renderScanReview(shipmentReview({ nextStage, nextStageLabel: 'API 階段名稱' }))
    assert.match(html, new RegExp(`<strong>${expected}</strong>`))
  }
  const custom = await renderScanReview(shipmentReview({ nextStage: 'custom', nextStageLabel: '人工處理' }))
  assert.match(custom, /<strong>人工處理<\/strong>/)
  const course = await renderScanReview({ kind: 'course', nextStage: 'pre_pickup', nextStageLabel: '扣除 1 堂', courseBooking: {} })
  assert.match(course, /<strong>扣除 1 堂<\/strong>/)
  assert.doesNotMatch(course, /待賽前取車/)
})

test('shipment review retains readiness, confirming and per-order photo minimum gates', async () => {
  for (const stage of ['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup']) {
    const ready = shipmentReview({ stage })
    assert.doesNotMatch(confirmButton(await renderScanReview(ready)), /\bdisabled\b/)
    const busy = await renderScanReview(ready, true)
    assert.match(confirmButton(busy), /\bdisabled\b/)
    assert.match(busy.match(/<button\b[^>]*class="[^"]*scan-review-cancel[^>]*>/)?.[0] || '', /\bdisabled\b/)
  }
  const legacy = await renderScanReview(shipmentReview({ checklist: { items: [], photos: [], photoCount: 1, minPhotoCount: 1 } }))
  assert.match(legacy, /1 張／至少 1 張/)
  assert.doesNotMatch(confirmButton(legacy), /\bdisabled\b/)
  const incomplete = await renderScanReview(shipmentReview({ checklistReady: false, checklist: { items: [], photos: [{ id: 1 }, { id: 2 }], photoCount: 1, minPhotoCount: 2 } }))
  assert.match(incomplete, /1 張／至少 2 張/)
  assert.match(confirmButton(incomplete), /\bdisabled\b/)
  assert.match(incomplete, /至少上傳 2 張照片/)
  const missing = await renderScanReview({})
  assert.match(confirmButton(missing), /\bdisabled\b/)
  assert.match(missing, /0 張／至少 2 張/)
})

test('course review preserves redeemable precedence and does not acquire shipment checklist gates', async () => {
  const course = {
    kind: 'course', stage: 'course_attendance', nextStage: 'attended', checklistReady: false,
    reservation: { id: 1, username: '測試會員' },
    courseBooking: { capabilities: { attend: true }, remainingUses: 3 },
  }
  const primaryButton = html => {
    const button = html.match(/<button\b[^>]*class="[^"]*btn-primary[^>]*>/)?.[0]
    assert.ok(button, 'permitted course attendance action must render')
    return button
  }
  assert.doesNotMatch(primaryButton(await renderScanReview(course)), /\bdisabled\b/)
  for (const redeemable of [{ redeemableNow: false, redeemable_now: true, redeemable: true }, { redeemable_now: false, redeemable: true }, { redeemable: false }]) {
    const html = await renderScanReview({ ...course, courseBooking: { ...course.courseBooking, ...redeemable } })
    assert.match(primaryButton(html), /\bdisabled\b/)
  }
  assert.match(primaryButton(await renderScanReview(course, true)), /\bdisabled\b/)
  const makeup = await renderScanReview({ ...course, courseBooking: { ...course.courseBooking, capabilities: ['makeup-redeem'] } })
  assert.match(makeup, /事後補登/)
  assert.doesNotMatch(primaryButton(makeup), /\bdisabled\b/)
  const withoutAttendance = await renderScanReview({ ...course, courseBooking: { ...course.courseBooking, capabilities: { undo: true } } })
  assert.doesNotMatch(withoutAttendance, /<button\b[^>]*class="[^"]*btn-primary/)
})

let scannerFactoryPromise
function scannerFactory() {
  scannerFactoryPromise ||= read('../src/pages/admin.vue').then(source => {
    const { descriptor } = parse(source)
    const script = descriptor.scriptSetup.content
    const { scriptSetupAst } = compileScript(descriptor, { id: 'admin-scanner-contract' })
    const names = ['openScan', 'closeScan', 'submitManual', 'resumeScanAfterReview', 'cancelScanReview', 'startDriverScan']
    const declarations = names.map(name => {
      const node = scriptSetupAst.find(item => (item.type === 'FunctionDeclaration' && item.id.name === name)
        || (item.type === 'VariableDeclaration' && item.declarations.some(declaration => declaration.id.name === name)))
      assert.ok(node, `scanner action ${name} must exist`)
      return script.slice(node.start, node.end)
    })
    const openWatcher = scriptSetupAst.find(node => node.type === 'ExpressionStatement'
      && node.expression?.callee?.name === 'watch'
      && script.slice(node.expression.arguments[0].start, node.expression.arguments[0].end).includes('scan.value.open'))
    assert.ok(openWatcher, 'camera open lifecycle watcher must exist')
    return new Function('scan', 'scanInputMode', 'scanManualInput', 'nextTick', 'watch', 'startScanCamera', 'stopScanCamera', 'submitCode', 'tab', 'showNotice', 'switchAdminTask',
      `${declarations.join('\n')}\nconst dispose = ${script.slice(openWatcher.start, openWatcher.end)}\nreturn { ${names.join(', ')}, dispose }`)
  })
  return scannerFactoryPromise
}

async function scannerHarness({ mode = 'manual', state = {}, previewError = '' } = {}) {
  const scan = ref({ open: false, scanning: false, manual: 'TEST-CODE', review: { stage: 'pre_dropoff' }, confirming: false, error: 'previous error', ...state })
  const scanInputMode = ref(mode)
  const tab = ref('driver-tasks')
  const calls = []
  const input = ref({ focus: () => calls.push('focus') })
  const create = await scannerFactory()
  const actions = create(scan, scanInputMode, input, nextTick, watch,
    async () => { calls.push('camera-start'); scan.value.scanning = true },
    () => { calls.push('camera-stop'); scan.value.scanning = false },
    async code => { calls.push(['preview', code]); if (previewError) scan.value.error = previewError },
    tab,
    async message => calls.push(['notice', message]),
    key => { tab.value = key; calls.push(['navigate', key]) })
  return { scan, scanInputMode, tab, calls, ...actions }
}

test('scanner drawer is unavailable on the dedicated scan page but remains available elsewhere', async () => {
  const source = await read('../src/pages/admin.vue')
  const conditions = [...source.matchAll(/v-if="([^"]*scan\.open[^"]*)"[^>]*class="[^"]*fixed[^"]*"/g)].map(match => match[1])
  assert.equal(conditions.length, 2, 'backdrop and drawer must both have route guards')
  for (const condition of conditions) {
    const visible = new Function('scan', 'tab', `return ${condition}`)
    assert.equal(visible({ open: true }, 'scan'), false)
    assert.equal(visible({ open: true }, 'orders'), true)
    assert.equal(visible({ open: false }, 'orders'), false)
  }
})

test('manual review cancellation releases the camera and restores input focus without restarting it', async () => {
  const scanner = await scannerHarness({ mode: 'manual' })
  try {
    scanner.cancelScanReview()
    await nextTick()
    assert.deepEqual(scanner.calls, ['camera-stop', 'focus'])
    assert.equal(scanner.scan.value.open, false)
    assert.equal(scanner.scan.value.review, null)
    assert.equal(scanner.scan.value.manual, '')
    assert.equal(scanner.scan.value.error, '')
    scanner.scan.value.review = { stage: 'pre_pickup' }
    scanner.scan.value.confirming = true
    scanner.calls.length = 0
    scanner.cancelScanReview()
    await nextTick()
    assert.deepEqual(scanner.calls, [])
    assert.equal(scanner.scan.value.review.stage, 'pre_pickup')
  } finally { scanner.dispose() }
})

test('camera review cancellation resumes existing or newly opened scanner sessions', async () => {
  for (const open of [false, true]) {
    const scanner = await scannerHarness({ mode: 'camera', state: { open } })
    try {
      scanner.cancelScanReview()
      await nextTick()
      assert.deepEqual(scanner.calls, ['camera-start'])
      assert.equal(scanner.scan.value.open, true)
      assert.equal(scanner.scan.value.review, null)
    } finally { scanner.dispose() }
  }
})

test('scanner entry chooses its input mode and blocks manual submission during review or confirmation', async () => {
  const scanner = await scannerHarness({ mode: 'camera', state: { review: null } })
  try {
    await scanner.submitManual()
    assert.equal(scanner.scanInputMode.value, 'manual')
    assert.deepEqual(scanner.calls, [['preview', 'TEST-CODE']])
    await scanner.openScan()
    await nextTick()
    assert.equal(scanner.scanInputMode.value, 'camera')
    assert.equal(scanner.scan.value.open, true)
    assert.deepEqual(scanner.calls, [['preview', 'TEST-CODE'], 'camera-start'])
    await scanner.openScan()
    assert.deepEqual(scanner.calls, [['preview', 'TEST-CODE'], 'camera-start', 'camera-start'])
    for (const blocked of [{ manual: '' }, { manual: 'TEST', review: {} }, { manual: 'TEST', review: null, confirming: true }]) {
      Object.assign(scanner.scan.value, { manual: 'TEST', review: null, confirming: false }, blocked)
      scanner.calls.length = 0
      await scanner.submitManual()
      assert.deepEqual(scanner.calls, [])
      assert.equal(scanner.scanInputMode.value, 'camera')
    }
  } finally { scanner.dispose() }
})

test('driver task manual preview failure cannot leave a camera attached to the old drawer', async () => {
  for (const open of [false, true]) {
    const scanner = await scannerHarness({ mode: 'camera', state: { open, scanning: open, review: null }, previewError: '預覽失敗' })
    try {
      await scanner.startDriverScan({ stage_verify_code: 'TEST-CODE' })
      await nextTick()
      assert.equal(scanner.tab.value, 'scan')
      assert.equal(scanner.scanInputMode.value, 'manual')
      assert.equal(scanner.scan.value.open, false)
      assert.equal(scanner.scan.value.scanning, false)
      assert.equal(scanner.scan.value.error, '預覽失敗')
      assert.equal(scanner.calls.filter(call => call === 'camera-start').length, 0)
      assert.equal(scanner.calls.filter(call => Array.isArray(call) && call[0] === 'preview').length, 1)
      assert.ok(scanner.calls.find(call => Array.isArray(call) && call[0] === 'navigate' && call[1] === 'scan'))
    } finally { scanner.dispose() }
  }
})

test('course V2 admin keeps orders and tickets outside its resource tabs', async () => {
  const source = await read('../src/components/CourseV2AdminPanel.vue')
  assert.match(source, /TicketProduct/)
  assert.match(source, /RedeemScenario/)
  assert.match(source, /現場課務與補登佇列/)
  assert.match(source, /員工權限與教練名冊/)
  assert.match(source, /capability: 'manageCatalog'/)
  assert.match(source, /capability: 'manageAttendance'/)
  assert.match(source, /buildCourseSettingsPayload/)
  assert.match(source, /buildCourseTicketProductPayload/)
  assert.doesNotMatch(source, /key: 'orders'|key: 'tickets'/)
})

test('course V2 admin tabs support canonical focused surfaces and keyboard navigation', async () => {
  const source = await read('../src/components/CourseV2AdminPanel.vue')

  assert.match(source, /initialTab: \{ type: String, default: '' \}/)
  assert.match(source, /allowedTabs: \{ type: Array, default: \(\) => \[\] \}/)
  assert.match(source, /v-if="tabs\.length > 1"/)
  assert.match(source, /:aria-controls="`course-v2-panel-\$\{item\.key\}`"/)
  assert.match(source, /:tabindex="activeTab === item\.key \? 0 : -1"/)
  assert.match(source, /@keydown="onTabKeydown\(\$event, index\)"/)
  assert.match(source, /role="tabpanel"/)
  assert.match(source, /interactive-press[^"]*focus-visible:ring-2[^"]*motion-reduce:transition-none/)
  assert.match(source, /:role="messageTone === 'error' \? 'alert' : 'status'"/)
  assert.match(source, /<AppOverlayPanel[\s\S]*placement="right"/)
  assert.match(source, /<CourseResourceState/)
  assert.match(source, /ref="editorErrorRef"[\s\S]*role="alert"[\s\S]*tabindex="-1"/)
  assert.match(source, /:close-on-backdrop="!saving"/)
  assert.match(source, /:close-on-escape="!saving"/)
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.match(source, new RegExp(key))
})

test('canonical course admin tasks delegate V2 resources to the real panel', async () => {
  const source = await read('../src/pages/course-admin.vue')

  assert.match(source, /'redeem-contexts': \{ initialTab: 'ticket-products', allowedTabs: \['ticket-products', 'scenarios', 'sessions'\] \}/)
  assert.match(source, /reports: \{ initialTab: 'reports', allowedTabs: \['reports'\] \}/)
  assert.match(source, /settings: \{ initialTab: 'settings', allowedTabs: \['settings'\] \}/)
  assert.match(source, /<CourseV2AdminPanel\s+v-if="productizedV2PanelConfig"/)
  assert.match(source, /:initial-tab="productizedV2PanelConfig\.initialTab"/)
  assert.match(source, /:allowed-tabs="productizedV2PanelConfig\.allowedTabs"/)
  assert.doesNotMatch(source, /'redeem-contexts': '\/admin\/courses\/redeem-scenarios'/)
})

test('course admin editors use accessible overlay primitives and sticky actions', async () => {
  const source = await read('../src/pages/course-admin.vue')

  assert.match(source, /<AppOverlayPanel[\s\S]*placement="right"[\s\S]*@update:model-value="handleDialogModelValue"/)
  assert.doesNotMatch(source, /<transition name="drawer-right"><aside/)
  assert.match(source, /id="course-productized-editor"/)
  assert.match(source, /<template #actions><button type="submit" form="course-productized-editor"/)
})

test('course admin canonical tasks support the original admin shell and a focused coach frame', async () => {
  const source = await read('../src/pages/course-admin.vue')

  assert.match(source, /import CourseCenterShell from '\.\.\/components\/CourseCenterShell\.vue'/)
  assert.match(source, /<CourseAdminFrame[\s\S]*:embedded="embedded && !coachSurface"[\s\S]*:tasks="coachSurface \? \[\] : adminCourseTasks"[\s\S]*:active-key="adminTask\.key"/)
  assert.match(source, /path: task\.path \|\| `\/admin\/courses\/\$\{task\.key\}`/)
  assert.match(source, /if \(!frameProps\.embedded\)[\s\S]*h\(CourseCenterShell/)
  assert.match(source, /h\('div', \{ \.\.\.attrs, class: \['space-y-5', attrs\.class\] \}/)
  assert.match(source, /#header-actions/)
  assert.match(source, /#context/)
})

test('course V2 reports use immutable-event metrics, server filters and student insight labels', async () => {
  const source = await read('../src/components/CourseV2AdminPanel.vue')

  assert.match(source, /reportFilters = reactive\(\{ from: '', to: '', scenarioId: '', coachProfileId: '', location: '', inactiveDays: 90 \}\)/)
  assert.match(source, /successConsumedUses/)
  assert.match(source, /uniqueSuccessStudents/)
  assert.doesNotMatch(source, /attendanceRate/)
  assert.match(source, /item\.studentId \|\| item\.id/)
  assert.match(source, /item\.displayName \|\| item\.name/)
  assert.match(source, /item\.labels \|\| \[\]/)
  assert.match(source, /item\.expiredRemainingUses/)
  assert.match(source, /loadReportDimensions/)
  assert.match(source, /COURSE_V2_ENDPOINTS\.coachProfiles/)
  assert.match(source, /formatTicketSources\(item\)/)
  assert.match(source, /自購/)
  assert.match(source, /下單購買/)
  assert.match(source, /轉贈/)
  for (const field of ['from', 'to', 'scenarioId', 'coachProfileId', 'location']) {
    assert.match(source, new RegExp(`reportFilters\\.${field}`))
  }
})

test('course V2 admin scopes every resource request to the selected tenant', async () => {
  const admin = await read('../src/pages/admin.vue')
  const courseAdmin = await read('../src/pages/course-admin.vue')
  const panel = await read('../src/components/CourseV2AdminPanel.vue')

  assert.match(admin, /:memberships="courseStaffAccess\.memberships"/)
  assert.match(courseAdmin, /:memberships="props\.memberships"/)
  assert.match(courseAdmin, /:provider-options="providerOptions"/)
  assert.match(panel, /const showTenantSelector = computed\(\(\) => !props\.embeddedTenantContext && \(isAdmin\.value \|\| tenantOptions\.value\.length > 1\)\)/)
  assert.match(panel, /ownerUserId: \{ type: \[String, Number\], default: '' \}/)
  assert.match(panel, /defineEmits\(\['update:ownerUserId'\]\)/)
  assert.match(panel, /function tenantScopeParams\(extra = \{\}\)/)
  assert.match(panel, /function tenantScopeBody\(body = \{\}\)/)
  assert.match(panel, /ownerUserId: selectedOwnerUserId\.value \|\| null/)
  assert.match(panel, /params: tenantScopeParams\(\)/)
  assert.match(panel, /tenantScopeBody\(buildCourseTicketProductPayload\(form\)\)/)
  assert.match(panel, /tenantScopeBody\(buildCourseScenarioPayload\(form\)\)/)
  assert.match(panel, /resetTenantScopedState\(\)/)
  assert.match(panel, /tenantAbortController\.abort\(\)/)
  assert.match(panel, /signal: tenantAbortController\.signal/)
  assert.match(panel, /if \(activeTab\.value\) await selectTab\(activeTab\.value\)/)
})

test('course session form assigns a same-tenant coach profile without granting permissions', async () => {
  const source = await read('../src/pages/course-admin.vue')

  assert.match(source, /v-model="sessionForm\.coachProfileId"/)
  assert.match(source, /\/admin\/courses\/coach-profiles/)
  assert.match(source, /params: \{ ownerUserId: scopedOwnerUserId \}/)
  assert.match(source, /coachProfileId: sessionForm\.value\.coachProfileId \? Number\(sessionForm\.value\.coachProfileId\) : null/)
  assert.match(source, /名冊僅供場次指派，不會授予後台權限/)
})

test('course sales plan keeps new-student add-ons separate from returning-only eligibility', async () => {
  const admin = await read('../src/pages/course-admin.vue')
  const store = await read('../src/pages/courses.vue')
  const utility = await read('../src/utils/courseV2.js')

  assert.match(admin, /v-model="productForm\.requireAddonForNew"/)
  assert.match(admin, /非舊生仍可購買/)
  assert.match(admin, /payload\.requireAddonForNew = Boolean\(productForm\.value\.requireAddonForNew\)/)
  assert.doesNotMatch(admin, /v-model="productForm\.returningStudentOnly"/)
  assert.match(store, /normalizeCourseProduct/)
  assert.match(store, /非舊生需強制加購/)
  const previewNormalizer = utility.slice(
    utility.indexOf('export function normalizeCourseOrderPreview'),
    utility.indexOf('export function normalizeCourseStaffAccess')
  )
  assert.match(previewNormalizer, /payload\.eligible/)
  assert.doesNotMatch(previewNormalizer, /!\(returningStudentOnly && returningEligible === false\)/)
})

test('course V2 policy forms expose ticket, scenario and edge redemption windows', async () => {
  const source = await read('../src/components/CourseV2AdminPanel.vue')
  const utility = await read('../src/utils/courseV2.js')

  assert.match(source, /ticketProductForm\.redeemOpenMinutesBefore/)
  assert.match(source, /ticketProductForm\.redeemCloseMinutesAfter/)
  assert.match(source, /scenarioForm\.redeemOpenMinutesBefore/)
  assert.match(source, /scenarioForm\.redeemCloseMinutesAfter/)
  assert.match(source, /scenarioForm\.edgePolicies\[product\.id\]\.redeemOpenMinutesBefore/)
  assert.match(source, /scenarioForm\.edgePolicies\[product\.id\]\.redeemCloseMinutesAfter/)
  assert.match(utility, /redemptionPolicy: \{/)
  assert.match(utility, /source\.edgePolicies\?\.\[ticketProductId\]\?\.redeemOpenMinutesBefore/)
})

test('attendance invite expiry is derived by the server policy', async () => {
  const source = await read('../src/components/CourseV2AdminPanel.vue')
  const inviteMutation = source.slice(
    source.indexOf('async function createAttendanceInvite'),
    source.indexOf('async function loadInvites')
  )

  assert.match(source, /邀請到期與自動核銷時間由伺服器依有效的租戶／平台政策決定/)
  assert.doesNotMatch(inviteMutation, /expiresInMinutes|expiresAt|Date\.now/)
})

test('course admin mutations carry V2 preconditions and use canonical order actions', async () => {
  const admin = await read('../src/pages/admin.vue')
  const source = await read('../src/pages/course-admin.vue')

  assert.equal((admin.match(/:course-v2-enabled="Boolean\(courseStaffAccess\.enabled\)"/g) || []).length, 3)
  assert.match(source, /courseV2Enabled: \{ type: Boolean, default: false \}/)
  assert.match(source, /normalized\.rowVersion = item\.rowVersion \?\? item\.row_version \?\? item\.version \?\? item\.lockVersion \?\? ''/)
  for (const mutationPrefix of [
    'course-product-create',
    'course-product-update',
    'course-product-archive',
    'course-session-create',
    'course-session-update',
    'course-session-cancel',
    'course-ticket-manual-issue',
  ]) {
    assert.match(source, new RegExp(`courseMutationConfig\\([^\\n]*['"]${mutationPrefix}['"]`))
  }
  assert.match(source, /function isCourseMutationPreconditionFailure\(error\)/)
  assert.match(source, /Number\(error\?\.response\?\.status \|\| 0\) === 428/)
  assert.match(source, /await reloadCourseMutationConflict\(error, '(products|sessions|orders)'/)
  assert.match(source, /\/admin\/courses\/orders\/bulk-actions/)
  assert.match(source, /\/admin\/courses\/orders\/\$\{order\.id\}\/actions\/\$\{action\.value\}/)
  assert.match(source, /orderMutationHeaders\(order, attempt\.idempotencyKey\)/)
  assert.match(source, /data\?\.data\?\.items/)
  assert.match(source, /const bulkOrderMutationEnabled = computed\(\(\) => true\)/)
  assert.match(source, /hasOrderCapability\(order, action\.capability\)/)
})

test('manual course issuance makes returning eligibility an explicit audited decision', async () => {
  const source = await read('../src/pages/course-admin.vue')
  const mutation = source.slice(
    source.indexOf('async function issueManualTicket'),
    source.indexOf('async function openTicketDetail')
  )

  assert.match(source, /v-model="ticketForm\.countsTowardReturningEligibility"/)
  assert.match(source, /v-model\.trim="ticketForm\.reason"/)
  assert.match(source, /是否計入舊生必須逐張明確決定/)
  assert.match(mutation, /countsTowardReturningEligibility: countsTowardReturningEligibility === 'yes'/)
  assert.match(mutation, /!ticketForm\.value\.reason\.trim\(\)/)
  assert.match(mutation, /course-ticket-manual-issue/)
})

test('legacy admins can open a course form without a TicketProduct dependency', async () => {
  const source = await read('../src/pages/course-admin.vue')

  assert.match(source, /新增課程/)
  assert.match(source, /props\.courseV2Enabled && Object\.values\(props\.capabilities \|\| \{\}\)\.some\(Boolean\)/)
  assert.match(source, /v-if="courseV2Enabled" label="發行 TicketProduct"/)
  assert.match(source, /if \(props\.courseV2Enabled\) loadTicketProductChoices\(\)/)
  assert.match(source, /delete payload\.ticketProductId/)
  assert.match(source, /delete payload\.requireAddonForNew/)
  assert.match(source, /v-if="isAdmin && !editingId" label="課程歸屬"/)
  assert.match(source, /payload\.ownerUserId = ownerUserId \|\| null/)
})

test('course and ticket product codes are generated instead of entered manually', async () => {
  const admin = await read('../src/pages/course-admin.vue')
  const panel = await read('../src/components/CourseV2AdminPanel.vue')

  assert.match(admin, /課程代碼.*儲存時由系統自動產生/)
  assert.doesNotMatch(admin, /v-model(?:\.trim)?="productForm\.code"/)
  assert.match(panel, /票種代碼會在儲存時由系統自動產生/)
  assert.doesNotMatch(panel, /v-model(?:\.trim)?="ticketProductForm\.code"/)
  assert.match(panel, /delete payload\.code/)
})

test('course admin and route guard use server staff capabilities without promoting COACH', async () => {
  const admin = await read('../src/pages/admin.vue')
  const courseAdmin = await read('../src/pages/course-admin.vue')
  const router = await read('../src/router/router.js')
  const whoamiIndex = router.indexOf('`${API_BASE}/whoami`')
  const staffAccessIndex = router.indexOf('COURSE_V2_ENDPOINTS.staffMe')
  assert.match(admin, /COURSE_V2_ENDPOINTS\.staffMe/)
  assert.match(admin, /hasCourseAdminCapability/)
  assert.match(admin, /normalizeCourseStaffAccess\(data, \{ platformRole \}\)/)
  assert.match(admin, /courseAccessState\.value = classifyCourseStaffAccessError\(error\)/)
  assert.match(admin, /query: \{ redirect: route\.fullPath \}/)
  assert.match(admin, /課程權限服務暫時無法載入/)
  assert.doesNotMatch(admin, /raw === 'STORE' \|\| raw === 'COACH'/)
  assert.doesNotMatch(courseAdmin, /role === 'STORE' \|\| role === 'COACH'/)
  assert.ok(whoamiIndex >= 0 && whoamiIndex < staffAccessIndex, 'whoami refreshes before staff access')
  assert.match(router, /loadCourseStaffAccessForGuard/)
  assert.match(router, /setUserProfile\(user\)/)
  assert.match(router, /normalizeCourseStaffAccess\(data, \{ platformRole \}\)/)
  assert.match(router, /state === 'unauthorized'[\s\S]{0,180}redirect: to\.fullPath/)
  assert.doesNotMatch(router, /requestedTab === 'courses' && !canManageCourses/)
  assert.doesNotMatch(router, /'STORE','COACH'/)
})
