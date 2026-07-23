<template>
    <main class="ops-page">
        <div class="space-y-5">
            <header class="ops-header">
                <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div class="min-w-0 space-y-1">
                        <h1 class="ui-title text-2xl text-slate-950 sm:text-3xl">
                            {{ activeTab === 'events' ? '場次預約' : activeTab === 'courses' ? '課程商店' : '票券商店' }}
                        </h1>
                        <p class="break-all text-sm leading-6 text-slate-600">
                            <template v-if="activeTab === 'courses'">購買課程、查看開放場次並使用課程票券完成預約。</template>
                            <template v-else>
                                <span class="sm:hidden">預約單車運輸服務，管理訂單。</span>
                                <span class="hidden sm:inline">預約單車運輸服務，購買票券、管理訂單並同步雲端購物車。</span>
                            </template>
                        </p>
                    </div>
                    <div v-if="activeTab !== 'courses'" class="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2 lg:flex lg:items-center">
                        <button class="btn btn-outline w-full lg:w-auto" @click="cartOpen = true">
                            <AppIcon name="cart" class="h-4 w-4" />
                            購物車
                            <span class="ops-chip ml-1 px-2 py-0.5">{{ cartItemCount }}</span>
                        </button>
                        <button class="btn btn-outline w-full lg:w-auto" @click="openOrders('general')">
                            <AppIcon name="orders" class="h-4 w-4" /> 我的訂單
                        </button>
                    </div>
                    <div v-else class="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2 lg:flex lg:items-center">
                        <button class="btn btn-outline w-full lg:w-auto" @click="openOrders('course')">
                            <AppIcon name="orders" class="h-4 w-4" /> 課程訂單
                        </button>
                        <button class="btn btn-outline w-full lg:w-auto" @click="goWalletCourseTickets">
                            <AppIcon name="ticket" class="h-4 w-4" /> 課程票券
                        </button>
                    </div>
                </div>
            </header>

            <section v-if="activeTab !== 'courses' && actionCenterCards.length" class="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <article v-for="card in actionCenterCards" :key="card.key" class="card-quiet flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div class="min-w-0 space-y-1">
                        <p class="text-sm font-medium text-slate-950">{{ card.title }}</p>
                        <p v-if="card.subtitle" class="text-sm leading-6 text-slate-600">{{ card.subtitle }}</p>
                    </div>
                    <button v-if="card.actionLabel" class="btn btn-outline btn-sm shrink-0 self-start sm:self-auto" @click="handleActionCenterAction(card)">
                        {{ card.actionLabel }}
                    </button>
                </article>
            </section>

            <div class="ops-toolbar material-chrome sticky top-0 z-30 md:top-[65px]">
                <div class="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
                    <div
                        class="relative flex rounded-lg border border-slate-200 bg-slate-50 p-1"
                        role="tablist"
                        aria-label="購票中心分類"
                        @keydown="handleTablistKeydown"
                    >
                        <button
                            :ref="(element) => setTabButtonRef(element, 0)"
                            id="store-tab-shop"
                            class="relative flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-md px-2 py-2 text-xs font-medium transition sm:text-sm lg:min-w-[9rem] lg:flex-none lg:gap-2 lg:px-4"
                            :class="activeTab === 'shop' ? 'bg-white text-primary shadow-sm' : 'text-slate-600 hover:text-slate-950'"
                            role="tab"
                            :aria-selected="activeTab === 'shop'"
                            aria-controls="store-panel-shop"
                            :tabindex="activeTab === 'shop' ? 0 : -1"
                            @click="setActiveTab('shop', 0)"
                        >
                            <AppIcon name="store" class="h-4 w-4" />
                            <span class="sm:hidden">票券</span>
                            <span class="hidden sm:inline">票券商店</span>
                        </button>
                        <button
                            :ref="(element) => setTabButtonRef(element, 1)"
                            id="store-tab-events"
                            class="relative flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-md px-2 py-2 text-xs font-medium transition sm:text-sm lg:min-w-[9rem] lg:flex-none lg:gap-2 lg:px-4"
                            :class="activeTab === 'events' ? 'bg-white text-primary shadow-sm' : 'text-slate-600 hover:text-slate-950'"
                            role="tab"
                            :aria-selected="activeTab === 'events'"
                            aria-controls="store-panel-events"
                            :tabindex="activeTab === 'events' ? 0 : -1"
                            @click="setActiveTab('events', 1)"
                        >
                            <AppIcon name="calendar" class="h-4 w-4" />
                            <span class="sm:hidden">預約</span>
                            <span class="hidden sm:inline">場次預約</span>
                        </button>
                        <button
                            :ref="(element) => setTabButtonRef(element, 2)"
                            id="store-tab-courses"
                            class="relative flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-md px-2 py-2 text-xs font-medium transition sm:text-sm lg:min-w-[9rem] lg:flex-none lg:gap-2 lg:px-4"
                            :class="activeTab === 'courses' ? 'bg-white text-primary shadow-sm' : 'text-slate-600 hover:text-slate-950'"
                            role="tab"
                            :aria-selected="activeTab === 'courses'"
                            aria-controls="store-panel-courses"
                            :tabindex="activeTab === 'courses' ? 0 : -1"
                            @click="setActiveTab('courses', 2)"
                        >
                            <AppIcon name="calendar" class="h-4 w-4" />
                            <span class="sm:hidden">課程</span>
                            <span class="hidden sm:inline">課程商店</span>
                        </button>
                    </div>

                    <AppSearchInput
                        v-if="activeTab === 'shop'"
                        v-model="productSearch"
                        input-id="store-product-search"
                        name="productSearch"
                        aria-label="搜尋票券"
                        placeholder="搜尋票券"
                        container-class="relative w-full"
                        @clear="clearProductSearch"
                    />
                    <AppSearchInput
                        v-else-if="activeTab === 'events'"
                        v-model="eventSearch"
                        input-id="store-event-search"
                        name="eventSearch"
                        aria-label="搜尋服務檔期"
                        placeholder="搜尋服務檔期"
                        container-class="relative w-full"
                        @clear="clearEventSearch"
                    />
                    <div v-else class="hidden lg:block"></div>

                    <button v-if="activeTab !== 'courses'" class="btn btn-outline w-full lg:w-auto" @click="goWalletReservations">
                        <AppIcon name="orders" class="h-4 w-4" /> 查看預約
                    </button>
                    <button v-else class="btn btn-outline w-full lg:w-auto" @click="goWalletCourseReservations">
                        <AppIcon name="orders" class="h-4 w-4" /> 查看課程預約
                    </button>
                </div>
            </div>

            <!-- 🛒 商店 -->
            <section
                v-if="activeTab === 'shop'"
                id="store-panel-shop"
                ref="productsSectionRef"
                class="slide-in space-y-4"
                role="tabpanel"
                aria-labelledby="store-tab-shop"
                tabindex="0"
            >
                <div v-if="loadingProducts" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div v-for="i in 6" :key="'pskel-'+i" class="ticket-card animate-pulse p-0">
                        <div class="h-44 w-full bg-slate-200"></div>
                        <div class="space-y-3 p-4">
                            <div class="h-4 w-2/3 rounded bg-slate-200"></div>
                            <div class="h-3 w-full rounded bg-slate-200"></div>
                            <div class="h-3 w-5/6 rounded bg-slate-200"></div>
                            <div class="h-10 rounded bg-slate-200"></div>
                        </div>
                    </div>
                </div>
                <div v-else-if="productsError" class="ticket-card border-red-200 bg-red-50/70 p-5" role="alert">
                    <p class="font-medium text-red-800">票券載入失敗</p>
                    <p class="mt-1 text-sm leading-6 text-red-700">{{ productsError }}</p>
                    <button class="btn btn-outline mt-4" @click="fetchProducts">重新載入</button>
                </div>
                <div v-else-if="!filteredProducts.length" class="ticket-card p-6 text-center">
                    <p class="font-medium text-slate-900">{{ productSearch ? '沒有符合搜尋條件的票券' : '目前尚無可販售票券' }}</p>
                    <p class="mt-1 text-sm leading-6 text-slate-600">{{ productSearch ? '請調整關鍵字，或先查看可預約的服務場次。' : '可先查看服務場次，票券上架後會顯示在這裡。' }}</p>
                    <div class="mt-4 flex flex-wrap justify-center gap-2">
                        <button v-if="productSearch" class="btn btn-outline" @click="clearProductSearch">清除搜尋</button>
                        <button class="btn btn-primary text-white" @click="setActiveTab('events', 1)">查看場次預約</button>
                    </div>
                </div>
                <template v-else>
                    <TransitionGroup name="grid-stagger" tag="div" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <article v-for="(product, index) in displayedProducts" :key="product.id ?? `${product.name}-${index}`" class="ticket-card flex h-full flex-col p-0">
                            <div class="relative w-full overflow-hidden" style="aspect-ratio: 16 / 10;">
                                <img
                                    :src="productCoverUrl(product)"
                                    loading="lazy"
                                    decoding="async"
                                    sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw"
                                    @error="(e)=>e.target.src='/transport-fallback.png'"
                                    :alt="productImageAlt(product)"
                                    class="absolute inset-0 h-full w-full object-cover"
                                />
                                <div class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-slate-950/60 to-transparent"></div>
                                <div class="absolute bottom-3 left-3 rounded-md bg-white/95 px-2 py-1 text-sm font-medium text-slate-800 shadow-sm">
                                    票券
                                </div>
                            </div>
                            <div class="flex flex-1 flex-col gap-4 p-4">
                                <div class="min-w-0 space-y-2">
                                    <h2 class="ui-title text-lg text-slate-950">{{ product.name }}</h2>
                                    <p class="line-clamp-3 whitespace-pre-line text-sm leading-6 text-slate-600">{{ product.description }}</p>
                                </div>
                                <div class="mt-auto flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
                                    <div>
                                        <p class="text-sm text-slate-500">票券價格</p>
                                        <p class="money-value text-xl text-slate-950">NT$ {{ product.price }}</p>
                                    </div>
                                    <QuantityStepper v-model="product.quantity" :min="1" :max="10" />
                                </div>
                                <button class="btn btn-primary w-full text-white" :disabled="cartMutationLocked" @click="addToCart(product)">
                                    <AppIcon name="cart" class="h-4 w-4" /> 加入購物車
                                </button>
                            </div>
                        </article>
                    </TransitionGroup>

                    <div v-if="shouldPaginateProducts" class="flex flex-wrap items-center gap-2 pt-2">
                        <button class="btn btn-outline btn-sm" :disabled="activeProductPage <= 1" @click="goPrevProductPage">上一頁</button>
                        <button
                            v-for="page in totalProductPages"
                            :key="`product-page-${page}`"
                            class="btn btn-sm"
                            :class="page === activeProductPage ? 'btn-primary text-white' : 'btn-outline'"
                            @click="goToProductPage(page)"
                        >
                            {{ page }}
                        </button>
                        <button class="btn btn-outline btn-sm" :disabled="activeProductPage >= totalProductPages" @click="goNextProductPage">下一頁</button>
                    </div>
                </template>
            </section>

            <section
                v-if="activeTab === 'events'"
                id="store-panel-events"
                ref="eventsSectionRef"
                class="slide-in space-y-4"
                role="tabpanel"
                aria-labelledby="store-tab-events"
                tabindex="0"
            >
                <div v-if="loadingEvents" class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div v-for="i in 8" :key="'eskel-'+i" class="ticket-card animate-pulse p-0">
                        <div class="h-36 w-full bg-slate-200"></div>
                        <div class="space-y-3 p-4">
                            <div class="h-3 w-24 rounded bg-slate-200"></div>
                            <div class="h-5 w-3/4 rounded bg-slate-200"></div>
                            <div class="h-3 w-1/2 rounded bg-slate-200"></div>
                            <div class="h-10 rounded bg-slate-200"></div>
                        </div>
                    </div>
                </div>
                <div v-else-if="eventsError" class="ticket-card border-red-200 bg-red-50/70 p-5" role="alert">
                    <p class="font-medium text-red-800">服務場次載入失敗</p>
                    <p class="mt-1 text-sm leading-6 text-red-700">{{ eventsError }}</p>
                    <button class="btn btn-outline mt-4" @click="fetchEvents">重新載入</button>
                </div>
                <div v-else-if="!filteredEvents.length" class="ticket-card p-6 text-center">
                    <p class="font-medium text-slate-900">{{ eventSearch ? '沒有符合搜尋條件的服務場次' : '目前沒有可預約的服務場次' }}</p>
                    <p class="mt-1 text-sm leading-6 text-slate-600">{{ eventSearch ? '請調整關鍵字，或先查看目前的票券。' : '新場次開放後會顯示在這裡，也可先查看票券服務。' }}</p>
                    <div class="mt-4 flex flex-wrap justify-center gap-2">
                        <button v-if="eventSearch" class="btn btn-outline" @click="clearEventSearch">清除搜尋</button>
                        <button class="btn btn-primary text-white" @click="setActiveTab('shop', 0)">查看票券商店</button>
                    </div>
                </div>
                <template v-else>
                    <TransitionGroup name="grid-stagger" tag="div" class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <article v-for="(event, index) in displayedEvents" :key="event.id ?? `${event.code}-${index}`" class="ticket-card flex h-full flex-col p-0">
                            <div class="relative w-full overflow-hidden" style="aspect-ratio: 16 / 9;">
                                <img
                                    :src="event.cover || '/transport-fallback.png'"
                                    loading="lazy"
                                    decoding="async"
                                    sizes="(min-width:1280px) 25vw, (min-width:768px) 50vw, 100vw"
                                    @error="(e)=>e.target.src='/transport-fallback.png'"
                                    :alt="eventImageAlt(event)"
                                    class="absolute inset-0 h-full w-full object-cover"
                                />
                                <div class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-slate-950/65 to-transparent"></div>
                                <span class="absolute bottom-3 left-3 rounded-md bg-white/95 px-2 py-1 text-sm font-medium text-slate-800 shadow-sm">
                                    {{ event.code || event.id }}
                                </span>
                            </div>
                            <div class="flex flex-1 flex-col gap-3 p-4">
                                <header class="space-y-2">
                                    <h2 class="ui-title text-lg leading-7 text-slate-950">{{ event.title }}</h2>
                                    <div class="flex flex-wrap gap-2 text-sm text-slate-600">
                                        <span class="ops-chip">
                                            <AppIcon name="calendar" class="h-3.5 w-3.5" />
                                            {{ event.date || formatRange(event.starts_at, event.ends_at) || '日期待更新' }}
                                        </span>
                                        <span class="ops-chip ops-chip-warning">
                                            截止 {{ event.deadline || '未設定' }}
                                        </span>
                                    </div>
                                </header>
                                <p class="line-clamp-3 text-sm leading-6 text-slate-600">{{ event.description }}</p>
                                <ul v-if="event.rules.length" class="space-y-1 text-sm leading-6 text-slate-600">
                                    <li v-for="rule in event.rules.slice(0, 2)" :key="rule" class="flex gap-2">
                                        <span class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70"></span>
                                        <span>{{ rule }}</span>
                                    </li>
                                </ul>
                                <div class="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                                    <span class="text-sm text-slate-500">交車點與價格於下一步選擇</span>
                                    <button class="btn btn-primary btn-sm shrink-0 text-white" @click="goReserve(event.code || event.id)">
                                        立即預約
                                    </button>
                                </div>
                            </div>
                        </article>
                    </TransitionGroup>

                    <div v-if="shouldPaginateEvents" class="flex flex-wrap items-center gap-2 pt-2">
                        <button class="btn btn-outline btn-sm" :disabled="activeEventPage <= 1" @click="goPrevEventPage">上一頁</button>
                        <button
                            v-for="page in totalEventPages"
                            :key="`event-page-${page}`"
                            class="btn btn-sm"
                            :class="page === activeEventPage ? 'btn-primary text-white' : 'btn-outline'"
                            @click="goToEventPage(page)"
                        >
                            {{ page }}
                        </button>
                        <button class="btn btn-outline btn-sm" :disabled="activeEventPage >= totalEventPages" @click="goNextEventPage">下一頁</button>
                    </div>
                </template>
            </section>

            <section
                v-if="activeTab === 'courses'"
                id="store-panel-courses"
                role="tabpanel"
                aria-labelledby="store-tab-courses"
                tabindex="0"
            >
                <CourseStorePanel class="slide-in" @order-created="handleCourseOrderCreated" />
            </section>
        </div>

        <AppOverlayPanel
            v-model="cartOpen"
            placement="auto"
            title="購物車"
            description="確認票券數量與總額後完成結帳。"
            size="md"
        >
            <div class="mb-4 flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <p class="text-xs" :class="cartSyncState === 'error' ? 'text-red-700' : 'text-slate-600'" aria-live="polite">{{ cartSyncLabel }}</p>
                <button v-if="cartSyncState === 'error'" class="btn btn-outline btn-sm shrink-0" @click="retryCartSync">重試</button>
            </div>

            <div v-if="cartUndo" class="mb-4 flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" role="status">
                <span class="min-w-0 text-slate-700">已移除 {{ cartUndo.item.name }}</span>
                <button type="button" class="btn btn-outline btn-sm shrink-0" @click="undoCartRemoval">復原</button>
            </div>

            <div v-if="cartItems.length" class="space-y-4">
                <div v-for="(item, index) in cartItems" :key="item.id ?? item.sku ?? item.name"
                    class="rounded-lg border border-slate-200 bg-white p-4">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <p class="font-medium text-slate-950">{{ item.name }}</p>
                            <p class="money-value mt-1 text-sm text-slate-600">NT$ {{ item.price }} × {{ item.quantity }}</p>
                        </div>
                        <button @click="removeFromCart(index)" class="btn btn-outline btn-sm text-red-700" :disabled="cartMutationLocked" :aria-label="`移除 ${item.name}`" title="移除">
                            <AppIcon name="trash" class="h-4 w-4" />
                        </button>
                    </div>
                    <div class="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                        <span class="text-sm text-slate-500">數量</span>
                        <QuantityStepper v-model="cartItems[index].quantity" :min="1" :max="99" :show-input="false" :disabled="cartMutationLocked" />
                    </div>
                </div>
            </div>
            <div v-else class="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <p class="font-medium text-slate-900">購物車目前是空的</p>
                <p class="mt-1 text-sm text-slate-600">加入票券後，可在這裡統一調整數量。</p>
            </div>

            <template v-if="cartItems.length" #actions>
                <div class="w-full space-y-3">
                    <div class="flex items-center justify-between text-sm text-slate-600">
                        <span>{{ cartItemCount }} 件票券</span>
                        <span class="money-value text-xl text-primary">NT$ {{ cartTotalPrice }}</span>
                    </div>
                    <button @click="checkout" class="btn btn-primary w-full text-white" :disabled="cartMutationLocked">
                        {{ checkingOut ? '處理中…' : '結帳' }}
                    </button>
                </div>
            </template>
        </AppOverlayPanel>

        <AppOverlayPanel
            v-model="ordersOpen"
            placement="auto"
            title="我的訂單"
            description="查看一般服務與課程訂單的付款與處理狀態。"
            size="xl"
        >
            <div class="mb-4 flex justify-end">
                <button class="btn btn-outline btn-sm" @click="refreshActiveOrders" :disabled="orderCategory === 'general' && ordersLoading">
                    <AppIcon name="refresh" class="h-4 w-4" /> 重新整理
                </button>
            </div>

                <div class="mb-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p class="font-medium text-slate-900">訂單分類</p>
                        <p class="mt-1 text-sm text-slate-600">一般服務訂單與課程訂單分開顯示，保留各自的付款與狀態流程。</p>
                    </div>
                    <RecordCategoryTabs
                        :model-value="orderCategory"
                        :options="orderCategoryOptions"
                        label="訂單分類"
                        @update:model-value="setOrderCategory"
                    />
                </div>

                <CourseAccountPanel v-if="orderCategory === 'course'" ref="courseOrdersPanelRef" mode="orders" />

                <template v-else>
                    <div v-if="ordersLoading" class="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600" role="status">載入訂單中…</div>

                    <div v-else-if="ordersError" class="rounded-lg border border-red-200 bg-red-50/70 p-5" role="alert">
                        <p class="font-medium text-red-800">訂單載入失敗</p>
                        <p class="mt-1 text-sm leading-6 text-red-700">{{ ordersError }}</p>
                        <button class="btn btn-outline mt-4" @click="fetchOrders">重新載入</button>
                    </div>

                    <div v-else-if="ticketOrders.length" class="space-y-4 pr-1">
                        <div v-for="order in ticketOrders" :key="order.code || order.id"
                            class="rounded-lg border border-slate-200 bg-white p-4">
                        <p class="mb-1 flex items-center gap-2">
                            <strong>訂單編號：</strong>
                            <span class="font-mono">{{ order.code || order.id }}</span>
                            <button class="btn-ghost" title="複製訂單編號" @click="copyText(order.code || order.id)"><AppIcon name="copy" class="h-4 w-4" /></button>
                        </p>
                        <template v-if="order.isReservation">
                            <p class="mb-1"><strong>服務檔期：</strong>{{ order.eventName || '-' }}</p>
                            <p class="mb-2" v-if="order.eventDate"><strong>時間：</strong>{{ order.eventDate }}</p>
                            <div class="border border-slate-200 divide-y mb-2 rounded-xl">
                                <div v-for="line in order.selections" :key="line.key" class="px-3 py-2 text-sm text-slate-600">
                                    <div class="font-medium text-slate-700">{{ line.store || '—' }}｜{{ line.type || '—' }}</div>
                                    <div>單價：{{ line.byTicket ? '票券抵扣' : formatCurrency(line.unitPrice) }}</div>
                                    <div>數量：{{ line.qty }}</div>
                                    <div>優惠折扣：
                                        <span v-if="line.byTicket">票券抵扣</span>
                                        <span v-else-if="line.discount > 0">-{{ formatCurrency(line.discount) }}</span>
                                        <span v-else>—</span>
                                    </div>
                                    <div>小計：{{ formatCurrency(line.subtotal) }}</div>
                                </div>
                            </div>
                            <div class="text-sm text-slate-700 space-y-1 mb-2">
                                <div>總件數：{{ order.quantity }}</div>
                                <div v-if="order.subtotal !== undefined"><strong>小計：</strong><span class="money-value">{{ formatCurrency(order.subtotal) }}</span></div>
                                <div v-if="order.discountTotal > 0"><strong>優惠折扣：</strong><span class="money-value">-{{ formatCurrency(order.discountTotal) }}</span></div>
                                <div v-for="item in order.addOns || []" :key="`store-order-addon-${order.id}-${item.key}`">
                                    <strong>加購項目：</strong>{{ item.label }} x {{ item.quantity }}（<span class="money-value">{{ formatCurrency(item.amount) }}</span>）
                                </div>
                                <div v-if="order.addOnCost > 0"><strong>加購費用：</strong><span class="money-value">{{ formatCurrency(order.addOnCost) }}</span></div>
                                <div><strong>總金額：</strong><span class="money-value text-primary">{{ formatCurrency(order.total) }}</span></div>
                            </div>
                        </template>
                        <template v-else>
                            <p class="mb-1"><strong>票券種類：</strong>{{ order.ticketType }}</p>
                            <p class="mb-1"><strong>數量：</strong>{{ order.quantity }}</p>
                            <p class="mb-1"><strong>總金額：</strong><span class="money-value text-primary">{{ formatCurrency(order.total) }}</span></p>
                        </template>
                        <p class="mb-2"><strong>訂單時間：</strong>{{ order.createdAt }}</p>
                        <p>
                            <strong>狀態：</strong>
                            <span :class="{
                                'text-green-600': isOrderPaidStatus(order.status),
                                'text-yellow-600': order.status === '待匯款',
                                'text-blue-600': order.status === '處理中',
                                'text-gray-600': order.status === ORDER_STATUS_CANCELLED
                            }">
                                {{ order.status || '處理中' }}
                            </span>
                        </p>
                        <div v-if="order.hasRemittance" class="mt-3 border border-primary/40 bg-red-50/80 px-3 py-3 text-sm text-slate-700 space-y-1 rounded-xl">
                            <div class="font-medium text-primary">匯款資訊</div>
                            <p v-if="order.remittance.bankName">銀行名稱：{{ order.remittance.bankName }}</p>
                            <p v-if="order.remittance.info">{{ order.remittance.info }}</p>
                            <p v-if="order.remittance.bankCode">銀行代碼：{{ order.remittance.bankCode }}</p>
                            <p v-if="order.remittance.bankAccount" class="flex items-center gap-2">
                                <span>銀行帳戶：{{ order.remittance.bankAccount }}</span>
                                <button class="btn-ghost" title="複製帳號" @click="copyText(order.remittance.bankAccount)"><AppIcon name="copy" class="h-4 w-4" /></button>
                            </p>
                            <p v-if="order.remittance.accountName">帳戶名稱：{{ order.remittance.accountName }}</p>
                        </div>
                        <div v-if="canEditOrder(order)" class="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center">
                            <template v-if="!order.isReservation">
                                <label class="text-sm text-slate-600" :for="`order-product-${order.id}`">票券</label>
                                <select :id="`order-product-${order.id}`" v-model="order.editProductId" class="input min-w-0 sm:max-w-48">
                                    <option v-for="product in products" :key="`order-${order.id}-product-${product.id}`" :value="product.id">
                                        {{ product.name }}
                                    </option>
                                </select>
                                <span class="text-sm text-slate-600">修改數量</span>
                                <QuantityStepper v-model="order.editQuantity" :min="1" :max="99" :show-input="false" />
                                <button class="btn btn-primary btn-sm text-white" :disabled="orderActionId === order.id" @click="saveTicketOrder(order)">
                                    儲存修改
                                </button>
                            </template>
                            <button v-else class="btn btn-primary btn-sm text-white" :disabled="orderActionId === order.id" @click="editReservationOrder(order)">
                                修改預約內容
                            </button>
                            <button class="btn btn-outline btn-sm text-red-700 sm:ml-auto" :disabled="orderActionId === order.id" @click="cancelOrder(order)">
                                取消訂單
                            </button>
                        </div>
                        </div>
                    </div>

                    <div v-else class="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                        <p class="font-medium text-slate-900">尚無訂單紀錄</p>
                        <p class="mt-1 text-sm text-slate-600">完成購票或預約後，訂單會顯示在這裡。</p>
                    </div>
                </template>
        </AppOverlayPanel>

        <MobileActionGuideSheet
            v-model="guideSheetOpen"
            v-bind="storeGuideSheet"
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
    import { useRouter, useRoute, onBeforeRouteLeave } from 'vue-router'
    import axios from '../api/axios'
    import AppIcon from '../components/AppIcon.vue'
    import AppOverlayPanel from '../components/AppOverlayPanel.vue'
    import AppSearchInput from '../components/AppSearchInput.vue'
    import RecordCategoryTabs from '../components/RecordCategoryTabs.vue'
    import CourseAccountPanel from './course-account.vue'
    import CourseStorePanel from './courses.vue'
    import LegalReviewDrawer from '../components/LegalReviewDrawer.vue'
    import OrderUserDataReviewDrawer from '../components/OrderUserDataReviewDrawer.vue'
    import MobileActionGuideSheet from '../components/MobileActionGuideSheet.vue'
    import { showNotice, showConfirm } from '../utils/sheet'
    import { dismissToast, showToast } from '../utils/toast.js'
    import { setPageMeta } from '../utils/meta'
    import { formatDateTime, formatDateTimeRange } from '../utils/datetime'
    import { buildUserRecordCategoryOptions, resolveUserRecordCategory } from '../utils/userRecordCategories'
    import { useIsMobile } from '../composables/useIsMobile'
    import {
        CART_DRAFT_STORAGE_KEY,
        createCartDraft,
        parseCartDraft,
        planGuestCartMerge,
        sanitizeCartItem,
        sanitizeCartItems,
    } from '../utils/cartDraft.js'

    const router = useRouter()
    const route = useRoute()
    const API = API_BASE
    axios.defaults.withCredentials = true
    const QuantityStepper = defineAsyncComponent(() => import('../components/QuantityStepper.vue'))

    const toNumber = (value) => {
        const n = Number(value)
        return Number.isFinite(n) ? n : 0
    }
    const formatCurrency = (value) => `NT$ ${toNumber(value).toLocaleString('zh-TW')}`
    const orderAddOnItems = (details = {}) => {
        const items = []
        const materialCount = Math.max(0, Math.floor(toNumber(details?.addOn?.materialCount || 0)))
        const materialCost = details?.addOn?.material ? materialCount * 100 : 0
        if (details?.addOn?.material && materialCount > 0) {
            items.push({ key: 'material', label: '包材', quantity: materialCount, amount: materialCost })
        } else if (toNumber(details.addOnCost) > 0) {
            items.push({ key: 'addon', label: '加購項目', quantity: 1, amount: toNumber(details.addOnCost) })
        }
        return items
    }
    const copyText = async (value) => {
        if (!value) return
        try {
            if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
            await navigator.clipboard.writeText(String(value))
            showToast('已複製到剪貼簿', { tone: 'success' })
        } catch {
            showToast('無法複製，請長按內容後手動複製', { tone: 'error' })
        }
    }

    // Tabs
    const tabs = ['shop', 'events', 'courses']
    const defaultTab = 'events'
    const findTabIndex = (key) => tabs.findIndex(tab => tab === key)
    const defaultTabIndex = findTabIndex(defaultTab)
    const activeTab = ref(defaultTab)
    const activeTabIndex = ref(defaultTabIndex)
    const resolveTab = (value) => {
        const key = typeof value === 'string' ? value : defaultTab
        const idx = findTabIndex(key)
        return idx === -1 ? { key: defaultTab, idx: defaultTabIndex } : { key, idx }
    }
    const tabButtonRefs = ref([])
    const setTabButtonRef = (element, index) => {
        if (element) tabButtonRefs.value[index] = element
    }
    const updateRouteTabQuery = (key) => {
        const current = typeof route.query.tab === 'string' ? route.query.tab : ''
        if (current === key) return
        router.push({
            query: { ...route.query, tab: key }
        }).catch(() => {})
    }
    const setActiveTab = (key, index, options = {}) => {
        const { skipRouteSync = false, force = false } = options
        const resolvedIndex = typeof index === 'number' && index >= 0 ? index : findTabIndex(key)
        if (resolvedIndex === -1) return
        if (!force && activeTab.value === key && activeTabIndex.value === resolvedIndex) {
            if (!skipRouteSync) updateRouteTabQuery(key)
            return
        }
        activeTab.value = key
        activeTabIndex.value = resolvedIndex
        if (!skipRouteSync) updateRouteTabQuery(key)
    }
    const handleTablistKeydown = (event) => {
        const key = event.key
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
        event.preventDefault()

        let targetIndex = activeTabIndex.value
        if (key === 'ArrowRight') targetIndex = (targetIndex + 1) % tabs.length
        if (key === 'ArrowLeft') targetIndex = (targetIndex - 1 + tabs.length) % tabs.length
        if (key === 'Home') targetIndex = 0
        if (key === 'End') targetIndex = tabs.length - 1

        setActiveTab(tabs[targetIndex], targetIndex)
        nextTick(() => tabButtonRefs.value[targetIndex]?.focus())
    }
    watch(() => route.query.tab, (value) => {
        const { key: target, idx } = resolveTab(value)
        if (activeTab.value !== target) {
            setActiveTab(target, idx, { skipRouteSync: true })
        }
    })
    const { isMobile } = useIsMobile(768)

    // 抽屜 / 狀態
    const cartOpen = ref(false)
    const ordersOpen = ref(false)
    const ordersLoading = ref(false)
    const courseOrdersPanelRef = ref(null)
    const checkingOut = ref(false)
    const checkoutIdempotencyKey = ref('')
    const sessionReady = ref(false)
    const sessionProfile = ref(null)
    const legalReviewRef = ref(null)
    const userDataReviewRef = ref(null)
    const activeGuide = ref(null)

    const createOrderIdempotencyKey = (source = 'store') => {
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

    // 商店
    const products = ref([])
    const loadingProducts = ref(true)
    const productsError = ref('')
    const productsSectionRef = ref(null)
    const PRODUCTS_PAGE_SIZE = 10
    const activeProductPage = ref(1)
    const productSearch = ref('')
    const filteredProducts = computed(() => {
        const keyword = productSearch.value.trim().toLowerCase()
        if (!keyword) return products.value
        return products.value.filter(product => {
            const fields = [
                product.name,
                product.description,
                product.code,
                product.category,
                product?.title
            ]
            return fields.some(field => String(field || '').toLowerCase().includes(keyword))
        })
    })
    const clearProductSearch = () => { productSearch.value = '' }
    // 數量控制改由 QuantityStepper 組件處理

    // 購物車
    const cartItems = ref([])
    const cartUndo = ref(null)
    const cartSyncDelay = 400
    const CART_SYNC_STORAGE_KEY = 'leader-online-cart-sync'
    const cartSyncState = ref('idle')
    const cartSyncError = ref('')
    let cartSyncTimer = null
    let cartUndoTimer = null
    let lastSyncedSnapshot = '[]'
    let applyingRemoteCart = false
    let cartLoading = false
    let guestMergeCompleted = false
    let guestMergePending = false
    const guestMergeResumeRequired = ref(false)
    const cartMutationLocked = computed(() => checkingOut.value || guestMergePending || guestMergeResumeRequired.value || cartSyncState.value === 'syncing')
    const cartSyncLabel = computed(() => {
        if (!sessionReady.value) return '已儲存在這個分頁，登入後再同步雲端'
        if (cartSyncState.value === 'syncing') return '正在同步雲端購物車…'
        if (cartSyncState.value === 'error') return cartSyncError.value || '雲端同步失敗，購物車仍保留在本機'
        return '已同步雲端購物車'
    })
    const announceCartSync = (updatedAt = null) => {
        try {
            localStorage.setItem(CART_SYNC_STORAGE_KEY, JSON.stringify({ updatedAt, nonce: `${Date.now()}-${Math.random()}` }))
        } catch {}
    }

    const clampQuantity = (value) => {
        const n = Math.floor(Number(value) || 0)
        return Math.max(1, Math.min(99, n))
    }
    const buildCartPayload = () => sanitizeCartItems(cartItems.value)
    const extractRequestError = (error, fallback) => String(
        error?.response?.data?.message
        || error?.response?.data?.error
        || error?.message
        || fallback
    )
    const readGuestCartDraft = () => {
        try { return sessionStorage.getItem(CART_DRAFT_STORAGE_KEY) } catch { return null }
    }
    const clearGuestCartDraft = () => {
        try { sessionStorage.removeItem(CART_DRAFT_STORAGE_KEY) } catch {}
        guestMergeResumeRequired.value = false
    }
    const persistGuestCart = () => {
        try {
            const items = buildCartPayload()
            if (!items.length) {
                clearGuestCartDraft()
                return
            }
            const currentDraft = parseCartDraft(readGuestCartDraft())
            sessionStorage.setItem(CART_DRAFT_STORAGE_KEY, JSON.stringify(createCartDraft(items, {
                pendingItems: currentDraft?.pendingItems,
            })))
            guestMergeResumeRequired.value = Boolean(currentDraft?.pendingItems?.length)
        } catch {}
    }
    const persistPendingGuestMerge = (pendingItems = buildCartPayload()) => {
        try {
            const currentDraft = parseCartDraft(readGuestCartDraft())
            if (!currentDraft?.items?.length) return
            sessionStorage.setItem(CART_DRAFT_STORAGE_KEY, JSON.stringify(createCartDraft(currentDraft.items, {
                pendingItems,
            })))
            guestMergeResumeRequired.value = true
        } catch {}
    }
    const loadGuestCart = () => {
        const draft = parseCartDraft(readGuestCartDraft())
        const items = draft?.items || []
        guestMergeResumeRequired.value = Boolean(draft?.pendingItems?.length)
        applyingRemoteCart = true
        cartItems.value = items.map(item => ({ ...item }))
        applyingRemoteCart = false
        cartSyncState.value = 'idle'
        cartSyncError.value = ''
    }
    const syncCartNow = async () => {
        if (cartSyncTimer) {
            clearTimeout(cartSyncTimer)
            cartSyncTimer = null
        }
        if (!sessionReady.value) return
        const payload = buildCartPayload()
        const snapshot = JSON.stringify(payload)
        if (snapshot === lastSyncedSnapshot) return
        cartSyncState.value = 'syncing'
        cartSyncError.value = ''
        try {
            const { data } = await axios.put(`${API}/cart`, { items: payload })
            if (data?.ok === false) throw new Error(data?.message || '雲端同步失敗')
            lastSyncedSnapshot = snapshot
            cartSyncState.value = 'synced'
            if (guestMergePending) {
                guestMergePending = false
                guestMergeCompleted = true
                clearGuestCartDraft()
            }
            announceCartSync(data?.data?.updatedAt || data?.updatedAt || null)
        } catch (e) {
            cartSyncState.value = 'error'
            cartSyncError.value = extractRequestError(e, '雲端同步失敗')
            if (e?.response?.status === 401) { sessionReady.value = false; sessionProfile.value = null }
        }
    }
    const scheduleCartSync = () => {
        if (!sessionReady.value || applyingRemoteCart) return
        if (cartSyncTimer) clearTimeout(cartSyncTimer)
        cartSyncTimer = setTimeout(syncCartNow, cartSyncDelay)
    }
    const loadCart = async () => {
        if (!sessionReady.value || cartLoading) return
        if (guestMergePending) {
            await syncCartNow()
            return
        }
        cartLoading = true
        cartSyncState.value = 'syncing'
        cartSyncError.value = ''
        try {
            const { data } = await axios.get(`${API}/cart`)
            if (data?.ok === false) throw new Error(data?.message || '無法載入雲端購物車')
            const remoteRaw = Array.isArray(data?.data?.items) ? data.data.items : (Array.isArray(data?.items) ? data.items : [])
            const mergePlan = planGuestCartMerge(remoteRaw, readGuestCartDraft(), {
                alreadyMerged: guestMergeCompleted,
            })

            applyingRemoteCart = true
            cartItems.value = mergePlan.items.map(item => ({ ...item }))

            const snapshot = JSON.stringify(mergePlan.items)
            if (mergePlan.shouldPut) {
                guestMergePending = true
                persistPendingGuestMerge(mergePlan.items)
                try {
                    const saveResponse = await axios.put(`${API}/cart`, { items: mergePlan.items })
                    if (saveResponse?.data?.ok === false) throw new Error(saveResponse.data?.message || '購物車合併失敗')
                    lastSyncedSnapshot = snapshot
                    cartSyncState.value = 'synced'
                    guestMergeCompleted = true
                    guestMergePending = false
                    if (mergePlan.shouldClearDraft) clearGuestCartDraft()
                    announceCartSync(saveResponse?.data?.data?.updatedAt || saveResponse?.data?.updatedAt || null)
                } catch (e) {
                    cartSyncState.value = 'error'
                    cartSyncError.value = extractRequestError(e, '購物車合併失敗，請重試')
                    if (e?.response?.status === 401) { sessionReady.value = false; sessionProfile.value = null }
                }
            } else {
                guestMergeCompleted = true
                lastSyncedSnapshot = snapshot
                cartSyncState.value = 'synced'
            }
        } catch (e) {
            cartSyncState.value = 'error'
            cartSyncError.value = extractRequestError(e, '無法載入雲端購物車')
            if (e?.response?.status === 401) { sessionReady.value = false; sessionProfile.value = null }
        } finally {
            applyingRemoteCart = false
            cartLoading = false
        }
    }
    const clearCart = async (syncRemote = false) => {
        applyingRemoteCart = true
        cartItems.value = []
        applyingRemoteCart = false
        lastSyncedSnapshot = '[]'
        if (syncRemote && sessionReady.value) {
            try {
                await axios.delete(`${API}/cart`)
                cartSyncState.value = 'synced'
                cartSyncError.value = ''
                announceCartSync(null)
            } catch (e) {
                cartSyncState.value = 'error'
                cartSyncError.value = extractRequestError(e, '雲端購物車清除失敗')
                if (e?.response?.status === 401) { sessionReady.value = false; sessionProfile.value = null }
            }
        }
    }
    const retryCartSync = async () => {
        if (!sessionReady.value) {
            const authed = await checkSession()
            if (!authed) return
        }
        if (!guestMergeCompleted) await loadCart()
        else await syncCartNow()
    }

    const addToCart = async (product) => {
        if (cartMutationLocked.value) {
            showToast('購物車正在完成同步，請稍後再調整', { tone: 'warning' })
            return
        }
        const sanitized = sanitizeCartItem({ ...product })
        if (!sanitized) {
            await showNotice('無法加入購物車', { title: '錯誤' })
            return
        }
        const existing = cartItems.value.find(item => (
            sanitized.id != null
            && item.id != null
            && String(item.id) === String(sanitized.id)
        ) || item.name === sanitized.name)
        if (existing) {
            existing.quantity = clampQuantity(existing.quantity + sanitized.quantity)
            existing.price = sanitized.price
        } else {
            cartItems.value.push({ ...sanitized })
        }
        showToast(`已加入 ${sanitized.name}`, { tone: 'success' })
    }
    const removeFromCart = (idx) => {
        if (cartMutationLocked.value) {
            showToast('購物車正在完成同步，請稍後再調整', { tone: 'warning' })
            return
        }
        const [removed] = cartItems.value.splice(idx, 1)
        if (!removed) return
        if (cartUndoTimer) clearTimeout(cartUndoTimer)
        if (cartUndo.value?.toastId) dismissToast(cartUndo.value.toastId)
        cartUndo.value = { item: removed, index: idx }
        cartUndoTimer = setTimeout(() => {
            cartUndo.value = null
            cartUndoTimer = null
        }, 5000)
        const toastId = showToast(`已移除 ${removed.name}`, {
            duration: 5000,
            actionLabel: '復原',
            onAction: () => undoCartRemoval(),
        })
        if (cartUndo.value) cartUndo.value.toastId = toastId
    }
    const undoCartRemoval = () => {
        const pending = cartUndo.value
        if (!pending) return
        if (cartMutationLocked.value) {
            showToast('購物車正在完成同步，請稍後再調整', { tone: 'warning' })
            return
        }
        if (cartUndoTimer) clearTimeout(cartUndoTimer)
        if (pending.toastId) dismissToast(pending.toastId)
        cartUndoTimer = null
        cartUndo.value = null
        cartItems.value.splice(Math.min(pending.index, cartItems.value.length), 0, pending.item)
        showToast(`已復原 ${pending.item.name}`)
    }
    const cartItemCount = computed(() => cartItems.value.reduce((s, item) => s + Number(item.quantity || 0), 0))
    const cartTotalPrice = computed(() => cartItems.value.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0))
    const profilePhoneComplete = computed(() => {
        const info = sessionProfile.value || {}
        return String(info.phone || '').replace(/\D/g, '').length >= 8
    })
    const profileRemittanceComplete = computed(() => {
        const info = sessionProfile.value || {}
        const last5 = String((info.remittanceLast5 ?? info.remittance_last5) || '').trim()
        return /^\d{5}$/.test(last5)
    })
    const contactInfoComplete = computed(() => sessionReady.value && profilePhoneComplete.value && profileRemittanceComplete.value)
    const contactStatusItem = computed(() => {
        if (!sessionReady.value) {
            return { key: 'contact', icon: 'user', label: '結帳資料', value: '登入後確認手機與匯款後五碼', tone: 'warning' }
        }
        if (contactInfoComplete.value) {
            return { key: 'contact', icon: 'check', label: '結帳資料', value: '手機號碼與匯款後五碼已完成', tone: 'success' }
        }
        const missing = []
        if (!profilePhoneComplete.value) missing.push('手機號碼')
        if (!profileRemittanceComplete.value) missing.push('匯款帳號後五碼')
        return { key: 'contact', icon: 'info', label: '結帳資料', value: `尚需補齊：${missing.join('、')}`, tone: 'warning' }
    })

    watch(cartItems, () => {
        if (applyingRemoteCart) return
        if (sessionReady.value) {
            if (guestMergePending) persistPendingGuestMerge()
            scheduleCartSync()
        }
        else persistGuestCart()
    }, { deep: true })

    const updateStoreMeta = () => {
        if (typeof window === 'undefined') return
        const productCount = products.value.length
        const eventCount = events.value.length
        const description = `選購${productCount > 0 ? `${productCount} 款` : '多款'}單車託運票券，查看${eventCount > 0 ? `${eventCount} 檔` : '多檔'}服務檔期與交車點資訊，並完成線上預約。`
        setPageMeta({
            title: '單車託運購票中心',
            description,
            url: '/store',
            image: '/og_img.png',
            imageAlt: 'Leader Online 單車託運購票中心',
            keywords: ['單車託運', '自行車託運', '貨車預約', '票券購買', '交車點資訊', '服務檔期']
        })
    }

    const hasStoredSession = () => {
        try { return !!localStorage.getItem('user_info') } catch { return false }
    }
    const handleAuthChanged = () => {
        if (hasStoredSession()) {
            checkSession()
        } else {
            sessionReady.value = false
            sessionProfile.value = null
            guestMergeCompleted = false
            guestMergePending = false
            loadGuestCart()
        }
    }
    const handleStorage = (event) => {
        if (!event || event.key === 'user_info') {
            handleAuthChanged()
            return
        }
        if (event.key === CART_SYNC_STORAGE_KEY && sessionReady.value) loadCart()
    }
    const handleCartWindowFocus = () => {
        if (sessionReady.value) loadCart()
    }
    const handleCartVisibilityChange = () => {
        if (document.visibilityState === 'visible') handleCartWindowFocus()
    }

    // 訂單
    const ticketOrders = ref([])
    const ordersError = ref('')
    const orderActionId = ref(null)
    const orderCategoryOptions = buildUserRecordCategoryOptions('orders')
    const orderCategory = ref(resolveUserRecordCategory('orders', 'general'))
    const ORDER_STATUS_PAID = '已付款'
    const ORDER_STATUS_CANCELLED = '已取消'
    const LEGACY_PAID_ORDER_STATUSES = new Set(['已完成', '待指派'])
    const normalizeOrderPaymentStatus = (status = '') => {
        const value = String(status || '').trim()
        return LEGACY_PAID_ORDER_STATUSES.has(value) ? ORDER_STATUS_PAID : value
    }
    const isOrderPaidStatus = (status = '') => normalizeOrderPaymentStatus(status) === ORDER_STATUS_PAID
    const isOrderPendingPayment = (status = '') => {
        const normalized = normalizeOrderPaymentStatus(status)
        return normalized !== ORDER_STATUS_PAID && normalized !== ORDER_STATUS_CANCELLED
    }
    const pendingOrders = computed(() => ticketOrders.value.filter(order => isOrderPendingPayment(order.status)))
    const canEditOrder = (order = {}) => isOrderPendingPayment(order.status)
    const setOrderCategory = async (value, options = {}) => {
        const { refresh = true } = options
        const next = resolveUserRecordCategory('orders', value)
        const changed = orderCategory.value !== next
        orderCategory.value = next
        if (!changed || !refresh || !ordersOpen.value) return
        if (next === 'general') await fetchOrders({ silent: true })
    }
    const openOrders = async (category = 'general') => {
        await checkSession()
        if (!sessionReady.value) {
            if (openMobileGuide({ action: 'login-required', source: 'orders' })) return
            await showNotice('請先登入查看訂單', { title: '需要登入' })
            router.push({ path: '/login', query: { redirect: route.fullPath || '/store' } })
            return
        }
        await setOrderCategory(category, { refresh: false })
        ordersOpen.value = true
        if (orderCategory.value === 'general') await fetchOrders()
    }
    const handleCourseOrderCreated = async (order = {}) => {
        const nextQuery = { ...route.query }
        delete nextQuery.courseProduct
        delete nextQuery.courseSession
        await router.replace({
            query: {
                ...nextQuery,
                tab: 'courses',
                orders: '1',
                category: 'course',
                ...(order?.id ? { order: String(order.id) } : {}),
            },
        }).catch(() => {})
        await openOrders('course')
        await nextTick()
        await courseOrdersPanelRef.value?.refresh?.()
    }
    const fetchOrders = async (options = {}) => {
        const { silent = false } = options
        ordersLoading.value = true
        ordersError.value = ''
        try {
            const { data } = await axios.get(`${API}/orders/me`)
            if (data?.ok && Array.isArray(data.data)) {
                ticketOrders.value = data.data.map(o => {
                    let details = {}
                    try { details = typeof o.details === 'string' ? JSON.parse(o.details) : (o.details || {}) } catch { }
                    const rawSelections = Array.isArray(details.selections) ? details.selections : []
                    const selections = rawSelections.map((sel, idx) => {
                        const qty = toNumber(sel.qty)
                        const unitPrice = toNumber(sel.unitPrice)
                        const subtotal = toNumber(sel.subtotal || unitPrice * qty)
                        const rawDiscount = Number(sel.discount)
                        const discount = Number.isFinite(rawDiscount) ? Math.max(0, rawDiscount) : Math.max(0, (unitPrice * qty) - subtotal)
                        return {
                            key: `${o.id}-${idx}`,
                            store: sel.store || '',
                            type: sel.type || '',
                            qty,
                            unitPrice,
                            subtotal,
                            discount,
                            byTicket: Boolean(sel.byTicket),
                        }
                    })
                    const isReservation = selections.length > 0 || details.kind === 'event-reservation'
                    const subtotal = toNumber(details.subtotal)
                    const addOnCost = toNumber(details.addOnCost)
                    const addOns = orderAddOnItems(details)
                    const total = toNumber(details.total)
                    let discountTotal = toNumber(details.discount)
                    if (!discountTotal) {
                        discountTotal = Math.max(0, (subtotal + addOnCost) - total)
                    }
                    const remittanceRaw = {
                        info: details?.remittance?.info || details.bankInfo || '',
                        bankCode: details?.remittance?.bankCode || details.bankCode || '',
                        bankAccount: details?.remittance?.bankAccount || details.bankAccount || '',
                        accountName: details?.remittance?.accountName || details.bankAccountName || '',
                        bankName: details?.remittance?.bankName || details.bankName || ''
                    }
                    const hasRemittance = Object.values(remittanceRaw).some(val => String(val || '').trim())
                    const base = {
                        id: o.id,
                        code: o.code || '',
                        ticketType: details.ticketType || details?.event?.name || '',
                        quantity: toNumber(details.quantity || 0),
                        total,
                        createdAt: formatDateTime(o.created_at || o.createdAt, { fallback: o.created_at || o.createdAt || '' }),
                        status: normalizeOrderPaymentStatus(details.status || ''),
                        isReservation,
                        remittance: remittanceRaw,
                        hasRemittance,
                        selections,
                        subtotal,
                        addOnCost,
                        addOns,
                        discountTotal,
                        eventName: details?.event?.name || details.ticketType || '',
                        eventDate: details?.event?.date || '',
                        eventCode: details?.event?.code || details?.event?.id || '',
                        productId: details.productId || details.product_id || null,
                        editProductId: details.productId || details.product_id || products.value.find(product => product.name === details.ticketType)?.id || null,
                        editQuantity: toNumber(details.quantity || 1),
                        details,
                    }
                    if (!base.eventName) base.eventName = base.ticketType
                    if (!base.ticketType) base.ticketType = base.eventName
                    return base
                })
            } else {
                ticketOrders.value = []
                ordersError.value = String(data?.message || '伺服器回傳了無法識別的訂單資料')
            }
        } catch (e) {
            if (e?.response?.status === 401) {
                sessionReady.value = false
                sessionProfile.value = null
                ticketOrders.value = []
                ordersOpen.value = false
            } else {
                ordersError.value = extractRequestError(e, '無法載入訂單')
                if (!silent && !ordersOpen.value) showToast(ordersError.value, { tone: 'error' })
            }
        } finally {
            ordersLoading.value = false
        }
    }
    const refreshActiveOrders = async () => {
        if (orderCategory.value === 'general') {
            await fetchOrders()
            return
        }
        await nextTick()
        await courseOrdersPanelRef.value?.refresh?.()
    }

    const saveTicketOrder = async (order) => {
        if (!canEditOrder(order) || orderActionId.value) return
        const quantity = Math.max(1, Math.min(99, Math.floor(Number(order.editQuantity || 1))))
        const product = products.value.find(item => String(item.id) === String(order.editProductId))
        if (!product) {
            await showNotice('請選擇有效的票券商品', { title: '無法修改訂單' })
            return
        }
        const providerUserId = providerIdFromSource(product) || null
        const legalAccepted = await legalReviewRef.value?.open({
            title: '請重新確認本次票券購買規定',
            description: '修改訂單內容前，請重新閱讀票券對應的服務商條款與平台使用者條款。',
            items: [{
                name: product.name,
                quantity,
                providerId: providerUserId,
                detail: `金額 ${formatCurrency(Number(product.price || 0) * quantity)}`,
            }],
            providerIds: providerUserId ? [providerUserId] : [],
            pageSlugs: ['terms'],
        })
        if (legalAccepted !== true) return
        orderActionId.value = order.id
        try {
            const details = {
                ...(order.details || {}),
                productId: product.id,
                product_id: product.id,
                ticketType: product.name,
                providerUserId,
                provider_user_id: providerUserId,
                quantity,
            }
            const { data } = await axios.patch(`${API}/orders/${order.id}`, { details })
            await showNotice(data?.message || '訂單已更新')
            await fetchOrders({ silent: true })
        } catch (e) {
            await showNotice(e?.response?.data?.message || e.message || '更新訂單失敗', { title: '無法修改訂單' })
        } finally {
            orderActionId.value = null
        }
    }

    const editReservationOrder = (order) => {
        if (!canEditOrder(order) || !order?.eventCode) return
        ordersOpen.value = false
        router.push({ path: `/booking/${order.eventCode}`, query: { editOrder: String(order.id) } })
    }

    const cancelOrder = async (order) => {
        if (!canEditOrder(order) || orderActionId.value) return
        const confirmed = await showConfirm(`確定取消訂單 ${order.code || order.id}？付款確認前取消會同時釋放本單使用的票券。`, {
            title: '取消訂單',
            confirmText: '確認取消',
        })
        if (!confirmed) return
        orderActionId.value = order.id
        try {
            const { data } = await axios.post(`${API}/orders/${order.id}/cancel`)
            await showNotice(data?.message || '訂單已取消')
            await fetchOrders({ silent: true })
        } catch (e) {
            await showNotice(e?.response?.data?.message || e.message || '取消訂單失敗', { title: '無法取消訂單' })
        } finally {
            orderActionId.value = null
        }
    }

    watch(sessionReady, (logged) => {
        if (logged) {
            loadCart()
            fetchOrders({ silent: true })
        } else {
            sessionProfile.value = null
            guestMergeCompleted = false
            guestMergePending = false
            loadGuestCart()
            ticketOrders.value = []
            ordersError.value = ''
            ordersOpen.value = false
        }
    })

    // 結帳（商店購物車）
    const checkout = async () => {
        if (checkingOut.value) return
        if (!cartItems.value.length) { await showNotice('購物車是空的'); return }
        if (guestMergePending || guestMergeResumeRequired.value || cartSyncState.value === 'syncing') {
            showToast('請先完成購物車同步再結帳', { tone: 'warning' })
            return
        }
        checkingOut.value = true
        try {
            const ready = await ensureContactInfoComplete()
            if (!ready) return
            if (productsError.value) await fetchProducts()
            const { items: checkoutItems, missing } = rehydrateCartItemsFromCatalog()
            if (missing.length) {
                await showNotice(`以下商品已下架或無法取得最新資料：${missing.join('、')}。請移除後再結帳。`, { title: '購物車需要更新' })
                return
            }
            applyingRemoteCart = true
            cartItems.value = checkoutItems.map((item) => ({ ...item }))
            applyingRemoteCart = false
            const legalAccepted = await requestCartLegalReview(checkoutItems)
            if (!legalAccepted) return
            const contactConfirmation = currentOrderContact()
            const userDataConfirmed = await requestCartUserDataReview(checkoutItems, contactConfirmation)
            if (!userDataConfirmed) return
            const payload = {
                contactConfirmation,
                items: checkoutItems.map(i => ({
                    providerUserId: providerIdFromSource(i) || null,
                    provider_user_id: providerIdFromSource(i) || null,
                    ticketType: i.name,
                    productId: i.id || null,
                    product_id: i.id || null,
                    quantity: i.quantity,
                    total: i.price * i.quantity,
                    status: '待匯款'
                }))
            }
            if (!checkoutIdempotencyKey.value) {
                checkoutIdempotencyKey.value = createOrderIdempotencyKey('store')
            }
            payload.idempotencyKey = checkoutIdempotencyKey.value
            const { data } = await axios.post(`${API}/orders`, payload)
            if (data?.ok) {
                showToast(`已建立 ${payload.items.length} 筆訂單`, { tone: 'success' })
                await clearCart(true)
                checkoutIdempotencyKey.value = ''
                cartOpen.value = false
                await setOrderCategory('general', { refresh: false })
                await fetchOrders()
                ordersOpen.value = true
            } else {
                checkoutIdempotencyKey.value = ''
                await showNotice(data?.message || '結帳失敗', { title: '結帳失敗' })
            }
        } catch (e) {
            if (e?.response) checkoutIdempotencyKey.value = ''
            if (e?.response?.status === 401) {
                sessionReady.value = false
                sessionProfile.value = null
                await showNotice('請先登入', { title: '需要登入' })
                router.push({ path: '/login', query: { redirect: route.fullPath || '/store' } })
            } else {
                await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
            }
        } finally {
            checkingOut.value = false
        }
    }

    // 服務檔期
    const events = ref([])
    const loadingEvents = ref(true)
    const eventsError = ref('')
    const eventsSectionRef = ref(null)
    const EVENTS_PAGE_SIZE = 10
    const activeEventPage = ref(1)
    const eventSearch = ref('')
    const filteredEvents = computed(() => {
        const keyword = eventSearch.value.trim().toLowerCase()
        if (!keyword) return events.value
        return events.value.filter(event => {
            const fields = [
                event.title,
                event.name,
                event.code,
                event.location,
                event.description
            ]
            return fields.some(field => String(field || '').toLowerCase().includes(keyword))
        })
    })
    const clearEventSearch = () => { eventSearch.value = '' }
    // 導頁採用 path 形式，使用活動代碼定位
    const goReserve = (eventCode) => router.push(`/booking/${eventCode}`)
    const goWalletReservations = () => router.push({ path: '/wallet', query: { tab: 'reservations', category: 'general' } })
    const goWalletCourseTickets = () => router.push({ path: '/wallet', query: { tab: 'tickets', category: 'course' } })
    const goWalletCourseReservations = () => router.push({ path: '/wallet', query: { tab: 'reservations', category: 'course' } })

    // 共用
    const formatRange = (a, b) => formatDateTimeRange(a, b)

    const checkSession = async () => {
        try {
            // 結帳前取後端當下的完整會員資料，不使用 JWT 內可能過期的快照。
            const { data } = await axios.get(`${API}/me`)
            if (data?.ok) {
                sessionReady.value = true
                sessionProfile.value = data.data || data || null
            } else {
                sessionReady.value = false
                sessionProfile.value = null
            }
        } catch {
            sessionReady.value = false
            sessionProfile.value = null
        }
        return sessionReady.value
    }

    const ensureContactInfoComplete = async () => {
        const authed = await checkSession()
        if (!authed) {
            if (openMobileGuide({ action: 'login-required', source: 'checkout' })) return false
            await showNotice('請先登入再結帳', { title: '需要登入' })
            router.push({ path: '/login', query: { redirect: route.fullPath || '/store' } })
            return false
        }
        const info = sessionProfile.value || {}
        const username = String(info.username || '').trim()
        const email = String(info.email || '').trim()
        const phoneDigits = String(info.phone || '').replace(/\D/g, '')
        const last5 = String((info.remittanceLast5 ?? info.remittance_last5) || '').trim()
        if (!username || !email || phoneDigits.length < 8 || !/^\d{5}$/.test(last5)) {
            if (openMobileGuide({ action: 'profile-required', source: 'checkout' })) return false
            await showNotice('請先於帳戶中心補齊真實姓名、Email、手機號碼與匯款帳號後五碼，再進行購票或預約', { title: '需要補完資料' })
            router.push({ path: '/account', query: { tab: 'profile' } })
            return false
        }
        return true
    }

    const providerIdFromSource = (source = {}) => String(source.providerUserId || source.provider_user_id || source.owner_user_id || '').trim()
    const findCatalogProduct = (item = {}) => products.value.find((product) => (
        item.id != null && product.id != null && String(item.id) === String(product.id)
    ) || (
        item.sku && product.sku && String(item.sku) === String(product.sku)
    ) || String(item.name || '') === String(product.name || ''))
    const rehydrateCartItemsFromCatalog = () => {
        const items = []
        const missing = []
        for (const item of cartItems.value) {
            const product = findCatalogProduct(item)
            if (!product) {
                missing.push(item.name || '未知商品')
                continue
            }
            const hydrated = sanitizeCartItem({
                ...product,
                quantity: item.quantity,
                providerUserId: providerIdFromSource(product),
            })
            if (hydrated) items.push(hydrated)
            else missing.push(item.name || '未知商品')
        }
        return { items, missing }
    }
    const requestCartLegalReview = async (items = cartItems.value) => {
        const providerIds = Array.from(new Set(items.map(providerIdFromSource).filter(Boolean)))
        const acceptedLegal = await legalReviewRef.value?.open({
            title: '請閱讀本次票券購買規定',
            description: '送出訂單前，請閱讀本次購物車商品對應的服務商條款與平台使用者條款。',
            items: items.map((item) => ({
                name: item.name,
                quantity: item.quantity,
                providerId: providerIdFromSource(item),
                detail: `金額 ${formatCurrency(Number(item.price || 0) * Number(item.quantity || 0))}`,
            })),
            providerIds,
            pageSlugs: ['terms'],
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

    const requestCartUserDataReview = async (items, contact) => {
        const accepted = await userDataReviewRef.value?.open({
            title: '再次確認訂單使用者資料',
            description: `本次將建立 ${items.length} 筆訂單，並共用以下會員聯絡與付款辨識資料。`,
            summary: [{
                key: 'cart-orders',
                label: `${items.length} 筆票券訂單`,
                value: `${items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} 件`,
                detail: `合計 ${formatCurrency(items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0))}`,
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

    function safeParseArray(s) {
        try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
    }

    const fetchProducts = async () => {
        loadingProducts.value = true
        productsError.value = ''
        try{
            const { data } = await axios.get(`${API}/products`)
            if (data?.ok === false) throw new Error(data?.message || '票券服務回傳失敗')
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : null)
            if (!list) throw new Error(data?.message || '票券資料格式錯誤')
            products.value = list.map(p => ({ ...p, providerUserId: p.providerUserId || p.provider_user_id || p.owner_user_id || '', quantity: 1 }))
            activeProductPage.value = 1
            updateStoreMeta()
        } catch (error) {
            products.value = []
            activeProductPage.value = 1
            productsError.value = extractRequestError(error, '無法載入票券資料')
        } finally { loadingProducts.value = false }
    }
    const productCoverUrl = (p) => p?.id
        ? `${API}/products/${p.id}/cover`
        : `${API}/tickets/cover/${encodeURIComponent(p?.name || '')}`
    const productImageAlt = (product = {}) => `${product?.name || '單車託運票券'}封面圖片`
    const eventImageAlt = (event = {}) => `${event?.title || event?.name || '單車託運服務檔期'}封面圖片`

    const productPages = computed(() => {
        const list = filteredProducts.value || []
        if (!Array.isArray(list) || !list.length) return []
        const pages = []
        for (let i = 0; i < list.length; i += PRODUCTS_PAGE_SIZE) {
            pages.push(list.slice(i, i + PRODUCTS_PAGE_SIZE))
        }
        return pages
    })
    const totalProductPages = computed(() => productPages.value.length || 0)
    const shouldPaginateProducts = computed(() => totalProductPages.value > 1)
    watch(productPages, () => {
        if (totalProductPages.value === 0) {
            activeProductPage.value = 1
        } else if (activeProductPage.value > totalProductPages.value) {
            activeProductPage.value = totalProductPages.value
        } else if (activeProductPage.value < 1) {
            activeProductPage.value = 1
        }
    }, { immediate: true })
    const currentProductPageIndex = computed(() => {
        if (!shouldPaginateProducts.value) return 0
        return Math.min(Math.max(activeProductPage.value - 1, 0), totalProductPages.value - 1)
    })
    const displayedProducts = computed(() => {
        if (!shouldPaginateProducts.value) return filteredProducts.value
        return productPages.value[currentProductPageIndex.value] || []
    })
    watch(productSearch, () => {
        activeProductPage.value = 1
    })
    const goToProductPage = (page) => {
        if (!shouldPaginateProducts.value) return
        const target = Math.min(Math.max(1, Number(page) || 1), totalProductPages.value)
        if (target === activeProductPage.value) return
        activeProductPage.value = target
        nextTick(() => {
            const el = productsSectionRef.value
            if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    }
    const goPrevProductPage = () => {
        if (activeProductPage.value > 1) goToProductPage(activeProductPage.value - 1)
    }
    const goNextProductPage = () => {
        if (activeProductPage.value < totalProductPages.value) goToProductPage(activeProductPage.value + 1)
    }

    // ✅ 同時支援 e.date 與 e.starts_at/ends_at
    const fetchEvents = async () => {
        loadingEvents.value = true
        eventsError.value = ''
        try{
            const { data } = await axios.get(`${API}/events`)
            if (data?.ok === false) throw new Error(data?.message || '服務場次回傳失敗')
            const raw = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : null)
            if (!raw) throw new Error(data?.message || '服務場次資料格式錯誤')
            const nowTs = Date.now()
            const parseTs = (value) => {
                if (!value) return null
                const ts = Date.parse(value)
                return Number.isNaN(ts) ? null : ts
            }
            const active = raw.filter(e => {
                const deadlineTs = parseTs(e.deadline)
                const endsTs = parseTs(e.ends_at || e.end_at)
                const expiryTs = deadlineTs ?? endsTs
                if (expiryTs === null) return true
                return expiryTs >= nowTs
            })
            events.value = active.map(e => {
                const rules = Array.isArray(e.rules)
                    ? e.rules
                    : (typeof e.rules === 'string' && e.rules.trim() ? safeParseArray(e.rules) : [])
                const name = e.name || e.title || ''
                return {
                    id: e.id,
                    code: e.code || '',
                    title: name,
                    name,
                    location: e.location || '',
                    date: e.date || '',
                    deadline: e.deadline || e.ends_at || '',
                    starts_at: e.starts_at || e.start_at || null,
                    ends_at: e.ends_at || e.end_at || null,
                    description: e.description || '',
                    cover: e.cover || e.banner || e.image || `${API}/events/${e.id}/cover`,
                    rules
                }
            })
            updateStoreMeta()
            activeEventPage.value = 1
        } catch (error) {
            events.value = []
            activeEventPage.value = 1
            eventsError.value = extractRequestError(error, '無法載入服務場次')
        } finally { loadingEvents.value = false }
    }

    const nextUpcomingEvent = computed(() => {
        if (!events.value.length) return null
        const now = Date.now()
        const scoreEvent = (event) => {
            const parse = (value) => {
                if (!value) return null
                const ts = Date.parse(value)
                return Number.isNaN(ts) ? null : ts
            }
            const startTs = parse(event.starts_at) || parse(event.date)
            const deadlineTs = parse(event.deadline)
            const primary = startTs ?? deadlineTs ?? Number.MAX_SAFE_INTEGER
            const effective = primary >= now ? primary : (deadlineTs ?? startTs ?? Number.MAX_SAFE_INTEGER)
            return { event, score: effective }
        }
        const scored = events.value.map(scoreEvent).sort((a, b) => a.score - b.score)
        const upcoming = scored.find(item => item.score >= now)
        return (upcoming || scored[0] || {}).event || null
    })

    const eventPages = computed(() => {
        const list = filteredEvents.value || []
        if (!Array.isArray(list) || !list.length) return []
        const pages = []
        for (let i = 0; i < list.length; i += EVENTS_PAGE_SIZE) {
            pages.push(list.slice(i, i + EVENTS_PAGE_SIZE))
        }
        return pages
    })
    const totalEventPages = computed(() => eventPages.value.length || 0)
    const shouldPaginateEvents = computed(() => totalEventPages.value > 1)
    watch(eventPages, () => {
        if (totalEventPages.value === 0) {
            activeEventPage.value = 1
        } else if (activeEventPage.value > totalEventPages.value) {
            activeEventPage.value = totalEventPages.value
        } else if (activeEventPage.value < 1) {
            activeEventPage.value = 1
        }
    }, { immediate: true })
    const currentEventPageIndex = computed(() => {
        if (!shouldPaginateEvents.value) return 0
        return Math.min(Math.max(activeEventPage.value - 1, 0), totalEventPages.value - 1)
    })
    const displayedEvents = computed(() => {
        if (!shouldPaginateEvents.value) return filteredEvents.value
        return eventPages.value[currentEventPageIndex.value] || []
    })
    watch(eventSearch, () => {
        activeEventPage.value = 1
    })
    const goToEventPage = (page) => {
        if (!shouldPaginateEvents.value) return
        const target = Math.min(Math.max(1, Number(page) || 1), totalEventPages.value)
        if (target === activeEventPage.value) return
        activeEventPage.value = target
        nextTick(() => {
            const el = eventsSectionRef.value
            if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    }
    const goPrevEventPage = () => {
        if (activeEventPage.value > 1) goToEventPage(activeEventPage.value - 1)
    }
    const goNextEventPage = () => {
        if (activeEventPage.value < totalEventPages.value) goToEventPage(activeEventPage.value + 1)
    }

    const actionCenterCards = computed(() => {
        const cards = []
        if (cartItemCount.value > 0) {
            cards.push({
                key: 'cart-summary',
                title: `購物車有 ${cartItemCount.value} 件待結帳`,
                subtitle: '可隨時同步雲端購物車，避免遺漏項目',
                action: 'cart',
                actionLabel: '查看購物車'
            })
        }
        if (pendingOrders.value.length > 0) {
            cards.push({
                key: 'orders-pending',
                title: `有 ${pendingOrders.value.length} 筆訂單尚未付款`,
                subtitle: '確認匯款資訊或等待付款狀態更新，讓預約順利產生',
                action: 'orders',
                actionLabel: '管理訂單'
            })
        }
        if (nextUpcomingEvent.value) {
            const event = nextUpcomingEvent.value
            cards.push({
                key: 'next-event',
                title: `下一場活動：${event.title || event.name || event.code || '待更新'}`,
                subtitle: formatRange(event.starts_at, event.ends_at) || '請查看活動詳情',
                action: 'event',
                actionLabel: event.code ? '立即預約' : '查看活動',
                eventCode: event.code || ''
            })
        }
        return cards
    })

    const storeGuideSheet = computed(() => {
        const guide = activeGuide.value || {}
        if (guide.action === 'login-required') {
            return {
                eyebrow: '帳戶',
                title: '登入後才能繼續',
                description: '手機端會先保留目前流程，登入後再回到購票或預約頁完成後續步驟。',
                statusItems: [
                    { key: 'login', icon: 'user', label: '登入狀態', value: '尚未登入', tone: 'warning' }
                ],
                steps: [
                    { title: '前往登入', detail: '登入或註冊後，系統會重新確認購物車與訂單資料。' },
                    { title: '補齊結帳資料', detail: '購買與預約前需有手機號碼與匯款帳號後五碼。' },
                    { title: '回到流程完成送出', detail: '送出前仍會開啟條款閱讀抽屜。' },
                ],
                primaryLabel: '前往登入',
                secondaryLabel: '留在本頁',
            }
        }
        if (guide.action === 'profile-required') {
            return {
                eyebrow: '結帳資料',
                title: '先補齊必要資料',
                description: '手機號碼與匯款帳號後五碼會用於訂單、付款與預約通知，完成後即可回來送出。',
                statusItems: [
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
                ],
                steps: [
                    { title: '進入帳戶中心', detail: '資料管理頁可更新手機與匯款後五碼。' },
                    { title: '儲存後回到購票中心', detail: '原本購物車會保留，可直接繼續結帳。' },
                    { title: '閱讀條款並建立訂單', detail: '送出前會再次確認本次購買規定。' },
                ],
                primaryLabel: '補齊資料',
                secondaryLabel: '稍後處理',
            }
        }
        if (guide.action === 'cart-added') {
            return {
                eyebrow: '已加入購物車',
                title: guide.itemName || '票券已加入購物車',
                description: '手機上可先進購物車確認數量與總額，也可以關閉抽屜繼續挑選其他票券或場次。',
                statusItems: [
                    { key: 'cart-count', icon: 'cart', label: '購物車數量', value: `${cartItemCount.value} 件`, tone: 'success' },
                    { key: 'cart-total', icon: 'orders', label: '目前金額', value: formatCurrency(cartTotalPrice.value), tone: 'default' },
                ],
                steps: [
                    { title: '確認票券與數量', detail: '購物車內可調整每個票券數量。' },
                    { title: '補齊結帳資料', detail: '登入後需完成手機與匯款後五碼。' },
                    { title: '閱讀規定後送出', detail: '每次送出訂單都會開啟對應條款。' },
                ],
                primaryLabel: '查看購物車',
                secondaryLabel: '繼續選購',
            }
        }
        if (guide.action === 'cart') {
            return {
                eyebrow: '購物車',
                title: `購物車有 ${cartItemCount.value} 件待結帳`,
                description: '先確認數量、總金額與必要資料，再建立訂單。',
                statusItems: [
                    { key: 'cart-count', icon: 'cart', label: '票券數量', value: `${cartItemCount.value} 件`, tone: 'success' },
                    { key: 'cart-total', icon: 'orders', label: '預估金額', value: formatCurrency(cartTotalPrice.value), tone: 'default' },
                    contactStatusItem.value,
                ],
                steps: [
                    { title: '打開購物車', detail: '確認票券項目、數量與總額。' },
                    { title: '送出前閱讀規定', detail: '本次商品對應的條款會以抽屜開啟並要求讀到底。' },
                    { title: '建立訂單後處理付款', detail: '完成後可在我的訂單查看匯款資訊與狀態。' },
                ],
                primaryLabel: '開啟購物車',
                secondaryLabel: sessionReady.value && !contactInfoComplete.value ? '補齊資料' : '繼續選購',
            }
        }
        if (guide.action === 'orders') {
            return {
                eyebrow: '訂單',
                title: `有 ${pendingOrders.value.length} 筆訂單尚未付款`,
                description: '待付款訂單需要確認匯款資訊，付款完成後才會進入後續安排。',
                statusItems: [
                    { key: 'pending-orders', icon: 'orders', label: '待付款訂單', value: `${pendingOrders.value.length} 筆`, tone: 'warning' },
                ],
                steps: [
                    { title: '開啟我的訂單', detail: '查看每筆訂單的金額、狀態與匯款資訊。' },
                    { title: '複製匯款帳號', detail: '手機上可直接複製帳號，避免手動輸入錯誤。' },
                    { title: '等待付款狀態更新', detail: '付款完成後再回來確認狀態。' },
                ],
                primaryLabel: '管理訂單',
                secondaryLabel: '稍後處理',
            }
        }
        if (guide.action === 'event') {
            return {
                eyebrow: '場次預約',
                title: guide.title || '查看可預約場次',
                description: guide.subtitle || '選擇服務檔期後，再挑交車點、價格方案與票券抵扣。',
                statusItems: [
                    { key: 'event', icon: 'calendar', label: '服務時間', value: guide.subtitle || '請查看活動詳情', tone: 'default' },
                ],
                steps: [
                    { title: '進入預約頁', detail: '查看活動時間、交車點與方案價格。' },
                    { title: '選擇交車點與數量', detail: '可使用已持有票券抵扣對應方案。' },
                    { title: '確認預約規定', detail: '送出前會閱讀購買須知、使用規定與服務商條款。' },
                ],
                primaryLabel: guide.eventCode ? '立即預約' : '查看活動',
                secondaryLabel: '留在商店',
            }
        }
        return {
            eyebrow: '下一步',
            title: '選擇接下來要完成的動作',
            description: '依照目前狀態處理購物車、訂單或預約。',
            steps: [
                { title: '確認目前項目' },
                { title: '補齊必要資料' },
                { title: '閱讀規定後送出' },
            ],
            primaryLabel: '知道了',
        }
    })

    const runActionCenterAction = async (card) => {
        if (!card) return
        if (card.action === 'cart') {
            cartOpen.value = true
        } else if (card.action === 'orders') {
            await openOrders('general')
        } else if (card.action === 'event') {
            if (card.eventCode) {
                goReserve(card.eventCode)
            } else {
                setActiveTab('events', findTabIndex('events'))
            }
        }
    }
    const handleActionCenterAction = (card) => {
        if (!card) return
        if (openMobileGuide(card)) return
        runActionCenterAction(card)
    }
    const handleGuidePrimary = async () => {
        const guide = activeGuide.value || {}
        activeGuide.value = null
        if (guide.action === 'login-required') {
            router.push({ path: '/login', query: { redirect: route.fullPath || route.path } })
            return
        }
        if (guide.action === 'profile-required') {
            router.push({ path: '/account', query: { tab: 'profile' } })
            return
        }
        if (guide.action === 'cart-added') {
            cartOpen.value = true
            return
        }
        await runActionCenterAction(guide)
    }
    const handleGuideSecondary = () => {
        const guide = activeGuide.value || {}
        activeGuide.value = null
        if (guide.action === 'cart' && sessionReady.value && !contactInfoComplete.value) {
            router.push({ path: '/account', query: { tab: 'profile' } })
        }
    }

    onMounted(async () => {
        window.addEventListener('auth-changed', handleAuthChanged)
        window.addEventListener('storage', handleStorage)
        window.addEventListener('focus', handleCartWindowFocus)
        document.addEventListener('visibilitychange', handleCartVisibilityChange)
        loadGuestCart()
        const { key: initialTab, idx: initialIdx } = resolveTab(route.query.tab)
        setActiveTab(initialTab, initialIdx, { skipRouteSync: true, force: true })
        await Promise.all([fetchProducts(), fetchEvents()])
        const authed = await checkSession()
        if (authed) {
            await loadCart()
            if (String(route.query.orders || '') === '1') await openOrders(route.query.category)
        }
    })

    onBeforeRouteLeave(async () => {
        await syncCartNow()
    })

    onBeforeUnmount(() => {
        if (cartSyncTimer) void syncCartNow()
        if (cartUndoTimer) clearTimeout(cartUndoTimer)
        if (cartUndo.value?.toastId) dismissToast(cartUndo.value.toastId)
        cartUndo.value = null
        window.removeEventListener('auth-changed', handleAuthChanged)
        window.removeEventListener('storage', handleStorage)
        window.removeEventListener('focus', handleCartWindowFocus)
        document.removeEventListener('visibilitychange', handleCartVisibilityChange)
    })
</script>
