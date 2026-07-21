<template>
  <AppOverlayPanel
    v-model="openState"
    placement="right"
    size="md"
    :title="dialogTitle"
    :description="dialogDescription"
    :close-on-backdrop="false"
    :drag-to-close="false"
    @close="cancel"
    @after-close="resolveAfterClose"
  >
    <div class="space-y-5 px-5 py-5 sm:px-6">
      <section v-if="summaryItems.length" class="border-y border-slate-200 py-4">
        <p class="meta-label mb-2">本次送出內容</p>
        <div class="divide-y divide-slate-200 text-sm">
          <div v-for="item in summaryItems" :key="item.key" class="flex items-start justify-between gap-3 py-2">
            <div class="min-w-0">
              <p class="font-medium text-slate-900">{{ item.label }}</p>
              <p v-if="item.detail" class="mt-0.5 leading-6 text-slate-600">{{ item.detail }}</p>
            </div>
            <span v-if="item.value" class="shrink-0 text-slate-700">{{ item.value }}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="order-user-data-title">
        <div class="mb-3">
          <p class="meta-label">訂單使用者資料</p>
          <h3 id="order-user-data-title" class="ui-title mt-1 text-lg font-medium text-slate-950">請再次核實以下資料</h3>
        </div>
        <dl class="divide-y divide-slate-200 border-y border-slate-200">
          <div v-for="field in reviewFields" :key="field.key" class="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
            <dt class="text-sm font-medium text-slate-600">{{ field.label }}</dt>
            <dd class="break-words text-[0.95rem] text-slate-950">{{ field.value || '尚未填寫' }}</dd>
          </div>
        </dl>
        <p class="mt-3 text-sm leading-6" :class="missingRequiredFields.length ? 'text-red-700' : 'text-slate-600'">
          {{ missingRequiredFields.length
            ? `尚缺少：${missingRequiredFields.map((field) => field.label).join('、')}，請返回修改後再送出。`
            : editHint }}
        </p>
      </section>
    </div>

    <template #actions>
      <div class="w-full">
        <label class="mb-3 flex items-start gap-2 text-sm leading-6 text-slate-700" :class="missingRequiredFields.length ? 'opacity-60' : ''">
          <input v-model="confirmed" type="checkbox" class="mt-1" :disabled="missingRequiredFields.length > 0" />
          <span>我已再次核對，確認以上為本次訂單要使用的正確資料</span>
        </label>
        <div class="flex flex-col gap-2 sm:flex-row">
          <button type="button" class="btn btn-outline w-full" @click="cancel">返回修改</button>
          <button type="button" class="btn btn-primary w-full text-white" :disabled="confirmDisabled" @click="confirm">
            {{ confirmText }}
          </button>
        </div>
      </div>
    </template>
  </AppOverlayPanel>
</template>

<script setup>
import { computed, ref } from 'vue'
import AppOverlayPanel from './AppOverlayPanel.vue'

const openState = ref(false)
const confirmed = ref(false)
const currentOptions = ref({
  title: '',
  description: '',
  fields: [],
  summary: [],
  confirmText: '',
  editHint: '',
})
let resolver = null
let pendingResult = null

const dialogTitle = computed(() => currentOptions.value.title || '確認本次訂單資料')
const dialogDescription = computed(() => currentOptions.value.description || '送出前，請確認本次訂單使用的聯絡與付款辨識資料。')
const confirmText = computed(() => currentOptions.value.confirmText || '資料正確，確認下單')
const editHint = computed(() => currentOptions.value.editHint || '若資料有誤，請返回上一頁或前往帳戶中心修改後再送出。')

const reviewFields = computed(() => currentOptions.value.fields || [])
const summaryItems = computed(() => currentOptions.value.summary || [])
const missingRequiredFields = computed(() => reviewFields.value.filter((field) => field.required && !field.value))
const confirmDisabled = computed(() => missingRequiredFields.value.length > 0 || !confirmed.value)

function normalizeField(field = {}, index = 0) {
  return {
    key: String(field.key || `field-${index}`),
    label: String(field.label || `資料 ${index + 1}`).trim(),
    value: String(field.value ?? '').trim(),
    required: field.required !== false,
  }
}

function normalizeSummaryItem(item = {}, index = 0) {
  return {
    key: String(item.key || `summary-${index}`),
    label: String(item.label || item.name || `項目 ${index + 1}`).trim(),
    value: String(item.value ?? '').trim(),
    detail: String(item.detail || '').trim(),
  }
}

function normalizeOptions(options = {}) {
  return {
    title: String(options.title || '').trim(),
    description: String(options.description || '').trim(),
    fields: Array.isArray(options.fields) ? options.fields.map(normalizeField) : [],
    summary: Array.isArray(options.summary) ? options.summary.map(normalizeSummaryItem) : [],
    confirmText: String(options.confirmText || '').trim(),
    editHint: String(options.editHint || '').trim(),
  }
}

function finish(value) {
  if (!resolver) return
  pendingResult = Boolean(value)
  openState.value = false
}

function resolveAfterClose() {
  if (!resolver || pendingResult === null) return
  const resolve = resolver
  const result = pendingResult
  resolver = null
  pendingResult = null
  resolve(result)
}

function cancel() {
  finish(false)
}

function confirm() {
  if (confirmDisabled.value) return
  finish(true)
}

function open(options = {}) {
  if (resolver) {
    const previousResolve = resolver
    resolver = null
    pendingResult = null
    previousResolve(false)
  }
  currentOptions.value = normalizeOptions(options)
  confirmed.value = false
  openState.value = true
  return new Promise((resolve) => {
    resolver = resolve
  })
}

defineExpose({ open })
</script>
