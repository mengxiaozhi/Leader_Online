<template>
    <main class="pt-6 pb-12 px-4">
        <div class="max-w-6xl mx-auto">
            <!-- Header -->
            <header class="bg-white shadow-sm border-b border-gray-100 mb-8 p-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 class="text-2xl font-bold text-gray-900">鐵人競賽購票中心</h1>
                    <p class="text-gray-600 mt-1">購買票券 • 管理訂單 • 預約賽事</p>
                </div>
                <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                    <button class="w-full sm:w-auto flex items-center justify-center gap-1 bg-red-50 text-red-700 px-3 py-2 text-sm font-medium border border-red-200 hover:bg-red-100 hover:text-primary hover:border-primary transition"
                        @click="cartOpen = true">
                        <AppIcon name="cart" class="h-4 w-4" /> 購物車 {{ cartItems.length }} 項
                    </button>
                    <button class="w-full sm:w-auto flex items-center justify-center gap-1 px-3 py-2 border text-sm hover:border-primary hover:text-primary hover:bg-red-50 transition" @click="openOrders()">
                        <AppIcon name="orders" class="h-4 w-4" /> 我的訂單
                    </button>
                </div>
            </header>

            <!-- Tabs -->
            <div class="relative mb-6 sticky top-0 z-20 bg-white">
                <div class="flex justify-center border-b border-gray-200 relative">
                    <div class="tab-indicator" :style="indicatorStyle"></div>

                    <button class="relative px-4 py-3 sm:px-6 sm:py-4 font-semibold transition-all duration-300 text-base sm:text-lg whitespace-nowrap flex items-center gap-1 justify-center"
                        :class="tabColor('shop')" @click="setActiveTab('shop', 0)">
                        <AppIcon name="store" class="h-4 w-4" /> 票券商店
                    </button>
                    <button class="relative px-4 py-3 sm:px-6 sm:py-4 font-semibold transition-all duration-300 text-base sm:text-lg whitespace-nowrap flex items-center gap-1 justify-center"
                        :class="tabColor('events')" @click="setActiveTab('events', 1)">
                        <AppIcon name="ticket" class="h-4 w-4" /> 場次預約
                    </button>
                </div>
            </div>

            <!-- 🛒 商店 -->
            <section v-if="activeTab === 'shop'" class="slide-in">
                <div v-if="loadingProducts" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div v-for="i in 6" :key="'pskel-'+i" class="ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm overflow-hidden skeleton" style="height: 320px;"></div>
                </div>
                <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div v-for="(product, index) in products" :key="product.id ?? index"
                        class="ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm hover:shadow-lg transition overflow-hidden">
                        <div class="relative w-full overflow-hidden" style="aspect-ratio: 3/2;">
                            <img :src="productCoverUrl(product)" @error="(e)=>e.target.src='/logo.png'" alt="cover" class="absolute inset-0 w-full h-full object-cover" />
                            <div class="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-red-700/10 pointer-events-none"></div>
                        </div>
                        <div class="p-4 sm:p-5">
                            <h2 class="text-lg font-semibold text-primary">{{ product.name }}</h2>
                            <p class="text-sm text-gray-600">{{ product.description }}</p>
                            <p class="text-sm text-gray-700 font-medium">NT$ {{ product.price }}</p>

                            <div class="flex items-center mt-2 gap-2">
                                <button @click="decreaseQuantity(index)" class="btn btn-outline btn-sm" title="減少">
                                    <AppIcon name="minus" class="h-4 w-4" />
                                </button>
                                <input aria-label="數量" type="number" inputmode="numeric" pattern="[0-9]*" @wheel.prevent v-model.number="product.quantity" min="1" max="10"
                                    class="w-20 px-2 py-1 border border-gray-300 text-center" />
                                <button @click="increaseQuantity(index)" class="btn btn-outline btn-sm" title="增加">
                                    <AppIcon name="plus" class="h-4 w-4" />
                                </button>
                            </div>

                            <button class="mt-3 w-full py-2 text-white font-medium btn btn-primary flex items-center justify-center gap-2"
                                @click="addToCart(product)">
                                <AppIcon name="cart" class="h-4 w-4" /> 加入購物車
                            </button>
                            <button class="mt-2 w-full py-2 bg-gray-100 text-gray-700 hover:bg-gray-200"
                                @click="viewProductInfo(product)">
                                查看詳細
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 🚴 場次預約 -->
            <section v-if="activeTab === 'events'" class="slide-in">
                <div v-if="loadingEvents" class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div v-for="i in 4" :key="'eskel-'+i" class="ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm overflow-hidden skeleton" style="height: 360px;"></div>
                </div>
                <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div v-for="event in events" :key="event.id"
                        class="ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm hover:shadow-lg transition flex flex-col justify-between">
                        <div class="relative w-full overflow-hidden" style="aspect-ratio: 3/2;">
                            <img :src="event.cover || '/logo.png'" @error="(e)=>e.target.src='/logo.png'" alt="event cover" class="absolute inset-0 w-full h-full object-cover" />
                            <div class="absolute inset-0 bg-gradient-to-tr from-black/35 via-transparent to-red-700/20 pointer-events-none"></div>
                        </div>
                        <div class="p-4 sm:p-6">
                            <h2 class="text-lg font-semibold text-gray-800 mb-2">{{ event.title }}</h2>
                            <p class="text-sm text-gray-600">📅 {{ event.date || formatRange(event.starts_at, event.ends_at) }}</p>
                            <p class="text-sm text-gray-600 mb-4" v-if="event.deadline">🛑 報名截止：{{ event.deadline }}</p>
                            <ul class="list-disc ml-6 text-sm text-gray-700 space-y-1 mb-4" v-if="event.rules?.length">
                                <li v-for="rule in event.rules" :key="rule">{{ rule }}</li>
                            </ul>
                        </div>
                        <div class="flex gap-3 px-4 pb-4 sm:px-6 sm:pb-6 flex-col sm:flex-row">
                            <button @click="goReserve(event.code)" class="flex-1 btn btn-primary text-white py-2 flex items-center justify-center gap-2">
                                <AppIcon name="ticket" class="h-4 w-4" /> 立即預約
                            </button>
                            <button @click="viewEventInfo(event)" class="flex-1 bg-gray-100 text-gray-700 py-2 hover:bg-gray-200">查看詳細</button>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <!-- 購物車抽屜 -->
        <transition name="fade">
            <div v-if="cartOpen" class="fixed inset-0 bg-black/40 z-50" @click.self="cartOpen = false"></div>
        </transition>
        <transition name="slide-x">
            <aside v-if="cartOpen" class="fixed inset-y-0 right-0 w-full max-w-md bg-white h-full p-6 z-50 shadow-2xl pb-safe">
                <header class="flex justify-between items-center mb-4">
                    <h2 class="font-bold text-lg">購物車</h2>
                    <button class="btn-ghost" title="關閉" @click="cartOpen = false"><AppIcon name="x" class="h-5 w-5" /></button>
                </header>

                <div v-if="cartItems.length" class="space-y-4 overflow-auto max-h-[calc(100vh-140px)]">
                    <div v-for="(item, index) in cartItems" :key="index"
                        class="ticket-card bg-white border-2 border-gray-100 p-4 shadow-sm hover:shadow-lg transition flex justify-between items-center">
                        <div>
                            <p class="font-medium">{{ item.name }}</p>
                            <p class="text-sm text-gray-500">NT$ {{ item.price }} x {{ item.quantity }}</p>
                        </div>
                        <div class="flex gap-2">
                            <button @click="changeCartQuantity(index, -1)" class="btn btn-outline btn-sm" title="減少">
                                <AppIcon name="minus" class="h-4 w-4" />
                            </button>
                            <button @click="changeCartQuantity(index, 1)" class="btn btn-outline btn-sm" title="增加">
                                <AppIcon name="plus" class="h-4 w-4" />
                            </button>
                            <button @click="removeFromCart(index)" class="btn btn-outline btn-sm text-red-700" title="移除">
                                <AppIcon name="trash" class="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    <div class="text-right text-lg font-bold">總計：NT$ {{ cartTotalPrice }}</div>
                    <button @click="checkout" class="w-full btn btn-primary text-white py-2"
                        :disabled="checkingOut">
                        {{ checkingOut ? '處理中...' : '結帳' }}
                    </button>
                </div>
                <p v-else class="text-center text-gray-500 mt-10">購物車目前是空的</p>
            </aside>
        </transition>

        <!-- 訂單抽屜 -->
        <transition name="fade">
            <div v-if="ordersOpen" class="fixed inset-0 bg-black/40 z-50" @click.self="ordersOpen = false"></div>
        </transition>
        <transition name="slide-x">
            <aside v-if="ordersOpen"
                class="fixed inset-y-0 right-0 w-full max-w-xl bg-white h-full p-6 z-50 shadow-2xl">
                <header class="flex items-center justify-between mb-4">
                    <h3 class="font-bold text-lg">我的訂單</h3>
                    <div class="flex items-center gap-2">
                        <button class="btn btn-outline btn-sm" @click="fetchOrders" :disabled="ordersLoading"><AppIcon name="refresh" class="h-4 w-4" /> 重新整理</button>
                        <button class="btn-ghost" title="關閉" @click="ordersOpen = false"><AppIcon name="x" class="h-5 w-5" /></button>
                    </div>
                </header>

                <div v-if="ordersLoading" class="text-center text-gray-500">載入中…</div>

                <div v-else-if="ticketOrders.length" class="space-y-4 overflow-auto max-h-[calc(100vh-140px)] pr-1">
                    <div v-for="order in ticketOrders" :key="order.code || order.id"
                        class="ticket-card bg-white border-2 border-gray-100 p-5 shadow-sm hover:shadow-lg transition">
                        <p class="mb-1 flex items-center gap-2">
                            <strong>訂單編號：</strong>
                            <span class="font-mono">{{ order.code || order.id }}</span>
                            <button class="btn-ghost" title="複製訂單編號" @click="copyText(order.code || order.id)"><AppIcon name="copy" class="h-4 w-4" /></button>
                        </p>
                        <p class="mb-1"><strong>票券種類：</strong>{{ order.ticketType }}</p>
                        <p class="mb-1"><strong>數量：</strong>{{ order.quantity }}</p>
                        <p class="mb-1"><strong>總金額：</strong>NT$ {{ order.total }}</p>
                        <p class="mb-2"><strong>建立時間：</strong>{{ order.createdAt }}</p>
                        <p>
                            <strong>狀態：</strong>
                            <span :class="{
                                'text-green-600': order.status === '已完成',
                                'text-yellow-600': order.status === '待匯款',
                                'text-blue-600': order.status === '處理中'
                            }">
                                {{ order.status || '處理中' }}
                            </span>
                        </p>
                    </div>
                </div>

                <p v-else class="text-center text-gray-500 mt-10">尚無訂單紀錄</p>
            </aside>
        </transition>

        <!-- 事件詳情 Bottom Sheet -->
        <transition name="fade"><div v-if="showEventModal" class="fixed inset-0 bg-black/40 z-40" @click="showEventModal=false"></div></transition>
        <transition name="sheet">
            <div v-if="showEventModal" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel">
                <div class="relative p-4 sm:p-6">
                    <button class="btn-ghost absolute top-3 right-3 text-gray-500 hover:text-gray-700" @click="showEventModal=false" title="關閉">✕</button>
                    <h3 class="text-lg sm:text-xl font-bold text-primary mb-2 text-center">{{ modalEvent?.title }}</h3>
                    <p class="text-sm text-gray-600">📅 {{ modalEvent?.date || formatRange(modalEvent?.starts_at, modalEvent?.ends_at) }}</p>
                    <p class="text-sm text-gray-600 mt-1 mb-3" v-if="modalEvent?.deadline">🛑 截止：{{ modalEvent?.deadline }}</p>
                    <ul class="list-disc ml-6 text-sm text-gray-700 space-y-1 mb-4" v-if="modalEvent?.rules?.length">
                        <li v-for="rule in modalEvent.rules" :key="rule">{{ rule }}</li>
                    </ul>
                    <button @click="goReserve(modalEvent.code)" class="w-full btn btn-primary text-white py-2 flex items-center justify-center gap-2">
                        <AppIcon name="ticket" class="h-4 w-4" /> 前往預約
                    </button>
                </div>
            </div>
        </transition>

        <!-- 商品詳情 Bottom Sheet -->
        <transition name="fade"><div v-if="showProductModal" class="fixed inset-0 bg-black/40 z-40" @click.self="showProductModal=false"></div></transition>
        <transition name="sheet">
            <div v-if="showProductModal" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel">
                <div class="relative p-4 sm:p-6">
                    <button class="btn-ghost absolute top-3 right-3 text-gray-500 hover:text-gray-700" @click="showProductModal=false" title="關閉"><AppIcon name="x" class="h-5 w-5" /></button>
                    <div class="relative w-full mb-3 overflow-hidden" style="aspect-ratio: 3/2;">
                        <img :src="modalProduct ? productCoverUrl(modalProduct) : '/logo.png'" @error="(e)=>e.target.src='/logo.png'" alt="cover" class="absolute inset-0 w-full h-full object-cover" />
                        <div class="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-red-700/10 pointer-events-none"></div>
                    </div>
                    <h3 class="text-lg font-bold text-primary mb-1">{{ modalProduct?.name }}</h3>
                    <p class="text-sm text-gray-600 mb-1">{{ modalProduct?.description }}</p>
                    <p class="text-sm text-gray-700 font-medium mb-3">NT$ {{ modalProduct?.price }}</p>
                    <div class="flex items-center gap-2 mb-4">
                        <button @click="modalQuantity = Math.max(1, modalQuantity-1)" class="btn btn-outline btn-sm" title="減少"><AppIcon name="minus" class="h-4 w-4" /></button>
                        <input aria-label="數量" type="number" inputmode="numeric" pattern="[0-9]*" @wheel.prevent v-model.number="modalQuantity" min="1" max="10" class="w-20 px-2 py-1 border text-center" />
                        <button @click="modalQuantity = Math.min(10, modalQuantity+1)" class="btn btn-outline btn-sm" title="增加"><AppIcon name="plus" class="h-4 w-4" /></button>
                    </div>
                    <button class="w-full btn btn-primary text-white py-2 flex items-center justify-center gap-2" @click="confirmAddFromModal">
                        <AppIcon name="cart" class="h-4 w-4" /> 加入購物車
                    </button>
                </div>
            </div>
        </transition>
    </main>
</template>

<script setup>
    import { ref, computed, onMounted } from 'vue'
    import { useRouter, useRoute } from 'vue-router'
    import axios from '../api/axios'
    import AppIcon from '../components/AppIcon.vue'

    const router = useRouter()
    const route = useRoute()
    const API = 'https://api.xiaozhi.moe/uat/leader_online'
    axios.defaults.withCredentials = true

    // Tabs
    const activeTab = ref('shop')
    const activeTabIndex = ref(0)
    const tabCount = computed(() => 2)
    const indicatorStyle = computed(() => ({ left: `${activeTabIndex.value * (100 / tabCount.value)}%`, width: `${100 / tabCount.value}%` }))
    const tabColor = (key) => activeTab.value === key ? 'text-primary' : 'text-gray-500 hover:text-secondary'
    const setActiveTab = (key, idx) => { activeTab.value = key; activeTabIndex.value = idx }

    // 抽屜 / 狀態
    const cartOpen = ref(false)
    const ordersOpen = ref(false)
    const ordersLoading = ref(false)
    const checkingOut = ref(false)
    const sessionReady = ref(false)

    // 商店
    const products = ref([])
    const loadingProducts = ref(true)
    const increaseQuantity = (i) => { if (products.value[i].quantity < 10) products.value[i].quantity++ }
    const decreaseQuantity = (i) => { if (products.value[i].quantity > 1) products.value[i].quantity-- }

    // 購物車
    const cartItems = ref([])
    const addToCart = (p) => {
        const ex = cartItems.value.find(i => i.id === p.id) || cartItems.value.find(i => i.name === p.name)
        if (ex) ex.quantity += p.quantity
        else cartItems.value.push({ id: p.id, name: p.name, price: p.price, quantity: p.quantity })
        alert(`已加入 ${p.name}`)
    }
    // 商品詳情 Modal
    const showProductModal = ref(false)
    const modalProduct = ref(null)
    const modalQuantity = ref(1)
    const viewProductInfo = (product) => { modalProduct.value = product; modalQuantity.value = Number(product?.quantity || 1); showProductModal.value = true }
    const confirmAddFromModal = () => {
        if (!modalProduct.value) return
        const p = { ...modalProduct.value, quantity: Math.max(1, Math.min(10, Number(modalQuantity.value) || 1)) }
        addToCart(p)
        showProductModal.value = false
    }
    const changeCartQuantity = (idx, d) => {
        cartItems.value[idx].quantity += d
        if (cartItems.value[idx].quantity <= 0) removeFromCart(idx)
    }
    const removeFromCart = (idx) => cartItems.value.splice(idx, 1)
    const cartTotalPrice = computed(() => cartItems.value.reduce((s, i) => s + i.price * i.quantity, 0))

    // 訂單
    const ticketOrders = ref([])
    const openOrders = async () => {
        await checkSession()
        if (!sessionReady.value) { alert('請先登入查看訂單'); router.push('/login'); return }
        ordersOpen.value = true
        await fetchOrders()
    }
    const fetchOrders = async () => {
        ordersLoading.value = true
        try {
            const { data } = await axios.get(`${API}/orders/me`)
            if (data?.ok && Array.isArray(data.data)) {
                ticketOrders.value = data.data.map(o => {
                    let details = {}
                    try { details = typeof o.details === 'string' ? JSON.parse(o.details) : (o.details || {}) } catch { }
                    return {
                        id: o.id,
                        code: o.code || '',
                        ticketType: details.ticketType || details?.event?.name || '',
                        quantity: details.quantity || 0,
                        total: details.total || 0,
                        createdAt: o.created_at || o.createdAt || '',
                        status: details.status || ''
                    }
                })
            } else {
                ticketOrders.value = []
            }
        } catch (e) {
            if (e?.response?.status === 401) sessionReady.value = false
            else alert(e?.response?.data?.message || e.message)
        } finally {
            ordersLoading.value = false
        }
    }

    // 結帳（商店購物車）
    const checkout = async () => {
        if (!cartItems.value.length) { alert('購物車是空的'); return }
        if (!sessionReady.value) { alert('請先登入再結帳'); router.push('/login'); return }
        checkingOut.value = true
        try {
            const payload = {
                items: cartItems.value.map(i => ({
                    ticketType: i.name,
                    quantity: i.quantity,
                    total: i.price * i.quantity,
                    status: '待匯款'
                }))
            }
            const { data } = await axios.post(`${API}/orders`, payload)
            if (data?.ok) {
                alert(`✅ 已生成 ${payload.items.length} 筆訂單`)
                cartItems.value = []
                cartOpen.value = false
                await fetchOrders()
                ordersOpen.value = true
            } else {
                alert(data?.message || '結帳失敗')
            }
        } catch (e) {
            if (e?.response?.status === 401) {
                sessionReady.value = false
                alert('請先登入')
                router.push('/login')
            } else {
                alert(e?.response?.data?.message || e.message)
            }
        } finally {
            checkingOut.value = false
        }
    }

    // 場次
    const events = ref([])
    const loadingEvents = ref(true)
    const showEventModal = ref(false)
    const modalEvent = ref(null)
    const viewEventInfo = (event) => { modalEvent.value = event; showEventModal.value = true }
    // 導頁採用 path 形式，使用活動代碼定位
    const goReserve = (eventCode) => router.push(`/booking/${eventCode}`)

    // 共用
    const formatDate = (input) => {
        if (!input) return ''
        const d = new Date(input)
        if (Number.isNaN(d.getTime())) return input
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    }
    const formatRange = (a, b) => {
        const A = formatDate(a), B = formatDate(b)
        return A && B ? `${A} ~ ${B}` : (A || B || '')
    }

    const checkSession = async () => {
        try { const { data } = await axios.get(`${API}/whoami`); sessionReady.value = !!data?.ok }
        catch { sessionReady.value = false }
    }

    function safeParseArray(s) {
        try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
    }

    const fetchProducts = async () => {
        try{
            const { data } = await axios.get(`${API}/products`)
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            products.value = list.map(p => ({ ...p, quantity: 1 }))
        } finally { loadingProducts.value = false }
    }
    const productCoverUrl = (p) => `${API}/tickets/cover/${encodeURIComponent(p?.name || '')}`

    // ✅ 同時支援 e.date 與 e.starts_at/ends_at
    const fetchEvents = async () => {
        try{
            const { data } = await axios.get(`${API}/events`)
            const raw = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            events.value = raw.map(e => {
                const rules = Array.isArray(e.rules)
                    ? e.rules
                    : (typeof e.rules === 'string' && e.rules.trim() ? safeParseArray(e.rules) : [])
                const name = e.name || e.title || ''
                return {
                    id: e.id,
                    code: e.code || '',
                    title: name,
                    name,
                    date: e.date || '',
                    deadline: e.deadline || e.ends_at || '',
                    starts_at: e.starts_at || e.start_at || null,
                    ends_at: e.ends_at || e.end_at || null,
                    description: e.description || '',
                    cover: e.cover || e.banner || e.image || `${API}/events/${e.id}/cover`,
                    rules
                }
            })
        } finally { loadingEvents.value = false }
    }

    onMounted(async () => {
        await Promise.all([fetchProducts(), fetchEvents()])
        await checkSession()
        if (route.query.tab === 'events') setActiveTab('events', 1)
    })
</script>

<style scoped>
.tab-indicator{position:absolute;bottom:0;height:3px;background:linear-gradient(90deg,var(--color-primary),var(--color-secondary));transition:all .3s ease}
.ticket-card:hover{transform:translateY(-4px);border-color:var(--color-primary);box-shadow:0 20px 25px -5px rgba(217,0,0,.1),0 10px 10px -5px rgba(217,0,0,.04)}
</style>
<style scoped>
    .ticket-card:hover {
        transform: translateY(-4px);
        border-color: var(--color-primary);
        box-shadow: 0 20px 25px -5px rgba(217, 0, 0, 0.1), 0 10px 10px -5px rgba(217, 0, 0, 0.04);
    }

    .tab-indicator {
        position: absolute;
        bottom: 0;
        height: 3px;
        background: linear-gradient(90deg, var(--color-primary), var(--color-secondary));
        transition: all 0.3s ease;
    }

    .fade-enter-active,
    .fade-leave-active {
        transition: opacity .25s;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }

    /* Bottom sheet transitions */
    .sheet-enter-active, .sheet-leave-active { transition: transform .25s ease; }
    .sheet-enter-from, .sheet-leave-to { transform: translateY(100%); }

    .slide-x-enter-active,
    .slide-x-leave-active {
        transition: transform .3s ease, opacity .3s ease;
    }

    .slide-x-enter-from,
    .slide-x-leave-to {
        transform: translateX(100%);
        opacity: .6;
    }

    .slide-in {
        animation: slideIn .5s ease-out;
    }

    @keyframes slideIn {
        from {
            transform: translateY(20px);
            opacity: 0;
        }

        to {
            transform: translateY(0);
            opacity: 1;
        }
    }

    button,
    input,
    .ticket-card,
    .tab-indicator,
    .modal {
        border-radius: 0 !important;
    }
</style>
