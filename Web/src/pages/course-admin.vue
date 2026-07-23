<template>
  <section class="space-y-5">
    <section v-if="!focusedMode" class="grid grid-cols-2 gap-3 lg:grid-cols-5">
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
        {{ isAdmin ? '管理範圍：全部服務商與平台課程' : '管理範圍：我的課程' }}
      </span>
      <span v-if="activeTab !== 'overview' && activeSummary.total != null" class="text-sm text-slate-500">
        此租戶範圍共 {{ activeSummary.total }} 筆
      </span>
    </div>

    <p
      v-if="message"
      class="rounded-lg border px-4 py-3 text-sm"
      :class="messageType === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'"
      role="status"
    >
      {{ message }}
    </p>

    <section v-if="activeTab === 'overview'" class="grid gap-4 lg:grid-cols-2">
      <article class="surface-section space-y-4">
        <h2 class="ui-title text-xl text-slate-950">營運流程</h2>
        <ol class="space-y-3 text-sm leading-6 text-slate-600">
          <li><strong class="text-slate-900">1. 商品：</strong>建立課程票種、堂數、效期與售價，發布後顯示在前台。</li>
          <li><strong class="text-slate-900">2. 場次：</strong>設定教練、地點、時間、名額與適用商品。</li>
          <li><strong class="text-slate-900">3. 訂單：</strong>至「訂單」的課程分類確認款項與發券。</li>
          <li><strong class="text-slate-900">4. 核銷：</strong>預約不扣堂，確認出席時才扣除 1 堂。</li>
        </ol>
      </article>
      <article class="surface-section space-y-4">
        <h2 class="ui-title text-xl text-slate-950">多租戶管理</h2>
        <div class="space-y-3 text-sm leading-6 text-slate-600">
          <p>管理員可管理平台與所有服務商課程；服務商只能看見及操作自己的商品、場次、訂單、票券與預約。</p>
          <p>課程訂單與票券保留在原後台分類；此頁管理課程商品、場次與預約核銷。</p>
        </div>
      </article>
    </section>

    <section v-else-if="activeTab === 'products'" class="space-y-4">
      <ListHeading title="課程商品" description="定義課程售價、堂數、效期、歸屬服務商與發布狀態。">
        <button type="button" class="btn btn-primary text-white" @click="openProductForm()">
          <AppIcon name="plus" class="h-4 w-4" /> 新增商品
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
      <ListHeading title="課程訂單" description="確認款項、批次調整狀態，發券仍需逐筆確認。" />
      <ListToolbar v-model="listState.orders.q" :loading="loading.orders" :has-filters="hasFilters('orders')" placeholder="搜尋訂單、購買人、Email、課程或末五碼" @refresh="loadList('orders', { force: true })" @clear="clearFilters('orders')">
        <AdminFilterSheet :model-value="filters.orders" :columns="orderFilterColumns" title="課程訂單篩選" @update:model-value="filters.orders = $event" @apply="applyFilters('orders', $event)" />
      </ListToolbar>
      <div v-if="selectedOrderIds.length" class="surface-section flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p class="text-sm text-slate-700">已選 {{ selectedOrderIds.length }} 筆目前頁訂單</p><div class="flex flex-col gap-2 sm:flex-row"><select v-model="bulkOrderStatus" class="min-w-40"><option value="" disabled>選擇批次狀態</option><option v-for="option in bulkOrderStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select><button type="button" class="btn btn-primary text-white" :disabled="!bulkOrderStatus || bulkSaving" @click="bulkUpdateOrders">{{ bulkSaving ? '更新中…' : '套用批次狀態' }}</button><button type="button" class="btn btn-outline" :disabled="bulkSaving" @click="clearOrderSelection">取消選取</button></div></div>
      <ListError v-if="errors.orders" :message="errors.orders" @retry="loadList('orders', { force: true })" />
      <AdminTableState v-else :loading="loading.orders" :empty="!orders.length" :empty-text="emptyText('orders', '尚無課程訂單。')">
        <div class="hidden overflow-x-auto md:block"><table class="table-default min-w-[1320px]"><thead><tr><th><input type="checkbox" :checked="allVisibleOrdersSelected" :aria-label="allVisibleOrdersSelected ? '取消選取目前頁訂單' : '選取目前頁訂單'" @change="toggleAllVisibleOrders($event.target.checked)" /></th><th>訂單</th><th><TableColumnFilter mode="server" label="購買人" :fields="columnFields(orderFilterColumns, 'user')" :model-value="filters.orders.user" @update:model-value="setColumnFilter('orders', 'user', $event)" @apply="applyColumnFilter('orders', 'user', $event)" /></th><th><TableColumnFilter mode="server" label="課程" :fields="columnFields(orderFilterColumns, 'product')" :model-value="filters.orders.product" @update:model-value="setColumnFilter('orders', 'product', $event)" @apply="applyColumnFilter('orders', 'product', $event)" /></th><th v-if="isAdmin"><TableColumnFilter mode="server" label="服務商" :fields="columnFields(orderFilterColumns, 'provider')" :model-value="filters.orders.provider" @update:model-value="setColumnFilter('orders', 'provider', $event)" @apply="applyColumnFilter('orders', 'provider', $event)" /></th><th><TableColumnFilter mode="server" label="數量／金額" :fields="columnFields(orderFilterColumns, 'amount')" :model-value="filters.orders.amount" @update:model-value="setColumnFilter('orders', 'amount', $event)" @apply="applyColumnFilter('orders', 'amount', $event)" /></th><th><TableColumnFilter mode="server" label="後五碼" :fields="columnFields(orderFilterColumns, 'remittance')" :model-value="filters.orders.remittance" @update:model-value="setColumnFilter('orders', 'remittance', $event)" @apply="applyColumnFilter('orders', 'remittance', $event)" /></th><th><TableColumnFilter mode="server" label="狀態" :fields="columnFields(orderFilterColumns, 'status')" :model-value="filters.orders.status" @update:model-value="setColumnFilter('orders', 'status', $event)" @apply="applyColumnFilter('orders', 'status', $event)" /></th><th><TableColumnFilter mode="server" label="建立時間" :fields="columnFields(orderFilterColumns, 'created')" :model-value="filters.orders.created" @update:model-value="setColumnFilter('orders', 'created', $event)" @apply="applyColumnFilter('orders', 'created', $event)" /></th><th>操作</th></tr></thead><tbody><tr v-for="order in orders" :key="order.id"><td><input type="checkbox" :checked="isOrderSelected(order)" :aria-label="`選取訂單 ${order.code}`" @change="toggleOrder(order, $event.target.checked)" /></td><td class="font-medium text-slate-900">{{ order.code }}</td><td><p>{{ order.buyerName }}</p><p class="text-sm text-slate-500">{{ order.buyerEmail }}</p></td><td>{{ order.productName }}</td><td v-if="isAdmin">{{ providerDisplay(order) }}</td><td>{{ order.quantity }} 份／<span class="money-value">NT$ {{ formatMoney(order.totalAmount) }}</span></td><td>{{ order.remittanceLast5 || '—' }}</td><td><span class="ops-chip" :class="statusChip(order.status)">{{ orderStatusLabel(order.status) }}</span></td><td>{{ formatDateTime(order.createdAt) }}</td><td><div class="flex gap-2"><button type="button" class="btn btn-outline btn-sm" @click="openOrderDetail(order)">詳情</button><button v-if="order.status !== 'issued'" type="button" class="btn btn-primary btn-sm text-white" :disabled="busyId === `order-${order.id}`" @click="issueOrder(order)">發券</button></div></td></tr></tbody></table></div>
        <div class="grid gap-3 p-3 md:hidden"><article v-for="order in orders" :key="`mobile-order-${order.id}`" class="rounded-lg border border-slate-200 p-4"><div class="flex items-start justify-between gap-3"><label class="flex items-center gap-2"><input type="checkbox" :checked="isOrderSelected(order)" @change="toggleOrder(order, $event.target.checked)" /><span class="font-medium text-slate-950">{{ order.code }}</span></label><span class="ops-chip" :class="statusChip(order.status)">{{ orderStatusLabel(order.status) }}</span></div><p class="mt-3 text-sm">{{ order.buyerName }}・{{ order.productName }}</p><p class="mt-1 text-sm text-slate-500">{{ order.quantity }} 份・NT$ {{ formatMoney(order.totalAmount) }}・{{ formatDateTime(order.createdAt) }}</p><p v-if="isAdmin" class="mt-1 text-sm text-slate-500">{{ providerDisplay(order) }}</p><div class="mt-4 flex gap-2"><button type="button" class="btn btn-outline btn-sm flex-1" @click="openOrderDetail(order)">詳情</button><button v-if="order.status !== 'issued'" type="button" class="btn btn-primary btn-sm flex-1 text-white" :disabled="busyId === `order-${order.id}`" @click="issueOrder(order)">發券</button></div></article></div>
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
      <ListHeading title="預約與核銷" description="調整預約狀態；只有核銷出席會扣除票券 1 堂。"><button type="button" class="btn btn-primary text-white" @click="emit('navigate', 'scan')"><AppIcon name="camera" class="h-4 w-4" /> 掃描核銷</button></ListHeading>
      <ListToolbar v-model="listState.bookings.q" :loading="loading.bookings" :has-filters="hasFilters('bookings')" placeholder="搜尋場次、票券、商品、姓名或 Email" @refresh="loadList('bookings', { force: true })" @clear="clearFilters('bookings')"><AdminFilterSheet :model-value="filters.bookings" :columns="bookingFilterColumns" title="課程預約篩選" @update:model-value="filters.bookings = $event" @apply="applyFilters('bookings', $event)" /></ListToolbar>
      <ListError v-if="errors.bookings" :message="errors.bookings" @retry="loadList('bookings', { force: true })" />
      <AdminTableState v-else :loading="loading.bookings" :empty="!bookings.length" :empty-text="emptyText('bookings', '尚無課程預約。')">
        <div class="hidden overflow-x-auto md:block"><table class="table-default min-w-[1380px]"><thead><tr><th><TableColumnFilter mode="server" label="場次" :fields="columnFields(bookingFilterColumns, 'session')" :model-value="filters.bookings.session" @update:model-value="setColumnFilter('bookings', 'session', $event)" @apply="applyColumnFilter('bookings', 'session', $event)" /></th><th><TableColumnFilter mode="server" label="學員" :fields="columnFields(bookingFilterColumns, 'user')" :model-value="filters.bookings.user" @update:model-value="setColumnFilter('bookings', 'user', $event)" @apply="applyColumnFilter('bookings', 'user', $event)" /></th><th><TableColumnFilter mode="server" label="票券／商品" :fields="columnFields(bookingFilterColumns, 'ticket')" :model-value="filters.bookings.ticket" @update:model-value="setColumnFilter('bookings', 'ticket', $event)" @apply="applyColumnFilter('bookings', 'ticket', $event)" /></th><th v-if="isAdmin"><TableColumnFilter mode="server" label="服務商" :fields="columnFields(bookingFilterColumns, 'provider')" :model-value="filters.bookings.provider" @update:model-value="setColumnFilter('bookings', 'provider', $event)" @apply="applyColumnFilter('bookings', 'provider', $event)" /></th><th><TableColumnFilter mode="server" label="預約時間" :fields="columnFields(bookingFilterColumns, 'booked')" :model-value="filters.bookings.booked" @update:model-value="setColumnFilter('bookings', 'booked', $event)" @apply="applyColumnFilter('bookings', 'booked', $event)" /></th><th><TableColumnFilter mode="server" label="場次時間" :fields="columnFields(bookingFilterColumns, 'starts')" :model-value="filters.bookings.starts" @update:model-value="setColumnFilter('bookings', 'starts', $event)" @apply="applyColumnFilter('bookings', 'starts', $event)" /></th><th><TableColumnFilter mode="server" label="狀態" :fields="columnFields(bookingFilterColumns, 'status')" :model-value="filters.bookings.status" @update:model-value="setColumnFilter('bookings', 'status', $event)" @apply="applyColumnFilter('bookings', 'status', $event)" /></th><th>操作</th></tr></thead><tbody><tr v-for="booking in bookings" :key="booking.id"><td><p class="font-medium text-slate-900">{{ booking.sessionTitle }}</p><p class="text-sm text-slate-500">{{ booking.sessionCode }}</p></td><td><p>{{ booking.attendeeName }}</p><p class="text-sm text-slate-500">{{ booking.attendeeEmail }}</p></td><td><p>{{ booking.ticketCode }}</p><p class="text-sm text-slate-500">{{ booking.productName || '' }}・剩餘 {{ booking.remainingUses }} 堂</p></td><td v-if="isAdmin">{{ providerDisplay(booking) }}</td><td>{{ formatDateTime(booking.bookedAt || booking.createdAt) }}</td><td><p>{{ formatDateTime(booking.startsAt) }}</p><p class="text-sm text-slate-500">{{ booking.location || '地點待公告' }}</p></td><td><span class="ops-chip" :class="statusChip(booking.status)">{{ bookingStatusLabel(booking.status) }}</span></td><td><div class="flex gap-2"><button type="button" class="btn btn-outline btn-sm" @click="openBookingDetail(booking)">詳情</button><button v-if="booking.status === 'booked'" type="button" class="btn btn-primary btn-sm text-white" :disabled="busyId === `booking-${booking.id}`" @click="attendBooking(booking)">核銷出席</button></div></td></tr></tbody></table></div>
        <div class="grid gap-3 p-3 md:hidden"><article v-for="booking in bookings" :key="`mobile-booking-${booking.id}`" class="rounded-lg border border-slate-200 p-4"><div class="flex items-start justify-between gap-3"><div><p class="font-medium text-slate-950">{{ booking.sessionTitle }}</p><p class="text-sm text-slate-500">{{ booking.attendeeName }}・{{ booking.ticketCode }}</p></div><span class="ops-chip" :class="statusChip(booking.status)">{{ bookingStatusLabel(booking.status) }}</span></div><p class="mt-3 text-sm">{{ formatDateTime(booking.startsAt) }}</p><p class="mt-1 text-sm text-slate-500">{{ booking.location || '地點待公告' }}</p><p v-if="isAdmin" class="mt-1 text-sm text-slate-500">{{ providerDisplay(booking) }}</p><div class="mt-4 flex gap-2"><button type="button" class="btn btn-outline btn-sm flex-1" @click="openBookingDetail(booking)">詳情</button><button v-if="booking.status === 'booked'" type="button" class="btn btn-primary btn-sm flex-1 text-white" :disabled="busyId === `booking-${booking.id}`" @click="attendBooking(booking)">核銷出席</button></div></article></div>
      </AdminTableState>
      <AdminPagination v-if="!errors.bookings" v-bind="meta.bookings" :loading="loading.bookings" @change="changePage('bookings', $event)" />
    </section>

    <transition name="backdrop-fade"><div v-if="dialogOpen" class="fixed inset-0 z-50 bg-slate-950/40" @click.self="requestCloseDialog"></div></transition>
    <transition name="drawer-right"><aside v-if="dialogOpen" class="ops-drawer ops-drawer-wide">
      <header class="mb-5 flex items-start justify-between gap-3"><div><p class="text-sm text-slate-500">{{ dialogEyebrow }}</p><h2 class="ui-title text-2xl text-slate-950">{{ dialogTitle }}</h2></div><button type="button" class="btn btn-ghost btn-sm" :disabled="submitting" aria-label="關閉" @click="requestCloseDialog"><AppIcon name="x" class="h-5 w-5" /></button></header>
      <form v-if="dialogType === 'product'" class="space-y-4" @submit.prevent="saveProduct"><fieldset :disabled="submitting" class="min-w-0 space-y-4 border-0 p-0">
        <FormField v-if="isAdmin && !editingId" label="課程歸屬"><select v-model="productForm.ownerUserId" class="w-full"><option value="">平台課程</option><option v-for="provider in providerOptions" :key="provider.id" :value="provider.id">{{ provider.label }}</option></select></FormField>
        <div class="grid gap-4 sm:grid-cols-2"><FormField label="商品名稱" required><input v-model.trim="productForm.name" required class="w-full" /></FormField><FormField label="分類"><input v-model.trim="productForm.category" class="w-full" placeholder="例如：游泳團練" /></FormField><FormField label="售價"><input v-model.number="productForm.price" type="number" min="0" required class="w-full" /></FormField><FormField label="堂數"><input v-model.number="productForm.classCount" type="number" min="1" required class="w-full" /></FormField><FormField label="開卡後效期（天）"><input v-model.number="productForm.validDays" type="number" min="1" required class="w-full" /></FormField><FormField label="發券後開卡期限（天）"><input v-model.number="productForm.activationDays" type="number" min="1" required class="w-full" /></FormField><FormField label="發布狀態"><select v-model="productForm.status" class="w-full"><option value="draft">草稿</option><option value="published">已發布</option><option value="archived">已封存</option></select></FormField><FormField label="排序"><input v-model.number="productForm.sortOrder" type="number" class="w-full" /></FormField></div>
        <FormField label="簡介"><textarea v-model.trim="productForm.summary" rows="2" class="w-full"></textarea></FormField><FormField label="完整說明"><textarea v-model.trim="productForm.description" rows="6" class="w-full"></textarea></FormField><FormField label="外部購買網址"><input v-model.trim="productForm.externalPurchaseUrl" type="url" class="w-full" placeholder="留空時使用平台購買流程" /></FormField>
        <div class="space-y-2 text-sm font-medium text-slate-700"><span>課程封面</span><div class="relative aspect-[3/2] w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-slate-100"><img v-if="courseCoverPreview" :src="courseCoverPreview" :alt="`${productForm.name || '課程'}封面預覽`" class="h-full w-full object-cover" @error="handleCourseCoverPreviewError" /><div v-else class="flex h-full flex-col items-center justify-center gap-2 text-slate-400"><AppIcon name="image" class="h-10 w-10" /><span>尚未設定封面</span></div><div v-if="coverProcessing || coverLoading" class="absolute inset-0 grid place-items-center bg-white/85 text-sm text-slate-600">{{ coverProcessing ? '圖片處理中…' : '封面載入中…' }}</div></div><input ref="courseCoverInput" type="file" accept="image/*" class="hidden" @change="selectCourseCover" /><div class="flex flex-wrap gap-2"><button type="button" class="btn btn-outline btn-sm" :disabled="submitting || coverProcessing || coverLoading || coverRemoving" @click="openCourseCoverPicker"><AppIcon name="image" class="h-4 w-4" /> {{ hasCourseCover ? '更換圖片' : '選擇圖片' }}</button><button v-if="coverUploadData" type="button" class="btn btn-ghost btn-sm" @click="clearSelectedCourseCover">取消新圖片</button><button v-if="hasSavedCourseCover" type="button" class="btn btn-outline btn-sm text-red-700" @click="removeCourseCover">移除目前封面</button><button v-if="coverRemovalPending" type="button" class="btn btn-ghost btn-sm" @click="undoCourseCoverRemoval">復原目前封面</button></div><p v-if="coverError" class="font-normal text-red-600">{{ coverError }}</p><label class="block space-y-2"><span>或使用圖片網址</span><input v-model.trim="productForm.coverUrl" type="url" class="w-full" placeholder="https://example.com/course-cover.jpg" /></label></div>
        <label class="flex items-center gap-3 text-sm text-slate-700"><input v-model="productForm.transferable" type="checkbox" class="h-4 w-4" /> 允許學員轉讓此票券</label><button class="btn btn-primary w-full text-white" :disabled="submitting || coverProcessing || coverRemoving">{{ submitting ? '儲存中…' : '儲存商品' }}</button>
      </fieldset></form>
      <form v-else-if="dialogType === 'session'" class="space-y-4" @submit.prevent="saveSession"><FormField label="場次名稱" required><input v-model.trim="sessionForm.title" required class="w-full" /></FormField><div class="grid gap-4 sm:grid-cols-2"><FormField label="適用商品"><select v-model="sessionForm.productId" class="w-full" @change="syncSessionOwnerFromProduct"><option value="">同服務商全部課程票券</option><option v-for="product in activeProducts" :key="product.id" :value="String(product.id)">{{ product.name }}</option></select></FormField><FormField v-if="isAdmin" label="場次歸屬"><select v-model="sessionForm.ownerUserId" class="w-full" :disabled="Boolean(sessionForm.productId)"><option value="">平台課程</option><option v-for="provider in providerOptions" :key="provider.id" :value="provider.id">{{ provider.label }}</option></select></FormField><FormField label="狀態"><select v-model="sessionForm.status" class="w-full"><option value="draft">草稿</option><option value="open">開放預約</option><option value="closed">關閉預約</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></FormField><FormField label="開始時間" required><input v-model="sessionForm.startsAt" type="datetime-local" required class="w-full" /></FormField><FormField label="結束時間" required><input v-model="sessionForm.endsAt" type="datetime-local" required class="w-full" /></FormField><FormField label="預約開放時間"><input v-model="sessionForm.bookingOpenAt" type="datetime-local" class="w-full" /></FormField><FormField label="預約截止時間"><input v-model="sessionForm.bookingCloseAt" type="datetime-local" class="w-full" /></FormField><FormField label="教練姓名"><input v-model.trim="sessionForm.coachName" class="w-full" /></FormField><FormField label="地點"><input v-model.trim="sessionForm.location" class="w-full" /></FormField><FormField label="名額"><input v-model.number="sessionForm.capacity" type="number" min="1" class="w-full" /></FormField></div><FormField label="場次備註"><textarea v-model.trim="sessionForm.notes" rows="4" class="w-full"></textarea></FormField><button class="btn btn-primary w-full text-white" :disabled="submitting">{{ submitting ? '儲存中…' : '儲存場次' }}</button></form>
      <form v-else class="space-y-4" @submit.prevent="issueManualTicket"><FormField label="持有人 Email" required><input v-model.trim="ticketForm.ownerEmail" type="email" required class="w-full" /></FormField><FormField label="課程商品" required><select v-model="ticketForm.productId" required class="w-full"><option value="" disabled>請選擇商品</option><option v-for="product in activeProducts" :key="product.id" :value="String(product.id)">{{ product.name }}（{{ product.classCount }} 堂）</option></select></FormField><p class="text-sm leading-6 text-slate-600">手動發券不會建立購買訂單。</p><button class="btn btn-primary w-full text-white" :disabled="submitting">{{ submitting ? '發券中…' : '確認發券' }}</button></form>
    </aside></transition>

    <AppBottomSheet v-model="detailOpen">
      <div class="space-y-5">
        <header><p class="text-sm text-slate-500">{{ detailEyebrow }}</p><h2 class="ui-title text-xl text-slate-950">{{ detailTitle }}</h2></header>
        <p v-if="detailLoading" class="text-sm text-slate-600">詳細資料載入中…</p>
        <template v-else-if="detailType === 'order' && detailRecord">
          <DetailGrid :items="orderDetailItems" />
          <FormField label="訂單狀態"><select v-model="detailRecord.status" class="w-full" :disabled="detailRecord.status === 'issued'"><option v-for="option in orderDetailStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></FormField>
          <FormField label="備註"><textarea v-model.trim="detailRecord.note" rows="3" class="w-full"></textarea></FormField>
          <div class="grid grid-cols-2 gap-2"><button type="button" class="btn btn-outline" :disabled="detailSaving || detailRecord.status === 'issued'" @click="saveOrderDetail">儲存狀態</button><button v-if="detailRecord.status !== 'issued'" type="button" class="btn btn-primary text-white" :disabled="detailSaving" @click="issueOrder(detailRecord)">逐筆發券</button></div>
        </template>
        <template v-else-if="detailType === 'ticket' && detailRecord">
          <DetailGrid :items="ticketDetailItems" />
          <div class="grid gap-4 sm:grid-cols-2"><FormField label="剩餘堂數"><input v-model.number="detailRecord.remainingUses" type="number" min="0" max="9999" class="w-full" /></FormField><FormField label="效期"><input v-model="detailRecord.expiresAt" type="date" class="w-full" /></FormField><FormField label="狀態"><select v-model="detailRecord.status" class="w-full"><option v-for="option in ticketStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></FormField></div>
          <button type="button" class="btn btn-primary w-full text-white" :disabled="detailSaving" @click="saveTicketDetail">{{ detailSaving ? '儲存中…' : '儲存票券' }}</button>
          <section class="space-y-3 border-t border-slate-200 pt-4"><h3 class="font-medium text-slate-900">票券活動紀錄</h3><p v-if="activityLoading" class="text-sm text-slate-500">紀錄載入中…</p><p v-else-if="!ticketActivity.length" class="text-sm text-slate-500">尚無活動紀錄。</p><ol v-else class="space-y-3"><li v-for="(activity, index) in ticketActivity" :key="activity.id || `${activity.type}-${index}`" class="rounded-lg border border-slate-200 p-3"><p class="font-medium text-slate-900">{{ activity.label || activity.action || activity.type || '票券紀錄' }}</p><p class="mt-1 text-sm text-slate-500">{{ activity.description || activity.note || activity.actorName || '' }}</p><p class="mt-1 text-xs text-slate-400">{{ formatDateTime(activity.createdAt || activity.created_at || activity.occurredAt) }}</p></li></ol><button v-if="activityHasMore" type="button" class="btn btn-outline w-full" :disabled="activityLoading" @click="loadTicketActivity(false)">載入更多</button></section>
        </template>
        <template v-else-if="detailType === 'booking' && detailRecord">
          <DetailGrid :items="bookingDetailItems" />
          <FormField label="預約狀態"><select v-model="detailRecord.status" class="w-full" :disabled="detailRecord.status === 'attended'"><option value="booked">已預約</option><option value="cancelled">已取消</option><option value="no_show">未到</option><option v-if="detailRecord.status === 'attended'" value="attended">已出席</option></select></FormField>
          <div class="grid grid-cols-2 gap-2"><button type="button" class="btn btn-outline" :disabled="detailSaving || detailRecord.status === 'attended'" @click="saveBookingStatus">儲存狀態</button><button v-if="detailRecord.status === 'booked'" type="button" class="btn btn-primary text-white" :disabled="detailSaving" @click="attendBooking(detailRecord)">核銷出席</button></div>
        </template>
      </div>
    </AppBottomSheet>
  </section>
</template>

<script setup>
import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { formatDateTime, formatDateTimeRange } from '../utils/datetime'
import { normalizeHttpUrl } from '../utils/safeUrl'
import AppBottomSheet from '../components/AppBottomSheet.vue'
import AppIcon from '../components/AppIcon.vue'
import AppSearchInput from '../components/AppSearchInput.vue'
import AdminFilterSheet from '../components/AdminFilterSheet.vue'
import AdminPagination from '../components/AdminPagination.vue'
import TableColumnFilter from '../components/TableColumnFilter.vue'

const props = defineProps({
  mode: { type: String, default: 'manage', validator: value => ['manage', 'orders', 'tickets'].includes(value) },
  currentRole: { type: String, default: '' },
  currentUserId: { type: [String, Number], default: '' },
})
const emit = defineEmits(['navigate'])
const API = API_BASE
const normalizeRole = value => { const role = String(value || '').trim().toUpperCase(); return role === 'STORE' || role === 'COACH' ? 'SERVICE_PROVIDER' : role }
const role = computed(() => normalizeRole(props.currentRole))
const isAdmin = computed(() => role.value === 'ADMIN')
const focusedMode = computed(() => props.mode === 'orders' || props.mode === 'tickets')
const tabs = [{ key: 'overview', label: '總覽' }, { key: 'products', label: '課程商品' }, { key: 'sessions', label: '場次' }, { key: 'bookings', label: '預約核銷' }]
const activeTab = ref(focusedMode.value ? props.mode : 'overview')
const overview = ref({ products: 0, openSessions: 0, pendingOrders: 0, activeTickets: 0, upcomingBookings: 0 })
const products = ref([])
const productChoices = ref([])
const sessions = ref([])
const orders = ref([])
const tickets = ref([])
const bookings = ref([])
const providers = ref([])
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

const providerOptions = computed(() => {
  const found = new Map(providers.value.map(item => [String(item.id), { id: String(item.id), label: item.username || item.email || String(item.id) }]))
  for (const row of [...products.value, ...sessions.value, ...orders.value, ...tickets.value, ...bookings.value]) {
    const id = ownerId(row)
    if (id && !found.has(id)) found.set(id, { id, label: row.providerName || row.provider_name || id })
  }
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
})
const providerSelectOptions = computed(() => providerOptions.value.map(item => ({ value: item.id, label: item.label })))
const productSelectOptions = computed(() => activeProducts.value.map(item => ({ value: String(item.id), label: item.name })))
const activeProducts = computed(() => (productChoices.value.length ? productChoices.value : products.value).filter(item => item.status !== 'archived'))
const activeSummary = computed(() => summaries[activeTab.value] || {})
const overviewCards = computed(() => [
  { key: 'products', label: '課程商品', value: overview.value.products, hint: '前往商品管理' },
  { key: 'sessions', label: '開放場次', value: overview.value.openSessions, hint: '前往場次管理' },
  { key: 'orders', label: '待處理訂單', value: overview.value.pendingOrders, hint: '至「訂單」查看課程分類' },
  { key: 'tickets', label: '有效票券', value: overview.value.activeTickets, hint: '至「票券」查看課程分類' },
  { key: 'bookings', label: '待出席預約', value: overview.value.upcomingBookings, hint: '前往預約核銷' },
])

const productStatuses = [{ value: 'draft', label: '草稿' }, { value: 'published', label: '已發布' }, { value: 'archived', label: '已封存' }]
const sessionStatuses = [{ value: 'draft', label: '草稿' }, { value: 'open', label: '開放預約' }, { value: 'closed', label: '關閉預約' }, { value: 'completed', label: '已完成' }, { value: 'cancelled', label: '已取消' }]
const orderStatusOptions = [{ value: 'pending', label: '待匯款' }, { value: 'payment_review', label: '款項確認中' }, { value: 'paid', label: '已付款' }, { value: 'issued', label: '已發券' }, { value: 'cancelled', label: '已取消' }, { value: 'refunded', label: '已退款' }]
const bulkOrderStatusOptions = orderStatusOptions.filter(item => item.value !== 'issued')
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
const emptyProductForm = () => ({ ownerUserId: '', name: '', category: '', summary: '', description: '', coverUrl: '', externalPurchaseUrl: '', hasCover: false, price: 0, classCount: 1, validDays: 120, activationDays: 120, transferable: false, status: 'draft', sortOrder: 0 })
const emptySessionForm = () => ({ ownerUserId: '', productId: '', title: '', coachName: '', location: '', startsAt: '', endsAt: '', bookingOpenAt: '', bookingCloseAt: '', capacity: 20, notes: '', status: 'draft' })
const productForm = ref(emptyProductForm())
const sessionForm = ref(emptySessionForm())
const ticketForm = ref({ ownerEmail: '', productId: '' })
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
const dialogTitle = computed(() => dialogType.value === 'product' ? (editingId.value ? '編輯商品' : '新增商品') : dialogType.value === 'session' ? (editingId.value ? '編輯場次' : '新增場次') : '手動發券')

const detailOpen = ref(false)
const detailType = ref('')
const detailRecord = ref(null)
const orderDetailStatusOptions = computed(() => detailRecord.value?.status === 'issued'
  ? orderStatusOptions.filter(item => item.value === 'issued')
  : bulkOrderStatusOptions)
const detailLoading = ref(false)
const detailSaving = ref(false)
const ticketActivity = ref([])
const activityCursor = ref('')
const activityHasMore = ref(false)
const activityLoading = ref(false)
const detailEyebrow = computed(() => detailType.value === 'order' ? '課程訂單' : detailType.value === 'ticket' ? '課程票券' : '課程預約')
const detailTitle = computed(() => detailRecord.value?.code || detailRecord.value?.sessionTitle || '詳細資料')
const detailItem = (label, value) => ({ label, value: value || '—' })
const orderDetailItems = computed(() => detailRecord.value ? [detailItem('購買人', `${detailRecord.value.buyerName || ''} ${detailRecord.value.buyerEmail || ''}`.trim()), detailItem('課程', detailRecord.value.productName), detailItem('服務商', providerDisplay(detailRecord.value)), detailItem('數量／金額', `${detailRecord.value.quantity || 0} 份／NT$ ${formatMoney(detailRecord.value.totalAmount)}`), detailItem('匯款後五碼', detailRecord.value.remittanceLast5), detailItem('建立時間', formatDateTime(detailRecord.value.createdAt))] : [])
const ticketDetailItems = computed(() => detailRecord.value ? [detailItem('持有人', `${detailRecord.value.ownerName || ''} ${detailRecord.value.ownerEmail || ''}`.trim()), detailItem('商品', detailRecord.value.productName), detailItem('服務商', providerDisplay(detailRecord.value)), detailItem('總堂數', detailRecord.value.totalUses), detailItem('建立時間', formatDateTime(detailRecord.value.createdAt))] : [])
const bookingDetailItems = computed(() => detailRecord.value ? [detailItem('學員', `${detailRecord.value.attendeeName || ''} ${detailRecord.value.attendeeEmail || ''}`.trim()), detailItem('場次', detailRecord.value.sessionTitle), detailItem('票券', detailRecord.value.ticketCode), detailItem('商品', detailRecord.value.productName), detailItem('服務商', providerDisplay(detailRecord.value)), detailItem('時間／地點', `${formatDateTime(detailRecord.value.startsAt)} ${detailRecord.value.location || ''}`.trim())] : [])

const selectedOrderIds = ref([])
const bulkOrderStatus = ref('')
const bulkSaving = ref(false)
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
function formatRange(start, end) { return formatDateTimeRange(start, end, '－') || '時間待設定' }
function productStatusLabel(status) { return Object.fromEntries(productStatuses.map(item => [item.value, item.label]))[status] || status }
function sessionStatusLabel(status) { return Object.fromEntries(sessionStatuses.map(item => [item.value, item.label]))[status] || status }
function orderStatusLabel(status) { return Object.fromEntries(orderStatusOptions.map(item => [item.value, item.label]))[status] || status }
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
  const normalized = { ...item }
  if (key === 'products') normalized._ownerDraft = ownerId(item)
  if (key === 'tickets') normalized.expiresAt = item.expiresAt ? String(item.expiresAt).slice(0, 10) : ''
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
async function loadTab(key) { if (key === 'overview') return loadOverview(); const tasks = [loadList(key, { force: true })]; if (['sessions', 'tickets'].includes(key)) tasks.push(loadProductChoices()); await Promise.all(tasks) }
function selectTab(key) { activeTab.value = key; loadTab(key) }
function openOverviewItem(item) { if (['orders', 'tickets'].includes(item?.key)) return emit('navigate', item.key); if (item?.key) selectTab(item.key) }

function releaseCourseCoverObjectUrl() { if (coverObjectUrl && typeof URL !== 'undefined') URL.revokeObjectURL(coverObjectUrl); coverObjectUrl = ''; storedCoverPreview.value = '' }
function resetCourseCoverState() { coverPreviewRequestId += 1; coverProcessRequestId += 1; releaseCourseCoverObjectUrl(); coverUploadData.value = ''; coverLoading.value = false; coverProcessing.value = false; coverRemoving.value = false; coverRemovalPending.value = false; coverError.value = ''; if (courseCoverInput.value) courseCoverInput.value.value = '' }
function closeDialog() { dialogOpen.value = false; editingId.value = null; resetCourseCoverState() }
function requestCloseDialog() { if (!submitting.value) closeDialog() }
function openCourseCoverPicker() { courseCoverInput.value?.click() }
function processCourseCover(file) { return new Promise((resolve, reject) => { if (!file || !/^image\//.test(file.type)) return reject(new Error('請選擇圖片檔案')); if (file.size > COVER_MAX_FILE_BYTES) return reject(new Error('圖片檔案不得超過 10MB')); const reader = new FileReader(); reader.onerror = () => reject(new Error('讀取圖片失敗')); reader.onload = () => { const image = new Image(); image.onerror = () => reject(new Error('圖片格式無法讀取')); image.onload = () => { try { const width = image.naturalWidth || image.width; const height = image.naturalHeight || image.height; if (!width || !height) return reject(new Error('圖片尺寸無效')); if (width * height > COVER_MAX_SOURCE_PIXELS) return reject(new Error('圖片解析度過大')); let cropWidth = width; let cropHeight = height; if (width / height > COVER_TARGET_RATIO) cropWidth = Math.max(1, Math.floor(height * COVER_TARGET_RATIO)); else cropHeight = Math.max(1, Math.floor(width / COVER_TARGET_RATIO)); const canvas = document.createElement('canvas'); canvas.width = COVER_TARGET_WIDTH; canvas.height = COVER_TARGET_HEIGHT; const context = canvas.getContext('2d'); if (!context) return reject(new Error('瀏覽器無法處理圖片')); context.drawImage(image, Math.floor((width - cropWidth) / 2), Math.floor((height - cropHeight) / 2), cropWidth, cropHeight, 0, 0, COVER_TARGET_WIDTH, COVER_TARGET_HEIGHT); return resolve(canvas.toDataURL('image/jpeg', 0.85)) } catch { return reject(new Error('圖片轉換失敗')) } }; image.src = String(reader.result || '') }; reader.readAsDataURL(file) }) }
async function selectCourseCover(event) { const file = event?.target?.files?.[0]; if (!file) return; const requestId = ++coverProcessRequestId; coverProcessing.value = true; coverError.value = ''; try { const dataUrl = await processCourseCover(file); if (requestId === coverProcessRequestId) coverUploadData.value = dataUrl } catch (error) { if (requestId === coverProcessRequestId) coverError.value = error?.message || '圖片處理失敗' } finally { if (requestId === coverProcessRequestId) coverProcessing.value = false; if (event?.target) event.target.value = '' } }
function clearSelectedCourseCover() { coverProcessRequestId += 1; coverUploadData.value = ''; coverProcessing.value = false; coverError.value = '' }
function handleCourseCoverPreviewError() { coverError.value = '目前無法載入封面預覽，請確認圖片網址或重新選擇圖片。' }
async function loadStoredCourseCover(product) { if (!product?.id || !product?.hasCover) return; const requestId = ++coverPreviewRequestId; coverLoading.value = true; try { const version = product.updatedAt ? `?v=${encodeURIComponent(product.updatedAt)}` : ''; const { data } = await axios.get(`${API}/admin/courses/products/${product.id}/cover${version}`, { responseType: 'blob' }); if (requestId !== coverPreviewRequestId) return; releaseCourseCoverObjectUrl(); coverObjectUrl = URL.createObjectURL(data); storedCoverPreview.value = coverObjectUrl } catch { if (requestId === coverPreviewRequestId) coverError.value = '封面已上傳，但目前無法載入預覽。' } finally { if (requestId === coverPreviewRequestId) coverLoading.value = false } }
function removeCourseCover() { if (externalCourseCover.value) { productForm.value.coverUrl = ''; return } if (productForm.value.hasCover && editingId.value && window.confirm('確定移除目前的課程封面？儲存商品後才會套用。')) { coverRemovalPending.value = true; productForm.value.hasCover = false } }
function undoCourseCoverRemoval() { coverRemovalPending.value = false; productForm.value.hasCover = true }

function openProductForm(product = null) { resetCourseCoverState(); editingId.value = product?.id || null; productForm.value = product ? { ...emptyProductForm(), ...product, ownerUserId: ownerId(product) } : emptyProductForm(); dialogType.value = 'product'; dialogOpen.value = true; if (product?.hasCover) loadStoredCourseCover(product) }
async function saveProduct() {
  submitting.value = true
  const { id, code, hasCover, createdAt, updatedAt, _ownerDraft, ownerUserId, ...payload } = productForm.value
  if (isAdmin.value && !editingId.value) payload.ownerUserId = ownerUserId || null
  const external = normalizeHttpUrl(payload.coverUrl, '')
  const externalPurchaseUrl = normalizeHttpUrl(payload.externalPurchaseUrl, '')
  if (String(payload.coverUrl || '').trim() && !external) { coverError.value = '封面圖片網址僅支援 http 或 https'; submitting.value = false; return }
  if (String(payload.externalPurchaseUrl || '').trim() && !externalPurchaseUrl) { showMessage('外部購買網址僅支援 http 或 https', 'error'); submitting.value = false; return }
  if (external) payload.coverUrl = external
  payload.externalPurchaseUrl = externalPurchaseUrl
  try {
    const response = editingId.value ? await axios.patch(`${API}/admin/courses/products/${editingId.value}`, payload) : await axios.post(`${API}/admin/courses/products`, payload)
    const productId = editingId.value || Number(response?.data?.data?.id)
    if (!productId) throw new Error('無法取得商品編號')
    editingId.value = productId
    try {
      if (coverUploadData.value) await axios.post(`${API}/admin/courses/products/${productId}/cover_json`, { dataUrl: coverUploadData.value })
      else if (coverRemovalPending.value && !external) await axios.delete(`${API}/admin/courses/products/${productId}/cover`)
    } catch (error) {
      productChoices.value = []
      await Promise.allSettled([loadList('products', { force: true }), loadOverview(), loadProductChoices(true)])
      showMessage(`課程商品已儲存，但封面更新失敗：${error?.response?.data?.message || error?.message || '未知錯誤'}`, 'error')
      return
    }
    closeDialog(); productChoices.value = []; await Promise.all([loadList('products', { force: true }), loadOverview(), loadProductChoices(true)]); showMessage('課程商品已儲存。')
  } catch (error) { showMessage(error?.response?.data?.message || error?.message || '課程商品儲存失敗', 'error') } finally { submitting.value = false }
}
async function archiveProduct(product) { if (!window.confirm(`確定封存「${product.name}」？`)) return; try { await axios.delete(`${API}/admin/courses/products/${product.id}`); productChoices.value = []; await Promise.all([loadList('products', { force: true }), loadOverview()]); showMessage('課程商品已封存。') } catch (error) { showMessage(error?.response?.data?.message || '封存失敗', 'error') } }
function ownerChanged(product) { return String(product?._ownerDraft || '') !== ownerId(product) }
async function reassignProductOwner(product) { if (!isAdmin.value || !ownerChanged(product)) return; const target = product._ownerDraft || null; const label = target ? (providerOptions.value.find(item => item.id === target)?.label || target) : '平台'; if (!window.confirm(`確定將「${product.name}」移轉至${label}？相關場次與歷史管理權會一併移轉。`)) { product._ownerDraft = ownerId(product); return } busyId.value = `owner-${product.id}`; try { await axios.patch(`${API}/admin/courses/products/${product.id}/owner`, { ownerUserId: target }); productChoices.value = []; await Promise.all([loadList('products', { force: true }), loadOverview(), loadProductChoices(true)]); showMessage('課程歸屬已移轉。') } catch (error) { product._ownerDraft = ownerId(product); showMessage(error?.response?.data?.message || '課程歸屬移轉失敗', 'error') } finally { busyId.value = '' } }

async function openSessionForm(session = null) { await loadProductChoices(); editingId.value = session?.id || null; sessionForm.value = session ? { ...emptySessionForm(), ...session, ownerUserId: ownerId(session), productId: session.productId == null ? '' : String(session.productId), startsAt: toLocalDateTime(session.startsAt), endsAt: toLocalDateTime(session.endsAt), bookingOpenAt: toLocalDateTime(session.bookingOpenAt), bookingCloseAt: toLocalDateTime(session.bookingCloseAt) } : emptySessionForm(); syncSessionOwnerFromProduct(); dialogType.value = 'session'; dialogOpen.value = true }
function syncSessionOwnerFromProduct() { if (!sessionForm.value.productId) return; const product = activeProducts.value.find(item => String(item.id) === String(sessionForm.value.productId)); if (product) sessionForm.value.ownerUserId = ownerId(product) }
async function saveSession() { submitting.value = true; const payload = { ...sessionForm.value, productId: sessionForm.value.productId || null }; if (isAdmin.value) payload.ownerUserId = sessionForm.value.ownerUserId || null; else delete payload.ownerUserId; try { if (editingId.value) await axios.patch(`${API}/admin/courses/sessions/${editingId.value}`, payload); else await axios.post(`${API}/admin/courses/sessions`, payload); closeDialog(); await Promise.all([loadList('sessions', { force: true }), loadOverview()]); showMessage('課程場次已儲存。') } catch (error) { showMessage(error?.response?.data?.message || '課程場次儲存失敗', 'error') } finally { submitting.value = false } }
async function cancelSession(session) { if (!window.confirm(`確定取消「${session.title}」？`)) return; try { await axios.delete(`${API}/admin/courses/sessions/${session.id}`); await Promise.all([loadList('sessions', { force: true }), loadOverview()]); showMessage('課程場次已取消。') } catch (error) { showMessage(error?.response?.data?.message || '場次取消失敗', 'error') } }

function isOrderSelected(order) { return selectedOrderSet.value.has(String(order?.id)) }
function toggleOrder(order, checked) { const selected = new Set(selectedOrderIds.value.map(String)); if (checked) selected.add(String(order.id)); else selected.delete(String(order.id)); selectedOrderIds.value = [...selected] }
function toggleAllVisibleOrders(checked) { selectedOrderIds.value = checked ? orders.value.map(item => String(item.id)) : [] }
function clearOrderSelection() { selectedOrderIds.value = []; bulkOrderStatus.value = '' }
async function bulkUpdateOrders() { if (!selectedOrderIds.value.length || !bulkOrderStatus.value || bulkOrderStatus.value === 'issued') return; if (!window.confirm(`確定批次更新 ${selectedOrderIds.value.length} 筆訂單狀態？`)) return; bulkSaving.value = true; try { await axios.patch(`${API}/admin/courses/orders/bulk`, { ids: selectedOrderIds.value, status: bulkOrderStatus.value }); clearOrderSelection(); await Promise.all([loadList('orders', { force: true }), loadOverview()]); showMessage('課程訂單已批次更新。') } catch (error) { showMessage(error?.response?.data?.message || '批次更新失敗', 'error') } finally { bulkSaving.value = false } }
async function issueOrder(order) { if (!window.confirm(`確認依訂單 ${order.code} 發行 ${order.quantity} 張課程票券？`)) return; busyId.value = `order-${order.id}`; detailSaving.value = true; try { await axios.post(`${API}/admin/courses/orders/${order.id}/issue`); detailOpen.value = false; await Promise.all([loadList('orders', { force: true }), loadOverview()]); showMessage(`訂單 ${order.code} 已完成發券。`) } catch (error) { showMessage(error?.response?.data?.message || '訂單發券失敗', 'error') } finally { busyId.value = ''; detailSaving.value = false } }
async function openOrderDetail(order) { const requestId = ++detailRequestSequence; detailType.value = 'order'; detailRecord.value = { ...order }; detailOpen.value = true; detailLoading.value = true; try { const { data } = await axios.get(`${API}/admin/courses/orders/${order.id}`); if (requestId === detailRequestSequence) detailRecord.value = { ...order, ...(data?.data || {}) } } catch (error) { if (requestId === detailRequestSequence) showMessage(error?.response?.data?.message || '訂單詳情載入失敗', 'error') } finally { if (requestId === detailRequestSequence) detailLoading.value = false } }
async function saveOrderDetail() { if (!detailRecord.value) return; detailSaving.value = true; try { await axios.patch(`${API}/admin/courses/orders/${detailRecord.value.id}`, { status: detailRecord.value.status, note: detailRecord.value.note || '' }); detailOpen.value = false; await Promise.all([loadList('orders', { force: true }), loadOverview()]); showMessage('課程訂單已更新。') } catch (error) { showMessage(error?.response?.data?.message || '訂單更新失敗', 'error') } finally { detailSaving.value = false } }

async function openTicketForm() { await loadProductChoices(); ticketForm.value = { ownerEmail: '', productId: activeProducts.value[0]?.id ? String(activeProducts.value[0].id) : '' }; dialogType.value = 'ticket'; editingId.value = null; dialogOpen.value = true }
async function issueManualTicket() { submitting.value = true; try { const { data } = await axios.post(`${API}/admin/courses/tickets`, { ...ticketForm.value, productId: Number(ticketForm.value.productId) }); closeDialog(); await Promise.all([loadList('tickets', { force: true }), loadOverview()]); showMessage(`票券 ${data?.data?.code || ''} 已發行。`) } catch (error) { showMessage(error?.response?.data?.message || '手動發券失敗', 'error') } finally { submitting.value = false } }
async function openTicketDetail(ticket) { detailRequestSequence += 1; activityRequestSequence += 1; detailLoading.value = false; activityLoading.value = false; detailType.value = 'ticket'; detailRecord.value = { ...ticket, expiresAt: ticket.expiresAt ? String(ticket.expiresAt).slice(0, 10) : '' }; detailOpen.value = true; ticketActivity.value = []; activityCursor.value = ''; activityHasMore.value = false; await loadTicketActivity(true) }
async function loadTicketActivity(reset = false) { if (!detailRecord.value?.id || activityLoading.value) return; const requestId = ++activityRequestSequence; const ticketId = detailRecord.value.id; if (reset) { ticketActivity.value = []; activityCursor.value = '' } activityLoading.value = true; try { const { data } = await axios.get(`${API}/admin/courses/tickets/${ticketId}/activity`, { params: { limit: 20, ...(activityCursor.value ? { cursor: activityCursor.value } : {}) } }); if (requestId !== activityRequestSequence || String(detailRecord.value?.id) !== String(ticketId)) return; const payload = data?.data || []; const items = Array.isArray(payload) ? payload : (payload.items || []); ticketActivity.value = reset ? items : [...ticketActivity.value, ...items]; const responseMeta = Array.isArray(payload) ? {} : (payload.meta || {}); activityCursor.value = responseMeta.nextCursor || payload.nextCursor || ''; activityHasMore.value = responseMeta.hasMore != null ? Boolean(responseMeta.hasMore) : Boolean(activityCursor.value) } catch (error) { if (requestId === activityRequestSequence) showMessage(error?.response?.data?.message || '票券活動紀錄載入失敗', 'error') } finally { if (requestId === activityRequestSequence) activityLoading.value = false } }
async function saveTicketDetail() { if (!detailRecord.value) return; detailSaving.value = true; try { await axios.patch(`${API}/admin/courses/tickets/${detailRecord.value.id}`, { remainingUses: detailRecord.value.remainingUses, status: detailRecord.value.status, expiresAt: detailRecord.value.expiresAt || null }); detailOpen.value = false; await Promise.all([loadList('tickets', { force: true }), loadOverview()]); showMessage(`票券 ${detailRecord.value.code} 已更新。`) } catch (error) { showMessage(error?.response?.data?.message || '票券更新失敗', 'error') } finally { detailSaving.value = false } }

async function openBookingDetail(booking) { const requestId = ++detailRequestSequence; detailType.value = 'booking'; detailRecord.value = { ...booking }; detailOpen.value = true; detailLoading.value = true; try { const { data } = await axios.get(`${API}/admin/courses/bookings/${booking.id}`); if (requestId === detailRequestSequence) detailRecord.value = { ...booking, ...(data?.data || {}) } } catch (error) { if (requestId === detailRequestSequence) showMessage(error?.response?.data?.message || '預約詳情載入失敗', 'error') } finally { if (requestId === detailRequestSequence) detailLoading.value = false } }
async function saveBookingStatus() { if (!detailRecord.value || detailRecord.value.status === 'attended') return; detailSaving.value = true; try { await axios.patch(`${API}/admin/courses/bookings/${detailRecord.value.id}/status`, { status: detailRecord.value.status }); detailOpen.value = false; await Promise.all([loadList('bookings', { force: true }), loadOverview()]); showMessage('預約狀態已更新。') } catch (error) { showMessage(error?.response?.data?.message || '預約狀態更新失敗', 'error') } finally { detailSaving.value = false } }
async function attendBooking(booking) { if (!window.confirm(`確認「${booking.attendeeName}」已出席，並扣除票券 1 堂？`)) return; busyId.value = `booking-${booking.id}`; detailSaving.value = true; try { await axios.post(`${API}/admin/courses/bookings/${booking.id}/attend`); detailOpen.value = false; await Promise.all([loadList('bookings', { force: true }), loadOverview()]); showMessage('出席已核銷並扣除 1 堂。') } catch (error) { showMessage(error?.response?.data?.message || '出席核銷失敗', 'error') } finally { busyId.value = ''; detailSaving.value = false } }

async function resetForIdentityChange() {
  detailRequestSequence += 1
  activityRequestSequence += 1
  providerRequestSequence += 1
  productChoicesRequestSequence += 1
  detailLoading.value = false
  activityLoading.value = false
  for (const key of listKeys) { requestSequences[key] = (requestSequences[key] || 0) + 1; requestControllers[key]?.abort(); clearTimeout(searchTimers[key]); listRefs[key].value = []; filters[key] = {}; suppressedSearch.add(key); listState[key].q = ''; suppressedSearch.delete(key); meta[key] = { total: 0, limit: 50, offset: 0, hasMore: false }; summaries[key] = { total: null, byStatus: {} }; errors[key] = '' }
  productChoices.value = []; providers.value = []; detailOpen.value = false; closeDialog(); clearOrderSelection(); await loadProviders(); if (focusedMode.value) await loadTab(props.mode); else { activeTab.value = 'overview'; await Promise.all([loadOverview(), loadList('products', { force: true })]) }
}
watch(() => `${props.currentUserId}:${role.value}:${props.mode}`, (next, previous) => { if (previous != null && next !== previous) resetForIdentityChange() })
onMounted(async () => { await loadProviders(); if (focusedMode.value) await loadTab(props.mode); else await Promise.all([loadOverview(), loadList('products', { force: true })]) })
onBeforeUnmount(() => { overviewRequestSequence += 1; detailRequestSequence += 1; activityRequestSequence += 1; providerRequestSequence += 1; productChoicesRequestSequence += 1; for (const key of listKeys) { requestSequences[key] = (requestSequences[key] || 0) + 1; requestControllers[key]?.abort(); clearTimeout(searchTimers[key]) } resetCourseCoverState() })
</script>
