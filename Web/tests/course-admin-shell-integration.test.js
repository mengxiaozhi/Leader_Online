import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ADMIN_COURSE_TASKS } from '../src/utils/courseProductization.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('admin is the single shell for overview and all canonical course tasks', async () => {
  const source = await read('../src/pages/admin.vue')

  assert.deepEqual(ADMIN_COURSE_TASKS.map(item => item.key), [
    'catalog',
    'redeem-contexts',
    'classes',
    'schedule',
    'operations',
    'enrollments',
    'students',
    'reports',
    'settings',
  ])
  assert.equal((source.match(/<main\b/g) || []).length, 1)
  assert.equal((source.match(/<h1\b/g) || []).length, 1)
  assert.match(source, /courseTask:\s*\{\s*type:\s*String/)
  assert.match(source, /ADMIN_COURSE_TASKS\.map\(task => \(\{[\s\S]*?capability:\s*task\.capability/)
  assert.match(source, /const courseAdminTabKeys = \['courses', \.\.\.courseTaskTabs\.map/)
  assert.match(source, /:class="\{ 'admin-nav__tabs--scrollable': groupKey === 'course' \}"/)
  assert.match(source, /:productized-task="activeCourseTask"[\s\S]*?\bembedded\b/)
  assert.match(source, /v-if="!activeCourseTaskDenied"/)
})

test('course task tabs are capability scoped without hiding readiness blockers', async () => {
  const [admin, courseAdmin] = await Promise.all([
    read('../src/pages/admin.vue'),
    read('../src/pages/course-admin.vue'),
  ])
  const accessContract = admin.slice(
    admin.indexOf('const tabAllowedForCurrentUser'),
    admin.indexOf('const displayGroupDefs'),
  )

  assert.match(accessContract, /courseCapabilities\.value\?\.\[tabDefinition\.capability\]/)
  assert.match(accessContract, /\['idle', 'loading'\]\.includes\(courseAccessState\.value\)/)
  assert.doesNotMatch(accessContract, /readiness|fixedTerm|feature/i)
  assert.match(courseAdmin, /fixedTermBlockers/)
  assert.match(courseAdmin, /固定班任務不會被靜默隱藏/)
  assert.match(courseAdmin, /role="alert"/)
})

test('admin task URLs stay synchronized with tabs and browser history', async () => {
  const source = await read('../src/pages/admin.vue')

  assert.match(source, /const adminRouteTargetForTab/)
  assert.match(source, /if \(courseTask\) return \{ path: courseTask\.path \}/)
  assert.match(source, /const query = \{ tab: tabKey \}[\s\S]*?return \{ path: '\/admin', query \}/)
  assert.match(source, /router\.resolve\(target\)\.fullPath !== route\.fullPath/)
  assert.match(source, /watch\(\s*\[\(\) => props\.courseTask, \(\) => route\.query\.tab, \(\) => route\.query\.category\]/)
  assert.match(source, /setTab\(requestedTab, nextIndex, \{ refresh: changed, navigate: false \}\)/)
  assert.match(source, /preserveRequestedCourseTask/)
})

test('course admin supports embedded content while coach pages retain the focused shell', async () => {
  const source = await read('../src/pages/course-admin.vue')

  assert.equal((source.match(/<main\b/g) || []).length, 0)
  assert.equal((source.match(/<h1\b/g) || []).length, 0)
  assert.match(source, /embedded:\s*\{\s*type:\s*Boolean/)
  assert.match(source, /<CourseAdminFrame[\s\S]*?:embedded="embedded && !coachSurface"/)
  assert.match(source, /if \(!frameProps\.embedded\)[\s\S]*?h\(CourseCenterShell/)
  assert.match(source, /children\.push\(\.\.\.\(slots\.default\?\.\(\) \|\| \[\]\)\)/)
  assert.match(source, /defineEmits\(\['navigate'\]\)/)
  assert.match(source, /emit\('navigate', 'scan'\)/)
})

test('course operations use the shared sheet and expose errors as alerts', async () => {
  const [courseAdmin, courseV2] = await Promise.all([
    read('../src/pages/course-admin.vue'),
    read('../src/components/CourseV2AdminPanel.vue'),
  ])
  const combined = `${courseAdmin}\n${courseV2}`

  assert.doesNotMatch(combined, /window\.(?:confirm|prompt|alert)\s*\(/)
  assert.match(courseAdmin, /import \{ showConfirm, showPrompt \} from '\.\.\/utils\/sheet'/)
  assert.match(courseV2, /import \{ showConfirm, showPrompt \} from '\.\.\/utils\/sheet'/)
  assert.match(courseAdmin, /:role="productizedActionTone === 'error' \? 'alert' : 'status'"/)
  assert.match(courseAdmin, /:role="messageType === 'error' \? 'alert' : 'status'"/)
  assert.match(courseV2, /:role="messageTone === 'error' \? 'alert' : 'status'"/)
})
