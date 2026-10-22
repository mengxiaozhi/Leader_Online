<template>
  <section class="operations-overview" aria-label="託運營運總覽" :aria-busy="loading">
    <div class="operations-metrics">
      <button v-for="metric in metrics" :key="metric.key" type="button" @click="openReservations(metric.filter)">
        <span>{{ metric.label }}</span>
        <strong>{{ displayCount(metric.value) }}</strong>
        <small>{{ metric.hint }}</small>
      </button>
    </div>

    <div class="operations-context">
      <span>全部可管理預約</span>
      <span v-if="updatedAt">更新於 {{ formatDateTime(updatedAt) }}</span>
    </div>
    <div v-if="error" class="operations-error" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="btn btn-outline btn-sm" :disabled="loading" @click="reload">重新載入</button>
    </div>

    <div class="operations-grid">
      <section class="operations-panel operations-stores">
        <header>
          <div><h2>近期交車點概況</h2><p>{{ recentScope }}</p></div>
          <button class="operations-link" type="button" @click="openReservations('all')">查看全部預約</button>
        </header>
        <p v-if="reservationsLoading && !items.length" class="operations-empty" role="status">正在載入預約…</p>
        <p v-else-if="!items.length" class="operations-empty">{{ reservationError ? '預約資料暫時無法載入' : '目前沒有託運預約' }}</p>
        <div v-else class="operations-table-scroll" tabindex="0" role="region" aria-label="近期交車點概況表格">
          <table>
            <thead><tr><th scope="col">交車點</th><th scope="col">預約</th><th scope="col">待交車</th><th scope="col">待取車</th><th scope="col">完成</th><th scope="col">其他</th></tr></thead>
            <tbody><tr v-for="store in stores" :key="store.name"><th scope="row">{{ store.name }}</th><td>{{ store.total }}</td><td>{{ store.dropoff }}</td><td>{{ store.pickup }}</td><td>{{ store.done }}</td><td>{{ store.other }}</td></tr></tbody>
          </table>
        </div>
        <p v-if="items.length" class="operations-footnote">交、取車含賽前與賽後；其他包含待開始、已取消及尚待確認的狀態。</p>
      </section>

      <section class="operations-panel operations-tasks">
        <header><h2>待處理事項</h2></header>
        <button v-if="canViewOrders" type="button" class="operations-task" @click="openOrders('待匯款')">
          <span><strong>待匯款訂單</strong><small>查看付款進度與匯款資訊</small></span>
          <b>{{ displayCount(readSummaryCount(orderSummary, '待匯款')) }}</b>
        </button>
        <button v-if="canViewOrders" type="button" class="operations-task" @click="openOrders('處理中')">
          <span><strong>處理中訂單</strong><small>確認尚未完成的訂單作業</small></span>
          <b>{{ displayCount(readSummaryCount(orderSummary, '處理中')) }}</b>
        </button>
        <button type="button" class="operations-task" @click="openReservations('post_dropoff')">
          <span><strong>待賽後交車</strong><small>查看回程交車安排</small></span>
          <b>{{ displayCount(readSummaryCount(summary, 'post_dropoff')) }}</b>
        </button>
        <button type="button" class="operations-task" @click="openReservations('post_pickup')">
          <span><strong>待賽後取車</strong><small>確認車輛領取與服務收尾</small></span>
          <b>{{ displayCount(readSummaryCount(summary, 'post_pickup')) }}</b>
        </button>
      </section>

      <section class="operations-panel operations-recent">
        <header><div><h2>最新預約</h2><p>依預約時間排序，最多顯示 6 筆</p></div></header>
        <p v-if="!items.length" class="operations-empty">{{ reservationsLoading ? '正在載入預約…' : (reservationError ? '預約資料暫時無法載入' : '目前沒有預約') }}</p>
        <button v-for="record in items.slice(0, 6)" :key="record.id" type="button" class="operations-record" @click="$emit('open-detail', record)">
          <span class="operations-record__id">#{{ record.id }}</span>
          <span class="operations-record__content"><strong>{{ record.event || '服務檔期待確認' }}</strong><small>{{ record.store || '交車點待確認' }} · {{ formatConsignorName(record.consignor_name) }}</small></span>
          <span class="operations-record__stage">{{ reservationStageLabels[record.status] || record.status || '狀態待確認' }}</span>
        </button>
      </section>

      <section class="operations-panel operations-guide">
        <header><h2>現場作業</h2></header>
        <div class="operations-guide__body">
          <h3>核對預約，再完成交取車</h3>
          <p>掃描或輸入核銷碼，確認本次階段、檢核項目與照片後，接續下一階段。</p>
          <button type="button" class="btn btn-outline" @click="$emit('navigate', { tab: 'scan' })"><AppIcon name="camera" class="h-4 w-4" />開啟現場作業</button>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { formatDateTime } from '../utils/datetime'
import { formatConsignorName } from '../utils/consignorName'
import { groupRecentReservationStores, readSummaryCount, reservationStageLabels } from '../utils/adminOperations'
import AppIcon from './AppIcon.vue'

const props = defineProps({ canViewOrders: { type: Boolean, default: false } })
const emit = defineEmits(['navigate', 'open-detail', 'loading'])
const items = ref([])
const summary = ref(null)
const orderSummary = ref(null)
const loading = ref(false)
const reservationsLoading = ref(false)
const reservationError = ref('')
const orderError = ref('')
const updatedAt = ref(null)
let requestSequence = 0
const error = computed(() => [reservationError.value, orderError.value].filter(Boolean).join('；'))
const stores = computed(() => groupRecentReservationStores(items.value))
const recentScope = computed(() => `依最新 ${items.value.length} 筆預約彙整${readSummaryCount(summary.value) == null ? '' : `，全部共 ${readSummaryCount(summary.value)} 筆`}`)
const metrics = computed(() => [
  { key: 'total', label: '預約總數', value: readSummaryCount(summary.value), filter: 'all', hint: '含各階段與已取消預約' },
  { key: 'dropoff', label: '待賽前交車', value: readSummaryCount(summary.value, 'pre_dropoff'), filter: 'pre_dropoff', hint: '下一步：賽前交車' },
  { key: 'pickup', label: '待賽前取車', value: readSummaryCount(summary.value, 'pre_pickup'), filter: 'pre_pickup', hint: '下一步：賽前取車' },
  { key: 'done', label: '已完成', value: readSummaryCount(summary.value, 'done'), filter: 'done', hint: '四階段作業已結束' },
])
const displayCount = value => value == null ? '—' : value.toLocaleString('zh-TW')
const openReservations = status => emit('navigate', { tab: 'reservations', reservationFilter: status })
const openOrders = status => emit('navigate', { tab: 'orders', orderFilter: status })

async function fetchPayload(path, params) {
  const { data } = await axios.get(`${API_BASE}${path}`, { params })
  if (!data?.ok) throw new Error(data?.message || '資料暫時無法載入')
  return data.data || {}
}
async function reload() {
  const sequence = ++requestSequence
  loading.value = true
  emit('loading', true)
  reservationError.value = ''
  orderError.value = ''
  reservationsLoading.value = true
  const reservationRequest = fetchPayload('/admin/reservations', { limit: 50, offset: 0, includePhotos: 0 })
    .then(payload => {
      if (sequence !== requestSequence) return
      items.value = Array.isArray(payload.items) ? payload.items : []
      summary.value = payload.summary || null
      updatedAt.value = new Date().toISOString()
    })
    .catch(() => {
      if (sequence !== requestSequence) return
      items.value = []
      summary.value = null
      updatedAt.value = null
      reservationError.value = '預約資料載入失敗，請重新載入'
    })
    .finally(() => { if (sequence === requestSequence) reservationsLoading.value = false })
  const orderRequest = props.canViewOrders
    ? fetchPayload('/admin/orders', { limit: 1, offset: 0 })
      .then(payload => { if (sequence === requestSequence) orderSummary.value = payload.summary || null })
      .catch(() => {
        if (sequence !== requestSequence) return
        orderSummary.value = null
        orderError.value = '訂單統計載入失敗，請重新載入'
      })
    : Promise.resolve().then(() => { if (sequence === requestSequence) orderSummary.value = null })
  // Reservation results remain usable while the optional order statistics load.
  await Promise.allSettled([reservationRequest, orderRequest])
  if (sequence !== requestSequence) return
  loading.value = false
  emit('loading', false)
}
watch(() => props.canViewOrders, reload)
onMounted(reload)
onBeforeUnmount(() => { requestSequence += 1; emit('loading', false) })
defineExpose({ reload })
</script>

<style scoped>
.operations-overview { color: #17212e; }
.operations-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid #e1e6ec; border-radius: 8px; background: #fff; overflow: hidden; }
.operations-metrics button { display: flex; flex-direction: column; gap: 9px; padding: 23px 24px; text-align: left; min-width: 0; }
.operations-metrics button + button { border-left: 1px solid #e5e9ee; }
.operations-metrics span { font-size: 14px; color: #586575; }
.operations-metrics strong { color: #b4232a; font-size: 32px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.2; }
.operations-metrics button:last-child strong { color: #27764f; }
.operations-metrics small { color: #6b7685; font-size: 12px; }
.operations-context { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 20px 0; color: #657184; font-size: 13px; }
.operations-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(300px, 1fr); gap: 20px; align-items: start; }
.operations-panel { min-width: 0; border: 1px solid #e1e6ec; border-radius: 8px; background: #fff; overflow: hidden; }
.operations-panel header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px; border-bottom: 1px solid #e6eaf0; }
.operations-panel h2 { font-size: 18px; font-weight: 650; }
.operations-panel header p { color: #6b7685; font-size: 12px; margin-top: 5px; }
.operations-link { font-size: 13px; color: #8f1d24; white-space: nowrap; }
.operations-table-scroll { overflow: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { border-bottom: 1px solid #e9edf1; text-align: right; padding: 15px 14px; white-space: nowrap; font-variant-numeric: tabular-nums; }
thead th { color: #627083; background: #f8fafc; font-size: 12px; font-weight: 500; }
th:first-child { text-align: left; padding-left: 20px; white-space: normal; min-width: 140px; }
tbody th { font-weight: 500; }
tbody tr:last-child > * { border-bottom: 0; }
.operations-footnote { font-size: 12px; color: #6b7685; padding: 14px 20px; border-top: 1px solid #e9edf1; line-height: 1.6; }
.operations-task { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 16px; width: 100%; text-align: left; padding: 15px 20px; border-bottom: 1px solid #e9edf1; }
.operations-task:last-child { border-bottom: 0; }
.operations-task strong { font-size: 14px; font-weight: 600; }
.operations-task small { display: block; color: #6b7685; margin-top: 5px; font-size: 12px; }
.operations-task b { color: #b4232a; font-size: 22px; font-variant-numeric: tabular-nums; }
.operations-record { display: grid; grid-template-columns: 58px minmax(0, 1fr) auto; gap: 14px; align-items: center; width: 100%; padding: 16px 20px; border-bottom: 1px solid #e9edf1; text-align: left; }
.operations-record:last-child { border: 0; }
.operations-record__id { color: #697689; font-size: 13px; overflow-wrap: anywhere; }
.operations-record__content { min-width: 0; }
.operations-record__content strong { display: block; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.operations-record__content small { display: block; font-size: 12px; color: #687587; margin-top: 5px; }
.operations-record__stage { font-size: 12px; color: #5a687a; }
.operations-guide__body { padding: 20px; color: #5d6c7e; }
.operations-guide__body > .btn { display: inline-flex; align-items: center; gap: 8px; }
.operations-guide h3 { font-size: 16px; font-weight: 600; color: #253244; }
.operations-guide p { font-size: 14px; line-height: 1.8; margin: 10px 0 20px; }
.operations-empty { padding: 28px 20px; color: #687587; font-size: 14px; text-align: center; }
.operations-error { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; padding: 14px 18px; border: 1px solid #edc9cc; background: #fff7f7; color: #9b2630; font-size: 14px; }
button:focus-visible, .operations-table-scroll:focus-visible { outline: 2px solid #b4232a; outline-offset: -3px; }
@media (hover: hover) { .operations-metrics button:hover, .operations-task:hover, .operations-record:hover { background: #fcf5f5; } }
@media (max-width: 1199px) { .operations-grid { grid-template-columns: minmax(0, 1fr); } .operations-task { padding: 18px 20px; } }
@media (max-width: 639px) {
  .operations-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .operations-metrics button { padding: 18px 16px; }
  .operations-metrics button:nth-child(3) { border-left: 0; }
  .operations-metrics button:nth-child(n+3) { border-top: 1px solid #e5e9ee; }
  .operations-metrics strong { font-size: 28px; }
  .operations-panel header { flex-wrap: wrap; padding: 16px; }
  .operations-record { grid-template-columns: 44px minmax(0, 1fr); gap: 10px; padding: 16px; }
  .operations-record__stage { grid-column: 2; grid-row: 2; }
}
</style>
