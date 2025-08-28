<template>
    <main class="pt-6 pb-12 px-4 max-w-5xl mx-auto">
        <h1 class="text-2xl font-bold text-[#D90000] mb-6 text-center">
            {{ eventDetail.name }} 單車託運預約
        </h1>

        <!-- 賽事資訊 -->
        <div class="bg-white border p-6 shadow mb-6">
            <p class="mb-2 font-semibold">商品編號：{{ eventDetail.code }}</p>
            <p>比賽日期：{{ eventDetail.date || formatRange(eventDetail.starts_at, eventDetail.ends_at) }}</p>
            <p v-if="eventDetail.deadline">報名截止日期：{{ eventDetail.deadline }}</p>
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
                <input v-model="couponCodeInput" type="text" placeholder="輸入票券編號" class="flex-1 border px-2 py-1" />
                <button @click="applyCoupon" class="px-4 bg-[#D90000] text-white">套用</button>
            </div>
            <p v-if="selectedCoupon" class="text-green-600 mt-2">已折抵 {{ selectedCoupon.discount }} 元（{{
                selectedCoupon.uuid }}）</p>
        </div>

        <!-- 總金額 -->
        <div class="text-lg font-bold text-right mb-4">
            總金額：TWD {{ finalTotal }}
        </div>

        <button @click="confirmReserve" class="w-full bg-[#D90000] text-white py-2 hover:bg-[#B00000]">
            確認預約
        </button>
    </main>
</template>

<script setup>
    import { ref, computed, onMounted } from 'vue'
    import { useRoute, useRouter } from 'vue-router'
    import api from '../api/axios'

    const route = useRoute()
    const router = useRouter()

    // 賽事資料
    const eventDetail = ref({ id: null, code: '', name: '', date: '', deadline: '', description: '', deliveryNotes: [], starts_at: null, ends_at: null })
    const fetchEvent = async () => {
        try {
            const { data } = await api.get(`/events/${route.params.id}`)
            const e = data?.data || data || {}
            const rules = Array.isArray(e.rules) ? e.rules : (e.rules ? safeParseArray(e.rules) : [])
            eventDetail.value = {
                id: e.id,
                code: e.code || '',
                name: e.name || e.title || '',
                date: e.date || '',
                deadline: e.deadline || e.ends_at || '',
                starts_at: e.starts_at || e.start_at || null,
                ends_at: e.ends_at || e.end_at || null,
                description: e.description || '',
                deliveryNotes: rules
            }
        } catch (err) { console.error(err) }
    }
    function safeParseArray(s) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] } }

    // 門市價格（示例）
    const stores = ref([
        {
            name: '小巨蛋（台北市松山區）', pre: '2025/11/25 ~ 12/02', post: '2025/12/09 ~ 12/16',
            prices: { '大鐵人': { normal: 3000, early: 2200 }, '小鐵人': { normal: 2400, early: 1600 }, '滑步車': { normal: 1400, early: 600 } },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 }
        },
        {
            name: '277（台北市大安區）', pre: '2025/11/25 ~ 12/02', post: '2025/12/09 ~ 12/16',
            prices: { '大鐵人': { normal: 3000, early: 2200 }, '小鐵人': { normal: 2400, early: 1600 }, '滑步車': { normal: 1400, early: 600 } },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 }
        },
        {
            name: '瘋三鐵（台北市內湖區）', pre: '2025/11/25 ~ 12/02', post: '2025/12/09 ~ 12/16',
            prices: { '大鐵人': { normal: 3000, early: 2200 }, '小鐵人': { normal: 2400, early: 1600 }, '滑步車': { normal: 1400, early: 600 } },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 }
        },
        {
            name: '老學長（新竹市東區）', pre: '2025/11/25 ~ 12/02', post: '2025/12/09 ~ 12/16',
            prices: { '大鐵人': { normal: 3300, early: 2500 }, '小鐵人': { normal: 2700, early: 1900 }, '滑步車': { normal: 1400, early: 600 } },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 }
        },
        {
            name: '輕車（新竹市東區）', pre: '2025/11/25 ~ 12/02', post: '2025/12/09 ~ 12/16',
            prices: { '大鐵人': { normal: 3300, early: 2500 }, '小鐵人': { normal: 2700, early: 1900 }, '滑步車': { normal: 1400, early: 600 } },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 }
        },
        {
            name: '風城（新竹市東區）', pre: '2025/11/25 ~ 12/02', post: '2025/12/09 ~ 12/16',
            prices: { '大鐵人': { normal: 3300, early: 2500 }, '小鐵人': { normal: 2700, early: 1900 }, '滑步車': { normal: 1400, early: 600 } },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 }
        },
        {
            name: '丸鐵（高雄市三民區）', pre: '2025/11/25 ~ 12/02', post: '2025/12/09 ~ 12/16',
            prices: { '大鐵人': { normal: 3000, early: 2200 }, '小鐵人': { normal: 2400, early: 1600 }, '滑步車': { normal: 1400, early: 600 } },
            quantity: { '大鐵人': 0, '小鐵人': 0, '滑步車': 0 }
        },
    ])

    // 加值服務與勾選
    const addOn = ref({ material: false, nakedConfirm: false, purchasePolicy: false, usagePolicy: false })

    // 價格計算（>=20 件 9 折）
    const subtotal = computed(() => {
        let sum = 0
        stores.value.forEach(store => {
            for (const type in store.quantity) {
                const qty = store.quantity[type]
                if (qty > 0) sum += store.prices[type].early * qty
            }
        })
        return sum >= 20 ? Math.round(sum * 0.9) : sum
    })

    // 優惠券
    const coupons = ref([]) // {id, uuid, discount, used, expiry}
    const selectedCoupon = ref(null)
    const couponCodeInput = ref('')
    const loadCoupons = async () => {
        try {
            const { data } = await api.get('/tickets/me')
            coupons.value = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
        } catch (err) { console.error(err) }
    }
    const applyCoupon = () => {
        const found = coupons.value.find(c => c.uuid === couponCodeInput.value && !c.used)
        if (!found) { alert('優惠券不可用'); return }
        selectedCoupon.value = { id: found.id, uuid: found.uuid, discount: found.discount || 0 }
        alert(`已套用優惠券，折抵 ${selectedCoupon.value.discount} 元`)
    }
    const finalTotal = computed(() => Math.max(subtotal.value - (selectedCoupon.value?.discount || 0), 0))

    // 是否同時建立 reservations（每張票都建一筆）
    const CREATE_RESERVATIONS = true
    const createReservationsIfNeeded = async () => {
        if (!CREATE_RESERVATIONS) return
        const jobs = []
        stores.value.forEach(store => {
            for (const type in store.quantity) {
                const qty = store.quantity[type]
                for (let i = 0; i < qty; i++) {
                    jobs.push(api.post('/reservations', {
                        ticketType: type,
                        store: store.name,
                        // 後端目前是 VARCHAR 欄位；若未來改 INT 外鍵，可傳 eventId
                        event: eventDetail.value.name
                    }))
                }
            }
        })
        if (jobs.length) await Promise.all(jobs)
    }

    // 共用格式化
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

    // 建立訂單（單筆 items[0]）
    const confirmReserve = async () => {
        if (!addOn.value.nakedConfirm || !addOn.value.purchasePolicy || !addOn.value.usagePolicy) {
            alert('請先勾選所有規定確認'); return
        }

        const selections = []
        stores.value.forEach(store => {
            for (const type in store.quantity) {
                const qty = store.quantity[type]
                if (qty > 0) {
                    selections.push({
                        store: store.name,
                        type,
                        qty,
                        unitPrice: store.prices[type].early,
                        subtotal: store.prices[type].early * qty
                    })
                }
            }
        })
        const totalQty = selections.reduce((s, x) => s + x.qty, 0)
        if (!totalQty) { alert('尚未選擇數量'); return }

        try {
            await createReservationsIfNeeded()

            const details = {
                kind: 'event-reservation',
                event: { id: eventDetail.value.id, code: eventDetail.value.code, name: eventDetail.value.name, date: eventDetail.value.date || formatRange(eventDetail.value.starts_at, eventDetail.value.ends_at) },
                selections,
                addOn: addOn.value,
                subtotal: subtotal.value,
                coupon: selectedCoupon.value ? { code: selectedCoupon.value.uuid, discount: selectedCoupon.value.discount } : null,
                total: finalTotal.value,
                quantity: totalQty,
                status: '待匯款'
            }
            await api.post('/orders', { items: [details] })

            if (selectedCoupon.value?.id) {
                try { await api.patch(`/tickets/${selectedCoupon.value.id}/use`) } catch { }
            }

            alert(`✅ 已成功建立訂單\n總金額：${finalTotal.value} 元`)
            localStorage.setItem('openOrders', '1')
            router.push('/store')
        } catch (err) {
            alert(err?.response?.data?.message || err.message || '系統錯誤')
        }
    }

    onMounted(async () => {
        await fetchEvent()
        await loadCoupons()
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
