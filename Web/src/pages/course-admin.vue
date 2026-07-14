<template>
  <section class="space-y-5">
      <section class="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <article v-for="item in overviewCards" :key="item.key" class="surface-section"><p class="text-sm text-slate-500">{{ item.label }}</p><p class="stat-number mt-2 text-3xl text-slate-950">{{ item.value }}</p></article>
      </section>

      <div class="ops-toolbar sticky top-[65px] z-30 overflow-x-auto">
        <div class="flex min-w-max gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          <button v-for="tab in tabs" :key="tab.key" class="min-h-[40px] rounded-md px-4 py-2 text-sm font-medium transition" :class="activeTab === tab.key ? 'bg-white text-primary shadow-sm' : 'text-slate-600'" @click="selectTab(tab.key)">{{ tab.label }}</button>
        </div>
      </div>

      <p v-if="message" class="rounded-lg border px-4 py-3 text-sm" :class="messageType === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'">{{ message }}</p>

      <section v-if="activeTab === 'overview'" class="grid gap-4 lg:grid-cols-2">
        <article class="surface-section space-y-4"><h2 class="ui-title text-xl text-slate-950">營運流程</h2><ol class="space-y-3 text-sm leading-6 text-slate-600"><li><strong class="text-slate-900">1. 商品：</strong>建立課程票種、堂數、效期與售價，發布後顯示在前台。</li><li><strong class="text-slate-900">2. 場次：</strong>設定教練、地點、時間、名額與適用商品。</li><li><strong class="text-slate-900">3. 訂單：</strong>確認款項後發券，系統會依購買數量產生計次票。</li><li><strong class="text-slate-900">4. 核銷：</strong>學員預約不扣堂，教練在預約名單按「核銷出席」才扣 1 堂。</li></ol></article>
        <article class="surface-section space-y-4"><h2 class="ui-title text-xl text-slate-950">平台整合</h2><div class="space-y-3 text-sm leading-6 text-slate-600"><p>課程商品與場次顯示在原商店，學員票券、預約與購買紀錄顯示在原皮夾。</p><p>此頁直接管理商城、計次票、開卡效期、預約、核銷、暫停、恢復與轉讓，不再依賴外部課程商城。</p></div></article>
      </section>

      <section v-else-if="activeTab === 'products'" class="space-y-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 class="ui-title text-xl text-slate-950">課程商品</h2><p class="text-sm text-slate-600">定義課程售價、堂數、效期與發布狀態。</p></div><button class="btn btn-primary text-white" @click="openProductForm()"><AppIcon name="plus" class="h-4 w-4" /> 新增商品</button></div>
        <AdminTableState :loading="loading" :empty="!products.length" empty-text="尚無課程商品。">
          <table class="table-default min-w-[1040px]"><thead><tr><th>代碼</th><th>名稱</th><th>分類</th><th>價格</th><th>堂數／效期</th><th>轉讓</th><th>狀態</th><th>操作</th></tr></thead><tbody><tr v-for="product in products" :key="product.id"><td>{{ product.code }}</td><td><p class="font-medium text-slate-900">{{ product.name }}</p><p class="mt-1 max-w-sm line-clamp-2 text-sm text-slate-500">{{ product.summary || product.description }}</p></td><td>{{ product.category || '—' }}</td><td class="money-value">NT$ {{ formatMoney(product.price) }}</td><td>{{ product.classCount }} 堂／{{ product.validDays }} 天</td><td>{{ product.transferable ? '可' : '不可' }}</td><td><span class="ops-chip" :class="product.status === 'published' ? 'ops-chip-success' : product.status === 'archived' ? '' : 'ops-chip-warning'">{{ productStatusLabel(product.status) }}</span></td><td><div class="flex gap-2"><button class="btn btn-outline btn-sm" @click="openProductForm(product)"><AppIcon name="edit" class="h-4 w-4" /> 編輯</button><button v-if="product.status !== 'archived'" class="btn btn-outline btn-sm text-red-700" @click="archiveProduct(product)">封存</button></div></td></tr></tbody></table>
        </AdminTableState>
      </section>

      <section v-else-if="activeTab === 'sessions'" class="space-y-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 class="ui-title text-xl text-slate-950">課程場次</h2><p class="text-sm text-slate-600">管理教練、時間、地點、名額與預約開放狀態。</p></div><button class="btn btn-primary text-white" @click="openSessionForm()"><AppIcon name="plus" class="h-4 w-4" /> 新增場次</button></div>
        <AdminTableState :loading="loading" :empty="!sessions.length" empty-text="尚無課程場次。">
          <table class="table-default min-w-[1120px]"><thead><tr><th>場次</th><th>適用商品</th><th>時間</th><th>教練／地點</th><th>名額</th><th>狀態</th><th>操作</th></tr></thead><tbody><tr v-for="session in sessions" :key="session.id"><td><p class="font-medium text-slate-900">{{ session.title }}</p><p class="text-sm text-slate-500">{{ session.code }}</p></td><td>{{ session.productName || '全部票券' }}</td><td>{{ formatRange(session.startsAt, session.endsAt) }}</td><td><p>{{ session.coachName || '教練待公告' }}</p><p class="text-sm text-slate-500">{{ session.location || '地點待公告' }}</p></td><td>{{ session.bookedCount }}/{{ session.capacity }}</td><td><span class="ops-chip" :class="session.status === 'open' ? 'ops-chip-success' : session.status === 'cancelled' ? '' : 'ops-chip-warning'">{{ sessionStatusLabel(session.status) }}</span></td><td><div class="flex gap-2"><button class="btn btn-outline btn-sm" @click="openSessionForm(session)"><AppIcon name="edit" class="h-4 w-4" /> 編輯</button><button v-if="session.status !== 'cancelled'" class="btn btn-outline btn-sm text-red-700" @click="cancelSession(session)">取消</button></div></td></tr></tbody></table>
        </AdminTableState>
      </section>

      <section v-else-if="activeTab === 'orders'" class="space-y-4">
        <div><h2 class="ui-title text-xl text-slate-950">課程訂單</h2><p class="text-sm text-slate-600">確認款項、調整狀態並依訂單數量一次發券。</p></div>
        <AdminTableState :loading="loading" :empty="!orders.length" empty-text="尚無課程訂單。">
          <table class="table-default min-w-[1220px]"><thead><tr><th>訂單</th><th>購買人</th><th>課程</th><th>數量／金額</th><th>後五碼</th><th>狀態</th><th>建立時間</th><th>操作</th></tr></thead><tbody><tr v-for="order in orders" :key="order.id"><td class="font-medium text-slate-900">{{ order.code }}</td><td><p>{{ order.buyerName }}</p><p class="text-sm text-slate-500">{{ order.buyerEmail }}</p></td><td>{{ order.productName }}</td><td>{{ order.quantity }} 份／<span class="money-value">NT$ {{ formatMoney(order.totalAmount) }}</span></td><td>{{ order.remittanceLast5 || '—' }}</td><td><select v-model="order.status" class="min-w-32" :disabled="order.status === 'issued'" @change="updateOrder(order)"><option v-for="option in orderStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></td><td>{{ formatDateTime(order.createdAt) }}</td><td><button v-if="order.status !== 'issued'" class="btn btn-primary btn-sm text-white" :disabled="busyId === `order-${order.id}`" @click="issueOrder(order)"><AppIcon name="ticket" class="h-4 w-4" /> 發券</button><span v-else class="ops-chip ops-chip-success">已完成</span></td></tr></tbody></table>
        </AdminTableState>
      </section>

      <section v-else-if="activeTab === 'tickets'" class="space-y-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 class="ui-title text-xl text-slate-950">課程票券</h2><p class="text-sm text-slate-600">可手動發券，或調整剩餘堂數、效期與票券狀態。</p></div><button class="btn btn-primary text-white" @click="openTicketForm"><AppIcon name="plus" class="h-4 w-4" /> 手動發券</button></div>
        <AdminTableState :loading="loading" :empty="!tickets.length" empty-text="尚無課程票券。">
          <table class="table-default min-w-[1240px]"><thead><tr><th>票券</th><th>持有人</th><th>商品</th><th>剩餘／總堂數</th><th>效期</th><th>狀態</th><th>操作</th></tr></thead><tbody><tr v-for="ticket in tickets" :key="ticket.id"><td class="font-medium text-slate-900">{{ ticket.code }}</td><td><p>{{ ticket.ownerName || '—' }}</p><p class="text-sm text-slate-500">{{ ticket.ownerEmail }}</p></td><td>{{ ticket.productName }}</td><td><input v-model.number="ticket.remainingUses" type="number" min="0" max="9999" class="w-24" />／{{ ticket.totalUses }}</td><td><input v-model="ticket.expiresAt" type="date" class="min-w-40" /></td><td><select v-model="ticket.status" class="min-w-32"><option v-for="option in ticketStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></td><td><button class="btn btn-outline btn-sm" :disabled="busyId === `ticket-${ticket.id}`" @click="updateTicket(ticket)">儲存</button></td></tr></tbody></table>
        </AdminTableState>
      </section>

      <section v-else class="space-y-4">
        <div><h2 class="ui-title text-xl text-slate-950">預約與核銷</h2><p class="text-sm text-slate-600">查看場次名單；核銷出席會立即扣除票券 1 堂。</p></div>
        <div class="ops-toolbar"><AppSearchInput v-model="bookingSearch" placeholder="搜尋場次、票券、姓名或 Email" /></div>
        <AdminTableState :loading="loading" :empty="!filteredBookings.length" empty-text="尚無課程預約。">
          <table class="table-default min-w-[1220px]"><thead><tr><th>場次</th><th>學員</th><th>票券</th><th>時間／地點</th><th>狀態</th><th>操作</th></tr></thead><tbody><tr v-for="booking in filteredBookings" :key="booking.id"><td><p class="font-medium text-slate-900">{{ booking.sessionTitle }}</p><p class="text-sm text-slate-500">{{ booking.sessionCode }}</p></td><td><p>{{ booking.attendeeName }}</p><p class="text-sm text-slate-500">{{ booking.attendeeEmail }}</p></td><td><p>{{ booking.ticketCode }}</p><p class="text-sm text-slate-500">剩餘 {{ booking.remainingUses }} 堂</p></td><td><p>{{ formatDateTime(booking.startsAt) }}</p><p class="text-sm text-slate-500">{{ booking.location || '地點待公告' }}</p></td><td><span class="ops-chip" :class="booking.status === 'attended' ? 'ops-chip-success' : booking.status === 'booked' ? 'ops-chip-info' : ''">{{ bookingStatusLabel(booking.status) }}</span></td><td><button v-if="booking.status === 'booked'" class="btn btn-primary btn-sm text-white" :disabled="busyId === `booking-${booking.id}`" @click="attendBooking(booking)"><AppIcon name="check" class="h-4 w-4" /> 核銷出席</button><span v-else>—</span></td></tr></tbody></table>
        </AdminTableState>
      </section>

    <transition name="backdrop-fade"><div v-if="dialogOpen" class="fixed inset-0 z-50 bg-slate-950/40" @click.self="closeDialog"></div></transition>
    <transition name="drawer-right"><aside v-if="dialogOpen" class="ops-drawer ops-drawer-wide"><header class="mb-5 flex items-start justify-between gap-3"><div><p class="text-sm text-slate-500">{{ dialogEyebrow }}</p><h2 class="ui-title text-2xl text-slate-950">{{ dialogTitle }}</h2></div><button class="btn btn-ghost btn-sm" @click="closeDialog"><AppIcon name="x" class="h-5 w-5" /></button></header>
      <form v-if="dialogType === 'product'" class="space-y-4" @submit.prevent="saveProduct">
        <div class="grid gap-4 sm:grid-cols-2"><FormField label="商品名稱" required><input v-model.trim="productForm.name" required class="w-full" /></FormField><FormField label="分類"><input v-model.trim="productForm.category" class="w-full" placeholder="例如：游泳團練" /></FormField><FormField label="售價"><input v-model.number="productForm.price" type="number" min="0" required class="w-full" /></FormField><FormField label="堂數"><input v-model.number="productForm.classCount" type="number" min="1" required class="w-full" /></FormField><FormField label="開卡後效期（天）"><input v-model.number="productForm.validDays" type="number" min="1" required class="w-full" /></FormField><FormField label="發券後開卡期限（天）"><input v-model.number="productForm.activationDays" type="number" min="1" required class="w-full" /></FormField><FormField label="發布狀態"><select v-model="productForm.status" class="w-full"><option value="draft">草稿</option><option value="published">已發布</option><option value="archived">已封存</option></select></FormField><FormField label="排序"><input v-model.number="productForm.sortOrder" type="number" class="w-full" /></FormField></div>
        <FormField label="簡介"><textarea v-model.trim="productForm.summary" rows="2" class="w-full"></textarea></FormField><FormField label="完整說明"><textarea v-model.trim="productForm.description" rows="6" class="w-full"></textarea></FormField><FormField label="封面圖片網址"><input v-model.trim="productForm.coverUrl" type="url" class="w-full" /></FormField><label class="flex items-center gap-3 text-sm text-slate-700"><input v-model="productForm.transferable" type="checkbox" class="h-4 w-4" /> 允許學員轉讓此票券</label><button class="btn btn-primary w-full text-white" :disabled="submitting">{{ submitting ? '儲存中…' : '儲存商品' }}</button>
      </form>
      <form v-else-if="dialogType === 'session'" class="space-y-4" @submit.prevent="saveSession">
        <FormField label="場次名稱" required><input v-model.trim="sessionForm.title" required class="w-full" /></FormField><div class="grid gap-4 sm:grid-cols-2"><FormField label="適用商品"><select v-model.number="sessionForm.productId" class="w-full"><option :value="null">全部課程票券</option><option v-for="product in activeProducts" :key="product.id" :value="product.id">{{ product.name }}</option></select></FormField><FormField label="狀態"><select v-model="sessionForm.status" class="w-full"><option value="draft">草稿</option><option value="open">開放預約</option><option value="closed">關閉預約</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></FormField><FormField label="開始時間" required><input v-model="sessionForm.startsAt" type="datetime-local" required class="w-full" /></FormField><FormField label="結束時間" required><input v-model="sessionForm.endsAt" type="datetime-local" required class="w-full" /></FormField><FormField label="預約開放時間"><input v-model="sessionForm.bookingOpenAt" type="datetime-local" class="w-full" /></FormField><FormField label="預約截止時間"><input v-model="sessionForm.bookingCloseAt" type="datetime-local" class="w-full" /></FormField><FormField label="教練姓名"><input v-model.trim="sessionForm.coachName" class="w-full" /></FormField><FormField label="地點"><input v-model.trim="sessionForm.location" class="w-full" /></FormField><FormField label="名額"><input v-model.number="sessionForm.capacity" type="number" min="1" class="w-full" /></FormField></div><FormField label="場次備註"><textarea v-model.trim="sessionForm.notes" rows="4" class="w-full"></textarea></FormField><button class="btn btn-primary w-full text-white" :disabled="submitting">{{ submitting ? '儲存中…' : '儲存場次' }}</button>
      </form>
      <form v-else class="space-y-4" @submit.prevent="issueManualTicket"><FormField label="持有人 Email" required><input v-model.trim="ticketForm.ownerEmail" type="email" required class="w-full" placeholder="對方需先註冊平台帳號" /></FormField><FormField label="課程商品" required><select v-model.number="ticketForm.productId" required class="w-full"><option :value="null" disabled>請選擇商品</option><option v-for="product in activeProducts" :key="product.id" :value="product.id">{{ product.name }}（{{ product.classCount }} 堂）</option></select></FormField><p class="text-sm leading-6 text-slate-600">手動發券會建立待首次核銷的票券，不會建立購買訂單。</p><button class="btn btn-primary w-full text-white" :disabled="submitting">{{ submitting ? '發券中…' : '確認發券' }}</button></form>
    </aside></transition>
  </section>
</template>

<script setup>
import { computed, defineComponent, h, onMounted, ref } from 'vue'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { formatDateTime, formatDateTimeRange } from '../utils/datetime'
import AppIcon from '../components/AppIcon.vue'
import AppSearchInput from '../components/AppSearchInput.vue'

const API = API_BASE
const tabs = [{ key: 'overview', label: '總覽' }, { key: 'products', label: '課程商品' }, { key: 'sessions', label: '場次' }, { key: 'orders', label: '訂單' }, { key: 'tickets', label: '票券' }, { key: 'bookings', label: '預約核銷' }]
const activeTab = ref('overview')
const loading = ref(false)
const overview = ref({ products: 0, openSessions: 0, pendingOrders: 0, activeTickets: 0, upcomingBookings: 0 })
const products = ref([])
const sessions = ref([])
const orders = ref([])
const tickets = ref([])
const bookings = ref([])
const bookingSearch = ref('')
const loaded = ref(new Set())
const message = ref('')
const messageType = ref('success')
const busyId = ref('')
const dialogOpen = ref(false)
const dialogType = ref('product')
const editingId = ref(null)
const submitting = ref(false)

const emptyProductForm = () => ({ name: '', category: '', summary: '', description: '', coverUrl: '', price: 0, classCount: 1, validDays: 120, activationDays: 120, transferable: false, status: 'draft', sortOrder: 0 })
const emptySessionForm = () => ({ productId: null, title: '', coachName: '', location: '', startsAt: '', endsAt: '', bookingOpenAt: '', bookingCloseAt: '', capacity: 20, notes: '', status: 'draft' })
const productForm = ref(emptyProductForm())
const sessionForm = ref(emptySessionForm())
const ticketForm = ref({ ownerEmail: '', productId: null })

const orderStatusOptions = [{ value: 'pending', label: '待匯款' }, { value: 'payment_review', label: '款項確認中' }, { value: 'paid', label: '已付款' }, { value: 'issued', label: '已發券' }, { value: 'cancelled', label: '已取消' }, { value: 'refunded', label: '已退款' }]
const ticketStatusOptions = [{ value: 'pending', label: '待首次核銷' }, { value: 'active', label: '使用中' }, { value: 'paused', label: '已暫停' }, { value: 'exhausted', label: '已用完' }, { value: 'expired', label: '已過期' }, { value: 'void', label: '已作廢' }]
const overviewCards = computed(() => [{ key: 'products', label: '課程商品', value: overview.value.products }, { key: 'sessions', label: '開放場次', value: overview.value.openSessions }, { key: 'orders', label: '待處理訂單', value: overview.value.pendingOrders }, { key: 'tickets', label: '有效票券', value: overview.value.activeTickets }, { key: 'bookings', label: '待出席預約', value: overview.value.upcomingBookings }])
const activeProducts = computed(() => products.value.filter((item) => item.status !== 'archived'))
const filteredBookings = computed(() => { const q = bookingSearch.value.trim().toLowerCase(); if (!q) return bookings.value; return bookings.value.filter((item) => [item.sessionTitle, item.sessionCode, item.attendeeName, item.attendeeEmail, item.ticketCode].some((value) => String(value || '').toLowerCase().includes(q))) })
const dialogEyebrow = computed(() => dialogType.value === 'product' ? '課程商品' : dialogType.value === 'session' ? '課程場次' : '課程票券')
const dialogTitle = computed(() => dialogType.value === 'product' ? (editingId.value ? '編輯商品' : '新增商品') : dialogType.value === 'session' ? (editingId.value ? '編輯場次' : '新增場次') : '手動發券')

const FormField = defineComponent({ props: { label: String, required: Boolean }, setup(props, { slots }) { return () => h('label', { class: 'block space-y-2 text-sm font-medium text-slate-700' }, [h('span', {}, `${props.label || ''}${props.required ? ' *' : ''}`), slots.default?.()]) } })
const AdminTableState = defineComponent({ props: { loading: Boolean, empty: Boolean, emptyText: String }, setup(props, { slots }) { return () => props.loading ? h('div', { class: 'surface-section text-sm text-slate-600' }, '資料載入中…') : props.empty ? h('div', { class: 'surface-section text-sm text-slate-600' }, props.emptyText) : h('div', { class: 'overflow-hidden rounded-lg border border-slate-200 bg-white' }, [h('div', { class: 'overflow-x-auto' }, slots.default?.())]) } })

function formatMoney(value) { return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0)) }
function formatRange(start, end) { return formatDateTimeRange(start, end, '－') || '時間待設定' }
function productStatusLabel(status) { return ({ draft: '草稿', published: '已發布', archived: '已封存' })[status] || status }
function sessionStatusLabel(status) { return ({ draft: '草稿', open: '開放預約', closed: '關閉預約', completed: '已完成', cancelled: '已取消' })[status] || status }
function bookingStatusLabel(status) { return ({ booked: '已預約', attended: '已出席', cancelled: '已取消', no_show: '未到' })[status] || status }
function toLocalDateTime(value) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16) }
function showMessage(value, type = 'success') { message.value = value; messageType.value = type; window.scrollTo({ top: 0, behavior: 'smooth' }) }
function closeDialog() { dialogOpen.value = false; editingId.value = null }

async function loadOverview(force = false) { if (!force && loaded.value.has('overview')) return; const { data } = await axios.get(`${API}/admin/courses/overview`); overview.value = data?.data || overview.value; loaded.value.add('overview') }
async function loadProducts(force = false) { if (!force && loaded.value.has('products')) return; const { data } = await axios.get(`${API}/admin/courses/products`); products.value = data?.data || []; loaded.value.add('products') }
async function loadSessions(force = false) { if (!force && loaded.value.has('sessions')) return; const { data } = await axios.get(`${API}/admin/courses/sessions`); sessions.value = data?.data || []; loaded.value.add('sessions') }
async function loadOrders(force = false) { if (!force && loaded.value.has('orders')) return; const { data } = await axios.get(`${API}/admin/courses/orders`); orders.value = data?.data || []; loaded.value.add('orders') }
async function loadTickets(force = false) { if (!force && loaded.value.has('tickets')) return; const { data } = await axios.get(`${API}/admin/courses/tickets`); tickets.value = (data?.data || []).map((item) => ({ ...item, expiresAt: item.expiresAt ? String(item.expiresAt).slice(0, 10) : '' })); loaded.value.add('tickets') }
async function loadBookings(force = false) { if (!force && loaded.value.has('bookings')) return; const { data } = await axios.get(`${API}/admin/courses/bookings`); bookings.value = data?.data || []; loaded.value.add('bookings') }

async function loadTab(key, force = false) {
  loading.value = true
  try {
    if (key === 'overview') await loadOverview(force)
    if (key === 'products') await loadProducts(force)
    if (key === 'sessions') await Promise.all([loadProducts(force), loadSessions(force)])
    if (key === 'orders') await loadOrders(force)
    if (key === 'tickets') await Promise.all([loadProducts(force), loadTickets(force)])
    if (key === 'bookings') await loadBookings(force)
  } catch (error) { showMessage(error?.response?.data?.message || '課程後台資料載入失敗', 'error') }
  finally { loading.value = false }
}

function selectTab(key) { activeTab.value = key; loadTab(key) }
async function refreshActive() { loaded.value.delete(activeTab.value); if (['sessions','tickets'].includes(activeTab.value)) loaded.value.delete('products'); await Promise.all([loadOverview(true), loadTab(activeTab.value, true)]); showMessage('課程後台資料已更新。') }

function openProductForm(product = null) { editingId.value = product?.id || null; productForm.value = product ? { ...emptyProductForm(), ...product } : emptyProductForm(); dialogType.value = 'product'; dialogOpen.value = true }
async function saveProduct() { submitting.value = true; try { if (editingId.value) await axios.patch(`${API}/admin/courses/products/${editingId.value}`, productForm.value); else await axios.post(`${API}/admin/courses/products`, productForm.value); closeDialog(); await Promise.all([loadProducts(true), loadOverview(true)]); showMessage('課程商品已儲存。') } catch (error) { showMessage(error?.response?.data?.message || '課程商品儲存失敗', 'error') } finally { submitting.value = false } }
async function archiveProduct(product) { if (!window.confirm(`確定封存「${product.name}」？`)) return; try { await axios.delete(`${API}/admin/courses/products/${product.id}`); await Promise.all([loadProducts(true), loadOverview(true)]); showMessage('課程商品已封存。') } catch (error) { showMessage(error?.response?.data?.message || '封存失敗', 'error') } }

function openSessionForm(session = null) { editingId.value = session?.id || null; sessionForm.value = session ? { ...emptySessionForm(), ...session, startsAt: toLocalDateTime(session.startsAt), endsAt: toLocalDateTime(session.endsAt), bookingOpenAt: toLocalDateTime(session.bookingOpenAt), bookingCloseAt: toLocalDateTime(session.bookingCloseAt) } : emptySessionForm(); dialogType.value = 'session'; dialogOpen.value = true }
async function saveSession() { submitting.value = true; try { if (editingId.value) await axios.patch(`${API}/admin/courses/sessions/${editingId.value}`, sessionForm.value); else await axios.post(`${API}/admin/courses/sessions`, sessionForm.value); closeDialog(); await Promise.all([loadSessions(true), loadOverview(true)]); showMessage('課程場次已儲存。') } catch (error) { showMessage(error?.response?.data?.message || '課程場次儲存失敗', 'error') } finally { submitting.value = false } }
async function cancelSession(session) { if (!window.confirm(`確定取消「${session.title}」？`)) return; try { await axios.delete(`${API}/admin/courses/sessions/${session.id}`); await Promise.all([loadSessions(true), loadOverview(true)]); showMessage('課程場次已取消。') } catch (error) { showMessage(error?.response?.data?.message || '場次取消失敗', 'error') } }

async function updateOrder(order) { busyId.value = `order-${order.id}`; try { await axios.patch(`${API}/admin/courses/orders/${order.id}`, { status: order.status, note: order.note || '' }); await loadOverview(true); showMessage(`訂單 ${order.code} 狀態已更新。`) } catch (error) { showMessage(error?.response?.data?.message || '訂單更新失敗', 'error'); await loadOrders(true) } finally { busyId.value = '' } }
async function issueOrder(order) { if (!window.confirm(`確認依訂單 ${order.code} 發行 ${order.quantity} 張課程票券？`)) return; busyId.value = `order-${order.id}`; try { await axios.post(`${API}/admin/courses/orders/${order.id}/issue`); await Promise.all([loadOrders(true), loadTickets(true), loadOverview(true)]); showMessage(`訂單 ${order.code} 已完成發券。`) } catch (error) { showMessage(error?.response?.data?.message || '訂單發券失敗', 'error') } finally { busyId.value = '' } }

function openTicketForm() { ticketForm.value = { ownerEmail: '', productId: activeProducts.value[0]?.id || null }; dialogType.value = 'ticket'; editingId.value = null; dialogOpen.value = true }
async function issueManualTicket() { submitting.value = true; try { const { data } = await axios.post(`${API}/admin/courses/tickets`, ticketForm.value); closeDialog(); await Promise.all([loadTickets(true), loadOverview(true)]); showMessage(`票券 ${data?.data?.code || ''} 已發行。`) } catch (error) { showMessage(error?.response?.data?.message || '手動發券失敗', 'error') } finally { submitting.value = false } }
async function updateTicket(ticket) { busyId.value = `ticket-${ticket.id}`; try { await axios.patch(`${API}/admin/courses/tickets/${ticket.id}`, { remainingUses: ticket.remainingUses, status: ticket.status, expiresAt: ticket.expiresAt || null }); await Promise.all([loadTickets(true), loadOverview(true)]); showMessage(`票券 ${ticket.code} 已更新。`) } catch (error) { showMessage(error?.response?.data?.message || '票券更新失敗', 'error') } finally { busyId.value = '' } }
async function attendBooking(booking) { if (!window.confirm(`確認「${booking.attendeeName}」已出席，並扣除票券 1 堂？`)) return; busyId.value = `booking-${booking.id}`; try { await axios.post(`${API}/admin/courses/bookings/${booking.id}/attend`); await Promise.all([loadBookings(true), loadTickets(true), loadOverview(true)]); showMessage('出席已核銷並扣除 1 堂。') } catch (error) { showMessage(error?.response?.data?.message || '出席核銷失敗', 'error') } finally { busyId.value = '' } }

onMounted(async () => { await loadOverview(); await loadProducts() })
</script>
