<template>
    <main class="pt-6 pb-12 px-4">
        <div class="max-w-6xl mx-auto space-y-8">
            <section v-if="bookingActionCards.length" class="mb-4">
                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    <div v-for="card in bookingActionCards" :key="card.key"
                        class="card-quiet px-4 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div class="space-y-1">
                            <p class="text-sm font-medium text-gray-800">{{ card.title }}</p>
                            <p class="text-sm text-gray-600" v-if="card.subtitle">{{ card.subtitle }}</p>
                        </div>
                        <button v-if="card.actionLabel"
                            class="btn btn-outline btn-sm self-start sm:self-auto whitespace-nowrap"
                            @click="handleBookingActionCard(card)">
                            {{ card.actionLabel }}
                        </button>
                    </div>
                </div>
            </section>

            <div v-if="loadingEvent" class="ticket-card bg-white overflow-hidden animate-pulse">
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
                        <div class="absolute inset-0 bg-gradient-to-tr from-black/40 via-transparent to-primary/20 pointer-events-none"></div>
                        <div class="absolute bottom-3 left-4 right-4 z-10 space-y-1">
                            <p v-if="eventDetail.code" class="text-sm tracking-[0.04em] text-white/85">服務 {{ eventDetail.code }}</p>
                            <h2 class="ui-title text-2xl sm:text-3xl font-medium text-white">{{ eventDetail.name }}</h2>
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
                    <h3 class="ui-title text-lg font-medium text-gray-900 flex items-center gap-2">
                        <AppIcon name="store" class="h-5 w-5 text-primary" /> 交車點選擇
                    </h3>
                    <span class="text-sm text-gray-600">每筆預約綁定單一交車點，收款資訊未設定時使用平台匯款資訊</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div class="card-quiet p-4">
                        <p class="text-sm tracking-[0.04em] text-gray-600 mb-2">已選交車點</p>
                        <p class="font-medium text-gray-800">{{ selectedStore?.name || '尚未選擇' }}</p>
                        <p class="text-sm text-gray-600 mt-1">地址、電話與營業時間可點「交車點資訊」查看。</p>
                    </div>
                    <div class="card-quiet p-4">
                        <p class="text-sm tracking-[0.04em] text-gray-600 mb-2">已選價格</p>
                        <p class="font-medium text-gray-800 whitespace-pre-line">{{ selectedStorePriceSummary || '請先從下方價格卡選擇交車點' }}</p>
                    </div>
                </div>
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <AppSearchInput
                        v-model="storeSearch"
                        placeholder="搜尋交車點資訊（名稱或方案項目）"
                        container-class="relative w-full sm:w-80"
                        @clear="clearStoreSearch"
                    />
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
                    <div v-for="i in 4" :key="`store-skel-${i}`" class="ticket-card bg-white p-5 animate-pulse space-y-4">
                        <div class="h-5 w-1/2 bg-gray-200 rounded"></div>
                        <div class="h-4 w-3/4 bg-gray-200 rounded"></div>
                        <div class="h-36 bg-gray-200 rounded"></div>
                    </div>
                </div>
                <div v-else-if="!filteredStores.length" class="ticket-card bg-white p-5 text-sm text-gray-600">
                    {{ storeSearch ? '沒有符合搜尋條件的交車點資訊。' : '目前尚無可用交車點資訊。' }}
                </div>
                <template v-else>
                    <div class="space-y-4">
                        <div v-for="(store, storeIdx) in displayedStores" :key="store.id || `${store.name}-${storeIdx}`" class="ticket-card bg-white p-4 sm:p-5">
                            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                                <div class="space-y-1">
                                    <h4 class="ui-title text-lg font-medium text-primary">{{ store.name }}</h4>
                                    <p class="text-sm" :class="isStoreCapacityFull(store) ? 'text-red-600' : 'text-gray-600'">{{ storeCapacityLabel(store) }}</p>
                                </div>
                                <div class="flex items-center gap-3 flex-wrap justify-between sm:justify-end w-full sm:w-auto">
                                    <button class="btn btn-outline btn-sm" @click="openStoreDetail(store)">
                                        <AppIcon name="info" class="h-4 w-4" /> 交車點資訊
                                    </button>
                                    <span class="text-sm text-gray-600 tracking-[0.04em]">
                                        交車地點 {{ shouldPaginateStores ? ((activeStorePage - 1) * STORES_PAGE_SIZE) + storeIdx + 1 : storeIdx + 1 }}
                                    </span>
                                </div>
                            </div>

                            <div class="border-y border-red-100 py-4 bg-red-50/70 text-sm space-y-4">
                                <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                    <p class="text-sm font-medium tracking-[0.04em] text-red-600">此交車點價格</p>
                                    <p class="text-sm text-gray-600">地址、電話、營業時間請點交車點資訊</p>
                                </div>
                                <div v-if="storePriceEntries(store).length" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                    <div
                                        v-for="item in storePriceEntries(store)"
                                        :key="`${store.id || store.name}-${item.type}`"
                                        class="border-y bg-transparent py-3"
                                        :class="item.activeMode === 'early' ? 'border-red-200' : 'border-amber-200'"
                                    >
                                        <div class="flex h-full flex-col gap-3">
                                            <div>
                                                <p class="text-sm font-medium text-gray-800 leading-tight">{{ item.type }}</p>
                                                <div class="mt-2 flex items-end gap-2">
                                                    <span class="price-amount text-3xl sm:text-4xl font-medium tracking-tight leading-none" :class="storePriceValueClass(item)">
                                                        {{ formatPriceAmount(item.activePrice) }}
                                                    </span>
                                                    <span class="pb-1 text-sm font-medium tracking-[0.04em]" :class="item.activeMode === 'early' ? 'text-red-600' : 'text-amber-600'">
                                                        {{ item.activeMode === 'early' ? '早鳥' : '原價' }}
                                                    </span>
                                                </div>
                                                <div class="mt-2 flex flex-wrap gap-1 text-sm">
                                                    <span v-if="hasPriceValue(item.early)" class="rounded-lg bg-red-100 px-2 py-0.5 font-medium text-red-700">早鳥 {{ formatPriceAmount(item.early) }}</span>
                                                    <span v-if="hasPriceValue(item.normal)" class="rounded-lg bg-slate-100 px-2 py-0.5 font-medium text-slate-700">原價 {{ formatPriceAmount(item.normal) }}</span>
                                                </div>
                                            </div>
                                            <div class="space-y-3 border-t border-gray-200 pt-3">
                                                <div class="flex flex-col gap-2">
                                                    <div class="flex items-center justify-between gap-3">
                                                        <span class="text-sm font-medium text-gray-800">立即買票並預約</span>
                                                        <QuantityStepper
                                                            :model-value="quantityForStoreEntry(store, item)"
                                                            :min="0"
                                                            :max="quantityMaxForStoreEntry(store, item)"
                                                            :disabled="quantityMaxForStoreEntry(store, item) <= 0"
                                                            :aria-label="`${store.name} ${item.type} 購買數量`"
                                                            @update:modelValue="setStoreEntryQuantity(store, item, $event)"
                                                        />
                                                    </div>
                                                </div>
                                                <div class="flex flex-col gap-2">
                                                    <div class="flex items-center justify-between gap-3">
                                                        <span class="text-sm font-medium text-gray-800">使用票券抵扣</span>
                                                        <QuantityStepper
                                                            :model-value="useTicketsForStoreEntry(store, item)"
                                                            :min="0"
                                                            :max="ticketMaxForStoreEntry(store, item)"
                                                            :disabled="!loggedIn"
                                                            :aria-label="`${store.name} ${item.type} 票券抵扣數量`"
                                                            @update:modelValue="setStoreEntryUseTickets(store, item, $event)"
                                                        />
                                                    </div>
                                                    <div class="space-y-0.5">
                                                        <small v-if="loggedIn" class="block text-gray-600">可用：{{ ticketAvailableForStoreEntry(store, item) }}</small>
                                                        <small v-else class="block text-gray-600">登入後可使用票券</small>
                                                        <small v-if="loggedIn" class="block text-gray-600">{{ ticketBindingLabel(item.type, item) }}</small>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div v-else class="rounded-xl border border-dashed border-gray-300 bg-white/70 p-4 text-center font-medium text-gray-600">
                                    此交車點尚未設定價格。
                                </div>
                                <button
                                    class="btn btn-sm w-full sm:w-auto"
                                    :class="isSelectedStore(store) ? 'btn-primary text-white' : 'btn-outline'"
                                    :disabled="isStoreCapacityFull(store)"
                                    @click="selectServiceStore(store)"
                                >
                                    {{ isStoreCapacityFull(store) ? '收容數量已滿' : (isSelectedStore(store) ? '已選定此交車點，可直接調整數量' : '選擇此交車點') }}
                                </button>
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

            <div class="surface-section space-y-3">
                <h3 class="ui-title text-lg font-medium text-gray-900">加值服務與確認</h3>
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
                        <span>我已了解未妥善包裝之貨物不予託運</span>
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

            <div v-if="!loggedIn" class="ticket-card border border-amber-200 bg-amber-50 text-amber-800 p-4 sm:p-5">
                <h3 class="text-base font-medium mb-2">請先登入</h3>
                <p class="text-sm">登入後才能使用票券或送出預約，亦可查看可用票券與折抵紀錄。</p>
            </div>
            <div v-else-if="tickets.length" class="ticket-card border border-primary/30 bg-red-50/70 text-gray-800 p-4 sm:p-5">
                <h3 class="text-base font-medium mb-2 text-primary">可用票券</h3>
                <p class="text-sm text-gray-600 mb-2">已依綁定商品與舊票券名稱比對可抵扣方案。</p>
                <p class="text-sm flex flex-wrap gap-2">
                    <span v-for="ticket in tickets" :key="ticket.id || ticket.uuid" class="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-white px-2 py-1">
                        <AppIcon name="ticket" class="h-3.5 w-3.5 text-primary" /> {{ ticket.type || '票券' }}<span v-if="resolveProductId(ticket)" class="text-sm text-gray-600">商品 #{{ resolveProductId(ticket) }}</span>
                    </span>
                </p>
            </div>

            <div class="surface-section space-y-3">
                <h3 class="ui-title text-lg font-medium text-gray-900">預約摘要</h3>
                <ul class="space-y-1 text-sm text-gray-700">
                    <li v-if="!selectionsPreview.length" class="text-gray-600">尚未選擇任何數量。</li>
                    <li v-for="s in selectionsPreview" :key="s.key">{{ s.store }}｜{{ s.type || '方案' }} × {{ s.qty }}（{{ s._byTicket ? '使用票券' : ('單價 ' + s.unit) }}）</li>
                </ul>
                <div class="text-sm text-gray-700 space-y-1 text-right">
                    <div>小計：<span class="money-value">TWD {{ subtotal }}</span></div>
                    <div v-if="addOn.material && addOn.materialCount > 0">包材：<span class="money-value">TWD {{ addOn.materialCount * 100 }}</span></div>
                </div>
                <div class="money-value text-xl text-right text-primary">
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

        <Teleport to="body">
            <transition name="backdrop-fade">
                <div v-if="activeStoreDetail" class="fixed inset-0 bg-black/40 z-50" @click.self="closeStoreDetail"></div>
            </transition>
            <transition name="drawer-right">
                <aside v-if="activeStoreDetail"
                    class="fixed inset-y-0 right-0 w-full max-w-xl bg-white/95 backdrop-blur border-l border-gray-300 h-full p-6 z-50 rounded-l-3xl pb-safe overflow-y-auto">
                    <header class="flex items-start justify-between gap-3 mb-4">
                        <div>
                            <p class="text-sm tracking-[0.04em] text-gray-600">交車點資訊</p>
                            <h3 class="ui-title text-xl font-medium text-primary">{{ activeStoreDetail?.name }}</h3>
                        </div>
                        <button class="btn-ghost rounded-full px-2 py-1" title="關閉" @click="closeStoreDetail"><AppIcon name="x" class="h-5 w-5" /></button>
                    </header>

                    <div class="space-y-4 text-sm text-gray-700">
                        <div class="grid gap-3">
                            <div class="rounded-xl border border-gray-200 p-3">
                                <p class="text-sm tracking-[0.04em] text-gray-600 mb-1">地址</p>
                                <p class="font-medium text-gray-800">{{ activeStoreDetail?.address || activeStoreDetail?.location || '尚未提供地址' }}</p>
                            </div>
                            <div class="rounded-xl border border-gray-200 p-3">
                                <p class="text-sm tracking-[0.04em] text-gray-600 mb-1">電話</p>
                                <p class="font-medium text-gray-800">{{ activeStoreDetail?.phone || activeStoreDetail?.telephone || activeStoreDetail?.tel || '尚未提供電話' }}</p>
                            </div>
                            <div class="rounded-xl border border-gray-200 p-3">
                                <p class="text-sm tracking-[0.04em] text-gray-600 mb-1">收容數量</p>
                                <p class="font-medium" :class="isStoreCapacityFull(activeStoreDetail) ? 'text-red-600' : 'text-gray-800'">{{ storeCapacityLabel(activeStoreDetail) }}</p>
                            </div>
                        </div>

                        <div v-if="activeStoreHours.length" class="space-y-1">
                            <p class="text-sm tracking-[0.04em] text-gray-600">營業時間 / 服務說明</p>
                            <ul class="space-y-1">
                                <li v-for="line in activeStoreHours" :key="line" class="text-gray-800">{{ line }}</li>
                            </ul>
                        </div>
                        <div v-else class="rounded-xl border border-gray-300 p-3 text-gray-600">
                            尚未提供營業時間。
                        </div>

                        <div v-if="activeStoreDetail?.externalUrl" class="rounded-xl border border-gray-200 p-3 break-all">
                            <p class="text-sm tracking-[0.04em] text-gray-600 mb-1">服務連結</p>
                            <a :href="activeStoreDetail.externalUrl" target="_blank" rel="noreferrer" class="font-medium text-primary underline">{{ activeStoreDetail.externalUrl }}</a>
                        </div>

                        <div class="border border-gray-200 rounded-xl p-3">
                            <p class="text-sm font-medium text-gray-800 mb-2">價目表</p>
                            <div class="space-y-3">
                                <div v-for="item in activeStorePriceEntries" :key="item.type" class="flex items-center justify-between gap-3 text-sm">
                                    <div class="font-medium text-gray-800">{{ item.type }}</div>
                                    <div class="text-right">
                                        <div class="price-amount text-xl font-medium" :class="storePriceValueClass(item)">{{ formatPriceAmount(item.activePrice) }}</div>
                                        <div class="text-sm text-gray-600">{{ priceStageLabel(item) }}</div>
                                        <div class="text-sm text-gray-600">{{ earlyWindowLabel(item) }}</div>
                                    </div>
                                </div>
                                <p v-if="!activeStorePriceEntries.length" class="text-gray-600">尚未設定價目表。</p>
                            </div>
                        </div>
                    </div>
                </aside>
            </transition>
        </Teleport>
    </main>
</template>

<script setup>
    import { ref, computed, onMounted, watch, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
    import { API_BASE } from '../utils/api'
    import { useRoute, useRouter } from 'vue-router'
    import api from '../api/axios'
    import AppIcon from '../components/AppIcon.vue'
    import AppSearchInput from '../components/AppSearchInput.vue'
    import { showNotice } from '../utils/sheet'
    import { formatDateTime, formatDateTimeRange } from '../utils/datetime'
    import AppCard from '../components/AppCard.vue'
    const QuantityStepper = defineAsyncComponent(() => import('../components/QuantityStepper.vue'))

    const route = useRoute()
    const router = useRouter()
    const API = API_BASE

    const loadingEvent = ref(true)
    const loadingStores = ref(true)

    // 從網址參數取得服務代碼
    const routeCode = computed(() => String(route.params.code || ''))
    const currentEventId = ref(null)
    const loggedIn = ref(false)
    const sessionProfile = ref(null)

    const storesSectionRef = ref(null)
    const STORES_PAGE_SIZE = 10
    const activeStorePage = ref(1)
    const goWalletReservations = () => router.push({ path: '/wallet', query: { tab: 'reservations' } })

    // 服務檔期資料
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

    // 方案清單（從後端載入）
    const stores = ref([])
    const priceItems = ref([])
    const serviceSelection = ref({ storeId: '' })
    const activeStoreDetail = ref(null)
    const storeSearch = ref('')
    const filteredStores = computed(() => {
        const keyword = storeSearch.value.trim().toLowerCase()
        if (!keyword) return stores.value
        return stores.value.filter(store => {
            const fields = [
                store.name,
                store.location,
                store.address,
                store.businessHours,
                store.externalUrl,
                ...(Object.keys(store.prices || {}))
            ]
            return fields.some(field => String(field || '').toLowerCase().includes(keyword))
        })
    })
    const clearStoreSearch = () => { storeSearch.value = '' }
    const openStoreDetail = (store) => { activeStoreDetail.value = store || null }
    const closeStoreDetail = () => { activeStoreDetail.value = null }
    const activeStoreHours = computed(() => {
        const text = activeStoreDetail.value?.businessHours || activeStoreDetail.value?.business_hours || ''
        if (!text) return []
        return String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    })
    const tickets = ref([])
    const todayDate = () => {
        const now = new Date()
        return new Date(now.getFullYear(), now.getMonth(), now.getDate())
    }
    const parseDateOnly = (value) => {
        if (!value) return null
        const text = String(value).trim()
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
        if (!m) return null
        const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
        return Number.isNaN(dt.getTime()) ? null : dt
    }
    const isTicketExpired = (ticket) => {
        if (!ticket) return false
        const expiry = parseDateOnly(ticket.expiry)
        const expiredByDate = expiry ? expiry <= todayDate() : false
        if (ticket.expired !== undefined) {
            const expiredFlag = ticket.expired === true || ticket.expired === 1 || ticket.expired === '1' || String(ticket.expired).trim().toLowerCase() === 'true'
            return expiredFlag || expiredByDate
        }
        return expiredByDate
    }
    // 票種名稱正規化：移除空白、結尾的「隊/組」、結尾括號附註
    const normalizeTypeName = (t) => {
        let s = String(t || '').trim()
        if (!s) return ''
        s = s.replace(/\s+/g, '')
        s = s.replace(/^(EV|E)?\d{1,8}/i, '')
        s = s.replace(/[（(][^（）()]*[）)]\s*$/, '')
        s = s.replace(/(貨車託運券|託運券|票券|憑證|入場券|券)\s*$/, '')
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
    const bindingKeysForType = (type, info = {}) => {
        const productId = resolveProductId(info)
        const normalized = normalizeTypeName(type)
        const keys = []
        if (productId) return [`p-${productId}`]
        if (normalized) keys.push(`t-${normalized}`)
        return keys
    }
    const productIdForType = (info) => resolveProductId(info)
    const ticketBindingLabel = (type, info = {}) => {
        const productId = resolveProductId(info)
        if (productId) return `綁定商品 #${productId}`
        return `以票券名稱「${type}」比對`
    }
    const hasPriceValue = (value) => value !== undefined && value !== null && String(value).trim() !== '' && Number.isFinite(Number(value))
    const normalizePriceValue = (value) => hasPriceValue(value) ? Math.max(0, Number(value)) : null
    const normalizeCapacityValue = (value) => {
        if (value === undefined || value === null || String(value).trim() === '') return null
        const parsed = Math.floor(Number(value))
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    }
    const normalizeStorePrices = (prices = {}) => {
        const result = {}
        Object.keys(prices || {}).forEach(type => {
            const raw = prices[type] || {}
            const normal = normalizePriceValue(raw.normal)
            const early = normalizePriceValue(raw.early)
            if (normal === null && early === null) return
            const productId = resolveProductId(raw)
            const normalized = {
                ...raw,
                early_start: raw.early_start || raw.earlyStart || '',
                early_end: raw.early_end || raw.earlyEnd || '',
                productId: productId || null,
            }
            if (normal !== null) normalized.normal = normal
            if (early !== null) normalized.early = early
            result[type] = normalized
        })
        return result
    }
    const buildPriceItems = (prices = {}) => Object.keys(prices || {}).map(type => ({
        type,
        ...prices[type],
        quantity: 0,
        useTickets: 0,
    }))
    const fetchStores = async (id) => {
        loadingStores.value = true
        try {
            const { data } = await api.get(`${API}/events/${id}/stores`)
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            stores.value = list.map(s => {
                const address = s.address || s.location || s.city || ''
                const externalUrl = s.external_url || s.externalUrl || ''
                const businessHours = s.business_hours || s.businessHours || ''
                const capacity = normalizeCapacityValue(s.capacity)
                const reservedQuantity = Math.max(0, Math.floor(Number(s.reserved_quantity || s.reservedQuantity || 0)))
                const remainingInput = s.capacity_remaining ?? s.capacityRemaining
                const capacityRemaining = capacity === null
                    ? null
                    : Math.max(0, Math.floor(Number(remainingInput ?? (capacity - reservedQuantity))))
                return {
                    id: s.id,
                    eventId: s.event_id || s.eventId || currentEventId.value || null,
                    deliveryPointId: s.delivery_point_id || s.deliveryPointId || null,
                    name: s.name,
                    location: s.location || s.city || address || '',
                    address,
                    phone: s.phone || s.telephone || s.tel || '',
                    telephone: s.telephone || '',
                    tel: s.tel || '',
                    externalUrl,
                    businessHours,
                    capacity,
                    reservedQuantity,
                    capacityRemaining,
                    prices: normalizeStorePrices(s.prices || {}),
                }
            })
            activeStorePage.value = 1
            const selectedId = String(serviceSelection.value.storeId || '').trim()
            if (selectedId) {
                const matched = stores.value.find(item => String(item.id || '') === selectedId)
                if (matched) {
                    serviceSelection.value.storeId = String(matched.id || '')
                } else {
                    serviceSelection.value.storeId = ''
                }
            } else {
                serviceSelection.value.storeId = ''
            }
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
            tickets.value = list
                .filter(t => !t.used && !isTicketExpired(t))
                .map(t => ({ ...t, expired: false }))
        } catch (e) {
            if (e?.response?.status === 401) {
                loggedIn.value = false
                sessionProfile.value = null
            } else console.error(e)
        }
    }

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
        for (const item of priceItems.value) {
            let want = Number(item.useTickets || 0)
            if (want <= 0) continue
            for (const key of bindingKeysForType(item.type, item)) {
                if (!key || want <= 0) continue
                if (!remaining[key]) remaining[key] = 0
                const taken = Math.min(remaining[key], want)
                remaining[key] = Math.max(0, remaining[key] - taken)
                want -= taken
            }
        }
        return remaining
    })
    const ticketsRemainingFor = (type, info = {}) => {
        return bindingKeysForType(type, info).reduce((sum, key) => sum + Number(ticketsRemainingByBinding.value[key] || 0), 0)
    }

    // 加值服務與勾選
    const addOn = ref({ material: false, materialCount: 0, nakedConfirm: false, purchasePolicy: false, usagePolicy: false })

    // 目前預約總數（含使用票券與付費數量）
    const reservationQuantity = computed(() => {
        return priceItems.value.reduce((sum, item) => sum + Number(item.useTickets || 0) + Number(item.quantity || 0), 0)
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
                subtitle: '抵扣費用前，記得確認票券適用交車點資訊與方案項目',
                action: 'wallet',
                actionLabel: '檢視錢包'
            })
        }
        if (reservationQuantity.value > 0) {
            cards.push({
                key: 'reservation-progress',
                title: `已選 ${reservationQuantity.value} 項預約，請確認金額與票券`,
                subtitle: '在交車點價目列可直接調整購買數量與票券抵扣',
                action: 'review',
                actionLabel: '回到交車點資訊清單'
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

    const parsePriceDateMs = (value) => {
        if (!value) return null
        const ts = Date.parse(String(value).trim().replace(' ', 'T'))
        return Number.isNaN(ts) ? null : ts
    }
    const itemIsEarlyBird = (item = {}) => {
        if (hasPriceValue(item.early) && !hasPriceValue(item.normal)) return true
        if (!hasPriceValue(item.early)) return false
        const rawStart = item.early_start || item.earlyStart || ''
        const rawEnd = item.early_end || item.earlyEnd || ''
        const now = Date.now()
        if (rawStart || rawEnd) {
            const startTs = parsePriceDateMs(rawStart)
            const endTs = parsePriceDateMs(rawEnd)
            if (startTs !== null && now < startTs) return false
            if (endTs !== null && now > endTs) return false
            return startTs !== null || endTs !== null
        }
        const deadlineTs = parsePriceDateMs(eventDetail.value.deadline)
        return deadlineTs === null ? true : now <= deadlineTs
    }
    const priceModeForItem = (item = {}) => itemIsEarlyBird(item) ? 'early' : 'normal'
    const unitPriceForItem = (item = {}) => {
        const mode = priceModeForItem(item)
        return hasPriceValue(item[mode]) ? Number(item[mode]) : 0
    }
    const earlyWindowLabel = (item = {}) => {
        if (!hasPriceValue(item.early)) return '未設定早鳥價'
        const start = item.early_start || item.earlyStart || ''
        const end = item.early_end || item.earlyEnd || ''
        if (start && end) return `早鳥期間：${formatDateTime(start)} ~ ${formatDateTime(end)}`
        if (start) return `早鳥開始：${formatDateTime(start)}`
        if (end) return `早鳥截止：${formatDateTime(end)}`
        if (eventDetail.value.deadline) return `早鳥截止：${formatDateTime(eventDetail.value.deadline)}`
        return '未設定早鳥時間，預設套用早鳥價'
    }
    const formatPriceAmount = (value) => `TWD ${Number(value || 0).toLocaleString('zh-TW')}`
    const priceStageLabel = (item = {}) => {
        const parts = []
        if (hasPriceValue(item.normal)) parts.push(`原價 ${formatPriceAmount(item.normal)}`)
        if (hasPriceValue(item.early)) parts.push(`早鳥 ${formatPriceAmount(item.early)}`)
        return parts.join('｜') || '尚未設定價格'
    }
    const storePriceEntries = (store = {}) => Object.keys(store?.prices || {}).map(type => {
        const price = store.prices[type] || {}
        const activeMode = priceModeForItem(price)
        return {
            type,
            ...price,
            activeMode,
            activePrice: activeMode === 'early' ? Number(price.early || 0) : Number(price.normal || 0),
        }
    })
    const storePriceValueClass = (item = {}) => item.activeMode === 'early' ? 'text-red-600' : 'text-amber-600'

    // 價格計算（>=20 件 9 折）
    const subtotal = computed(() => {
        let sum = 0
        priceItems.value.forEach(item => {
            const qty = Number(item.quantity || 0)
            if (qty > 0) {
                const unit = unitPriceForItem(item)
                sum += unit * qty
            }
        })
        return sum
    })

    // 加購包材費用（與總價共用）
    const addOnCost = computed(() => addOn.value.material ? (100 * Math.max(0, addOn.value.materialCount || 0)) : 0)

    // 最終金額（不使用優惠券）
    const finalTotal = computed(() => {
        return Math.max(subtotal.value + addOnCost.value, 0)
    })

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
    const selectedStore = computed(() => stores.value.find(store => String(store.id || '') === String(serviceSelection.value.storeId || '')) || null)
    const storeCapacityRemaining = (store = null) => {
        const capacity = normalizeCapacityValue(store?.capacity)
        if (capacity === null) return null
        const remaining = store?.capacityRemaining
        if (remaining !== undefined && remaining !== null && Number.isFinite(Number(remaining))) {
            return Math.max(0, Math.floor(Number(remaining)))
        }
        const reserved = Math.max(0, Math.floor(Number(store?.reservedQuantity || 0)))
        return Math.max(0, capacity - reserved)
    }
    const storeCapacityLabel = (store = null) => {
        const capacity = normalizeCapacityValue(store?.capacity)
        if (capacity === null) return '收容數量：不限制'
        const remaining = storeCapacityRemaining(store)
        return remaining > 0 ? `收容數量：剩餘 ${remaining} / ${capacity} 輛` : `收容數量：已滿（${capacity} 輛）`
    }
    const isStoreCapacityFull = (store = null) => {
        const remaining = storeCapacityRemaining(store)
        return remaining !== null && remaining <= 0
    }
    const selectedStorePriceSummary = computed(() => {
        const rows = storePriceEntries(selectedStore.value)
        if (!rows.length) return ''
        return rows.map(item => `${item.type} ${formatPriceAmount(item.activePrice)}`).join(' / ')
    })
    const activeStorePriceEntries = computed(() => storePriceEntries(activeStoreDetail.value))
    const selectedServiceSummary = computed(() => selectedStore.value?.name || '')
    const isSelectedStore = (store) => String(serviceSelection.value.storeId || '') === String(store?.id || '')
    const syncPriceItemsForStore = (store) => {
        const prices = normalizeStorePrices(store?.prices || {})
        priceItems.value = buildPriceItems(prices)
    }
    watch(selectedStore, syncPriceItemsForStore, { immediate: true })
    const selectServiceStore = (store) => {
        if (!store) return
        if (isStoreCapacityFull(store)) {
            showNotice('此交車點收容數量已滿，請選擇其他交車點')
            return
        }
        serviceSelection.value.storeId = String(store.id || '')
        syncPriceItemsForStore(store)
    }
    const priceItemForStoreEntry = (store, entry = {}) => {
        if (!isSelectedStore(store)) return null
        return priceItems.value.find(item => item.type === entry.type) || null
    }
    const selectedUnitsExcludingField = (targetItem = null, field = 'quantity') => {
        return priceItems.value.reduce((sum, item) => {
            const itemTotal = Number(item.quantity || 0) + Number(item.useTickets || 0)
            if (targetItem && item.type === targetItem.type) {
                return sum + itemTotal - Number(item?.[field] || 0)
            }
            return sum + itemTotal
        }, 0)
    }
    const capacityMaxForStoreEntryField = (store, entry = {}, field = 'quantity') => {
        const remaining = storeCapacityRemaining(store)
        if (remaining === null) return 999
        if (!isSelectedStore(store)) return remaining
        const currentItem = priceItemForStoreEntry(store, entry) || entry
        const selectedWithoutField = selectedUnitsExcludingField(currentItem, field)
        return Math.max(0, remaining - selectedWithoutField)
    }
    const quantityMaxForStoreEntry = (store, entry = {}) => capacityMaxForStoreEntryField(store, entry, 'quantity')
    const quantityForStoreEntry = (store, entry = {}) => {
        return Number(priceItemForStoreEntry(store, entry)?.quantity || 0)
    }
    const useTicketsForStoreEntry = (store, entry = {}) => {
        return Number(priceItemForStoreEntry(store, entry)?.useTickets || 0)
    }
    const totalTicketsForEntry = (entry = {}) => {
        return bindingKeysForType(entry.type, entry).reduce((sum, key) => sum + Number(ticketsAvailableByBinding.value[key] || 0), 0)
    }
    const ticketMaxForStoreEntry = (store, entry = {}) => {
        const currentItem = priceItemForStoreEntry(store, entry)
        const ticketMax = currentItem
            ? ticketsRemainingFor(entry.type, currentItem) + Number(currentItem.useTickets || 0)
            : totalTicketsForEntry(entry)
        return Math.min(ticketMax, capacityMaxForStoreEntryField(store, entry, 'useTickets'))
    }
    const ticketAvailableForStoreEntry = (store, entry = {}) => {
        const currentItem = priceItemForStoreEntry(store, entry)
        if (currentItem) return ticketsRemainingFor(entry.type, currentItem)
        return totalTicketsForEntry(entry)
    }
    const setStoreEntryQuantity = (store, entry = {}, value) => {
        if (!store || !entry?.type) return
        if (!isSelectedStore(store)) {
            selectServiceStore(store)
            if (!isSelectedStore(store)) return
        }
        const target = priceItems.value.find(item => item.type === entry.type)
        if (!target) return
        target.quantity = Math.max(0, Math.min(quantityMaxForStoreEntry(store, target), Number(value || 0)))
    }
    const setStoreEntryUseTickets = (store, entry = {}, value) => {
        if (!store || !entry?.type || !loggedIn.value) return
        if (!isSelectedStore(store)) {
            selectServiceStore(store)
            if (!isSelectedStore(store)) return
        }
        const target = priceItems.value.find(item => item.type === entry.type)
        if (!target) return
        const max = ticketMaxForStoreEntry(store, target)
        target.useTickets = Math.max(0, Math.min(max, Number(value || 0)))
    }
    watch(storeSearch, () => {
        activeStorePage.value = 1
    })
    watch(stores, () => {
        if (!activeStoreDetail.value?.id) return
        const latest = stores.value.find(s => s.id === activeStoreDetail.value.id)
        activeStoreDetail.value = latest || null
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
        priceItems.value.forEach(item => {
            const qty = Number(item.useTickets || 0)
            if (qty > 0) items.push({ key: `T-${item.type}`, store: selectedServiceSummary.value, type: item.type, qty, unit: 0, _byTicket: true })
        })
        // 付費數量
        priceItems.value.forEach(item => {
            const qty = Number(item.quantity || 0)
            if (qty > 0) {
                const unit = unitPriceForItem(item)
                items.push({ key: `P-${item.type}`, store: selectedServiceSummary.value, type: item.type, qty, unit, _byTicket: false })
            }
        })
        return items
    })

    // 是否同時建立 reservations（每張票都建一筆）
    // 預約紀錄在訂單「已付款」時由後端建立，這裡不先建立

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
        if (!selectedStore.value) {
            await showNotice('請先選擇交車點')
            return
        }
        const remainingCapacity = storeCapacityRemaining(selectedStore.value)
        if (remainingCapacity !== null && reservationQuantity.value > remainingCapacity) {
            await showNotice(`此交車點收容數量剩餘 ${remainingCapacity} 輛，無法建立 ${reservationQuantity.value} 輛托運訂單`, { title: '收容數量不足' })
            return
        }

        const selections = []
        let ticketDiscountTotal = 0
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
        for (const item of priceItems.value) {
            const need = Number(item.useTickets || 0)
            if (need > 0) {
                const keys = bindingKeysForType(item.type, item)
                const available = keys.reduce((sum, itemKey) => sum + ((poolByBinding[itemKey] || []).length), 0)
                if (available < need) { await showNotice(`票券不足：${item.type}`, { title: '庫存不足' }); return }
                const taken = []
                let left = need
                for (const itemKey of keys) {
                    const pool = poolByBinding[itemKey] || []
                    while (pool.length && left > 0) {
                        taken.push(pool.shift())
                        left -= 1
                    }
                    if (left <= 0) break
                }
                usedTicketIds.push(...taken.map(x => x.id))
                const productId = productIdForType(item)
                const unitPrice = unitPriceForItem(item)
                const lineDiscount = unitPrice * need
                ticketDiscountTotal += lineDiscount
                selections.push({
                    store: selectedServiceSummary.value,
                    storeId: selectedStore.value?.id || null,
                    deliveryPointId: selectedStore.value?.deliveryPointId || null,
                    type: item.type,
                    qty: need,
                    unitPrice,
                    subtotal: 0,
                    discount: lineDiscount,
                    byTicket: true,
                    priceMode: itemIsEarlyBird(item) ? 'early' : 'normal',
                    early_start: item.early_start || item.earlyStart || undefined,
                    early_end: item.early_end || item.earlyEnd || undefined,
                    ...(productId ? { productId, product_id: productId } : {})
                })
            }
        }
        priceItems.value.forEach(item => {
            const qty = Number(item.quantity || 0)
            if (qty > 0) {
                const productId = productIdForType(item)
                const unitPrice = unitPriceForItem(item)
                const lineSubtotal = unitPrice * qty
                selections.push({
                    store: selectedServiceSummary.value,
                    storeId: selectedStore.value?.id || null,
                    deliveryPointId: selectedStore.value?.deliveryPointId || null,
                    type: item.type,
                    qty,
                    unitPrice,
                    subtotal: lineSubtotal,
                    priceMode: itemIsEarlyBird(item) ? 'early' : 'normal',
                    early_start: item.early_start || item.earlyStart || undefined,
                    early_end: item.early_end || item.earlyEnd || undefined,
                    ...(productId ? { productId, product_id: productId } : {})
                })
            }
        })
        const totalQty = selections.reduce((s, x) => s + x.qty, 0)
        if (!totalQty) { await showNotice('尚未選擇數量'); return }

        try {
            const addOnCostValue = addOnCost.value
            const subtotalWithTickets = subtotal.value + ticketDiscountTotal
            const discountTotal = ticketDiscountTotal
            const total = Math.max(subtotalWithTickets + addOnCostValue - discountTotal, 0)
            const details = {
                kind: 'event-reservation',
                event: { id: eventDetail.value.id, code: eventDetail.value.code, name: eventDetail.value.name, date: eventDetail.value.date || formatRange(eventDetail.value.starts_at, eventDetail.value.ends_at) },
                serviceSelection: {
                    storeId: selectedStore.value?.id || null,
                    deliveryPointId: selectedStore.value?.deliveryPointId || null,
                    storeName: selectedStore.value?.name || '',
                },
                selections,
                addOn: addOn.value,
                subtotal: subtotalWithTickets,
                // 票券折抵視為折扣紀錄，總金額仍按折抵後計算
                discount: discountTotal,
                addOnCost: addOnCostValue,
                total,
                quantity: totalQty,
                ticketsUsed: usedTicketIds,
                status: '待匯款'
            }
            await api.post(`${API}/orders`, { items: [details] })

            // 無需標記優惠券使用

            await showNotice(`✅ 已成功建立訂單\n總金額：${total} 元`)
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
            await showNotice('找不到對應的服務檔期', { title: '錯誤' })
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
