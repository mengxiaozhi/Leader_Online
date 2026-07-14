<template>
  <section class="space-y-5">
      <div class="ops-toolbar sticky top-[65px] z-30">
        <div class="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
          <div class="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button class="flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition lg:flex-none"
              :class="activeTab === 'products' ? 'bg-white text-primary shadow-sm' : 'text-slate-600'" @click="activeTab = 'products'">
              <AppIcon name="store" class="h-4 w-4" /> 課程商城
            </button>
            <button class="flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition lg:flex-none"
              :class="activeTab === 'sessions' ? 'bg-white text-primary shadow-sm' : 'text-slate-600'" @click="activeTab = 'sessions'">
              <AppIcon name="calendar" class="h-4 w-4" /> 開放場次
            </button>
          </div>
          <AppSearchInput v-model="search" :placeholder="activeTab === 'products' ? '搜尋課程名稱或分類' : '搜尋場次、教練或地點'" />
        </div>
      </div>

      <p v-if="message" class="rounded-lg border px-4 py-3 text-sm" :class="messageType === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'">
        {{ message }}
      </p>

      <section v-if="activeTab === 'products'" class="space-y-4">
        <div v-if="loadingProducts" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div v-for="index in 6" :key="index" class="ticket-card animate-pulse">
            <div class="h-44 bg-slate-200"></div><div class="space-y-3 p-4"><div class="h-5 w-2/3 rounded bg-slate-200"></div><div class="h-12 rounded bg-slate-100"></div></div>
          </div>
        </div>
        <div v-else-if="!filteredProducts.length" class="surface-section text-sm text-slate-600">
          {{ search ? '沒有符合搜尋條件的課程。' : '目前尚無已上架的課程，管理者可到課程後台新增。' }}
        </div>
        <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <article v-for="product in filteredProducts" :key="product.id" class="ticket-card flex min-h-full flex-col">
            <div class="relative h-44 overflow-hidden bg-slate-100">
              <img v-if="safeCover(product.coverUrl)" :src="safeCover(product.coverUrl)" :alt="`${product.name} 課程圖片`" class="h-full w-full object-cover" loading="lazy" @error="hideBrokenImage" />
              <div v-else class="flex h-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-primary">
                <AppIcon name="ticket" class="h-12 w-12" />
              </div>
              <span class="absolute bottom-3 left-3 rounded-md bg-white/95 px-2.5 py-1 text-sm font-medium text-slate-800">{{ product.category || '運動課程' }}</span>
            </div>
            <div class="flex flex-1 flex-col gap-4 p-4">
              <div class="space-y-2">
                <h2 class="ui-title text-xl text-slate-950">{{ product.name }}</h2>
                <p class="line-clamp-3 whitespace-pre-line text-sm leading-6 text-slate-600">{{ product.summary || product.description || '課程內容由 LEADER 專業團隊規劃。' }}</p>
              </div>
              <div class="flex flex-wrap gap-2 text-sm">
                <span class="ops-chip">{{ product.classCount }} 堂</span>
                <span class="ops-chip">開卡後 {{ product.validDays }} 天</span>
                <span v-if="product.transferable" class="ops-chip ops-chip-info">可轉讓</span>
              </div>
              <div class="mt-auto flex items-end justify-between gap-3 border-t border-slate-100 pt-4">
                <div><p class="text-sm text-slate-500">課程價格</p><p class="money-value text-2xl text-slate-950">NT$ {{ formatMoney(product.price) }}</p></div>
                <button class="btn btn-primary btn-sm text-white" @click="openPurchase(product)">立即購買</button>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section v-else class="space-y-4">
        <div v-if="loadingSessions" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div v-for="index in 6" :key="index" class="ticket-card animate-pulse p-5"><div class="h-5 w-2/3 rounded bg-slate-200"></div><div class="mt-4 h-16 rounded bg-slate-100"></div></div>
        </div>
        <div v-else-if="!filteredSessions.length" class="surface-section text-sm text-slate-600">
          {{ search ? '沒有符合搜尋條件的場次。' : '目前沒有開放預約的課程場次。' }}
        </div>
        <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <article v-for="session in filteredSessions" :key="session.id" class="ticket-card flex flex-col gap-4 p-5">
            <header class="space-y-2">
              <div class="flex items-start justify-between gap-3">
                <h2 class="ui-title text-xl text-slate-950">{{ session.title }}</h2>
                <span class="ops-chip" :class="session.bookedCount >= session.capacity ? 'ops-chip-warning' : 'ops-chip-success'">{{ session.bookedCount }}/{{ session.capacity }}</span>
              </div>
              <p v-if="session.productName" class="text-sm font-medium text-primary">適用：{{ session.productName }}</p>
            </header>
            <dl class="space-y-2 text-sm text-slate-600">
              <div class="flex gap-2"><AppIcon name="calendar" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ formatRange(session.startsAt, session.endsAt) }}</span></div>
              <div class="flex gap-2"><AppIcon name="map-pin" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ session.location || '地點待公告' }}</span></div>
              <div class="flex gap-2"><AppIcon name="user" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ session.coachName || '教練待公告' }}</span></div>
            </dl>
            <p v-if="session.notes" class="line-clamp-2 text-sm leading-6 text-slate-600">{{ session.notes }}</p>
            <button class="btn btn-primary mt-auto w-full text-white" :disabled="session.bookedCount >= session.capacity" @click="openBooking(session)">
              {{ session.bookedCount >= session.capacity ? '名額已滿' : '使用票券預約' }}
            </button>
          </article>
        </div>
      </section>

    <transition name="backdrop-fade">
      <div v-if="purchaseOpen || bookingOpen" class="fixed inset-0 z-50 bg-slate-950/40" @click.self="closeDialogs"></div>
    </transition>
    <transition name="sheet-pop">
      <section v-if="purchaseOpen" class="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-2xl border-t bg-white p-5 pb-safe shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:p-6">
        <header class="mb-5 flex items-start justify-between gap-3"><div><p class="text-sm text-slate-500">課程訂單</p><h2 class="ui-title text-2xl text-slate-950">購買 {{ selectedProduct?.name }}</h2></div><button class="btn btn-ghost btn-sm" @click="closeDialogs"><AppIcon name="x" class="h-5 w-5" /></button></header>
        <form class="space-y-4" @submit.prevent="submitPurchase">
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="space-y-2 text-sm font-medium text-slate-700">購買人姓名<input v-model.trim="purchaseForm.buyerName" required class="w-full" /></label>
            <label class="space-y-2 text-sm font-medium text-slate-700">Email<input v-model.trim="purchaseForm.buyerEmail" required type="email" class="w-full" /></label>
            <label class="space-y-2 text-sm font-medium text-slate-700">數量<input v-model.number="purchaseForm.quantity" min="1" max="10" required type="number" class="w-full" /></label>
            <label class="space-y-2 text-sm font-medium text-slate-700">匯款帳號後五碼（可稍後補）<input v-model.trim="purchaseForm.remittanceLast5" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" class="w-full" /></label>
          </div>
          <div class="surface-muted text-sm leading-6 text-slate-600">
            <p>付款與發券流程：建立訂單 → 行政確認款項 → 發行課程計次票。預約不扣堂，實際到場核銷時扣除。</p>
          </div>
          <label class="flex items-start gap-3 text-sm leading-6 text-slate-700"><input v-model="purchaseForm.termsAccepted" type="checkbox" class="mt-1 h-4 w-4" required /><span>我已閱讀並同意課程使用須知、取消與轉讓規則。</span></label>
          <div class="flex items-center justify-between gap-3 border-t border-slate-200 pt-4"><div><p class="text-sm text-slate-500">訂單總額</p><p class="money-value text-xl">NT$ {{ formatMoney(orderTotal) }}</p></div><button class="btn btn-primary text-white" :disabled="submitting">{{ submitting ? '建立中…' : '建立訂單' }}</button></div>
        </form>
      </section>
    </transition>

    <transition name="sheet-pop">
      <section v-if="bookingOpen" class="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-2xl border-t bg-white p-5 pb-safe shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:p-6">
        <header class="mb-5 flex items-start justify-between gap-3"><div><p class="text-sm text-slate-500">團練預約</p><h2 class="ui-title text-2xl text-slate-950">{{ selectedSession?.title }}</h2><p class="mt-1 text-sm text-slate-600">{{ formatRange(selectedSession?.startsAt, selectedSession?.endsAt) }}</p></div><button class="btn btn-ghost btn-sm" @click="closeDialogs"><AppIcon name="x" class="h-5 w-5" /></button></header>
        <form class="space-y-4" @submit.prevent="submitBooking">
          <label class="block space-y-2 text-sm font-medium text-slate-700">使用票券
            <select v-model.number="bookingForm.ticketId" required class="w-full"><option :value="null" disabled>請選擇可用票券</option><option v-for="ticket in applicableTickets" :key="ticket.id" :value="ticket.id">{{ ticket.productName }}｜剩餘 {{ ticket.remainingUses }} 堂｜{{ ticket.code }}</option></select>
          </label>
          <div v-if="!applicableTickets.length" class="surface-muted text-sm leading-6 text-slate-600">目前沒有適用且可用的課程票券，請先購買或等待行政發券。</div>
          <div class="grid gap-4 sm:grid-cols-2"><label class="space-y-2 text-sm font-medium text-slate-700">出席者姓名<input v-model.trim="bookingForm.attendeeName" required class="w-full" /></label><label class="space-y-2 text-sm font-medium text-slate-700">Email<input v-model.trim="bookingForm.attendeeEmail" required type="email" class="w-full" /></label></div>
          <p class="text-sm leading-6 text-slate-600">送出只登記出席意願，不會先扣堂；教練現場核銷後才扣除 1 堂。</p>
          <button class="btn btn-primary w-full text-white" :disabled="submitting || !applicableTickets.length">{{ submitting ? '預約中…' : '確認預約' }}</button>
        </form>
      </section>
    </transition>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { formatDateTimeRange } from '../utils/datetime'
import { normalizeHttpUrl } from '../utils/safeUrl'
import AppIcon from '../components/AppIcon.vue'
import AppSearchInput from '../components/AppSearchInput.vue'

const API = API_BASE
const router = useRouter()
const route = useRoute()
const activeTab = ref('products')
const search = ref('')
const products = ref([])
const sessions = ref([])
const myTickets = ref([])
const loadingProducts = ref(true)
const loadingSessions = ref(true)
const purchaseOpen = ref(false)
const bookingOpen = ref(false)
const selectedProduct = ref(null)
const selectedSession = ref(null)
const submitting = ref(false)
const message = ref('')
const messageType = ref('success')
const user = ref(readUser())

const purchaseForm = ref({ buyerName: user.value?.username || '', buyerEmail: user.value?.email || '', quantity: 1, remittanceLast5: '', termsAccepted: false })
const bookingForm = ref({ ticketId: null, attendeeName: user.value?.username || '', attendeeEmail: user.value?.email || '' })

const normalizedSearch = computed(() => search.value.trim().toLowerCase())
const filteredProducts = computed(() => products.value.filter((item) => !normalizedSearch.value || [item.name, item.category, item.summary, item.description].some((value) => String(value || '').toLowerCase().includes(normalizedSearch.value))))
const filteredSessions = computed(() => sessions.value.filter((item) => !normalizedSearch.value || [item.title, item.productName, item.coachName, item.location].some((value) => String(value || '').toLowerCase().includes(normalizedSearch.value))))
const orderTotal = computed(() => Number(selectedProduct.value?.price || 0) * Math.max(1, Number(purchaseForm.value.quantity || 1)))
const applicableTickets = computed(() => myTickets.value.filter((ticket) => {
  if (!['pending', 'active'].includes(ticket.status) || Number(ticket.remainingUses) <= 0) return false
  if (selectedSession.value?.productId && Number(selectedSession.value.productId) !== Number(ticket.productId)) return false
  return true
}))

function readUser() {
  try { return JSON.parse(localStorage.getItem('user_info') || 'null') } catch { return null }
}

function showMessage(value, type = 'success') {
  message.value = value
  messageType.value = type
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function formatMoney(value) { return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0)) }
function formatRange(start, end) { return formatDateTimeRange(start, end, '－') || '時間待公告' }
function safeCover(value) { return normalizeHttpUrl(value, '') }
function hideBrokenImage(event) { event.currentTarget.style.display = 'none' }

async function loadProducts() {
  loadingProducts.value = true
  try { const { data } = await axios.get(`${API}/courses/products`); products.value = data?.data || [] }
  catch (error) { showMessage(error?.response?.data?.message || '課程商品載入失敗', 'error') }
  finally { loadingProducts.value = false }
}

async function loadSessions() {
  loadingSessions.value = true
  try { const { data } = await axios.get(`${API}/courses/sessions`); sessions.value = data?.data || [] }
  catch (error) { showMessage(error?.response?.data?.message || '課程場次載入失敗', 'error') }
  finally { loadingSessions.value = false }
}

async function loadMyTickets() {
  if (!user.value) return
  const { data } = await axios.get(`${API}/courses/me`)
  myTickets.value = data?.data?.tickets || []
}

function requireLogin() {
  if (user.value) return true
  router.push({ path: '/login', query: { redirect: '/store?tab=courses' } })
  return false
}

function openPurchase(product) {
  if (!requireLogin()) return
  selectedProduct.value = product
  purchaseForm.value = { buyerName: user.value?.username || '', buyerEmail: user.value?.email || '', quantity: 1, remittanceLast5: '', termsAccepted: false }
  purchaseOpen.value = true
}

async function openBooking(session) {
  if (!requireLogin()) return
  selectedSession.value = session
  try { await loadMyTickets() } catch (error) { showMessage(error?.response?.data?.message || '票券載入失敗', 'error'); return }
  const first = applicableTickets.value[0]
  bookingForm.value = { ticketId: first?.id || null, attendeeName: user.value?.username || '', attendeeEmail: user.value?.email || '' }
  bookingOpen.value = true
}

function closeDialogs() { purchaseOpen.value = false; bookingOpen.value = false; selectedProduct.value = null; selectedSession.value = null }

async function submitPurchase() {
  if (!selectedProduct.value) return
  submitting.value = true
  try {
    const { data } = await axios.post(`${API}/courses/orders`, { productId: selectedProduct.value.id, ...purchaseForm.value })
    closeDialogs()
    showMessage(`訂單 ${data?.data?.code || ''} 已建立，行政確認款項後會發行課程票券。`)
  } catch (error) { showMessage(error?.response?.data?.message || '課程訂單建立失敗', 'error') }
  finally { submitting.value = false }
}

async function submitBooking() {
  if (!selectedSession.value || !bookingForm.value.ticketId) return
  submitting.value = true
  try {
    await axios.post(`${API}/courses/sessions/${selectedSession.value.id}/book`, bookingForm.value)
    closeDialogs()
    await Promise.all([loadSessions(), loadMyTickets()])
    showMessage('課程場次預約成功；到場核銷時才會扣除堂數。')
  } catch (error) { showMessage(error?.response?.data?.message || '課程場次預約失敗', 'error') }
  finally { submitting.value = false }
}

onMounted(() => {
  if (route.query.courseView === 'sessions') activeTab.value = 'sessions'
  Promise.all([loadProducts(), loadSessions()])
})
</script>
