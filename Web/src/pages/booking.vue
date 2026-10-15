<template>
    <main class="ops-page booking-page">
        <header class="booking-heading">
            <div>
                <p class="text-sm font-medium text-primary">單車託運服務</p>
                <h1 class="ui-title mt-1 text-2xl text-slate-950 sm:text-3xl">{{ isEditingOrder ? '修改託運訂單' : '預約單車託運' }}</h1>
                <p class="mt-2 text-sm leading-6 text-slate-600">選擇交車點與輛數，再確認票券抵免及應付費用。</p>
            </div>
            <div class="flex flex-wrap gap-2">
                <button type="button" class="btn btn-outline btn-sm" @click="router.push('/store')"><AppIcon name="arrow-left" class="h-4 w-4" /> 購票中心</button>
                <button type="button" class="btn btn-outline btn-sm" @click="goWalletReservations">我的預約</button>
            </div>
        </header>
        <div v-if="isEditingOrder" class="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            正在修改訂單 {{ editingOrderCode || `#${editingOrderId}` }}。付款確認完成前可調整託運者姓名、交車點、方案、數量、票券與包材。
        </div>
        <nav class="booking-steps" aria-label="預約步驟">
            <button v-for="step in bookingSteps" :key="step.number" type="button" @click="goToBookingStep(step.number)">
                <span class="booking-step-number" :class="{ 'is-complete': step.complete }"><AppIcon v-if="step.complete" name="check" class="h-4 w-4" /><template v-else>{{ step.number }}</template></span>
                <span>{{ step.label }}</span>
            </button>
        </nav>
        <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div class="min-w-0 space-y-5">
                <div v-if="loadingEvent" class="ticket-card animate-pulse bg-white p-5" aria-busy="true" aria-label="正在載入服務檔期"><div class="h-5 w-2/3 rounded bg-slate-200"></div><div class="mt-4 h-4 w-1/2 rounded bg-slate-200"></div></div>
                <div v-else-if="eventError" class="ticket-card border-red-200 bg-red-50 p-5 text-sm text-red-900" role="alert">
                    <p class="font-semibold">無法載入服務檔期</p><p class="mt-1 leading-6">{{ eventError }}</p>
                    <button type="button" class="btn btn-outline btn-sm mt-3" @click="retryEvent">重新載入</button>
                </div>
                <div v-else-if="!eventDetail.id" class="ticket-card bg-white p-5 text-sm text-slate-600">
                    <p class="font-semibold text-slate-950">找不到這個服務檔期</p><p class="mt-1">請回到購票中心選擇目前可預約的服務。</p>
                    <button type="button" class="btn btn-outline btn-sm mt-3" @click="router.push('/store')">回到購票中心</button>
                </div>
                <section v-else class="ticket-card overflow-hidden bg-white p-0" aria-label="服務檔期">
                    <div class="booking-event">
                        <img :src="eventDetail.cover || '/transport-fallback.png'" @error="(e)=>e.target.src='/transport-fallback.png'" :alt="bookingImageAlt" class="booking-event-cover" />
                        <div class="min-w-0 space-y-2">
                            <p class="text-xs font-medium text-slate-500">服務 {{ eventDetail.code }}</p>
                            <h2 class="ui-title text-lg leading-snug text-slate-950 sm:text-xl">{{ eventDetail.name }}</h2>
                            <p v-if="eventDetail.date || eventDetail.starts_at || eventDetail.ends_at" class="text-sm text-slate-600">{{ eventDetail.date || formatRange(eventDetail.starts_at, eventDetail.ends_at) }}</p>
                        </div>
                    </div>
                    <div v-if="eventDetail.deadline" class="border-t border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                        報名截止 {{ formatTaipeiDateTime(eventDetail.deadline, { fallback: '時間待更新' }) }}（台灣時間）
                    </div>
                    <details v-if="eventDetail.description || eventDetail.deliveryNotes.length" class="booking-event-details">
                        <summary>服務說明與注意事項</summary>
                        <div class="space-y-3 px-4 pb-4 text-sm leading-6 text-slate-600">
                            <p v-if="eventDetail.description">{{ eventDetail.description }}</p>
                            <ul v-if="eventDetail.deliveryNotes.length" class="list-disc space-y-1 pl-5"><li v-for="note in eventDetail.deliveryNotes" :key="note">{{ note }}</li></ul>
                        </div>
                    </details>
                </section>

                <section ref="storesSectionRef" class="surface-section space-y-4 booking-section" tabindex="-1" aria-labelledby="booking-stores-heading">
                    <div>
                        <h3 id="booking-stores-heading" class="ui-title flex items-center gap-2 text-xl text-slate-950"><span class="booking-section-number">1</span> 交車點與方案</h3>
                        <p class="mt-2 text-sm leading-6 text-slate-600">先選預約總輛數，再選其中要使用的票券張數。可選擇多個交車點。</p>
                    </div>
                    <div v-if="bookingInitializing" class="rounded-xl bg-slate-50 p-3 text-sm text-slate-600" role="status">正在讀取預約與票券資訊…</div>
                    <div v-else-if="!loggedIn" class="booking-account-note">
                        <div><p class="font-medium text-slate-950">有票券？登入後即可抵免</p><p class="mt-1 text-sm text-slate-600">可先選方案，登入後會保留本次選擇。</p></div>
                        <button type="button" class="btn btn-outline btn-sm shrink-0" @click="goBookingLogin">登入</button>
                    </div>
                    <div v-else-if="ticketsLoading" class="rounded-xl bg-slate-50 p-3 text-sm text-slate-600" role="status">正在同步可用票券…</div>
                    <div v-else-if="ticketsError" class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">
                        <p>無法同步票券：{{ ticketsError }}</p><button type="button" class="btn btn-outline btn-sm mt-2" @click="retryTickets">重試票券同步</button>
                    </div>
                    <div v-else class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                        <span>{{ tickets.length ? `錢包有 ${tickets.length} 張可用票券，各方案會顯示適用張數。` : '目前沒有可用票券，可直接購買託運服務。' }}</span>
                        <button v-if="tickets.length" type="button" class="text-primary underline underline-offset-4" @click="router.push({ path: '/wallet', query: { tab: 'tickets' } })">查看票券</button>
                    </div>
                    <AppSearchInput v-model="storeSearch" placeholder="搜尋交車點、地址或方案" container-class="relative w-full" @clear="clearStoreSearch" />
                    <p v-if="draftRestoreMessage" class="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900" role="status">{{ draftRestoreMessage }}</p>
                    <div v-if="eventError" class="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">請先重新載入服務檔期，再選擇交車點與方案。</div>
                    <div v-else-if="loadingStores" class="space-y-3" aria-busy="true" aria-label="正在載入交車點"><div v-for="i in 3" :key="i" class="h-28 animate-pulse rounded-xl bg-slate-100"></div></div>
                    <div v-else-if="storesError" class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
                        <p class="font-semibold">無法載入交車點</p><p class="mt-1">{{ storesError }}</p><button type="button" class="btn btn-outline btn-sm mt-3" @click="retryStores">重試交車點載入</button>
                    </div>
                    <div v-else-if="!filteredStores.length" class="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">
                        <p>{{ storeSearch ? '沒有符合搜尋條件的交車點。' : '目前尚無可用交車點。' }}</p><button v-if="storeSearch" type="button" class="btn btn-outline btn-sm mt-3" @click="clearStoreSearch">清除搜尋</button>
                    </div>
                    <div v-else class="space-y-3">
                        <article v-for="store in displayedStores" :key="store.id || store.name" class="booking-store t-acc" :class="{ 'is-selected': isSelectedStore(store) }" :data-open="String(isStorePlansExpanded(store))">
                            <div class="booking-store-header">
                                <div class="min-w-0">
                                    <h4 class="ui-title text-lg text-slate-950">{{ store.name }}</h4>
                                    <p v-if="store.address || store.location" class="mt-1 text-sm leading-6 text-slate-600">{{ store.address || store.location }}</p>
                                    <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                                        <span v-if="storeStartingPrice(store)" class="font-semibold text-primary">{{ storeStartingPrice(store) }} 起 / 輛</span>
                                        <span :class="isStoreCapacityFull(store) ? 'text-red-700' : 'text-slate-500'">{{ storeCapacityLabel(store) }}</span>
                                        <span v-if="isSelectedStore(store)" class="font-medium text-primary">已選 {{ selectedQuantityForStore(store) }} 輛</span>
                                    </div>
                                </div>
                                <div class="booking-store-actions">
                                    <button type="button" class="btn btn-outline btn-sm" :aria-label="`${store.name} 交車點資訊`" @click="openStoreDetail(store)">交車點資訊</button>
                                    <button type="button" class="btn btn-sm" :class="isStorePlansExpanded(store) ? 'btn-primary text-white' : 'btn-outline'" :aria-label="`${store.name} ${isStorePlansExpanded(store) ? '收合方案' : '選擇方案'}`" :aria-expanded="isStorePlansExpanded(store)" :aria-controls="storePlansId(store)" @click="toggleStorePlans(store)">
                                        {{ isStorePlansExpanded(store) ? '收合方案' : '選擇方案' }}<span class="t-acc-chevron" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6L8 10L12 6" /></svg></span>
                                    </button>
                                </div>
                            </div>
                            <div :id="storePlansId(store)" class="t-acc-panel" :inert="!isStorePlansExpanded(store)" :aria-hidden="!isStorePlansExpanded(store)">
                                <div class="t-acc-panel-inner">
                                    <div class="booking-store-content">
                                        <p v-if="isStoreCapacityFull(store)" class="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">此交車點已額滿，請選擇其他地點。</p>
                                        <div v-if="storePriceEntries(store).length" class="grid gap-3" :class="{ 'xl:grid-cols-2': storePriceEntries(store).length > 1 }">
                                            <fieldset v-for="item in storePriceEntries(store)" :id="entryControlId(store, item)" :key="`${store.id}-${item.type}`" class="booking-plan" :class="{ 'is-selected': totalForStoreEntry(store, item) > 0 }">
                                                <legend class="sr-only">{{ store.name }} {{ item.type }}</legend>
                                                <div class="flex flex-wrap items-start justify-between gap-2">
                                                    <h5 class="font-semibold text-slate-950">{{ item.type }}</h5><span class="booking-price-stage">{{ item.activeMode === 'early' ? '早鳥優惠' : '一般價格' }}</span>
                                                </div>
                                                <div class="mt-2 flex flex-wrap items-baseline gap-2"><span class="money-value text-2xl text-primary">{{ formatPriceAmount(item.activePrice) }}</span><span class="text-sm text-slate-500">/ 輛</span><del v-if="item.activeMode === 'early' && hasPriceValue(item.normal) && item.normal > item.activePrice" class="text-xs text-slate-500">{{ formatPriceAmount(item.normal) }}</del></div>
                                                <p v-if="item.activeMode === 'early' && (item.early_start || item.early_end)" class="mt-1 text-xs leading-5 text-slate-500">{{ earlyWindowLabel(item) }}</p>
                                                <div class="booking-quantity-row">
                                                    <div><p class="text-sm font-semibold text-slate-950">預約總輛數</p><p class="mt-1 text-xs text-slate-500">包含使用票券的輛數</p></div>
                                                    <QuantityStepper integer :model-value="totalForStoreEntry(store, item)" :min="0" :max="Math.max(totalForStoreEntry(store, item), totalMaxForStoreEntry(store, item))" :disabled="bookingInitializing || (totalMaxForStoreEntry(store, item) <= 0 && totalForStoreEntry(store, item) <= 0)" :aria-label="`${store.name} ${item.type} 預約總輛數`" @update:modelValue="setStoreEntryTotal(store, item, $event)" />
                                                </div>
                                                <div class="booking-ticket-area">
                                                    <div v-if="loggedIn" class="booking-quantity-row">
                                                        <div><p class="text-sm font-medium text-slate-950">其中使用票券</p><p class="mt-1 text-xs text-slate-600">{{ ticketsLoading ? '同步中…' : ticketsError ? '請先重試同步' : `本方案尚可用 ${ticketAvailableForStoreEntry(store, item)} 張` }}</p></div>
                                                        <QuantityStepper integer :model-value="useTicketsForStoreEntry(store, item)" :min="0" :max="ticketMaxForStoreEntry(store, item)" :disabled="bookingInitializing || ticketsLoading || Boolean(ticketsError) || totalForStoreEntry(store, item) <= 0" :aria-label="`${store.name} ${item.type} 其中使用票券張數`" @update:modelValue="setStoreEntryUseTickets(store, item, $event)" />
                                                    </div>
                                                    <button v-else type="button" class="flex min-h-11 items-center gap-2 text-sm font-medium text-primary" @click="goBookingLogin"><AppIcon name="ticket" class="h-4 w-4" /> 登入使用票券抵免</button>
                                                    <p v-if="loggedIn && totalForStoreEntry(store, item) <= 0" class="mt-1 text-xs text-slate-500">先選預約輛數，再選票券張數。</p>
                                                </div>
                                                <div v-if="totalForStoreEntry(store, item) > 0" class="booking-plan-total" aria-live="polite">
                                                    <span>{{ totalForStoreEntry(store, item) }} 輛<span v-if="useTicketsForStoreEntry(store, item)"> · 票券 {{ useTicketsForStoreEntry(store, item) }} 張</span></span><span class="money-value font-semibold">{{ formatPriceAmount(payableForStoreEntry(store, item)) }}</span>
                                                </div>
                                            </fieldset>
                                        </div>
                                        <p v-else class="text-sm text-slate-600">此交車點尚未設定價格。</p>
                                        <p class="text-xs leading-5 text-slate-600">每張票券用於 1 輛，不會增加預約輛數；抵免不足時需補差額。</p>
                                        <HandoverSchedule :schedule="store.handoverSchedule" />
                                    </div>
                                </div>
                            </div>
                        </article>
                    </div>
                    <div v-if="shouldPaginateStores" class="flex flex-wrap items-center gap-2 text-sm"><button type="button" class="btn btn-outline btn-sm" :disabled="activeStorePage <= 1" @click="goPrevStorePage">上一頁</button><span class="text-slate-600">{{ activeStorePage }} / {{ totalStorePages }}</span><button type="button" class="btn btn-outline btn-sm" :disabled="activeStorePage >= totalStorePages" @click="goNextStorePage">下一頁</button></div>
                </section>

                <section ref="consignorSectionRef" class="surface-section space-y-3 booking-section" tabindex="-1" aria-labelledby="booking-consignor-heading">
                    <h3 id="booking-consignor-heading" class="ui-title flex items-center gap-2 text-xl text-slate-950"><span class="booking-section-number">2</span> 託運者資料</h3>
                    <label for="booking-consignor-name" class="block text-sm font-medium text-slate-700">託運者姓名（選填）</label>
                    <input id="booking-consignor-name" ref="consignorNameInputRef" v-model="consignorName" type="text" maxlength="50" :disabled="bookingInitializing" class="w-full" placeholder="未填寫則使用購買者姓名" aria-describedby="booking-consignor-hint booking-consignor-error" :aria-invalid="consignorNameError ? 'true' : 'false'" @input="consignorNameTouched = true; consignorNameError = ''" />
                    <p id="booking-consignor-hint" class="text-sm leading-6 text-slate-600">預設使用購買者帳號姓名，可改為實際託運者；本次修改不會變更會員資料。</p>
                    <p v-if="consignorNameError" id="booking-consignor-error" class="text-sm text-red-700" role="alert">{{ consignorNameError }}</p>
                </section>
                <section ref="addOnSectionRef" class="surface-section space-y-4 booking-section" tabindex="-1" aria-labelledby="booking-addon-heading">
                    <h3 id="booking-addon-heading" class="ui-title flex items-center gap-2 text-xl text-slate-950"><span class="booking-section-number">3</span> 包材與包裝規定</h3>
                    <div class="booking-material-row">
                        <label class="flex min-h-11 items-center gap-3 text-sm font-medium text-slate-950"><input type="checkbox" :disabled="bookingInitializing" v-model="addOn.material" /><span>加購包材<span class="mt-1 block text-xs font-normal text-slate-600">TWD 100 / 份，依實際需求選購</span></span></label>
                        <QuantityStepper integer v-if="addOn.material" :model-value="addOn.materialCount" :min="1" :max="999" aria-label="加購包材份數" @update:modelValue="setMaterialCount($event)" />
                    </div>
                    <label class="booking-packaging" :class="{ 'is-confirmed': addOn.nakedConfirm }"><input ref="packagingInputRef" type="checkbox" :disabled="bookingInitializing" v-model="addOn.nakedConfirm" /><span><span class="block text-sm font-semibold text-slate-950">我已了解未妥善包裝之貨物不予託運</span><span class="mt-1 block text-xs leading-5 text-slate-600">完成預約前必須確認包裝規定。</span></span></label>
                    <p class="text-sm leading-6 text-slate-600">下一步會開啟 <RouterLink to="/reservation-notice" class="text-primary underline">購買須知</RouterLink>、<RouterLink to="/reservation-rules" class="text-primary underline">使用規定</RouterLink> 與服務商條款，閱讀並確認後才會建立訂單。</p>
                </section>
                <section ref="summarySectionRef" class="surface-section space-y-4 booking-section lg:hidden" tabindex="-1" aria-label="確認費用">
                    <BookingSummary v-bind="bookingSummaryProps" @edit="editSummaryItem" />
                    <p class="text-sm leading-6 text-slate-600">{{ checkoutExplanation }}</p>
                </section>
            </div>
            <aside ref="desktopSummaryRef" class="ops-summary booking-summary hidden space-y-4 lg:block" tabindex="-1" aria-label="確認費用">
                <BookingSummary v-bind="bookingSummaryProps" @edit="editSummaryItem" />
                <p v-if="selectionCapacityIssue" class="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{{ selectionCapacityIssue.store.name }} 容量不足，請調整輛數。</p>
                <button type="button" @click="handleCheckoutAction" class="btn btn-primary w-full text-white" :disabled="checkoutBusy"><AppIcon name="orders" class="h-4 w-4" /> {{ checkoutActionLabel }}</button>
                <p class="text-sm leading-6 text-slate-600">{{ checkoutExplanation }}</p>
            </aside>
        </div>
        <div class="booking-mobile-cta">
            <div class="mx-auto flex max-w-7xl items-center gap-3">
                <button type="button" class="booking-mobile-total min-w-0 flex-1 text-left" aria-label="查看預約明細與費用" @click="scrollToSummary">
                    <span class="block text-xs text-slate-600">已選 {{ reservationQuantity }} 輛 · 查看明細</span><span class="money-value block text-lg text-primary" aria-live="polite">{{ formatPriceAmount(finalTotal) }}</span>
                </button>
                <button type="button" @click="handleCheckoutAction" class="btn btn-primary shrink-0 text-white" :disabled="checkoutBusy">{{ checkoutActionLabel }}</button>
            </div>
        </div>
        <AppOverlayPanel v-model="storeDetailOpen" placement="right" :title="activeStoreDetail?.name || '交車點資訊'" size="lg">
            <div class="space-y-4 text-sm text-slate-700">
                <div class="grid gap-3"><div class="rounded-xl border border-slate-200 p-3"><p class="mb-1 text-slate-500">地址</p><p class="font-medium text-slate-950">{{ activeStoreDetail?.address || activeStoreDetail?.location || '尚未提供地址' }}</p></div><div class="rounded-xl border border-slate-200 p-3"><p class="mb-1 text-slate-500">電話</p><p class="font-medium text-slate-950">{{ activeStoreDetail?.phone || activeStoreDetail?.telephone || activeStoreDetail?.tel || '尚未提供電話' }}</p></div><div class="rounded-xl border border-slate-200 p-3"><p class="mb-1 text-slate-500">收容數量</p><p>{{ storeCapacityLabel(activeStoreDetail) }}</p></div></div>
                <HandoverSchedule :schedule="activeStoreDetail?.handoverSchedule" />
                <div v-if="activeStoreHours.length"><p class="mb-2 font-medium">營業時間 / 服務說明</p><ul class="space-y-1"><li v-for="line in activeStoreHours" :key="line">{{ line }}</li></ul></div><p v-else class="text-slate-500">尚未提供營業時間。</p>
                <a v-if="activeStoreDetail?.externalUrl" :href="activeStoreDetail.externalUrl" target="_blank" rel="noreferrer" class="break-all text-primary underline">{{ activeStoreDetail.externalUrl }}</a>
                <div class="rounded-xl border border-slate-200 p-3"><p class="mb-3 font-semibold">價目表</p><div class="space-y-3"><div v-for="item in activeStorePriceEntries" :key="item.type" class="flex flex-wrap items-center justify-between gap-2"><span>{{ item.type }}</span><div class="text-right"><p class="money-value text-lg text-primary">{{ formatPriceAmount(item.activePrice) }}</p><p class="text-xs text-slate-500">{{ item.activeMode === 'early' ? '早鳥優惠' : '一般價格' }}</p></div></div><p v-if="!activeStorePriceEntries.length" class="text-slate-500">尚未設定價目表。</p></div></div>
            </div>
        </AppOverlayPanel>
        <MobileActionGuideSheet v-model="guideSheetOpen" v-bind="bookingGuideSheet" @primary="handleGuidePrimary" @secondary="handleGuideSecondary" />
        <LegalReviewDrawer ref="legalReviewRef" /><OrderUserDataReviewDrawer ref="userDataReviewRef" /><DuplicateReservationOrderReview ref="duplicateOrderReviewRef" />
    </main>
</template>

<script setup>
import HandoverSchedule from '../components/HandoverSchedule.vue'
import BookingSummary from '../components/BookingSummary.vue'
import { bookingEditCapacityCredits, bookingSelectionTotal, updateBookingTotal, updateBookingTickets } from '../utils/bookingSelection.js'
import { formatConsignorName, normalizeConsignorName, resolveConsignorName } from '../utils/consignorName.js'
import { motionScrollBehavior } from '../utils/motion.js'
    import { allocateTicketRedemptions } from '../utils/ticketRedemption'
    import { onActivated, ref, computed, onMounted, watch, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
    import { API_BASE } from '../utils/api'
    import { useRoute, useRouter } from 'vue-router'
    import api from '../api/axios'
    import AppIcon from '../components/AppIcon.vue'
    import AppOverlayPanel from '../components/AppOverlayPanel.vue'
    import AppSearchInput from '../components/AppSearchInput.vue'
    import LegalReviewDrawer from '../components/LegalReviewDrawer.vue'
    import OrderUserDataReviewDrawer from '../components/OrderUserDataReviewDrawer.vue'
    import DuplicateReservationOrderReview from '../components/DuplicateReservationOrderReview.vue'
    import MobileActionGuideSheet from '../components/MobileActionGuideSheet.vue'
    import { showNotice } from '../utils/sheet'
    import { findDuplicateReservationOrders } from '../utils/duplicateReservationOrders.js'
    import { formatDateTime, formatDateTimeRange, formatTaipeiDateTime } from '../utils/datetime'
    import { summarizeText } from '../utils/content'
    import { setPageMeta } from '../utils/meta'
    import { normalizeHttpUrl } from '../utils/safeUrl'
    import { createOrderMutationKey, orderMutationHeaders, shouldRetainIdempotencyKey } from '../utils/orderParity.js'
    import { clearBookingDraft, loadBookingDraft, pruneBookingDraft, saveBookingDraft } from '../utils/bookingDraft'
    import { useIsMobile } from '../composables/useIsMobile'
    const QuantityStepper = defineAsyncComponent(() => import('../components/QuantityStepper.vue'))

    const route = useRoute()
    const router = useRouter()
    const componentBookingPath = route.path
    const API = API_BASE

    const loadingEvent = ref(true)
    const loadingStores = ref(true)
    const ticketsLoading = ref(false)
    const eventError = ref('')
    const storesError = ref('')
    const ticketsError = ref('')
    const draftReady = ref(false)
    const bookingInitializing = ref(true)
    const consignorName = ref('')
    const consignorNameTouched = ref(false)
    const consignorNameError = ref('')
    const consignorNameInputRef = ref(null)

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
    const duplicateOrderReviewRef = ref(null)
    const activeGuide = ref(null)
    const reservationSubmitting = ref(false)
    const reservationIdempotencyKey = ref('')
    const editingOrderId = computed(() => {
        const value = Number(route.query.editOrder)
        return Number.isSafeInteger(value) && value > 0 ? value : null
    })
    const editingOrderDetails = ref(null)
    const editingOrderCode = ref('')
    const editingOrderRowVersion = ref('')
    const editingOrderMutationKey = ref('')
    const isEditingOrder = computed(() => Boolean(editingOrderId.value && editingOrderDetails.value))
    const effectiveConsignorName = computed(() => resolveConsignorName(consignorName.value, sessionProfile.value?.username))
    const { isMobile } = useIsMobile(768)

    const storesSectionRef = ref(null)
    const consignorSectionRef = ref(null)
    const desktopSummaryRef = ref(null)
    const packagingInputRef = ref(null)
    const draftRestoreMessage = ref('')
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
    let bookingMeta = null
    const setBookingMeta = meta => { bookingMeta = meta; setPageMeta(meta) }
    const bookingImageAlt = computed(() => `${eventDetail.value.name || '單車託運服務檔期'}封面圖片`)
    const applyBookingMeta = () => {
        if (!route.path.startsWith('/booking/')) return
        const detail = eventDetail.value || {}
        if (![String(detail.id), String(detail.code)].includes(String(route.params.code))) return
        const serviceName = String(detail.name || '').trim()
        const dateText = detail.date || formatDateTimeRange(detail.starts_at, detail.ends_at)
        const deadlineText = detail.deadline ? `預約截止：${formatTaipeiDateTime(detail.deadline)}（台灣時間）` : ''
        const summary = summarizeText([
            detail.description,
            dateText ? `服務時間：${dateText}` : '',
            deadlineText,
        ].filter(Boolean).join('。'))
        setBookingMeta({
            title: serviceName ? `${serviceName}預約` : '單車託運服務預約',
            description: summary || '瀏覽單車託運服務檔期、交車點資訊與價格方案，使用票券折抵並完成預約手續。',
            expectedPath: route.path,
            url: detail.code ? `/booking/${encodeURIComponent(detail.code)}` : route.path,
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
        const expectedPath = route.path
        try {
            const { data } = await api.get(`${API}/events/${id}`)
            if (route.path !== expectedPath) return
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
            if (route.path !== expectedPath) return
            eventError.value = apiErrorMessage(err, '服務檔期暫時無法載入，請稍後再試。')
            if ([404, 410].includes(err?.response?.status)) setBookingMeta({ title: '找不到服務檔期', noindex: true, expectedPath })
        }
        finally { loadingEvent.value = false }
    }
    onActivated(() => {
        if (route.path !== componentBookingPath) return
        if (bookingMeta) setPageMeta(bookingMeta)
        if (initializedBookingIdentity && initializedBookingIdentity !== bookingIdentity()) initializeBooking()
    })

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
    const isStorePlansExpanded = (store = {}) => expandedStoreIds.value.has(String(store.id ?? ''))
    const toggleStorePlans = (store = {}) => {
        const key = String(store.id ?? '')
        if (!key) return
        const next = new Set(expandedStoreIds.value)
        if (next.has(key)) next.delete(key)
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
                    handoverSchedule: s.handoverSchedule,
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
                .filter(t => (!t.used || editingTicketIds.has(Number(t.id))) && !t.voided_at && !t.voidedAt && !isTicketExpired(t))
                .map(t => ({ ...t, used: editingTicketIds.has(Number(t.id)) ? false : t.used, expired: false }))
            // Keep bicycle counts when a refreshed ticket pool becomes smaller.
            const unavailable = ticketAllocations.value.filter(line => line.missing > 0)
            for (const { item, missing } of unavailable) {
                setSelectionItem(storeEntryKey({ id: item.storeId }, item), {
                    ...item, useTickets: Number(item.useTickets || 0) - missing, quantity: Number(item.quantity || 0) + missing,
                })
            }
            if (unavailable.length) draftRestoreMessage.value = '部分票券已無法使用，已保留預約輛數並更新應付費用，請重新核對明細。'
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
        consignorName.value = resolveConsignorName(restored.consignorName, sessionProfile.value?.username)
        const savedTotal = draft.selections.reduce((sum, item) => sum + Number(item.quantity || 0) + Number(item.useTickets || 0), 0)
        const savedTickets = draft.selections.reduce((sum, item) => sum + Number(item.useTickets || 0), 0)
        const restoredTotal = restored.selections.reduce((sum, item) => sum + Number(item.quantity || 0) + Number(item.useTickets || 0), 0)
        const restoredTickets = restored.selections.reduce((sum, item) => sum + Number(item.useTickets || 0), 0)
        draftRestoreMessage.value = savedTotal !== restoredTotal || savedTickets !== restoredTickets
            ? '已恢復草稿，並依最新交車點容量與可用票券調整數量，請核對明細。'
            : restoredTotal > 0 ? '已恢復本次預約選擇，請核對交車點、輛數與費用。' : ''
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
        if (!ticketsError.value && !draftReady.value && !selectedPriceItems.value.length) draftReady.value = restoreCurrentDraft()
        else if (!ticketsError.value) draftReady.value = true
    }

    const loadEditingOrder = async () => {
        const requestedOrderId = editingOrderId.value
        const expectedIdentity = bookingIdentity()
        if (!requestedOrderId) return true
        try {
            const { data } = await api.get(`${API}/orders/${requestedOrderId}`)
            if (bookingIdentity() !== expectedIdentity || route.path !== componentBookingPath) return false
            const order = data?.data || data || {}
            const details = typeof order.details === 'string' ? JSON.parse(order.details) : (order.details || {})
            const paymentStatus = String(order.paymentStatus ?? order.payment_status ?? details.status ?? '').trim()
            if (['paid', 'cancelled', 'refunded', '已付款', '已完成', '待指派', '已取消', '已退款'].includes(paymentStatus)) {
                await showNotice(['cancelled', '已取消'].includes(paymentStatus) ? '已取消的訂單無法修改' : '付款確認完成後無法修改訂單', { title: '無法修改訂單' })
                return false
            }
            const orderEventId = Number(details?.event?.id || details.event_id || details.eventId)
            if (orderEventId && orderEventId !== Number(currentEventId.value)) {
                await showNotice('訂單所屬服務檔期與目前頁面不一致', { title: '無法修改訂單' })
                return false
            }
            editingOrderDetails.value = details
            editingOrderCode.value = order.code || ''
            editingOrderRowVersion.value = order.rowVersion ?? order.row_version ?? ''
            editingOrderMutationKey.value = ''
            return true
        } catch (e) {
            await showNotice(e?.response?.data?.message || e.message || '無法讀取訂單', { title: '無法修改訂單' })
            return false
        }
    }

    const applyEditingOrderDetails = () => {
        const details = editingOrderDetails.value
        if (!details) return
        consignorName.value = resolveConsignorName(details.consignorName, sessionProfile.value?.username)
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
        expandedStoreIds.value = new Set(Object.values(next).map(item => String(item.storeId)))
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

    const focusSection = (element) => {
        element?.scrollIntoView?.({ behavior: motionScrollBehavior(), block: 'start' })
        element?.focus?.({ preventScroll: true })
    }
    const scrollToStores = () => focusSection(storesSectionRef.value)
    const scrollToAddOn = () => focusSection(addOnSectionRef.value)
    const scrollToSummary = () => focusSection(window.matchMedia('(min-width: 1024px)').matches ? desktopSummaryRef.value : summarySectionRef.value)
    const goBookingLogin = () => router.push({ path: '/login', query: { redirect: route.fullPath || route.path } })
    const bookingSteps = computed(() => [
        { number: 1, label: '地點方案', complete: reservationQuantity.value > 0 },
        { number: 2, label: '託運資料', complete: Boolean(effectiveConsignorName.value) },
        { number: 3, label: '包材規定', complete: addOn.value.nakedConfirm },
        { number: 4, label: '確認費用', complete: false },
    ])
    const goToBookingStep = (number) => {
        if (number === 1) scrollToStores()
        else if (number === 2) focusSection(consignorSectionRef.value)
        else if (number === 3) scrollToAddOn()
        else scrollToSummary()
    }
    const editSummaryItem = async (item) => {
        storeSearch.value = ''
        const index = stores.value.findIndex(store => String(store.id) === String(item.storeId))
        if (index < 0) return
        activeStorePage.value = Math.floor(index / STORES_PAGE_SIZE) + 1
        expandedStoreIds.value = new Set([...expandedStoreIds.value, String(item.storeId)])
        await nextTick()
        const element = document.getElementById(entryControlId(stores.value[index], item))
        element?.scrollIntoView?.({ behavior: motionScrollBehavior(), block: 'center' })
        element?.querySelector('input')?.focus({ preventScroll: true })
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
            addOn.value.materialCount = Math.max(1, reservationQuantity.value)
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

    watch([selectionItems, addOn, consignorName], () => {
        if (!draftReady.value || editingOrderId.value || !draftEventCode.value) return
        saveBookingDraft(draftEventCode.value, {
            selectionItems: selectionItems.value,
            addOn: addOn.value,
            consignorName: consignorName.value,
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

    const ticketAllocations = computed(() => allocateTicketRedemptions(selectedPriceItems.value, tickets.value, {
        ticketKey: bindingKeyForTicket,
        itemKeys: item => bindingKeysForType(item.type, item),
        unitPrice: unitPriceForItem,
    }))
    const ticketDiscountTotal = computed(() => Math.round(ticketAllocations.value.reduce((sum, line) => sum + line.discount, 0) * 100) / 100)
    const subtotal = computed(() => Math.round(selectedPriceItems.value.reduce((sum, item) =>
        sum + unitPriceForItem(item) * (Number(item.quantity || 0) + Number(item.useTickets || 0)), 0) * 100) / 100)

    // 加購包材費用（與總價共用）
    const addOnCost = computed(() => addOn.value.material ? (100 * Math.max(0, addOn.value.materialCount || 0)) : 0)

    // 服務費扣除票券抵免，再加上包材費
    const finalTotal = computed(() => {
        return Math.round(Math.max(subtotal.value + addOnCost.value - ticketDiscountTotal.value, 0) * 100) / 100
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
    const editingCapacityCredits = computed(() => isEditingOrder.value
        ? bookingEditCapacityCredits(editingOrderDetails.value, stores.value) : {})
    const capacityGroupForStore = (store = {}) => store.deliveryPointId
        ? `point-${store.deliveryPointId}` : `store-${store.id}`
    const capacityGroupForItem = (item = {}) => capacityGroupForStore(stores.value.find(store => String(store.id) === String(item.storeId)) || item)
    const storeCapacityRemaining = (store = null) => {
        const capacity = normalizeCapacityValue(store?.capacity)
        if (capacity === null) return null
        const remaining = store?.capacityRemaining
        const rawRemaining = remaining !== undefined && remaining !== null && Number.isFinite(Number(remaining))
            ? Math.max(0, Math.floor(Number(remaining)))
            : Math.max(0, capacity - Math.max(0, Math.floor(Number(store?.reservedQuantity || 0))))
        return Math.min(capacity, rawRemaining + Number(editingCapacityCredits.value[store?.id] || 0))
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
                .filter(item => capacityGroupForItem(item) === capacityGroupForStore(store))
                .reduce((sum, item) => sum + bookingSelectionTotal(item), 0)
            if (storeQty > remainingCapacity) return { store, storeQty, remainingCapacity }
        }
        return null
    })
    const activeStorePriceEntries = computed(() => storePriceEntries(activeStoreDetail.value))
    const isSelectedStore = (store) => selectedPriceItems.value.some(item => String(item.storeId || '') === String(store?.id || ''))
    const priceItemForStoreEntry = (store, entry = {}) => {
        return selectionItems.value[storeEntryKey(store, entry)] || null
    }
    const entryControlId = (store, entry = {}) => `${storePlansId(store)}-${encodeURIComponent(entry.type || '')}`
    const selectedQuantityForStore = store => selectedPriceItems.value
        .filter(item => String(item.storeId) === String(store.id)).reduce((sum, item) => sum + bookingSelectionTotal(item), 0)
    const totalForStoreEntry = (store, entry = {}) => bookingSelectionTotal(priceItemForStoreEntry(store, entry) || {})
    const totalMaxForStoreEntry = (store, entry = {}) => {
        const remaining = storeCapacityRemaining(store)
        if (remaining === null) return 999
        const key = storeEntryKey(store, entry)
        const otherUnits = selectedPriceItems.value
            .filter(item => storeEntryKey({ id: item.storeId }, item) !== key && capacityGroupForItem(item) === capacityGroupForStore(store))
            .reduce((sum, item) => sum + bookingSelectionTotal(item), 0)
        return Math.max(0, remaining - otherUnits)
    }
    const useTicketsForStoreEntry = (store, entry = {}) => Number(priceItemForStoreEntry(store, entry)?.useTickets || 0)
    const ticketPoolMaxForStoreEntry = (store, entry = {}) => {
        const currentItem = priceItemForStoreEntry(store, entry)
        return ticketsRemainingFor(entry.type, currentItem || entry) + Number(currentItem?.useTickets || 0)
    }
    const ticketMaxForStoreEntry = (store, entry = {}) => Math.min(
        totalForStoreEntry(store, entry), ticketPoolMaxForStoreEntry(store, entry), totalMaxForStoreEntry(store, entry),
    )
    const ticketAvailableForStoreEntry = (store, entry = {}) => ticketsRemainingFor(entry.type, priceItemForStoreEntry(store, entry) || entry)
    const setStoreEntryTotal = (store, entry = {}, value) => {
        if (!store || !entry?.type) return
        const { key, item: target } = ensureStoreEntrySelection(store, entry)
        if (!target) return
        setSelectionItem(key, { ...target, ...updateBookingTotal(target, value, {
            maxTotal: Math.max(bookingSelectionTotal(target), totalMaxForStoreEntry(store, target)),
            maxTickets: ticketsLoading.value || ticketsError.value ? Number(target.useTickets || 0) : ticketPoolMaxForStoreEntry(store, target),
        }) })
        if (!loadingEvent.value && !loadingStores.value) draftReady.value = true
    }
    const setStoreEntryUseTickets = (store, entry = {}, value) => {
        if (!store || !entry?.type || !loggedIn.value || ticketsLoading.value || ticketsError.value) return
        const { key, item: target } = ensureStoreEntrySelection(store, entry)
        if (!target) return
        setSelectionItem(key, { ...target, ...updateBookingTickets(target, value, {
            maxTotal: Math.max(bookingSelectionTotal(target), totalMaxForStoreEntry(store, target)), maxTickets: ticketPoolMaxForStoreEntry(store, target),
        }) })
    }
    const payableForStoreEntry = (store, entry = {}) => {
        const item = priceItemForStoreEntry(store, entry)
        if (!item) return 0
        const discount = ticketAllocations.value.find(line => line.item === item)?.discount || 0
        return Math.round((unitPriceForItem(item) * bookingSelectionTotal(item) - discount) * 100) / 100
    }
    const setMaterialCount = value => { addOn.value.materialCount = Math.min(999, Math.max(1, Math.floor(Number(value) || 1))) }
    watch(() => addOn.value.materialCount, value => {
        const normalized = Math.min(999, Math.max(0, Math.floor(Number(value) || 0)))
        if (value !== normalized) addOn.value.materialCount = normalized
    })
    const bookingSummaryItems = computed(() => selectedPriceItems.value.map(item => ({
        key: storeEntryKey({ id: item.storeId }, item), storeId: item.storeId,
        store: item.storeName, type: item.type, total: bookingSelectionTotal(item),
        tickets: Number(item.useTickets || 0), unit: unitPriceForItem(item),
        discount: ticketAllocations.value.find(line => line.item === item)?.discount || 0,
        payable: payableForStoreEntry({ id: item.storeId }, item),
    })))
    const bookingSummaryProps = computed(() => ({
        items: bookingSummaryItems.value, consignorName: formatConsignorName(effectiveConsignorName.value),
        subtotal: subtotal.value, ticketDiscount: ticketDiscountTotal.value, addOnCost: addOnCost.value, total: finalTotal.value,
    }))
    const checkoutBusy = computed(() => bookingInitializing.value || reservationSubmitting.value || loadingEvent.value || loadingStores.value || (selectedTicketQuantity.value > 0 && ticketsLoading.value))
    const checkoutActionLabel = computed(() => {
        if (reservationSubmitting.value) return '處理中…'
        if (bookingInitializing.value) return '讀取預約資訊…'
        if (loadingEvent.value || loadingStores.value) return '載入中…'
        if (eventError.value || storesError.value) return '重新載入服務'
        if (!eventDetail.value.id) return '選擇服務檔期'
        if (reservationQuantity.value <= 0) return '選擇方案與輛數'
        if (selectionCapacityIssue.value) return '調整預約輛數'
        if (selectedTicketQuantity.value > 0 && ticketsError.value) return '重試票券同步'
        if (!loggedIn.value) return '登入繼續預約'
        if (!contactInfoComplete.value) return '補齊訂購資料'
        if (addOn.value.material && addOn.value.materialCount <= 0) return '填寫包材份數'
        if (!addOn.value.nakedConfirm) return '確認包裝規定'
        return isEditingOrder.value ? '確認修改與規定' : '核對資料與規定'
    })
    const checkoutExplanation = computed(() => {
        if (reservationQuantity.value <= 0) return '尚未選擇預約輛數。'
        if (!loggedIn.value) return '登入後保留選擇，並同步可用票券。'
        if (!contactInfoComplete.value) return '訂單需要姓名、Email、手機與匯款帳號後五碼。'
        if (!addOn.value.nakedConfirm) return '請先勾選包裝規定，再核對資料與條款。'
        return '下一步核對資料與條款，確認後才建立訂單；付款確認後成立預約。'
    })
    const handleCheckoutAction = async () => {
        if (checkoutBusy.value) return
        if (eventError.value) { await retryEvent(); return }
        if (storesError.value) { await retryStores(); return }
        if (!eventDetail.value.id) { router.push('/store'); return }
        if (reservationQuantity.value <= 0 || selectionCapacityIssue.value) { scrollToStores(); return }
        if (selectedTicketQuantity.value > 0 && ticketsError.value) { await retryTickets(); return }
        if (!loggedIn.value) { goBookingLogin(); return }
        if (!contactInfoComplete.value) { await ensureContactInfoReady(); return }
        if (addOn.value.material && addOn.value.materialCount <= 0) { scrollToAddOn(); return }
        if (!addOn.value.nakedConfirm) {
            scrollToAddOn()
            packagingInputRef.value?.focus({ preventScroll: true })
            return
        }
        await confirmReserve()
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
            if (el?.scrollIntoView) el.scrollIntoView({ behavior: motionScrollBehavior(), block: 'start' })
        })
    }
    const goPrevStorePage = () => {
        if (activeStorePage.value > 1) goToStorePage(activeStorePage.value - 1)
    }
    const goNextStorePage = () => {
        if (activeStorePage.value < totalStorePages.value) goToStorePage(activeStorePage.value + 1)
    }

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
                selection.byTicket ? `抵免 ${formatPriceAmount(selection.discount)}，差額 ${formatPriceAmount(selection.subtotal)}` : formatPriceAmount(selection.subtotal ?? (selection.unitPrice * selection.qty)),
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
            title: '再次確認託運與訂購人資料',
            description: '這些聯絡與付款辨識資料將隨本次訂單送出，請再次逐項核對。',
            summary: [{
                key: 'booking-order',
                label: eventDetail.value.name || '預約服務',
                value: `${quantity} 項`,
                detail: [selectedStoreSummary.value, `合計 ${formatPriceAmount(total)}`].filter(Boolean).join('｜'),
            }],
            fields: [
                { key: 'consignorName', label: '託運者姓名', value: effectiveConsignorName.value },
                { key: 'username', label: '訂購會員姓名', value: contact.username },
                { key: 'email', label: '電子信箱', value: contact.email },
                { key: 'phone', label: '手機號碼', value: contact.phone },
                { key: 'remittanceLast5', label: '匯款帳號後五碼', value: contact.remittanceLast5 },
            ],
        })
        return accepted === true
    }

    const confirmNoAccidentalDuplicate = async (selections) => {
        let orders
        try {
            const { data } = await api.get(`${API}/orders/me`)
            if (!data?.ok || !Array.isArray(data.data)) throw new Error('訂單紀錄格式不正確')
            orders = data.data
        } catch {
            await showNotice('目前無法確認先前的訂單紀錄，請稍後再試；本次尚未下單，已選內容會保留。', { title: '訂單紀錄暫時無法載入' })
            return false
        }
        const matches = findDuplicateReservationOrders(orders, { event: eventDetail.value, selections })
        if (!matches.length) return true
        return (await duplicateOrderReviewRef.value?.open(matches)) === true
    }

    // 建立訂單（單筆 items[0]）
    const confirmReserve = async () => {
        if (reservationSubmitting.value || bookingInitializing.value || (editingOrderId.value && !editingOrderDetails.value)) return
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
        if (normalizeConsignorName(consignorName.value).length > 50) {
            consignorNameError.value = '託運者姓名最多 50 個字'
            consignorNameInputRef.value?.focus()
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
        const normalizedConsignorName = effectiveConsignorName.value
        if (normalizedConsignorName.length > 50) {
            consignorNameError.value = '託運者姓名最多 50 個字，請填寫實際託運者姓名'
            consignorNameInputRef.value?.focus()
            return
        }

        const selections = []
        const usedTicketIds = []
        for (const allocation of ticketAllocations.value) {
            const { item, quantity: need, redemptions, discount: lineDiscount } = allocation
            if (need > 0) {
                if (allocation.missing) { await showNotice(`票券不足：${item.type}`, { title: '庫存不足' }); return }
                usedTicketIds.push(...redemptions.map(ticket => ticket.ticketId))
                const productId = productIdForType(item)
                const unitPrice = unitPriceForItem(item)
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
                    subtotal: allocation.subtotal,
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
        const subtotalWithTickets = subtotal.value
        const discountTotal = ticketDiscountTotal.value
        const total = Math.max(subtotalWithTickets + addOnCostValue - discountTotal, 0)
        if (!isEditingOrder.value && !(await confirmNoAccidentalDuplicate(selections))) return
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
                ...(normalizedConsignorName ? { consignorName: normalizedConsignorName } : {}),
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
                if (!editingOrderRowVersion.value) throw new Error('伺服器未回傳訂單版本，請重新載入訂單')
                if (!editingOrderMutationKey.value) editingOrderMutationKey.value = createOrderMutationKey('reservation-order-edit')
                await api.patch(`${API}/orders/${editingOrderId.value}`, { details }, {
                    headers: orderMutationHeaders(
                        { rowVersion: editingOrderRowVersion.value },
                        editingOrderMutationKey.value,
                    ),
                })
                editingOrderMutationKey.value = ''
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
            if (isEditingOrder.value) {
                if (!shouldRetainIdempotencyKey(err)) editingOrderMutationKey.value = ''
            } else if (err?.response) reservationIdempotencyKey.value = ''
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
                if (!consignorNameTouched.value && !normalizeConsignorName(consignorName.value)) {
                    consignorName.value = resolveConsignorName('', sessionProfile.value?.username)
                }
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

    const bookingIdentity = () => `${route.path}|${editingOrderId.value || ''}`
    let initializedBookingIdentity = ''
    let bookingLoadGeneration = 0
    const initializeBooking = async () => {
        initializedBookingIdentity = bookingIdentity()
        const generation = ++bookingLoadGeneration
        const isCurrentLoad = () => generation === bookingLoadGeneration && route.path === componentBookingPath
        bookingInitializing.value = true
        try {
        draftReady.value = false
        loadingEvent.value = true
        loadingStores.value = true
        selectionItems.value = {}
        expandedStoreIds.value = new Set()
        editingOrderDetails.value = null
        editingOrderCode.value = ''
        editingOrderRowVersion.value = ''
        editingOrderMutationKey.value = ''
        reservationIdempotencyKey.value = ''
        addOn.value = { material: false, materialCount: 0, nakedConfirm: false, purchasePolicy: false, usagePolicy: false }
        draftRestoreMessage.value = ''
        consignorName.value = ''
        consignorNameTouched.value = false
        consignorNameError.value = ''
        eventError.value = ''
        let id = null
        const code = routeCode.value
        const expectedPath = route.path
        if (code && /^\d+$/.test(code)) {
            id = Number(code)
        } else {
            try {
                const { data } = await api.get(`${API}/events`)
                if (route.path !== expectedPath) return
                const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
                const hit = list.find(e => String(e.code || `EV${String(e.id).padStart(6,'0')}`) === code)
                id = hit?.id || null
            } catch (error) {
                if (route.path !== expectedPath) return
                eventError.value = apiErrorMessage(error, '無法查詢服務檔期，請稍後重試。')
                loadingEvent.value = false
                loadingStores.value = false
                return
            }
        }

        if (!id) {
            setBookingMeta({ title: '找不到服務檔期', noindex: true, expectedPath: route.path })
            loadingEvent.value = false
            loadingStores.value = false
            return
        }

        if (!isCurrentLoad()) return
        currentEventId.value = id
        await Promise.all([fetchEvent(id), fetchStores(id)])
        if (!isCurrentLoad()) return

        const authed = await checkSession()
        if (!isCurrentLoad()) return
        if (editingOrderId.value && !authed) {
            router.push({ path: '/login', query: { redirect: route.fullPath || route.path } })
            return
        }
        if (editingOrderId.value) {
            const loaded = await loadEditingOrder()
            if (!isCurrentLoad()) return
            if (!loaded) { router.push({ path: '/store', query: { orders: '1' } }); return }
        }
        if (authed) await loadTickets()
        if (!isCurrentLoad()) return
        if (editingOrderId.value) applyEditingOrderDetails()
        else if (!storesError.value && !eventError.value) draftReady.value = restoreCurrentDraft()
        } finally {
            if (generation === bookingLoadGeneration) bookingInitializing.value = false
        }
    }

    watch(() => [route.path, editingOrderId.value], () => {
        if (route.path === componentBookingPath && initializedBookingIdentity && initializedBookingIdentity !== bookingIdentity()) initializeBooking()
    })

    // Refresh only displayed schedules so selected plans and quantities stay intact.
    const refreshHandoverSchedules = async () => {
        const eventId = currentEventId.value
        if (!eventId || document.hidden || !route.path.startsWith('/booking/')) return
        try {
            const { data } = await api.get(`${API}/events/${eventId}/stores`)
            if (currentEventId.value !== eventId) return
            const map = new Map((data?.data || []).map(store => [String(store.id), store.handoverSchedule]))
            stores.value.forEach(store => { store.handoverSchedule = map.get(String(store.id)) || { available: false } })
        } catch {
            if (currentEventId.value === eventId) stores.value.forEach(store => { store.handoverSchedule = { available: false } })
        }
    }
    let handoverRefreshTimer
    onMounted(() => {
        window.addEventListener('focus', refreshHandoverSchedules)
        handoverRefreshTimer = setInterval(refreshHandoverSchedules, 60000)
    })
    onBeforeUnmount(() => {
        window.removeEventListener('focus', refreshHandoverSchedules)
        clearInterval(handoverRefreshTimer)
    })

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

<style scoped>
:global(.app-shell:has(.booking-page)) { overflow-x: clip; }
.booking-page { overflow: visible; --acc-expand: 250ms; --acc-collapse: 250ms; --acc-chevron: 250ms; --acc-ease: cubic-bezier(.22, 1, .36, 1); padding-bottom: calc(8rem + env(safe-area-inset-bottom, 0px)); }
.booking-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
.booking-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .25rem; margin-bottom: 1.25rem; padding: .5rem; border: 1px solid #e2e8f0; border-radius: 1rem; background: #fff; }
.booking-steps button { display: flex; align-items: center; justify-content: center; gap: .5rem; min-height: 2.75rem; padding: .5rem .25rem; border-radius: .75rem; color: #475569; font-size: .875rem; }
.booking-steps button:hover { background: #f8fafc; }
.booking-step-number { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; flex-shrink: 0; border-radius: 50%; background: #f1f5f9; color: #475569; font-size: .75rem; font-weight: 600; }
.booking-step-number.is-complete { background: #fceced; color: #a33335; }
.booking-section-number { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; border-radius: 50%; background: #a33335; color: white; font-size: .875rem; flex-shrink: 0; }
.booking-section, .booking-summary { scroll-margin-top: 6.5rem; }
.booking-section:focus { outline: none; }
.booking-section:focus-visible, .booking-summary:focus-visible { outline: 2px solid #a33335; outline-offset: 3px; }
.booking-event { display: flex; align-items: center; gap: 1rem; padding: 1rem; }
.booking-event-cover { width: 7rem; height: 6rem; flex-shrink: 0; border-radius: .75rem; object-fit: cover; }
.booking-event-details { border-top: 1px solid #e2e8f0; }
.booking-event-details summary { cursor: pointer; padding: .875rem 1rem; font-size: .875rem; color: #475569; }
.booking-account-note { display: flex; align-items: center; justify-content: space-between; gap: .75rem; border-radius: .75rem; background: #f8fafc; padding: .875rem; font-size: .875rem; }
.booking-store { min-width: 0; border: 1px solid #dce3eb; border-radius: 1rem; background: white; }
.booking-store.is-selected { border-color: #a33335; box-shadow: 0 0 0 1px #a3333514; }
.booking-store-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem; }
.booking-store-actions { display: flex; flex-wrap: wrap; gap: .5rem; flex-shrink: 0; }
.booking-store-content { display: grid; gap: .875rem; padding: 1rem; border-top: 1px solid #e2e8f0; background: #f8fafc; border-radius: 0 0 1rem 1rem; }
.booking-store-content :deep(.handover-schedule) { margin: 0; background: #fff; }
.booking-plan { min-width: 0; padding: 1rem; border: 1px solid #e2e8f0; border-radius: .875rem; background: white; }
.booking-plan.is-selected { border-color: #c37879; }
.booking-price-stage { padding: .2rem .5rem; border-radius: .375rem; background: #f1f5f9; color: #475569; font-size: .75rem; }
.booking-quantity-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; padding-top: .875rem; }
.booking-ticket-area { margin-top: .875rem; border-top: 1px solid #e2e8f0; }
.booking-ticket-area :deep(.quantity-stepper) { flex-shrink: 0; }
.booking-plan-total { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; margin-top: .875rem; padding-top: .875rem; border-top: 1px solid #e2e8f0; color: #a33335; font-size: .875rem; }
.booking-material-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: .875rem; border: 1px solid #e2e8f0; border-radius: .75rem; }
.booking-packaging { display: flex; align-items: flex-start; gap: .75rem; padding: 1rem; border: 1px solid #e2e8f0; border-radius: .75rem; background: #f8fafc; cursor: pointer; }
.booking-packaging input { margin-top: .2rem; flex-shrink: 0; }
.booking-packaging.is-confirmed { border-color: #c37879; background: #fff7f7; }
.booking-summary { position: sticky; top: 5.5rem; max-height: calc(100dvh - 7rem); overflow-y: auto; overscroll-behavior: contain; }
.booking-mobile-total { min-height: 2.75rem; border-radius: .5rem; }
.booking-steps button:focus-visible, .booking-mobile-total:focus-visible { outline: 2px solid #a33335; outline-offset: 2px; }
.t-acc-panel { display: grid; grid-template-rows: 0fr; visibility: hidden; transition: grid-template-rows var(--acc-collapse) var(--acc-ease), visibility 0s var(--acc-collapse); }
.t-acc[data-open="true"] .t-acc-panel { grid-template-rows: 1fr; visibility: visible; transition: grid-template-rows var(--acc-expand) var(--acc-ease), visibility 0s; }
.t-acc-panel-inner { overflow: hidden; min-height: 0; opacity: 0; transition: opacity var(--acc-collapse) var(--acc-ease); }
.t-acc[data-open="true"] .t-acc-panel-inner { opacity: 1; transition: opacity var(--acc-expand) var(--acc-ease); }
.t-acc-chevron { display: inline-flex; transform: scaleY(1); transform-origin: center; transition: transform var(--acc-chevron) var(--acc-ease); }
.t-acc-chevron path { vector-effect: non-scaling-stroke; }
.t-acc[data-open="true"] .t-acc-chevron { transform: scaleY(-1); }
@media (max-width: 639px) {
  .booking-steps button { flex-direction: column; gap: .25rem; font-size: .75rem; }
  .booking-event { align-items: flex-start; gap: .75rem; }
  .booking-event-cover { width: 4.5rem; height: 4.5rem; }
  .booking-store-actions { width: 100%; }
  .booking-store-actions button { flex: 1; }
  .booking-store-content, .booking-plan { padding: .875rem; }
}
@media (min-width: 1024px) { .booking-page { padding-bottom: 3rem; } }
@media (prefers-reduced-motion: reduce) { .t-acc-panel, .t-acc-panel-inner, .t-acc-chevron { transition: none !important; } .booking-page :deep(.animate-pulse) { animation: none; } }
@media (prefers-reduced-transparency: reduce) { .booking-mobile-cta { background: white; backdrop-filter: none; } }
@media (prefers-contrast: more) { .booking-store, .booking-plan, .booking-steps { border-color: #475569; } }
</style>
