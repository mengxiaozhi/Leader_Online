import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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

test('store bridges legacy attendance invite links to wallet without persisting token', async () => {
  const source = await read('../src/pages/courses.vue')
  assert.match(source, /bridgeAttendanceInviteDeepLink/)
  assert.match(source, /action: 'attendance-invite'/)
  const bridge = source.slice(source.indexOf('function bridgeAttendanceInviteDeepLink'), source.indexOf('watch(search'))
  assert.doesNotMatch(bridge, /localStorage|console\./)
})

test('desktop and mobile scanner surfaces share course attendance action component', async () => {
  const source = await read('../src/pages/admin.vue')
  assert.equal((source.match(/<CourseAttendanceActions/g) || []).length, 2)
  assert.match(source, /buildCourseMutationHeaders/)
})

test('course V2 admin keeps orders and tickets outside its resource tabs', async () => {
  const source = await read('../src/components/CourseV2AdminPanel.vue')
  assert.match(source, /TicketProduct/)
  assert.match(source, /RedeemScenario/)
  assert.match(source, /現場課務與補登佇列/)
  assert.match(source, /staff membership/)
  assert.match(source, /capability: 'manageCatalog'/)
  assert.match(source, /capability: 'manageAttendance'/)
  assert.match(source, /buildCourseSettingsPayload/)
  assert.match(source, /buildCourseTicketProductPayload/)
  assert.doesNotMatch(source, /key: 'orders'|key: 'tickets'/)
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
  assert.match(panel, /const showTenantSelector = computed\(\(\) => isAdmin\.value \|\| tenantOptions\.value\.length > 1\)/)
  assert.match(panel, /function tenantScopeParams\(extra = \{\}\)/)
  assert.match(panel, /function tenantScopeBody\(body = \{\}\)/)
  assert.match(panel, /ownerUserId: selectedOwnerUserId\.value \|\| null/)
  assert.match(panel, /params: tenantScopeParams\(\)/)
  assert.match(panel, /tenantScopeBody\(buildCourseTicketProductPayload\(form\)\)/)
  assert.match(panel, /tenantScopeBody\(buildCourseScenarioPayload\(form\)\)/)
  assert.match(panel, /resetTenantScopedState\(\)/)
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

test('legacy course admin mutations carry V2 preconditions and reload stale records', async () => {
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
    'course-order-issue',
    'course-order-update',
    'course-ticket-manual-issue',
  ]) {
    assert.match(source, new RegExp(`courseMutationConfig\\([^\\n]*['"]${mutationPrefix}['"]`))
  }
  assert.match(source, /function isCourseMutationPreconditionFailure\(error\)/)
  assert.match(source, /Number\(error\?\.response\?\.status \|\| 0\) === 428/)
  assert.match(source, /await reloadCourseMutationConflict\(error, '(products|sessions|orders)'/)
  assert.match(source, /const bulkOrderMutationEnabled = computed\(\(\) => !props\.courseV2Enabled\)/)
  assert.match(source, /Course V2 需要逐筆驗證訂單版本，批次狀態更新已停用/)
  assert.match(source, /:disabled="!bulkOrderMutationEnabled"/)
})

test('course admin and route guard use server staff capabilities without promoting COACH', async () => {
  const admin = await read('../src/pages/admin.vue')
  const courseAdmin = await read('../src/pages/course-admin.vue')
  const router = await read('../src/router/router.js')
  assert.match(admin, /COURSE_V2_ENDPOINTS\.staffMe/)
  assert.match(admin, /hasCourseAdminCapability/)
  assert.doesNotMatch(admin, /raw === 'STORE' \|\| raw === 'COACH'/)
  assert.doesNotMatch(courseAdmin, /role === 'STORE' \|\| role === 'COACH'/)
  assert.match(router, /loadCourseStaffAccessForGuard/)
  assert.doesNotMatch(router, /'STORE','COACH'/)
})
