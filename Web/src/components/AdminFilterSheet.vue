<template>
  <div :class="containerClass">
    <button type="button" class="btn btn-outline btn-sm w-full" @click="openSheet">
      <AppIcon name="filter" class="h-4 w-4" />
      欄位篩選<span v-if="activeCount">（{{ activeCount }}）</span>
    </button>
    <AppBottomSheet v-model="open">
      <div class="space-y-4">
        <div>
          <h3 class="ui-title text-lg font-medium text-primary">{{ title }}</h3>
          <p class="mt-1 text-sm text-gray-600">條件會套用到全部資料，不只目前頁。</p>
        </div>
        <section v-for="column in columns" :key="column.key" class="border-y border-gray-200 py-3">
          <h4 class="mb-2 text-sm font-semibold text-gray-800">{{ column.label }}</h4>
          <div class="space-y-3">
            <div v-for="field in column.fields || []" :key="field.key" class="space-y-1">
              <label class="text-sm text-gray-600">{{ field.label || column.label }}</label>
              <input
                v-if="field.type === 'date'"
                v-model="fieldDraft(column.key, field.key).value"
                type="date"
                class="border px-3 py-2 w-full"
              />
              <select
                v-else-if="field.type === 'select'"
                v-model="fieldDraft(column.key, field.key).value"
                class="border px-3 py-2 w-full"
              >
                <option value="">{{ field.placeholder || '全部' }}</option>
                <option v-for="option in field.options || []" :key="String(option.value)" :value="option.value">{{ option.label }}</option>
              </select>
              <div v-else-if="field.type === 'multi'" class="grid grid-cols-2 gap-2">
                <label v-for="option in field.options || []" :key="String(option.value)" class="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    :checked="multiSelected(column.key, field.key, option.value)"
                    @change="toggleMulti(column.key, field.key, option.value, $event.target.checked)"
                  />
                  {{ option.label }}
                </label>
              </div>
              <input
                v-else
                v-model.trim="fieldDraft(column.key, field.key).value"
                type="text"
                class="border px-3 py-2 w-full"
                :placeholder="field.placeholder || `搜尋${field.label || column.label}`"
              />
            </div>
          </div>
        </section>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="btn btn-outline" @click="clearAll">清除全部</button>
          <button type="button" class="btn btn-primary" @click="applyAll">套用篩選</button>
        </div>
      </div>
    </AppBottomSheet>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
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
