<template>
    <main class="page-container" v-hammer="mainSwipeBinding">
        <div class="space-y-8">

            <!-- Header -->
            <header
                class="card mb-8 p-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 class="ui-title text-2xl font-medium text-slate-900">我的皮夾</h1>
                    <p class="text-slate-600 mt-1">管理您的票券、預約與課程</p>
                </div>
                <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                    <p v-if="activeTab === 'tickets' && ticketCategory === 'general'" class="text-sm font-medium text-slate-600 sm:text-right">
                        共 {{ totalTickets }} 張票券
                    </p>
                    <p v-else-if="activeTab === 'tickets'" class="text-sm font-medium text-slate-600 sm:text-right">課程計次票與剩餘堂數</p>
                    <p v-else-if="activeTab === 'reservations' && reservationCategory === 'course'" class="text-sm font-medium text-slate-600 sm:text-right">課程場次預約</p>
                    <p v-else-if="activeTab === 'reservations'" class="text-sm font-medium text-slate-600 sm:text-right">一般服務預約與交取車進度</p>
                    <p v-else class="text-sm font-medium text-slate-600 sm:text-right">票券與預約轉讓紀錄</p>
                    <!-- <button class="btn btn-outline text-sm" @click="openScan"><AppIcon name="camera" class="h-4 w-4" /> 掃描轉贈</button>-->
                </div>
            </header>

            <!-- Action Center -->
            <section v-if="!isCourseRecordCategory && actionCenterItems.length" class="mb-8">
                <div
                    class="card-quiet p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h2 class="ui-title text-base font-medium text-slate-800">快速提醒</h2>
                        <ul class="mt-2 space-y-1 text-sm text-slate-600">
                            <li v-for="(item, idx) in actionCenterItems" :key="`action-item-${idx}`"
                                class="flex items-center gap-2">
                                <AppIcon name="info" class="h-4 w-4 text-primary" />
                                <span>{{ item }}</span>
                            </li>
                        </ul>
                    </div>
                    <div class="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <!--<button v-if="nextActionReservation" class="btn btn-primary text-sm"
                            @click="goToNextReservationAction">
                            立即處理下一筆預約
                        </button>
                        -->
                        <button class="btn btn-outline text-sm"
                            @click="goToGeneralReservations">
                            檢視預約
                        </button>
                    </div>
                </div>
            </section>

            <!-- Tabs -->
            <div class="relative mb-6 sticky top-0 z-30 bg-white/90 backdrop-blur rounded-2xl border border-slate-300">
                <div class="flex justify-center relative">
                    <div class="tab-indicator" :style="indicatorStyle"></div>
                    <button v-for="(tab, index) in tabs" :key="tab.key" @click="setActiveTab(tab.key, index)" :class="[
                        'relative flex-1 px-3 py-3 sm:px-6 sm:py-4 font-medium transition-all duration-300 text-sm sm:text-lg whitespace-nowrap flex items-center gap-1 justify-center',
                        activeTab === tab.key
                            ? 'text-primary'
                            : 'text-slate-600 hover:text-primary'
                    ]">
                        <AppIcon :name="tab.icon" class="h-4 w-4" /> {{ tab.label }}
                    </button>
                </div>
            </div>

            <!-- 我的票券 -->
            <section v-if="activeTab === 'tickets'" class="slide-in">
                <div class="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p class="font-medium text-slate-900">票券分類</p>
                        <p class="mt-1 text-sm text-slate-600">一般服務票券與課程計次票分開顯示，保留各自的使用與轉讓流程。</p>
                    </div>
                    <RecordCategoryTabs
                        v-model="ticketCategoryModel"
                        :options="ticketCategoryOptions"
                        label="票券分類"
                    />
                </div>

                <div v-if="ticketCategory === 'general'">
                <!-- Stats Cards -->
                <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div @click="filterTickets('all')"
                        class="cursor-pointer border-y border-slate-300 bg-transparent p-4 sm:p-5 hover:border-primary transition">
                        <p class="text-sm text-slate-600 font-medium">總票卷數</p>
                        <p class="stat-number text-3xl text-slate-900">{{ totalTickets }}</p>
                    </div>
                    <div @click="filterTickets('available')"
                        class="cursor-pointer border-y border-slate-300 bg-transparent p-4 sm:p-5 hover:border-primary transition">
                        <p class="text-sm text-slate-600 font-medium">可用票卷</p>
                        <p class="stat-number text-3xl text-green-600">{{ availableTickets }}</p>
                    </div>
                    <div @click="filterTickets('used')"
                        class="cursor-pointer border-y border-slate-300 bg-transparent p-4 sm:p-5 hover:border-primary transition">
                        <p class="text-sm text-slate-600 font-medium">已使用</p>
                        <p class="stat-number text-3xl text-red-600">{{ usedTickets }}</p>
                    </div>
                    <div @click="filterTickets('expired')"
                        class="cursor-pointer border-y border-slate-300 bg-transparent p-4 sm:p-5 hover:border-primary transition">
                        <p class="text-sm text-slate-600 font-medium">已過期</p>
                        <p class="stat-number text-3xl text-slate-600">{{ expiredTickets }}</p>
                    </div>
                </div>

                <!-- Filter Buttons -->
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
                    <div class="flex flex-wrap gap-2">
                        <button @click="filterTickets('available')"
                            :class="filter === 'available' ? activeFilterClass : defaultFilterClass">可用</button>
                        <button @click="filterTickets('used')"
                            :class="filter === 'used' ? activeFilterClass : defaultFilterClass">已使用</button>
                        <button @click="filterTickets('expired')"
                            :class="filter === 'expired' ? activeFilterClass : defaultFilterClass">已過期</button>
                        <button @click="filterTickets('all')"
                            :class="filter === 'all' ? activeFilterClass : defaultFilterClass">全部</button>
                    </div>
                    <AppSearchInput
                        v-model="ticketSearch"
                        placeholder="搜尋票券（名稱或編號）"
                        container-class="relative w-full sm:w-64"
                        @clear="clearTicketSearch"
                    />
                </div>

                <!-- Coupon Cards -->
                <div v-if="loadingTickets" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div v-for="i in 6" :key="'tskel-' + i"
                        class="ticket-card p-0 skeleton"
                        style="height: 320px;"></div>
                </div>
                <div v-else>
                    <TransitionGroup v-if="filteredTickets.length" name="grid-stagger" tag="div"
                        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                        <div v-for="ticket in filteredTickets" :key="ticket.uuid" :class="ticketCardClass(ticket)"
                            :aria-disabled="ticket.expired && !canCopyTicketCode(ticket) ? 'true' : 'false'">
                            <div class="relative w-full overflow-hidden" style="aspect-ratio: 3/2;">
                                <img :src="ticketCoverUrl(ticket)" @error="(e) => e.target.src = '/logo.png'"
                                    alt="cover" class="absolute inset-0 w-full h-full object-cover" />
                                <div
                                    class="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-primary/10 pointer-events-none">
                                </div>
                            </div>
                            <div class="p-6">
                                <div class="flex items-start justify-between mb-4">
                                    <div>
                                        <h3 class="ui-title text-xl font-medium text-primary">{{ ticket.type }}</h3>
                                        <p class="text-sm text-slate-600">使用期限：{{ formatDate(ticket.expiry) }}</p>
                                    </div>
                                    <span :class="[
                                         'px-3 py-1 text-sm font-medium',
                                        ticket.used
                                            ? 'bg-green-100 text-green-700'
                                            : ticket.expired
                                                ? 'bg-slate-200 text-slate-700'
                                                : 'bg-red-100 text-red-700'
                                    ]">
                                        {{ ticket.used ? '已使用' : ticket.expired ? '已過期' : '未使用' }}
                                    </span>
                                </div>
                                <p class="text-sm text-slate-600 mb-1">票券編號</p>
                                <div class="flex items-center justify-between border-y border-slate-300 bg-transparent px-2 py-2 mb-3">
                                    <p class="text-sm font-mono text-slate-700 truncate mr-2" :title="ticket.uuid">{{
                                        ticket.uuid }}</p>
                                    <button class="btn-ghost" title="複製編號" :disabled="!canCopyTicketCode(ticket)" @click="copyText(ticket.uuid)">
                                        <AppIcon name="copy" class="h-4 w-4" />
                                    </button>
                                </div>
                                <button class="w-full py-3 font-medium text-white" :class="ticket.used || ticket.expired
                                    ? 'bg-slate-300 cursor-not-allowed'
                                    : 'btn btn-primary'" :disabled="ticket.used || ticket.expired" @click="goReserve()">
                                    {{ ticket.used ? '已使用' : ticket.expired ? '已過期' : '去預約使用' }}
                                </button>
                                <div v-if="!ticket.used && !ticket.expired" class="mt-2 grid grid-cols-2 gap-2">
                                    <button class="btn btn-outline text-sm" @click="startTransferEmail(ticket)">
                                        <AppIcon name="orders" class="h-4 w-4" /> 用電子信箱轉贈
                                    </button>
                                    <button class="btn btn-outline text-sm" @click="startTransferQR(ticket)">
                                        <AppIcon name="camera" class="h-4 w-4" /> 用掃描碼轉贈
                                    </button>
                                </div>
                            </div>
                        </div>
                    </TransitionGroup>
                    <div v-else
                        class="ticket-card p-6 text-sm text-slate-600">
                        {{ ticketSearch ? '沒有符合搜尋條件的票券。' : '目前沒有票券可以顯示。' }}
                    </div>
                </div>
                </div>
                <CourseAccountPanel v-else mode="tickets" />
            </section>

            <!-- 行動 FAB：掃描轉贈（僅手機顯示） v-if="isMobile" -->
            <div v-if="!isCourseRecordCategory" class="fixed bottom-4 right-4 z-40">
                <button class="btn btn-primary px-4 py-3" @click="openScan">
                    <AppIcon name="camera" class="h-5 w-5" /> 接收票卷
                </button>
            </div>

            <!-- 我的預約 -->
            <section v-if="activeTab === 'reservations'" class="slide-in" ref="reservationsSectionRef">
                <div class="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p class="font-medium text-slate-900">預約分類</p>
                        <p class="mt-1 text-sm text-slate-600">一般服務預約與課程場次預約分開管理，不混用狀態與核銷流程。</p>
                    </div>
                    <RecordCategoryTabs
                        v-model="reservationCategoryModel"
                        :options="reservationCategoryOptions"
                        label="預約分類"
                    />
                </div>

                <div v-if="reservationCategory === 'general'">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
                    <div class="flex flex-wrap gap-3">
                        <button @click="filterReservations('all')"
                            :class="resFilter === 'all' ? activeFilterClass : defaultFilterClass">全部</button>
                        <button v-for="opt in reservationStatusList" :key="opt.key" @click="filterReservations(opt.key)"
                            :class="resFilter === opt.key ? activeFilterClass : defaultFilterClass">{{ opt.shortLabel
                            }}</button>
                    </div>
                    <AppSearchInput
                        v-model="reservationSearch"
                        placeholder="搜尋預約（交車點資訊或服務檔期）"
                        container-class="relative w-full sm:w-64"
                        @clear="clearReservationSearch"
                    />
                    <!--<span class="text-sm text-slate-600">一次顯示最多 10 筆預約紀錄</span>-->
                </div>

                <!-- Reservation Cards -->
                <div v-if="loadingReservations" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div v-for="i in 6" :key="'rskel-' + i"
                        class="ticket-card p-6 animate-pulse"
                        style="height: 220px;"></div>
                </div>
                <div v-else-if="!filteredReservations.length"
                    class="ticket-card p-6 text-sm text-slate-600">
                    <p v-if="reservationSearch">沒有找到符合搜尋條件的預約。</p>
                    <p v-else-if="resFilter !== 'all'">目前沒有 {{ statusLabelMap[resFilter] || '' }} 預約。</p>
                    <p v-else>目前沒有符合條件的預約紀錄。</p>
                </div>
                <template v-else>
                    <TransitionGroup name="grid-stagger" tag="div"
                        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                        <div v-for="(res, index) in displayedReservations" :key="`${res.id || res.event}-${index}`"
                            :class="[
                                'ticket-card p-6 cursor-pointer',
                                res.status === 'done' ? 'opacity-60' : ''
                            ]" @click="openReservationModal(res)">
                            <div class="flex items-start justify-between mb-4">
                                <div>
                                    <h3 class="ui-title text-xl font-medium text-primary">{{ res.event }}</h3>
                                    <p class="text-sm text-slate-600">交車點資訊：{{ res.store }}</p>
                                    <p class="text-sm text-slate-600">預約時間：{{ formatDate(res.reservedAt) }}</p>
                                </div>
                                <span :class="[
                                    'badge',
                                    statusColorMap[res.status]
                                ]">
                                    {{ statusLabelMap[res.status] }}
                                </span>
                            </div>
                            <button class="w-full py-3 font-medium text-white" :class="res.status === 'done'
                                ? 'bg-slate-300 cursor-not-allowed'
                                : 'btn btn-primary'" :disabled="res.status === 'done'"
                                @click.stop="openReservationModal(res)">
                                {{ reservationActionLabel(res.status) }}
                            </button>
                            <div v-if="canTransferReservation(res)" class="mt-2 grid grid-cols-2 gap-2">
                                <button class="btn btn-outline text-sm" @click.stop="startReservationTransferEmail(res)">
                                    <AppIcon name="orders" class="h-4 w-4" /> 用電子信箱轉讓
                                </button>
                                <button class="btn btn-outline text-sm" @click.stop="startReservationTransferQR(res)">
                                    <AppIcon name="camera" class="h-4 w-4" /> 用掃描碼轉讓
                                </button>
                            </div>
                        </div>
                    </TransitionGroup>

                    <div v-if="shouldPaginateReservations"
                        class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-6">
                        <div class="flex items-center gap-2 flex-wrap">
                            <button class="btn btn-outline btn-sm" :disabled="activeReservationPage <= 1"
                                @click="goPrevReservationPage">
                                上一頁
                            </button>
                            <div class="flex items-center gap-1">
                                <button v-for="page in totalReservationPages" :key="`reservation-page-${page}`"
                                    class="px-3 py-1 text-sm border rounded transition"
                                    :class="page === activeReservationPage ? 'bg-primary text-white border-primary' : 'bg-white hover:border-primary hover:text-primary'"
                                    @click="goToReservationPage(page)">
                                    {{ page }}
                                </button>
                            </div>
                            <button class="btn btn-outline btn-sm"
                                :disabled="activeReservationPage >= totalReservationPages"
                                @click="goNextReservationPage">
                                下一頁
                            </button>
                        </div>
                    </div>
                </template>
                </div>
                <CourseAccountPanel v-else mode="bookings" />
            </section>

            <!-- 預約詳情 Bottom Sheet -->
            <AppBottomSheet v-model="showModal">
                <div class="max-h-[80vh] overflow-y-auto">
                    <div class="mx-auto h-1.5 w-10 bg-slate-300 mb-3 rounded-full"></div>
                    <h3 class="ui-title text-lg sm:text-xl font-medium text-primary mb-3">預約詳情</h3>

                    <div class="space-y-1 text-sm text-slate-800">
                        <p><strong>票券類型：</strong>{{ selectedReservation.ticketType }}</p>
                        <p><strong>{{ phaseLabel(selectedReservation.status) }}地點：</strong>{{ selectedReservation.store
                            }}</p>
                        <p><strong>服務檔期：</strong>{{ selectedReservation.event }}</p>
                        <p><strong>{{ phaseLabel(selectedReservation.status) }}時間：</strong>{{
                            formatDate(selectedReservation.reservedAt) }}</p>
                        <p class="mt-2"><strong>狀態：</strong>
                            <span :class="['px-2 py-1 text-sm', statusColorMap[selectedReservation.status]]">
                                {{ statusLabelMap[selectedReservation.status] }}
                            </span>
                        </p>
                    </div>

                    <div v-if="showPickupIdentification" class="mt-5 text-center space-y-3">
                        <p class="text-sm text-slate-700 font-medium">預約編號</p>
                        <div class="flex items-center justify-center gap-2 font-mono text-xl text-slate-900">
                            <span>{{ pickupIdentificationCode }}</span>
                            <button class="btn-ghost" title="複製預約編號" @click="copyText(pickupIdentificationCode)">
                                <AppIcon name="copy" class="h-4 w-4" />
                            </button>
                        </div>
                        <div class="flex justify-center">
                            <qrcode-vue :value="pickupIdentificationCode" :size="140" level="M" />
                        </div>
                        <p class="text-sm text-slate-600">請先掃描此碼，以定位貨主與貨物，再進行檢核。</p>
                    </div>

                    <template v-if="showReservationQr">
                        <div class="mt-5 text-center space-y-3">
                            <p class="text-sm text-slate-700 font-medium">{{ phaseLabel(selectedReservation.status) }}驗證碼</p>
                            <div
                                class="text-2xl font-medium text-primary tracking-widest flex items-center justify-center gap-2">
                                <span>{{ activeReservationVerifyCode }}</span>
                                <button class="btn-ghost" title="複製" @click="copyText(activeReservationVerifyCode)"
                                    :disabled="!activeReservationVerifyCode">
                                    <AppIcon name="copy" class="h-4 w-4" />
                                </button>
                            </div>
                            <div class="flex justify-center">
                                <qrcode-vue :value="activeReservationVerifyCode" :size="140" level="M" />
                            </div>
                        </div>
                    </template>
                    <template v-else-if="activeStageChecklistDefinition && activeStageChecklist">
                        <div class="mt-5 space-y-4">
                        <div class="bg-white border border-yellow-200 rounded-md p-4">
                            <div class="flex items-start gap-2 mb-3">
                                <AppIcon name="check" class="h-5 w-5 text-yellow-600" />
                                <div>
                                    <h4 class="font-medium text-yellow-700 text-base">{{
                                        activeStageChecklistDefinition.title }}</h4>
                                    <p v-if="activeStageChecklistDefinition.description"
                                        class="text-sm text-yellow-700 mt-1 leading-relaxed">
                                        {{ activeStageChecklistDefinition.description }}
                                    </p>
                                </div>
                            </div>
                            <div class="space-y-2">
                                <label v-for="(item, idx) in activeStageChecklist.items" :key="idx"
                                    class="flex items-start gap-2 text-sm text-slate-700 leading-snug">
                                    <input type="checkbox" v-model="item.checked" class="mt-1" />
                                    <span>{{ item.label }}</span>
                                </label>
                            </div>
                            <div class="mt-5">
                                <div class="flex items-center justify-between mb-2">
                                    <h5 class="text-sm font-medium text-slate-700">檢核照片</h5>
                                    <span class="text-sm text-slate-600">
                                        {{ activeStageChecklist.photos.length }} / {{ CHECKLIST_PHOTO_LIMIT }}
                                    </span>
                                </div>
                                <div class="relative">
                                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                        <div v-for="photo in activeStageChecklist.photos" :key="photo.id"
                                            class="relative overflow-hidden rounded-xl border border-slate-300 bg-slate-100">
                                            <img :src="checklistPhotoSrc(selectedReservation.value, selectedReservation.value?.status, photo)" alt="檢核照片" class="w-full h-32 object-cover" crossorigin="use-credentials" />
                                            <button type="button"
                                                class="absolute top-1 right-1 bg-black/70 text-white px-2 py-0.5 text-sm rounded-lg"
                                                @click="removeStageChecklistPhoto(photo.id)"
                                                :disabled="activeStageChecklist.uploading || activeStageChecklist.saving">
                                                刪除
                                            </button>
                                            <p class="text-sm text-slate-600 px-2 py-1 truncate">
                                                {{ formatChecklistUploadedAt(photo.uploadedAt) }}
                                            </p>
                                        </div>
                                        <label v-if="activeStageChecklist.photos.length < CHECKLIST_PHOTO_LIMIT"
                                            class="border border-dashed border-slate-300 text-slate-700 rounded-xl flex flex-col items-center justify-center h-32 cursor-pointer bg-slate-100 hover:border-primary hover:text-primary transition"
                                            :class="{ 'opacity-50 pointer-events-none': activeStageChecklist.uploading || activeStageChecklist.saving }">
                                            <input type="file" class="hidden" accept="image/*" capture="environment"
                                                @change="uploadActiveStageChecklistPhoto" />
                                            <AppIcon name="camera" class="h-6 w-6 mb-1" />
                                            <span class="text-sm font-medium">新增照片</span>
                                            <span class="text-sm text-slate-600 mt-1">支援常見圖片格式</span>
                                        </label>
                                    </div>
                                    <div v-if="activeStageChecklist.uploading" class="absolute inset-0 z-10 grid place-items-center bg-white/90 backdrop-blur-sm">
                                        <div class="flex flex-col items-center gap-2 text-center">
                                            <span class="h-8 w-8 rounded-full border-[3px] border-primary/30 border-t-primary animate-spin" aria-hidden="true"></span>
                                            <span class="text-sm font-medium text-primary">
                                                {{ activeStageChecklist.uploadMessage || '處理中…' }}
                                            </span>
                                            <div v-if="activeStageChecklist.uploadProgress > 0" class="flex w-full max-w-xs flex-col items-center gap-1">
                                                <div class="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                                    <div class="h-full bg-primary transition-all duration-200"
                                                        :style="{ width: `${Math.min(activeStageChecklist.uploadProgress, 100)}%` }">
                                                    </div>
                                                </div>
                                                <span class="text-sm text-slate-600">
                                                    {{ Math.min(activeStageChecklist.uploadProgress, 100) }}%
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <p class="text-sm text-slate-600 mt-2">至少上傳 1 張照片，檔案需小於 8MB。</p>
                            </div>
                            <button class="w-full mt-4 py-2 btn btn-primary text-white"
                                @click="completeActiveStageChecklist"
                                :disabled="!canSubmitStageChecklist || activeStageChecklist.uploading || activeStageChecklist.saving">
                                {{ activeStageChecklistDefinition.confirmText }}
                            </button>
                        </div>
                        <p class="text-sm text-slate-600 text-center">完成檢核後會立即顯示掃描碼，供店員掃描。</p>
                        </div>
                    </template>
                    <div v-else-if="reservationChecklistNotice" class="mt-5">
                        <div
                            class="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 text-sm leading-relaxed">
                            {{ reservationChecklistNotice }}
                        </div>
                    </div>
                </div>
            </AppBottomSheet>

            <!-- 紀錄 -->
            <section v-if="activeTab === 'logs'" class="slide-in">
                <div class="bg-white p-4 border border-slate-300 rounded-2xl">
                    <div class="flex items-center justify-between mb-3">
                        <h2 class="ui-title font-medium">票券與預約紀錄</h2>
                        <button class="btn btn-outline text-sm" @click="loadLogs({ reset: true })" :disabled="loadingLogs">
                            <AppIcon name="refresh" class="h-4 w-4" /> 重新整理
                        </button>
                    </div>
                    <div v-if="loadingLogs && !logs.length" class="text-slate-600">載入中…</div>
                    <div v-else>
                        <div v-if="!logs.length" class="text-slate-600">尚無紀錄</div>
                        <div v-else>
                            <div class="hidden sm:block overflow-x-auto">
                                <table class="min-w-[720px] w-full text-sm table-default">
                                    <thead>
                                        <tr class="bg-slate-50 text-left">
                                            <th class="px-3 py-2 border">時間</th>
                                            <th class="px-3 py-2 border">類型</th>
                                            <th class="px-3 py-2 border">行為</th>
                                            <th class="px-3 py-2 border">編號</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="row in logs" :key="logRowKey(row)" class="hover:bg-slate-50">
                                            <td class="px-3 py-2 border whitespace-nowrap">{{ fmtTime(row.created_at) }}
                                            </td>
                                            <td class="px-3 py-2 border whitespace-nowrap">
                                                <span class="inline-flex items-center rounded-full border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700">
                                                    {{ logRecordLabel(row) }}
                                                </span>
                                            </td>
                                            <td class="px-3 py-2 border">{{ logText(row) }}</td>
                                            <td class="px-3 py-2 border font-mono whitespace-nowrap">{{ logRecordId(row) }}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div class="sm:hidden flex flex-col gap-3">
                                <article v-for="row in logs" :key="logRowKey(row)" class="space-y-2 rounded-xl border border-slate-300 bg-white p-4">
                                    <header class="flex items-center justify-between gap-2 flex-wrap">
                                        <span class="text-sm font-medium text-slate-900">{{ fmtTime(row.created_at) }}</span>
                                        <span class="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
                                            <span class="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-700">{{ logRecordLabel(row) }}</span>
                                            <span>{{ logRecordId(row) }}</span>
                                        </span>
                                    </header>
                                    <p class="text-sm leading-relaxed text-slate-700">{{ logText(row) }}</p>
                                    <footer class="flex flex-wrap gap-2"
                                        v-if="row.meta?.method || row.meta?.event || row.meta?.store">
                                        <span v-if="row.meta?.method" class="text-sm font-medium text-slate-700 border-b border-slate-200 pb-0.5">
                                            {{ logMethodText(row) }}
                                        </span>
                                        <span v-if="row.meta?.event" class="text-sm font-medium text-slate-700 border-b border-slate-200 pb-0.5">
                                            活動：{{ row.meta.event }}
                                        </span>
                                        <span v-if="row.meta?.store" class="text-sm font-medium text-slate-700 border-b border-slate-200 pb-0.5">
                                            交車點資訊：{{ row.meta.store }}
                                        </span>
                                    </footer>
                                </article>
                            </div>
                            <div v-if="logsHasMore" class="mt-4 flex justify-center">
                                <button class="btn btn-outline text-sm" @click="loadMoreLogs" :disabled="loadingLogs">
                                    {{ loadingLogs ? '載入中…' : '載入更多' }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 轉贈掃描碼 Bottom Sheet（出示給對方掃） -->
            <AppBottomSheet v-model="qrSheet.open">
                <div class="text-center">
                    <h3 class="ui-title text-lg font-medium text-primary mb-2">{{ qrSheet.type === 'reservation' ? '出示掃描碼轉讓預約' : '出示掃描碼轉贈票券' }}</h3>
                    <div v-if="qrSheet.code" class="flex flex-col items-center gap-2">
                        <qrcode-vue :value="qrSheet.code" :size="180" level="M" />
                        <div class="flex items-center gap-2 text-lg font-mono tracking-widest text-primary">
                            <span>{{ qrSheet.code }}</span>
                            <button class="btn-ghost" title="複製轉贈碼" @click="copyText(qrSheet.code)">
                                <AppIcon name="copy" class="h-4 w-4" />
                            </button>
                        </div>
                        <p class="text-sm text-slate-600">請對方於錢包頁點擊「接收票卷」掃此掃描碼</p>
                    </div>
                    <div v-else class="text-slate-600">生成中…</div>
                </div>
            </AppBottomSheet>

            <!-- 接收方：待處理轉贈（全局底部抽屜，一張張顯示） -->
            <AppBottomSheet v-model="incoming.open" :closable="false" :close-on-backdrop="false">
                <h3 class="ui-title text-lg font-medium text-primary mb-2">{{ incoming.current?.transferType === 'reservation' ? '收到預約轉讓' : '收到票券轉贈' }}</h3>
                <div v-if="incoming.current" class="space-y-2 text-sm text-slate-800">
                    <p><strong>來自：</strong>{{ incoming.current.from_email || incoming.current.from_username }}</p>
                    <template v-if="incoming.current.transferType === 'reservation'">
                        <p><strong>服務檔期：</strong>{{ incoming.current.event }}</p>
                        <p><strong>交車點資訊：</strong>{{ incoming.current.store }}</p>
                        <p><strong>票券類型：</strong>{{ incoming.current.ticket_type }}</p>
                        <p><strong>預約時間：</strong>{{ formatDate(incoming.current.reserved_at) }}</p>
                    </template>
                    <template v-else>
                        <p><strong>票券：</strong>{{ incoming.current.type }}</p>
                        <p><strong>到期：</strong>{{ formatDate(incoming.current.expiry) }}</p>
                    </template>
                    <div class="mt-3 flex gap-2">
                        <button class="btn btn-primary" @click="acceptCurrentTransfer">接受</button>
                        <button class="btn btn-outline" @click="declineCurrentTransfer">不接受</button>
                    </div>
                </div>
                <div v-else class="text-slate-600">沒有待處理的轉贈</div>
            </AppBottomSheet>

            <!-- 掃描轉贈（接收方） -->
            <AppBottomSheet v-model="scan.open" @close="closeScan">
                <div class="flex flex-col gap-5">
                    <header class="flex flex-col gap-1 rounded-2xl border border-slate-300 bg-white p-4">
                        <h3 class="ui-title text-lg font-medium text-slate-900">掃描轉讓碼</h3>
                        <p class="text-sm text-slate-600">將掃描碼對準框線，完成後票券或預約會自動加入您的皮夾。</p>
                    </header>

                    <div class="grid gap-4 md:grid-cols-2">
                        <section class="space-y-2">
                            <div class="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 aspect-[16/10]">
                                <video ref="scanVideo" autoplay playsinline class="w-full h-full object-cover"></video>
                                <div class="absolute inset-[8%] rounded-2xl border-2 border-white/70 bg-white/5 pointer-events-none"></div>
                            </div>
                            <p class="mt-1 text-sm text-slate-600">若掃描未成功，可請對方重新顯示票券碼。</p>
                        </section>

                        <section class="flex flex-col gap-3 rounded-2xl border border-slate-300 bg-white p-4">
                            <h4 class="text-base font-medium text-slate-900">輸入轉贈碼</h4>
                            <div class="flex flex-wrap gap-3">
                                <input v-model.trim="scan.manual" placeholder="輸入轉讓碼"
                                       class="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-800 focus:border-primary focus:ring-2 focus:ring-primary/30" />
                                <button class="btn btn-primary" @click="claimByCode"
                                    :disabled="!scan.manual">認領</button>
                            </div>
                            <p class="text-sm text-slate-600">請確認與對方同步最新轉讓碼，以避免重複使用。</p>
                        </section>
                    </div>
                </div>
            </AppBottomSheet>

            <!-- 通用抽屜由 AppSheetHost 全局渲染，此處移除本地重複 Host -->

        </div>
    </main>
</template>

<script setup>
    import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
    import { API_BASE } from '../utils/api'
    import { useRouter, useRoute } from 'vue-router'
    import QrcodeVue from 'qrcode.vue'
    import axios from '../api/axios'
    import AppIcon from '../components/AppIcon.vue'
    import AppSearchInput from '../components/AppSearchInput.vue'
    import AppBottomSheet from '../components/AppBottomSheet.vue'
    import RecordCategoryTabs from '../components/RecordCategoryTabs.vue'
    import CourseAccountPanel from './course-account.vue'
    import { startQrScanner } from '../utils/qrScanner'
    import { showNotice, showConfirm, showPrompt } from '../utils/sheet'
    import { useSwipeRegistry } from '../composables/useSwipeRegistry'
    import { useIsMobile } from '../composables/useIsMobile'
    import { formatDateTime, toDate } from '../utils/datetime'
    import {
        buildUserRecordCategoryOptions,
        resolveUserRecordCategory,
        resolveWalletRecordLocation
    } from '../utils/userRecordCategories'
    import {
        CHECKLIST_STAGE_KEYS,
        RESERVATION_STATUS_COLOR_MAP,
        RESERVATION_STATUS_LABEL_MAP,
        RESERVATION_STATUS_LIST,
        DEFAULT_STAGE_CHECKLIST_DEFINITIONS,
        buildStageCodeMap,
        checklistFriendlyName,
        cloneStageChecklistDefinitions,
        detectStageChecklistStatus,
        ensureChecklistHasPhotos,
        getReservationStageCode,
        isPickupStage,
        isStageChecklistCompleted,
        normalizeStageChecklist,
        parseReservationDate,
        phaseLabel,
        reservationActionLabel,
        requiresChecklistBeforeQr,
        sortReservationsByLatest,
        toOptionalNumber,
        toStageCodeString
    } from '../utils/reservationStages'

    const API = API_BASE
    const router = useRouter()
    const route = useRoute()
    const readStoredUser = () => {
        try {
            return JSON.parse(localStorage.getItem('user_info') || 'null')
        } catch {
            return null
        }
    }
    const currentUser = ref(readStoredUser())
    const userRole = computed(() => String(currentUser.value?.role || 'USER').toUpperCase())
    const isGeneralUser = computed(() => !userRole.value || userRole.value === 'USER')
    const syncStoredUser = () => {
        currentUser.value = readStoredUser()
    }
    const handleAuthChanged = () => {
        syncStoredUser()
        syncIncomingPolling()
    }
    const handleStorage = (event) => {
        if (!event || event.key === 'user_info' || event.key === null) syncStoredUser()
    }
    const { registerSwipeHandlers, getBinding } = useSwipeRegistry()
    const mainSwipeBinding = getBinding('wallet-main')
    const { isMobile } = useIsMobile(768)
    const activeTab = ref('tickets')
    const activeTabIndex = ref(0)

    const ticketCategoryOptions = buildUserRecordCategoryOptions('tickets')
    const reservationCategoryOptions = buildUserRecordCategoryOptions('reservations')
    const ticketCategory = ref(resolveUserRecordCategory('tickets'))
    const reservationCategory = ref(resolveUserRecordCategory('reservations'))
    const isCourseRecordCategory = computed(() => (
        (activeTab.value === 'tickets' && ticketCategory.value === 'course')
        || (activeTab.value === 'reservations' && reservationCategory.value === 'course')
    ))

    const tabs = [
        { key: 'tickets', label: '我的票券', icon: 'ticket' },
        { key: 'reservations', label: '我的預約', icon: 'orders' },
        { key: 'logs', label: '紀錄', icon: 'copy' },
    ]
    const findTabIndex = (key) => tabs.findIndex(tab => tab.key === key)
    const reservationsTabIndex = computed(() => findTabIndex('reservations'))

    const categoryForTab = (key) => {
        if (key === 'tickets') return ticketCategory.value
        if (key === 'reservations') return reservationCategory.value
        return ''
    }
    const updateRouteLocation = (key, preferredCategory = categoryForTab(key)) => {
        const isCategoryTab = key === 'tickets' || key === 'reservations'
        const category = isCategoryTab
            ? resolveUserRecordCategory(key, preferredCategory)
            : ''
        const currentTab = typeof route.query.tab === 'string' ? route.query.tab : ''
        const currentCategory = typeof route.query.category === 'string' ? route.query.category : ''
        if (currentTab === key && currentCategory === category) return
        const query = { ...route.query, tab: key }
        if (category) query.category = category
        else delete query.category
        router.replace({ query }).catch(() => {})
    }
    const setTicketCategory = (value, options = {}) => {
        const next = resolveUserRecordCategory('tickets', value)
        ticketCategory.value = next
        if (!options.skipRouteSync && activeTab.value === 'tickets') updateRouteLocation('tickets', next)
    }
    const setReservationCategory = (value, options = {}) => {
        const next = resolveUserRecordCategory('reservations', value)
        reservationCategory.value = next
        if (!options.skipRouteSync && activeTab.value === 'reservations') updateRouteLocation('reservations', next)
    }
    const ticketCategoryModel = computed({
        get: () => ticketCategory.value,
        set: value => setTicketCategory(value),
    })
    const reservationCategoryModel = computed({
        get: () => reservationCategory.value,
        set: value => setReservationCategory(value),
    })
    const setActiveTab = (key, index, options = {}) => {
        const { skipRouteSync = false, force = false } = options
        const resolvedIndex = typeof index === 'number' && index >= 0 ? index : findTabIndex(key)
        if (resolvedIndex === -1) return
        if (!force && activeTab.value === key && activeTabIndex.value === resolvedIndex) {
            if (!skipRouteSync) updateRouteLocation(key)
            return
        }
        activeTab.value = key
        activeTabIndex.value = resolvedIndex
        if (key === 'logs') loadLogs({ reset: true })
        if (!skipRouteSync) updateRouteLocation(key)
    }
    const tabCount = computed(() => tabs.length)
    const indicatorStyle = computed(() => ({ left: `${activeTabIndex.value * (100 / tabCount.value)}%`, width: `${100 / tabCount.value}%` }))
    const syncWalletLocationFromRoute = () => {
        const rawTab = typeof route.query.tab === 'string' ? route.query.tab : ''
        const rawCategory = typeof route.query.category === 'string' ? route.query.category : ''
        if (!rawTab && !rawCategory) return

        const location = resolveWalletRecordLocation(rawTab, rawCategory)
        if (location.tab === 'tickets') setTicketCategory(location.category, { skipRouteSync: true })
        if (location.tab === 'reservations') setReservationCategory(location.category, { skipRouteSync: true })
        setActiveTab(location.tab, findTabIndex(location.tab), { skipRouteSync: true })

        const isCategoryTab = location.tab === 'tickets' || location.tab === 'reservations'
        const needsNormalization = location.migratedLegacyCourseTab
            || rawTab !== location.tab
            || (isCategoryTab && rawCategory !== location.category)
            || (!isCategoryTab && Boolean(rawCategory))
        if (needsNormalization) updateRouteLocation(location.tab, location.category)
    }
    watch(
        () => [route.query.tab, route.query.category],
        syncWalletLocationFromRoute
    )

    const activeFilterClass = 'px-4 py-2 rounded-lg bg-primary text-white font-medium'
    const defaultFilterClass = 'px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200'
    let incomingPollingTimer = null
    let incomingLoading = false

    // 票券資料
    const tickets = ref([])
    const loadingTickets = ref(true)
    const todayDate = () => {
        const now = new Date()
        return new Date(now.getFullYear(), now.getMonth(), now.getDate())
    }
    const parseDateOnly = (value) => {
        if (!value && value !== 0) return null
        const text = String(value).trim()
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
        if (match) {
            const dt = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
            return Number.isNaN(dt.getTime()) ? null : dt
        }
        const dt = toDate(value)
        if (!dt) return null
        return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
    }
    const parseDateTimeValue = (value) => toDate(value)
    const hasExpiredFlag = (value) => value === true || value === 1 || value === '1' || String(value).trim().toLowerCase() === 'true'
    const isTicketExpired = (ticket) => {
        if (!ticket) return false
        const expiryDate = parseDateOnly(ticket.expiry)
        const expiredByDate = expiryDate ? expiryDate <= todayDate() : false
        if (ticket.expired !== undefined) return hasExpiredFlag(ticket.expired) || expiredByDate
        return expiredByDate
    }
    const canCopyTicketCode = (ticket) => Boolean(ticket?.uuid) && (!ticket?.expired || !isGeneralUser.value)
    const ticketCardClass = (ticket) => [
        'ticket-card p-0',
        ticket?.expired
            ? [
                'grayscale contrast-75 saturate-0 bg-slate-100 border-slate-400 opacity-80',
                isGeneralUser.value ? 'select-none' : 'select-text',
                canCopyTicketCode(ticket) ? '' : 'cursor-not-allowed pointer-events-none',
            ].filter(Boolean).join(' ')
            : '',
        ticket?.used && !ticket?.expired ? 'opacity-60' : ''
    ]
    const totalTickets = computed(() => tickets.value.length)
    const availableTickets = computed(() => tickets.value.filter(t => !t.used && !t.expired).length)
    const usedTickets = computed(() => tickets.value.filter(t => t.used).length)
    const expiredTickets = computed(() => tickets.value.filter(t => t.expired && !t.used).length)

    const filter = ref('available')
    const ticketSearch = ref('')
    const filteredTickets = computed(() => {
        let list = tickets.value
        if (filter.value === 'available') {
            list = list.filter(t => !t.used && !t.expired)
        } else if (filter.value === 'used') {
            list = list.filter(t => t.used)
        } else if (filter.value === 'expired') {
            list = list.filter(t => t.expired && !t.used)
        }
        const keyword = ticketSearch.value.trim().toLowerCase()
        if (!keyword) return list
        return list.filter(ticket => {
            const candidates = [
                ticket.type,
                ticket.uuid,
                ticket.id,
                ticket.ticket_id,
                ticket.ticketId
            ]
            return candidates.some(field => String(field || '').toLowerCase().includes(keyword))
        })
    })
    const clearTicketSearch = () => { ticketSearch.value = '' }
    const filterTickets = (type) => { filter.value = type }
    const ticketCoverUrl = (t) => `${API}/tickets/cover/${encodeURIComponent(t.type || '')}`
    const goReserve = () => { router.push({ path: '/store', query: { tab: 'events' } }) }
    // 使用全局抽屜 API
    const promptEmail = async (msg, title = '轉贈票券') => {
        const v = await showPrompt(msg || '請輸入對方電子信箱', { title, placeholder: '對方電子信箱', inputType: 'email', confirmText: '送出' }).catch(() => null)
        return (v || '').trim();
    }
    const copyText = (t) => { try { if (t) navigator.clipboard?.writeText(String(t)) } catch { } }

    const normalizeTicket = (raw) => {
        if (!raw || typeof raw !== 'object') return raw
        const id = raw.id ?? raw.ticket_id ?? raw.ticketId
        const expired = isTicketExpired(raw)
        return { ...raw, id, expired }
    }

    const resolveTicketId = (ticket) => {
        const id = ticket?.id ?? ticket?.ticket_id ?? ticket?.ticketId
        const n = Number(id)
        return Number.isFinite(n) && n > 0 ? n : null
    }
    const ticketSortTimestamp = (ticket) => {
        const createdAt = parseDateTimeValue(ticket?.created_at || ticket?.createdAt)
        if (createdAt) return createdAt.getTime()
        const expiryDate = parseDateOnly(ticket?.expiry)
        if (expiryDate) return expiryDate.getTime()
        const id = resolveTicketId(ticket)
        return Number.isFinite(id) ? id : 0
    }
    const sortTicketsByLatest = (list = []) => [...list].sort((a, b) => ticketSortTimestamp(b) - ticketSortTimestamp(a))

    const loadTickets = async () => {
        try {
            const { data } = await axios.get(`${API}/tickets/me`)
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            tickets.value = sortTicketsByLatest(list.map(normalizeTicket))
        } catch (err) { await showNotice(err?.response?.data?.message || err.message, { title: '錯誤' }) }
        finally { loadingTickets.value = false }
    }

    // ===== 票券與預約紀錄 =====
    const ticketLogs = ref([])
    const reservationLogs = ref([])
    const loadingLogs = ref(false)
    const ticketLogsHasMore = ref(false)
    const reservationLogsHasMore = ref(false)
    const ticketLogsNextCursor = ref(null)
    const reservationLogsNextCursor = ref(null)
    const logsHasMore = computed(() => ticketLogsHasMore.value || reservationLogsHasMore.value)
    const logTimestamp = (row) => parseDateTimeValue(row?.created_at)?.getTime() || 0
    const logs = computed(() => [...ticketLogs.value, ...reservationLogs.value].sort((a, b) => {
        const timeDiff = logTimestamp(b) - logTimestamp(a)
        if (timeDiff) return timeDiff
        return Number(b?.id || 0) - Number(a?.id || 0)
    }))
    const logRowKey = (row) => `${row?.record_type === 'reservation' ? 'reservation' : 'ticket'}:${row?.id ?? ''}`
    const mergeLogsById = (current = [], incoming = [], recordType = 'ticket') => {
        const seen = new Set()
        return [...current, ...incoming].map((row) => ({
            ...row,
            record_type: row?.record_type || recordType,
        })).filter((row) => {
            const id = row?.id
            const key = id == null
                ? `${row?.record_type || recordType}:${row?.ticket_id || row?.reservation_id || ''}:${row?.action || ''}:${row?.created_at || ''}`
                : `${row?.record_type || recordType}:${id}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
    }
    const fetchLogPage = async ({ endpoint, cursor, reset }) => {
        const params = { paged: 1, limit: 50 }
        if (!reset && cursor) params.cursor = cursor
        let response = await axios.get(`${API}${endpoint}`, { params })
        let payload = response.data?.data ?? response.data
        if (reset && Array.isArray(payload) && payload.length === params.limit) {
            response = await axios.get(`${API}${endpoint}`, { params: { limit: 200 } })
            payload = response.data?.data ?? response.data
        }
        const isLegacyArray = Array.isArray(payload)
        return {
            items: isLegacyArray ? payload : (Array.isArray(payload?.items) ? payload.items : []),
            hasMore: isLegacyArray ? false : Boolean(payload?.meta?.hasMore),
            nextCursor: isLegacyArray ? null : (payload?.meta?.nextCursor ?? null),
        }
    }
    const loadLogs = async (options = {}) => {
        if (loadingLogs.value) return
        const reset = options?.reset === true
        loadingLogs.value = true
        try {
            const requests = []
            const sources = []
            if (reset || ticketLogsHasMore.value) {
                sources.push('ticket')
                requests.push(fetchLogPage({ endpoint: '/tickets/logs', cursor: ticketLogsNextCursor.value, reset }))
            }
            if (reset || reservationLogsHasMore.value) {
                sources.push('reservation')
                requests.push(fetchLogPage({ endpoint: '/reservations/logs', cursor: reservationLogsNextCursor.value, reset }))
            }
            const results = await Promise.allSettled(requests)
            results.forEach((result, index) => {
                const source = sources[index]
                if (result.status !== 'fulfilled') {
                    if (reset && source === 'reservation') {
                        reservationLogs.value = []
                        reservationLogsHasMore.value = false
                        reservationLogsNextCursor.value = null
                    }
                    return
                }
                const page = result.value
                if (source === 'reservation') {
                    reservationLogs.value = reset
                        ? mergeLogsById([], page.items, 'reservation')
                        : mergeLogsById(reservationLogs.value, page.items, 'reservation')
                    reservationLogsHasMore.value = page.hasMore
                    reservationLogsNextCursor.value = page.nextCursor
                } else {
                    ticketLogs.value = reset
                        ? mergeLogsById([], page.items, 'ticket')
                        : mergeLogsById(ticketLogs.value, page.items, 'ticket')
                    ticketLogsHasMore.value = page.hasMore
                    ticketLogsNextCursor.value = page.nextCursor
                }
            })
        } catch (e) { /* keep the last successfully loaded records */ }
        finally { loadingLogs.value = false }
    }
    const loadMoreLogs = () => {
        if (!logsHasMore.value || loadingLogs.value) return
        loadLogs()
    }
    const fmtTime = (t) => formatDateTime(t)
    const isReservationLog = (row) => row?.record_type === 'reservation'
    const logRecordLabel = (row) => isReservationLog(row) ? '預約' : '票券'
    const logRecordId = (row) => {
        const raw = isReservationLog(row) ? row?.reservation_id : row?.ticket_id
        const value = String(raw ?? '').trim()
        if (!value) return '-'
        if (isReservationLog(row)) return /^R/i.test(value) ? value : `R${value}`
        return value.startsWith('#') ? value : `#${value}`
    }
    const logMethodText = (row) => {
        const method = row?.meta?.method
        const action = isReservationLog(row) ? '轉讓' : '轉贈'
        if (method === 'qr') return `掃描碼即時${action}`
        if (method === 'email') return `電子信箱${action}`
        return method || ''
    }
    const logText = (row) => {
        const a = String(row.action || '')
        const m = row.meta || {}
        const type = m.ticket_type || m.type || ''
        if (isReservationLog(row)) {
            const subject = m.event || type || '預約'
            if (a === 'transferred_in') return `收到預約轉讓 - ${subject}${m.from_email ? `，來自：${m.from_email}` : ''}`
            if (a === 'transferred_out') return `已轉讓預約 - ${subject}${m.to_email ? `，給：${m.to_email}` : ''}`
            return `${a} - ${subject}`
        }
        if (a === 'issued') return `取得票券（購買） - ${type}`
        if (a === 'transferred_in') return `收到轉贈 - ${type}${m.from_email ? `，來自：${m.from_email}` : ''}`
        if (a === 'transferred_out') return `已轉贈 - ${type}${m.to_email ? `，給：${m.to_email}` : ''}`
        if (a === 'used') return `已使用 - ${type}`
        if (a.startsWith('expiry_notice_')) {
            const days = Number(m.days_before || String(a).match(/(\d+)d$/)?.[1] || 0)
            return `到期提醒（${days || 0} 天前） - ${type}`
        }
        return `${a} - ${type}`
    }

    // ===== 轉贈：發起（電子信箱 / 掃描碼） =====
    const qrSheet = ref({ open: false, code: '', type: 'ticket' })
    const startTransferEmail = async (ticket) => {
        const email = await promptEmail('請輸入對方電子信箱（轉贈）')
        if (!email) return
        const ticketId = resolveTicketId(ticket)
        if (!ticketId) return await showNotice('找不到票券編號，請重新整理後再試', { title: '錯誤' })
        try {
            const { data } = await axios.post(`${API}/tickets/transfers/initiate`, { ticketId, mode: 'email', email })
            if (data?.ok) { await showNotice('已發起轉贈，等待對方接受'); await loadTickets() }
            else await showNotice(data?.message || '發起失敗', { title: '發起失敗' })
        } catch (e) {
            const code = e?.response?.data?.code || ''
            const msg = e?.response?.data?.message || e.message
            if (code === 'TRANSFER_EXISTS') {
                if (await showConfirm('已有待處理的轉贈，是否取消並重新發起？', { title: '重新發起轉贈' })) {
                    try {
                        await axios.post(`${API}/tickets/transfers/cancel_pending`, { ticketId })
                        const { data } = await axios.post(`${API}/tickets/transfers/initiate`, { ticketId, mode: 'email', email })
                        if (data?.ok) { await showNotice('已發起轉贈，等待對方接受'); await loadTickets() }
                        else await showNotice(data?.message || '發起失敗', { title: '發起失敗' })
                    } catch (e2) { await showNotice(e2?.response?.data?.message || e2.message, { title: '錯誤' }) }
                }
            } else {
                await showNotice(msg, { title: '錯誤' })
            }
        }
    }
    const startTransferQR = async (ticket) => {
        qrSheet.value = { open: true, code: '', type: 'ticket' }
        const ticketId = resolveTicketId(ticket)
        if (!ticketId) {
            qrSheet.value.open = false
            return await showNotice('找不到票券編號，請重新整理後再試', { title: '錯誤' })
        }
        try {
            const { data } = await axios.post(`${API}/tickets/transfers/initiate`, { ticketId, mode: 'qr' })
            if (data?.ok) { qrSheet.value.code = data.data?.code || '' }
            else { qrSheet.value.open = false; await showNotice(data?.message || '產生失敗', { title: '產生失敗' }) }
        } catch (e) {
            qrSheet.value.open = false
            const code = e?.response?.data?.code || ''
            const msg = e?.response?.data?.message || e.message
            if (code === 'TRANSFER_EXISTS') {
                if (await showConfirm('已有待處理的轉贈，是否取消並重新產生掃描碼？', { title: '重新產生掃描碼' })) {
                    try {
                        await axios.post(`${API}/tickets/transfers/cancel_pending`, { ticketId })
                        qrSheet.value = { open: true, code: '', type: 'ticket' }
                        const { data } = await axios.post(`${API}/tickets/transfers/initiate`, { ticketId, mode: 'qr' })
                        if (data?.ok) { qrSheet.value.code = data.data?.code || '' }
                        else { qrSheet.value.open = false; await showNotice(data?.message || '產生失敗', { title: '產生失敗' }) }
                    } catch (e2) { qrSheet.value.open = false; await showNotice(e2?.response?.data?.message || e2.message, { title: '錯誤' }) }
                }
            } else {
                await showNotice(msg, { title: '錯誤' })
            }
        }
    }

    // 預約資料
    const reservations = ref([])
    const loadingReservations = ref(true)
    const reservationsSectionRef = ref(null)
    const RESERVATIONS_PAGE_SIZE = 10
    const activeReservationPage = ref(1)
    const reservationStatusList = RESERVATION_STATUS_LIST
    const statusLabelMap = RESERVATION_STATUS_LABEL_MAP
    const statusColorMap = RESERVATION_STATUS_COLOR_MAP

    const stageChecklistDefinitions = reactive(cloneStageChecklistDefinitions(DEFAULT_STAGE_CHECKLIST_DEFINITIONS))
    let checklistDefinitionsLoaded = false
    let checklistDefinitionsPending = null
    let checklistDefinitionsFingerprint = ''
    const CHECKLIST_PHOTO_LIMIT = 6
    const CHECKLIST_PHOTO_MAX_BYTES = 8 * 1024 * 1024
    const normalizeChecklist = (stage, raw = {}) => normalizeStageChecklist(stage, raw, { definitions: stageChecklistDefinitions })
    const stageChecklistState = reactive({})

    const resFilter = ref('all')
    const reservationSearch = ref('')
    const filteredReservations = computed(() => {
        let list = resFilter.value === 'all'
            ? reservations.value
            : reservations.value.filter(r => r.status === resFilter.value)
        const keyword = reservationSearch.value.trim().toLowerCase()
        if (!keyword) return list
        return list.filter(r => {
            const candidates = [
                r.event,
                r.store,
                r.ticketType,
                r.reservedAt,
                statusLabelMap[r.status]
            ]
            return candidates.some(field => String(field || '').toLowerCase().includes(keyword))
        })
    })
    const clearReservationSearch = () => { reservationSearch.value = '' }
    const filterReservations = (type) => { resFilter.value = type }
    const reservationPages = computed(() => {
        const list = filteredReservations.value || []
        if (!Array.isArray(list) || !list.length) return []
        const pages = []
        for (let i = 0; i < list.length; i += RESERVATIONS_PAGE_SIZE) {
            pages.push(list.slice(i, i + RESERVATIONS_PAGE_SIZE))
        }
        return pages
    })
    const totalReservationPages = computed(() => reservationPages.value.length || 0)
    const shouldPaginateReservations = computed(() => totalReservationPages.value > 1)
    watch(reservationPages, () => {
        if (totalReservationPages.value === 0) {
            activeReservationPage.value = 1
        } else if (activeReservationPage.value > totalReservationPages.value) {
            activeReservationPage.value = totalReservationPages.value
        } else if (activeReservationPage.value < 1) {
            activeReservationPage.value = 1
        }
    }, { immediate: true })
    watch(filteredReservations, () => {
        activeReservationPage.value = 1
    })
    const currentReservationPageIndex = computed(() => {
        if (!shouldPaginateReservations.value) return 0
        return Math.min(Math.max(activeReservationPage.value - 1, 0), totalReservationPages.value - 1)
    })
    const displayedReservations = computed(() => {
        if (!shouldPaginateReservations.value) return filteredReservations.value
        return reservationPages.value[currentReservationPageIndex.value] || []
    })
    const goToReservationPage = (page) => {
        if (!shouldPaginateReservations.value) return
        const target = Math.min(Math.max(1, Number(page) || 1), totalReservationPages.value)
        if (target === activeReservationPage.value) return
        activeReservationPage.value = target
        nextTick(() => {
            const el = reservationsSectionRef.value
            if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    }
    const goPrevReservationPage = () => {
        if (activeReservationPage.value > 1) goToReservationPage(activeReservationPage.value - 1)
    }
    const goNextReservationPage = () => {
        if (activeReservationPage.value < totalReservationPages.value) goToReservationPage(activeReservationPage.value + 1)
    }

    const toNewStatus = (s) => {
        // 未設定或舊值轉換，視為支付完成後的第一階段：賽前交車
        if (!s || s === 'pending' || s === 'service_booking') return 'pre_dropoff'
        if (s === 'pickup') return 'pre_pickup'
        return s
    }
    const actionableReservations = computed(() => reservations.value.filter(res => res.status && res.status !== 'done'))
    const pendingChecklistReservations = computed(() => actionableReservations.value.filter(res => requiresChecklistBeforeQr(res.status) && !isStageChecklistCompleted(res, res.status)))
    const pendingChecklistCount = computed(() => pendingChecklistReservations.value.length)
    const nextActionReservation = computed(() => {
        const sorted = actionableReservations.value
            .map(res => ({ res, date: parseReservationDate(res.reservedAt) }))
            .sort((a, b) => {
                const aTime = a.date ? a.date.getTime() : Number.MAX_SAFE_INTEGER
                const bTime = b.date ? b.date.getTime() : Number.MAX_SAFE_INTEGER
                return aTime - bTime
            })
        const now = Date.now()
        const upcoming = sorted.find(item => item.date && item.date.getTime() >= now)
        return (upcoming || sorted[0] || {}).res || null
    })
    const actionCenterItems = computed(() => {
        const items = []
        if (availableTickets.value > 0) {
            items.push(`有 ${availableTickets.value} 張票券尚未使用，別忘了預約。`)
        }
        if (expiredTickets.value > 0) {
            items.push(`有 ${expiredTickets.value} 張票券已過期，無法使用。`)
        }
        if (pendingChecklistCount.value > 0) {
            items.push(`有 ${pendingChecklistCount.value} 筆預約待完成檢核。`)
        }
        if (nextActionReservation.value) {
            const target = nextActionReservation.value
            const statusLabel = statusLabelMap[target.status] || phaseLabel(target.status)
            const timeLabel = formatDate(target.reservedAt)
            items.push(`下一筆預約：${target.event} · ${timeLabel}${statusLabel ? `（${statusLabel}）` : ''}`)
        }
        return items
    })

    const loadReservations = async (options = {}) => {
        const preservePage = !!options.preservePage
        const prevPage = activeReservationPage.value
        loadingReservations.value = true
        try {
            const { data } = await axios.get(`${API}/reservations/me`)
            const raw = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            const mapped = raw.map(r => {
                const status = toNewStatus(r.status)
                const stageCodes = buildStageCodeMap(r)
                const stageFromServer = r.stage_checklist && typeof r.stage_checklist === 'object' ? r.stage_checklist : {}
                const checklists = {}
                CHECKLIST_STAGE_KEYS.forEach(stage => {
                    const rawChecklist = r?.[`${stage}_checklist`] || r?.checklists?.[stage] || {}
                    checklists[stage] = normalizeChecklist(stage, rawChecklist)
                })
                const stageChecklist = {}
                CHECKLIST_STAGE_KEYS.forEach(stage => {
                    const serverInfo = stageFromServer[stage]
                    const baseChecklist = checklists[stage]
                    const normalizedPhotoCount = baseChecklist
                        ? (typeof baseChecklist.photoCount === 'number' ? baseChecklist.photoCount : baseChecklist.photos.length)
                        : 0
                    if (serverInfo) {
                        const serverPhotoCount = typeof serverInfo.photoCount === 'number' ? serverInfo.photoCount : normalizedPhotoCount
                        stageChecklist[stage] = {
                            found: serverInfo.found != null ? !!serverInfo.found : serverPhotoCount > 0,
                            completed: serverInfo.completed != null ? !!serverInfo.completed : !!baseChecklist?.completed,
                            photoCount: serverPhotoCount
                        }
                    } else {
                        const fallback = detectStageChecklistStatus(r, stage)
                        const hasPhotos = ensureChecklistHasPhotos(baseChecklist)
                        stageChecklist[stage] = {
                            found: fallback.found ? true : hasPhotos,
                            completed: fallback.completed ? true : !!baseChecklist?.completed,
                            photoCount: normalizedPhotoCount
                        }
                    }
                })
                const fallbackCodes = [
                    stageCodes.pre_dropoff,
                    stageCodes.pre_pickup,
                    stageCodes.post_dropoff,
                    stageCodes.post_pickup,
                    toStageCodeString(r.verify_code || r.verifyCode)
                ].filter(Boolean)
                return {
                    id: r.id ?? null,
                    ticketType: r.ticket_type,
                    store: r.store,
                    event: r.event,
                    storeId: toOptionalNumber(r.store_id ?? r.storeId),
                    eventId: toOptionalNumber(r.event_id ?? r.eventId),
                    reservedAt: r.reserved_at,
                    verifyCode: stageCodes[status] || fallbackCodes[0] || null,
                    status,
                    stageChecklist,
                    checklists,
                    stageCodes,
                    transferable: !!r.transferable,
                    transferBlockCode: r.transfer_block_code || r.transferBlockCode || null,
                    transferBlockMessage: r.transfer_block_message || r.transferBlockMessage || ''
                }
            })
            reservations.value = sortReservationsByLatest(mapped)
            if (!preservePage) {
                activeReservationPage.value = 1
            }
        } catch (err) {
            await showNotice(err?.response?.data?.message || err.message, { title: '錯誤' })
        } finally {
            loadingReservations.value = false
        }
        if (preservePage) {
            await nextTick()
            const total = totalReservationPages.value || 1
            activeReservationPage.value = Math.min(Math.max(prevPage, 1), total)
        }
        return reservations.value
    }

    const resolveReservationId = (reservation) => {
        const id = reservation?.id ?? reservation?.reservation_id ?? reservation?.reservationId
        const n = Number(id)
        return Number.isFinite(n) && n > 0 ? n : null
    }
    const canTransferReservation = (reservation) => !!reservation?.transferable
    const startReservationTransferEmail = async (reservation) => {
        const email = await promptEmail('請輸入對方電子信箱（轉讓預約）', '轉讓預約')
        if (!email) return
        const reservationId = resolveReservationId(reservation)
        if (!reservationId) return await showNotice('找不到預約編號，請重新整理後再試', { title: '錯誤' })
        try {
            const { data } = await axios.post(`${API}/reservations/transfers/initiate`, { reservationId, mode: 'email', email })
            if (data?.ok) {
                await showNotice('已發起預約轉讓，等待對方接受')
                await loadReservations({ preservePage: true })
            } else {
                await showNotice(data?.message || '發起失敗', { title: '發起失敗' })
            }
        } catch (e) {
            const code = e?.response?.data?.code || ''
            const msg = e?.response?.data?.message || e.message
            if (code === 'TRANSFER_EXISTS') {
                if (await showConfirm('已有待處理的預約轉讓，是否取消並重新發起？', { title: '重新發起預約轉讓' })) {
                    try {
                        await axios.post(`${API}/reservations/transfers/cancel_pending`, { reservationId })
                        const { data } = await axios.post(`${API}/reservations/transfers/initiate`, { reservationId, mode: 'email', email })
                        if (data?.ok) {
                            await showNotice('已發起預約轉讓，等待對方接受')
                            await loadReservations({ preservePage: true })
                        } else {
                            await showNotice(data?.message || '發起失敗', { title: '發起失敗' })
                        }
                    } catch (e2) {
                        await showNotice(e2?.response?.data?.message || e2.message, { title: '錯誤' })
                    }
                }
            } else {
                await showNotice(msg, { title: '錯誤' })
            }
        }
    }
    const startReservationTransferQR = async (reservation) => {
        qrSheet.value = { open: true, code: '', type: 'reservation' }
        const reservationId = resolveReservationId(reservation)
        if (!reservationId) {
            qrSheet.value.open = false
            return await showNotice('找不到預約編號，請重新整理後再試', { title: '錯誤' })
        }
        try {
            const { data } = await axios.post(`${API}/reservations/transfers/initiate`, { reservationId, mode: 'qr' })
            if (data?.ok) {
                qrSheet.value.code = data.data?.code || ''
            } else {
                qrSheet.value.open = false
                await showNotice(data?.message || '產生失敗', { title: '產生失敗' })
            }
        } catch (e) {
            qrSheet.value.open = false
            const code = e?.response?.data?.code || ''
            const msg = e?.response?.data?.message || e.message
            if (code === 'TRANSFER_EXISTS') {
                if (await showConfirm('已有待處理的預約轉讓，是否取消並重新產生掃描碼？', { title: '重新產生掃描碼' })) {
                    try {
                        await axios.post(`${API}/reservations/transfers/cancel_pending`, { reservationId })
                        qrSheet.value = { open: true, code: '', type: 'reservation' }
                        const { data } = await axios.post(`${API}/reservations/transfers/initiate`, { reservationId, mode: 'qr' })
                        if (data?.ok) {
                            qrSheet.value.code = data.data?.code || ''
                        } else {
                            qrSheet.value.open = false
                            await showNotice(data?.message || '產生失敗', { title: '產生失敗' })
                        }
                    } catch (e2) {
                        qrSheet.value.open = false
                        await showNotice(e2?.response?.data?.message || e2.message, { title: '錯誤' })
                    }
                }
            } else {
                await showNotice(msg, { title: '錯誤' })
            }
        }
    }

    // Modal
    const showModal = ref(false)
    const selectedReservation = ref({})
    const stageChecklistKey = (reservation) => {
        if (!reservation) return null
        const stage = reservation.status
        if (!stage) return null
        const rawId = reservation.id ?? `${reservation.event || ''}-${reservation.store || ''}`
        const fallbackId = getReservationStageCode(reservation, stage) || reservation.reservedAt || Date.now()
        const id = rawId && rawId !== '-' ? rawId : fallbackId
        return `${String(id)}-${stage}`
    }
    const prepareStageChecklist = (reservation) => {
        const stage = reservation?.status
        if (!requiresChecklistBeforeQr(stage)) return
        const def = stageChecklistDefinitions[stage] || null
        if (!def) return
        const key = stageChecklistKey(reservation)
        if (!key) return
        const backend = reservation?.checklists?.[stage] || normalizeChecklist(stage, {})
        const items = def.items.map(label => {
            const found = backend.items?.find(item => item && item.label === label)
            return { label, checked: !!found?.checked }
        })
        const photos = Array.isArray(backend.photos) ? backend.photos : []
        const photoCount = typeof backend.photoCount === 'number' ? backend.photoCount : photos.length
        const completed = !!backend.completed
        if (!stageChecklistState[key]) {
            stageChecklistState[key] = reactive({
                items,
                photos: [...photos],
                completed,
                photoCount,
                uploading: false,
                uploadMessage: '',
                uploadProgress: 0,
                saving: false
            })
        } else {
            const current = stageChecklistState[key]
            current.items.splice(0, current.items.length, ...items)
            current.photos.splice(0, current.photos.length, ...photos)
            current.completed = completed
            current.photoCount = photoCount
            if (!current.uploading) {
                current.uploadMessage = ''
                current.uploadProgress = 0
            }
        }
    }
    const applyStageChecklistDefinitions = (payload = {}) => {
        const mapped = cloneStageChecklistDefinitions(payload)
        const nextFingerprint = JSON.stringify(mapped)
        if (nextFingerprint === checklistDefinitionsFingerprint) {
            if (selectedReservation.value) prepareStageChecklist(selectedReservation.value)
            checklistDefinitionsLoaded = true
            return
        }
        checklistDefinitionsFingerprint = nextFingerprint
        CHECKLIST_STAGE_KEYS.forEach(stage => {
            const defaults = DEFAULT_STAGE_CHECKLIST_DEFINITIONS[stage] || {}
            const entry = mapped[stage] || defaults
            const target = stageChecklistDefinitions[stage]
            target.title = entry.title || defaults.title || ''
            target.description = entry.description || defaults.description || ''
            target.confirmText = entry.confirmText || defaults.confirmText || ''
            target.items = [...(entry.items && entry.items.length ? entry.items : (defaults.items || []))]
        })
        if (reservations.value.length) {
                const updated = reservations.value.map(reservation => {
                    const next = {
                        ...reservation,
                        checklists: { ...(reservation.checklists || {}) },
                        stageChecklist: { ...(reservation.stageChecklist || {}) }
                    }
                    CHECKLIST_STAGE_KEYS.forEach(stage => {
                        const sourceChecklist = reservation.checklists?.[stage] || {}
                        const normalized = normalizeChecklist(stage, sourceChecklist)
                        next.checklists[stage] = normalized
                        const currentStageInfo = next.stageChecklist[stage] || {}
                    const normalizedPhotoCount = typeof normalized.photoCount === 'number'
                        ? normalized.photoCount
                        : (Array.isArray(normalized.photos) ? normalized.photos.length : 0)
                    next.stageChecklist[stage] = {
                        found: currentStageInfo.found != null ? !!currentStageInfo.found : ensureChecklistHasPhotos(normalized),
                        completed: currentStageInfo.completed != null ? !!currentStageInfo.completed : !!normalized.completed,
                        photoCount: currentStageInfo.photoCount != null ? currentStageInfo.photoCount : normalizedPhotoCount
                    }
                })
                return next
            })
            reservations.value = updated
            if (selectedReservation.value?.id) {
                const refreshed = updated.find(r => String(r.id) === String(selectedReservation.value.id))
                if (refreshed) {
                    selectedReservation.value = refreshed
                    prepareStageChecklist(refreshed)
                }
            }
        } else if (selectedReservation.value) {
            prepareStageChecklist(selectedReservation.value)
        }
        checklistDefinitionsLoaded = true
    }
    const loadChecklistDefinitions = async (options = {}) => {
        if (options?.force) {
            checklistDefinitionsLoaded = false
        }
        if (checklistDefinitionsLoaded && !options?.force) return
        if (checklistDefinitionsPending) return checklistDefinitionsPending
        const silent = options?.silent === true
        checklistDefinitionsPending = (async () => {
            try {
                const { data } = await axios.get(`${API}/app/reservation_checklists`)
                if (data?.ok) {
                    applyStageChecklistDefinitions(data.data || data || {})
                } else if (!silent && data?.message) {
                    await showNotice(data.message, { title: '檢核項目載入失敗' })
                }
            } catch (err) {
                if (!silent) {
                    await showNotice(err?.response?.data?.message || err.message || '檢核項目載入失敗', { title: '錯誤' })
                } else {
                    console.error('loadChecklistDefinitions error:', err?.response?.data?.message || err.message || err)
                }
            } finally {
                checklistDefinitionsPending = null
            }
        })()
        return checklistDefinitionsPending
    }
    const openReservationModal = (reservation) => {
        selectedReservation.value = reservation
        prepareStageChecklist(reservation)
        showModal.value = true
    }
    const closeModal = () => showModal.value = false
    const goToGeneralReservations = () => {
        setReservationCategory('general', { skipRouteSync: true })
        const index = reservationsTabIndex.value
        setActiveTab('reservations', index >= 0 ? index : 1)
    }
    const goToNextReservationAction = () => {
        const target = nextActionReservation.value
        if (!target) return
        goToGeneralReservations()
        openReservationModal(target)
    }
    const fileToDataUrl = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error || new Error('檔案讀取失敗'))
        reader.readAsDataURL(file)
    })
    const syncReservationChecklist = (reservationId, stage, checklist, options = {}) => {
        const preserveChecked = options.preserveChecked === true
        const normalized = normalizeChecklist(stage, checklist)
        const preservedCheckedMap = new Map()
        if (preserveChecked) {
            const collectChecked = (sourceItems) => {
                if (!Array.isArray(sourceItems)) return
                sourceItems.forEach(item => {
                    if (item && item.label) preservedCheckedMap.set(item.label, !!item.checked)
                })
            }
            const targetReservation = reservations.value.find(r => String(r.id) === String(reservationId)) || selectedReservation.value
            if (targetReservation?.checklists?.[stage]?.items) {
                collectChecked(targetReservation.checklists[stage].items)
            }
            if (targetReservation) {
                const key = stageChecklistKey(targetReservation)
                if (key && stageChecklistState[key]?.items) {
                    collectChecked(stageChecklistState[key].items)
                }
            }
        }
        const mergedItems = normalized.items.map(item => {
            if (!preserveChecked || !preservedCheckedMap.has(item.label)) return item
            const preservedChecked = preservedCheckedMap.get(item.label)
            // Respect server-provided true values to avoid accidental uncheck.
            if (item.checked === true && preservedChecked === false) return item
            return { ...item, checked: preservedChecked }
        })
        const nextChecklist = { ...normalized, items: mergedItems }
        const normalizedPhotoCount = typeof nextChecklist.photoCount === 'number' ? nextChecklist.photoCount : nextChecklist.photos.length
        const applyToReservation = (reservation) => {
            if (!reservation) return
            if (!reservation.checklists) reservation.checklists = {}
            reservation.checklists[stage] = nextChecklist
            if (!reservation.stageChecklist) reservation.stageChecklist = {}
            reservation.stageChecklist[stage] = {
                found: ensureChecklistHasPhotos(nextChecklist),
                completed: !!nextChecklist.completed,
                photoCount: normalizedPhotoCount
            }
        }
        const target = reservations.value.find(r => String(r.id) === String(reservationId))
        applyToReservation(target)
        if (selectedReservation.value && String(selectedReservation.value.id) === String(reservationId)) {
            applyToReservation(selectedReservation.value)
            const key = stageChecklistKey(selectedReservation.value)
            if (key && stageChecklistState[key]) {
                const state = stageChecklistState[key]
                state.items.splice(0, state.items.length, ...nextChecklist.items)
                state.photos.splice(0, state.photos.length, ...nextChecklist.photos)
                state.completed = !!nextChecklist.completed
                state.photoCount = normalizedPhotoCount
            }
        }
    }
    const uploadActiveStageChecklistPhoto = async (event) => {
        const files = event?.target?.files
        if (!files || !files.length) return
        const file = files[0]
        if (event?.target) event.target.value = ''
        const reservation = selectedReservation.value
        const stage = reservation?.status
        const checklist = activeStageChecklist.value
        if (!reservation || !stage || !requiresChecklistBeforeQr(stage) || !checklist) return
        if (!reservation.id) { await showNotice('預約資料有誤，請重新整理頁面', { title: '錯誤' }); return }
        if (checklist.photos.length >= CHECKLIST_PHOTO_LIMIT) {
            await showNotice(`最多可上傳 ${CHECKLIST_PHOTO_LIMIT} 張照片`, { title: '上傳限制' })
            return
        }
        if (!/^image\/(?:avif|gif|heic|heif|jpeg|png|webp)$/i.test(file.type || '') || file.size > CHECKLIST_PHOTO_MAX_BYTES) {
            await showNotice('僅支援上傳 8MB 以下的圖片檔', { title: '上傳限制' })
            return
        }
        checklist.uploading = true
        checklist.uploadMessage = '照片上傳中…'
        checklist.uploadProgress = 5
        try {
            const dataUrl = await fileToDataUrl(file)
            const { data } = await axios.post(
                `${API}/reservations/${reservation.id}/checklists/${stage}/photos`,
                {
                    data: dataUrl,
                    name: file.name
                },
                {
                    onUploadProgress: (event) => {
                        if (!event) return
                        if (event.total) {
                            const percent = Math.round((event.loaded / event.total) * 100)
                            checklist.uploadProgress = Math.min(99, Math.max(percent, 5))
                        } else {
                            const next = (checklist.uploadProgress || 0) + 10
                            checklist.uploadProgress = Math.min(90, next)
                        }
                    }
                }
            )
            if (data?.ok) {
                checklist.uploadProgress = 100
                checklist.uploadMessage = '上傳完成'
                const payload = data.data || {}
                syncReservationChecklist(reservation.id, stage, payload.checklist || {}, { preserveChecked: true })
                await showNotice('已上傳檢核照片')
            } else {
                await showNotice(data?.message || '上傳失敗', { title: '上傳失敗' })
            }
        } catch (err) {
            await showNotice(err?.response?.data?.message || err.message || '上傳失敗', { title: '上傳失敗' })
        } finally {
            const state = activeStageChecklist.value || checklist
            if (state) {
                state.uploading = false
                state.uploadMessage = ''
                state.uploadProgress = 0
            }
        }
    }
    const removeStageChecklistPhoto = async (photoId) => {
        const reservation = selectedReservation.value
        const stage = reservation?.status
        if (!reservation || !stage || !requiresChecklistBeforeQr(stage) || !photoId) return
        if (!(await showConfirm('確認刪除這張檢核照片嗎？', { title: '刪除確認' }))) return
        const checklist = activeStageChecklist.value
        if (!checklist) return
        checklist.uploading = true
        checklist.uploadMessage = '照片刪除中…'
        checklist.uploadProgress = 0
        try {
            const { data } = await axios.delete(`${API}/reservations/${reservation.id}/checklists/${stage}/photos/${photoId}`)
            if (data?.ok) {
                const payload = data.data || {}
                syncReservationChecklist(reservation.id, stage, payload.checklist || {}, { preserveChecked: true })
                await showNotice('已刪除檢核照片')
            } else {
                await showNotice(data?.message || '刪除失敗', { title: '刪除失敗' })
            }
        } catch (err) {
            await showNotice(err?.response?.data?.message || err.message || '刪除失敗', { title: '刪除失敗' })
        } finally {
            const state = activeStageChecklist.value || checklist
            if (state) {
                state.uploading = false
                state.uploadMessage = ''
                state.uploadProgress = 0
            }
        }
    }
    const formatChecklistUploadedAt = (value) => formatDateTime(value, { fallback: '' })

    const toAbsolutePhotoUrl = (url) => {
        if (!url) return ''
        if (typeof url !== 'string') return ''
        if (url.startsWith('data:') || url.startsWith('blob:')) return url
        if (/^https?:\/\//i.test(url)) return url
        if (url.startsWith('/')) return `${API}${url}`
        return `${API}/${url.replace(/^\/+/, '')}`
    }
    const checklistPhotoSrc = (reservation, stage, photo) => {
        if (!photo) return ''
        if (photo.url) return toAbsolutePhotoUrl(photo.url)
        const reservationId = reservation?.id ?? selectedReservation.value?.id
        const stageKey = stage || reservation?.status || selectedReservation.value?.status
        if (photo.storagePath && reservationId && stageKey && photo.id != null) {
            return `${API}/reservations/${reservationId}/checklists/${stageKey}/photos/${photo.id}/raw`
        }
        if (photo.legacy && photo.dataUrl) return toAbsolutePhotoUrl(photo.dataUrl)
        return ''
    }

    const pickupIdentificationCode = computed(() => {
        const res = selectedReservation.value || {}
        if (!isPickupStage(res.status)) return ''
        const rawId = res.id
        if (rawId === null || rawId === undefined) return ''
        const text = String(rawId).trim()
        return text
    })
    const showPickupIdentification = computed(() => !!pickupIdentificationCode.value)
    const activeReservationVerifyCode = computed(() => {
        const code = getReservationStageCode(selectedReservation.value)
        return code || ''
    })
    const showReservationQr = computed(() => {
        const res = selectedReservation.value || {}
        const status = res.status
        if (!status) return false
        if (!CHECKLIST_STAGE_KEYS.includes(status)) return false
        if (!activeReservationVerifyCode.value) return false
        if (!requiresChecklistBeforeQr(status)) return true
        const stageInfo = res.stageChecklist?.[status]
        const fallback = res.checklists?.[status]
        const active = activeStageChecklist.value
        const completed = !!(active?.completed || stageInfo?.completed || fallback?.completed)
        if (!completed) return false
        const stagePhotoCount = typeof stageInfo?.photoCount === 'number' ? stageInfo.photoCount : 0
        const hasPhotos =
            ensureChecklistHasPhotos(active) ||
            stagePhotoCount > 0 ||
            ensureChecklistHasPhotos(fallback)
        return hasPhotos
    })
    const activeStageChecklistDefinition = computed(() => {
        const stage = selectedReservation.value?.status
        if (!stage || !requiresChecklistBeforeQr(stage)) return null
        return stageChecklistDefinitions[stage] || null
    })
    const activeStageChecklistKey = computed(() => {
        const res = selectedReservation.value
        if (!res || !requiresChecklistBeforeQr(res.status)) return null
        return stageChecklistKey(res)
    })
    const activeStageChecklist = computed(() => {
        const key = activeStageChecklistKey.value
        if (!key) return null
        return stageChecklistState[key] || null
    })
    const canSubmitStageChecklist = computed(() => {
        const checklist = activeStageChecklist.value
        if (!checklist || checklist.completed) return false
        if (!Array.isArray(checklist.items) || !checklist.items.length) return false
        if (!ensureChecklistHasPhotos(checklist)) return false
        return checklist.items.every(item => item.checked)
    })
    const reservationChecklistNotice = computed(() => {
        const res = selectedReservation.value || {}
        const status = res.status
        if (!status || !requiresChecklistBeforeQr(status)) return ''
        const label = checklistFriendlyName(status)
        const stageInfo = res.stageChecklist?.[status]
        const checklist = res.checklists?.[status]
        const completed = !!(stageInfo?.completed || checklist?.completed)
        const stagePhotoCount = typeof stageInfo?.photoCount === 'number' ? stageInfo.photoCount : 0
        const checklistPhotoCount = typeof checklist?.photoCount === 'number'
            ? checklist.photoCount
            : (Array.isArray(checklist?.photos) ? checklist.photos.length : 0)
        const totalPhotoCount = stagePhotoCount > 0 ? stagePhotoCount : checklistPhotoCount
        if (completed && totalPhotoCount > 0) return ''
        if (!completed && totalPhotoCount <= 0) return `請先完成${label}並上傳檢核照片，完成後才會顯示掃描碼。`
        if (!completed) return `${label}尚未完成，完成後才會顯示掃描碼。`
        return `請先上傳${label}檢核照片，完成後才會顯示掃描碼。`
    })
    const completeActiveStageChecklist = async () => {
        const res = selectedReservation.value
        if (!res) return
        const stage = res.status
        if (!requiresChecklistBeforeQr(stage)) return
        const checklist = activeStageChecklist.value
        if (!checklist) {
            if (reservationChecklistNotice.value) await showNotice(reservationChecklistNotice.value, { title: '尚未完成' })
            return
        }
        if (!checklist.items.every(item => item.checked)) {
            await showNotice('請先勾選所有檢核項目', { title: '檢核未完成' })
            return
        }
        if (!ensureChecklistHasPhotos(checklist)) {
            await showNotice('請至少上傳 1 張檢核照片', { title: '檢核未完成' })
            return
        }
        checklist.saving = true
        try {
            const { data } = await axios.patch(`${API}/reservations/${res.id}/checklists/${stage}`, {
                items: checklist.items,
                completed: true
            })
            if (data?.ok) {
                const payload = data.data || {}
                syncReservationChecklist(res.id, stage, payload.checklist || {})
                const prevKey = stageChecklistKey(selectedReservation.value)
                const targetId = res.id ?? null
                const targetSignature = `${res.store || ''}|${res.event || ''}|${res.reservedAt || ''}`
                const updatedReservations = await loadReservations({ preservePage: true })
                if (prevKey && Object.prototype.hasOwnProperty.call(stageChecklistState, prevKey)) {
                    Reflect.deleteProperty(stageChecklistState, prevKey)
                }
                const refreshed = updatedReservations.find(r => {
                    if (targetId != null && String(r.id) === String(targetId)) return true
                    const signature = `${r.store || ''}|${r.event || ''}|${r.reservedAt || ''}`
                    return signature === targetSignature
                }) || null
                if (refreshed) {
                    selectedReservation.value = refreshed
                    prepareStageChecklist(refreshed)
                } else {
                    const nextVerifyCodeRaw =
                        payload.verifyCode ||
                        payload.verify_code ||
                        payload?.checklist?.verifyCode ||
                        payload?.checklist?.verify_code ||
                        null
                    const nextVerifyCode = toStageCodeString(nextVerifyCodeRaw)
                    if (nextVerifyCode) {
                        const updatedSelection = {
                            ...selectedReservation.value,
                            verifyCode: nextVerifyCode,
                            stageCodes: {
                                ...(selectedReservation.value?.stageCodes || {}),
                                [stage]: nextVerifyCode
                            }
                        }
                        selectedReservation.value = updatedSelection
                        prepareStageChecklist(updatedSelection)
                        const idx = reservations.value.findIndex(r => {
                            if (targetId != null && String(r.id) === String(targetId)) return true
                            const signature = `${r.store || ''}|${r.event || ''}|${r.reservedAt || ''}`
                            return signature === targetSignature
                        })
                        if (idx !== -1) {
                            reservations.value.splice(idx, 1, {
                                ...reservations.value[idx],
                                verifyCode: nextVerifyCode,
                                stageCodes: {
                                    ...(reservations.value[idx].stageCodes || {}),
                                    [stage]: nextVerifyCode
                                }
                            })
                        }
                    }
                }
                await showNotice('檢核完成，已顯示掃描碼')
            } else {
                await showNotice(data?.message || '檢核更新失敗', { title: '檢核失敗' })
            }
        } catch (err) {
            await showNotice(err?.response?.data?.message || err.message || '檢核更新失敗', { title: '檢核失敗' })
        } finally {
            checklist.saving = false
        }
    }

    watch(() => selectedReservation.value, (res) => {
        if (res) prepareStageChecklist(res)
    }, { immediate: false })

    const formatDate = (dateString) => formatDateTime(dateString)

    onMounted(async () => {
        window.addEventListener('auth-changed', handleAuthChanged)
        window.addEventListener('storage', handleStorage)
        document.addEventListener('visibilitychange', syncIncomingPolling)
        syncStoredUser()
        if (currentUser.value) {
            await loadChecklistDefinitions({ silent: true })
            loadTickets()
            loadReservations()
            loadIncomingTransfers()
            syncIncomingPolling()
        }
        syncWalletLocationFromRoute()
    })
    onUnmounted(() => {
        window.removeEventListener('auth-changed', handleAuthChanged)
        window.removeEventListener('storage', handleStorage)
        document.removeEventListener('visibilitychange', syncIncomingPolling)
        stopIncomingPolling()
    })

    // ===== 接收方：待處理轉贈（底部抽屜，逐一處理） =====
    const transferSortTimestamp = (transfer) => {
        const createdAt = parseDateTimeValue(transfer?.created_at || transfer?.createdAt)
        if (createdAt) return createdAt.getTime()
        const id = Number(transfer?.id)
        return Number.isFinite(id) ? id : 0
    }
    const sortTransfersByLatest = (list = []) => [...list].sort((a, b) => transferSortTimestamp(b) - transferSortTimestamp(a))
    const incoming = ref({ open: false, list: [], current: null })
    const loadIncomingTransfers = async () => {
        if (typeof document !== 'undefined' && document.hidden) return
        if (incomingLoading) return
        incomingLoading = true
        try {
            const [ticketResp, reservationResp] = await Promise.allSettled([
                axios.get(`${API}/tickets/transfers/incoming`),
                axios.get(`${API}/reservations/transfers/incoming`)
            ])
            const ticketList = ticketResp.status === 'fulfilled'
                ? (Array.isArray(ticketResp.value?.data?.data) ? ticketResp.value.data.data : [])
                : []
            const reservationList = reservationResp.status === 'fulfilled'
                ? (Array.isArray(reservationResp.value?.data?.data) ? reservationResp.value.data.data : [])
                : []
            const list = [
                ...ticketList.map(item => ({ ...item, transferType: 'ticket' })),
                ...reservationList.map(item => ({ ...item, transferType: 'reservation' }))
            ]
            const sorted = sortTransfersByLatest(list)
            incoming.value.list = sorted
            incoming.value.current = sorted[0] || null
            incoming.value.open = !!incoming.value.current
        } catch (e) { /* ignore */ }
        finally { incomingLoading = false }
    }

    const stopIncomingPolling = () => {
        if (!incomingPollingTimer) return
        clearInterval(incomingPollingTimer)
        incomingPollingTimer = null
    }
    const syncIncomingPolling = () => {
        if (!currentUser.value || (typeof document !== 'undefined' && document.hidden)) {
            stopIncomingPolling()
            return
        }
        loadIncomingTransfers()
        if (!incomingPollingTimer) incomingPollingTimer = setInterval(loadIncomingTransfers, 15000)
    }
    const shiftIncoming = () => {
        incoming.value.list.shift()
        incoming.value.current = incoming.value.list[0] || null
        incoming.value.open = !!incoming.value.current
    }
    const acceptCurrentTransfer = async () => {
        const it = incoming.value.current; if (!it) return
        try {
            const endpoint = it.transferType === 'reservation'
                ? `${API}/reservations/transfers/${it.id}/accept`
                : `${API}/tickets/transfers/${it.id}/accept`
            const { data } = await axios.post(endpoint)
            if (data?.ok) {
                if (it.transferType === 'reservation') await loadReservations({ preservePage: true })
                else await loadTickets()
                shiftIncoming()
            }
            else await showNotice(data?.message || '接受失敗', { title: '接受失敗' })
        } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
    }
    const declineCurrentTransfer = async () => {
        const it = incoming.value.current; if (!it) return
        try {
            const endpoint = it.transferType === 'reservation'
                ? `${API}/reservations/transfers/${it.id}/decline`
                : `${API}/tickets/transfers/${it.id}/decline`
            const { data } = await axios.post(endpoint)
            if (data?.ok) { shiftIncoming() }
            else await showNotice(data?.message || '拒絕失敗', { title: '拒絕失敗' })
        } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
    }

    // ===== 掃描轉贈（接收方） =====
    const scan = ref({ open: false, scanning: false, manual: '' })
    const scanVideo = ref(null)
    let qrCtrl = null
    const openScan = () => { scan.value.open = true }
    const closeScan = () => { if (qrCtrl) { try { qrCtrl.stop() } catch { } qrCtrl = null } scan.value.scanning = false; scan.value.open = false }
    watch(() => scan.value.open, async (v) => {
        if (v) {
            try {
                await nextTick()
                const videoEl = scanVideo.value
                if (!videoEl) return
                const { stop } = await startQrScanner({
                    video: videoEl,
                    onDecode: async (raw) => { if (!scan.value.scanning) return; await claimCode(raw) },
                    onError: () => { }
                })
                qrCtrl = { stop }
                scan.value.scanning = true
            } catch { /* ignore */ }
        } else {
            if (qrCtrl) { try { qrCtrl.stop() } catch { } qrCtrl = null }
            scan.value.scanning = false
        }
    })
    const claimCode = async (raw) => {
        try {
            const code = String(raw).replace(/\s+/g, '')
            const isReservationCode = code.toUpperCase().startsWith('RSV-')
            const endpoint = isReservationCode
                ? `${API}/reservations/transfers/claim_code`
                : `${API}/tickets/transfers/claim_code`
            const { data } = await axios.post(endpoint, { code })
            if (data?.ok) {
                await showNotice(isReservationCode ? '已認領預約' : '已認領票券')
                if (isReservationCode) await loadReservations({ preservePage: true })
                else await loadTickets()
                closeScan()
            }
            else await showNotice(data?.message || '認領失敗', { title: '認領失敗' })
        } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
    }
    const claimByCode = async () => { if (scan.value.manual) await claimCode(scan.value.manual) }

    const overlayOpen = computed(() => showModal.value || qrSheet.value.open || incoming.value.open || scan.value.open)
    const canUseSwipeNavigation = computed(() => isMobile.value && !overlayOpen.value)
    const goToTabByOffset = (offset) => {
        if (!canUseSwipeNavigation.value) return
        const nextIndex = activeTabIndex.value + offset
        if (nextIndex < 0 || nextIndex >= tabs.length) return
        const targetTab = tabs[nextIndex]
        if (targetTab) setActiveTab(targetTab.key, nextIndex)
    }
    const handleSwipeLeft = () => goToTabByOffset(1)
    const handleSwipeRight = () => goToTabByOffset(-1)

    registerSwipeHandlers('wallet-tabs', computed(() => {
        if (!canUseSwipeNavigation.value) return null
        return {
            events: {
                swipeleft: handleSwipeLeft,
                swiperight: handleSwipeRight
            },
            touchAction: 'pan-y'
        }
    }), { target: 'wallet-main' })
</script>
