<template>
  <CourseCenterShell
    v-if="productizedTask"
    title="我的課程中心"
    description="管理計次票、固定班課表、請假補課、續報、訂單與站內通知。"
    eyebrow="會員課程"
    :tasks="memberCourseTasks"
    :active-key="memberTask.key"
    nav-label="會員課程任務"
  >
    <template v-if="memberTask.sharedRecord" #context>
      <div class="rounded-lg bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
        <strong class="text-slate-900">共用紀錄、課程分類：</strong>{{ memberTask.sharedRecord === 'orders' ? '付款審核、限時占位與發券狀態沿用分類式訂單紀錄。' : '剩餘、保留、可用、暫停與轉讓沿用分類式票券紀錄。' }}
      </div>
    </template>

    <template v-if="productizedApiTask">
      <section class="space-y-4" :aria-labelledby="`member-course-${memberTask.key}`">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 :id="`member-course-${memberTask.key}`" class="ui-title text-xl text-slate-950">{{ memberTask.label }}</h2><p class="mt-1 text-sm leading-6 text-slate-600">{{ productizedTaskDescription }}</p></div><button type="button" class="btn btn-outline" :disabled="productizedLoading" @click="loadProductizedData">{{ productizedLoading ? '載入中…' : '重新載入' }}</button></div>
        <p v-if="productizedActionNotice" class="rounded-xl border px-4 py-3 text-sm" :class="productizedActionTone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'" :role="productizedActionTone === 'error' ? 'alert' : 'status'" :aria-live="productizedActionTone === 'error' ? 'assertive' : 'polite'" aria-atomic="true">{{ productizedActionNotice }}</p>
        <CourseResourceState
          :loading="productizedLoading"
          :error="productizedError"
          :empty="!productizedItems.length && !(memberTask.key === 'enrollments' && productizedWaitlistOffers.length)"
          :has-content="Boolean(productizedItems.length || (memberTask.key === 'enrollments' && productizedWaitlistOffers.length))"
          :empty-text="productizedEmptyText"
          @retry="loadProductizedData"
        >
        <div v-if="memberTask.key === 'notifications'" class="course-result-list course-result-list--wide">
          <article v-for="item in productizedItems" :key="item.id" class="ticket-card flex flex-col gap-4 p-5" :class="item.readAt ? '' : 'border-primary/40 bg-primary/[0.025]'">
            <header class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="text-xs text-slate-500">{{ formatDateTime(item.createdAt) }}</p><h3 class="ui-title mt-1 text-xl text-slate-950">{{ item.title || '課程通知' }}</h3></div><span class="ops-chip" :class="item.readAt ? 'ops-chip-info' : 'ops-chip-warning'">{{ item.readAt ? '已讀' : '未讀' }}</span></header>
            <p class="whitespace-pre-line text-sm leading-6 text-slate-700">{{ item.body || '請點選查看詳情。' }}</p>
            <div class="mt-auto grid gap-2 border-t border-slate-100 pt-4" :class="notificationActionPath(item) && !item.readAt ? 'sm:grid-cols-2' : ''">
              <router-link v-if="notificationActionPath(item)" :to="notificationActionPath(item)" class="btn btn-outline w-full">查看相關資料</router-link>
              <button v-if="!item.readAt" type="button" class="btn btn-primary w-full text-white" :disabled="productizedActionSaving" @click="markNotificationRead(item)">標示為已讀</button>
            </div>
          </article>
        </div>
        <div v-else class="course-result-list course-result-list--wide">
          <article v-for="offer in (memberTask.key === 'enrollments' ? productizedWaitlistOffers : [])" :key="`waitlist-offer-${offer.id}`" class="course-result-list__item ticket-card flex flex-col gap-4 border-amber-200 bg-amber-50 p-5"><header class="flex items-start justify-between gap-3"><div><p class="text-xs text-amber-800">限時候補名額</p><h3 class="ui-title mt-1 text-xl text-slate-950">{{ offer.termName || offer.term_name || '固定班候補' }}</h3></div><span class="ops-chip ops-chip-warning">{{ productizedStatusLabel(offer) }}</span></header><div class="flex flex-wrap items-center gap-2 text-sm text-amber-900"><span>席位保留至 {{ formatDateTime(offer.expiresAt || offer.expires_at) }}</span><span class="ops-chip" :class="deadlineChipClass(offer.expiresAt || offer.expires_at)">{{ deadlineState(offer.expiresAt || offer.expires_at).label }}</span></div><p class="text-sm text-amber-900">接受後還需完成伺服器報價與結帳。</p><div v-if="String(offer.status).toUpperCase() === 'OFFERED'" class="mt-auto grid grid-cols-2 gap-2 border-t border-amber-200 pt-4"><button type="button" class="btn btn-primary interactive-press text-white" :disabled="productizedActionSaving || deadlineState(offer.expiresAt || offer.expires_at).expired" @click="actOnWaitlistOffer(offer, 'accept')">接受名額</button><button type="button" class="btn btn-outline interactive-press bg-white" :disabled="productizedActionSaving" @click="actOnWaitlistOffer(offer, 'decline')">放棄名額</button></div><router-link v-else-if="String(offer.status).toUpperCase() === 'ACCEPTED'" :to="courseTermCheckoutPath(offer.termId || offer.term_id)" class="btn btn-primary interactive-press mt-auto w-full text-white">前往報價結帳</router-link></article>
          <article v-for="item in productizedItems" :key="item.id || item.code" class="ticket-card flex flex-col gap-4 p-5">
            <header class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="text-xs text-slate-500">{{ item.code || item.sessionCode || item.session_code || '課程紀錄' }}</p><h3 class="ui-title mt-1 text-xl text-slate-950">{{ productizedItemTitle(item) }}</h3></div><span class="ops-chip" :class="productizedStatusClass(item)">{{ productizedStatusLabel(item) }}</span></header>
            <dl class="grid grid-cols-2 gap-3 text-sm"><div><dt class="text-slate-500">時間</dt><dd class="mt-1 text-slate-900">{{ formatRange(item.startsAt || item.starts_at || item.startsOn || item.starts_on || item.sourceStartsAt, item.endsAt || item.ends_at || item.endsOn || item.ends_on) }}</dd></div><div><dt class="text-slate-500">服務商</dt><dd class="mt-1 text-slate-900">{{ providerLabel(item) }}</dd></div><div v-if="item.remainingSessions != null || item.remaining_sessions != null"><dt class="text-slate-500">固定堂次權益</dt><dd class="stat-number mt-1 text-xl text-primary">{{ item.remainingSessions ?? item.remaining_sessions }} 堂</dd></div><div v-if="item.validUntil || item.valid_until || item.expiresAt || item.expires_at"><dt class="text-slate-500">有效期限</dt><dd class="mt-1 text-slate-900">{{ formatDate(item.validUntil || item.valid_until || item.expiresAt || item.expires_at) }}</dd></div></dl>
            <p v-if="memberTask.key === 'makeup'" class="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">有效請假會保留補課權益；開放水域場次若需保險，須在限時匯款完成後才確認補課席位。</p>
            <p v-if="item.payByAt || item.pay_by_at" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">席位保留至 {{ formatDateTime(item.payByAt || item.pay_by_at) }}，逾期會自動釋出並推進候補。</p>
            <div class="mt-auto space-y-3 border-t border-slate-100 pt-4">
              <template v-if="memberTask.key === 'schedule' && canRequestTermLeave(item)">
                <button v-if="productizedActionOpen !== `leave-${item.id}`" type="button" class="btn btn-outline w-full" @click="productizedActionOpen = `leave-${item.id}`">申請請假</button>
                <form v-else class="space-y-3" @submit.prevent="requestTermLeave(item)">
                  <label class="block space-y-2 text-sm font-medium text-slate-700">請假原因<textarea v-model.trim="productizedReasons[item.id]" rows="2" maxlength="500" class="w-full" placeholder="請簡述原因（選填）"></textarea></label>
                  <div class="grid grid-cols-2 gap-2"><button type="button" class="btn btn-outline" @click="productizedActionOpen = ''">取消</button><button class="btn btn-primary text-white" :disabled="productizedActionSaving">確認請假</button></div>
                </form>
              </template>
              <button v-if="memberTask.key === 'schedule' && canCancelTermLeave(item)" type="button" class="btn btn-outline w-full text-red-700" :disabled="productizedActionSaving" @click="cancelTermLeave(item)">取消原請假</button>

              <template v-if="memberTask.key === 'makeup' && canUseMakeup(item)">
                <label class="block space-y-2 text-sm font-medium text-slate-700">目標補課場次
                  <select v-model="productizedTargets[item.id]" class="w-full" :disabled="!item.targetSessions?.length">
                    <option value="">{{ item.targetSessions?.length ? '請選擇場次' : '目前沒有可預約場次' }}</option>
                    <option v-for="session in item.targetSessions" :key="session.id" :value="String(session.id)">{{ session.title || session.code }}・{{ formatDateTime(session.startsAt) }}{{ session.availableSeats == null ? '・不限名額' : `・剩餘 ${session.availableSeats} 席` }}{{ session.requiresInsurance ? '・需補課保險' : '' }}</option>
                  </select>
                  <span class="block text-xs font-normal text-slate-500">只會顯示補課路由、預約時間與名額都符合的場次；送出時還會交易性重新驗證。</span>
                </label>
                <button v-if="!requiresMakeupInsurance(item)" type="button" class="btn btn-primary w-full text-white" :disabled="productizedActionSaving || !hasSelectedMakeupTarget(item)" @click="bookMakeup(item)">預約補課</button>
                <button v-else type="button" class="btn btn-primary w-full text-white" :disabled="productizedActionSaving || !hasSelectedMakeupTarget(item)" @click="checkoutMakeupInsurance(item)">建立補課保險訂單</button>
              </template>

              <form v-if="memberTask.key === 'makeup' && insuranceOrderFor(item)?.orderId && ['pending_payment','pending'].includes(String(insuranceOrderFor(item)?.paymentStatus || insuranceOrderFor(item)?.status || '').toLowerCase())" class="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3" @submit.prevent="submitInsurancePayment(item)"><p class="text-sm text-amber-900">保險訂單 {{ insuranceOrderFor(item).orderCode || insuranceOrderFor(item).orderId }}，付款保留至 {{ formatDateTime(insuranceOrderFor(item).payByAt) }}</p><label class="block space-y-1 text-sm font-medium text-slate-700">匯款帳號後五碼<input v-model.trim="productizedPaymentLast5[item.id]" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required class="w-full bg-white" /></label><button class="btn btn-primary w-full text-white" :disabled="productizedActionSaving || !/^\d{5}$/.test(productizedPaymentLast5[item.id] || '')">送出後五碼</button></form>

              <button v-if="memberTask.key === 'renewals' && item.id" type="button" class="btn btn-primary w-full text-white" :disabled="productizedActionSaving" @click="startRenewal(item)">驗證資格並鎖定續報價</button>
              <router-link v-if="memberTask.key === 'enrollments' && (item.orderId || item.order_id)" :to="courseRecordDeepLink('orders', item.orderId || item.order_id)" class="btn btn-outline w-full">查看付款與訂單</router-link>
            </div>
          </article>
        </div>
        </CourseResourceState>
      </section>
    </template>
  </CourseCenterShell>
  <section v-else class="space-y-5">
    <p v-if="message" class="rounded-lg border px-4 py-3 text-sm" :role="messageType === 'error' ? 'alert' : 'status'" :aria-live="messageType === 'error' ? 'assertive' : 'polite'" aria-atomic="true"
      :class="messageType === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'">{{ message }}</p>

    <div class="grid gap-3 sm:items-end" :class="props.mode === 'bookings' ? 'sm:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]' : 'sm:grid-cols-[minmax(0,1fr)_12rem_auto]'">
      <AppSearchInput v-model="query" :placeholder="searchPlaceholder" />
      <label class="space-y-1 text-sm text-slate-600">狀態
        <select v-model="statusFilter" class="w-full"><option value="">全部狀態</option><option v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
      </label>
      <label v-if="props.mode === 'bookings'" class="space-y-1 text-sm text-slate-600">時間範圍<select v-model="periodFilter" class="w-full"><option value="">全部紀錄</option><option value="upcoming">即將到來</option><option value="history">歷史紀錄</option></select></label>
      <button type="button" class="btn btn-outline" :disabled="!hasFilters" @click="clearFilters">清除篩選</button>
    </div>

    <div v-if="summaryCards.length" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <button v-for="card in summaryCards" :key="card.key" type="button" class="surface-section min-h-[44px] text-left transition hover:border-primary"
        :aria-pressed="statusFilter === card.status" @click="statusFilter = card.status">
        <p class="text-sm text-slate-500">{{ card.label }}</p><p class="stat-number mt-1 text-2xl text-slate-950">{{ card.value }}</p>
      </button>
    </div>

    <section v-if="loading" class="grid gap-4 md:grid-cols-2"><div v-for="index in 4" :key="index" class="ticket-card animate-pulse p-5"><div class="h-5 w-2/3 rounded bg-slate-200"></div><div class="mt-4 h-24 rounded bg-slate-100"></div></div></section>
    <section v-else-if="loadError" class="surface-section text-sm text-red-700"><p>{{ loadError }}</p><button type="button" class="btn btn-outline mt-3" @click="loadData(meta.offset, { forceSummary: true })">重新載入</button></section>

    <section v-else-if="props.mode === 'tickets'" class="space-y-4">
      <div v-if="!items.length" class="surface-section text-sm leading-6 text-slate-600"><p>{{ hasFilters ? '沒有符合條件的課程票券。' : '目前沒有課程票券。購買課程並由行政確認款項後，票券會出現在這裡。' }}</p><router-link to="/store?tab=courses" class="btn btn-primary mt-4 text-white">前往課程商店</router-link></div>
      <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article v-for="ticket in items" :key="ticket.id" class="ticket-card flex flex-col gap-4 p-5">
          <header class="flex items-start justify-between gap-3"><div><p class="text-sm text-slate-500">{{ ticket.code }}</p><h2 class="ui-title mt-1 text-xl text-slate-950">{{ ticket.productName }}</h2><p class="mt-1 text-sm font-medium text-primary">{{ providerLabel(ticket) }}</p></div><span class="ops-chip" :class="ticketStatusClass(ticket.status)">{{ ticketStatusLabel(ticket.status) }}</span></header>
          <div class="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-4"><div><p class="text-sm text-slate-500">剩餘</p><p class="stat-number mt-1 text-3xl text-primary">{{ ticketUsesLabel(ticket, 'remaining') }}</p></div><div><p class="text-sm text-slate-500">已保留</p><p class="stat-number mt-1 text-3xl text-amber-700">{{ ticketUsesLabel(ticket, 'held') }}</p></div><div><p class="text-sm text-slate-500">可使用</p><p class="stat-number mt-1 text-3xl text-emerald-700">{{ ticketUsesLabel(ticket, 'available') }}</p></div></div>
          <p class="text-xs leading-5 text-slate-500">{{ ticketReadinessLabel(ticket) }}</p>
          <dl class="space-y-2 text-sm text-slate-600"><div class="flex justify-between gap-3"><dt>發券日</dt><dd class="text-right text-slate-800">{{ formatDate(ticket.issuedAt) }}</dd></div><div class="flex justify-between gap-3"><dt>{{ ticket.activatedAt ? '到期日' : '開卡期限' }}</dt><dd class="text-right text-slate-800">{{ formatDate(ticket.expiresAt || ticket.activationDeadline) || '未設定' }}</dd></div><div v-if="ticket.pauseReason" class="flex justify-between gap-3"><dt>暫停原因</dt><dd class="text-right text-slate-800">{{ ticket.pauseReason }}</dd></div></dl>
          <div class="mt-auto grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <button
              v-if="ticketRedemptionCount(ticket)"
              type="button"
              class="btn btn-primary btn-sm w-full text-white sm:col-span-2"
              @click="openTicketAttendanceQr(ticket)"
            >
              <AppIcon name="camera" class="h-4 w-4" />
              {{ ticketRedemptionCount(ticket) === 1 ? '出示核銷 QR' : `選擇場次出示 QR（${ticketRedemptionCount(ticket)} 場）` }}
            </button>
            <button class="btn btn-outline btn-sm" @click="openDetail(ticket)">查看詳情</button>
            <button v-if="ticket.status === 'active'" class="btn btn-outline btn-sm" @click="openAction(ticket)"><AppIcon name="pause" class="h-4 w-4" /> 暫停</button>
            <button v-if="ticket.status === 'paused'" class="btn btn-outline btn-sm" @click="resumeTicket(ticket)"><AppIcon name="refresh" class="h-4 w-4" /> 恢復</button>
            <button v-if="partialTransferAvailable && canPartialTransferTicket(ticket)" class="btn btn-outline btn-sm sm:col-span-2" @click="openPartialTransfer(ticket)"><AppIcon name="orders" class="h-4 w-4" /> 轉讓部分堂數</button>
            <template v-else-if="!partialTransferAvailable && canTransferTicket(ticket)"><button class="btn btn-outline btn-sm" @click="requestTransferEmail(ticket)"><AppIcon name="orders" class="h-4 w-4" /> Email 轉讓</button><button class="btn btn-outline btn-sm" @click="requestTransferQr(ticket)"><AppIcon name="camera" class="h-4 w-4" /> 掃碼轉讓</button></template>
            <router-link v-if="['pending','active'].includes(ticket.status) && (ticket.unlimited || ticket.remainingUses > 0)" to="/store?tab=courses&courseView=sessions" class="btn btn-primary btn-sm text-white"><AppIcon name="calendar" class="h-4 w-4" /> 預約</router-link>
          </div>
        </article>
      </div>

      <section v-if="partialTransferAvailable" class="surface-section space-y-4" aria-labelledby="partial-transfer-history-title">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h2 id="partial-transfer-history-title" class="ui-title text-lg text-slate-950">部分堂數轉讓</h2><p class="mt-1 text-sm text-slate-600">僅限已註冊帳號；送出前會先預覽受讓人、可用堂數與加購資格。</p></div><button type="button" class="btn btn-outline btn-sm" :disabled="partialTransfersLoading" @click="loadPartialTransfers">{{ partialTransfersLoading ? '載入中…' : '重新載入' }}</button></div>
        <p v-if="partialTransfersError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{{ partialTransfersError }}</p>
        <div v-if="partialTransfers.incoming.length || partialTransfers.outgoing.length" class="grid gap-4 lg:grid-cols-2">
          <div class="space-y-3"><h3 class="font-medium text-slate-900">待我處理</h3><p v-if="!partialTransfers.incoming.length" class="text-sm text-slate-500">目前沒有收到的部分轉讓。</p><article v-for="transfer in partialTransfers.incoming" :key="`incoming-${transfer.id}`" class="rounded-xl border border-slate-200 p-4"><div class="flex items-start justify-between gap-3"><div><strong class="text-slate-950">{{ transfer.sourceTicket.productName || transfer.sourceTicket.code }}</strong><p class="mt-1 text-sm text-slate-600">{{ transfer.counterparty.displayName }} 轉讓 {{ transfer.quantity }} 堂</p></div><span class="ops-chip" :class="partialTransferStatusClass(transfer.status)">{{ partialTransferStatusLabel(transfer.status) }}</span></div><p v-if="transfer.expiresAt" class="mt-2 text-xs text-slate-500">處理期限：{{ formatDateTime(transfer.expiresAt) }}</p><div v-if="transfer.capabilities.accept || transfer.capabilities.decline" class="mt-3 grid grid-cols-2 gap-2"><button type="button" class="btn btn-primary btn-sm text-white" :disabled="partialTransferSaving" @click="actOnPartialTransfer(transfer, 'accept')">接受</button><button type="button" class="btn btn-outline btn-sm" :disabled="partialTransferSaving" @click="actOnPartialTransfer(transfer, 'decline')">拒絕</button></div><p v-if="transfer.childTicket" class="mt-3 text-xs text-slate-500">子票：{{ transfer.childTicket.code }}</p></article></div>
          <div class="space-y-3"><h3 class="font-medium text-slate-900">我發起的</h3><p v-if="!partialTransfers.outgoing.length" class="text-sm text-slate-500">目前沒有發起的部分轉讓。</p><article v-for="transfer in partialTransfers.outgoing" :key="`outgoing-${transfer.id}`" class="rounded-xl border border-slate-200 p-4"><div class="flex items-start justify-between gap-3"><div><strong class="text-slate-950">{{ transfer.sourceTicket.productName || transfer.sourceTicket.code }}</strong><p class="mt-1 text-sm text-slate-600">轉讓 {{ transfer.quantity }} 堂給 {{ transfer.counterparty.displayName }}</p></div><span class="ops-chip" :class="partialTransferStatusClass(transfer.status)">{{ partialTransferStatusLabel(transfer.status) }}</span></div><p v-if="transfer.expiresAt" class="mt-2 text-xs text-slate-500">處理期限：{{ formatDateTime(transfer.expiresAt) }}</p><button v-if="transfer.capabilities.cancel" type="button" class="btn btn-outline btn-sm mt-3 w-full text-red-700" :disabled="partialTransferSaving" @click="actOnPartialTransfer(transfer, 'cancel')">取消轉讓</button><p v-if="transfer.childTicket" class="mt-3 text-xs text-slate-500">受讓子票：{{ transfer.childTicket.code }}</p></article></div>
        </div>
        <p v-else-if="!partialTransfersLoading" class="text-sm text-slate-500">目前沒有部分堂數轉讓紀錄。</p>
      </section>
    </section>

    <section v-else-if="props.mode === 'bookings'" class="space-y-4">
      <div v-if="!items.length" class="surface-section text-sm leading-6 text-slate-600"><p>{{ hasFilters ? '沒有符合條件的課程預約。' : '目前沒有課程預約。前往課程商店選擇開放場次。' }}</p><router-link to="/store?tab=courses&courseView=sessions" class="btn btn-primary mt-4 text-white">查看開放場次</router-link></div>
      <div v-else class="grid gap-4 lg:grid-cols-2">
        <article v-for="booking in items" :key="booking.id" class="ticket-card flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0 space-y-3">
            <div class="flex flex-wrap items-center gap-2"><h2 class="ui-title text-xl text-slate-950">{{ booking.sessionTitle }}</h2><span class="ops-chip" :class="bookingStatusClass(booking.status)">{{ bookingStatusLabel(booking.status) }}</span><span class="ops-chip">{{ isUpcoming(booking) ? '即將到來' : '歷史紀錄' }}</span></div>
            <p class="text-sm font-medium text-primary">{{ providerLabel(booking) }}</p>
            <dl class="space-y-2 text-sm text-slate-600"><div class="flex gap-2"><AppIcon name="calendar" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ formatRange(booking.startsAt, booking.endsAt) }}（台灣時間）</span></div><div class="flex gap-2"><AppIcon name="map-pin" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ booking.location || '地點待公告' }}</span></div><div class="flex gap-2"><AppIcon name="user" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ booking.coachName || '教練待公告' }}</span></div><div class="flex gap-2"><AppIcon name="ticket" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ booking.ticketCode }}</span></div><div v-if="booking.cancellationDeadline || booking.cancelBefore" class="flex gap-2"><AppIcon name="clock" class="mt-0.5 h-4 w-4 shrink-0" /><span>取消截止：{{ formatDateTime(booking.cancellationDeadline || booking.cancelBefore) }}</span></div></dl>
            <p v-if="booking.redeemable === false && booking.redeemableReason" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{{ booking.redeemableReason }}</p>
          </div>
          <div class="flex shrink-0 flex-col gap-2 sm:min-w-40"><button class="btn btn-outline btn-sm" @click="openDetail(booking)">查看詳情</button><button v-if="booking.status === 'booked' && booking.verifyCode && booking.redeemable !== false" class="btn btn-primary btn-sm text-white" @click="requestAttendanceQr(booking)"><AppIcon name="camera" class="h-4 w-4" /> 出示核銷 QR</button><button v-if="booking.status === 'booked' && canCancel(booking)" class="btn btn-outline btn-sm text-red-700" @click="cancelBooking(booking)">取消預約</button></div>
        </article>
      </div>
    </section>

    <section v-else class="space-y-4">
      <div v-if="!items.length" class="surface-section text-sm leading-6 text-slate-600"><p>{{ hasFilters ? '沒有符合條件的課程訂單。' : '目前沒有課程訂單。' }}</p><router-link to="/store?tab=courses" class="btn btn-primary mt-4 text-white">選購課程</router-link></div>
      <div v-else>
        <div class="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block"><div class="overflow-x-auto"><table class="table-default min-w-[1080px]"><thead><tr><th>訂單編號</th><th>課程／服務商</th><th>數量</th><th>金額</th><th>匯款後五碼</th><th>付款／發券</th><th>建立時間</th><th>操作</th></tr></thead><tbody><tr v-for="order in items" :key="order.id"><td class="font-medium text-slate-900">{{ order.code }}</td><td><p>{{ order.productName }}</p><p class="text-sm text-primary">{{ providerLabel(order) }}</p><p v-if="order.lineItems.length > 1" class="text-xs text-slate-500">{{ order.lineItems.length }} 項完整明細</p></td><td>{{ order.quantity }}</td><td class="money-value">NT$ {{ formatMoney(order.totalAmount) }}</td><td>{{ order.remittanceLast5 || '—' }}</td><td><span class="ops-chip" :class="orderStatusClass(order)">{{ orderStatusLabel(order) }}</span></td><td>{{ formatDateTime(order.createdAt) }}</td><td><div class="flex gap-2"><button class="btn btn-outline btn-sm" @click="openDetail(order)">詳情</button><button v-if="canEditOrder(order)" class="btn btn-outline btn-sm" @click="openOrderEdit(order)">修改</button><button v-if="canCancelOrder(order)" class="btn btn-outline btn-sm text-red-700" @click="cancelOrder(order)">取消</button></div></td></tr></tbody></table></div></div>
        <div class="grid gap-3 md:hidden"><article v-for="order in items" :key="`mobile-${order.id}`" class="ticket-card space-y-4 p-4"><header class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="break-all font-mono text-sm text-slate-500">{{ order.code }}</p><h2 class="ui-title mt-1 text-lg text-slate-950">{{ order.productName }}</h2><p class="mt-1 text-sm font-medium text-primary">{{ providerLabel(order) }}</p></div><span class="ops-chip shrink-0" :class="orderStatusClass(order)">{{ orderStatusLabel(order) }}</span></header><dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><div><dt class="text-slate-500">數量</dt><dd class="mt-1 font-medium text-slate-900">{{ order.quantity }}</dd></div><div><dt class="text-slate-500">金額</dt><dd class="money-value mt-1 text-slate-950">NT$ {{ formatMoney(order.totalAmount) }}</dd></div><div><dt class="text-slate-500">已發票券</dt><dd class="mt-1 font-medium text-slate-900">{{ order.issuedTickets.length }} 張</dd></div><div><dt class="text-slate-500">建立時間</dt><dd class="mt-1 text-slate-700">{{ formatDateTime(order.createdAt) }}</dd></div></dl><div class="grid grid-cols-3 gap-2"><button class="btn btn-outline btn-sm" @click="openDetail(order)">詳情</button><button v-if="canEditOrder(order)" class="btn btn-outline btn-sm" @click="openOrderEdit(order)">修改</button><button v-if="canCancelOrder(order)" class="btn btn-outline btn-sm text-red-700" @click="cancelOrder(order)">取消</button></div></article></div>
      </div>
    </section>

    <AdminPagination v-if="meta.total > 0" :total="meta.total" :limit="meta.limit" :offset="meta.offset" :loading="loading" @change="loadData($event.offset)" />

    <AppOverlayPanel v-model="detailOpen" placement="auto" size="md" :title="detailTitle" :description="selectedItem?.code || selectedItem?.sessionCode || ''" @close="closeDetail">
      <div v-if="selectedItem" class="space-y-4 text-sm">
        <p class="font-medium text-primary">{{ providerLabel(selectedItem) }}</p>
        <dl class="divide-y divide-slate-200 border-y border-slate-200">
          <div v-for="row in detailRows" :key="row.label" class="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)]"><dt class="font-medium text-slate-600">{{ row.label }}</dt><dd class="break-words text-slate-950">{{ row.value || '—' }}</dd></div>
        </dl>
        <section v-if="props.mode === 'orders' && selectedItem.lineItems?.length" class="space-y-2"><h3 class="font-medium text-slate-900">完整訂單明細</h3><ul class="divide-y divide-slate-100 rounded-lg border border-slate-200"><li v-for="(line, index) in selectedItem.lineItems" :key="line.id || `${line.productId || line.name}-${index}`" class="flex justify-between gap-3 p-3"><span>{{ line.name || line.productName }} × {{ line.quantity || 1 }}<em v-if="line.required" class="ml-1 not-italic text-amber-700">強制加購</em></span><span class="money-value">NT$ {{ formatMoney(line.subtotal ?? line.lineTotal ?? Number(line.unitPrice || 0) * Number(line.quantity || 1)) }}</span></li></ul></section>
        <section v-if="props.mode === 'orders'" class="space-y-2"><h3 class="font-medium text-slate-900">已發票券</h3><p v-if="!selectedItem.issuedTickets?.length" class="text-slate-500">尚未發券。</p><ul v-else class="space-y-2"><li v-for="ticket in selectedItem.issuedTickets" :key="ticket.id || ticket.code" class="rounded-lg border border-slate-200 px-3 py-2 font-mono">{{ ticket.code }}<span v-if="ticket.status" class="ml-2 font-sans text-xs text-slate-500">{{ ticket.status }}</span></li></ul></section>
        <section v-if="props.mode === 'orders' && selectedItem.lifecycle?.length" class="space-y-2"><h3 class="font-medium text-slate-900">訂單生命週期</h3><ol class="space-y-2"><li v-for="(event, index) in selectedItem.lifecycle" :key="event.id || index" class="rounded-lg border border-slate-200 p-3"><strong>{{ event.label || event.action || event.type }}</strong><p class="mt-1 text-xs text-slate-500">{{ formatDateTime(event.createdAt || event.created_at || event.occurredAt) }}<span v-if="event.reason">・{{ event.reason }}</span></p></li></ol></section>
        <section v-if="props.mode === 'tickets'" class="space-y-3">
          <div class="flex items-center justify-between gap-3"><h3 class="font-medium text-slate-900">堂數帳本</h3><span class="text-xs text-slate-500">不可變更事件</span></div>
          <p v-if="ledgerLoading" class="text-slate-500">帳本載入中…</p>
          <p v-else-if="!selectedItem.ledger?.length" class="text-slate-500">目前沒有帳本事件。</p>
          <ol v-else class="space-y-2">
            <li v-for="event in selectedItem.ledger" :key="event.id || `${event.type}-${event.occurredAt}`" class="rounded-lg border border-slate-200 p-3">
              <div class="flex items-start justify-between gap-3"><strong class="text-slate-900">{{ usageEventLabel(event.type) }}</strong><span class="font-medium" :class="event.delta < 0 ? 'text-red-700' : 'text-emerald-700'">{{ formatDelta(event.delta) }}</span></div>
              <p class="mt-1 text-xs text-slate-500">{{ formatDateTime(event.occurredAt) }}<span v-if="event.balanceAfter != null">・事件後 {{ event.balanceAfter }} 堂</span></p>
              <p v-if="event.note" class="mt-1 text-slate-600">{{ event.note }}</p>
            </li>
          </ol>
        </section>
      </div>
    </AppOverlayPanel>

    <AppOverlayPanel
      v-model="attendanceSelectorOpen"
      placement="auto"
      size="md"
      title="選擇核銷場次"
      :description="attendanceSelectorDescription"
      @close="closeAttendanceSelector"
      @after-close="emitPendingAttendanceQr"
    >
      <div class="space-y-3">
        <p class="text-sm leading-6 text-slate-600">這張票券有多場待核銷預約，請選擇本次要出示的課程場次。</p>
        <article
          v-for="booking in attendanceSelectorBookings"
          :key="booking.id || booking.verifyCode"
          class="rounded-xl border border-slate-200 bg-white p-4"
        >
          <div class="min-w-0">
            <h3 class="ui-title text-base text-slate-950">{{ booking.sessionTitle || booking.sessionCode || '課程場次' }}</h3>
            <p v-if="booking.sessionCode" class="mt-1 break-all text-xs text-slate-500">{{ booking.sessionCode }}</p>
            <dl class="mt-3 space-y-2 text-sm text-slate-600">
              <div class="flex gap-2"><AppIcon name="calendar" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ formatRange(booking.startsAt, booking.endsAt) }}</span></div>
              <div class="flex gap-2"><AppIcon name="map-pin" class="mt-0.5 h-4 w-4 shrink-0" /><span>{{ booking.location || '地點待公告' }}</span></div>
            </dl>
          </div>
          <button type="button" class="btn btn-primary btn-sm mt-4 w-full text-white" @click="selectAttendanceBooking(booking)">
            <AppIcon name="camera" class="h-4 w-4" /> 出示此場 QR
          </button>
        </article>
      </div>
    </AppOverlayPanel>

    <AppOverlayPanel v-model="actionOpen" placement="auto" size="md" :title="`暫停 ${selectedTicket?.productName || '課程票券'}`" description="填寫原因後，票券會暫停預約與核銷，之後仍可自行恢復。" @close="closeAction">
      <p v-if="actionError" class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{{ actionError }}</p>
      <form class="space-y-4" @submit.prevent="submitAction"><label class="block space-y-2 text-sm font-medium text-slate-700">暫停原因<textarea v-model.trim="actionValue" required rows="4" class="w-full" placeholder="例如：工作、家庭或健康因素"></textarea></label><p class="text-sm leading-6 text-slate-600">暫停後不可預約或核銷，之後可自行恢復使用。</p><button class="btn btn-primary w-full text-white" :disabled="submitting">{{ submitting ? '處理中…' : '確認送出' }}</button></form>
    </AppOverlayPanel>

    <AppOverlayPanel v-model="partialTransferOpen" placement="auto" size="md" :title="`轉讓 ${partialTransferTicket?.productName || '課程票券'} 的部分堂數`" description="受讓人必須已有平台帳號；先預覽後才能確認建立轉讓。" @close="closePartialTransfer">
      <p v-if="partialTransferFormError" class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{{ partialTransferFormError }}</p>
      <form v-if="partialTransferTicket && !partialTransferPreview" class="space-y-4" @submit.prevent="previewPartialTransfer"><label class="block space-y-2 text-sm font-medium text-slate-700">受讓人帳號 Email<input v-model.trim="partialTransferForm.recipientEmail" type="email" required autocomplete="email" class="w-full" placeholder="member@example.com" /></label><label class="block space-y-2 text-sm font-medium text-slate-700">轉讓堂數<input v-model.number="partialTransferForm.quantity" type="number" min="1" :max="Math.max(1, Number(partialTransferTicket.availableUses || 1))" required class="w-full" /><span class="block text-xs font-normal text-slate-500">目前可用 {{ partialTransferTicket.availableUses }} 堂，預約保留堂數不可轉讓。</span></label><button class="btn btn-primary w-full text-white" :disabled="partialTransferSaving">{{ partialTransferSaving ? '檢查中…' : '預覽轉讓' }}</button></form>
      <div v-else-if="partialTransferPreview" class="space-y-4"><dl class="divide-y divide-slate-200 border-y border-slate-200 text-sm"><div class="grid grid-cols-[7rem_1fr] gap-3 py-3"><dt class="text-slate-500">受讓帳號</dt><dd class="break-all text-slate-950">{{ partialTransferPreview.recipientEmail || partialTransferForm.recipientEmail }}</dd></div><div class="grid grid-cols-[7rem_1fr] gap-3 py-3"><dt class="text-slate-500">轉讓堂數</dt><dd class="text-slate-950">{{ partialTransferPreview.quantity }} 堂</dd></div><div class="grid grid-cols-[7rem_1fr] gap-3 py-3"><dt class="text-slate-500">轉讓後可用</dt><dd class="text-slate-950">{{ partialTransferPreview.availableAfterTransfer }} 堂</dd></div></dl><p class="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">確認後會保留這些堂數；受讓人接受時才會寫入 TRANSFER_OUT / TRANSFER_IN 帳本。</p><div class="grid grid-cols-2 gap-2"><button type="button" class="btn btn-outline" :disabled="partialTransferSaving" @click="partialTransferPreview = null">返回修改</button><button type="button" class="btn btn-primary text-white" :disabled="partialTransferSaving" @click="initiatePartialTransfer">{{ partialTransferSaving ? '建立中…' : '確認建立' }}</button></div></div>
    </AppOverlayPanel>

    <AppOverlayPanel v-model="orderEditOpen" placement="auto" size="md" :title="`修改訂單 ${selectedOrder?.code || ''}`" description="付款確認前可調整數量及匯款辨識資料。" @close="closeOrderEdit">
      <p v-if="actionError" class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{{ actionError }}</p>
      <form v-if="selectedOrder" class="space-y-4" @submit.prevent="saveOrderEdit"><label class="block space-y-2 text-sm font-medium text-slate-700">數量<input v-model.number="orderEditForm.quantity" type="number" min="1" :max="selectedOrder.maxPurchaseQuantity" required class="w-full" /><span class="block text-xs font-normal text-slate-500">此方案最多 {{ selectedOrder.maxPurchaseQuantity }} 份</span></label><label class="block space-y-2 text-sm font-medium text-slate-700">目前會員匯款帳號後五碼<input v-model.trim="orderEditForm.remittanceLast5" readonly class="w-full bg-slate-50" /></label><router-link to="/account?tab=profile" class="inline-flex text-sm font-medium text-primary">需要變更末五碼？前往帳戶中心修改</router-link><p class="surface-muted p-3 text-sm leading-6 text-slate-600">儲存時會同步目前會員資料並由伺服器重建明細。商品不可在原訂單內更換；若要購買其他服務商課程，請取消後重新下單。</p><button class="btn btn-primary w-full text-white" :disabled="submitting">{{ submitting ? '儲存中…' : '確認修改' }}</button></form>
    </AppOverlayPanel>
    <OrderUserDataReviewDrawer ref="userDataReviewRef" />
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import AppIcon from '../components/AppIcon.vue'
import CourseCenterShell from '../components/CourseCenterShell.vue'
import CourseResourceState from '../components/CourseResourceState.vue'
import AppOverlayPanel from '../components/AppOverlayPanel.vue'
import AppSearchInput from '../components/AppSearchInput.vue'
import AdminPagination from '../components/AdminPagination.vue'
import OrderUserDataReviewDrawer from '../components/OrderUserDataReviewDrawer.vue'
import { showConfirm } from '../utils/sheet'
import { showToast } from '../utils/toast.js'
import {
  buildCourseMutationHeaders,
  COURSE_V2_ENDPOINTS,
  courseTaipeiTimestamp,
  createCourseIdempotencyKey,
  formatCourseDelta,
  formatCourseTaipeiDate,
  formatCourseTaipeiDateTime,
  isCourseVersionConflict,
  normalizeCoursePartialTransfer,
  normalizeCourseTicket,
  normalizeCourseUsageEvent,
} from '../utils/courseV2'
import {
  clampPurchaseQuantity,
  fulfillmentStatusLabel,
  hasEditableOrderField,
  hasOrderCapability,
  normalizeOrderRecord,
  orderStatusChip,
  orderStatusSummary,
  paymentStatusLabel,
  shouldRetainIdempotencyKey,
} from '../utils/orderParity.js'
import {
  COURSE_PRODUCTIZATION_ENDPOINTS,
  MEMBER_COURSE_TASKS,
  courseCenterErrorMessage,
  courseDeadlineState,
  courseRecordDeepLink,
  courseTermCheckoutPath,
  normalizeCourseCenterPayload,
  resolveCourseMemberTask,
} from '../utils/courseProductization.js'
import { normalizeLocalPath } from '../utils/safeUrl.js'

const API = API_BASE
const route = useRoute()
const router = useRouter()
const props = defineProps({
  mode: { type: String, default: 'tickets', validator: value => ['tickets', 'bookings', 'orders'].includes(value) },
  productizedTask: { type: String, default: '' },
})
const emit = defineEmits(['transfer-email', 'transfer-qr', 'attendance-qr'])
const loading = ref(true)
const loadError = ref('')
const items = ref([])
const summary = ref({})
const meta = reactive({ total: 0, limit: 10, offset: 0, hasMore: false })
const query = ref('')
const statusFilter = ref('')
const periodFilter = ref('')
const message = ref('')
const messageType = ref('success')
const actionOpen = ref(false)
const actionValue = ref('')
const actionError = ref('')
const selectedTicket = ref(null)
const submitting = ref(false)
const detailOpen = ref(false)
const selectedItem = ref(null)
const orderEditOpen = ref(false)
const selectedOrder = ref(null)
const orderEditForm = ref({ quantity: 1, remittanceLast5: '' })
const attendanceSelectorOpen = ref(false)
const attendanceSelectorTicket = ref(null)
const attendanceSelectorBookings = ref([])
const pendingAttendanceBooking = ref(null)
const userDataReviewRef = ref(null)
const ledgerLoading = ref(false)
const mutationKeys = new Map()
const partialTransferAvailable = ref(false)
const partialTransfersLoading = ref(false)
const partialTransfersError = ref('')
const partialTransfers = reactive({ incoming: [], outgoing: [] })
const partialTransferOpen = ref(false)
const partialTransferTicket = ref(null)
const partialTransferPreview = ref(null)
const partialTransferForm = reactive({ recipientEmail: '', quantity: 1 })
const partialTransferFormError = ref('')
const partialTransferSaving = ref(false)
let searchTimer = null
let requestId = 0
const memberCourseTasks = MEMBER_COURSE_TASKS
const memberTask = computed(() => resolveCourseMemberTask(props.productizedTask))
const productizedApiTask = computed(() => Boolean(props.productizedTask && memberTask.value.endpoint))
const productizedItems = ref([])
const productizedLoading = ref(false)
const productizedError = ref('')
const productizedActionOpen = ref('')
const productizedActionSaving = ref(false)
const productizedActionNotice = ref('')
const productizedActionTone = ref('success')
const productizedReasons = reactive({})
const productizedTargets = reactive({})
const productizedWaitlistOffers = ref([])
const productizedInsuranceOrders = reactive({})
const productizedPaymentLast5 = reactive({})
const notificationUnreadCount = ref(0)
const deadlineNow = ref(Date.now())
let deadlineTimer = null
const productizedTaskDescription = computed(() => ({
  schedule: '固定班與計次預約整合成時間順序課表，出席狀態以逐堂紀錄為準。',
  enrollments: '查看程度資格、固定堂次、插班價格、候補與限時付款席位。',
  makeup: '提前請假後保留補課權益；補課預約與保險付款分開顯示。',
  renewals: '顯示符合來源班期、程度門檻與續報期間的選項。',
  notifications: notificationUnreadCount.value ? `尚有 ${notificationUnreadCount.value} 則未讀課程通知。` : '查看訂單、候補、補課、轉讓與續報的站內通知。',
})[memberTask.value.key] || '')
const productizedEmptyText = computed(() => ({ schedule: '目前沒有即將到來的固定班或計次課程。', enrollments: '目前沒有固定班報名或候補紀錄。', makeup: '目前沒有可用補課權益或補課預約。', renewals: '目前沒有開放中的續報資格。', notifications: '目前沒有課程通知。' })[memberTask.value.key] || '目前沒有課程紀錄。')

const statusOptions = computed(() => props.mode === 'tickets'
  ? [{ value: 'pending', label: '待首次核銷' }, { value: 'active', label: '使用中' }, { value: 'paused', label: '已暫停' }, { value: 'exhausted', label: '已用完' }, { value: 'expired', label: '已過期' }, { value: 'void', label: '已作廢' }]
  : props.mode === 'bookings'
    ? [{ value: 'booked', label: '已預約' }, { value: 'attended', label: '已出席' }, { value: 'cancelled', label: '已取消' }, { value: 'no_show', label: '未到' }]
    : [{ value: 'pending', label: '待匯款' }, { value: 'reviewing', label: '款項確認中' }, { value: 'paid', label: '已付款' }, { value: 'cancelled', label: '已取消' }, { value: 'refunded', label: '已退款' }])
const searchPlaceholder = computed(() => props.mode === 'tickets' ? '搜尋商品、票號或服務商' : props.mode === 'bookings' ? '搜尋場次、地點、教練、票號或服務商' : '搜尋訂單、課程或服務商')
const hasFilters = computed(() => Boolean(query.value.trim() || statusFilter.value || periodFilter.value))
const summaryCards = computed(() => {
  const total = Number(summary.value?.total ?? meta.total) || 0
  const byStatus = summary.value?.byStatus || {}
  const cards = [{ key: 'all', label: '全部', value: total, status: '' }]
  return cards.concat(statusOptions.value.map(option => ({ key: option.value, label: option.label, value: Number(byStatus[option.value] || 0), status: option.value })))
})
const detailTitle = computed(() => props.mode === 'tickets' ? selectedItem.value?.productName || '課程票券' : props.mode === 'bookings' ? selectedItem.value?.sessionTitle || '課程預約' : selectedItem.value?.productName || '課程訂單')
const attendanceSelectorDescription = computed(() => {
  const ticketCode = String(attendanceSelectorTicket.value?.code || '').trim()
  const count = attendanceSelectorBookings.value.length
  return [ticketCode, count ? `${count} 場待核銷預約` : ''].filter(Boolean).join('｜')
})
const detailRows = computed(() => {
  const item = selectedItem.value || {}
  if (props.mode === 'tickets') return [{ label: '票券編號', value: item.code }, { label: '狀態', value: ticketStatusLabel(item.status) }, { label: '剩餘／保留／可用', value: `${ticketUsesLabel(item, 'remaining')} / ${ticketUsesLabel(item, 'held')} / ${ticketUsesLabel(item, 'available')}` }, { label: '發行總堂數', value: item.unlimited ? '不限' : item.totalUses }, { label: '發券日', value: formatDate(item.issuedAt) }, { label: '開卡期限', value: formatDate(item.activationDeadline) }, { label: '到期日', value: formatDate(item.expiresAt) }, { label: '轉讓', value: item.transferable && !item.unlimited ? '允許' : '不允許' }]
  if (props.mode === 'bookings') return [{ label: '場次', value: item.sessionTitle }, { label: '狀態', value: bookingStatusLabel(item.status) }, { label: '時間（台灣）', value: formatRange(item.startsAt, item.endsAt) }, { label: '取消截止', value: formatDateTime(item.cancellationDeadline || item.cancelBefore) }, { label: '地點', value: item.location }, { label: '教練', value: item.coachName }, { label: '使用票券', value: item.ticketCode }, { label: '保留堂數', value: item.holdUnits ?? item.heldUses }, { label: '出席者', value: item.attendeeName }, { label: 'Email', value: item.attendeeEmail }, { label: '核銷狀態', value: item.redeemable === false ? (item.redeemableReason || '目前不可核銷') : '可由現場依時間窗核銷' }, { label: '核銷碼', value: item.verifyCode }]
  return [{ label: '訂單編號', value: item.code }, { label: '付款狀態', value: paymentStatusLabel(item.paymentStatus) }, { label: '履約狀態', value: fulfillmentStatusLabel(item.fulfillmentStatus) }, { label: '銷售方案', value: item.productName }, { label: '訂單明細', value: orderItemsLabel(item) }, { label: '數量', value: item.quantity }, { label: '單價', value: `NT$ ${formatMoney(item.unitPrice)}` }, { label: '總額', value: `NT$ ${formatMoney(item.totalAmount)}` }, { label: '發券詳情', value: item.issuedTickets?.length ? `${item.issuedTickets.length} 張：${item.issuedTickets.map(ticket => ticket.code).filter(Boolean).join('、')}` : '尚未發券' }, { label: '購買人', value: item.buyerName }, { label: 'Email', value: item.buyerEmail }, { label: '手機', value: item.buyerPhone }, { label: '匯款後五碼', value: item.remittanceLast5 }, { label: '建立時間', value: formatDateTime(item.createdAt) }]
})

function formatMoney(value) { return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0)) }
function formatDate(value) { return formatCourseTaipeiDate(value) }
function formatDateTime(value) { return formatCourseTaipeiDateTime(value) }
function formatRange(start, end) { const from = formatDateTime(start); const to = formatDateTime(end); return from && to ? `${from}－${to}` : (from || to || '時間待公告') }
function formatDelta(value) { return formatCourseDelta(value) }
function usageEventLabel(type) { return ({ issuance: '票券發行', success: '出席扣堂', no_show: 'NO SHOW 扣堂', no_show_audit: '無票 NO SHOW 稽核', reversal: '撤銷補償', adjustment: '行政調整', refund: '退款補償' })[String(type || '').toLowerCase()] || type || '帳本事件' }
function orderItemsLabel(order = {}) { const rows = Array.isArray(order.lineItems) ? order.lineItems : []; return rows.length ? rows.map(item => `${item.name || item.productName} × ${item.quantity || 1}${item.required ? '（強制加購）' : ''}`).join('、') : order.productName }
function providerId(source = {}) { return String(source.providerUserId || source.provider_user_id || source.ownerUserId || source.owner_user_id || '').trim() }
function providerLabel(source = {}) { return source?.isPlatformCourse || !providerId(source) ? '平台課程' : (source.providerName || '服務商課程') }
function showMessage(value, type = 'success') { if (type === 'error') { message.value = value; messageType.value = type; return } message.value = ''; messageType.value = type; showToast(value, { tone: 'success' }) }
function ticketStatusLabel(status) { return ({ pending: '待首次核銷', active: '使用中', paused: '已暫停', exhausted: '已用完', expired: '已過期', void: '已作廢' })[status] || status }
function ticketStatusClass(status) { return status === 'active' ? 'ops-chip-success' : status === 'paused' ? 'ops-chip-warning' : status === 'pending' ? 'ops-chip-info' : '' }
function partialTransferStatusLabel(status) { return ({ pending: '待處理', accepted: '已接受', declined: '已拒絕', canceled: '已取消', cancelled: '已取消', expired: '已過期' })[status] || status }
function partialTransferStatusClass(status) { return status === 'accepted' ? 'ops-chip-success' : status === 'pending' ? 'ops-chip-warning' : 'ops-chip-info' }
function bookingStatusLabel(status) { return ({ booked: '已預約', attended: '已出席', cancelled: '已取消', no_show: '未到' })[status] || status }
function bookingStatusClass(status) { return status === 'attended' ? 'ops-chip-success' : status === 'booked' ? 'ops-chip-info' : status === 'no_show' ? 'ops-chip-warning' : '' }
function orderStatusLabel(order) { return orderStatusSummary(order) }
function orderStatusClass(order) { return orderStatusChip(order) }
function ticketUsesLabel(ticket, kind) {
  if (ticket?.unlimited || ticket?.isUnlimited || ticket?.is_unlimited) return '不限'
  if (kind === 'held') return Number(ticket?.heldUses || 0)
  if (kind === 'available') return Number(ticket?.availableUses ?? Math.max(0, Number(ticket?.remainingUses || 0) - Number(ticket?.heldUses || 0)))
  return Number(ticket?.remainingUses || 0)
}
function ticketReadinessLabel(ticket = {}) {
  if (ticket.status === 'paused') return `票券已暫停${ticket.pauseReason ? `：${ticket.pauseReason}` : ''}，恢復後才能預約與核銷。`
  if (Number(ticket.heldUses || 0) > 0) return `${ticket.heldUses} 堂已由預約保留；取消或請假後依伺服器政策釋放。`
  if (ticket.selected || ticket.isSelected) return '已選為本次預約票券，送出前仍會重新檢查可用堂數。'
  if (ticket.transferPending || ticket.transfer_pending) return '轉讓處理中，完成或取消前不可重複移轉。'
  return ticket.status === 'pending' ? '待首次核銷；開卡後依發行快照計算效期。' : '目前可依場次情境與核銷時間窗使用。'
}
function productizedItemTitle(item = {}) { return item.title || item.name || item.termName || item.term_name || item.sessionTitle || item.session_title || '課程紀錄' }
function productizedStatusLabel(item = {}) {
  const status = String(item.status || item.enrollmentStatus || item.enrollment_status || '').toLowerCase()
  return ({ active: '進行中', confirmed: '已確認', waiting: '候補中', offered: '候補保留中', pending_payment: '待匯款', pending_insurance: '待保險匯款', leave: '已請假', leave_pending: '請假待鎖定', leave_locked: '請假成立', scheduled: '已排課', available: '可預約', reserved: '席位保留中', booked: '已預約', used: '已使用', eligible: '可續報' })[status] || status || '待確認'
}
function productizedStatusClass(item = {}) {
  const status = String(item.status || item.enrollmentStatus || item.enrollment_status || '').toLowerCase()
  if (['active', 'confirmed', 'booked', 'eligible'].includes(status)) return 'ops-chip-success'
  if (['pending_payment', 'pending_insurance', 'waiting', 'offered', 'leave_pending'].includes(status)) return 'ops-chip-warning'
  return 'ops-chip-info'
}
function deadlineState(value) { return courseDeadlineState(value, deadlineNow.value) }
function deadlineChipClass(value) {
  const tone = deadlineState(value).tone
  if (tone === 'danger') return 'ops-chip-danger'
  if (tone === 'warning') return 'ops-chip-warning'
  return 'ops-chip-info'
}
function normalizeCourseNotification(item = {}) {
  return {
    ...item,
    id: Number(item.id),
    title: String(item.title || '').trim(),
    body: String(item.body || '').trim(),
    actionUrl: String(item.actionUrl || item.action_url || '').trim(),
    readAt: item.readAt || item.read_at || null,
    createdAt: item.createdAt || item.created_at || null,
    rowVersion: Number(item.rowVersion ?? item.row_version ?? 1) || 1,
  }
}
function notificationActionPath(item = {}) { return normalizeLocalPath(item.actionUrl || item.action_url, '') }
async function loadProductizedData() {
  if (!memberTask.value.endpoint) return
  productizedLoading.value = true
  productizedError.value = ''
  try {
    const requests = [axios.get(`${API}${memberTask.value.endpoint}`, { params: { includeSummary: 1 } })]
    if (memberTask.value.key === 'enrollments') requests.push(axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.memberWaitlistOffers}`))
    const [{ data }, waitlistResponse] = await Promise.all(requests)
    const rows = normalizeCourseCenterPayload(data, ['schedule', 'enrollments', 'makeupCredits', 'renewalOptions', 'notifications'])
    if (memberTask.value.key === 'notifications') {
      const payload = data?.data ?? data ?? {}
      notificationUnreadCount.value = Math.max(0, Number(payload.unreadCount ?? payload.unread_count ?? 0) || 0)
      productizedItems.value = rows.map(normalizeCourseNotification)
    } else {
      notificationUnreadCount.value = 0
      productizedItems.value = rows
    }
    productizedWaitlistOffers.value = memberTask.value.key === 'enrollments'
      ? normalizeCourseCenterPayload(waitlistResponse?.data, ['offers', 'waitlistOffers']).map(item => ({ ...item, rowVersion: Number(item.rowVersion ?? item.row_version ?? 1) || 1 }))
      : []
  } catch (error) {
    productizedItems.value = []
    notificationUnreadCount.value = 0
    productizedError.value = courseCenterErrorMessage(error, `${memberTask.value.label}載入失敗`)
  } finally {
    productizedLoading.value = false
  }
}
function productizedStatus(item = {}) { return String(item.status || item.enrollmentStatus || item.enrollment_status || '').toLowerCase() }
function canRequestTermLeave(item = {}) { return productizedStatus(item) === 'scheduled' }
function leaveId(item = {}) { return Number(item.leaveId ?? item.leave_id ?? item.leaveRequestId ?? item.leave_request_id) || null }
function leaveRowVersion(item = {}) { return Number(item.leaveRowVersion ?? item.leave_row_version) || null }
function canCancelTermLeave(item = {}) { return ['leave', 'excused_leave'].includes(productizedStatus(item)) && Boolean(leaveId(item) && leaveRowVersion(item)) }
function selectedMakeupTarget(item = {}) {
  const selected = String(productizedTargets[item.id] || '')
  return Array.isArray(item.targetSessions)
    ? item.targetSessions.find(session => String(session.id) === selected) || null
    : null
}
function requiresMakeupInsurance(item = {}) {
  const target = selectedMakeupTarget(item)
  if (target && (Object.hasOwn(target, 'requiresInsurance') || Object.hasOwn(target, 'requires_insurance'))) {
    return Boolean(target.requiresInsurance ?? target.requires_insurance)
  }
  return Boolean(item.requiresInsurance ?? item.requires_insurance) || productizedStatus(item) === 'pending_insurance'
}
function insuranceOrderFor(item = {}) {
  return productizedInsuranceOrders[item.id] || item.insurance || null
}
function canUseMakeup(item = {}) { return ['available', 'pending_insurance'].includes(productizedStatus(item)) && !(item.insurance?.status && ['pending_payment', 'reviewing', 'active'].includes(String(item.insurance.status).toLowerCase())) }
function hasSelectedMakeupTarget(item = {}) {
  return Boolean(selectedMakeupTarget(item))
}
function showProductizedAction(value, tone = 'success') { productizedActionNotice.value = value; productizedActionTone.value = tone }
async function runProductizedAction({ endpoint, item, body = {}, prefix, rowVersion = null, success }) {
  if (productizedActionSaving.value) return
  productizedActionSaving.value = true
  productizedActionNotice.value = ''
  try {
    await axios.post(`${API}${endpoint}`, body, {
      headers: buildCourseMutationHeaders(item, {
        rowVersion: rowVersion ?? item.rowVersion ?? item.row_version,
        idempotencyKey: createCourseIdempotencyKey(prefix),
      }),
    })
    productizedActionOpen.value = ''
    showProductizedAction(success)
    await loadProductizedData()
  } catch (error) {
    showProductizedAction(courseCenterErrorMessage(error, '課程操作失敗'), 'error')
  } finally { productizedActionSaving.value = false }
}
async function requestTermLeave(item) {
  return runProductizedAction({
    endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.termLeave(item.id), item,
    body: { reason: productizedReasons[item.id] || '' }, prefix: 'term-leave',
    success: '請假已成立，補課權益已依班期規則建立。',
  })
}
async function cancelTermLeave(item) {
  if (!(await showConfirm('確定取消這筆請假？只有截止前且補課權益尚未使用才能撤銷。', { title: '取消請假', confirmText: '確認取消' }))) return
  return runProductizedAction({
    endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.termLeaveCancel(leaveId(item)), item,
    rowVersion: leaveRowVersion(item), prefix: 'term-leave-cancel',
    success: '請假已取消，尚未使用的補課權益已收回。',
  })
}
async function bookMakeup(item) {
  if (!hasSelectedMakeupTarget(item)) return showProductizedAction('請先選擇仍可預約的補課場次。', 'error')
  return runProductizedAction({
    endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.makeupBook(item.id), item,
    body: { sessionId: Number(productizedTargets[item.id]) }, prefix: 'makeup-book',
    success: '補課場次已預約。',
  })
}
async function checkoutMakeupInsurance(item) {
  if (!hasSelectedMakeupTarget(item)) return showProductizedAction('請先選擇仍可預約的補課場次。', 'error')
  if (productizedActionSaving.value) return
  productizedActionSaving.value = true
  try {
    const { data } = await axios.post(
      `${API}${COURSE_PRODUCTIZATION_ENDPOINTS.makeupInsuranceCheckout(item.id)}`,
      { sessionId: Number(productizedTargets[item.id]) },
      { headers: buildCourseMutationHeaders(item, { idempotencyKey: createCourseIdempotencyKey('makeup-insurance') }) },
    )
    const result = data?.data ?? data ?? {}
    productizedInsuranceOrders[item.id] = { ...result, paymentStatus: result.paymentStatus || result.status }
    showProductizedAction('補課保險訂單已建立，請於付款期限內送出後五碼。')
    await loadProductizedData()
  } catch (error) { showProductizedAction(courseCenterErrorMessage(error, '補課保險訂單建立失敗'), 'error') }
  finally { productizedActionSaving.value = false }
}
async function submitInsurancePayment(item) {
  const insurance = insuranceOrderFor(item)
  const last5 = String(productizedPaymentLast5[item.id] || '').trim()
  if (!insurance?.orderId || !/^\d{5}$/.test(last5) || productizedActionSaving.value) return
  const mutationMapKey = `makeup-insurance-payment:${insurance.orderId}:${last5}`
  if (!mutationKeys.has(mutationMapKey)) {
    mutationKeys.set(mutationMapKey, createCourseIdempotencyKey('makeup-insurance-payment'))
  }
  productizedActionSaving.value = true
  try {
    await axios.post(
      `${API}${COURSE_PRODUCTIZATION_ENDPOINTS.orderPaymentSubmission(insurance.orderId)}`,
      { last5 },
      { headers: buildCourseMutationHeaders(insurance, { idempotencyKey: mutationKeys.get(mutationMapKey) }) },
    )
    mutationKeys.delete(mutationMapKey)
    delete productizedPaymentLast5[item.id]
    showProductizedAction('後五碼已送出，席位會保留至人工審核。')
    await loadProductizedData()
  } catch (error) {
    if (!shouldRetainIdempotencyKey(error)) mutationKeys.delete(mutationMapKey)
    showProductizedAction(courseCenterErrorMessage(error, '匯款資料送出失敗'), 'error')
  }
  finally { productizedActionSaving.value = false }
}
async function actOnWaitlistOffer(offer, action) {
  if (productizedActionSaving.value) return
  productizedActionSaving.value = true
  try {
    await axios.post(
      `${API}${COURSE_PRODUCTIZATION_ENDPOINTS.memberWaitlistOfferAction(offer.id, action)}`,
      {},
      { headers: buildCourseMutationHeaders(offer, { idempotencyKey: createCourseIdempotencyKey(`waitlist-${action}`) }) },
    )
    showProductizedAction(action === 'accept' ? '已接受候補名額，請於保留期間內完成報價與結帳。' : '已放棄候補名額。')
    await loadProductizedData()
  } catch (error) { showProductizedAction(courseCenterErrorMessage(error, '候補名額操作失敗'), 'error') }
  finally { productizedActionSaving.value = false }
}
async function startRenewal(item) {
  if (productizedActionSaving.value) return
  productizedActionSaving.value = true
  try {
    const { data: eligibilityResponse } = await axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.renewalEligibility(item.id)}`)
    const eligibility = eligibilityResponse?.data ?? eligibilityResponse ?? {}
    if (!eligibility.eligible) throw new Error('目前不符合這筆續報資格')
    const { data: quoteResponse } = await axios.post(
      `${API}${COURSE_PRODUCTIZATION_ENDPOINTS.renewalQuote(item.id)}`,
      {},
      { headers: buildCourseMutationHeaders({ rowVersion: item.rowVersion ?? item.row_version }, { idempotencyKey: createCourseIdempotencyKey('renewal-quote') }) },
    )
    const quote = quoteResponse?.data ?? quoteResponse ?? {}
    try { sessionStorage.setItem(`course-renewal-quote:${quote.quoteId || quote.id}`, JSON.stringify(quote)) } catch (_) {}
    await router.push({ path: courseTermCheckoutPath(item.targetTermId || item.target_term_id), query: { quote: quote.quoteId || quote.id } })
  } catch (error) { showProductizedAction(courseCenterErrorMessage(error, error?.message || '續報資格驗證失敗'), 'error') }
  finally { productizedActionSaving.value = false }
}
async function markNotificationRead(item) {
  if (item.readAt) return
  return runProductizedAction({
    endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.memberNotificationRead(item.id), item,
    prefix: 'course-notification-read', success: '通知已標示為已讀。',
  })
}
function canCancel(booking) {
  if (typeof booking?.canCancel === 'boolean') return booking.canCancel
  if (booking?.capabilities && typeof booking.capabilities === 'object' && 'cancel' in booking.capabilities) return Boolean(booking.capabilities.cancel)
  const deadline = booking?.cancellationDeadline || booking?.cancelBefore || booking?.startsAt
  const time = courseTaipeiTimestamp(deadline)
  return Number.isFinite(time) && time > Date.now()
}
function isUpcoming(booking) { const time = courseTaipeiTimestamp(booking.endsAt || booking.startsAt); return Number.isFinite(time) && time >= Date.now() }
function canEditOrder(order) { return hasOrderCapability(order, 'edit') && hasEditableOrderField(order, 'quantity') }
function canCancelOrder(order) { return hasOrderCapability(order, 'cancel') }
function canTransferTicket(ticket) { if (!ticket?.transferable || ticket?.unlimited || !['pending', 'active', 'paused'].includes(ticket.status) || Number(ticket.remainingUses || 0) <= 0) return false; if (!ticket.expiresAt) return true; const expiry = courseTaipeiTimestamp(ticket.expiresAt); return Number.isFinite(expiry) && expiry >= Date.now() }
function canPartialTransferTicket(ticket) {
  return canTransferTicket(ticket)
    && ['pending', 'active'].includes(ticket.status)
    && Number(ticket.availableUses || 0) > 0
}
function isPartialTransferUnavailable(error) {
  const status = Number(error?.response?.status || 0)
  const code = String(error?.response?.data?.code || '')
  return [404, 501, 503].includes(status)
    || ['COURSE_COUNT_CARD_PARITY_DISABLED', 'COURSE_COUNT_CARD_PARITY_SCHEMA_REQUIRED', 'COURSE_COUNT_CARD_PARITY_PROVIDER_DISABLED', 'COURSE_COUNT_CARD_PARITY_UNAVAILABLE'].includes(code)
}
function closePartialTransfer() {
  partialTransferOpen.value = false
  partialTransferTicket.value = null
  partialTransferPreview.value = null
  partialTransferForm.recipientEmail = ''
  partialTransferForm.quantity = 1
  partialTransferFormError.value = ''
}
function openPartialTransfer(ticket) {
  partialTransferTicket.value = ticket
  partialTransferPreview.value = null
  partialTransferForm.recipientEmail = ''
  partialTransferForm.quantity = 1
  partialTransferFormError.value = ''
  partialTransferOpen.value = true
}
async function loadPartialTransfers() {
  if (props.mode !== 'tickets' || props.productizedTask) return
  const wasAvailable = partialTransferAvailable.value
  partialTransfersLoading.value = true
  partialTransfersError.value = ''
  try {
    const { data } = await axios.get(`${API}${COURSE_V2_ENDPOINTS.partialTransfers}`)
    const payload = data?.data || data || {}
    partialTransfers.incoming = (Array.isArray(payload.incoming) ? payload.incoming : []).map(normalizeCoursePartialTransfer)
    partialTransfers.outgoing = (Array.isArray(payload.outgoing) ? payload.outgoing : []).map(normalizeCoursePartialTransfer)
    partialTransferAvailable.value = true
  } catch (error) {
    partialTransfers.incoming = []
    partialTransfers.outgoing = []
    if (isPartialTransferUnavailable(error)) {
      partialTransferAvailable.value = false
      partialTransfersError.value = ''
    } else if (!wasAvailable) {
      partialTransferAvailable.value = false
      partialTransfersError.value = ''
    } else {
      partialTransferAvailable.value = true
      partialTransfersError.value = error?.response?.data?.message || '部分堂數轉讓紀錄載入失敗'
    }
  } finally { partialTransfersLoading.value = false }
}
async function previewPartialTransfer() {
  if (!partialTransferTicket.value || partialTransferSaving.value) return
  partialTransferSaving.value = true
  partialTransferFormError.value = ''
  try {
    const { data } = await axios.post(
      `${API}${COURSE_V2_ENDPOINTS.partialTransferPreview(partialTransferTicket.value.id)}`,
      {
        recipientEmail: partialTransferForm.recipientEmail,
        quantity: Number(partialTransferForm.quantity),
      }
    )
    partialTransferPreview.value = data?.data || data || null
  } catch (error) {
    if (isPartialTransferUnavailable(error)) {
      partialTransferAvailable.value = false
      closePartialTransfer()
      return showMessage('部分堂數轉讓尚未開放，已保留 Email 與掃碼轉讓。', 'error')
    }
    partialTransferFormError.value = error?.response?.data?.message || '無法預覽這筆轉讓'
  } finally { partialTransferSaving.value = false }
}
async function initiatePartialTransfer() {
  if (!partialTransferTicket.value || !partialTransferPreview.value || partialTransferSaving.value) return
  partialTransferSaving.value = true
  partialTransferFormError.value = ''
  const mutation = mutationConfig(partialTransferTicket.value, `partial-transfer-${partialTransferPreview.value.recipientUserId}-${partialTransferPreview.value.quantity}`)
  try {
    await axios.post(
      `${API}${COURSE_V2_ENDPOINTS.partialTransferInitiate(partialTransferTicket.value.id)}`,
      {
        recipientUserId: partialTransferPreview.value.recipientUserId,
        recipientEmail: partialTransferPreview.value.recipientEmail || partialTransferForm.recipientEmail,
        quantity: Number(partialTransferPreview.value.quantity),
      },
      mutation.config
    )
    mutationKeys.delete(mutation.key)
    closePartialTransfer()
    await Promise.all([loadData(meta.offset, { forceSummary: true }), loadPartialTransfers()])
    showMessage('部分堂數已保留，等待受讓人處理。')
  } catch (error) {
    if (isCourseVersionConflict(error)) mutationKeys.delete(mutation.key)
    partialTransferFormError.value = error?.response?.data?.message || '部分堂數轉讓建立失敗'
  } finally { partialTransferSaving.value = false }
}
async function actOnPartialTransfer(transfer, action) {
  if (partialTransferSaving.value) return
  const confirmation = action === 'accept'
    ? '確定接受這筆部分堂數轉讓？'
    : action === 'decline'
      ? '確定拒絕這筆部分堂數轉讓？'
      : '確定取消這筆部分堂數轉讓？保留堂數會立即釋放。'
  if (!(await showConfirm(confirmation, { title: '部分堂數轉讓', confirmText: '確定' }))) return
  partialTransferSaving.value = true
  const mutation = mutationConfig(transfer, `partial-transfer-${action}`)
  try {
    await axios.post(`${API}${COURSE_V2_ENDPOINTS.partialTransferAction(transfer.id, action)}`, {}, mutation.config)
    mutationKeys.delete(mutation.key)
    await Promise.all([loadData(meta.offset, { forceSummary: true }), loadPartialTransfers()])
    showMessage(action === 'accept' ? '已接受轉讓，受讓子票已建立。' : action === 'decline' ? '已拒絕轉讓。' : '已取消轉讓並釋放保留堂數。')
  } catch (error) {
    if (isCourseVersionConflict(error)) mutationKeys.delete(mutation.key)
    showMessage(error?.response?.data?.message || '轉讓操作失敗', 'error')
    await loadPartialTransfers()
  } finally { partialTransferSaving.value = false }
}
function normalizeAttendanceBooking(booking) {
  const verifyCode = String(booking?.verifyCode || '').trim().replace(/\s+/g, '').toUpperCase()
  if (booking?.status !== 'booked' || booking?.redeemable === false || !/^CBK-[A-F0-9]{16,32}$/.test(verifyCode)) return null
  return { ...booking, verifyCode }
}
function ticketRedemptionBookings(ticket) {
  return Array.isArray(ticket?.redemptionBookings)
    ? ticket.redemptionBookings.map(normalizeAttendanceBooking).filter(Boolean)
    : []
}
function ticketRedemptionCount(ticket) { return ticketRedemptionBookings(ticket).length }
function unpack(data) {
  const payload = data?.data
  if (Array.isArray(payload)) return { items: payload, meta: { total: payload.length, limit: Math.max(payload.length, 10), offset: 0, hasMore: false }, summary: {} }
  if (Array.isArray(payload?.items)) return { items: payload.items, meta: payload.meta || {}, summary: payload.summary || {} }
  const legacy = Array.isArray(payload?.[props.mode]) ? payload[props.mode] : []
  return { items: legacy, meta: { total: legacy.length, limit: Math.max(legacy.length, 10), offset: 0, hasMore: false }, summary: {} }
}

function normalizeModeItem(item) {
  if (props.mode === 'tickets') return normalizeCourseTicket(item)
  if (props.mode === 'bookings') {
    const redeemableNow = item.redeemableNow ?? item.redeemable_now ?? item.redeemable
    return {
      ...item,
      cancellationDeadline: item.cancellationDeadline || item.cancellation_deadline || item.cancelBefore || item.cancel_before,
      redeemable: redeemableNow === undefined ? true : Boolean(redeemableNow),
      redeemableNow: redeemableNow === undefined ? true : Boolean(redeemableNow),
      redeemableReason: item.redeemableReason || item.redeemable_reason || item.redeemableNowReason || item.redeemable_now_reason || '',
      rowVersion: item.rowVersion || item.row_version || item.version || '',
    }
  }
  return normalizeOrderRecord(item, 'course')
}

async function loadData(offset = 0, options = {}) {
  const currentRequest = ++requestId
  loading.value = true
  loadError.value = ''
  try {
    const params = { paged: 1, view: props.mode, limit: meta.limit || 10, offset: Math.max(0, Number(offset) || 0), q: query.value.trim(), includeSummary: options.forceSummary || !Object.keys(summary.value || {}).length ? 1 : 0 }
    if (statusFilter.value) params.statuses = statusFilter.value
    if (props.mode === 'bookings' && periodFilter.value) params.upcoming = periodFilter.value === 'upcoming' ? 1 : 0
    const { data } = await axios.get(`${API}/courses/me`, { params })
    if (currentRequest !== requestId) return
    const result = unpack(data)
    items.value = result.items.map(normalizeModeItem)
    meta.total = Math.max(0, Number(result.meta?.total ?? result.items.length) || 0)
    meta.limit = Math.max(1, Number(result.meta?.limit ?? 10) || 10)
    meta.offset = Math.max(0, Number(result.meta?.offset ?? 0) || 0)
    meta.hasMore = Boolean(result.meta?.hasMore)
    if (Object.keys(result.summary || {}).length) summary.value = result.summary
    if (!result.items.length && meta.offset > 0) {
      const lastOffset = meta.total > 0 ? Math.floor((meta.total - 1) / meta.limit) * meta.limit : 0
      return loadData(lastOffset, options)
    }
    openHighlightedItem()
  } catch (error) { if (currentRequest === requestId) loadError.value = error?.response?.data?.message || '我的課程載入失敗' }
  finally { if (currentRequest === requestId) loading.value = false }
}

function scheduleSearch() { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(() => loadData(0), 300) }
function clearFilters() { query.value = ''; statusFilter.value = ''; periodFilter.value = '' }
async function openDetail(item) {
  selectedItem.value = props.mode === 'tickets' ? normalizeCourseTicket(item) : item
  detailOpen.value = true
  if (props.mode !== 'tickets' || !item?.id) return
  ledgerLoading.value = true
  try {
    const { data } = await axios.get(`${API}${COURSE_V2_ENDPOINTS.ticketLedger(item.id)}`)
    if (String(selectedItem.value?.id) !== String(item.id)) return
    const payload = data?.data || data || {}
    const events = Array.isArray(payload) ? payload : (payload.items || payload.events || payload.usageEvents || [])
    selectedItem.value = normalizeCourseTicket({
      ...selectedItem.value,
      ...(payload.balance || {}),
      ledger: events.map(normalizeCourseUsageEvent),
    })
  } catch (error) {
    if (Number(error?.response?.status || 0) !== 404) {
      showMessage(error?.response?.data?.message || '堂數帳本載入失敗', 'error')
    }
  } finally {
    if (String(selectedItem.value?.id) === String(item.id)) ledgerLoading.value = false
  }
}
function closeDetail() {
  detailOpen.value = false
  selectedItem.value = null
  const nextQuery = { ...route.query }
  delete nextQuery.order
  delete nextQuery.booking
  delete nextQuery.ticket
  router.replace({ query: nextQuery }).catch(() => {})
}

function mutationConfig(record, action) {
  const id = String(record?.id || record?.code || '')
  const mapKey = `${action}:${id}`
  if (!mutationKeys.has(mapKey)) mutationKeys.set(mapKey, createCourseIdempotencyKey(`course-${action}`))
  return {
    key: mapKey,
    config: {
      headers: buildCourseMutationHeaders(record, {
        idempotencyKey: mutationKeys.get(mapKey),
      }),
    },
  }
}

async function refreshAfterConflict(messageText = '資料已由其他操作更新，已重新載入最新狀態。') {
  await loadData(meta.offset, { forceSummary: true })
  showMessage(messageText, 'error')
}
function openHighlightedItem() { const target = String(props.mode === 'orders' ? route.query.order || '' : props.mode === 'bookings' ? route.query.booking || '' : route.query.ticket || ''); if (!target) return; const item = items.value.find(row => String(row.id) === target || String(row.code) === target); if (item) openDetail(item) }
function handleAuthChanged() {
  if (searchTimer) clearTimeout(searchTimer)
  requestId += 1
  query.value = ''
  statusFilter.value = ''
  periodFilter.value = ''
  items.value = []
  summary.value = {}
  meta.total = 0
  meta.offset = 0
  meta.hasMore = false
  message.value = ''
  closeAction()
  closeAttendanceSelector()
  closeOrderEdit()
  closeDetail()
  closePartialTransfer()
  partialTransferAvailable.value = false
  partialTransfers.incoming = []
  partialTransfers.outgoing = []
  loadData(0, { forceSummary: true })
  if (props.mode === 'tickets' && !props.productizedTask) loadPartialTransfers()
}
function handleStorage(event) { if (!event || event.key === 'user_info') handleAuthChanged() }
function openAction(ticket) { selectedTicket.value = ticket; actionValue.value = ''; actionError.value = ''; actionOpen.value = true }
function closeAction() { actionOpen.value = false; selectedTicket.value = null; actionValue.value = ''; actionError.value = '' }
function requestTransferEmail(ticket) { emit('transfer-email', ticket) }
function requestTransferQr(ticket) { emit('transfer-qr', ticket) }
function requestAttendanceQr(booking) {
  const normalizedBooking = normalizeAttendanceBooking(booking)
  if (!normalizedBooking) return showMessage('此課程預約尚無可用核銷碼，請重新整理後再試。', 'error')
  emit('attendance-qr', normalizedBooking)
}
function openTicketAttendanceQr(ticket) {
  const bookings = ticketRedemptionBookings(ticket)
  if (!bookings.length) return showMessage('此票券目前沒有可用的課程核銷碼，請重新整理後再試。', 'error')
  if (bookings.length === 1) return requestAttendanceQr(bookings[0])
  attendanceSelectorTicket.value = ticket
  attendanceSelectorBookings.value = bookings
  pendingAttendanceBooking.value = null
  attendanceSelectorOpen.value = true
}
function closeAttendanceSelector() {
  attendanceSelectorOpen.value = false
  attendanceSelectorTicket.value = null
  attendanceSelectorBookings.value = []
  pendingAttendanceBooking.value = null
}
function selectAttendanceBooking(booking) {
  const normalizedBooking = normalizeAttendanceBooking(booking)
  if (!normalizedBooking) return showMessage('此課程預約尚無可用核銷碼，請重新整理後再試。', 'error')
  pendingAttendanceBooking.value = normalizedBooking
  attendanceSelectorOpen.value = false
}
function emitPendingAttendanceQr() {
  const booking = pendingAttendanceBooking.value
  attendanceSelectorTicket.value = null
  attendanceSelectorBookings.value = []
  pendingAttendanceBooking.value = null
  if (booking) emit('attendance-qr', booking)
}

async function submitAction() {
  if (!selectedTicket.value || !actionValue.value) return
  submitting.value = true
  const mutation = mutationConfig(selectedTicket.value, 'pause')
  try { await axios.post(`${API}/courses/tickets/${selectedTicket.value.id}/pause`, { reason: actionValue.value }, mutation.config); mutationKeys.delete(mutation.key); closeAction(); await loadData(meta.offset, { forceSummary: true }); showMessage('票券已暫停。') }
  catch (error) { if (isCourseVersionConflict(error)) { mutationKeys.delete(mutation.key); closeAction(); await refreshAfterConflict() } else actionError.value = error?.response?.data?.message || '票券操作失敗' }
  finally { submitting.value = false }
}
async function resumeTicket(ticket) { submitting.value = true; const mutation = mutationConfig(ticket, 'resume'); try { await axios.post(`${API}/courses/tickets/${ticket.id}/resume`, {}, mutation.config); mutationKeys.delete(mutation.key); await loadData(meta.offset, { forceSummary: true }); showMessage('票券已恢復使用。') } catch (error) { if (isCourseVersionConflict(error)) { mutationKeys.delete(mutation.key); await refreshAfterConflict() } else showMessage(error?.response?.data?.message || '票券恢復失敗', 'error') } finally { submitting.value = false } }
async function cancelBooking(booking) { if (!(await showConfirm(`確定取消「${booking.sessionTitle}」的預約？保留的 1 堂會立即釋放。`, { title: '取消課程預約', confirmText: '確定取消' }))) return; const mutation = mutationConfig(booking, 'cancel-booking'); try { await axios.delete(`${API}/courses/bookings/${booking.id}`, mutation.config); mutationKeys.delete(mutation.key); await loadData(meta.offset, { forceSummary: true }); showMessage('預約已取消，保留堂數已釋放。') } catch (error) { if (isCourseVersionConflict(error)) { mutationKeys.delete(mutation.key); await refreshAfterConflict() } else showMessage(error?.response?.data?.message || '取消預約失敗', 'error') } }

async function openOrderEdit(order) {
  if (!canEditOrder(order)) return
  selectedOrder.value = order
  orderEditForm.value = { quantity: Number(order.quantity || 1), remittanceLast5: String(order.remittanceLast5 || '') }
  actionError.value = ''
  orderEditOpen.value = true
  try {
    const contact = await currentContact()
    orderEditForm.value.remittanceLast5 = contact.remittanceLast5
  } catch (error) {
    actionError.value = error?.response?.data?.message || '無法取得目前會員資料'
  }
}
function closeOrderEdit() { orderEditOpen.value = false; selectedOrder.value = null; actionError.value = '' }
async function currentContact() { const { data } = await axios.get(`${API}/me`); const profile = data?.data || data || {}; return { username: String(profile.username || '').trim(), email: String(profile.email || '').trim(), phone: String(profile.phone || '').trim(), remittanceLast5: String((profile.remittanceLast5 ?? profile.remittance_last5) || '').trim() } }
async function saveOrderEdit() {
  if (!selectedOrder.value || !canEditOrder(selectedOrder.value) || submitting.value) return
  submitting.value = true
  try {
    const contact = await currentContact()
    orderEditForm.value.remittanceLast5 = contact.remittanceLast5
    const accepted = await userDataReviewRef.value?.open({ title: '再次確認課程訂單資料', description: '修改後的訂單會使用目前會員聯絡資料，款項確認中的訂單會回到待匯款。', summary: [{ key: 'course-order-edit', label: selectedOrder.value.productName, value: `${orderEditForm.value.quantity} 份`, detail: `匯款後五碼 ${orderEditForm.value.remittanceLast5}` }], fields: [{ key: 'username', label: '真實姓名', value: contact.username }, { key: 'email', label: '電子信箱', value: contact.email }, { key: 'phone', label: '手機號碼', value: contact.phone }, { key: 'remittanceLast5', label: '會員匯款後五碼', value: contact.remittanceLast5 }] })
    if (accepted !== true) return
    const quantity = clampPurchaseQuantity(orderEditForm.value.quantity, selectedOrder.value)
    const mutation = mutationConfig(selectedOrder.value, `edit-order-${quantity}`)
    await axios.patch(`${API}/courses/orders/${selectedOrder.value.id}`, { quantity, remittanceLast5: String(orderEditForm.value.remittanceLast5 || '').trim(), contactConfirmation: contact }, mutation.config)
    mutationKeys.delete(mutation.key)
    closeOrderEdit(); await loadData(meta.offset, { forceSummary: true }); showMessage('課程訂單已更新。')
  } catch (error) {
    const quantity = clampPurchaseQuantity(orderEditForm.value.quantity, selectedOrder.value || {})
    const key = `edit-order-${quantity}:${String(selectedOrder.value?.id || selectedOrder.value?.code || '')}`
    const retainKey = shouldRetainIdempotencyKey(error)
    if (!retainKey) mutationKeys.delete(key)
    if (!retainKey && isCourseVersionConflict(error)) { closeOrderEdit(); await refreshAfterConflict() }
    else actionError.value = error?.response?.data?.message || '課程訂單更新失敗'
  }
  finally { submitting.value = false }
}
async function cancelOrder(order) { if (!canCancelOrder(order)) return; if (!(await showConfirm(`確定取消課程訂單 ${order.code}？`, { title: '取消課程訂單', confirmText: '確認取消' }))) return; const mutation = mutationConfig(order, 'cancel-order'); try { await axios.post(`${API}/courses/orders/${order.id}/cancel`, {}, mutation.config); mutationKeys.delete(mutation.key); await loadData(meta.offset, { forceSummary: true }); showMessage('課程訂單已取消。') } catch (error) { const retainKey = shouldRetainIdempotencyKey(error); if (!retainKey) mutationKeys.delete(mutation.key); if (!retainKey && isCourseVersionConflict(error)) await refreshAfterConflict(); else showMessage(error?.response?.data?.message || '課程訂單取消失敗', 'error') } }

watch(query, scheduleSearch)
watch(statusFilter, () => loadData(0))
watch(periodFilter, () => loadData(0))
watch(() => props.mode, () => { items.value = []; summary.value = {}; meta.offset = 0; query.value = ''; statusFilter.value = ''; periodFilter.value = ''; closeAttendanceSelector(); closePartialTransfer(); loadData(0, { forceSummary: true }); if (props.mode === 'tickets' && !props.productizedTask) loadPartialTransfers() })
watch(() => props.productizedTask, () => {
  productizedItems.value = []
  notificationUnreadCount.value = 0
  productizedActionNotice.value = ''
  productizedActionOpen.value = ''
  if (productizedApiTask.value) loadProductizedData()
  else if (props.productizedTask === 'passes') router.replace({ path: '/wallet', query: { tab: 'tickets', category: 'course' } }).catch(() => {})
  else if (props.productizedTask === 'orders') router.replace({ path: '/store', query: { tab: 'courses', orders: '1', category: 'course' } }).catch(() => {})
})
defineExpose({ refresh: () => loadData(meta.offset, { forceSummary: true }) })
onMounted(() => {
  window.addEventListener('auth-changed', handleAuthChanged)
  window.addEventListener('storage', handleStorage)
  deadlineTimer = window.setInterval(() => { deadlineNow.value = Date.now() }, 60_000)
  if (productizedApiTask.value) loadProductizedData()
  else if (props.productizedTask === 'passes') router.replace({ path: '/wallet', query: { tab: 'tickets', category: 'course' } }).catch(() => {})
  else if (props.productizedTask === 'orders') router.replace({ path: '/store', query: { tab: 'courses', orders: '1', category: 'course' } }).catch(() => {})
  else {
    loadData(0, { forceSummary: true })
    if (props.mode === 'tickets') loadPartialTransfers()
  }
})
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  if (deadlineTimer) window.clearInterval(deadlineTimer)
  window.removeEventListener('auth-changed', handleAuthChanged)
  window.removeEventListener('storage', handleStorage)
})
</script>
