<template>
  <div class="admin-filter-controls">
    <button
      type="button"
      class="btn btn-outline btn-sm w-full"
      :class="containerClass"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="openSheet"
    >
      <AppIcon name="filter" class="h-4 w-4" />
      欄位篩選<span v-if="activeCount">（{{ activeCount }}）</span>
    </button>
    <div v-if="activeFilters.length" class="admin-filter-summary" aria-label="已套用的欄位篩選">
      <span class="admin-filter-summary__label">篩選條件</span>
      <button v-for="filter in activeFilters" :key="filter.id" type="button" class="admin-filter-chip" :aria-label="`移除篩選：${filter.label}`" @click="removeFilter(filter)">
        <span>{{ filter.label }}</span><AppIcon name="x" class="h-3.5 w-3.5 shrink-0" />
      </button>
      <button type="button" class="admin-filter-reset" @click="clearAll">清除全部欄位</button>
    </div>
    <span class="sr-only" role="status">{{ activeCount ? `已套用 ${activeCount} 項欄位篩選` : '' }}</span>
    <AppBottomSheet
      v-model="open"
      :title="title"
      description="條件會套用到全部資料，不只目前頁。"
    >
      <div class="space-y-4">
        <section v-for="column in columns" :key="column.key" class="border-y border-gray-200 py-3">
          <h4 class="mb-2 text-sm font-semibold text-gray-800">{{ column.label }}</h4>
          <div class="space-y-3">
            <div v-for="field in column.fields || []" :key="field.key" class="space-y-1">
              <fieldset v-if="field.type === 'multi'">
                <legend class="text-sm text-gray-600">{{ field.label || column.label }}</legend>
                <div class="mt-1 grid grid-cols-2 gap-2">
                  <label
                    v-for="(option, optionIndex) in field.options || []"
                    :key="String(option.value)"
                    :for="optionId(column, field, optionIndex)"
                    class="flex min-h-11 items-center gap-2 text-sm text-gray-700"
                  >
                    <input
                      :id="optionId(column, field, optionIndex)"
                      type="checkbox"
                      :data-overlay-initial-focus="isInitialField(column, field) && optionIndex === 0 ? '' : undefined"
                      :checked="multiSelected(column.key, field.key, option.value)"
                      @change="toggleMulti(column.key, field.key, option.value, $event.target.checked)"
                    />
                    {{ option.label }}
                  </label>
                </div>
              </fieldset>
              <template v-else>
                <label :for="fieldId(column, field)" class="text-sm text-gray-600">
                  {{ field.label || column.label }}
                </label>
                <input
                  v-if="field.type === 'date'"
                  :id="fieldId(column, field)"
                  v-model="fieldDraft(column.key, field.key).value"
                  type="date"
                  class="min-h-11 w-full border px-3 py-2"
                  :data-overlay-initial-focus="isInitialField(column, field) ? '' : undefined"
                />
                <select
                  v-else-if="field.type === 'select'"
                  :id="fieldId(column, field)"
                  v-model="fieldDraft(column.key, field.key).value"
                  class="min-h-11 w-full border px-3 py-2"
                  :data-overlay-initial-focus="isInitialField(column, field) ? '' : undefined"
                >
                  <option value="">{{ field.placeholder || '全部' }}</option>
                  <option v-for="option in field.options || []" :key="String(option.value)" :value="option.value">{{ option.label }}</option>
                </select>
                <input
                  v-else
                  :id="fieldId(column, field)"
                  v-model.trim="fieldDraft(column.key, field.key).value"
                  type="text"
                  class="min-h-11 w-full border px-3 py-2"
                  :data-overlay-initial-focus="isInitialField(column, field) ? '' : undefined"
                  :placeholder="field.placeholder || `搜尋${field.label || column.label}`"
                />
              </template>
            </div>
          </div>
        </section>
      </div>
      <template #actions>
        <div class="grid w-full grid-cols-2 gap-2">
          <button type="button" class="btn btn-outline" @click="clearAll">清除全部</button>
          <button type="button" class="btn btn-primary" @click="applyAll">套用篩選</button>
        </div>
      </template>
    </AppBottomSheet>
  </div>
</template>

<script setup>
import { computed, ref, useId } from 'vue'
import AppBottomSheet from './AppBottomSheet.vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  columns: { type: Array, default: () => [] },
  title: { type: String, default: '欄位篩選' },
  containerClass: { type: String, default: 'md:hidden' },
})

const emit = defineEmits(['update:modelValue', 'apply'])
const open = ref(false)
const draft = ref({})
const instanceId = `admin-filter-${useId()}`

const safeIdPart = value => encodeURIComponent(String(value ?? ''))
  .replace(/%/g, '')
  .replace(/[^a-zA-Z0-9_-]+/g, '-')

const initialField = computed(() => {
  for (const column of props.columns || []) {
    const field = column.fields?.[0]
    if (field) return `${String(column.key)}:${String(field.key)}`
  }
  return ''
})

function fieldId(column, field) {
  return `${instanceId}-${safeIdPart(column.key)}-${safeIdPart(field.key)}`
}

function optionId(column, field, optionIndex) {
  return `${fieldId(column, field)}-option-${optionIndex}`
}

function isInitialField(column, field) {
  return initialField.value === `${String(column.key)}:${String(field.key)}`
}

const clone = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [key, {}]
    return [key, Object.fromEntries(Object.entries(item).map(([field, fieldValue]) => [field, Array.isArray(fieldValue) ? [...fieldValue] : fieldValue]))]
  }))
}

const meaningful = (value) => Array.isArray(value)
  ? value.length > 0
  : String(value ?? '').trim().length > 0

const normalize = (value) => {
  const result = {}
  for (const [columnKey, fields] of Object.entries(clone(value))) {
    const normalizedFields = {}
    for (const [fieldKey, fieldValue] of Object.entries(fields)) {
      if (!meaningful(fieldValue)) continue
      normalizedFields[fieldKey] = Array.isArray(fieldValue)
        ? Array.from(new Set(fieldValue.map(String).filter(Boolean)))
        : (typeof fieldValue === 'string' ? fieldValue.trim() : fieldValue)
    }
    if (Object.keys(normalizedFields).length) result[columnKey] = normalizedFields
  }
  return result
}

const activeCount = computed(() => Object.values(normalize(props.modelValue)).reduce((count, fields) => count + Object.keys(fields).length, 0))
const activeFilters = computed(() => props.columns.flatMap(column => (column.fields || []).flatMap(field => {
  const value = props.modelValue?.[column.key]?.[field.key]
  if (!meaningful(value)) return []
  const values = Array.isArray(value) ? value : [value]
  const labels = values.map(item => field.options?.find(option => String(option.value) === String(item))?.label ?? String(item))
  return [{ id: `${column.key}:${field.key}`, column: column.key, field: field.key, label: `${field.label || column.label}：${labels.join('、')}` }]
})))

function removeFilter(filter) {
  const value = clone(props.modelValue)
  delete value[filter.column]?.[filter.field]
  const normalized = normalize(value)
  emit('update:modelValue', normalized)
  emit('apply', normalized)
}

function openSheet() {
  draft.value = clone(props.modelValue)
  open.value = true
}

function fieldDraft(columnKey, fieldKey) {
  if (!draft.value[columnKey]) draft.value[columnKey] = {}
  return {
    get value() { return draft.value[columnKey][fieldKey] ?? '' },
    set value(next) { draft.value[columnKey][fieldKey] = next },
  }
}

function multiSelected(columnKey, fieldKey, value) {
  const selected = draft.value?.[columnKey]?.[fieldKey]
  return Array.isArray(selected) && selected.map(String).includes(String(value))
}

function toggleMulti(columnKey, fieldKey, value, checked) {
  if (!draft.value[columnKey]) draft.value[columnKey] = {}
  const selected = new Set(Array.isArray(draft.value[columnKey][fieldKey]) ? draft.value[columnKey][fieldKey].map(String) : [])
  const normalized = String(value)
  if (checked) selected.add(normalized)
  else selected.delete(normalized)
  draft.value[columnKey][fieldKey] = Array.from(selected)
}

function applyAll() {
  const value = normalize(draft.value)
  emit('update:modelValue', value)
  emit('apply', value)
  open.value = false
}

function clearAll() {
  draft.value = {}
  emit('update:modelValue', {})
  emit('apply', {})
  open.value = false
}
</script>

<style scoped>
.admin-filter-summary { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-top: .75rem; }
.admin-filter-summary__label { color: #64748b; font-size: .75rem; }
.admin-filter-chip { display: inline-flex; align-items: center; gap: .45rem; min-height: 36px; max-width: 100%; padding: .4rem .65rem; border: 1px solid #e3c9cc; border-radius: .5rem; background: #fcf3f3; color: #923138; font-size: .8125rem; text-align: left; }
.admin-filter-chip span { overflow-wrap: anywhere; }
.admin-filter-reset { min-height: 36px; padding: .4rem; font-size: .8125rem; color: #475569; text-decoration: underline; text-underline-offset: 3px; }
.admin-filter-chip:focus-visible, .admin-filter-reset:focus-visible { outline: 2px solid #a9363c; outline-offset: 2px; }
@media (pointer: coarse) { .admin-filter-chip, .admin-filter-reset { min-height: 44px; } }
</style>
