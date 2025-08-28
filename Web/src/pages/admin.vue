<template>
  <main class="pt-6 pb-12 px-4">
    <div class="max-w-7xl mx-auto">
      <header class="bg-white shadow-sm border-b border-gray-100 mb-8 p-6 flex justify-between items-center">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">管理後台 Dashboard</h1>
          <p class="text-gray-600 mt-1">使用者、商品、活動的集中管理（目前唯讀）</p>
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
            <div v-for="p in products" :key="p.id || p.name" class="border p-3">
              <div class="font-semibold text-[#D90000]">{{ p.name }}</div>
              <div class="text-gray-600 text-sm">{{ p.description }}</div>
              <div class="mt-1">NT$ {{ p.price }}</div>
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
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in events" :key="e.id" class="hover:bg-gray-50">
                  <td class="px-3 py-2 border">{{ e.id }}</td>
                  <td class="px-3 py-2 border">{{ e.name || e.title }}</td>
                  <td class="px-3 py-2 border">{{ e.date || formatRange(e.starts_at, e.ends_at) }}</td>
                  <td class="px-3 py-2 border">{{ e.deadline || e.ends_at }}</td>
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
const indicatorStyle = computed(() => ({ left: `${tabIndex.value * (100/3)}%`, width: `${100/3}%` }))

// Data
const users = ref([])
const userQuery = ref('')
const products = ref([])
const events = ref([])
const showProductForm = ref(false)
const showEventForm = ref(false)
const newProduct = ref({ name: '', price: 0, description: '' })
const newEvent = ref({ code: '', title: '', starts_at: '', ends_at: '', deadline: '', location: '', description: '', rules: '' })

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
    products.value = Array.isArray(data?.data) ? data.data : []
  } finally { loading.value = false }
}

async function loadEvents() {
  loading.value = true
  try {
    const { data } = await axios.get(`${API}/events`)
    events.value = Array.isArray(data?.data) ? data.data : []
  } finally { loading.value = false }
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
