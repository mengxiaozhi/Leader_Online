<template>
  <section class="space-y-5">
    <p v-if="message" class="rounded-lg border px-4 py-3 text-sm" role="status"
      :class="messageType === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'">{{ message }}</p>

    <div class="grid gap-3 sm:items-end" :class="props.mode === 'bookings' ? 'sm:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]' : 'sm:grid-cols-[minmax(0,1fr)_12rem_auto]'">
      <AppSearchInput v-model="query" :placeholder="searchPlaceholder" />
      <label class="space-y-1 text-sm text-slate-600">狀態
        <select v-model="statusFilter" class="w-full"><option value="">全部狀態</option><option v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
      </label>
      <label v-if="props.mode === 'bookings'" class="space-y-1 text-sm text-slate-600">時間範圍<select v-model="periodFilter" class="w-full"><option value="">全部紀錄</option><option value="upcoming">即將到來</option><option value="history">歷史紀錄</option></select></label>
      <button type="button" class="btn btn-outline" :disabled="!hasFilters" @click="clearFilters">清除篩選</button>
    </div>

    <div v-if="summaryCards.length" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <button v-for="card in summaryCards" :key="card.key" type="button" class="surface-section min-h-[44px] text-left transition hover:border-primary"
        :aria-pressed="statusFilter === card.status" @click="statusFilter = card.status">
        <p class="text-sm text-slate-500">{{ card.label }}</p><p class="stat-number mt-1 text-2xl text-slate-950">{{ card.value }}</p>
      </button>
    </div>

    <section v-if="loading" class="grid gap-4 md:grid-cols-2"><div v-for="index in 4" :key="index" class="ticket-card animate-pulse p-5"><div class="h-5 w-2/3 rounded bg-slate-200"></div><div class="mt-4 h-24 rounded bg-slate-100"></div></div></section>
    <section v-else-if="loadError" class="surface-section text-sm text-red-700"><p>{{ loadError }}</p><button type="button" class="btn btn-outline mt-3" @click="loadData(meta.offset, { forceSummary: true })">重新載入</button></section>

    <section v-else-if="props.mode === 'tickets'" class="space-y-4">
      <div v-if="!items.length" class="surface-section text-sm leading-6 text-slate-600"><p>{{ hasFilters ? '沒有符合條件的課程票券。' : '目前沒有課程票券。購買課程並由行政確認款項後，票券會出現在這裡。' }}</p><router-link to="/store?tab=courses" class="btn btn-primary mt-4 text-white">前往課程商店</router-link></div>
      <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article v-for="ticket in items" :key="ticket.id" class="ticket-card flex flex-col gap-4 p-5">
          <header class="flex items-start justify-between gap-3"><div><p class="text-sm text-slate-500">{{ ticket.code }}</p><h2 class="ui-title mt-1 text-xl text-slate-950">{{ ticket.productName }}</h2><p class="mt-1 text-sm font-medium text-primary">{{ providerLabel(ticket) }}</p></div><span class="ops-chip" :class="ticketStatusClass(ticket.status)">{{ ticketStatusLabel(ticket.status) }}</span></header>
          <div class="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4"><div><p class="text-sm text-slate-500">剩餘堂數</p><p class="stat-number mt-1 text-3xl text-primary">{{ ticket.remainingUses }}</p></div><div><p class="text-sm text-slate-500">總堂數</p><p class="stat-number mt-1 text-3xl text-slate-800">{{ ticket.totalUses }}</p></div></div>
          <dl class="space-y-2 text-sm text-slate-600"><div class="flex justify-between gap-3"><dt>發券日</dt><dd class="text-right text-slate-800">{{ formatDate(ticket.issuedAt) }}</dd></div><div class="flex justify-between gap-3"><dt>{{ ticket.activatedAt ? '到期日' : '開卡期限' }}</dt><dd class="text-right text-slate-800">{{ formatDate(ticket.expiresAt || ticket.activationDeadline) || '未設定' }}</dd></div><div v-if="ticket.pauseReason" class="flex justify-between gap-3"><dt>暫停原因</dt><dd class="text-right text-slate-800">{{ ticket.pauseReason }}</dd></div></dl>
          <div class="mt-auto grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <button class="btn btn-outline btn-sm" @click="openDetail(ticket)">查看詳情</button>
            <button v-if="ticket.status === 'active'" class="btn btn-outline btn-sm" @click="openAction(ticket)"><AppIcon name="pause" class="h-4 w-4" /> 暫停</button>
            <button v-if="ticket.status === 'paused'" class="btn btn-outline btn-sm" @click="resumeTicket(ticket)"><AppIcon name="refresh" class="h-4 w-4" /> 恢復</button>
            <template v-if="canTransferTicket(ticket)"><button class="btn btn-outline btn-sm" @click="requestTransferEmail(ticket)"><AppIcon name="orders" class="h-4 w-4" /> Email 轉讓</button><button class="btn btn-outline btn-sm" @click="requestTransferQr(ticket)"><AppIcon name="camera" class="h-4 w-4" /> 掃碼轉讓</button></template>
            <router-link v-if="['pending','active'].includes(ticket.status) && ticket.remainingUses > 0" to="/store?tab=courses&courseView=sessions" class="btn btn-primary btn-sm text-white"><AppIcon name="calendar" class="h-4 w-4" /> 預約</router-link>
          </div>
        </article>
      </div>
    </section>

    <section v-else-if="props.mode === 'bookings'" class="space-y-4">
      <div v-if="!items.length" class="surface-section text-sm leading-6 text-slate-600"><p>{{ hasFilters ? '沒有符合條件的課程預約。' : '目前沒有課程預約。前往課程商店選擇開放場次。' }}</p><router-link to="/store?tab=courses&courseView=sessions" class="btn btn-primary mt-4 text-white">查看開放場次</router-link></div>
      <div v-else class="grid gap-4 lg:grid-cols-2">
        <article v-for="booking in items" :key="booking.id" class="ticket-card flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0 space-y-3">
            <div class="flex flex-wrap items-center gap-2"><h2 class="ui-title text-xl text-slate-950">{{ booking.sessionTitle }}</h2><span class="ops-chip" :class="bookingStatusClass(booking.status)">{{ bookingStatusLabel(booking.status) }}</span><span class="ops-chip">{{ isUpcoming(booking) ? '即將到來' : '歷史紀錄' }}</span></div>
            <p class="text-sm font-medium text-primary">{{ providerLabel(booking) }}</p>
            <dl class="space-y-2 text-sm text-slate-600"><div class="flex gap-2"><AppIcon name="calendar" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ formatRange(booking.startsAt, booking.endsAt) }}</span></div><div class="flex gap-2"><AppIcon name="map-pin" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ booking.location || '地點待公告' }}</span></div><div class="flex gap-2"><AppIcon name="user" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ booking.coachName || '教練待公告' }}</span></div><div class="flex gap-2"><AppIcon name="ticket" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ booking.ticketCode }}</span></div></dl>
          </div>
          <div class="flex shrink-0 flex-col gap-2 sm:min-w-40"><button class="btn btn-outline btn-sm" @click="openDetail(booking)">查看詳情</button><button v-if="booking.status === 'booked' && booking.verifyCode" class="btn btn-primary btn-sm text-white" @click="requestAttendanceQr(booking)"><AppIcon name="camera" class="h-4 w-4" /> 出示核銷 QR</button><button v-if="booking.status === 'booked' && canCancel(booking)" class="btn btn-outline btn-sm text-red-700" @click="cancelBooking(booking)">取消預約</button></div>
        </article>
      </div>
    </section>

    <section v-else class="space-y-4">
      <div v-if="!items.length" class="surface-section text-sm leading-6 text-slate-600"><p>{{ hasFilters ? '沒有符合條件的課程訂單。' : '目前沒有課程訂單。' }}</p><router-link to="/store?tab=courses" class="btn btn-primary mt-4 text-white">選購課程</router-link></div>
      <div v-else>
        <div class="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block"><div class="overflow-x-auto"><table class="table-default min-w-[980px]"><thead><tr><th>訂單編號</th><th>課程／服務商</th><th>數量</th><th>金額</th><th>匯款後五碼</th><th>狀態</th><th>建立時間</th><th>操作</th></tr></thead><tbody><tr v-for="order in items" :key="order.id"><td class="font-medium text-slate-900">{{ order.code }}</td><td><p>{{ order.productName }}</p><p class="text-sm text-primary">{{ providerLabel(order) }}</p></td><td>{{ order.quantity }}</td><td class="money-value">NT$ {{ formatMoney(order.totalAmount) }}</td><td>{{ order.remittanceLast5 || '—' }}</td><td><span class="ops-chip" :class="orderStatusClass(order.status)">{{ orderStatusLabel(order.status) }}</span></td><td>{{ formatDateTime(order.createdAt) }}</td><td><div class="flex gap-2"><button class="btn btn-outline btn-sm" @click="openDetail(order)">詳情</button><button v-if="canEditOrder(order)" class="btn btn-outline btn-sm" @click="openOrderEdit(order)">修改</button><button v-if="canEditOrder(order)" class="btn btn-outline btn-sm text-red-700" @click="cancelOrder(order)">取消</button></div></td></tr></tbody></table></div></div>
        <div class="grid gap-3 md:hidden"><article v-for="order in items" :key="`mobile-${order.id}`" class="ticket-card space-y-4 p-4"><header class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="break-all font-mono text-sm text-slate-500">{{ order.code }}</p><h2 class="ui-title mt-1 text-lg text-slate-950">{{ order.productName }}</h2><p class="mt-1 text-sm font-medium text-primary">{{ providerLabel(order) }}</p></div><span class="ops-chip shrink-0" :class="orderStatusClass(order.status)">{{ orderStatusLabel(order.status) }}</span></header><dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><div><dt class="text-slate-500">數量</dt><dd class="mt-1 font-medium text-slate-900">{{ order.quantity }}</dd></div><div><dt class="text-slate-500">金額</dt><dd class="money-value mt-1 text-slate-950">NT$ {{ formatMoney(order.totalAmount) }}</dd></div><div><dt class="text-slate-500">匯款後五碼</dt><dd class="mt-1 font-medium text-slate-900">{{ order.remittanceLast5 || '—' }}</dd></div><div><dt class="text-slate-500">建立時間</dt><dd class="mt-1 text-slate-700">{{ formatDateTime(order.createdAt) }}</dd></div></dl><div class="grid grid-cols-3 gap-2"><button class="btn btn-outline btn-sm" @click="openDetail(order)">詳情</button><button v-if="canEditOrder(order)" class="btn btn-outline btn-sm" @click="openOrderEdit(order)">修改</button><button v-if="canEditOrder(order)" class="btn btn-outline btn-sm text-red-700" @click="cancelOrder(order)">取消</button></div></article></div>
      </div>
    </section>

    <AdminPagination v-if="meta.total > 0" :total="meta.total" :limit="meta.limit" :offset="meta.offset" :loading="loading" @change="loadData($event.offset)" />

    <AppOverlayPanel v-model="detailOpen" placement="auto" size="md" :title="detailTitle" :description="selectedItem?.code || selectedItem?.sessionCode || ''" @close="closeDetail">
      <div v-if="selectedItem" class="space-y-4 text-sm">
        <p class="font-medium text-primary">{{ providerLabel(selectedItem) }}</p>
        <dl class="divide-y divide-slate-200 border-y border-slate-200">
          <div v-for="row in detailRows" :key="row.label" class="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)]"><dt class="font-medium text-slate-600">{{ row.label }}</dt><dd class="break-words text-slate-950">{{ row.value || '—' }}</dd></div>
        </dl>
      </div>
    </AppOverlayPanel>

    <AppOverlayPanel v-model="actionOpen" placement="auto" size="md" :title="`暫停 ${selectedTicket?.productName || '課程票券'}`" description="填寫原因後，票券會暫停預約與核銷，之後仍可自行恢復。" @close="closeAction">
      <p v-if="actionError" class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{{ actionError }}</p>
      <form class="space-y-4" @submit.prevent="submitAction"><label class="block space-y-2 text-sm font-medium text-slate-700">暫停原因<textarea v-model.trim="actionValue" required rows="4" class="w-full" placeholder="例如：工作、家庭或健康因素"></textarea></label><p class="text-sm leading-6 text-slate-600">暫停後不可預約或核銷，之後可自行恢復使用。</p><button class="btn btn-primary w-full text-white" :disabled="submitting">{{ submitting ? '處理中…' : '確認送出' }}</button></form>
    </AppOverlayPanel>

    <AppOverlayPanel v-model="orderEditOpen" placement="auto" size="md" :title="`修改訂單 ${selectedOrder?.code || ''}`" description="付款確認前可調整數量及匯款辨識資料。" @close="closeOrderEdit">
      <p v-if="actionError" class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{{ actionError }}</p>
      <form v-if="selectedOrder" class="space-y-4" @submit.prevent="saveOrderEdit"><label class="block space-y-2 text-sm font-medium text-slate-700">數量<input v-model.number="orderEditForm.quantity" type="number" min="1" max="10" required class="w-full" /></label><label class="block space-y-2 text-sm font-medium text-slate-700">目前會員匯款帳號後五碼<input v-model.trim="orderEditForm.remittanceLast5" readonly class="w-full bg-slate-50" /></label><router-link to="/account?tab=profile" class="inline-flex text-sm font-medium text-primary">需要變更末五碼？前往帳戶中心修改</router-link><p class="surface-muted p-3 text-sm leading-6 text-slate-600">儲存時會同步目前會員資料。商品不可在原訂單內更換；若要購買其他服務商課程，請取消後重新下單。款項確認中的訂單修改後會回到待匯款。</p><button class="btn btn-primary w-full text-white" :disabled="submitting">{{ submitting ? '儲存中…' : '確認修改' }}</button></form>
    </AppOverlayPanel>
    <OrderUserDataReviewDrawer ref="userDataReviewRef" />
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { formatDateTime, formatDateTimeRange } from '../utils/datetime'
import AppIcon from '../components/AppIcon.vue'
import AppOverlayPanel from '../components/AppOverlayPanel.vue'
import AppSearchInput from '../components/AppSearchInput.vue'
import AdminPagination from '../components/AdminPagination.vue'
import OrderUserDataReviewDrawer from '../components/OrderUserDataReviewDrawer.vue'
import { showConfirm } from '../utils/sheet'
import { showToast } from '../utils/toast.js'

const API = API_BASE
const route = useRoute()
const router = useRouter()
const props = defineProps({ mode: { type: String, default: 'tickets', validator: value => ['tickets', 'bookings', 'orders'].includes(value) } })
const emit = defineEmits(['transfer-email', 'transfer-qr', 'attendance-qr'])
const loading = ref(true)
const loadError = ref('')
const items = ref([])
const summary = ref({})
const meta = reactive({ total: 0, limit: 10, offset: 0, hasMore: false })
const query = ref('')
const statusFilter = ref('')
const periodFilter = ref('')
const message = ref('')
const messageType = ref('success')
const actionOpen = ref(false)
const actionValue = ref('')
const actionError = ref('')
const selectedTicket = ref(null)
const submitting = ref(false)
const detailOpen = ref(false)
const selectedItem = ref(null)
const orderEditOpen = ref(false)
const selectedOrder = ref(null)
const orderEditForm = ref({ quantity: 1, remittanceLast5: '' })
const userDataReviewRef = ref(null)
let searchTimer = null
let requestId = 0

const statusOptions = computed(() => props.mode === 'tickets'
  ? [{ value: 'pending', label: '待首次核銷' }, { value: 'active', label: '使用中' }, { value: 'paused', label: '已暫停' }, { value: 'exhausted', label: '已用完' }, { value: 'expired', label: '已過期' }, { value: 'void', label: '已作廢' }]
  : props.mode === 'bookings'
    ? [{ value: 'booked', label: '已預約' }, { value: 'attended', label: '已出席' }, { value: 'cancelled', label: '已取消' }, { value: 'no_show', label: '未到' }]
    : [{ value: 'pending', label: '待匯款' }, { value: 'payment_review', label: '款項確認中' }, { value: 'paid', label: '已付款' }, { value: 'issued', label: '已發券' }, { value: 'cancelled', label: '已取消' }, { value: 'refunded', label: '已退款' }])
const searchPlaceholder = computed(() => props.mode === 'tickets' ? '搜尋商品、票號或服務商' : props.mode === 'bookings' ? '搜尋場次、地點、教練、票號或服務商' : '搜尋訂單、課程或服務商')
const hasFilters = computed(() => Boolean(query.value.trim() || statusFilter.value || periodFilter.value))
const summaryCards = computed(() => {
  const total = Number(summary.value?.total ?? meta.total) || 0
  const byStatus = summary.value?.byStatus || {}
  const cards = [{ key: 'all', label: '全部', value: total, status: '' }]
  return cards.concat(statusOptions.value.map(option => ({ key: option.value, label: option.label, value: Number(byStatus[option.value] || 0), status: option.value })))
})
const detailTitle = computed(() => props.mode === 'tickets' ? selectedItem.value?.productName || '課程票券' : props.mode === 'bookings' ? selectedItem.value?.sessionTitle || '課程預約' : selectedItem.value?.productName || '課程訂單')
const detailRows = computed(() => {
  const item = selectedItem.value || {}
  if (props.mode === 'tickets') return [{ label: '票券編號', value: item.code }, { label: '狀態', value: ticketStatusLabel(item.status) }, { label: '剩餘／總堂數', value: `${item.remainingUses ?? 0} / ${item.totalUses ?? 0}` }, { label: '發券日', value: formatDate(item.issuedAt) }, { label: '開卡期限', value: formatDate(item.activationDeadline) }, { label: '到期日', value: formatDate(item.expiresAt) }, { label: '轉讓', value: item.transferable ? '允許' : '不允許' }]
  if (props.mode === 'bookings') return [{ label: '場次', value: item.sessionTitle }, { label: '狀態', value: bookingStatusLabel(item.status) }, { label: '時間', value: formatRange(item.startsAt, item.endsAt) }, { label: '地點', value: item.location }, { label: '教練', value: item.coachName }, { label: '使用票券', value: item.ticketCode }, { label: '出席者', value: item.attendeeName }, { label: 'Email', value: item.attendeeEmail }, { label: '核銷碼', value: item.verifyCode }]
  return [{ label: '訂單編號', value: item.code }, { label: '付款狀態', value: orderStatusLabel(item.status) }, { label: '商品', value: item.productName }, { label: '數量', value: item.quantity }, { label: '單價', value: `NT$ ${formatMoney(item.unitPrice)}` }, { label: '總額', value: `NT$ ${formatMoney(item.totalAmount)}` }, { label: '發券詳情', value: item.ticketCodes?.length ? `${item.ticketCodes.length} 張：${item.ticketCodes.join('、')}` : (item.status === 'issued' ? `${item.issuedTicketCount || item.quantity || 0} 張已發行` : '尚未發券') }, { label: '購買人', value: item.buyerName }, { label: 'Email', value: item.buyerEmail }, { label: '手機', value: item.buyerPhone }, { label: '匯款後五碼', value: item.remittanceLast5 }, { label: '建立時間', value: formatDateTime(item.createdAt) }]
})

function formatMoney(value) { return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0)) }
function formatDate(value) { return value ? formatDateTime(value).slice(0, 10) : '' }
function formatRange(start, end) { return formatDateTimeRange(start, end, '－') || '時間待公告' }
function providerId(source = {}) { return String(source.providerUserId || source.provider_user_id || source.ownerUserId || source.owner_user_id || '').trim() }
function providerLabel(source = {}) { return source?.isPlatformCourse || !providerId(source) ? '平台課程' : (source.providerName || '服務商課程') }
function showMessage(value, type = 'success') { if (type === 'error') { message.value = value; messageType.value = type; return } message.value = ''; messageType.value = type; showToast(value, { tone: 'success' }) }
function ticketStatusLabel(status) { return ({ pending: '待首次核銷', active: '使用中', paused: '已暫停', exhausted: '已用完', expired: '已過期', void: '已作廢' })[status] || status }
function ticketStatusClass(status) { return status === 'active' ? 'ops-chip-success' : status === 'paused' ? 'ops-chip-warning' : status === 'pending' ? 'ops-chip-info' : '' }
function bookingStatusLabel(status) { return ({ booked: '已預約', attended: '已出席', cancelled: '已取消', no_show: '未到' })[status] || status }
function bookingStatusClass(status) { return status === 'attended' ? 'ops-chip-success' : status === 'booked' ? 'ops-chip-info' : status === 'no_show' ? 'ops-chip-warning' : '' }
function orderStatusLabel(status) { return ({ pending: '待匯款', payment_review: '款項確認中', paid: '已付款', issued: '已發券', cancelled: '已取消', refunded: '已退款' })[status] || status }
function orderStatusClass(status) { return status === 'issued' ? 'ops-chip-success' : ['payment_review', 'paid'].includes(status) ? 'ops-chip-info' : status === 'pending' ? 'ops-chip-warning' : '' }
function canCancel(booking) { const time = new Date(booking.startsAt).getTime(); return Number.isFinite(time) && time > Date.now() }
function isUpcoming(booking) { const time = new Date(booking.endsAt || booking.startsAt).getTime(); return Number.isFinite(time) && time >= Date.now() }
function canEditOrder(order) { return ['pending', 'payment_review'].includes(order?.status) }
function canTransferTicket(ticket) { if (!ticket?.transferable || !['pending', 'active', 'paused'].includes(ticket.status) || Number(ticket.remainingUses || 0) <= 0) return false; if (!ticket.expiresAt) return true; const expiry = new Date(ticket.expiresAt).getTime(); return Number.isFinite(expiry) && expiry >= Date.now() }
function unpack(data) {
  const payload = data?.data
  if (Array.isArray(payload)) return { items: payload, meta: { total: payload.length, limit: Math.max(payload.length, 10), offset: 0, hasMore: false }, summary: {} }
  if (Array.isArray(payload?.items)) return { items: payload.items, meta: payload.meta || {}, summary: payload.summary || {} }
  const legacy = Array.isArray(payload?.[props.mode]) ? payload[props.mode] : []
  return { items: legacy, meta: { total: legacy.length, limit: Math.max(legacy.length, 10), offset: 0, hasMore: false }, summary: {} }
}

async function loadData(offset = 0, options = {}) {
  const currentRequest = ++requestId
  loading.value = true
  loadError.value = ''
  try {
    const params = { paged: 1, view: props.mode, limit: meta.limit || 10, offset: Math.max(0, Number(offset) || 0), q: query.value.trim(), includeSummary: options.forceSummary || !Object.keys(summary.value || {}).length ? 1 : 0 }
    if (statusFilter.value) params.statuses = statusFilter.value
    if (props.mode === 'bookings' && periodFilter.value) params.upcoming = periodFilter.value === 'upcoming' ? 1 : 0
    const { data } = await axios.get(`${API}/courses/me`, { params })
    if (currentRequest !== requestId) return
    const result = unpack(data)
    items.value = result.items
    meta.total = Math.max(0, Number(result.meta?.total ?? result.items.length) || 0)
    meta.limit = Math.max(1, Number(result.meta?.limit ?? 10) || 10)
    meta.offset = Math.max(0, Number(result.meta?.offset ?? 0) || 0)
    meta.hasMore = Boolean(result.meta?.hasMore)
    if (Object.keys(result.summary || {}).length) summary.value = result.summary
    if (!result.items.length && meta.offset > 0) {
      const lastOffset = meta.total > 0 ? Math.floor((meta.total - 1) / meta.limit) * meta.limit : 0
      return loadData(lastOffset, options)
    }
    openHighlightedItem()
  } catch (error) { if (currentRequest === requestId) loadError.value = error?.response?.data?.message || '我的課程載入失敗' }
  finally { if (currentRequest === requestId) loading.value = false }
}

function scheduleSearch() { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(() => loadData(0), 300) }
function clearFilters() { query.value = ''; statusFilter.value = ''; periodFilter.value = '' }
function openDetail(item) { selectedItem.value = item; detailOpen.value = true }
function closeDetail() {
  detailOpen.value = false
  selectedItem.value = null
  const nextQuery = { ...route.query }
  delete nextQuery.order
  delete nextQuery.booking
  delete nextQuery.ticket
  router.replace({ query: nextQuery }).catch(() => {})
}
function openHighlightedItem() { const target = String(props.mode === 'orders' ? route.query.order || '' : props.mode === 'bookings' ? route.query.booking || '' : route.query.ticket || ''); if (!target) return; const item = items.value.find(row => String(row.id) === target || String(row.code) === target); if (item) openDetail(item) }
function handleAuthChanged() {
  if (searchTimer) clearTimeout(searchTimer)
  requestId += 1
  query.value = ''
  statusFilter.value = ''
  periodFilter.value = ''
  items.value = []
  summary.value = {}
  meta.total = 0
  meta.offset = 0
  meta.hasMore = false
  message.value = ''
  closeAction()
  closeOrderEdit()
  closeDetail()
  loadData(0, { forceSummary: true })
}
function handleStorage(event) { if (!event || event.key === 'user_info') handleAuthChanged() }
function openAction(ticket) { selectedTicket.value = ticket; actionValue.value = ''; actionError.value = ''; actionOpen.value = true }
function closeAction() { actionOpen.value = false; selectedTicket.value = null; actionValue.value = ''; actionError.value = '' }
function requestTransferEmail(ticket) { emit('transfer-email', ticket) }
function requestTransferQr(ticket) { emit('transfer-qr', ticket) }
function requestAttendanceQr(booking) { emit('attendance-qr', booking) }

async function submitAction() {
  if (!selectedTicket.value || !actionValue.value) return
  submitting.value = true
  try { await axios.post(`${API}/courses/tickets/${selectedTicket.value.id}/pause`, { reason: actionValue.value }); closeAction(); await loadData(meta.offset, { forceSummary: true }); showMessage('票券已暫停。') }
  catch (error) { actionError.value = error?.response?.data?.message || '票券操作失敗' }
  finally { submitting.value = false }
}
async function resumeTicket(ticket) { submitting.value = true; try { await axios.post(`${API}/courses/tickets/${ticket.id}/resume`); await loadData(meta.offset, { forceSummary: true }); showMessage('票券已恢復使用。') } catch (error) { showMessage(error?.response?.data?.message || '票券恢復失敗', 'error') } finally { submitting.value = false } }
async function cancelBooking(booking) { if (!(await showConfirm(`確定取消「${booking.sessionTitle}」的預約？`, { title: '取消課程預約', confirmText: '確定取消' }))) return; try { await axios.delete(`${API}/courses/bookings/${booking.id}`); await loadData(meta.offset, { forceSummary: true }); showMessage('預約已取消。') } catch (error) { showMessage(error?.response?.data?.message || '取消預約失敗', 'error') } }

async function openOrderEdit(order) {
  selectedOrder.value = order
  orderEditForm.value = { quantity: Number(order.quantity || 1), remittanceLast5: String(order.remittanceLast5 || '') }
  actionError.value = ''
  orderEditOpen.value = true
  try {
    const contact = await currentContact()
    orderEditForm.value.remittanceLast5 = contact.remittanceLast5
  } catch (error) {
    actionError.value = error?.response?.data?.message || '無法取得目前會員資料'
  }
}
function closeOrderEdit() { orderEditOpen.value = false; selectedOrder.value = null; actionError.value = '' }
async function currentContact() { const { data } = await axios.get(`${API}/me`); const profile = data?.data || data || {}; return { username: String(profile.username || '').trim(), email: String(profile.email || '').trim(), phone: String(profile.phone || '').trim(), remittanceLast5: String((profile.remittanceLast5 ?? profile.remittance_last5) || '').trim() } }
async function saveOrderEdit() {
  if (!selectedOrder.value || submitting.value) return
  submitting.value = true
  try {
    const contact = await currentContact()
    orderEditForm.value.remittanceLast5 = contact.remittanceLast5
    const accepted = await userDataReviewRef.value?.open({ title: '再次確認課程訂單資料', description: '修改後的訂單會使用目前會員聯絡資料，款項確認中的訂單會回到待匯款。', summary: [{ key: 'course-order-edit', label: selectedOrder.value.productName, value: `${orderEditForm.value.quantity} 份`, detail: `匯款後五碼 ${orderEditForm.value.remittanceLast5}` }], fields: [{ key: 'username', label: '真實姓名', value: contact.username }, { key: 'email', label: '電子信箱', value: contact.email }, { key: 'phone', label: '手機號碼', value: contact.phone }, { key: 'remittanceLast5', label: '會員匯款後五碼', value: contact.remittanceLast5 }] })
    if (accepted !== true) return
    await axios.patch(`${API}/courses/orders/${selectedOrder.value.id}`, { quantity: Math.max(1, Number(orderEditForm.value.quantity || 1)), remittanceLast5: String(orderEditForm.value.remittanceLast5 || '').trim(), contactConfirmation: contact })
    closeOrderEdit(); await loadData(meta.offset, { forceSummary: true }); showMessage('課程訂單已更新。')
  } catch (error) { actionError.value = error?.response?.data?.message || '課程訂單更新失敗' }
  finally { submitting.value = false }
}
async function cancelOrder(order) { if (!(await showConfirm(`確定取消課程訂單 ${order.code}？`, { title: '取消課程訂單', confirmText: '確認取消' }))) return; try { await axios.post(`${API}/courses/orders/${order.id}/cancel`); await loadData(meta.offset, { forceSummary: true }); showMessage('課程訂單已取消。') } catch (error) { showMessage(error?.response?.data?.message || '課程訂單取消失敗', 'error') } }

watch(query, scheduleSearch)
watch(statusFilter, () => loadData(0))
watch(periodFilter, () => loadData(0))
watch(() => props.mode, () => { items.value = []; summary.value = {}; meta.offset = 0; query.value = ''; statusFilter.value = ''; periodFilter.value = ''; loadData(0, { forceSummary: true }) })
defineExpose({ refresh: () => loadData(meta.offset, { forceSummary: true }) })
onMounted(() => {
  window.addEventListener('auth-changed', handleAuthChanged)
  window.addEventListener('storage', handleStorage)
  loadData(0, { forceSummary: true })
})
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  window.removeEventListener('auth-changed', handleAuthChanged)
  window.removeEventListener('storage', handleStorage)
})
</script>
