<template>
  <section class="space-y-5">
    <div class="ops-toolbar space-y-4">
      <div class="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
        <div class="flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="tablist"
          aria-label="課程商店分頁" @keydown="handleTabKeydown">
          <button v-for="tabItem in courseTabOptions" :id="`course-tab-${tabItem.key}`" :key="tabItem.key"
            role="tab" type="button" :aria-controls="`course-panel-${tabItem.key}`"
            :aria-selected="activeTab === tabItem.key" :tabindex="activeTab === tabItem.key ? 0 : -1"
            class="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition lg:flex-none"
            :class="activeTab === tabItem.key ? 'bg-white text-primary shadow-sm' : 'text-slate-600'"
            @click="setCourseTab(tabItem.key)">
            <AppIcon :name="tabItem.icon" class="h-4 w-4" /> {{ tabItem.label }}
          </button>
        </div>
        <AppSearchInput v-model="search"
          :placeholder="activeTab === 'products' ? '搜尋課程名稱、代碼、分類或服務商' : '搜尋場次、課程、服務商、教練或地點'" />
      </div>

      <div v-if="activeTab === 'products'" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <label class="space-y-1 text-sm text-slate-600">分類
          <select v-model="productFilters.category" class="w-full">
            <option value="">全部分類</option>
            <option v-for="category in productCategories" :key="category" :value="category">{{ category }}</option>
          </select>
        </label>
        <label class="space-y-1 text-sm text-slate-600">服務商
          <select v-model="productFilters.providerUserId" class="w-full">
            <option value="">全部服務商</option>
            <option value="platform">平台課程</option>
            <option v-for="provider in courseProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
          </select>
        </label>
        <label class="space-y-1 text-sm text-slate-600">最低價格<input v-model.trim="productFilters.priceMin" type="number" min="0" class="w-full" /></label>
        <label class="space-y-1 text-sm text-slate-600">最高價格<input v-model.trim="productFilters.priceMax" type="number" min="0" class="w-full" /></label>
        <label class="space-y-1 text-sm text-slate-600">排序
          <select v-model="productFilters.sort" class="w-full">
            <option value="sort_order">推薦順序</option>
            <option value="price_asc">價格低到高</option>
            <option value="price_desc">價格高到低</option>
          </select>
        </label>
        <div class="flex items-end"><button type="button" class="btn btn-outline w-full" :disabled="!hasProductFilters" @click="clearProductFilters">清除篩選</button></div>
      </div>

      <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <label class="space-y-1 text-sm text-slate-600">服務商
          <select v-model="sessionFilters.providerUserId" class="w-full">
            <option value="">全部服務商</option>
            <option value="platform">平台場次</option>
            <option v-for="provider in courseProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
          </select>
        </label>
        <label class="space-y-1 text-sm text-slate-600">開始日期<input v-model="sessionFilters.startsFrom" type="date" class="w-full" /></label>
        <label class="space-y-1 text-sm text-slate-600">結束日期<input v-model="sessionFilters.startsTo" type="date" class="w-full" /></label>
        <label class="space-y-1 text-sm text-slate-600">名額
          <select v-model="sessionFilters.availability" class="w-full">
            <option value="">全部場次</option>
            <option value="available">尚有名額</option>
            <option value="full">已額滿</option>
          </select>
        </label>
        <label class="space-y-1 text-sm text-slate-600">排序
          <select v-model="sessionFilters.sort" class="w-full"><option value="starts_asc">時間近到遠</option><option value="starts_desc">時間遠到近</option></select>
        </label>
        <div class="flex items-end"><button type="button" class="btn btn-outline w-full" :disabled="!hasSessionFilters" @click="clearSessionFilters">清除篩選</button></div>
      </div>
    </div>

    <p v-if="message" class="rounded-lg border px-4 py-3 text-sm" role="status"
      :class="messageType === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'">
      {{ message }}
    </p>

    <section v-if="activeTab === 'products'" id="course-panel-products" role="tabpanel"
      aria-labelledby="course-tab-products" tabindex="0" class="space-y-4">
      <div v-if="loadingProducts" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div v-for="index in 6" :key="index" class="ticket-card animate-pulse"><div class="h-44 bg-slate-200"></div><div class="space-y-3 p-4"><div class="h-5 w-2/3 rounded bg-slate-200"></div><div class="h-12 rounded bg-slate-100"></div></div></div>
      </div>
      <div v-else-if="productsError" class="surface-section text-sm text-red-700">
        <p>{{ productsError }}</p><button type="button" class="btn btn-outline mt-3" @click="loadProducts(productMeta.offset, { forceSummary: true })">重新載入</button>
      </div>
      <div v-else-if="!products.length" class="surface-section text-sm text-slate-600">
        {{ search || hasProductFilters ? '沒有符合搜尋或篩選條件的課程。' : '目前尚無已上架的課程。' }}
      </div>
      <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article v-for="product in products" :key="product.id" class="ticket-card flex min-h-full flex-col">
          <div class="relative h-44 overflow-hidden bg-slate-100">
            <img v-if="courseCover(product)" :src="courseCover(product)" :alt="`${product.name} 課程圖片`" class="h-full w-full object-cover" loading="lazy" @error="hideBrokenImage(product)" />
            <div v-else class="flex h-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-primary"><AppIcon name="ticket" class="h-12 w-12" /></div>
            <span class="absolute bottom-3 left-3 rounded-md bg-white/95 px-2.5 py-1 text-sm font-medium text-slate-800">{{ product.category || '運動課程' }}</span>
          </div>
          <div class="flex flex-1 flex-col gap-4 p-4">
            <div class="space-y-2">
              <p class="text-sm font-medium text-primary">{{ providerLabel(product) }}</p>
              <h2 class="ui-title text-xl text-slate-950">{{ product.name }}</h2>
              <p class="line-clamp-3 whitespace-pre-line text-sm leading-6 text-slate-600">{{ product.summary || product.description || '課程內容由專業團隊規劃。' }}</p>
            </div>
            <div class="flex flex-wrap gap-2 text-sm"><span class="ops-chip">{{ product.classCount }} 堂</span><span class="ops-chip">開卡後 {{ product.validDays }} 天</span><span v-if="product.transferable" class="ops-chip ops-chip-info">可轉讓</span></div>
            <div class="mt-auto flex items-end justify-between gap-3 border-t border-slate-100 pt-4">
              <div><p class="text-sm text-slate-500">課程價格</p><p class="money-value text-2xl text-slate-950">NT$ {{ formatMoney(product.price) }}</p></div>
              <button class="btn btn-primary btn-sm text-white" @click="openPurchase(product)">{{ product.externalPurchaseUrl ? '查看購買方式' : '查看與購買' }}</button>
            </div>
          </div>
        </article>
      </div>
      <AdminPagination v-if="productMeta.total > 0" :total="productMeta.total" :limit="productMeta.limit" :offset="productMeta.offset" :loading="loadingProducts" @change="loadProducts($event.offset)" />
    </section>

    <section v-else id="course-panel-sessions" role="tabpanel" aria-labelledby="course-tab-sessions" tabindex="0" class="space-y-4">
      <div v-if="loadingSessions" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><div v-for="index in 6" :key="index" class="ticket-card animate-pulse p-5"><div class="h-5 w-2/3 rounded bg-slate-200"></div><div class="mt-4 h-16 rounded bg-slate-100"></div></div></div>
      <div v-else-if="sessionsError" class="surface-section text-sm text-red-700"><p>{{ sessionsError }}</p><button type="button" class="btn btn-outline mt-3" @click="loadSessions(sessionMeta.offset, { forceSummary: true })">重新載入</button></div>
      <div v-else-if="!sessions.length" class="surface-section text-sm text-slate-600">{{ search || hasSessionFilters ? '沒有符合搜尋或篩選條件的場次。' : '目前沒有課程場次。' }}</div>
      <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article v-for="session in sessions" :key="session.id" class="ticket-card flex flex-col gap-4 p-5">
          <header class="space-y-2">
            <div class="flex items-start justify-between gap-3"><h2 class="ui-title text-xl text-slate-950">{{ session.title }}</h2><span class="ops-chip" :class="bookingStateClass(session)">{{ bookingStateLabel(session) }}</span></div>
            <p class="text-sm font-medium text-primary">{{ providerLabel(session) }}</p>
            <p v-if="session.productName" class="text-sm text-slate-600">適用：{{ session.productName }}</p>
            <p v-else class="text-sm text-slate-600">適用：同服務商全部課程票券</p>
          </header>
          <dl class="space-y-2 text-sm text-slate-600">
            <div class="flex gap-2"><AppIcon name="calendar" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ formatRange(session.startsAt, session.endsAt) }}</span></div>
            <div class="flex gap-2"><AppIcon name="map-pin" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ session.location || '地點待公告' }}</span></div>
            <div class="flex gap-2"><AppIcon name="user" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ session.coachName || '教練待公告' }}</span></div>
            <div class="flex gap-2"><AppIcon name="ticket" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ capacityLabel(session) }}</span></div>
          </dl>
          <p v-if="session.notes" class="line-clamp-2 text-sm leading-6 text-slate-600">{{ session.notes }}</p>
          <button class="btn btn-primary mt-auto min-h-[44px] w-full text-white" @click="openBooking(session)">{{ sessionCanBook(session) ? '查看並使用票券預約' : `查看場次 · ${bookingStateLabel(session)}` }}</button>
        </article>
      </div>
      <AdminPagination v-if="sessionMeta.total > 0" :total="sessionMeta.total" :limit="sessionMeta.limit" :offset="sessionMeta.offset" :loading="loadingSessions" @change="loadSessions($event.offset)" />
    </section>

    <AppOverlayPanel v-model="purchaseOpen" placement="auto" size="lg" :title="selectedProduct?.name || '課程詳情'"
      :description="providerLabel(selectedProduct)" @close="closeDialogs">
      <div v-if="selectedProduct" class="space-y-5">
        <div v-if="courseCover(selectedProduct)" class="aspect-[16/7] overflow-hidden rounded-xl bg-slate-100"><img :src="courseCover(selectedProduct)" :alt="`${selectedProduct.name} 課程圖片`" class="h-full w-full object-cover" /></div>
        <div class="flex flex-wrap gap-2"><span class="ops-chip">{{ selectedProduct.category || '運動課程' }}</span><span class="ops-chip">{{ selectedProduct.classCount }} 堂</span><span class="ops-chip">{{ selectedProduct.activationDays }} 天內開卡</span><span class="ops-chip">開卡後 {{ selectedProduct.validDays }} 天</span><span v-if="selectedProduct.transferable" class="ops-chip ops-chip-info">可轉讓</span></div>
        <p class="whitespace-pre-line text-sm leading-7 text-slate-700">{{ selectedProduct.description || selectedProduct.summary || '尚無課程說明。' }}</p>
        <section v-if="selectedProduct.recentSessions?.length" class="space-y-3">
          <h3 class="font-medium text-slate-900">近期場次</h3>
          <button v-for="session in selectedProduct.recentSessions" :key="session.id" type="button" class="surface-muted flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-sm" @click="openBookingFromProduct(session)"><span><strong class="block text-slate-900">{{ session.title }}</strong><span class="text-slate-600">{{ formatRange(session.startsAt, session.endsAt) }}・{{ session.location || '地點待公告' }}</span></span><AppIcon name="calendar" class="h-4 w-4 shrink-0" /></button>
        </section>
        <div v-if="dialogError" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"><span>{{ dialogError }}</span><button v-if="selectedProduct?._detailReady === false" type="button" class="btn btn-outline btn-sm" @click="openPurchase(selectedProduct, { syncRoute: false })">重新載入詳情</button></div>

        <div v-if="selectedProduct.externalPurchaseUrl" class="surface-muted space-y-3 text-sm leading-6 text-slate-700">
          <p>此課程由 {{ providerLabel(selectedProduct) }} 的外部頁面完成購買，平台不會建立課程訂單。</p>
          <button type="button" class="btn btn-outline w-full" :disabled="selectedProduct?._detailReady === false" @click="reviewPurchaseLegal"><AppIcon name="shield" class="h-4 w-4" />查看服務商與課程條款</button>
          <button type="button" class="btn btn-primary w-full text-white" :disabled="selectedProduct?._detailReady === false" @click="openExternalPurchase(selectedProduct)">前往外部購買頁面</button>
        </div>

        <form v-else class="space-y-4" @submit.prevent="submitPurchase">
          <div v-if="!user" class="surface-muted text-sm leading-6 text-slate-700"><p>登入後才能購買課程。</p><button type="button" class="btn btn-primary mt-3 text-white" @click="requireLogin">登入並繼續</button></div>
          <template v-else>
            <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div class="mb-3 flex items-center justify-between gap-3"><h3 class="font-medium text-slate-900">本次訂單聯絡資料</h3><router-link to="/account?tab=profile" class="text-sm font-medium text-primary">前往帳戶修改</router-link></div>
              <dl class="grid gap-3 text-sm sm:grid-cols-2"><div><dt class="text-slate-500">真實姓名</dt><dd class="mt-1 text-slate-900">{{ orderContact.username || '尚未填寫' }}</dd></div><div><dt class="text-slate-500">Email</dt><dd class="mt-1 break-all text-slate-900">{{ orderContact.email || '尚未填寫' }}</dd></div><div><dt class="text-slate-500">手機號碼</dt><dd class="mt-1 text-slate-900">{{ orderContact.phone || '尚未填寫' }}</dd></div><div><dt class="text-slate-500">匯款後五碼</dt><dd class="mt-1 text-slate-900">{{ orderContact.remittanceLast5 || '尚未填寫' }}</dd></div></dl>
              <p v-if="!contactComplete" class="mt-3 text-sm text-red-700">請先補齊真實姓名、Email、手機號碼與匯款帳號後五碼。</p>
            </div>
            <label class="block space-y-2 text-sm font-medium text-slate-700">購買數量<input v-model.number="purchaseForm.quantity" min="1" max="10" required type="number" class="w-full" /></label>
            <div class="surface-muted text-sm leading-6 text-slate-600"><p>付款與發券流程：建立訂單 → 行政確認款項 → 發行課程計次票。預約不扣堂，實際到場核銷時扣除。</p></div>
            <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <p>{{ purchaseForm.termsAccepted ? '已完成課程使用須知、取消與轉讓規則閱讀。' : '送出前需閱讀完整規定並確認。' }}</p>
              <button type="button" class="btn btn-outline mt-3 min-h-[44px]" @click="reviewPurchaseLegal"><AppIcon name="shield" class="h-4 w-4" />{{ purchaseForm.termsAccepted ? '重新閱讀課程規定' : '閱讀並接受課程規定' }}</button>
            </div>
            <div class="flex items-center justify-between gap-3 border-t border-slate-200 pt-4"><div><p class="text-sm text-slate-500">訂單總額</p><p class="money-value text-xl">NT$ {{ formatMoney(orderTotal) }}</p></div><button class="btn btn-primary text-white" :disabled="submitting || !contactComplete || selectedProduct?._detailReady === false">{{ submitting ? '建立中…' : '建立訂單' }}</button></div>
          </template>
        </form>
      </div>
    </AppOverlayPanel>

    <AppOverlayPanel v-model="bookingOpen" placement="auto" size="md" :title="selectedSession?.title || '團練預約'"
      :description="formatRange(selectedSession?.startsAt, selectedSession?.endsAt)" @close="closeDialogs">
      <div v-if="selectedSession" class="space-y-4">
        <div class="surface-muted space-y-2 text-sm leading-6 text-slate-700"><p class="font-medium text-primary">{{ providerLabel(selectedSession) }}</p><p>{{ selectedSession.productName || '同服務商全部課程票券' }}</p><p>{{ selectedSession.location || '地點待公告' }}｜{{ selectedSession.coachName || '教練待公告' }}</p><p aria-live="polite">{{ capacityLabel(selectedSession) }}；預約期間 {{ formatRange(selectedSession.bookingOpenAt, selectedSession.bookingCloseAt) }}</p><p v-if="selectedSession.notes" class="whitespace-pre-line">{{ selectedSession.notes }}</p></div>
        <div v-if="dialogError" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"><span>{{ dialogError }}</span><button v-if="selectedSession?._detailReady === false" type="button" class="btn btn-outline btn-sm" @click="openBooking(selectedSession, { syncRoute: false })">重新載入詳情</button></div>
        <div v-if="!sessionCanBook(selectedSession)" class="surface-muted text-sm leading-6 text-slate-700">此場次目前為「{{ bookingStateLabel(selectedSession) }}」，可先查看資訊，待開放後再預約。</div>
        <div v-else-if="!user" class="surface-muted text-sm leading-6 text-slate-700"><p>登入後才能使用課程票券預約。</p><button type="button" class="btn btn-primary mt-3 text-white" @click="requireLogin">登入並繼續</button></div>
        <form v-else class="space-y-4" @submit.prevent="submitBooking">
          <label class="block space-y-2 text-sm font-medium text-slate-700">使用票券<select v-model.number="bookingForm.ticketId" required class="w-full"><option :value="null" disabled>請選擇可用票券</option><option v-for="ticket in applicableTickets" :key="ticket.id" :value="ticket.id">{{ ticket.productName }}｜剩餘 {{ ticket.remainingUses }} 堂｜{{ ticket.code }}</option></select></label>
          <div v-if="!applicableTickets.length" class="surface-muted text-sm leading-6 text-slate-600">目前沒有同服務商且適用的可用課程票券，請先購買或等待行政發券。</div>
          <ul v-if="myTickets.length" class="space-y-2 text-sm" aria-label="票券適用性說明"><li v-for="ticket in myTickets" :key="`reason-${ticket.id}`" class="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"><span class="min-w-0"><strong class="block truncate text-slate-900">{{ ticket.productName }}・{{ ticket.code }}</strong><span class="text-slate-600">{{ ticketApplicability(ticket, selectedSession).reason }}</span></span><span class="ops-chip shrink-0" :class="ticketApplicability(ticket, selectedSession).applicable ? 'ops-chip-success' : 'ops-chip-warning'">{{ ticketApplicability(ticket, selectedSession).applicable ? '可使用' : '不適用' }}</span></li></ul>
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-4"><div class="mb-3 flex items-center justify-between gap-3"><h3 class="font-medium text-slate-900">本次預約會員資料</h3><router-link to="/account?tab=profile" class="text-sm font-medium text-primary">前往帳戶修改</router-link></div><dl class="grid gap-3 text-sm sm:grid-cols-2"><div><dt class="text-slate-500">出席者姓名</dt><dd class="mt-1 text-slate-900">{{ bookingForm.attendeeName || '尚未填寫' }}</dd></div><div><dt class="text-slate-500">Email</dt><dd class="mt-1 break-all text-slate-900">{{ bookingForm.attendeeEmail || '尚未填寫' }}</dd></div></dl></div>
          <p class="text-sm leading-6 text-slate-600">送出只登記出席意願，不會先扣堂；現場核銷後才扣除 1 堂。</p>
          <div class="sticky bottom-0 -mx-2 border-t border-slate-200 bg-white/95 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur"><button class="btn btn-primary min-h-[44px] w-full text-white" :disabled="submitting || !applicableTickets.length || !sessionCanBook(selectedSession)">{{ submitting ? '預約中…' : '確認預約' }}</button></div>
        </form>
      </div>
    </AppOverlayPanel>

    <LegalReviewDrawer ref="legalReviewRef" />
    <OrderUserDataReviewDrawer ref="userDataReviewRef" />
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { formatDateTimeRange } from '../utils/datetime'
import { normalizeHttpUrl } from '../utils/safeUrl'
import { showConfirm } from '../utils/sheet'
import AppIcon from '../components/AppIcon.vue'
import AppOverlayPanel from '../components/AppOverlayPanel.vue'
import AppSearchInput from '../components/AppSearchInput.vue'
import AdminPagination from '../components/AdminPagination.vue'
import LegalReviewDrawer from '../components/LegalReviewDrawer.vue'
import OrderUserDataReviewDrawer from '../components/OrderUserDataReviewDrawer.vue'

const API = API_BASE
const router = useRouter()
const route = useRoute()
const emit = defineEmits(['order-created', 'booking-created'])
const courseTabOptions = [{ key: 'products', label: '課程商城', icon: 'store' }, { key: 'sessions', label: '開放場次', icon: 'calendar' }]
const activeTab = ref('products')
const search = ref('')
const products = ref([])
const sessions = ref([])
const myTickets = ref([])
const loadingProducts = ref(true)
const loadingSessions = ref(true)
const productsError = ref('')
const sessionsError = ref('')
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
const userDataReviewRef = ref(null)
const purchaseIdempotencyKey = ref('')
const bookingIdempotencyKey = ref('')
const purchaseForm = ref({ quantity: 1, termsAccepted: false })
const bookingForm = ref({ ticketId: null, attendeeName: user.value?.username || '', attendeeEmail: user.value?.email || '' })
const productMeta = reactive({ total: 0, limit: 10, offset: 0, hasMore: false })
const sessionMeta = reactive({ total: 0, limit: 10, offset: 0, hasMore: false })
const productSummary = ref({})
const sessionSummary = ref({})
const productFilters = reactive({ category: '', providerUserId: '', priceMin: '', priceMax: '', sort: 'sort_order' })
const sessionFilters = reactive({ providerUserId: '', startsFrom: '', startsTo: '', availability: '', sort: 'starts_asc' })
let productRequestId = 0
let sessionRequestId = 0
let sessionGeneration = 0
let dialogRequestId = 0
let profileController = null
let ticketsController = null
let searchTimer = null

const orderTotal = computed(() => Number(selectedProduct.value?.price || 0) * Math.max(1, Number(purchaseForm.value.quantity || 1)))
const orderContact = computed(() => ({
  username: String(user.value?.username || '').trim(),
  email: String(user.value?.email || '').trim(),
  phone: String(user.value?.phone || '').trim(),
  remittanceLast5: String((user.value?.remittanceLast5 ?? user.value?.remittance_last5) || '').trim(),
}))
const contactComplete = computed(() => Boolean(orderContact.value.username && orderContact.value.email && String(orderContact.value.phone).replace(/\D/g, '').length >= 8 && /^\d{5}$/.test(orderContact.value.remittanceLast5)))
const hasProductFilters = computed(() => Boolean(productFilters.category || productFilters.providerUserId || productFilters.priceMin || productFilters.priceMax || productFilters.sort !== 'sort_order'))
const hasSessionFilters = computed(() => Boolean(sessionFilters.providerUserId || sessionFilters.startsFrom || sessionFilters.startsTo || sessionFilters.availability || sessionFilters.sort !== 'starts_asc'))
const productCategories = computed(() => {
  const values = Array.isArray(productSummary.value?.categories) ? productSummary.value.categories : products.value.map(item => item.category)
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
})
const courseProviders = computed(() => {
  const summaryProviders = [...(Array.isArray(productSummary.value?.providers) ? productSummary.value.providers : []), ...(Array.isArray(sessionSummary.value?.providers) ? sessionSummary.value.providers : [])]
  const visibleProviders = [...products.value, ...sessions.value].map(item => ({ id: providerId(item), name: item.providerName || '' }))
  const providers = new Map()
  for (const value of [...summaryProviders, ...visibleProviders]) {
    const id = String(value?.id ?? value?.providerUserId ?? '').trim()
    if (!id) continue
    providers.set(id, { id, name: String(value?.name ?? value?.providerName ?? id).trim() || id })
  }
  return Array.from(providers.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
})
const applicableTickets = computed(() => myTickets.value.filter(ticket => ticketApplicability(ticket, selectedSession.value).applicable))

function readUser() { try { return JSON.parse(localStorage.getItem('user_info') || 'null') } catch { return null } }
function formatMoney(value) { return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0)) }
function formatRange(start, end) { return formatDateTimeRange(start, end, '－') || '時間待公告' }
function providerId(source = {}) { const value = source || {}; return String(value.providerUserId || value.provider_user_id || value.ownerUserId || value.owner_user_id || '').trim() }
function ownerScope(source = {}) { if (source?.isPlatformCourse === true) return 'platform'; return providerId(source) || '' }
function providerLabel(source = {}) { const value = source || {}; return value.isPlatformCourse || !providerId(value) ? '平台課程' : (value.providerName || '服務商課程') }
function courseCoverKey(product) { return [product?.id || '', product?.updatedAt || '', product?.coverUrl || ''].join(':') }
function courseCover(product) {
  if (!product || failedCourseCovers.value.has(courseCoverKey(product))) return ''
  if (product.hasCover && product.id) return `${API}/courses/products/${encodeURIComponent(product.id)}/cover${product.updatedAt ? `?v=${encodeURIComponent(product.updatedAt)}` : ''}`
  return normalizeHttpUrl(product.coverUrl, '')
}
function hideBrokenImage(product) { const next = new Set(failedCourseCovers.value); next.add(courseCoverKey(product)); failedCourseCovers.value = next }
function showMessage(value, type = 'success') { message.value = value; messageType.value = type; if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }
function applyMeta(target, source = {}, fallbackLength = 0) { target.total = Math.max(0, Number(source.total ?? fallbackLength) || 0); target.limit = Math.max(1, Number(source.limit ?? 10) || 10); target.offset = Math.max(0, Number(source.offset ?? 0) || 0); target.hasMore = Boolean(source.hasMore) }
function unpackList(data, legacyKey) {
  const payload = data?.data
  if (Array.isArray(payload)) return { items: payload, meta: { total: payload.length, limit: Math.max(payload.length, 10), offset: 0, hasMore: false }, summary: {} }
  if (Array.isArray(payload?.items)) return { items: payload.items, meta: payload.meta || {}, summary: payload.summary || {} }
  const legacy = Array.isArray(payload?.[legacyKey]) ? payload[legacyKey] : []
  return { items: legacy, meta: { total: legacy.length, limit: Math.max(legacy.length, 10), offset: 0, hasMore: false }, summary: {} }
}
function createIdempotencyKey(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`.slice(0, 128)
}

async function loadProducts(offset = 0, options = {}) {
  const requestId = ++productRequestId
  loadingProducts.value = true
  productsError.value = ''
  try {
    const params = { paged: 1, limit: productMeta.limit || 10, offset: Math.max(0, Number(offset) || 0), q: search.value.trim(), includeSummary: options.forceSummary || !Object.keys(productSummary.value || {}).length ? 1 : 0, sort: productFilters.sort }
    if (productFilters.category) params.category = productFilters.category
    if (productFilters.providerUserId === 'platform') params.ownerType = 'platform'
    else if (productFilters.providerUserId) params.providerUserId = productFilters.providerUserId
    if (productFilters.priceMin !== '') params.priceMin = productFilters.priceMin
    if (productFilters.priceMax !== '') params.priceMax = productFilters.priceMax
    const { data } = await axios.get(`${API}/courses/products`, { params })
    if (requestId !== productRequestId) return
    const result = unpackList(data, 'products')
    products.value = result.items
    applyMeta(productMeta, result.meta, result.items.length)
    if (Object.keys(result.summary || {}).length) productSummary.value = result.summary
  } catch (error) {
    if (requestId !== productRequestId) return
    productsError.value = error?.response?.data?.message || '課程商品載入失敗'
  } finally { if (requestId === productRequestId) loadingProducts.value = false }
}

async function loadSessions(offset = 0, options = {}) {
  const requestId = ++sessionRequestId
  loadingSessions.value = true
  sessionsError.value = ''
  try {
    const params = { paged: 1, limit: sessionMeta.limit || 10, offset: Math.max(0, Number(offset) || 0), q: search.value.trim(), includeSummary: options.forceSummary || !Object.keys(sessionSummary.value || {}).length ? 1 : 0, sort: sessionFilters.sort }
    if (sessionFilters.providerUserId === 'platform') params.ownerType = 'platform'
    else if (sessionFilters.providerUserId) params.providerUserId = sessionFilters.providerUserId
    if (sessionFilters.startsFrom) params.startsFrom = sessionFilters.startsFrom
    if (sessionFilters.startsTo) params.startsTo = sessionFilters.startsTo
    if (sessionFilters.availability) params.availability = sessionFilters.availability
    const { data } = await axios.get(`${API}/courses/sessions`, { params })
    if (requestId !== sessionRequestId) return
    const result = unpackList(data, 'sessions')
    sessions.value = result.items
    applyMeta(sessionMeta, result.meta, result.items.length)
    if (Object.keys(result.summary || {}).length) sessionSummary.value = result.summary
  } catch (error) {
    if (requestId !== sessionRequestId) return
    sessionsError.value = error?.response?.data?.message || '課程場次載入失敗'
  } finally { if (requestId === sessionRequestId) loadingSessions.value = false }
}

async function loadMyTickets() {
  if (!user.value) { myTickets.value = []; return }
  const generation = sessionGeneration
  const expectedUserId = String(user.value?.id || '')
  ticketsController?.abort()
  const controller = new AbortController()
  ticketsController = controller
  const collected = []
  let offset = 0
  do {
    const { data } = await axios.get(`${API}/courses/me`, { params: { paged: 1, view: 'tickets', statuses: 'pending,active', limit: 100, offset }, signal: controller.signal })
    if (generation !== sessionGeneration || expectedUserId !== String(user.value?.id || '')) return
    const result = unpackList(data, 'tickets')
    collected.push(...result.items)
    if (!result.meta?.hasMore || !result.items.length) break
    offset += Math.max(1, Number(result.meta?.limit || result.items.length) || 100)
  } while (offset < 5000)
  if (generation === sessionGeneration && expectedUserId === String(user.value?.id || '')) myTickets.value = collected
}

async function refreshProfile() {
  const storedUser = readUser()
  if (!storedUser) { user.value = null; return false }
  const generation = sessionGeneration
  const expectedUserId = String(storedUser?.id || '')
  profileController?.abort()
  const controller = new AbortController()
  profileController = controller
  try {
    const { data } = await axios.get(`${API}/me`, { signal: controller.signal })
    if (generation !== sessionGeneration || expectedUserId !== String(readUser()?.id || '')) return false
    user.value = data?.data || data || null
    return Boolean(user.value)
  } catch (error) {
    if (controller.signal.aborted) return false
    if (error?.response?.status === 401) user.value = null
    return false
  }
}

function requireLogin() {
  user.value = readUser()
  if (user.value) return true
  router.push({ path: '/login', query: { redirect: route.fullPath || '/store?tab=courses' } })
  return false
}

async function handleAuthChanged() {
  const previousIdentity = `${String(user.value?.id || '')}:${String(user.value?.role || '').toUpperCase()}`
  const nextUser = readUser()
  const nextIdentity = `${String(nextUser?.id || '')}:${String(nextUser?.role || '').toUpperCase()}`
  sessionGeneration += 1
  profileController?.abort()
  ticketsController?.abort()
  user.value = nextUser
  myTickets.value = []
  purchaseIdempotencyKey.value = ''
  bookingIdempotencyKey.value = ''
  bookingForm.value = { ticketId: null, attendeeName: '', attendeeEmail: '' }
  purchaseForm.value = { quantity: 1, termsAccepted: false }
  if (previousIdentity !== nextIdentity && (purchaseOpen.value || bookingOpen.value)) await closeDialogs()
  if (user.value) await refreshProfile()
}
function handleStorage(event) { if (!event || event.key === 'user_info') handleAuthChanged() }

function updateDialogQuery(key, value) {
  const query = { ...route.query }
  delete query.courseProduct
  delete query.courseSession
  if (key && value) query[key] = value
  return router.replace({ query }).catch(() => {})
}

async function openPurchase(product, options = {}) {
  const requestId = ++dialogRequestId
  dialogError.value = ''
  selectedProduct.value = { ...product, _detailReady: false }
  purchaseForm.value = { quantity: 1, termsAccepted: false }
  purchaseIdempotencyKey.value = ''
  purchaseOpen.value = true
  if (options.syncRoute !== false) updateDialogQuery('courseProduct', product.code || product.id)
  const [detailResult, sessionsResult] = await Promise.allSettled([
    axios.get(`${API}/courses/products/${encodeURIComponent(product.code || product.id)}`),
    axios.get(`${API}/courses/sessions`, { params: { paged: 1, productId: product.id, limit: 5, offset: 0, sort: 'starts_asc' } }),
  ])
  if (requestId !== dialogRequestId || !purchaseOpen.value) return
  const detail = detailResult.status === 'fulfilled' ? detailResult.value?.data?.data : null
  const recentSessions = sessionsResult.status === 'fulfilled' ? unpackList(sessionsResult.value?.data, 'sessions').items : []
  if (!detail) {
    dialogError.value = detailResult.reason?.response?.data?.message || '無法重新取得課程商品資料，請重試。'
    selectedProduct.value = { ...selectedProduct.value, recentSessions, _detailReady: false }
    loadProducts(productMeta.offset)
    return
  }
  selectedProduct.value = { ...product, ...detail, recentSessions, _detailReady: true }
  if (readUser()) await refreshProfile()
}

async function openBooking(session, options = {}) {
  const requestId = ++dialogRequestId
  dialogError.value = ''
  selectedSession.value = { ...session, _detailReady: false }
  bookingIdempotencyKey.value = ''
  bookingOpen.value = true
  if (options.syncRoute !== false) updateDialogQuery('courseSession', session.code || session.id)
  try {
    const { data } = await axios.get(`${API}/courses/sessions/${encodeURIComponent(session.code || session.id)}`)
    if (requestId !== dialogRequestId || !bookingOpen.value) return
    selectedSession.value = { ...session, ...(data?.data || {}), _detailReady: true }
  } catch (error) {
    if (requestId === dialogRequestId) {
      dialogError.value = error?.response?.data?.message || '無法重新取得場次資料'
      selectedSession.value = { ...selectedSession.value, _detailReady: false }
      loadSessions(sessionMeta.offset)
    }
    return
  }
  user.value = readUser()
  if (!user.value || !sessionCanBook(selectedSession.value)) return
  if (!(await refreshProfile())) { user.value = null; return }
  try { await loadMyTickets() } catch (error) { dialogError.value = error?.response?.data?.message || '票券載入失敗'; return }
  const first = applicableTickets.value[0]
  bookingForm.value = { ticketId: first?.id || null, attendeeName: user.value?.username || '', attendeeEmail: user.value?.email || '' }
}

async function openBookingFromProduct(session) {
  purchaseOpen.value = false
  selectedProduct.value = null
  await openBooking(session)
}

async function refreshSelectedSession() {
  const current = selectedSession.value
  if (!current) return null
  const { data } = await axios.get(`${API}/courses/sessions/${encodeURIComponent(current.code || current.id)}`)
  const fresh = { ...current, ...(data?.data || {}) }
  selectedSession.value = fresh
  return fresh
}

async function closeDialogs() {
  dialogRequestId += 1
  purchaseOpen.value = false
  bookingOpen.value = false
  selectedProduct.value = null
  selectedSession.value = null
  dialogError.value = ''
  await updateDialogQuery('', '')
}

async function openExternalPurchase(product) {
  const url = normalizeHttpUrl(product?.externalPurchaseUrl, '')
  if (!url) { dialogError.value = '外部購買網址無效，請聯絡服務商。'; return }
  const accepted = await showConfirm(`即將前往「${providerLabel(product)}」的外部購買頁面。此操作不會在平台建立訂單，是否繼續？`, { title: '離開平台', confirmText: '前往外部頁面' })
  if (!accepted) return
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (opened) opened.opener = null
}

async function reviewPurchaseLegal() {
  const product = selectedProduct.value
  if (!product) return false
  const accepted = await legalReviewRef.value?.open({
    title: '課程購買規定',
    description: '請閱讀課程使用、取消、轉讓與現場核銷規定。',
    items: [{ name: product.name, quantity: Math.max(1, Number(purchaseForm.value.quantity || 1)), providerId: providerId(product), detail: `${product.classCount || 0} 堂｜開卡後 ${product.validDays || 0} 天` }],
    providerIds: providerId(product) ? [providerId(product)] : [],
    pageSlugs: ['terms', 'reservation-notice'],
    extraSections: [{ key: 'course-usage', title: '課程票券與核銷說明', content: '建立訂單後，由行政確認款項並發行課程計次票。預約不會預先扣堂，實際到場核銷後才扣除一堂。' }],
  })
  purchaseForm.value.termsAccepted = accepted === true
  return purchaseForm.value.termsAccepted
}

async function requestPurchaseUserDataReview(payload) {
  return (await userDataReviewRef.value?.open({
    title: '再次確認課程訂單資料',
    description: '以下是本次課程訂單實際會送出的會員聯絡與付款辨識資料。',
    summary: [{ key: 'course-order', label: selectedProduct.value?.name || '課程訂單', value: `${payload.quantity} 份`, detail: `合計 NT$ ${formatMoney(orderTotal.value)}｜${providerLabel(selectedProduct.value)}` }],
    fields: [
      { key: 'username', label: '真實姓名', value: payload.contactConfirmation.username },
      { key: 'email', label: '電子信箱', value: payload.contactConfirmation.email },
      { key: 'phone', label: '手機號碼', value: payload.contactConfirmation.phone },
      { key: 'remittanceLast5', label: '匯款帳號後五碼', value: payload.contactConfirmation.remittanceLast5 },
    ],
  })) === true
}

async function requestCourseBookingUserDataReview(payload) {
  const ticket = myTickets.value.find(item => Number(item.id) === Number(payload.ticketId))
  return (await userDataReviewRef.value?.open({
    title: '再次確認課程預約資料',
    description: '請核對本次預約的場次、票券與出席者資料。',
    summary: [{ key: 'course-booking', label: selectedSession.value?.title || '課程場次', value: '1 席', detail: [providerLabel(selectedSession.value), formatRange(selectedSession.value?.startsAt, selectedSession.value?.endsAt), ticket?.code ? `使用票券 ${ticket.code}` : ''].filter(Boolean).join('｜') }],
    fields: [{ key: 'attendeeName', label: '出席者姓名', value: payload.attendeeName }, { key: 'attendeeEmail', label: '出席者 Email', value: payload.attendeeEmail }],
  })) === true
}

function buildCourseUserDataConfirmation(payload, fields) { return fields.reduce((result, key) => ({ ...result, [key]: payload[key] }), { version: 1, confirmed: true }) }

async function submitPurchase() {
  if (!selectedProduct.value || selectedProduct.value._detailReady === false || submitting.value || !requireLogin()) return
  if (!(await refreshProfile())) {
    dialogError.value = '無法重新取得目前會員資料，請確認登入狀態後再試一次。'
    return
  }
  if (!contactComplete.value) { dialogError.value = '請先於帳戶中心補齊真實姓名、Email、手機號碼與匯款帳號後五碼。'; return }
  if (!purchaseForm.value.termsAccepted && !(await reviewPurchaseLegal())) return
  const contactConfirmation = { ...orderContact.value }
  const payload = {
    productId: selectedProduct.value.id,
    buyerName: contactConfirmation.username,
    buyerEmail: contactConfirmation.email,
    buyerPhone: contactConfirmation.phone,
    quantity: Math.max(1, Number(purchaseForm.value.quantity || 1)),
    expectedUnitPrice: Number(selectedProduct.value.price || 0),
    expectedOwnerUserId: providerId(selectedProduct.value) || null,
    remittanceLast5: contactConfirmation.remittanceLast5,
    termsAccepted: true,
    contactConfirmation,
  }
  payload.userDataConfirmation = buildCourseUserDataConfirmation({ buyerName: payload.buyerName, buyerEmail: payload.buyerEmail, remittanceLast5: payload.remittanceLast5 }, ['buyerName', 'buyerEmail', 'remittanceLast5'])
  if (!(await requestPurchaseUserDataReview(payload))) return
  if (!purchaseIdempotencyKey.value) purchaseIdempotencyKey.value = createIdempotencyKey('course-order')
  payload.idempotencyKey = purchaseIdempotencyKey.value
  submitting.value = true
  try {
    const { data } = await axios.post(`${API}/courses/orders`, payload)
    const order = data?.data || {}
    purchaseIdempotencyKey.value = ''
    await closeDialogs()
    showMessage(`訂單 ${order.code || ''} 已建立，行政確認款項後會發行課程票券。`)
    emit('order-created', order)
  } catch (error) {
    if (shouldResetIdempotencyKey(error)) purchaseIdempotencyKey.value = ''
    dialogError.value = error?.response?.data?.message || '課程訂單建立失敗'
    if (error?.response?.status === 409 && ['COURSE_PRODUCT_PRICE_CHANGED', 'COURSE_PRODUCT_OWNER_CHANGED', 'COURSE_PRODUCT_NOT_FOUND', 'COURSE_EXTERNAL_PURCHASE_REQUIRED'].includes(errorCode(error))) {
      const retainedQuantity = payload.quantity
      await openPurchase(selectedProduct.value, { syncRoute: false })
      purchaseForm.value = { quantity: retainedQuantity, termsAccepted: false }
      dialogError.value = '課程價格、服務商或上架資訊已更新，請重新閱讀條款並確認訂單。'
    }
  } finally { submitting.value = false }
}

async function submitBooking() {
  if (!selectedSession.value || selectedSession.value._detailReady === false || !bookingForm.value.ticketId || submitting.value) return
  if (!(await refreshProfile())) { dialogError.value = '無法重新取得目前會員資料，請確認登入狀態後再試一次。'; return }
  bookingForm.value.attendeeName = String(user.value?.username || '').trim()
  bookingForm.value.attendeeEmail = String(user.value?.email || '').trim()
  if (!bookingForm.value.attendeeName || !bookingForm.value.attendeeEmail) { dialogError.value = '請先於帳戶中心補齊真實姓名與 Email。'; return }
  const payload = { ticketId: Number(bookingForm.value.ticketId), attendeeName: bookingForm.value.attendeeName, attendeeEmail: bookingForm.value.attendeeEmail }
  if (!(await requestCourseBookingUserDataReview(payload))) return
  payload.userDataConfirmation = buildCourseUserDataConfirmation(payload, ['attendeeName', 'attendeeEmail'])
  if (!bookingIdempotencyKey.value) bookingIdempotencyKey.value = createIdempotencyKey('course-booking')
  payload.idempotencyKey = bookingIdempotencyKey.value
  submitting.value = true
  try {
    const { data } = await axios.post(`${API}/courses/sessions/${selectedSession.value.id}/book`, payload)
    const booking = data?.data || {}
    bookingIdempotencyKey.value = ''
    await closeDialogs()
    emit('booking-created', booking)
    await router.push({ path: '/wallet', query: { tab: 'reservations', category: 'course', booking: booking.id || undefined } })
  } catch (error) {
    if (shouldResetIdempotencyKey(error)) bookingIdempotencyKey.value = ''
    dialogError.value = error?.response?.data?.message || '課程場次預約失敗'
    if (error?.response?.status === 409) {
      await Promise.allSettled([loadSessions(sessionMeta.offset), loadMyTickets(), refreshSelectedSession()])
      const selectedStillApplies = applicableTickets.value.some(ticket => Number(ticket.id) === Number(bookingForm.value.ticketId))
      if (!selectedStillApplies) bookingForm.value.ticketId = applicableTickets.value[0]?.id || null
    }
  } finally { submitting.value = false }
}

function errorCode(error) { return String(error?.response?.data?.code || error?.response?.data?.error?.code || '').trim().toUpperCase() }
function shouldResetIdempotencyKey(error) {
  const status = Number(error?.response?.status || 0)
  if (!status || status >= 500 || status === 408 || status === 429) return false
  return errorCode(error) !== 'IDEMPOTENCY_IN_PROGRESS'
}
function isUnlimitedCapacity(session = {}) { return Number(session.capacity || 0) <= 0 }
function remainingCapacity(session = {}) { return isUnlimitedCapacity(session) ? null : Math.max(0, Number(session.remainingCapacity ?? (Number(session.capacity || 0) - Number(session.bookedCount || 0))) || 0) }
function capacityLabel(session = {}) { return isUnlimitedCapacity(session) ? '不限人數' : `剩餘 ${remainingCapacity(session)} / ${Number(session.capacity || 0)} 席` }
function bookingState(session = {}) {
  if (session.bookingState) return session.bookingState
  if (session.status === 'cancelled') return 'cancelled'
  if (!isUnlimitedCapacity(session) && remainingCapacity(session) <= 0) return 'full'
  if (session.status !== 'open') return 'closed'
  const now = Date.now()
  if (session.bookingOpenAt && new Date(session.bookingOpenAt).getTime() > now) return 'not_open'
  if ((session.bookingCloseAt && new Date(session.bookingCloseAt).getTime() < now) || (session.endsAt && new Date(session.endsAt).getTime() < now)) return 'closed'
  return 'open'
}
function bookingStateLabel(session) { return ({ not_open: '尚未開放', open: '可預約', full: '名額已滿', closed: '已截止', cancelled: '已取消' })[bookingState(session)] || '目前不可預約' }
function bookingStateClass(session) { const state = bookingState(session); return state === 'open' ? 'ops-chip-success' : state === 'not_open' ? 'ops-chip-info' : 'ops-chip-warning' }
function sessionCanBook(session) { return session?._detailReady !== false && bookingState(session) === 'open' }

function ticketApplicability(ticket = {}, session = {}) {
  if (!['pending', 'active'].includes(ticket.status) || Number(ticket.remainingUses || 0) <= 0) return { applicable: false, reason: '票券目前不可使用或已無剩餘堂數' }
  if (ticket.expiresAt && new Date(ticket.expiresAt).getTime() < Date.now()) return { applicable: false, reason: '票券已到期' }
  const sessionOwner = ownerScope(session)
  const ticketOwner = ownerScope(ticket)
  if (sessionOwner && ticketOwner && sessionOwner !== ticketOwner) return { applicable: false, reason: '票券與場次屬於不同服務商' }
  if (session.productId && Number(session.productId) !== Number(ticket.productId)) return { applicable: false, reason: '此場次限定其他課程商品票券' }
  return { applicable: true, reason: session.productId ? '符合此場次指定課程與服務商' : '符合此服務商通用場次' }
}

function clearProductFilters() { Object.assign(productFilters, { category: '', providerUserId: '', priceMin: '', priceMax: '', sort: 'sort_order' }) }
function clearSessionFilters() { Object.assign(sessionFilters, { providerUserId: '', startsFrom: '', startsTo: '', availability: '', sort: 'starts_asc' }) }
function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { loadProducts(0); loadSessions(0) }, 300)
}

function updateCourseView(tab, options = {}) {
  if (String(route.query.courseView || '') === tab) return
  const navigation = options.replace ? router.replace({ query: { ...route.query, courseView: tab } }) : router.push({ query: { ...route.query, courseView: tab } })
  navigation.catch(() => {})
}
function setCourseTab(tab, options = {}) {
  const next = courseTabOptions.some(item => item.key === tab) ? tab : 'products'
  activeTab.value = next
  if (!options.skipRouteSync) updateCourseView(next)
  if (next === 'products' && !products.value.length && !loadingProducts.value) loadProducts(0, { forceSummary: true })
  if (next === 'sessions' && !sessions.value.length && !loadingSessions.value) loadSessions(0, { forceSummary: true })
}
function syncCourseViewFromRoute() { setCourseTab(route.query.courseView === 'sessions' ? 'sessions' : 'products', { skipRouteSync: true }) }
function handleTabKeydown(event) {
  const tabs = courseTabOptions.map(item => item.key)
  let index = tabs.indexOf(activeTab.value)
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = (index - 1 + tabs.length) % tabs.length
  else if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = tabs.length - 1
  else return
  event.preventDefault(); setCourseTab(tabs[index]); nextTick(() => document.getElementById(`course-tab-${tabs[index]}`)?.focus())
}

async function syncDeepLink() {
  const productCode = String(route.query.courseProduct || '').trim()
  const sessionCode = String(route.query.courseSession || '').trim()
  if (productCode) {
    setCourseTab('products', { skipRouteSync: true })
    let product = products.value.find(item => String(item.code || item.id) === productCode)
    if (!product) {
      try { const { data } = await axios.get(`${API}/courses/products/${encodeURIComponent(productCode)}`); product = data?.data } catch (error) { showMessage(error?.response?.data?.message || '找不到課程商品', 'error'); return }
    }
    if (product && (!purchaseOpen.value || String(selectedProduct.value?.id) !== String(product.id))) await openPurchase(product, { syncRoute: false })
  } else if (sessionCode) {
    setCourseTab('sessions', { skipRouteSync: true })
    let session = sessions.value.find(item => String(item.code || item.id) === sessionCode)
    if (!session) {
      try { const { data } = await axios.get(`${API}/courses/sessions/${encodeURIComponent(sessionCode)}`); session = data?.data } catch (error) { showMessage(error?.response?.data?.message || '找不到課程場次', 'error'); return }
    }
    if (session && (!bookingOpen.value || String(selectedSession.value?.id) !== String(session.id))) await openBooking(session, { syncRoute: false })
  }
}

watch(search, scheduleSearch)
watch(productFilters, () => loadProducts(0), { deep: true })
watch(sessionFilters, () => loadSessions(0), { deep: true })
watch(() => route.query.courseView, syncCourseViewFromRoute)
watch(() => [route.query.courseProduct, route.query.courseSession], syncDeepLink)
watch(() => purchaseForm.value.quantity, (value, previous) => { if (previous !== undefined && value !== previous) { purchaseForm.value.termsAccepted = false; purchaseIdempotencyKey.value = '' } })
watch(bookingForm, () => { bookingIdempotencyKey.value = '' }, { deep: true })

onMounted(async () => {
  window.addEventListener('auth-changed', handleAuthChanged)
  window.addEventListener('storage', handleStorage)
  syncCourseViewFromRoute()
  await Promise.all([loadProducts(0, { forceSummary: true }), loadSessions(0, { forceSummary: true })])
  await syncDeepLink()
})
onBeforeUnmount(() => {
  sessionGeneration += 1
  dialogRequestId += 1
  profileController?.abort()
  ticketsController?.abort()
  if (searchTimer) clearTimeout(searchTimer)
  window.removeEventListener('auth-changed', handleAuthChanged)
  window.removeEventListener('storage', handleStorage)
})
</script>
