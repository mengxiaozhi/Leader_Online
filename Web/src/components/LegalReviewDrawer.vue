<template>
  <AppOverlayPanel
    v-model="openState"
    placement="right"
    size="xl"
    :title="dialogTitle"
    :description="dialogDescription"
    :close-on-backdrop="false"
    :body-scroll="false"
    :drag-to-close="false"
    @close="cancel"
    @after-close="resolveAfterClose"
  >
    <div ref="scrollRef" class="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6" @scroll="updateReadProgress">
          <div v-if="loading" class="flex min-h-[220px] items-center justify-center text-sm text-slate-600">
            法務規定載入中…
          </div>

          <div v-else-if="error" class="space-y-4">
            <div class="border-y border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
              {{ error }}
            </div>
            <button class="btn btn-outline btn-sm" @click="loadLegalContent">
              <AppIcon name="refresh" class="h-4 w-4" />
              重新載入
            </button>
          </div>

          <div v-else class="space-y-5">
            <section v-if="orderItems.length" class="border-y border-slate-200 py-4">
              <p class="meta-label mb-2">本次下單內容</p>
              <div class="divide-y divide-slate-200 text-sm text-slate-700">
                <div v-for="item in orderItems" :key="item.key" class="flex items-start justify-between gap-3 py-2">
                  <div class="min-w-0">
                    <p class="font-medium text-slate-900">{{ item.name }}</p>
                    <p v-if="item.detail" class="mt-0.5 leading-6 text-slate-600">{{ item.detail }}</p>
                  </div>
                  <span class="shrink-0 text-slate-600">x {{ item.quantity }}</span>
                </div>
              </div>
            </section>

            <section v-for="section in legalSections" :key="section.key" class="border-y border-slate-200 py-4">
              <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 class="ui-title text-lg font-medium text-slate-900">{{ section.title }}</h3>
                <p v-if="section.updatedAt" class="text-sm text-slate-600">更新時間：{{ section.updatedAt }}</p>
              </div>
              <div v-if="section.html" class="content-body mt-3" v-html="section.content"></div>
              <div v-else class="mt-3 whitespace-pre-wrap text-[0.95rem] leading-7 text-slate-800">{{ section.content }}</div>
            </section>
          </div>
    </div>

    <template #actions>
      <div class="w-full">
          <p v-if="!loading && !error && !readToEnd" class="mb-3 text-sm text-slate-600">
            請先將上方規定閱讀到底部，再勾選確認。
          </p>
          <label class="mb-3 flex items-start gap-2 text-sm text-slate-700" :class="readToEnd ? '' : 'opacity-60'">
            <input v-model="accepted" type="checkbox" class="mt-1" :disabled="loading || !!error || !readToEnd" />
            <span>我已完整閱讀並接受本次下單相關法務規定</span>
          </label>
          <div class="flex flex-col gap-2 sm:flex-row">
            <button class="btn btn-outline w-full" @click="cancel">取消</button>
            <button class="btn btn-primary w-full text-white" :disabled="confirmDisabled" @click="confirm">
              已閱讀，繼續下單
            </button>
          </div>
      </div>
    </template>
  </AppOverlayPanel>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { formatDateTime } from '../utils/datetime'
import { normalizeRichText } from '../utils/content'
import AppIcon from './AppIcon.vue'
import AppOverlayPanel from './AppOverlayPanel.vue'

const API = API_BASE

const PAGE_LABELS = {
  terms: '使用者條款',
  'reservation-notice': '預約購買須知',
  'reservation-rules': '預約使用規定',
}

const PAGE_FALLBACKS = {
  terms: '平台尚未提供完整使用者條款內容。請確認本次交易資訊、付款方式、票券效期與訂單狀態後再送出。',
  'reservation-notice': '平台尚未提供預約購買須知。請確認預約數量、交車點、付款方式與活動截止時間後再送出。',
  'reservation-rules': '平台尚未提供預約使用規定。請依交車點現場流程、貨物包裝要求與通知時程完成服務。',
}

const PROVIDER_FALLBACK = '本次下單項目尚未提供專屬服務商條款。請確認商品、服務、付款資訊、退款與服務限制後再送出訂單；如有疑問，請先聯繫平台或服務商。'

const openState = ref(false)
const loading = ref(false)
const error = ref('')
const accepted = ref(false)
const readToEnd = ref(false)
const scrollRef = ref(null)
const currentOptions = ref({
  title: '',
  description: '',
  items: [],
  providerIds: [],
  pageSlugs: [],
  extraSections: [],
})
const providerTerms = ref([])
const pagesBySlug = ref({})
let resolver = null
let pendingResult = null

const dialogTitle = computed(() => currentOptions.value.title || '請閱讀本次下單法務規定')
const dialogDescription = computed(() => currentOptions.value.description || '送出訂單前，請閱讀本次商品或服務對應的規定並確認。')
const orderItems = computed(() => currentOptions.value.items || [])
const confirmDisabled = computed(() => loading.value || !!error.value || !readToEnd.value || !accepted.value)

const normalizeProviderId = (value) => String(value || '').trim()
const unique = (list = []) => Array.from(new Set(list.map(normalizeProviderId).filter(Boolean)))

const normalizeItem = (item = {}, index = 0) => {
  const name = String(item.name || item.title || item.ticketType || item.type || `項目 ${index + 1}`).trim()
  const quantity = Math.max(1, Math.floor(Number(item.quantity || item.qty || 1)))
  const providerId = normalizeProviderId(item.providerId || item.provider_user_id || item.providerUserId || item.owner_user_id)
  const detail = String(item.detail || item.subtitle || '').trim()
  return {
    key: `${providerId || 'item'}-${name}-${index}`,
    name,
    quantity,
    providerId,
    detail,
  }
}

const normalizeSection = (section = {}, index = 0) => {
  const rawContent = section.content == null ? '' : String(section.content).trim()
  return {
    key: String(section.key || `extra-${index}`),
    title: String(section.title || '補充規定').trim(),
    content: section.html ? normalizeRichText(rawContent) : rawContent,
    html: Boolean(section.html),
    updatedAt: section.updatedAt || '',
  }
}

const normalizeOptions = (options = {}) => {
  const items = Array.isArray(options.items) ? options.items.map(normalizeItem) : []
  const providerIds = unique([
    ...(Array.isArray(options.providerIds) ? options.providerIds : []),
    ...items.map((item) => item.providerId),
  ])
  const pageSlugs = Array.isArray(options.pageSlugs)
    ? Array.from(new Set(options.pageSlugs.map((slug) => String(slug || '').trim()).filter(Boolean)))
    : []
  const extraSections = Array.isArray(options.extraSections)
    ? options.extraSections.map(normalizeSection).filter((section) => section.title && section.content)
    : []
  return {
    title: String(options.title || '').trim(),
    description: String(options.description || '').trim(),
    items,
    providerIds,
    pageSlugs,
    extraSections,
  }
}

const matchingProviderTerms = computed(() => {
  const ids = new Set(currentOptions.value.providerIds || [])
  if (!ids.size) return []
  return providerTerms.value.filter((item) => ids.has(normalizeProviderId(item.id)))
})

const legalSections = computed(() => {
  const sections = [...(currentOptions.value.extraSections || [])]
  for (const slug of currentOptions.value.pageSlugs || []) {
    const raw = pagesBySlug.value[slug] || ''
    const label = PAGE_LABELS[slug] || '平台規定'
    if (raw) {
      sections.push({
        key: `page-${slug}`,
        title: label,
        content: normalizeRichText(raw),
        html: true,
        updatedAt: '',
      })
    } else {
      sections.push({
        key: `page-${slug}-fallback`,
        title: label,
        content: PAGE_FALLBACKS[slug] || '平台尚未提供此規定內容，請確認本次交易資訊後再送出。',
        html: false,
        updatedAt: '',
      })
    }
  }

  if (matchingProviderTerms.value.length) {
    matchingProviderTerms.value.forEach((item) => {
      sections.push({
        key: `provider-${item.id || item.name}`,
        title: `${item.name || '服務商'}服務條款`,
        content: item.content,
        html: false,
        updatedAt: item.updated_at ? formatDateTime(item.updated_at) : '',
      })
    })
  } else {
    sections.push({
      key: 'provider-fallback',
      title: '服務商條款',
      content: PROVIDER_FALLBACK,
      html: false,
      updatedAt: '',
    })
  }

  return sections
})

function updateReadProgress() {
  const el = scrollRef.value
  if (!el || loading.value || error.value) {
    readToEnd.value = false
    return
  }
  readToEnd.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 12
}

async function fetchPage(slug) {
  const { data } = await axios.get(`${API}/pages/${slug}`)
  if (!data?.ok) throw new Error(data?.message || '無法載入平台規定')
  return [slug, data.data?.content || '']
}

async function loadLegalContent() {
  loading.value = true
  error.value = ''
  accepted.value = false
  readToEnd.value = false
  pagesBySlug.value = {}
  providerTerms.value = []
  try {
    const pageSlugs = currentOptions.value.pageSlugs || []
    const [providerResponse, pageEntries] = await Promise.all([
      axios.get(`${API}/providers/legal_terms`),
      Promise.all(pageSlugs.map(fetchPage)),
    ])
    if (!providerResponse.data?.ok) {
      throw new Error(providerResponse.data?.message || '無法載入服務商條款')
    }
    providerTerms.value = Array.isArray(providerResponse.data.data)
      ? providerResponse.data.data
          .map((item) => ({
            id: normalizeProviderId(item?.id),
            name: String(item?.name || '').trim(),
            content: String(item?.content || '').trim(),
            updated_at: item?.updated_at || '',
          }))
          .filter((item) => item.content)
      : []
    pagesBySlug.value = Object.fromEntries(pageEntries)
    await nextTick()
    updateReadProgress()
  } catch (e) {
    error.value = e?.response?.data?.message || e.message || '無法載入法務規定，請稍後再試'
  } finally {
    loading.value = false
    await nextTick()
    updateReadProgress()
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
  accepted.value = false
  readToEnd.value = false
  openState.value = true
  nextTick(() => {
    if (scrollRef.value) scrollRef.value.scrollTop = 0
  })
  loadLegalContent()
  return new Promise((resolve) => {
    resolver = resolve
  })
}

defineExpose({ open })
</script>
