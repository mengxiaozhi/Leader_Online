<template>
    <main class="pt-6 pb-12 px-4">
        <div class="max-w-6xl mx-auto">
            <!-- Header -->
            <header class="bg-white shadow-sm border-b border-gray-100 mb-8 p-6 flex justify-between items-center">
                <div>
                    <h1 class="text-2xl font-bold text-gray-900">鐵人競賽購票中心</h1>
                    <p class="text-gray-600 mt-1">購買票券 • 管理訂單 • 預約賽事</p>
                </div>
                <div class="bg-red-50 text-red-700 px-4 py-2 text-sm font-medium border border-red-200">
                    購物車 {{ cartItems.length }} 項
                </div>
            </header>

            <!-- Tabs -->
            <div class="relative mb-12">
                <div class="flex justify-center border-b border-gray-200 relative">
                    <div class="tab-indicator"
                        :style="{ left: (activeTabIndex * (100 / tabs.length)) + '%', width: (100 / tabs.length) + '%' }">
                    </div>
                    <button v-for="(tab, index) in tabs" :key="tab.key" @click="setActiveTab(tab.key, index)" :class="[
                        'relative px-6 py-4 font-semibold transition-all duration-300 text-lg flex-1',
                        activeTab === tab.key ? 'text-[#D90000]' : 'text-gray-500 hover:text-[#B00000]'
                    ]">
                        {{ tab.label }}
                    </button>
                </div>
            </div>

            <!-- 🛒 商店 -->
            <section v-if="activeTab === 'shop'" class="slide-in">
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div v-for="(product, index) in products" :key="index"
                        class="ticket-card bg-white border-2 border-gray-100 p-5 shadow-sm hover:shadow-lg transition">
                        <h2 class="text-lg font-semibold text-[#D90000]">{{ product.name }}</h2>
                        <p class="text-sm text-gray-600">{{ product.description }}</p>
                        <p class="text-sm text-gray-700 font-medium">NT$ {{ product.price }}</p>

                        <div class="flex items-center mt-2 gap-2">
                            <button @click="decreaseQuantity(index)" class="px-3 py-1 bg-gray-200">-</button>
                            <input type="number" v-model.number="product.quantity" min="1" max="10"
                                class="w-20 px-2 py-1 border border-gray-300 text-center" />
                            <button @click="increaseQuantity(index)" class="px-3 py-1 bg-gray-200">+</button>
                        </div>

                        <button class="mt-3 w-full py-2 text-white font-medium bg-[#D90000] hover:bg-[#B00000]"
                            @click="addToCart(product)">
                            加入購物車
                        </button>
                    </div>
                </div>
            </section>

            <!-- 🛍️ 購物車 -->
            <section v-if="activeTab === 'cart'" class="slide-in">
                <div v-if="cartItems.length" class="space-y-4">
                    <div v-for="(item, index) in cartItems" :key="index"
                        class="ticket-card bg-white border-2 border-gray-100 p-5 shadow-sm hover:shadow-lg transition flex justify-between items-center">
                        <div>
                            <p class="font-medium">{{ item.name }}</p>
                            <p class="text-sm text-gray-500">NT$ {{ item.price }} x {{ item.quantity }}</p>
                        </div>
                        <div class="flex gap-2">
                            <button @click="changeCartQuantity(index, -1)" class="px-3 py-1 bg-gray-200">-</button>
                            <button @click="changeCartQuantity(index, 1)" class="px-3 py-1 bg-gray-200">+</button>
                            <button @click="removeFromCart(index)" class="px-3 py-1 bg-red-200 text-red-700">移除</button>
                        </div>
                    </div>
                    <div class="text-right text-lg font-bold">總計：NT$ {{ cartTotalPrice }}</div>
                    <button @click="checkout"
                        class="w-full bg-[#D90000] text-white py-2 hover:bg-[#B00000] font-semibold">
                        結帳
                    </button>
                </div>
                <p v-else class="text-center text-gray-500">購物車目前是空的</p>
            </section>

            <!-- 📦 訂單 -->
            <section v-if="activeTab === 'orders'" class="slide-in">
                <div v-if="orders.length" class="space-y-4">
                    <div v-for="order in orders" :key="order.id"
                        class="ticket-card bg-white border-2 border-gray-100 p-5 shadow-sm hover:shadow-lg transition">
                        <p><strong>訂單編號：</strong>{{ order.id }}</p>
                        <p><strong>票券種類：</strong>{{ order.ticketType }}</p>
                        <p><strong>數量：</strong>{{ order.quantity }}</p>
                        <p><strong>總金額：</strong>NT$ {{ order.total }}</p>
                        <p><strong>建立時間：</strong>{{ order.createdAt }}</p>
                        <p>
                            <strong>狀態：</strong>
                            <span :class="{
                                'text-green-600': order.status === '已完成',
                                'text-yellow-600': order.status === '待匯款',
                                'text-blue-600': order.status === '處理中'
                            }">
                                {{ order.status }}
                            </span>
                        </p>
                    </div>
                </div>
                <p v-else class="text-center text-gray-500">尚無訂單紀錄</p>
            </section>

            <!-- 🚴 賽事預約 -->
            <section v-if="activeTab === 'events'" class="slide-in">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div v-for="event in events" :key="event.id"
                        class="ticket-card bg-white border-2 border-gray-100 p-6 shadow-sm hover:shadow-lg transition flex flex-col justify-between">
                        <div>
                            <h2 class="text-lg font-semibold text-gray-800 mb-2">{{ event.name }}</h2>
                            <p class="text-sm text-gray-600">📅 {{ event.date }}</p>
                            <p class="text-sm text-gray-600 mb-4">🛑 報名截止：{{ event.deadline }}</p>
                            <ul class="list-disc ml-6 text-sm text-gray-700 space-y-1 mb-4">
                                <li v-for="rule in event.rules" :key="rule">{{ rule }}</li>
                            </ul>
                        </div>
                        <div class="flex gap-3 mt-4">
                            <button @click="goToEventDetail(event.id)"
                                class="flex-1 bg-[#D90000] text-white py-2 hover:bg-[#B00000]">
                                立即預約
                            </button>
                            <button @click="viewEventInfo(event)"
                                class="flex-1 bg-gray-100 text-gray-700 py-2 hover:bg-gray-200">
                                查看詳細
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Modal for 查看詳細 -->
            <transition name="fade">
                <div v-if="showEventModal"
                    class="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
                    <div class="bg-white shadow-lg p-6 w-full max-w-md relative">
                        <button class="absolute top-3 right-3 text-gray-500 hover:text-gray-700"
                            @click="showEventModal = false">
                            ✕
                        </button>
                        <h3 class="text-xl font-bold text-[#D90000] mb-4 text-center">{{ modalEvent?.name }}</h3>
                        <p class="text-sm text-gray-600">📅 日期：{{ modalEvent?.date }}</p>
                        <p class="text-sm text-gray-600 mb-4">🛑 截止：{{ modalEvent?.deadline }}</p>
                        <ul class="list-disc ml-6 text-sm text-gray-700 space-y-1 mb-4">
                            <li v-for="rule in modalEvent?.rules" :key="rule">{{ rule }}</li>
                        </ul>
                        <button @click="goToEventDetail(modalEvent.id)"
                            class="w-full bg-[#D90000] text-white py-2 hover:bg-[#B00000]">
                            前往預約
                        </button>
                    </div>
                </div>
            </transition>
        </div>
    </main>
</template>

<script setup>
    import { ref, computed } from 'vue'
    import { useRouter } from 'vue-router'

    const router = useRouter()

    const tabs = [
        { key: 'shop', label: '商店' },
        { key: 'cart', label: '購物車' },
        { key: 'orders', label: '我的訂單' },
        { key: 'events', label: '賽事預約' },
    ]
    const activeTab = ref('shop')
    const activeTabIndex = ref(0)
    const setActiveTab = (key, index) => {
        activeTab.value = key
        activeTabIndex.value = index
    }

    // 商店
    const products = ref([
        { name: '小鐵人', description: '適合5~8歲', price: 300, quantity: 1 },
        { name: '大鐵人', description: '適合9~12歲', price: 500, quantity: 1 },
        { name: '滑步車', description: '適合3~6歲', price: 200, quantity: 1 },
    ])
    const increaseQuantity = (i) => { if (products.value[i].quantity < 10) products.value[i].quantity++ }
    const decreaseQuantity = (i) => { if (products.value[i].quantity > 1) products.value[i].quantity-- }

    // 購物車
    const cartItems = ref([])
    const addToCart = (product) => {
        const existing = cartItems.value.find((item) => item.name === product.name)
        if (existing) {
            existing.quantity += product.quantity
        } else {
            cartItems.value.push({ ...product })
        }
        alert(`已加入 ${product.name}`)
    }
    const changeCartQuantity = (index, delta) => {
        cartItems.value[index].quantity += delta
        if (cartItems.value[index].quantity <= 0) removeFromCart(index)
    }
    const removeFromCart = (index) => {
        cartItems.value.splice(index, 1)
    }
    const cartTotalPrice = computed(() =>
        cartItems.value.reduce((sum, item) => sum + item.price * item.quantity, 0)
    )
    const generateOrderId = () => {
        const prefix = 'ORD-'
        const randomNum = Math.floor(1000 + Math.random() * 9000)
        return `${prefix}${randomNum}`
    }
    const orders = ref([
        { id: 'ORD-001', ticketType: '小鐵人', quantity: 2, total: 600, createdAt: '2025-07-21', status: '已完成' },
        { id: 'ORD-002', ticketType: '滑步車', quantity: 1, total: 200, createdAt: '2025-07-22', status: '處理中' },
    ])
    const checkout = () => {
        if (!cartItems.value.length) {
            alert('購物車是空的')
            return
        }
        cartItems.value.forEach(item => {
            orders.value.push({
                id: generateOrderId(),
                ticketType: item.name,
                quantity: item.quantity,
                total: item.price * item.quantity,
                createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
                status: '待匯款'
            })
        })
        alert(`✅ 已生成 ${cartItems.value.length} 筆訂單，請完成匯款`)
        cartItems.value = []
    }

    // 賽事預約
    const events = ref([
        { id: 1, name: '墾丁 70.3 鐵人賽', date: '2025-10-31 ~ 11-02', deadline: '2025-10-26', rules: ['17噸卡車運送', '依法規投保貨物險', '禁止裸車', '代購包材$100/現場代包$300'] },
        { id: 2, name: '親子滑步趣跑賽', date: '2025-09-01', deadline: '2025-08-25', rules: ['適合 3-8 歲兒童', '含安全檢查與托運保險'] },
    ])

    // Modal
    const showEventModal = ref(false)
    const modalEvent = ref(null)

    const goToEventDetail = (eventId) => {
        router.push({ name: 'booking-detail', params: { id: eventId } })
    }
    const viewEventInfo = (event) => {
        modalEvent.value = event
        showEventModal.value = true
    }
</script>

<style scoped>
    .ticket-card:hover {
        transform: translateY(-4px);
        border-color: #D90000;
        box-shadow: 0 20px 25px -5px rgba(217, 0, 0, 0.1),
            0 10px 10px -5px rgba(217, 0, 0, 0.04);
    }

    .tab-indicator {
        position: absolute;
        bottom: 0;
        height: 3px;
        background: linear-gradient(90deg, #D90000, #B00000);
        transition: all 0.3s ease;
    }

    .fade-enter-active,
    .fade-leave-active {
        transition: opacity 0.3s;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
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

    /* 統一所有按鈕、輸入框、卡片、Modal 為直角 */
    button,
    input,
    .ticket-card,
    .tab-indicator,
    .modal {
        border-radius: 0 !important;
    }
</style>
