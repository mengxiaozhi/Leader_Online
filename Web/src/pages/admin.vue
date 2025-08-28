<template>
  <main class="pt-6 pb-12 px-4">
    <div class="max-w-7xl mx-auto">
      <header class="bg-white shadow-sm border-b border-gray-100 mb-8 p-6 flex justify-between items-center">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">管理後台 Dashboard</h1>
          <p class="text-gray-600 mt-1">使用者、商品、活動與訂單管理</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="px-3 py-1 border text-sm" @click="refreshActive" :disabled="loading">重新整理</button>
        </div>
      </header>

      <div class="relative mb-6">
        <div class="flex border-b border-gray-200 relative">
          <div class="tab-indicator" :style="indicatorStyle"></div>
          <button class="relative px-4 py-3 font-semibold" :class="tabClass('users')" @click="setTab('users', 0)">使用者</button>
          <button class="relative px-4 py-3 font-semibold" :class="tabClass('products')" @click="setTab('products', 1)">商品</button>
          <button class="relative px-4 py-3 font-semibold" :class="tabClass('events')" @click="setTab('events', 2)">活動</button>
          <button class="relative px-4 py-3 font-semibold" :class="tabClass('orders')" @click="setTab('orders', 3)">訂單</button>
        </div>
      </div>

      <!-- Users -->
      <section v-if="tab==='users'" class="bg-white border p-4 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-bold">使用者列表</h2>
          <input v-model.trim="userQuery" placeholder="搜尋名稱/Email" class="border px-2 py-1 w-60" />
        </div>
        <div v-if="loading" class="text-gray-500">載入中…</div>
        <div v-else>
          <div v-if="filteredUsers.length===0" class="text-gray-500">沒有資料</div>
          <div v-else class="overflow-auto">
            <table class="min-w-full text-sm">
              <thead>
                <tr class="bg-gray-50 text-left">
                  <th class="px-3 py-2 border">ID</th>
                  <th class="px-3 py-2 border">名稱</th>
                  <th class="px-3 py-2 border">Email</th>
                  <th class="px-3 py-2 border">角色</th>
                  <th class="px-3 py-2 border">建立時間</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in filteredUsers" :key="u.id" class="hover:bg-gray-50">
                  <td class="px-3 py-2 border font-mono truncate max-w-[240px]" :title="u.id">{{ u.id }}</td>
                  <td class="px-3 py-2 border">{{ u.username }}</td>
                  <td class="px-3 py-2 border">{{ u.email }}</td>
                  <td class="px-3 py-2 border uppercase">{{ (u.role || 'user') }}</td>
                  <td class="px-3 py-2 border">{{ u.created_at || u.createdAt }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Products -->
      <section v-if="tab==='products'" class="bg-white border p-4 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-bold">商品列表</h2>
          <div class="flex items-center gap-2">
            <button class="px-2 py-1 border text-sm" @click="showProductForm = !showProductForm">新增商品</button>
          </div>
        </div>
        <div v-if="showProductForm" class="mb-4 border p-3 bg-gray-50">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input v-model.trim="newProduct.name" placeholder="名稱" class="border px-2 py-1" />
            <input v-model.number="newProduct.price" type="number" min="0" step="1" placeholder="價格" class="border px-2 py-1" />
            <input v-model.trim="newProduct.description" placeholder="描述" class="border px-2 py-1" />
          </div>
          <div class="mt-2 flex gap-2">
            <button class="px-2 py-1 border text-sm" @click="createProduct" :disabled="loading">儲存</button>
            <button class="px-2 py-1 border text-sm" @click="showProductForm=false">取消</button>
          </div>
        </div>
        <div v-if="loading" class="text-gray-500">載入中…</div>
        <div v-else>
          <div v-if="products.length===0" class="text-gray-500">沒有資料</div>
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div v-for="p in products" :key="p.id || p.name" class="border p-3 flex flex-col gap-2">
              <!-- View mode -->
              <template v-if="!p._editing">
                <div class="font-semibold text-[#D90000]">{{ p.name }}</div>
                <div class="text-gray-600 text-sm min-h-[2.5rem]">{{ p.description }}</div>
                <div class="mt-1">NT$ {{ p.price }}</div>
                <div class="mt-2 flex gap-2">
                  <button class="px-2 py-1 border text-sm" @click="startEditProduct(p)">編輯</button>
                  <button class="px-2 py-1 border text-sm" @click="deleteProduct(p)" :disabled="loading">刪除</button>
                </div>
              </template>
              <!-- Edit mode -->
              <template v-else>
                <input v-model.trim="p._editing.name" placeholder="名稱" class="border px-2 py-1" />
                <input v-model.number="p._editing.price" type="number" min="0" step="1" placeholder="價格" class="border px-2 py-1" />
                <input v-model.trim="p._editing.description" placeholder="描述" class="border px-2 py-1" />
                <div class="mt-2 flex gap-2">
                  <button class="px-2 py-1 border text-sm" @click="saveEditProduct(p)" :disabled="loading">儲存</button>
                  <button class="px-2 py-1 border text-sm" @click="cancelEditProduct(p)" :disabled="loading">取消</button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </section>

      <!-- Events -->
      <section v-if="tab==='events'" class="bg-white border p-4 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-bold">活動列表</h2>
          <div class="flex items-center gap-2">
            <button class="px-2 py-1 border text-sm" @click="showEventForm = !showEventForm">新增活動</button>
          </div>
        </div>
        <div v-if="showEventForm" class="mb-4 border p-3 bg-gray-50">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input v-model.trim="newEvent.title" placeholder="標題" class="border px-2 py-1" />
            <input v-model.trim="newEvent.code" placeholder="代碼（可選）" class="border px-2 py-1" />
            <input v-model.trim="newEvent.location" placeholder="地點（可選）" class="border px-2 py-1" />
            <input v-model="newEvent.deadline" type="datetime-local" placeholder="截止（可選）" class="border px-2 py-1" />
            <input v-model="newEvent.starts_at" type="datetime-local" placeholder="開始時間" class="border px-2 py-1" />
            <input v-model="newEvent.ends_at" type="datetime-local" placeholder="結束時間" class="border px-2 py-1" />
          </div>
          <div class="grid grid-cols-1 gap-2 mt-2">
            <input v-model.trim="newEvent.description" placeholder="描述（可選）" class="border px-2 py-1" />
            <input v-model.trim="newEvent.rules" placeholder="規則（以逗號分隔，可選）" class="border px-2 py-1" />
          </div>
          <div class="mt-2 flex gap-2">
            <button class="px-2 py-1 border text-sm" @click="createEvent" :disabled="loading">儲存</button>
            <button class="px-2 py-1 border text-sm" @click="showEventForm=false">取消</button>
          </div>
        </div>
        <div v-if="loading" class="text-gray-500">載入中…</div>
        <div v-else>
          <div v-if="events.length===0" class="text-gray-500">沒有資料</div>
          <div v-else class="overflow-auto">
            <table class="min-w-full text-sm">
              <thead>
                <tr class="bg-gray-50 text-left">
                  <th class="px-3 py-2 border">ID</th>
                  <th class="px-3 py-2 border">名稱</th>
                  <th class="px-3 py-2 border">日期/區間</th>
                  <th class="px-3 py-2 border">截止</th>
                  <th class="px-3 py-2 border">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in events" :key="e.id" class="hover:bg-gray-50">
                  <td class="px-3 py-2 border">{{ e.id }}</td>
                  <td class="px-3 py-2 border">{{ e.name || e.title }}</td>
                  <td class="px-3 py-2 border">{{ e.date || formatRange(e.starts_at, e.ends_at) }}</td>
                  <td class="px-3 py-2 border">{{ e.deadline || e.ends_at }}</td>
                  <td class="px-3 py-2 border">
                    <button class="px-2 py-1 border text-sm" @click="openStoreManager(e)">管理店面</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 店面管理 -->
        <div v-if="selectedEvent" class="mt-6 border p-4 bg-gray-50">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold">店面管理：{{ selectedEvent.name || selectedEvent.title }}（ID: {{ selectedEvent.id }}）</h3>
            <button class="px-2 py-1 border text-sm" @click="selectedEvent=null">關閉</button>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div class="border p-3 bg-white">
              <h4 class="font-semibold mb-2">新增店面</h4>
              <div class="grid grid-cols-2 gap-2">
                <input v-model.trim="newStore.name" placeholder="名稱（含地區）" class="border px-2 py-1 col-span-2" />
                <label class="text-xs text-gray-600">賽前開始</label>
                <label class="text-xs text-gray-600">賽前結束</label>
                <input type="date" v-model="newStore.pre_start" class="border px-2 py-1" />
                <input type="date" v-model="newStore.pre_end" class="border px-2 py-1" />
                <label class="text-xs text-gray-600">賽後開始</label>
                <label class="text-xs text-gray-600">賽後結束</label>
                <input type="date" v-model="newStore.post_start" class="border px-2 py-1" />
                <input type="date" v-model="newStore.post_end" class="border px-2 py-1" />
              </div>
              <div class="mt-3">
                <div class="flex items-center justify-between mb-1">
                  <h5 class="font-medium">價目（車型 / 原價 / 早鳥）</h5>
                  <button class="px-2 py-1 border text-xs" @click="addPriceItem()">+ 車型</button>
                </div>
                <div v-for="(it, idx) in newStore.priceItems" :key="idx" class="grid grid-cols-3 gap-2 mb-2">
                  <input v-model.trim="it.type" placeholder="車型" class="border px-2 py-1" />
                  <input type="number" min="0" v-model.number="it.normal" placeholder="原價" class="border px-2 py-1" />
                  <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" class="border px-2 py-1" />
                </div>
              </div>
              <div class="mt-2 flex gap-2">
                <button class="px-2 py-1 border text-sm" @click="createStore" :disabled="storeLoading">新增</button>
                <button class="px-2 py-1 border text-sm" @click="resetNewStore" :disabled="storeLoading">清空</button>
              </div>
            </div>
            <div class="border p-3 bg-white">
              <h4 class="font-semibold mb-2">已設定店面</h4>
              <div v-if="storeLoading" class="text-gray-500">載入中…</div>
              <div v-else-if="eventStores.length===0" class="text-gray-500">尚無資料</div>
              <div v-else class="space-y-3">
                <div v-for="s in eventStores" :key="s.id" class="border p-2">
                  <template v-if="!s._editing">
                    <div class="font-medium text-[#D90000]">{{ s.name }}</div>
                    <div class="text-sm text-gray-600">賽前：{{ s.pre_start }} ~ {{ s.pre_end }} ｜ 賽後：{{ s.post_start }} ~ {{ s.post_end }}</div>
                    <div class="text-sm mt-1">
                      <div v-for="(pv, tk) in s.prices" :key="tk">{{ tk }}：原價 {{ pv.normal }}，早鳥 {{ pv.early }}</div>
                    </div>
                    <div class="mt-2 flex gap-2">
                      <button class="px-2 py-1 border text-sm" @click="startEditStore(s)">編輯</button>
                      <button class="px-2 py-1 border text-sm" @click="deleteStore(s)" :disabled="storeLoading">刪除</button>
                    </div>
                  </template>
                  <template v-else>
                    <input v-model.trim="s._editing.name" placeholder="名稱" class="border px-2 py-1 w-full mb-2" />
                    <div class="grid grid-cols-2 gap-2 mb-2">
                      <input type="date" v-model="s._editing.pre_start" class="border px-2 py-1" />
                      <input type="date" v-model="s._editing.pre_end" class="border px-2 py-1" />
                      <input type="date" v-model="s._editing.post_start" class="border px-2 py-1" />
                      <input type="date" v-model="s._editing.post_end" class="border px-2 py-1" />
                    </div>
                    <div class="mb-2">
                      <div class="flex items-center justify-between mb-1">
                        <span class="font-medium">價目</span>
                        <button class="px-2 py-1 border text-xs" @click="s._editing.priceItems.push({type:'', normal:0, early:0})">+ 車型</button>
                      </div>
                      <div v-for="(it, idx) in s._editing.priceItems" :key="idx" class="grid grid-cols-3 gap-2 mb-2">
                        <input v-model.trim="it.type" placeholder="車型" class="border px-2 py-1" />
                        <input type="number" min="0" v-model.number="it.normal" placeholder="原價" class="border px-2 py-1" />
                        <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" class="border px-2 py-1" />
                      </div>
                    </div>
                    <div class="mt-2 flex gap-2">
                      <button class="px-2 py-1 border text-sm" @click="saveEditStore(s)" :disabled="storeLoading">儲存</button>
                      <button class="px-2 py-1 border text-sm" @click="cancelEditStore(s)" :disabled="storeLoading">取消</button>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Orders -->
      <section v-if="tab==='orders'" class="bg-white border p-4 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-bold">訂單狀態管理</h2>
          <button class="px-2 py-1 border text-sm" @click="loadOrders" :disabled="ordersLoading">重新整理</button>
        </div>
        <div v-if="ordersLoading" class="text-gray-500">載入中…</div>
        <div v-else>
          <div v-if="adminOrders.length===0" class="text-gray-500">沒有資料</div>
          <div v-else class="overflow-auto">
            <table class="min-w-full text-sm">
              <thead>
                <tr class="bg-gray-50 text-left">
                  <th class="px-3 py-2 border">ID</th>
                  <th class="px-3 py-2 border">代碼</th>
                  <th class="px-3 py-2 border">使用者</th>
                  <th class="px-3 py-2 border">內容</th>
                  <th class="px-3 py-2 border">狀態</th>
                  <th class="px-3 py-2 border">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="o in adminOrders" :key="o.id">
                  <td class="px-3 py-2 border">{{ o.id }}</td>
                  <td class="px-3 py-2 border font-mono">{{ o.code || '-' }}</td>
                  <td class="px-3 py-2 border">{{ o.username }}<br/><small class="text-gray-500">{{ o.email }}</small></td>
                  <td class="px-3 py-2 border">
                    <div>票券：{{ o.ticketType || '-' }}</div>
                    <div>數量：{{ o.quantity || 0 }}</div>
                    <div>總額：{{ o.total || 0 }}</div>
                  </td>
                  <td class="px-3 py-2 border">
                    <select v-model="o.newStatus" class="border px-2 py-1">
                      <option v-for="s in orderStatuses" :key="s" :value="s">{{ s }}</option>
                    </select>
                  </td>
                  <td class="px-3 py-2 border">
                    <button class="px-2 py-1 border text-sm" @click="saveOrderStatus(o)" :disabled="o.saving">儲存</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from '../api/axios'
import { useRouter } from 'vue-router'

const router = useRouter()
const API = 'https://api.xiaozhi.moe/uat/leader_online'

const tab = ref('users')
const tabIndex = ref(0)
const loading = ref(false)

const setTab = (t, i) => { tab.value = t; tabIndex.value = i; refreshActive() }
const tabClass = (t) => tab.value === t ? 'text-[#D90000]' : 'text-gray-500 hover:text-[#B00000]'
const tabCount = 4
const indicatorStyle = computed(() => ({ left: `${tabIndex.value * (100/tabCount)}%`, width: `${100/tabCount}%` }))

// Data
const users = ref([])
const userQuery = ref('')
const products = ref([])
const events = ref([])
const selectedEvent = ref(null)
const eventStores = ref([])
const storeLoading = ref(false)
const adminOrders = ref([])
const ordersLoading = ref(false)
const orderStatuses = ['待匯款', '處理中', '已完成']
const showProductForm = ref(false)
const showEventForm = ref(false)
const newProduct = ref({ name: '', price: 0, description: '' })
const newEvent = ref({ code: '', title: '', starts_at: '', ends_at: '', deadline: '', location: '', description: '', rules: '' })
const newStore = ref({ name: '', pre_start: '', pre_end: '', post_start: '', post_end: '', priceItems: [{ type: '大鐵人', normal: 0, early: 0 }] })

const filteredUsers = computed(() => {
  const q = userQuery.value.toLowerCase()
  if (!q) return users.value
  return users.value.filter(u =>
    String(u.username || '').toLowerCase().includes(q) ||
    String(u.email || '').toLowerCase().includes(q)
  )
})

const formatDate = (input) => {
  if (!input) return ''
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return input
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
}
const formatRange = (a,b) => {
  const A = formatDate(a), B = formatDate(b)
  return A && B ? `${A} ~ ${B}` : (A || B || '')
}

async function checkSession() {
  try {
    const { data } = await axios.get(`${API}/whoami`);
    return !!data?.ok && (data?.data?.role === 'admin');
  } catch {
    return false;
  }
}

async function loadUsers() {
  loading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/users`)
    users.value = Array.isArray(data?.data) ? data.data : []
  } catch (e) {
    if (e?.response?.status === 401) router.push('/login')
    else if (e?.response?.status === 403) alert('需要管理員權限')
  } finally { loading.value = false }
}

async function loadProducts() {
  loading.value = true
  try {
    const { data } = await axios.get(`${API}/products`)
    const list = Array.isArray(data?.data) ? data.data : []
    products.value = list.map(p => ({ ...p, price: Number(p.price) }))
  } finally { loading.value = false }
}

async function loadEvents() {
  loading.value = true
  try {
    const { data } = await axios.get(`${API}/events`)
    events.value = Array.isArray(data?.data) ? data.data : []
  } finally { loading.value = false }
}

function toPricesMap(items){
  const m = {}
  for (const it of items) {
    if (!it.type) continue
    m[it.type] = { normal: Number(it.normal||0), early: Number(it.early||0) }
  }
  return m
}
function fromPricesMap(m){
  const arr = []
  for (const k of Object.keys(m||{})) { const v = m[k]||{}; arr.push({ type: k, normal: Number(v.normal||0), early: Number(v.early||0) }) }
  return arr.length ? arr : [{ type: '', normal: 0, early: 0 }]
}

async function loadEventStores(eventId){
  storeLoading.value = true
  try{
    const { data } = await axios.get(`${API}/admin/events/${eventId}/stores`)
    eventStores.value = Array.isArray(data?.data) ? data.data : []
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally{ storeLoading.value = false }
}

function openStoreManager(e){ selectedEvent.value = e; loadEventStores(e.id) }
function addPriceItem(){ newStore.value.priceItems.push({ type: '', normal: 0, early: 0 }) }
function resetNewStore(){ newStore.value = { name: '', pre_start: '', pre_end: '', post_start: '', post_end: '', priceItems: [{ type: '大鐵人', normal: 0, early: 0 }] } }
async function createStore(){
  if (!selectedEvent.value) return
  if (!newStore.value.name) return alert('請輸入名稱')
  const prices = toPricesMap(newStore.value.priceItems)
  if (!Object.keys(prices).length) return alert('至少設定一個車型價格')
  storeLoading.value = true
  try{
    const payload = { name: newStore.value.name, pre_start: newStore.value.pre_start||undefined, pre_end: newStore.value.pre_end||undefined, post_start: newStore.value.post_start||undefined, post_end: newStore.value.post_end||undefined, prices }
    const { data } = await axios.post(`${API}/admin/events/${selectedEvent.value.id}/stores`, payload)
    if (data?.ok){ resetNewStore(); await loadEventStores(selectedEvent.value.id) }
    else alert(data?.message || '新增失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally{ storeLoading.value = false }
}

function startEditStore(s){ s._editing = { name: s.name, pre_start: s.pre_start||'', pre_end: s.pre_end||'', post_start: s.post_start||'', post_end: s.post_end||'', priceItems: fromPricesMap(s.prices||{}) } }
function cancelEditStore(s){ delete s._editing }
async function saveEditStore(s){
  if (!s?._editing) return
  const body = {}
  if (s._editing.name !== s.name) body.name = s._editing.name
  if ((s._editing.pre_start||'') !== (s.pre_start||'')) body.pre_start = s._editing.pre_start||null
  if ((s._editing.pre_end||'') !== (s.pre_end||'')) body.pre_end = s._editing.pre_end||null
  if ((s._editing.post_start||'') !== (s.post_start||'')) body.post_start = s._editing.post_start||null
  if ((s._editing.post_end||'') !== (s.post_end||'')) body.post_end = s._editing.post_end||null
  const newPrices = toPricesMap(s._editing.priceItems)
  if (JSON.stringify(newPrices) !== JSON.stringify(s.prices||{})) body.prices = newPrices
  if (!Object.keys(body).length) { delete s._editing; return }
  storeLoading.value = true
  try{
    const { data } = await axios.patch(`${API}/admin/events/stores/${s.id}`, body)
    if (data?.ok){ await loadEventStores(selectedEvent.value.id) }
    else alert(data?.message || '更新失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally{ storeLoading.value = false }
}

async function deleteStore(s){
  if (!confirm(`確定刪除店面「${s.name}」？`)) return
  storeLoading.value = true
  try{
    const { data } = await axios.delete(`${API}/admin/events/stores/${s.id}`)
    if (data?.ok){ await loadEventStores(selectedEvent.value.id) }
    else alert(data?.message || '刪除失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally{ storeLoading.value = false }
}

async function loadOrders() {
  ordersLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/orders`)
    if (data?.ok && Array.isArray(data.data)) {
      adminOrders.value = data.data.map(o => {
        const d = safeParse(o.details)
        const base = {
          id: o.id,
          code: o.code || '',
          username: o.username || '',
          email: o.email || '',
          total: d.total || 0,
          quantity: d.quantity || 0,
          ticketType: d.ticketType || d?.event?.name || '',
          status: d.status || '處理中',
        }
        return { ...base, newStatus: base.status, saving: false }
      })
    } else {
      adminOrders.value = []
    }
  } catch (e) {
    alert(e?.response?.data?.message || e.message)
  } finally {
    ordersLoading.value = false
  }
}

function safeParse(v){ try { return typeof v === 'string' ? JSON.parse(v) : (v || {}) } catch { return {} } }

async function saveOrderStatus(o){
  if (!orderStatuses.includes(o.newStatus)) return alert('狀態不正確')
  o.saving = true
  try {
    const { data } = await axios.patch(`${API}/admin/orders/${o.id}/status`, { status: o.newStatus })
    if (data?.ok) {
      await loadOrders()
      alert('已更新')
    } else {
      alert(data?.message || '更新失敗')
    }
  } catch (e) {
    alert(e?.response?.data?.message || e.message)
  } finally {
    o.saving = false
  }
}

async function createProduct() {
  if (!newProduct.value.name || newProduct.value.price < 0) return alert('請輸入正確的商品資料')
  loading.value = true
  try {
    const payload = { name: newProduct.value.name, description: newProduct.value.description || '', price: Number(newProduct.value.price) }
    const { data } = await axios.post(`${API}/admin/products`, payload)
    if (data?.ok) {
      showProductForm.value = false
      newProduct.value = { name: '', price: 0, description: '' }
      await loadProducts()
    } else {
      alert(data?.message || '新增失敗')
    }
  } catch (e) {
    alert(e?.response?.data?.message || e.message)
  } finally {
    loading.value = false
  }
}

function startEditProduct(p) {
  p._editing = { name: p.name, price: Number(p.price) || 0, description: p.description || '' }
}
function cancelEditProduct(p) { delete p._editing }
async function saveEditProduct(p) {
  if (!p?._editing) return
  const body = {}
  if (p._editing.name !== p.name) body.name = p._editing.name
  if (Number(p._editing.price) !== Number(p.price)) body.price = Number(p._editing.price)
  if ((p._editing.description || '') !== (p.description || '')) body.description = p._editing.description || ''
  if (!Object.keys(body).length) { delete p._editing; return }
  loading.value = true
  try {
    const { data } = await axios.patch(`${API}/admin/products/${p.id}`, body)
    if (data?.ok) {
      await loadProducts()
    } else {
      alert(data?.message || '更新失敗')
    }
  } catch (e) {
    alert(e?.response?.data?.message || e.message)
  } finally {
    loading.value = false
  }
}

async function deleteProduct(p) {
  if (!confirm(`確定要刪除「${p.name}」？`)) return
  loading.value = true
  try {
    const { data } = await axios.delete(`${API}/admin/products/${p.id}`)
    if (data?.ok) {
      await loadProducts()
    } else {
      alert(data?.message || '刪除失敗')
    }
  } catch (e) {
    alert(e?.response?.data?.message || e.message)
  } finally {
    loading.value = false
  }
}

function normalizeDT(dt) {
  if (!dt) return ''
  // datetime-local => 'YYYY-MM-DDTHH:mm' => convert to 'YYYY-MM-DD HH:mm:00'
  return dt.replace('T', ' ') + (dt.length === 16 ? ':00' : '')
}

async function createEvent() {
  if (!newEvent.value.title || !newEvent.value.starts_at || !newEvent.value.ends_at) return alert('請輸入標題與時間')
  loading.value = true
  try {
    const rules = newEvent.value.rules
      ? newEvent.value.rules.split(',').map(s => s.trim()).filter(Boolean)
      : []
    const payload = {
      code: newEvent.value.code || undefined,
      title: newEvent.value.title,
      starts_at: normalizeDT(newEvent.value.starts_at),
      ends_at: normalizeDT(newEvent.value.ends_at),
      deadline: newEvent.value.deadline ? normalizeDT(newEvent.value.deadline) : undefined,
      location: newEvent.value.location || undefined,
      description: newEvent.value.description || '',
      rules
    }
    const { data } = await axios.post(`${API}/admin/events`, payload)
    if (data?.ok) {
      showEventForm.value = false
      newEvent.value = { code: '', title: '', starts_at: '', ends_at: '', deadline: '', location: '', description: '', rules: '' }
      await loadEvents()
    } else {
      alert(data?.message || '新增失敗')
    }
  } catch (e) {
    alert(e?.response?.data?.message || e.message)
  } finally {
    loading.value = false
  }
}

async function refreshActive() {
  if (tab.value === 'users') await loadUsers()
  if (tab.value === 'products') await loadProducts()
  if (tab.value === 'events') await loadEvents()
  if (tab.value === 'orders') await loadOrders()
}

onMounted(async () => {
  const ok = await checkSession()
  if (!ok) {
    alert('需要管理員登入');
    return router.push('/login')
  }
  await refreshActive()
})
</script>

<style scoped>
.tab-indicator{position:absolute;bottom:0;height:3px;background:linear-gradient(90deg,#D90000,#B00000);transition:all .3s ease}
</style>
