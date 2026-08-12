import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('course center shell provides focused route-aware wayfinding and extension slots', async () => {
  const source = await read('../src/components/CourseCenterShell.vue')

  for (const prop of ['title', 'description', 'eyebrow', 'tasks', 'activeKey', 'navLabel']) {
    assert.match(source, new RegExp(`${prop}:`))
  }
  for (const slot of ['breadcrumb', 'header-actions', 'context']) {
    assert.match(source, new RegExp(`name="${slot}"`))
  }
  assert.match(source, /course-center-shell/)
  assert.match(source, /course-task-nav/)
  assert.match(source, /task\.icon/)
  assert.match(source, /task\?\.to \|\| task\?\.path/)
  assert.match(source, /aria-current="isActive\(task\) \? 'page'/)
  assert.match(source, /interactive-press/)
  assert.match(source, /scrollIntoView/)
  assert.match(source, /defineEmits\(\['select'\]\)/)
})

test('course resource state preserves existing results during refresh and exposes recovery', async () => {
  const source = await read('../src/components/CourseResourceState.vue')

  assert.match(source, /loading && !hasContent/)
  assert.match(source, /error && !hasContent/)
  assert.match(source, /v-else-if="empty"/)
  assert.match(source, /course-resource-state__refreshing/)
  assert.match(source, /role="status"/)
  assert.match(source, /role="alert"/)
  assert.match(source, /aria-busy/)
  assert.match(source, /defineEmits\(\['retry'\]\)/)
})

test('focused course rail shares existing tokens and accessibility fallbacks', async () => {
  const source = await read('../src/tailwind.css')

  for (const selector of [
    '.course-task-nav',
    '.course-task-nav__item',
    '.course-search-toolbar',
    '.course-result-list',
    '.course-action-dock',
    '.course-resource-state',
  ]) assert.match(source, new RegExp(selector.replaceAll('.', '\\.')))

  assert.match(source, /scroll-snap|snap-x/)
  assert.match(source, /--course-task-columns/)
  assert.match(source, /var\(--ui-material-chrome\)/)
  assert.match(source, /env\(safe-area-inset-bottom/)
  assert.match(source, /@media \(hover: hover\) and \(pointer: fine\)/)

  const reducedMotion = source.slice(source.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reducedMotion, /course-task-nav/)
  assert.match(reducedMotion, /course-resource-state__indicator/)

  const reducedTransparency = source.slice(source.indexOf('@media (prefers-reduced-transparency: reduce)'))
  assert.match(reducedTransparency, /course-search-toolbar/)
  assert.match(reducedTransparency, /course-action-dock/)

  const increasedContrast = source.slice(source.indexOf('@media (prefers-contrast: more)'))
  assert.match(increasedContrast, /course-task-nav__item/)
  assert.match(increasedContrast, /course-resource-state__panel/)
})
