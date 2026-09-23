<template>
  <section class="audit-log" aria-labelledby="audit-heading">
    <header class="audit-header">
      <div><h2 id="audit-heading">查詢紀錄</h2><p>追查管理操作與資料變更。時間以台北時區顯示。</p></div>
      <button class="btn btn-outline" type="button" :disabled="loading" @click="reload">重新整理</button>
    </header>
    <details class="audit-filter-disclosure" :open="filtersExpanded" @toggle="filtersExpanded = $event.target.open">
      <summary>篩選條件</summary>
    <form class="audit-filters" @submit.prevent="reload">
      <label>開始日期<input v-model="filters.from" type="date" /></label>
      <label>結束日期<input v-model="filters.to" type="date" /></label>
      <label>操作人 ID<input v-model.trim="filters.actorId" placeholder="輸入完整 ID" maxlength="36" /></label>
      <label>模組<select v-model="filters.module"><option value="">全部模組</option><option v-for="(label, key) in modules" :key="key" :value="key">{{ label }}</option></select></label>
      <label>操作<select v-model="filters.action"><option value="">全部操作</option><option v-for="(label, key) in actions" :key="key" :value="key">{{ label }}</option></select></label>
      <label>結果<select v-model="filters.status"><option value="">全部結果</option><option v-for="key in ['success','partial','failed','pending']" :key="key" :value="key">{{ statuses[key] }}</option></select></label>
      <label>資料編號<input v-model.trim="filters.resourceId" placeholder="輸入完整資料編號" maxlength="255" /></label>
      <div class="audit-filter-actions"><button type="submit" class="btn btn-primary" :disabled="loading">套用篩選</button><button type="button" class="btn btn-outline" :disabled="loading" @click="reset">清除</button></div>
    </form>
    </details>
    <p v-if="!isAdmin" class="audit-hint">僅顯示目前有權查閱的變更。批次操作的其他資料與整批結果不會顯示。</p>
    <p v-if="error" role="alert" class="audit-error">{{ error }} <button type="button" class="underline" @click="reload">重試</button></p>
    <p v-if="loading" role="status" class="audit-empty">正在讀取操作日誌…</p>
    <p v-else-if="!items.length && !error" class="audit-empty">{{ nextCursor ? '這一頁沒有可查閱的紀錄，可繼續查看更早紀錄。' : '目前條件沒有操作紀錄。' }}</p>
    <div v-if="items.length" class="audit-table-wrap" :aria-busy="loading">
      <table class="audit-table"><caption class="sr-only">管理操作日誌</caption><thead><tr><th scope="col">時間／操作人</th><th scope="col">操作</th><th scope="col">結果</th><th scope="col">明細</th></tr></thead>
        <tbody><tr v-for="item in items" :key="item.id"><td><time>{{ time(item.createdAt) }}</time><strong>{{ item.actorName || '未驗證身分' }}</strong><small>{{ item.actorRole || '—' }}</small></td><td><strong>{{ modules[item.module] || item.module }}</strong><span class="audit-action">{{ actions[item.action] || item.action }}</span></td><td><span class="audit-badge" :data-status="item.status">{{ statuses[item.status] || item.status }}</span></td><td><button type="button" class="btn btn-outline" :aria-label="`查看 ${item.actorName || '未驗證身分'} 的操作明細`" @click="openDetail(item.id)">查看明細</button></td></tr></tbody>
      </table>
    </div>
    <div v-if="items.length" class="audit-cards">
      <article v-for="item in items" :key="item.id" class="audit-card"><div class="audit-card-heading"><time>{{ time(item.createdAt) }}</time><span class="audit-badge" :data-status="item.status">{{ statuses[item.status] || item.status }}</span></div><h3>{{ item.actorName || '未驗證身分' }} <small>{{ item.actorRole || '' }}</small></h3><p>{{ modules[item.module] || item.module }}</p><code class="audit-action">{{ actions[item.action] || item.action }}</code><button type="button" class="btn btn-outline" @click="openDetail(item.id)">查看明細</button></article>
    </div>
    <nav class="audit-pagination" aria-label="日誌分頁"><button class="btn btn-outline" :disabled="loading || !cursors.length" @click="previous">較新紀錄</button><span>第 {{ cursors.length + 1 }} 頁</span><button class="btn btn-outline" :disabled="loading || !nextCursor" @click="next">較早紀錄</button></nav>
    <AppBottomSheet v-model="detailOpen" title="操作明細" size="xl">
      <p v-if="detailLoading" role="status">正在讀取明細…</p><p v-else-if="detailError" class="audit-error" role="alert">{{ detailError }}</p>
      <div v-else-if="detail" class="audit-detail">
        <p><strong>{{ detail.actorName || '未驗證身分' }}</strong> · {{ time(detail.createdAt) }}</p><p class="audit-action">{{ actions[detail.action] || detail.action }}</p>
        <p><span class="audit-badge" :data-status="detail.status">{{ statuses[detail.status] || detail.status }}</span></p>
        <p v-if="detail.errorCode">錯誤代碼：{{ detail.errorCode }}</p>
        <p v-if="detail.status === 'pending'">請求已記錄，但尚未確認最終結果。請先確認資料狀態，再決定是否重試。</p>
        <p class="audit-hint">請求識別碼：<span class="audit-action">{{ detail.requestId }}</span></p>
        <p v-if="!detail.changes?.length" class="audit-empty">此操作沒有可顯示的資料變更。</p>
        <article v-for="change in detail.changes" :key="change.id" class="audit-change">
          <h3>{{ operations[change.operation] || change.operation }} · {{ resources[change.resource] || change.resource }} #{{ change.resourceId }}</h3>
          <p v-if="change.errorCode" class="audit-error">{{ change.errorCode }}</p>
          <dl v-for="diff in change.differences" :key="diff.field" class="audit-diff"><dt>{{ fields[diff.field] || diff.field }}</dt><dd><span>變更前</span><pre>{{ display(diff.before) }}</pre></dd><dd><span>變更後</span><pre>{{ display(diff.after) }}</pre></dd></dl>
          <p v-if="change.redactedFields?.length" class="audit-hint">其他已變更欄位：{{ change.redactedFields.join('、') }}（內容不保存於日誌）</p>
          <p v-if="!change.differences.length" class="audit-hint">{{ change.operation === 'ATTEMPT' ? '已記錄操作嘗試；沒有重複記錄實際變更。' : '未涉及可顯示的欄位；敏感內容不會保存於日誌。' }}</p>
        </article>
        <section v-if="detail.jobs?.length"><h3>後續通知與檔案處理</h3><p v-for="job in detail.jobs" :key="job.id">{{ effects[job.kind] || job.kind }}：{{ jobStatuses[job.status] || job.status }} <span v-if="job.errorCode">（{{ job.errorCode }}）</span></p></section>
      </div>
    </AppBottomSheet>
  </section>
</template>
<script setup>
import { onMounted, ref } from 'vue'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import AppBottomSheet from './AppBottomSheet.vue'
const props = defineProps({ isAdmin: { type: Boolean, default: false } })
const emptyFilters = () => ({ from: '', to: '', actorId: '', module: '', action: '', status: '', resourceId: '' })
const filtersExpanded = ref(typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches)
const filters = ref(emptyFilters())
const applied = ref(emptyFilters())
const items = ref([]), loading = ref(false), error = ref(''), nextCursor = ref(null), cursor = ref(null), cursors = ref([])
const detail = ref(null), detailOpen = ref(false), detailLoading = ref(false), detailError = ref('')
const statuses = { success: '成功', partial: '部分完成', failed: '失敗', pending: '結果待確認', recorded: '範圍內紀錄', processing: '處理中' }
const modules = { auth: '登入與登出', users: '帳號與權限', courses: '課程', orders: '訂單', tickets: '票券', reservations: '預約', events: '服務檔期', products: '商品', settings: '平台設定', account: '個人帳號', drivers: '司機', 'delivery-points': '交車點' }
const operations = { INSERT: '新增', UPDATE: '修改', DELETE: '刪除', ATTEMPT: '操作嘗試', FAILED: '操作失敗', EXPORT: '匯出', REPLAY: '重試回應' }
const resources = { users: '使用者', products: '商品', events: '服務檔期', orders: '訂單', tickets: '票券', reservations: '預約', reservation_tasks: '預約任務', event_stores: '服務地點', delivery_points: '交車點', course_products: '課程商品', course_sessions: '課程場次', course_orders: '課程訂單', course_tickets: '課程票券', course_bookings: '課程預約', course_staff_memberships: '課務權限', app_settings: '平台設定' }
const actions = { 'mark-reviewing': '標記審核中', 'confirm-payment': '確認收款', 'retry-fulfillment': '重試履約', reissue: '補發票券', void: '作廢', create: '新增', update: '修改', delete: '刪除', refund: '退款', approve: '審核通過', reject: '拒絕', issue: '發券', scan: '掃碼', export: '匯出', login: '登入', logout: '登出', cancel: '取消', restore: '恢復', transfer: '轉讓', merge: '合併帳號', assign: '指派', publish: '發布', unpublish: '下架', attend: '報到', pause: '暫停', resume: '繼續', operation: '其他操作' }
const jobStatuses = { pending: '等待處理', processing: '處理中', unknown: '結果待確認', success: '成功', failed: '失敗' }
const effects = { mail: '電子郵件', 'line-push': 'LINE 通知', 'file-write': '檔案寫入', 'file-delete': '檔案清除' }
const fields = { id: '編號', name: '名稱', title: '標題', role: '角色', status: '狀態', price: '價格', quantity: '數量', total_amount: '總金額', payment_status: '付款狀態', fulfillment_status: '履約狀態', listing_status: '上架狀態', owner_user_id: '所屬人員', row_version: '資料版本' }
function time(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date) }
function display(value) { return value == null ? '—' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value) }
let generation = 0, detailGeneration = 0
async function load() {
  const version = ++generation; loading.value = true; error.value = ''
  try {
    const params = Object.fromEntries(Object.entries(applied.value).filter(([, value]) => value))
    if (cursor.value) params.cursor = cursor.value
    const { data } = await axios.get(`${API_BASE}/admin/audit-logs`, { params })
    if (version !== generation) return
    if (!data?.ok) throw new Error(data?.message || '無法讀取操作日誌')
    items.value = data.data.items; nextCursor.value = data.data.nextCursor
  } catch (e) { if (version === generation) { items.value = []; nextCursor.value = null; error.value = e.response?.data?.message || e.message || '讀取失敗' } }
  finally { if (version === generation) loading.value = false }
}
function reload() {
  if (filters.value.from && filters.value.to && filters.value.from > filters.value.to) { error.value = '結束日期不可早於開始日期'; return }
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) filtersExpanded.value = false
  applied.value = { ...filters.value }; cursor.value = null; cursors.value = []; return load()
}
function reset() { filters.value = emptyFilters(); return reload() }
function next() { if (!nextCursor.value) return; cursors.value.push(cursor.value); cursor.value = nextCursor.value; return load() }
function previous() { cursor.value = cursors.value.pop() || null; return load() }
async function openDetail(id) {
  const version = ++detailGeneration; detailOpen.value = true; detailLoading.value = true; detailError.value = ''; detail.value = null
  try { const { data } = await axios.get(`${API_BASE}/admin/audit-logs/${id}`); if (version !== detailGeneration) return; if (!data?.ok) throw new Error(data?.message || '無法讀取明細'); detail.value = data.data }
  catch (e) { if (version === detailGeneration) detailError.value = e.response?.data?.message || e.message || '讀取失敗' }
  finally { if (version === detailGeneration) detailLoading.value = false }
}
onMounted(load)
defineExpose({ reload })
</script>
<style scoped>
.audit-log { color: #172d37; min-width: 0; }
.audit-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
h2 { font-size: 1.4rem; font-weight: 700; } h3 { font-weight: 600; overflow-wrap: anywhere; }
.audit-header p,.audit-hint { color: #536773; font-size: .875rem; margin-top: .35rem; }
.audit-filter-disclosure summary { cursor: pointer; min-height: 44px; padding: .7rem 0; font-weight: 600; }
.audit-filters { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: .85rem; padding: 1rem; border: 1px solid #d9e2e6; border-radius: 1rem; background: #f7fafb; }
.audit-filters label { display: flex; flex-direction: column; gap: .3rem; font-size: .875rem; font-weight: 600; min-width: 0; }
.audit-filters input,.audit-filters select { width: 100%; min-width: 0; border: 1px solid #aebfc7; border-radius: .5rem; background: white; padding: .65rem; font: inherit; font-weight: 400; }
.audit-filter-actions { display: flex; align-items: end; gap: .5rem; flex-wrap: wrap; }
.audit-log button:focus-visible,.audit-log input:focus-visible,.audit-log select:focus-visible { outline: 3px solid #167694; outline-offset: 3px; }
.audit-log button { min-height: 44px; }.audit-empty { padding: 2rem 1rem; text-align: center; color: #536773; }
.audit-error { color: #aa2632; padding: .75rem; background: #fff3f3; border-radius: .5rem; }
.audit-table-wrap { overflow-x: auto; margin-top: 1.1rem; border: 1px solid #d9e2e6; border-radius: .8rem; }
.audit-table { width: 100%; border-collapse: collapse; text-align: left; }.audit-table th { background: #f3f7f8; font-size: .85rem; }.audit-table td,.audit-table th { padding: 1rem; border-bottom: 1px solid #e3eaed; }.audit-table td:first-child { min-width: 12rem; }.audit-table strong,.audit-table small { display: block; }.audit-table small { color: #536773; }
.audit-action { display: block; overflow-wrap: anywhere; font-size: .8rem; margin-top: .35rem; }.audit-badge { display: inline-block; white-space: nowrap; border-radius: 999px; padding: .25rem .65rem; background: #e7eef2; color: #324c5b; font-size: .8rem; }.audit-badge[data-status="success"] { background: #dcf2e8; color: #196243; }.audit-badge[data-status="failed"] { background: #ffe5e5; color: #9b2632; }.audit-badge[data-status="pending"],.audit-badge[data-status="partial"] { background: #fff0cf; color: #76520d; }
.audit-cards { display: none; }.audit-pagination { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin: 1rem 0; font-size: .85rem; }
.audit-detail { display: grid; gap: .85rem; min-width: 0; }.audit-change { padding: 1rem; border: 1px solid #d9e2e6; border-radius: .75rem; }.audit-diff { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; border-top: 1px solid #e3eaed; margin-top: .75rem; padding-top: .75rem; }.audit-diff dt { grid-column: 1/-1; font-weight: 600; }.audit-diff dd { min-width: 0; }.audit-diff dd span { font-size: .75rem; color: #536773; }.audit-diff pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f5f8fa; padding: .5rem; border-radius: .35rem; font-size: .85rem; }
@media(max-width: 767px) { .audit-filters { grid-template-columns: repeat(2,minmax(0,1fr)); }.audit-header { align-items: start; }.audit-header .btn { flex-shrink: 0; }.audit-table-wrap { display: none; }.audit-cards { display: grid; gap: .75rem; margin-top: 1rem; }.audit-card { border: 1px solid #d9e2e6; border-radius: .85rem; padding: 1rem; display: grid; gap: .6rem; }.audit-card-heading { display: flex; gap: .5rem; justify-content: space-between; font-size: .75rem; }.audit-card small { color: #536773; font-weight: 400; font-size: .75rem; }.audit-diff { grid-template-columns: 1fr; } }
</style>
