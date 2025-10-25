<template>
    <main class="pt-6 pb-12 px-4">
        <div class="max-w-6xl mx-auto space-y-8">
<!--
            <header v-if="loadingEvent" class="bg-white shadow-sm border border-gray-100 p-6 flex flex-col gap-4 animate-pulse">
                <div class="space-y-3">
                    <div class="h-3 w-24 bg-gray-200 rounded"></div>
                    <div class="h-6 w-48 bg-gray-200 rounded"></div>
                    <div class="h-4 w-64 bg-gray-200 rounded"></div>
                </div>
                <div class="flex flex-col sm:flex-row gap-3">
                    <div class="h-9 w-full sm:w-40 bg-gray-200 rounded"></div>
                    <div class="h-9 w-full sm:w-40 bg-gray-200 rounded"></div>
                </div>
            </header>

            <header v-else class="bg-white shadow-sm border border-gray-100 p-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <p v-if="eventDetail.code" class="text-xs uppercase tracking-[0.25em] text-primary/70 mb-1">EVENT {{ eventDetail.code }}</p>
                    <h1 class="text-2xl font-bold text-gray-900">{{ eventDetail.name || '場次預約' }}</h1>
                    <p class="text-gray-600 mt-1">
                        <span v-if="eventDetail.date || eventDetail.starts_at || eventDetail.ends_at">
                            📅 {{ eventDetail.date || formatRange(eventDetail.starts_at, eventDetail.ends_at) }}
                        </span>
                        <span v-else>選擇門市與票券，完成預約流程</span>
                    </p>
                </div>
                <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                    <div class="w-full sm:w-auto flex items-center justify-center gap-2 bg-gray-50 text-gray-700 px-3 py-2 text-sm font-medium border border-gray-200">
                        <AppIcon name="ticket" class="h-4 w-4" />
                        <span v-if="eventDetail.deadline">報名截止：{{ eventDetail.deadline }}</span>
                        <span v-else>預約資訊</span>
                    </div>
                    <RouterLink
                        to="/store"
                        class="w-full sm:w-auto flex items-center justify-center gap-2 px-3 py-2 border text-sm hover:border-primary hover:text-primary hover:bg-red-50 transition">
                        <AppIcon name="store" class="h-4 w-4" /> 返回購票中心
                    </RouterLink>
                </div>
            </header>
-->
            <section v-if="bookingActionCards.length" class="mb-4">
                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    <div v-for="card in bookingActionCards" :key="card.key"
                        class="border border-gray-200 bg-white shadow-sm px-4 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div class="space-y-1">
                            <p class="text-sm font-semibold text-gray-800">{{ card.title }}</p>
                            <p class="text-xs text-gray-500" v-if="card.subtitle">{{ card.subtitle }}</p>
                        </div>
                        <button v-if="card.actionLabel"
                            class="btn btn-outline btn-sm self-start sm:self-auto whitespace-nowrap"
                            @click="handleBookingActionCard(card)">
                            {{ card.actionLabel }}
                        </button>
                    </div>
                </div>
            </section>

            <div v-if="loadingEvent" class="ticket-card bg-white border-2 border-gray-100 shadow-sm overflow-hidden animate-pulse">
                <div class="w-full bg-gray-200" style="aspect-ratio: 3/2;"></div>
                <div class="p-5 space-y-3">
                    <div class="h-4 bg-gray-200 rounded w-1/3"></div>
                    <div class="h-3 bg-gray-200 rounded w-2/3"></div>
                    <div class="h-3 bg-gray-200 rounded w-full"></div>
                    <div class="h-3 bg-gray-200 rounded w-5/6"></div>
                </div>
            </div>
            <AppCard v-else>
                <template #cover>
                    <div class="relative w-full overflow-hidden" style="aspect-ratio: 3/2;">
                        <img :src="eventDetail.cover || '/logo.png'" @error="(e)=>e.target.src='/logo.png'" alt="event cover" class="absolute inset-0 w-full h-full object-cover" />
                        <div class="absolute inset-0 bg-gradient-to-tr from-black/40 via-transparent to-red-700/20 pointer-events-none"></div>
                        <div class="absolute bottom-3 left-4 right-4 z-10 space-y-1">
                            <p v-if="eventDetail.code" class="text-xs uppercase tracking-[0.35em] text-white/70">EVENT {{ eventDetail.code }}</p>
                            <h2 class="text-2xl sm:text-3xl font-semibold text-white drop-shadow">{{ eventDetail.name }}</h2>
                            <p v-if="eventDetail.date || eventDetail.starts_at || eventDetail.ends_at" class="text-sm text-white/90">
                                📅 {{ eventDetail.date || formatRange(eventDetail.starts_at, eventDetail.ends_at) }}
                            </p>
                        </div>
                    </div>
                </template>
                <div class="space-y-4 text-sm text-gray-700">
                    <div class="grid gap-3 sm:grid-cols-2">
                        <div class="flex items-center gap-2 bg-gray-100 px-3 py-2 rounded">
                            <AppIcon name="ticket" class="h-4 w-4 text-primary" />
                            <span class="font-medium">商品編號：</span>
                            <span>{{ eventDetail.code || '—' }}</span>
                        </div>
                        <div v-if="eventDetail.deadline" class="flex items-center gap-2 bg-gray-100 px-3 py-2 rounded">
                            <AppIcon name="orders" class="h-4 w-4 text-primary" />
                            <span class="font-medium">報名截止：</span>
                            <span>{{ eventDetail.deadline }}</span>
                        </div>
                    </div>
                    <p v-if="eventDetail.description" class="leading-relaxed">{{ eventDetail.description }}</p>
                    <ul v-if="eventDetail.deliveryNotes.length" class="list-disc pl-5 space-y-1">
                        <li v-for="note in eventDetail.deliveryNotes" :key="note">{{ note }}</li>
                    </ul>
                </div>
            </AppCard>

            <section ref="storesSectionRef" class="space-y-4">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <h3 class="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <AppIcon name="store" class="h-5 w-5 text-primary" /> 門市價格表
                    </h3>
                    <span class="text-sm text-gray-500">依照門市調整購買數量與使用票券</span>
                </div>
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div class="relative w-full sm:w-80">
                        <AppIcon name="search"
                            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input v-model.trim="storeSearch"
                            class="w-full pl-10 pr-10 py-2 border border-gray-200 focus:border-primary focus:ring-0 text-sm text-gray-700 placeholder-gray-400"
                            placeholder="搜尋門市（名稱、時段或車型）" />
                        <button v-if="storeSearch"
                            class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                            @click="clearStoreSearch">
                            清除
                        </button>
                    </div>
                    <div class="flex items-center gap-2">
                        <button class="btn btn-outline btn-sm" @click="router.push('/store')">
                            <AppIcon name="store" class="h-4 w-4" /> 回到購票中心
                        </button>
                        <button class="btn btn-outline btn-sm" @click="goWalletReservations">
                            <AppIcon name="orders" class="h-4 w-4" /> 檢視預約
                        </button>
                    </div>
                </div>

                <div v-if="loadingStores" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div v-for="i in 4" :key="`store-skel-${i}`" class="ticket-card bg-white border-2 border-gray-100 shadow-sm p-5 animate-pulse space-y-4">
                        <div class="h-5 w-1/2 bg-gray-200 rounded"></div>
                        <div class="h-4 w-3/4 bg-gray-200 rounded"></div>
                        <div class="h-36 bg-gray-200 rounded"></div>
                    </div>
                </div>
                <div v-else-if="!filteredStores.length" class="ticket-card bg-white border-2 border-gray-100 shadow-sm p-5 text-sm text-gray-500">
                    {{ storeSearch ? '沒有符合搜尋條件的門市。' : '目前尚無可用門市資訊。' }}
                </div>
                <template v-else>
                    <div class="space-y-4">
                        <div v-for="(store, storeIdx) in displayedStores" :key="store.id || `${store.name}-${storeIdx}`" class="ticket-card bg-white border-2 border-gray-100 shadow-sm p-4 sm:p-5">
                            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                                <div>
                                    <h4 class="text-lg font-semibold text-primary">{{ store.name }}</h4>
                                    <p class="text-sm text-gray-600">賽前交車：{{ store.pre }}｜賽後取車：{{ store.post }}</p>
                                </div>
                                <span class="text-xs text-gray-500 uppercase tracking-[0.2em]">
                                    Store {{ shouldPaginateStores ? ((activeStorePage - 1) * STORES_PAGE_SIZE) + storeIdx + 1 : storeIdx + 1 }}
                                </span>
                            </div>

                            <div class="hidden sm:block">
                                <div class="overflow-x-auto -mx-2 sm:mx-0">
                                    <table class="min-w-full border text-sm mb-2 table-default">
                                        <thead class="bg-gray-50">
                                            <tr>
                                                <th class="border p-2 whitespace-nowrap">車型</th>
                                                <th class="border p-2 whitespace-nowrap">原價</th>
                                                <th class="border p-2 whitespace-nowrap">早鳥價</th>
                                                <th class="border p-2 whitespace-nowrap">購買數量</th>
                                                <th class="border p-2 whitespace-nowrap">使用票券數</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr v-for="(price, type) in store.prices" :key="type">
                                                <td class="border p-2">{{ type }}</td>
                                                <td class="border p-2">TWD {{ price.normal }}</td>
                                                <td class="border p-2">TWD {{ price.early }}</td>
                                                <td class="border p-2">
                                                    <QuantityStepper v-model="store.quantity[type]" :min="0" :max="999" />
                                                </td>
                                                <td class="border p-2">
                                                    <div class="flex items-center gap-2">
                                                        <QuantityStepper
                                                          v-model="store.useTickets[type]"
                                                          :min="0"
                                                          :max="ticketsRemainingFor(store, type) + (store.useTickets[type] || 0)"
                                                          :disabled="!loggedIn"
                                                        />
                                                        <small v-if="loggedIn" class="text-gray-500">可用：{{ ticketsRemainingFor(store, type) }}</small>
                                                        <small v-else class="text-gray-400">登入後可使用票券</small>
                                                    </div>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div class="space-y-3 sm:hidden">
                                <div
                                    v-for="(price, type) in store.prices"
                                    :key="`${store.name}-${type}`"
                                    class="border border-gray-200 rounded-lg p-3 bg-gray-50"
                                >
                                    <h5 class="text-base font-semibold text-gray-800 mb-3">{{ type }}</h5>
                                    <div class="space-y-2 text-sm text-gray-700">
                                        <div class="flex items-center justify-between">
                                            <span class="text-gray-500">原價</span>
                                            <span class="font-medium text-gray-800">TWD {{ price.normal }}</span>
                                        </div>
                                        <div class="flex items-center justify-between">
                                            <span class="text-gray-500">早鳥價</span>
                                            <span class="font-medium text-gray-800">TWD {{ price.early }}</span>
                                        </div>
                                    </div>
                                    <div class="mt-4 space-y-3">
                                        <div>
                                            <label class="block text-xs text-gray-500 mb-1">購買數量</label>
                                            <QuantityStepper v-model="store.quantity[type]" :min="0" :max="999" />
                                        </div>
                                        <div>
                                            <label class="block text-xs text-gray-500 mb-1">使用票券數</label>
                                            <div class="flex flex-wrap items-center gap-2">
                                                <QuantityStepper
                                                    v-model="store.useTickets[type]"
                                                    :min="0"
                                                    :max="ticketsRemainingFor(store, type) + (store.useTickets[type] || 0)"
                                                    :disabled="!loggedIn"
                                                />
                                                <small v-if="loggedIn" class="text-gray-500">可用：{{ ticketsRemainingFor(store, type) }}</small>
                                                <small v-else class="text-gray-400">登入後可使用票券</small>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div v-if="shouldPaginateStores" class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-6">
                        <div class="flex items-center gap-2 flex-wrap">
                            <button class="btn btn-outline btn-sm" :disabled="activeStorePage <= 1" @click="goPrevStorePage">
                                上一頁
                            </button>
                            <div class="flex items-center gap-1">
                                <button
                                    v-for="page in totalStorePages"
                                    :key="`store-page-${page}`"
                                    class="px-3 py-1 text-sm border rounded transition"
                                    :class="page === activeStorePage ? 'bg-primary text-white border-primary' : 'bg-white hover:border-primary hover:text-primary'"
                                    @click="goToStorePage(page)"
                                >
                                    {{ page }}
                                </button>
                            </div>
                            <button class="btn btn-outline btn-sm" :disabled="activeStorePage >= totalStorePages" @click="goNextStorePage">
                                下一頁
                            </button>
                        </div>
                    </div>
                </template>
            </section>

            <div class="ticket-card bg-white border-2 border-gray-100 shadow-sm p-4 sm:p-5 space-y-3">
                <h3 class="text-lg font-semibold text-gray-900">加值服務與確認</h3>
                <div class="flex flex-col sm:flex-row sm:items-center gap-3">
                    <label class="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" v-model="addOn.material" class="mr-1" />
                        加購包材 100 元/份
                    </label>
                    <input
                        type="number"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        min="0"
                        class="w-full sm:w-24 border px-2 py-1 text-sm"
                        v-model.number="addOn.materialCount"
                        :disabled="!addOn.material"
                    />
                </div>
                <div class="space-y-2 text-sm text-gray-700">
                    <label class="flex items-start gap-2">
                        <input type="checkbox" v-model="addOn.nakedConfirm" class="mt-1" />
                        <span>我已了解裸車不予託運</span>
                    </label>
                    <label class="flex items-start gap-2">
                        <input type="checkbox" v-model="addOn.purchasePolicy" class="mt-1" />
                        <span>
                            我已詳閱
                            <RouterLink to="/reservation-notice" class="text-primary underline hover:opacity-80">購買須知</RouterLink>
                        </span>
                    </label>
                    <label class="flex items-start gap-2">
                        <input type="checkbox" v-model="addOn.usagePolicy" class="mt-1" />
                        <span>
                            我已詳閱
                            <RouterLink to="/reservation-rules" class="text-primary underline hover:opacity-80">使用規定</RouterLink>
                        </span>
                    </label>
                </div>
            </div>

            <div v-if="!loggedIn" class="ticket-card border-2 border-amber-200 bg-amber-50 text-amber-800 shadow-sm p-4 sm:p-5">
                <h3 class="text-base font-semibold mb-2">請先登入</h3>
                <p class="text-sm">登入後才能使用票券或送出預約，亦可查看可用票券與折抵紀錄。</p>
            </div>
            <div v-else-if="Object.keys(ticketsAvailableByType).length" class="ticket-card border-2 border-primary/30 bg-red-50/70 text-gray-800 shadow-sm p-4 sm:p-5">
                <h3 class="text-base font-semibold mb-2 text-primary">可用票券</h3>
                <p class="text-sm">
                    <span v-for="(cnt, t) in ticketsAvailableByType" :key="t" class="inline-flex items-center gap-1 mr-3">
                        <AppIcon name="ticket" class="h-3.5 w-3.5 text-primary" /> {{ t }} × {{ cnt }}
                    </span>
                </p>
            </div>

            <div class="ticket-card bg-white border-2 border-gray-100 shadow-sm p-4 sm:p-5 space-y-3">
                <h3 class="text-lg font-semibold text-gray-900">預約摘要</h3>
                <ul class="space-y-1 text-sm text-gray-700">
                    <li v-if="!selectionsPreview.length" class="text-gray-400">尚未選擇任何數量。</li>
                    <li v-for="s in selectionsPreview" :key="s.key">{{ s.store }}｜{{ s.type }} × {{ s.qty }}（{{ s._byTicket ? '使用票券' : ('單價 ' + s.unit) }}）</li>
                </ul>
                <div class="text-sm text-gray-700 space-y-1 text-right">
                    <div>小計：TWD {{ subtotal }}</div>
                    <div v-if="addOn.material && addOn.materialCount > 0">包材：TWD {{ addOn.materialCount * 100 }}</div>
                </div>
                <div class="text-xl font-bold text-right text-primary">
                    總金額：TWD {{ finalTotal }}
                </div>
            </div>
        </div>

        <div class="sticky bottom-0 left-0 right-0 p-3 pb-safe z-30 md:static md:border-0 md:p-0">
            <div class="max-w-6xl mx-auto">
                <button @click="confirmReserve" class="w-full btn btn-primary text-white py-3 hover:opacity-90 flex items-center justify-center gap-2">
                    <AppIcon name="orders" class="h-4 w-4" /> 確認預約
                </button>
            </div>
        </div>
    </main>
</template>

<script setup>
    import { ref, computed, onMounted, watch, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
    import { useRoute, useRouter } from 'vue-router'
    import api from '../api/axios'
    import AppIcon from '../components/AppIcon.vue'
    import { showNotice } from '../utils/sheet'
    import { formatDateTimeRange } from '../utils/datetime'
    import AppCard from '../components/AppCard.vue'
    const QuantityStepper = defineAsyncComponent(() => import('../components/QuantityStepper.vue'))

    const route = useRoute()
    const router = useRouter()
    const API = 'https://api.xiaozhi.moe/uat/leader_online'

    const loadingEvent = ref(true)
    const loadingStores = ref(true)

    // 從網址參數取得活動代碼
    const routeCode = computed(() => String(route.params.code || ''))
    const currentEventId = ref(null)
    const loggedIn = ref(false)
    const sessionProfile = ref(null)

    const storesSectionRef = ref(null)
    const STORES_PAGE_SIZE = 10
    const activeStorePage = ref(1)
    const goWalletReservations = () => router.push({ path: '/wallet', query: { tab: 'reservations' } })

    // 賽事資料
    const eventDetail = ref({ id: null, code: '', name: '', date: '', deadline: '', description: '', cover: '', deliveryNotes: [], starts_at: null, ends_at: null })
    const fetchEvent = async (id) => {
        loadingEvent.value = true
        try {
            const { data } = await api.get(`${API}/events/${id}`)
            const e = data?.data || data || {}
            const rules = Array.isArray(e.rules) ? e.rules : (e.rules ? safeParseArray(e.rules) : [])
            eventDetail.value = {
                id: e.id,
                code: e.code || (e?.id ? `EV${String(e.id).padStart(6,'0')}` : ''),
                name: e.name || e.title || '',
                date: e.date || '',
                deadline: e.deadline || e.ends_at || '',
                starts_at: e.starts_at || e.start_at || null,
                ends_at: e.ends_at || e.end_at || null,
                description: e.description || '',
                cover: (e.cover || e.banner || e.image || (e.id ? `${API}/events/${e.id}/cover` : '')),
                deliveryNotes: rules
            }
        } catch (err) { console.error(err) }
        finally { loadingEvent.value = false }
    }
    function safeParseArray(s) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] } }

    // 場次店面（從後端載入）
    const stores = ref([])
    const storeSearch = ref('')
    const filteredStores = computed(() => {
        const keyword = storeSearch.value.trim().toLowerCase()
        if (!keyword) return stores.value
        return stores.value.filter(store => {
            const fields = [
                store.name,
                store.pre,
                store.post,
                store.location,
                ...(Object.keys(store.prices || {}))
            ]
            return fields.some(field => String(field || '').toLowerCase().includes(keyword))
        })
    })
    const clearStoreSearch = () => { storeSearch.value = '' }
    const tickets = ref([])
    // 票種名稱正規化：移除空白、結尾的「隊/組」、結尾括號附註
    const normalizeTypeName = (t) => {
        let s = String(t || '').trim()
        if (!s) return ''
        s = s.replace(/\s+/g, '')
        s = s.replace(/^(EV|E)?\d{1,8}/i, '')
        s = s.replace(/[（(][^（）()]*[）)]\s*$/, '')
        s = s.replace(/(單車託運券|託運券|票券|憑證|入場券|券)\s*$/, '')
        s = s.replace(/(隊|組)\s*$/, '')
        return s
    }
    const resolveProductId = (source) => {
        if (source == null) return null
        if (typeof source === 'number') return Number.isFinite(source) && source > 0 ? source : null
        if (typeof source === 'string') {
            const n = Number(source)
            return Number.isFinite(n) && n > 0 ? n : null
        }
        if (typeof source !== 'object') return null
        const raw =
            source.product_id ??
            source.productId ??
            source.productID ??
            source.ticket_product_id ??
            source.ticketProductId ??
            source.product?.id ??
            source.product?.product_id ??
            source.product
        const n = Number(raw)
        return Number.isFinite(n) && n > 0 ? n : null
    }
    const bindingKeyForTicket = (ticket) => {
        const productId = resolveProductId(ticket)
        if (productId) return `p-${productId}`
        const normalized = normalizeTypeName(ticket?.type)
        return normalized ? `t-${normalized}` : ''
    }
    const bindingKeyForType = (store, type) => {
        const info = store?.prices?.[type] || {}
        const productId = resolveProductId(info)
        if (productId) return `p-${productId}`
        const normalized = normalizeTypeName(type)
        return normalized ? `t-${normalized}` : ''
    }
    const productIdForType = (store, type) => resolveProductId(store?.prices?.[type])
    const normalizeStorePrices = (prices = {}) => {
        const result = {}
        Object.keys(prices || {}).forEach(type => {
            const raw = prices[type] || {}
            const normal = Number(raw.normal || 0)
            const early = Number(raw.early || 0)
            const productId = resolveProductId(raw)
            const normalized = {
                ...raw,
                normal,
                early,
                productId: productId || null,
            }
            result[type] = normalized
        })
        return result
    }
    const makeQuantity = (prices) => { const q = {}; Object.keys(prices || {}).forEach(k => q[k] = 0); return q }
    const makeUseTickets = (prices) => { const q = {}; Object.keys(prices || {}).forEach(k => q[k] = 0); return q }
    const fetchStores = async (id) => {
        loadingStores.value = true
        try {
            const { data } = await api.get(`${API}/events/${id}/stores`)
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            stores.value = list.map(s => {
                const prices = normalizeStorePrices(s.prices || {})
                const preRange = formatDateTimeRange(s.pre_start, s.pre_end)
                const postRange = formatDateTimeRange(s.post_start, s.post_end)
                return {
                    id: s.id,
                    eventId: s.event_id || s.eventId || currentEventId.value || null,
                    name: s.name,
                    location: s.location || s.city || '',
                    pre: preRange,
                    post: postRange,
                    prices,
                    quantity: makeQuantity(prices),
                    useTickets: makeUseTickets(prices),
                }
            })
            activeStorePage.value = 1
        } catch (e) { console.error(e) }
        finally { loadingStores.value = false }
    }

    // 票券（可用）
    const loadTickets = async () => {
        if (!loggedIn.value) {
            tickets.value = []
            return
        }
        try {
            const { data } = await api.get(`${API}/tickets/me`)
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            tickets.value = list.filter(t => !t.used)
        } catch (e) {
            if (e?.response?.status === 401) {
                loggedIn.value = false
                sessionProfile.value = null
            } else console.error(e)
        }
    }

    // 依原始票種名稱彙總（僅供顯示「可用票券」清單）
    const ticketsAvailableByType = computed(() => {
        const m = {}
        for (const t of tickets.value) {
            const type = String(t.type || '')
            if (!type) continue
            m[type] = (m[type] || 0) + 1
        }
        return m
    })

    // 依正規化後的票種名稱彙總（用於可折抵邏輯）
    const ticketsAvailableByBinding = computed(() => {
        const m = {}
        for (const t of tickets.value) {
            if (t.used) continue
            const key = bindingKeyForTicket(t)
            if (!key) continue
            m[key] = (m[key] || 0) + 1
        }
        return m
    })

    const ticketsRemainingByBinding = computed(() => {
        const remaining = { ...ticketsAvailableByBinding.value }
        for (const store of stores.value) {
            for (const type of Object.keys(store.useTickets || {})) {
                const want = Number(store.useTickets[type] || 0)
                const key = bindingKeyForType(store, type)
                if (!key) continue
                if (!remaining[key]) remaining[key] = 0
                remaining[key] = Math.max(0, remaining[key] - want)
            }
        }
        return remaining
    })
    const ticketsRemainingFor = (store, type) => {
        const key = bindingKeyForType(store, type)
        if (!key) return 0
        return Number(ticketsRemainingByBinding.value[key] || 0)
    }

    // 加值服務與勾選
    const addOn = ref({ material: false, materialCount: 0, nakedConfirm: false, purchasePolicy: false, usagePolicy: false })

    // 目前預約總數（含使用票券與付費數量）
    const reservationQuantity = computed(() => {
        let total = 0
        for (const s of stores.value) {
            for (const k in (s.useTickets || {})) total += Number(s.useTickets[k] || 0)
            for (const k in (s.quantity || {})) total += Number(s.quantity[k] || 0)
        }
        return total
    })

    const bookingActionCards = computed(() => {
        const cards = []
        if (!loggedIn.value) {
            cards.push({
                key: 'login-required',
                title: '尚未登入，無法同步票券與預約',
                subtitle: '登入以自動帶入購票資訊並保存預約進度',
                action: 'login',
                actionLabel: '前往登入'
            })
        }
        if (tickets.value.length > 0) {
            cards.push({
                key: 'tickets-available',
                title: `可用票券 ${tickets.value.length} 張`,
                subtitle: '抵扣費用前，記得確認票券適用門市與車型',
                action: 'wallet',
                actionLabel: '檢視錢包'
            })
        }
        if (reservationQuantity.value > 0) {
            cards.push({
                key: 'reservation-progress',
                title: `已選 ${reservationQuantity.value} 項預約，請確認金額與票券`,
                subtitle: '滑動至門市區塊可調整使用票券與購買數量',
                action: 'review',
                actionLabel: '回到門市清單'
            })
        }
        return cards
    })

    const scrollToStores = () => {
        const el = storesSectionRef.value
        if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    const handleBookingActionCard = (card) => {
        if (!card) return
        if (card.action === 'login') {
            router.push({ path: '/login', query: { redirect: route.fullPath || route.path } })
        } else if (card.action === 'wallet') {
            router.push({ path: '/wallet', query: { tab: 'tickets' } })
        } else if (card.action === 'review') {
            scrollToStores()
        }
    }

    // 勾選加購包材後，預先帶入預約總數（仍可手動調整）
    watch(() => addOn.value.material, (checked) => {
        if (checked) {
            addOn.value.materialCount = reservationQuantity.value
        } else {
            addOn.value.materialCount = 0
        }
    })

    watch(loggedIn, (authed) => {
        if (authed) {
            loadTickets()
        } else {
            tickets.value = []
            sessionProfile.value = null
        }
    })

    // 是否早鳥（用 deadline 判斷，逾期則用原價）
    const isEarlyBird = computed(() => {
        if (!eventDetail.value.deadline) return true
        const d = new Date(eventDetail.value.deadline)
        const now = new Date()
        if (Number.isNaN(d.getTime())) return true
        return now <= d
    })

    // 價格計算（>=20 件 9 折）
    const subtotal = computed(() => {
        let sum = 0
        stores.value.forEach(store => {
            for (const type in store.quantity) {
                const qty = store.quantity[type]
                if (qty > 0) {
                    const unit = isEarlyBird.value ? store.prices[type].early : store.prices[type].normal
                    sum += unit * qty
                }
            }
        })
        return sum
    })

    // 最終金額（不使用優惠券）
    const finalTotal = computed(() => {
        const addOnCost = (addOn.value.material ? (100 * Math.max(0, addOn.value.materialCount || 0)) : 0)
        return Math.max(subtotal.value + addOnCost, 0)
    })

    // 手動微調：購買數量、使用票券
    const changeQty = (store, type, d) => {
        const v = Math.max(0, Number(store.quantity[type] || 0) + Number(d || 0))
        store.quantity[type] = v
    }
    const changeUseTicket = (store, type, d) => {
        const cur = Number(store.useTickets[type] || 0)
        const max = ticketsRemainingFor(store, type) + cur
        const v = Math.max(0, Math.min(max, cur + Number(d || 0)))
        store.useTickets[type] = v
    }

    const storePages = computed(() => {
        const list = filteredStores.value || []
        if (!Array.isArray(list) || !list.length) return []
        const pages = []
        for (let i = 0; i < list.length; i += STORES_PAGE_SIZE) {
            pages.push(list.slice(i, i + STORES_PAGE_SIZE))
        }
        return pages
    })
    const totalStorePages = computed(() => storePages.value.length || 0)
    const shouldPaginateStores = computed(() => totalStorePages.value > 1)
    watch(storePages, () => {
        if (totalStorePages.value === 0) {
            activeStorePage.value = 1
        } else if (activeStorePage.value > totalStorePages.value) {
            activeStorePage.value = totalStorePages.value
        } else if (activeStorePage.value < 1) {
            activeStorePage.value = 1
        }
    }, { immediate: true })
    const currentStorePageIndex = computed(() => {
        if (!shouldPaginateStores.value) return 0
        return Math.min(Math.max(activeStorePage.value - 1, 0), totalStorePages.value - 1)
    })
    const displayedStores = computed(() => {
        if (!shouldPaginateStores.value) return filteredStores.value
        return storePages.value[currentStorePageIndex.value] || []
    })
    watch(storeSearch, () => {
        activeStorePage.value = 1
    })
    const goToStorePage = (page) => {
        if (!shouldPaginateStores.value) return
        const target = Math.min(Math.max(1, Number(page) || 1), totalStorePages.value)
        if (target === activeStorePage.value) return
        activeStorePage.value = target
        nextTick(() => {
            const el = storesSectionRef.value
            if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    }
    const goPrevStorePage = () => {
        if (activeStorePage.value > 1) goToStorePage(activeStorePage.value - 1)
    }
    const goNextStorePage = () => {
        if (activeStorePage.value < totalStorePages.value) goToStorePage(activeStorePage.value + 1)
    }

    const selectionsPreview = computed(() => {
        const items = []
        // 票券使用（單價 0）
        stores.value.forEach(store => {
            for (const type in store.useTickets) {
                const qty = Number(store.useTickets[type] || 0)
                if (qty > 0) items.push({ key: `T-${store.name}-${type}`, store: store.name, storeId: store.id, type, qty, unit: 0, _byTicket: true })
            }
        })
        // 付費數量
        stores.value.forEach(store => {
            for (const type in store.quantity) {
                const qty = Number(store.quantity[type] || 0)
                if (qty > 0) {
                    const unit = isEarlyBird.value ? store.prices[type].early : store.prices[type].normal
                    items.push({ key: `P-${store.name}-${type}`, store: store.name, storeId: store.id, type, qty, unit, _byTicket: false })
                }
            }
        })
        return items
    })

    // 是否同時建立 reservations（每張票都建一筆）
    // 預約紀錄在訂單「已完成」時由後端建立，這裡不先建立

    // 共用格式化
    const formatRange = (a, b) => formatDateTimeRange(a, b)

    // 建立訂單（單筆 items[0]）
    const confirmReserve = async () => {
        if (!(await checkSession())) {
            await showNotice('請先登入再預約', { title: '需要登入' })
            const redirectTarget = route.fullPath || route.path
            router.push({ path: '/login', query: { redirect: redirectTarget } })
            return
        }
        if (!addOn.value.nakedConfirm || !addOn.value.purchasePolicy || !addOn.value.usagePolicy) { await showNotice('請先勾選所有規定確認'); return }
        if (!(await ensureContactInfoReady())) return

        const selections = []
        const poolByBinding = {}
        for (const t of tickets.value) {
            if (t.used) continue
            const key = bindingKeyForTicket(t)
            if (!key) continue
            if (!poolByBinding[key]) poolByBinding[key] = []
            poolByBinding[key].push(t)
        }
        const usedTicketIds = []
        // 票券使用 selections
        for (const store of stores.value) {
            for (const type in store.useTickets) {
                const need = Number(store.useTickets[type] || 0)
                if (need > 0) {
                    const key = bindingKeyForType(store, type)
                    const pool = key ? (poolByBinding[key] || []) : []
                    if (pool.length < need) { await showNotice(`票券不足：${type}`, { title: '庫存不足' }); return }
                    const taken = pool.splice(0, need)
                    usedTicketIds.push(...taken.map(x => x.id))
                    const productId = productIdForType(store, type)
                    const storeId = store.id || null
                    selections.push({
                        store: store.name,
                        ...(storeId ? { storeId, store_id: storeId } : {}),
                        type,
                        qty: need,
                        unitPrice: 0,
                        subtotal: 0,
                        byTicket: true,
                        ...(productId ? { productId, product_id: productId } : {})
                    })
                }
            }
        }
        stores.value.forEach(store => {
            for (const type in store.quantity) {
                const qty = store.quantity[type]
                if (qty > 0) {
                    const productId = productIdForType(store, type)
                    const storeId = store.id || null
                    selections.push({
                        store: store.name,
                        ...(storeId ? { storeId, store_id: storeId } : {}),
                        type,
                        qty,
                        unitPrice: (isEarlyBird.value ? store.prices[type].early : store.prices[type].normal),
                        subtotal: (isEarlyBird.value ? store.prices[type].early : store.prices[type].normal) * qty,
                        ...(productId ? { productId, product_id: productId } : {})
                    })
                }
            }
        })
        const totalQty = selections.reduce((s, x) => s + x.qty, 0)
        if (!totalQty) { await showNotice('尚未選擇數量'); return }

        try {
            const details = {
                kind: 'event-reservation',
                event: { id: eventDetail.value.id, code: eventDetail.value.code, name: eventDetail.value.name, date: eventDetail.value.date || formatRange(eventDetail.value.starts_at, eventDetail.value.ends_at) },
                selections,
                addOn: addOn.value,
                subtotal: subtotal.value,
                // 預約不使用優惠券
                addOnCost: addOn.value.material ? (100 * Math.max(0, addOn.value.materialCount || 0)) : 0,
                total: finalTotal.value,
                quantity: totalQty,
                ticketsUsed: usedTicketIds,
                status: '待匯款'
            }
            await api.post(`${API}/orders`, { items: [details] })

            // 無需標記優惠券使用

            await showNotice(`✅ 已成功建立訂單\n總金額：${finalTotal.value} 元`)
            router.push({ path: '/wallet', query: { tab: 'reservations' } })
        } catch (err) {
            await showNotice(err?.response?.data?.message || err.message || '系統錯誤', { title: '錯誤' })
        }
    }

    const checkSession = async () => {
        try {
            const { data } = await api.get(`${API}/whoami`)
            if (data?.ok) {
                loggedIn.value = true
                sessionProfile.value = data.data || data || null
                return true
            }
            loggedIn.value = false
            sessionProfile.value = null
            return false
        } catch {
            loggedIn.value = false
            sessionProfile.value = null
            return false
        }
    }

    const ensureContactInfoReady = async () => {
        if (!sessionProfile.value) {
            const authed = await checkSession()
            if (!authed) return false
        }
        const info = sessionProfile.value || {}
        const phoneDigits = String(info.phone || '').replace(/\D/g, '')
        const last5 = String((info.remittanceLast5 ?? info.remittance_last5) || '').trim()
        if (phoneDigits.length < 8 || !/^\d{5}$/.test(last5)) {
            await showNotice('請先於帳戶中心補齊手機號碼與匯款帳號後五碼，再送出預約', { title: '需要補完資料' })
            router.push({ path: '/account', query: { tab: 'profile' } })
            return false
        }
        return true
    }

    const hasStoredSession = () => {
        try { return !!localStorage.getItem('user_info') } catch { return false }
    }
    const handleAuthChanged = () => {
        if (hasStoredSession()) {
            checkSession()
        } else {
            loggedIn.value = false
            tickets.value = []
            sessionProfile.value = null
        }
    }
    const handleStorage = (event) => {
        if (!event || event.key === 'user_info') handleAuthChanged()
    }

    onMounted(async () => {
        window.addEventListener('auth-changed', handleAuthChanged)
        window.addEventListener('storage', handleStorage)

        let id = null
        const code = routeCode.value
        if (code && /^\d+$/.test(code)) {
            id = Number(code)
        } else {
            try {
                const { data } = await api.get(`${API}/events`)
                const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
                const hit = list.find(e => String(e.code || `EV${String(e.id).padStart(6,'0')}`) === code)
                id = hit?.id || null
            } catch (e) { console.error(e) }
        }

        if (!id) {
            await showNotice('找不到對應的活動', { title: '錯誤' })
            router.push('/store')
            return
        }

        currentEventId.value = id
        await Promise.all([fetchEvent(id), fetchStores(id)])

        const authed = await checkSession()
        if (authed) await loadTickets()
    })

    onBeforeUnmount(() => {
        window.removeEventListener('auth-changed', handleAuthChanged)
        window.removeEventListener('storage', handleStorage)
    })
</script>

<style scoped>

    button,
    input,
    .bg-white,
    table,
    td,
    th {
        border-radius: 0 !important;
    }
</style>
