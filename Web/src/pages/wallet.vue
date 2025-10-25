<template>
    <main class="pt-6 pb-12 px-4" v-hammer="mainSwipeBinding">
        <div class="max-w-6xl mx-auto">

            <!-- Header -->
            <header
                class="bg-white shadow-sm border-b border-gray-100 mb-8 p-6 pt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 class="text-2xl font-bold text-gray-900">我的皮夾</h1>
                    <p class="text-gray-600 mt-1">管理您的所有票券與預約</p>
                </div>
                <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                    <div
                        class="w-full sm:w-auto flex items-center justify-center gap-2 bg-red-50 text-red-700 px-3 py-2 text-sm font-medium border border-red-200">
                        共 {{ totalTickets }} 張票券
                    </div>
                    <!-- <button class="btn btn-outline text-sm" @click="openScan"><AppIcon name="camera" class="h-4 w-4" /> 掃描轉贈</button>-->
                </div>
            </header>

            <!-- Action Center -->
            <section v-if="actionCenterItems.length" class="mb-8">
                <div
                    class="bg-gray-50 border border-gray-200 shadow-sm p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h2 class="text-base font-semibold text-gray-800">快速提醒</h2>
                        <ul class="mt-2 space-y-1 text-sm text-gray-600">
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
                            @click="setActiveTab('reservations', reservationsTabIndex)">
                            檢視預約
                        </button>
                    </div>
                </div>
            </section>

            <!-- Tabs -->
            <div class="relative mb-6 sticky top-0 z-20 bg-white">
                <div class="flex justify-center border-b border-gray-200 relative">
                    <div class="tab-indicator" :style="indicatorStyle"></div>
                    <button v-for="(tab, index) in tabs" :key="tab.key" @click="setActiveTab(tab.key, index)" :class="[
                        'relative flex-1 px-2 py-3 sm:px-6 sm:py-4 font-semibold transition-all duration-300 text-sm sm:text-lg whitespace-nowrap flex items-center gap-1 justify-center',
                        activeTab === tab.key
                            ? 'text-primary'
                            : 'text-gray-500 hover:text-secondary'
                    ]">
                        <AppIcon :name="tab.icon" class="h-4 w-4" /> {{ tab.label }}
                    </button>
                </div>
            </div>

            <!-- 我的票券 -->
            <section v-if="activeTab === 'tickets'" class="slide-in">
                <!-- Stats Cards -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div @click="filterTickets('all')"
                        class="cursor-pointer bg-white p-6 border border-gray-200 shadow-sm hover:border-primary">
                        <p class="text-sm text-gray-600 font-medium">總票卷數</p>
                        <p class="text-3xl font-bold text-gray-900">{{ totalTickets }}</p>
                    </div>
                    <div @click="filterTickets('available')"
                        class="cursor-pointer bg-white p-6 border border-gray-200 shadow-sm hover:border-primary">
                        <p class="text-sm text-gray-600 font-medium">可用票卷</p>
                        <p class="text-3xl font-bold text-green-600">{{ availableTickets }}</p>
                    </div>
                    <div @click="filterTickets('used')"
                        class="cursor-pointer bg-white p-6 border border-gray-200 shadow-sm hover:border-primary">
                        <p class="text-sm text-gray-600 font-medium">已使用</p>
                        <p class="text-3xl font-bold text-red-600">{{ usedTickets }}</p>
                    </div>
                </div>

                <!-- Filter Buttons -->
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
                    <div class="flex flex-wrap gap-2">
                        <button @click="filterTickets('available')"
                            :class="filter === 'available' ? activeFilterClass : defaultFilterClass">可用</button>
                        <button @click="filterTickets('used')"
                            :class="filter === 'used' ? activeFilterClass : defaultFilterClass">已使用</button>
                        <button @click="filterTickets('all')"
                            :class="filter === 'all' ? activeFilterClass : defaultFilterClass">全部</button>
                    </div>
                    <div class="relative w-full sm:w-64">
                        <AppIcon name="search"
                            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input v-model.trim="ticketSearch" type="text" placeholder="搜尋票券（名稱或編號）"
                            class="w-full pl-10 pr-3 py-2 border border-gray-200 focus:border-primary focus:ring-0 text-sm text-gray-700 placeholder-gray-400" />
                        <button v-if="ticketSearch"
                            class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                            @click="clearTicketSearch">
                            清除
                        </button>
                    </div>
                </div>

                <!-- Coupon Cards -->
                <div v-if="loadingTickets" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div v-for="i in 6" :key="'tskel-' + i"
                        class="ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm skeleton"
                        style="height: 320px;"></div>
                </div>
                <div v-else>
                    <TransitionGroup v-if="filteredTickets.length" name="grid-stagger" tag="div"
                        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                        <div v-for="(ticket, index) in filteredTickets" :key="ticket.uuid" :class="[
                            'ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm',
                            ticket.used ? 'opacity-60' : ''
                        ]">
                            <div class="relative w-full overflow-hidden" style="aspect-ratio: 3/2;">
                                <img :src="ticketCoverUrl(ticket)" @error="(e) => e.target.src = '/logo.png'"
                                    alt="cover" class="absolute inset-0 w-full h-full object-cover" />
                                <div
                                    class="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-red-700/10 pointer-events-none">
                                </div>
                            </div>
                            <div class="p-6">
                                <div class="flex items-start justify-between mb-4">
                                    <div>
                                        <h3 class="text-xl font-bold text-primary">🎫 {{ ticket.type }}</h3>
                                        <p class="text-sm text-gray-500">使用期限：{{ formatDate(ticket.expiry) }}</p>
                                    </div>
                                    <span :class="[
                                        'px-3 py-1 text-xs font-semibold',
                                        ticket.used ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                    ]">
                                        {{ ticket.used ? '已使用' : '未使用' }}
                                    </span>
                                </div>
                                <p class="text-xs text-gray-500 mb-1">票券編號</p>
                                <div class="flex items-center justify-between bg-gray-50 px-2 py-2 mb-3">
                                    <p class="text-sm font-mono text-gray-700 truncate mr-2" :title="ticket.uuid">{{
                                        ticket.uuid }}</p>
                                    <button class="btn-ghost" title="複製編號" @click="copyText(ticket.uuid)">
                                        <AppIcon name="copy" class="h-4 w-4" />
                                    </button>
                                </div>
                                <button class="w-full py-3 font-semibold text-white" :class="ticket.used
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'btn btn-primary'" :disabled="ticket.used" @click="goReserve()">
                                    {{ ticket.used ? '已使用' : '去預約使用' }}
                                </button>
                                <div v-if="!ticket.used" class="mt-2 grid grid-cols-2 gap-2">
                                    <button class="btn btn-outline text-sm" @click="startTransferEmail(ticket)">
                                        <AppIcon name="orders" class="h-4 w-4" /> 轉贈 Email
                                    </button>
                                    <button class="btn btn-outline text-sm" @click="startTransferQR(ticket)">
                                        <AppIcon name="camera" class="h-4 w-4" /> 轉贈 QR
                                    </button>
                                </div>
                            </div>
                        </div>
                    </TransitionGroup>
                    <div v-else
                        class="ticket-card bg-white border-2 border-gray-100 p-6 shadow-sm text-sm text-gray-500">
                        {{ ticketSearch ? '沒有符合搜尋條件的票券。' : '目前沒有票券可以顯示。' }}
                    </div>
                </div>
            </section>

            <!-- 行動 FAB：掃描轉贈（僅手機顯示） -->
            <div v-if="isMobile" class="fixed bottom-4 right-4 z-40">
                <button class="btn btn-primary shadow px-4 py-3" @click="openScan">
                    <AppIcon name="camera" class="h-5 w-5" /> 掃描轉贈
                </button>
            </div>

            <!-- 我的預約 -->
            <section v-if="activeTab === 'reservations'" class="slide-in" ref="reservationsSectionRef">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
                    <div class="flex flex-wrap gap-3">
                        <button @click="filterReservations('all')"
                            :class="resFilter === 'all' ? activeFilterClass : defaultFilterClass">全部</button>
                        <button v-for="opt in reservationStatusList" :key="opt.key" @click="filterReservations(opt.key)"
                            :class="resFilter === opt.key ? activeFilterClass : defaultFilterClass">{{ opt.shortLabel
                            }}</button>
                    </div>
                    <div class="relative w-full sm:w-64">
                        <AppIcon name="search"
                            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input v-model.trim="reservationSearch" type="text" placeholder="搜尋預約（門市或賽事）"
                            class="w-full pl-10 pr-3 py-2 border border-gray-200 focus:border-primary focus:ring-0 text-sm text-gray-700 placeholder-gray-400" />
                        <button v-if="reservationSearch"
                            class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                            @click="clearReservationSearch">
                            清除
                        </button>
                    </div>
                    <!--<span class="text-sm text-gray-600">一次顯示最多 10 筆預約紀錄</span>-->
                </div>

                <!-- Reservation Cards -->
                <div v-if="loadingReservations" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div v-for="i in 6" :key="'rskel-' + i"
                        class="ticket-card bg-white border-2 border-gray-100 p-6 shadow-sm animate-pulse"
                        style="height: 220px;"></div>
                </div>
                <div v-else-if="!filteredReservations.length"
                    class="ticket-card bg-white border-2 border-gray-100 p-6 shadow-sm text-sm text-gray-500">
                    <p v-if="reservationSearch">沒有找到符合搜尋條件的預約。</p>
                    <p v-else-if="resFilter !== 'all'">目前沒有 {{ statusLabelMap[resFilter] || '' }} 預約。</p>
                    <p v-else>目前沒有符合條件的預約紀錄。</p>
                </div>
                <template v-else>
                    <TransitionGroup name="grid-stagger" tag="div"
                        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                        <div v-for="(res, index) in displayedReservations" :key="`${res.id || res.event}-${index}`"
                            :class="[
                                'ticket-card bg-white border-2 border-gray-100 p-6 shadow-sm cursor-pointer',
                                res.status === 'done' ? 'opacity-60' : ''
                            ]" @click="openReservationModal(res)">
                            <div class="flex items-start justify-between mb-4">
                                <div>
                                    <h3 class="text-xl font-bold text-primary">{{ res.event }}</h3>
                                    <p class="text-sm text-gray-600">門市：{{ res.store }}</p>
                                    <p class="text-xs text-gray-500">預約時間：{{ formatDate(res.reservedAt) }}</p>
                                </div>
                                <span :class="[
                                    'badge',
                                    statusColorMap[res.status]
                                ]">
                                    {{ statusLabelMap[res.status] }}
                                </span>
                            </div>
                            <button class="w-full py-3 font-semibold text-white" :class="res.status === 'done'
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'btn btn-primary'" :disabled="res.status === 'done'"
                                @click.stop="openReservationModal(res)">
                                {{ reservationActionLabel(res.status) }}
                            </button>
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
            </section>

            <!-- 預約詳情 Bottom Sheet -->
            <AppBottomSheet v-model="showModal">
                <div class="max-h-[80vh] overflow-y-auto">
                    <div class="mx-auto h-1.5 w-10 bg-gray-300 mb-3"></div>
                    <h3 class="text-lg sm:text-xl font-bold text-primary mb-3">預約詳情</h3>

                    <div class="space-y-1 text-sm text-gray-800">
                        <p><strong>票券類型：</strong>{{ selectedReservation.ticketType }}</p>
                        <p><strong>{{ phaseLabel(selectedReservation.status) }}地點：</strong>{{ selectedReservation.store
                            }}</p>
                        <p><strong>賽事：</strong>{{ selectedReservation.event }}</p>
                        <p><strong>{{ phaseLabel(selectedReservation.status) }}時間：</strong>{{
                            formatDate(selectedReservation.reservedAt) }}</p>
                        <p class="mt-2"><strong>狀態：</strong>
                            <span :class="['px-2 py-1 text-xs', statusColorMap[selectedReservation.status]]">
                                {{ statusLabelMap[selectedReservation.status] }}
                            </span>
                        </p>
                    </div>

                    <div v-if="showReservationQr" class="mt-5 text-center space-y-3">
                        <p class="text-sm text-gray-700 font-medium">{{ phaseLabel(selectedReservation.status) }}驗證碼</p>
                        <div
                            class="text-2xl font-bold text-primary tracking-widest flex items-center justify-center gap-2">
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
                    <div v-else-if="activeStageChecklistDefinition && activeStageChecklist" class="mt-5 space-y-4">
                        <div class="bg-white border border-yellow-200 shadow-sm rounded-md p-4">
                            <div class="flex items-start gap-2 mb-3">
                                <AppIcon name="check" class="h-5 w-5 text-yellow-600" />
                                <div>
                                    <h4 class="font-semibold text-yellow-700 text-base">{{
                                        activeStageChecklistDefinition.title }}</h4>
                                    <p v-if="activeStageChecklistDefinition.description"
                                        class="text-xs text-yellow-700/90 mt-1 leading-relaxed">
                                        {{ activeStageChecklistDefinition.description }}
                                    </p>
                                </div>
                            </div>
                            <div class="space-y-2">
                                <label v-for="(item, idx) in activeStageChecklist.items" :key="idx"
                                    class="flex items-start gap-2 text-sm text-gray-700 leading-snug">
                                    <input type="checkbox" v-model="item.checked" class="mt-1" />
                                    <span>{{ item.label }}</span>
                                </label>
                            </div>
                            <div class="mt-5">
                                <div class="flex items-center justify-between mb-2">
                                    <h5 class="text-sm font-semibold text-gray-700">檢核照片</h5>
                                    <span class="text-xs text-gray-500">
                                        {{ activeStageChecklist.photos.length }} / {{ CHECKLIST_PHOTO_LIMIT }}
                                    </span>
                                </div>
                                <div class="relative">
                                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                        <div v-for="photo in activeStageChecklist.photos" :key="photo.id"
                                            class="border border-gray-200 bg-gray-50 relative">
                                            <img :src="photo.url" alt="檢核照片" class="w-full h-32 object-cover" />
                                            <button type="button"
                                                class="absolute top-1 right-1 bg-black/70 text-white px-2 py-0.5 text-xs"
                                                @click="removeStageChecklistPhoto(photo.id)"
                                                :disabled="activeStageChecklist.uploading || activeStageChecklist.saving">
                                                刪除
                                            </button>
                                            <p class="text-[11px] text-gray-600 px-2 py-1 truncate">
                                                {{ formatChecklistUploadedAt(photo.uploadedAt) }}
                                            </p>
                                        </div>
                                        <label v-if="activeStageChecklist.photos.length < CHECKLIST_PHOTO_LIMIT"
                                            class="border border-dashed border-gray-300 text-gray-500 flex flex-col items-center justify-center h-32 cursor-pointer bg-gray-50 hover:border-primary hover:text-primary transition"
                                            :class="{ 'opacity-50 pointer-events-none': activeStageChecklist.uploading || activeStageChecklist.saving }">
                                            <input type="file" class="hidden" accept="image/*" capture="environment"
                                                @change="uploadActiveStageChecklistPhoto" />
                                            <AppIcon name="camera" class="h-6 w-6 mb-1" />
                                            <span class="text-xs font-medium">新增照片</span>
                                            <span class="text-[11px] text-gray-400 mt-1">支援 JPG / PNG / WEBP</span>
                                        </label>
                                    </div>
                                    <div v-if="activeStageChecklist.uploading" class="upload-overlay">
                                        <div class="upload-overlay__content">
                                            <span class="upload-spinner" aria-hidden="true"></span>
                                            <span class="upload-overlay__text">
                                                {{ activeStageChecklist.uploadMessage || '處理中…' }}
                                            </span>
                                            <div v-if="activeStageChecklist.uploadProgress > 0" class="upload-progress">
                                                <div class="upload-progress__bar">
                                                    <div class="upload-progress__fill"
                                                        :style="{ width: `${Math.min(activeStageChecklist.uploadProgress, 100)}%` }">
                                                    </div>
                                                </div>
                                                <span class="upload-progress__value">
                                                    {{ Math.min(activeStageChecklist.uploadProgress, 100) }}%
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <p class="text-[11px] text-gray-500 mt-2">至少上傳 1 張照片，檔案需小於 8MB。</p>
                            </div>
                            <button class="w-full mt-4 py-2 btn btn-primary text-white"
                                @click="completeActiveStageChecklist"
                                :disabled="!canSubmitStageChecklist || activeStageChecklist.uploading || activeStageChecklist.saving">
                                {{ activeStageChecklistDefinition.confirmText }}
                            </button>
                        </div>
                        <p class="text-xs text-gray-500 text-center">完成檢核後會立即顯示 QR Code，供店員掃描。</p>
                    </div>
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
                <div class="bg-white border p-4 shadow-sm">
                    <div class="flex items-center justify-between mb-3">
                        <h2 class="font-semibold">票券紀錄</h2>
                        <button class="btn btn-outline text-sm" @click="loadLogs" :disabled="loadingLogs">
                            <AppIcon name="refresh" class="h-4 w-4" /> 重新整理
                        </button>
                    </div>
                    <div v-if="loadingLogs" class="text-gray-500">載入中…</div>
                    <div v-else>
                        <div v-if="!logs.length" class="text-gray-500">尚無紀錄</div>
                        <div v-else>
                            <div class="hidden sm:block overflow-x-auto">
                                <table class="min-w-[720px] w-full text-sm table-default">
                                    <thead>
                                        <tr class="bg-gray-50 text-left">
                                            <th class="px-3 py-2 border">時間</th>
                                            <th class="px-3 py-2 border">行為</th>
                                            <th class="px-3 py-2 border">票券ID</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="row in logs" :key="row.id" class="hover:bg-gray-50">
                                            <td class="px-3 py-2 border whitespace-nowrap">{{ fmtTime(row.created_at) }}
                                            </td>
                                            <td class="px-3 py-2 border">{{ logText(row) }}</td>
                                            <td class="px-3 py-2 border font-mono whitespace-nowrap">#{{ row.ticket_id
                                                }}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div class="sm:hidden flex flex-col gap-3">
                                <article v-for="row in logs" :key="row.id" class="log-card">
                                    <header class="log-card__header">
                                        <span class="log-card__time">{{ fmtTime(row.created_at) }}</span>
                                        <span class="log-card__badge">ID #{{ row.ticket_id }}</span>
                                    </header>
                                    <p class="log-card__text">{{ logText(row) }}</p>
                                    <footer class="log-card__footer"
                                        v-if="row.meta?.method || row.meta?.event || row.meta?.store">
                                        <span v-if="row.meta?.method" class="log-card__tag">
                                            {{ row.meta.method === 'qr' ? 'QR 即時轉贈' : row.meta.method === 'email' ?
                                            'Email 轉贈' :
                                            row.meta.method }}
                                        </span>
                                        <span v-if="row.meta?.event" class="log-card__tag">
                                            活動：{{ row.meta.event }}
                                        </span>
                                        <span v-if="row.meta?.store" class="log-card__tag">
                                            門市：{{ row.meta.store }}
                                        </span>
                                    </footer>
                                </article>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 轉贈 QR Bottom Sheet（出示給對方掃） -->
            <AppBottomSheet v-model="qrSheet.open">
                <div class="text-center">
                    <h3 class="text-lg font-bold text-primary mb-2">出示 QR 轉贈</h3>
                    <div v-if="qrSheet.code" class="flex flex-col items-center gap-2">
                        <qrcode-vue :value="qrSheet.code" :size="180" level="M" />
                        <div class="flex items-center gap-2 text-lg font-mono tracking-widest text-primary">
                            <span>{{ qrSheet.code }}</span>
                            <button class="btn-ghost" title="複製轉贈碼" @click="copyText(qrSheet.code)">
                                <AppIcon name="copy" class="h-4 w-4" />
                            </button>
                        </div>
                        <p class="text-xs text-gray-600">請對方於錢包頁點擊「掃描轉贈」掃此 QR</p>
                    </div>
                    <div v-else class="text-gray-500">生成中…</div>
                </div>
            </AppBottomSheet>

            <!-- 接收方：待處理轉贈（全局底部抽屜，一張張顯示） -->
            <AppBottomSheet v-model="incoming.open" :closable="false" :close-on-backdrop="false">
                <h3 class="text-lg font-bold text-primary mb-2">收到票券轉贈</h3>
                <div v-if="incoming.current" class="space-y-2 text-sm text-gray-800">
                    <p><strong>來自：</strong>{{ incoming.current.from_email || incoming.current.from_username }}</p>
                    <p><strong>票券：</strong>{{ incoming.current.type }}</p>
                    <p><strong>到期：</strong>{{ formatDate(incoming.current.expiry) }}</p>
                    <div class="mt-3 flex gap-2">
                        <button class="btn btn-primary" @click="acceptCurrentTransfer">接受</button>
                        <button class="btn btn-outline" @click="declineCurrentTransfer">不接受</button>
                    </div>
                </div>
                <div v-else class="text-gray-500">沒有待處理的轉贈</div>
            </AppBottomSheet>

            <!-- 掃描轉贈（接收方） -->
            <AppBottomSheet v-model="scan.open" @close="closeScan">
                <div class="scan-sheet">
                    <header class="scan-header">
                        <h3 class="scan-title">掃描票券轉贈</h3>
                        <p class="scan-subtitle">將 QR 對準框線，完成後票券會自動加入您的皮夾。</p>
                    </header>

                    <div class="scan-body">
                        <section class="scan-camera">
                            <div class="camera-wrapper">
                                <video ref="scanVideo" autoplay playsinline class="camera-video"></video>
                                <div class="scan-frame"></div>
                                <div v-if="scan.scanning" class="scan-laser"></div>
                            </div>
                            <p class="camera-hint">若掃描未成功，可請對方重新顯示 QR 碼。</p>
                        </section>

                        <section class="scan-manual">
                            <h4 class="manual-title">輸入轉贈碼</h4>
                            <div class="manual-input">
                                <input v-model.trim="scan.manual" placeholder="輸入 6 碼轉贈碼" class="manual-field" />
                                <button class="btn btn-primary" @click="claimByCode"
                                    :disabled="!scan.manual">認領</button>
                            </div>
                            <p class="manual-note">請確認與對方同步最新轉贈碼，以避免重複使用。</p>
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
    import { useRouter, useRoute } from 'vue-router'
    import QrcodeVue from 'qrcode.vue'
    import axios from '../api/axios'
    import AppIcon from '../components/AppIcon.vue'
    import AppBottomSheet from '../components/AppBottomSheet.vue'
    import { startQrScanner } from '../utils/qrScanner'
    import { showNotice, showConfirm, showPrompt } from '../utils/sheet'
    import { useSwipeRegistry } from '../composables/useSwipeRegistry'
    import { useIsMobile } from '../composables/useIsMobile'
    import { formatDateTime } from '../utils/datetime'

    const API = 'https://api.xiaozhi.moe/uat/leader_online'
    const router = useRouter()
    const route = useRoute()
    const user = JSON.parse(localStorage.getItem('user_info') || 'null')
    const { registerSwipeHandlers, getBinding } = useSwipeRegistry()
    const mainSwipeBinding = getBinding('wallet-main')
    const { isMobile } = useIsMobile(768)

    const tabs = [
        { key: 'tickets', label: '我的票券', icon: 'ticket' },
        { key: 'reservations', label: '我的預約', icon: 'orders' },
        { key: 'logs', label: '紀錄', icon: 'copy' },
    ]
    const activeTab = ref('tickets')
    const activeTabIndex = ref(0)
    const findTabIndex = (key) => tabs.findIndex(tab => tab.key === key)
    const reservationsTabIndex = computed(() => findTabIndex('reservations'))
    const updateRouteTabQuery = (key) => {
        const current = typeof route.query.tab === 'string' ? route.query.tab : ''
        if (current === key) return
        router.replace({
            query: { ...route.query, tab: key }
        })
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
        if (key === 'logs') loadLogs()
        if (!skipRouteSync) updateRouteTabQuery(key)
    }
    const tabCount = computed(() => tabs.length)
    const indicatorStyle = computed(() => ({ left: `${activeTabIndex.value * (100 / tabCount.value)}%`, width: `${100 / tabCount.value}%` }))
    watch(() => route.query.tab, (value) => {
        const target = typeof value === 'string' ? value : ''
        if (!target) return
        const index = findTabIndex(target)
        if (index === -1) return
        if (activeTab.value !== target) {
            setActiveTab(target, index, { skipRouteSync: true })
        }
    })

    const activeFilterClass = 'px-4 py-2 btn btn-primary text-white font-medium'
    const defaultFilterClass = 'px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200'
    let incomingPollingTimer = null
    let incomingLoading = false

    // 票券資料
    const tickets = ref([])
    const loadingTickets = ref(true)
    const totalTickets = computed(() => tickets.value.length)
    const availableTickets = computed(() => tickets.value.filter(t => !t.used).length)
    const usedTickets = computed(() => tickets.value.filter(t => t.used).length)

    const filter = ref('available')
    const ticketSearch = ref('')
    const filteredTickets = computed(() => {
        let list = tickets.value
        if (filter.value === 'available') {
            list = list.filter(t => !t.used)
        } else if (filter.value === 'used') {
            list = list.filter(t => t.used)
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
    const promptEmail = async (msg) => {
        const v = await showPrompt(msg || '請輸入對方 Email', { title: '轉贈票券', placeholder: '對方 Email', inputType: 'email', confirmText: '送出' }).catch(() => null)
        return (v || '').trim();
    }
    const copyText = (t) => { try { if (t) navigator.clipboard?.writeText(String(t)) } catch { } }

    const normalizeTicket = (raw) => {
        if (!raw || typeof raw !== 'object') return raw
        const id = raw.id ?? raw.ticket_id ?? raw.ticketId
        return { ...raw, id }
    }

    const resolveTicketId = (ticket) => {
        const id = ticket?.id ?? ticket?.ticket_id ?? ticket?.ticketId
        const n = Number(id)
        return Number.isFinite(n) && n > 0 ? n : null
    }

    const loadTickets = async () => {
        try {
            const { data } = await axios.get(`${API}/tickets/me`)
            const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
            tickets.value = list.map(normalizeTicket)
        } catch (err) { await showNotice(err?.response?.data?.message || err.message, { title: '錯誤' }) }
        finally { loadingTickets.value = false }
    }

    // ===== 票券紀錄 =====
    const logs = ref([])
    const loadingLogs = ref(false)
    const loadLogs = async () => {
        if (loadingLogs.value) return
        loadingLogs.value = true
        try {
            const { data } = await axios.get(`${API}/tickets/logs`, { params: { limit: 200 } })
            logs.value = Array.isArray(data?.data) ? data.data : []
        } catch (e) { /* ignore */ }
        finally { loadingLogs.value = false }
    }
    const fmtTime = (t) => formatDateTime(t)
    const logText = (row) => {
        const a = String(row.action || '')
        const m = row.meta || {}
        const type = m.ticket_type || m.type || ''
        if (a === 'issued') return `取得票券（購買） - ${type}`
        if (a === 'transferred_in') return `收到轉贈 - ${type}${m.from_email ? `，來自：${m.from_email}` : ''}`
        if (a === 'transferred_out') return `已轉贈 - ${type}${m.to_email ? `，給：${m.to_email}` : ''}`
        if (a === 'used') return `已使用 - ${type}`
        return `${a} - ${type}`
    }

    // ===== 轉贈：發起（Email / QR） =====
    const qrSheet = ref({ open: false, code: '' })
    const startTransferEmail = async (ticket) => {
        const email = await promptEmail('請輸入對方 Email（轉贈）')
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
        qrSheet.value = { open: true, code: '' }
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
                if (await showConfirm('已有待處理的轉贈，是否取消並重新產生 QR？', { title: '重新產生 QR' })) {
                    try {
                        await axios.post(`${API}/tickets/transfers/cancel_pending`, { ticketId })
                        qrSheet.value = { open: true, code: '' }
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
    // 六階段預約狀態（代碼、顯示與顏色）
    const CHECKLIST_STAGE_KEYS = ['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup']
    const reservationStatusList = [
        { key: 'pre_dropoff', shortLabel: '賽前交車', label: '賽前交車', color: 'bg-yellow-100 text-yellow-700' },
        { key: 'pre_pickup', shortLabel: '賽前取車', label: '賽前取車', color: 'bg-blue-100 text-blue-700' },
        { key: 'post_dropoff', shortLabel: '賽後交車', label: '賽後交車', color: 'bg-indigo-100 text-indigo-700' },
        { key: 'post_pickup', shortLabel: '賽後取車', label: '賽後取車', color: 'bg-blue-100 text-blue-700' },
        { key: 'done', shortLabel: '完成', label: '完成', color: 'bg-green-100 text-green-700' },
    ]
    const statusLabelMap = Object.fromEntries(reservationStatusList.map(s => [s.key, s.label]))
    const statusColorMap = Object.fromEntries(reservationStatusList.map(s => [s.key, s.color]))

    const toOptionalNumber = (value) => {
        if (value === null || value === undefined || value === '') return null
        const n = Number(value)
        return Number.isFinite(n) ? n : null
    }
    const toStageCodeString = (value) => {
        if (value === undefined || value === null) return null
        const text = String(value).trim()
        return text ? text : null
    }
    const buildStageCodeMap = (record) => {
        const base = {
            pre_dropoff: null,
            pre_pickup: null,
            post_dropoff: null,
            post_pickup: null
        }
        if (!record || typeof record !== 'object') return base
        const existing = (record.stageCodes && typeof record.stageCodes === 'object') ? record.stageCodes : {}
        return {
            pre_dropoff: toStageCodeString(existing.pre_dropoff ?? record.verify_code_pre_dropoff),
            pre_pickup: toStageCodeString(existing.pre_pickup ?? record.verify_code_pre_pickup),
            post_dropoff: toStageCodeString(existing.post_dropoff ?? record.verify_code_post_dropoff),
            post_pickup: toStageCodeString(existing.post_pickup ?? record.verify_code_post_pickup)
        }
    }
    const getReservationStageCode = (reservation, stageOverride = null) => {
        if (!reservation) return null
        const stage = stageOverride || reservation.status
        if (!stage) return null
        const codes = buildStageCodeMap(reservation)
        if (codes[stage]) return codes[stage]
        const fallbackList = Object.values(codes).filter(Boolean)
        if (fallbackList.length) return fallbackList[0]
        return toStageCodeString(reservation.verifyCode)
    }

    const stageChecklistDefinitions = {
        pre_dropoff: {
            title: '賽前交車檢核表',
            description: '交付單車前請與店員確認托運內容並完成點交紀錄。',
            items: [
                '車輛與配件與預約資訊相符',
                '托運文件、標籤與聯絡方式已確認',
                '完成車況拍照（含序號、特殊配件）'
            ],
            confirmText: '檢核完成，顯示 QR Code'
        },
        pre_pickup: {
            title: '賽前取車檢核表',
            description: '請與店員逐項確認車輛與文件，完成後即可出示 QR Code。',
            items: [
                '車輛外觀、輪胎與配件無異常',
                '車牌、證件與隨車用品已領取',
                '與店員完成車況紀錄或拍照存證'
            ],
            confirmText: '檢核完成，顯示 QR Code'
        },
        post_dropoff: {
            title: '賽後交車檢核表',
            description: '賽後返還托運時，請與店員再次確認車況與交車資訊。',
            items: [
                '車輛完整停放於指定區域並妥善固定',
                '與店員核對賽後車況與隨車用品',
                '拍攝交車現場與車況照片備查'
            ],
            confirmText: '檢核完成，顯示 QR Code'
        },
        post_pickup: {
            title: '賽後取車檢核表',
            description: '確認賽後車況與點交內容，完成後才會顯示 QR Code。',
            items: [
                '車輛外觀無新增損傷與污漬',
                '賽前寄存的隨車用品已領回',
                '與店員完成賽後車況點交紀錄'
            ],
            confirmText: '檢核完成，顯示 QR Code'
        }
    }
    const CHECKLIST_PHOTO_LIMIT = 6
    const ensureChecklistHasPhotos = (data) => Array.isArray(data?.photos) && data.photos.length > 0
    const normalizeStageChecklist = (stage, raw) => {
        const def = stageChecklistDefinitions[stage] || { items: [] }
        const base = raw && typeof raw === 'object' ? raw : {}
        const items = Array.isArray(base.items) ? base.items : []
        const defItems = Array.isArray(def.items) ? def.items : []
        const normalizedItems = defItems.length
            ? defItems.map(label => {
                const existed = items.find(item => item && item.label === label)
                return { label, checked: existed ? !!existed.checked : false }
            })
            : items.map(item => ({ label: item?.label || String(item?.text || ''), checked: !!item?.checked })).filter(i => i.label)
        const photos = Array.isArray(base.photos) ? base.photos.map(photo => ({
            id: photo.id,
            url: photo.url,
            mime: photo.mime,
            originalName: photo.originalName,
            uploadedAt: photo.uploadedAt,
            size: photo.size
        })).filter(photo => photo.id && photo.url) : []
        return {
            items: normalizedItems,
            photos,
            completed: !!base.completed,
            completedAt: base.completedAt || null
        }
    }
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
    // 依狀態回傳「交車」或「取車」字樣，用於動態標籤
    const phaseLabel = (s) => (String(s || '').includes('pickup') ? '取車' : '交車')
    const reservationActionLabel = (status) => {
        const value = String(status || '')
        if (value === 'done') return '已完成'
        if (value.includes('pickup')) return '我要取車'
        if (value.includes('dropoff')) return '我要交車'
        return '查看詳情'
    }

    const requiresChecklistBeforeQr = (stage) => CHECKLIST_STAGE_KEYS.includes(stage)
    const checklistFriendlyName = (stage) => {
        const map = {
            pre_dropoff: '賽前交車檢核',
            pre_pickup: '賽前取車檢核',
            post_dropoff: '賽後交車檢核',
            post_pickup: '賽後取車檢核'
        }
        return map[stage] || '檢核'
    }
    const coerceChecklistBoolean = (value) => {
        if (typeof value === 'boolean') return value
        if (typeof value === 'number') return Number.isFinite(value) ? value > 0 : false
        if (value instanceof Date) return true
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase()
            if (!normalized) return false
            const positive = ['1', 'true', 'yes', 'y', 'done', 'completed', 'complete', 'finished', 'ok', 'pass', 'passed', '已完成', '完成', '已檢核', '已檢查']
            const negative = ['0', 'false', 'no', 'n', 'pending', 'incomplete', 'todo', 'none', 'null', 'undefined', '未完成', '尚未完成', '待處理', '未檢核', '未檢查']
            if (positive.includes(normalized)) return true
            if (negative.includes(normalized)) return false
            if (/^\d+$/.test(normalized)) return Number(normalized) > 0
            return true
        }
        return !!value
    }
    const detectStageChecklistStatus = (record, stage) => {
        if (!record || !stage) return { found: false, completed: false }
        const stageSnake = String(stage || '').toLowerCase()
        const stagePlain = stageSnake.replace(/_/g, '')
        const keys = Object.keys(record || {})
        for (const key of keys) {
            const lower = key.toLowerCase()
            const matchesStage = lower.includes(stageSnake) || lower.includes(stagePlain)
            if (!matchesStage) continue
            const matchesCategory = ['check', 'inspect', 'verify', 'confirm'].some(marker => lower.includes(marker))
            if (!matchesCategory) continue
            const val = record[key]
            if (val === undefined || val === null || val === '') continue
            if (typeof val === 'object') continue
            return { found: true, completed: coerceChecklistBoolean(val) }
        }
        return { found: false, completed: false }
    }

    const isStageChecklistCompleted = (reservation, stage) => {
        if (!reservation || !stage) return false
        const stageInfo = reservation.stageChecklist?.[stage]
        if (stageInfo?.completed) return true
        const checklist = reservation.checklists?.[stage]
        return !!checklist?.completed
    }
    const parseReservationDate = (value) => {
        if (!value) return null
        const direct = new Date(value)
        if (!Number.isNaN(direct.getTime())) return direct
        const normalized = new Date(String(value).replace(/-/g, '/'))
        if (!Number.isNaN(normalized.getTime())) return normalized
        return null
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
            reservations.value = raw.map(r => {
                const status = toNewStatus(r.status)
                const stageCodes = buildStageCodeMap(r)
                const stageFromServer = r.stage_checklist && typeof r.stage_checklist === 'object' ? r.stage_checklist : {}
                const checklists = {}
                CHECKLIST_STAGE_KEYS.forEach(stage => {
                    const rawChecklist = r?.[`${stage}_checklist`] || r?.checklists?.[stage] || {}
                    checklists[stage] = normalizeStageChecklist(stage, rawChecklist)
                })
                const stageChecklist = {}
                CHECKLIST_STAGE_KEYS.forEach(stage => {
                    const serverInfo = stageFromServer[stage]
                    if (serverInfo) {
                        stageChecklist[stage] = {
                            found: !!serverInfo.found,
                            completed: !!serverInfo.completed
                        }
                    } else {
                        const fallback = detectStageChecklistStatus(r, stage)
                        const hasPhotos = ensureChecklistHasPhotos(checklists[stage])
                        stageChecklist[stage] = {
                            found: fallback.found ? true : hasPhotos,
                            completed: fallback.completed ? true : !!checklists[stage]?.completed
                        }
                    }
                })
                const fallbackCodes = [
                    stageCodes.pre_dropoff,
                    stageCodes.pre_pickup,
                    stageCodes.post_dropoff,
                    stageCodes.post_pickup,
                    toStageCodeString(r.verify_code)
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
                    stageCodes
                }
            })
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
        const backend = reservation?.checklists?.[stage] || normalizeStageChecklist(stage, {})
        const items = def.items.map(label => {
            const found = backend.items?.find(item => item && item.label === label)
            return { label, checked: !!found?.checked }
        })
        const photos = Array.isArray(backend.photos) ? backend.photos : []
        const completed = !!backend.completed
        if (!stageChecklistState[key]) {
            stageChecklistState[key] = reactive({
                items,
                photos: [...photos],
                completed,
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
            if (!current.uploading) {
                current.uploadMessage = ''
                current.uploadProgress = 0
            }
        }
    }
    const openReservationModal = (reservation) => {
        selectedReservation.value = reservation
        prepareStageChecklist(reservation)
        showModal.value = true
    }
    const closeModal = () => showModal.value = false
    const goToNextReservationAction = () => {
        const target = nextActionReservation.value
        if (!target) return
        const index = reservationsTabIndex.value
        setActiveTab('reservations', index >= 0 ? index : 1)
        openReservationModal(target)
    }
    const fileToDataUrl = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error || new Error('檔案讀取失敗'))
        reader.readAsDataURL(file)
    })
    const syncReservationChecklist = (reservationId, stage, checklist) => {
        const normalized = normalizeStageChecklist(stage, checklist)
        const applyToReservation = (reservation) => {
            if (!reservation) return
            if (!reservation.checklists) reservation.checklists = {}
            reservation.checklists[stage] = normalized
            if (!reservation.stageChecklist) reservation.stageChecklist = {}
            reservation.stageChecklist[stage] = {
                found: ensureChecklistHasPhotos(normalized),
                completed: !!normalized.completed
            }
        }
        const target = reservations.value.find(r => String(r.id) === String(reservationId))
        applyToReservation(target)
        if (selectedReservation.value && String(selectedReservation.value.id) === String(reservationId)) {
            applyToReservation(selectedReservation.value)
            const key = stageChecklistKey(selectedReservation.value)
            if (key && stageChecklistState[key]) {
                const state = stageChecklistState[key]
                state.items.splice(0, state.items.length, ...normalized.items)
                state.photos.splice(0, state.photos.length, ...normalized.photos)
                state.completed = !!normalized.completed
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
                syncReservationChecklist(reservation.id, stage, payload.checklist || {})
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
                syncReservationChecklist(reservation.id, stage, payload.checklist || {})
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
        const active = activeStageChecklist.value
        if (active && active.completed) return true
        const stageInfo = res.stageChecklist?.[status]
        if (stageInfo?.completed) return true
        const fallback = res.checklists?.[status]
        return !!fallback?.completed
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
        const stageInfo = res.stageChecklist?.[status]
        if (stageInfo?.completed) return ''
        const label = checklistFriendlyName(status)
        if (stageInfo?.found) return `${label}尚未完成，完成後才會顯示 QR Code。`
        return `請先完成${label}，完成後才會顯示 QR Code。`
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
                await showNotice('✅ 檢核完成，已顯示 QR Code')
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

    onMounted(() => {
        if (user) {
            loadTickets()
            loadReservations()
            loadIncomingTransfers()
            if (!incomingPollingTimer) {
                incomingPollingTimer = setInterval(loadIncomingTransfers, 5000)
            }
        }
        const init = typeof route.query.tab === 'string' ? route.query.tab : ''
        if (init) {
            const idx = findTabIndex(init)
            if (idx !== -1) {
                setActiveTab(init, idx, { skipRouteSync: true, force: true })
            }
        }
    })
    onUnmounted(() => {
        if (incomingPollingTimer) {
            clearInterval(incomingPollingTimer)
            incomingPollingTimer = null
        }
    })

    // ===== 接收方：待處理轉贈（底部抽屜，逐一處理） =====
    const incoming = ref({ open: false, list: [], current: null })
    const loadIncomingTransfers = async () => {
        if (incomingLoading) return
        incomingLoading = true
        try {
            const { data } = await axios.get(`${API}/tickets/transfers/incoming`)
            const list = Array.isArray(data?.data) ? data.data : []
            incoming.value.list = list
            incoming.value.current = list[0] || null
            incoming.value.open = !!incoming.value.current
        } catch (e) { /* ignore */ }
        finally { incomingLoading = false }
    }
    const shiftIncoming = () => {
        incoming.value.list.shift()
        incoming.value.current = incoming.value.list[0] || null
        incoming.value.open = !!incoming.value.current
    }
    const acceptCurrentTransfer = async () => {
        const it = incoming.value.current; if (!it) return
        try {
            const { data } = await axios.post(`${API}/tickets/transfers/${it.id}/accept`)
            if (data?.ok) { await loadTickets(); shiftIncoming() }
            else await showNotice(data?.message || '接受失敗', { title: '接受失敗' })
        } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
    }
    const declineCurrentTransfer = async () => {
        const it = incoming.value.current; if (!it) return
        try {
            const { data } = await axios.post(`${API}/tickets/transfers/${it.id}/decline`)
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
            const { data } = await axios.post(`${API}/tickets/transfers/claim_code`, { code })
            if (data?.ok) { await showNotice('✅ 已認領票券'); await loadTickets(); closeScan() }
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

<style scoped>
    /* moved common styles to global style.css: .ticket-card:hover, .tab-indicator */

    .slide-in {
        animation: slideIn 0.5s ease-out;
    }

    @keyframes slideIn {
        from {
            transform: translateY(20px);
            opacity: 0;
        }

        to {
            transform: translateY(0);
            opacity: 1;
        }
    }

    @keyframes fadeInScale {
        from {
            transform: scale(0.9);
            opacity: 0;
        }

        to {
            transform: scale(1);
            opacity: 1;
        }
    }

    .animate-fade-in {
        animation: fadeInScale 0.3s ease-out;
    }

    /* Bottom sheet + backdrop transitions */
    .fade-enter-active,
    .fade-leave-active {
        transition: opacity .2s ease;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }

    .sheet-enter-active,
    .sheet-leave-active {
        transition: transform .25s ease;
    }

    .sheet-enter-from,
    .sheet-leave-to {
        transform: translateY(100%);
    }

    .scan-sheet {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }

    .scan-header {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        padding: 1.25rem 1rem;
        border: 1px solid #e5e7eb;
        background: #fff;
        border-radius: 0;
    }

    .scan-title {
        font-size: 1.05rem;
        font-weight: 700;
        color: #1f2937;
        margin: 0;
    }

    .scan-subtitle {
        margin: 0;
        font-size: 0.88rem;
        color: #4b5563;
        line-height: 1.5;
    }

    .scan-body {
        display: grid;
        gap: 1.25rem;
    }

    @media (min-width: 768px) {
        .scan-body {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }

    .camera-wrapper {
        position: relative;
        border: 1px solid #e5e7eb;
        border-radius: 0;
        overflow: hidden;
        background: #111827;
        aspect-ratio: 16 / 10;
    }

    .camera-video {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .scan-frame {
        position: absolute;
        inset: 8%;
        border: 2px solid rgba(255, 255, 255, 0.55);
        border-radius: 0;
        box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.35);
        pointer-events: none;
    }

    .scan-laser {
        position: absolute;
        left: 16%;
        right: 16%;
        height: 2px;
        background: linear-gradient(90deg, transparent, rgba(217, 0, 0, 0.9), transparent);
        animation: scanSweep 1.8s ease-in-out infinite;
    }

    @keyframes scanSweep {
        0% {
            top: 18%;
        }

        50% {
            top: 82%;
        }

        100% {
            top: 18%;
        }
    }

    .camera-hint {
        margin-top: 0.75rem;
        font-size: 0.82rem;
        color: #6b7280;
    }

    .scan-manual {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1rem;
        border: 1px solid #e5e7eb;
        border-radius: 0;
        background: #fff;
    }

    .manual-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0;
    }

    .manual-input {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
    }

    .manual-field {
        flex: 1;
        border: 1px solid #d1d5db;
        border-radius: 0;
        padding: 0.75rem 1rem;
        font-size: 0.95rem;
        min-width: 0;
    }

    .manual-field:focus {
        outline: none;
        border-color: #d90000;
        box-shadow: inset 0 0 0 1px rgba(217, 0, 0, 0.4);
    }

    .manual-note {
        margin: 0;
        font-size: 0.82rem;
        color: #6b7280;
    }

    .upload-overlay {
        position: absolute;
        inset: 0;
        background: rgba(255, 255, 255, 0.88);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 5;
        padding: 1rem;
        backdrop-filter: blur(2px);
    }

    .upload-overlay__content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        text-align: center;
    }

    .upload-spinner {
        width: 2rem;
        height: 2rem;
        border-radius: 9999px;
        border: 3px solid rgba(217, 0, 0, 0.25);
        border-top-color: #d90000;
        animation: uploadSpin 0.8s linear infinite;
    }

    .upload-overlay__text {
        font-size: 0.85rem;
        color: #b91c1c;
        font-weight: 600;
        letter-spacing: 0.02em;
    }

    .upload-progress {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.35rem;
        width: 100%;
        max-width: 200px;
    }

    .upload-progress__bar {
        width: 100%;
        height: 0.35rem;
        background: rgba(17, 24, 39, 0.12);
        border-radius: 999px;
        overflow: hidden;
    }

    .upload-progress__fill {
        height: 100%;
        background: #d90000;
        transition: width 0.25s ease;
    }

    .upload-progress__value {
        font-size: 0.75rem;
        color: #6b7280;
    }

    @keyframes uploadSpin {
        from {
            transform: rotate(0deg);
        }

        to {
            transform: rotate(360deg);
        }
    }

    button,
    .ticket-card,
    .bg-white,
    .shadow-lg {
        border-radius: 0 !important;
    }

    .log-card {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        border: 1px solid #e5e7eb;
        background: #fff;
        padding: 1rem;
        box-shadow: 0 6px 18px rgba(17, 24, 39, 0.06);
    }

    .log-card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
    }

    .log-card__time {
        font-size: 0.9rem;
        font-weight: 600;
        color: #111827;
    }

    .log-card__badge {
        font-size: 0.75rem;
        font-weight: 600;
        color: #1f2937;
        background-color: #f3f4f6;
        padding: 0.25rem 0.5rem;
        border-radius: 9999px;
        letter-spacing: 0.02em;
    }

    .log-card__text {
        font-size: 0.95rem;
        line-height: 1.5;
        color: #374151;
    }

    .log-card__footer {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-top: 0.25rem;
    }

    .log-card__tag {
        font-size: 0.7rem;
        font-weight: 500;
        color: #374151;
        background-color: #f9fafb;
        border: 1px solid #e5e7eb;
        padding: 0.2rem 0.6rem;
        border-radius: 9999px;
    }
</style>
