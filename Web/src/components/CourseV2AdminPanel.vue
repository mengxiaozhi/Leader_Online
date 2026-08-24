<template>
  <section class="space-y-5">
    <section v-if="showTenantSelector" class="surface-section flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <label class="block flex-1 space-y-1 text-sm text-slate-600">
        課程服務商範圍
        <select
          v-if="!isAdmin"
          v-model="tenantOwnerDraft"
          class="w-full"
          :disabled="saving"
          @change="applyTenantScope"
        >
          <option v-for="option in tenantOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
        </select>
        <input
          v-else
          v-model.trim="tenantOwnerDraft"
          list="course-v2-tenant-options"
          class="w-full"
          :disabled="saving"
          placeholder="留空為平台課程，或輸入服務商 User ID"
          @keyup.enter.prevent="applyTenantScope"
        />
        <datalist v-if="isAdmin" id="course-v2-tenant-options">
          <option v-for="option in tenantOptions.filter(item => item.id)" :key="option.id" :value="option.id">{{ option.label }}</option>
        </datalist>
      </label>
      <div class="flex items-center gap-2">
        <span class="text-sm text-slate-500">{{ selectedTenantLabel }}</span>
        <button
          v-if="isAdmin"
          type="button"
          class="btn btn-outline btn-sm"
          :disabled="saving || tenantOwnerDraft === selectedOwnerUserId"
          @click="applyTenantScope"
        >
          套用範圍
        </button>
        <button
          v-if="isAdmin && selectedOwnerUserId"
          type="button"
          class="btn btn-outline btn-sm"
          :disabled="saving"
          @click="selectPlatformTenant"
        >
          切回平台
        </button>
      </div>
    </section>

    <div v-if="tabs.length > 1" class="overflow-x-auto">
      <div class="flex min-w-max gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" role="tablist" aria-label="計次課程管理">
        <button
          v-for="(item, index) in tabs"
          :key="item.key"
          :id="`course-v2-tab-${item.key}`"
          type="button"
          role="tab"
          class="interactive-press min-h-[44px] rounded-md px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 motion-reduce:transition-none"
          :class="activeTab === item.key ? 'bg-white text-primary shadow-sm' : 'text-slate-600'"
          :aria-selected="activeTab === item.key"
          :aria-controls="`course-v2-panel-${item.key}`"
          :tabindex="activeTab === item.key ? 0 : -1"
          @click="selectTab(item.key)"
          @keydown="onTabKeydown($event, index)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <p
      v-if="message"
      class="rounded-lg border px-4 py-3 text-sm"
      :class="messageTone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'"
      :role="messageTone === 'error' ? 'alert' : 'status'"
    >
      {{ message }}
    </p>

    <div
      v-if="activeTab"
      :id="`course-v2-panel-${activeTab}`"
      role="tabpanel"
      :aria-labelledby="tabs.length > 1 ? `course-v2-tab-${activeTab}` : undefined"
      tabindex="-1"
    >
    <section v-if="activeTab === 'ticket-products'" class="space-y-4">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div><h2 class="ui-title text-xl text-slate-950">計次票產品</h2><p class="mt-1 text-sm text-slate-600">定義發券規則；商城銷售方案引用此產品，修改不會回寫已發行票券快照。<span class="ml-1 font-mono text-xs text-slate-400">TicketProduct</span></p></div>
        <button type="button" class="btn btn-primary text-white" @click="startTicketProduct()"><AppIcon name="plus" class="h-4 w-4" /> 新增票種</button>
      </header>
      <AppOverlayPanel
        v-model="ticketProductFormOpen"
        placement="right"
        size="xl"
        :title="ticketProductForm.id ? '編輯計次票產品' : '新增計次票產品'"
        description="設定票券效期、權益、轉讓、暫停與核銷限制。"
        :closable="!saving"
        :close-on-backdrop="!saving"
        :close-on-escape="!saving"
        :drag-to-close="!saving"
        @after-open="focusEditorStart"
      >
        <form id="course-ticket-product-editor" class="space-y-6" @submit.prevent="saveTicketProduct">
          <p v-if="editorError" ref="editorErrorRef" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert" tabindex="-1">{{ editorError }}</p>
          <fieldset class="space-y-4">
            <legend class="font-medium text-slate-950">基本資料</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="space-y-1 text-sm text-slate-600">票種名稱<input v-model.trim="ticketProductForm.name" required class="w-full" data-overlay-initial-focus /></label>
              <label class="space-y-1 text-sm text-slate-600">代碼<input v-model.trim="ticketProductForm.code" required class="w-full font-mono" /></label>
              <label class="space-y-1 text-sm text-slate-600">權益模式<select v-model="ticketProductForm.usageMode" class="w-full"><option value="finite">有限堂數</option><option value="unlimited">無限次</option></select></label>
              <label class="space-y-1 text-sm text-slate-600">發行堂數<input v-model.number="ticketProductForm.classCount" required type="number" min="1" class="w-full" :disabled="ticketProductForm.usageMode === 'unlimited'" /></label>
              <label class="space-y-1 text-sm text-slate-600">狀態<select v-model="ticketProductForm.status" class="w-full"><option value="active">啟用</option><option value="draft">草稿</option><option value="archived">封存</option></select></label>
            </div>
          </fieldset>
          <fieldset class="space-y-4 border-t border-slate-200 pt-5">
            <legend class="font-medium text-slate-950">效期與使用政策</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="space-y-1 text-sm text-slate-600">開卡期限（天）<input v-model.number="ticketProductForm.activationDays" required type="number" min="0" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">開卡後效期（天）<input v-model.number="ticketProductForm.validDays" required type="number" min="1" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">每票暫停次數<input v-model.number="ticketProductForm.pauseMaxOperations" type="number" min="0" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">單次暫停上限（天）<input v-model.number="ticketProductForm.pauseMaxDays" type="number" min="1" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">轉讓操作上限<input v-model.number="ticketProductForm.maxTransferOperations" type="number" min="0" class="w-full" :disabled="ticketProductForm.usageMode === 'unlimited'" /><span class="text-xs text-slate-500">0 代表效期內不限次；無限次票不開放自助轉讓。</span></label>
              <label class="flex min-h-11 items-center gap-2 self-end text-sm text-slate-700"><input v-model="ticketProductForm.transferable" type="checkbox" />允許轉讓</label>
            </div>
          </fieldset>
          <fieldset class="space-y-4 border-t border-slate-200 pt-5">
            <legend class="font-medium text-slate-950">核銷與條款</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="space-y-1 text-sm text-slate-600">開始前幾分鐘開放<input v-model.number="ticketProductForm.redeemOpenMinutesBefore" type="number" min="0" class="w-full" placeholder="留空不限制" /></label>
              <label class="space-y-1 text-sm text-slate-600">結束後幾分鐘截止<input v-model.number="ticketProductForm.redeemCloseMinutesAfter" type="number" min="0" class="w-full" placeholder="留空不限制" /></label>
            </div>
            <label class="block space-y-1 text-sm text-slate-600">票券條款快照<textarea v-model.trim="ticketProductForm.termsText" rows="4" class="w-full"></textarea></label>
          </fieldset>
        </form>
        <template #actions>
          <button type="button" class="btn btn-outline" :disabled="saving" @click="ticketProductFormOpen = false">取消</button>
          <button type="submit" form="course-ticket-product-editor" class="btn btn-primary text-white" :disabled="saving">{{ saving ? '儲存中…' : '儲存票種' }}</button>
        </template>
      </AppOverlayPanel>
      <CourseResourceState :loading="loading.ticketProducts" :error="errors.ticketProducts" :empty="!ticketProducts.length" :has-content="ticketProducts.length > 0" empty-text="尚無計次票產品。" @retry="loadTicketProducts">
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <article v-for="product in ticketProducts" :key="product.id" class="ticket-card space-y-3 p-4">
            <header class="flex items-start justify-between gap-3"><div><h3 class="font-medium text-slate-950">{{ product.name }}</h3><p class="font-mono text-xs text-slate-500">{{ product.code }}</p></div><span class="ops-chip">{{ product.status }}</span></header>
            <dl class="grid grid-cols-2 gap-2 text-sm"><div><dt class="text-slate-500">堂數</dt><dd>{{ product.usageMode === 'unlimited' ? '不限次' : `${product.classCount} 堂` }}</dd></div><div><dt class="text-slate-500">效期</dt><dd>{{ product.validDays }} 天</dd></div><div><dt class="text-slate-500">開卡</dt><dd>{{ product.activationDays }} 天內</dd></div><div><dt class="text-slate-500">轉讓</dt><dd>{{ product.transferable && product.usageMode !== 'unlimited' ? (product.maxTransferOperations === 0 ? '不限操作次數' : `最多 ${product.maxTransferOperations ?? 1} 次`) : '不可' }}</dd></div><div><dt class="text-slate-500">核銷開放</dt><dd>{{ product.redeemOpenMinutesBefore === '' || product.redeemOpenMinutesBefore == null ? '不限制' : `開始前 ${product.redeemOpenMinutesBefore} 分` }}</dd></div><div><dt class="text-slate-500">核銷截止</dt><dd>{{ product.redeemCloseMinutesAfter === '' || product.redeemCloseMinutesAfter == null ? '不限制' : `結束後 ${product.redeemCloseMinutesAfter} 分` }}</dd></div></dl>
            <button type="button" class="btn btn-outline btn-sm w-full" @click="startTicketProduct(product)">編輯票種</button>
          </article>
        </div>
      </CourseResourceState>
    </section>

    <section v-else-if="activeTab === 'scenarios'" class="space-y-4">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div><h2 class="ui-title text-xl text-slate-950">核銷情境</h2><p class="mt-1 text-sm text-slate-600">場次引用情境；票種依明確優先序自動選擇，不再綁單一商城商品。<span class="ml-1 font-mono text-xs text-slate-400">RedeemScenario</span></p></div>
        <button type="button" class="btn btn-primary text-white" @click="startScenario()"><AppIcon name="plus" class="h-4 w-4" /> 新增情境</button>
      </header>
      <AppOverlayPanel
        v-model="scenarioFormOpen"
        placement="right"
        size="xl"
        :title="scenarioForm.id ? '編輯核銷情境' : '新增核銷情境'"
        description="定義使用場景、扣除堂數、允許票種與優先順序。"
        :closable="!saving"
        :close-on-backdrop="!saving"
        :close-on-escape="!saving"
        :drag-to-close="!saving"
        @after-open="focusEditorStart"
      >
        <form id="course-scenario-editor" class="space-y-6" @submit.prevent="saveScenario">
          <p v-if="editorError" ref="editorErrorRef" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert" tabindex="-1">{{ editorError }}</p>
          <fieldset class="space-y-4">
            <legend class="font-medium text-slate-950">基本資料</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="space-y-1 text-sm text-slate-600">名稱<input v-model.trim="scenarioForm.name" required class="w-full" data-overlay-initial-focus /></label>
              <label class="space-y-1 text-sm text-slate-600">代碼<input v-model.trim="scenarioForm.code" required class="w-full font-mono" /></label>
              <label class="space-y-1 text-sm text-slate-600">情境類型<select v-model="scenarioForm.itemType" class="w-full"><option value="class">課程</option><option value="term">期課付款／資格</option><option value="event">活動</option><option value="merchant">店家</option><option value="service">服務</option><option value="other">其他</option></select></label>
              <label class="space-y-1 text-sm text-slate-600">狀態<select v-model="scenarioForm.status" class="w-full"><option value="active">啟用</option><option value="draft">草稿</option><option value="archived">封存</option></select></label>
            </div>
            <label class="block space-y-1 text-sm text-slate-600">說明<textarea v-model.trim="scenarioForm.description" rows="3" class="w-full"></textarea></label>
          </fieldset>
          <fieldset class="space-y-4 border-t border-slate-200 pt-5">
            <legend class="font-medium text-slate-950">扣堂與時間窗</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="space-y-1 text-sm text-slate-600">每次扣除堂數<input v-model.number="scenarioForm.redeemQuantity" type="number" min="1" class="w-full" /></label>
              <label class="flex min-h-11 items-center gap-2 self-end text-sm text-slate-700"><input v-model="scenarioForm.sessionBound" type="checkbox" />需綁定場次</label>
              <label class="space-y-1 text-sm text-slate-600">開始前幾分鐘開放<input v-model.number="scenarioForm.redeemOpenMinutesBefore" type="number" min="0" class="w-full" placeholder="留空不限制" /></label>
              <label class="space-y-1 text-sm text-slate-600">結束後幾分鐘截止<input v-model.number="scenarioForm.redeemCloseMinutesAfter" type="number" min="0" class="w-full" placeholder="留空不限制" /></label>
            </div>
            <p class="text-xs leading-5 text-slate-500">期課付款／資格只表示計次券可作付款或資格，不承載固定班逐堂出席。</p>
          </fieldset>
          <fieldset class="space-y-3 border-t border-slate-200 pt-5">
            <legend class="font-medium text-slate-950">允許票種與優先序</legend>
            <p class="text-xs leading-5 text-slate-500">票種限制會與情境、計次票產品及場次時間窗取交集；留空代表此層不額外限制。</p>
            <p v-if="!ticketProducts.length" class="text-sm text-amber-700">請先建立計次票產品。</p>
            <div v-for="product in ticketProducts" :key="product.id" class="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
              <label class="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-800 sm:col-span-2"><input v-model="scenarioForm.allowedProductIds" type="checkbox" :value="String(product.id)" />{{ product.name }}（{{ product.code }}）</label>
              <label class="space-y-1 text-xs text-slate-600">優先序<input v-model.number="scenarioForm.priorities[product.id]" type="number" min="1" class="w-full" :disabled="!scenarioForm.allowedProductIds.includes(String(product.id))" /></label>
              <span></span>
              <label class="space-y-1 text-xs text-slate-600">開始前分鐘<input v-model.number="scenarioForm.edgePolicies[product.id].redeemOpenMinutesBefore" type="number" min="0" class="w-full" placeholder="不限制" :disabled="!scenarioForm.allowedProductIds.includes(String(product.id))" /></label>
              <label class="space-y-1 text-xs text-slate-600">結束後分鐘<input v-model.number="scenarioForm.edgePolicies[product.id].redeemCloseMinutesAfter" type="number" min="0" class="w-full" placeholder="不限制" :disabled="!scenarioForm.allowedProductIds.includes(String(product.id))" /></label>
            </div>
          </fieldset>
        </form>
        <template #actions>
          <button type="button" class="btn btn-outline" :disabled="saving" @click="scenarioFormOpen = false">取消</button>
          <button type="submit" form="course-scenario-editor" class="btn btn-primary text-white" :disabled="saving">{{ saving ? '儲存中…' : '儲存情境' }}</button>
        </template>
      </AppOverlayPanel>
      <CourseResourceState :loading="loading.scenarios" :error="errors.scenarios" :empty="!scenarios.length" :has-content="scenarios.length > 0" empty-text="尚無核銷情境。" @retry="loadScenarios">
        <div class="grid gap-3 md:grid-cols-2">
          <article v-for="scenario in scenarios" :key="scenario.id" class="ticket-card space-y-3 p-4">
            <header class="flex items-start justify-between gap-3"><div><h3 class="font-medium text-slate-950">{{ scenario.name }}</h3><p class="font-mono text-xs text-slate-500">{{ scenario.code }}</p></div><span class="ops-chip">{{ scenario.status }}</span></header>
            <p class="text-xs text-slate-500">{{ scenario.itemType || 'class' }}・{{ scenario.sessionBound ? '綁定場次' : '不綁定場次' }}・每次 {{ scenario.redeemQuantity || 1 }} 堂</p><p class="text-xs text-slate-500">Scenario：開始前 {{ scenario.redeemOpenMinutesBefore ?? '不限' }} 分／結束後 {{ scenario.redeemCloseMinutesAfter ?? '不限' }} 分</p>
            <ol class="space-y-1 text-sm text-slate-600"><li v-for="allowed in scenario.allowedProducts || scenario.allowedTicketProducts || []" :key="allowed.id || allowed.ticketProductId || allowed.productId">{{ allowed.priority }}. {{ allowed.name || ticketProductName(allowed.ticketProductId ?? allowed.productId) }} <span class="text-xs text-slate-500">（前 {{ allowed.redeemOpenMinutesBefore ?? allowed.redeem_open_minutes_before ?? '不限' }}／後 {{ allowed.redeemCloseMinutesAfter ?? allowed.redeem_close_minutes_after ?? '不限' }} 分）</span></li></ol>
            <button type="button" class="btn btn-outline btn-sm w-full" @click="startScenario(scenario)">編輯情境</button>
          </article>
        </div>
      </CourseResourceState>
    </section>

    <section v-else-if="activeTab === 'sessions'" class="space-y-4">
      <header><h2 class="ui-title text-xl text-slate-950">場次政策</h2><p class="mt-1 text-sm text-slate-600">設定情境及場次級絕對／相對時間窗；未填欄位由服務商與平台預設解析。</p></header>
      <CourseResourceState :loading="loading.sessions" :error="errors.sessions" :empty="!sessions.length" :has-content="sessions.length > 0" empty-text="尚無場次。" @retry="loadSessions">
        <div class="grid gap-3 lg:grid-cols-2">
          <article v-for="session in sessions" :key="session.id" class="ticket-card space-y-3 p-4">
            <div><h3 class="font-medium text-slate-950">{{ session.title }}</h3><p class="text-xs text-slate-500">{{ session.code }}・{{ formatRange(session.startsAt, session.endsAt) }}</p></div>
            <p class="text-sm text-slate-600">情境：{{ session.scenarioName || scenarioName(session.scenarioId) || '沿用租戶預設' }}</p>
            <dl class="grid grid-cols-2 gap-2 text-sm"><div><dt class="text-slate-500">預約截止</dt><dd>{{ formatTimeOrMinutes(session.bookingCloseAt, session.bookingCloseMinutesBefore) }}</dd></div><div><dt class="text-slate-500">取消截止</dt><dd>{{ formatTimeOrMinutes(session.cancellationDeadline, session.cancelCloseMinutesBefore) }}</dd></div><div><dt class="text-slate-500">核銷開放</dt><dd>{{ formatTimeOrMinutes(session.redeemOpenAt, session.redeemOpenMinutesBefore) }}</dd></div><div><dt class="text-slate-500">核銷截止</dt><dd>{{ formatTimeOrMinutes(session.redeemCloseAt, session.redeemCloseMinutesAfter) }}</dd></div></dl>
            <button type="button" class="btn btn-outline btn-sm w-full" @click="startSessionPolicy(session)">設定場次政策</button>
          </article>
        </div>
      </CourseResourceState>
      <AppOverlayPanel
        v-model="sessionPolicyOpen"
        placement="right"
        size="lg"
        title="設定場次政策"
        :description="sessionPolicyForm.title || '設定核銷情境與場次時間窗。'"
        :closable="!saving"
        :close-on-backdrop="!saving"
        :close-on-escape="!saving"
        :drag-to-close="!saving"
        @after-open="focusEditorStart"
      >
        <form id="course-session-policy-editor" class="space-y-6" @submit.prevent="saveSessionPolicy">
          <p v-if="editorError" ref="editorErrorRef" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert" tabindex="-1">{{ editorError }}</p>
          <fieldset class="space-y-4">
            <legend class="font-medium text-slate-950">情境與取消</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="space-y-1 text-sm text-slate-600">核銷情境<select v-model="sessionPolicyForm.scenarioId" class="w-full" data-overlay-initial-focus><option value="">沿用租戶預設</option><option v-for="scenario in scenarios" :key="scenario.id" :value="String(scenario.id)">{{ scenario.name }}</option></select></label>
              <label class="space-y-1 text-sm text-slate-600">開始前幾分鐘停止取消<input v-model.number="sessionPolicyForm.cancelCloseMinutesBefore" type="number" min="0" class="w-full" /></label>
            </div>
          </fieldset>
          <fieldset class="space-y-4 border-t border-slate-200 pt-5">
            <legend class="font-medium text-slate-950">核銷時間窗</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="space-y-1 text-sm text-slate-600">核銷開放絕對時間<input v-model="sessionPolicyForm.redeemOpenAt" type="datetime-local" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">或開始前幾分鐘開放<input v-model.number="sessionPolicyForm.redeemOpenMinutesBefore" type="number" min="0" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">核銷截止絕對時間<input v-model="sessionPolicyForm.redeemCloseAt" type="datetime-local" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">或結束後幾分鐘截止<input v-model.number="sessionPolicyForm.redeemCloseMinutesAfter" type="number" min="0" class="w-full" /></label>
            </div>
            <p class="text-xs leading-5 text-slate-500">場次絕對時間優先，其次為相對時間，再沿用服務商與平台設定。</p>
          </fieldset>
        </form>
        <template #actions>
          <button type="button" class="btn btn-outline" :disabled="saving" @click="sessionPolicyOpen = false">取消</button>
          <button type="submit" form="course-session-policy-editor" class="btn btn-primary text-white" :disabled="saving">{{ saving ? '儲存中…' : '儲存場次政策' }}</button>
        </template>
      </AppOverlayPanel>
    </section>

    <section v-else-if="activeTab === 'attendance'" class="space-y-4">
      <header><h2 class="ui-title text-xl text-slate-950">現場課務與補登佇列</h2><p class="mt-1 text-sm text-slate-600">A–F 流程共用同一個伺服器 domain service；畫面只顯示 capability 允許的操作。</p></header>
      <label class="block max-w-xl space-y-1 text-sm text-slate-600">操作場次<select v-model="attendanceSessionId" class="w-full" @change="loadAttendance"><option value="">請選擇場次</option><option v-for="session in sessions" :key="session.id" :value="String(session.id)">{{ session.title }}・{{ formatRange(session.startsAt, session.endsAt) }}</option></select></label>
      <CourseResourceState :loading="loading.attendance" :error="errors.attendance" :empty="Boolean(attendanceSessionId) && !attendanceBookings.length" :has-content="attendanceBookings.length > 0" empty-text="此場次目前沒有預約紀錄。" @retry="loadAttendance">
        <div class="grid gap-3 lg:grid-cols-2">
          <article v-for="booking in attendanceBookings" :key="booking.id" class="ticket-card space-y-3 p-4">
            <header class="flex items-start justify-between gap-3"><div><h3 class="font-medium text-slate-950">{{ booking.attendeeName || booking.studentName || booking.attendeeEmail }}</h3><p class="text-xs text-slate-500">{{ booking.ticketCode || '未綁票券' }}</p></div><span class="ops-chip">{{ booking.status }}</span></header>
            <p class="text-sm text-slate-600">剩餘 {{ booking.remainingUses ?? '—' }}・保留 {{ booking.heldUses ?? booking.holdUnits ?? 0 }}・可用 {{ booking.availableUses ?? '—' }}</p>
            <button type="button" class="btn btn-outline w-full" @click="openAttendanceActionDrawer(booking)">打開課務操作</button>
          </article>
        </div>
      </CourseResourceState>
      <AppOverlayPanel
        v-model="attendanceActionOpen"
        placement="right"
        size="lg"
        title="計次現場課務"
        :description="attendanceActionBooking?.attendeeName || attendanceActionBooking?.studentName || attendanceActionBooking?.attendeeEmail || '確認學員與票券後再執行。'"
        :closable="!attendanceActionBusy"
        :close-on-backdrop="!attendanceActionBusy"
        :close-on-escape="!attendanceActionBusy"
        :drag-to-close="!attendanceActionBusy"
      >
        <div v-if="attendanceActionBooking" class="space-y-5">
          <dl class="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
            <div><dt class="text-slate-500">學員</dt><dd class="mt-1 font-medium text-slate-950">{{ attendanceActionBooking.attendeeName || attendanceActionBooking.studentName || '—' }}</dd></div>
            <div><dt class="text-slate-500">狀態</dt><dd class="mt-1 font-medium text-slate-950">{{ attendanceActionBooking.status || '—' }}</dd></div>
            <div><dt class="text-slate-500">票券</dt><dd class="mt-1 font-medium text-slate-950">{{ attendanceActionBooking.ticketCode || '未綁票券' }}</dd></div>
            <div><dt class="text-slate-500">剩餘／保留／可用</dt><dd class="mt-1 font-medium text-slate-950">{{ attendanceActionBooking.remainingUses ?? '—' }}／{{ attendanceActionBooking.heldUses ?? attendanceActionBooking.holdUnits ?? 0 }}／{{ attendanceActionBooking.availableUses ?? '—' }}</dd></div>
          </dl>
          <CourseAttendanceActions :booking="attendanceActionBooking" :busy="attendanceActionBusy" :busy-action="busyAction" @action="runAttendanceDrawerAction" />
        </div>
      </AppOverlayPanel>
      <div v-if="attendanceSessionId" class="grid gap-4 lg:grid-cols-2">
        <form class="surface-section space-y-3" @submit.prevent="createWalkIn">
          <h3 class="font-medium text-slate-950">窗內 walk-in</h3>
          <label class="block space-y-1 text-sm text-slate-600">學員 Email<input v-model.trim="walkInForm.email" type="email" required class="w-full" /></label>
          <label class="block space-y-1 text-sm text-slate-600">學員姓名<input v-model.trim="walkInForm.name" class="w-full" /></label>
          <label class="block space-y-1 text-sm text-slate-600">指定票券 ID（留空由伺服器自動選票）<input v-model.trim="walkInForm.ticketId" class="w-full" /></label>
          <button class="btn btn-primary w-full text-white" :disabled="saving">建立 walk-in 並核銷</button>
        </form>
        <form class="surface-section space-y-3" @submit.prevent="createAttendanceInvite">
          <h3 class="font-medium text-slate-950">窗外補登邀請</h3>
          <label class="block space-y-1 text-sm text-slate-600">學員 Email<input v-model.trim="inviteForm.email" type="email" required class="w-full" /></label>
          <label class="block space-y-1 text-sm text-slate-600">學員姓名<input v-model.trim="inviteForm.name" class="w-full" /></label>
          <p class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">邀請到期與自動核銷時間由伺服器依有效的租戶／平台政策決定，現場人員不可任意覆寫。</p>
          <button class="btn btn-outline w-full" :disabled="saving">建立登入回跳邀請</button>
        </form>
      </div>
      <section class="space-y-3">
        <div class="flex items-center justify-between"><h3 class="font-medium text-slate-950">補登邀請佇列</h3><button type="button" class="btn btn-outline btn-sm" @click="loadInvites">重新整理</button></div>
        <CourseResourceState :loading="loading.invites" :error="errors.invites" :empty="!invites.length" :has-content="invites.length > 0" empty-text="目前沒有補登邀請。" @retry="loadInvites">
          <div class="grid gap-3 lg:hidden">
            <article v-for="invite in invites" :key="`mobile-invite-${invite.id}`" class="ticket-card space-y-3 p-4">
              <header class="flex items-start justify-between gap-3"><div class="min-w-0"><h4 class="font-medium text-slate-950">{{ invite.studentName || invite.email }}</h4><p class="mt-1 text-sm text-slate-500">{{ invite.sessionTitle || invite.sessionCode }}</p></div><span class="ops-chip shrink-0">{{ invite.status }}</span></header>
              <dl class="grid gap-2 text-sm sm:grid-cols-2"><div><dt class="text-slate-500">到期時間</dt><dd class="mt-1">{{ formatDateTime(invite.expiresAt) }}</dd></div><div><dt class="text-slate-500">自動核銷</dt><dd class="mt-1">{{ invite.autoRedeemAt ? formatDateTime(invite.autoRedeemAt) : '關閉' }}</dd></div></dl>
            </article>
          </div>
          <div class="hidden overflow-x-auto lg:block"><table class="table-default min-w-[760px]"><thead><tr><th>學員</th><th>場次</th><th>狀態</th><th>到期時間</th><th>自動核銷</th></tr></thead><tbody><tr v-for="invite in invites" :key="invite.id"><td>{{ invite.studentName || invite.email }}</td><td>{{ invite.sessionTitle || invite.sessionCode }}</td><td>{{ invite.status }}</td><td>{{ formatDateTime(invite.expiresAt) }}</td><td>{{ invite.autoRedeemAt ? formatDateTime(invite.autoRedeemAt) : '關閉' }}</td></tr></tbody></table></div>
        </CourseResourceState>
      </section>
    </section>

    <section v-else-if="activeTab === 'settings'" class="space-y-4">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div><h2 class="ui-title text-xl text-slate-950">課程設定</h2><p class="mt-1 text-sm text-slate-600">先查看目前生效政策，需要調整時再開啟分區設定。</p></div>
        <button type="button" class="btn btn-primary text-white" :disabled="loading.settings" @click="startSettingsEditor">編輯設定</button>
      </header>
      <CourseResourceState :loading="loading.settings" :error="errors.settings" :empty="false" :has-content="settingsLoaded" @retry="loadSettings">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article class="surface-section"><p class="text-sm font-medium text-slate-500">預約與取消</p><p class="mt-2 text-sm leading-6 text-slate-800">開始前 {{ settings.bookingOpenMinutesBefore }} 分開放<br>開始前 {{ settings.bookingCloseMinutesBefore }} 分截止<br>開始前 {{ settings.cancelCloseMinutesBefore }} 分停止取消</p></article>
          <article class="surface-section"><p class="text-sm font-medium text-slate-500">核銷與邀請</p><p class="mt-2 text-sm leading-6 text-slate-800">開始前 {{ settings.redeemOpenMinutesBefore }} 分開放<br>結束後 {{ settings.redeemCloseMinutesAfter }} 分截止<br>邀請 {{ settings.inviteExpiresMinutes }} 分到期</p></article>
          <article class="surface-section"><p class="text-sm font-medium text-slate-500">票券與洞察</p><p class="mt-2 text-sm leading-6 text-slate-800">暫停 {{ settings.pauseMaxOperations }} 次／{{ settings.pauseMaxDays }} 天<br>推方案 ≤ {{ settings.pushPlanMaxAvailableUses }} 堂<br>到期 {{ settings.expiringTicketDays }} 天／沉睡 {{ settings.dormantStudentDays }} 天</p></article>
          <article class="surface-section"><p class="text-sm font-medium text-slate-500">功能狀態</p><p class="mt-2 text-sm leading-6 text-slate-800">計次商品化：{{ settings.countCardParityEnabled ? '開啟' : '關閉' }}<br>固定班：{{ settings.fixedTermEnabled ? '開啟' : '關閉' }}<br>匯款／保險：{{ settings.advancedPaymentsEnabled ? '開啟' : '關閉' }}</p></article>
        </div>
        <details class="surface-section">
          <summary class="cursor-pointer font-medium text-slate-950">查看技術診斷</summary>
          <div class="mt-3 space-y-2">
            <p v-if="settings.countCardParityReadOnly" class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Course V2 切換狀態為 {{ settings.v2CutoverState }}；計次 parity 保持唯讀且關閉，不會繞過 cutover。</p>
            <p v-if="!settings.fixedTermAvailable" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">尚未偵測到 migration 052，固定班租戶旗標不可編輯。</p>
            <p v-else-if="!settings.fixedTermRuntimeEnabled" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">租戶旗標可先設定，但伺服器仍需開啟 COURSE_FIXED_TERM_ENABLED 才會生效。</p>
            <p v-if="settings.fixedTermAvailable && !settings.advancedPaymentsAvailable" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">尚未偵測到 migration 053；固定班可管理，匯款、保險與通知暫停。</p>
            <p v-else-if="settings.advancedPaymentsAvailable && !settings.advancedPaymentsRuntimeEnabled" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">053 租戶旗標可先設定，但伺服器仍需開啟 COURSE_ADVANCED_PAYMENTS_ENABLED 才會生效。</p>
          </div>
        </details>
      </CourseResourceState>
      <AppOverlayPanel
        v-model="settingsFormOpen"
        placement="right"
        size="xl"
        title="編輯課程設定"
        description="依營運任務分區調整；未通過 readiness 的功能仍會保持阻擋。"
        :closable="!saving"
        :close-on-backdrop="!saving"
        :close-on-escape="!saving"
        :drag-to-close="!saving"
        @after-open="focusEditorStart"
        @close="cancelSettingsEditor"
      >
        <form id="course-settings-editor" class="space-y-6" @submit.prevent="saveSettings">
          <p v-if="editorError" ref="editorErrorRef" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert" tabindex="-1">{{ editorError }}</p>
          <fieldset class="space-y-4">
            <legend class="font-medium text-slate-950">預約與取消</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="space-y-1 text-sm text-slate-600">營運時區<select v-model="settings.timezone" class="w-full" data-overlay-initial-focus><option value="Asia/Taipei">Asia/Taipei</option></select></label>
              <label class="space-y-1 text-sm text-slate-600">預約開始前（分鐘）<input v-model.number="settings.bookingOpenMinutesBefore" type="number" min="0" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">預約截止前（分鐘）<input v-model.number="settings.bookingCloseMinutesBefore" type="number" min="0" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">取消截止前（分鐘）<input v-model.number="settings.cancelCloseMinutesBefore" type="number" min="0" class="w-full" /></label>
            </div>
          </fieldset>
          <fieldset class="space-y-4 border-t border-slate-200 pt-5">
            <legend class="font-medium text-slate-950">出席與邀請</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="space-y-1 text-sm text-slate-600">核銷開放前（分鐘）<input v-model.number="settings.redeemOpenMinutesBefore" type="number" min="0" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">核銷截止後（分鐘）<input v-model.number="settings.redeemCloseMinutesAfter" type="number" min="0" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">補登邀請有效（分鐘）<input v-model.number="settings.inviteExpiresMinutes" type="number" min="5" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">邀請到期行為<select v-model="settings.attendanceInviteExpiryAction" class="w-full"><option value="release">釋放並待人工判定</option><option value="auto_redeem">自動核銷</option></select></label>
              <label class="flex min-h-11 items-center gap-2 text-sm text-slate-700"><input v-model="settings.autoNoShow" type="checkbox" />啟用 AUTO_NO_SHOW</label>
            </div>
            <p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">AUTO_NO_SHOW 預設保持關閉；首波固定班付款只開放銀行匯款。</p>
          </fieldset>
          <fieldset class="space-y-4 border-t border-slate-200 pt-5">
            <legend class="font-medium text-slate-950">票券與洞察</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="space-y-1 text-sm text-slate-600">暫停次數預設<input v-model.number="settings.pauseMaxOperations" type="number" min="0" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">暫停最長天數<input v-model.number="settings.pauseMaxDays" type="number" min="1" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">推方案可用堂數門檻<input v-model.number="settings.pushPlanMaxAvailableUses" type="number" min="0" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">即將到期（天）<input v-model.number="settings.expiringTicketDays" type="number" min="1" class="w-full" /></label>
              <label class="space-y-1 text-sm text-slate-600">沉睡（天）<input v-model.number="settings.dormantStudentDays" type="number" min="1" class="w-full" /></label>
            </div>
          </fieldset>
          <fieldset class="space-y-4 border-t border-slate-200 pt-5">
            <legend class="font-medium text-slate-950">功能啟用</legend>
            <div class="space-y-3">
              <label class="flex min-h-11 items-center gap-2 text-sm text-slate-700"><input v-model="settings.countCardParityEnabled" type="checkbox" :disabled="settings.countCardParityReadOnly || !settings.countCardParityAvailable" />開啟本租戶 051 計次商品化</label>
              <label class="flex min-h-11 items-center gap-2 text-sm text-slate-700"><input v-model="settings.fixedTermEnabled" type="checkbox" :disabled="!settings.fixedTermAvailable" />開啟本租戶 052 固定班</label>
              <label class="flex min-h-11 items-center gap-2 text-sm text-slate-700"><input v-model="settings.advancedPaymentsEnabled" type="checkbox" :disabled="!settings.advancedPaymentsAvailable || !settings.fixedTermEnabled" />開啟本租戶 053 匯款／保險／通知</label>
            </div>
          </fieldset>
        </form>
        <template #actions>
          <button type="button" class="btn btn-outline" :disabled="saving" @click="closeSettingsEditor">取消</button>
          <button type="submit" form="course-settings-editor" class="btn btn-primary text-white" :disabled="saving">{{ saving ? '儲存中…' : '儲存設定' }}</button>
        </template>
      </AppOverlayPanel>
    </section>

    <section v-else-if="activeTab === 'staff'" class="space-y-4">
      <header><h2 class="ui-title text-xl text-slate-950">員工權限與教練名冊</h2><p class="mt-1 text-sm text-slate-600">員工權限才會授予後台能力；教練名冊只供場次指派，不會自動取得管理權限。</p></header>
      <div class="grid gap-4 lg:grid-cols-2">
        <form class="surface-section space-y-3" @submit.prevent="createStaffMembership"><h3 class="font-medium text-slate-950">新增員工權限</h3><label class="block space-y-1 text-sm text-slate-600">平台帳號 User ID<input v-model.trim="staffForm.userId" required class="w-full" /></label><label class="block space-y-1 text-sm text-slate-600">課程角色<select v-model="staffForm.role" class="w-full"><option value="ops">課務行政</option><option value="coach">現場教練</option></select></label><button class="btn btn-primary w-full text-white" :disabled="saving">新增員工</button></form>
        <form class="surface-section space-y-3" @submit.prevent="createCoachProfile"><h3 class="font-medium text-slate-950">新增教練名冊</h3><label class="block space-y-1 text-sm text-slate-600">教練姓名<input v-model.trim="coachForm.displayName" required class="w-full" /></label><label class="block space-y-1 text-sm text-slate-600">聯絡 Email（可選）<input v-model.trim="coachForm.email" type="email" class="w-full" /></label><button class="btn btn-outline w-full" :disabled="saving">新增名冊</button></form>
      </div>
      <div class="grid gap-4 lg:grid-cols-2">
        <ResourceList title="員工權限" :items="staffMemberships" :loading="loading.staff" :error="errors.staff" :label="staffLabel" @retry="loadStaff" />
        <ResourceList title="教練名冊（不授權）" :items="coachProfiles" :loading="loading.staff" :error="errors.staff" :label="coachLabel" @retry="loadStaff" />
      </div>
    </section>

    <section v-else class="space-y-4">
      <header class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="ui-title text-xl text-slate-950">核銷與學生洞察</h2><p class="mt-1 text-sm text-slate-600">營運 KPI、NO SHOW、扣堂異常及學生後續分析。</p></div><button type="button" class="btn btn-outline" @click="loadReports">重新整理</button></header>
      <form class="surface-section grid gap-3 md:grid-cols-3 xl:grid-cols-6" @submit.prevent="loadReports">
        <label class="space-y-1 text-sm text-slate-600">開始日期<input v-model="reportFilters.from" type="date" class="w-full" /></label>
        <label class="space-y-1 text-sm text-slate-600">結束日期<input v-model="reportFilters.to" type="date" class="w-full" /></label>
        <label class="space-y-1 text-sm text-slate-600">Scenario<select v-model="reportFilters.scenarioId" class="w-full"><option value="">全部</option><option v-for="scenario in scenarios" :key="`report-scenario-${scenario.id}`" :value="String(scenario.id)">{{ scenario.name }}</option></select></label>
        <label class="space-y-1 text-sm text-slate-600">教練<select v-model="reportFilters.coachProfileId" class="w-full"><option value="">全部</option><option v-for="coach in coachProfiles" :key="`report-coach-${coach.id}`" :value="String(coach.id)">{{ coach.displayName || coach.display_name || coach.name }}</option></select></label>
        <label class="space-y-1 text-sm text-slate-600">地點<input v-model.trim="reportFilters.location" class="w-full" placeholder="包含文字" /></label>
        <div class="flex items-end gap-2"><button class="btn btn-primary flex-1 text-white" :disabled="loading.reports">套用</button><button type="button" class="btn btn-outline" @click="resetReportFilters">清除</button></div>
      </form>
      <CourseResourceState :loading="loading.reports" :error="errors.reports" :empty="!Object.keys(report).length" :has-content="Object.keys(report).length > 0" empty-text="目前沒有報表資料。" @retry="loadReports">
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-5"><article v-for="metric in reportMetrics" :key="metric.key" class="surface-section"><p class="text-sm text-slate-500">{{ metric.label }}</p><p class="stat-number mt-2 text-3xl text-slate-950">{{ metric.value }}</p></article></div>
        <div class="grid gap-4 lg:grid-cols-2">
          <article class="surface-section"><h3 class="font-medium text-slate-950">行政異常</h3><ul class="mt-3 space-y-2 text-sm text-slate-600"><li v-for="item in report.exceptions || []" :key="item.id">{{ item.label || item.eventType || item.event_type || item.type || '異常事件' }}・{{ item.studentName || item.email || item.note || '待人工確認' }}</li><li v-if="!report.exceptions?.length">目前沒有異常。</li></ul></article>
          <article class="surface-section"><h3 class="font-medium text-slate-950">學生洞察</h3><ul class="mt-3 space-y-3 text-sm text-slate-600"><li v-for="item in report.students || []" :key="item.studentId || item.id || item.email" class="rounded-lg border border-slate-200 p-3"><div class="flex flex-wrap items-center gap-2"><strong class="text-slate-900">{{ item.displayName || item.name || item.email }}</strong><span v-for="label in item.labels || []" :key="label" class="ops-chip">{{ label }}</span></div><p class="mt-1">可用 {{ item.availableUses ?? 0 }} 堂・已過期餘額 {{ item.expiredRemainingUses ?? 0 }} 堂・NO SHOW {{ item.noShowCount ?? 0 }}</p><p class="mt-1 text-xs text-slate-500">最近 SUCCESS：{{ item.lastSuccessAt ? formatDateTime(item.lastSuccessAt) : '尚無' }}・票券來源 {{ formatTicketSources(item) }}</p></li><li v-if="!report.students?.length">目前沒有學生洞察。</li></ul></article>
        </div>
      </CourseResourceState>
    </section>
    </div>
  </section>
</template>

<script setup>
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { showConfirm, showPrompt } from '../utils/sheet'
import AppIcon from './AppIcon.vue'
import AppOverlayPanel from './AppOverlayPanel.vue'
import CourseAttendanceActions from './CourseAttendanceActions.vue'
import CourseResourceState from './CourseResourceState.vue'
import {
  buildCourseMutationHeaders,
  buildCourseScenarioPayload,
  buildCourseSessionPolicyPayload,
  buildCourseSettingsPayload,
  buildCourseTicketMutationHeaders,
  buildCourseTicketProductPayload,
  courseActionDefinition,
  courseRowVersion,
  COURSE_V2_ENDPOINTS,
  createCourseIdempotencyKey,
  formatCourseTaipeiDateTime,
  isCourseVersionConflict,
  normalizeCourseEligibility,
  normalizeCourseTicket,
  toCourseTaipeiDate,
} from '../utils/courseV2'

const props = defineProps({
  currentRole: { type: String, default: '' },
  currentUserId: { type: [String, Number], default: '' },
  capabilities: { type: Object, default: () => ({}) },
  memberships: { type: Array, default: () => [] },
  providerOptions: { type: Array, default: () => [] },
  initialTab: { type: String, default: '' },
  allowedTabs: { type: Array, default: () => [] },
  ownerUserId: { type: [String, Number], default: '' },
  embeddedTenantContext: { type: Boolean, default: false },
})

const emit = defineEmits(['update:ownerUserId'])

const API = API_BASE
const normalizedRole = computed(() => String(props.currentRole || '').trim().toUpperCase())
const isAdmin = computed(() => normalizedRole.value === 'ADMIN')
const membershipTenantOptions = computed(() => {
  const found = new Map()
  for (const membership of props.memberships || []) {
    const id = String(membership?.ownerUserId ?? membership?.owner_user_id ?? '').trim()
    if (!id || found.has(id)) continue
    found.set(id, {
      id,
      label: membership.ownerName || membership.owner_name || `服務商 ${id}`,
    })
  }
  return [...found.values()]
})
const tenantOptions = computed(() => {
  const found = new Map(membershipTenantOptions.value.map(item => [item.id, item]))
  if (isAdmin.value) {
    for (const provider of props.providerOptions || []) {
      const id = String(provider?.id ?? provider?.value ?? '').trim()
      if (!id || found.has(id)) continue
      found.set(id, { id, label: provider.label || provider.name || id })
    }
    return [{ id: '', label: '平台課程' }, ...found.values()]
  }
  return [...found.values()]
})
const selectedOwnerUserId = ref(String(props.ownerUserId || '').trim())
const tenantOwnerDraft = ref(String(props.ownerUserId || '').trim())
const showTenantSelector = computed(() => !props.embeddedTenantContext && (isAdmin.value || tenantOptions.value.length > 1))
const selectedTenantLabel = computed(() => {
  if (!selectedOwnerUserId.value) return '目前：平台課程'
  const option = tenantOptions.value.find(item => item.id === selectedOwnerUserId.value)
  return `目前：${option?.label || selectedOwnerUserId.value}`
})
const tabDefinitions = [
  { key: 'ticket-products', label: '票種', capability: 'manageCatalog' },
  { key: 'scenarios', label: '核銷情境', capability: 'manageCatalog' },
  { key: 'sessions', label: '場次政策', capability: 'manageCatalog' },
  { key: 'attendance', label: '現場／補登', capability: 'manageAttendance' },
  { key: 'settings', label: '設定', capability: 'manageSettings' },
  { key: 'staff', label: '員工／教練', capability: 'manageStaff' },
  { key: 'reports', label: '報表', capability: 'viewReports' },
]
const tabs = computed(() => {
  const allowed = new Set((props.allowedTabs || []).map(value => String(value || '').trim()).filter(Boolean))
  return tabDefinitions.filter(item => Boolean(props.capabilities?.[item.capability]) && (!allowed.size || allowed.has(item.key)))
})
const activeTab = ref('')
const loading = reactive({ ticketProducts: false, scenarios: false, sessions: false, attendance: false, invites: false, settings: false, staff: false, reports: false })
const errors = reactive({ ticketProducts: '', scenarios: '', sessions: '', attendance: '', invites: '', settings: '', staff: '', reports: '' })
const message = ref('')
const messageTone = ref('success')
const saving = ref(false)
const busyId = ref('')
const busyAction = ref('')
const ticketProducts = ref([])
const scenarios = ref([])
const sessions = ref([])
const attendanceBookings = ref([])
const attendanceActionOpen = ref(false)
const attendanceActionBooking = ref(null)
const invites = ref([])
const staffMemberships = ref([])
const coachProfiles = ref([])
const report = ref({})
const attendanceSessionId = ref('')
const selectedAttendanceSession = computed(() => sessions.value.find(item => String(item.id) === String(attendanceSessionId.value)) || null)
const attendanceActionBusy = computed(() => Boolean(attendanceActionBooking.value?.id && busyId.value === `booking-${attendanceActionBooking.value.id}`))
const ticketProductFormOpen = ref(false)
const scenarioFormOpen = ref(false)
const sessionPolicyOpen = ref(false)
const settingsFormOpen = ref(false)
const settingsSnapshot = ref(null)
const settingsLoaded = ref(false)
const editorError = ref('')
const editorErrorRef = ref(null)
const ticketProductForm = ref(emptyTicketProduct())
const scenarioForm = ref(emptyScenario())
const sessionPolicyForm = ref({})
const settings = reactive({
  id: null,
  timezone: 'Asia/Taipei',
  bookingOpenMinutesBefore: 43200,
  bookingCloseMinutesBefore: 0,
  cancelCloseMinutesBefore: 0,
  redeemOpenMinutesBefore: 120,
  redeemCloseMinutesAfter: 1440,
  inviteExpiresMinutes: 1440,
  attendanceInviteExpiryAction: 'release',
  autoNoShow: false,
  bankTransferHoldHours: 24,
  pauseMaxOperations: 1,
  pauseMaxDays: 365,
  pushPlanMaxAvailableUses: 3,
  expiringTicketDays: 30,
  dormantStudentDays: 90,
  countCardParityEnabled: false,
  fixedTermEnabled: false,
  advancedPaymentsEnabled: false,
  countCardParityReadOnly: true,
  countCardParityAvailable: false,
  fixedTermAvailable: false,
  advancedPaymentsAvailable: false,
  fixedTermRuntimeEnabled: false,
  advancedPaymentsRuntimeEnabled: false,
  v2CutoverState: 'legacy',
  rowVersion: '',
})
const walkInForm = reactive({ email: '', name: '', ticketId: '' })
const inviteForm = reactive({ email: '', name: '' })
const staffForm = reactive({ userId: '', role: 'ops' })
const coachForm = reactive({ displayName: '', email: '' })
const reportFilters = reactive({ from: '', to: '', scenarioId: '', coachProfileId: '', location: '', inactiveDays: 90 })

const reportMetrics = computed(() => [
  { key: 'success', label: 'SUCCESS 核銷', value: Number(report.value.successCount ?? report.value.success ?? 0) },
  { key: 'success-uses', label: 'SUCCESS 扣堂', value: Number(report.value.successConsumedUses ?? report.value.consumedUses ?? 0) },
  { key: 'students', label: '出席學員', value: Number(report.value.uniqueSuccessStudents ?? 0) },
  { key: 'no-show', label: 'NO SHOW', value: Number(report.value.noShowCount ?? report.value.noShow ?? 0) },
  { key: 'exceptions', label: '行政異常', value: Number(report.value.anomalyCount ?? report.value.exceptionCount ?? report.value.exceptions?.length ?? 0) },
])

function emptyTicketProduct() {
  return { id: '', name: '', code: '', productType: 'count_pass', usageMode: 'finite', classCount: 1, activationDays: 120, validDays: 120, transferable: false, maxTransfers: 1, maxTransferOperations: 1, pauseMaxOperations: 1, pauseMaxDays: 365, termsText: '', redemptionPolicy: {}, redeemOpenMinutesBefore: '', redeemCloseMinutesAfter: '', status: 'draft', rowVersion: '' }
}
function emptyScenario() { return { id: '', name: '', code: '', description: '', itemType: 'class', sessionBound: true, redeemQuantity: 1, status: 'draft', redeemOpenMinutesBefore: '', redeemCloseMinutesAfter: '', allowedProductIds: [], priorities: {}, edgePolicies: {}, rowVersion: '' } }
function showMessage(value, tone = 'success') { message.value = value; messageTone.value = tone }
function clearEditorError() { editorError.value = '' }
async function showEditorError(value) {
  editorError.value = String(value || '操作失敗')
  await nextTick()
  editorErrorRef.value?.focus?.({ preventScroll: true })
}
function focusEditorStart() {
  if (editorError.value) editorErrorRef.value?.focus?.({ preventScroll: true })
}
function normalizeList(data, keys = []) {
  const root = data?.data ?? data ?? {}
  const payload = root?.data ?? root
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key]
  return []
}
function formatDateTime(value) { return formatCourseTaipeiDateTime(value) || '—' }
function formatRange(start, end) { const from = formatDateTime(start); const to = formatDateTime(end); return from === '—' && to === '—' ? '時間待公告' : `${from}－${to}` }
function formatTimeOrMinutes(absolute, relative) { return absolute ? formatDateTime(absolute) : relative != null && relative !== '' ? `${relative} 分鐘` : '沿用預設' }
function formatTicketSources(item) {
  if (Array.isArray(item?.ticketSources) && item.ticketSources.length) {
    return item.ticketSources
      .map(source => `${source.label} ${Number(source.ticketCount || 0)}`)
      .join('・')
  }
  if (Array.isArray(item?.source) && item.source.length) return item.source.join('／')
  const source = item?.ticketSourceBreakdown || {}
  return `自購 ${Number(source.manualOrImported || 0)}・下單購買 ${Number(source.purchased || 0)}・轉贈 ${Number(source.transferredIn || 0)}`
}
function ticketProductName(id) { return ticketProducts.value.find(item => String(item.id) === String(id))?.name || `票種 ${id}` }
function scenarioName(id) { return scenarios.value.find(item => String(item.id) === String(id))?.name || '' }
function staffLabel(item) { return `${item.username || item.email || item.userId || item.user_id}・${item.role || 'ops'}` }
function coachLabel(item) { return `${item.displayName || item.display_name || item.name || item.coachName}${item.email ? `・${item.email}` : ''}` }
function tenantScopeParams(extra = {}) {
  const ownerUserId = String(selectedOwnerUserId.value || '').trim()
  return {
    ...extra,
    ownerUserId,
    ...(isAdmin.value
      ? (ownerUserId ? { providerUserId: ownerUserId } : { ownerType: 'platform' })
      : {}),
  }
}
function tenantScopeBody(body = {}) {
  return {
    ...body,
    ownerUserId: selectedOwnerUserId.value || null,
  }
}
let tenantGeneration = 0
let tenantAbortController = new AbortController()
function replaceTenantAbortController() {
  tenantAbortController.abort()
  tenantAbortController = new AbortController()
}
function resetTenantScopedState() {
  tenantGeneration += 1
  replaceTenantAbortController()
  ticketProducts.value = []
  scenarios.value = []
  sessions.value = []
  attendanceBookings.value = []
  invites.value = []
  staffMemberships.value = []
  coachProfiles.value = []
  report.value = {}
  settingsLoaded.value = false
  Object.assign(settings, {
    id: null,
    timezone: 'Asia/Taipei',
    bookingOpenMinutesBefore: 43200,
    bookingCloseMinutesBefore: 0,
    cancelCloseMinutesBefore: 0,
    redeemOpenMinutesBefore: 120,
    redeemCloseMinutesAfter: 1440,
    inviteExpiresMinutes: 1440,
    attendanceInviteExpiryAction: 'release',
    autoNoShow: false,
    bankTransferHoldHours: 24,
    pauseMaxOperations: 1,
    pauseMaxDays: 365,
    pushPlanMaxAvailableUses: 3,
    expiringTicketDays: 30,
    dormantStudentDays: 90,
    countCardParityEnabled: false,
    fixedTermEnabled: false,
    advancedPaymentsEnabled: false,
    countCardParityReadOnly: true,
    countCardParityAvailable: false,
    fixedTermAvailable: false,
    advancedPaymentsAvailable: false,
    fixedTermRuntimeEnabled: false,
    advancedPaymentsRuntimeEnabled: false,
    v2CutoverState: 'legacy',
    rowVersion: '',
  })
  attendanceSessionId.value = ''
  attendanceActionOpen.value = false
  attendanceActionBooking.value = null
  ticketProductFormOpen.value = false
  scenarioFormOpen.value = false
  sessionPolicyOpen.value = false
  settingsFormOpen.value = false
  settingsSnapshot.value = null
  clearEditorError()
  message.value = ''
  for (const key of Object.keys(errors)) errors[key] = ''
}
async function applyTenantScope() {
  const nextOwnerUserId = String(tenantOwnerDraft.value || '').trim()
  if (!isAdmin.value && !tenantOptions.value.some(option => option.id === nextOwnerUserId)) {
    tenantOwnerDraft.value = selectedOwnerUserId.value
    return
  }
  if (nextOwnerUserId === selectedOwnerUserId.value) return
  selectedOwnerUserId.value = nextOwnerUserId
  emit('update:ownerUserId', nextOwnerUserId)
  resetTenantScopedState()
  if (activeTab.value) await selectTab(activeTab.value)
}
async function selectPlatformTenant() {
  tenantOwnerDraft.value = ''
  await applyTenantScope()
}
function mutationConfig(record, prefix) {
  return {
    headers: buildCourseMutationHeaders(record, {
      idempotencyKey: createCourseIdempotencyKey(prefix),
    }),
  }
}
async function handleMutationError(error, refresh) {
  const errorMessage = error?.response?.data?.message || error.message || '操作失敗'
  if (isCourseVersionConflict(error) || Number(error?.response?.status || 0) === 428) {
    const settingsDraft = settingsFormOpen.value ? { ...settings } : null
    await refresh?.()
    if (settingsDraft) Object.assign(settings, settingsDraft)
    const conflictMessage = '資料版本已更新，請確認目前內容後再操作；尚未送出的欄位會保留。'
    if (ticketProductFormOpen.value || scenarioFormOpen.value || sessionPolicyOpen.value || settingsFormOpen.value) await showEditorError(conflictMessage)
    else showMessage(conflictMessage, 'error')
    return
  }
  if (ticketProductFormOpen.value || scenarioFormOpen.value || sessionPolicyOpen.value || settingsFormOpen.value) await showEditorError(errorMessage)
  else showMessage(errorMessage, 'error')
}
async function readResource(key, url, aliases = []) {
  const generation = tenantGeneration
  loading[key] = true
  errors[key] = ''
  try {
    const { data } = await axios.get(`${API}${url}`, {
      params: tenantScopeParams(),
      signal: tenantAbortController.signal,
    })
    if (generation !== tenantGeneration) return null
    return normalizeList(data, aliases)
  } catch (error) {
    if (generation !== tenantGeneration || error?.code === 'ERR_CANCELED') return null
    errors[key] = Number(error?.response?.status || 0) === 404
      ? '此環境尚未啟用這項 Course V2 API。'
      : (error?.response?.data?.message || '資料載入失敗')
    return null
  } finally {
    if (generation === tenantGeneration) loading[key] = false
  }
}
async function selectTab(key) {
  if (!tabs.value.some(item => item.key === key)) return
  activeTab.value = key
  if (key === 'ticket-products') await loadTicketProducts()
  else if (key === 'scenarios') await Promise.all([loadTicketProducts(), loadScenarios()])
  else if (key === 'sessions') await Promise.all([loadSessions(), loadScenarios()])
  else if (key === 'attendance') await Promise.all([loadSessions(), loadInvites()])
  else if (key === 'settings') await loadSettings()
  else if (key === 'staff') await loadStaff()
  else await Promise.all([loadReports(), loadReportDimensions()])
}

function onTabKeydown(event, index) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key) || !tabs.value.length) return
  event.preventDefault()
  const last = tabs.value.length - 1
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? last
      : event.key === 'ArrowLeft'
        ? (index - 1 + tabs.value.length) % tabs.value.length
        : (index + 1) % tabs.value.length
  const next = tabs.value[nextIndex]
  if (!next) return
  selectTab(next.key)
  event.currentTarget?.parentElement?.querySelectorAll?.('[role="tab"]')?.[nextIndex]?.focus()
}

async function loadTicketProducts() {
  const items = await readResource('ticketProducts', COURSE_V2_ENDPOINTS.ticketProducts, ['ticketProducts'])
  if (!items) return
  ticketProducts.value = items.map(item => {
      const redemptionPolicy = item.redemptionPolicy || item.redemption_policy || item.redemption_policy_json || {}
      return {
        ...item,
        classCount: item.classCount ?? item.class_count,
        productType: item.productType ?? item.product_type ?? 'count_pass',
        usageMode: item.usageMode ?? item.usage_mode ?? 'finite',
        activationDays: item.activationDays ?? item.activation_days,
        validDays: item.validDays ?? item.valid_days,
        maxTransfers: item.maxTransfers ?? item.max_transfers ?? item.transferLimit ?? item.transfer_limit,
        maxTransferOperations: item.maxTransferOperations ?? item.max_transfer_operations ?? item.maxTransfers ?? item.max_transfers ?? 1,
        pauseMaxOperations: item.pauseMaxOperations ?? item.pause_max_operations ?? 1,
        pauseMaxDays: item.pauseMaxDays ?? item.pause_max_days ?? 365,
        termsText: item.termsText ?? item.terms_text ?? item.terms ?? '',
        redemptionPolicy,
        redeemOpenMinutesBefore: redemptionPolicy.redeemOpenMinutesBefore ?? redemptionPolicy.redeem_open_minutes_before ?? '',
        redeemCloseMinutesAfter: redemptionPolicy.redeemCloseMinutesAfter ?? redemptionPolicy.redeem_close_minutes_after ?? '',
        rowVersion: item.rowVersion ?? item.row_version,
      }
    })
}
function startTicketProduct(product = null) {
  clearEditorError()
  ticketProductForm.value = product ? { ...emptyTicketProduct(), ...product } : emptyTicketProduct()
  ticketProductFormOpen.value = true
}
async function saveTicketProduct() {
  clearEditorError()
  const form = ticketProductForm.value
  const payload = tenantScopeBody(buildCourseTicketProductPayload(form))
  saving.value = true
  try {
    const url = form.id ? `${COURSE_V2_ENDPOINTS.ticketProducts}/${encodeURIComponent(form.id)}` : COURSE_V2_ENDPOINTS.ticketProducts
    const method = form.id ? 'patch' : 'post'
    await axios[method](`${API}${url}`, payload, mutationConfig(form, 'ticket-product'))
    ticketProductFormOpen.value = false
    await loadTicketProducts()
    showMessage('TicketProduct 已儲存。')
  } catch (error) { await handleMutationError(error, loadTicketProducts) }
  finally { saving.value = false }
}

async function loadScenarios() {
  const items = await readResource('scenarios', COURSE_V2_ENDPOINTS.scenarios, ['scenarios'])
  if (!items) return
  scenarios.value = items.map(item => ({
      ...item,
      itemType: item.itemType ?? item.item_type ?? 'class',
      sessionBound: Boolean(item.sessionBound ?? item.session_bound ?? true),
      redeemQuantity: item.redeemQuantity ?? item.redeem_quantity ?? 1,
      redeemOpenMinutesBefore: item.redeemOpenMinutesBefore ?? item.redeem_open_minutes_before ?? null,
      redeemCloseMinutesAfter: item.redeemCloseMinutesAfter ?? item.redeem_close_minutes_after ?? null,
      allowedProducts: (item.allowedProducts || item.allowedTicketProducts || item.allowed_products || []).map(allowed => ({
        ...allowed,
        ticketProductId: allowed.ticketProductId ?? allowed.ticket_product_id ?? allowed.productId ?? allowed.product_id,
        redeemOpenMinutesBefore: allowed.redeemOpenMinutesBefore ?? allowed.redeem_open_minutes_before ?? null,
        redeemCloseMinutesAfter: allowed.redeemCloseMinutesAfter ?? allowed.redeem_close_minutes_after ?? null,
      })),
      rowVersion: item.rowVersion ?? item.row_version,
    }))
}
function scenarioEdgePolicies(allowed = []) {
  const byProduct = new Map(allowed.map(item => [String(item.ticketProductId ?? item.productId ?? item.id), item]))
  return Object.fromEntries(ticketProducts.value.map(product => {
    const edge = byProduct.get(String(product.id)) || {}
    return [product.id, {
      redeemOpenMinutesBefore: edge.redeemOpenMinutesBefore ?? edge.redeem_open_minutes_before ?? '',
      redeemCloseMinutesAfter: edge.redeemCloseMinutesAfter ?? edge.redeem_close_minutes_after ?? '',
    }]
  }))
}
function startScenario(scenario = null) {
  clearEditorError()
  const allowed = scenario?.allowedProducts || scenario?.allowedTicketProducts || []
  scenarioForm.value = scenario ? {
    ...emptyScenario(),
    ...scenario,
    redeemOpenMinutesBefore: scenario.redeemOpenMinutesBefore ?? scenario.redeem_open_minutes_before ?? '',
    redeemCloseMinutesAfter: scenario.redeemCloseMinutesAfter ?? scenario.redeem_close_minutes_after ?? '',
    allowedProductIds: allowed.map(item => String(item.productId ?? item.ticketProductId ?? item.id)),
    priorities: Object.fromEntries(allowed.map(item => [item.productId ?? item.ticketProductId ?? item.id, item.priority ?? 1])),
    edgePolicies: scenarioEdgePolicies(allowed),
  } : {
    ...emptyScenario(),
    edgePolicies: scenarioEdgePolicies(),
  }
  scenarioFormOpen.value = true
}
async function saveScenario() {
  clearEditorError()
  const form = scenarioForm.value
  const payload = tenantScopeBody(buildCourseScenarioPayload(form))
  saving.value = true
  try {
    const url = form.id ? `${COURSE_V2_ENDPOINTS.scenarios}/${encodeURIComponent(form.id)}` : COURSE_V2_ENDPOINTS.scenarios
    await axios[form.id ? 'patch' : 'post'](`${API}${url}`, payload, mutationConfig(form, 'scenario'))
    scenarioFormOpen.value = false
    await loadScenarios()
    showMessage('RedeemScenario 已儲存。')
  } catch (error) { await handleMutationError(error, loadScenarios) }
  finally { saving.value = false }
}

async function loadSessions() {
  const items = await readResource('sessions', '/admin/courses/sessions?paged=1&limit=200&sort=starts_desc', ['sessions'])
  if (!items) return
  sessions.value = items.map(item => ({ ...item, rowVersion: item.rowVersion ?? item.row_version ?? item.version ?? '' }))
}
function startSessionPolicy(session) {
  clearEditorError()
  sessionPolicyForm.value = {
    ...session,
    scenarioId: String(session.scenarioId || session.scenario_id || ''),
    cancelCloseMinutesBefore: session.cancelCloseMinutesBefore
      ?? session.cancel_close_minutes_before
      ?? session.cancelMinutesBefore
      ?? session.cancel_minutes_before
      ?? '',
    redeemOpenAt: toDateTimeLocal(session.redeemOpenAt || session.redeem_open_at),
    redeemOpenMinutesBefore: session.redeemOpenMinutesBefore ?? session.redeem_open_minutes_before ?? '',
    redeemCloseAt: toDateTimeLocal(session.redeemCloseAt || session.redeem_close_at),
    redeemCloseMinutesAfter: session.redeemCloseMinutesAfter ?? session.redeem_close_minutes_after ?? '',
  }
  sessionPolicyOpen.value = true
}
function toDateTimeLocal(value) { const date = toCourseTaipeiDate(value); return date ? new Date(date.getTime() + 8 * 60 * 60000).toISOString().slice(0, 16) : '' }
function toTaipeiDatabaseDateTime(value) { const text = String(value || '').trim(); return text ? `${text.replace('T', ' ')}${text.length === 16 ? ':00' : ''}` : null }
async function saveSessionPolicy() {
  clearEditorError()
  const form = sessionPolicyForm.value
  saving.value = true
  try {
    await axios.patch(
      `${API}/admin/courses/sessions/${encodeURIComponent(form.id)}/policy`,
      tenantScopeBody(buildCourseSessionPolicyPayload({
        ...form,
        redeemOpenAt: toTaipeiDatabaseDateTime(form.redeemOpenAt),
        redeemCloseAt: toTaipeiDatabaseDateTime(form.redeemCloseAt),
      })),
      mutationConfig(form, 'session-policy')
    )
    sessionPolicyOpen.value = false
    await loadSessions()
    showMessage('場次政策已儲存。')
  } catch (error) { await handleMutationError(error, loadSessions) }
  finally { saving.value = false }
}

async function loadAttendance() {
  if (!attendanceSessionId.value) { attendanceBookings.value = []; return }
  const items = await readResource('attendance', `/admin/courses/bookings?paged=1&limit=200&sessionId=${encodeURIComponent(attendanceSessionId.value)}`, ['bookings'])
  if (!items) return
  attendanceBookings.value = items.map(item => {
      const redeemableNow = item.redeemableNow ?? item.redeemable_now ?? item.redeemable
      return { ...normalizeCourseTicket(item), capabilities: item.capabilities || {}, redeemable: redeemableNow === undefined ? true : Boolean(redeemableNow), redeemableNow: redeemableNow === undefined ? true : Boolean(redeemableNow), redeemableReason: item.redeemableReason || item.redeemable_reason || item.redeemableNowReason || item.redeemable_now_reason || '' }
    })
}
async function refreshAttendanceContext() {
  await loadSessions()
  await loadAttendance()
}
async function previewAttendanceTicket(email, requestedTicketId, purpose, mode) {
  const session = selectedAttendanceSession.value
  if (!session?.id) throw new Error('請先選擇場次')
  const { data } = await axios.get(`${API}${COURSE_V2_ENDPOINTS.adminSessionEligibility(session.id)}`, {
    params: tenantScopeParams({
      attendeeEmail: String(email || '').trim(),
      ...(requestedTicketId ? { ticketId: Number(requestedTicketId) } : {}),
    }),
  })
  const eligibility = normalizeCourseEligibility(data?.data || data)
  const isUsable = item => Boolean(item?.eligibleForAttendance) && (mode !== 'walk-in' || Boolean(item?.redeemableNow))
  const requestedTicket = requestedTicketId
    ? eligibility.tickets.find(item => Number(item.id) === Number(requestedTicketId))
    : null
  const selectedTicket = eligibility.tickets.find(
    item => Number(item.id) === Number(eligibility.selectedTicketId) && isUsable(item)
  )
  const ticket = requestedTicket || selectedTicket || eligibility.tickets.find(isUsable)
  const attendanceEligible = Boolean(ticket?.eligibleForAttendance)
  const withinWalkInWindow = mode !== 'walk-in' || Boolean(ticket?.redeemableNow)
  if (!ticket?.id || !attendanceEligible || !withinWalkInWindow) {
    throw new Error(
      (mode === 'walk-in' && !withinWalkInWindow ? ticket?.redeemableReason : '')
      || ticket?.reason
      || eligibility.reason
      || '此學員目前沒有可保留的票券'
    )
  }
  const ticketVersion = courseRowVersion(ticket)
  if (!ticketVersion) throw new Error('伺服器未回傳票券版本，無法安全建立保留額度')
  const confirmed = await showConfirm(
    `${purpose}將使用票券 ${ticket.code || ticket.id}；剩餘 ${ticket.remainingUses}、保留 ${ticket.heldUses}、可用 ${ticket.availableUses} 堂。是否繼續？`,
    { title: '確認票券', confirmText: '確定使用' },
  )
  if (!confirmed) return null
  return { ticket, ticketVersion }
}
function attendanceMutationConfig(session, ticketVersion, prefix) {
  return {
    headers: buildCourseTicketMutationHeaders(session, { rowVersion: ticketVersion }, {
      idempotencyKey: createCourseIdempotencyKey(prefix),
    }),
  }
}
function openAttendanceActionDrawer(booking) {
  attendanceActionBooking.value = booking ? { ...booking } : null
  attendanceActionOpen.value = Boolean(attendanceActionBooking.value)
}
async function runAttendanceDrawerAction(action) {
  if (!attendanceActionBooking.value) return
  const completed = await runBookingAction(attendanceActionBooking.value, action)
  if (completed) {
    attendanceActionOpen.value = false
    attendanceActionBooking.value = null
  }
}
async function runBookingAction(booking, action) {
  const definition = courseActionDefinition(action)
  if (!definition) return false
  const note = action === 'undo'
    ? await showPrompt('請填寫管理沖正原因（會寫入稽核紀錄）', {
        title: '管理沖正',
        placeholder: '請輸入具體原因',
        confirmText: '確認沖正',
      }).catch(() => null)
    : ''
  if (action === 'undo' && !String(note || '').trim()) return false
  busyId.value = `booking-${booking.id}`
  busyAction.value = action
  try {
    await axios.post(
      `${API}${COURSE_V2_ENDPOINTS.bookingAction(booking.id, definition.endpoint)}`,
      tenantScopeBody({ note: String(note || '').trim() }),
      mutationConfig(booking, `booking-${definition.endpoint}`)
    )
    await loadAttendance()
    showMessage(`${definition.label}已完成。`)
    return true
  } catch (error) { await handleMutationError(error, loadAttendance); return false }
  finally { busyId.value = ''; busyAction.value = '' }
}
async function createWalkIn() {
  saving.value = true
  try {
    const selection = await previewAttendanceTicket(walkInForm.email, walkInForm.ticketId, 'walk-in 核銷', 'walk-in')
    if (!selection) return
    await axios.post(`${API}${COURSE_V2_ENDPOINTS.walkIns(attendanceSessionId.value)}`, tenantScopeBody({
      attendeeEmail: walkInForm.email,
      attendeeName: walkInForm.name,
      ticketId: Number(selection.ticket.id),
      expectedTicketRowVersion: selection.ticketVersion,
    }), attendanceMutationConfig(selectedAttendanceSession.value || {}, selection.ticketVersion, 'walk-in'))
    Object.assign(walkInForm, { email: '', name: '', ticketId: '' })
    await loadAttendance()
    showMessage('walk-in 已建立並由伺服器完成核銷。')
  } catch (error) { await handleMutationError(error, refreshAttendanceContext) }
  finally { saving.value = false }
}
async function createAttendanceInvite() {
  saving.value = true
  try {
    const selection = await previewAttendanceTicket(inviteForm.email, '', '補登邀請', 'attendance-invite')
    if (!selection) return
    await axios.post(`${API}${COURSE_V2_ENDPOINTS.sessionInvites(attendanceSessionId.value)}`, tenantScopeBody({
      attendeeEmail: inviteForm.email,
      attendeeName: inviteForm.name,
      ticketId: Number(selection.ticket.id),
      expectedTicketRowVersion: selection.ticketVersion,
    }), attendanceMutationConfig(selectedAttendanceSession.value || {}, selection.ticketVersion, 'attendance-invite'))
    Object.assign(inviteForm, { email: '', name: '' })
    await loadInvites()
    showMessage('補登邀請已建立。')
  } catch (error) { await handleMutationError(error, refreshAttendanceContext) }
  finally { saving.value = false }
}
async function loadInvites() {
  const items = await readResource('invites', COURSE_V2_ENDPOINTS.attendanceInvites, ['invites', 'attendanceInvites'])
  if (items) invites.value = items
}

function startSettingsEditor() {
  clearEditorError()
  settingsSnapshot.value = { ...settings }
  settingsFormOpen.value = true
}
function cancelSettingsEditor() {
  if (settingsSnapshot.value) Object.assign(settings, settingsSnapshot.value)
  settingsSnapshot.value = null
  clearEditorError()
}
function closeSettingsEditor() {
  cancelSettingsEditor()
  settingsFormOpen.value = false
}

async function loadSettings() {
  const generation = tenantGeneration
  loading.settings = true
  errors.settings = ''
  try {
    const { data } = await axios.get(`${API}${COURSE_V2_ENDPOINTS.settings}`, {
      params: tenantScopeParams(),
      signal: tenantAbortController.signal,
    })
    if (generation !== tenantGeneration) return
    const payload = data?.data || data || {}
    Object.assign(settings, {
      id: payload.id ?? null,
      bookingOpenMinutesBefore: payload.bookingOpenMinutesBefore ?? payload.booking_open_minutes_before ?? settings.bookingOpenMinutesBefore,
      bookingCloseMinutesBefore: payload.bookingCloseMinutesBefore ?? payload.booking_close_minutes_before ?? settings.bookingCloseMinutesBefore,
      cancelCloseMinutesBefore: payload.cancelCloseMinutesBefore
        ?? payload.cancel_close_minutes_before
        ?? payload.cancelMinutesBefore
        ?? payload.cancel_minutes_before
        ?? settings.cancelCloseMinutesBefore,
      redeemOpenMinutesBefore: payload.redeemOpenMinutesBefore ?? payload.redeem_open_minutes_before ?? settings.redeemOpenMinutesBefore,
      redeemCloseMinutesAfter: payload.redeemCloseMinutesAfter ?? payload.redeem_close_minutes_after ?? settings.redeemCloseMinutesAfter,
      inviteExpiresMinutes: payload.attendanceInviteExpiresMinutes ?? payload.attendance_invite_expires_minutes ?? payload.inviteExpiresMinutes ?? payload.invite_expires_minutes ?? settings.inviteExpiresMinutes,
      timezone: payload.timezone ?? settings.timezone,
      attendanceInviteExpiryAction: payload.attendanceInviteExpiryAction ?? payload.attendance_invite_expiry_action ?? 'release',
      autoNoShow: Boolean(payload.autoNoShow ?? payload.auto_no_show ?? false),
      bankTransferHoldHours: payload.bankTransferHoldHours ?? payload.bank_transfer_hold_hours ?? 24,
      pauseMaxOperations: payload.pauseMaxOperations ?? payload.pause_max_operations ?? 1,
      pauseMaxDays: payload.pauseMaxDays ?? payload.pause_max_days ?? 365,
      pushPlanMaxAvailableUses: payload.pushPlanMaxAvailableUses ?? payload.push_plan_max_available_uses ?? 3,
      expiringTicketDays: payload.expiringTicketDays ?? payload.expiring_ticket_days ?? 30,
      dormantStudentDays: payload.dormantStudentDays ?? payload.dormant_student_days ?? 90,
      countCardParityEnabled: Boolean(payload.countCardParityEnabled ?? payload.count_card_parity_enabled ?? false),
      fixedTermEnabled: Boolean(payload.fixedTermEnabled ?? payload.fixed_term_enabled ?? false),
      advancedPaymentsEnabled: Boolean(payload.advancedPaymentsEnabled ?? payload.advanced_payments_enabled ?? false),
      countCardParityReadOnly: Boolean(payload.countCardParityReadOnly ?? payload.count_card_parity_read_only ?? false),
      countCardParityAvailable: Boolean(payload.countCardParityAvailable ?? payload.count_card_parity_available ?? true),
      fixedTermAvailable: Boolean(payload.fixedTermAvailable ?? payload.fixed_term_available ?? false),
      advancedPaymentsAvailable: Boolean(payload.advancedPaymentsAvailable ?? payload.advanced_payments_available ?? false),
      fixedTermRuntimeEnabled: Boolean(payload.fixedTermRuntimeEnabled ?? payload.fixed_term_runtime_enabled ?? false),
      advancedPaymentsRuntimeEnabled: Boolean(payload.advancedPaymentsRuntimeEnabled ?? payload.advanced_payments_runtime_enabled ?? false),
      v2CutoverState: payload.v2CutoverState ?? payload.v2_cutover_state ?? 'legacy',
      rowVersion: payload.rowVersion ?? payload.row_version ?? '',
    })
    settingsLoaded.value = true
  } catch (error) {
    if (generation === tenantGeneration && error?.code !== 'ERR_CANCELED') {
      errors.settings = Number(error?.response?.status || 0) === 404 ? '此環境尚未啟用 Course V2 設定 API。' : (error?.response?.data?.message || '設定載入失敗')
    }
  } finally {
    if (generation === tenantGeneration) loading.settings = false
  }
}
async function saveSettings() {
  clearEditorError()
  saving.value = true
  try {
    const persisted = Number(settings.id || 0) > 0
    await axios[persisted ? 'patch' : 'post'](
      `${API}${COURSE_V2_ENDPOINTS.settings}`,
      tenantScopeBody(buildCourseSettingsPayload(settings)),
      persisted
        ? mutationConfig(settings, 'course-settings')
        : { headers: buildCourseMutationHeaders({}, {
          idempotencyKey: createCourseIdempotencyKey('course-settings'),
        }) }
    )
    await loadSettings()
    settingsSnapshot.value = null
    settingsFormOpen.value = false
    showMessage('課程設定已儲存。')
  } catch (error) { await handleMutationError(error, loadSettings) }
  finally { saving.value = false }
}

async function loadStaff() {
  const generation = tenantGeneration
  loading.staff = true
  errors.staff = ''
  try {
    const [staffResult, coachResult] = await Promise.allSettled([
      axios.get(`${API}${COURSE_V2_ENDPOINTS.staffMemberships}`, { params: tenantScopeParams(), signal: tenantAbortController.signal }),
      axios.get(`${API}${COURSE_V2_ENDPOINTS.coachProfiles}`, { params: tenantScopeParams(), signal: tenantAbortController.signal }),
    ])
    if (generation !== tenantGeneration) return
    if (staffResult.status === 'fulfilled') staffMemberships.value = normalizeList(staffResult.value?.data, ['memberships', 'staffMemberships'])
    if (coachResult.status === 'fulfilled') coachProfiles.value = normalizeList(coachResult.value?.data, ['coaches', 'coachProfiles'])
    const failed = [staffResult, coachResult].find(result => result.status === 'rejected' && result.reason?.code !== 'ERR_CANCELED')
    if (failed) errors.staff = Number(failed.reason?.response?.status || 0) === 404 ? '此環境尚未啟用員工或教練 API。' : (failed.reason?.response?.data?.message || '人員資料載入失敗')
  } finally {
    if (generation === tenantGeneration) loading.staff = false
  }
}
async function createStaffMembership() {
  saving.value = true
  try { await axios.post(`${API}${COURSE_V2_ENDPOINTS.staffMemberships}`, tenantScopeBody({ userId: staffForm.userId, role: staffForm.role }), mutationConfig({}, 'staff-membership')); Object.assign(staffForm, { userId: '', role: 'ops' }); await loadStaff(); showMessage('員工 membership 已新增。') }
  catch (error) { await handleMutationError(error, loadStaff) }
  finally { saving.value = false }
}
async function createCoachProfile() {
  saving.value = true
  try { await axios.post(`${API}${COURSE_V2_ENDPOINTS.coachProfiles}`, tenantScopeBody({ displayName: coachForm.displayName, email: coachForm.email || null }), mutationConfig({}, 'coach-profile')); Object.assign(coachForm, { displayName: '', email: '' }); await loadStaff(); showMessage('教練名冊已新增；此動作未授予後台權限。') }
  catch (error) { await handleMutationError(error, loadStaff) }
  finally { saving.value = false }
}
async function loadReports() {
  const generation = tenantGeneration
  loading.reports = true
  errors.reports = ''
  try {
    const reportParams = tenantScopeParams({
      from: reportFilters.from || undefined,
      to: reportFilters.to || undefined,
      scenarioId: reportFilters.scenarioId || undefined,
      coachProfileId: reportFilters.coachProfileId || undefined,
      location: reportFilters.location || undefined,
      inactiveDays: reportFilters.inactiveDays,
    })
    const [summary, students, anomalies] = await Promise.all([
      axios.get(`${API}${COURSE_V2_ENDPOINTS.reports}`, { params: reportParams, signal: tenantAbortController.signal }),
      axios.get(`${API}${COURSE_V2_ENDPOINTS.reportStudents}`, { params: reportParams, signal: tenantAbortController.signal }),
      axios.get(`${API}${COURSE_V2_ENDPOINTS.reportAnomalies}`, { params: reportParams, signal: tenantAbortController.signal }),
    ])
    if (generation !== tenantGeneration) return
    report.value = {
      ...(summary.data?.data || summary.data || {}),
      students: normalizeList(students.data, ['students']),
      exceptions: normalizeList(anomalies.data, ['anomalies', 'exceptions']),
    }
  }
  catch (error) {
    if (generation === tenantGeneration && error?.code !== 'ERR_CANCELED') {
      errors.reports = Number(error?.response?.status || 0) === 404 ? '此環境尚未啟用 Course V2 報表 API。' : (error?.response?.data?.message || '報表載入失敗')
    }
  } finally {
    if (generation === tenantGeneration) loading.reports = false
  }
}

async function loadReportDimensions() {
  const generation = tenantGeneration
  const [scenarioResult, coachResult] = await Promise.allSettled([
    axios.get(`${API}${COURSE_V2_ENDPOINTS.scenarios}`, { params: tenantScopeParams(), signal: tenantAbortController.signal }),
    axios.get(`${API}${COURSE_V2_ENDPOINTS.coachProfiles}`, { params: tenantScopeParams(), signal: tenantAbortController.signal }),
  ])
  if (generation !== tenantGeneration) return
  if (scenarioResult.status === 'fulfilled') scenarios.value = normalizeList(scenarioResult.value?.data, ['scenarios'])
  if (coachResult.status === 'fulfilled') coachProfiles.value = normalizeList(coachResult.value?.data, ['coaches', 'coachProfiles'])
}

async function resetReportFilters() {
  Object.assign(reportFilters, { from: '', to: '', scenarioId: '', coachProfileId: '', location: '', inactiveDays: 90 })
  await loadReports()
}

const ResourceList = defineComponent({
  props: { title: String, items: Array, loading: Boolean, error: String, label: Function },
  emits: ['retry'],
  setup(props, { emit }) {
    return () => h('section', { class: 'surface-section space-y-3' }, [
      h('h3', { class: 'font-medium text-slate-950' }, props.title),
      h(CourseResourceState, {
        loading: props.loading,
        error: props.error,
        empty: !props.items?.length,
        hasContent: Boolean(props.items?.length),
        emptyText: '目前沒有資料。',
        onRetry: () => emit('retry'),
      }, {
        default: () => h('ul', { class: 'space-y-2 text-sm text-slate-600' }, (props.items || []).map(item => h('li', { class: 'rounded-lg border border-slate-200 p-3' }, props.label(item)))),
      }),
    ])
  },
})

watch(
  () => String(props.ownerUserId || '').trim(),
  async (nextOwnerUserId) => {
    if (nextOwnerUserId === selectedOwnerUserId.value) return
    selectedOwnerUserId.value = nextOwnerUserId
    tenantOwnerDraft.value = nextOwnerUserId
    resetTenantScopedState()
    if (activeTab.value) await selectTab(activeTab.value)
  }
)

watch(
  () => `${normalizedRole.value}:${membershipTenantOptions.value.map(item => item.id).join(',')}`,
  () => {
    if (isAdmin.value) {
      tenantOwnerDraft.value = selectedOwnerUserId.value
      return
    }
    const fallbackOwnerUserId = membershipTenantOptions.value[0]?.id
      || (normalizedRole.value === 'SERVICE_PROVIDER' ? String(props.currentUserId || '') : '')
    const currentIsAllowed = tenantOptions.value.some(option => option.id === selectedOwnerUserId.value)
    const nextOwnerUserId = currentIsAllowed ? selectedOwnerUserId.value : fallbackOwnerUserId
    const changed = nextOwnerUserId !== selectedOwnerUserId.value
    selectedOwnerUserId.value = nextOwnerUserId
    tenantOwnerDraft.value = nextOwnerUserId
    if (changed && activeTab.value) {
      emit('update:ownerUserId', nextOwnerUserId)
      resetTenantScopedState()
      selectTab(activeTab.value)
    }
  },
  { immediate: true }
)

watch(
  () => `${props.initialTab}:${tabs.value.map(item => item.key).join(',')}`,
  async () => {
    if (tabs.value.some(item => item.key === activeTab.value)) return
    const preferred = tabs.value.find(item => item.key === props.initialTab)?.key || tabs.value[0]?.key || ''
    if (preferred) await selectTab(preferred)
    else activeTab.value = ''
  }
)

onMounted(async () => {
  const firstTab = tabs.value.find(item => item.key === props.initialTab)?.key || tabs.value[0]?.key || ''
  if (firstTab) await selectTab(firstTab)
})

onBeforeUnmount(() => tenantAbortController.abort())
</script>
