import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileTemplate, parse } from '@vue/compiler-sfc'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

const assertTemplateCompiles = (source, filename) => {
  const { descriptor, errors: parseErrors } = parse(source, { filename })
  assert.deepEqual(parseErrors, [])
  const result = compileTemplate({
    source: descriptor.template?.content || '',
    filename,
    id: filename,
  })
  assert.deepEqual(result.errors, [])
}

test('mobile admin filter sheet has a named dialog and programmatic field labels', async () => {
  const source = await read('../src/components/AdminFilterSheet.vue')

  assertTemplateCompiles(source, 'AdminFilterSheet.vue')
  assert.match(source, /<AppBottomSheet[\s\S]*?:title="title"[\s\S]*?description="條件會套用到全部資料/)
  assert.match(source, /aria-haspopup="dialog"/)
  assert.match(source, /:aria-expanded="open"/)
  assert.match(source, /<label :for="fieldId\(column, field\)"/)
  assert.match(source, /<fieldset v-if="field\.type === 'multi'">[\s\S]*?<legend/)
  assert.match(source, /:for="optionId\(column, field, optionIndex\)"[\s\S]*?:id="optionId\(column, field, optionIndex\)"/)
  assert.match(source, /data-overlay-initial-focus/)
  assert.match(source, /defineEmits\(\['update:modelValue', 'apply'\]\)/)
})

test('table column filter exposes popover state and supports keyboard focus lifecycle', async () => {
  const source = await read('../src/components/TableColumnFilter.vue')

  assertTemplateCompiles(source, 'TableColumnFilter.vue')
  assert.match(source, /:aria-expanded="open"/)
  assert.match(source, /:aria-controls="panelId"/)
  assert.match(source, /:id="panelId"[\s\S]*?role="dialog"[\s\S]*?:aria-labelledby="panelTitleId"/)
  assert.match(source, /<label :for="localSearchId" class="sr-only">/)
  assert.match(source, /:for="serverOptionId\(field, optionIndex\)"[\s\S]*?:id="serverOptionId\(field, optionIndex\)"/)
  assert.match(source, /:for="allOptionsId"[\s\S]*?:id="allOptionsId"/)
  assert.match(source, /:for="localOptionId\(optionIndex\)"[\s\S]*?:id="localOptionId\(optionIndex\)"/)
  assert.match(source, /data-filter-initial-focus/)
  assert.match(source, /function focusInitialControl\(\)[\s\S]*?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(source, /function handlePanelKeydown\(event\)[\s\S]*?event\.key !== 'Escape'[\s\S]*?closePanel\(\)/)
  assert.match(source, /document\.addEventListener\('click', handleOutsideClick\)/)
  assert.match(source, /function closePanel\([\s\S]*?focusTrigger\(\)/)
  assert.match(source, /trigger\.value\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(source, /defineEmits\(\['update:modelValue', 'apply'\]\)/)
})
