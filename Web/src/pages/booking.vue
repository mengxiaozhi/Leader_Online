<template>
    <main class="ops-page">
        <h1 class="sr-only">{{ eventDetail.name || '單車託運服務預約' }}</h1>
        <div class="space-y-5">
            <div v-if="isEditingOrder" class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                正在修改訂單 {{ editingOrderCode || `#${editingOrderId}` }}。付款確認完成前可調整交車點、方案、數量、票券與包材。
            </div>
            <section v-if="bookingActionCards.length" class="mb-4">
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div v-for="card in bookingActionCards" :key="card.key"
                        class="card-quiet flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div class="space-y-1">
                            <p class="text-sm font-medium text-slate-950">{{ card.title }}</p>
                            <p class="text-sm leading-6 text-slate-600" v-if="card.subtitle">{{ card.subtitle }}</p>
                        </div>
                        <button v-if="card.actionLabel"
                            class="btn btn-outline btn-sm shrink-0 self-start whitespace-nowrap sm:self-auto"
                            @click="handleBookingActionCard(card)">
                            {{ card.actionLabel }}
                        </button>
                    </div>
                </div>
            </section>

            <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
                <div class="space-y-5">
            <div v-if="loadingEvent" class="ticket-card bg-white overflow-hidden animate-pulse" aria-busy="true" aria-label="正在載入服務檔期">
                <div class="w-full bg-gray-200" style="aspect-ratio: 3/2;"></div>
                <div class="p-5 space-y-3">
                    <div class="h-4 bg-gray-200 rounded w-1/3"></div>
                    <div class="h-3 bg-gray-200 rounded w-2/3"></div>
                    <div class="h-3 bg-gray-200 rounded w-full"></div>
                    <div class="h-3 bg-gray-200 rounded w-5/6"></div>
                </div>
            </div>
            <div v-else-if="eventError" class="ticket-card border border-red-200 bg-red-50 p-5 text-sm text-red-900" role="alert">
                <p class="font-medium">無法載入服務檔期</p>
                <p class="mt-1 leading-6">{{ eventError }}</p>
                <button class="btn btn-outline btn-sm mt-4" type="button" @click="retryEvent">
                    <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                </button>
            </div>
            <div v-else-if="!eventDetail.id" class="ticket-card border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
                <p class="font-medium text-slate-950">找不到這個服務檔期</p>
                <p class="mt-1">請回到購票中心選擇目前可預約的服務。</p>
                <button class="btn btn-outline btn-sm mt-4" type="button" @click="router.push('/store')">回到購票中心</button>
            </div>
            <div v-else class="ticket-card overflow-hidden bg-white p-0">
                <div class="relative w-full overflow-hidden" style="aspect-ratio: 16/7;">
                    <img :src="eventDetail.cover || '/transport-fallback.png'" @error="(e)=>e.target.src='/transport-fallback.png'" :alt="bookingImageAlt" class="absolute inset-0 h-full w-full object-cover" />
                    <div class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-slate-950/75 to-transparent pointer-events-none"></div>
                    <div class="absolute bottom-4 left-4 right-4 z-10 space-y-2">
                        <p v-if="eventDetail.code" class="inline-flex rounded-md bg-white/95 px-2 py-1 text-sm font-medium text-slate-800 shadow-sm">服務 {{ eventDetail.code }}</p>
                        <h2 class="ui-title text-2xl text-white sm:text-3xl">{{ eventDetail.name }}</h2>
                        <p v-if="eventDetail.date || eventDetail.starts_at || eventDetail.ends_at" class="text-sm text-white/90">
                            {{ eventDetail.date || formatRange(eventDetail.starts_at, eventDetail.ends_at) }}
                        </p>
                    </div>
                </div>
                <div v-if="eventDetail.deadline || eventDetail.description || eventDetail.deliveryNotes.length" class="space-y-4 p-4 text-sm text-slate-700 sm:p-5">
                    <div v-if="eventDetail.deadline" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-amber-800">
                        <div class="flex items-center gap-2">
                            <AppIcon name="orders" class="h-4 w-4 text-primary" />
                            <span class="font-medium">報名截止</span>
                            <span>{{ eventDetail.deadline }}</span>
                        </div>
                    </div>
                    <p v-if="eventDetail.description" class="leading-relaxed">{{ eventDetail.description }}</p>
                    <ul v-if="eventDetail.deliveryNotes.length" class="list-disc pl-5 space-y-1">
                        <li v-for="note in eventDetail.deliveryNotes" :key="note">{{ note }}</li>
                    </ul>
                </div>
            </div>

            <section ref="storesSectionRef" class="surface-section space-y-4">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <h3 class="ui-title flex items-center gap-2 text-xl text-slate-950">
                        <span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm text-white">1</span>
                        <AppIcon name="store" class="h-5 w-5 text-primary" /> 交車點與方案
                    </h3>
                    <span class="text-sm text-slate-600">選擇交車點與價格方案</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div class="card-quiet p-4">
                        <p class="text-sm font-medium text-slate-500">已選交車點</p>
                        <p class="mt-1 font-medium text-slate-950">{{ selectedStoreSummary || '尚未選擇交車點' }}</p>
                        <p v-if="selectedStoreCount" class="mt-1 text-sm text-slate-600">已選 {{ selectedStoreCount }} 個交車點，可繼續調整各點數量。</p>
                    </div>
                    <div class="card-quiet p-4">
                        <p class="text-sm font-medium text-slate-500">已選價格</p>
                        <p class="mt-1 whitespace-pre-line font-medium text-slate-950">{{ selectedStorePriceSummary || '尚未選擇價格' }}</p>
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

                <div v-if="eventError" class="ticket-card border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900" role="status">
                    請先重新載入服務檔期，再選擇交車點與方案。
                </div>
                <div v-else-if="loadingStores" class="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-busy="true" aria-label="正在載入交車點">
                    <div v-for="i in 4" :key="`store-skel-${i}`" class="ticket-card bg-white p-5 animate-pulse space-y-4">
                        <div class="h-5 w-1/2 bg-gray-200 rounded"></div>
                        <div class="h-4 w-3/4 bg-gray-200 rounded"></div>
                        <div class="h-36 bg-gray-200 rounded"></div>
                    </div>
                </div>
                <div v-else-if="storesError" class="ticket-card border border-red-200 bg-red-50 p-5 text-sm text-red-900" role="alert">
                    <p class="font-medium">無法載入交車點</p>
                    <p class="mt-1 leading-6">{{ storesError }}</p>
                    <button class="btn btn-outline btn-sm mt-4" type="button" @click="retryStores">
                        <AppIcon name="refresh" class="h-4 w-4" /> 重試
                    </button>
                </div>
                <div v-else-if="!filteredStores.length" class="ticket-card border border-dashed border-slate-300 bg-white p-5 text-sm text-gray-600">
                    {{ storeSearch ? '沒有符合搜尋條件的交車點資訊。' : '目前尚無可用交車點資訊。' }}
                </div>
                <template v-else>
                    <div class="space-y-4">
                        <div
                            v-for="store in displayedStores"
                            :key="store.id || store.name"
                            class="ticket-card bg-white p-4 sm:p-5"
                            :class="isSelectedStore(store) ? 'border-primary ring-1 ring-primary/30' : ''"
                        >
                            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                                <div class="space-y-1">
                                    <h4 class="ui-title text-lg text-slate-950">{{ store.name }}</h4>
                                    <p v-if="store.address || store.location" class="text-sm leading-6 text-slate-600">{{ store.address || store.location }}</p>
                                    <p class="text-sm" :class="isStoreCapacityFull(store) ? 'text-red-600' : 'text-slate-600'">{{ storeCapacityLabel(store) }}</p>
                                    <p v-if="storeStartingPrice(store)" class="text-sm font-medium text-primary">方案 {{ storeStartingPrice(store) }} 起</p>
                                </div>
                                <div class="flex items-center gap-2 flex-wrap justify-between sm:justify-end w-full sm:w-auto">
                                    <button class="btn btn-outline btn-sm" @click="openStoreDetail(store)">
                                        <AppIcon name="info" class="h-4 w-4" /> 交車點資訊
                                    </button>
                                    <button
                                        class="btn btn-sm"
                                        :class="isSelectedStore(store) ? 'btn-primary text-white' : 'btn-outline'"
                                        type="button"
                                        :aria-expanded="isStorePlansExpanded(store)"
                                        :aria-controls="storePlansId(store)"
                                        @click="toggleStorePlans(store)"
                                    >
                                        {{ isSelectedStore(store) ? '調整已選方案' : (isStorePlansExpanded(store) ? '收合方案' : '查看方案') }}
                                    </button>
                                </div>
                            </div>

                            <div
                                v-if="isStorePlansExpanded(store)"
                                :id="storePlansId(store)"
                                class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm space-y-4"
                            >
                                <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                    <p class="text-sm font-medium text-slate-950">價格方案</p>
                                </div>
                                <div v-if="storePriceEntries(store).length" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                    <div
                                        v-for="item in storePriceEntries(store)"
                                        :key="`${store.id || store.name}-${item.type}`"
                                        class="rounded-lg border bg-white p-3"
                                        :class="item.activeMode === 'early' ? 'border-red-200' : 'border-amber-200'"
                                    >
                                        <div class="flex h-full flex-col gap-3">
                                            <div>
                                                <p class="text-sm font-medium text-slate-950 leading-tight">{{ item.type }}</p>
                                                <div class="mt-2 flex items-end gap-2">
                                                    <span class="price-amount text-2xl font-medium leading-none sm:text-3xl" :class="storePriceValueClass(item)">
                                                        {{ formatPriceAmount(item.activePrice) }}
                                                    </span>
                                                    <span class="pb-1 text-sm font-medium" :class="item.activeMode === 'early' ? 'text-red-600' : 'text-amber-600'">
                                                        {{ item.activeMode === 'early' ? '早鳥' : '原價' }}
                                                    </span>
                                                </div>
                                                <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                                                    <span v-if="hasPriceValue(item.early)" class="font-medium text-red-700">早鳥 {{ formatPriceAmount(item.early) }}</span>
                                                    <span v-if="hasPriceValue(item.normal)" class="font-medium text-slate-700">原價 {{ formatPriceAmount(item.normal) }}</span>
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
                                <p v-if="isStoreCapacityFull(store)" class="rounded-lg bg-red-50 px-3 py-2 font-medium text-red-700">這個交車點已無可用容量，請選擇其他地點。</p>
                            </div>
                        </div>
                    </div>

                    <div v-if="shouldPaginateStores" class="mt-6 flex flex-wrap items-center gap-2">
                        <button class="btn btn-outline btn-sm" :disabled="activeStorePage <= 1" @click="goPrevStorePage">上一頁</button>
                        <button
                            v-for="page in totalStorePages"
                            :key="`store-page-${page}`"
                            class="btn btn-sm"
                            :class="page === activeStorePage ? 'btn-primary text-white' : 'btn-outline'"
                            @click="goToStorePage(page)"
                        >
                            {{ page }}
                        </button>
                        <button class="btn btn-outline btn-sm" :disabled="activeStorePage >= totalStorePages" @click="goNextStorePage">下一頁</button>
                    </div>
                </template>
            </section>

            <section ref="addOnSectionRef" class="surface-section space-y-3">
                <h3 class="ui-title flex items-center gap-2 text-lg text-slate-950">
                    <span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm text-white">2</span>
                    加值服務與規定
                </h3>
                <div class="flex flex-col sm:flex-row sm:items-center gap-3">
                    <label class="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" v-model="addOn.material" class="mr-1" />
                        加購包材 100 元/份
                    </label>
                    <label class="flex items-center gap-2 text-sm text-slate-700">
                        <span>包材數量</span>
                        <input
                            type="number"
                            inputmode="numeric"
                            pattern="[0-9]*"
                            min="0"
                            class="w-full sm:w-24"
                            v-model.number="addOn.materialCount"
                            :disabled="!addOn.material"
                        />
                    </label>
                </div>
                <div class="space-y-2 text-sm text-slate-700">
                    <label class="flex items-start gap-2">
                        <input type="checkbox" v-model="addOn.nakedConfirm" class="mt-1" />
                        <span>我已了解未妥善包裝之貨物不予託運</span>
                    </label>
                    <div class="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                        <AppIcon name="shield" class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>
                            確認預約時會開啟
                            <RouterLink to="/reservation-notice" class="text-primary underline hover:opacity-80">購買須知</RouterLink>
                            、
                            <RouterLink to="/reservation-rules" class="text-primary underline hover:opacity-80">使用規定</RouterLink>
                            與對應服務商條款，閱讀到底並確認後才會建立訂單。
                        </span>
                    </div>
                </div>
            </section>

            <div v-if="!loggedIn" class="ticket-card border border-amber-200 bg-amber-50 text-amber-800 p-4 sm:p-5">
                <h3 class="text-base font-medium mb-2">請先登入</h3>
                <p class="text-sm">登入後才能使用票券或送出預約，亦可查看可用票券與折抵紀錄。</p>
            </div>
            <div v-else-if="ticketsLoading" class="ticket-card bg-white p-4 text-sm text-slate-600 sm:p-5" aria-busy="true">正在同步可用票券…</div>
            <div v-else-if="ticketsError" class="ticket-card border border-red-200 bg-red-50 p-4 text-sm text-red-900 sm:p-5" role="alert">
                <p class="font-medium">無法同步可用票券</p>
                <p class="mt-1">{{ ticketsError }}</p>
                <button type="button" class="btn btn-outline btn-sm mt-3" @click="retryTickets">重試</button>
            </div>
            <div v-else-if="tickets.length" class="ticket-card border border-primary/30 bg-red-50/70 text-slate-800 p-4 sm:p-5">
                <h3 class="text-base font-medium mb-2 text-primary">可用票券</h3>
                <p class="text-sm flex flex-wrap gap-x-3 gap-y-1 text-slate-700">
                    <span v-for="ticket in tickets" :key="ticket.id || ticket.uuid" class="inline-flex items-center gap-1 border-b border-primary/30 pb-0.5">
                        <AppIcon name="ticket" class="h-3.5 w-3.5 text-primary" /> {{ ticket.type || '票券' }}
                    </span>
                </p>
            </div>
            <div v-else class="ticket-card border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600 sm:p-5">
                目前沒有可用票券，仍可直接購買方案完成預約。
            </div>

            <div ref="summarySectionRef" class="surface-section space-y-3 lg:hidden">
                <h3 class="ui-title flex items-center gap-2 text-lg text-slate-950">
                    <span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm text-white">3</span>
                    摘要與送出
                </h3>
                <ul class="space-y-1 text-sm text-slate-700">
                    <li v-if="!selectionsPreview.length" class="text-slate-600">尚未選擇任何數量。</li>
                    <li v-for="s in selectionsPreview" :key="s.key">{{ s.store }}｜{{ s.type || '方案' }} × {{ s.qty }}（{{ s._byTicket ? '使用票券' : ('單價 ' + s.unit) }}）</li>
                </ul>
                <div class="text-sm text-slate-700 space-y-1 text-right">
                    <div>小計：<span class="money-value">TWD {{ subtotal }}</span></div>
                    <div v-if="addOn.material && addOn.materialCount > 0">包材：<span class="money-value">TWD {{ addOn.materialCount * 100 }}</span></div>
                </div>
                <div class="money-value text-xl text-right text-primary">
                    總金額：TWD {{ finalTotal }}
                </div>
            </div>
                </div>

                <aside class="ops-summary sticky top-[88px] hidden space-y-4 lg:block">
                    <div class="space-y-1">
                        <p class="flex items-center gap-2 text-sm font-medium text-slate-600">
                            <span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm text-white">3</span>
                            摘要與送出
                        </p>
                        <h3 class="ui-title text-2xl text-slate-950">{{ eventDetail.name || '單車託運服務' }}</h3>
                    </div>
                    <div class="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                        <div>
                            <p class="text-slate-500">交車點</p>
                            <p class="mt-1 font-medium text-slate-950">{{ selectedStoreSummary || '尚未選擇' }}</p>
                        </div>
                        <div>
                            <p class="text-slate-500">價格方案</p>
                            <p class="mt-1 whitespace-pre-line font-medium text-slate-950">{{ selectedStorePriceSummary || '尚未選擇價格' }}</p>
                        </div>
                    </div>
                    <ul class="space-y-2 text-sm text-slate-700">
                        <li v-if="!selectionsPreview.length" class="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-slate-600">尚未選擇任何數量。</li>
                        <li v-for="s in selectionsPreview" :key="`desktop-${s.key}`" class="rounded-lg border border-slate-200 bg-white p-3">
                            <div class="font-medium text-slate-950">{{ s.type || '方案' }} x {{ s.qty }}</div>
                            <div class="mt-1 text-slate-600">{{ s.store || '未選交車點' }}｜{{ s._byTicket ? '使用票券' : ('單價 ' + s.unit) }}</div>
                        </li>
                    </ul>
                    <div class="space-y-2 border-t border-slate-200 pt-4 text-sm text-slate-700">
                        <div class="flex items-center justify-between">
                            <span>小計</span>
                            <span class="money-value">TWD {{ subtotal }}</span>
                        </div>
                        <div v-if="addOn.material && addOn.materialCount > 0" class="flex items-center justify-between">
                            <span>包材</span>
                            <span class="money-value">TWD {{ addOn.materialCount * 100 }}</span>
                        </div>
                        <div class="flex items-end justify-between pt-2">
                            <span class="font-medium text-slate-950">總金額</span>
                            <span class="money-value text-2xl text-primary">TWD {{ finalTotal }}</span>
                        </div>
                    </div>
                    <button @click="confirmReserve" class="btn btn-primary w-full text-white" :disabled="reservationSubmitting">
                        <AppIcon name="orders" class="h-4 w-4" /> {{ reservationSubmitting ? '處理中...' : reservationSubmitLabel }}
                    </button>
                    <p class="text-center text-sm text-slate-500">下一步：{{ nextRequirementLabel }}</p>
                </aside>
            </div>
        </div>

        <div class="booking-mobile-cta">
            <div class="mx-auto flex max-w-7xl items-center gap-3">
                <div class="min-w-0 flex-1" aria-live="polite">
                    <div class="flex items-baseline gap-2">
                        <span class="text-sm font-medium text-slate-950">已選 {{ reservationQuantity }} 輛</span>
                        <span class="money-value text-base text-primary">TWD {{ finalTotal }}</span>
                    </div>
                    <p class="truncate text-sm text-slate-600">下一步：{{ nextRequirementLabel }}</p>
                </div>
                <button @click="confirmReserve" class="btn btn-primary shrink-0 text-white" :disabled="reservationSubmitting">
                    <AppIcon name="orders" class="h-4 w-4" /> {{ reservationSubmitting ? '處理中...' : reservationSubmitLabel }}
                </button>
            </div>
        </div>

        <AppOverlayPanel
            v-model="storeDetailOpen"
            placement="right"
            :title="activeStoreDetail?.name || '交車點資訊'"
            size="lg"
        >
            <div class="space-y-4 text-sm text-slate-700">
                        <p class="text-sm font-medium text-slate-500">交車點資訊</p>
                        <div class="grid gap-3">
                            <div class="rounded-lg border border-slate-200 bg-white p-3">
                                <p class="mb-1 text-sm font-medium text-slate-500">地址</p>
                                <p class="font-medium text-slate-950">{{ activeStoreDetail?.address || activeStoreDetail?.location || '尚未提供地址' }}</p>
                            </div>
                            <div class="rounded-lg border border-slate-200 bg-white p-3">
                                <p class="mb-1 text-sm font-medium text-slate-500">電話</p>
                                <p class="font-medium text-slate-950">{{ activeStoreDetail?.phone || activeStoreDetail?.telephone || activeStoreDetail?.tel || '尚未提供電話' }}</p>
                            </div>
                            <div class="rounded-lg border border-slate-200 bg-white p-3">
                                <p class="mb-1 text-sm font-medium text-slate-500">收容數量</p>
                                <p class="font-medium" :class="isStoreCapacityFull(activeStoreDetail) ? 'text-red-600' : 'text-slate-950'">{{ storeCapacityLabel(activeStoreDetail) }}</p>
                            </div>
                        </div>

                        <div v-if="activeStoreHours.length" class="space-y-1">
                            <p class="text-sm font-medium text-slate-500">營業時間 / 服務說明</p>
                            <ul class="space-y-1">
                                <li v-for="line in activeStoreHours" :key="line" class="text-slate-800">{{ line }}</li>
                            </ul>
                        </div>
                        <div v-else class="rounded-lg border border-slate-300 p-3 text-slate-600">
                            尚未提供營業時間。
                        </div>

                        <div v-if="activeStoreDetail?.externalUrl" class="rounded-lg border border-slate-200 p-3 break-all">
                            <p class="mb-1 text-sm font-medium text-slate-500">服務連結</p>
                            <a :href="activeStoreDetail.externalUrl" target="_blank" rel="noreferrer" class="font-medium text-primary underline">{{ activeStoreDetail.externalUrl }}</a>
                        </div>

                        <div class="rounded-lg border border-slate-200 p-3">
                            <p class="mb-2 text-sm font-medium text-slate-950">價目表</p>
                            <div class="space-y-3">
                                <div v-for="item in activeStorePriceEntries" :key="item.type" class="flex items-center justify-between gap-3 text-sm">
                                    <div class="font-medium text-slate-950">{{ item.type }}</div>
                                    <div class="text-right">
                                        <div class="price-amount text-xl font-medium" :class="storePriceValueClass(item)">{{ formatPriceAmount(item.activePrice) }}</div>
                                        <div class="text-sm text-slate-600">{{ priceStageLabel(item) }}</div>
                                        <div class="text-sm text-slate-600">{{ earlyWindowLabel(item) }}</div>
                                    </div>
                                </div>
                                <p v-if="!activeStorePriceEntries.length" class="text-slate-600">尚未設定價目表。</p>
                            </div>
                        </div>
            </div>
        </AppOverlayPanel>
        <MobileActionGuideSheet
            v-model="guideSheetOpen"
            v-bind="bookingGuideSheet"
            @primary="handleGuidePrimary"
            @secondary="handleGuideSecondary"
        />
        <LegalReviewDrawer ref="legalReviewRef" />
        <OrderUserDataReviewDrawer ref="userDataReviewRef" />
    </main>
</template>

<script setup>
    import { ref, computed, onMounted, watch, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
    import { API_BASE } from '../utils/api'
    import { useRoute, useRouter } from 'vue-router'
    import api from '../api/axios'
    import AppIcon from '../components/AppIcon.vue'
    import AppOverlayPanel from '../components/AppOverlayPanel.vue'
    import AppSearchInput from '../components/AppSearchInput.vue'
    import LegalReviewDrawer from '../components/LegalReviewDrawer.vue'
    import OrderUserDataReviewDrawer from '../components/OrderUserDataReviewDrawer.vue'
    import MobileActionGuideSheet from '../components/MobileActionGuideSheet.vue'
    import { showNotice } from '../utils/sheet'
    import { formatDateTime, formatDateTimeRange } from '../utils/datetime'
    import { summarizeText } from '../utils/content'
    import { setPageMeta } from '../utils/meta'
    import { normalizeHttpUrl } from '../utils/safeUrl'
    import { clearBookingDraft, loadBookingDraft, pruneBookingDraft, saveBookingDraft } from '../utils/bookingDraft'
    import { useIsMobile } from '../composables/useIsMobile'
    const QuantityStepper = defineAsyncComponent(() => import('../components/QuantityStepper.vue'))

    const route = useRoute()
    const router = useRouter()
    const API = API_BASE

    const loadingEvent = ref(true)
    const loadingStores = ref(true)
    const ticketsLoading = ref(false)
    const eventError = ref('')
    const storesError = ref('')
    const ticketsError = ref('')
    const draftReady = ref(false)

    const apiErrorMessage = (error, fallback) => String(
        error?.response?.data?.message
        || error?.response?.data?.error
        || error?.message
        || fallback
    )

    // 從網址參數取得服務代碼
    const routeCode = computed(() => String(route.params.code || ''))
    const currentEventId = ref(null)
    const loggedIn = ref(false)
    const sessionProfile = ref(null)
    const legalReviewRef = ref(null)
    const userDataReviewRef = ref(null)
    const activeGuide = ref(null)
    const reservationSubmitting = ref(false)
    const reservationIdempotencyKey = ref('')
    const editingOrderId = computed(() => {
        const value = Number(route.query.editOrder)
        return Number.isSafeInteger(value) && value > 0 ? value : null
    })
    const editingOrderDetails = ref(null)
    const editingOrderCode = ref('')
    const isEditingOrder = computed(() => Boolean(editingOrderId.value && editingOrderDetails.value))
    const reservationSubmitLabel = computed(() => isEditingOrder.value ? '儲存訂單修改' : '確認預約')
    const { isMobile } = useIsMobile(768)

    const storesSectionRef = ref(null)
    const addOnSectionRef = ref(null)
    const summarySectionRef = ref(null)
    const STORES_PAGE_SIZE = 10
    const activeStorePage = ref(1)
    const goWalletReservations = () => router.push({ path: '/wallet', query: { tab: 'reservations' } })
    const createOrderIdempotencyKey = (source = 'booking') => {
        const random = globalThis.crypto?.randomUUID?.()
            || `${Date.now()}-${Math.random().toString(16).slice(2)}`
        return `${source}-${random}`
    }
    const guideSheetOpen = computed({
        get: () => Boolean(activeGuide.value),
        set: (open) => {
            if (!open) activeGuide.value = null
        }
    })
    const openMobileGuide = (guide) => {
        if (!isMobile.value) return false
        activeGuide.value = guide || { action: 'default' }
        return true
    }
    const profilePhoneComplete = computed(() => {
        const info = sessionProfile.value || {}
        return String(info.phone || '').replace(/\D/g, '').length >= 8
    })
    const profileNameComplete = computed(() => String(sessionProfile.value?.username || '').trim().length > 0)
    const profileEmailComplete = computed(() => String(sessionProfile.value?.email || '').trim().length > 0)
    const profileRemittanceComplete = computed(() => {
        const info = sessionProfile.value || {}
        const last5 = String((info.remittanceLast5 ?? info.remittance_last5) || '').trim()
        return /^\d{5}$/.test(last5)
    })
    const contactInfoComplete = computed(() => (
        loggedIn.value
        && profileNameComplete.value
        && profileEmailComplete.value
        && profilePhoneComplete.value
        && profileRemittanceComplete.value
    ))

    // 服務檔期資料
    const eventDetail = ref({ id: null, code: '', name: '', date: '', deadline: '', description: '', cover: '', deliveryNotes: [], starts_at: null, ends_at: null, providerUserId: '' })
    const bookingImageAlt = computed(() => `${eventDetail.value.name || '單車託運服務檔期'}封面圖片`)
    const applyBookingMeta = () => {
        const detail = eventDetail.value || {}
        const serviceName = String(detail.name || '').trim()
        const dateText = detail.date || formatDateTimeRange(detail.starts_at, detail.ends_at)
        const deadlineText = detail.deadline ? `預約截止：${formatDateTime(detail.deadline)}` : ''
        const summary = summarizeText([
            detail.description,
            dateText ? `服務時間：${dateText}` : '',
            deadlineText,
        ].filter(Boolean).join('。'))
        setPageMeta({
            title: serviceName ? `${serviceName}預約` : '單車託運服務預約',
            description: summary || '瀏覽單車託運服務檔期、交車點資訊與價格方案，使用票券折抵並完成預約手續。',
            url: route.path,
            image: detail.cover || '/og_img.png',
            imageAlt: bookingImageAlt.value,
            keywords: [
                serviceName,
                detail.code ? `服務 ${detail.code}` : '',
                '單車託運預約',
                '交車點',
                '服務檔期',
                '票券折抵',
            ].filter(Boolean)
        })
    }
    const fetchEvent = async (id) => {
        loadingEvent.value = true
        eventError.value = ''
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
                deliveryNotes: rules,
                providerUserId: e.provider_user_id || e.owner_user_id || ''
            }
            applyBookingMeta()
        } catch (err) {
            eventError.value = apiErrorMessage(err, '服務檔期暫時無法載入，請稍後再試。')
        }
        finally { loadingEvent.value = false }
    }
    const retryEvent = async () => {
        if (!currentEventId.value) return initializeBooking()
        await fetchEvent(currentEventId.value)
        if (!eventError.value && !storesError.value && !editingOrderId.value) {
            draftReady.value = restoreCurrentDraft()
        }
    }
    function safeParseArray(s) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] } }

    // 方案清單（從後端載入）
    const stores = ref([])
    const selectionItems = ref({})
    const activeStoreDetail = ref(null)
    const expandedStoreIds = ref(new Set())
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
    const storeDetailOpen = computed({
        get: () => Boolean(activeStoreDetail.value),
        set: (open) => { if (!open) closeStoreDetail() },
    })
    const storePlansId = (store = {}) => `booking-store-plans-${String(store.id ?? store.name ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-')}`
    const isStorePlansExpanded = (store = {}) => isSelectedStore(store) || expandedStoreIds.value.has(String(store.id ?? ''))
    const toggleStorePlans = (store = {}) => {
        const key = String(store.id ?? '')
        if (!key) return
        const next = new Set(expandedStoreIds.value)
        if (next.has(key) && !isSelectedStore(store)) next.delete(key)
        else next.add(key)
        expandedStoreIds.value = next
    }
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
    const selectionKeyFromParts = (storeId, type) => `${String(storeId || '').trim()}::${String(type || '').trim()}`
    const storeEntryKey = (store = {}, entry = {}) => selectionKeyFromParts(store?.id, entry?.type)
    const buildSelectionItem = (store = {}, entry = {}) => ({
        type: entry.type,
        ...entry,
        storeId: store?.id || null,
        deliveryPointId: store?.deliveryPointId || null,
        storeName: store?.name || '',
        providerUserId: providerIdFromSource(store) || providerIdFromSource(eventDetail.value) || '',
        quantity: 0,
        useTickets: 0,
    })
    const setSelectionItem = (key, item = {}) => {
        const quantity = Number(item.quantity || 0)
        const useTickets = Number(item.useTickets || 0)
        const next = { ...selectionItems.value }
        if (quantity <= 0 && useTickets <= 0) {
            delete next[key]
        } else {
            next[key] = { ...item, quantity, useTickets }
        }
        selectionItems.value = next
    }
    const ensureStoreEntrySelection = (store = {}, entry = {}) => {
        const key = storeEntryKey(store, entry)
        if (!key || !entry?.type) return { key: '', item: null }
        const existing = selectionItems.value[key]
        if (existing) return { key, item: existing }
        return { key, item: buildSelectionItem(store, entry) }
    }
    const pruneSelectionsForStores = (list = []) => {
        const validKeys = new Set()
        list.forEach(store => {
            Object.keys(store?.prices || {}).forEach(type => validKeys.add(selectionKeyFromParts(store.id, type)))
        })
        const next = {}
        Object.entries(selectionItems.value).forEach(([key, item]) => {
            if (validKeys.has(key)) next[key] = item
        })
        selectionItems.value = next
    }
    const fetchStores = async (id) => {
        loadingStores.value = true
        storesError.value = ''
        try {
            const { data } = await api.get(`${API}/events/${id}/stores`)
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            stores.value = list.map(s => {
                const storeId = s.id ?? s.store_id ?? s.storeId ?? null
                const address = s.address || s.location || s.city || ''
                const externalUrl = normalizeHttpUrl(s.external_url || s.externalUrl || '')
                const businessHours = s.business_hours || s.businessHours || ''
                const capacity = normalizeCapacityValue(s.capacity)
                const reservedQuantity = Math.max(0, Math.floor(Number(s.reserved_quantity || s.reservedQuantity || 0)))
                const remainingInput = s.capacity_remaining ?? s.capacityRemaining
                const capacityRemaining = capacity === null
                    ? null
                    : Math.max(0, Math.floor(Number(remainingInput ?? (capacity - reservedQuantity))))
                return {
                    id: storeId,
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
                    providerUserId: s.provider_user_id || s.owner_user_id || '',
                    prices: normalizeStorePrices(s.prices || {}),
                }
            })
            activeStorePage.value = 1
            pruneSelectionsForStores(stores.value)
        } catch (error) {
            storesError.value = apiErrorMessage(error, '交車點暫時無法載入，請稍後再試。')
        }
        finally { loadingStores.value = false }
    }

    // 票券（可用）
    const loadTickets = async () => {
        if (!loggedIn.value) {
            tickets.value = []
            ticketsError.value = ''
            return
        }
        ticketsLoading.value = true
        ticketsError.value = ''
        try {
            const { data } = await api.get(`${API}/tickets/me`)
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            const editingTicketIds = new Set((Array.isArray(editingOrderDetails.value?.ticketsUsed) ? editingOrderDetails.value.ticketsUsed : []).map(Number))
            tickets.value = list
                .filter(t => (!t.used || editingTicketIds.has(Number(t.id))) && !isTicketExpired(t))
                .map(t => ({ ...t, used: editingTicketIds.has(Number(t.id)) ? false : t.used, expired: false }))
        } catch (e) {
            if (e?.response?.status === 401) {
                loggedIn.value = false
                sessionProfile.value = null
            } else {
                ticketsError.value = apiErrorMessage(e, '票券暫時無法同步，可稍後重試或先以現金方案預約。')
            }
        } finally {
            ticketsLoading.value = false
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
        for (const item of selectedPriceItems.value) {
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
    const draftEventCode = computed(() => String(eventDetail.value.code || routeCode.value || '').trim())

    const restoreCurrentDraft = () => {
        if (editingOrderId.value) return true
        if (loggedIn.value && ticketsError.value) return false
        const draft = loadBookingDraft(draftEventCode.value)
        if (!draft) return true
        const restored = pruneBookingDraft(draft, {
            stores: stores.value,
            ticketAvailability: ticketsAvailableByBinding.value,
            allowTickets: loggedIn.value && !ticketsError.value,
        })
        const next = {}
        restored.selections.forEach(saved => {
            const store = stores.value.find(item => String(item.id ?? '') === String(saved.storeId ?? ''))
            const price = store?.prices?.[saved.type]
            if (!store || !price) return
            const key = selectionKeyFromParts(store.id, saved.type)
            next[key] = {
                ...buildSelectionItem(store, { type: saved.type, ...price }),
                quantity: saved.quantity,
                useTickets: saved.useTickets,
            }
        })
        selectionItems.value = next
        addOn.value = { ...addOn.value, ...restored.addOn }
        expandedStoreIds.value = new Set(restored.selections.map(item => String(item.storeId ?? '')))
        return true
    }
    const retryStores = async () => {
        if (!currentEventId.value) return initializeBooking()
        await fetchStores(currentEventId.value)
        if (storesError.value || eventError.value) return
        if (editingOrderId.value && editingOrderDetails.value) applyEditingOrderDetails()
        else draftReady.value = restoreCurrentDraft()
    }
    const retryTickets = async () => {
        await loadTickets()
        if (!ticketsError.value) draftReady.value = restoreCurrentDraft()
    }

    const loadEditingOrder = async () => {
        if (!editingOrderId.value) return true
        try {
            const { data } = await api.get(`${API}/orders/${editingOrderId.value}`)
            const order = data?.data || data || {}
            const details = typeof order.details === 'string' ? JSON.parse(order.details) : (order.details || {})
            const status = String(details.status || '').trim()
            if (['已付款', '已完成', '待指派', '已取消'].includes(status)) {
                await showNotice(status === '已取消' ? '已取消的訂單無法修改' : '付款確認完成後無法修改訂單', { title: '無法修改訂單' })
                return false
            }
            const orderEventId = Number(details?.event?.id || details.event_id || details.eventId)
            if (orderEventId && orderEventId !== Number(currentEventId.value)) {
                await showNotice('訂單所屬服務檔期與目前頁面不一致', { title: '無法修改訂單' })
                return false
            }
            editingOrderDetails.value = details
            editingOrderCode.value = order.code || ''
            return true
        } catch (e) {
            await showNotice(e?.response?.data?.message || e.message || '無法讀取訂單', { title: '無法修改訂單' })
            return false
        }
    }

    const applyEditingOrderDetails = () => {
        const details = editingOrderDetails.value
        if (!details) return
        const next = {}
        for (const selection of (Array.isArray(details.selections) ? details.selections : [])) {
            const store = stores.value.find(item => String(item.id) === String(selection.storeId ?? selection.store_id))
            if (!store) continue
            const type = String(selection.type || selection.ticketType || '')
            const priceType = Object.keys(store.prices || {}).find(key => normalizeTypeName(key) === normalizeTypeName(type))
            if (!priceType) continue
            const key = selectionKeyFromParts(store.id, priceType)
            const current = next[key] || buildSelectionItem(store, { type: priceType, ...(store.prices[priceType] || {}) })
            if (selection.byTicket) current.useTickets = Number(current.useTickets || 0) + Number(selection.qty || selection.quantity || 0)
            else current.quantity = Number(current.quantity || 0) + Number(selection.qty || selection.quantity || 0)
            next[key] = current
        }
        selectionItems.value = next
        addOn.value = {
            ...addOn.value,
            ...(details.addOn || {}),
            purchasePolicy: false,
            usagePolicy: false,
        }
    }

    const selectedPriceItems = computed(() => Object.values(selectionItems.value)
        .filter(item => item && (Number(item.quantity || 0) > 0 || Number(item.useTickets || 0) > 0)))
    const selectedStoreIds = computed(() => Array.from(new Set(selectedPriceItems.value
        .map(item => String(item.storeId || '').trim())
        .filter(Boolean))))
    const selectedStores = computed(() => selectedStoreIds.value
        .map(id => stores.value.find(store => String(store.id || '') === id))
        .filter(Boolean))
    const selectedStoreCount = computed(() => selectedStores.value.length)
    const selectedStoreSummary = computed(() => {
        const names = selectedStores.value.map(store => store.name || `交車點 #${store.id}`)
        if (!names.length) return ''
        if (names.length <= 3) return names.join('、')
        return `${names.slice(0, 3).join('、')} 等 ${names.length} 個交車點`
    })

    // 目前預約總數（含使用票券與付費數量）
    const reservationQuantity = computed(() => {
        return selectedPriceItems.value.reduce((sum, item) => sum + Number(item.useTickets || 0) + Number(item.quantity || 0), 0)
    })
    const selectedTicketQuantity = computed(() => selectedPriceItems.value
        .reduce((sum, item) => sum + Number(item.useTickets || 0), 0))

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
    const scrollToAddOn = () => {
        const el = addOnSectionRef.value
        if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    const scrollToSummary = () => {
        const el = summarySectionRef.value
        if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    const runBookingAction = (card) => {
        if (!card) return
        if (card.action === 'login') {
            router.push({ path: '/login', query: { redirect: route.fullPath || route.path } })
        } else if (card.action === 'wallet') {
            router.push({ path: '/wallet', query: { tab: 'tickets' } })
        } else if (card.action === 'review') {
            scrollToStores()
        }
    }
    const handleBookingActionCard = (card) => {
        if (!card) return
        if (openMobileGuide(card)) return
        runBookingAction(card)
    }

    const bookingGuideSheet = computed(() => {
        const guide = activeGuide.value || {}
        const contactStatusItems = [
            {
                key: 'username',
                icon: profileNameComplete.value ? 'check' : 'info',
                label: '真實姓名',
                value: profileNameComplete.value ? '已完成' : '尚未填寫',
                tone: profileNameComplete.value ? 'success' : 'warning',
            },
            {
                key: 'email',
                icon: profileEmailComplete.value ? 'check' : 'info',
                label: '電子信箱',
                value: profileEmailComplete.value ? '已完成' : '尚未填寫',
                tone: profileEmailComplete.value ? 'success' : 'warning',
            },
            {
                key: 'phone',
                icon: profilePhoneComplete.value ? 'check' : 'info',
                label: '手機號碼',
                value: profilePhoneComplete.value ? '已完成' : '尚未填寫或格式不足',
                tone: profilePhoneComplete.value ? 'success' : 'warning',
            },
            {
                key: 'remittance',
                icon: profileRemittanceComplete.value ? 'check' : 'info',
                label: '匯款帳號後五碼',
                value: profileRemittanceComplete.value ? '已完成' : '需填寫 5 碼數字',
                tone: profileRemittanceComplete.value ? 'success' : 'warning',
            },
        ]
        if (guide.action === 'login' || guide.action === 'login-required') {
            return {
                eyebrow: '帳戶',
                title: '登入後才能預約',
                description: '登入後可讀取票券、保存預約進度，並在送出前確認必要聯絡資料。',
                statusItems: [
                    { key: 'login', icon: 'user', label: '登入狀態', value: '尚未登入', tone: 'warning' },
                ],
                steps: [
                    { title: '前往登入', detail: '登入後會回到目前服務檔期。' },
                    { title: '確認可用票券', detail: '若有對應票券，可在交車點價格列直接抵扣。' },
                    { title: '完成預約確認', detail: '最後會閱讀購買須知、使用規定與服務商條款。' },
                ],
                primaryLabel: '前往登入',
                secondaryLabel: '留在本頁',
            }
        }
        if (guide.action === 'profile-required') {
            return {
                eyebrow: '預約資料',
                title: '先補齊必要資料',
                description: '真實姓名、Email、手機號碼與匯款帳號後五碼會用於訂單通知與付款核對，完成後即可回來送出預約。',
                statusItems: contactStatusItems,
                steps: [
                    { title: '進入帳戶中心', detail: '在資料管理頁補齊真實姓名、Email、手機與匯款後五碼。' },
                    { title: '回到本次預約', detail: '已選交車點與數量會從本機草稿恢復。' },
                    { title: '閱讀規定並送出', detail: '送出前會開啟條款閱讀抽屜。' },
                ],
                primaryLabel: '補齊資料',
                secondaryLabel: '稍後處理',
            }
        }
        if (guide.action === 'wallet') {
            return {
                eyebrow: '票券',
                title: `可用票券 ${tickets.value.length} 張`,
                description: '可先查看錢包中的票券，也可以回到交車點價格列直接選擇抵扣數量。',
                statusItems: [
                    { key: 'tickets', icon: 'ticket', label: '可用票券', value: `${tickets.value.length} 張`, tone: 'success' },
                    { key: 'store', icon: 'store', label: '已選交車點', value: selectedStoreSummary.value || '尚未選擇', tone: selectedStoreCount.value ? 'success' : 'warning' },
                ],
                steps: [
                    { title: '確認票券適用方案', detail: '系統會依綁定商品或票券名稱比對。' },
                    { title: '回到交車點價格列', detail: '在「使用票券抵扣」調整數量。' },
                    { title: '確認摘要與規定', detail: '送出前再核對總金額與條款。' },
                ],
                primaryLabel: '檢視錢包',
                secondaryLabel: '回到交車點',
            }
        }
        if (guide.action === 'review' || guide.action === 'reservation-progress') {
            return {
                eyebrow: '預約進度',
                title: `已選 ${reservationQuantity.value} 項預約`,
                description: '送出前請確認交車點、票券抵扣、加購項目與總金額。',
                statusItems: [
                    { key: 'store', icon: 'store', label: '交車點', value: selectedStoreSummary.value || '尚未選擇', tone: selectedStoreCount.value ? 'success' : 'warning' },
                    { key: 'quantity', icon: 'ticket', label: '預約數量', value: `${reservationQuantity.value} 項`, tone: reservationQuantity.value > 0 ? 'success' : 'warning' },
                    { key: 'total', icon: 'orders', label: '預估總額', value: formatPriceAmount(finalTotal.value), tone: 'default' },
                ],
                steps: [
                    { title: '回到交車點價格列', detail: '仍可調整購買數量與票券抵扣。' },
                    { title: '完成包裝確認', detail: '未妥善包裝的貨物不予託運。' },
                    { title: '送出前閱讀條款', detail: '系統會要求讀完本次預約規定。' },
                ],
                primaryLabel: '回到交車點',
                secondaryLabel: '查看摘要',
            }
        }
        if (guide.action === 'packaging-required') {
            return {
                eyebrow: '包裝確認',
                title: '先確認包裝規定',
                description: '預約送出前，需要確認已了解未妥善包裝之貨物不予託運。',
                statusItems: [
                    { key: 'packaging', icon: 'shield', label: '包裝確認', value: addOn.value.nakedConfirm ? '已確認' : '尚未勾選', tone: addOn.value.nakedConfirm ? 'success' : 'warning' },
                ],
                steps: [
                    { title: '回到加值服務與確認', detail: '勾選包裝規定確認。' },
                    { title: '檢查是否需要包材', detail: '若需要包材，可同步調整份數。' },
                    { title: '再送出預約', detail: '最後會進入條款閱讀抽屜。' },
                ],
                primaryLabel: '前往確認',
                secondaryLabel: '稍後處理',
            }
        }
        if (guide.action === 'store-required' || guide.action === 'quantity-required' || guide.action === 'capacity') {
            const isCapacity = guide.action === 'capacity'
            const isQuantity = guide.action === 'quantity-required'
            return {
                eyebrow: '交車點',
                title: isCapacity ? '交車點收容數量不足' : (isQuantity ? '尚未選擇預約數量' : '先選擇交車點'),
                description: isCapacity
                    ? `目前交車點剩餘 ${guide.remainingCapacity ?? 0} 輛，請調整數量或改選其他交車點。`
                    : '需要先選定交車點，再選擇購買數量或票券抵扣數量。',
                statusItems: [
                    { key: 'store', icon: 'store', label: '交車點', value: selectedStoreSummary.value || '尚未選擇', tone: selectedStoreCount.value ? 'success' : 'warning' },
                    { key: 'quantity', icon: 'ticket', label: '預約數量', value: `${reservationQuantity.value} 項`, tone: reservationQuantity.value > 0 ? 'success' : 'warning' },
                ],
                steps: [
                    { title: '回到交車點清單', detail: '查看地址、電話、收容數量與價目表。' },
                    { title: '選定交車點', detail: '可依需求選擇一個或多個交車點，各點數量會分開計算。' },
                    { title: '調整數量或票券抵扣', detail: '確認摘要出現項目後再送出。' },
                ],
                primaryLabel: '回到交車點',
                secondaryLabel: '查看摘要',
            }
        }
        return {
            eyebrow: '下一步',
            title: '確認預約流程',
            description: '依照目前狀態完成登入、交車點、數量、包裝與條款確認。',
            steps: [
                { title: '選擇交車點' },
                { title: '調整數量與票券抵扣' },
                { title: '確認規定後送出' },
            ],
            primaryLabel: '知道了',
        }
    })

    const handleGuidePrimary = () => {
        const guide = activeGuide.value || {}
        activeGuide.value = null
        if (guide.action === 'login' || guide.action === 'login-required') {
            router.push({ path: '/login', query: { redirect: route.fullPath || route.path } })
            return
        }
        if (guide.action === 'profile-required') {
            router.push({ path: '/account', query: { tab: 'profile' } })
            return
        }
        if (guide.action === 'wallet') {
            router.push({ path: '/wallet', query: { tab: 'tickets' } })
            return
        }
        if (guide.action === 'packaging-required') {
            scrollToAddOn()
            return
        }
        if (guide.action === 'store-required' || guide.action === 'quantity-required' || guide.action === 'capacity' || guide.action === 'review' || guide.action === 'reservation-progress') {
            scrollToStores()
            return
        }
        runBookingAction(guide)
    }
    const handleGuideSecondary = () => {
        const guide = activeGuide.value || {}
        activeGuide.value = null
        if (guide.action === 'wallet' || guide.action === 'store-required' || guide.action === 'quantity-required' || guide.action === 'capacity') {
            scrollToStores()
            return
        }
        if (guide.action === 'review' || guide.action === 'reservation-progress') {
            scrollToSummary()
        }
    }

    // 勾選加購包材後，預先帶入預約總數（仍可手動調整）
    watch(() => addOn.value.material, (checked) => {
        if (checked && Number(addOn.value.materialCount || 0) <= 0) {
            addOn.value.materialCount = reservationQuantity.value
        } else if (!checked) {
            addOn.value.materialCount = 0
        }
    })

    watch(loggedIn, (authed) => {
        if (authed) {
            if (draftReady.value) loadTickets()
        } else {
            tickets.value = []
            ticketsError.value = ''
            sessionProfile.value = null
        }
    })

    watch([selectionItems, addOn], () => {
        if (!draftReady.value || editingOrderId.value || !draftEventCode.value) return
        saveBookingDraft(draftEventCode.value, {
            selectionItems: selectionItems.value,
            addOn: addOn.value,
        })
    }, { deep: true })

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
    const storeStartingPrice = (store = {}) => {
        const prices = storePriceEntries(store)
            .map(item => Number(item.activePrice))
            .filter(value => Number.isFinite(value) && value >= 0)
        return prices.length ? formatPriceAmount(Math.min(...prices)) : ''
    }
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
        selectedPriceItems.value.forEach(item => {
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
    const selectionCapacityIssue = computed(() => {
        for (const store of selectedStores.value) {
            const remainingCapacity = storeCapacityRemaining(store)
            if (remainingCapacity === null) continue
            const storeQty = selectedPriceItems.value
                .filter(item => String(item.storeId || '') === String(store.id || ''))
                .reduce((sum, item) => sum + Number(item.quantity || 0) + Number(item.useTickets || 0), 0)
            if (storeQty > remainingCapacity) return { store, storeQty, remainingCapacity }
        }
        return null
    })
    const nextRequirementLabel = computed(() => {
        if (loadingStores.value || loadingEvent.value) return '等待資料載入'
        if (storesError.value || eventError.value) return '重新載入服務資料'
        if (reservationQuantity.value <= 0) return '選擇交車點與方案數量'
        if (selectionCapacityIssue.value) return '調整超過容量的數量'
        if (selectedTicketQuantity.value > 0 && (ticketsLoading.value || ticketsError.value)) return '重新同步可用票券'
        if (addOn.value.material && Number(addOn.value.materialCount || 0) <= 0) return '填寫包材份數'
        if (!addOn.value.nakedConfirm) return '確認包裝規定'
        if (!loggedIn.value) return '登入帳戶'
        if (!contactInfoComplete.value) return '補齊聯絡與匯款資料'
        return '閱讀規定並送出'
    })
    const selectedStorePriceSummary = computed(() => {
        const rows = selectionsPreview.value
        if (!rows.length) return ''
        const storeCount = selectedStoreCount.value
        return `${storeCount} 個交車點 / ${reservationQuantity.value} 項`
    })
    const activeStorePriceEntries = computed(() => storePriceEntries(activeStoreDetail.value))
    const isSelectedStore = (store) => selectedPriceItems.value.some(item => String(item.storeId || '') === String(store?.id || ''))
    const priceItemForStoreEntry = (store, entry = {}) => {
        return selectionItems.value[storeEntryKey(store, entry)] || null
    }
    const selectedUnitsForStoreExcludingField = (store = {}, targetItem = null, field = 'quantity') => {
        const storeId = String(store?.id || '').trim()
        return selectedPriceItems.value.reduce((sum, item) => {
            if (String(item.storeId || '') !== storeId) return sum
            const itemTotal = Number(item.quantity || 0) + Number(item.useTickets || 0)
            if (targetItem && String(item.type || '') === String(targetItem.type || '') && String(item.storeId || '') === String(targetItem.storeId || storeId)) {
                return sum + itemTotal - Number(item?.[field] || 0)
            }
            return sum + itemTotal
        }, 0)
    }
    const capacityMaxForStoreEntryField = (store, entry = {}, field = 'quantity') => {
        const remaining = storeCapacityRemaining(store)
        if (remaining === null) return 999
        const currentItem = priceItemForStoreEntry(store, entry) || entry
        const selectedWithoutField = selectedUnitsForStoreExcludingField(store, currentItem, field)
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
        const { key, item: target } = ensureStoreEntrySelection(store, entry)
        if (!target) return
        setSelectionItem(key, {
            ...target,
            quantity: Math.max(0, Math.min(quantityMaxForStoreEntry(store, target), Number(value || 0))),
        })
    }
    const setStoreEntryUseTickets = (store, entry = {}, value) => {
        if (!store || !entry?.type || !loggedIn.value) return
        const { key, item: target } = ensureStoreEntrySelection(store, entry)
        if (!target) return
        const max = ticketMaxForStoreEntry(store, target)
        setSelectionItem(key, {
            ...target,
            useTickets: Math.max(0, Math.min(max, Number(value || 0))),
        })
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
        selectedPriceItems.value.forEach(item => {
            const qty = Number(item.useTickets || 0)
            if (qty > 0) items.push({ key: `T-${item.storeId}-${item.type}`, store: item.storeName || '未命名交車點', type: item.type, qty, unit: 0, _byTicket: true })
        })
        // 付費數量
        selectedPriceItems.value.forEach(item => {
            const qty = Number(item.quantity || 0)
            if (qty > 0) {
                const unit = unitPriceForItem(item)
                items.push({ key: `P-${item.storeId}-${item.type}`, store: item.storeName || '未命名交車點', type: item.type, qty, unit, _byTicket: false })
            }
        })
        return items
    })

    // 是否同時建立 reservations（每張票都建一筆）
    // 預約紀錄在訂單「已付款」時由後端建立，這裡不先建立

    // 共用格式化
    const formatRange = (a, b) => formatDateTimeRange(a, b)

    const providerIdFromSource = (source = {}) => String(source.providerUserId || source.provider_user_id || source.owner_user_id || '').trim()
    const selectedServiceSelections = computed(() => selectedStores.value.map(store => {
        const storeId = String(store?.id || '')
        const quantity = selectedPriceItems.value
            .filter(item => String(item.storeId || '') === storeId)
            .reduce((sum, item) => sum + Number(item.quantity || 0) + Number(item.useTickets || 0), 0)
        const providerId = providerIdFromSource(store) || providerIdFromSource(eventDetail.value) || null
        return {
            storeId: store?.id || null,
            deliveryPointId: store?.deliveryPointId || null,
            storeName: store?.name || '',
            providerUserId: providerId,
            provider_user_id: providerId,
            quantity,
        }
    }))
    const requestBookingLegalReview = async (selections = [], total = 0) => {
        const providerIds = Array.from(new Set(selections
            .map(selection => providerIdFromSource(selection))
            .filter(Boolean)))
        const fallbackProviderId = providerIds.length === 1 ? providerIds[0] : providerIdFromSource(eventDetail.value)
        const eventRules = (eventDetail.value.deliveryNotes || []).join('\n')
        const extraSections = eventRules
            ? [{
                key: 'event-rules',
                title: `${eventDetail.value.name || '服務檔期'}活動規定`,
                content: eventRules,
            }]
            : []
        const items = selections.map((selection, index) => ({
            name: `${eventDetail.value.name || '預約服務'}｜${selection.type || `方案 ${index + 1}`}`,
            quantity: selection.qty,
            providerId: providerIdFromSource(selection) || fallbackProviderId,
            detail: [
                selection.store || '未命名交車點',
                selection.byTicket ? '票券抵扣' : formatPriceAmount(selection.subtotal || (selection.unitPrice * selection.qty)),
            ].filter(Boolean).join('｜'),
        }))
        if (addOn.value.material && Number(addOn.value.materialCount || 0) > 0) {
            items.push({
                name: '加購包材',
                quantity: Number(addOn.value.materialCount || 0),
                providerId: fallbackProviderId,
                detail: formatPriceAmount(addOnCost.value),
            })
        }
        const acceptedLegal = await legalReviewRef.value?.open({
            title: '請閱讀本次預約規定',
            description: `送出預約前，請閱讀購買須知、使用規定與對應服務商條款。預估總金額 ${formatPriceAmount(total)}。`,
            items,
            providerIds,
            pageSlugs: ['reservation-notice', 'reservation-rules'],
            extraSections,
        })
        return acceptedLegal === true
    }

    const currentOrderContact = () => {
        const info = sessionProfile.value || {}
        return {
            username: String(info.username || '').trim(),
            email: String(info.email || '').trim(),
            phone: String(info.phone || '').trim(),
            remittanceLast5: String((info.remittanceLast5 ?? info.remittance_last5) || '').trim(),
        }
    }

    const requestBookingUserDataReview = async (selections = [], total = 0, contact = {}) => {
        const quantity = selections.reduce((sum, selection) => sum + Number(selection.qty || 0), 0)
        const accepted = await userDataReviewRef.value?.open({
            title: '再次確認預約使用者資料',
            description: '這些聯絡與付款辨識資料將隨本次訂單送出，請再次逐項核對。',
            summary: [{
                key: 'booking-order',
                label: eventDetail.value.name || '預約服務',
                value: `${quantity} 項`,
                detail: [selectedStoreSummary.value, `合計 ${formatPriceAmount(total)}`].filter(Boolean).join('｜'),
            }],
            fields: [
                { key: 'username', label: '真實姓名', value: contact.username },
                { key: 'email', label: '電子信箱', value: contact.email },
                { key: 'phone', label: '手機號碼', value: contact.phone },
                { key: 'remittanceLast5', label: '匯款帳號後五碼', value: contact.remittanceLast5 },
            ],
        })
        return accepted === true
    }

    // 建立訂單（單筆 items[0]）
    const confirmReserve = async () => {
        if (reservationSubmitting.value) return
        reservationSubmitting.value = true
        try {
        if (loadingEvent.value || loadingStores.value) {
            await showNotice('服務資料仍在載入，請稍候。')
            return
        }
        if (eventError.value || storesError.value) {
            await showNotice(eventError.value || storesError.value, { title: '請先重新載入' })
            return
        }
        if (reservationQuantity.value <= 0) {
            if (openMobileGuide({ action: 'quantity-required' })) return
            await showNotice('請先選擇交車點、方案與數量')
            return
        }
        if (selectionCapacityIssue.value) {
            const { store, storeQty, remainingCapacity } = selectionCapacityIssue.value
            if (openMobileGuide({ action: 'capacity', remainingCapacity })) return
            await showNotice(`${store.name || '此交車點'}收容數量剩餘 ${remainingCapacity} 輛，無法建立 ${storeQty} 輛託運訂單`, { title: '收容數量不足' })
            return
        }
        if (selectedTicketQuantity.value > 0 && (ticketsLoading.value || ticketsError.value)) {
            await showNotice(ticketsError.value || '票券尚在同步，請稍候。', { title: '請先確認票券' })
            return
        }
        if (addOn.value.material && Number(addOn.value.materialCount || 0) <= 0) {
            await showNotice('請填寫加購包材份數')
            return
        }
        if (!addOn.value.nakedConfirm) {
            if (openMobileGuide({ action: 'packaging-required' })) return
            await showNotice('請先確認包裝規定')
            return
        }
        if (!(await checkSession())) {
            if (openMobileGuide({ action: 'login-required', source: 'reserve' })) return
            await showNotice('請先登入再預約', { title: '需要登入' })
            const redirectTarget = route.fullPath || route.path
            router.push({ path: '/login', query: { redirect: redirectTarget } })
            return
        }
        if (!(await ensureContactInfoReady())) return

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
        for (const item of selectedPriceItems.value) {
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
                const providerId = providerIdFromSource(item) || providerIdFromSource(eventDetail.value) || null
                selections.push({
                    store: item.storeName || '',
                    storeId: item.storeId || null,
                    deliveryPointId: item.deliveryPointId || null,
                    providerUserId: providerId,
                    provider_user_id: providerId,
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
        selectedPriceItems.value.forEach(item => {
            const qty = Number(item.quantity || 0)
            if (qty > 0) {
                const productId = productIdForType(item)
                const unitPrice = unitPriceForItem(item)
                const lineSubtotal = unitPrice * qty
                const providerId = providerIdFromSource(item) || providerIdFromSource(eventDetail.value) || null
                selections.push({
                    store: item.storeName || '',
                    storeId: item.storeId || null,
                    deliveryPointId: item.deliveryPointId || null,
                    providerUserId: providerId,
                    provider_user_id: providerId,
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

        const addOnCostValue = addOnCost.value
        const subtotalWithTickets = subtotal.value + ticketDiscountTotal
        const discountTotal = ticketDiscountTotal
        const total = Math.max(subtotalWithTickets + addOnCostValue - discountTotal, 0)
        const legalAccepted = await requestBookingLegalReview(selections, total)
        if (!legalAccepted) return
        addOn.value.purchasePolicy = true
        addOn.value.usagePolicy = true

        try {
            const serviceSelections = selectedServiceSelections.value
            const singleServiceSelection = serviceSelections.length === 1 ? serviceSelections[0] : null
            const providerIds = Array.from(new Set(serviceSelections.map(item => providerIdFromSource(item)).filter(Boolean)))
            const fallbackProviderId = providerIds.length === 1 ? providerIds[0] : providerIdFromSource(eventDetail.value) || null
            const details = {
                kind: 'event-reservation',
                event: { id: eventDetail.value.id, code: eventDetail.value.code, name: eventDetail.value.name, date: eventDetail.value.date || formatRange(eventDetail.value.starts_at, eventDetail.value.ends_at) },
                serviceSelection: {
                    storeId: singleServiceSelection?.storeId || null,
                    deliveryPointId: singleServiceSelection?.deliveryPointId || null,
                    storeName: singleServiceSelection?.storeName || selectedStoreSummary.value || '',
                    providerUserId: singleServiceSelection?.providerUserId || fallbackProviderId,
                    provider_user_id: singleServiceSelection?.providerUserId || fallbackProviderId,
                },
                serviceSelections,
                storeSummary: selectedStoreSummary.value || '',
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
            if (isEditingOrder.value) {
                await api.patch(`${API}/orders/${editingOrderId.value}`, { details })
            } else {
                const contactConfirmation = currentOrderContact()
                const userDataConfirmed = await requestBookingUserDataReview(selections, total, contactConfirmation)
                if (!userDataConfirmed) return
                if (!reservationIdempotencyKey.value) {
                    reservationIdempotencyKey.value = createOrderIdempotencyKey('booking')
                }
                await api.post(`${API}/orders`, {
                    contactConfirmation,
                    items: [details],
                    idempotencyKey: reservationIdempotencyKey.value,
                })
            }

            // 無需標記優惠券使用

            if (!isEditingOrder.value) clearBookingDraft(draftEventCode.value)
            await showNotice(isEditingOrder.value ? `✅ 訂單已更新\n總金額：${total} 元` : `✅ 已成功建立訂單\n總金額：${total} 元`)
            router.push(isEditingOrder.value ? { path: '/store', query: { orders: '1' } } : { path: '/wallet', query: { tab: 'reservations' } })
        } catch (err) {
            if (err?.response) reservationIdempotencyKey.value = ''
            const code = err?.response?.data?.code
            const message = code === 'ORDER_REMITTANCE_MIXED'
                ? '本次選擇包含不同匯款資訊的交車點，請分開下單'
                : (err?.response?.data?.message || err.message || '系統錯誤')
            await showNotice(message, { title: '錯誤' })
        }
        } finally {
            reservationSubmitting.value = false
        }
    }

    const checkSession = async () => {
        try {
            const { data } = await api.get(`${API}/me`)
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
            if (!authed) {
                if (openMobileGuide({ action: 'login-required', source: 'reserve' })) return false
                return false
            }
        }
        const info = sessionProfile.value || {}
        const username = String(info.username || '').trim()
        const email = String(info.email || '').trim()
        const phoneDigits = String(info.phone || '').replace(/\D/g, '')
        const last5 = String((info.remittanceLast5 ?? info.remittance_last5) || '').trim()
        if (!username || !email || phoneDigits.length < 8 || !/^\d{5}$/.test(last5)) {
            if (openMobileGuide({ action: 'profile-required', source: 'reserve' })) return false
            await showNotice('請先於帳戶中心補齊真實姓名、Email、手機號碼與匯款帳號後五碼，再送出預約', { title: '需要補完資料' })
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

    const initializeBooking = async () => {
        draftReady.value = false
        eventError.value = ''
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
            } catch (error) {
                eventError.value = apiErrorMessage(error, '無法查詢服務檔期，請稍後重試。')
                loadingEvent.value = false
                loadingStores.value = false
                return
            }
        }

        if (!id) {
            loadingEvent.value = false
            loadingStores.value = false
            return
        }

        currentEventId.value = id
        await Promise.all([fetchEvent(id), fetchStores(id)])

        const authed = await checkSession()
        if (editingOrderId.value && !authed) {
            router.push({ path: '/login', query: { redirect: route.fullPath || route.path } })
            return
        }
        if (editingOrderId.value && !(await loadEditingOrder())) {
            router.push({ path: '/store', query: { orders: '1' } })
            return
        }
        if (authed) await loadTickets()
        if (editingOrderId.value) applyEditingOrderDetails()
        else if (!storesError.value && !eventError.value) draftReady.value = restoreCurrentDraft()
    }

    onMounted(async () => {
        window.addEventListener('auth-changed', handleAuthChanged)
        window.addEventListener('storage', handleStorage)
        await initializeBooking()
    })

    onBeforeUnmount(() => {
        window.removeEventListener('auth-changed', handleAuthChanged)
        window.removeEventListener('storage', handleStorage)
    })
</script>
