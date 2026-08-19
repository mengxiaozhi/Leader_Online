<template>
  <CourseAdminFrame
    v-if="productizedTask"
    :embedded="embedded && !coachSurface"
    :title="coachSurface ? '教練場次中心' : '課程管理中心'"
    :description="coachSurface ? '查看本場名冊並依伺服器時間窗完成報到。' : '商品、固定班、課表、課務與學員資料依任務分區；訂單與票券保留分類式共用紀錄。'"
    :eyebrow="coachSurface ? '教練課務' : '課程管理'"
    :tasks="coachSurface ? [] : adminCourseTasks"
    :active-key="adminTask.key"
    nav-label="課程管理任務"
  >
    <template v-if="!coachSurface && !embedded" #header-actions>
      <router-link to="/admin?tab=courses" class="btn btn-outline">返回既有課程後台</router-link>
    </template>
    <template v-if="!coachSurface && !productizedV2PanelConfig" #context>
      <label class="block max-w-xl space-y-2 text-sm font-medium text-slate-700">課程租戶
          <select v-model="productizedOwnerUserId" class="w-full" :disabled="productizedContextLoading || productizedOwnerOptions.length < 2" @change="changeProductizedOwner">
            <option value="" disabled>{{ productizedContextLoading ? '租戶載入中…' : '請選擇課程租戶' }}</option>
            <option v-for="owner in productizedOwnerOptions" :key="owner.id" :value="owner.id">{{ owner.label }}</option>
          </select>
          <span class="block text-xs font-normal text-slate-500">所有查詢與建立資料都會帶入此 owner scope；切換後會重新載入。</span>
      </label>
    </template>

    <section class="space-y-4" :aria-labelledby="`course-admin-${adminTask.key}`">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p v-if="!coachSurface" class="text-sm font-medium text-primary">{{ adminTask.group }}</p><h2 :id="`course-admin-${adminTask.key}`" class="ui-title text-xl text-slate-950">{{ coachSurface ? (productizedTask === 'coach-check-in' ? '場次報到' : '場次名冊') : adminTask.label }}</h2><p class="mt-1 text-sm leading-6 text-slate-600">{{ productizedTaskDescription }}</p></div><button v-if="!productizedV2PanelConfig" type="button" class="btn btn-outline" :disabled="productizedLoading || productizedContextLoading || (!coachSurface && !productizedOwnerUserId)" @click="loadProductizedAdminData">{{ productizedLoading ? '載入中…' : '重新載入' }}</button></div>
        <p v-if="productizedActionNotice" class="rounded-xl border px-4 py-3 text-sm" :class="productizedActionTone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'" :role="productizedActionTone === 'error' ? 'alert' : 'status'">{{ productizedActionNotice }}</p>
        <CourseV2AdminPanel
          v-if="productizedV2PanelConfig"
          :current-role="role"
          :current-user-id="effectiveCurrentUserId"
          :capabilities="effectiveCourseCapabilities"
          :memberships="effectiveCourseMemberships"
          :provider-options="providerOptions"
          :initial-tab="productizedV2PanelConfig.initialTab"
          :allowed-tabs="productizedV2PanelConfig.allowedTabs"
        />
        <section
          v-if="!productizedV2PanelConfig && adminTask.key === 'classes' && productizedFeatureReadiness"
          class="surface-section space-y-3"
          :class="fixedTermAdminActive ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/60'"
          aria-live="polite"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 class="font-medium text-slate-950">{{ fixedTermAdminActive ? '固定班管理已啟用' : '固定班管理尚未可用' }}</h3>
              <p class="mt-1 text-sm text-slate-600">052 {{ productizedFeatureReadiness.schema?.termReady ? '已完成' : '未完成' }}・053 {{ productizedFeatureReadiness.schema?.paymentReady ? '已完成' : '未完成' }}・付款 {{ fixedTermPaymentsActive ? '已啟用' : '尚未啟用' }}</p>
            </div>
            <router-link to="/admin/courses/settings" class="btn btn-outline btn-sm">前往課程設定</router-link>
          </div>
          <ul v-if="fixedTermBlockers.length" class="list-disc space-y-1 pl-5 text-sm text-amber-900">
            <li v-for="blocker in fixedTermBlockers" :key="blocker.code">{{ blocker.message }}</li>
          </ul>
          <p v-if="productizedFeatureReadiness.bankTransferOnly" class="text-sm font-medium text-slate-700">首波付款限制：只開放銀行匯款；課程券與體驗折抵保持關閉。</p>
        </section>
        <div v-if="productizedLoading" class="grid gap-4 md:grid-cols-2"><div v-for="index in 4" :key="index" class="ticket-card animate-pulse p-5"><div class="h-5 w-2/3 rounded bg-slate-200"></div><div class="mt-4 h-20 rounded bg-slate-100"></div></div></div>
        <div v-else-if="productizedError" class="surface-section text-sm text-amber-800" role="alert"><p>{{ productizedError }}</p><button type="button" class="btn btn-outline mt-3" @click="loadProductizedAdminData">重新載入</button></div>
        <div v-else-if="adminTask.key === 'classes' && !fixedTermAdminActive" class="surface-section text-sm leading-6 text-slate-600">完成上方阻擋項目後再重新載入；固定班任務不會被靜默隱藏。</div>
        <template v-else-if="adminTask.key === 'classes'">
          <section class="surface-section space-y-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 class="ui-title text-lg text-slate-950">固定班商品建立</h3><p class="text-sm text-slate-600">依序建立課程計畫、程度與班期，再補齊場次與定價後發布。</p></div><div class="flex flex-wrap gap-2"><button type="button" class="btn btn-outline btn-sm" @click="openProductizedEditor('program')">新增課程計畫</button><button type="button" class="btn btn-outline btn-sm" @click="openProductizedEditor('scheme')">新增程度方案</button><button type="button" class="btn btn-outline btn-sm" :disabled="!productizedCatalog.levelSchemes.length" @click="openProductizedEditor('level')">新增程度</button><button type="button" class="btn btn-primary btn-sm text-white" :disabled="!productizedCatalog.programs.length" @click="openProductizedEditor('term')">新增班期</button></div></div>
            <div class="grid gap-4 lg:grid-cols-2">
              <article class="rounded-xl border border-slate-200 p-4"><h4 class="font-medium text-slate-950">課程計畫（{{ productizedCatalog.programs.length }}）</h4><p v-if="!productizedCatalog.programs.length" class="mt-3 text-sm text-slate-500">尚未建立課程計畫。</p><ul v-else class="mt-3 space-y-2"><li v-for="program in productizedCatalog.programs" :key="program.id" class="rounded-lg bg-slate-50 px-3 py-2 text-sm"><strong>{{ program.name }}</strong><span class="ml-2 text-slate-500">{{ program.code }}・{{ adminStatusLabel(program) }}</span></li></ul></article>
              <article class="rounded-xl border border-slate-200 p-4"><h4 class="font-medium text-slate-950">程度方案（{{ productizedCatalog.levelSchemes.length }}）</h4><p v-if="!productizedCatalog.levelSchemes.length" class="mt-3 text-sm text-slate-500">尚未建立程度方案。</p><ul v-else class="mt-3 space-y-2"><li v-for="scheme in productizedCatalog.levelSchemes" :key="scheme.id" class="rounded-lg bg-slate-50 px-3 py-2 text-sm"><strong>{{ scheme.name }}</strong><p class="mt-1 text-xs text-slate-500">{{ levelsForScheme(scheme.id).map(level => level.name).join('、') || '尚未建立程度' }}</p></li></ul></article>
            </div>
          </section>
          <section class="surface-section space-y-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 class="ui-title text-lg text-slate-950">補課路由設定</h3><p class="text-sm text-slate-600">指定來源班期可使用的目標場次、預約視窗與獨立補課名額。</p></div><button type="button" class="btn btn-primary btn-sm text-white" :disabled="!productizedCatalog.terms.length || !productizedCatalog.sessions.length" @click="openProductizedEditor('makeup-route')">新增補課路由</button></div>
            <p v-if="!productizedCatalog.makeupRoutes.length" class="text-sm text-slate-500">尚未建立補課路由，學員不會看到可預約的目標場次。</p>
            <div v-else class="grid gap-3 lg:grid-cols-2"><article v-for="route in productizedCatalog.makeupRoutes" :key="route.id" class="rounded-xl border border-slate-200 p-4"><header class="flex items-start justify-between gap-3"><div><strong class="text-slate-950">{{ route.source_term_name || route.sourceTermName || '來源班期' }}</strong><p class="mt-1 text-sm text-slate-600">→ {{ route.target_session_title || route.targetSessionTitle || '目標場次' }}</p></div><span class="ops-chip" :class="adminStatusClass(route)">{{ adminStatusLabel(route) }}</span></header><dl class="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt class="text-slate-500">目標時間</dt><dd>{{ formatDateTime(route.starts_at || route.startsAt) }}</dd></div><div><dt class="text-slate-500">補課名額</dt><dd>{{ route.capacityOverride ?? route.capacity_override ?? '沿用場次' }}</dd></div><div class="col-span-2"><dt class="text-slate-500">預約視窗</dt><dd>{{ route.bookingOpenAt || route.booking_open_at ? formatDateTime(route.bookingOpenAt || route.booking_open_at) : '不限' }} 至 {{ route.bookingCloseAt || route.booking_close_at ? formatDateTime(route.bookingCloseAt || route.booking_close_at) : '不限' }}</dd></div></dl><button type="button" class="btn btn-outline btn-sm mt-3 w-full" @click="openProductizedEditor('makeup-route', route)">編輯補課路由</button></article></div>
          </section>
          <section class="surface-section space-y-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 class="ui-title text-lg text-slate-950">開放水域補課保險</h3><p class="text-sm text-slate-600">規則綁定目標補課場次；只有「必須投保」且啟用的規則會導入保險結帳。</p></div><button type="button" class="btn btn-primary btn-sm text-white" :disabled="!fixedTermPaymentsActive || !productizedCatalog.sessions.length" @click="openProductizedEditor('insurance-policy')">新增保險規則</button></div>
            <p v-if="!fixedTermPaymentsActive" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">053 schema、runtime 或租戶旗標尚未全部啟用；保險與付款區暫停，但固定班 catalog、場次及補課路由仍可管理。</p>
            <p v-else-if="!productizedCatalog.insurancePolicies.length" class="text-sm text-slate-500">尚未建立保險規則。</p>
            <div v-else class="grid gap-3 lg:grid-cols-2"><article v-for="policy in productizedCatalog.insurancePolicies" :key="policy.id" class="rounded-xl border border-slate-200 p-4"><header class="flex items-start justify-between gap-3"><div><strong class="text-slate-950">{{ policy.session_title || policy.sessionTitle || '補課場次' }}</strong><p class="mt-1 text-sm text-slate-500">{{ formatDateTime(policy.starts_at || policy.startsAt) }}</p></div><span class="ops-chip" :class="adminStatusClass(policy)">{{ adminStatusLabel(policy) }}</span></header><dl class="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt class="text-slate-500">規則</dt><dd>{{ Number(policy.required) ? '必須投保' : '可選投保' }}</dd></div><div><dt class="text-slate-500">保費</dt><dd>{{ policy.currency || 'TWD' }} {{ Number(policy.fee_amount ?? policy.feeAmount ?? 0).toLocaleString() }}</dd></div><div class="col-span-2"><dt class="text-slate-500">費用商品</dt><dd>{{ policy.fee_product_name || policy.feeProductName || '未指定（仍以規則金額建單）' }}</dd></div></dl><button type="button" class="btn btn-outline btn-sm mt-3 w-full" @click="openProductizedEditor('insurance-policy', policy)">編輯保險規則</button></article></div>
          </section>
          <section class="surface-section space-y-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 class="ui-title text-lg text-slate-950">續報規則</h3><p class="text-sm text-slate-600">綁定已結業來源班期、目標班期與續報開放期間。</p></div><button type="button" class="btn btn-primary btn-sm text-white" :disabled="productizedCatalog.terms.length < 2" @click="openProductizedEditor('renewal-rule')">新增續報規則</button></div>
            <p v-if="!productizedCatalog.renewalRules.length" class="text-sm text-slate-500">尚未建立續報規則。</p>
            <div v-else class="grid gap-3 lg:grid-cols-2"><article v-for="rule in productizedCatalog.renewalRules" :key="rule.id" class="rounded-xl border border-slate-200 p-4"><header class="flex items-start justify-between gap-3"><div><strong class="text-slate-950">{{ rule.source_term_name || rule.sourceTermName || '來源班期' }} → {{ rule.target_term_name || rule.targetTermName || '目標班期' }}</strong><p class="mt-1 text-sm text-slate-500">{{ formatDateTime(rule.renewal_open_at || rule.renewalOpenAt) }} 至 {{ formatDateTime(rule.renewal_close_at || rule.renewalCloseAt) }}</p></div><span class="ops-chip" :class="adminStatusClass(rule)">{{ adminStatusLabel(rule) }}</span></header><button type="button" class="btn btn-outline btn-sm mt-3 w-full" @click="openProductizedEditor('renewal-rule', rule)">編輯續報規則</button></article></div>
          </section>
          <div v-if="!productizedCatalog.terms.length" class="surface-section text-sm leading-6 text-slate-600">目前沒有固定班期，請先建立課程計畫與班期。</div>
          <section v-else class="grid gap-4 xl:grid-cols-2">
            <article v-for="term in productizedCatalog.terms" :key="term.id" class="ticket-card flex flex-col gap-4 p-5">
              <header class="flex items-start justify-between gap-3"><div><p class="text-xs text-slate-500">{{ term.program_name || term.programName }}・{{ term.code }}</p><h3 class="ui-title mt-1 text-xl text-slate-950">{{ term.name }}</h3><p class="mt-1 text-sm text-slate-600">{{ term.level_name || term.levelName || '不限程度' }}</p></div><span class="ops-chip" :class="adminStatusClass(term)">{{ adminStatusLabel(term) }}</span></header>
              <dl class="grid grid-cols-2 gap-3 text-sm"><div><dt class="text-slate-500">班期</dt><dd class="mt-1">{{ term.starts_on || term.startsOn }} 至 {{ term.ends_on || term.endsOn }}</dd></div><div><dt class="text-slate-500">名額</dt><dd class="mt-1">{{ term.capacity == null ? '不限名額' : `${term.capacity} 人` }}</dd></div><div><dt class="text-slate-500">場次</dt><dd class="mt-1">{{ sessionsForTerm(term.id).length }} 堂</dd></div><div><dt class="text-slate-500">有效定價</dt><dd class="mt-1">{{ pricingRulesForTerm(term.id).length }} 筆</dd></div></dl>
              <div v-if="sessionsForTerm(term.id).length" class="rounded-xl bg-slate-50 p-3"><p class="text-xs font-medium text-slate-500">已排場次</p><ul class="mt-2 space-y-2"><li v-for="session in sessionsForTerm(term.id)" :key="session.id" class="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between"><span class="min-w-0"><strong class="text-slate-800">{{ session.title || '固定班場次' }}</strong><span class="ml-2 text-slate-500">{{ session.location || session.venueName || session.venue_name || '地點待定' }}</span></span><span class="shrink-0 text-xs text-slate-500">{{ formatRange(session.startsAt || session.starts_at, session.endsAt || session.ends_at) }}</span></li></ul></div>
              <div v-if="productizedReadiness[term.id]" class="rounded-lg border p-3 text-sm" :class="productizedReadiness[term.id].ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'"><strong>{{ productizedReadiness[term.id].ready ? '可發布' : '尚不可發布' }}</strong><ul v-if="productizedReadiness[term.id].issues?.length" class="mt-2 list-disc space-y-1 pl-5"><li v-for="issue in productizedReadiness[term.id].issues" :key="issue.code">{{ issue.message }}</li></ul></div>
              <div class="mt-auto grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 sm:grid-cols-4"><button type="button" class="btn btn-outline btn-sm" :disabled="String(term.status).toLowerCase() !== 'draft'" @click="openProductizedEditor('session', term)">加場次</button><button type="button" class="btn btn-outline btn-sm" @click="openProductizedEditor('pricing', term)">加定價</button><button type="button" class="btn btn-outline btn-sm" :disabled="productizedActionBusy === `readiness-${term.id}`" @click="checkTermReadiness(term)">發布檢查</button><button type="button" class="btn btn-primary btn-sm text-white" :disabled="String(term.status).toLowerCase() === 'published' || productizedActionBusy === `publish-${term.id}`" @click="publishProductizedTerm(term)">發布</button></div>
            </article>
          </section>
        </template>

        <template v-else-if="adminTask.key === 'students'">
          <div v-if="!productizedItems.length" class="surface-section text-sm leading-6 text-slate-600">{{ productizedEmptyText }}</div>
          <section v-else class="grid gap-4 lg:grid-cols-2"><article v-for="item in productizedItems" :key="item.id" class="ticket-card flex flex-col gap-4 p-5"><header class="flex items-start justify-between gap-3"><div><h3 class="ui-title text-lg text-slate-950">{{ item.display_name || item.displayName || item.student_name || item.studentName }}</h3><p class="mt-1 text-sm text-slate-500">{{ item.email }}</p></div><span class="ops-chip" :class="adminStatusClass(item)">{{ adminStatusLabel(item) }}</span></header><dl class="grid grid-cols-2 gap-3 text-sm"><div><dt class="text-slate-500">目前程度</dt><dd class="mt-1">{{ item.level_name || item.levelName || '尚未設定' }}</dd></div><div><dt class="text-slate-500">評估</dt><dd class="mt-1">{{ assessmentStatusLabel(item.assessment_status || item.assessmentStatus) }}</dd></div><div><dt class="text-slate-500">報名數</dt><dd class="mt-1">{{ item.enrollment_count ?? item.enrollmentCount ?? 0 }}</dd></div><div><dt class="text-slate-500">手機</dt><dd class="mt-1">{{ item.phone || '—' }}</dd></div></dl><button type="button" class="btn btn-primary mt-auto w-full text-white" :disabled="!productizedCatalog.levelSchemes.length" @click="openProductizedEditor('student-level', item)">更新程度評估</button></article></section>
        </template>

        <template v-else-if="adminTask.key === 'enrollments'">
          <section class="surface-section space-y-4"><div><h3 class="ui-title text-lg text-slate-950">候補名額與限時 offer</h3><p class="mt-1 text-sm text-slate-600">依座位 allocation 即時重新檢查，一次只會釋出一位等待中候補。</p></div><div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto_auto]"><label class="space-y-1 text-sm font-medium text-slate-700">固定班期<select v-model="productizedWaitlistTermId" class="w-full" @change="loadProductizedWaitlist"><option value="">請選擇班期</option><option v-for="term in productizedCatalog.terms" :key="term.id" :value="String(term.id)">{{ term.name }}（{{ term.code }}）</option></select></label><label class="space-y-1 text-sm font-medium text-slate-700">offer 分鐘<input v-model.number="productizedOfferMinutes" type="number" min="15" max="10080" class="w-full" /></label><button type="button" class="btn btn-outline self-end" :disabled="!productizedWaitlistTermId || productizedWaitlistLoading" @click="loadProductizedWaitlist">查看候補</button><button type="button" class="btn btn-primary self-end text-white" :disabled="!selectedWaitlistTerm || productizedActionBusy === 'waitlist-offer'" @click="createProductizedWaitlistOffer">釋出下一位</button></div><p v-if="productizedWaitlistLoading" class="text-sm text-slate-500">候補載入中…</p><p v-else-if="productizedWaitlistTermId && !productizedWaitlist.length" class="text-sm text-slate-500">此班期目前沒有候補紀錄。</p><ul v-else-if="productizedWaitlist.length" class="grid gap-2 sm:grid-cols-2"><li v-for="entry in productizedWaitlist" :key="entry.id" class="rounded-lg border border-slate-200 p-3 text-sm"><strong>{{ entry.student_name || entry.studentName }}</strong><p class="mt-1 text-slate-500">{{ entry.student_email || entry.studentEmail }}・順位 {{ entry.priority }}</p><p class="mt-1">{{ adminStatusLabel(entry) }}<span v-if="entry.offer_expires_at"> ・至 {{ formatDateTime(entry.offer_expires_at) }}</span></p></li></ul></section>
          <div v-if="!productizedItems.length" class="surface-section text-sm leading-6 text-slate-600">{{ productizedEmptyText }}</div>
          <section v-else class="grid gap-4 lg:grid-cols-2"><article v-for="item in productizedItems" :key="item.id" class="ticket-card flex flex-col gap-4 p-5"><header class="flex items-start justify-between gap-3"><div><p class="text-xs text-slate-500">{{ item.enrollment_code || item.enrollmentCode }}</p><h3 class="ui-title mt-1 text-lg text-slate-950">{{ item.term_name || item.termName }}</h3><p class="mt-1 text-sm text-slate-500">{{ item.student_name || item.studentName }}・{{ item.student_email || item.studentEmail }}</p></div><span class="ops-chip" :class="adminStatusClass(item)">{{ adminStatusLabel(item) }}</span></header><p v-if="item.pay_by_at || item.payByAt" class="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">付款保留至 {{ formatDateTime(item.pay_by_at || item.payByAt) }}</p><div class="mt-auto grid gap-2 sm:grid-cols-2"><router-link v-if="item.order_id || item.orderId" :to="courseRecordDeepLink('orders', item.order_id || item.orderId)" class="btn btn-outline w-full">查看訂單</router-link><button v-if="String(item.status || '').toUpperCase() === 'CONFIRMED'" type="button" class="btn btn-primary w-full text-white" @click="openProductizedEditor('complete-enrollment', item)">標記結業</button></div></article></section>
        </template>

        <template v-else-if="adminTask.key === 'operations'">
          <section class="surface-section space-y-4"><div><h3 class="ui-title text-lg text-slate-950">補課預約判定</h3><p class="mt-1 text-sm leading-6 text-slate-600">清單依目前課程租戶載入；送出時伺服器還會重新驗證席位、權益狀態與 row version。</p></div><p v-if="!productizedMakeupBookings.length" class="text-sm text-slate-500">目前沒有待判定的補課預約。</p><div v-else class="grid gap-3 lg:grid-cols-2"><article v-for="booking in productizedMakeupBookings" :key="booking.id" class="rounded-xl border border-slate-200 p-4"><header class="flex items-start justify-between gap-3"><div><strong class="text-slate-950">{{ booking.session_title || booking.sessionTitle || booking.title || '補課場次' }}</strong><p class="mt-1 text-sm text-slate-500">{{ booking.student_name || booking.studentName || '學員' }}・{{ booking.sourceTermName || booking.source_term_name || booking.term_name || booking.termName || '固定班' }}</p></div><span class="ops-chip" :class="adminStatusClass(booking)">{{ adminStatusLabel(booking) }}</span></header><p class="mt-3 text-sm text-slate-600">{{ formatRange(booking.starts_at || booking.startsAt, booking.ends_at || booking.endsAt) }}</p><label class="mt-3 block space-y-1 text-sm font-medium text-slate-700">判定理由<input v-model.trim="productizedMakeupReasons[booking.id]" maxlength="500" class="w-full" placeholder="必填，供稽核追溯" /></label><div v-if="canMarkMakeupAttendance(booking)" class="mt-3 grid grid-cols-2 gap-2"><button type="button" class="btn btn-primary text-white" :disabled="!productizedMakeupReasons[booking.id] || productizedActionBusy === `makeup-attend-${booking.id}`" @click="markProductizedMakeupAttendance(booking, 'attend')">補課已出席</button><button type="button" class="btn btn-outline text-amber-800" :disabled="!productizedMakeupReasons[booking.id] || productizedActionBusy === `makeup-no-show-${booking.id}`" @click="markProductizedMakeupAttendance(booking, 'no-show')">補課未到</button></div></article></div></section>
          <div v-if="!productizedItems.length" class="surface-section text-sm leading-6 text-slate-600">{{ productizedEmptyText }}</div>
          <section v-else class="grid gap-4 lg:grid-cols-2"><article v-for="item in productizedItems" :key="item.id" class="ticket-card flex flex-col gap-4 p-5"><header class="flex items-start justify-between gap-3"><div><p class="text-xs text-slate-500">{{ item.enrollment_code || item.enrollmentCode }}</p><h3 class="ui-title mt-1 text-lg text-slate-950">{{ item.title || item.term_name || item.termName }}</h3><p class="mt-1 text-sm text-slate-500">{{ item.student_name || item.studentName }}・{{ item.location || '地點待定' }}</p></div><span class="ops-chip" :class="adminStatusClass(item)">{{ adminStatusLabel(item) }}</span></header><p class="text-sm text-slate-700">{{ formatRange(item.starts_at || item.startsAt, item.ends_at || item.endsAt) }}</p><div v-if="canMarkTermAttendance(item)" class="mt-auto grid gap-2" :class="String(item.status || '').toUpperCase() === 'SCHEDULED' ? 'grid-cols-2' : 'grid-cols-1'"><button type="button" class="btn btn-primary text-white" :disabled="productizedActionBusy === `term-attend-${item.id}`" @click="markProductizedTermAttendance(item, 'attend')">已出席</button><button v-if="String(item.status || '').toUpperCase() === 'SCHEDULED'" type="button" class="btn btn-outline" :disabled="productizedActionBusy === `term-absent-${item.id}`" @click="markProductizedTermAttendance(item, 'absent')">一般缺席</button></div></article></section>
        </template>

        <template v-else>
          <div v-if="!productizedItems.length" class="surface-section text-sm leading-6 text-slate-600">{{ productizedEmptyText }}</div>
          <div v-else class="overflow-hidden rounded-xl border border-slate-200 bg-white"><div class="overflow-x-auto"><table class="table-default min-w-[880px]"><thead><tr><th>名稱／編號</th><th>狀態</th><th>名額／權益</th><th>時間</th><th>下一步</th></tr></thead><tbody><tr v-for="item in productizedItems" :key="item.id || item.code"><td><strong class="text-slate-900">{{ item.name || item.title || item.termName || item.term_name || item.studentName || item.student_name || '課程紀錄' }}</strong><p class="text-xs text-slate-500">{{ item.code || item.email || item.sessionCode || item.session_code || '—' }}</p></td><td><span class="ops-chip" :class="adminStatusClass(item)">{{ adminStatusLabel(item) }}</span></td><td>{{ adminCapacityLabel(item) }}</td><td>{{ formatRange(item.startsAt || item.starts_at, item.endsAt || item.ends_at) }}</td><td><router-link v-if="item.orderId || item.order_id" :to="courseRecordDeepLink('orders', item.orderId || item.order_id)" class="text-sm font-medium text-primary">查看課程訂單</router-link><span v-else class="text-sm text-slate-500">依伺服器 capability 開放操作</span></td></tr></tbody></table></div></div>
        </template>
        <aside v-if="['classes','enrollments'].includes(adminTask.key)" class="surface-section text-sm leading-6 text-slate-600"><strong class="text-slate-900">併發規則：</strong>候補 offer、人工匯款與插班共用限時 seat allocation；逾期自動釋出，不以前端計數器判斷名額。</aside>
        <aside v-if="adminTask.key === 'operations'" class="surface-section text-sm leading-6 text-slate-600"><strong class="text-slate-900">補課規則：</strong>有效請假鎖定後補課權益仍保留；開放水域補課須完成保險訂單才確認席位。</aside>
    </section>
    <AppBottomSheet v-model="productizedEditorOpen" :title="productizedEditorTitle" size="lg" :closable="!productizedSaving">
      <form id="course-productized-editor" class="space-y-4" @submit.prevent="submitProductizedEditor"><fieldset :disabled="productizedSaving" class="min-w-0 space-y-4 border-0 p-0">
        <template v-if="productizedEditorType === 'program'">
          <FormField label="課程計畫名稱" required><input v-model.trim="productizedEditorForm.name" required class="w-full" /></FormField>
          <div class="grid gap-4 sm:grid-cols-2"><FormField label="計畫編號"><input v-model.trim="productizedEditorForm.code" class="w-full" placeholder="留空由系統產生" /></FormField><FormField label="Slug"><input v-model.trim="productizedEditorForm.slug" class="w-full" placeholder="留空由名稱產生" /></FormField></div>
          <FormField label="簡介"><textarea v-model.trim="productizedEditorForm.summary" rows="3" maxlength="500" class="w-full"></textarea></FormField>
        </template>
        <template v-else-if="productizedEditorType === 'scheme'">
          <FormField label="程度方案名稱" required><input v-model.trim="productizedEditorForm.name" required class="w-full" /></FormField>
          <FormField label="方案編號"><input v-model.trim="productizedEditorForm.code" class="w-full" placeholder="留空由系統產生" /></FormField>
          <FormField label="說明"><textarea v-model.trim="productizedEditorForm.description" rows="4" class="w-full"></textarea></FormField>
        </template>
        <template v-else-if="productizedEditorType === 'level'">
          <FormField label="程度方案" required><select v-model="productizedEditorForm.schemeId" required class="w-full"><option value="" disabled>請選擇</option><option v-for="scheme in productizedCatalog.levelSchemes" :key="scheme.id" :value="String(scheme.id)">{{ scheme.name }}</option></select></FormField>
          <div class="grid gap-4 sm:grid-cols-2"><FormField label="程度名稱" required><input v-model.trim="productizedEditorForm.name" required class="w-full" /></FormField><FormField label="程度編號"><input v-model.trim="productizedEditorForm.code" class="w-full" /></FormField><FormField label="排序"><input v-model.number="productizedEditorForm.sortOrder" type="number" class="w-full" /></FormField></div>
        </template>
        <template v-else-if="productizedEditorType === 'term'">
          <div class="grid gap-4 sm:grid-cols-2"><FormField label="課程計畫" required><select v-model="productizedEditorForm.programId" required class="w-full"><option value="" disabled>請選擇</option><option v-for="program in productizedCatalog.programs" :key="program.id" :value="String(program.id)">{{ program.name }}</option></select></FormField><FormField label="程度門檻"><select v-model="productizedEditorForm.levelId" class="w-full"><option value="">不限程度</option><option v-for="level in productizedCatalog.levels" :key="level.id" :value="String(level.id)">{{ level.scheme_name || level.schemeName }}・{{ level.name }}</option></select></FormField><FormField label="班期名稱" required><input v-model.trim="productizedEditorForm.name" required class="w-full" /></FormField><FormField label="班期編號"><input v-model.trim="productizedEditorForm.code" class="w-full" /></FormField><FormField label="開始日" required><input v-model="productizedEditorForm.startsOn" type="date" required class="w-full" /></FormField><FormField label="結束日" required><input v-model="productizedEditorForm.endsOn" type="date" required class="w-full" /></FormField><FormField label="報名開放"><input v-model="productizedEditorForm.enrollmentOpenAt" type="datetime-local" class="w-full" /></FormField><FormField label="報名截止"><input v-model="productizedEditorForm.enrollmentCloseAt" type="datetime-local" class="w-full" /></FormField><FormField label="名額（留空不限）"><input v-model="productizedEditorForm.capacity" type="number" min="1" class="w-full" /></FormField><FormField label="請假額度"><input v-model.number="productizedEditorForm.leaveQuota" type="number" min="0" class="w-full" /></FormField><FormField label="請假截止（課前分鐘）"><input v-model.number="productizedEditorForm.leaveCutoffMinutes" type="number" min="0" class="w-full" /></FormField><FormField label="補課效期（天）"><input v-model.number="productizedEditorForm.makeupValidDays" type="number" min="1" class="w-full" /></FormField></div>
        </template>
        <template v-else-if="productizedEditorType === 'session'">
          <p class="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">新增場次會遞增班期 row version，發布前會再檢查。</p>
          <div class="grid gap-4 sm:grid-cols-2"><FormField label="場次名稱" required><input v-model.trim="productizedEditorForm.title" required class="w-full" /></FormField><FormField label="場次編號"><input v-model.trim="productizedEditorForm.code" class="w-full" /></FormField><FormField label="開始時間" required><input v-model="productizedEditorForm.startsAt" type="datetime-local" required class="w-full" /></FormField><FormField label="結束時間" required><input v-model="productizedEditorForm.endsAt" type="datetime-local" required class="w-full" /></FormField><FormField label="教練顯示名稱"><input v-model.trim="productizedEditorForm.coachName" class="w-full" /></FormField><FormField label="城市"><input v-model.trim="productizedEditorForm.city" class="w-full" /></FormField><FormField label="地點"><input v-model.trim="productizedEditorForm.location" class="w-full" /></FormField><FormField label="名額（留空不限）"><input v-model="productizedEditorForm.capacity" type="number" min="1" class="w-full" /></FormField></div>
        </template>
        <template v-else-if="productizedEditorType === 'pricing'">
          <div class="grid gap-4 sm:grid-cols-2"><FormField label="定價方式" required><select v-model="productizedEditorForm.pricingMode" required class="w-full"><option value="FULL_TERM">全期價</option><option value="PRO_RATA_SESSIONS">依剩餘場次比例</option><option value="UNIT_X_REMAINING">單價 × 剩餘堂數</option><option value="PRO_RATA_CALENDAR">依日曆比例</option></select></FormField><FormField label="幣別"><input v-model.trim="productizedEditorForm.currency" maxlength="3" required class="w-full" /></FormField><FormField label="全期價"><input v-model="productizedEditorForm.fullPrice" type="number" min="0" step="1" class="w-full" /></FormField><FormField label="單價"><input v-model="productizedEditorForm.unitPrice" type="number" min="0" step="1" class="w-full" /></FormField><FormField label="優先序"><input v-model.number="productizedEditorForm.priority" type="number" min="1" class="w-full" /></FormField></div><p class="text-sm text-slate-500">全期價或單價至少填一項。</p>
        </template>
        <template v-else-if="productizedEditorType === 'makeup-route'">
          <div class="grid gap-4 sm:grid-cols-2"><FormField label="來源班期" required><select v-model="productizedEditorForm.sourceTermId" required class="w-full"><option value="" disabled>請選擇</option><option v-for="term in productizedCatalog.terms" :key="term.id" :value="String(term.id)">{{ term.name }}（{{ term.code }}）</option></select></FormField><FormField label="目標場次" required><select v-model="productizedEditorForm.targetSessionId" required class="w-full"><option value="" disabled>請選擇</option><option v-for="session in productizedCatalog.sessions" :key="session.id" :value="String(session.id)">{{ session.title || session.code }}・{{ formatDateTime(session.startsAt || session.starts_at) }}</option></select></FormField><FormField label="狀態"><select v-model="productizedEditorForm.status" class="w-full"><option value="active">啟用</option><option value="inactive">停用</option></select></FormField><FormField label="補課名額覆寫（留空沿用場次）"><input v-model="productizedEditorForm.capacityOverride" type="number" min="1" class="w-full" /></FormField><FormField label="預約開放"><input v-model="productizedEditorForm.bookingOpenAt" type="datetime-local" class="w-full" /></FormField><FormField label="預約截止"><input v-model="productizedEditorForm.bookingCloseAt" type="datetime-local" class="w-full" /></FormField></div><p class="text-sm text-slate-500">來源班期與目標場次必須隸屬目前課程租戶；伺服器會在交易內再次驗證。</p>
        </template>
        <template v-else-if="productizedEditorType === 'insurance-policy'">
          <div class="grid gap-4 sm:grid-cols-2"><FormField label="目標補課場次" required><select v-model="productizedEditorForm.targetSessionId" required class="w-full"><option value="" disabled>請選擇</option><option v-for="session in productizedCatalog.sessions" :key="session.id" :value="String(session.id)">{{ session.title || session.code }}・{{ formatDateTime(session.startsAt || session.starts_at) }}</option></select></FormField><FormField label="狀態"><select v-model="productizedEditorForm.status" class="w-full"><option value="active">啟用</option><option value="inactive">停用</option><option value="archived">封存</option></select></FormField><FormField label="是否必須投保"><select v-model="productizedEditorForm.required" class="w-full"><option :value="true">必須投保</option><option :value="false">可選投保</option></select></FormField><FormField label="保險費" required><input v-model="productizedEditorForm.feeAmount" type="number" min="0" step="1" required class="w-full" /></FormField><FormField label="幣別"><input v-model.trim="productizedEditorForm.currency" maxlength="3" required class="w-full" /></FormField><FormField label="付款保留（分鐘）"><input v-model.number="productizedEditorForm.paymentHoldMinutes" type="number" min="1" max="10080" required class="w-full" /></FormField><FormField label="保險費商品"><select v-model="productizedEditorForm.feeProductId" class="w-full"><option value="">不指定</option><option v-for="product in activeProducts" :key="product.id" :value="String(product.id)">{{ product.name }}</option></select></FormField><FormField label="購買截止"><input v-model="productizedEditorForm.cancelCloseAt" type="datetime-local" class="w-full" /></FormField></div><p class="text-sm text-slate-500">規則、場次與費用商品都必須屬於目前課程租戶；付款確認前只保留該補課場次名額。</p>
        </template>
        <template v-else-if="productizedEditorType === 'renewal-rule'">
          <div class="grid gap-4 sm:grid-cols-2"><FormField label="來源班期" required><select v-model="productizedEditorForm.sourceTermId" required class="w-full"><option value="" disabled>請選擇</option><option v-for="term in productizedCatalog.terms" :key="term.id" :value="String(term.id)">{{ term.name }}（{{ term.code }}）</option></select></FormField><FormField label="目標班期" required><select v-model="productizedEditorForm.targetTermId" required class="w-full"><option value="" disabled>請選擇</option><option v-for="term in productizedCatalog.terms" :key="term.id" :value="String(term.id)">{{ term.name }}（{{ term.code }}）</option></select></FormField><FormField label="續報開放" required><input v-model="productizedEditorForm.renewalOpenAt" type="datetime-local" required class="w-full" /></FormField><FormField label="續報截止" required><input v-model="productizedEditorForm.renewalCloseAt" type="datetime-local" required class="w-full" /></FormField><FormField label="保留名額"><input v-model.number="productizedEditorForm.reservedCapacity" type="number" min="0" class="w-full" /></FormField><FormField label="狀態"><select v-model="productizedEditorForm.status" class="w-full"><option value="active">啟用</option><option value="inactive">停用</option><option value="archived">封存</option></select></FormField></div><label class="flex min-h-[44px] items-center gap-2 text-sm text-slate-700"><input v-model="productizedEditorForm.requireCompleted" type="checkbox" />必須完成來源班期</label><label class="flex min-h-[44px] items-center gap-2 text-sm text-slate-700"><input v-model="productizedEditorForm.requireTargetLevel" type="checkbox" />必須符合目標班期程度</label>
        </template>
        <template v-else-if="productizedEditorType === 'student-level'">
          <div class="grid gap-4 sm:grid-cols-2"><FormField label="程度方案" required><select v-model="productizedEditorForm.schemeId" required class="w-full" @change="productizedEditorForm.levelId = ''"><option value="" disabled>請選擇</option><option v-for="scheme in productizedCatalog.levelSchemes" :key="scheme.id" :value="String(scheme.id)">{{ scheme.name }}</option></select></FormField><FormField label="評估狀態" required><select v-model="productizedEditorForm.assessmentStatus" required class="w-full"><option value="NOT_STARTED">尚未開始</option><option value="PENDING">評估中</option><option value="PASSED">已通過</option><option value="FAILED">未通過</option><option value="EXPIRED">已失效</option></select></FormField><FormField label="程度" :required="productizedEditorForm.assessmentStatus === 'PASSED'"><select v-model="productizedEditorForm.levelId" class="w-full" :required="productizedEditorForm.assessmentStatus === 'PASSED'"><option value="">不指定</option><option v-for="level in productizedEditorLevels" :key="level.id" :value="String(level.id)">{{ level.name }}</option></select></FormField><FormField label="效期"><input v-model="productizedEditorForm.expiresAt" type="datetime-local" class="w-full" /></FormField></div><FormField label="評估備註"><textarea v-model.trim="productizedEditorForm.note" rows="3" maxlength="500" class="w-full"></textarea></FormField>
        </template>
        <template v-else-if="productizedEditorType === 'complete-enrollment'">
          <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">只有已確認報名、所有場次已結束且沒有未判定逐堂權益時才能結業。</p><FormField label="結業理由"><textarea v-model.trim="productizedEditorForm.reason" rows="3" maxlength="500" class="w-full" placeholder="例如：班期完成並經課務確認"></textarea></FormField>
        </template>
      </fieldset></form>
      <template #actions><button type="submit" form="course-productized-editor" class="btn btn-primary w-full text-white" :disabled="productizedSaving">{{ productizedSaving ? '儲存中…' : productizedEditorSubmitLabel }}</button></template>
    </AppBottomSheet>
  </CourseAdminFrame>
  <section v-else class="space-y-5">
    <router-link
      v-if="!focusedMode"
      to="/admin/courses/classes"
      class="surface-section group flex min-h-[96px] items-center justify-between gap-4 border-primary/20 transition hover:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
    >
      <div>
        <p class="text-sm font-medium text-primary">固定班管理</p>
        <h2 class="ui-title mt-1 text-xl text-slate-950">班期、場次、定價與補課設定</h2>
        <p class="mt-1 text-sm text-slate-600">入口永遠保留；尚未啟用時會顯示 migration、runtime 與租戶旗標的具體阻擋原因。</p>
      </div>
      <span class="btn btn-primary shrink-0 text-white" aria-hidden="true">前往管理</span>
    </router-link>
    <section v-if="!focusedMode && canUseLegacyCourseManager" class="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <button
        v-for="item in overviewCards"
        :key="item.key"
        type="button"
        class="surface-section text-left transition hover:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
        @click="openOverviewItem(item)"
      >
        <p class="text-sm text-slate-500">{{ item.label }}</p>
        <p class="stat-number mt-2 text-3xl text-slate-950">{{ item.value }}</p>
        <p class="mt-2 text-xs text-slate-500">{{ item.hint }}</p>
      </button>
    </section>

    <div v-if="!focusedMode" class="ops-toolbar sticky top-[65px] z-30 overflow-x-auto">
      <div class="flex min-w-max gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button
          v-for="item in tabs"
          :key="item.key"
          type="button"
          class="min-h-[40px] rounded-md px-4 py-2 text-sm font-medium transition"
          :class="activeTab === item.key ? 'bg-white text-primary shadow-sm' : 'text-slate-600'"
          @click="selectTab(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="ops-chip" :class="isAdmin ? 'ops-chip-info' : 'ops-chip-success'">
        {{ isAdmin ? '管理範圍：全部服務商與平台課程' : canUseLegacyCourseManager ? '管理範圍：我的課程' : '管理範圍：伺服器授權的課程租戶' }}
      </span>
      <span v-if="activeTab !== 'overview' && activeSummary.total != null" class="text-sm text-slate-500">
        此租戶範圍共 {{ activeSummary.total }} 筆
      </span>
    </div>

    <p
      v-if="message"
      class="rounded-lg border px-4 py-3 text-sm"
      :class="messageType === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'"
      :role="messageType === 'error' ? 'alert' : 'status'"
    >
      {{ message }}
    </p>

    <section v-if="activeTab === 'overview'" class="grid gap-4 lg:grid-cols-2">
      <article class="surface-section space-y-4">
        <h2 class="ui-title text-xl text-slate-950">營運流程</h2>
        <ol class="space-y-3 text-sm leading-6 text-slate-600">
          <li><strong class="text-slate-900">1. 票種與銷售方案：</strong>TicketProduct 定義發券權益；銷售方案定義售價、舊生資格與強制加購。</li>
          <li><strong class="text-slate-900">2. 情境與場次：</strong>RedeemScenario 依優先序允許多種票；場次設定教練、地點、時間窗與名額。</li>
          <li><strong class="text-slate-900">3. 訂單：</strong>至「訂單」的課程分類確認款項與發券。</li>
          <li><strong class="text-slate-900">4. 保留與核銷：</strong>預約保留 1 堂；SUCCESS／NO SHOW 才扣堂，取消或請假釋放。</li>
        </ol>
      </article>
      <article class="surface-section space-y-4">
        <h2 class="ui-title text-xl text-slate-950">多租戶管理</h2>
        <div class="space-y-3 text-sm leading-6 text-slate-600">
          <p>管理員可管理平台與所有服務商課程；服務商只能看見及操作自己的商品、場次、訂單、票券與預約。</p>
          <p>課程訂單與票券保留在原後台分類；此頁管理銷售方案、TicketProduct、Scenario、場次、現場課務、設定、人員與報表。</p>
        </div>
      </article>
    </section>

    <section v-else-if="activeTab === 'course-v2'" class="space-y-4">
      <CourseV2AdminPanel
        :current-role="role"
        :current-user-id="currentUserId"
        :capabilities="props.capabilities"
        :memberships="props.memberships"
        :provider-options="providerOptions"
      />
    </section>

    <section v-else-if="activeTab === 'products'" class="space-y-4">
      <ListHeading title="商城銷售方案" description="定義售價、發行票種、舊生資格、強制加購、歸屬服務商與發布狀態。">
        <button type="button" class="btn btn-primary text-white" @click="openProductForm()">
          <AppIcon name="plus" class="h-4 w-4" /> 新增課程
        </button>
      </ListHeading>
      <ListToolbar
        v-model="listState.products.q"
        :loading="loading.products"
        :has-filters="hasFilters('products')"
        placeholder="搜尋商品代碼、名稱或服務商"
        @refresh="loadList('products', { force: true })"
        @clear="clearFilters('products')"
      >
        <AdminFilterSheet
          :model-value="filters.products"
          :columns="productFilterColumns"
          title="課程商品篩選"
          @update:model-value="filters.products = $event"
          @apply="applyFilters('products', $event)"
        />
      </ListToolbar>
      <ListError v-if="errors.products" :message="errors.products" @retry="loadList('products', { force: true })" />
      <AdminTableState v-else :loading="loading.products" :empty="!products.length" :empty-text="emptyText('products', '尚無課程商品。')">
        <div class="hidden overflow-x-auto md:block">
          <table class="table-default min-w-[1320px]">
            <thead><tr>
              <th>代碼／名稱</th>
              <th><TableColumnFilter mode="server" label="分類" :fields="columnFields(productFilterColumns, 'category')" :model-value="filters.products.category" @update:model-value="setColumnFilter('products', 'category', $event)" @apply="applyColumnFilter('products', 'category', $event)" /></th>
              <th v-if="isAdmin"><TableColumnFilter mode="server" label="服務商" :fields="columnFields(productFilterColumns, 'provider')" :model-value="filters.products.provider" @update:model-value="setColumnFilter('products', 'provider', $event)" @apply="applyColumnFilter('products', 'provider', $event)" /></th>
              <th><TableColumnFilter mode="server" label="價格" :fields="columnFields(productFilterColumns, 'price')" :model-value="filters.products.price" @update:model-value="setColumnFilter('products', 'price', $event)" @apply="applyColumnFilter('products', 'price', $event)" /></th>
              <th><TableColumnFilter mode="server" label="堂數／效期" :fields="columnFields(productFilterColumns, 'usage')" :model-value="filters.products.usage" @update:model-value="setColumnFilter('products', 'usage', $event)" @apply="applyColumnFilter('products', 'usage', $event)" /></th>
              <th><TableColumnFilter mode="server" label="轉讓" :fields="columnFields(productFilterColumns, 'transfer')" :model-value="filters.products.transfer" @update:model-value="setColumnFilter('products', 'transfer', $event)" @apply="applyColumnFilter('products', 'transfer', $event)" /></th>
              <th><TableColumnFilter mode="server" label="狀態" :fields="columnFields(productFilterColumns, 'status')" :model-value="filters.products.status" @update:model-value="setColumnFilter('products', 'status', $event)" @apply="applyColumnFilter('products', 'status', $event)" /></th>
              <th><TableColumnFilter mode="server" label="更新日期" :fields="columnFields(productFilterColumns, 'updated')" :model-value="filters.products.updated" @update:model-value="setColumnFilter('products', 'updated', $event)" @apply="applyColumnFilter('products', 'updated', $event)" /></th>
              <th>操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="product in products" :key="product.id">
                <td><p class="font-medium text-slate-900">{{ product.name }}</p><p class="text-sm text-slate-500">{{ product.code }}</p></td>
                <td>{{ product.category || '—' }}</td>
                <td v-if="isAdmin" class="min-w-56">
                  <p class="mb-2 text-sm text-slate-600">{{ providerDisplay(product) }}</p>
                  <div class="flex gap-2">
                    <select v-model="product._ownerDraft" class="min-w-40 text-sm" :disabled="busyId === `owner-${product.id}`">
                      <option value="">平台課程</option>
                      <option v-for="provider in providerOptions" :key="provider.id" :value="provider.id">{{ provider.label }}</option>
                    </select>
                    <button v-if="ownerChanged(product)" type="button" class="btn btn-outline btn-sm" :disabled="busyId === `owner-${product.id}`" @click="reassignProductOwner(product)">移轉</button>
                  </div>
                </td>
                <td class="money-value">NT$ {{ formatMoney(product.price) }}</td>
                <td>{{ product.classCount }} 堂／{{ product.validDays }} 天</td>
                <td>{{ product.transferable ? '可' : '不可' }}</td>
                <td><span class="ops-chip" :class="statusChip(product.status)">{{ productStatusLabel(product.status) }}</span></td>
                <td>{{ formatDateTime(product.updatedAt) }}</td>
                <td><div class="flex gap-2"><button type="button" class="btn btn-outline btn-sm" @click="openProductForm(product)"><AppIcon name="edit" class="h-4 w-4" /> 編輯</button><button v-if="product.status !== 'archived'" type="button" class="btn btn-outline btn-sm text-red-700" @click="archiveProduct(product)">封存</button></div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="grid gap-3 p-3 md:hidden">
          <article v-for="product in products" :key="`mobile-product-${product.id}`" class="rounded-lg border border-slate-200 p-4">
            <div class="flex items-start justify-between gap-3"><div><p class="font-medium text-slate-950">{{ product.name }}</p><p class="text-sm text-slate-500">{{ product.code }}</p></div><span class="ops-chip" :class="statusChip(product.status)">{{ productStatusLabel(product.status) }}</span></div>
            <dl class="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt class="text-slate-500">分類</dt><dd>{{ product.category || '—' }}</dd></div><div><dt class="text-slate-500">價格</dt><dd>NT$ {{ formatMoney(product.price) }}</dd></div><div><dt class="text-slate-500">堂數／效期</dt><dd>{{ product.classCount }} 堂／{{ product.validDays }} 天</dd></div><div v-if="isAdmin"><dt class="text-slate-500">服務商</dt><dd>{{ providerDisplay(product) }}</dd></div></dl>
            <div v-if="isAdmin" class="mt-3 flex gap-2"><select v-model="product._ownerDraft" class="min-w-0 flex-1 text-sm" :disabled="busyId === `owner-${product.id}`"><option value="">平台課程</option><option v-for="provider in providerOptions" :key="provider.id" :value="provider.id">{{ provider.label }}</option></select><button v-if="ownerChanged(product)" type="button" class="btn btn-outline btn-sm" :disabled="busyId === `owner-${product.id}`" @click="reassignProductOwner(product)">移轉</button></div>
            <div class="mt-4 flex gap-2"><button type="button" class="btn btn-outline btn-sm flex-1" @click="openProductForm(product)">編輯</button><button v-if="product.status !== 'archived'" type="button" class="btn btn-outline btn-sm flex-1 text-red-700" @click="archiveProduct(product)">封存</button></div>
          </article>
        </div>
      </AdminTableState>
      <AdminPagination v-if="!errors.products" v-bind="meta.products" :loading="loading.products" @change="changePage('products', $event)" />
    </section>

    <section v-else-if="activeTab === 'sessions'" class="space-y-4">
      <ListHeading title="課程場次" description="管理教練、時間、地點、名額與預約開放狀態。">
        <button type="button" class="btn btn-primary text-white" @click="openSessionForm()"><AppIcon name="plus" class="h-4 w-4" /> 新增場次</button>
      </ListHeading>
      <ListToolbar v-model="listState.sessions.q" :loading="loading.sessions" :has-filters="hasFilters('sessions')" placeholder="搜尋場次代碼、名稱、商品、教練或地點" @refresh="loadList('sessions', { force: true })" @clear="clearFilters('sessions')">
        <AdminFilterSheet :model-value="filters.sessions" :columns="sessionFilterColumns" title="課程場次篩選" @update:model-value="filters.sessions = $event" @apply="applyFilters('sessions', $event)" />
      </ListToolbar>
      <ListError v-if="errors.sessions" :message="errors.sessions" @retry="loadList('sessions', { force: true })" />
      <AdminTableState v-else :loading="loading.sessions" :empty="!sessions.length" :empty-text="emptyText('sessions', '尚無課程場次。')">
        <div class="hidden overflow-x-auto md:block"><table class="table-default min-w-[1240px]"><thead><tr>
          <th>場次</th><th><TableColumnFilter mode="server" label="適用商品" :fields="columnFields(sessionFilterColumns, 'product')" :model-value="filters.sessions.product" @update:model-value="setColumnFilter('sessions', 'product', $event)" @apply="applyColumnFilter('sessions', 'product', $event)" /></th>
          <th v-if="isAdmin"><TableColumnFilter mode="server" label="服務商" :fields="columnFields(sessionFilterColumns, 'provider')" :model-value="filters.sessions.provider" @update:model-value="setColumnFilter('sessions', 'provider', $event)" @apply="applyColumnFilter('sessions', 'provider', $event)" /></th>
          <th><TableColumnFilter mode="server" label="時間" :fields="columnFields(sessionFilterColumns, 'time')" :model-value="filters.sessions.time" @update:model-value="setColumnFilter('sessions', 'time', $event)" @apply="applyColumnFilter('sessions', 'time', $event)" /></th>
          <th><TableColumnFilter mode="server" label="教練／地點" :fields="columnFields(sessionFilterColumns, 'place')" :model-value="filters.sessions.place" @update:model-value="setColumnFilter('sessions', 'place', $event)" @apply="applyColumnFilter('sessions', 'place', $event)" /></th>
          <th><TableColumnFilter mode="server" label="名額" :fields="columnFields(sessionFilterColumns, 'availability')" :model-value="filters.sessions.availability" @update:model-value="setColumnFilter('sessions', 'availability', $event)" @apply="applyColumnFilter('sessions', 'availability', $event)" /></th>
          <th><TableColumnFilter mode="server" label="狀態" :fields="columnFields(sessionFilterColumns, 'status')" :model-value="filters.sessions.status" @update:model-value="setColumnFilter('sessions', 'status', $event)" @apply="applyColumnFilter('sessions', 'status', $event)" /></th><th>操作</th>
        </tr></thead><tbody><tr v-for="session in sessions" :key="session.id">
          <td><p class="font-medium text-slate-900">{{ session.title }}</p><p class="text-sm text-slate-500">{{ session.code }}</p></td><td>{{ session.productName || '同服務商全部課程票券' }}</td><td v-if="isAdmin">{{ providerDisplay(session) }}</td><td>{{ formatRange(session.startsAt, session.endsAt) }}</td><td><p>{{ session.coachName || '教練待公告' }}</p><p class="text-sm text-slate-500">{{ session.location || '地點待公告' }}</p></td><td>{{ session.bookedCount }}/{{ session.capacity }}</td><td><span class="ops-chip" :class="statusChip(session.status)">{{ sessionStatusLabel(session.status) }}</span></td><td><div class="flex gap-2"><button type="button" class="btn btn-outline btn-sm" @click="openSessionForm(session)">編輯</button><button v-if="session.status !== 'cancelled'" type="button" class="btn btn-outline btn-sm text-red-700" @click="cancelSession(session)">取消</button></div></td>
        </tr></tbody></table></div>
        <div class="grid gap-3 p-3 md:hidden"><article v-for="session in sessions" :key="`mobile-session-${session.id}`" class="rounded-lg border border-slate-200 p-4"><div class="flex items-start justify-between gap-3"><div><p class="font-medium text-slate-950">{{ session.title }}</p><p class="text-sm text-slate-500">{{ session.code }}</p></div><span class="ops-chip" :class="statusChip(session.status)">{{ sessionStatusLabel(session.status) }}</span></div><p class="mt-3 text-sm">{{ formatRange(session.startsAt, session.endsAt) }}</p><p class="mt-1 text-sm text-slate-500">{{ session.coachName || '教練待公告' }}・{{ session.location || '地點待公告' }}・{{ session.bookedCount }}/{{ session.capacity }} 人</p><p v-if="isAdmin" class="mt-1 text-sm text-slate-500">{{ providerDisplay(session) }}</p><div class="mt-4 flex gap-2"><button type="button" class="btn btn-outline btn-sm flex-1" @click="openSessionForm(session)">編輯</button><button v-if="session.status !== 'cancelled'" type="button" class="btn btn-outline btn-sm flex-1 text-red-700" @click="cancelSession(session)">取消</button></div></article></div>
      </AdminTableState>
      <AdminPagination v-if="!errors.sessions" v-bind="meta.sessions" :loading="loading.sessions" @change="changePage('sessions', $event)" />
    </section>

    <section v-else-if="activeTab === 'orders'" class="space-y-4">
      <ListHeading title="課程訂單" description="付款確認與發券會在同一交易完成；取消、退款與修復均保留稽核紀錄。" />
      <ListToolbar v-model="listState.orders.q" :loading="loading.orders" :has-filters="hasFilters('orders')" placeholder="搜尋訂單、購買人、Email、課程或末五碼" @refresh="loadList('orders', { force: true })" @clear="clearFilters('orders')">
        <AdminFilterSheet :model-value="filters.orders" :columns="orderFilterColumns" title="課程訂單篩選" @update:model-value="filters.orders = $event" @apply="applyFilters('orders', $event)" />
      </ListToolbar>
      <div v-if="selectedOrderIds.length" class="surface-section flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p class="text-sm text-slate-700">已選 {{ selectedOrderIds.length }} 筆目前頁訂單</p><div class="flex flex-col gap-2 sm:flex-row"><select v-model="bulkOrderStatus" class="min-w-48"><option value="" disabled>選擇批次操作</option><option v-for="option in bulkOrderActionOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select><button type="button" class="btn btn-primary text-white" :disabled="!bulkOrderStatus || bulkSaving" @click="bulkUpdateOrders">{{ bulkSaving ? '處理中…' : '執行批次操作' }}</button><button type="button" class="btn btn-outline" :disabled="bulkSaving" @click="clearOrderSelection">取消選取</button></div></div>
      <ListError v-if="errors.orders" :message="errors.orders" @retry="loadList('orders', { force: true })" />
      <AdminTableState v-else :loading="loading.orders" :empty="!orders.length" :empty-text="emptyText('orders', '尚無課程訂單。')">
        <div class="hidden overflow-x-auto md:block"><table class="table-default min-w-[1320px]"><thead><tr><th><input type="checkbox" :checked="allVisibleOrdersSelected" :aria-label="allVisibleOrdersSelected ? '取消選取目前頁訂單' : '選取目前頁訂單'" @change="toggleAllVisibleOrders($event.target.checked)" /></th><th>訂單</th><th><TableColumnFilter mode="server" label="購買人" :fields="columnFields(orderFilterColumns, 'user')" :model-value="filters.orders.user" @update:model-value="setColumnFilter('orders', 'user', $event)" @apply="applyColumnFilter('orders', 'user', $event)" /></th><th><TableColumnFilter mode="server" label="課程" :fields="columnFields(orderFilterColumns, 'product')" :model-value="filters.orders.product" @update:model-value="setColumnFilter('orders', 'product', $event)" @apply="applyColumnFilter('orders', 'product', $event)" /></th><th v-if="isAdmin"><TableColumnFilter mode="server" label="服務商" :fields="columnFields(orderFilterColumns, 'provider')" :model-value="filters.orders.provider" @update:model-value="setColumnFilter('orders', 'provider', $event)" @apply="applyColumnFilter('orders', 'provider', $event)" /></th><th><TableColumnFilter mode="server" label="數量／金額" :fields="columnFields(orderFilterColumns, 'amount')" :model-value="filters.orders.amount" @update:model-value="setColumnFilter('orders', 'amount', $event)" @apply="applyColumnFilter('orders', 'amount', $event)" /></th><th><TableColumnFilter mode="server" label="後五碼" :fields="columnFields(orderFilterColumns, 'remittance')" :model-value="filters.orders.remittance" @update:model-value="setColumnFilter('orders', 'remittance', $event)" @apply="applyColumnFilter('orders', 'remittance', $event)" /></th><th><TableColumnFilter mode="server" label="狀態" :fields="columnFields(orderFilterColumns, 'status')" :model-value="filters.orders.status" @update:model-value="setColumnFilter('orders', 'status', $event)" @apply="applyColumnFilter('orders', 'status', $event)" /></th><th><TableColumnFilter mode="server" label="建立時間" :fields="columnFields(orderFilterColumns, 'created')" :model-value="filters.orders.created" @update:model-value="setColumnFilter('orders', 'created', $event)" @apply="applyColumnFilter('orders', 'created', $event)" /></th><th>操作</th></tr></thead><tbody><tr v-for="order in orders" :key="order.id"><td><input type="checkbox" :checked="isOrderSelected(order)" :aria-label="`選取訂單 ${order.code}`" @change="toggleOrder(order, $event.target.checked)" /></td><td class="font-medium text-slate-900">{{ order.code }}</td><td><p>{{ order.buyerName }}</p><p class="text-sm text-slate-500">{{ order.buyerEmail }}</p></td><td>{{ order.productName }}</td><td v-if="isAdmin">{{ providerDisplay(order) }}</td><td>{{ order.quantity }} 份／<span class="money-value">NT$ {{ formatMoney(order.totalAmount) }}</span></td><td>{{ order.remittanceLast5 || '—' }}</td><td><span class="ops-chip" :class="orderStatusClass(order)">{{ orderStatusLabel(order) }}</span></td><td>{{ formatDateTime(order.createdAt) }}</td><td><div class="flex gap-2"><button type="button" class="btn btn-outline btn-sm" @click="openOrderDetail(order)">詳情</button><button v-if="primaryOrderAction(order)" type="button" class="btn btn-primary btn-sm text-white" :disabled="busyId === `order-${order.id}`" @click="runOrderAction(order, primaryOrderAction(order).value)">{{ primaryOrderAction(order).label }}</button></div></td></tr></tbody></table></div>
        <div class="grid gap-3 p-3 md:hidden"><article v-for="order in orders" :key="`mobile-order-${order.id}`" class="rounded-lg border border-slate-200 p-4"><div class="flex items-start justify-between gap-3"><label class="flex items-center gap-2"><input type="checkbox" :checked="isOrderSelected(order)" @change="toggleOrder(order, $event.target.checked)" /><span class="font-medium text-slate-950">{{ order.code }}</span></label><span class="ops-chip" :class="orderStatusClass(order)">{{ orderStatusLabel(order) }}</span></div><p class="mt-3 text-sm">{{ order.buyerName }}・{{ order.productName }}</p><p class="mt-1 text-sm text-slate-500">{{ order.quantity }} 份・NT$ {{ formatMoney(order.totalAmount) }}・{{ formatDateTime(order.createdAt) }}</p><p v-if="isAdmin" class="mt-1 text-sm text-slate-500">{{ providerDisplay(order) }}</p><div class="mt-4 flex gap-2"><button type="button" class="btn btn-outline btn-sm flex-1" @click="openOrderDetail(order)">詳情</button><button v-if="primaryOrderAction(order)" type="button" class="btn btn-primary btn-sm flex-1 text-white" :disabled="busyId === `order-${order.id}`" @click="runOrderAction(order, primaryOrderAction(order).value)">{{ primaryOrderAction(order).label }}</button></div></article></div>
      </AdminTableState>
      <AdminPagination v-if="!errors.orders" v-bind="meta.orders" :loading="loading.orders" @change="changePage('orders', $event)" />
    </section>

    <section v-else-if="activeTab === 'tickets'" class="space-y-4">
      <ListHeading title="課程票券" description="查看票券詳情與活動紀錄，或手動發行課程票券。"><button type="button" class="btn btn-primary text-white" @click="openTicketForm"><AppIcon name="plus" class="h-4 w-4" /> 手動發券</button></ListHeading>
      <ListToolbar v-model="listState.tickets.q" :loading="loading.tickets" :has-filters="hasFilters('tickets')" placeholder="搜尋票號、持有人、Email 或商品" @refresh="loadList('tickets', { force: true })" @clear="clearFilters('tickets')"><AdminFilterSheet :model-value="filters.tickets" :columns="ticketFilterColumns" title="課程票券篩選" @update:model-value="filters.tickets = $event" @apply="applyFilters('tickets', $event)" /></ListToolbar>
      <ListError v-if="errors.tickets" :message="errors.tickets" @retry="loadList('tickets', { force: true })" />
      <AdminTableState v-else :loading="loading.tickets" :empty="!tickets.length" :empty-text="emptyText('tickets', '尚無課程票券。')">
        <div class="hidden overflow-x-auto md:block"><table class="table-default min-w-[1320px]"><thead><tr><th>票券</th><th><TableColumnFilter mode="server" label="持有人" :fields="columnFields(ticketFilterColumns, 'holder')" :model-value="filters.tickets.holder" @update:model-value="setColumnFilter('tickets', 'holder', $event)" @apply="applyColumnFilter('tickets', 'holder', $event)" /></th><th><TableColumnFilter mode="server" label="商品" :fields="columnFields(ticketFilterColumns, 'product')" :model-value="filters.tickets.product" @update:model-value="setColumnFilter('tickets', 'product', $event)" @apply="applyColumnFilter('tickets', 'product', $event)" /></th><th v-if="isAdmin"><TableColumnFilter mode="server" label="服務商" :fields="columnFields(ticketFilterColumns, 'provider')" :model-value="filters.tickets.provider" @update:model-value="setColumnFilter('tickets', 'provider', $event)" @apply="applyColumnFilter('tickets', 'provider', $event)" /></th><th><TableColumnFilter mode="server" label="剩餘／總堂數" :fields="columnFields(ticketFilterColumns, 'usage')" :model-value="filters.tickets.usage" @update:model-value="setColumnFilter('tickets', 'usage', $event)" @apply="applyColumnFilter('tickets', 'usage', $event)" /></th><th><TableColumnFilter mode="server" label="發行時間" :fields="columnFields(ticketFilterColumns, 'created')" :model-value="filters.tickets.created" @update:model-value="setColumnFilter('tickets', 'created', $event)" @apply="applyColumnFilter('tickets', 'created', $event)" /></th><th><TableColumnFilter mode="server" label="效期" :fields="columnFields(ticketFilterColumns, 'expiry')" :model-value="filters.tickets.expiry" @update:model-value="setColumnFilter('tickets', 'expiry', $event)" @apply="applyColumnFilter('tickets', 'expiry', $event)" /></th><th><TableColumnFilter mode="server" label="狀態" :fields="columnFields(ticketFilterColumns, 'status')" :model-value="filters.tickets.status" @update:model-value="setColumnFilter('tickets', 'status', $event)" @apply="applyColumnFilter('tickets', 'status', $event)" /></th><th>操作</th></tr></thead><tbody><tr v-for="ticket in tickets" :key="ticket.id"><td class="font-medium text-slate-900">{{ ticket.code }}</td><td><p>{{ ticket.ownerName || '—' }}</p><p class="text-sm text-slate-500">{{ ticket.ownerEmail }}</p></td><td>{{ ticket.productName }}</td><td v-if="isAdmin">{{ providerDisplay(ticket) }}</td><td>{{ ticket.remainingUses }}／{{ ticket.totalUses }}</td><td>{{ formatDateTime(ticket.createdAt) }}</td><td>{{ ticket.expiresAt || '未啟用' }}</td><td><span class="ops-chip" :class="statusChip(ticket.status)">{{ ticketStatusLabel(ticket.status) }}</span></td><td><button type="button" class="btn btn-outline btn-sm" @click="openTicketDetail(ticket)">詳情與紀錄</button></td></tr></tbody></table></div>
        <div class="grid gap-3 p-3 md:hidden"><article v-for="ticket in tickets" :key="`mobile-ticket-${ticket.id}`" class="rounded-lg border border-slate-200 p-4"><div class="flex items-start justify-between gap-3"><div><p class="font-medium text-slate-950">{{ ticket.code }}</p><p class="text-sm text-slate-500">{{ ticket.productName }}</p></div><span class="ops-chip" :class="statusChip(ticket.status)">{{ ticketStatusLabel(ticket.status) }}</span></div><p class="mt-3 text-sm">{{ ticket.ownerName || '—' }}・剩餘 {{ ticket.remainingUses }}/{{ ticket.totalUses }} 堂</p><p v-if="isAdmin" class="mt-1 text-sm text-slate-500">{{ providerDisplay(ticket) }}</p><button type="button" class="btn btn-outline btn-sm mt-4 w-full" @click="openTicketDetail(ticket)">詳情與紀錄</button></article></div>
      </AdminTableState>
      <AdminPagination v-if="!errors.tickets" v-bind="meta.tickets" :loading="loading.tickets" @change="changePage('tickets', $event)" />
    </section>

    <section v-else class="space-y-4">
      <ListHeading title="預約與核銷" description="調整預約狀態；出席與 NO SHOW 會依伺服器規則扣次。"><button type="button" class="btn btn-primary text-white" @click="emit('navigate', 'scan')"><AppIcon name="camera" class="h-4 w-4" /> 掃描核銷</button></ListHeading>
      <ListToolbar v-model="listState.bookings.q" :loading="loading.bookings" :has-filters="hasFilters('bookings')" placeholder="搜尋場次、票券、商品、姓名或 Email" @refresh="loadList('bookings', { force: true })" @clear="clearFilters('bookings')"><AdminFilterSheet :model-value="filters.bookings" :columns="bookingFilterColumns" title="課程預約篩選" @update:model-value="filters.bookings = $event" @apply="applyFilters('bookings', $event)" /></ListToolbar>
      <ListError v-if="errors.bookings" :message="errors.bookings" @retry="loadList('bookings', { force: true })" />
      <AdminTableState v-else :loading="loading.bookings" :empty="!bookings.length" :empty-text="emptyText('bookings', '尚無課程預約。')">
        <div class="hidden overflow-x-auto md:block"><table class="table-default min-w-[1380px]"><thead><tr><th><TableColumnFilter mode="server" label="場次" :fields="columnFields(bookingFilterColumns, 'session')" :model-value="filters.bookings.session" @update:model-value="setColumnFilter('bookings', 'session', $event)" @apply="applyColumnFilter('bookings', 'session', $event)" /></th><th><TableColumnFilter mode="server" label="學員" :fields="columnFields(bookingFilterColumns, 'user')" :model-value="filters.bookings.user" @update:model-value="setColumnFilter('bookings', 'user', $event)" @apply="applyColumnFilter('bookings', 'user', $event)" /></th><th><TableColumnFilter mode="server" label="票券／商品" :fields="columnFields(bookingFilterColumns, 'ticket')" :model-value="filters.bookings.ticket" @update:model-value="setColumnFilter('bookings', 'ticket', $event)" @apply="applyColumnFilter('bookings', 'ticket', $event)" /></th><th v-if="isAdmin"><TableColumnFilter mode="server" label="服務商" :fields="columnFields(bookingFilterColumns, 'provider')" :model-value="filters.bookings.provider" @update:model-value="setColumnFilter('bookings', 'provider', $event)" @apply="applyColumnFilter('bookings', 'provider', $event)" /></th><th><TableColumnFilter mode="server" label="預約時間" :fields="columnFields(bookingFilterColumns, 'booked')" :model-value="filters.bookings.booked" @update:model-value="setColumnFilter('bookings', 'booked', $event)" @apply="applyColumnFilter('bookings', 'booked', $event)" /></th><th><TableColumnFilter mode="server" label="場次時間" :fields="columnFields(bookingFilterColumns, 'starts')" :model-value="filters.bookings.starts" @update:model-value="setColumnFilter('bookings', 'starts', $event)" @apply="applyColumnFilter('bookings', 'starts', $event)" /></th><th><TableColumnFilter mode="server" label="狀態" :fields="columnFields(bookingFilterColumns, 'status')" :model-value="filters.bookings.status" @update:model-value="setColumnFilter('bookings', 'status', $event)" @apply="applyColumnFilter('bookings', 'status', $event)" /></th><th>操作</th></tr></thead><tbody><tr v-for="booking in bookings" :key="booking.id"><td><p class="font-medium text-slate-900">{{ booking.sessionTitle }}</p><p class="text-sm text-slate-500">{{ booking.sessionCode }}</p></td><td><p>{{ booking.attendeeName }}</p><p class="text-sm text-slate-500">{{ booking.attendeeEmail }}</p></td><td><p>{{ booking.ticketCode }}</p><p class="text-sm text-slate-500">{{ booking.productName || '' }}・剩餘 {{ booking.remainingUses }}・保留 {{ booking.heldUses ?? 0 }}・可用 {{ booking.availableUses ?? booking.remainingUses }} 堂</p></td><td v-if="isAdmin">{{ providerDisplay(booking) }}</td><td>{{ formatDateTime(booking.bookedAt || booking.createdAt) }}</td><td><p>{{ formatDateTime(booking.startsAt) }}</p><p class="text-sm text-slate-500">{{ booking.location || '地點待公告' }}</p></td><td><span class="ops-chip" :class="statusChip(booking.status)">{{ bookingStatusLabel(booking.status) }}</span></td><td><button type="button" class="btn btn-outline btn-sm" @click="openBookingDetail(booking)">{{ booking.status === 'booked' ? '課務操作' : '詳情' }}</button></td></tr></tbody></table></div>
        <div class="grid gap-3 p-3 md:hidden"><article v-for="booking in bookings" :key="`mobile-booking-${booking.id}`" class="rounded-lg border border-slate-200 p-4"><div class="flex items-start justify-between gap-3"><div><p class="font-medium text-slate-950">{{ booking.sessionTitle }}</p><p class="text-sm text-slate-500">{{ booking.attendeeName }}・{{ booking.ticketCode }}</p></div><span class="ops-chip" :class="statusChip(booking.status)">{{ bookingStatusLabel(booking.status) }}</span></div><p class="mt-3 text-sm">{{ formatDateTime(booking.startsAt) }}</p><p class="mt-1 text-sm text-slate-500">{{ booking.location || '地點待公告' }}</p><p class="mt-1 text-sm text-slate-500">剩餘 {{ booking.remainingUses }}・保留 {{ booking.heldUses ?? 0 }}・可用 {{ booking.availableUses ?? booking.remainingUses }} 堂</p><p v-if="isAdmin" class="mt-1 text-sm text-slate-500">{{ providerDisplay(booking) }}</p><button type="button" class="btn btn-outline btn-sm mt-4 w-full" @click="openBookingDetail(booking)">{{ booking.status === 'booked' ? '課務操作' : '詳情' }}</button></article></div>
      </AdminTableState>
      <AdminPagination v-if="!errors.bookings" v-bind="meta.bookings" :loading="loading.bookings" @change="changePage('bookings', $event)" />
    </section>

    <AppOverlayPanel
      :model-value="dialogOpen"
      :title="dialogTitle"
      :description="dialogEyebrow"
      placement="right"
      size="lg"
      :closable="!submitting"
      :close-on-backdrop="!submitting"
      :close-on-escape="!submitting"
      :drag-to-close="false"
      @update:model-value="handleDialogModelValue"
    >
      <form v-if="dialogType === 'product'" class="space-y-4" @submit.prevent="saveProduct"><fieldset :disabled="submitting" class="min-w-0 space-y-4 border-0 p-0">
        <FormField v-if="isAdmin && !editingId" label="課程歸屬"><select v-model="productForm.ownerUserId" class="w-full"><option value="">平台課程</option><option v-for="provider in providerOptions" :key="provider.id" :value="provider.id">{{ provider.label }}</option></select></FormField>
        <div class="grid gap-4 sm:grid-cols-2"><FormField :label="courseV2Enabled ? '銷售方案名稱' : '課程名稱'" required><input v-model.trim="productForm.name" required class="w-full" /></FormField><FormField v-if="courseV2Enabled" label="發行 TicketProduct" required><select v-model="productForm.ticketProductId" required class="w-full"><option value="" disabled>請選擇票種</option><option v-for="ticketProduct in ticketProductChoices" :key="ticketProduct.id" :value="String(ticketProduct.id)">{{ ticketProduct.name }}（{{ ticketProduct.classCount }} 堂）</option></select></FormField><FormField label="分類"><input v-model.trim="productForm.category" class="w-full" placeholder="例如：游泳團練" /></FormField><FormField label="售價"><input v-model.number="productForm.price" type="number" min="0" required class="w-full" /></FormField><FormField label="每筆訂單購買上限"><input v-model.number="productForm.maxPurchaseQuantity" type="number" min="1" max="99" required class="w-full" /></FormField><FormField label="堂數快取（Legacy）"><input v-model.number="productForm.classCount" type="number" min="1" required class="w-full" /></FormField><FormField label="開卡後效期快取（天）"><input v-model.number="productForm.validDays" type="number" min="1" required class="w-full" /></FormField><FormField label="開卡期限快取（天）"><input v-model.number="productForm.activationDays" type="number" min="1" required class="w-full" /></FormField><FormField label="發布狀態"><select v-model="productForm.status" class="w-full"><option value="draft">草稿</option><option value="published">已發布</option><option value="archived">已封存</option></select></FormField><FormField label="排序"><input v-model.number="productForm.sortOrder" type="number" class="w-full" /></FormField></div>
        <div v-if="courseV2Enabled" class="grid gap-4 sm:grid-cols-2"><FormField label="舊生認定產品（可複選）"><select v-model="productForm.returningProductIds" multiple class="h-32 w-full"><option v-for="product in activeProducts.filter(item => String(item.id) !== String(editingId || ''))" :key="product.id" :value="String(product.id)">{{ product.name }}</option></select></FormField><FormField label="強制加購銷售方案（可複選）"><select v-model="productForm.requiredAddonProductIds" multiple class="h-32 w-full"><option v-for="product in activeProducts.filter(item => String(item.id) !== String(editingId || ''))" :key="product.id" :value="String(product.id)">{{ product.name }}</option></select></FormField></div>
        <label v-if="courseV2Enabled" class="flex items-start gap-3 text-sm text-slate-700"><input v-model="productForm.requireAddonForNew" type="checkbox" class="mt-1 h-4 w-4" /><span><strong class="block font-medium text-slate-900">非舊生強制加購</strong><span class="block text-xs leading-5 text-slate-500">非舊生仍可購買，但必須一併購買上方強制加購方案；符合舊生資格者免加購。這不是「僅限舊生購買」。</span></span></label>
        <FormField label="簡介"><textarea v-model.trim="productForm.summary" rows="2" class="w-full"></textarea></FormField><FormField label="完整說明"><textarea v-model.trim="productForm.description" rows="6" class="w-full"></textarea></FormField><FormField label="外部購買網址"><input v-model.trim="productForm.externalPurchaseUrl" type="url" class="w-full" placeholder="留空時使用平台購買流程" /></FormField>
        <div class="space-y-2 text-sm font-medium text-slate-700"><span>課程封面</span><div class="relative aspect-[3/2] w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-slate-100"><img v-if="courseCoverPreview" :src="courseCoverPreview" :alt="`${productForm.name || '課程'}封面預覽`" class="h-full w-full object-cover" @error="handleCourseCoverPreviewError" /><div v-else class="flex h-full flex-col items-center justify-center gap-2 text-slate-400"><AppIcon name="image" class="h-10 w-10" /><span>尚未設定封面</span></div><div v-if="coverProcessing || coverLoading" class="absolute inset-0 grid place-items-center bg-white/85 text-sm text-slate-600">{{ coverProcessing ? '圖片處理中…' : '封面載入中…' }}</div></div><input ref="courseCoverInput" type="file" accept="image/*" class="hidden" @change="selectCourseCover" /><div class="flex flex-wrap gap-2"><button type="button" class="btn btn-outline btn-sm" :disabled="submitting || coverProcessing || coverLoading || coverRemoving" @click="openCourseCoverPicker"><AppIcon name="image" class="h-4 w-4" /> {{ hasCourseCover ? '更換圖片' : '選擇圖片' }}</button><button v-if="coverUploadData" type="button" class="btn btn-ghost btn-sm" @click="clearSelectedCourseCover">取消新圖片</button><button v-if="hasSavedCourseCover" type="button" class="btn btn-outline btn-sm text-red-700" @click="removeCourseCover">移除目前封面</button><button v-if="coverRemovalPending" type="button" class="btn btn-ghost btn-sm" @click="undoCourseCoverRemoval">復原目前封面</button></div><p v-if="coverError" class="font-normal text-red-600">{{ coverError }}</p><label class="block space-y-2"><span>或使用圖片網址</span><input v-model.trim="productForm.coverUrl" type="url" class="w-full" placeholder="https://example.com/course-cover.jpg" /></label></div>
        <label class="flex items-center gap-3 text-sm text-slate-700"><input v-model="productForm.transferable" type="checkbox" class="h-4 w-4" /> Legacy 顯示：允許轉讓（實際以 TicketProduct 發行快照為準）</label><button class="btn btn-primary w-full text-white" :disabled="submitting || coverProcessing || coverRemoving">{{ submitting ? '儲存中…' : '儲存銷售方案' }}</button>
      </fieldset></form>
      <form v-else-if="dialogType === 'session'" class="space-y-4" @submit.prevent="saveSession"><FormField label="場次名稱" required><input v-model.trim="sessionForm.title" required class="w-full" /></FormField><div class="grid gap-4 sm:grid-cols-2"><FormField label="適用商品"><select v-model="sessionForm.productId" class="w-full" @change="syncSessionOwnerFromProduct"><option value="">同服務商全部課程票券</option><option v-for="product in activeProducts" :key="product.id" :value="String(product.id)">{{ product.name }}</option></select></FormField><FormField v-if="isAdmin" label="場次歸屬"><select v-model="sessionForm.ownerUserId" class="w-full" :disabled="Boolean(sessionForm.productId)" @change="loadCoachProfileChoices(sessionForm.ownerUserId)"><option value="">平台課程</option><option v-for="provider in providerOptions" :key="provider.id" :value="provider.id">{{ provider.label }}</option></select></FormField><FormField label="狀態"><select v-model="sessionForm.status" class="w-full"><option value="draft">草稿</option><option value="open">開放預約</option><option value="closed">關閉預約</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></FormField><FormField label="開始時間" required><input v-model="sessionForm.startsAt" type="datetime-local" required class="w-full" /></FormField><FormField label="結束時間" required><input v-model="sessionForm.endsAt" type="datetime-local" required class="w-full" /></FormField><FormField label="預約開放時間"><input v-model="sessionForm.bookingOpenAt" type="datetime-local" class="w-full" /></FormField><FormField label="預約截止時間"><input v-model="sessionForm.bookingCloseAt" type="datetime-local" class="w-full" /></FormField><FormField label="教練名冊"><select v-model="sessionForm.coachProfileId" class="w-full"><option value="">不指定教練名冊</option><option v-for="coach in coachProfileChoices" :key="coach.id" :value="String(coach.id)">{{ coach.displayName || coach.display_name || coach.name || `教練 ${coach.id}` }}</option></select><p class="text-xs font-normal text-slate-500">名冊僅供場次指派，不會授予後台權限。</p></FormField><FormField label="顯示教練名稱"><input v-model.trim="sessionForm.coachName" class="w-full" /></FormField><FormField label="地點"><input v-model.trim="sessionForm.location" class="w-full" /></FormField><FormField label="名額"><input v-model.number="sessionForm.capacity" type="number" min="1" class="w-full" /></FormField></div><FormField label="場次備註"><textarea v-model.trim="sessionForm.notes" rows="4" class="w-full"></textarea></FormField><button class="btn btn-primary w-full text-white" :disabled="submitting">{{ submitting ? '儲存中…' : '儲存場次' }}</button></form>
      <form v-else class="space-y-4" @submit.prevent="issueManualTicket">
        <FormField label="持有人 Email" required><input v-model.trim="ticketForm.ownerEmail" type="email" required class="w-full" /></FormField>
        <FormField label="課程商品" required><select v-model="ticketForm.productId" required class="w-full"><option value="" disabled>請選擇商品</option><option v-for="product in activeProducts" :key="product.id" :value="String(product.id)">{{ product.name }}（{{ product.classCount }} 堂）</option></select></FormField>
        <FormField label="是否計入舊生資格" required>
          <select v-model="ticketForm.countsTowardReturningEligibility" required class="w-full">
            <option value="" disabled>請明確選擇</option>
            <option value="yes">是，納入此銷售方案的舊生資格</option>
            <option value="no">否，僅發行權益</option>
          </select>
        </FormField>
        <FormField label="手動發券理由" required><textarea v-model.trim="ticketForm.reason" rows="3" maxlength="500" required class="w-full" placeholder="說明發券來源，以供稽核與舊生資格追溯"></textarea></FormField>
        <p class="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">手動發券不會建立購買訂單；是否計入舊生必須逐張明確決定，理由會保留在稽核紀錄。</p>
        <button class="btn btn-primary w-full text-white" :disabled="submitting">{{ submitting ? '發券中…' : '確認發券' }}</button>
      </form>
    </AppOverlayPanel>

    <AppBottomSheet v-model="detailOpen">
      <div class="space-y-5">
        <header><p class="text-sm text-slate-500">{{ detailEyebrow }}</p><h2 class="ui-title text-xl text-slate-950">{{ detailTitle }}</h2></header>
        <p v-if="detailLoading" class="text-sm text-slate-600">詳細資料載入中…</p>
        <template v-else-if="detailType === 'order' && detailRecord">
          <DetailGrid :items="orderDetailItems" />
          <section v-if="detailRecord.lineItems?.length" class="space-y-2"><h3 class="font-medium text-slate-900">完整訂單明細</h3><ul class="divide-y divide-slate-100 rounded-lg border border-slate-200"><li v-for="(line, index) in detailRecord.lineItems" :key="line.id || index" class="flex justify-between gap-3 p-3 text-sm"><span>{{ line.name || line.productName }} × {{ line.quantity || 1 }}<em v-if="line.required" class="ml-1 not-italic text-amber-700">強制加購</em></span><span class="money-value">NT$ {{ formatMoney(line.subtotal ?? line.lineTotal ?? Number(line.unitPrice || 0) * Number(line.quantity || 1)) }}</span></li></ul></section>
          <section class="space-y-2"><h3 class="font-medium text-slate-900">發行票券</h3><p v-if="!detailRecord.issuedTickets?.length" class="text-sm text-slate-500">尚未發券。</p><ul v-else class="space-y-2"><li v-for="ticket in detailRecord.issuedTickets" :key="ticket.id || ticket.code" class="rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm">{{ ticket.code }}<span v-if="ticket.status" class="ml-2 font-sans text-xs text-slate-500">{{ ticket.status }}</span></li></ul></section>
          <section v-if="detailRecord.lifecycle?.length" class="space-y-2"><h3 class="font-medium text-slate-900">生命週期與稽核</h3><ol class="space-y-2"><li v-for="(event, index) in detailRecord.lifecycle" :key="event.id || index" class="rounded-lg border border-slate-200 p-3 text-sm"><strong>{{ event.label || event.action || event.type }}</strong><p class="mt-1 text-xs text-slate-500">{{ formatDateTime(event.createdAt || event.created_at || event.occurredAt) }}<span v-if="event.reason">・{{ event.reason }}</span></p></li></ol></section>
          <div v-if="availableOrderActions(detailRecord).length" class="grid gap-2 sm:grid-cols-2"><button v-for="action in availableOrderActions(detailRecord)" :key="action.value" type="button" class="btn" :class="action.value === 'confirm-payment' || action.value === 'retry-fulfillment' ? 'btn-primary text-white' : 'btn-outline'" :disabled="detailSaving" @click="runOrderAction(detailRecord, action.value)">{{ action.label }}</button></div>
          <p v-else class="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">此訂單目前沒有可執行的直接操作；已付款內容需透過退款或票券補償處理。</p>
        </template>
        <template v-else-if="detailType === 'ticket' && detailRecord">
          <DetailGrid :items="ticketDetailItems" />
          <div class="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-4 text-center"><div><p class="text-xs text-slate-500">剩餘</p><p class="stat-number text-2xl">{{ detailRecord.remainingUses ?? 0 }}</p></div><div><p class="text-xs text-slate-500">保留</p><p class="stat-number text-2xl text-amber-700">{{ detailRecord.heldUses ?? 0 }}</p></div><div><p class="text-xs text-slate-500">可用</p><p class="stat-number text-2xl text-emerald-700">{{ detailRecord.availableUses ?? detailRecord.remainingUses ?? 0 }}</p></div></div>
          <div class="grid gap-4 sm:grid-cols-2"><FormField label="調整堂數（正數增加、負數扣除）"><input v-model.number="ticketAdjustment.delta" type="number" min="-9999" max="9999" class="w-full" /></FormField><FormField label="調整原因"><input v-model.trim="ticketAdjustment.reason" class="w-full" placeholder="必填；會寫入不可變帳本" /></FormField></div>
          <button type="button" class="btn btn-primary w-full text-white" :disabled="detailSaving || !ticketAdjustment.delta || !ticketAdjustment.reason" @click="saveTicketAdjustment">{{ detailSaving ? '寫入中…' : '新增補償／調整事件' }}</button>
          <section class="space-y-3 border-t border-slate-200 pt-4"><h3 class="font-medium text-slate-900">票券活動紀錄</h3><p v-if="activityLoading" class="text-sm text-slate-500">紀錄載入中…</p><p v-else-if="!ticketActivity.length" class="text-sm text-slate-500">尚無活動紀錄。</p><ol v-else class="space-y-3"><li v-for="(activity, index) in ticketActivity" :key="activity.id || `${activity.type}-${index}`" class="rounded-lg border border-slate-200 p-3"><p class="font-medium text-slate-900">{{ activity.label || activity.action || activity.type || '票券紀錄' }}</p><p class="mt-1 text-sm text-slate-500">{{ activity.description || activity.note || activity.actorName || '' }}</p><p class="mt-1 text-xs text-slate-400">{{ formatDateTime(activity.createdAt || activity.created_at || activity.occurredAt) }}</p></li></ol><button v-if="activityHasMore" type="button" class="btn btn-outline w-full" :disabled="activityLoading" @click="loadTicketActivity(false)">載入更多</button></section>
        </template>
        <template v-else-if="detailType === 'booking' && detailRecord">
          <DetailGrid :items="bookingDetailItems" />
          <CourseAttendanceActions :booking="detailRecord" :busy="detailSaving" :busy-action="bookingActionBusy" @action="runBookingAction(detailRecord, $event)" />
        </template>
      </div>
    </AppBottomSheet>
  </section>
</template>

<script setup>
import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { normalizeHttpUrl } from '../utils/safeUrl'
import { showConfirm, showPrompt } from '../utils/sheet'
import AppBottomSheet from '../components/AppBottomSheet.vue'
import AppOverlayPanel from '../components/AppOverlayPanel.vue'
import AppIcon from '../components/AppIcon.vue'
import AppSearchInput from '../components/AppSearchInput.vue'
import AdminFilterSheet from '../components/AdminFilterSheet.vue'
import AdminPagination from '../components/AdminPagination.vue'
import TableColumnFilter from '../components/TableColumnFilter.vue'
import CourseCenterShell from '../components/CourseCenterShell.vue'
import CourseV2AdminPanel from '../components/CourseV2AdminPanel.vue'
import CourseAttendanceActions from '../components/CourseAttendanceActions.vue'
import {
  buildCourseMutationHeaders,
  buildCourseTicketAdjustmentPayload,
  courseActionDefinition,
  createCourseIdempotencyKey,
  formatCourseTaipeiDateTime,
  isCourseVersionConflict,
  normalizeCourseProduct,
  normalizeCourseStaffAccess,
  normalizeCourseTicket,
} from '../utils/courseV2'
import {
  createOrderMutationKey,
  hasOrderCapability,
  maxPurchaseQuantity,
  normalizeOrderRecord,
  orderMutationHeaders,
  orderStatusChip,
  orderStatusSummary,
  shouldRetainIdempotencyKey,
} from '../utils/orderParity.js'
import {
  ADMIN_COURSE_TASKS,
  COURSE_PRODUCTIZATION_ENDPOINTS,
  courseCapacityLabel,
  courseCenterErrorMessage,
  courseRecordDeepLink,
  normalizeCourseCenterPayload,
  resolveCourseAdminTask,
} from '../utils/courseProductization.js'

const props = defineProps({
  mode: { type: String, default: 'manage', validator: value => ['manage', 'orders', 'tickets'].includes(value) },
  currentRole: { type: String, default: '' },
  currentUserId: { type: [String, Number], default: '' },
  capabilities: { type: Object, default: () => ({}) },
  memberships: { type: Array, default: () => [] },
  courseV2Enabled: { type: Boolean, default: false },
  productizedTask: { type: String, default: '' },
  embedded: { type: Boolean, default: false },
  coachSessionId: { type: [String, Number], default: '' },
})
const emit = defineEmits(['navigate'])
const API = API_BASE
const adminCourseTasks = ADMIN_COURSE_TASKS.map(task => ({
  ...task,
  description: task.group,
  path: task.path || `/admin/courses/${task.key}`,
}))
const CourseAdminFrame = defineComponent({
  name: 'CourseAdminFrame',
  inheritAttrs: false,
  props: {
    embedded: { type: Boolean, default: false },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    eyebrow: { type: String, default: '' },
    tasks: { type: Array, default: () => [] },
    activeKey: { type: String, default: '' },
    navLabel: { type: String, default: '' },
  },
  setup(frameProps, { attrs, slots }) {
    return () => {
      if (!frameProps.embedded) {
        return h(CourseCenterShell, {
          ...attrs,
          title: frameProps.title,
          description: frameProps.description,
          eyebrow: frameProps.eyebrow,
          tasks: frameProps.tasks,
          activeKey: frameProps.activeKey,
          navLabel: frameProps.navLabel,
        }, slots)
      }
      const children = []
      const context = slots.context?.() || []
      if (context.length) children.push(h('section', { class: 'surface-section' }, context))
      children.push(...(slots.default?.() || []))
      return h('div', { ...attrs, class: ['space-y-5', attrs.class] }, children)
    }
  },
})
const coachSurface = computed(() => props.productizedTask.startsWith('coach-'))
const adminTask = computed(() => resolveCourseAdminTask(props.productizedTask))
const productizedV2PanelConfig = computed(() => ({
  'redeem-contexts': { initialTab: 'ticket-products', allowedTabs: ['ticket-products', 'scenarios', 'sessions'] },
  reports: { initialTab: 'reports', allowedTabs: ['reports'] },
  settings: { initialTab: 'settings', allowedTabs: ['settings'] },
})[adminTask.value.key] || null)
const productizedItems = ref([])
const productizedLoading = ref(false)
const productizedError = ref('')
const productizedContextLoading = ref(false)
const productizedOwnerUserId = ref('')
const productizedSelf = reactive({ id: '', role: '', username: '' })
const productizedStaffAccess = ref({ memberships: [], capabilities: {} })
const productizedCatalog = reactive({ programs: [], levelSchemes: [], levels: [], terms: [], sessions: [], pricingRules: [], renewalRules: [], makeupRoutes: [], insurancePolicies: [] })
const productizedFeatureReadiness = ref(null)
const productizedReadiness = reactive({})
const productizedActionNotice = ref('')
const productizedActionTone = ref('success')
const productizedActionBusy = ref('')
const productizedEditorOpen = ref(false)
const productizedEditorType = ref('')
const productizedEditorRecord = ref(null)
const productizedEditorForm = ref({})
const productizedEditorKey = ref('')
const productizedSaving = ref(false)
const productizedWaitlistTermId = ref('')
const productizedOfferMinutes = ref(60)
const productizedWaitlist = ref([])
const productizedWaitlistLoading = ref(false)
const productizedMakeupBookings = ref([])
const productizedMakeupReasons = reactive({})
const productizedTaskDescription = computed(() => coachSurface.value
  ? '場次資訊、名冊與可核銷狀態由教練權限 API 回傳；前端不推定出席資格。'
  : ({
      catalog: '管理計次票銷售方案、體驗折抵與課程券支付標記。',
      'redeem-contexts': '設定 TicketProduct、核銷情境與場次時間窗。',
      classes: '管理固定班期、程度門檻、固定堂次、插班、續報與候補名額。',
      schedule: '安排固定班逐堂課表與計次開放場次。',
      operations: '集中處理出席、有效請假、補課與開放水域保險。',
      enrollments: '檢視報名、候補 offer、限時匯款占位與續報來源。',
      students: '管理學員帳號、程度評估與有效期限，不以 Email 當身份主鍵。',
      reports: '由逐堂出席與不可變權益事件產生營運報表。',
      settings: '管理課務、通知、付款期限與補課政策。',
    })[adminTask.value.key] || '')
const productizedEmptyText = computed(() => coachSurface.value ? '此場次目前沒有可顯示的名冊紀錄。' : `目前沒有${adminTask.value.label}資料。`)
const fixedTermAdminActive = computed(() => adminTask.value.key !== 'classes' || Boolean(productizedFeatureReadiness.value?.fixedTermActive))
const fixedTermPaymentsActive = computed(() => Boolean(productizedFeatureReadiness.value?.advancedPaymentsActive))
const fixedTermBlockers = computed(() => Array.isArray(productizedFeatureReadiness.value?.blockers) ? productizedFeatureReadiness.value.blockers : [])
const normalizeRole = value => { const role = String(value || '').trim().toUpperCase(); return role === 'STORE' ? 'SERVICE_PROVIDER' : role }
const role = computed(() => normalizeRole(props.currentRole || productizedSelf.role))
const effectiveCurrentUserId = computed(() => String(props.currentUserId || productizedSelf.id || '').trim())
const isAdmin = computed(() => role.value === 'ADMIN')
const canUseLegacyCourseManager = computed(() => ['ADMIN', 'SERVICE_PROVIDER'].includes(role.value))
const focusedMode = computed(() => props.mode === 'orders' || props.mode === 'tickets')
const hasCourseCapability = key => Boolean(props.capabilities?.[key])
const tabs = computed(() => {
  const items = []
  if (canUseLegacyCourseManager.value && hasCourseCapability('manageCatalog')) {
    items.push({ key: 'overview', label: '總覽' }, { key: 'products', label: '銷售方案' }, { key: 'sessions', label: '場次' })
  }
  if (canUseLegacyCourseManager.value && hasCourseCapability('manageAttendance')) {
    items.push({ key: 'bookings', label: '預約核銷' })
  }
  if (props.courseV2Enabled && Object.values(props.capabilities || {}).some(Boolean)) {
    items.push({ key: 'course-v2', label: '票種／情境／課務' })
  }
  return items
})
const activeTab = ref(focusedMode.value ? props.mode : '')
const overview = ref({ products: 0, openSessions: 0, pendingOrders: 0, activeTickets: 0, upcomingBookings: 0 })
const products = ref([])
const productChoices = ref([])
const sessions = ref([])
const orders = ref([])
const tickets = ref([])
const bookings = ref([])
const providers = ref([])
const ticketProductChoices = ref([])
const coachProfileChoices = ref([])
const message = ref('')
const messageType = ref('success')
const busyId = ref('')
const listKeys = ['products', 'sessions', 'orders', 'tickets', 'bookings']
const listRefs = { products, sessions, orders, tickets, bookings }
const loading = reactive(Object.fromEntries(listKeys.map(key => [key, false])))
const errors = reactive(Object.fromEntries(listKeys.map(key => [key, ''])))
const meta = reactive(Object.fromEntries(listKeys.map(key => [key, { total: 0, limit: 50, offset: 0, hasMore: false }])))
const summaries = reactive(Object.fromEntries(listKeys.map(key => [key, { total: null, byStatus: {} }])))
const listState = reactive(Object.fromEntries(listKeys.map(key => [key, { q: '' }])))
const filters = reactive(Object.fromEntries(listKeys.map(key => [key, {}])))
const requestSequences = Object.create(null)
const requestControllers = Object.create(null)
const searchTimers = Object.create(null)
const suppressedSearch = new Set()
let overviewRequestSequence = 0
let detailRequestSequence = 0
let activityRequestSequence = 0
let providerRequestSequence = 0
let productChoicesRequestSequence = 0
let coachProfileChoicesRequestSequence = 0

const providerOptions = computed(() => {
  const found = new Map(providers.value.map(item => [String(item.id), { id: String(item.id), label: item.username || item.email || String(item.id) }]))
  for (const row of [...products.value, ...sessions.value, ...orders.value, ...tickets.value, ...bookings.value]) {
    const id = ownerId(row)
    if (id && !found.has(id)) found.set(id, { id, label: row.providerName || row.provider_name || id })
  }
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
})
const effectiveCourseMemberships = computed(() => (props.memberships?.length ? props.memberships : (productizedStaffAccess.value.memberships || [])))
const effectiveCourseCapabilities = computed(() => ({
  ...(productizedStaffAccess.value.capabilities || {}),
  ...(props.capabilities || {}),
}))
const productizedOwnerOptions = computed(() => {
  const found = new Map()
  const add = (id, label) => { const value = String(id || '').trim(); if (value && !found.has(value)) found.set(value, { id: value, label: String(label || value) }) }
  if (isAdmin.value) providerOptions.value.forEach(owner => add(owner.id, owner.label))
  if (role.value === 'SERVICE_PROVIDER') add(effectiveCurrentUserId.value, productizedSelf.username || '我的課程租戶')
  effectiveCourseMemberships.value.forEach(membership => add(
    membership.ownerUserId ?? membership.owner_user_id,
    membership.ownerName ?? membership.owner_name ?? membership.providerName ?? '課程租戶'
  ))
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
})
const defaultCourseOwnerUserId = computed(() => {
  if (isAdmin.value) return ''
  const membershipOwner = effectiveCourseMemberships.value
    .map(item => String(item?.ownerUserId ?? item?.owner_user_id ?? '').trim())
    .find(Boolean)
  if (membershipOwner) return membershipOwner
  return role.value === 'SERVICE_PROVIDER' ? effectiveCurrentUserId.value : ''
})
const productizedEditorLevels = computed(() => levelsForScheme(productizedEditorForm.value.schemeId))
const productizedEditorTitle = computed(() => ({
  program: '新增課程計畫', scheme: '新增程度方案', level: '新增程度', term: '新增固定班期',
  session: '新增固定班場次', pricing: '新增班期定價', 'makeup-route': productizedEditorRecord.value ? '編輯補課路由' : '新增補課路由', 'insurance-policy': productizedEditorRecord.value ? '編輯保險規則' : '新增保險規則', 'renewal-rule': productizedEditorRecord.value ? '編輯續報規則' : '新增續報規則', 'student-level': '更新學員程度', 'complete-enrollment': '標記固定班結業',
})[productizedEditorType.value] || '固定班操作')
const productizedEditorSubmitLabel = computed(() => ({ 'makeup-route': productizedEditorRecord.value ? '儲存補課路由' : '建立補課路由', 'insurance-policy': productizedEditorRecord.value ? '儲存保險規則' : '建立保險規則', 'renewal-rule': productizedEditorRecord.value ? '儲存續報規則' : '建立續報規則', 'student-level': '儲存程度評估', 'complete-enrollment': '確認標記結業' })[productizedEditorType.value] || '建立資料')
const selectedWaitlistTerm = computed(() => productizedCatalog.terms.find(term => String(term.id) === String(productizedWaitlistTermId.value)) || null)
const providerSelectOptions = computed(() => providerOptions.value.map(item => ({ value: item.id, label: item.label })))
const productSelectOptions = computed(() => activeProducts.value.map(item => ({ value: String(item.id), label: item.name })))
const activeProducts = computed(() => (productChoices.value.length ? productChoices.value : products.value).filter(item => item.status !== 'archived'))
const activeSummary = computed(() => summaries[activeTab.value] || {})
const overviewCards = computed(() => [
  { key: 'products', label: '銷售方案', value: overview.value.products, hint: '前往商城方案管理' },
  { key: 'sessions', label: '開放場次', value: overview.value.openSessions, hint: '前往場次管理' },
  { key: 'orders', label: '待處理訂單', value: overview.value.pendingOrders, hint: '至「訂單」查看課程分類' },
  { key: 'tickets', label: '有效票券', value: overview.value.activeTickets, hint: '至「票券」查看課程分類' },
  { key: 'bookings', label: '待出席預約', value: overview.value.upcomingBookings, hint: '前往預約核銷' },
])

const productStatuses = [{ value: 'draft', label: '草稿' }, { value: 'published', label: '已發布' }, { value: 'archived', label: '已封存' }]
const sessionStatuses = [{ value: 'draft', label: '草稿' }, { value: 'open', label: '開放預約' }, { value: 'closed', label: '關閉預約' }, { value: 'completed', label: '已完成' }, { value: 'cancelled', label: '已取消' }]
const orderStatusOptions = [{ value: 'pending', label: '待匯款' }, { value: 'reviewing', label: '款項確認中' }, { value: 'paid', label: '已付款' }, { value: 'cancelled', label: '已取消' }, { value: 'refunded', label: '已退款' }]
const bulkOrderActionOptions = [
  { value: 'mark-reviewing', label: '標記款項審核中', capability: 'markPaymentReview' },
  { value: 'confirm-payment', label: '確認付款並發券', capability: 'confirmPayment' },
  { value: 'cancel', label: '取消訂單', capability: 'cancel' },
  { value: 'refund', label: '退款並作廢票券', capability: 'refund' },
  { value: 'retry-fulfillment', label: '重試發券', capability: 'retryFulfillment' },
]
const ticketStatusOptions = [{ value: 'pending', label: '待首次核銷' }, { value: 'active', label: '使用中' }, { value: 'paused', label: '已暫停' }, { value: 'exhausted', label: '已用完' }, { value: 'expired', label: '已過期' }, { value: 'void', label: '已作廢' }]
const bookingStatuses = [{ value: 'booked', label: '已預約' }, { value: 'attended', label: '已出席' }, { value: 'cancelled', label: '已取消' }, { value: 'no_show', label: '未到' }]
const providerFields = computed(() => [{ key: 'providerUserId', label: '服務商', type: 'select', options: providerSelectOptions.value }, { key: 'ownerType', label: '歸屬類型', type: 'select', options: [{ value: 'platform', label: '平台課程' }, { value: 'provider', label: '服務商課程' }] }])
const productFilterColumns = computed(() => [
  { key: 'category', label: '分類', fields: [{ key: 'category', label: '分類包含', type: 'text' }] },
  ...(isAdmin.value ? [{ key: 'provider', label: '服務商', fields: providerFields.value }] : []),
  { key: 'price', label: '價格', fields: [{ key: 'priceMin', label: '最低價格', type: 'text' }, { key: 'priceMax', label: '最高價格', type: 'text' }] },
  { key: 'usage', label: '堂數／效期', fields: [{ key: 'classCountMin', label: '最少堂數', type: 'text' }, { key: 'classCountMax', label: '最多堂數', type: 'text' }, { key: 'validDaysMin', label: '最短效期（天）', type: 'text' }, { key: 'validDaysMax', label: '最長效期（天）', type: 'text' }, { key: 'activationDaysMin', label: '最短開卡期限（天）', type: 'text' }, { key: 'activationDaysMax', label: '最長開卡期限（天）', type: 'text' }] },
  { key: 'transfer', label: '轉讓', fields: [{ key: 'transferable', label: '是否可轉讓', type: 'select', options: [{ value: '1', label: '可轉讓' }, { value: '0', label: '不可轉讓' }] }] },
  { key: 'status', label: '狀態', fields: [{ key: 'statuses', label: '狀態', type: 'multi', options: productStatuses }] },
  { key: 'updated', label: '更新日期', fields: [{ key: 'updatedFrom', label: '更新日起', type: 'date' }, { key: 'updatedTo', label: '更新日至', type: 'date' }] },
])
const sessionFilterColumns = computed(() => [
  { key: 'product', label: '適用商品', fields: [{ key: 'productId', label: '商品', type: 'select', options: productSelectOptions.value }, { key: 'product', label: '商品名稱包含', type: 'text' }] },
  ...(isAdmin.value ? [{ key: 'provider', label: '服務商', fields: providerFields.value }] : []),
  { key: 'time', label: '場次時間', fields: [{ key: 'startsFrom', label: '開始日期', type: 'date' }, { key: 'startsTo', label: '結束日期', type: 'date' }] },
  { key: 'place', label: '教練／地點', fields: [{ key: 'coach', label: '教練包含', type: 'text' }, { key: 'location', label: '地點包含', type: 'text' }] },
  { key: 'availability', label: '名額', fields: [{ key: 'availability', label: '名額狀態', type: 'select', options: [{ value: 'available', label: '尚有名額' }, { value: 'full', label: '已額滿' }] }] },
  { key: 'status', label: '狀態', fields: [{ key: 'statuses', label: '狀態', type: 'multi', options: sessionStatuses }] },
])
const orderFilterColumns = computed(() => [
  { key: 'user', label: '購買人', fields: [{ key: 'user', label: '姓名或 Email', type: 'text' }] },
  { key: 'product', label: '課程', fields: [{ key: 'product', label: '課程名稱包含', type: 'text' }] },
  ...(isAdmin.value ? [{ key: 'provider', label: '服務商', fields: providerFields.value }] : []),
  { key: 'amount', label: '金額', fields: [{ key: 'amountMin', label: '最低金額', type: 'text' }, { key: 'amountMax', label: '最高金額', type: 'text' }] },
  { key: 'remittance', label: '末五碼', fields: [{ key: 'remittanceLast5', label: '匯款後五碼', type: 'text' }] },
  { key: 'status', label: '狀態', fields: [{ key: 'statuses', label: '狀態', type: 'multi', options: orderStatusOptions }] },
  { key: 'created', label: '建立時間', fields: [{ key: 'createdFrom', label: '開始日期', type: 'date' }, { key: 'createdTo', label: '結束日期', type: 'date' }] },
])
const ticketFilterColumns = computed(() => [
  { key: 'holder', label: '持有人', fields: [{ key: 'holder', label: '姓名或 Email', type: 'text' }] },
  { key: 'product', label: '商品', fields: [{ key: 'product', label: '商品名稱包含', type: 'text' }] },
  ...(isAdmin.value ? [{ key: 'provider', label: '服務商', fields: providerFields.value }] : []),
  { key: 'usage', label: '剩餘堂數', fields: [{ key: 'remainingMin', label: '最少剩餘堂數', type: 'text' }, { key: 'remainingMax', label: '最多剩餘堂數', type: 'text' }] },
  { key: 'created', label: '發行時間', fields: [{ key: 'createdFrom', label: '發行日起', type: 'date' }, { key: 'createdTo', label: '發行日至', type: 'date' }] },
  { key: 'expiry', label: '效期', fields: [{ key: 'expiryFrom', label: '到期日起', type: 'date' }, { key: 'expiryTo', label: '到期日至', type: 'date' }] },
  { key: 'status', label: '狀態', fields: [{ key: 'statuses', label: '狀態', type: 'multi', options: ticketStatusOptions }] },
])
const bookingFilterColumns = computed(() => [
  { key: 'session', label: '場次', fields: [{ key: 'session', label: '場次名稱包含', type: 'text' }, { key: 'location', label: '地點包含', type: 'text' }, { key: 'coach', label: '教練包含', type: 'text' }] },
  { key: 'user', label: '學員', fields: [{ key: 'user', label: '姓名或 Email', type: 'text' }] },
  { key: 'ticket', label: '票券／商品', fields: [{ key: 'ticket', label: '票號包含', type: 'text' }, { key: 'product', label: '商品名稱包含', type: 'text' }] },
  ...(isAdmin.value ? [{ key: 'provider', label: '服務商', fields: providerFields.value }] : []),
  { key: 'booked', label: '預約建立時間', fields: [{ key: 'bookedFrom', label: '建立日起', type: 'date' }, { key: 'bookedTo', label: '建立日至', type: 'date' }] },
  { key: 'starts', label: '場次時間', fields: [{ key: 'startsFrom', label: '開始日期', type: 'date' }, { key: 'startsTo', label: '結束日期', type: 'date' }] },
  { key: 'status', label: '狀態', fields: [{ key: 'statuses', label: '狀態', type: 'multi', options: bookingStatuses }] },
])

const dialogOpen = ref(false)
const dialogType = ref('product')
const editingId = ref(null)
const submitting = ref(false)
const emptyProductForm = () => ({ ownerUserId: '', name: '', ticketProductId: '', requireAddonForNew: false, returningProductIds: [], requiredAddonProductIds: [], category: '', summary: '', description: '', coverUrl: '', externalPurchaseUrl: '', hasCover: false, price: 0, maxPurchaseQuantity: 10, classCount: 1, validDays: 120, activationDays: 120, transferable: false, status: 'draft', sortOrder: 0, rowVersion: '' })
const emptySessionForm = () => ({ ownerUserId: '', productId: '', title: '', coachProfileId: '', coachName: '', location: '', startsAt: '', endsAt: '', bookingOpenAt: '', bookingCloseAt: '', capacity: 20, notes: '', status: 'draft', rowVersion: '' })
const productForm = ref(emptyProductForm())
const sessionForm = ref(emptySessionForm())
const ticketForm = ref({ ownerEmail: '', productId: '', countsTowardReturningEligibility: '', reason: '' })
const courseCoverInput = ref(null)
const coverUploadData = ref('')
const storedCoverPreview = ref('')
const coverLoading = ref(false)
const coverProcessing = ref(false)
const coverRemoving = ref(false)
const coverRemovalPending = ref(false)
const coverError = ref('')
let coverObjectUrl = ''
let coverPreviewRequestId = 0
let coverProcessRequestId = 0
const COVER_TARGET_WIDTH = 900
const COVER_TARGET_HEIGHT = 600
const COVER_TARGET_RATIO = COVER_TARGET_WIDTH / COVER_TARGET_HEIGHT
const COVER_MAX_FILE_BYTES = 10 * 1024 * 1024
const COVER_MAX_SOURCE_PIXELS = 40_000_000
const externalCourseCover = computed(() => normalizeHttpUrl(productForm.value.coverUrl, ''))
const courseCoverPreview = computed(() => coverUploadData.value || externalCourseCover.value || (coverRemovalPending.value ? '' : storedCoverPreview.value))
const hasSavedCourseCover = computed(() => Boolean(productForm.value.hasCover || externalCourseCover.value))
const hasCourseCover = computed(() => Boolean(courseCoverPreview.value || productForm.value.hasCover))
const dialogEyebrow = computed(() => dialogType.value === 'product' ? '課程商品' : dialogType.value === 'session' ? '課程場次' : '課程票券')
const dialogTitle = computed(() => dialogType.value === 'product'
  ? (editingId.value ? '編輯課程' : '新增課程')
  : dialogType.value === 'session'
    ? (editingId.value ? '編輯場次' : '新增場次')
    : '手動發券')

const detailOpen = ref(false)
const detailType = ref('')
const detailRecord = ref(null)
const detailLoading = ref(false)
const detailSaving = ref(false)
const ticketAdjustment = reactive({ delta: 0, reason: '' })
const bookingActionBusy = ref('')
const ticketActivity = ref([])
const activityCursor = ref('')
const activityHasMore = ref(false)
const activityLoading = ref(false)
const detailEyebrow = computed(() => detailType.value === 'order' ? '課程訂單' : detailType.value === 'ticket' ? '課程票券' : '課程預約')
const detailTitle = computed(() => detailRecord.value?.code || detailRecord.value?.sessionTitle || '詳細資料')
const detailItem = (label, value) => ({ label, value: value || '—' })
const orderDetailItems = computed(() => detailRecord.value ? [detailItem('購買人', `${detailRecord.value.buyerName || ''} ${detailRecord.value.buyerEmail || ''}`.trim()), detailItem('課程', detailRecord.value.productName), detailItem('服務商', providerDisplay(detailRecord.value)), detailItem('數量／金額', `${detailRecord.value.quantity || 0} 份／NT$ ${formatMoney(detailRecord.value.totalAmount)}`), detailItem('付款／發券', orderStatusSummary(detailRecord.value)), detailItem('已發票券', `${detailRecord.value.issuedTickets?.length || 0} 張`), detailItem('匯款後五碼', detailRecord.value.remittanceLast5), detailItem('建立時間', formatDateTime(detailRecord.value.createdAt))] : [])
const ticketDetailItems = computed(() => detailRecord.value ? [detailItem('持有人', `${detailRecord.value.ownerName || ''} ${detailRecord.value.ownerEmail || ''}`.trim()), detailItem('商品', detailRecord.value.productName), detailItem('服務商', providerDisplay(detailRecord.value)), detailItem('總堂數', detailRecord.value.totalUses), detailItem('建立時間', formatDateTime(detailRecord.value.createdAt))] : [])
const bookingDetailItems = computed(() => detailRecord.value ? [detailItem('學員', `${detailRecord.value.attendeeName || ''} ${detailRecord.value.attendeeEmail || ''}`.trim()), detailItem('場次', detailRecord.value.sessionTitle), detailItem('票券', detailRecord.value.ticketCode), detailItem('商品', detailRecord.value.productName), detailItem('服務商', providerDisplay(detailRecord.value)), detailItem('時間／地點', `${formatDateTime(detailRecord.value.startsAt)} ${detailRecord.value.location || ''}`.trim())] : [])

const selectedOrderIds = ref([])
const bulkOrderStatus = ref('')
const bulkSaving = ref(false)
const bulkOrderMutationEnabled = computed(() => true)
const orderActionKeys = new Map()
const bulkOrderIdempotencyKey = ref('')
const bulkOrderAttemptBody = ref(null)
const selectedOrderSet = computed(() => new Set(selectedOrderIds.value.map(String)))
const allVisibleOrdersSelected = computed(() => orders.value.length > 0 && orders.value.every(item => selectedOrderSet.value.has(String(item.id))))

const FormField = defineComponent({ props: { label: String, required: Boolean }, setup(componentProps, { slots }) { return () => h('label', { class: 'block space-y-2 text-sm font-medium text-slate-700' }, [h('span', {}, `${componentProps.label || ''}${componentProps.required ? ' *' : ''}`), slots.default?.()]) } })
const ListHeading = defineComponent({ props: { title: String, description: String }, setup(componentProps, { slots }) { return () => h('div', { class: 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between' }, [h('div', {}, [h('h2', { class: 'ui-title text-xl text-slate-950' }, componentProps.title), h('p', { class: 'text-sm text-slate-600' }, componentProps.description)]), slots.default?.()]) } })
const ListToolbar = defineComponent({ props: { modelValue: String, loading: Boolean, hasFilters: Boolean, placeholder: String }, emits: ['update:modelValue', 'refresh', 'clear'], setup(componentProps, { emit: componentEmit, slots }) { return () => h('div', { class: 'ops-toolbar flex flex-col gap-2 md:flex-row md:items-center' }, [h(AppSearchInput, { modelValue: componentProps.modelValue, placeholder: componentProps.placeholder, class: 'w-full md:max-w-md', 'onUpdate:modelValue': value => componentEmit('update:modelValue', value) }), h('div', { class: 'flex flex-1 flex-wrap gap-2 md:justify-end' }, [slots.default?.(), h('button', { type: 'button', class: 'btn btn-outline btn-sm', disabled: componentProps.loading, onClick: () => componentEmit('refresh') }, '重新載入'), componentProps.hasFilters ? h('button', { type: 'button', class: 'btn btn-outline btn-sm', disabled: componentProps.loading, onClick: () => componentEmit('clear') }, '清除篩選') : null])]) } })
const ListError = defineComponent({ props: { message: String }, emits: ['retry'], setup(componentProps, { emit: componentEmit }) { return () => h('div', { class: 'surface-section flex flex-col gap-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between' }, [h('span', {}, componentProps.message), h('button', { type: 'button', class: 'btn btn-outline btn-sm', onClick: () => componentEmit('retry') }, '重試')]) } })
const AdminTableState = defineComponent({ props: { loading: Boolean, empty: Boolean, emptyText: String }, setup(componentProps, { slots }) { return () => componentProps.loading ? h('div', { class: 'surface-section text-sm text-slate-600', role: 'status' }, '資料載入中…') : componentProps.empty ? h('div', { class: 'surface-section text-sm text-slate-600' }, componentProps.emptyText) : h('div', { class: 'overflow-hidden rounded-lg border border-slate-200 bg-white' }, slots.default?.()) } })
const DetailGrid = defineComponent({ props: { items: { type: Array, default: () => [] } }, setup(componentProps) { return () => h('dl', { class: 'grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-2' }, componentProps.items.map(item => h('div', {}, [h('dt', { class: 'text-xs text-slate-500' }, item.label), h('dd', { class: 'mt-1 break-words text-sm text-slate-900' }, String(item.value ?? '—'))]))) } })

function ownerId(item = {}) { return String(item.providerUserId ?? item.provider_user_id ?? item.ownerUserId ?? item.owner_user_id ?? '').trim() }
function providerDisplay(item = {}) { return item.isPlatformCourse || !ownerId(item) ? '平台課程' : (item.providerName || item.provider_name || ownerId(item)) }
function formatMoney(value) { return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0)) }
function formatDateTime(value) { return formatCourseTaipeiDateTime(value) }
function formatRange(start, end) { const from = formatDateTime(start); const to = formatDateTime(end); return from && to ? `${from}－${to}` : (from || to || '時間待設定') }
function productStatusLabel(status) { return Object.fromEntries(productStatuses.map(item => [item.value, item.label]))[status] || status }
function sessionStatusLabel(status) { return Object.fromEntries(sessionStatuses.map(item => [item.value, item.label]))[status] || status }
function orderStatusLabel(order) { return orderStatusSummary(order) }
function orderStatusClass(order) { return orderStatusChip(order) }
function ticketStatusLabel(status) { return Object.fromEntries(ticketStatusOptions.map(item => [item.value, item.label]))[status] || status }
function bookingStatusLabel(status) { return Object.fromEntries(bookingStatuses.map(item => [item.value, item.label]))[status] || status }
function statusChip(status) { if (['published', 'open', 'paid', 'issued', 'active', 'attended', 'completed'].includes(status)) return 'ops-chip-success'; if (['draft', 'pending', 'payment_review', 'booked', 'paused'].includes(status)) return 'ops-chip-warning'; return '' }
function toLocalDateTime(value) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16) }
function showMessage(value, type = 'success') { message.value = value; messageType.value = type; if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }
function columnFields(columns, key) { return columns.find(item => item.key === key)?.fields || [] }
function meaningful(value) { return Array.isArray(value) ? value.length > 0 : String(value ?? '').trim().length > 0 }
function flattenFilters(key) { const result = {}; for (const fields of Object.values(filters[key] || {})) { if (!fields || typeof fields !== 'object') continue; for (const [name, value] of Object.entries(fields)) { if (!meaningful(value)) continue; result[name] = Array.isArray(value) ? value.join(',') : value } } return result }
function hasFilters(key) { return Boolean(String(listState[key]?.q || '').trim()) || Object.keys(flattenFilters(key)).length > 0 }
function emptyText(key, fallback) { return hasFilters(key) ? '沒有符合目前搜尋與篩選條件的資料。' : fallback }
function setColumnFilter(key, column, value) { filters[key] = { ...filters[key], [column]: value || {} } }
function applyColumnFilter(key, column, value) { setColumnFilter(key, column, value); loadList(key, { offset: 0, force: true }) }
function applyFilters(key, value) { filters[key] = value || {}; loadList(key, { offset: 0, force: true }) }
function clearFilters(key) { suppressedSearch.add(key); listState[key].q = ''; suppressedSearch.delete(key); filters[key] = {}; loadList(key, { offset: 0, force: true }) }
function changePage(key, event) { loadList(key, { offset: Number(event?.offset) || 0, force: true }) }

function scheduleSearch(key) {
  if (suppressedSearch.has(key)) return
  requestSequences[key] = (requestSequences[key] || 0) + 1
  requestControllers[key]?.abort()
  clearTimeout(searchTimers[key])
  searchTimers[key] = setTimeout(() => loadList(key, { offset: 0, force: true }), 300)
}
for (const key of listKeys) watch(() => listState[key].q, () => scheduleSearch(key), { flush: 'sync' })

function normalizeListItem(key, item) {
  const normalized = key === 'tickets'
    ? normalizeCourseTicket(item)
    : key === 'products'
      ? normalizeCourseProduct(item)
      : key === 'orders'
        ? normalizeOrderRecord(item, 'course')
        : { ...item }
  if (['products', 'sessions', 'orders', 'tickets'].includes(key)) {
    normalized.rowVersion = item.rowVersion ?? item.row_version ?? item.version ?? item.lockVersion ?? ''
  }
  if (key === 'products') normalized._ownerDraft = ownerId(item)
  if (key === 'tickets') normalized.expiresAt = item.expiresAt ? String(item.expiresAt).slice(0, 10) : ''
  if (key === 'bookings') {
    normalized.rowVersion = item.rowVersion ?? item.row_version ?? item.version ?? ''
    normalized.redeemable = (item.redeemableNow ?? item.redeemable_now ?? item.redeemable) !== false
    normalized.redeemableReason = item.redeemableReason || item.redeemable_reason || item.redeemableNowReason || item.redeemable_now_reason || ''
  }
  return normalized
}
async function loadList(key, options = {}) {
  if (!listKeys.includes(key)) return
  const targetOffset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset)) : meta[key].offset
  const requestId = (requestSequences[key] || 0) + 1
  requestSequences[key] = requestId
  requestControllers[key]?.abort()
  const controller = new AbortController()
  requestControllers[key] = controller
  loading[key] = true
  errors[key] = ''
  const params = { paged: 1, limit: meta[key].limit || 50, offset: targetOffset, includeSummary: 1, ...flattenFilters(key) }
  const query = String(listState[key].q || '').trim()
  if (query) params.q = query
  try {
    const { data } = await axios.get(`${API}/admin/courses/${key}`, { params, signal: controller.signal })
    if (requestSequences[key] !== requestId) return
    const payload = data?.data ?? []
    const rawItems = Array.isArray(payload) ? payload : (Array.isArray(payload.items) ? payload.items : [])
    const items = rawItems.map(item => normalizeListItem(key, item))
    listRefs[key].value = items
    const responseMeta = Array.isArray(payload) ? {} : (payload.meta || {})
    meta[key].limit = Math.max(1, Number(responseMeta.limit) || Number(params.limit) || 50)
    meta[key].offset = Array.isArray(payload) ? 0 : Math.max(0, Number(responseMeta.offset) || targetOffset)
    meta[key].total = Math.max(0, Number(responseMeta.total) || items.length)
    meta[key].hasMore = responseMeta.hasMore != null ? Boolean(responseMeta.hasMore) : meta[key].offset + items.length < meta[key].total
    const summary = Array.isArray(payload) ? {} : (payload.summary || {})
    summaries[key] = { total: Number.isFinite(Number(summary.total)) ? Number(summary.total) : (hasFilters(key) ? summaries[key]?.total : meta[key].total), byStatus: summary.byStatus || summary.by_status || {} }
    if (key === 'orders') clearOrderSelection()
    if (meta[key].total > 0 && !items.length && meta[key].offset >= meta[key].total) {
      const lastOffset = Math.max(0, (Math.ceil(meta[key].total / meta[key].limit) - 1) * meta[key].limit)
      if (lastOffset !== meta[key].offset) return loadList(key, { offset: lastOffset, force: true })
    }
  } catch (error) {
    if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || controller.signal.aborted) return
    if (requestSequences[key] !== requestId) return
    errors[key] = error?.response?.data?.message || '課程後台資料載入失敗'
  } finally {
    if (requestSequences[key] === requestId) loading[key] = false
  }
}
async function loadOverview() { const requestId = ++overviewRequestSequence; try { const { data } = await axios.get(`${API}/admin/courses/overview`); if (requestId === overviewRequestSequence) overview.value = { ...overview.value, ...(data?.data || {}) } } catch (error) { if (requestId === overviewRequestSequence) showMessage(error?.response?.data?.message || '課程總覽載入失敗', 'error') } }
async function loadAllReferencePages(url, params = {}) {
  const collected = []
  let offset = 0
  while (true) {
    const { data } = await axios.get(url, { params: { ...params, paged: 1, limit: 200, offset } })
    const payload = data?.data ?? []
    const pageItems = Array.isArray(payload) ? payload : (Array.isArray(payload.items) ? payload.items : [])
    collected.push(...pageItems)
    const meta = Array.isArray(payload) ? {} : (payload.meta || {})
    if (!pageItems.length || !meta.hasMore) break
    const nextOffset = Math.max(offset + pageItems.length, Number(meta.offset || offset) + Math.max(1, Number(meta.limit || pageItems.length)))
    if (nextOffset <= offset) break
    offset = nextOffset
  }
  return collected
}
async function loadProviders() { const requestId = ++providerRequestSequence; if (!isAdmin.value) { providers.value = []; return } try { const items = await loadAllReferencePages(`${API}/admin/users`, { roles: 'SERVICE_PROVIDER' }); if (requestId === providerRequestSequence && isAdmin.value) providers.value = items } catch { if (requestId === providerRequestSequence) providers.value = [] } }
async function loadProductChoices(force = false) { if (productChoices.value.length && !force) return; const requestId = ++productChoicesRequestSequence; try { const items = await loadAllReferencePages(`${API}/admin/courses/products`, { statuses: 'draft,published' }); if (requestId === productChoicesRequestSequence) productChoices.value = items.map(item => normalizeListItem('products', item)) } catch { if (requestId === productChoicesRequestSequence) productChoices.value = products.value.filter(item => item.status !== 'archived') } }
async function loadTicketProductChoices() { try { const { data } = await axios.get(`${API}/admin/courses/ticket-products`, { params: { paged: 1, limit: 200, statuses: 'active,draft' } }); const payload = data?.data || []; ticketProductChoices.value = (Array.isArray(payload) ? payload : (payload.items || payload.ticketProducts || [])).map(item => ({ ...item, classCount: item.classCount ?? item.class_count })) } catch { ticketProductChoices.value = [] } }
async function loadCoachProfileChoices(ownerUserId = sessionForm.value.ownerUserId) {
  const requestId = ++coachProfileChoicesRequestSequence
  const scopedOwnerUserId = String(ownerUserId ?? defaultCourseOwnerUserId.value ?? '').trim()
  coachProfileChoices.value = []
  try {
    const { data } = await axios.get(`${API}/admin/courses/coach-profiles`, {
      params: { ownerUserId: scopedOwnerUserId },
    })
    if (requestId !== coachProfileChoicesRequestSequence) return
    const payload = data?.data || data || []
    coachProfileChoices.value = Array.isArray(payload)
      ? payload
      : (payload.items || payload.coaches || payload.coachProfiles || [])
    if (
      sessionForm.value.coachProfileId
      && !coachProfileChoices.value.some(item => String(item.id) === String(sessionForm.value.coachProfileId))
    ) {
      sessionForm.value.coachProfileId = ''
    }
  } catch {
    if (requestId === coachProfileChoicesRequestSequence) coachProfileChoices.value = []
  }
}
async function loadTab(key) {
  if (!key || key === 'course-v2') return
  if (key === 'overview') return loadOverview()
  const tasks = [loadList(key, { force: true })]
  if (['sessions', 'tickets'].includes(key)) tasks.push(loadProductChoices())
  await Promise.all(tasks)
}
function selectTab(key) { activeTab.value = key; loadTab(key) }
function openOverviewItem(item) { if (['orders', 'tickets'].includes(item?.key)) return emit('navigate', item.key); if (item?.key) selectTab(item.key) }

function productizedAdminEndpoint() {
  if (coachSurface.value) return COURSE_PRODUCTIZATION_ENDPOINTS.coachSession(props.coachSessionId)
  if (adminTask.value.endpoint) return adminTask.value.endpoint
  return ({
    catalog: '/admin/courses/products',
    schedule: '/admin/courses/sessions',
    operations: '/admin/courses/operations',
  })[adminTask.value.key] || ''
}
function adminStatusLabel(item = {}) {
  const status = String(item.status || item.paymentStatus || item.payment_status || item.enrollmentStatus || item.enrollment_status || '').toLowerCase()
  return ({ draft: '草稿', published: '已發布', active: '啟用', inactive: '停用', open: '開放', booked: '已預約', waiting: '候補中', offered: '候補保留', pending_payment: '待匯款', reviewing: '匯款審核中', confirmed: '已確認', completed: '已結業', scheduled: '已排課', attended: '已出席', absent: '缺席', no_show: '未到', leave: '有效請假', leave_locked: '有效請假', pending_insurance: '待保險匯款' })[status] || status || '待確認'
}
function adminStatusClass(item = {}) {
  const status = String(item.status || item.paymentStatus || item.payment_status || item.enrollmentStatus || item.enrollment_status || '').toLowerCase()
  if (['published', 'active', 'open', 'confirmed', 'completed', 'attended'].includes(status)) return 'ops-chip-success'
  if (['waiting', 'offered', 'pending_payment', 'reviewing', 'pending_insurance'].includes(status)) return 'ops-chip-warning'
  return 'ops-chip-info'
}
function adminCapacityLabel(item = {}) {
  if (item.capacity != null || item.capacityTotal != null || item.capacity_total != null) return courseCapacityLabel(item)
  if (item.remainingSessions != null || item.remaining_sessions != null) return `${item.remainingSessions ?? item.remaining_sessions} 堂權益`
  if (item.levelName || item.level_name) return `程度：${item.levelName || item.level_name}`
  return '—'
}
function assessmentStatusLabel(status) { return ({ NOT_STARTED: '尚未開始', PENDING: '評估中', PASSED: '已通過', FAILED: '未通過', EXPIRED: '已失效' })[String(status || '').toUpperCase()] || '尚未評估' }
function normalizeProductizedAdminRow(item = {}) { return { ...item, rowVersion: Number(item.rowVersion ?? item.row_version ?? 1) || 1 } }
function levelsForScheme(schemeId) { return productizedCatalog.levels.filter(level => String(level.schemeId ?? level.scheme_id) === String(schemeId || '')) }
function sessionsForTerm(termId) { return productizedCatalog.sessions.filter(session => String(session.termId ?? session.term_id) === String(termId || '')) }
function pricingRulesForTerm(termId) { return productizedCatalog.pricingRules.filter(rule => String(rule.termId ?? rule.term_id) === String(termId || '') && String(rule.status || '').toLowerCase() === 'active') }
function assignProductizedCatalog(source = {}) {
  const payload = source?.data?.data ?? source?.data ?? source ?? {}
  for (const [target, keys] of Object.entries({ programs: ['programs'], levelSchemes: ['levelSchemes', 'level_schemes'], levels: ['levels'], terms: ['terms'], sessions: ['sessions'], pricingRules: ['pricingRules', 'pricing_rules'], renewalRules: ['renewalRules', 'renewal_rules'] })) {
    const rows = keys.map(key => payload?.[key]).find(Array.isArray) || []
    productizedCatalog[target] = rows.map(normalizeProductizedAdminRow)
  }
}
function clearProductizedCatalog() { for (const key of Object.keys(productizedCatalog)) productizedCatalog[key] = [] }
function showProductizedNotice(value, tone = 'success') { productizedActionNotice.value = value; productizedActionTone.value = tone }
function productizedMutationErrorMessage(error, fallback) {
  const message = courseCenterErrorMessage(error, fallback)
  const details = error?.response?.data?.details || error?.response?.data?.data || {}
  const issues = Array.isArray(details?.issues) ? details.issues.map(issue => issue.message).filter(Boolean) : []
  const counts = [details?.unresolvedCount != null ? `未判定 ${details.unresolvedCount} 堂` : '', details?.futureSessionCount != null ? `未結束 ${details.futureSessionCount} 堂` : ''].filter(Boolean)
  return [message, ...issues, ...counts].filter(Boolean).join('；')
}
async function handleProductizedMutationError(error, fallback) {
  const status = Number(error?.response?.status || 0)
  const recoverable = [409, 412, 428].includes(status)
  showProductizedNotice(`${productizedMutationErrorMessage(error, fallback)}${recoverable ? '；已重新載入最新資料，請確認後重試。' : ''}`, 'error')
  if (recoverable) await loadProductizedAdminData()
}
function productizedMutationHeaders(record, prefix, idempotencyKey = '') {
  return buildCourseMutationHeaders(record || {}, { idempotencyKey: idempotencyKey || createCourseIdempotencyKey(prefix) })
}
async function hydrateProductizedAdminContext() {
  if (coachSurface.value) return
  productizedContextLoading.value = true
  productizedError.value = ''
  try {
    if (props.currentRole || props.currentUserId) Object.assign(productizedSelf, { id: String(props.currentUserId || ''), role: props.currentRole || '', username: '' })
    else {
      const { data } = await axios.get(`${API}/whoami`)
      const profile = data?.data ?? data ?? {}
      Object.assign(productizedSelf, { id: String(profile.id || profile.userId || ''), role: profile.role || '', username: profile.username || profile.email || '' })
    }
    try {
      const { data } = await axios.get(`${API}/courses/staff/me`)
      productizedStaffAccess.value = normalizeCourseStaffAccess(data, { platformRole: role.value })
    } catch { productizedStaffAccess.value = { memberships: props.memberships || [], capabilities: props.capabilities || {} } }
    if (isAdmin.value) await loadProviders()
    const current = String(productizedOwnerUserId.value || '')
    const valid = productizedOwnerOptions.value.some(owner => owner.id === current)
    productizedOwnerUserId.value = valid ? current : (defaultCourseOwnerUserId.value || productizedOwnerOptions.value[0]?.id || '')
    if (!productizedOwnerUserId.value) productizedError.value = '沒有可管理的課程租戶，請先建立服務商或員工 membership。'
  } catch (error) {
    productizedError.value = courseCenterErrorMessage(error, '課程租戶載入失敗')
  } finally { productizedContextLoading.value = false }
}
async function changeProductizedOwner() {
  productizedItems.value = []
  productizedMakeupBookings.value = []
  Object.keys(productizedMakeupReasons).forEach(key => delete productizedMakeupReasons[key])
  productizedWaitlist.value = []
  productizedWaitlistTermId.value = ''
  Object.keys(productizedReadiness).forEach(key => delete productizedReadiness[key])
  productizedFeatureReadiness.value = null
  clearProductizedCatalog()
  await loadProductizedAdminData()
}
async function loadProductizedAdminData() {
  const endpoint = productizedAdminEndpoint()
  if (!endpoint) return
  if (!coachSurface.value && !productizedOwnerUserId.value) {
    productizedError.value = '請先選擇課程租戶。'
    return
  }
  productizedLoading.value = true
  productizedError.value = ''
  if (adminTask.value.key === 'classes') productizedFeatureReadiness.value = null
  try {
    const params = { paged: 1, limit: 100, sessionId: props.coachSessionId || undefined, ...(!coachSurface.value ? { ownerUserId: productizedOwnerUserId.value } : {}) }
    if (adminTask.value.key === 'classes') {
      const readinessResponse = await axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.adminFixedTermReadiness}`, { params })
      productizedFeatureReadiness.value = readinessResponse.data?.data ?? readinessResponse.data ?? null
      if (!productizedFeatureReadiness.value?.fixedTermActive) {
        clearProductizedCatalog()
        productizedItems.value = []
        return
      }
      const [catalogResponse, routesResponse] = await Promise.all([
        axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.adminFixedTermCatalog}`, { params }),
        axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.adminMakeupRoutes}`, { params }),
      ])
      assignProductizedCatalog(catalogResponse.data)
      productizedCatalog.makeupRoutes = normalizeCourseCenterPayload(routesResponse.data, ['makeupRoutes', 'routes']).map(normalizeProductizedAdminRow)
      productizedCatalog.insurancePolicies = []
      if (fixedTermPaymentsActive.value) {
        try {
          const insuranceResponse = await axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.adminMakeupInsurancePolicies}`, { params })
          productizedCatalog.insurancePolicies = normalizeCourseCenterPayload(insuranceResponse.data, ['insurancePolicies', 'policies']).map(normalizeProductizedAdminRow)
        } catch (error) {
          showProductizedNotice(courseCenterErrorMessage(error, '保險規則載入失敗；固定班 catalog 與補課路由仍可管理。'), 'error')
        }
      }
      productizedItems.value = productizedCatalog.terms
    } else {
      const requests = [axios.get(`${API}${endpoint}`, { params })]
      if (adminTask.value.key === 'operations') requests.push(axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.adminMakeupBookings}`, { params: { ...params, status: 'BOOKED' } }))
      else if (['students', 'enrollments'].includes(adminTask.value.key)) requests.push(axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.adminFixedTermCatalog}`, { params }))
      const [listResponse, relatedResponse] = await Promise.all(requests)
      if (adminTask.value.key === 'operations') {
        productizedMakeupBookings.value = normalizeCourseCenterPayload(relatedResponse?.data, ['makeupBookings', 'bookings']).map(normalizeProductizedAdminRow)
      } else if (relatedResponse) assignProductizedCatalog(relatedResponse.data)
      productizedItems.value = normalizeCourseCenterPayload(listResponse.data, ['terms', 'enrollments', 'students', 'sessions', 'bookings', 'roster', 'rows']).map(normalizeProductizedAdminRow)
    }
  } catch (error) {
    productizedItems.value = []
    if (adminTask.value.key === 'operations') productizedMakeupBookings.value = []
    productizedError.value = courseCenterErrorMessage(error, `${adminTask.value.label}載入失敗`)
  } finally {
    productizedLoading.value = false
  }
}

function openProductizedEditor(type, record = null) {
  productizedEditorType.value = type
  productizedEditorRecord.value = record ? normalizeProductizedAdminRow(record) : null
  const forms = {
    program: { name: '', code: '', slug: '', summary: '' },
    scheme: { name: '', code: '', description: '' },
    level: { schemeId: String(productizedCatalog.levelSchemes[0]?.id || ''), name: '', code: '', sortOrder: 0 },
    term: { programId: String(productizedCatalog.programs[0]?.id || ''), levelId: '', name: '', code: '', startsOn: '', endsOn: '', enrollmentOpenAt: '', enrollmentCloseAt: '', capacity: '', leaveQuota: 1, leaveCutoffMinutes: 60, makeupValidDays: 30 },
    session: { title: record?.name || '', code: '', startsAt: '', endsAt: '', coachName: '', city: '', location: '', capacity: '' },
    pricing: { pricingMode: 'FULL_TERM', currency: 'TWD', fullPrice: '', unitPrice: '', priority: 100 },
    'makeup-route': {
      sourceTermId: String(record?.sourceTermId ?? record?.source_term_id ?? productizedCatalog.terms[0]?.id ?? ''),
      targetSessionId: String(record?.targetSessionId ?? record?.target_session_id ?? productizedCatalog.sessions[0]?.id ?? ''),
      status: String(record?.status || 'active').toLowerCase(),
      capacityOverride: record?.capacityOverride ?? record?.capacity_override ?? '',
      bookingOpenAt: toLocalDateTime(record?.bookingOpenAt ?? record?.booking_open_at),
      bookingCloseAt: toLocalDateTime(record?.bookingCloseAt ?? record?.booking_close_at),
    },
    'insurance-policy': {
      targetSessionId: String(record?.targetSessionId ?? record?.target_session_id ?? productizedCatalog.sessions[0]?.id ?? ''),
      feeProductId: String(record?.feeProductId ?? record?.fee_product_id ?? ''),
      required: Boolean(Number(record?.required ?? 1)),
      feeAmount: record?.feeAmount ?? record?.fee_amount ?? 0,
      currency: String(record?.currency || 'TWD'),
      paymentHoldMinutes: Number(record?.paymentHoldMinutes ?? record?.payment_hold_minutes ?? 1440),
      cancelCloseAt: toLocalDateTime(record?.cancelCloseAt ?? record?.cancel_close_at),
      status: String(record?.status || 'active').toLowerCase(),
    },
    'renewal-rule': {
      sourceTermId: String(record?.sourceTermId ?? record?.source_term_id ?? productizedCatalog.terms[0]?.id ?? ''),
      targetTermId: String(record?.targetTermId ?? record?.target_term_id ?? productizedCatalog.terms[1]?.id ?? ''),
      renewalOpenAt: toLocalDateTime(record?.renewalOpenAt ?? record?.renewal_open_at),
      renewalCloseAt: toLocalDateTime(record?.renewalCloseAt ?? record?.renewal_close_at),
      reservedCapacity: Number(record?.reservedCapacity ?? record?.reserved_capacity ?? 0),
      requireCompleted: record?.eligibility?.requireCompleted ?? true,
      requireTargetLevel: record?.eligibility?.requireTargetLevel ?? true,
      status: String(record?.status || 'active').toLowerCase(),
    },
    'student-level': { schemeId: String(productizedCatalog.levels.find(level => String(level.id) === String(record?.level_id ?? record?.levelId))?.scheme_id || productizedCatalog.levelSchemes[0]?.id || ''), levelId: String(record?.level_id ?? record?.levelId ?? ''), assessmentStatus: String(record?.assessment_status ?? record?.assessmentStatus ?? 'NOT_STARTED').toUpperCase(), expiresAt: '', note: '' },
    'complete-enrollment': { reason: '' },
  }
  productizedEditorForm.value = forms[type] || {}
  productizedEditorKey.value = createCourseIdempotencyKey(`term-admin-${type}`)
  productizedEditorOpen.value = true
}
function productizedEditorRequest() {
  const type = productizedEditorType.value
  const form = productizedEditorForm.value
  const record = productizedEditorRecord.value
  const ownerUserId = productizedOwnerUserId.value
  if (type === 'program') return { method: 'post', endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.adminPrograms, body: { ...form, ownerUserId } }
  if (type === 'scheme') return { method: 'post', endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.adminLevelSchemes, body: { ...form, ownerUserId } }
  if (type === 'level') return { method: 'post', endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.adminLevels, body: { ...form, ownerUserId, schemeId: Number(form.schemeId), sortOrder: Number(form.sortOrder || 0) } }
  if (type === 'term') return { method: 'post', endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.adminClasses, body: { ...form, ownerUserId, programId: Number(form.programId), levelId: form.levelId ? Number(form.levelId) : null, capacity: form.capacity === '' ? null : Number(form.capacity) } }
  if (type === 'session') return { method: 'post', endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.adminTermSessions(record.id), record, body: { ...form, ownerUserId, capacity: form.capacity === '' ? null : Number(form.capacity), status: 'draft' } }
  if (type === 'pricing') return { method: 'post', endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.adminTermPricingRules(record.id), body: { ...form, ownerUserId, fullPrice: form.fullPrice === '' ? null : Number(form.fullPrice), unitPrice: form.unitPrice === '' ? null : Number(form.unitPrice), priority: Number(form.priority || 100), status: 'active' } }
  if (type === 'makeup-route') return { method: record ? 'patch' : 'post', endpoint: record ? COURSE_PRODUCTIZATION_ENDPOINTS.adminMakeupRoute(record.id) : COURSE_PRODUCTIZATION_ENDPOINTS.adminMakeupRoutes, record, body: { ...form, ownerUserId, sourceTermId: Number(form.sourceTermId), targetSessionId: Number(form.targetSessionId), capacityOverride: form.capacityOverride === '' ? null : Number(form.capacityOverride), bookingOpenAt: form.bookingOpenAt || null, bookingCloseAt: form.bookingCloseAt || null } }
  if (type === 'insurance-policy') return { method: record ? 'patch' : 'post', endpoint: record ? COURSE_PRODUCTIZATION_ENDPOINTS.adminMakeupInsurancePolicy(record.id) : COURSE_PRODUCTIZATION_ENDPOINTS.adminMakeupInsurancePolicies, record, body: { ...form, ownerUserId, targetSessionId: Number(form.targetSessionId), feeProductId: form.feeProductId ? Number(form.feeProductId) : null, feeAmount: Number(form.feeAmount || 0), paymentHoldMinutes: Number(form.paymentHoldMinutes || 1440), cancelCloseAt: form.cancelCloseAt || null } }
  if (type === 'renewal-rule') return { method: record ? 'patch' : 'post', endpoint: record ? COURSE_PRODUCTIZATION_ENDPOINTS.adminRenewalRule(record.id) : COURSE_PRODUCTIZATION_ENDPOINTS.adminRenewalRules, record, body: { ...form, ownerUserId, sourceTermId: Number(form.sourceTermId), targetTermId: Number(form.targetTermId), reservedCapacity: Number(form.reservedCapacity || 0), eligibility: { requireCompleted: Boolean(form.requireCompleted), requireTargetLevel: Boolean(form.requireTargetLevel) } } }
  if (type === 'student-level') return { method: 'put', endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.adminStudentLevel(record.id), record, body: { ...form, ownerUserId, schemeId: Number(form.schemeId), levelId: form.levelId ? Number(form.levelId) : null } }
  if (type === 'complete-enrollment') return { method: 'post', endpoint: COURSE_PRODUCTIZATION_ENDPOINTS.adminEnrollmentComplete(record.id), record, body: { reason: form.reason || '', ownerUserId } }
  return null
}
async function submitProductizedEditor() {
  const request = productizedEditorRequest()
  if (!request || productizedSaving.value) return
  if (productizedEditorType.value === 'pricing' && request.body.fullPrice == null && request.body.unitPrice == null) return showProductizedNotice('全期價或單價至少填一項。', 'error')
  productizedSaving.value = true
  productizedActionNotice.value = ''
  try {
    await axios({ method: request.method, url: `${API}${request.endpoint}`, data: request.body, headers: productizedMutationHeaders(request.record, `term-admin-${productizedEditorType.value}`, productizedEditorKey.value) })
    const success = productizedEditorSubmitLabel.value.replace(/^確認/, '')
    productizedEditorOpen.value = false
    productizedEditorKey.value = ''
    await loadProductizedAdminData()
    showProductizedNotice(`${success}已完成。`)
  } catch (error) {
    if (!shouldRetainIdempotencyKey(error)) productizedEditorKey.value = createCourseIdempotencyKey(`term-admin-${productizedEditorType.value}`)
    await handleProductizedMutationError(error, `${productizedEditorTitle.value}失敗`)
    const recordId = productizedEditorRecord.value?.id
    if (recordId) productizedEditorRecord.value = productizedCatalog.makeupRoutes.find(route => String(route.id) === String(recordId)) || productizedCatalog.insurancePolicies.find(policy => String(policy.id) === String(recordId)) || productizedCatalog.renewalRules.find(rule => String(rule.id) === String(recordId)) || productizedCatalog.terms.find(term => String(term.id) === String(recordId)) || productizedItems.value.find(item => String(item.id) === String(recordId)) || productizedEditorRecord.value
  } finally { productizedSaving.value = false }
}
async function checkTermReadiness(term, { quiet = false } = {}) {
  productizedActionBusy.value = `readiness-${term.id}`
  try {
    const { data } = await axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.adminTermReadiness(term.id)}`, { params: { ownerUserId: productizedOwnerUserId.value } })
    const result = normalizeProductizedAdminRow(data?.data ?? data ?? {})
    productizedReadiness[term.id] = result
    if (!quiet) showProductizedNotice(result.ready ? '班期依賴已完整，可以發布。' : `發布前還需要：${(result.issues || []).map(issue => issue.message).join('、')}`, result.ready ? 'success' : 'error')
    return result
  } catch (error) { await handleProductizedMutationError(error, '班期發布檢查失敗'); return null }
  finally { productizedActionBusy.value = '' }
}
async function publishProductizedTerm(term) {
  if (productizedActionBusy.value) return
  const readiness = await checkTermReadiness(term, { quiet: true })
  if (!readiness?.ready) {
    if (readiness) showProductizedNotice(`無法發布：${(readiness.issues || []).map(issue => issue.message).join('、')}`, 'error')
    return
  }
  productizedActionBusy.value = `publish-${term.id}`
  try {
    await axios.post(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.adminTermPublish(term.id)}`, { ownerUserId: productizedOwnerUserId.value }, { headers: productizedMutationHeaders(readiness, 'term-publish') })
    await loadProductizedAdminData()
    showProductizedNotice(`班期「${term.name}」已發布。`)
  } catch (error) { await handleProductizedMutationError(error, '固定班發布失敗') }
  finally { productizedActionBusy.value = '' }
}
async function loadProductizedWaitlist() {
  if (!productizedWaitlistTermId.value) { productizedWaitlist.value = []; return }
  productizedWaitlistLoading.value = true
  try {
    const { data } = await axios.get(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.adminTermWaitlist(productizedWaitlistTermId.value)}`, { params: { ownerUserId: productizedOwnerUserId.value } })
    productizedWaitlist.value = normalizeCourseCenterPayload(data, ['waitlist']).map(normalizeProductizedAdminRow)
  } catch (error) { productizedWaitlist.value = []; showProductizedNotice(courseCenterErrorMessage(error, '候補名單載入失敗'), 'error') }
  finally { productizedWaitlistLoading.value = false }
}
async function createProductizedWaitlistOffer() {
  const term = selectedWaitlistTerm.value
  if (!term || productizedActionBusy.value) return
  productizedActionBusy.value = 'waitlist-offer'
  try {
    await axios.post(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.adminTermWaitlistOffers(term.id)}`, { ownerUserId: productizedOwnerUserId.value, offerMinutes: Number(productizedOfferMinutes.value || 60) }, { headers: productizedMutationHeaders(term, 'term-waitlist-offer') })
    await Promise.all([loadProductizedWaitlist(), loadProductizedAdminData()])
    showProductizedNotice('已依順位釋出一筆限時候補 offer。')
  } catch (error) { await handleProductizedMutationError(error, '候補 offer 建立失敗') }
  finally { productizedActionBusy.value = '' }
}
function canMarkTermAttendance(item = {}) { return ['SCHEDULED', 'LEAVE'].includes(String(item.status || '').toUpperCase()) }
async function markProductizedTermAttendance(item, action) {
  const key = `term-${action}-${item.id}`
  productizedActionBusy.value = key
  try {
    await axios.post(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.adminTermEntitlementAttendance(item.id, action)}`, { ownerUserId: productizedOwnerUserId.value }, { headers: productizedMutationHeaders(item, `term-attendance-${action}`) })
    await loadProductizedAdminData()
    showProductizedNotice(action === 'attend' ? '固定班已標記出席。' : '固定班已標記一般缺席，不會產生補課權益。')
  } catch (error) { await handleProductizedMutationError(error, '固定班出席判定失敗') }
  finally { productizedActionBusy.value = '' }
}
function canMarkMakeupAttendance(booking = {}) { return String(booking.status || '').toUpperCase() === 'BOOKED' }
async function markProductizedMakeupAttendance(booking, action) {
  const reason = String(productizedMakeupReasons[booking?.id] || '').trim()
  if (!booking?.id || !canMarkMakeupAttendance(booking) || !reason || productizedActionBusy.value) return
  productizedActionBusy.value = `makeup-${action}-${booking.id}`
  try {
    await axios.post(`${API}${COURSE_PRODUCTIZATION_ENDPOINTS.adminMakeupBookingAttendance(booking.id, action)}`, { ownerUserId: productizedOwnerUserId.value, reason }, { headers: productizedMutationHeaders(booking, `makeup-${action}`) })
    delete productizedMakeupReasons[booking.id]
    await loadProductizedAdminData()
    showProductizedNotice(action === 'attend' ? '補課已完成出席判定。' : '補課已標記未到。')
  } catch (error) { await handleProductizedMutationError(error, '補課出席判定失敗') }
  finally { productizedActionBusy.value = '' }
}

function releaseCourseCoverObjectUrl() { if (coverObjectUrl && typeof URL !== 'undefined') URL.revokeObjectURL(coverObjectUrl); coverObjectUrl = ''; storedCoverPreview.value = '' }
function resetCourseCoverState() { coverPreviewRequestId += 1; coverProcessRequestId += 1; releaseCourseCoverObjectUrl(); coverUploadData.value = ''; coverLoading.value = false; coverProcessing.value = false; coverRemoving.value = false; coverRemovalPending.value = false; coverError.value = ''; if (courseCoverInput.value) courseCoverInput.value.value = '' }
function closeDialog() { dialogOpen.value = false; editingId.value = null; coachProfileChoices.value = []; resetCourseCoverState() }
function requestCloseDialog() { if (!submitting.value) closeDialog() }
function handleDialogModelValue(value) { if (value) dialogOpen.value = true; else requestCloseDialog() }
function openCourseCoverPicker() { courseCoverInput.value?.click() }
function processCourseCover(file) { return new Promise((resolve, reject) => { if (!file || !/^image\//.test(file.type)) return reject(new Error('請選擇圖片檔案')); if (file.size > COVER_MAX_FILE_BYTES) return reject(new Error('圖片檔案不得超過 10MB')); const reader = new FileReader(); reader.onerror = () => reject(new Error('讀取圖片失敗')); reader.onload = () => { const image = new Image(); image.onerror = () => reject(new Error('圖片格式無法讀取')); image.onload = () => { try { const width = image.naturalWidth || image.width; const height = image.naturalHeight || image.height; if (!width || !height) return reject(new Error('圖片尺寸無效')); if (width * height > COVER_MAX_SOURCE_PIXELS) return reject(new Error('圖片解析度過大')); let cropWidth = width; let cropHeight = height; if (width / height > COVER_TARGET_RATIO) cropWidth = Math.max(1, Math.floor(height * COVER_TARGET_RATIO)); else cropHeight = Math.max(1, Math.floor(width / COVER_TARGET_RATIO)); const canvas = document.createElement('canvas'); canvas.width = COVER_TARGET_WIDTH; canvas.height = COVER_TARGET_HEIGHT; const context = canvas.getContext('2d'); if (!context) return reject(new Error('瀏覽器無法處理圖片')); context.drawImage(image, Math.floor((width - cropWidth) / 2), Math.floor((height - cropHeight) / 2), cropWidth, cropHeight, 0, 0, COVER_TARGET_WIDTH, COVER_TARGET_HEIGHT); return resolve(canvas.toDataURL('image/jpeg', 0.85)) } catch { return reject(new Error('圖片轉換失敗')) } }; image.src = String(reader.result || '') }; reader.readAsDataURL(file) }) }
async function selectCourseCover(event) { const file = event?.target?.files?.[0]; if (!file) return; const requestId = ++coverProcessRequestId; coverProcessing.value = true; coverError.value = ''; try { const dataUrl = await processCourseCover(file); if (requestId === coverProcessRequestId) coverUploadData.value = dataUrl } catch (error) { if (requestId === coverProcessRequestId) coverError.value = error?.message || '圖片處理失敗' } finally { if (requestId === coverProcessRequestId) coverProcessing.value = false; if (event?.target) event.target.value = '' } }
function clearSelectedCourseCover() { coverProcessRequestId += 1; coverUploadData.value = ''; coverProcessing.value = false; coverError.value = '' }
function handleCourseCoverPreviewError() { coverError.value = '目前無法載入封面預覽，請確認圖片網址或重新選擇圖片。' }
async function loadStoredCourseCover(product) { if (!product?.id || !product?.hasCover) return; const requestId = ++coverPreviewRequestId; coverLoading.value = true; try { const version = product.updatedAt ? `?v=${encodeURIComponent(product.updatedAt)}` : ''; const { data } = await axios.get(`${API}/admin/courses/products/${product.id}/cover${version}`, { responseType: 'blob' }); if (requestId !== coverPreviewRequestId) return; releaseCourseCoverObjectUrl(); coverObjectUrl = URL.createObjectURL(data); storedCoverPreview.value = coverObjectUrl } catch { if (requestId === coverPreviewRequestId) coverError.value = '封面已上傳，但目前無法載入預覽。' } finally { if (requestId === coverPreviewRequestId) coverLoading.value = false } }
async function removeCourseCover() {
  if (externalCourseCover.value) { productForm.value.coverUrl = ''; return }
  if (!productForm.value.hasCover || !editingId.value) return
  const confirmed = await showConfirm('確定移除目前的課程封面？儲存商品後才會套用。', {
    title: '移除課程封面',
    confirmText: '移除封面',
  })
  if (!confirmed) return
  coverRemovalPending.value = true
  productForm.value.hasCover = false
}
function undoCourseCoverRemoval() { coverRemovalPending.value = false; productForm.value.hasCover = true }

function openProductForm(product = null) {
  resetCourseCoverState()
  editingId.value = product?.id || null
  productForm.value = product ? {
    ...emptyProductForm(),
    ...product,
    maxPurchaseQuantity: maxPurchaseQuantity(product),
    ownerUserId: ownerId(product),
    ticketProductId: String(product.ticketProductId ?? product.ticket_product_id ?? ''),
    requireAddonForNew: Boolean(product.requireAddonForNew ?? product.require_addon_for_new),
    returningProductIds: (product.returningProductIds || product.returning_product_ids || product.returningProducts || []).map(item => String(item?.id ?? item?.productId ?? item)),
    requiredAddonProductIds: (product.requiredAddonProductIds || product.required_addon_product_ids || product.requiredAddons || []).map(item => String(item?.id ?? item?.productId ?? item)),
  } : emptyProductForm()
  if (props.courseV2Enabled) loadTicketProductChoices()
  loadProductChoices()
  dialogType.value = 'product'
  dialogOpen.value = true
  if (product?.hasCover) loadStoredCourseCover(product)
}
async function saveProduct() {
  submitting.value = true
  const {
    id,
    code,
    hasCover,
    createdAt,
    updatedAt,
    _ownerDraft,
    ownerUserId,
    rowVersion,
    returningStudentOnly,
    returning_student_only,
    require_addon_for_new,
    ...payload
  } = productForm.value
  if (isAdmin.value && !editingId.value) payload.ownerUserId = ownerUserId || null
  const external = normalizeHttpUrl(payload.coverUrl, '')
  const externalPurchaseUrl = normalizeHttpUrl(payload.externalPurchaseUrl, '')
  if (String(payload.coverUrl || '').trim() && !external) { coverError.value = '封面圖片網址僅支援 http 或 https'; submitting.value = false; return }
  if (String(payload.externalPurchaseUrl || '').trim() && !externalPurchaseUrl) { showMessage('外部購買網址僅支援 http 或 https', 'error'); submitting.value = false; return }
  if (external) payload.coverUrl = external
  payload.externalPurchaseUrl = externalPurchaseUrl
  if (props.courseV2Enabled) {
    payload.ticketProductId = payload.ticketProductId ? Number(payload.ticketProductId) : null
    payload.requireAddonForNew = Boolean(productForm.value.requireAddonForNew)
    payload.returningProductIds = (payload.returningProductIds || []).map(Number).filter(Number.isFinite)
    payload.requiredAddonProductIds = (payload.requiredAddonProductIds || []).map(Number).filter(Number.isFinite)
  } else {
    delete payload.ticketProductId
    delete payload.requireAddonForNew
    delete payload.returningProductIds
    delete payload.requiredAddonProductIds
  }
  try {
    const response = editingId.value
      ? await axios.patch(
          `${API}/admin/courses/products/${editingId.value}`,
          payload,
          courseMutationConfig({ rowVersion }, 'course-product-update')
        )
      : await axios.post(
          `${API}/admin/courses/products`,
          payload,
          courseMutationConfig({}, 'course-product-create')
        )
    const productId = editingId.value || Number(response?.data?.data?.id)
    if (!productId) throw new Error('無法取得商品編號')
    editingId.value = productId
    const savedProductVersion = response?.data?.data?.rowVersion
      ?? response?.data?.data?.row_version
      ?? response?.data?.rowVersion
      ?? response?.data?.row_version
      ?? ''
    const coverMutationConfig = courseMutationConfig(
      { rowVersion: savedProductVersion },
      coverUploadData.value ? 'course-product-cover-upload' : 'course-product-cover-delete'
    )
    try {
      if (coverUploadData.value) {
        await axios.post(
          `${API}/admin/courses/products/${productId}/cover_json`,
          { dataUrl: coverUploadData.value },
          coverMutationConfig
        )
      } else if (coverRemovalPending.value && !external) {
        await axios.delete(
          `${API}/admin/courses/products/${productId}/cover`,
          coverMutationConfig
        )
      }
    } catch (error) {
      productChoices.value = []
      await Promise.allSettled([loadList('products', { force: true }), loadOverview(), loadProductChoices(true)])
      showMessage(`課程商品已儲存，但封面更新失敗：${error?.response?.data?.message || error?.message || '未知錯誤'}`, 'error')
      return
    }
    closeDialog(); productChoices.value = []; await Promise.all([loadList('products', { force: true }), loadOverview(), loadProductChoices(true)]); showMessage('課程商品已儲存。')
  } catch (error) {
    if (!await reloadCourseMutationConflict(error, 'products', {
      closeEditor: true,
      message: '課程商品版本已更新，清單已重新載入，請重新開啟後再儲存。',
    })) {
      showMessage(error?.response?.data?.message || error?.message || '課程商品儲存失敗', 'error')
    }
  } finally { submitting.value = false }
}
async function archiveProduct(product) {
  const confirmed = await showConfirm(`確定封存「${product.name}」？`, {
    title: '封存課程商品',
    confirmText: '確定封存',
  })
  if (!confirmed) return
  try {
    await axios.delete(
      `${API}/admin/courses/products/${product.id}`,
      courseMutationConfig(product, 'course-product-archive')
    )
    productChoices.value = []
    await Promise.all([loadList('products', { force: true }), loadOverview()])
    showMessage('課程商品已封存。')
  } catch (error) {
    if (!await reloadCourseMutationConflict(error, 'products', {
      message: '課程商品版本已更新，清單已重新載入，請確認後再封存。',
    })) showMessage(error?.response?.data?.message || '封存失敗', 'error')
  }
}
function ownerChanged(product) { return String(product?._ownerDraft || '') !== ownerId(product) }
async function reassignProductOwner(product) {
  if (!isAdmin.value || !ownerChanged(product)) return
  const target = product._ownerDraft || null
  const label = target ? (providerOptions.value.find(item => item.id === target)?.label || target) : '平台'
  const confirmed = await showConfirm(`確定將「${product.name}」移轉至${label}？相關場次與歷史管理權會一併移轉。`, {
    title: '移轉課程歸屬',
    confirmText: '確定移轉',
  })
  if (!confirmed) {
    product._ownerDraft = ownerId(product)
    return
  }
  busyId.value = `owner-${product.id}`
  try {
    await axios.patch(
      `${API}/admin/courses/products/${product.id}/owner`,
      { ownerUserId: target },
      courseMutationConfig(product, 'course-product-owner')
    )
    productChoices.value = []
    await Promise.all([loadList('products', { force: true }), loadOverview(), loadProductChoices(true)])
    showMessage('課程歸屬已移轉。')
  } catch (error) {
    product._ownerDraft = ownerId(product)
    if (!await reloadCourseMutationConflict(error, 'products', {
      message: '課程商品版本已更新，清單已重新載入，請重新確認歸屬。',
    })) showMessage(error?.response?.data?.message || '課程歸屬移轉失敗', 'error')
  } finally { busyId.value = '' }
}

async function openSessionForm(session = null) {
  await loadProductChoices()
  editingId.value = session?.id || null
  sessionForm.value = session ? {
    ...emptySessionForm(),
    ...session,
    ownerUserId: ownerId(session),
    productId: session.productId == null ? '' : String(session.productId),
    coachProfileId: String(session.coachProfileId ?? session.coach_profile_id ?? ''),
    startsAt: toLocalDateTime(session.startsAt),
    endsAt: toLocalDateTime(session.endsAt),
    bookingOpenAt: toLocalDateTime(session.bookingOpenAt),
    bookingCloseAt: toLocalDateTime(session.bookingCloseAt),
  } : {
    ...emptySessionForm(),
    ownerUserId: defaultCourseOwnerUserId.value,
  }
  await syncSessionOwnerFromProduct()
  dialogType.value = 'session'
  dialogOpen.value = true
}
async function syncSessionOwnerFromProduct() {
  if (sessionForm.value.productId) {
    const product = activeProducts.value.find(item => String(item.id) === String(sessionForm.value.productId))
    if (product) sessionForm.value.ownerUserId = ownerId(product)
  }
  await loadCoachProfileChoices(sessionForm.value.ownerUserId)
}
async function saveSession() {
  submitting.value = true
  const { rowVersion, ...sessionValues } = sessionForm.value
  const payload = {
    ...sessionValues,
    productId: sessionForm.value.productId || null,
    coachProfileId: sessionForm.value.coachProfileId ? Number(sessionForm.value.coachProfileId) : null,
    ownerUserId: sessionForm.value.ownerUserId || null,
  }
  try {
    if (editingId.value) {
      await axios.patch(
        `${API}/admin/courses/sessions/${editingId.value}`,
        payload,
        courseMutationConfig({ rowVersion }, 'course-session-update')
      )
    } else {
      await axios.post(
        `${API}/admin/courses/sessions`,
        payload,
        courseMutationConfig({}, 'course-session-create')
      )
    }
    closeDialog()
    await Promise.all([loadList('sessions', { force: true }), loadOverview()])
    showMessage('課程場次已儲存。')
  } catch (error) {
    if (!await reloadCourseMutationConflict(error, 'sessions', {
      closeEditor: true,
      message: '課程場次版本已更新，清單已重新載入，請重新開啟後再儲存。',
    })) showMessage(error?.response?.data?.message || '課程場次儲存失敗', 'error')
  } finally {
    submitting.value = false
  }
}
async function cancelSession(session) {
  const confirmed = await showConfirm(`確定取消「${session.title}」？`, {
    title: '取消課程場次',
    confirmText: '確定取消',
  })
  if (!confirmed) return
  try {
    await axios.delete(
      `${API}/admin/courses/sessions/${session.id}`,
      courseMutationConfig(session, 'course-session-cancel')
    )
    await Promise.all([loadList('sessions', { force: true }), loadOverview()])
    showMessage('課程場次已取消。')
  } catch (error) {
    if (!await reloadCourseMutationConflict(error, 'sessions', {
      message: '課程場次版本已更新，清單已重新載入，請確認後再取消。',
    })) showMessage(error?.response?.data?.message || '場次取消失敗', 'error')
  }
}

function isOrderSelected(order) { return selectedOrderSet.value.has(String(order?.id)) }
function toggleOrder(order, checked) { if (!bulkOrderMutationEnabled.value) return; const selected = new Set(selectedOrderIds.value.map(String)); if (checked) selected.add(String(order.id)); else selected.delete(String(order.id)); selectedOrderIds.value = [...selected] }
function toggleAllVisibleOrders(checked) { if (!bulkOrderMutationEnabled.value) return; selectedOrderIds.value = checked ? orders.value.map(item => String(item.id)) : [] }
function clearOrderSelection() { selectedOrderIds.value = []; bulkOrderStatus.value = ''; bulkOrderIdempotencyKey.value = ''; bulkOrderAttemptBody.value = null }
function availableOrderActions(order = {}) {
  return bulkOrderActionOptions.filter(action => hasOrderCapability(order, action.capability))
}
function primaryOrderAction(order = {}) {
  const actions = availableOrderActions(order)
  return ['retry-fulfillment', 'confirm-payment', 'mark-reviewing']
    .map(value => actions.find(action => action.value === value))
    .find(Boolean) || null
}
async function orderActionReason(action, count = 1) {
  if (!['cancel', 'refund', 'retry-fulfillment'].includes(action)) return ''
  const label = action === 'refund' ? '退款與作廢' : (action === 'retry-fulfillment' ? '重試發券' : '取消')
  return showPrompt(`請填寫${label}${count > 1 ? ` ${count} 筆訂單` : '訂單'}的原因（會寫入稽核紀錄）`, {
    title: `${label}原因`,
    placeholder: '請輸入可稽核的具體原因',
    confirmText: '繼續',
  }).catch(() => null)
}
async function orderRefundReference(action) {
  if (action !== 'refund') return ''
  return showPrompt('請填寫退款參考資訊（例如匯款日期、帳務編號或退款方式）', {
    title: '退款參考資訊',
    placeholder: '例如：2026/08/19、匯款退款',
    confirmText: '繼續',
  }).catch(() => null)
}
async function bulkUpdateOrders() {
  if (!selectedOrderIds.value.length || !bulkOrderStatus.value) return
  const selected = orders.value.filter(order => selectedOrderSet.value.has(String(order.id)))
  const action = bulkOrderActionOptions.find(option => option.value === bulkOrderStatus.value)
  if (!action) return
  const unsupported = selected.filter(order => !hasOrderCapability(order, action.capability))
  if (unsupported.length) {
    showMessage(`${unsupported.length} 筆訂單目前不可執行「${action.label}」，請重新整理後再選取。`, 'error')
    return
  }
  const reason = bulkOrderAttemptBody.value?.reason ?? await orderActionReason(action.value, selected.length)
  if (reason === null || (['cancel', 'refund', 'retry-fulfillment'].includes(action.value) && !reason)) return
  const refundReference = bulkOrderAttemptBody.value?.refundReference ?? await orderRefundReference(action.value)
  if (refundReference === null || (action.value === 'refund' && !refundReference)) return
  const confirmed = await showConfirm(`確定對 ${selected.length} 筆訂單執行「${action.label}」？每筆訂單會獨立驗證版本。`, {
    title: '確認批次訂單操作',
    confirmText: '確定執行',
  })
  if (!confirmed) return
  bulkSaving.value = true
  if (!bulkOrderIdempotencyKey.value) {
    bulkOrderIdempotencyKey.value = createOrderMutationKey('course-order-bulk')
    bulkOrderAttemptBody.value = { ...(reason ? { reason } : {}), ...(refundReference ? { refundReference } : {}) }
  }
  try {
    const { data } = await axios.post(`${API}/admin/courses/orders/bulk-actions`, {
      action: action.value,
      orders: selected.map(order => ({ id: order.id, rowVersion: order.rowVersion })),
      ...(bulkOrderAttemptBody.value || {}),
    }, { headers: { 'Idempotency-Key': bulkOrderIdempotencyKey.value } })
    if (!data?.ok) throw new Error(data?.message || '批次訂單操作失敗')
    const results = Array.isArray(data?.data?.items)
      ? data.data.items
      : (Array.isArray(data?.data?.orders) ? data.data.orders : [])
    const succeeded = Number(data?.data?.summary?.succeeded ?? results.filter(item => item?.ok).length)
    const failures = results.filter(item => !item?.ok)
    bulkOrderIdempotencyKey.value = ''
    bulkOrderAttemptBody.value = null
    await Promise.all([loadList('orders', { force: true }), loadOverview()])
    if (failures.length) {
      selectedOrderIds.value = failures.map(item => String(item.id)).filter(Boolean)
      bulkOrderStatus.value = action.value
      const detail = failures.slice(0, 3).map(item => `#${item.id || '—'}：${item?.error?.message || '操作失敗'}`).join('；')
      showMessage(`「${action.label}」成功 ${succeeded} 筆、失敗 ${failures.length} 筆。${detail}`, 'error')
    } else {
      clearOrderSelection()
      showMessage(`已完成 ${succeeded || selected.length} 筆課程訂單的「${action.label}」。`)
    }
  } catch (error) {
    const retainKey = shouldRetainIdempotencyKey(error)
    if (!retainKey) {
      bulkOrderIdempotencyKey.value = ''
      bulkOrderAttemptBody.value = null
    }
    if (retainKey) showMessage(error?.response?.data?.message || '批次操作結果尚未確認，請使用相同操作重試。', 'error')
    else if (!await reloadCourseMutationConflict(error, 'orders', {
      message: '部分訂單版本已更新，清單已重新載入，請重新選取後執行。',
    })) showMessage(error?.response?.data?.message || '批次訂單操作失敗', 'error')
  } finally { bulkSaving.value = false }
}
async function runOrderAction(order, actionValue) {
  const action = bulkOrderActionOptions.find(option => option.value === actionValue)
  if (!order || !action || !hasOrderCapability(order, action.capability)) return
  const key = `${action.value}:${order.id}`
  let attempt = orderActionKeys.get(key)
  if (!attempt) {
    const reason = await orderActionReason(action.value)
    if (reason === null || (['cancel', 'refund', 'retry-fulfillment'].includes(action.value) && !reason)) return
    const refundReference = await orderRefundReference(action.value)
    if (refundReference === null || (action.value === 'refund' && !refundReference)) return
    attempt = {
      idempotencyKey: createOrderMutationKey(`course-order-${action.value}`),
      body: { ...(reason ? { reason } : {}), ...(refundReference ? { refundReference } : {}) },
    }
    orderActionKeys.set(key, attempt)
  }
  const confirmation = action.value === 'confirm-payment'
    ? `確認訂單 ${order.code} 已付款？系統會在同一交易建立全部票券，任何一張失敗都不會留下已付款狀態。`
    : `確定對訂單 ${order.code} 執行「${action.label}」？`
  const confirmed = await showConfirm(confirmation, {
    title: `確認${action.label}`,
    confirmText: '確定執行',
  })
  if (!confirmed) return
  busyId.value = `order-${order.id}`
  detailSaving.value = true
  try {
    await axios.post(`${API}/admin/courses/orders/${order.id}/actions/${action.value}`, attempt.body, {
      headers: orderMutationHeaders(order, attempt.idempotencyKey),
    })
    orderActionKeys.delete(key)
    detailOpen.value = false
    await Promise.all([loadList('orders', { force: true }), loadOverview()])
    showMessage(`訂單 ${order.code} 已完成「${action.label}」。`)
  } catch (error) {
    const retainKey = shouldRetainIdempotencyKey(error)
    if (!retainKey) orderActionKeys.delete(key)
    if (retainKey) showMessage(error?.response?.data?.message || '操作結果尚未確認，請使用相同操作重試。', 'error')
    else if (!await reloadCourseMutationConflict(error, 'orders', {
      closeDetails: true,
      message: '課程訂單版本已更新，清單已重新載入，請重新確認後再操作。',
    })) showMessage(error?.response?.data?.message || '課程訂單操作失敗', 'error')
  } finally { busyId.value = ''; detailSaving.value = false }
}
async function openOrderDetail(order) {
  const requestId = ++detailRequestSequence
  detailType.value = 'order'
  detailRecord.value = normalizeListItem('orders', order)
  detailOpen.value = true
  detailLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/courses/orders/${order.id}`)
    if (requestId === detailRequestSequence) {
      detailRecord.value = normalizeListItem('orders', { ...order, ...(data?.data || {}) })
    }
  } catch (error) {
    if (requestId === detailRequestSequence) showMessage(error?.response?.data?.message || '訂單詳情載入失敗', 'error')
  } finally {
    if (requestId === detailRequestSequence) detailLoading.value = false
  }
}

async function openTicketForm() { await loadProductChoices(); ticketForm.value = { ownerEmail: '', productId: activeProducts.value[0]?.id ? String(activeProducts.value[0].id) : '', countsTowardReturningEligibility: '', reason: '' }; dialogType.value = 'ticket'; editingId.value = null; dialogOpen.value = true }
async function issueManualTicket() {
  if (!['yes', 'no'].includes(ticketForm.value.countsTowardReturningEligibility) || !ticketForm.value.reason.trim()) {
    showMessage('請明確選擇是否計入舊生資格，並填寫手動發券理由。', 'error')
    return
  }
  submitting.value = true
  const product = activeProducts.value.find(item => String(item.id) === String(ticketForm.value.productId))
  try {
    const { countsTowardReturningEligibility, ...ticketPayload } = ticketForm.value
    const { data } = await axios.post(
      `${API}/admin/courses/tickets`,
      { ...ticketPayload, productId: Number(ticketForm.value.productId), countsTowardReturningEligibility: countsTowardReturningEligibility === 'yes' },
      courseMutationConfig(product || {}, 'course-ticket-manual-issue')
    )
    closeDialog()
    await Promise.all([loadList('tickets', { force: true }), loadOverview()])
    showMessage(`票券 ${data?.data?.code || ''} 已發行。`)
  } catch (error) {
    if (isCourseMutationPreconditionFailure(error)) {
      closeDialog()
      productChoices.value = []
      await Promise.allSettled([
        loadList('tickets', { force: true }),
        loadProductChoices(true),
        loadOverview(),
      ])
      showMessage('銷售方案版本已更新，資料已重新載入，請重新開啟後再發券。', 'error')
    } else showMessage(error?.response?.data?.message || '手動發券失敗', 'error')
  } finally { submitting.value = false }
}
async function openTicketDetail(ticket) { detailRequestSequence += 1; activityRequestSequence += 1; detailLoading.value = false; activityLoading.value = false; detailType.value = 'ticket'; detailRecord.value = normalizeCourseTicket(ticket); Object.assign(ticketAdjustment, { delta: 0, reason: '' }); detailOpen.value = true; ticketActivity.value = []; activityCursor.value = ''; activityHasMore.value = false; await loadTicketActivity(true) }
async function loadTicketActivity(reset = false) { if (!detailRecord.value?.id || activityLoading.value) return; const requestId = ++activityRequestSequence; const ticketId = detailRecord.value.id; if (reset) { ticketActivity.value = []; activityCursor.value = '' } activityLoading.value = true; try { const { data } = await axios.get(`${API}/admin/courses/tickets/${ticketId}/activity`, { params: { limit: 20, ...(activityCursor.value ? { cursor: activityCursor.value } : {}) } }); if (requestId !== activityRequestSequence || String(detailRecord.value?.id) !== String(ticketId)) return; const payload = data?.data || []; const items = Array.isArray(payload) ? payload : (payload.items || []); ticketActivity.value = reset ? items : [...ticketActivity.value, ...items]; const responseMeta = Array.isArray(payload) ? {} : (payload.meta || {}); activityCursor.value = responseMeta.nextCursor || payload.nextCursor || ''; activityHasMore.value = responseMeta.hasMore != null ? Boolean(responseMeta.hasMore) : Boolean(activityCursor.value) } catch (error) { if (requestId === activityRequestSequence) showMessage(error?.response?.data?.message || '票券活動紀錄載入失敗', 'error') } finally { if (requestId === activityRequestSequence) activityLoading.value = false } }
function courseMutationConfig(record, prefix) { return { headers: buildCourseMutationHeaders(record, { idempotencyKey: createCourseIdempotencyKey(prefix) }) } }
function isCourseMutationPreconditionFailure(error) {
  return isCourseVersionConflict(error) || Number(error?.response?.status || 0) === 428
}
async function reloadCourseMutationConflict(error, key, options = {}) {
  if (!isCourseMutationPreconditionFailure(error)) return false
  if (options.closeEditor) closeDialog()
  if (options.closeDetails) detailOpen.value = false
  if (key === 'products') productChoices.value = []
  if (key === 'orders') clearOrderSelection()
  const tasks = [
    loadList(key, { force: true }),
    loadOverview(),
  ]
  if (key === 'products') tasks.push(loadProductChoices(true))
  await Promise.allSettled(tasks)
  const status = Number(error?.response?.status || 0)
  const code = String(error?.response?.data?.code || error?.response?.data?.error?.code || '').toUpperCase()
  const isVersionFailure = status === 428 || code.includes('ROW_VERSION') || code.includes('VERSION_CONFLICT')
  const serverMessage = error?.response?.data?.message || error?.message || '操作條件已變更'
  showMessage(
    isVersionFailure
      ? (options.message || '資料版本已更新，清單已重新載入，請確認後再操作。')
      : `${serverMessage}；清單已重新載入。`,
    'error'
  )
  return true
}
async function saveTicketAdjustment() {
  if (!detailRecord.value || !Number(ticketAdjustment.delta) || !ticketAdjustment.reason) return
  detailSaving.value = true
  try {
    await axios.post(
      `${API}/admin/courses/tickets/${detailRecord.value.id}/adjustments`,
      buildCourseTicketAdjustmentPayload(ticketAdjustment.delta, ticketAdjustment.reason),
      courseMutationConfig(detailRecord.value, 'ticket-adjustment')
    )
    detailOpen.value = false
    await Promise.all([loadList('tickets', { force: true }), loadOverview()])
    showMessage(`票券 ${detailRecord.value.code} 已新增不可變調整事件。`)
  } catch (error) {
    if (isCourseVersionConflict(error) || Number(error?.response?.status || 0) === 428) {
      detailOpen.value = false
      await loadList('tickets', { force: true })
      showMessage('票券餘額版本已更新，請重新開啟後再調整。', 'error')
    } else showMessage(error?.response?.data?.message || '票券調整失敗', 'error')
  } finally { detailSaving.value = false }
}

async function openBookingDetail(booking) { const requestId = ++detailRequestSequence; detailType.value = 'booking'; detailRecord.value = normalizeListItem('bookings', booking); detailOpen.value = true; detailLoading.value = true; try { const { data } = await axios.get(`${API}/admin/courses/bookings/${booking.id}`); if (requestId === detailRequestSequence) detailRecord.value = normalizeListItem('bookings', { ...booking, ...(data?.data || {}) }) } catch (error) { if (requestId === detailRequestSequence) showMessage(error?.response?.data?.message || '預約詳情載入失敗', 'error') } finally { if (requestId === detailRequestSequence) detailLoading.value = false } }
async function runBookingAction(booking, action) {
  const definition = courseActionDefinition(action)
  if (!booking?.id || !definition) return
  const note = action === 'undo'
    ? await showPrompt('請填寫管理沖正原因（會寫入稽核紀錄）', {
        title: '管理沖正',
        placeholder: '請輸入具體原因',
        confirmText: '確認沖正',
      }).catch(() => null)
    : ''
  if (action === 'undo' && !String(note || '').trim()) return
  bookingActionBusy.value = action
  detailSaving.value = true
  try {
    await axios.post(`${API}/admin/courses/bookings/${booking.id}/${definition.endpoint}`, { note: String(note || '').trim() }, courseMutationConfig(booking, `booking-${definition.endpoint}`))
    detailOpen.value = false
    await Promise.all([loadList('bookings', { force: true }), loadOverview()])
    showMessage(`${definition.label}已完成。`)
  } catch (error) {
    if (isCourseVersionConflict(error) || Number(error?.response?.status || 0) === 428) {
      detailOpen.value = false
      await loadList('bookings', { force: true })
      showMessage('預約、hold 或票券餘額已更新，請重新開啟後再操作。', 'error')
    } else showMessage(error?.response?.data?.message || `${definition.label}失敗`, 'error')
  } finally { bookingActionBusy.value = ''; detailSaving.value = false }
}

async function resetForIdentityChange() {
  detailRequestSequence += 1
  activityRequestSequence += 1
  providerRequestSequence += 1
  productChoicesRequestSequence += 1
  coachProfileChoicesRequestSequence += 1
  detailLoading.value = false
  activityLoading.value = false
  for (const key of listKeys) { requestSequences[key] = (requestSequences[key] || 0) + 1; requestControllers[key]?.abort(); clearTimeout(searchTimers[key]); listRefs[key].value = []; filters[key] = {}; suppressedSearch.add(key); listState[key].q = ''; suppressedSearch.delete(key); meta[key] = { total: 0, limit: 50, offset: 0, hasMore: false }; summaries[key] = { total: null, byStatus: {} }; errors[key] = '' }
  productChoices.value = []
  coachProfileChoices.value = []
  providers.value = []
  detailOpen.value = false
  closeDialog()
  clearOrderSelection()
  if (focusedMode.value || canUseLegacyCourseManager.value) await loadProviders()
  if (focusedMode.value) {
    await loadTab(props.mode)
  } else {
    activeTab.value = tabs.value[0]?.key || ''
    if (activeTab.value === 'overview') await Promise.all([loadOverview(), loadList('products', { force: true })])
    else await loadTab(activeTab.value)
  }
}
watch(() => `${props.currentUserId}:${role.value}:${props.mode}`, (next, previous) => { if (!props.productizedTask && previous != null && next !== previous) resetForIdentityChange() })
watch(() => props.courseV2Enabled, enabled => { if (enabled) clearOrderSelection() })
watch(() => props.productizedTask, async (next, previous) => {
  if (!next || next === previous) return
  productizedItems.value = []
  productizedError.value = ''
  productizedActionNotice.value = ''
  productizedEditorOpen.value = false
  productizedMakeupBookings.value = []
  Object.keys(productizedMakeupReasons).forEach(key => delete productizedMakeupReasons[key])
  productizedWaitlist.value = []
  productizedWaitlistTermId.value = ''
  Object.keys(productizedReadiness).forEach(key => delete productizedReadiness[key])
  if (!coachSurface.value && !productizedOwnerUserId.value) await hydrateProductizedAdminContext()
  await loadProductizedAdminData()
})
onMounted(async () => {
  if (props.productizedTask) {
    await hydrateProductizedAdminContext()
    if (coachSurface.value || productizedOwnerUserId.value) await loadProductizedAdminData()
    return
  }
  if (focusedMode.value || canUseLegacyCourseManager.value) await loadProviders()
  if (focusedMode.value) {
    await loadTab(props.mode)
    return
  }
  activeTab.value = tabs.value[0]?.key || ''
  if (activeTab.value === 'overview') await Promise.all([loadOverview(), loadList('products', { force: true })])
  else await loadTab(activeTab.value)
})
onBeforeUnmount(() => { overviewRequestSequence += 1; detailRequestSequence += 1; activityRequestSequence += 1; providerRequestSequence += 1; productChoicesRequestSequence += 1; coachProfileChoicesRequestSequence += 1; for (const key of listKeys) { requestSequences[key] = (requestSequences[key] || 0) + 1; requestControllers[key]?.abort(); clearTimeout(searchTimers[key]) } resetCourseCoverState() })
</script>
