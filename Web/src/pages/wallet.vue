<template>
    <main class="pt-6 pb-12 px-4">
        <div class="max-w-6xl mx-auto">

            <!-- Header -->
            <header class="bg-white shadow-sm border-b border-gray-100 mb-6 p-4 pt-safe">
                <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 class="text-2xl font-bold text-gray-900">我的皮夾</h1>
                        <p class="text-gray-600 mt-1">管理您的所有票券與預約</p>
                    </div>
                    <div class="flex items-center gap-3 w-full md:w-auto">
                        <div class="bg-red-50 text-red-700 px-4 py-2 text-sm font-medium w-full md:w-auto text-center">
                            共 {{ totalTickets }} 張票卷
                        </div>
                        <!-- <button class="btn btn-outline text-sm" @click="openScan"><AppIcon name="camera" class="h-4 w-4" /> 掃描轉贈</button>-->
                    </div>
                </div>
            </header>

            <!-- Tabs -->
            <div class="relative mb-6 sticky top-0 z-20 bg-white">
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

            <!-- 我的票券 -->
            <section v-if="activeTab === 'tickets'" class="slide-in">
                <!-- Stats Cards -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div @click="filterTickets('all')"
                        class="cursor-pointer bg-white p-6 border border-gray-200 shadow-sm hover:border-primary">
                        <p class="text-sm text-gray-600 font-medium">總票卷數</p>
                        <p class="text-3xl font-bold text-gray-900">{{ totalTickets }}</p>
                    </div>
                    <div @click="filterTickets('available')"
                        class="cursor-pointer bg-white p-6 border border-gray-200 shadow-sm hover:border-primary">
                        <p class="text-sm text-gray-600 font-medium">可用票卷</p>
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
                    <div v-for="i in 6" :key="'tskel-' + i"
                        class="ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm skeleton"
                        style="height: 320px;"></div>
                </div>
                <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div v-for="(ticket, index) in filteredTickets" :key="ticket.uuid" :class="[
                        'ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm',
                        ticket.used ? 'opacity-60' : ''
                    ]">
                        <div class="relative w-full overflow-hidden" style="aspect-ratio: 3/2;">
                            <img :src="ticketCoverUrl(ticket)" @error="(e) => e.target.src = '/logo.png'" alt="cover"
                                class="absolute inset-0 w-full h-full object-cover" />
                            <div
                                class="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-red-700/10 pointer-events-none">
                            </div>
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
                            <p class="text-xs text-gray-500 mb-1">票券編號</p>
                            <div class="flex items-center justify-between bg-gray-50 px-2 py-2 mb-3">
                                <p class="text-sm font-mono text-gray-700 truncate mr-2" :title="ticket.uuid">{{ ticket.uuid }}</p>
                                <button class="btn-ghost" title="複製編號" @click="copyText(ticket.uuid)"><AppIcon name="copy" class="h-4 w-4" /></button>
                            </div>
                            <button class="w-full py-3 font-semibold text-white" :class="ticket.used
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'btn btn-primary'" :disabled="ticket.used" @click="goReserve()">
                                {{ ticket.used ? '已使用' : '去預約使用' }}
                            </button>
                            <div v-if="!ticket.used" class="mt-2 grid grid-cols-2 gap-2">
                                <button class="btn btn-outline text-sm" @click="startTransferEmail(ticket)"><AppIcon name="orders" class="h-4 w-4" /> 轉贈 Email</button>
                                <button class="btn btn-outline text-sm" @click="startTransferQR(ticket)"><AppIcon name="camera" class="h-4 w-4" /> 轉贈 QR</button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 行動 FAB：掃描轉贈（僅手機顯示） -->
            <div class="fixed bottom-4 right-4 z-40">
                <button class="btn btn-primary shadow px-4 py-3" @click="openScan">
                    <AppIcon name="camera" class="h-5 w-5" /> 掃描轉贈
                </button>
            </div>

            <!-- 我的預約 -->
            <section v-if="activeTab === 'reservations'" class="slide-in">
                <div class="flex flex-wrap gap-3 mb-6">
                    <button @click="filterReservations('all')"
                        :class="resFilter === 'all' ? activeFilterClass : defaultFilterClass">全部</button>
                    <button v-for="opt in reservationStatusList" :key="opt.key" @click="filterReservations(opt.key)"
                        :class="resFilter === opt.key ? activeFilterClass : defaultFilterClass">{{ opt.shortLabel
                        }}</button>
                </div>

                <!-- Reservation Cards -->
                <div v-if="loadingReservations" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div v-for="i in 6" :key="'rskel-' + i"
                        class="ticket-card bg-white border-2 border-gray-100 p-6 shadow-sm skeleton"
                        style="height: 220px;"></div>
                </div>
                <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div v-for="(res, index) in filteredReservations" :key="index" :class="[
                        'ticket-card bg-white border-2 border-gray-100 p-6 shadow-sm cursor-pointer',
                        res.status === 'done' ? 'opacity-60' : ''
                    ]" @click="openReservationModal(res)">
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
                            : 'btn btn-primary'" :disabled="res.status === 'done'" @click.stop="openReservationModal(res)">
                            {{ res.status === 'done' ? '已完成' : '查看詳情' }}
                        </button>
                    </div>
                </div>
            </section>

            <!-- 預約詳情 Bottom Sheet -->
            <transition name="fade">
                <div v-if="showModal" class="fixed inset-0 bg-black/40 z-40" @click="closeModal"></div>
            </transition>
            <transition name="sheet">
                <div v-if="showModal" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel">
                    <div class="relative p-4 sm:p-6 max-h-[80vh] overflow-y-auto">
                        <button @click="closeModal"
                            class="btn-ghost absolute top-3 right-3 text-gray-500 hover:text-red-500" title="關閉">
                            <AppIcon name="x" class="h-5 w-5" />
                        </button>
                        <div class="mx-auto h-1.5 w-10 bg-gray-300 mb-3"></div>
                        <h3 class="text-lg sm:text-xl font-bold text-primary mb-3">預約詳情</h3>

                        <div class="space-y-1 text-sm text-gray-800">
                            <p><strong>票券類型：</strong>{{ selectedReservation.ticketType }}</p>
                            <p><strong>{{ phaseLabel(selectedReservation.status) }}地點：</strong>{{
                                selectedReservation.store }}</p>
                            <p><strong>賽事：</strong>{{ selectedReservation.event }}</p>
                            <p><strong>{{ phaseLabel(selectedReservation.status) }}時間：</strong>{{
                                selectedReservation.reservedAt }}</p>
                            <p class="mt-2"><strong>狀態：</strong>
                                <span :class="['px-2 py-1 text-xs', statusColorMap[selectedReservation.status]]">
                                    {{ statusLabelMap[selectedReservation.status] }}
                                </span>
                            </p>
                        </div>

                        <div v-if="['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup'].includes(selectedReservation.status)"
                            class="mt-5 text-center space-y-3">
                            <p class="text-sm text-gray-700 font-medium">{{ phaseLabel(selectedReservation.status) }}驗證碼
                            </p>
                            <div
                                class="text-2xl font-bold text-primary tracking-widest flex items-center justify-center gap-2">
                                <span>{{ selectedReservation.verifyCode }}</span>
                                <button class="btn-ghost" title="複製" @click="copyText(selectedReservation.verifyCode)">
                                    <AppIcon name="copy" class="h-4 w-4" />
                                </button>
                            </div>
                            <div class="flex justify-center">
                                <qrcode-vue :value="selectedReservation.verifyCode" :size="140" level="M" />
                            </div>
                        </div>
                    </div>
                </div>
            </transition>

            <!-- 轉贈 QR Bottom Sheet（出示給對方掃） -->
            <transition name="fade"><div v-if="qrSheet.open" class="fixed inset-0 bg-black/40 z-40" @click="qrSheet.open=false"></div></transition>
            <transition name="sheet">
                <div v-if="qrSheet.open" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel">
                    <div class="relative p-4 sm:p-6 text-center">
                        <button class="btn-ghost absolute top-3 right-3" @click="qrSheet.open=false" title="關閉"><AppIcon name="x" class="h-5 w-5" /></button>
                        <h3 class="text-lg font-bold text-primary mb-2">出示 QR 轉贈</h3>
                        <div v-if="qrSheet.code" class="flex flex-col items-center gap-2">
                            <qrcode-vue :value="qrSheet.code" :size="180" level="M" />
                            <p class="text-xs text-gray-600">請對方於錢包頁點擊「掃描轉贈」掃此 QR</p>
                        </div>
                        <div v-else class="text-gray-500">生成中…</div>
                    </div>
                </div>
            </transition>

            <!-- 接收方：待處理轉贈（全局底部抽屜，一張張顯示） -->
            <transition name="fade"><div v-if="incoming.open" class="fixed inset-0 bg-black/40 z-40"></div></transition>
            <transition name="sheet">
                <div v-if="incoming.open" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel">
                    <div class="relative p-4 sm:p-6">
                        <h3 class="text-lg font-bold text-primary mb-2">收到票券轉贈</h3>
                        <div v-if="incoming.current" class="space-y-2 text-sm text-gray-800">
                            <p><strong>來自：</strong>{{ incoming.current.from_email || incoming.current.from_username }}</p>
                            <p><strong>票券：</strong>{{ incoming.current.type }}</p>
                            <p><strong>到期：</strong>{{ formatDate(incoming.current.expiry) }}</p>
                            <div class="mt-3 flex gap-2">
                                <button class="btn btn-primary" @click="acceptCurrentTransfer">接受</button>
                                <button class="btn btn-outline" @click="declineCurrentTransfer">不接受</button>
                            </div>
                        </div>
                        <div v-else class="text-gray-500">沒有待處理的轉贈</div>
                    </div>
                </div>
            </transition>

            <!-- 掃描轉贈（接收方） -->
            <transition name="fade"><div v-if="scan.open" class="fixed inset-0 bg-black/40 z-40" @click="closeScan"></div></transition>
            <transition name="sheet">
                <div v-if="scan.open" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel">
                    <div class="relative p-4 sm:p-6">
                        <button class="btn-ghost absolute top-3 right-3" title="關閉" @click="closeScan"><AppIcon name="x" class="h-5 w-5" /></button>
                        <h3 class="text-lg font-bold text-primary mb-2">掃描票券轉贈</h3>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                            <div>
                                <div class="text-xs text-gray-600 mb-1">相機掃描</div>
                                <div class="border bg-black aspect-video relative">
                                    <video ref="scanVideo" autoplay playsinline class="w-full h-full object-cover"></video>
                                </div>
                                <div class="mt-2 flex gap-2">
                                    <button class="btn btn-outline btn-sm" @click="startScan" :disabled="scan.scanning">啟動</button>
                                    <button class="btn btn-outline btn-sm" @click="stopScan" :disabled="!scan.scanning">停止</button>
                                </div>
                            </div>
                            <div>
                                <div class="text-xs text-gray-600 mb-1">手動輸入驗證碼</div>
                                <div class="flex gap-2">
                                    <input v-model.trim="scan.manual" placeholder="轉贈碼" class="border px-2 py-2 w-full" />
                                    <button class="btn btn-primary" @click="claimByCode" :disabled="!scan.manual">認領</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </transition>

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
        { key: 'tickets', label: '我的票券' },
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

    // 票券資料
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
    const promptEmail = (msg) => {
        const v = window.prompt(msg || '請輸入對方 Email');
        return (v || '').trim();
    }
    const copyText = (t) => { try { if (t) navigator.clipboard?.writeText(String(t)) } catch { } }

    const loadTickets = async () => {
        try {
            const { data } = await axios.get(`${API}/tickets/me`)
            tickets.value = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
        } catch (err) { alert(err?.response?.data?.message || err.message) }
        finally { loadingTickets.value = false }
    }

    // ===== 轉贈：發起（Email / QR） =====
    const qrSheet = ref({ open: false, code: '' })
    const startTransferEmail = async (ticket) => {
        const email = promptEmail('請輸入對方 Email（轉贈）')
        if (!email) return
        try{
            const { data } = await axios.post(`${API}/tickets/transfers/initiate`, { ticketId: ticket.id, mode: 'email', email })
            if (data?.ok){ alert('已發起轉贈，等待對方接受'); await loadTickets() }
            else alert(data?.message || '發起失敗')
        } catch(e){
            const code = e?.response?.data?.code || ''
            const msg = e?.response?.data?.message || e.message
            if (code === 'TRANSFER_EXISTS'){
                if (confirm('已有待處理的轉贈，是否取消並重新發起？')){
                    try{
                        await axios.post(`${API}/tickets/transfers/cancel_pending`, { ticketId: ticket.id })
                        const { data } = await axios.post(`${API}/tickets/transfers/initiate`, { ticketId: ticket.id, mode: 'email', email })
                        if (data?.ok){ alert('已發起轉贈，等待對方接受'); await loadTickets() }
                        else alert(data?.message || '發起失敗')
                    } catch(e2){ alert(e2?.response?.data?.message || e2.message) }
                }
            } else {
                alert(msg)
            }
        }
    }
    const startTransferQR = async (ticket) => {
        qrSheet.value = { open: true, code: '' }
        try{
            const { data } = await axios.post(`${API}/tickets/transfers/initiate`, { ticketId: ticket.id, mode: 'qr' })
            if (data?.ok){ qrSheet.value.code = data.data?.code || '' }
            else { qrSheet.value.open = false; alert(data?.message || '產生失敗') }
        } catch(e){
            qrSheet.value.open = false
            const code = e?.response?.data?.code || ''
            const msg = e?.response?.data?.message || e.message
            if (code === 'TRANSFER_EXISTS'){
                if (confirm('已有待處理的轉贈，是否取消並重新產生 QR？')){
                    try{
                        await axios.post(`${API}/tickets/transfers/cancel_pending`, { ticketId: ticket.id })
                        qrSheet.value = { open: true, code: '' }
                        const { data } = await axios.post(`${API}/tickets/transfers/initiate`, { ticketId: ticket.id, mode: 'qr' })
                        if (data?.ok){ qrSheet.value.code = data.data?.code || '' }
                        else { qrSheet.value.open = false; alert(data?.message || '產生失敗') }
                    } catch(e2){ qrSheet.value.open = false; alert(e2?.response?.data?.message || e2.message) }
                }
            } else {
                alert(msg)
            }
        }
    }

    // 預約資料
    const reservations = ref([])
    const loadingReservations = ref(true)
    // 六階段預約狀態（代碼、顯示與顏色）
    const reservationStatusList = [
        { key: 'pre_dropoff', shortLabel: '賽前交車', label: '賽前交車（顯示交車時間、地點與 QRcode/驗證碼）', color: 'bg-yellow-100 text-yellow-700' },
        { key: 'pre_pickup', shortLabel: '賽前取車', label: '賽前取車（顯示取車時間、地點與 QRcode/驗證碼）', color: 'bg-blue-100 text-blue-700' },
        { key: 'post_dropoff', shortLabel: '賽後交車', label: '賽後交車（顯示交車時間、地點與 QRcode/驗證碼）', color: 'bg-indigo-100 text-indigo-700' },
        { key: 'post_pickup', shortLabel: '賽後取車', label: '賽後取車（顯示取車時間、地點與 QRcode/驗證碼）', color: 'bg-blue-100 text-blue-700' },
        { key: 'done', shortLabel: '完成', label: '完成', color: 'bg-green-100 text-green-700' },
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
        // 未設定或舊值轉換，視為支付完成後的第一階段：賽前交車
        if (!s || s === 'pending' || s === 'service_booking') return 'pre_dropoff'
        if (s === 'pickup') return 'pre_pickup'
        return s
    }
    // 依狀態回傳「交車」或「取車」字樣，用於動態標籤
    const phaseLabel = (s) => (String(s || '').includes('pickup') ? '取車' : '交車')

    const loadReservations = async () => {
        try {
            const { data } = await axios.get(`${API}/reservations/me`)
            const raw = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            reservations.value = raw.map(r => {
                const status = toNewStatus(r.status)
                const codeByStage = {
                    pre_dropoff: r.verify_code_pre_dropoff || null,
                    pre_pickup: r.verify_code_pre_pickup || null,
                    post_dropoff: r.verify_code_post_dropoff || null,
                    post_pickup: r.verify_code_post_pickup || null,
                }
                return {
                    ticketType: r.ticket_type,
                    store: r.store,
                    event: r.event,
                    reservedAt: r.reserved_at,
                    verifyCode: codeByStage[status] || r.verify_code || null,
                    status
                }
            })
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
            loadIncomingTransfers()
        }
        const init = typeof route.query.tab === 'string' ? route.query.tab : ''
        if (init === 'reservations') setActiveTab('reservations', 1)
        else if (init === 'tickets') setActiveTab('tickets', 0)
    })

    // ===== 接收方：待處理轉贈（底部抽屜，逐一處理） =====
    const incoming = ref({ open: false, list: [], current: null })
    const loadIncomingTransfers = async () => {
        try{
            const { data } = await axios.get(`${API}/tickets/transfers/incoming`)
            const list = Array.isArray(data?.data) ? data.data : []
            incoming.value.list = list
            incoming.value.current = list[0] || null
            incoming.value.open = !!incoming.value.current
        } catch(e){ /* ignore */ }
    }
    const shiftIncoming = () => {
        incoming.value.list.shift()
        incoming.value.current = incoming.value.list[0] || null
        incoming.value.open = !!incoming.value.current
    }
    const acceptCurrentTransfer = async () => {
        const it = incoming.value.current; if (!it) return
        try{
            const { data } = await axios.post(`${API}/tickets/transfers/${it.id}/accept`)
            if (data?.ok){ await loadTickets(); shiftIncoming() }
            else alert(data?.message || '接受失敗')
        } catch(e){ alert(e?.response?.data?.message || e.message) }
    }
    const declineCurrentTransfer = async () => {
        const it = incoming.value.current; if (!it) return
        try{
            const { data } = await axios.post(`${API}/tickets/transfers/${it.id}/decline`)
            if (data?.ok){ shiftIncoming() }
            else alert(data?.message || '拒絕失敗')
        } catch(e){ alert(e?.response?.data?.message || e.message) }
    }

    // ===== 掃描轉贈（接收方） =====
    const scan = ref({ open: false, scanning: false, manual: '' })
    const scanVideo = ref(null)
    let scanStream = null; let scanTimer = null
    const openScan = () => { scan.value.open = true; startScan() }
    const closeScan = () => { stopScan(); scan.value.open = false }
    const startScan = async () => {
        if (!('BarcodeDetector' in window)) return
        try{
            const det = new window.BarcodeDetector({ formats: ['qr_code'] })
            scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            const video = scanVideo.value; if (!video) return
            video.srcObject = scanStream; await video.play(); scan.value.scanning = true
            const tick = async () => {
                if (!scan.value.scanning) return
                try {
                    const codes = await det.detect(video)
                    if (codes?.length){ const raw = String(codes[0].rawValue||'').trim(); if (raw){ await claimCode(raw); return } }
                } catch(_){}
                scanTimer = setTimeout(tick, 400)
            }
            tick()
        } catch(_){}
    }
    const stopScan = () => { scan.value.scanning = false; if (scanTimer) clearTimeout(scanTimer); try{ scanStream?.getTracks?.().forEach(t=>t.stop()) }catch(_){} scanStream=null; scanTimer=null }
    const claimCode = async (raw) => {
        try{
            const code = String(raw).replace(/\s+/g,'')
            const { data } = await axios.post(`${API}/tickets/transfers/claim_code`, { code })
            if (data?.ok){ alert('✅ 已認領票券'); await loadTickets(); closeScan() }
            else alert(data?.message || '認領失敗')
        } catch(e){ alert(e?.response?.data?.message || e.message) }
    }
    const claimByCode = async () => { if (scan.value.manual) await claimCode(scan.value.manual) }
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

    /* Bottom sheet + backdrop transitions */
    .fade-enter-active,
    .fade-leave-active {
        transition: opacity .2s ease;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }

    .sheet-enter-active,
    .sheet-leave-active {
        transition: transform .25s ease;
    }

    .sheet-enter-from,
    .sheet-leave-to {
        transform: translateY(100%);
    }

    button,
    .ticket-card,
    .bg-white,
    .shadow-lg {
        border-radius: 0 !important;
    }
</style>
