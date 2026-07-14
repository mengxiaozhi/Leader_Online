<template>
  <section class="space-y-5">
      <div class="ops-toolbar sticky top-[65px] z-30">
        <div class="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          <button v-for="tab in tabs" :key="tab.key" class="min-h-[42px] rounded-md px-2 py-2 text-sm font-medium transition" :class="activeTab === tab.key ? 'bg-white text-primary shadow-sm' : 'text-slate-600'" @click="activeTab = tab.key">
            {{ tab.label }} <span class="hidden sm:inline">({{ tab.count }})</span>
          </button>
        </div>
      </div>

      <p v-if="message" class="rounded-lg border px-4 py-3 text-sm" :class="messageType === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'">{{ message }}</p>

      <section v-if="loading" class="grid gap-4 md:grid-cols-2"><div v-for="index in 4" :key="index" class="ticket-card animate-pulse p-5"><div class="h-5 w-2/3 rounded bg-slate-200"></div><div class="mt-4 h-24 rounded bg-slate-100"></div></div></section>

      <section v-else-if="activeTab === 'tickets'" class="space-y-4">
        <div v-if="!tickets.length" class="surface-section text-sm leading-6 text-slate-600">目前沒有課程票券。購買課程並由行政確認款項後，票券會出現在這裡。</div>
        <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <article v-for="ticket in tickets" :key="ticket.id" class="ticket-card flex flex-col gap-4 p-5">
            <header class="flex items-start justify-between gap-3"><div><p class="text-sm text-slate-500">{{ ticket.code }}</p><h2 class="ui-title mt-1 text-xl text-slate-950">{{ ticket.productName }}</h2></div><span class="ops-chip" :class="ticketStatusClass(ticket.status)">{{ ticketStatusLabel(ticket.status) }}</span></header>
            <div class="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4">
              <div><p class="text-sm text-slate-500">剩餘堂數</p><p class="stat-number mt-1 text-3xl text-primary">{{ ticket.remainingUses }}</p></div>
              <div><p class="text-sm text-slate-500">總堂數</p><p class="stat-number mt-1 text-3xl text-slate-800">{{ ticket.totalUses }}</p></div>
            </div>
            <dl class="space-y-2 text-sm text-slate-600">
              <div class="flex justify-between gap-3"><dt>發券日</dt><dd class="text-right text-slate-800">{{ formatDate(ticket.issuedAt) }}</dd></div>
              <div class="flex justify-between gap-3"><dt>{{ ticket.activatedAt ? '到期日' : '開卡期限' }}</dt><dd class="text-right text-slate-800">{{ formatDate(ticket.expiresAt || ticket.activationDeadline) || '未設定' }}</dd></div>
              <div v-if="ticket.pauseReason" class="flex justify-between gap-3"><dt>暫停原因</dt><dd class="text-right text-slate-800">{{ ticket.pauseReason }}</dd></div>
            </dl>
            <div class="mt-auto grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <button v-if="ticket.status === 'active'" class="btn btn-outline btn-sm" @click="openAction(ticket, 'pause')"><AppIcon name="pause" class="h-4 w-4" /> 暫停</button>
              <button v-if="ticket.status === 'paused'" class="btn btn-outline btn-sm" @click="resumeTicket(ticket)"><AppIcon name="refresh" class="h-4 w-4" /> 恢復</button>
              <button v-if="ticket.transferable && ['pending','active','paused'].includes(ticket.status)" class="btn btn-outline btn-sm" @click="openAction(ticket, 'transfer')"><AppIcon name="user" class="h-4 w-4" /> 轉讓</button>
              <router-link v-if="['pending','active'].includes(ticket.status) && ticket.remainingUses > 0" to="/store?tab=courses&courseView=sessions" class="btn btn-primary btn-sm text-white"><AppIcon name="calendar" class="h-4 w-4" /> 預約</router-link>
            </div>
          </article>
        </div>
      </section>

      <section v-else-if="activeTab === 'bookings'" class="space-y-4">
        <div v-if="!bookings.length" class="surface-section text-sm leading-6 text-slate-600">目前沒有課程預約。前往商店的課程分頁選擇開放場次。</div>
        <div v-else class="grid gap-4 lg:grid-cols-2">
          <article v-for="booking in bookings" :key="booking.id" class="ticket-card flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0 space-y-3">
              <div class="flex flex-wrap items-center gap-2"><h2 class="ui-title text-xl text-slate-950">{{ booking.sessionTitle }}</h2><span class="ops-chip" :class="bookingStatusClass(booking.status)">{{ bookingStatusLabel(booking.status) }}</span></div>
              <dl class="space-y-2 text-sm text-slate-600"><div class="flex gap-2"><AppIcon name="calendar" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ formatRange(booking.startsAt, booking.endsAt) }}</span></div><div class="flex gap-2"><AppIcon name="map-pin" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ booking.location || '地點待公告' }}</span></div><div class="flex gap-2"><AppIcon name="user" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ booking.coachName || '教練待公告' }}</span></div><div class="flex gap-2"><AppIcon name="ticket" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ booking.ticketCode }}</span></div></dl>
            </div>
            <button v-if="booking.status === 'booked' && canCancel(booking)" class="btn btn-outline btn-sm shrink-0 text-red-700" @click="cancelBooking(booking)">取消預約</button>
          </article>
        </div>
      </section>

      <section v-else class="space-y-4">
        <div v-if="!orders.length" class="surface-section text-sm leading-6 text-slate-600">目前沒有課程訂單。</div>
        <div v-else class="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div class="overflow-x-auto"><table class="table-default min-w-[760px]"><thead><tr><th>訂單編號</th><th>課程</th><th>數量</th><th>金額</th><th>匯款後五碼</th><th>狀態</th><th>建立時間</th></tr></thead><tbody><tr v-for="order in orders" :key="order.id"><td class="font-medium text-slate-900">{{ order.code }}</td><td>{{ order.productName }}</td><td>{{ order.quantity }}</td><td class="money-value">NT$ {{ formatMoney(order.totalAmount) }}</td><td>{{ order.remittanceLast5 || '—' }}</td><td><span class="ops-chip" :class="orderStatusClass(order.status)">{{ orderStatusLabel(order.status) }}</span></td><td>{{ formatDateTime(order.createdAt) }}</td></tr></tbody></table></div>
        </div>
      </section>

    <transition name="backdrop-fade"><div v-if="actionOpen" class="fixed inset-0 z-50 bg-slate-950/40" @click.self="closeAction"></div></transition>
    <transition name="sheet-pop">
      <section v-if="actionOpen" class="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t bg-white p-5 pb-safe sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:p-6">
        <header class="mb-5 flex items-start justify-between gap-3"><div><p class="text-sm text-slate-500">{{ actionType === 'pause' ? '暫停票券' : '轉讓票券' }}</p><h2 class="ui-title text-2xl text-slate-950">{{ selectedTicket?.productName }}</h2></div><button class="btn btn-ghost btn-sm" @click="closeAction"><AppIcon name="x" class="h-5 w-5" /></button></header>
        <form class="space-y-4" @submit.prevent="submitAction">
          <label v-if="actionType === 'pause'" class="block space-y-2 text-sm font-medium text-slate-700">暫停原因<textarea v-model.trim="actionValue" required rows="4" class="w-full" placeholder="例如：工作、家庭或健康因素"></textarea></label>
          <label v-else class="block space-y-2 text-sm font-medium text-slate-700">受讓人 Email<input v-model.trim="actionValue" required type="email" class="w-full" placeholder="對方需先註冊平台帳號" /></label>
          <p class="text-sm leading-6 text-slate-600">{{ actionType === 'pause' ? '暫停後不可預約或核銷，之後可自行恢復使用。' : '確認後票券與剩餘堂數會立即移轉給受讓人；若仍有未出席預約，請先取消後再轉讓。' }}</p>
          <button class="btn btn-primary w-full text-white" :disabled="submitting">{{ submitting ? '處理中…' : '確認送出' }}</button>
        </form>
      </section>
    </transition>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { formatDateTime, formatDateTimeRange } from '../utils/datetime'
import AppIcon from '../components/AppIcon.vue'

const API = API_BASE
const loading = ref(true)
const activeTab = ref('tickets')
const tickets = ref([])
const bookings = ref([])
const orders = ref([])
const message = ref('')
const messageType = ref('success')
const actionOpen = ref(false)
const actionType = ref('pause')
const actionValue = ref('')
const selectedTicket = ref(null)
const submitting = ref(false)

const tabs = computed(() => [
  { key: 'tickets', label: '我的票券', count: tickets.value.length },
  { key: 'bookings', label: '我的預約', count: bookings.value.length },
  { key: 'orders', label: '購買紀錄', count: orders.value.length },
])

function formatMoney(value) { return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0)) }
function formatDate(value) { return value ? formatDateTime(value).slice(0, 10) : '' }
function formatRange(start, end) { return formatDateTimeRange(start, end, '－') || '時間待公告' }
function showMessage(value, type = 'success') { message.value = value; messageType.value = type; window.scrollTo({ top: 0, behavior: 'smooth' }) }
function ticketStatusLabel(status) { return ({ pending: '待首次核銷', active: '使用中', paused: '已暫停', exhausted: '已用完', expired: '已過期', void: '已作廢' })[status] || status }
function ticketStatusClass(status) { return status === 'active' ? 'ops-chip-success' : status === 'paused' ? 'ops-chip-warning' : status === 'pending' ? 'ops-chip-info' : '' }
function bookingStatusLabel(status) { return ({ booked: '已預約', attended: '已出席', cancelled: '已取消', no_show: '未到' })[status] || status }
function bookingStatusClass(status) { return status === 'attended' ? 'ops-chip-success' : status === 'booked' ? 'ops-chip-info' : status === 'no_show' ? 'ops-chip-warning' : '' }
function orderStatusLabel(status) { return ({ pending: '待匯款', payment_review: '款項確認中', paid: '已付款', issued: '已發券', cancelled: '已取消', refunded: '已退款' })[status] || status }
function orderStatusClass(status) { return status === 'issued' ? 'ops-chip-success' : ['payment_review','paid'].includes(status) ? 'ops-chip-info' : status === 'pending' ? 'ops-chip-warning' : '' }
function canCancel(booking) { const time = new Date(booking.startsAt).getTime(); return Number.isFinite(time) && time > Date.now() }

async function loadData() {
  loading.value = true
  try {
    const { data } = await axios.get(`${API}/courses/me`)
    tickets.value = data?.data?.tickets || []
    bookings.value = data?.data?.bookings || []
    orders.value = data?.data?.orders || []
  } catch (error) { showMessage(error?.response?.data?.message || '我的課程載入失敗', 'error') }
  finally { loading.value = false }
}

function openAction(ticket, type) { selectedTicket.value = ticket; actionType.value = type; actionValue.value = ''; actionOpen.value = true }
function closeAction() { actionOpen.value = false; selectedTicket.value = null; actionValue.value = '' }

async function submitAction() {
  if (!selectedTicket.value || !actionValue.value) return
  submitting.value = true
  try {
    if (actionType.value === 'pause') await axios.post(`${API}/courses/tickets/${selectedTicket.value.id}/pause`, { reason: actionValue.value })
    else await axios.post(`${API}/courses/tickets/${selectedTicket.value.id}/transfer`, { email: actionValue.value })
    const completedAction = actionType.value
    closeAction(); await loadData(); showMessage(completedAction === 'pause' ? '票券已暫停。' : '票券已完成轉讓。')
  } catch (error) { showMessage(error?.response?.data?.message || '票券操作失敗', 'error') }
  finally { submitting.value = false }
}

async function resumeTicket(ticket) {
  submitting.value = true
  try { await axios.post(`${API}/courses/tickets/${ticket.id}/resume`); await loadData(); showMessage('票券已恢復使用。') }
  catch (error) { showMessage(error?.response?.data?.message || '票券恢復失敗', 'error') }
  finally { submitting.value = false }
}

async function cancelBooking(booking) {
  if (!window.confirm(`確定取消「${booking.sessionTitle}」的預約？`)) return
  try { await axios.delete(`${API}/courses/bookings/${booking.id}`); await loadData(); showMessage('預約已取消。') }
  catch (error) { showMessage(error?.response?.data?.message || '取消預約失敗', 'error') }
}

onMounted(loadData)
</script>
