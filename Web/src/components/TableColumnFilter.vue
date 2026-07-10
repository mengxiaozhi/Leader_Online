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

    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        class="table-filter__panel"
        :class="{ 'table-filter__panel--server': mode === 'server' }"
        :style="panelStyle"
        role="dialog"
        :aria-label="`篩選 ${label}`"
      >
      <template v-if="mode === 'server'">
        <div class="table-filter__server-fields">
          <div v-for="field in fields" :key="field.key" class="table-filter__field">
            <label class="table-filter__field-label" :for="fieldId(field)">{{ field.label || label }}</label>
            <input
              v-if="field.type === 'date'"
              :id="fieldId(field)"
              v-model="staged[field.key]"
              type="date"
              class="table-filter__search"
            />
            <select
              v-else-if="field.type === 'select'"
              :id="fieldId(field)"
              v-model="staged[field.key]"
              class="table-filter__search"
            >
              <option value="">{{ field.placeholder || '全部' }}</option>
              <option v-for="option in field.options || []" :key="String(option.value)" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <div v-else-if="field.type === 'multi'" class="table-filter__server-options">
              <label v-for="option in field.options || []" :key="String(option.value)" class="table-filter__server-option">
                <input
                  type="checkbox"
                  :checked="serverMultiSelected(field.key, option.value)"
                  @change="toggleServerMulti(field.key, option.value, $event.target.checked)"
                />
                <span>{{ option.label }}</span>
              </label>
            </div>
            <input
              v-else
              :id="fieldId(field)"
              v-model.trim="staged[field.key]"
              type="text"
              class="table-filter__search"
              :placeholder="field.placeholder || `搜尋${field.label || label}`"
              @keydown.enter.prevent="applyServerFilter"
            />
          </div>
        </div>
        <div class="table-filter__actions">
          <button type="button" class="table-filter__action" @click="clearServerFilter">清除</button>
          <button type="button" class="table-filter__action table-filter__action--primary" @click="applyServerFilter">套用</button>
        </div>
      </template>
      <template v-else>
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
      </template>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  label: { type: String, required: true },
  rows: { type: Array, default: () => [] },
  value: { type: Function, default: null },
  modelValue: { type: [Array, Object, String, Number, Boolean], default: null },
  mode: { type: String, default: 'local' },
  fields: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'apply'])

const open = ref(false)
const query = ref('')
const root = ref(null)
const panel = ref(null)
const panelStyle = ref({})
const staged = ref({})

const cloneServerValue = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? [...item] : item]))
}

const isMeaningfulServerValue = (value) => {
  if (Array.isArray(value)) return value.length > 0
  if (value === true || value === false || value === 0 || value === 1) return true
  return String(value ?? '').trim().length > 0
}

const normalizeServerValue = (value) => {
  const source = cloneServerValue(value)
  const normalized = {}
  for (const [key, item] of Object.entries(source)) {
    if (!isMeaningfulServerValue(item)) continue
    normalized[key] = Array.isArray(item)
      ? Array.from(new Set(item.map(entry => String(entry)).filter(Boolean)))
      : (typeof item === 'string' ? item.trim() : item)
  }
  return Object.keys(normalized).length ? normalized : null
}

const normalizeFilterValue = (value) => {
  if (Array.isArray(value)) return value.map(normalizeFilterValue).join(' / ')
  if (value === null || value === undefined || value === '') return '空白'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

const options = computed(() => {
  const map = new Map()
  for (const row of props.rows || []) {
    if (typeof props.value !== 'function') continue
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
const hasFilter = computed(() => props.mode === 'server'
  ? !!normalizeServerValue(props.modelValue)
  : Array.isArray(selectedKeys.value))

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

function fieldId(field) {
  return `table-filter-${String(props.label || '').replace(/\s+/g, '-')}-${field.key}`
}

function serverMultiSelected(key, value) {
  return Array.isArray(staged.value[key]) && staged.value[key].map(String).includes(String(value))
}

function toggleServerMulti(key, value, checked) {
  const current = new Set(Array.isArray(staged.value[key]) ? staged.value[key].map(String) : [])
  const normalized = String(value)
  if (checked) current.add(normalized)
  else current.delete(normalized)
  staged.value[key] = Array.from(current)
}

function applyServerFilter() {
  const value = normalizeServerValue(staged.value)
  emit('update:modelValue', value)
  emit('apply', value)
  open.value = false
}

function clearServerFilter() {
  staged.value = {}
  emit('update:modelValue', null)
  emit('apply', null)
  open.value = false
}

function handleOutsideClick(event) {
  const el = root.value
  const panelEl = panel.value
  if (!el || el.contains(event.target) || panelEl?.contains(event.target)) return
  open.value = false
}

function updatePanelPosition() {
  if (!open.value || !root.value || typeof window === 'undefined') return
  const anchor = root.value.getBoundingClientRect()
  const panelWidth = Math.min(props.mode === 'server' ? 336 : 288, Math.max(240, window.innerWidth - 24))
  const measuredHeight = panel.value?.offsetHeight || 360
  const gap = 6
  const left = Math.min(
    Math.max(12, anchor.left),
    Math.max(12, window.innerWidth - panelWidth - 12),
  )
  const roomBelow = window.innerHeight - anchor.bottom - gap - 12
  const top = roomBelow >= Math.min(measuredHeight, 360)
    ? anchor.bottom + gap
    : Math.max(12, anchor.top - measuredHeight - gap)
  panelStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(panelWidth)}px`,
  }
}

function handleViewportChange() {
  if (open.value) updatePanelPosition()
}

onMounted(() => {
  document.addEventListener('click', handleOutsideClick)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})
watch(open, async (value) => {
  if (value && props.mode === 'server') staged.value = cloneServerValue(props.modelValue)
  if (!value) query.value = ''
  if (value) {
    await nextTick()
    updatePanelPosition()
  }
})
watch(() => props.modelValue, (value) => {
  if (!open.value && props.mode === 'server') staged.value = cloneServerValue(value)
}, { deep: true })
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
  position: fixed;
  z-index: 80;
  width: min(18rem, 80vw);
  border: 1px solid #d1d5db;
  background: #fff;
  box-shadow: 0 18px 35px -20px rgba(15, 23, 42, 0.35);
  padding: 0.75rem;
  max-height: calc(100vh - 1.5rem);
  overflow-y: auto;
}

.table-filter__panel--server {
  width: min(21rem, 86vw);
}

.table-filter__server-fields {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.table-filter__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.table-filter__field-label {
  color: #374151;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: none;
}

.table-filter__server-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem 0.75rem;
  max-height: 12rem;
  overflow: auto;
}

.table-filter__server-option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #374151;
  font-size: 0.8125rem;
  font-weight: 400;
  text-transform: none;
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
