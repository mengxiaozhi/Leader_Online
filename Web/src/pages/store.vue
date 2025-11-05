<template>
    <main class="pt-6 pb-12 px-4" v-hammer="mainSwipeBinding">
        <div class="max-w-6xl mx-auto">
            <!-- Header -->
            <header class="bg-white shadow-sm border-b border-gray-100 mb-8 p-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 class="text-2xl font-bold text-gray-900">鐵人三項一站式服務登記</h1>
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

            <!-- Action Center -->
            <section v-if="actionCenterCards.length" class="mb-8">
                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    <div v-for="card in actionCenterCards" :key="card.key"
                        class="border border-gray-200 bg-white shadow-sm px-4 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div class="space-y-1">
                            <p class="text-sm font-semibold text-gray-800">{{ card.title }}</p>
                            <p class="text-xs text-gray-500 leading-relaxed" v-if="card.subtitle">{{ card.subtitle }}</p>
                        </div>
                        <button v-if="card.actionLabel" class="btn btn-outline btn-sm self-start sm:self-auto whitespace-nowrap"
                            @click="handleActionCenterAction(card)">
                            {{ card.actionLabel }}
                        </button>
                    </div>
                </div>
            </section>

            <!-- Tabs -->
            <div class="relative mb-6 sticky top-0 z-20 bg-white">
                <div class="flex justify-center border-b border-gray-200 relative">
                    <div class="tab-indicator" :style="indicatorStyle"></div>

                    <button class="relative flex-1 px-2 py-3 sm:px-6 sm:py-4 font-semibold transition-all duration-300 text-sm sm:text-lg whitespace-nowrap flex items-center gap-1 justify-center"
                        :class="tabColor('shop')" @click="setActiveTab('shop', 0)">
                        <AppIcon name="store" class="h-4 w-4" /> 票券商店
                    </button>
                    <button class="relative flex-1 px-2 py-3 sm:px-6 sm:py-4 font-semibold transition-all duration-300 text-sm sm:text-lg whitespace-nowrap flex items-center gap-1 justify-center"
                        :class="tabColor('events')" @click="setActiveTab('events', 1)">
                        <AppIcon name="ticket" class="h-4 w-4" /> 場次預約
                    </button>
                </div>
            </div>

            <!-- 🛒 商店 -->
            <section v-if="activeTab === 'shop'" class="slide-in" ref="productsSectionRef">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <div class="relative w-full sm:w-72">
                        <AppIcon name="search"
                            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input v-model.trim="productSearch"
                            class="w-full pl-10 pr-10 py-2 border border-gray-200 focus:border-primary focus:ring-0 text-sm text-gray-700 placeholder-gray-400"
                            placeholder="搜尋票券（名稱或描述）" />
                        <button v-if="productSearch"
                            class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                            @click="clearProductSearch">
                            清除
                        </button>
                    </div>
                    <!--<button class="btn btn-outline btn-sm self-start sm:self-auto" @click="cartOpen = true">
                        <AppIcon name="cart" class="h-4 w-4" /> 查看購物車
                    </button>
                    -->
                </div>
                <div v-if="loadingProducts" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div v-for="i in 6" :key="'pskel-'+i" class="ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm overflow-hidden animate-pulse" style="height: 320px;">
                        <div class="w-full h-40 bg-gray-200"></div>
                        <div class="p-4 space-y-3">
                            <div class="h-4 bg-gray-200 rounded w-2/3"></div>
                            <div class="h-3 bg-gray-200 rounded w-full"></div>
                            <div class="h-3 bg-gray-200 rounded w-5/6"></div>
                            <div class="h-10 bg-gray-200 rounded"></div>
                        </div>
                    </div>
                </div>
                <div v-else-if="!filteredProducts.length" class="ticket-card bg-white border-2 border-gray-100 shadow-sm p-5 text-sm text-gray-500">
                    {{ productSearch ? '沒有符合搜尋條件的票券。' : '目前尚無可販售票券，請稍後再試。' }}
                </div>
                <template v-else>
                    <TransitionGroup name="grid-stagger" tag="div" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div v-for="(product, index) in displayedProducts" :key="product.id ?? `${product.name}-${index}`"
                            class="ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm hover:shadow-lg transition overflow-hidden">
                            <div class="relative w-full overflow-hidden" style="aspect-ratio: 3/2;">
                                <img :src="productCoverUrl(product)"
                                     loading="lazy" decoding="async"
                                     sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw"
                                     @error="(e)=>e.target.src='/logo.png'" alt="cover"
                                     class="absolute inset-0 w-full h-full object-cover" />
                                <div class="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-red-700/10 pointer-events-none"></div>
                            </div>
                            <div class="p-4 sm:p-5">
                                <h2 class="text-lg font-semibold text-primary">{{ product.name }}</h2>
                                <p class="text-sm text-gray-600">{{ product.description }}</p>
                                <p class="text-sm text-gray-700 font-medium">NT$ {{ product.price }}</p>

                                <QuantityStepper class="mt-2" v-model="product.quantity" :min="1" :max="10" />

                                <button class="mt-3 w-full py-2 text-white font-medium btn btn-primary flex items-center justify-center gap-2"
                                    @click="addToCart(product)">
                                    <AppIcon name="cart" class="h-4 w-4" /> 加入購物車
                                </button>
                            </div>
                        </div>
                    </TransitionGroup>

                    <div v-if="shouldPaginateProducts" class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-6">
                        <div class="flex items-center gap-2 flex-wrap">
                            <button class="btn btn-outline btn-sm" :disabled="activeProductPage <= 1" @click="goPrevProductPage">
                                上一頁
                            </button>
                            <div class="flex items-center gap-1">
                                <button
                                    v-for="page in totalProductPages"
                                    :key="`product-page-${page}`"
                                    class="px-3 py-1 text-sm border rounded transition"
                                    :class="page === activeProductPage ? 'bg-primary text-white border-primary' : 'bg-white hover:border-primary hover:text-primary'"
                                    @click="goToProductPage(page)"
                                >
                                    {{ page }}
                                </button>
                            </div>
                            <button class="btn btn-outline btn-sm" :disabled="activeProductPage >= totalProductPages" @click="goNextProductPage">
                                下一頁
                            </button>
                        </div>
                    </div>
                </template>
            </section>

            <!-- 🚴 場次預約 -->
            <section v-if="activeTab === 'events'" class="slide-in" ref="eventsSectionRef">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <div class="relative w-full sm:w-72">
                        <AppIcon name="search"
                            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input v-model.trim="eventSearch"
                            class="w-full pl-10 pr-10 py-2 border border-gray-200 focus:border-primary focus:ring-0 text-sm text-gray-700 placeholder-gray-400"
                            placeholder="搜尋活動（名稱、地點或代碼）" />
                        <button v-if="eventSearch"
                            class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                            @click="clearEventSearch">
                            清除
                        </button>
                    </div>
                    <button class="btn btn-outline btn-sm self-start sm:self-auto" @click="goWalletReservations">
                        <AppIcon name="orders" class="h-4 w-4" /> 查看預約
                    </button>
                </div>
                <div v-if="loadingEvents" class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div v-for="i in 4" :key="'eskel-'+i" class="ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm overflow-hidden animate-pulse" style="height: 340px;">
                        <div class="w-full h-40 bg-gray-200"></div>
                        <div class="p-5 space-y-3">
                            <div class="h-3 bg-gray-200 rounded w-24"></div>
                            <div class="h-5 bg-gray-200 rounded w-3/4"></div>
                            <div class="h-3 bg-gray-200 rounded w-1/2"></div>
                            <div class="h-3 bg-gray-200 rounded w-full"></div>
                        </div>
                    </div>
                </div>
                <div v-else-if="!filteredEvents.length" class="ticket-card bg-white border-2 border-gray-100 shadow-sm p-5 text-sm text-gray-500">
                    {{ eventSearch ? '沒有符合搜尋條件的活動。' : '目前沒有可預約的活動，歡迎稍後再查看。' }}
                </div>
                <template v-else>
                    <TransitionGroup name="grid-stagger" tag="div" class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <article v-for="(event, index) in displayedEvents" :key="event.id ?? `${event.code}-${index}`"
                            class="ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm hover:shadow-lg transition overflow-hidden">
                            <div class="relative w-full overflow-hidden" style="aspect-ratio: 3/2;">
                                <img :src="event.cover || '/logo.png'"
                                    loading="lazy" decoding="async"
                                    sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw"
                                    @error="(e)=>e.target.src='/logo.png'" alt="cover"
                                    class="absolute inset-0 w-full h-full object-cover" />
                                <div class="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-red-700/10 pointer-events-none"></div>
                            </div>
                            <div class="p-5 space-y-3">
                                <header>
                                    <p class="text-xs uppercase tracking-[0.35em] text-primary/70 mb-1">EVENT {{ event.code || event.id }}</p>
                                    <h2 class="text-xl font-semibold text-primary flex items-center gap-2">
                                        {{ event.title }}
                                    </h2>
                                    <p class="text-sm text-gray-600">
                                        📅 {{ event.date || formatRange(event.starts_at, event.ends_at) }}
                                    </p>
                                </header>
                                <p class="text-sm text-gray-600 leading-relaxed">
                                    {{ event.description }}
                                </p>
                                <ul v-if="event.rules.length" class="text-xs text-gray-500 space-y-1">
                                    <li v-for="rule in event.rules" :key="rule">・ {{ rule }}</li>
                                </ul>
                                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                    <div class="text-xs text-gray-500 bg-gray-100 px-3 py-1 inline-flex items-center gap-1">
                                        截止：{{ event.deadline || '未設定' }}
                                    </div>
                                    <button class="btn btn-primary text-white flex-1 sm:flex-none" @click="goReserve(event.code)">
                                        <AppIcon name="ticket" class="h-4 w-4" /> 立即預約
                                    </button>
                                </div>
                            </div>
                        </article>
                    </TransitionGroup>

                    <div v-if="shouldPaginateEvents" class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-6">
                        <div class="flex items-center gap-2 flex-wrap">
                            <button class="btn btn-outline btn-sm" :disabled="activeEventPage <= 1" @click="goPrevEventPage">
                                上一頁
                            </button>
                            <div class="flex items-center gap-1">
                                <button
                                    v-for="page in totalEventPages"
                                    :key="`event-page-${page}`"
                                    class="px-3 py-1 text-sm border rounded transition"
                                    :class="page === activeEventPage ? 'bg-primary text-white border-primary' : 'bg-white hover:border-primary hover:text-primary'"
                                    @click="goToEventPage(page)"
                                >
                                    {{ page }}
                                </button>
                            </div>
                            <button class="btn btn-outline btn-sm" :disabled="activeEventPage >= totalEventPages" @click="goNextEventPage">
                                下一頁
                            </button>
                        </div>
                    </div>
                </template>
            </section>
        </div>

        <!-- 購物車抽屜 -->
        <transition name="backdrop-fade">
            <div v-if="cartOpen" class="fixed inset-0 bg-black/40 z-50" @click.self="cartOpen = false" v-hammer="cartSwipeBinding"></div>
        </transition>
        <transition name="drawer-right">
            <aside v-if="cartOpen" v-hammer="cartSwipeBinding"
                class="fixed inset-y-0 right-0 w-full max-w-md bg-white h-full p-6 z-50 shadow-2xl pb-safe">
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
                        <div class="flex items-center gap-2">
                            <QuantityStepper v-model="cartItems[index].quantity" :min="1" :max="99" :show-input="false" />
                            <button @click="removeFromCart(index)" class="btn btn-outline btn-sm text-red-700" title="移除"><AppIcon name="trash" class="h-4 w-4" /></button>
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
        <transition name="backdrop-fade">
            <div v-if="ordersOpen" class="fixed inset-0 bg-black/40 z-50" @click.self="ordersOpen = false" v-hammer="ordersSwipeBinding"></div>
        </transition>
        <transition name="drawer-right">
            <aside v-if="ordersOpen" v-hammer="ordersSwipeBinding"
                class="fixed inset-y-0 right-0 w-full max-w-xl bg-white h-full p-6 z-50 shadow-2xl pb-safe">
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
                        <template v-if="order.isReservation">
                            <p class="mb-1"><strong>場次：</strong>{{ order.eventName || '-' }}</p>
                            <p class="mb-2" v-if="order.eventDate"><strong>時間：</strong>{{ order.eventDate }}</p>
                            <div class="border border-gray-200 divide-y mb-2">
                                <div v-for="line in order.selections" :key="line.key" class="px-3 py-2 text-sm text-gray-600">
                                    <div class="font-semibold text-gray-700">{{ line.store || '—' }}｜{{ line.type || '—' }}</div>
                                    <div>單價：{{ line.byTicket ? '票券抵扣' : formatCurrency(line.unitPrice) }}</div>
                                    <div>數量：{{ line.qty }}</div>
                                    <div>優惠折扣：
                                        <span v-if="line.byTicket">票券抵扣</span>
                                        <span v-else-if="line.discount > 0">-{{ formatCurrency(line.discount) }}</span>
                                        <span v-else>—</span>
                                    </div>
                                    <div>小計：{{ formatCurrency(line.subtotal) }}</div>
                                </div>
                            </div>
                            <div class="text-sm text-gray-700 space-y-1 mb-2">
                                <div>總件數：{{ order.quantity }}</div>
                                <div v-if="order.subtotal !== undefined"><strong>小計：</strong>{{ formatCurrency(order.subtotal) }}</div>
                                <div v-if="order.discountTotal > 0"><strong>優惠折扣：</strong>-{{ formatCurrency(order.discountTotal) }}</div>
                                <div v-if="order.addOnCost > 0"><strong>加購費用：</strong>{{ formatCurrency(order.addOnCost) }}</div>
                                <div><strong>總金額：</strong>{{ formatCurrency(order.total) }}</div>
                            </div>
                        </template>
                        <template v-else>
                            <p class="mb-1"><strong>票券種類：</strong>{{ order.ticketType }}</p>
                            <p class="mb-1"><strong>數量：</strong>{{ order.quantity }}</p>
                            <p class="mb-1"><strong>總金額：</strong>{{ formatCurrency(order.total) }}</p>
                        </template>
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
                        <div v-if="order.hasRemittance" class="mt-3 border border-primary/40 bg-red-50/80 px-3 py-3 text-sm text-gray-700 space-y-1">
                            <div class="font-semibold text-primary">匯款資訊</div>
                            <p v-if="order.remittance.bankName">銀行名稱：{{ order.remittance.bankName }}</p>
                            <p v-if="order.remittance.info">{{ order.remittance.info }}</p>
                            <p v-if="order.remittance.bankCode">銀行代碼：{{ order.remittance.bankCode }}</p>
                            <p v-if="order.remittance.bankAccount" class="flex items-center gap-2">
                                <span>銀行帳戶：{{ order.remittance.bankAccount }}</span>
                                <button class="btn-ghost" title="複製帳號" @click="copyText(order.remittance.bankAccount)"><AppIcon name="copy" class="h-4 w-4" /></button>
                            </p>
                            <p v-if="order.remittance.accountName">帳戶名稱：{{ order.remittance.accountName }}</p>
                        </div>
                    </div>
                </div>

                <p v-else class="text-center text-gray-500 mt-10">尚無訂單紀錄</p>
            </aside>
        </transition>

    </main>
</template>

<script setup>
    import { ref, computed, onMounted, watch, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
    import { useRouter, useRoute } from 'vue-router'
    import axios from '../api/axios'
    import AppIcon from '../components/AppIcon.vue'
    import { showNotice } from '../utils/sheet'
    import { setPageMeta } from '../utils/meta'
    import { formatDateTime, formatDateTimeRange } from '../utils/datetime'
    import { useSwipeRegistry } from '../composables/useSwipeRegistry'
    import { useIsMobile } from '../composables/useIsMobile'

    const router = useRouter()
    const route = useRoute()
    const API = 'https://api.xiaozhi.moe/uat/leader_online'
    axios.defaults.withCredentials = true

    const toNumber = (value) => {
        const n = Number(value)
        return Number.isFinite(n) ? n : 0
    }
    const formatCurrency = (value) => `NT$ ${toNumber(value).toLocaleString('zh-TW')}`
    const copyText = (value) => {
        try { if (value) navigator.clipboard?.writeText(String(value)) } catch {}
    }

    // Tabs
    const tabs = ['shop', 'events']
    const activeTab = ref('shop')
    const activeTabIndex = ref(0)
    const findTabIndex = (key) => tabs.findIndex(tab => tab === key)
    const tabCount = computed(() => tabs.length)
    const indicatorStyle = computed(() => ({ left: `${activeTabIndex.value * (100 / tabCount.value)}%`, width: `${100 / tabCount.value}%` }))
    const tabColor = (key) => activeTab.value === key ? 'text-primary' : 'text-gray-500 hover:text-secondary'
    const updateRouteTabQuery = (key) => {
        const current = typeof route.query.tab === 'string' ? route.query.tab : ''
        if (current === key) return
        router.replace({
            query: { ...route.query, tab: key }
        }).catch(() => {})
    }
    const setActiveTab = (key, index, options = {}) => {
        const { skipRouteSync = false, force = false } = options
        const resolvedIndex = typeof index === 'number' && index >= 0 ? index : findTabIndex(key)
        if (resolvedIndex === -1) return
        if (!force && activeTab.value === key && activeTabIndex.value === resolvedIndex) {
            if (!skipRouteSync) updateRouteTabQuery(key)
            return
        }
        activeTab.value = key
        activeTabIndex.value = resolvedIndex
        if (!skipRouteSync) updateRouteTabQuery(key)
    }
    watch(() => route.query.tab, (value) => {
        const target = typeof value === 'string' ? value : ''
        const idx = findTabIndex(target)
        if (idx === -1) return
        if (activeTab.value !== target) {
            setActiveTab(target, idx, { skipRouteSync: true })
        }
    })
    const { isMobile } = useIsMobile(768)

    // 抽屜 / 狀態
    const cartOpen = ref(false)
    const ordersOpen = ref(false)
    const ordersLoading = ref(false)
    const checkingOut = ref(false)
    const sessionReady = ref(false)
    const sessionProfile = ref(null)

    const { registerSwipeHandlers, getBinding } = useSwipeRegistry()
    const mainSwipeBinding = getBinding('store-main')
    const cartSwipeBinding = getBinding('store-cart')
    const ordersSwipeBinding = getBinding('store-orders')

    const canUseSwipeNavigation = computed(() => isMobile.value && !cartOpen.value && !ordersOpen.value)
    const goToTabByOffset = (offset) => {
        if (!canUseSwipeNavigation.value) return
        const targetIndex = activeTabIndex.value + offset
        if (targetIndex < 0 || targetIndex >= tabs.length) return
        setActiveTab(tabs[targetIndex], targetIndex)
    }
    const handleSwipeLeft = () => goToTabByOffset(1)
    const handleSwipeRight = () => goToTabByOffset(-1)
    const handleSwipeCloseCart = () => {
        if (!isMobile.value) return
        cartOpen.value = false
    }
    const handleSwipeCloseOrders = () => {
        if (!isMobile.value) return
        ordersOpen.value = false
    }

    registerSwipeHandlers('store-tabs', computed(() => {
        if (!canUseSwipeNavigation.value) return null
        return {
            events: {
                swipeleft: handleSwipeLeft,
                swiperight: handleSwipeRight
            },
            touchAction: 'pan-y'
        }
    }), { target: 'store-main' })

    registerSwipeHandlers('store-cart', computed(() => {
        if (!isMobile.value || !cartOpen.value) return null
        return {
            priority: 20,
            events: {
                swiperight: handleSwipeCloseCart
            },
            touchAction: 'pan-y'
        }
    }), { target: 'store-cart' })

    registerSwipeHandlers('store-orders', computed(() => {
        if (!isMobile.value || !ordersOpen.value) return null
        return {
            priority: 18,
            events: {
                swiperight: handleSwipeCloseOrders
            },
            touchAction: 'pan-y'
        }
    }), { target: 'store-orders' })

    // 商店
    const products = ref([])
    const loadingProducts = ref(true)
    const productsSectionRef = ref(null)
    const PRODUCTS_PAGE_SIZE = 10
    const activeProductPage = ref(1)
    const productSearch = ref('')
    const filteredProducts = computed(() => {
        const keyword = productSearch.value.trim().toLowerCase()
        if (!keyword) return products.value
        return products.value.filter(product => {
            const fields = [
                product.name,
                product.description,
                product.code,
                product.category,
                product?.title
            ]
            return fields.some(field => String(field || '').toLowerCase().includes(keyword))
        })
    })
    const clearProductSearch = () => { productSearch.value = '' }
    // 數量控制改由 QuantityStepper 組件處理

    // 購物車
    const cartItems = ref([])
    const cartSyncDelay = 400
    let cartSyncTimer = null
    let lastSyncedSnapshot = '[]'
    let applyingRemoteCart = false
    let cartLoading = false

    const clampQuantity = (value) => {
        const n = Math.floor(Number(value) || 0)
        return Math.max(1, Math.min(99, n))
    }
    const sanitizeCartItem = (raw) => {
        if (!raw) return null
        const name = String(raw.name || raw.title || '').trim()
        if (!name) return null
        const quantity = clampQuantity(raw.quantity ?? 1)
        const priceNum = Number(raw.price)
        const price = Number.isFinite(priceNum) ? Math.max(0, Math.round(priceNum * 100) / 100) : 0
        const item = { name, price, quantity }
        if (raw.id !== undefined && raw.id !== null) item.id = raw.id
        if (raw.cover) item.cover = String(raw.cover)
        if (raw.sku) item.sku = String(raw.sku)
        return item
    }
    const buildCartPayload = () => cartItems.value
        .map(item => sanitizeCartItem(item))
        .filter(Boolean)
    const syncCartNow = async () => {
        if (cartSyncTimer) {
            clearTimeout(cartSyncTimer)
            cartSyncTimer = null
        }
        if (!sessionReady.value) return
        const payload = buildCartPayload()
        const snapshot = JSON.stringify(payload)
        if (snapshot === lastSyncedSnapshot) return
        try {
            await axios.put(`${API}/cart`, { items: payload })
            lastSyncedSnapshot = snapshot
        } catch (e) {
            if (e?.response?.status === 401) { sessionReady.value = false; sessionProfile.value = null }
        }
    }
    const scheduleCartSync = () => {
        if (!sessionReady.value || applyingRemoteCart) return
        if (cartSyncTimer) clearTimeout(cartSyncTimer)
        cartSyncTimer = setTimeout(syncCartNow, cartSyncDelay)
    }
    const loadCart = async () => {
        if (!sessionReady.value || cartLoading) return
        cartLoading = true
        try {
            const localSnapshot = buildCartPayload()
            const localJson = JSON.stringify(localSnapshot)
            const hasUnsyncedLocal = localJson !== lastSyncedSnapshot
            const { data } = await axios.get(`${API}/cart`)
            const remoteRaw = Array.isArray(data?.data?.items) ? data.data.items : (Array.isArray(data?.items) ? data.items : [])
            const remoteSanitized = remoteRaw.map(item => sanitizeCartItem(item)).filter(Boolean)
            const merged = remoteSanitized.map(item => ({ ...item }))
            let changed = false
            if (hasUnsyncedLocal) {
                for (const local of localSnapshot) {
                    const target = merged.find(item => (local.id != null && item.id === local.id) || item.name === local.name)
                    if (target) {
                        const newQty = clampQuantity(target.quantity + local.quantity)
                        if (newQty !== target.quantity) {
                            target.quantity = newQty
                            changed = true
                        }
                        if (local.price && local.price !== target.price) {
                            target.price = local.price
                            changed = true
                        }
                    } else {
                        merged.push({ ...local })
                        changed = true
                    }
                }
            }

            applyingRemoteCart = true
            cartItems.value = merged.map(item => ({ ...item }))

            const snapshot = JSON.stringify(merged)
            if (changed) {
                try {
                    await axios.put(`${API}/cart`, { items: merged })
                    lastSyncedSnapshot = snapshot
                } catch (e) {
                    if (e?.response?.status === 401) { sessionReady.value = false; sessionProfile.value = null }
                }
            } else {
                lastSyncedSnapshot = snapshot
            }
        } catch (e) {
            if (e?.response?.status === 401) { sessionReady.value = false; sessionProfile.value = null }
        } finally {
            applyingRemoteCart = false
            cartLoading = false
        }
    }
    const clearCart = async (syncRemote = false) => {
        applyingRemoteCart = true
        cartItems.value = []
        applyingRemoteCart = false
        lastSyncedSnapshot = '[]'
        if (syncRemote && sessionReady.value) {
            try {
                await axios.delete(`${API}/cart`)
            } catch (e) {
                if (e?.response?.status === 401) { sessionReady.value = false; sessionProfile.value = null }
            }
        }
    }

    const addToCart = async (product) => {
        const sanitized = sanitizeCartItem({ ...product })
        if (!sanitized) {
            await showNotice('無法加入購物車', { title: '錯誤' })
            return
        }
        const existing = cartItems.value.find(item => (sanitized.id != null && item.id === sanitized.id) || item.name === sanitized.name)
        if (existing) {
            existing.quantity = clampQuantity(existing.quantity + sanitized.quantity)
            existing.price = sanitized.price
        } else {
            cartItems.value.push({ ...sanitized })
        }
        if (sessionReady.value) scheduleCartSync()
        await showNotice(`已加入 ${sanitized.name}`)
    }
    const removeFromCart = (idx) => {
        cartItems.value.splice(idx, 1)
        if (sessionReady.value) scheduleCartSync()
    }
    const cartItemCount = computed(() => cartItems.value.reduce((s, item) => s + Number(item.quantity || 0), 0))
    const cartTotalPrice = computed(() => cartItems.value.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0))

    watch(cartItems, () => {
        if (!sessionReady.value || applyingRemoteCart) return
        scheduleCartSync()
    }, { deep: true })

    const updateStoreMeta = () => {
        if (typeof window === 'undefined') return
        const productCount = products.value.length
        const eventCount = events.value.length
        const description = `選購${productCount > 0 ? `${productCount} 款` : '多款'}鐵人競賽票券，雲端購物車同步，並預約${eventCount > 0 ? `${eventCount} 場` : '多場'}賽事。`
        setPageMeta({ title: '鐵人競賽購票中心', description })
    }

    const hasStoredSession = () => {
        try { return !!localStorage.getItem('user_info') } catch { return false }
    }
    const handleAuthChanged = () => {
        if (hasStoredSession()) {
            checkSession()
        } else {
            sessionReady.value = false
            sessionProfile.value = null
            clearCart(false)
        }
    }
    const handleStorage = (event) => {
        if (!event || event.key === 'user_info') handleAuthChanged()
    }

    // 訂單
    const ticketOrders = ref([])
    const pendingOrders = computed(() => ticketOrders.value.filter(order => (order.status || '') !== '已完成'))
    const openOrders = async () => {
        await checkSession()
        if (!sessionReady.value) { await showNotice('請先登入查看訂單', { title: '需要登入' }); router.push('/login'); return }
        ordersOpen.value = true
        await fetchOrders()
    }
    const fetchOrders = async (options = {}) => {
        const { silent = false } = options
        ordersLoading.value = true
        try {
            const { data } = await axios.get(`${API}/orders/me`)
            if (data?.ok && Array.isArray(data.data)) {
                ticketOrders.value = data.data.map(o => {
                    let details = {}
                    try { details = typeof o.details === 'string' ? JSON.parse(o.details) : (o.details || {}) } catch { }
                    const rawSelections = Array.isArray(details.selections) ? details.selections : []
                    const selections = rawSelections.map((sel, idx) => {
                        const qty = toNumber(sel.qty)
                        const unitPrice = toNumber(sel.unitPrice)
                        const subtotal = toNumber(sel.subtotal || unitPrice * qty)
                        const rawDiscount = Number(sel.discount)
                        const discount = Number.isFinite(rawDiscount) ? Math.max(0, rawDiscount) : Math.max(0, (unitPrice * qty) - subtotal)
                        return {
                            key: `${o.id}-${idx}`,
                            store: sel.store || '',
                            type: sel.type || '',
                            qty,
                            unitPrice,
                            subtotal,
                            discount,
                            byTicket: Boolean(sel.byTicket),
                        }
                    })
                    const isReservation = selections.length > 0 || details.kind === 'event-reservation'
                    const subtotal = toNumber(details.subtotal)
                    const addOnCost = toNumber(details.addOnCost)
                    const total = toNumber(details.total)
                    let discountTotal = toNumber(details.discount)
                    if (!discountTotal) {
                        discountTotal = Math.max(0, (subtotal + addOnCost) - total)
                    }
                    const remittanceRaw = {
                        info: details?.remittance?.info || details.bankInfo || '',
                        bankCode: details?.remittance?.bankCode || details.bankCode || '',
                        bankAccount: details?.remittance?.bankAccount || details.bankAccount || '',
                        accountName: details?.remittance?.accountName || details.bankAccountName || '',
                        bankName: details?.remittance?.bankName || details.bankName || ''
                    }
                    const hasRemittance = Object.values(remittanceRaw).some(val => String(val || '').trim())
                    const base = {
                        id: o.id,
                        code: o.code || '',
                        ticketType: details.ticketType || details?.event?.name || '',
                        quantity: toNumber(details.quantity || 0),
                        total,
                        createdAt: formatDateTime(o.created_at || o.createdAt, { fallback: o.created_at || o.createdAt || '' }),
                        status: details.status || '',
                        isReservation,
                        remittance: remittanceRaw,
                        hasRemittance,
                        selections,
                        subtotal,
                        addOnCost,
                        discountTotal,
                        eventName: details?.event?.name || details.ticketType || '',
                        eventDate: details?.event?.date || '',
                    }
                    if (!base.eventName) base.eventName = base.ticketType
                    if (!base.ticketType) base.ticketType = base.eventName
                    return base
                })
            } else {
                ticketOrders.value = []
            }
        } catch (e) {
            if (e?.response?.status === 401) {
                sessionReady.value = false
                sessionProfile.value = null
                ticketOrders.value = []
                ordersOpen.value = false
            } else if (!silent) {
                await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
            }
        } finally {
            ordersLoading.value = false
        }
    }

    watch(sessionReady, (logged) => {
        if (logged) {
            loadCart()
            fetchOrders({ silent: true })
        } else {
            sessionProfile.value = null
            clearCart(false)
            ticketOrders.value = []
            ordersOpen.value = false
        }
    })

    // 結帳（商店購物車）
    const checkout = async () => {
        if (!cartItems.value.length) { await showNotice('購物車是空的'); return }
        checkingOut.value = true
        try {
            const ready = await ensureContactInfoComplete()
            if (!ready) return
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
                await showNotice(`✅ 已生成 ${payload.items.length} 筆訂單`)
                await clearCart(true)
                cartOpen.value = false
                await fetchOrders()
                ordersOpen.value = true
            } else {
                await showNotice(data?.message || '結帳失敗', { title: '結帳失敗' })
            }
        } catch (e) {
            if (e?.response?.status === 401) {
                sessionReady.value = false
                sessionProfile.value = null
                await showNotice('請先登入', { title: '需要登入' })
                router.push('/login')
            } else {
                await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
            }
        } finally {
            checkingOut.value = false
        }
    }

    // 場次
    const events = ref([])
    const loadingEvents = ref(true)
    const eventsSectionRef = ref(null)
    const EVENTS_PAGE_SIZE = 10
    const activeEventPage = ref(1)
    const eventSearch = ref('')
    const filteredEvents = computed(() => {
        const keyword = eventSearch.value.trim().toLowerCase()
        if (!keyword) return events.value
        return events.value.filter(event => {
            const fields = [
                event.title,
                event.name,
                event.code,
                event.location,
                event.description
            ]
            return fields.some(field => String(field || '').toLowerCase().includes(keyword))
        })
    })
    const clearEventSearch = () => { eventSearch.value = '' }
    // 導頁採用 path 形式，使用活動代碼定位
    const goReserve = (eventCode) => router.push(`/booking/${eventCode}`)
    const goWalletReservations = () => router.push({ path: '/wallet', query: { tab: 'reservations' } })

    // 共用
    const formatRange = (a, b) => formatDateTimeRange(a, b)

    const checkSession = async () => {
        try {
            const { data } = await axios.get(`${API}/whoami`)
            if (data?.ok) {
                sessionReady.value = true
                sessionProfile.value = data.data || data || null
            } else {
                sessionReady.value = false
                sessionProfile.value = null
            }
        } catch {
            sessionReady.value = false
            sessionProfile.value = null
        }
        return sessionReady.value
    }

    const ensureContactInfoComplete = async () => {
        if (!sessionReady.value || !sessionProfile.value) {
            const authed = await checkSession()
            if (!authed) {
                await showNotice('請先登入再結帳', { title: '需要登入' })
                router.push('/login')
                return false
            }
        }
        const info = sessionProfile.value || {}
        const phoneDigits = String(info.phone || '').replace(/\D/g, '')
        const last5 = String((info.remittanceLast5 ?? info.remittance_last5) || '').trim()
        if (phoneDigits.length < 8 || !/^\d{5}$/.test(last5)) {
            await showNotice('請先於帳戶中心補齊手機號碼與匯款帳號後五碼，再進行購票或預約', { title: '需要補完資料' })
            router.push({ path: '/account', query: { tab: 'profile' } })
            return false
        }
        return true
    }

    function safeParseArray(s) {
        try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
    }

    const fetchProducts = async () => {
        try{
            const { data } = await axios.get(`${API}/products`)
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            products.value = list.map(p => ({ ...p, quantity: 1 }))
            activeProductPage.value = 1
            updateStoreMeta()
        } finally { loadingProducts.value = false }
    }
    const productCoverUrl = (p) => `${API}/tickets/cover/${encodeURIComponent(p?.name || '')}`

    const productPages = computed(() => {
        const list = filteredProducts.value || []
        if (!Array.isArray(list) || !list.length) return []
        const pages = []
        for (let i = 0; i < list.length; i += PRODUCTS_PAGE_SIZE) {
            pages.push(list.slice(i, i + PRODUCTS_PAGE_SIZE))
        }
        return pages
    })
    const totalProductPages = computed(() => productPages.value.length || 0)
    const shouldPaginateProducts = computed(() => totalProductPages.value > 1)
    watch(productPages, () => {
        if (totalProductPages.value === 0) {
            activeProductPage.value = 1
        } else if (activeProductPage.value > totalProductPages.value) {
            activeProductPage.value = totalProductPages.value
        } else if (activeProductPage.value < 1) {
            activeProductPage.value = 1
        }
    }, { immediate: true })
    const currentProductPageIndex = computed(() => {
        if (!shouldPaginateProducts.value) return 0
        return Math.min(Math.max(activeProductPage.value - 1, 0), totalProductPages.value - 1)
    })
    const displayedProducts = computed(() => {
        if (!shouldPaginateProducts.value) return filteredProducts.value
        return productPages.value[currentProductPageIndex.value] || []
    })
    watch(productSearch, () => {
        activeProductPage.value = 1
    })
    const goToProductPage = (page) => {
        if (!shouldPaginateProducts.value) return
        const target = Math.min(Math.max(1, Number(page) || 1), totalProductPages.value)
        if (target === activeProductPage.value) return
        activeProductPage.value = target
        nextTick(() => {
            const el = productsSectionRef.value
            if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    }
    const goPrevProductPage = () => {
        if (activeProductPage.value > 1) goToProductPage(activeProductPage.value - 1)
    }
    const goNextProductPage = () => {
        if (activeProductPage.value < totalProductPages.value) goToProductPage(activeProductPage.value + 1)
    }

    // ✅ 同時支援 e.date 與 e.starts_at/ends_at
    const fetchEvents = async () => {
        try{
            const { data } = await axios.get(`${API}/events`)
            const raw = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            const nowTs = Date.now()
            const parseTs = (value) => {
                if (!value) return null
                const ts = Date.parse(value)
                return Number.isNaN(ts) ? null : ts
            }
            const active = raw.filter(e => {
                const deadlineTs = parseTs(e.deadline)
                const endsTs = parseTs(e.ends_at || e.end_at)
                const expiryTs = deadlineTs ?? endsTs
                if (expiryTs === null) return true
                return expiryTs >= nowTs
            })
            events.value = active.map(e => {
                const rules = Array.isArray(e.rules)
                    ? e.rules
                    : (typeof e.rules === 'string' && e.rules.trim() ? safeParseArray(e.rules) : [])
                const name = e.name || e.title || ''
                return {
                    id: e.id,
                    code: e.code || '',
                    title: name,
                    name,
                    location: e.location || '',
                    date: e.date || '',
                    deadline: e.deadline || e.ends_at || '',
                    starts_at: e.starts_at || e.start_at || null,
                    ends_at: e.ends_at || e.end_at || null,
                    description: e.description || '',
                    cover: e.cover || e.banner || e.image || `${API}/events/${e.id}/cover`,
                    rules
                }
            })
            updateStoreMeta()
            activeEventPage.value = 1
        } finally { loadingEvents.value = false }
    }

    const nextUpcomingEvent = computed(() => {
        if (!events.value.length) return null
        const now = Date.now()
        const scoreEvent = (event) => {
            const parse = (value) => {
                if (!value) return null
                const ts = Date.parse(value)
                return Number.isNaN(ts) ? null : ts
            }
            const startTs = parse(event.starts_at) || parse(event.date)
            const deadlineTs = parse(event.deadline)
            const primary = startTs ?? deadlineTs ?? Number.MAX_SAFE_INTEGER
            const effective = primary >= now ? primary : (deadlineTs ?? startTs ?? Number.MAX_SAFE_INTEGER)
            return { event, score: effective }
        }
        const scored = events.value.map(scoreEvent).sort((a, b) => a.score - b.score)
        const upcoming = scored.find(item => item.score >= now)
        return (upcoming || scored[0] || {}).event || null
    })

    const eventPages = computed(() => {
        const list = filteredEvents.value || []
        if (!Array.isArray(list) || !list.length) return []
        const pages = []
        for (let i = 0; i < list.length; i += EVENTS_PAGE_SIZE) {
            pages.push(list.slice(i, i + EVENTS_PAGE_SIZE))
        }
        return pages
    })
    const totalEventPages = computed(() => eventPages.value.length || 0)
    const shouldPaginateEvents = computed(() => totalEventPages.value > 1)
    watch(eventPages, () => {
        if (totalEventPages.value === 0) {
            activeEventPage.value = 1
        } else if (activeEventPage.value > totalEventPages.value) {
            activeEventPage.value = totalEventPages.value
        } else if (activeEventPage.value < 1) {
            activeEventPage.value = 1
        }
    }, { immediate: true })
    const currentEventPageIndex = computed(() => {
        if (!shouldPaginateEvents.value) return 0
        return Math.min(Math.max(activeEventPage.value - 1, 0), totalEventPages.value - 1)
    })
    const displayedEvents = computed(() => {
        if (!shouldPaginateEvents.value) return filteredEvents.value
        return eventPages.value[currentEventPageIndex.value] || []
    })
    watch(eventSearch, () => {
        activeEventPage.value = 1
    })
    const goToEventPage = (page) => {
        if (!shouldPaginateEvents.value) return
        const target = Math.min(Math.max(1, Number(page) || 1), totalEventPages.value)
        if (target === activeEventPage.value) return
        activeEventPage.value = target
        nextTick(() => {
            const el = eventsSectionRef.value
            if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    }
    const goPrevEventPage = () => {
        if (activeEventPage.value > 1) goToEventPage(activeEventPage.value - 1)
    }
    const goNextEventPage = () => {
        if (activeEventPage.value < totalEventPages.value) goToEventPage(activeEventPage.value + 1)
    }

    const actionCenterCards = computed(() => {
        const cards = []
        if (cartItemCount.value > 0) {
            cards.push({
                key: 'cart-summary',
                title: `購物車有 ${cartItemCount.value} 件待結帳`,
                subtitle: '可隨時同步雲端購物車，避免遺漏項目',
                action: 'cart',
                actionLabel: '查看購物車'
            })
        }
        if (pendingOrders.value.length > 0) {
            cards.push({
                key: 'orders-pending',
                title: `有 ${pendingOrders.value.length} 筆訂單尚未完成`,
                subtitle: '確認匯款資訊或更新處理狀態，讓預約順利進行',
                action: 'orders',
                actionLabel: '管理訂單'
            })
        }
        if (nextUpcomingEvent.value) {
            const event = nextUpcomingEvent.value
            cards.push({
                key: 'next-event',
                title: `下一場活動：${event.title || event.name || event.code || '待更新'}`,
                subtitle: formatRange(event.starts_at, event.ends_at) || '請查看活動詳情',
                action: 'event',
                actionLabel: event.code ? '立即預約' : '查看活動',
                eventCode: event.code || ''
            })
        }
        return cards
    })

    const handleActionCenterAction = (card) => {
        if (!card) return
        if (card.action === 'cart') {
            cartOpen.value = true
        } else if (card.action === 'orders') {
            openOrders()
        } else if (card.action === 'event') {
            if (card.eventCode) {
                goReserve(card.eventCode)
            } else {
                setActiveTab('events', findTabIndex('events'))
            }
        }
    }

    onMounted(async () => {
        window.addEventListener('auth-changed', handleAuthChanged)
        window.addEventListener('storage', handleStorage)
        const initialTab = typeof route.query.tab === 'string' ? route.query.tab : 'shop'
        const initialIdx = findTabIndex(initialTab)
        if (initialIdx !== -1) {
            setActiveTab(initialTab, initialIdx, { skipRouteSync: true, force: true })
        } else {
            setActiveTab('shop', 0, { skipRouteSync: true, force: true })
        }
        await Promise.all([fetchProducts(), fetchEvents()])
        const authed = await checkSession()
        if (authed) await loadCart()
    })

    onBeforeUnmount(() => {
        if (cartSyncTimer) clearTimeout(cartSyncTimer)
        cartSyncTimer = null
        window.removeEventListener('auth-changed', handleAuthChanged)
        window.removeEventListener('storage', handleStorage)
    })
</script>

<style scoped>
    /* moved common styles to global style.css: .ticket-card:hover, .tab-indicator */

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

    /* Better tap highlight for mobile */
    :root { -webkit-tap-highlight-color: transparent; }
    button:focus-visible, a:focus-visible, input:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
    }
</style>
    const QuantityStepper = defineAsyncComponent(() => import('../components/QuantityStepper.vue'))
