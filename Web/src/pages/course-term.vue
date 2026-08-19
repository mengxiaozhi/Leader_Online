<template>
  <main class="ops-page" aria-labelledby="course-term-title">
    <div class="space-y-5">
      <header class="ops-header">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div class="min-w-0 space-y-2">
            <router-link to="/courses/classes" class="interactive-press inline-flex min-h-[44px] items-center rounded-lg text-sm font-medium text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              ← 回到固定班列表
            </router-link>
            <p class="text-sm font-medium text-primary">{{ term?.programName || '固定班課程' }}</p>
            <h1 id="course-term-title" class="ui-title text-2xl text-slate-950 sm:text-3xl">{{ term?.name || (loading ? '固定班詳情' : '固定班') }}</h1>
            <p class="max-w-3xl text-sm leading-6 text-slate-600">{{ term?.summary || term?.description || '查看班期、堂次、程度與名額，再進入伺服器驗證的報名流程。' }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span v-if="term" class="ops-chip" :class="termFull ? 'ops-chip-warning' : 'ops-chip-success'">{{ termFull ? '額滿可候補' : '開放報名' }}</span>
            <router-link to="/courses/me/enrollments" class="btn btn-outline">我的固定班</router-link>
          </div>
        </div>
      </header>

      <div class="ops-toolbar material-chrome sticky top-0 z-30 space-y-3 md:top-[65px]">
        <nav class="grid grid-cols-3 rounded-lg border border-slate-200 bg-slate-50 p-1" aria-label="購票中心分類">
          <router-link to="/store?tab=shop" class="interactive-press flex min-h-[44px] items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium text-slate-600 transition hover:text-slate-950 sm:text-sm"><AppIcon name="store" class="h-4 w-4" /><span class="sm:hidden">票券</span><span class="hidden sm:inline">票券商店</span></router-link>
          <router-link to="/store?tab=events" class="interactive-press flex min-h-[44px] items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium text-slate-600 transition hover:text-slate-950 sm:text-sm"><AppIcon name="calendar" class="h-4 w-4" /><span class="sm:hidden">預約</span><span class="hidden sm:inline">場次預約</span></router-link>
          <router-link to="/courses/classes" class="interactive-press flex min-h-[44px] items-center justify-center gap-1.5 rounded-md bg-white px-2 py-2 text-xs font-medium text-primary shadow-sm sm:text-sm" aria-current="page"><AppIcon name="calendar" class="h-4 w-4" /><span class="sm:hidden">課程</span><span class="hidden sm:inline">課程商店</span></router-link>
        </nav>
        <nav class="grid gap-2 sm:grid-cols-3" aria-label="課程商店分類">
          <router-link
            v-for="task in publicCourseTasks"
            :key="task.key"
            :to="task.path"
            class="interactive-press min-h-[44px] rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :class="task.key === 'classes' ? 'border-primary bg-primary/5 text-primary shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-primary/40'"
            :aria-current="task.key === 'classes' ? 'page' : undefined"
          >
            <span class="flex items-start gap-2"><AppIcon :name="task.icon" class="mt-0.5 h-4 w-4 shrink-0" /><span class="min-w-0"><strong class="block text-sm">{{ task.label }}</strong><span class="mt-0.5 hidden text-xs leading-5 text-slate-500 sm:block">{{ task.description }}</span></span></span>
          </router-link>
        </nav>
      </div>

    <section v-if="loading" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" role="status" aria-live="polite" aria-label="正在載入固定班資料">
      <div class="ticket-card animate-pulse p-6"><div class="h-7 w-2/3 rounded bg-slate-200"></div><div class="mt-5 h-64 rounded bg-slate-100"></div></div>
      <div class="ticket-card animate-pulse p-6"><div class="h-40 rounded bg-slate-100"></div></div>
    </section>
    <section v-else-if="loadError" class="surface-section text-sm text-red-700" role="alert">
      <p>{{ loadError }}</p><button type="button" class="btn btn-outline mt-3" @click="loadTerm">重新載入</button>
    </section>

    <template v-else-if="term">
      <p v-if="message" class="rounded-xl border px-4 py-3 text-sm" :class="messageTone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'" :role="messageTone === 'error' ? 'alert' : 'status'" :aria-live="messageTone === 'error' ? 'assertive' : 'polite'" aria-atomic="true">{{ message }}</p>
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section class="space-y-5" :class="checkoutMode ? 'order-last lg:order-first' : ''">
          <article class="ticket-card space-y-4 p-5">
            <h2 class="ui-title text-xl text-slate-950">班期與報名規則</h2>
            <dl class="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt class="text-slate-500">班期</dt><dd class="mt-1 text-slate-900">{{ formatDate(term.startsOn) }}－{{ formatDate(term.endsOn) }}</dd></div>
              <div><dt class="text-slate-500">程度門檻</dt><dd class="mt-1 text-slate-900">{{ term.levelName || '不限程度' }}</dd></div>
              <div><dt class="text-slate-500">報名期間</dt><dd class="mt-1 text-slate-900">{{ formatDateTime(term.enrollmentOpenAt) }}－{{ formatDateTime(term.enrollmentCloseAt) }}</dd></div>
              <div><dt class="text-slate-500">名額</dt><dd class="mt-1 text-slate-900">{{ capacityLabel }}</dd></div>
            </dl>
            <div v-if="term.description" class="whitespace-pre-line rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-700">{{ term.description }}</div>
          </article>

          <article class="ticket-card space-y-4 p-5">
            <div class="flex items-center justify-between gap-3"><h2 class="ui-title text-xl text-slate-950">堂次</h2><span class="text-sm text-slate-500">{{ sessions.length }} 堂</span></div>
            <ol v-if="sessions.length" class="divide-y divide-slate-100 rounded-xl border border-slate-200">
              <li v-for="(session, index) in sessions" :key="session.id" class="grid gap-2 p-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center">
                <span class="stat-number text-lg text-primary">{{ index + 1 }}</span>
                <div><strong class="text-slate-900">{{ session.title || term.name }}</strong><p class="mt-1 text-sm text-slate-500">{{ session.location || session.city || '地點待公告' }}</p></div>
                <time class="text-sm text-slate-600">{{ formatDateTime(session.startsAt) }}</time>
              </li>
            </ol>
            <p v-else class="text-sm text-slate-500">堂次即將公告。</p>
          </article>
        </section>

        <aside class="space-y-4" :class="checkoutMode ? 'order-first lg:order-last lg:sticky lg:top-24 lg:self-start' : 'lg:sticky lg:top-24 lg:self-start'">
          <article class="ticket-card space-y-4 p-5">
            <template v-if="!checkoutMode">
              <h2 class="ui-title text-xl text-slate-950">{{ termFull ? '候補本班' : '報名本班' }}</h2>
              <p class="text-sm leading-6 text-slate-600">價格、程度、名額與可報堂次均由伺服器重新檢查。</p>
              <button v-if="termFull && user" type="button" class="btn btn-primary w-full text-white" :disabled="submitting" @click="joinWaitlist">{{ submitting ? '處理中…' : '加入候補' }}</button>
              <router-link v-else-if="user" :to="checkoutPath" class="btn btn-primary w-full text-white">檢查資格與鎖定報價</router-link>
              <router-link v-else :to="loginPath" class="btn btn-primary w-full text-white">登入後報名</router-link>
            </template>

            <template v-else>
              <h2 class="ui-title text-xl text-slate-950">資格與結帳</h2>
              <ol class="grid grid-cols-3 gap-2" aria-label="固定班報名進度">
                <li v-for="step in checkoutSteps" :key="step.key" class="rounded-lg border px-2 py-2 text-center text-xs font-medium" :class="checkoutStepClass(step.index)" :aria-current="checkoutStage === step.index ? 'step' : undefined">
                  <span class="stat-number mr-1">{{ step.index }}</span>{{ step.label }}
                </li>
              </ol>
              <p v-if="eligibilityLoading" class="text-sm text-slate-500">正在檢查資格…</p>
              <p v-else class="rounded-lg bg-slate-50 p-3 text-sm leading-6" :class="eligibility?.eligible === false ? 'text-amber-800' : 'text-slate-600'">{{ eligibilityMessage }}</p>
              <p v-if="paymentOptionsUnavailable" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800" role="status" aria-live="polite">進階付款工具尚未開放，目前可繼續使用銀行匯款報名。
              </p>

              <label v-if="sessions.length > 1" class="block space-y-2 text-sm font-medium text-slate-700">報名起始堂次
                <select v-model="startSessionId" class="w-full">
                  <option value="">完整班期</option>
                  <option v-for="(session, index) in sessions" :key="session.id" :value="String(session.id)">第 {{ index + 1 }} 堂起・{{ formatDateTime(session.startsAt) }}</option>
                </select>
              </label>

              <button v-if="!quote" type="button" class="btn btn-primary w-full text-white" :disabled="submitting || termFull" @click="createQuote">{{ submitting ? '資格檢查中…' : '檢查資格並鎖定價格' }}</button>

              <template v-else>
                <div class="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <p class="text-sm text-slate-600">{{ quote.pricingMode || '班期報價' }}・{{ quote.selectedSessionCount }} 堂</p>
                  <p class="money-value mt-1 text-3xl text-slate-950">NT$ {{ formatMoney(quote.totalAmount) }}</p>
                  <p class="mt-2 text-xs text-slate-500">報價保留至 {{ formatDateTime(quote.expiresAt) }}</p>
                </div>

                <fieldset class="space-y-2">
                  <legend class="text-sm font-medium text-slate-700">付款方式</legend>
                  <label class="interactive-press flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition" :class="paymentMethod === 'BANK_TRANSFER' ? 'border-primary bg-primary/5 text-slate-900' : 'border-slate-200 bg-white text-slate-700'"><input v-model="paymentMethod" type="radio" value="BANK_TRANSFER" @change="selectedCourseTicketId = ''" />銀行匯款（24 小時席位保留）</label>
                  <label v-if="courseTickets.length" class="interactive-press flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition" :class="paymentMethod === 'COURSE_TICKET' ? 'border-primary bg-primary/5 text-slate-900' : 'border-slate-200 bg-white text-slate-700'"><input v-model="paymentMethod" type="radio" value="COURSE_TICKET" @change="selectedTrialTicketId = ''" />課程券全額支付</label>
                </fieldset>

                <label v-if="paymentMethod === 'COURSE_TICKET'" class="block space-y-2 text-sm font-medium text-slate-700">選擇課程券
                  <select v-model="selectedCourseTicketId" class="w-full" required>
                    <option value="">請選擇</option>
                    <option v-for="ticket in courseTickets" :key="ticket.ticketId" :value="String(ticket.ticketId)">{{ ticket.ticketProductName || ticket.ticketCode }}・{{ ticket.availableUses == null ? '不限次' : `可用 ${ticket.availableUses} 堂` }}</option>
                  </select>
                </label>

                <label v-if="paymentMethod === 'BANK_TRANSFER' && trialTickets.length" class="block space-y-2 text-sm font-medium text-slate-700">體驗折抵（選填）
                  <select v-model="selectedTrialTicketId" class="w-full">
                    <option value="">不使用體驗折抵</option>
                    <option v-for="ticket in trialTickets" :key="ticket.ticketId" :value="String(ticket.ticketId)">{{ ticket.ticketProductName || ticket.ticketCode }}・折抵 NT$ {{ formatMoney(ticket.discountAmount) }}</option>
                  </select>
                  <span class="block text-xs font-normal text-slate-500">體驗折抵可與匯款併用，不可與課程券同時使用。</span>
                </label>

                <section class="surface-muted space-y-3" aria-labelledby="term-rules-title">
                  <div><h3 id="term-rules-title" class="font-medium text-slate-900">報名規則</h3><p class="mt-1 text-sm leading-6 text-slate-600">{{ termsAccepted ? '已完成閱讀與同意；送出時會使用這份報價的規則快照。' : '請先閱讀本班期的報名、請假、補課、退費與服務商條款。' }}</p></div>
                  <button type="button" class="btn btn-outline interactive-press w-full" @click="reviewTermRules">{{ termsAccepted ? '再次閱讀班期規則' : '閱讀並同意班期規則' }}</button>
                </section>
                <button v-if="!checkoutResult" type="button" class="btn btn-primary w-full text-white" :disabled="submitting || !canCheckout" @click="checkout">{{ submitting ? '建立訂單中…' : '確認報名與付款' }}</button>
              </template>

              <button v-if="termFull" type="button" class="btn btn-outline w-full" :disabled="submitting" @click="joinWaitlist">加入候補</button>
            </template>
          </article>

          <article v-if="checkoutResult" class="ticket-card space-y-4 border-emerald-200 p-5">
            <div><p class="text-sm font-medium text-emerald-700">報名訂單已建立</p><p class="mt-1 font-mono text-slate-950">{{ checkoutResult.orderCode }}</p></div>
            <p v-if="checkoutResult.payByAt" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">請於 {{ formatDateTime(checkoutResult.payByAt) }} 前匯款並送出後五碼；期限內送出後會保留席位至人工審核。</p>
            <form v-if="checkoutResult.paymentStatus === 'pending'" class="space-y-3" @submit.prevent="submitBankTransfer">
              <label class="block space-y-2 text-sm font-medium text-slate-700">匯款帳號後五碼<input v-model.trim="remittanceLast5" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required class="w-full" /></label>
              <button class="btn btn-primary w-full text-white" :disabled="submitting || !/^\d{5}$/.test(remittanceLast5)">{{ submitting ? '送出中…' : '送出後五碼' }}</button>
            </form>
            <router-link to="/courses/me/enrollments" class="btn btn-outline w-full">查看我的固定班</router-link>
          </article>
        </aside>
      </div>
    </template>
    <LegalReviewDrawer ref="legalReviewRef" />
    </div>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import AppIcon from '../components/AppIcon.vue'
import LegalReviewDrawer from '../components/LegalReviewDrawer.vue'
import { buildCourseMutationHeaders, createCourseIdempotencyKey, formatCourseTaipeiDate, formatCourseTaipeiDateTime } from '../utils/courseV2'
import {
  COURSE_PRODUCTIZATION_ENDPOINTS,
  PUBLIC_COURSE_TASKS,
  courseCapacityLabel,
  courseCenterErrorMessage,
  courseTermCheckoutPath,
  isCourseTermFull,
  normalizeCourseTermPaymentOptions,
} from '../utils/courseProductization'
import { shouldRetainIdempotencyKey } from '../utils/orderParity.js'

const props = defineProps({ checkoutMode: { type: Boolean, default: false } })
const route = useRoute()
const API = API_BASE
const publicCourseTasks = PUBLIC_COURSE_TASKS
const checkoutSteps = Object.freeze([{ key: 'eligibility', index: 1, label: '資格' }, { key: 'quote', index: 2, label: '報價' }, { key: 'payment', index: 3, label: '付款' }])
const term = ref(null)
const loading = ref(true)
const loadError = ref('')
const submitting = ref(false)
const message = ref('')
const messageTone = ref('success')
const eligibility = ref(null)
const eligibilityLoading = ref(false)
const paymentOptions = ref([])
const paymentOptionsUnavailable = ref(false)
const quote = ref(null)
const checkoutResult = ref(null)
const startSessionId = ref('')
const paymentMethod = ref('BANK_TRANSFER')
const selectedCourseTicketId = ref('')
const selectedTrialTicketId = ref('')
const termsAccepted = ref(false)
const remittanceLast5 = ref('')
const remittanceMutationKey = ref('')
const remittanceMutationSignature = ref('')
const legalReviewRef = ref(null)
let termRequestId = 0
let eligibilityRequestId = 0
let actionGeneration = 0

const termId = computed(() => route.params.id)
const sessions = computed(() => Array.isArray(term.value?.sessions) ? term.value.sessions : [])
const termFull = computed(() => isCourseTermFull(term.value || {}))
const capacityLabel = computed(() => courseCapacityLabel(term.value || {}))
const checkoutPath = computed(() => courseTermCheckoutPath(termId.value))
const loginPath = computed(() => ({ path: '/login', query: { redirect: checkoutPath.value } }))
const user = computed(() => {
  try { return JSON.parse(localStorage.getItem('user_info') || 'null') } catch { return null }
})
const courseTickets = computed(() => paymentOptions.value.filter(item => item.instrumentType === 'COURSE_TICKET'))
const trialTickets = computed(() => paymentOptions.value.filter(item => item.instrumentType === 'TRIAL_DISCOUNT'))
const checkoutStage = computed(() => checkoutResult.value ? 3 : quote.value ? 2 : 1)
const termRulesText = computed(() => {
  const rules = quote.value?.rules || term.value?.rules || {}
  const lines = []
  if (term.value?.description) lines.push(`課程說明\n${term.value.description}`)
  if (hasNumericRule(rules.leaveQuota)) lines.push(`請假額度：每位學員 ${Number(rules.leaveQuota)} 次`)
  if (hasNumericRule(rules.leaveCutoffMinutes)) lines.push(`請假截止：每堂課開始前 ${Number(rules.leaveCutoffMinutes)} 分鐘`)
  if (hasNumericRule(rules.makeupValidDays)) lines.push(`補課權益效期：成立請假後 ${Number(rules.makeupValidDays)} 天`)
  if (quote.value) lines.push(`本次報價：${Number(quote.value.selectedSessionCount || 0)} 堂，NT$ ${formatMoney(quote.value.totalAmount)}`)
  return lines.join('\n\n') || '本班期未提供額外文字規則；報名堂次、價格、時間與名額以本頁伺服器報價為準。'
})
const selectedPaymentTicket = computed(() => {
  const id = Number(paymentMethod.value === 'COURSE_TICKET' ? selectedCourseTicketId.value : selectedTrialTicketId.value)
  return paymentOptions.value.find(item => item.ticketId === id) || null
})
const canCheckout = computed(() => Boolean(
  quote.value && termsAccepted.value
  && (paymentMethod.value !== 'COURSE_TICKET' || selectedCourseTicketId.value)
  && !(selectedCourseTicketId.value && selectedTrialTicketId.value)
))
const eligibilityMessage = computed(() => {
  if (eligibility.value?.message) return eligibility.value.message
  if (eligibility.value?.eligible === false) return '目前不符合報名資格，請依提示補齊程度或報名條件。'
  if (eligibility.value?.eligible === true) return '初步資格檢查通過；建立報價與結帳時會再次鎖定驗證。'
  return '資格、程度、價格與名額將在建立報價時由伺服器交易性重新驗證。'
})

function formatDate(value) { return formatCourseTaipeiDate(value) || '待公告' }
function formatDateTime(value) { return formatCourseTaipeiDateTime(value) || '待公告' }
function formatMoney(value) { return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0)) }
function hasNumericRule(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) }
function showMessage(value, tone = 'success') { message.value = value; messageTone.value = tone }
function unwrap(data) { return data?.data ?? data ?? {} }
function checkoutStepClass(index) {
  if (index < checkoutStage.value) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (index === checkoutStage.value) return 'border-primary bg-primary/5 text-primary'
  return 'border-slate-200 bg-white text-slate-500'
}
async function reviewTermRules() {
  if (!term.value || !quote.value) return
  const generation = actionGeneration
  const expectedTermId = String(termId.value || '')
  const accepted = await legalReviewRef.value?.open({
    title: '閱讀固定班報名規則',
    description: `${term.value.name}・報價 ${quote.value.quoteCode || quote.value.id || ''}`,
    items: [{ name: term.value.name, quantity: 1, detail: `${Number(quote.value.selectedSessionCount || 0)} 堂・NT$ ${formatMoney(quote.value.totalAmount)}` }],
    providerIds: term.value.ownerUserId ? [term.value.ownerUserId] : [],
    pageSlugs: ['terms'],
    extraSections: [{ key: 'course-term-rules', title: '本班期規則快照', content: termRulesText.value }],
  })
  if (accepted === true && generation === actionGeneration && expectedTermId === String(termId.value || '')) termsAccepted.value = true
}

async function loadEligibilityAndPayments(expectedTermId, parentRequestId) {
  if (!props.checkoutMode) {
    eligibility.value = null
    paymentOptions.value = []
    paymentOptionsUnavailable.value = false
    return
  }
  const requestId = ++eligibilityRequestId
  eligibilityLoading.value = true
  paymentOptionsUnavailable.value = false
  const [eligibilityResult, paymentResult] = await Promise.allSettled([
    axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.termEligibility(expectedTermId)}`),
    axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.termPaymentOptions(expectedTermId)}`),
  ])
  if (requestId !== eligibilityRequestId || parentRequestId !== termRequestId || String(expectedTermId) !== String(termId.value)) return
  if (eligibilityResult.status === 'fulfilled') eligibility.value = unwrap(eligibilityResult.value.data)
  else if (![404, 405].includes(Number(eligibilityResult.reason?.response?.status))) {
    eligibility.value = { eligible: false, message: courseCenterErrorMessage(eligibilityResult.reason, '資格檢查失敗') }
  }
  paymentOptions.value = paymentResult.status === 'fulfilled'
    ? normalizeCourseTermPaymentOptions(paymentResult.value.data)
    : []
  paymentOptionsUnavailable.value = paymentResult.status === 'rejected'
  if (requestId === eligibilityRequestId) eligibilityLoading.value = false
}

async function loadTerm() {
  const requestId = ++termRequestId
  eligibilityRequestId += 1
  actionGeneration += 1
  const expectedTermId = String(termId.value || '')
  loading.value = true; loadError.value = ''; quote.value = null; checkoutResult.value = null; termsAccepted.value = false
  message.value = ''
  messageTone.value = 'success'
  term.value = null
  eligibility.value = null
  paymentOptions.value = []
  paymentOptionsUnavailable.value = false
  eligibilityLoading.value = false
  submitting.value = false
  startSessionId.value = ''
  paymentMethod.value = 'BANK_TRANSFER'
  selectedCourseTicketId.value = ''
  selectedTrialTicketId.value = ''
  remittanceLast5.value = ''
  remittanceMutationKey.value = ''
  remittanceMutationSignature.value = ''
  try {
    const { data } = await axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.publicClass(expectedTermId)}`)
    if (requestId !== termRequestId || expectedTermId !== String(termId.value || '')) return
    term.value = unwrap(data)
    await loadEligibilityAndPayments(expectedTermId, requestId)
    if (requestId !== termRequestId || expectedTermId !== String(termId.value || '')) return
    if (props.checkoutMode && route.query.quote) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(`course-renewal-quote:${route.query.quote}`) || 'null')
        if (stored?.quoteCode && Number(stored.termId || expectedTermId) === Number(expectedTermId)) {
          quote.value = stored
          eligibility.value = { eligible: true, message: '續報資格已驗證，價格與堂次已鎖定。' }
        }
      } catch (_) {}
    }
  } catch (error) {
    if (requestId !== termRequestId || expectedTermId !== String(termId.value || '')) return
    loadError.value = courseCenterErrorMessage(error, '固定班詳情載入失敗')
  } finally { if (requestId === termRequestId) loading.value = false }
}

async function createQuote() {
  if (!term.value || submitting.value) return
  const generation = actionGeneration
  const expectedTermId = String(termId.value || '')
  submitting.value = true; message.value = ''
  try {
    const { data } = await axios.post(
      `${API}${COURSE_PRODUCTIZATION_ENDPOINTS.termQuote(expectedTermId)}`,
      { startSessionId: startSessionId.value ? Number(startSessionId.value) : null },
      { headers: buildCourseMutationHeaders(term.value, { idempotencyKey: createCourseIdempotencyKey('term-quote') }) }
    )
    if (generation !== actionGeneration || expectedTermId !== String(termId.value || '')) return
    quote.value = unwrap(data)
    termsAccepted.value = false
    eligibility.value = { eligible: true }
    showMessage('資格檢查通過，價格與報名堂次已鎖定。')
  } catch (error) { if (generation === actionGeneration) showMessage(courseCenterErrorMessage(error, '固定班報價失敗'), 'error') }
  finally { if (generation === actionGeneration) submitting.value = false }
}

async function checkout() {
  if (!canCheckout.value || submitting.value) return
  const generation = actionGeneration
  const expectedTermId = String(termId.value || '')
  submitting.value = true; message.value = ''
  const ticket = selectedPaymentTicket.value
  try {
    const headers = buildCourseMutationHeaders(quote.value, { idempotencyKey: createCourseIdempotencyKey('term-checkout') })
    if (ticket) headers['X-Course-Ticket-If-Match'] = String(ticket.rowVersion)
    const { data } = await axios.post(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.termCheckout}`, {
      quoteCode: quote.value.quoteCode,
      paymentMethod: paymentMethod.value,
      courseTicketId: selectedCourseTicketId.value ? Number(selectedCourseTicketId.value) : null,
      trialTicketId: selectedTrialTicketId.value ? Number(selectedTrialTicketId.value) : null,
      termsAccepted: true,
    }, { headers })
    if (generation !== actionGeneration || expectedTermId !== String(termId.value || '')) return
    checkoutResult.value = unwrap(data)
    showMessage(checkoutResult.value.paymentStatus === 'paid' ? '報名已確認。' : '已建立 24 小時匯款席位保留。')
  } catch (error) { if (generation === actionGeneration) showMessage(courseCenterErrorMessage(error, '固定班結帳失敗'), 'error') }
  finally { if (generation === actionGeneration) submitting.value = false }
}

async function joinWaitlist() {
  if (!term.value || submitting.value) return
  const generation = actionGeneration
  const expectedTermId = String(termId.value || '')
  submitting.value = true; message.value = ''
  try {
    await axios.post(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.termWaitlist(expectedTermId)}`, {}, {
      headers: buildCourseMutationHeaders(term.value, { idempotencyKey: createCourseIdempotencyKey('term-waitlist') }),
    })
    if (generation !== actionGeneration || expectedTermId !== String(termId.value || '')) return
    showMessage('已加入候補；取得席位時會收到限時 offer 通知。')
  } catch (error) { if (generation === actionGeneration) showMessage(courseCenterErrorMessage(error, '加入候補失敗'), 'error') }
  finally { if (generation === actionGeneration) submitting.value = false }
}

async function submitBankTransfer() {
  if (!checkoutResult.value || !/^\d{5}$/.test(remittanceLast5.value) || submitting.value) return
  const generation = actionGeneration
  const expectedTermId = String(termId.value || '')
  submitting.value = true; message.value = ''
  const signature = `${checkoutResult.value.orderId}:${remittanceLast5.value}`
  if (remittanceMutationSignature.value !== signature || !remittanceMutationKey.value) {
    remittanceMutationSignature.value = signature
    remittanceMutationKey.value = createCourseIdempotencyKey('term-remittance')
  }
  try {
    const { data } = await axios.post(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.orderPaymentSubmission(checkoutResult.value.orderId)}`, {
      last5: remittanceLast5.value,
    }, { headers: buildCourseMutationHeaders(checkoutResult.value, { idempotencyKey: remittanceMutationKey.value }) })
    if (generation !== actionGeneration || expectedTermId !== String(termId.value || '')) return
    checkoutResult.value = { ...checkoutResult.value, ...unwrap(data), paymentStatus: 'reviewing' }
    remittanceMutationKey.value = ''
    remittanceMutationSignature.value = ''
    showMessage('後五碼已送出，席位將保留至人工確認或駁回。')
  } catch (error) {
    if (generation !== actionGeneration) return
    if (!shouldRetainIdempotencyKey(error)) {
      remittanceMutationKey.value = ''
      remittanceMutationSignature.value = ''
    }
    showMessage(courseCenterErrorMessage(error, '匯款資料送出失敗'), 'error')
  }
  finally { if (generation === actionGeneration) submitting.value = false }
}

watch(startSessionId, () => { quote.value = null; checkoutResult.value = null; termsAccepted.value = false })
watch(paymentMethod, value => {
  if (value === 'COURSE_TICKET') selectedTrialTicketId.value = ''
  else selectedCourseTicketId.value = ''
})
watch([termId, () => props.checkoutMode], (value, previous) => {
  if (!previous || (String(value[0]) === String(previous[0]) && value[1] === previous[1])) return
  loadTerm()
})
onMounted(loadTerm)
onBeforeUnmount(() => {
  termRequestId += 1
  eligibilityRequestId += 1
  actionGeneration += 1
})
</script>
