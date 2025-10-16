<template>
  <main class="pt-6 pb-12 px-4">
    <div class="max-w-6xl mx-auto">

      <!-- Header -->
      <header class="bg-white shadow-sm border-b border-gray-100 mb-8 p-6 pt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">帳戶中心</h1>
          <p class="text-gray-600 mt-1">管理個人資料與登入設定</p>
        </div>
        <!--
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          <div class="w-full sm:w-auto flex items-center justify-center gap-2 bg-gray-50 text-gray-700 px-3 py-2 text-sm font-medium border border-gray-200">
            <AppIcon name="user" class="h-4 w-4" /> 角色：{{ role }}
          </div>
        </div>
        -->
      </header>

      <div class="relative mb-6 sticky top-0 z-20 bg-white">
        <div class="flex justify-center border-b border-gray-200 relative">
          <div class="tab-indicator" :style="indicatorStyle"></div>
          <button
            v-for="(tab, index) in tabs"
            :key="tab.key"
            @click="setActiveTab(tab.key, index)"
            :class="[
              'relative flex-1 px-2 py-3 sm:px-6 sm:py-4 font-semibold transition-all duration-300 text-sm sm:text-lg whitespace-nowrap flex items-center gap-1 justify-center',
              activeTab === tab.key ? 'text-primary' : 'text-gray-500 hover:text-secondary'
            ]">
            <AppIcon v-if="tab.icon" :name="tab.icon" class="h-4 w-4" />
            {{ tab.label }}
          </button>
        </div>
      </div>

      <div v-if="activeTab === 'card'" class="space-y-6">
        <!-- Member Card -->
        <section v-if="form.id">
          <div
            class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-red-600 via-rose-500 to-white-900 text-white shadow-xl">
            <div class="absolute -top-20 -right-16 h-48 w-48 rounded-full bg-white/10"></div>
            <div class="absolute -bottom-24 -left-24 h-56 w-56 rounded-full bg-white/5"></div>
            <div class="relative flex flex-col gap-6 p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
              <div class="space-y-4">
                <div class="text-xs uppercase tracking-[0.35em] text-white/70">Member Card</div>
                <div>
                  <h2 class="text-3xl font-semibold leading-tight sm:text-4xl">{{ displayName }}</h2>
                  <p v-if="form.email" class="mt-2 text-sm text-white/80">Email：{{ form.email }}</p>
                </div>
                <div class="space-y-1 text-sm text-white/70">
                  <span class="block font-medium uppercase tracking-wide text-white/80">會員編號</span>
                  <span class="block font-mono text-lg tracking-widest break-all">{{ form.id }}</span>
                  <span class="block text-white/70">角色：{{ role }}</span>
                </div>
              </div>
              <div
                class="flex w-full max-w-[220px] flex-col items-center gap-3 self-start bg-white/90 px-5 py-4 text-gray-900 md:self-center">
                <QrcodeVue v-if="memberQrValue" :value="memberQrValue" :size="memberCardQrSize" level="M" />
                <div class="text-center text-xs font-medium text-gray-600">掃描 QR Code 以驗證會員身份</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div v-else-if="activeTab === 'profile'" class="space-y-6">
        <!-- Profile -->
        <section>
          <AppCard>
            <h2 class="font-semibold mb-4">基本資料</h2>
            <p class="text-xs text-gray-500 mb-3">購買票券或預約前，需要先補齊手機號碼與匯款帳號後五碼。</p>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label class="block text-sm text-gray-600 mb-1">名稱</label>
                <input v-model.trim="form.username" class="w-full border px-3 py-2" />
              </div>
              <div>
                <label class="block text-sm text-gray-600 mb-1">Email</label>
                <input v-model.trim="form.email" type="email" class="w-full border px-3 py-2" />
              </div>
              <div>
                <label class="block text-sm text-gray-600 mb-1">手機號碼</label>
                <input
                  v-model="form.phone"
                  @input="onPhoneInput"
                  inputmode="tel"
                  maxlength="20"
                  class="w-full border px-3 py-2"
                  placeholder="例：0912-345678"
                />
              </div>
              <div>
                <label class="block text-sm text-gray-600 mb-1">匯款帳號後五碼</label>
                <input
                  v-model="form.remittanceLast5"
                  @input="onRemittanceInput"
                  inputmode="numeric"
                  maxlength="5"
                  class="w-full border px-3 py-2 tracking-widest"
                  placeholder="12345"
                />
              </div>
            </div>
            <p class="text-sm text-gray-600 mb-4">UUID:{{ form.id }}</p>
            <div class="mt-4 flex gap-3 flex-col sm:flex-row">
              <button class="btn btn-primary text-white w-full sm:w-auto" :disabled="savingProfile"
                @click="saveProfile">儲存基本資料</button>
            </div>
          </AppCard>
        </section>

        <!-- Password -->
        <section>
          <AppCard>
            <h2 class="font-semibold mb-1">變更密碼（需 Email 驗證）</h2>
            <p class="text-sm text-gray-600 mb-4">輸入目前密碼後，我們會寄送一封確認信到您的 Email，請透過信中的連結完成新密碼設定。</p>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label class="block text-sm text-gray-600 mb-1">目前密碼</label>
                <input v-model.trim="pwd.current" type="password" autocomplete="current-password"
                  class="w-full border px-3 py-2" />
              </div>
            </div>
            <div class="mt-4 flex gap-3 flex-col sm:flex-row">
              <button class="btn btn-outline w-full sm:w-auto" :disabled="savingPwd"
                @click="changePassword">寄送驗證信</button>
            </div>
          </AppCard>
        </section>

        <!-- 資料匯出 -->
        <section>
          <AppCard>
            <h2 class="font-semibold mb-2">下載我的帳號資料（JSON）</h2>
            <p class="text-sm text-gray-600 mb-3">出於安全，匯出前請先輸入一次目前密碼以驗證身分。</p>
            <p class="text-xs text-gray-500 mb-4">
              匯出檔案包含基本個人資料、購物車內容、票券與訂單、預約紀錄、票券轉贈紀錄，以及第三方登入與安全相關紀錄；請妥善保管此檔案。
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm text-gray-600 mb-1">目前密碼</label>
                <input v-model.trim="exportPwd" type="password" autocomplete="current-password"
                  class="w-full border px-3 py-2" />
              </div>
            </div>
            <div class="mt-4 flex gap-3 flex-col sm:flex-row">
              <button class="btn btn-outline w-full sm:w-auto" :disabled="exporting || !exportPwd"
                @click="exportAccountData">下載 JSON</button>
            </div>
          </AppCard>
        </section>
      </div>

      <div v-else-if="activeTab === 'other'" class="space-y-6">
        <!-- 第三方登入綁定 -->
        <section>
          <AppCard>
            <h2 class="font-semibold mb-2">第三方登入</h2>
            <div class="flex flex-col gap-4">
              <div class="flex items-center justify-between gap-3">
                <div class="text-sm text-gray-600">Google：<strong>{{ providers.includes('google') ? '已綁定' : '未綁定'
                    }}</strong></div>
                <div class="flex gap-2">
                  <button v-if="!providers.includes('google')" class="btn btn-outline" @click="linkGoogle">
                    綁定 Google 登入
                  </button>
                  <button v-else class="btn btn-outline" @click="unlinkGoogle">解除綁定</button>
                </div>
              </div>

              <div class="border-t border-gray-200 pt-4">
                <div class="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
                  <div class="flex-1">
                    <div class="flex items-center gap-2 mb-2">
                      <div class="text-sm text-gray-600">LINE：<strong>{{ providers.includes('line') ? '已綁定' : '未綁定' }}</strong></div>
                      <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700" v-if="providers.includes('line')">已啟用登入</span>
                    </div>
                    <div class="flex gap-2 flex-wrap mb-3">
                      <button v-if="!providers.includes('line')" class="btn btn-outline" @click="linkLine">
                        綁定 LINE 登入
                      </button>
                      <button v-else class="btn btn-outline" @click="unlinkLine">解除綁定</button>
                      <a :href="lineOfficialUrl" target="_blank" rel="noopener noreferrer" class="btn btn-primary text-white">
                        加入官方帳號
                      </a>
                    </div>
                    <ul class="text-xs text-gray-600 space-y-1">
                      <li>・ 綁定後可用 LINE 一鍵登入，免輸入帳密。</li>
                      <li>・ 加入官方帳號即可收到最新活動通知與預約提醒。</li>
                      <li>・ 官方帳號中可快速查看預約資訊與客服聯繫方式。</li>
                    </ul>
                  </div>
                  <div class="flex flex-col items-center gap-2 border border-gray-200 p-3 bg-gray-50">
                    <img :src="lineOfficialQr" alt="LINE 官方帳號 QR Code" class="w-32 h-32 object-contain" />
                    <p class="text-xs text-gray-600 text-center leading-snug">掃描 QR Code 加入<br>Leader Online 官方帳號</p>
                  </div>
                </div>
              </div>
            </div>
          </AppCard>
        </section>

        <!-- 刪除帳號 -->
        <section>
          <AppCard>
            <h2 class="font-semibold mb-2 text-red-700">刪除帳號</h2>
            <p class="text-sm text-gray-600 mb-2">此動作會刪除您的登入資格並匿名化個人資料，無法復原。若有既有訂單/預約/票券，將保留其紀錄但不再能與您帳號關聯。</p>
            <p class="text-sm text-gray-600 mb-3">出於安全，刪除前請先輸入一次目前密碼以驗證身分。</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm text-gray-600 mb-1">目前密碼</label>
                <input v-model.trim="deletePwd" type="password" autocomplete="current-password"
                  class="w-full border px-3 py-2" />
              </div>
            </div>
            <div class="mt-4 flex gap-3 flex-col sm:flex-row">
              <button class="btn btn-primary text-white w-full sm:w-auto bg-red-600 border-red-600 hover:brightness-95"
                :disabled="deleting || !deletePwd" @click="deleteAccount">永久刪除帳號</button>
            </div>
          </AppCard>
        </section>

        <!-- Danger / Logout -->
        <section>
          <AppCard>
            <h2 class="font-semibold mb-4">其他</h2>
            <div class="flex flex-col sm:flex-row gap-3">
              <button class="btn btn-outline w-full sm:w-auto" @click="logout">
                <AppIcon name="logout" class="h-4 w-4" /> 登出
              </button>
            </div>
          </AppCard>
        </section>
      </div>

    </div>
  </main>
</template>

<script setup>
  import { ref, onMounted, computed } from 'vue'
  import axios from '../api/axios'
  import { useRouter, useRoute } from 'vue-router'
  import QrcodeVue from 'qrcode.vue'
  import AppIcon from '../components/AppIcon.vue'
  import AppCard from '../components/AppCard.vue'
  import { showNotice, showConfirm } from '../utils/sheet'

  const API = 'https://api.xiaozhi.moe/uat/leader_online'
  const router = useRouter()
  const route = useRoute()

  const form = ref({ username: '', email: '', id: '', phone: '', remittanceLast5: '' })
  const role = ref('USER')
  const savingProfile = ref(false)
  const savingPwd = ref(false)
  const exportPwd = ref('')
  const deletePwd = ref('')
  const exporting = ref(false)
  const deleting = ref(false)
  const providers = ref([])
  const lineOfficialUrl = 'https://line.me/R/ti/p/@855wwpug'
  const lineOfficialQr = `https://qr-official.line.me/gs/M_855wwpug_GW.png`
  const pwd = ref({ current: '', next: '' })
  const memberCardQrSize = 180
  const displayName = computed(() => form.value.username || '會員')
  const memberQrValue = computed(() => form.value.id || '')

  const normalizePhoneValue = (value) => String(value || '').replace(/[^0-9+\-()\s]/g, '').slice(0, 20)
  const normalizeRemittanceValue = (value) => String(value || '').replace(/\D/g, '').slice(0, 5)
  const onPhoneInput = (event) => {
    const sanitized = normalizePhoneValue(event?.target?.value ?? form.value.phone)
    if (event?.target) event.target.value = sanitized
    form.value.phone = sanitized
  }
  const onRemittanceInput = (event) => {
    const sanitized = normalizeRemittanceValue(event?.target?.value ?? form.value.remittanceLast5)
    if (event?.target) event.target.value = sanitized
    form.value.remittanceLast5 = sanitized
  }

  const tabs = [
    { key: 'card', label: '會員卡', icon: 'ticket' },
    { key: 'profile', label: '資料管理', icon: 'user' },
    { key: 'other', label: '其他', icon: 'settings' },
  ]
  const activeTab = ref(tabs[0].key)
  const activeTabIndex = ref(0)
  const tabCount = computed(() => tabs.length || 1)
  const indicatorStyle = computed(() => {
    const count = tabCount.value
    return {
      left: `${activeTabIndex.value * (100 / count)}%`,
      width: `${100 / count}%`
    }
  })
  const setActiveTab = (key, index) => {
    const nextIndex = typeof index === 'number' && index >= 0
      ? index
      : tabs.findIndex(t => t.key === key)
    if (nextIndex < 0 || nextIndex >= tabs.length) return
    activeTab.value = tabs[nextIndex].key
    activeTabIndex.value = nextIndex
  }

  async function loadMe() {
    try {
      const { data } = await axios.get(`${API}/me`)
      if (data?.ok) {
        form.value.username = data.data.username || ''
        form.value.email = data.data.email || ''
        form.value.id = data.data.id ? String(data.data.id) : ''
        form.value.phone = normalizePhoneValue(data.data.phone || '')
        const last5 = data.data.remittanceLast5 ?? data.data.remittance_last5 ?? ''
        form.value.remittanceLast5 = normalizeRemittanceValue(last5)
        role.value = String(data.data.role || 'USER').toUpperCase()
        // 若後端有回傳 providers，一併寫入（避免另一次請求失敗造成顯示為未綁定）
        try {
          const list = Array.isArray(data?.data?.providers) ? data.data.providers : []
          if (list.length) {
            providers.value = Array.from(new Set(list.map(p => String(p || '').trim().toLowerCase()))).filter(Boolean)
          }
        } catch { }
      }
    } catch (e) {
      if (e?.response?.status === 401) { router.push('/login') }
      else await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
    }
  }

  async function refreshLocalUser() {
    try {
      const { data } = await axios.get(`${API}/whoami`)
      if (data?.ok) {
        localStorage.setItem('user_info', JSON.stringify(data.data))
        window.dispatchEvent(new Event('auth-changed'))
      }
    } catch { }
  }

  async function saveProfile() {
    savingProfile.value = true
    try {
      const payload = {}
      if (form.value.username) payload.username = form.value.username
      if (form.value.email) payload.email = form.value.email
      payload.phone = normalizePhoneValue(form.value.phone)
      payload.remittanceLast5 = normalizeRemittanceValue(form.value.remittanceLast5)
      const { data } = await axios.patch(`${API}/me`, payload)
      if (data?.ok) { await refreshLocalUser(); await showNotice('已更新基本資料') }
      else await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
    } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
    finally { savingProfile.value = false }
  }

  async function changePassword() {
    if (!pwd.value.current) { await showNotice('請輸入目前密碼', { title: '格式錯誤' }); return }
    savingPwd.value = true
    try {
      const { data } = await axios.post(`${API}/me/password/send_reset`, { currentPassword: pwd.value.current })
      if (data?.ok) { await showNotice('已寄出驗證信，請至信箱點擊連結後設定新密碼'); pwd.value = { current: '', next: '' } }
      else await showNotice(data?.message || '寄送失敗', { title: '寄送失敗' })
    } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
    finally { savingPwd.value = false }
  }

  onMounted(async () => {
    await loadMe()
    await loadProviders()
    const init = typeof route.query.tab === 'string' ? route.query.tab : ''
    const idx = tabs.findIndex(t => t.key === init)
    if (idx >= 0) setActiveTab(tabs[idx].key, idx)
  })

  async function logout() {
    try { await axios.post(`${API}/logout`) } catch { }
    finally {
      try { localStorage.removeItem('user_info'); localStorage.removeItem('auth_bearer') } catch { }
      window.dispatchEvent(new Event('auth-changed'))
      router.push('/login')
    }
  }

  async function loadProviders() {
    try {
      const { data } = await axios.get(`${API}/auth/providers`)
      const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
      // 正規化：trim + lowercase，並去重，避免舊資料格式影響顯示
      providers.value = Array.from(new Set(list.map(p => String(p || '').trim().toLowerCase()))).filter(Boolean)
    } catch (_) { }
  }

  function linkGoogle() {
    window.location.href = `${API}/auth/google/start?mode=link&redirect=/account`
  }
  async function unlinkGoogle() {
    try {
      const { data } = await axios.delete(`${API}/auth/providers/google`)
      if (data?.ok) { await showNotice('已解除綁定 Google'); await loadProviders() }
      else await showNotice(data?.message || '解除失敗', { title: '解除失敗' })
    } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  }

  function linkLine() {
    window.location.href = `${API}/auth/line/start?mode=link&redirect=/account`
  }
  async function unlinkLine() {
    try {
      const { data } = await axios.delete(`${API}/auth/providers/line`)
      if (data?.ok) { await showNotice('已解除綁定 LINE'); await loadProviders() }
      else await showNotice(data?.message || '解除失敗', { title: '解除失敗' })
    } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  }

  function fileDownload(filename, content) {
    try {
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      setTimeout(() => { try { URL.revokeObjectURL(url); a.remove() } catch { } }, 0)
    } catch { }
  }

  function todayStr() {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}${m}${day}`
  }

  async function exportAccountData() {
    if (!exportPwd.value) { await showNotice('請輸入目前密碼', { title: '需要驗證' }); return }
    exporting.value = true
    try {
      const { data } = await axios.post(`${API}/me/export`, { currentPassword: exportPwd.value })
      if (data?.ok) {
        const json = JSON.stringify(data.data, null, 2)
        fileDownload(`account_export_${todayStr()}.json`, json)
        await showNotice('已下載帳號資料 JSON')
        exportPwd.value = ''
      } else {
        await showNotice(data?.message || '匯出失敗', { title: '匯出失敗' })
      }
    } catch (e) {
      await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
    } finally {
      exporting.value = false
    }
  }

  async function deleteAccount() {
    if (!deletePwd.value) { await showNotice('請輸入目前密碼', { title: '需要驗證' }); return }
    if (!(await showConfirm('此操作無法復原，確定要永久刪除帳號嗎？', { title: '刪除帳號確認' }))) return
    deleting.value = true
    try {
      const { data } = await axios.post(`${API}/me/delete`, { currentPassword: deletePwd.value })
      if (data?.ok) {
        await showNotice('您的帳號已刪除與匿名化')
        // 清除本地登入狀態並回登入頁
        try { localStorage.removeItem('user_info'); localStorage.removeItem('auth_bearer') } catch { }
        window.dispatchEvent(new Event('auth-changed'))
        router.push('/login')
      } else {
        await showNotice(data?.message || '刪除失敗', { title: '刪除失敗' })
      }
    } catch (e) {
      await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
    } finally {
      deleting.value = false
    }
  }
</script>

<style scoped>

  button,
  .bg-white,
  .border {
    border-radius: 0 !important
  }
</style>
