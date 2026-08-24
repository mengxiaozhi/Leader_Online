import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('canonical course tasks delegate to the complete operational surfaces', async () => {
  const source = await read('../src/pages/course-admin.vue')

  assert.match(source, /productizedLegacyTab = computed\(\(\) => \(\{ catalog: 'products', schedule: 'sessions', operations: 'bookings' \}\)/)
  assert.match(source, /reloadCanonicalLegacyTask/)
  assert.match(source, /openProductForm\(\)/)
  assert.match(source, /openSessionForm\(\)/)
  assert.match(source, /CourseAttendanceActions/)
  assert.match(source, /計次現場/)
  assert.match(source, /固定班點名／補課/)
  assert.match(source, /staff: \{ initialTab: 'staff', allowedTabs: \['staff'\] \}/)
  assert.doesNotMatch(source, /v-for="item in tabs"/)
})

test('course overview is a daily operations inbox and keeps shared records canonical', async () => {
  const source = await read('../src/pages/course-admin.vue')

  for (const label of ['今日與下一場', '待點名／待判定', '候補與限時名額', '匯款與付款期限', '異常與啟用狀態']) {
    assert.match(source, new RegExp(label))
  }
  assert.match(source, /to="\/admin\?tab=orders&category=course"/)
  assert.match(source, /dailyOperationQueues/)
  assert.doesNotMatch(source, />營運流程</)
})

test('provider context, fixed-term sections and pagination preserve task state', async () => {
  const source = await read('../src/pages/course-admin.vue')

  assert.match(source, /目前服務商/)
  assert.match(source, /sticky top-\[65px\] z-30/)
  assert.match(source, /v-model:owner-user-id="productizedOwnerUserId"/)
  assert.match(source, /:embedded-tenant-context="true"/)
  for (const label of ['班期', '課程計畫與程度', '補課與續報', '保險', '建議下一步']) {
    assert.match(source, new RegExp(label))
  }
  assert.match(source, /visibleProductizedItems/)
  assert.match(source, /productizedPagination/)
  assert.match(source, /<AdminPagination[^>]+@change="changeProductizedPage"/)
  assert.match(source, /placement="right"[\s\S]{0,180}size="xl"/)
})

test('productized loads abort stale requests and retain successful content while refreshing', async () => {
  const source = await read('../src/pages/course-admin.vue')

  assert.match(source, /productizedRequestSequence/)
  assert.match(source, /productizedRequestController\?\.abort\(\)/)
  assert.match(source, /signal: controller\.signal/)
  assert.match(source, /<CourseResourceState[^>]+:has-content="productizedHasContent"/)
  assert.match(source, /已顯示的內容會保留/)
  assert.match(source, /limit: 200, status: 'BOOKED'/)
  assert.doesNotMatch(source, /const params = \{ paged: 1, limit: 100/)
  assert.match(source, /assignProductizedResponseMeta/)
})
