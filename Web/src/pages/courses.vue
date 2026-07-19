<template>
  <section class="space-y-5">
      <div class="ops-toolbar">
        <div class="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
          <div class="flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="tablist"
            aria-label="課程商店分頁" @keydown="handleTabKeydown">
            <button id="course-tab-products" role="tab" type="button"
              aria-controls="course-panel-products" :aria-selected="activeTab === 'products'"
              :tabindex="activeTab === 'products' ? 0 : -1"
              class="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition lg:flex-none"
              :class="activeTab === 'products' ? 'bg-white text-primary shadow-sm' : 'text-slate-600'" @click="setCourseTab('products')">
              <AppIcon name="store" class="h-4 w-4" /> 課程商城
            </button>
            <button id="course-tab-sessions" role="tab" type="button"
              aria-controls="course-panel-sessions" :aria-selected="activeTab === 'sessions'"
              :tabindex="activeTab === 'sessions' ? 0 : -1"
              class="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition lg:flex-none"
              :class="activeTab === 'sessions' ? 'bg-white text-primary shadow-sm' : 'text-slate-600'" @click="setCourseTab('sessions')">
              <AppIcon name="calendar" class="h-4 w-4" /> 開放場次
            </button>
          </div>
          <AppSearchInput v-model="search" :placeholder="activeTab === 'products' ? '搜尋課程名稱或分類' : '搜尋場次、教練或地點'" />
        </div>
      </div>

      <p v-if="message" class="rounded-lg border px-4 py-3 text-sm" :class="messageType === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'">
        {{ message }}
      </p>

      <section v-if="activeTab === 'products'" id="course-panel-products" role="tabpanel"
        aria-labelledby="course-tab-products" tabindex="0" class="space-y-4">
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
              <img v-if="courseCover(product)" :src="courseCover(product)" :alt="`${product.name} 課程圖片`" class="h-full w-full object-cover" loading="lazy" @error="hideBrokenImage(product)" />
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

      <section v-else id="course-panel-sessions" role="tabpanel"
        aria-labelledby="course-tab-sessions" tabindex="0" class="space-y-4">
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

    <AppOverlayPanel
      v-model="purchaseOpen"
      placement="auto"
      size="md"
      :title="`購買 ${selectedProduct?.name || '課程'}`"
      description="填寫購買資料並閱讀課程規定後建立訂單。"
      @close="closeDialogs"
    >
        <p v-if="dialogError" class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{{ dialogError }}</p>
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
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
            <p>{{ purchaseForm.termsAccepted ? '已完成課程使用須知、取消與轉讓規則閱讀。' : '送出前需閱讀完整規定並確認。' }}</p>
            <button type="button" class="btn btn-outline mt-3 min-h-[44px]" @click="reviewPurchaseLegal">
              <AppIcon name="shield" class="h-4 w-4" />
              {{ purchaseForm.termsAccepted ? '重新閱讀課程規定' : '閱讀並接受課程規定' }}
            </button>
          </div>
          <div class="flex items-center justify-between gap-3 border-t border-slate-200 pt-4"><div><p class="text-sm text-slate-500">訂單總額</p><p class="money-value text-xl">NT$ {{ formatMoney(orderTotal) }}</p></div><button class="btn btn-primary text-white" :disabled="submitting">{{ submitting ? '建立中…' : '建立訂單' }}</button></div>
        </form>
    </AppOverlayPanel>

    <AppOverlayPanel
      v-model="bookingOpen"
      placement="auto"
      size="md"
      :title="selectedSession?.title || '團練預約'"
      :description="formatRange(selectedSession?.startsAt, selectedSession?.endsAt)"
      @close="closeDialogs"
    >
        <p v-if="dialogError" class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{{ dialogError }}</p>
        <form class="space-y-4" @submit.prevent="submitBooking">
          <label class="block space-y-2 text-sm font-medium text-slate-700">使用票券
            <select v-model.number="bookingForm.ticketId" required class="w-full"><option :value="null" disabled>請選擇可用票券</option><option v-for="ticket in applicableTickets" :key="ticket.id" :value="ticket.id">{{ ticket.productName }}｜剩餘 {{ ticket.remainingUses }} 堂｜{{ ticket.code }}</option></select>
          </label>
          <div v-if="!applicableTickets.length" class="surface-muted text-sm leading-6 text-slate-600">目前沒有適用且可用的課程票券，請先購買或等待行政發券。</div>
          <div class="grid gap-4 sm:grid-cols-2"><label class="space-y-2 text-sm font-medium text-slate-700">出席者姓名<input v-model.trim="bookingForm.attendeeName" required class="w-full" /></label><label class="space-y-2 text-sm font-medium text-slate-700">Email<input v-model.trim="bookingForm.attendeeEmail" required type="email" class="w-full" /></label></div>
          <p class="text-sm leading-6 text-slate-600">送出只登記出席意願，不會先扣堂；教練現場核銷後才扣除 1 堂。</p>
          <button class="btn btn-primary w-full text-white" :disabled="submitting || !applicableTickets.length">{{ submitting ? '預約中…' : '確認預約' }}</button>
        </form>
    </AppOverlayPanel>
    <LegalReviewDrawer ref="legalReviewRef" />
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { formatDateTimeRange } from '../utils/datetime'
import { normalizeHttpUrl } from '../utils/safeUrl'
import AppIcon from '../components/AppIcon.vue'
import AppOverlayPanel from '../components/AppOverlayPanel.vue'
import AppSearchInput from '../components/AppSearchInput.vue'
import LegalReviewDrawer from '../components/LegalReviewDrawer.vue'

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
const dialogError = ref('')
const user = ref(readUser())
const failedCourseCovers = ref(new Set())
const legalReviewRef = ref(null)

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

const courseTabs = ['products', 'sessions']
function updateCourseView(tab, options = {}) {
  const current = typeof route.query.courseView === 'string' ? route.query.courseView : ''
  if (current === tab) return
  const location = { query: { ...route.query, courseView: tab } }
  const navigation = options.replace ? router.replace(location) : router.push(location)
  navigation.catch(() => {})
}
function setCourseTab(tab, options = {}) {
  const next = courseTabs.includes(tab) ? tab : 'products'
  activeTab.value = next
  if (!options.skipRouteSync) updateCourseView(next)
}
function syncCourseViewFromRoute() {
  const requested = typeof route.query.courseView === 'string' ? route.query.courseView : ''
  setCourseTab(requested === 'sessions' ? 'sessions' : 'products', { skipRouteSync: true })
}
function handleTabKeydown(event) {
  let index = courseTabs.indexOf(activeTab.value)
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % courseTabs.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = (index - 1 + courseTabs.length) % courseTabs.length
  else if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = courseTabs.length - 1
  else return
  event.preventDefault()
  setCourseTab(courseTabs[index])
  nextTick(() => document.getElementById(`course-tab-${courseTabs[index]}`)?.focus())
}

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
function courseCoverKey(product) {
  return [product?.id || '', product?.updatedAt || '', product?.coverUrl || ''].join(':')
}

function courseCover(product) {
  if (failedCourseCovers.value.has(courseCoverKey(product))) return ''
  if (product?.hasCover && product?.id) {
    const version = product.updatedAt ? `?v=${encodeURIComponent(product.updatedAt)}` : ''
    return `${API}/courses/products/${encodeURIComponent(product.id)}/cover${version}`
  }
  return normalizeHttpUrl(product?.coverUrl, '')
}
function hideBrokenImage(product) {
  const next = new Set(failedCourseCovers.value)
  next.add(courseCoverKey(product))
  failedCourseCovers.value = next
}

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
  dialogError.value = ''
  selectedProduct.value = product
  purchaseForm.value = { buyerName: user.value?.username || '', buyerEmail: user.value?.email || '', quantity: 1, remittanceLast5: '', termsAccepted: false }
  purchaseOpen.value = true
}

async function reviewPurchaseLegal() {
  const product = selectedProduct.value
  if (!product) return false
  const accepted = await legalReviewRef.value?.open({
    title: '課程購買規定',
    description: '請閱讀課程使用、取消、轉讓與現場核銷規定。',
    items: [{
      name: product.name,
      quantity: Math.max(1, Number(purchaseForm.value.quantity || 1)),
      providerId: product.providerId || product.providerUserId || product.ownerUserId,
      detail: `${product.classCount || 0} 堂｜開卡後 ${product.validDays || 0} 天`,
    }],
    pageSlugs: ['terms', 'reservation-notice'],
    extraSections: [{
      key: 'course-usage',
      title: '課程票券與核銷說明',
      content: '建立訂單後，由行政確認款項並發行課程計次票。預約不會預先扣堂，實際到場核銷後才扣除一堂。',
    }],
  })
  purchaseForm.value.termsAccepted = accepted === true
  return purchaseForm.value.termsAccepted
}

async function openBooking(session) {
  if (!requireLogin()) return
  dialogError.value = ''
  selectedSession.value = session
  try { await loadMyTickets() } catch (error) { showMessage(error?.response?.data?.message || '票券載入失敗', 'error'); return }
  const first = applicableTickets.value[0]
  bookingForm.value = { ticketId: first?.id || null, attendeeName: user.value?.username || '', attendeeEmail: user.value?.email || '' }
  bookingOpen.value = true
}

function closeDialogs() { purchaseOpen.value = false; bookingOpen.value = false; selectedProduct.value = null; selectedSession.value = null; dialogError.value = '' }

async function submitPurchase() {
  if (!selectedProduct.value) return
  if (!purchaseForm.value.termsAccepted && !(await reviewPurchaseLegal())) return
  submitting.value = true
  try {
    const { data } = await axios.post(`${API}/courses/orders`, { productId: selectedProduct.value.id, ...purchaseForm.value })
    closeDialogs()
    showMessage(`訂單 ${data?.data?.code || ''} 已建立，行政確認款項後會發行課程票券。`)
  } catch (error) {
    dialogError.value = error?.response?.data?.message || '課程訂單建立失敗'
    showMessage(dialogError.value, 'error')
  }
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
  } catch (error) {
    dialogError.value = error?.response?.data?.message || '課程場次預約失敗'
    showMessage(dialogError.value, 'error')
  }
  finally { submitting.value = false }
}

watch(() => route.query.courseView, syncCourseViewFromRoute)
watch(() => purchaseForm.value.quantity, (value, previous) => {
  if (previous !== undefined && value !== previous) purchaseForm.value.termsAccepted = false
})

onMounted(() => {
  syncCourseViewFromRoute()
  Promise.all([loadProducts(), loadSessions()])
})
</script>
