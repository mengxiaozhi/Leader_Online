<template>
  <component :is="courseFrameComponent" v-bind="courseFrameProps">
  <section class="space-y-5">
    <header v-if="!props.initialTask && !props.embedded" class="ops-header space-y-4">
      <div>
        <h1 class="ui-title text-2xl text-slate-950 sm:text-3xl">課程中心</h1>
        <p class="mt-1 text-sm leading-6 text-slate-600">計次票保留彈性預約；固定班提供固定堂次、候補、插班、續報與請假補課。</p>
      </div>
      <nav class="grid gap-2 sm:grid-cols-3" aria-label="課程商品類型">
        <router-link
          v-for="task in publicCourseTasks"
          :key="task.key"
          :to="task.path"
          class="interactive-press min-h-[44px] border-b-2 px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-primary/30"
          :class="publicTask === task.key ? 'border-primary text-primary' : 'border-slate-200 text-slate-700 hover:text-primary'"
          :aria-current="publicTask === task.key ? 'page' : undefined"
        >
          <strong class="block text-sm">{{ task.label }}</strong>
        </router-link>
      </nav>
    </header>

    <section v-if="publicTask === 'classes'" class="space-y-4" aria-labelledby="fixed-class-title">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 id="fixed-class-title" class="ui-title text-xl text-slate-950">固定班</h2><p class="mt-1 text-sm text-slate-600">報名時會檢查程度、剩餘固定堂次與限時付款席位；額滿可加入候補。</p></div>
        <button type="button" class="btn btn-outline" :disabled="fixedClassesLoading" @click="loadFixedClasses">{{ fixedClassesLoading ? '載入中…' : '重新載入' }}</button>
      </div>
      <div v-if="fixedClassesLoading" class="grid gap-4 md:grid-cols-2"><div v-for="index in 4" :key="index" class="ticket-card animate-pulse p-5"><div class="h-5 w-2/3 rounded bg-slate-200"></div><div class="mt-4 h-20 rounded bg-slate-100"></div></div></div>
      <div v-else-if="fixedClassesError" role="alert" class="surface-section text-sm text-amber-800"><p>{{ fixedClassesError }}</p><button type="button" class="btn btn-outline mt-3" @click="loadFixedClasses">重新載入</button></div>
      <div v-else-if="!fixedClasses.length" class="surface-section text-sm text-slate-600">目前沒有開放報名的固定班。</div>
      <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article v-for="term in fixedClasses" :key="term.id || term.code" class="ticket-card flex flex-col gap-4 p-5">
          <header><div class="flex items-start justify-between gap-3"><h3 class="ui-title text-xl text-slate-950">{{ term.name || term.title }}</h3><span class="ops-chip" :class="isCourseTermFull(term) ? 'ops-chip-warning' : 'ops-chip-success'">{{ isCourseTermFull(term) ? '額滿可候補' : '開放報名' }}</span></div><p class="mt-1 text-sm text-primary">{{ term.providerName || '平台課程' }}</p></header>
          <dl class="space-y-2 text-sm text-slate-600"><div class="flex justify-between gap-3"><dt>班期</dt><dd class="text-right">{{ formatRange(term.startsOn || term.starts_on || term.startsAt || term.starts_at, term.endsOn || term.ends_on || term.endsAt || term.ends_at) }}</dd></div><div class="flex justify-between gap-3"><dt>程度門檻</dt><dd class="text-right">{{ term.levelName || term.level_name || term.levelRequirement || term.level_requirement || '不限程度' }}</dd></div><div class="flex justify-between gap-3"><dt>堂次</dt><dd>{{ term.sessionCount || term.session_count || '詳情公告' }}</dd></div><div class="flex justify-between gap-3"><dt>名額</dt><dd>{{ courseCapacityLabel(term) }}</dd></div></dl>
          <p class="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">{{ term.midjoinAvailable || term.midjoin_available ? '可依剩餘堂次申請插班。' : '目前不開放插班。' }} 提前請假後保留補課權益。</p>
          <router-link :to="courseTermPath(term.id || term.code)" class="btn btn-primary mt-auto min-h-[44px] text-white">{{ isCourseTermFull(term) ? '查看候補資格' : '查看報名資格' }}</router-link>
        </article>
      </div>
    </section>

    <template v-else>
    <div class="ops-toolbar space-y-4">
      <div class="grid gap-3 lg:items-center" :class="props.initialTask || props.embedded ? '' : 'lg:grid-cols-[auto_minmax(0,1fr)]'">
        <div v-if="!props.initialTask && !props.embedded" class="flex border-b border-slate-300" role="tablist"
          aria-label="課程商店分頁" @keydown="handleTabKeydown">
          <button v-for="tabItem in courseTabOptions" :id="`course-tab-${tabItem.key}`" :key="tabItem.key"
            role="tab" type="button" :aria-controls="`course-panel-${tabItem.key}`"
            :aria-selected="activeTab === tabItem.key" :tabindex="activeTab === tabItem.key ? 0 : -1"
            class="interactive-press flex min-h-[44px] flex-1 items-center justify-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition lg:flex-none"
            :class="activeTab === tabItem.key ? 'border-primary text-primary' : 'border-transparent text-slate-600'"
            @click="setCourseTab(tabItem.key)">
            <AppIcon :name="tabItem.icon" class="h-4 w-4" /> {{ tabItem.label }}
          </button>
        </div>
        <div class="flex min-w-0 flex-col gap-2 sm:flex-row">
          <AppSearchInput v-model="search" class="min-w-0 flex-1"
            :placeholder="activeTab === 'products' ? '搜尋課程名稱、代碼、分類或服務商' : '搜尋場次、課程、服務商、教練或地點'" />
          <button v-if="activeTab === 'products'" type="button" class="btn btn-outline shrink-0" @click="courseCartOpen = true">
            <AppIcon name="cart" class="h-4 w-4" /> 課程購物車<span v-if="courseCartCount">（{{ courseCartCount }}）</span>
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between gap-3 md:hidden">
        <p class="text-sm text-slate-600">{{ activeFilterCount ? `已套用 ${activeFilterCount} 項篩選` : '顯示全部結果' }}</p>
        <button type="button" class="btn btn-outline btn-sm interactive-press" :aria-label="mobileFilterButtonLabel" @click="openMobileFilters">
          <AppIcon name="filter" class="h-4 w-4" /> {{ mobileFilterButtonLabel }}
        </button>
      </div>

      <div v-if="activeTab === 'products'" class="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-6">
        <label class="space-y-1 text-sm text-slate-600">分類
          <select v-model="productFilters.category" class="w-full">
            <option value="">全部分類</option>
            <option v-for="category in productCategories" :key="category" :value="category">{{ category }}</option>
          </select>
        </label>
        <label class="space-y-1 text-sm text-slate-600">服務商
          <select v-model="productFilters.providerUserId" class="w-full">
            <option value="">全部服務商</option>
            <option value="platform">平台課程</option>
            <option v-for="provider in courseProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
          </select>
        </label>
        <label class="space-y-1 text-sm text-slate-600">最低價格<input v-model.trim="productFilters.priceMin" type="number" min="0" class="w-full" /></label>
        <label class="space-y-1 text-sm text-slate-600">最高價格<input v-model.trim="productFilters.priceMax" type="number" min="0" class="w-full" /></label>
        <label class="space-y-1 text-sm text-slate-600">排序
          <select v-model="productFilters.sort" class="w-full">
            <option value="sort_order">推薦順序</option>
            <option value="price_asc">價格低到高</option>
            <option value="price_desc">價格高到低</option>
          </select>
        </label>
        <div class="flex items-end"><button type="button" class="btn btn-outline w-full" :disabled="!hasProductFilters" @click="clearProductFilters">清除篩選</button></div>
      </div>

      <div v-else class="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-6">
        <label class="space-y-1 text-sm text-slate-600">服務商
          <select v-model="sessionFilters.providerUserId" class="w-full">
            <option value="">全部服務商</option>
            <option value="platform">平台場次</option>
            <option v-for="provider in courseProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
          </select>
        </label>
        <label class="space-y-1 text-sm text-slate-600">開始日期<input v-model="sessionFilters.startsFrom" type="date" class="w-full" /></label>
        <label class="space-y-1 text-sm text-slate-600">結束日期<input v-model="sessionFilters.startsTo" type="date" class="w-full" /></label>
        <label class="space-y-1 text-sm text-slate-600">名額
          <select v-model="sessionFilters.availability" class="w-full">
            <option value="">全部場次</option>
            <option value="available">尚有名額</option>
            <option value="full">已額滿</option>
          </select>
        </label>
        <label class="space-y-1 text-sm text-slate-600">排序
          <select v-model="sessionFilters.sort" class="w-full"><option value="starts_asc">時間近到遠</option><option value="starts_desc">時間遠到近</option></select>
        </label>
        <div class="flex items-end"><button type="button" class="btn btn-outline w-full" :disabled="!hasSessionFilters" @click="clearSessionFilters">清除篩選</button></div>
      </div>
    </div>

    <AppBottomSheet
      v-model="mobileFiltersOpen"
      :title="activeTab === 'products' ? '篩選課程方案' : '篩選開放場次'"
      description="設定後再一次套用，不會在調整過程中反覆載入。"
    >
      <form id="course-mobile-filter-form" class="space-y-4" @submit.prevent="applyMobileFilters">
        <template v-if="activeTab === 'products'">
          <label class="block space-y-2 text-sm font-medium text-slate-700">分類
            <select v-model="mobileProductFilters.category" class="w-full">
              <option value="">全部分類</option>
              <option v-for="category in productCategories" :key="category" :value="category">{{ category }}</option>
            </select>
          </label>
          <label class="block space-y-2 text-sm font-medium text-slate-700">服務商
            <select v-model="mobileProductFilters.providerUserId" class="w-full">
              <option value="">全部服務商</option><option value="platform">平台課程</option>
              <option v-for="provider in courseProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
            </select>
          </label>
          <div class="grid grid-cols-2 gap-3">
            <label class="block space-y-2 text-sm font-medium text-slate-700">最低價格<input v-model.trim="mobileProductFilters.priceMin" type="number" min="0" class="w-full" /></label>
            <label class="block space-y-2 text-sm font-medium text-slate-700">最高價格<input v-model.trim="mobileProductFilters.priceMax" type="number" min="0" class="w-full" /></label>
          </div>
          <label class="block space-y-2 text-sm font-medium text-slate-700">排序
            <select v-model="mobileProductFilters.sort" class="w-full"><option value="sort_order">推薦順序</option><option value="price_asc">價格低到高</option><option value="price_desc">價格高到低</option></select>
          </label>
        </template>
        <template v-else>
          <label class="block space-y-2 text-sm font-medium text-slate-700">服務商
            <select v-model="mobileSessionFilters.providerUserId" class="w-full">
              <option value="">全部服務商</option><option value="platform">平台場次</option>
              <option v-for="provider in courseProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
            </select>
          </label>
          <div class="grid grid-cols-2 gap-3">
            <label class="block space-y-2 text-sm font-medium text-slate-700">開始日期<input v-model="mobileSessionFilters.startsFrom" type="date" class="w-full" /></label>
            <label class="block space-y-2 text-sm font-medium text-slate-700">結束日期<input v-model="mobileSessionFilters.startsTo" type="date" class="w-full" /></label>
          </div>
          <label class="block space-y-2 text-sm font-medium text-slate-700">名額
            <select v-model="mobileSessionFilters.availability" class="w-full"><option value="">全部場次</option><option value="available">尚有名額</option><option value="full">已額滿</option></select>
          </label>
          <label class="block space-y-2 text-sm font-medium text-slate-700">排序
            <select v-model="mobileSessionFilters.sort" class="w-full"><option value="starts_asc">時間近到遠</option><option value="starts_desc">時間遠到近</option></select>
          </label>
        </template>
      </form>
      <template #actions>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="btn btn-outline interactive-press" @click="clearMobileFilters">清除全部</button>
          <button type="submit" form="course-mobile-filter-form" class="btn btn-primary interactive-press text-white">套用篩選</button>
        </div>
      </template>
    </AppBottomSheet>

    <p v-if="message" class="rounded-lg border px-4 py-3 text-sm" :role="messageType === 'error' ? 'alert' : 'status'" :aria-live="messageType === 'error' ? 'assertive' : 'polite'" aria-atomic="true"
      :class="messageType === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'">
      {{ message }}
    </p>

    <section v-if="activeTab === 'products'" id="course-panel-products" :role="standaloneTabbed ? 'tabpanel' : undefined"
      :aria-labelledby="standaloneTabbed ? 'course-tab-products' : undefined" :tabindex="standaloneTabbed ? 0 : undefined" :aria-busy="loadingProducts" class="space-y-4">
      <div v-if="loadingProducts" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div v-for="index in 6" :key="index" class="ticket-card animate-pulse"><div class="h-44 bg-slate-200"></div><div class="space-y-3 p-4"><div class="h-5 w-2/3 rounded bg-slate-200"></div><div class="h-12 rounded bg-slate-100"></div></div></div>
      </div>
      <div v-else-if="productsError" class="surface-section text-sm text-red-700" role="alert">
        <p>{{ productsError }}</p><button type="button" class="btn btn-outline mt-3" @click="loadProducts(productMeta.offset, { forceSummary: true })">重新載入</button>
      </div>
      <div v-else-if="!products.length" class="surface-section text-sm text-slate-600">
        {{ search || hasProductFilters ? '沒有符合搜尋或篩選條件的課程。' : '目前尚無已上架的課程。' }}
      </div>
      <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article v-for="product in products" :key="product.id" class="ticket-card flex min-h-full flex-col overflow-hidden p-0">
          <div class="relative aspect-[16/10] overflow-hidden bg-slate-100">
            <img v-if="courseCover(product)" :src="courseCover(product)" :alt="`${product.name} 課程圖片`" class="h-full w-full object-cover" loading="lazy" @error="hideBrokenImage(product)" />
            <div v-else class="flex h-full items-center justify-center bg-slate-100 text-primary"><AppIcon name="ticket" class="h-12 w-12" /></div>
            <span class="absolute bottom-3 left-3 rounded-sm bg-white px-2.5 py-1 text-sm font-medium text-slate-800">{{ product.category || '運動課程' }}</span>
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-5">
            <div class="space-y-2">
              <p class="text-sm font-medium text-primary">{{ providerLabel(product) }}・銷售方案</p>
              <h2 class="ui-title text-xl text-slate-950">{{ product.name }}</h2>
              <p class="line-clamp-3 whitespace-pre-line text-sm leading-6 text-slate-600">{{ product.summary || product.description || '課程內容由專業團隊規劃。' }}</p>
            </div>
            <div class="flex flex-wrap gap-2 text-sm"><span class="ops-chip">{{ product.classCount }} 堂</span><span class="ops-chip">開卡後 {{ product.validDays }} 天</span><span v-if="product.ticketProductName" class="ops-chip ops-chip-info">發行：{{ product.ticketProductName }}</span><span v-if="product.requireAddonForNew" class="ops-chip ops-chip-warning">非舊生需加購</span><span v-if="product.transferable" class="ops-chip ops-chip-info">可轉讓</span></div>
            <div class="mt-auto border-t border-slate-100 pt-4"><p class="text-sm text-slate-500">課程價格</p><p class="money-value mt-1 text-2xl text-slate-950">NT$ {{ formatMoney(product.price) }}</p><p v-if="!product.externalPurchaseUrl" class="mt-1 text-xs text-slate-500">單次最多 {{ productPurchaseLimit(product) }} 份</p></div>
            <button class="btn btn-primary interactive-press w-full text-white" @click="openPurchase(product)">{{ product.externalPurchaseUrl ? '查看購買方式' : '查看方案與加入購物車' }}</button>
          </div>
        </article>
      </div>
      <AdminPagination v-if="productMeta.total > 0" :total="productMeta.total" :limit="productMeta.limit" :offset="productMeta.offset" :loading="loadingProducts" @change="loadProducts($event.offset)" />
    </section>

    <section v-else id="course-panel-sessions" :role="standaloneTabbed ? 'tabpanel' : undefined" :aria-labelledby="standaloneTabbed ? 'course-tab-sessions' : undefined" :tabindex="standaloneTabbed ? 0 : undefined" :aria-busy="loadingSessions" class="space-y-4">
      <div v-if="loadingSessions" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><div v-for="index in 6" :key="index" class="ticket-card animate-pulse p-5"><div class="h-5 w-2/3 rounded bg-slate-200"></div><div class="mt-4 h-16 rounded bg-slate-100"></div></div></div>
      <div v-else-if="sessionsError" class="surface-section text-sm text-red-700" role="alert"><p>{{ sessionsError }}</p><button type="button" class="btn btn-outline mt-3" @click="loadSessions(sessionMeta.offset, { forceSummary: true })">重新載入</button></div>
      <div v-else-if="!sessions.length" class="surface-section text-sm text-slate-600">{{ search || hasSessionFilters ? '沒有符合搜尋或篩選條件的場次。' : '目前沒有課程場次。' }}</div>
      <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article v-for="session in sessions" :key="session.id" class="ticket-card flex min-h-full flex-col gap-4 p-4 sm:p-5">
          <div class="min-w-0 space-y-4">
            <header class="space-y-2">
              <div class="flex items-start justify-between gap-3"><h2 class="ui-title min-w-0 text-xl text-slate-950">{{ session.title }}</h2><span class="ops-chip shrink-0" :class="bookingStateClass(session)">{{ bookingStateLabel(session) }}</span></div>
              <p class="text-sm font-medium text-primary">{{ providerLabel(session) }}</p>
              <p v-if="session.productName" class="text-sm text-slate-600">適用：{{ session.productName }}</p>
              <p v-else class="text-sm text-slate-600">適用：同服務商全部課程票券</p>
            </header>
            <dl class="grid gap-2 text-sm text-slate-600">
              <div class="flex gap-2"><AppIcon name="calendar" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ formatRange(session.startsAt, session.endsAt) }}</span></div>
              <div class="flex gap-2"><AppIcon name="map-pin" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ session.location || '地點待公告' }}</span></div>
              <div class="flex gap-2"><AppIcon name="user" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ session.coachName || '教練待公告' }}</span></div>
              <div class="flex gap-2"><AppIcon name="ticket" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ capacityLabel(session) }}</span></div>
            </dl>
            <p v-if="session.notes" class="line-clamp-2 text-sm leading-6 text-slate-600">{{ session.notes }}</p>
          </div>
          <div class="mt-auto border-t border-slate-100 pt-4">
            <button class="btn btn-primary interactive-press min-h-[44px] w-full text-white" @click="openBooking(session)">{{ sessionCanBook(session) ? '查看場次並預約' : `查看場次 · ${bookingStateLabel(session)}` }}</button>
          </div>
        </article>
      </div>
      <AdminPagination v-if="sessionMeta.total > 0" :total="sessionMeta.total" :limit="sessionMeta.limit" :offset="sessionMeta.offset" :loading="loadingSessions" @change="loadSessions($event.offset)" />
    </section>

    <AppOverlayPanel v-model="purchaseOpen" placement="auto" size="lg" :title="selectedProduct?.name || '課程詳情'"
      :description="providerLabel(selectedProduct)" @close="closeDialogs">
      <div v-if="selectedProduct" class="space-y-5">
        <div v-if="courseCover(selectedProduct)" class="aspect-[16/7] overflow-hidden rounded-xl bg-slate-100"><img :src="courseCover(selectedProduct)" :alt="`${selectedProduct.name} 課程圖片`" class="h-full w-full object-cover" /></div>
        <div class="flex flex-wrap gap-2"><span class="ops-chip">{{ selectedProduct.category || '運動課程' }}</span><span class="ops-chip">{{ selectedProduct.classCount }} 堂</span><span class="ops-chip">{{ selectedProduct.activationDays }} 天內開卡</span><span class="ops-chip">開卡後 {{ selectedProduct.validDays }} 天</span><span v-if="selectedProduct.requireAddonForNew" class="ops-chip ops-chip-warning">非舊生需強制加購</span><span v-if="selectedProduct.transferable" class="ops-chip ops-chip-info">可轉讓</span></div>
        <p class="whitespace-pre-line text-sm leading-7 text-slate-700">{{ selectedProduct.description || selectedProduct.summary || '尚無課程說明。' }}</p>
        <section v-if="selectedProduct.recentSessions?.length" class="space-y-3">
          <h3 class="font-medium text-slate-900">近期場次</h3>
          <button v-for="session in selectedProduct.recentSessions" :key="session.id" type="button" class="surface-muted flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-sm" @click="openBookingFromProduct(session)"><span><strong class="block text-slate-900">{{ session.title }}</strong><span class="text-slate-600">{{ formatRange(session.startsAt, session.endsAt) }}・{{ session.location || '地點待公告' }}</span></span><AppIcon name="calendar" class="h-4 w-4 shrink-0" /></button>
        </section>
        <div v-if="dialogError" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"><span>{{ dialogError }}</span><button v-if="selectedProduct?._detailReady === false" type="button" class="btn btn-outline btn-sm" @click="openPurchase(selectedProduct, { syncRoute: false })">重新載入詳情</button></div>

        <div v-if="selectedProduct.externalPurchaseUrl" class="surface-muted space-y-3 text-sm leading-6 text-slate-700">
          <p>此課程由 {{ providerLabel(selectedProduct) }} 的外部頁面完成購買，平台不會建立課程訂單。</p>
          <button type="button" class="btn btn-outline w-full" :disabled="selectedProduct?._detailReady === false" @click="reviewPurchaseLegal"><AppIcon name="shield" class="h-4 w-4" />查看服務商與課程條款</button>
          <button type="button" class="btn btn-primary w-full text-white" :disabled="selectedProduct?._detailReady === false" @click="openExternalPurchase(selectedProduct)">前往外部購買頁面</button>
        </div>

        <form v-else class="space-y-4" @submit.prevent="addSelectedProductToCourseCart">
            <div v-if="!user" class="surface-muted text-sm leading-6 text-slate-700">可先加入本機購物車；登入後會與雲端課程購物車合併，結帳前再確認會員資料與資格。</div>
            <label class="block space-y-2 text-sm font-medium text-slate-700">購買數量<input v-model.number="purchaseForm.quantity" min="1" :max="selectedProductPurchaseLimit" required type="number" class="w-full" /><span class="block text-xs font-normal text-slate-500">此方案每筆訂單最多 {{ selectedProductPurchaseLimit }} 份</span></label>
            <section class="rounded-xl border border-slate-200 bg-white p-4" aria-live="polite">
              <div class="flex items-center justify-between gap-3">
                <h3 class="font-medium text-slate-900">訂單預覽</h3>
                <span v-if="purchasePreview" class="ops-chip" :class="purchasePreview.returningStudent ? 'ops-chip-success' : 'ops-chip-info'">{{ purchasePreview.returningStudentLabel }}</span>
              </div>
              <p v-if="previewLoading" class="mt-3 text-sm text-slate-500">正在檢查舊生資格與加購規則…</p>
              <p v-else-if="previewError" class="mt-3 text-sm text-red-700">{{ previewError }}</p>
              <template v-else-if="purchasePreview">
                <p v-if="!purchasePreview.eligible" class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{{ purchasePreview.reason || '目前不符合此銷售方案資格。' }}</p>
                <ul class="mt-3 divide-y divide-slate-100 text-sm">
                  <li v-for="(item, index) in purchasePreview.items" :key="`${item.productId || item.name}-${index}`" class="flex items-start justify-between gap-3 py-2">
                    <span><strong class="text-slate-900">{{ item.name }}</strong><span v-if="item.required || item.kind === 'required_add_on'" class="ml-2 text-amber-700">強制加購</span><span class="block text-slate-500">{{ item.quantity }} × NT$ {{ formatMoney(item.unitPrice) }}</span></span>
                    <span class="money-value shrink-0">NT$ {{ formatMoney(item.subtotal) }}</span>
                  </li>
                </ul>
              </template>
            </section>
            <div class="surface-muted text-sm leading-6 text-slate-600"><p>結帳時會重新檢查所有方案、價格、強制加購與服務商歸屬；行政確認付款與發券會原子完成。</p></div>
            <div class="flex items-center justify-between gap-3 border-t border-slate-200 pt-4"><div><p class="text-sm text-slate-500">目前預估</p><p class="money-value text-xl">NT$ {{ formatMoney(orderTotal) }}</p></div><button class="btn btn-primary text-white" :disabled="selectedProduct?._detailReady === false">加入課程購物車</button></div>
        </form>
      </div>
    </AppOverlayPanel>

    <AppOverlayPanel v-model="courseCartOpen" placement="auto" size="lg" title="課程購物車" description="可一次結帳多個方案；每個方案會建立獨立課程訂單。">
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
          <span :class="courseCartSyncState === 'error' ? 'text-red-700' : 'text-slate-600'">{{ courseCartSyncLabel }}</span>
          <button v-if="courseCartSyncState === 'error'" type="button" class="btn btn-outline btn-sm" @click="loadCourseCart">重試</button>
        </div>
        <p v-if="courseCheckoutError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{{ courseCheckoutError }}</p>
        <div v-if="courseCartItems.length" class="space-y-3">
          <article v-for="(item, index) in courseCartItems" :key="item.productId" class="rounded-lg border border-slate-200 bg-white p-4">
            <div class="flex items-start justify-between gap-3"><div class="min-w-0"><h3 class="font-medium text-slate-950">{{ item.name }}</h3><p class="mt-1 text-sm text-primary">{{ item.providerName || (item.providerUserId ? '服務商課程' : '平台課程') }}</p><p class="money-value mt-1 text-sm text-slate-600">NT$ {{ formatMoney(item.price) }} × {{ item.quantity }}</p></div><button type="button" class="btn btn-outline btn-sm text-red-700" :disabled="courseCartLocked" @click="removeCourseCartItem(index)"><AppIcon name="trash" class="h-4 w-4" /></button></div>
            <label class="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm text-slate-600">數量<input v-model.number="courseCartItems[index].quantity" type="number" min="1" :max="item.maxPurchaseQuantity" class="w-24" :disabled="courseCartLocked" @change="normalizeCourseCartQuantity(item)" /></label>
            <p class="mt-1 text-right text-xs text-slate-500">最多 {{ item.maxPurchaseQuantity }} 份</p>
          </article>
        </div>
        <div v-else class="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">課程購物車目前是空的。</div>

        <section v-if="courseBatchPreview.orders.length" class="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4" aria-live="polite">
          <div class="flex items-center justify-between gap-3"><h3 class="font-medium text-slate-950">權威訂單預覽</h3><span class="ops-chip ops-chip-info">{{ courseBatchPreview.orderCount }} 筆訂單</span></div>
          <article v-for="order in courseBatchPreview.orders" :key="order.productId" class="rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div class="flex items-start justify-between gap-3"><div><strong class="text-slate-950">{{ order.productName }}</strong><p class="text-slate-500">{{ order.providerName || (order.providerUserId ? '服務商課程' : '平台課程') }}・{{ order.quantity }} 份</p><p v-if="order.expectedTicketCount" class="mt-1 text-xs text-slate-500">預計發行 {{ order.expectedTicketCount }} 張課程票券</p></div><span class="money-value">NT$ {{ formatMoney(order.totalAmount) }}</span></div>
            <ul v-if="order.lineItems.length" class="mt-2 divide-y divide-slate-100"><li v-for="(line, lineIndex) in order.lineItems" :key="`${order.productId}-${lineIndex}`" class="flex justify-between gap-3 py-2"><span>{{ line.name || line.productName }} × {{ line.quantity || 1 }}<em v-if="line.required" class="ml-1 not-italic text-amber-700">強制加購</em></span><span>NT$ {{ formatMoney(line.subtotal ?? line.lineTotal ?? Number(line.unitPrice || 0) * Number(line.quantity || 1)) }}</span></li></ul>
          </article>
          <section v-if="courseBatchPreview.paymentGroups.length" class="space-y-2 border-t border-primary/20 pt-3">
            <h4 class="text-sm font-medium text-slate-900">分服務商匯款資訊</h4>
            <article v-for="group in courseBatchPreview.paymentGroups" :key="group.key" class="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <div class="flex flex-wrap items-start justify-between gap-2"><div><strong>{{ coursePaymentGroupLabel(group) }}</strong><p class="text-xs text-slate-500">預計發行 {{ group.expectedTicketCount }} 張票券</p></div><span class="money-value">NT$ {{ formatMoney(group.totalAmount) }}</span></div>
              <dl class="mt-2 grid gap-x-4 gap-y-1 text-slate-600 sm:grid-cols-2">
                <div v-if="group.remittance.bankName"><dt class="inline text-slate-500">銀行：</dt><dd class="inline">{{ group.remittance.bankName }}</dd></div>
                <div v-if="group.remittance.bankCode"><dt class="inline text-slate-500">代碼：</dt><dd class="inline">{{ group.remittance.bankCode }}</dd></div>
                <div v-if="group.remittance.bankAccount"><dt class="inline text-slate-500">帳號：</dt><dd class="inline break-all">{{ group.remittance.bankAccount }}</dd></div>
                <div v-if="group.remittance.accountName"><dt class="inline text-slate-500">戶名：</dt><dd class="inline">{{ group.remittance.accountName }}</dd></div>
              </dl>
              <p v-if="group.remittance.info" class="mt-2 whitespace-pre-line text-slate-600">{{ group.remittance.info }}</p>
              <p v-if="!courseRemittanceText(group)" class="mt-2 text-amber-700">匯款資訊請洽詢服務商。</p>
            </article>
          </section>
          <div class="flex justify-between border-t border-primary/20 pt-3"><span>共 {{ courseBatchPreview.totalQuantity }} 份・預計 {{ courseBatchPreview.expectedTicketCount }} 張票券</span><strong class="money-value text-lg">NT$ {{ formatMoney(courseBatchPreview.totalAmount) }}</strong></div>
        </section>

        <div v-if="courseCartItems.length" class="border-t border-slate-200 pt-4">
          <div class="mb-3 flex items-center justify-between text-sm"><span>購物車 {{ courseCartCount }} 份</span><strong class="money-value text-xl">NT$ {{ formatMoney(courseCartEstimatedTotal) }}</strong></div>
          <button v-if="!courseBatchPreview.checkoutHash" type="button" class="btn btn-primary w-full text-white" :disabled="courseCartLocked" @click="prepareCourseBatchCheckout">{{ courseCheckoutLoading ? '檢查中…' : '檢查並預覽訂單' }}</button>
          <button v-else type="button" class="btn btn-primary w-full text-white" :disabled="courseCartLocked" @click="submitCourseBatchCheckout">{{ courseCheckoutLoading ? '建立中…' : `確認建立 ${courseBatchPreview.orderCount} 筆訂單` }}</button>
        </div>
      </div>
    </AppOverlayPanel>

    <AppOverlayPanel v-model="bookingOpen" placement="auto" size="md" :title="selectedSession?.title || '團練預約'"
      :description="formatRange(selectedSession?.startsAt, selectedSession?.endsAt)" @close="closeDialogs">
      <div v-if="selectedSession" class="space-y-4">
        <div class="surface-muted space-y-2 text-sm leading-6 text-slate-700"><p class="font-medium text-primary">{{ providerLabel(selectedSession) }}</p><p>{{ selectedSession.scenarioName ? `使用情境：${selectedSession.scenarioName}` : (selectedSession.productName || '依伺服器情境判定適用票券') }}</p><p>{{ selectedSession.location || '地點待公告' }}｜{{ selectedSession.coachName || '教練待公告' }}</p><p aria-live="polite">{{ capacityLabel(selectedSession) }}；預約期間 {{ formatRange(selectedSession.bookingOpenAt, selectedSession.bookingCloseAt) }}</p><p v-if="sessionEligibility.cancellationDeadline">可取消至 {{ formatTaipei(sessionEligibility.cancellationDeadline) }}（台灣時間）</p><p v-if="selectedSession.notes" class="whitespace-pre-line">{{ selectedSession.notes }}</p></div>
        <div v-if="dialogError" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"><span>{{ dialogError }}</span><button v-if="selectedSession?._detailReady === false" type="button" class="btn btn-outline btn-sm" @click="openBooking(selectedSession, { syncRoute: false })">重新載入詳情</button></div>
        <div v-if="!sessionCanBook(selectedSession)" class="surface-muted text-sm leading-6 text-slate-700">此場次目前為「{{ bookingStateLabel(selectedSession) }}」，可先查看資訊，待開放後再預約。</div>
        <div v-else-if="!user" class="surface-muted text-sm leading-6 text-slate-700"><p>登入後才能使用課程票券預約。</p><button type="button" class="btn btn-primary mt-3 text-white" @click="requireLogin">登入並繼續</button></div>
        <form v-else class="space-y-4" @submit.prevent="submitBooking">
          <p v-if="eligibilityLoading" class="surface-muted text-sm text-slate-600">伺服器正在解析場次、情境與票券時間窗…</p>
          <p v-else-if="eligibilityError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ eligibilityError }}</p>
          <label class="block space-y-2 text-sm font-medium text-slate-700">使用票券<select v-model.number="bookingForm.ticketId" required class="w-full"><option :value="null" disabled>請選擇可用票券</option><option v-for="ticket in applicableTickets" :key="ticket.id" :value="ticket.id">{{ ticket.productName }}｜可用 {{ ticketBalanceLabel(ticket, 'available') }}（保留 {{ ticketBalanceLabel(ticket, 'held') }}）｜{{ ticket.code }}</option></select></label>
          <div v-if="!eligibilityLoading && !applicableTickets.length" class="surface-muted text-sm leading-6 text-slate-600">{{ sessionEligibility.reason || '目前沒有符合情境、時間窗及額度規則的票券。' }}</div>
          <ul v-if="eligibilityTickets.length" class="space-y-2 text-sm" aria-label="票券適用性說明"><li v-for="ticket in eligibilityTickets" :key="`reason-${ticket.id}`" class="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"><span class="min-w-0"><strong class="block truncate text-slate-900">{{ ticket.productName }}・{{ ticket.code }}</strong><span class="text-slate-600">{{ ticket.reason }}</span><span class="mt-1 block text-xs text-slate-500">剩餘 {{ ticketBalanceLabel(ticket, 'remaining') }}・保留 {{ ticketBalanceLabel(ticket, 'held') }}・可用 {{ ticketBalanceLabel(ticket, 'available') }}</span></span><span class="ops-chip shrink-0" :class="ticket.eligibleForBooking ? 'ops-chip-success' : 'ops-chip-warning'">{{ ticket.eligibleForBooking ? '可預約' : '不適用' }}</span></li></ul>
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-4"><div class="mb-3 flex items-center justify-between gap-3"><h3 class="font-medium text-slate-900">本次預約會員資料</h3><router-link to="/account?tab=profile" class="text-sm font-medium text-primary">前往帳戶修改</router-link></div><dl class="grid gap-3 text-sm sm:grid-cols-2"><div><dt class="text-slate-500">出席者姓名</dt><dd class="mt-1 text-slate-900">{{ bookingForm.attendeeName || '尚未填寫' }}</dd></div><div><dt class="text-slate-500">Email</dt><dd class="mt-1 break-all text-slate-900">{{ bookingForm.attendeeEmail || '尚未填寫' }}</dd></div></dl></div>
          <p class="text-sm leading-6 text-slate-600">本次預約保留 {{ sessionEligibility.redeemQuantity || 1 }} 堂；SUCCESS 或 NO SHOW 才扣堂，無限次票不扣餘額，取消／請假會釋放保留。</p>
          <div class="sticky bottom-0 -mx-2 border-t border-slate-200 bg-white/95 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur"><button class="btn btn-primary min-h-[44px] w-full text-white" :disabled="submitting || !applicableTickets.length || !sessionCanBook(selectedSession)">{{ submitting ? '預約中…' : '確認預約' }}</button></div>
        </form>
      </div>
    </AppOverlayPanel>

    <LegalReviewDrawer ref="legalReviewRef" />
    <OrderUserDataReviewDrawer ref="userDataReviewRef" />
    </template>
  </section>
  </component>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { formatDateTimeRange } from '../utils/datetime'
import { normalizeHttpUrl } from '../utils/safeUrl'
import { showConfirm } from '../utils/sheet'
import {
  buildCourseMutationHeaders,
  buildCourseTicketMutationHeaders,
  COURSE_V2_ENDPOINTS,
  courseRowVersion,
  courseTaipeiTimestamp,
  formatCourseTaipeiDateTime,
  normalizeCourseEligibility,
  normalizeCourseOrderPreview,
  normalizeCourseProduct,
  normalizeCourseTicket,
} from '../utils/courseV2'
import AppIcon from '../components/AppIcon.vue'
import AppBottomSheet from '../components/AppBottomSheet.vue'
import AppOverlayPanel from '../components/AppOverlayPanel.vue'
import AppSearchInput from '../components/AppSearchInput.vue'
import AdminPagination from '../components/AdminPagination.vue'
import CourseCenterShell from '../components/CourseCenterShell.vue'
import LegalReviewDrawer from '../components/LegalReviewDrawer.vue'
import OrderUserDataReviewDrawer from '../components/OrderUserDataReviewDrawer.vue'
import {
  COURSE_CART_DRAFT_STORAGE_KEY,
  courseCartRequestItems,
  createCourseCartDraft,
  mergeCourseCartItems,
  normalizeCourseBatchPreview,
  normalizeCourseCartItems,
  parseCourseCartDraft,
} from '../utils/courseCart.js'
import {
  clampPurchaseQuantity,
  createOrderMutationKey,
  maxPurchaseQuantity,
  shouldRetainIdempotencyKey,
} from '../utils/orderParity.js'
import {
  COURSE_PRODUCTIZATION_ENDPOINTS,
  PUBLIC_COURSE_TASKS,
  courseCapacityLabel,
  courseCenterErrorMessage,
  courseTermPath,
  isCourseTermFull,
  normalizeCourseCenterPayload,
  resolveCoursePublicTask,
} from '../utils/courseProductization.js'

const props = defineProps({
  initialTask: { type: String, default: '' },
  embedded: { type: Boolean, default: false },
})

const API = API_BASE
const router = useRouter()
const route = useRoute()
const emit = defineEmits(['order-created', 'booking-created'])
const publicCourseTasks = PUBLIC_COURSE_TASKS
const publicTask = computed(() => resolveCoursePublicTask(props.initialTask || (route.path.split('/').filter(Boolean).at(-1) || 'passes')).key)
const standaloneTabbed = computed(() => !props.initialTask && !props.embedded)
const courseShellProps = computed(() => ({
  title: '課程中心',
  description: '選購計次方案、查看固定班，或使用課程票預約開放場次。',
  tasks: publicCourseTasks,
  activeKey: publicTask.value,
  navLabel: '課程服務',
}))
const courseFrameComponent = computed(() => props.initialTask && !props.embedded ? CourseCenterShell : 'div')
const courseFrameProps = computed(() => props.initialTask && !props.embedded ? courseShellProps.value : {})
const courseTabOptions = [{ key: 'products', label: '課程商城', icon: 'store' }, { key: 'sessions', label: '開放場次', icon: 'calendar' }]
const activeTab = ref('products')
const search = ref('')
const products = ref([])
const sessions = ref([])
const myTickets = ref([])
const loadingProducts = ref(true)
const loadingSessions = ref(true)
const productsError = ref('')
const sessionsError = ref('')
const purchaseOpen = ref(false)
const bookingOpen = ref(false)
const selectedProduct = ref(null)
const selectedSession = ref(null)
const submitting = ref(false)
const message = ref('')
const messageType = ref('success')
const dialogError = ref('')
const user = ref(readUser())
const failedCourseCovers = ref(new Set())
const legalReviewRef = ref(null)
const userDataReviewRef = ref(null)
const purchaseIdempotencyKey = ref('')
const bookingIdempotencyKey = ref('')
const purchaseForm = ref({ quantity: 1, termsAccepted: false })
const courseCartOpen = ref(false)
const courseCartItems = ref([])
const courseCartSyncState = ref('idle')
const courseCartSyncError = ref('')
const courseBatchPreview = ref(normalizeCourseBatchPreview())
const courseCheckoutError = ref('')
const courseCheckoutLoading = ref(false)
const courseBatchIdempotencyKey = ref('')
const bookingForm = ref({ ticketId: null, attendeeName: user.value?.username || '', attendeeEmail: user.value?.email || '' })
const purchasePreview = ref(null)
const previewLoading = ref(false)
const previewError = ref('')
const sessionEligibility = ref(normalizeCourseEligibility())
const eligibilityLoading = ref(false)
const eligibilityError = ref('')
const courseV2Enabled = ref(false)
const fixedClasses = ref([])
const fixedClassesLoading = ref(false)
const fixedClassesError = ref('')
const productMeta = reactive({ total: 0, limit: 10, offset: 0, hasMore: false })
const sessionMeta = reactive({ total: 0, limit: 10, offset: 0, hasMore: false })
const productSummary = ref({})
const sessionSummary = ref({})
const productFilters = reactive({ category: '', providerUserId: '', priceMin: '', priceMax: '', sort: 'sort_order' })
const sessionFilters = reactive({ providerUserId: '', startsFrom: '', startsTo: '', availability: '', sort: 'starts_asc' })
const mobileFiltersOpen = ref(false)
const mobileProductFilters = reactive({ ...productFilters })
const mobileSessionFilters = reactive({ ...sessionFilters })
let productRequestId = 0
let sessionRequestId = 0
let fixedClassesRequestId = 0
let previewRequestId = 0
let eligibilityRequestId = 0
let sessionGeneration = 0
let dialogRequestId = 0
let profileController = null
let ticketsController = null
let searchTimer = null
let courseCartSyncTimer = null
let applyingCourseCart = false
let skipCourseCartWatch = false
let courseCartLoadedForUser = ''

const orderTotal = computed(() => Number(
  purchasePreview.value?.totalAmount
  ?? (Number(selectedProduct.value?.price || 0) * Math.max(1, Number(purchaseForm.value.quantity || 1)))
))
const selectedProductPurchaseLimit = computed(() => maxPurchaseQuantity(selectedProduct.value || {}))
const courseCartCount = computed(() => courseCartItems.value.reduce((sum, item) => sum + Number(item.quantity || 0), 0))
const courseCartEstimatedTotal = computed(() => courseCartItems.value.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0))
const courseCartLocked = computed(() => courseCheckoutLoading.value || courseCartSyncState.value === 'syncing')
const courseCartSyncLabel = computed(() => {
  if (!user.value) return '訪客購物車已保留在這個分頁，登入後會合併至雲端。'
  if (courseCartSyncState.value === 'syncing') return '正在同步雲端課程購物車…'
  if (courseCartSyncState.value === 'error') return courseCartSyncError.value || '課程購物車同步失敗，本機內容仍保留。'
  return '課程購物車已同步雲端。'
})
const orderContact = computed(() => ({
  username: String(user.value?.username || '').trim(),
  email: String(user.value?.email || '').trim(),
  phone: String(user.value?.phone || '').trim(),
  remittanceLast5: String((user.value?.remittanceLast5 ?? user.value?.remittance_last5) || '').trim(),
}))
const contactComplete = computed(() => Boolean(orderContact.value.username && orderContact.value.email && String(orderContact.value.phone).replace(/\D/g, '').length >= 8 && /^\d{5}$/.test(orderContact.value.remittanceLast5)))
const hasProductFilters = computed(() => Boolean(productFilters.category || productFilters.providerUserId || productFilters.priceMin || productFilters.priceMax || productFilters.sort !== 'sort_order'))
const hasSessionFilters = computed(() => Boolean(sessionFilters.providerUserId || sessionFilters.startsFrom || sessionFilters.startsTo || sessionFilters.availability || sessionFilters.sort !== 'starts_asc'))
const activeFilterCount = computed(() => activeTab.value === 'products'
  ? [productFilters.category, productFilters.providerUserId, productFilters.priceMin, productFilters.priceMax, productFilters.sort !== 'sort_order'].filter(Boolean).length
  : [sessionFilters.providerUserId, sessionFilters.startsFrom, sessionFilters.startsTo, sessionFilters.availability, sessionFilters.sort !== 'starts_asc'].filter(Boolean).length)
const mobileFilterButtonLabel = computed(() => activeFilterCount.value ? `篩選（${activeFilterCount.value}）` : '篩選與排序')
const productCategories = computed(() => {
  const values = Array.isArray(productSummary.value?.categories) ? productSummary.value.categories : products.value.map(item => item.category)
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
})
const courseProviders = computed(() => {
  const summaryProviders = [...(Array.isArray(productSummary.value?.providers) ? productSummary.value.providers : []), ...(Array.isArray(sessionSummary.value?.providers) ? sessionSummary.value.providers : [])]
  const visibleProviders = [...products.value, ...sessions.value].map(item => ({ id: providerId(item), name: item.providerName || '' }))
  const providers = new Map()
  for (const value of [...summaryProviders, ...visibleProviders]) {
    const id = String(value?.id ?? value?.providerUserId ?? '').trim()
    if (!id) continue
    providers.set(id, { id, name: String(value?.name ?? value?.providerName ?? id).trim() || id })
  }
  return Array.from(providers.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
})
const eligibilityTickets = computed(() => sessionEligibility.value.tickets || [])
const applicableTickets = computed(() => eligibilityTickets.value.filter(ticket => ticket.eligibleForBooking))
const selectedProductUsesV2 = computed(() => Boolean(
  courseV2Enabled.value
  || selectedProduct.value?.courseV2Enabled
  || selectedProduct.value?.course_v2_enabled
  || selectedProduct.value?.ticketProductId
  || selectedProduct.value?.ticket_product_id
  || selectedProduct.value?.ticketProduct
  || selectedProduct.value?.requireAddonForNew
  || selectedProduct.value?.require_addon_for_new
  || selectedProduct.value?.requiredAddonProductIds?.length
  || selectedProduct.value?.required_addon_product_ids?.length
))

function readUser() { try { return JSON.parse(localStorage.getItem('user_info') || 'null') } catch { return null } }
function formatMoney(value) { return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0)) }
function formatRange(start, end) { return formatDateTimeRange(start, end, '－') || '時間待公告' }
function formatTaipei(value) { return formatCourseTaipeiDateTime(value) || '時間待公告' }
function providerId(source = {}) { const value = source || {}; return String(value.providerUserId || value.provider_user_id || value.ownerUserId || value.owner_user_id || '').trim() }
function ownerScope(source = {}) { if (source?.isPlatformCourse === true) return 'platform'; return providerId(source) || '' }
function providerLabel(source = {}) { const value = source || {}; return value.isPlatformCourse || !providerId(value) ? '平台課程' : (value.providerName || '服務商課程') }
function ticketBalanceLabel(ticket = {}, kind = 'available') {
  if (ticket.unlimited || ticket.usageMode === 'unlimited') return '不限'
  if (kind === 'held') return `${Number(ticket.heldUses || 0)} 堂`
  const value = kind === 'remaining' ? ticket.remainingUses : ticket.availableUses
  return `${Number(value || 0)} 堂`
}
function coursePaymentGroupLabel(group = {}) { return group.providerName || (group.providerUserId ? '服務商課程' : '平台課程') }
function courseRemittanceText(group = {}) {
  const remittance = group.remittance || {}
  return [remittance.info, remittance.bankName, remittance.bankCode, remittance.bankAccount, remittance.accountName]
    .map(value => String(value || '').trim()).filter(Boolean).join('｜')
}
function courseCoverKey(product) { return [product?.id || '', product?.updatedAt || '', product?.coverUrl || ''].join(':') }
function courseCover(product) {
  if (!product || failedCourseCovers.value.has(courseCoverKey(product))) return ''
  if (product.hasCover && product.id) return `${API}/courses/products/${encodeURIComponent(product.id)}/cover${product.updatedAt ? `?v=${encodeURIComponent(product.updatedAt)}` : ''}`
  return normalizeHttpUrl(product.coverUrl, '')
}
function hideBrokenImage(product) { const next = new Set(failedCourseCovers.value); next.add(courseCoverKey(product)); failedCourseCovers.value = next }
function showMessage(value, type = 'success') { message.value = value; messageType.value = type; if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }
function applyMeta(target, source = {}, fallbackLength = 0) { target.total = Math.max(0, Number(source.total ?? fallbackLength) || 0); target.limit = Math.max(1, Number(source.limit ?? 10) || 10); target.offset = Math.max(0, Number(source.offset ?? 0) || 0); target.hasMore = Boolean(source.hasMore) }
function unpackList(data, legacyKey) {
  const payload = data?.data
  if (Array.isArray(payload)) return { items: payload, meta: { total: payload.length, limit: Math.max(payload.length, 10), offset: 0, hasMore: false }, summary: {} }
  if (Array.isArray(payload?.items)) return { items: payload.items, meta: payload.meta || {}, summary: payload.summary || {} }
  const legacy = Array.isArray(payload?.[legacyKey]) ? payload[legacyKey] : []
  return { items: legacy, meta: { total: legacy.length, limit: Math.max(legacy.length, 10), offset: 0, hasMore: false }, summary: {} }
}
function createIdempotencyKey(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`.slice(0, 128)
}
function detectCourseV2(source = {}) {
  const payload = source?.data?.data || source?.data || source || {}
  const explicit = payload.courseV2Enabled
    ?? payload.course_v2_enabled
    ?? payload.features?.courseV2
    ?? payload.features?.course_v2
    ?? payload.capabilities?.courseV2
    ?? payload.capabilities?.course_v2
  if (explicit === true || explicit === 1 || explicit === '1') courseV2Enabled.value = true
}

function productPurchaseLimit(product = {}) { return maxPurchaseQuantity(product) }
function readCourseCartDraft() {
  try { return parseCourseCartDraft(sessionStorage.getItem(COURSE_CART_DRAFT_STORAGE_KEY)) } catch { return null }
}
function persistGuestCourseCart(items = courseCartItems.value, options = {}) {
  try {
    if (!items.length) {
      sessionStorage.removeItem(COURSE_CART_DRAFT_STORAGE_KEY)
      return
    }
    sessionStorage.setItem(COURSE_CART_DRAFT_STORAGE_KEY, JSON.stringify(createCourseCartDraft(items, options)))
  } catch {}
}
function clearGuestCourseCart() {
  try { sessionStorage.removeItem(COURSE_CART_DRAFT_STORAGE_KEY) } catch {}
}
function invalidateCourseBatchPreview({ resetKey = true } = {}) {
  courseBatchPreview.value = normalizeCourseBatchPreview()
  courseCheckoutError.value = ''
  if (resetKey) courseBatchIdempotencyKey.value = ''
}
async function hydrateCourseCartItems(rawItems = []) {
  const ids = Array.from(new Set((Array.isArray(rawItems) ? rawItems : []).map(item => String(item?.productId ?? item?.product_id ?? item?.id ?? '')).filter(Boolean)))
  const catalog = [...products.value]
  const knownIds = new Set(catalog.map(item => String(item.id)))
  const missingIds = ids.filter(id => !knownIds.has(id))
  if (missingIds.length) {
    const results = await Promise.allSettled(missingIds.map(id => axios.get(`${API}/courses/products/${encodeURIComponent(id)}`)))
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value?.data?.data) catalog.push(normalizeCourseProduct(result.value.data.data))
    }
  }
  return normalizeCourseCartItems(rawItems, catalog)
}
async function syncCourseCartNow() {
  if (courseCartSyncTimer) {
    clearTimeout(courseCartSyncTimer)
    courseCartSyncTimer = null
  }
  if (!user.value || applyingCourseCart) return
  courseCartSyncState.value = 'syncing'
  courseCartSyncError.value = ''
  try {
    const { data } = await axios.put(`${API}/courses/cart`, { items: courseCartRequestItems(courseCartItems.value) })
    if (data?.ok === false) throw new Error(data?.message || '課程購物車同步失敗')
    courseCartSyncState.value = 'synced'
  } catch (error) {
    courseCartSyncState.value = 'error'
    courseCartSyncError.value = error?.response?.data?.message || error?.message || '課程購物車同步失敗'
    if (Number(error?.response?.status || 0) === 401) user.value = null
  }
}
function scheduleCourseCartSync() {
  if (!user.value || applyingCourseCart) return
  if (courseCartSyncTimer) clearTimeout(courseCartSyncTimer)
  courseCartSyncTimer = setTimeout(syncCourseCartNow, 400)
}
async function loadCourseCart() {
  const currentUser = readUser()
  user.value = currentUser
  const guestDraft = readCourseCartDraft()
  if (!currentUser) {
    applyingCourseCart = true
    skipCourseCartWatch = true
    courseCartItems.value = await hydrateCourseCartItems(guestDraft?.items || [])
    applyingCourseCart = false
    courseCartSyncState.value = 'idle'
    return
  }
  const userKey = String(currentUser.id || currentUser.email || 'authenticated')
  courseCartSyncState.value = 'syncing'
  courseCartSyncError.value = ''
  try {
    const { data } = await axios.get(`${API}/courses/cart`)
    const payload = data?.data || data || {}
    const remote = await hydrateCourseCartItems(Array.isArray(payload.items) ? payload.items : [])
    const pendingMerge = await hydrateCourseCartItems(guestDraft?.pendingItems || [])
    const guest = await hydrateCourseCartItems(guestDraft?.items || [])
    const merged = pendingMerge.length ? pendingMerge : mergeCourseCartItems(remote, guest, products.value)
    applyingCourseCart = true
    skipCourseCartWatch = true
    courseCartItems.value = merged
    applyingCourseCart = false
    if (guest.length || pendingMerge.length) {
      persistGuestCourseCart(guestDraft?.items || guest, { pendingItems: merged })
      await axios.put(`${API}/courses/cart`, { items: courseCartRequestItems(merged) })
      clearGuestCourseCart()
    }
    courseCartLoadedForUser = userKey
    courseCartSyncState.value = 'synced'
  } catch (error) {
    applyingCourseCart = false
    courseCartSyncState.value = 'error'
    courseCartSyncError.value = error?.response?.data?.message || error?.message || '無法載入雲端課程購物車'
    if (guestDraft?.items?.length && !courseCartItems.value.length) {
      applyingCourseCart = true
      skipCourseCartWatch = true
      courseCartItems.value = await hydrateCourseCartItems(guestDraft.items)
      applyingCourseCart = false
    }
  }
}
function normalizeCourseCartQuantity(item) {
  item.quantity = clampPurchaseQuantity(item.quantity, item)
}
async function addSelectedProductToCourseCart() {
  const product = selectedProduct.value
  if (!product || product.externalPurchaseUrl || product._detailReady === false) return
  const quantity = clampPurchaseQuantity(purchaseForm.value.quantity, product)
  const nextItem = {
    ...product,
    productId: product.id,
    quantity,
    maxPurchaseQuantity: maxPurchaseQuantity(product),
    providerUserId: providerId(product),
    providerName: product.providerName || providerLabel(product),
    rowVersion: courseRowVersion(product),
  }
  applyingCourseCart = true
  skipCourseCartWatch = true
  courseCartItems.value = mergeCourseCartItems(courseCartItems.value, [nextItem], [...products.value, product])
  applyingCourseCart = false
  invalidateCourseBatchPreview()
  if (user.value) scheduleCourseCartSync()
  else persistGuestCourseCart()
  const productName = product.name
  await closeDialogs()
  courseCartOpen.value = true
  showMessage(`已將「${productName}」加入課程購物車。`)
}
function removeCourseCartItem(index) {
  if (courseCartLocked.value) return
  applyingCourseCart = true
  skipCourseCartWatch = true
  courseCartItems.value.splice(index, 1)
  applyingCourseCart = false
  invalidateCourseBatchPreview()
  if (user.value) scheduleCourseCartSync()
  else persistGuestCourseCart()
}
async function prepareCourseBatchCheckout() {
  if (!courseCartItems.value.length || courseCheckoutLoading.value || !requireLogin()) return
  courseCheckoutLoading.value = true
  courseCheckoutError.value = ''
  try {
    if (!(await refreshProfile()) || !contactComplete.value) {
      courseCheckoutError.value = '請先於帳戶中心補齊真實姓名、Email、手機號碼與匯款帳號後五碼。'
      return
    }
    await syncCourseCartNow()
    if (courseCartSyncState.value === 'error') throw new Error(courseCartSyncError.value)
    const { data } = await axios.post(`${API}/courses/orders/batch/preview`, {
      items: courseCartRequestItems(courseCartItems.value),
    })
    const preview = normalizeCourseBatchPreview(data)
    if (!preview.checkoutHash || !preview.orders.length) throw new Error('伺服器未回傳可確認的課程訂單預覽')
    courseBatchPreview.value = preview
    applyingCourseCart = true
    skipCourseCartWatch = true
    courseCartItems.value = normalizeCourseCartItems(preview.orders, [...products.value, ...preview.orders])
    applyingCourseCart = false
    courseBatchIdempotencyKey.value = ''
  } catch (error) {
    courseCheckoutError.value = error?.response?.data?.message || error?.message || '課程訂單預覽失敗'
  } finally { courseCheckoutLoading.value = false }
}
async function reviewCourseCartLegal() {
  const providerIds = Array.from(new Set(courseBatchPreview.value.orders.map(order => order.providerUserId).filter(Boolean)))
  return (await legalReviewRef.value?.open({
    title: '課程購物車購買規定',
    description: '請確認每個課程方案、服務商條款、取消與票券使用規則。',
    items: courseBatchPreview.value.orders.map(order => ({ name: order.productName, quantity: order.quantity, providerId: order.providerUserId, detail: `金額 NT$ ${formatMoney(order.totalAmount)}` })),
    providerIds,
    pageSlugs: ['terms', 'reservation-notice'],
    extraSections: [
      { key: 'course-atomic-fulfillment', title: '付款與發券', content: '行政確認款項時會在同一交易完成發券；若發券失敗，不會留下已付款狀態。' },
      ...courseBatchPreview.value.paymentGroups.map(group => ({
        key: `course-remittance-${group.key}`,
        title: `${coursePaymentGroupLabel(group)}匯款資訊`,
        content: courseRemittanceText(group) || '匯款資訊請洽詢服務商。',
      })),
    ],
  })) === true
}
async function reviewCourseCartUserData(contactConfirmation) {
  return (await userDataReviewRef.value?.open({
    title: '再次確認課程訂單資料',
    description: `本次將建立 ${courseBatchPreview.value.orderCount} 筆獨立課程訂單。`,
    summary: courseBatchPreview.value.orders.map(order => ({ key: `course-order-${order.productId}`, label: order.productName, value: `${order.quantity} 份`, detail: `${order.providerName || '平台課程'}｜預計 ${order.expectedTicketCount} 張票券｜NT$ ${formatMoney(order.totalAmount)}` })),
    fields: [
      { key: 'username', label: '真實姓名', value: contactConfirmation.username },
      { key: 'email', label: '電子信箱', value: contactConfirmation.email },
      { key: 'phone', label: '手機號碼', value: contactConfirmation.phone },
      { key: 'remittanceLast5', label: '匯款帳號後五碼', value: contactConfirmation.remittanceLast5 },
    ],
  })) === true
}
async function submitCourseBatchCheckout() {
  if (!courseBatchPreview.value.checkoutHash || courseCheckoutLoading.value || !requireLogin()) return
  courseCheckoutLoading.value = true
  courseCheckoutError.value = ''
  try {
    if (!(await refreshProfile()) || !contactComplete.value) throw new Error('會員聯絡資料不完整，請更新後重新預覽。')
    const contactConfirmation = { ...orderContact.value }
    if (!(await reviewCourseCartLegal())) return
    if (!(await reviewCourseCartUserData(contactConfirmation))) return
    if (!courseBatchIdempotencyKey.value) courseBatchIdempotencyKey.value = createOrderMutationKey('course-order-batch')
    const { data } = await axios.post(`${API}/courses/orders/batch`, {
      items: courseCartRequestItems(courseCartItems.value),
      checkoutHash: courseBatchPreview.value.checkoutHash,
      termsAccepted: true,
      contactConfirmation,
      userDataConfirmation: buildCourseUserDataConfirmation({ buyerName: contactConfirmation.username, buyerEmail: contactConfirmation.email, remittanceLast5: contactConfirmation.remittanceLast5 }, ['buyerName', 'buyerEmail', 'remittanceLast5']),
    }, { headers: { 'Idempotency-Key': courseBatchIdempotencyKey.value } })
    const payload = data?.data || data || {}
    const createdOrders = Array.isArray(payload.orders) ? payload.orders : []
    const createdCount = createdOrders.length || courseBatchPreview.value.orderCount || 1
    applyingCourseCart = true
    skipCourseCartWatch = true
    courseCartItems.value = []
    applyingCourseCart = false
    clearGuestCourseCart()
    invalidateCourseBatchPreview()
    courseCartSyncState.value = 'synced'
    courseCartOpen.value = false
    showMessage(`已建立 ${createdCount} 筆課程訂單，確認付款時會原子發券。`)
    emit('order-created', { ...(createdOrders[0] || {}), batchOrders: createdOrders })
  } catch (error) {
    if (!shouldRetainIdempotencyKey(error)) courseBatchIdempotencyKey.value = ''
    courseCheckoutError.value = error?.response?.data?.message || error?.message || '課程批次訂單建立失敗'
    if ([409, 428].includes(Number(error?.response?.status || 0))) {
      invalidateCourseBatchPreview({ resetKey: !shouldRetainIdempotencyKey(error) })
      await Promise.allSettled([loadProducts(productMeta.offset, { forceSummary: true }), loadCourseCart()])
      courseCheckoutError.value = '課程價格、數量上限或版本已更新，請重新檢查訂單預覽。'
    }
  } finally { courseCheckoutLoading.value = false }
}

async function loadProducts(offset = 0, options = {}) {
  const requestId = ++productRequestId
  loadingProducts.value = true
  productsError.value = ''
  try {
    const params = { paged: 1, limit: productMeta.limit || 10, offset: Math.max(0, Number(offset) || 0), q: search.value.trim(), includeSummary: options.forceSummary || !Object.keys(productSummary.value || {}).length ? 1 : 0, sort: productFilters.sort }
    if (productFilters.category) params.category = productFilters.category
    if (productFilters.providerUserId === 'platform') params.ownerType = 'platform'
    else if (productFilters.providerUserId) params.providerUserId = productFilters.providerUserId
    if (productFilters.priceMin !== '') params.priceMin = productFilters.priceMin
    if (productFilters.priceMax !== '') params.priceMax = productFilters.priceMax
    const { data } = await axios.get(`${API}/courses/products`, { params })
    if (requestId !== productRequestId) return
    detectCourseV2(data)
    const result = unpackList(data, 'products')
    products.value = result.items.map(item => {
      const product = normalizeCourseProduct(item)
      return {
        ...product,
        ticketProductName: item.ticketProductName || item.ticket_product_name || item.ticketProduct?.name || '',
      }
    })
    applyMeta(productMeta, result.meta, result.items.length)
    if (Object.keys(result.summary || {}).length) productSummary.value = result.summary
  } catch (error) {
    if (requestId !== productRequestId) return
    productsError.value = error?.response?.data?.message || '課程商品載入失敗'
  } finally { if (requestId === productRequestId) loadingProducts.value = false }
}

async function loadSessions(offset = 0, options = {}) {
  const requestId = ++sessionRequestId
  loadingSessions.value = true
  sessionsError.value = ''
  try {
    const params = { paged: 1, limit: sessionMeta.limit || 10, offset: Math.max(0, Number(offset) || 0), q: search.value.trim(), includeSummary: options.forceSummary || !Object.keys(sessionSummary.value || {}).length ? 1 : 0, sort: sessionFilters.sort }
    if (sessionFilters.providerUserId === 'platform') params.ownerType = 'platform'
    else if (sessionFilters.providerUserId) params.providerUserId = sessionFilters.providerUserId
    if (sessionFilters.startsFrom) params.startsFrom = sessionFilters.startsFrom
    if (sessionFilters.startsTo) params.startsTo = sessionFilters.startsTo
    if (sessionFilters.availability) params.availability = sessionFilters.availability
    const { data } = await axios.get(`${API}/courses/sessions`, { params })
    if (requestId !== sessionRequestId) return
    detectCourseV2(data)
    const result = unpackList(data, 'sessions')
    sessions.value = result.items
    applyMeta(sessionMeta, result.meta, result.items.length)
    if (Object.keys(result.summary || {}).length) sessionSummary.value = result.summary
  } catch (error) {
    if (requestId !== sessionRequestId) return
    sessionsError.value = error?.response?.data?.message || '課程場次載入失敗'
  } finally { if (requestId === sessionRequestId) loadingSessions.value = false }
}

async function loadFixedClasses() {
  const requestId = ++fixedClassesRequestId
  fixedClassesLoading.value = true
  fixedClassesError.value = ''
  try {
    const { data } = await axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.publicClasses}`, { params: { statuses: 'open,waitlist', includeSummary: 1 } })
    if (requestId !== fixedClassesRequestId) return
    fixedClasses.value = normalizeCourseCenterPayload(data, ['terms', 'classes'])
  } catch (error) {
    if (requestId !== fixedClassesRequestId) return
    fixedClasses.value = []
    fixedClassesError.value = courseCenterErrorMessage(error, '固定班載入失敗')
  } finally {
    if (requestId === fixedClassesRequestId) fixedClassesLoading.value = false
  }
}

async function loadMyTickets() {
  if (!user.value) { myTickets.value = []; return }
  const generation = sessionGeneration
  const expectedUserId = String(user.value?.id || '')
  ticketsController?.abort()
  const controller = new AbortController()
  ticketsController = controller
  const collected = []
  let offset = 0
  do {
    const { data } = await axios.get(`${API}/courses/me`, { params: { paged: 1, view: 'tickets', statuses: 'pending,active', limit: 100, offset }, signal: controller.signal })
    if (generation !== sessionGeneration || expectedUserId !== String(user.value?.id || '')) return
    const result = unpackList(data, 'tickets')
    collected.push(...result.items)
    if (!result.meta?.hasMore || !result.items.length) break
    offset += Math.max(1, Number(result.meta?.limit || result.items.length) || 100)
  } while (offset < 5000)
  if (generation === sessionGeneration && expectedUserId === String(user.value?.id || '')) {
    myTickets.value = collected.map(normalizeCourseTicket)
  }
}

async function loadPurchasePreview(options = {}) {
  const product = selectedProduct.value
  if (!product?.id || product.externalPurchaseUrl || !user.value) {
    purchasePreview.value = normalizeCourseOrderPreview({
      quantity: Math.max(1, Number(purchaseForm.value.quantity || 1)),
      returningStudentLabel: user.value ? '一般購買資格' : '登入後檢查購買資格',
    }, product || {})
    return purchasePreview.value
  }
  const requestId = ++previewRequestId
  previewLoading.value = true
  previewError.value = ''
  try {
    const { data } = await axios.get(`${API}${COURSE_V2_ENDPOINTS.productPreview(product.id)}`, {
      params: { quantity: Math.max(1, Number(purchaseForm.value.quantity || 1)) },
    })
    if (requestId !== previewRequestId || String(selectedProduct.value?.id) !== String(product.id)) return null
    courseV2Enabled.value = true
    purchasePreview.value = normalizeCourseOrderPreview(data?.data || data, product)
    return purchasePreview.value
  } catch (error) {
    if (requestId !== previewRequestId || String(selectedProduct.value?.id) !== String(product.id)) return null
    if (Number(error?.response?.status || 0) === 404 && options.allowLegacy !== false && !selectedProductUsesV2.value) {
      purchasePreview.value = normalizeCourseOrderPreview({
        quantity: Math.max(1, Number(purchaseForm.value.quantity || 1)),
        returningStudentLabel: '一般購買資格（相容模式）',
      }, product)
      return purchasePreview.value
    }
    previewError.value = Number(error?.response?.status || 0) === 404 && selectedProductUsesV2.value
      ? 'Course V2 已啟用，但訂單預覽 API 不可用；為避免繞過舊生與強制加購規則，本次無法下單。'
      : (error?.response?.data?.message || '無法檢查購買資格與加購明細')
    purchasePreview.value = null
    return null
  } finally {
    if (requestId === previewRequestId) previewLoading.value = false
  }
}

async function loadSessionEligibility(options = {}) {
  const session = selectedSession.value
  if (!session?.id || !user.value) {
    sessionEligibility.value = normalizeCourseEligibility()
    return sessionEligibility.value
  }
  const requestId = ++eligibilityRequestId
  eligibilityLoading.value = true
  eligibilityError.value = ''
  try {
    const { data } = await axios.get(`${API}${COURSE_V2_ENDPOINTS.sessionEligibility(session.id)}`)
    if (requestId !== eligibilityRequestId || String(selectedSession.value?.id) !== String(session.id)) return null
    courseV2Enabled.value = true
    sessionEligibility.value = normalizeCourseEligibility(data?.data || data)
    return sessionEligibility.value
  } catch (error) {
    if (requestId !== eligibilityRequestId || String(selectedSession.value?.id) !== String(session.id)) return null
    const embedded = selectedSession.value?.eligibility
    if (embedded) {
      sessionEligibility.value = normalizeCourseEligibility(embedded)
      return sessionEligibility.value
    }
    eligibilityError.value = Number(error?.response?.status || 0) === 404 && options.allowLegacy !== false
      ? '此環境尚未啟用伺服器票券資格解析，為避免使用錯誤票券，暫不開放預約。'
      : (error?.response?.data?.message || '場次票券資格載入失敗')
    sessionEligibility.value = normalizeCourseEligibility({
      reason: eligibilityError.value,
      tickets: myTickets.value.map(ticket => ({
        ...ticket,
        eligible: false,
        eligibleForBooking: false,
        redeemable: false,
        reason: '等待伺服器判定票券資格',
      })),
    })
    return sessionEligibility.value
  } finally {
    if (requestId === eligibilityRequestId) eligibilityLoading.value = false
  }
}

async function refreshProfile() {
  const storedUser = readUser()
  if (!storedUser) { user.value = null; return false }
  const generation = sessionGeneration
  const expectedUserId = String(storedUser?.id || '')
  profileController?.abort()
  const controller = new AbortController()
  profileController = controller
  try {
    const { data } = await axios.get(`${API}/me`, { signal: controller.signal })
    if (generation !== sessionGeneration || expectedUserId !== String(readUser()?.id || '')) return false
    user.value = data?.data || data || null
    return Boolean(user.value)
  } catch (error) {
    if (controller.signal.aborted) return false
    if (error?.response?.status === 401) user.value = null
    return false
  }
}

function requireLogin() {
  user.value = readUser()
  if (user.value) return true
  router.push({ path: '/login', query: { redirect: route.fullPath || '/store?tab=courses' } })
  return false
}

async function handleAuthChanged() {
  const previousIdentity = `${String(user.value?.id || '')}:${String(user.value?.role || '').toUpperCase()}`
  const nextUser = readUser()
  const nextIdentity = `${String(nextUser?.id || '')}:${String(nextUser?.role || '').toUpperCase()}`
  sessionGeneration += 1
  profileController?.abort()
  ticketsController?.abort()
  user.value = nextUser
  myTickets.value = []
  purchaseIdempotencyKey.value = ''
  bookingIdempotencyKey.value = ''
  bookingForm.value = { ticketId: null, attendeeName: '', attendeeEmail: '' }
  purchaseForm.value = { quantity: 1, termsAccepted: false }
  courseCartLoadedForUser = ''
  invalidateCourseBatchPreview()
  if (previousIdentity !== nextIdentity && (purchaseOpen.value || bookingOpen.value)) await closeDialogs()
  if (user.value) await refreshProfile()
  await loadCourseCart()
}
function handleStorage(event) { if (!event || event.key === 'user_info') handleAuthChanged() }

function updateDialogQuery(key, value) {
  const query = { ...route.query }
  delete query.courseProduct
  delete query.courseSession
  if (key && value) query[key] = value
  return router.replace({ query }).catch(() => {})
}

async function openPurchase(product, options = {}) {
  const requestId = ++dialogRequestId
  dialogError.value = ''
  selectedProduct.value = { ...normalizeCourseProduct(product), _detailReady: false }
  purchaseForm.value = { quantity: 1, termsAccepted: false }
  purchaseIdempotencyKey.value = ''
  purchasePreview.value = null
  previewError.value = ''
  purchaseOpen.value = true
  if (options.syncRoute !== false) updateDialogQuery('courseProduct', product.code || product.id)
  const [detailResult, sessionsResult] = await Promise.allSettled([
    axios.get(`${API}/courses/products/${encodeURIComponent(product.code || product.id)}`),
    axios.get(`${API}/courses/sessions`, { params: { paged: 1, productId: product.id, limit: 5, offset: 0, sort: 'starts_asc' } }),
  ])
  if (requestId !== dialogRequestId || !purchaseOpen.value) return
  const detail = detailResult.status === 'fulfilled' ? detailResult.value?.data?.data : null
  const recentSessions = sessionsResult.status === 'fulfilled' ? unpackList(sessionsResult.value?.data, 'sessions').items : []
  if (!detail) {
    dialogError.value = detailResult.reason?.response?.data?.message || '無法重新取得課程商品資料，請重試。'
    selectedProduct.value = { ...selectedProduct.value, recentSessions, _detailReady: false }
    loadProducts(productMeta.offset)
    return
  }
  detectCourseV2(detailResult.value?.data)
  selectedProduct.value = {
    ...normalizeCourseProduct({ ...product, ...detail }),
    ticketProductName: detail.ticketProductName || detail.ticket_product_name || detail.ticketProduct?.name || product.ticketProductName || '',
    recentSessions,
    _detailReady: true,
  }
  if (readUser()) await refreshProfile()
  await loadPurchasePreview()
}

async function openBooking(session, options = {}) {
  const requestId = ++dialogRequestId
  dialogError.value = ''
  selectedSession.value = { ...session, _detailReady: false }
  bookingIdempotencyKey.value = ''
  sessionEligibility.value = normalizeCourseEligibility()
  eligibilityError.value = ''
  bookingOpen.value = true
  if (options.syncRoute !== false) updateDialogQuery('courseSession', session.code || session.id)
  try {
    const { data } = await axios.get(`${API}/courses/sessions/${encodeURIComponent(session.code || session.id)}`)
    if (requestId !== dialogRequestId || !bookingOpen.value) return
    selectedSession.value = { ...session, ...(data?.data || {}), _detailReady: true }
  } catch (error) {
    if (requestId === dialogRequestId) {
      dialogError.value = error?.response?.data?.message || '無法重新取得場次資料'
      selectedSession.value = { ...selectedSession.value, _detailReady: false }
      loadSessions(sessionMeta.offset)
    }
    return
  }
  user.value = readUser()
  if (!user.value || !sessionCanBook(selectedSession.value)) return
  if (!(await refreshProfile())) { user.value = null; return }
  try { await loadMyTickets() } catch (error) { dialogError.value = error?.response?.data?.message || '票券載入失敗'; return }
  await loadSessionEligibility()
  const first = applicableTickets.value[0]
  const selectedTicketId = sessionEligibility.value.selectedTicketId
  const selectedTicket = applicableTickets.value.find(ticket => Number(ticket.id) === Number(selectedTicketId)) || first
  bookingForm.value = { ticketId: selectedTicket?.id || null, attendeeName: user.value?.username || '', attendeeEmail: user.value?.email || '' }
}

async function openBookingFromProduct(session) {
  purchaseOpen.value = false
  selectedProduct.value = null
  await openBooking(session)
}

async function refreshSelectedSession() {
  const current = selectedSession.value
  if (!current) return null
  const { data } = await axios.get(`${API}/courses/sessions/${encodeURIComponent(current.code || current.id)}`)
  const fresh = { ...current, ...(data?.data || {}) }
  selectedSession.value = fresh
  return fresh
}

async function closeDialogs() {
  dialogRequestId += 1
  purchaseOpen.value = false
  bookingOpen.value = false
  selectedProduct.value = null
  selectedSession.value = null
  purchasePreview.value = null
  sessionEligibility.value = normalizeCourseEligibility()
  dialogError.value = ''
  await updateDialogQuery('', '')
}

async function openExternalPurchase(product) {
  const url = normalizeHttpUrl(product?.externalPurchaseUrl, '')
  if (!url) { dialogError.value = '外部購買網址無效，請聯絡服務商。'; return }
  const accepted = await showConfirm(`即將前往「${providerLabel(product)}」的外部購買頁面。此操作不會在平台建立訂單，是否繼續？`, { title: '離開平台', confirmText: '前往外部頁面' })
  if (!accepted) return
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (opened) opened.opener = null
}

async function reviewPurchaseLegal() {
  const product = selectedProduct.value
  if (!product) return false
  const accepted = await legalReviewRef.value?.open({
    title: '課程購買規定',
    description: '請閱讀課程使用、取消、轉讓與現場核銷規定。',
    items: [{ name: product.name, quantity: Math.max(1, Number(purchaseForm.value.quantity || 1)), providerId: providerId(product), detail: `${product.classCount || 0} 堂｜開卡後 ${product.validDays || 0} 天` }],
    providerIds: providerId(product) ? [providerId(product)] : [],
    pageSlugs: ['terms', 'reservation-notice'],
    extraSections: [{ key: 'course-usage', title: '課程票券與核銷說明', content: '建立訂單後，由行政確認款項並依明細發行主票與加購票。單堂核銷情境的預約只保留 1 堂；SUCCESS 或 NO SHOW 才扣堂；多堂情境依 redeem quantity 保留，取消或請假會釋放保留額度。' }],
  })
  purchaseForm.value.termsAccepted = accepted === true
  return purchaseForm.value.termsAccepted
}

async function requestPurchaseUserDataReview(payload) {
  return (await userDataReviewRef.value?.open({
    title: '再次確認課程訂單資料',
    description: '以下是本次課程訂單實際會送出的會員聯絡與付款辨識資料。',
    summary: [{ key: 'course-order', label: selectedProduct.value?.name || '課程訂單', value: `${payload.quantity} 份`, detail: `合計 NT$ ${formatMoney(orderTotal.value)}｜${providerLabel(selectedProduct.value)}` }],
    fields: [
      { key: 'username', label: '真實姓名', value: payload.contactConfirmation.username },
      { key: 'email', label: '電子信箱', value: payload.contactConfirmation.email },
      { key: 'phone', label: '手機號碼', value: payload.contactConfirmation.phone },
      { key: 'remittanceLast5', label: '匯款帳號後五碼', value: payload.contactConfirmation.remittanceLast5 },
    ],
  })) === true
}

async function requestCourseBookingUserDataReview(payload) {
  const ticket = myTickets.value.find(item => Number(item.id) === Number(payload.ticketId))
  return (await userDataReviewRef.value?.open({
    title: '再次確認課程預約資料',
    description: '請核對本次預約的場次、票券與出席者資料。',
    summary: [{ key: 'course-booking', label: selectedSession.value?.title || '課程場次', value: '1 席', detail: [providerLabel(selectedSession.value), formatRange(selectedSession.value?.startsAt, selectedSession.value?.endsAt), ticket?.code ? `使用票券 ${ticket.code}` : ''].filter(Boolean).join('｜') }],
    fields: [{ key: 'attendeeName', label: '出席者姓名', value: payload.attendeeName }, { key: 'attendeeEmail', label: '出席者 Email', value: payload.attendeeEmail }],
  })) === true
}

function buildCourseUserDataConfirmation(payload, fields) { return fields.reduce((result, key) => ({ ...result, [key]: payload[key] }), { version: 1, confirmed: true }) }

async function submitPurchase() {
  if (!selectedProduct.value || selectedProduct.value._detailReady === false || submitting.value || !requireLogin()) return
  if (!(await refreshProfile())) {
    dialogError.value = '無法重新取得目前會員資料，請確認登入狀態後再試一次。'
    return
  }
  if (!contactComplete.value) { dialogError.value = '請先於帳戶中心補齊真實姓名、Email、手機號碼與匯款帳號後五碼。'; return }
  if (!purchasePreview.value && !(await loadPurchasePreview())) return
  if (!purchasePreview.value?.eligible) { dialogError.value = purchasePreview.value?.reason || '目前不符合此銷售方案資格。'; return }
  if (!purchaseForm.value.termsAccepted && !(await reviewPurchaseLegal())) return
  const contactConfirmation = { ...orderContact.value }
  const payload = {
    productId: selectedProduct.value.id,
    buyerName: contactConfirmation.username,
    buyerEmail: contactConfirmation.email,
    buyerPhone: contactConfirmation.phone,
    quantity: Math.max(1, Number(purchaseForm.value.quantity || 1)),
    expectedUnitPrice: Number(selectedProduct.value.price || 0),
    expectedTotalAmount: Number(purchasePreview.value.totalAmount || 0),
    previewVersion: purchasePreview.value.version || undefined,
    items: purchasePreview.value.items.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      kind: item.kind,
      required: item.required,
    })),
    expectedOwnerUserId: providerId(selectedProduct.value) || null,
    remittanceLast5: contactConfirmation.remittanceLast5,
    termsAccepted: true,
    contactConfirmation,
  }
  payload.userDataConfirmation = buildCourseUserDataConfirmation({ buyerName: payload.buyerName, buyerEmail: payload.buyerEmail, remittanceLast5: payload.remittanceLast5 }, ['buyerName', 'buyerEmail', 'remittanceLast5'])
  if (!(await requestPurchaseUserDataReview(payload))) return
  if (!purchaseIdempotencyKey.value) purchaseIdempotencyKey.value = createIdempotencyKey('course-order')
  payload.idempotencyKey = purchaseIdempotencyKey.value
  submitting.value = true
  try {
    const { data } = await axios.post(`${API}/courses/orders`, payload, {
      headers: buildCourseMutationHeaders(purchasePreview.value, {
        idempotencyKey: purchaseIdempotencyKey.value,
      }),
    })
    const order = data?.data || {}
    purchaseIdempotencyKey.value = ''
    await closeDialogs()
    showMessage(`訂單 ${order.code || ''} 已建立，行政確認款項後會發行課程票券。`)
    emit('order-created', order)
  } catch (error) {
    if (shouldResetIdempotencyKey(error)) purchaseIdempotencyKey.value = ''
    dialogError.value = error?.response?.data?.message || '課程訂單建立失敗'
    if (error?.response?.status === 409 && ['COURSE_PRODUCT_PRICE_CHANGED', 'COURSE_PRODUCT_OWNER_CHANGED', 'COURSE_PRODUCT_NOT_FOUND', 'COURSE_EXTERNAL_PURCHASE_REQUIRED'].includes(errorCode(error))) {
      const retainedQuantity = payload.quantity
      await openPurchase(selectedProduct.value, { syncRoute: false })
      purchaseForm.value = { quantity: retainedQuantity, termsAccepted: false }
      await loadPurchasePreview()
      dialogError.value = '課程價格、服務商或上架資訊已更新，請重新閱讀條款並確認訂單。'
    }
  } finally { submitting.value = false }
}

async function submitBooking() {
  if (!selectedSession.value || selectedSession.value._detailReady === false || !bookingForm.value.ticketId || submitting.value) return
  if (!(await refreshProfile())) { dialogError.value = '無法重新取得目前會員資料，請確認登入狀態後再試一次。'; return }
  bookingForm.value.attendeeName = String(user.value?.username || '').trim()
  bookingForm.value.attendeeEmail = String(user.value?.email || '').trim()
  if (!bookingForm.value.attendeeName || !bookingForm.value.attendeeEmail) { dialogError.value = '請先於帳戶中心補齊真實姓名與 Email。'; return }
  const eligibilityTicket = sessionEligibility.value.tickets.find(
    ticket => Number(ticket.id) === Number(bookingForm.value.ticketId)
  )
  const ticketRowVersion = courseRowVersion(eligibilityTicket || {})
  if (courseV2Enabled.value && !ticketRowVersion) {
    dialogError.value = '伺服器未回傳票券版本，無法安全保留堂數；請重新載入資格。'
    await loadSessionEligibility()
    return
  }
  const payload = {
    ticketId: Number(bookingForm.value.ticketId),
    attendeeName: bookingForm.value.attendeeName,
    attendeeEmail: bookingForm.value.attendeeEmail,
    ...(ticketRowVersion ? { expectedTicketRowVersion: ticketRowVersion } : {}),
  }
  if (!(await requestCourseBookingUserDataReview(payload))) return
  payload.userDataConfirmation = buildCourseUserDataConfirmation(payload, ['attendeeName', 'attendeeEmail'])
  if (!bookingIdempotencyKey.value) bookingIdempotencyKey.value = createIdempotencyKey('course-booking')
  payload.idempotencyKey = bookingIdempotencyKey.value
  submitting.value = true
  try {
    const headers = buildCourseTicketMutationHeaders(selectedSession.value, eligibilityTicket || {}, {
      idempotencyKey: bookingIdempotencyKey.value,
      ticketRowVersion,
    })
    const { data } = await axios.post(`${API}/courses/sessions/${selectedSession.value.id}/book`, payload, {
      headers,
    })
    const booking = data?.data || {}
    bookingIdempotencyKey.value = ''
    await closeDialogs()
    emit('booking-created', booking)
    await router.push({ path: '/wallet', query: { tab: 'reservations', category: 'course', booking: booking.id || undefined } })
  } catch (error) {
    if (shouldResetIdempotencyKey(error)) bookingIdempotencyKey.value = ''
    dialogError.value = error?.response?.data?.message || '課程場次預約失敗'
    if ([409, 428].includes(Number(error?.response?.status || 0))) {
      await Promise.allSettled([loadSessions(sessionMeta.offset), loadMyTickets(), refreshSelectedSession()])
      await loadSessionEligibility()
      const selectedStillApplies = applicableTickets.value.some(ticket => Number(ticket.id) === Number(bookingForm.value.ticketId))
      if (!selectedStillApplies) bookingForm.value.ticketId = applicableTickets.value[0]?.id || null
    }
  } finally { submitting.value = false }
}

function errorCode(error) { return String(error?.response?.data?.code || error?.response?.data?.error?.code || '').trim().toUpperCase() }
function shouldResetIdempotencyKey(error) {
  const status = Number(error?.response?.status || 0)
  if (!status || status >= 500 || status === 408 || status === 429) return false
  return errorCode(error) !== 'IDEMPOTENCY_IN_PROGRESS'
}
function isUnlimitedCapacity(session = {}) { return Number(session.capacity || 0) <= 0 }
function remainingCapacity(session = {}) { return isUnlimitedCapacity(session) ? null : Math.max(0, Number(session.remainingCapacity ?? (Number(session.capacity || 0) - Number(session.bookedCount || 0))) || 0) }
function capacityLabel(session = {}) { return isUnlimitedCapacity(session) ? '不限人數' : `剩餘 ${remainingCapacity(session)} / ${Number(session.capacity || 0)} 席` }
function bookingState(session = {}) {
  if (session.bookingState) return session.bookingState
  if (session.status === 'cancelled') return 'cancelled'
  if (!isUnlimitedCapacity(session) && remainingCapacity(session) <= 0) return 'full'
  if (session.status !== 'open') return 'closed'
  const now = Date.now()
  if (session.bookingOpenAt && courseTaipeiTimestamp(session.bookingOpenAt) > now) return 'not_open'
  if ((session.bookingCloseAt && courseTaipeiTimestamp(session.bookingCloseAt) < now) || (session.endsAt && courseTaipeiTimestamp(session.endsAt) < now)) return 'closed'
  return 'open'
}
function bookingStateLabel(session) { return ({ not_open: '尚未開放', open: '可預約', full: '名額已滿', closed: '已截止', cancelled: '已取消' })[bookingState(session)] || '目前不可預約' }
function bookingStateClass(session) { const state = bookingState(session); return state === 'open' ? 'ops-chip-success' : state === 'not_open' ? 'ops-chip-info' : 'ops-chip-warning' }
function sessionCanBook(session) { return session?._detailReady !== false && bookingState(session) === 'open' }

function ticketApplicability(ticket = {}, session = {}) {
  const candidate = sessionEligibility.value.tickets.find(item => Number(item.id) === Number(ticket.id))
  if (!candidate) return { applicable: false, reason: '伺服器未回傳此票券的場次資格' }
  return { applicable: candidate.eligibleForBooking, reason: candidate.reason }
}

function clearProductFilters() { Object.assign(productFilters, { category: '', providerUserId: '', priceMin: '', priceMax: '', sort: 'sort_order' }) }
function clearSessionFilters() { Object.assign(sessionFilters, { providerUserId: '', startsFrom: '', startsTo: '', availability: '', sort: 'starts_asc' }) }
function openMobileFilters() {
  Object.assign(mobileProductFilters, productFilters)
  Object.assign(mobileSessionFilters, sessionFilters)
  mobileFiltersOpen.value = true
}
function applyMobileFilters() {
  if (activeTab.value === 'products') Object.assign(productFilters, mobileProductFilters)
  else Object.assign(sessionFilters, mobileSessionFilters)
  mobileFiltersOpen.value = false
}
function clearMobileFilters() {
  if (activeTab.value === 'products') {
    Object.assign(mobileProductFilters, { category: '', providerUserId: '', priceMin: '', priceMax: '', sort: 'sort_order' })
  } else {
    Object.assign(mobileSessionFilters, { providerUserId: '', startsFrom: '', startsTo: '', availability: '', sort: 'starts_asc' })
  }
  applyMobileFilters()
}
function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { loadProducts(0); loadSessions(0) }, 300)
}

function updateCourseView(tab, options = {}) {
  if (props.initialTask) {
    const path = tab === 'sessions' ? '/courses/sessions' : '/courses/passes'
    if (route.path !== path) router.push({ path, query: { ...route.query, courseView: undefined } }).catch(() => {})
    return
  }
  if (String(route.query.courseView || '') === tab) return
  const navigation = options.replace ? router.replace({ query: { ...route.query, courseView: tab } }) : router.push({ query: { ...route.query, courseView: tab } })
  navigation.catch(() => {})
}
function setCourseTab(tab, options = {}) {
  const next = courseTabOptions.some(item => item.key === tab) ? tab : 'products'
  activeTab.value = next
  if (!options.skipRouteSync) updateCourseView(next)
  if (next === 'products' && !products.value.length && !loadingProducts.value) loadProducts(0, { forceSummary: true })
  if (next === 'sessions' && !sessions.value.length && !loadingSessions.value) loadSessions(0, { forceSummary: true })
}
function syncCourseViewFromRoute() {
  const canonicalTab = publicTask.value === 'sessions' ? 'sessions' : 'products'
  setCourseTab(props.initialTask ? canonicalTab : (route.query.courseView === 'sessions' ? 'sessions' : 'products'), { skipRouteSync: true })
}
function handleTabKeydown(event) {
  const tabs = courseTabOptions.map(item => item.key)
  let index = tabs.indexOf(activeTab.value)
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = (index - 1 + tabs.length) % tabs.length
  else if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = tabs.length - 1
  else return
  event.preventDefault(); setCourseTab(tabs[index]); nextTick(() => document.getElementById(`course-tab-${tabs[index]}`)?.focus())
}

async function syncDeepLink() {
  const productCode = String(route.query.courseProduct || '').trim()
  const sessionCode = String(route.query.courseSession || '').trim()
  if (productCode) {
    setCourseTab('products', { skipRouteSync: true })
    let product = products.value.find(item => String(item.code || item.id) === productCode)
    if (!product) {
      try { const { data } = await axios.get(`${API}/courses/products/${encodeURIComponent(productCode)}`); product = data?.data } catch (error) { showMessage(error?.response?.data?.message || '找不到課程商品', 'error'); return }
    }
    if (product && (!purchaseOpen.value || String(selectedProduct.value?.id) !== String(product.id))) await openPurchase(product, { syncRoute: false })
  } else if (sessionCode) {
    setCourseTab('sessions', { skipRouteSync: true })
    let session = sessions.value.find(item => String(item.code || item.id) === sessionCode)
    if (!session) {
      try { const { data } = await axios.get(`${API}/courses/sessions/${encodeURIComponent(sessionCode)}`); session = data?.data } catch (error) { showMessage(error?.response?.data?.message || '找不到課程場次', 'error'); return }
    }
    if (session && (!bookingOpen.value || String(selectedSession.value?.id) !== String(session.id))) await openBooking(session, { syncRoute: false })
  }
}

function bridgeAttendanceInviteDeepLink() {
  const token = String(
    route.query.attendanceInvite
    || route.query.attendanceInviteToken
    || route.query.attendance_invite_token
    || ''
  ).trim()
  if (!token) return false
  const version = String(route.query.version || route.query.rowVersion || '').trim()
  const query = {
    tab: 'reservations',
    category: 'course',
    action: 'attendance-invite',
    token,
    ...(version ? { version } : {}),
  }
  router.replace({ path: '/wallet', query }).catch(() => {})
  return true
}

watch(search, scheduleSearch)
watch(productFilters, () => loadProducts(0), { deep: true })
watch(sessionFilters, () => loadSessions(0), { deep: true })
watch(() => route.query.courseView, syncCourseViewFromRoute)
watch(publicTask, async (task) => {
  if (!props.initialTask) return
  if (task !== 'classes') { fixedClassesRequestId += 1; fixedClassesLoading.value = false }
  if (task !== 'sessions') { sessionRequestId += 1; loadingSessions.value = false }
  if (task !== 'passes') { productRequestId += 1; loadingProducts.value = false }
  syncCourseViewFromRoute()
  if (task === 'classes') await loadFixedClasses()
  else if (task === 'sessions') await loadSessions(0, { forceSummary: true })
  else {
    await loadProducts(0, { forceSummary: true })
    await loadCourseCart()
  }
})
watch(() => [route.query.courseProduct, route.query.courseSession], syncDeepLink)
watch(
  () => [route.query.attendanceInvite, route.query.attendanceInviteToken, route.query.attendance_invite_token, route.query.version],
  bridgeAttendanceInviteDeepLink
)
watch(() => purchaseForm.value.quantity, (value, previous) => {
  const normalized = clampPurchaseQuantity(value, selectedProduct.value || {})
  if (Number(value) !== normalized) {
    purchaseForm.value.quantity = normalized
    return
  }
  if (previous !== undefined && value !== previous) {
    purchaseForm.value.termsAccepted = false
    purchaseIdempotencyKey.value = ''
    loadPurchasePreview()
  }
})
watch(courseCartItems, () => {
  if (skipCourseCartWatch) { skipCourseCartWatch = false; return }
  if (applyingCourseCart) return
  for (const item of courseCartItems.value) normalizeCourseCartQuantity(item)
  invalidateCourseBatchPreview()
  if (user.value) scheduleCourseCartSync()
  else persistGuestCourseCart()
}, { deep: true })
watch(bookingForm, () => { bookingIdempotencyKey.value = '' }, { deep: true })

onMounted(async () => {
  if (bridgeAttendanceInviteDeepLink()) return
  window.addEventListener('auth-changed', handleAuthChanged)
  window.addEventListener('storage', handleStorage)
  if (publicTask.value === 'classes') {
    await loadFixedClasses()
    return
  }
  syncCourseViewFromRoute()
  if (props.initialTask) {
    if (publicTask.value === 'sessions') await loadSessions(0, { forceSummary: true })
    else {
      await loadProducts(0, { forceSummary: true })
      await loadCourseCart()
    }
  } else {
    await Promise.all([loadProducts(0, { forceSummary: true }), loadSessions(0, { forceSummary: true })])
    await loadCourseCart()
  }
  await syncDeepLink()
})
onBeforeUnmount(() => {
  productRequestId += 1
  sessionRequestId += 1
  fixedClassesRequestId += 1
  previewRequestId += 1
  eligibilityRequestId += 1
  sessionGeneration += 1
  dialogRequestId += 1
  profileController?.abort()
  ticketsController?.abort()
  if (searchTimer) clearTimeout(searchTimer)
  if (courseCartSyncTimer) clearTimeout(courseCartSyncTimer)
  window.removeEventListener('auth-changed', handleAuthChanged)
  window.removeEventListener('storage', handleStorage)
})
</script>
