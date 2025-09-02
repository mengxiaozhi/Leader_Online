<template>
    <main class="pt-6 pb-12 px-4">
        <div class="max-w-6xl mx-auto">

            <!-- Header -->
            <header class="bg-white shadow-sm border-b border-gray-100 mb-8 p-6">
                <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 class="text-2xl font-bold text-gray-900">優惠券管理中心</h1>
                        <p class="text-gray-600 mt-1">管理您的所有優惠券與預約紀錄</p>
                    </div>
                    <div class="flex items-center gap-3 w-full md:w-auto">
                        <div class="bg-red-50 text-red-700 px-4 py-2 text-sm font-medium w-full md:w-auto text-center">
                            共 {{ totalTickets }} 張優惠券
                        </div>
                    </div>
                </div>
            </header>

            <!-- Tabs -->
            <div class="relative mb-12">
                <div class="flex justify-center border-b border-gray-200 relative">
                    <div class="tab-indicator" :style="{
                        left: activeTabIndex * 50 + '%',
                        width: '50%'
                    }"></div>
                    <button v-for="(tab, index) in tabs" :key="tab.key" @click="setActiveTab(tab.key, index)" :class="[
                        'relative px-8 py-4 font-semibold transition-all duration-300 text-lg',
                        activeTab === tab.key
                            ? 'text-primary'
                            : 'text-gray-500 hover:text-secondary'
                    ]">
                        {{ tab.label }}
                    </button>
                </div>
            </div>

            <!-- 我的優惠券 -->
            <section v-if="activeTab === 'tickets'" class="slide-in">
                <!-- Stats Cards -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div @click="filterTickets('all')"
                        class="cursor-pointer bg-white p-6 border border-gray-200 shadow-sm hover:border-primary">
                        <p class="text-sm text-gray-600 font-medium">總優惠券數</p>
                        <p class="text-3xl font-bold text-gray-900">{{ totalTickets }}</p>
                    </div>
                    <div @click="filterTickets('available')"
                        class="cursor-pointer bg-white p-6 border border-gray-200 shadow-sm hover:border-primary">
                        <p class="text-sm text-gray-600 font-medium">可用優惠券</p>
                        <p class="text-3xl font-bold text-green-600">{{ availableTickets }}</p>
                    </div>
                    <div @click="filterTickets('used')"
                        class="cursor-pointer bg-white p-6 border border-gray-200 shadow-sm hover:border-primary">
                        <p class="text-sm text-gray-600 font-medium">已使用</p>
                        <p class="text-3xl font-bold text-red-600">{{ usedTickets }}</p>
                    </div>
                </div>

                <!-- Filter Buttons -->
                <div class="flex flex-wrap gap-2 mb-6">
                    <button @click="filterTickets('all')"
                        :class="filter === 'all' ? activeFilterClass : defaultFilterClass">全部</button>
                    <button @click="filterTickets('available')"
                        :class="filter === 'available' ? activeFilterClass : defaultFilterClass">可用</button>
                    <button @click="filterTickets('used')"
                        :class="filter === 'used' ? activeFilterClass : defaultFilterClass">已使用</button>
                </div>

                <!-- Coupon Cards -->
                <div v-if="loadingTickets" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div v-for="i in 6" :key="'tskel-'+i" class="ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm skeleton" style="height: 320px;"></div>
                </div>
                <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div v-for="(ticket, index) in filteredTickets" :key="ticket.uuid" :class="[
                        'ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm',
                        ticket.used ? 'opacity-60' : ''
                    ]">
                        <div class="relative w-full overflow-hidden" style="aspect-ratio: 3/2;">
                            <img :src="ticketCoverUrl(ticket)" @error="(e)=>e.target.src='/logo.png'" alt="cover" class="absolute inset-0 w-full h-full object-cover" />
                            <div class="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-red-700/10 pointer-events-none"></div>
                        </div>
                        <div class="p-6">
                            <div class="flex items-start justify-between mb-4">
                                <div>
                                    <h3 class="text-xl font-bold text-primary">🎫 {{ ticket.type }}</h3>
                                    <p class="text-sm text-gray-500">使用期限：{{ formatDate(ticket.expiry) }}</p>
                                </div>
                                <span :class="[
                                    'px-3 py-1 text-xs font-semibold',
                                    ticket.used ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                ]">
                                    {{ ticket.used ? '已使用' : '未使用' }}
                                </span>
                            </div>
                            <p class="text-xs text-gray-500 mb-1">優惠券編號</p>
                            <p class="text-sm font-mono bg-gray-50 p-2 text-gray-700 break-all mb-4">{{ ticket.uuid }}</p>
                            <button class="w-full py-3 font-semibold text-white" :class="ticket.used
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'btn btn-primary'" :disabled="ticket.used"
                                @click="goReserve()">
                                {{ ticket.used ? '已使用' : '去預約使用' }}
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 我的預約 -->
            <section v-if="activeTab === 'reservations'" class="slide-in">
                <div class="flex flex-wrap gap-3 mb-6">
                    <button @click="filterReservations('all')"
                        :class="resFilter === 'all' ? activeFilterClass : defaultFilterClass">全部</button>
                    <button v-for="opt in reservationStatusList" :key="opt.key" @click="filterReservations(opt.key)"
                        :class="resFilter === opt.key ? activeFilterClass : defaultFilterClass">{{ opt.shortLabel }}</button>
                </div>

                <!-- Reservation Cards -->
                <div v-if="loadingReservations" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div v-for="i in 6" :key="'rskel-'+i" class="ticket-card bg-white border-2 border-gray-100 p-6 shadow-sm skeleton" style="height: 220px;"></div>
                </div>
                <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div v-for="(res, index) in filteredReservations" :key="index" :class="[
                        'ticket-card bg-white border-2 border-gray-100 p-6 shadow-sm',
                        res.status === 'done' ? 'opacity-60' : ''
                    ]">
                        <div class="flex items-start justify-between mb-4">
                            <div>
                                <h3 class="text-xl font-bold text-primary">{{ res.event }}</h3>
                                <p class="text-sm text-gray-600">門市：{{ res.store }}</p>
                                <p class="text-xs text-gray-500">預約時間：{{ res.reservedAt }}</p>
                            </div>
                            <span :class="[
                                'badge',
                                statusColorMap[res.status]
                            ]">
                                {{ statusLabelMap[res.status] }}
                            </span>
                        </div>
                        <button class="w-full py-3 font-semibold text-white" :class="res.status === 'done'
                            ? 'bg-gray-400 cursor-not-allowed'
                            : 'btn btn-primary'" :disabled="res.status === 'done'"
                            @click="openReservationModal(res)">
                            {{ res.status === 'done' ? '已完成' : '查看詳情' }}
                        </button>
                    </div>
                </div>
            </section>

            <!-- 預約詳情 Modal -->
            <div v-if="showModal" class="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
                <div class="bg-white p-6 shadow-lg max-w-md w-full relative animate-fade-in">
                    <button @click="closeModal" class="btn-ghost absolute top-3 right-3 text-gray-500 hover:text-red-500" title="關閉">
                        <AppIcon name="x" class="h-5 w-5" />
                    </button>
                    <h3 class="text-xl font-bold text-primary mb-4">預約詳情</h3>
                    <p><strong>優惠券類型：</strong>{{ selectedReservation.ticketType }}</p>
                    <p><strong>門市：</strong>{{ selectedReservation.store }}</p>
                    <p><strong>賽事：</strong>{{ selectedReservation.event }}</p>
                    <p><strong>預約時間：</strong>{{ selectedReservation.reservedAt }}</p>
                    <p class="mt-2"><strong>狀態：</strong>
                        <span :class="['px-2 py-1 text-xs', statusColorMap[selectedReservation.status]]">
                            {{ statusLabelMap[selectedReservation.status] }}
                        </span>
                    </p>
                    <div v-if="['pre_pickup','post_pickup'].includes(selectedReservation.status)" class="mt-4 text-center space-y-3">
                        <p class="text-sm text-gray-700 font-medium">取車驗證碼</p>
                        <div class="text-2xl font-bold text-primary tracking-widest flex items-center justify-center gap-2">
                            <span>{{ selectedReservation.verifyCode }}</span>
                            <button class="btn-ghost" title="複製" @click="copyText(selectedReservation.verifyCode)"><AppIcon name="copy" class="h-4 w-4" /></button>
                        </div>
                        <qrcode-vue :value="selectedReservation.verifyCode" :size="120" level="M" />
                    </div>
                </div>
            </div>

        </div>
    </main>
</template>

<script setup>
    import { ref, computed, onMounted } from 'vue'
    import { useRouter, useRoute } from 'vue-router'
    import QrcodeVue from 'qrcode.vue'
    import axios from '../api/axios'
    import AppIcon from '../components/AppIcon.vue'

    const API = 'https://api.xiaozhi.moe/uat/leader_online'
    const router = useRouter()
    const route = useRoute()
    const user = JSON.parse(localStorage.getItem('user_info') || 'null')

    const tabs = [
        { key: 'tickets', label: '我的優惠券' },
        { key: 'reservations', label: '我的預約' },
    ]
    const activeTab = ref('tickets')
    const activeTabIndex = ref(0)
    const setActiveTab = (key, index) => {
        activeTab.value = key
        activeTabIndex.value = index
    }

    const activeFilterClass = 'px-4 py-2 btn btn-primary text-white font-medium'
    const defaultFilterClass = 'px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200'

    // 優惠券資料
    const tickets = ref([])
    const loadingTickets = ref(true)
    const totalTickets = computed(() => tickets.value.length)
    const availableTickets = computed(() => tickets.value.filter(t => !t.used).length)
    const usedTickets = computed(() => tickets.value.filter(t => t.used).length)

    const filter = ref('all')
    const filteredTickets = computed(() => {
        if (filter.value === 'available') return tickets.value.filter(t => !t.used)
        if (filter.value === 'used') return tickets.value.filter(t => t.used)
        return tickets.value
    })
    const filterTickets = (type) => { filter.value = type }
    const ticketCoverUrl = (t) => `${API}/tickets/cover/${encodeURIComponent(t.type || '')}`
    const goReserve = () => { router.push({ path: '/store', query: { tab: 'events' } }) }
    const copyText = (t) => { try { if (t) navigator.clipboard?.writeText(String(t)) } catch {} }

    const loadTickets = async () => {
        try {
            const { data } = await axios.get(`${API}/tickets/me`)
            tickets.value = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
        } catch (err) { alert(err?.response?.data?.message || err.message) }
        finally { loadingTickets.value = false }
    }

    // 預約資料
    const reservations = ref([])
    const loadingReservations = ref(true)
    // 六階段預約狀態（代碼、顯示與顏色）
    const reservationStatusList = [
        { key: 'service_booking', shortLabel: '預約託運服務', label: '預約託運服務（購買票券、付款、憑證產生）', color: 'bg-gray-100 text-gray-700' },
        { key: 'pre_dropoff', shortLabel: '賽前交車', label: '賽前交車（刷碼、檢核、上傳照片、掛車牌、生成取車碼）', color: 'bg-yellow-100 text-yellow-700' },
        { key: 'pre_pickup', shortLabel: '賽前取車', label: '賽前取車（出示取車碼、領車、檢查、上傳合照）', color: 'bg-blue-100 text-blue-700' },
        { key: 'post_dropoff', shortLabel: '賽後交車', label: '賽後交車（刷碼、檢核、上傳照片、掛車牌、生成取車碼）', color: 'bg-indigo-100 text-indigo-700' },
        { key: 'post_pickup', shortLabel: '賽後取車', label: '賽後取車（出示取車碼、領車、檢查、合照存檔）', color: 'bg-blue-100 text-blue-700' },
        { key: 'done', shortLabel: '服務結束', label: '服務結束', color: 'bg-green-100 text-green-700' },
    ]
    const statusLabelMap = Object.fromEntries(reservationStatusList.map(s => [s.key, s.label]))
    const statusColorMap = Object.fromEntries(reservationStatusList.map(s => [s.key, s.color]))

    const resFilter = ref('all')
    const filteredReservations = computed(() => {
        if (resFilter.value === 'all') return reservations.value
        return reservations.value.filter(r => r.status === resFilter.value)
    })
    const filterReservations = (type) => { resFilter.value = type }

    const toNewStatus = (s) => {
        if (s === 'pending') return 'pre_dropoff'
        if (s === 'pickup') return 'pre_pickup'
        return s
    }

    const loadReservations = async () => {
        try {
            const { data } = await axios.get(`${API}/reservations/me`)
            const raw = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            reservations.value = raw.map(r => ({
                ticketType: r.ticket_type,
                store: r.store,
                event: r.event,
                reservedAt: r.reserved_at,
                verifyCode: r.verify_code,
                status: toNewStatus(r.status)
            }))
        } catch (err) { alert(err?.response?.data?.message || err.message) }
        finally { loadingReservations.value = false }
    }

    // Modal
    const showModal = ref(false)
    const selectedReservation = ref({})
    const openReservationModal = (reservation) => {
        selectedReservation.value = reservation
        showModal.value = true
    }
    const closeModal = () => showModal.value = false

    const formatDate = (dateString) => {
        const date = new Date(dateString)
        return date.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
    }

    onMounted(() => {
        if (user) {
            loadTickets()
            loadReservations()
        }
        const init = typeof route.query.tab === 'string' ? route.query.tab : ''
        if (init === 'reservations') setActiveTab('reservations', 1)
        else if (init === 'tickets') setActiveTab('tickets', 0)
    })
</script>

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

    .slide-in {
        animation: slideIn 0.5s ease-out;
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

    @keyframes fadeInScale {
        from {
            transform: scale(0.9);
            opacity: 0;
        }

        to {
            transform: scale(1);
            opacity: 1;
        }
    }

    .animate-fade-in {
        animation: fadeInScale 0.3s ease-out;
    }

    button,
    .ticket-card,
    .bg-white,
    .shadow-lg {
        border-radius: 0 !important;
    }
</style>
