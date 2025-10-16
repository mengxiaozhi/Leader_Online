<template>
    <main class="pt-0 pb-12 px-4 max-w-5xl mx-auto">
        <!-- Hero Cover -->
        <div class="relative w-full mb-4 overflow-hidden" style="aspect-ratio: 3/2;">
            <img :src="eventDetail.cover || '/logo.png'" @error="(e)=>e.target.src='/logo.png'" alt="event cover" class="absolute inset-0 w-full h-full object-cover" />
            <div class="absolute inset-0 bg-gradient-to-tr from-black/40 via-transparent to-red-700/20 pointer-events-none"></div>
            <div class="absolute bottom-3 left-4 right-4 z-10">
                <h1 class="text-2xl sm:text-3xl font-bold text-white drop-shadow">{{ eventDetail.name }}</h1>
                <p class="text-sm text-white/90">📅 {{ eventDetail.date || formatRange(eventDetail.starts_at, eventDetail.ends_at) }}</p>
            </div>
        </div>

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

        <div v-if="!loggedIn" class="bg-amber-50 border border-amber-200 text-amber-800 p-4 mb-4">
            <p class="text-sm">登入後才能使用票券或送出預約。</p>
        </div>

        <!-- 門市價格表 -->
        <div v-for="(store, sIdx) in stores" :key="store.name" class="bg-white border p-4 mb-4 shadow">
            <h3 class="font-bold text-lg text-primary mb-2">{{ store.name }}</h3>
            <p class="text-sm text-gray-600 mb-2">賽前交車：{{ store.pre }}｜賽後取車：{{ store.post }}</p>
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
                                      :max="ticketsRemainingByType[type] + (store.useTickets[type] || 0)"
                                      :disabled="!loggedIn"
                                    />
                                    <small v-if="loggedIn" class="text-gray-500">可用：{{ ticketsRemainingByType[type] }}</small>
                                    <small v-else class="text-gray-400">登入後可使用票券</small>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- 加值服務與確認 -->
        <div class="bg-white border p-4 mb-4 shadow">
            <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-2">
                <label class="flex items-center gap-2">
                    <input type="checkbox" v-model="addOn.material" class="mr-1" />
                    加購包材 100 元/份
                </label>
                <input type="number" inputmode="numeric" pattern="[0-9]*" min="0" class="w-full sm:w-24 border px-2 py-1" v-model.number="addOn.materialCount"
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

        <!-- 票券提示 -->
        <div class="bg-white border p-4 mb-4 shadow" v-if="loggedIn && Object.keys(ticketsAvailableByType).length">
            <div class="text-sm text-gray-700">
                可用票券：
                <span v-for="(cnt, t) in ticketsAvailableByType" :key="t" class="inline-block mr-3">{{ t }} × {{ cnt }}</span>
            </div>
        </div>
        <div class="bg-white border p-4 mb-4 shadow" v-else-if="!loggedIn">
            <div class="text-sm text-gray-600">登入後可查看可用票券與折抵紀錄。</div>
        </div>

        <!-- 預約摘要與總金額 -->
        <div class="bg-white border p-4 mb-4 shadow">
            <h3 class="font-semibold mb-2">預約摘要</h3>
            <ul class="list-disc ml-6 text-sm text-gray-700 space-y-1">
                <li v-for="s in selectionsPreview" :key="s.key">{{ s.store }}｜{{ s.type }} × {{ s.qty }}（{{ s._byTicket ? '使用票券' : ('單價 ' + s.unit) }}）</li>
            </ul>
            <div class="text-right mt-3 text-sm text-gray-700">
                <div>小計：TWD {{ subtotal }}</div>
                <div v-if="addOn.material && addOn.materialCount > 0">包材：TWD {{ addOn.materialCount * 100 }}</div>
            </div>
            <div class="text-lg font-bold text-right mt-1">
                總金額：TWD {{ finalTotal }}
            </div>
        </div>

        <div class="sticky bottom-0 left-0 right-0 bg-white border-t p-3 md:static md:border-0 md:p-0 pb-safe z-20">
            <button @click="confirmReserve" class="w-full btn btn-primary text-white py-2 hover:opacity-90 flex items-center justify-center gap-2">
                <AppIcon name="orders" class="h-4 w-4" /> 確認預約
            </button>
        </div>
    </main>
</template>

<script setup>
    import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
    import { useRoute, useRouter } from 'vue-router'
    import api from '../api/axios'
    import AppIcon from '../components/AppIcon.vue'
    import { showNotice } from '../utils/sheet'
    import QuantityStepper from '../components/QuantityStepper.vue'

    const route = useRoute()
    const router = useRouter()
    const API = 'https://api.xiaozhi.moe/uat/leader_online'

    // 從網址參數取得活動代碼
    const routeCode = computed(() => String(route.params.code || ''))
    const currentEventId = ref(null)
    const loggedIn = ref(false)
    const sessionProfile = ref(null)

    // 賽事資料
    const eventDetail = ref({ id: null, code: '', name: '', date: '', deadline: '', description: '', cover: '', deliveryNotes: [], starts_at: null, ends_at: null })
    const fetchEvent = async (id) => {
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
    }
    function safeParseArray(s) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] } }

    // 場次店面（從後端載入）
    const stores = ref([])
    const tickets = ref([])
    // 票種名稱正規化：移除空白、結尾的「隊/組」、結尾括號附註
    const normalizeTypeName = (t) => {
        let s = String(t || '').trim()
        if (!s) return ''
        // 移除所有空白
        s = s.replace(/\s+/g, '')
        // 去除開頭的代碼/數字（如 EV123、E2、2 等）
        s = s.replace(/^(EV|E)?\d{1,8}/i, '')
        // 去除結尾括號（含全形/半形）及其內容，例如：大鐵人(隊)、大鐵人（附註）
        s = s.replace(/[（(][^（）()]*[）)]\s*$/, '')
        // 去除常見尾綴（僅末尾）：單車託運券/託運券/票券/憑證/入場券/券
        s = s.replace(/(單車託運券|託運券|票券|憑證|入場券|券)\s*$/, '')
        // 去除結尾的「隊/組」（避免『大鐵人隊』無法匹配『大鐵人』）
        s = s.replace(/(隊|組)\s*$/, '')
        return s
    }
    const fmtDate = (d) => {
        if (!d) return ''
        const dt = new Date(d)
        if (Number.isNaN(dt.getTime())) return d
        return `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`
    }
    const makeQuantity = (prices) => { const q = {}; Object.keys(prices || {}).forEach(k => q[k] = 0); return q }
    const makeUseTickets = (prices) => { const q = {}; Object.keys(prices || {}).forEach(k => q[k] = 0); return q }
    const fetchStores = async (id) => {
        try {
            const { data } = await api.get(`${API}/events/${id}/stores`)
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            stores.value = list.map(s => ({
                id: s.id,
                name: s.name,
                pre: s.pre_start && s.pre_end ? `${fmtDate(s.pre_start)} ~ ${fmtDate(s.pre_end)}` : '',
                post: s.post_start && s.post_end ? `${fmtDate(s.post_start)} ~ ${fmtDate(s.post_end)}` : '',
                prices: s.prices || {},
                quantity: makeQuantity(s.prices || {}),
                useTickets: makeUseTickets(s.prices || {}),
            }))
        } catch (e) { console.error(e) }
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
    const ticketsAvailableByKey = computed(() => {
        const m = {}
        for (const t of tickets.value) {
            if (t.used) continue
            const key = normalizeTypeName(t.type)
            if (!key) continue
            m[key] = (m[key] || 0) + 1
        }
        return m
    })

    const ticketsRemainingByType = computed(() => {
        // 以「正規化 key」為主扣除欲使用數量，再映射回各門市的顯示車型名稱
        const remainingByKey = { ...ticketsAvailableByKey.value }
        // 扣掉目前所有門市欲使用的票券數（同一正規化 key 共享數量）
        for (const s of stores.value) {
            for (const k of Object.keys(s.useTickets || {})) {
                const want = Number(s.useTickets[k] || 0)
                const key = normalizeTypeName(k)
                if (!remainingByKey[key]) remainingByKey[key] = 0
                remainingByKey[key] = Math.max(0, remainingByKey[key] - want)
            }
        }
        // 為了模板中能以門市的『原始車型名稱』索引剩餘數量，將每個店面的車型映回對應的 key
        const m = {}
        const allTypes = new Set()
        for (const s of stores.value) {
            Object.keys(s.prices || {}).forEach(t => allTypes.add(t))
            Object.keys(s.useTickets || {}).forEach(t => allTypes.add(t))
        }
        for (const type of allTypes) {
            const key = normalizeTypeName(type)
            m[type] = Number(remainingByKey[key] || 0)
        }
        return m
    })

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
        const max = Number(ticketsRemainingByType.value[type] || 0) + cur
        const v = Math.max(0, Math.min(max, cur + Number(d || 0)))
        store.useTickets[type] = v
    }

    const selectionsPreview = computed(() => {
        const items = []
        // 票券使用（單價 0）
        stores.value.forEach(store => {
            for (const type in store.useTickets) {
                const qty = Number(store.useTickets[type] || 0)
                if (qty > 0) items.push({ key: `T-${store.name}-${type}`, store: store.name, type, qty, unit: 0, _byTicket: true })
            }
        })
        // 付費數量
        stores.value.forEach(store => {
            for (const type in store.quantity) {
                const qty = Number(store.quantity[type] || 0)
                if (qty > 0) {
                    const unit = isEarlyBird.value ? store.prices[type].early : store.prices[type].normal
                    items.push({ key: `P-${store.name}-${type}`, store: store.name, type, qty, unit, _byTicket: false })
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
        if (!(await checkSession())) {
            await showNotice('請先登入再預約', { title: '需要登入' })
            const redirectTarget = route.fullPath || route.path
            router.push({ path: '/login', query: { redirect: redirectTarget } })
            return
        }
        if (!addOn.value.nakedConfirm || !addOn.value.purchasePolicy || !addOn.value.usagePolicy) { await showNotice('請先勾選所有規定確認'); return }
        if (!(await ensureContactInfoReady())) return

        const selections = []
        // 準備依「正規化後的車型」分配票券 ID（FIFO）
        const poolByKey = {}
        for (const t of tickets.value) {
            if (t.used) continue
            const key = normalizeTypeName(t.type)
            if (!key) continue
            if (!poolByKey[key]) poolByKey[key] = []
            poolByKey[key].push(t)
        }
        const usedTicketIds = []
        // 票券使用 selections
        for (const store of stores.value) {
            for (const type in store.useTickets) {
                const need = Number(store.useTickets[type] || 0)
                if (need > 0) {
                    const key = normalizeTypeName(type)
                    const pool = poolByKey[key] || []
                    if (pool.length < need) { await showNotice(`票券不足：${type}`, { title: '庫存不足' }); return }
                    const taken = pool.splice(0, need)
                    usedTicketIds.push(...taken.map(x => x.id))
                    selections.push({ store: store.name, type, qty: need, unitPrice: 0, subtotal: 0, byTicket: true })
                }
            }
        }
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
