<template>
    <main class="pt-6 pb-12 px-4 max-w-5xl mx-auto">
        <h1 class="text-2xl font-bold text-[#D90000] mb-6 text-center">
            {{ eventDetail.name }} 單車託運預約
        </h1>

        <!-- 賽事資訊 -->
        <div class="bg-white border p-6 shadow mb-6">
            <p class="mb-2 font-semibold">商品編號：{{ eventDetail.code }}</p>
            <p>比賽日期：{{ eventDetail.date }}</p>
            <p>報名截止日期：{{ eventDetail.deadline }}</p>
            <p class="mt-3 text-sm text-gray-600">{{ eventDetail.description }}</p>
            <ul class="list-disc ml-6 text-sm mt-2">
                <li v-for="note in eventDetail.deliveryNotes" :key="note">{{ note }}</li>
            </ul>
        </div>

        <!-- 門市價格表 -->
        <div v-for="(store, sIdx) in stores" :key="store.name" class="bg-white border p-4 mb-4 shadow">
            <h3 class="font-bold text-lg text-[#D90000] mb-2">{{ store.name }}</h3>
            <p class="text-sm text-gray-600 mb-2">賽前交車：{{ store.pre }}｜賽後取車：{{ store.post }}</p>
            <table class="w-full border text-sm mb-2">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="border p-2">車型</th>
                        <th class="border p-2">原價</th>
                        <th class="border p-2">早鳥價</th>
                        <th class="border p-2">購買數量</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(price, type) in store.prices" :key="type">
                        <td class="border p-2">{{ type }}</td>
                        <td class="border p-2">TWD {{ price.normal }}</td>
                        <td class="border p-2">TWD {{ price.early }}</td>
                        <td class="border p-2">
                            <input type="number" v-model.number="store.quantity[type]" min="0"
                                class="w-20 border px-2 py-1 text-center" />
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- 加值服務與確認 -->
        <div class="bg-white border p-4 mb-4 shadow">
            <label class="block mb-2">
                <input type="checkbox" v-model="addOn.material" class="mr-1" />
                加購包材 100 元/份
            </label>
            <label class="block mb-2">
                <input type="checkbox" v-model="addOn.nakedConfirm" class="mr-1" />
                我已了解裸車不予託運
            </label>
            <label class="block mb-2">
                <input type="checkbox" v-model="addOn.purchasePolicy" class="mr-1" />
                我已詳閱購買須知
            </label>
            <label class="block">
                <input type="checkbox" v-model="addOn.usagePolicy" class="mr-1" />
                我已詳閱使用規定
            </label>
        </div>

        <!-- 優惠券 -->
        <div class="bg-white border p-4 mb-4 shadow">
            <label class="block mb-2 font-semibold">套用優惠券</label>
            <div class="flex gap-2">
                <input v-model="couponCode" type="text" placeholder="輸入票券編號"
                    class="flex-1 border px-2 py-1" />
                <button @click="applyCoupon" class="px-4 bg-[#D90000] text-white">套用</button>
            </div>
            <p v-if="couponDiscount" class="text-green-600 mt-2">已折抵 {{ couponDiscount }} 元</p>
        </div>

        <!-- 總金額 -->
        <div class="text-lg font-bold text-right mb-4">
            總金額：TWD {{ finalPrice }}
        </div>

        <button @click="reserve" class="w-full bg-[#D90000] text-white py-2 hover:bg-[#B00000]">
            確認預約
        </button>
    </main>
</template>

<script setup>
    import { ref, computed, onMounted } from 'vue'
    import { useRoute } from 'vue-router'
    import axios from 'axios'

    const API = 'http://localhost:3000/api'
    const route = useRoute()
    const user = JSON.parse(localStorage.getItem('user') || 'null')

    // 賽事資料
    const eventDetail = ref({})
    const fetchEvent = async () => {
        try {
            const { data } = await axios.get(`${API}/events/${route.params.id}`)
            eventDetail.value = {
                ...data,
                deliveryNotes: JSON.parse(data.rules || '[]')
            }
        } catch (err) { console.error(err) }
    }

    // 門市價格
    const stores = ref([
        {
            name: '小巨蛋（台北市松山區）',
            pre: '2025/11/25 ~ 12/02',
            post: '2025/12/09 ~ 12/16',
            prices: {
                '大鐵人': { normal: 3000, early: 2200 },
                '小鐵人': { normal: 2400, early: 1600 },
                '滑步車': { normal: 1400, early: 600 },
            },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 },
        },
        {
            name: '277（台北市大安區）',
            pre: '2025/11/25 ~ 12/02',
            post: '2025/12/09 ~ 12/16',
            prices: {
                '大鐵人': { normal: 3000, early: 2200 },
                '小鐵人': { normal: 2400, early: 1600 },
                '滑步車': { normal: 1400, early: 600 },
            },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 },
        },
        {
            name: '瘋三鐵（台北市內湖區）',
            pre: '2025/11/25 ~ 12/02',
            post: '2025/12/09 ~ 12/16',
            prices: {
                '大鐵人': { normal: 3000, early: 2200 },
                '小鐵人': { normal: 2400, early: 1600 },
                '滑步車': { normal: 1400, early: 600 },
            },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 },
        },
        {
            name: '老學長（新竹市東區）',
            pre: '2025/11/25 ~ 12/02',
            post: '2025/12/09 ~ 12/16',
            prices: {
                '大鐵人': { normal: 3300, early: 2500 },
                '小鐵人': { normal: 2700, early: 1900 },
                '滑步車': { normal: 1400, early: 600 },
            },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 },
        },
        {
            name: '輕車（新竹市東區）',
            pre: '2025/11/25 ~ 12/02',
            post: '2025/12/09 ~ 12/16',
            prices: {
                '大鐵人': { normal: 3300, early: 2500 },
                '小鐵人': { normal: 2700, early: 1900 },
                '滑步車': { normal: 1400, early: 600 },
            },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 },
        },
        {
            name: '風城（新竹市東區）',
            pre: '2025/11/25 ~ 12/02',
            post: '2025/12/09 ~ 12/16',
            prices: {
                '大鐵人': { normal: 3300, early: 2500 },
                '小鐵人': { normal: 2700, early: 1900 },
                '滑步車': { normal: 1400, early: 600 },
            },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 },
        },
        {
            name: '丸鐵（高雄市三民區）',
            pre: '2025/11/25 ~ 12/02',
            post: '2025/12/09 ~ 12/16',
            prices: {
                '大鐵人': { normal: 3000, early: 2200 },
                '小鐵人': { normal: 2400, early: 1600 },
                '滑步車': { normal: 1400, early: 600 },
            },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 },
        },
    ])

    // 加值服務
    const addOn = ref({
        material: false,
        nakedConfirm: false,
        purchasePolicy: false,
        usagePolicy: false,
    })

    // 計算總價
    const totalPrice = computed(() => {
        let sum = 0
        stores.value.forEach(store => {
            for (let type in store.quantity) {
                const qty = store.quantity[type]
                if (qty > 0) sum += store.prices[type].early * qty
            }
        })
        return sum >= 20 ? Math.round(sum * 0.9) : sum
    })

    // 優惠券
    const couponCode = ref('')
    const couponDiscount = ref(0)
    const coupons = ref([])
    const loadCoupons = async () => {
        try {
            const { data } = await axios.get(`${API}/tickets/${user.id}`)
            coupons.value = data.map(t => ({ id: t.id, code: t.uuid, discount: t.discount, used: t.used }))
        } catch (err) { console.error(err) }
    }
    const applyCoupon = async () => {
        const coupon = coupons.value.find(c => c.code === couponCode.value && !c.used)
        if (coupon) {
            couponDiscount.value = coupon.discount
            try { await axios.patch(`${API}/tickets/${coupon.id}/use`) } catch (err) { console.error(err) }
            coupon.used = true
            alert(`已套用優惠券，折抵 ${coupon.discount} 元`)
        } else {
            alert('優惠券不可用')
        }
    }
    const finalPrice = computed(() => Math.max(totalPrice.value - couponDiscount.value, 0))

    const reserve = async () => {
        if (!addOn.value.nakedConfirm || !addOn.value.purchasePolicy || !addOn.value.usagePolicy) {
            alert('請確認已閱讀並同意所有規定')
            return
        }
        try {
            for (const store of stores.value) {
                for (const type in store.quantity) {
                    const qty = store.quantity[type]
                    for (let i = 0; i < qty; i++) {
                        await axios.post(`${API}/reservations`, {
                            userId: user.id,
                            ticketType: type,
                            store: store.name,
                            event: eventDetail.value.name
                        })
                    }
                }
            }
            alert(`✅ 已成功預約\n總金額：${finalPrice.value} 元`)
        } catch (err) { console.error(err) }
    }

    onMounted(() => {
        fetchEvent()
        if (user) loadCoupons()
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
