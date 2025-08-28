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
            <div class="flex items-center gap-3 mb-2">
                <label class="flex items-center gap-2">
                    <input type="checkbox" v-model="addOn.material" class="mr-1" />
                    加購包材 100 元/份
                </label>
                <input type="number" min="0" class="w-24 border px-2 py-1" v-model.number="addOn.materialCount"
                    :disabled="!addOn.material" />
            </div>
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
            <label class="block mb-2 font-semibold">可用優惠券</label>
            <div v-if="availableCoupons.length === 0" class="text-sm text-gray-500">目前沒有可用的優惠券</div>
            <div v-else class="space-y-2">
                <div v-for="c in availableCoupons" :key="c.uuid" class="flex items-center justify-between border px-3 py-2">
                    <div class="text-sm">
                        <div class="font-medium">{{ c.type || '優惠券' }} • 折抵 {{ c.discount || 0 }} 元</div>
                        <div class="text-gray-500 text-xs">編號：{{ c.uuid }}<span v-if="c.expiry">｜到期：{{ formatDate(c.expiry) }}</span></div>
                    </div>
                    <button class="px-3 py-1 border text-sm" @click="() => { couponCodeInput = c.uuid; applyCoupon() }">套用</button>
                </div>
            </div>
            <div class="mt-3 text-xs text-gray-500">也可手動輸入券號：</div>
            <div class="flex gap-2 mt-1">
                <input v-model="couponCodeInput" type="text" placeholder="輸入票券編號" class="flex-1 border px-2 py-1" />
                <button @click="applyCoupon" class="px-4 bg-[#D90000] text-white">套用</button>
            </div>
            <p v-if="selectedCoupon" class="text-green-600 mt-2">已折抵 {{ selectedCoupon.discount }} 元（{{ selectedCoupon.uuid }}）</p>
        </div>

        <!-- 預約摘要與總金額 -->
        <div class="bg-white border p-4 mb-4 shadow">
            <h3 class="font-semibold mb-2">預約摘要</h3>
            <ul class="list-disc ml-6 text-sm text-gray-700 space-y-1">
                <li v-for="s in selectionsPreview" :key="s.key">{{ s.store }}｜{{ s.type }} × {{ s.qty }}（單價 {{ s.unit }}）</li>
            </ul>
            <div class="text-right mt-3 text-sm text-gray-700">
                <div>小計：TWD {{ subtotal }}</div>
                <div v-if="addOn.material && addOn.materialCount > 0">包材：TWD {{ addOn.materialCount * 100 }}</div>
                <div v-if="selectedCoupon">折抵：-TWD {{ selectedCoupon.discount }}</div>
            </div>
            <div class="text-lg font-bold text-right mt-1">
                總金額：TWD {{ finalTotal }}
            </div>
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
    const API = 'https://api.xiaozhi.moe/uat/leader_online'

    // 賽事資料
    const eventDetail = ref({ id: null, code: '', name: '', date: '', deadline: '', description: '', deliveryNotes: [], starts_at: null, ends_at: null })
    const fetchEvent = async () => {
        try {
            const { data } = await api.get(`${API}/events/${route.params.id}`)
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

    // 場次店面（從後端載入）
    const stores = ref([])
    const fmtDate = (d) => {
        if (!d) return ''
        const dt = new Date(d)
        if (Number.isNaN(dt.getTime())) return d
        return `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`
    }
    const makeQuantity = (prices) => { const q = {}; Object.keys(prices || {}).forEach(k => q[k] = 0); return q }
    const fetchStores = async () => {
        try {
            const { data } = await api.get(`${API}/events/${route.params.id}/stores`)
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            stores.value = list.map(s => ({
                id: s.id,
                name: s.name,
                pre: s.pre_start && s.pre_end ? `${fmtDate(s.pre_start)} ~ ${fmtDate(s.pre_end)}` : '',
                post: s.post_start && s.post_end ? `${fmtDate(s.post_start)} ~ ${fmtDate(s.post_end)}` : '',
                prices: s.prices || {},
                quantity: makeQuantity(s.prices || {})
            }))
        } catch (e) { console.error(e) }
    }

    // 加值服務與勾選
    const addOn = ref({ material: false, materialCount: 0, nakedConfirm: false, purchasePolicy: false, usagePolicy: false })

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

    // 優惠券
    const coupons = ref([]) // {id, uuid, discount, used, expiry}
    const selectedCoupon = ref(null)
    const couponCodeInput = ref('')
    const loadCoupons = async () => {
        try {
            const { data } = await api.get(`${API}/tickets/me`)
            coupons.value = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
        } catch (err) { console.error(err) }
    }
    const availableCoupons = computed(() => {
        const now = new Date()
        return coupons.value.filter(c => {
            if (c.used) return false
            if (c.expiry) {
                const d = new Date(c.expiry)
                if (!Number.isNaN(d.getTime()) && d < now) return false
            }
            return true
        })
    })
    const applyCoupon = () => {
        const found = coupons.value.find(c => c.uuid === couponCodeInput.value && !c.used)
        if (!found) { alert('優惠券不可用'); return }
        if (found.expiry) {
            const exp = new Date(found.expiry)
            if (!Number.isNaN(exp.getTime()) && exp < new Date()) { alert('優惠券已過期'); return }
        }
        selectedCoupon.value = { id: found.id, uuid: found.uuid, discount: found.discount || 0 }
        alert(`已套用優惠券，折抵 ${selectedCoupon.value.discount} 元`)
    }
    const finalTotal = computed(() => Math.max(subtotal.value + (addOn.value.material ? (100 * Math.max(0, addOn.value.materialCount || 0)) : 0) - (selectedCoupon.value?.discount || 0), 0))

    const selectionsPreview = computed(() => {
        const items = []
        stores.value.forEach(store => {
            for (const type in store.quantity) {
                const qty = store.quantity[type]
                if (qty > 0) {
                    const unit = isEarlyBird.value ? store.prices[type].early : store.prices[type].normal
                    items.push({ key: `${store.name}-${type}`, store: store.name, type, qty, unit })
                }
            }
        })
        return items
    })

    // 是否同時建立 reservations（每張票都建一筆）
    // 預約紀錄在訂單「已完成」時由後端建立，這裡不先建立

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
                        unitPrice: (isEarlyBird.value ? store.prices[type].early : store.prices[type].normal),
                        subtotal: (isEarlyBird.value ? store.prices[type].early : store.prices[type].normal) * qty
                    })
                }
            }
        })
        const totalQty = selections.reduce((s, x) => s + x.qty, 0)
        if (!totalQty) { alert('尚未選擇數量'); return }

        try {
            const details = {
                kind: 'event-reservation',
                event: { id: eventDetail.value.id, code: eventDetail.value.code, name: eventDetail.value.name, date: eventDetail.value.date || formatRange(eventDetail.value.starts_at, eventDetail.value.ends_at) },
                selections,
                addOn: addOn.value,
                subtotal: subtotal.value,
                coupon: selectedCoupon.value ? { code: selectedCoupon.value.uuid, discount: selectedCoupon.value.discount } : null,
                addOnCost: addOn.value.material ? (100 * Math.max(0, addOn.value.materialCount || 0)) : 0,
                total: finalTotal.value,
                quantity: totalQty,
                status: '待匯款'
            }
            await api.post(`${API}/orders`, { items: [details] })

            if (selectedCoupon.value?.id) {
                try { await api.patch(`${API}/tickets/${selectedCoupon.value.id}/use`) } catch { }
            }

            alert(`✅ 已成功建立訂單\n總金額：${finalTotal.value} 元`)
            localStorage.setItem('openOrders', '1')
            router.push('/store')
        } catch (err) {
            alert(err?.response?.data?.message || err.message || '系統錯誤')
        }
    }

    const checkSession = async () => {
        try { const { data } = await api.get(`${API}/whoami`); return !!data?.ok } catch { return false }
    }

    onMounted(async () => {
        const ok = await checkSession(); if (!ok) { alert('請先登入'); return router.push('/login') }
        await fetchEvent()
        await fetchStores()
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
