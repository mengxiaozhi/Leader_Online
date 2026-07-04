<template>
  <div ref="root" class="table-filter" :class="{ 'table-filter--active': hasFilter }">
    <button
      type="button"
      class="table-filter__button"
      :title="`篩選 ${label}`"
      @click="open = !open"
    >
      <span class="table-filter__label">{{ label }}</span>
      <AppIcon name="filter" class="h-3.5 w-3.5" />
    </button>

    <div v-if="open" class="table-filter__panel" role="dialog" :aria-label="`篩選 ${label}`">
      <input
        v-model.trim="query"
        class="table-filter__search"
        :placeholder="`搜尋${label}`"
      />
      <div class="table-filter__summary">
        {{ selectedCountText }}
      </div>
      <div class="table-filter__options">
        <label class="table-filter__option table-filter__option--all">
          <input
            type="checkbox"
            :checked="allVisibleSelected"
            :disabled="!visibleOptions.length"
            @change="toggleVisible($event.target.checked)"
          />
          <span>全選目前項目</span>
        </label>
        <label
          v-for="option in visibleOptions"
          :key="option.key"
          class="table-filter__option"
        >
          <input
            type="checkbox"
            :checked="isSelected(option.key)"
            @change="toggleOption(option.key, $event.target.checked)"
          />
          <span class="table-filter__option-label">{{ option.label }}</span>
          <span class="table-filter__count">{{ option.count }}</span>
        </label>
      </div>
      <div class="table-filter__actions">
        <button type="button" class="table-filter__action" @click="clearFilter">清除</button>
        <button type="button" class="table-filter__action table-filter__action--primary" @click="open = false">完成</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  label: { type: String, required: true },
  rows: { type: Array, default: () => [] },
  value: { type: Function, required: true },
  modelValue: { type: Array, default: null },
})

const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const query = ref('')
const root = ref(null)

const normalizeFilterValue = (value) => {
  if (Array.isArray(value)) return value.map(normalizeFilterValue).join(' / ')
  if (value === null || value === undefined || value === '') return '空白'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

const options = computed(() => {
  const map = new Map()
  for (const row of props.rows || []) {
    const label = normalizeFilterValue(props.value(row))
    const key = label.toLowerCase()
    const current = map.get(key)
    if (current) {
      current.count += 1
    } else {
      map.set(key, { key, label, count: 1 })
    }
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
})

const visibleOptions = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return options.value
  return options.value.filter((option) => option.label.toLowerCase().includes(q))
})

const allKeys = computed(() => options.value.map((option) => option.key))
const selectedKeys = computed(() => Array.isArray(props.modelValue) ? props.modelValue : null)
const hasFilter = computed(() => Array.isArray(selectedKeys.value))

const selectedCountText = computed(() => {
  if (!options.value.length) return '目前沒有可篩選項目'
  if (!hasFilter.value) return `全部 ${options.value.length} 個項目`
  return `已選 ${selectedKeys.value.length} / ${options.value.length}`
})

const selectedSet = computed(() => new Set(selectedKeys.value || []))
const isSelected = (key) => !hasFilter.value || selectedSet.value.has(key)
const allVisibleSelected = computed(() => {
  if (!visibleOptions.value.length) return false
  return visibleOptions.value.every((option) => isSelected(option.key))
})

function emitSelection(nextKeys) {
  const valid = new Set(allKeys.value)
  const unique = Array.from(new Set(nextKeys)).filter((key) => valid.has(key))
  emit('update:modelValue', unique.length === allKeys.value.length ? null : unique)
}

function currentSelection() {
  return hasFilter.value ? [...selectedKeys.value] : [...allKeys.value]
}

function toggleOption(key, checked) {
  const selected = new Set(currentSelection())
  if (checked) selected.add(key)
  else selected.delete(key)
  emitSelection([...selected])
}

function toggleVisible(checked) {
  const selected = new Set(currentSelection())
  for (const option of visibleOptions.value) {
    if (checked) selected.add(option.key)
    else selected.delete(option.key)
  }
  emitSelection([...selected])
}

function clearFilter() {
  emit('update:modelValue', null)
}

function handleOutsideClick(event) {
  const el = root.value
  if (!el || el.contains(event.target)) return
  open.value = false
}

onMounted(() => document.addEventListener('click', handleOutsideClick))
onBeforeUnmount(() => document.removeEventListener('click', handleOutsideClick))
watch(open, (value) => {
  if (!value) query.value = ''
})
</script>

<style scoped>
.table-filter {
  position: relative;
  display: inline-flex;
  max-width: 100%;
}

.table-filter__button {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  width: 100%;
  min-width: 0;
  color: inherit;
  font: inherit;
  text-align: left;
}

.table-filter__button:hover {
  color: var(--color-primary, #c53030);
}

.table-filter--active .table-filter__button {
  color: var(--color-primary, #c53030);
}

.table-filter__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-filter__panel {
  position: absolute;
  top: calc(100% + 0.35rem);
  left: 0;
  z-index: 45;
  width: min(18rem, 80vw);
  border: 1px solid #d1d5db;
  background: #fff;
  box-shadow: 0 18px 35px -20px rgba(15, 23, 42, 0.35);
  padding: 0.75rem;
}

.table-filter__search {
  width: 100%;
  border: 1px solid #d1d5db;
  padding: 0.45rem 0.6rem;
  font-size: 0.875rem;
}

.table-filter__summary {
  margin-top: 0.5rem;
  color: #6b7280;
  font-size: 0.75rem;
}

.table-filter__options {
  margin-top: 0.5rem;
  max-height: 14rem;
  overflow: auto;
  border: 1px solid #e5e7eb;
}

.table-filter__option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.55rem;
  border-bottom: 1px solid #f3f4f6;
  color: #374151;
  font-size: 0.8125rem;
  font-weight: 400;
  text-transform: none;
}

.table-filter__option:last-child {
  border-bottom: 0;
}

.table-filter__option--all {
  background: #f9fafb;
  color: #111827;
  font-weight: 500;
}

.table-filter__option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-filter__count {
  color: #9ca3af;
  font-size: 0.75rem;
}

.table-filter__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.table-filter__action {
  border: 1px solid #d1d5db;
  background: #fff;
  padding: 0.35rem 0.7rem;
  color: #374151;
  font-size: 0.8125rem;
}

.table-filter__action--primary {
  border-color: var(--color-primary, #c53030);
  background: var(--color-primary, #c53030);
  color: #fff;
}
</style>
