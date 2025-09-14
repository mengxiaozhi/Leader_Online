<template>
  <main class="pt-6 pb-12 px-4">
    <div class="max-w-6xl mx-auto">

      <!-- Header -->
      <header class="bg-white shadow-sm border-b border-gray-100 mb-6 p-4 pt-safe fade-in">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 class="text-2xl font-bold text-gray-900">帳戶中心</h1>
            <p class="text-gray-600 mt-1">管理個人資料與登入設定</p>
          </div>
          <div class="flex items-center gap-3 w-full md:w-auto">
            <div class="bg-gray-50 text-gray-700 px-4 py-2 text-sm font-medium w-full md:w-auto text-center">
              角色：{{ role }}
            </div>
          </div>
        </div>
      </header>

      <!-- Profile -->
      <section class="mb-6 slide-up">
        <AppCard>
          <h2 class="font-semibold mb-4">基本資料</h2>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label class="block text-sm text-gray-600 mb-1">名稱</label>
              <input v-model.trim="form.username" class="w-full border px-3 py-2" />
            </div>
            <div>
              <label class="block text-sm text-gray-600 mb-1">Email</label>
              <input v-model.trim="form.email" type="email" class="w-full border px-3 py-2" />
            </div>
          </div>
          <div class="mt-4 flex gap-3 flex-col sm:flex-row">
            <button class="btn btn-primary text-white w-full sm:w-auto" :disabled="savingProfile" @click="saveProfile">儲存基本資料</button>
          </div>
        </AppCard>
      </section>

      <!-- Password -->
      <section class="mb-6 slide-up">
        <AppCard>
          <h2 class="font-semibold mb-1">變更密碼（需 Email 驗證）</h2>
          <p class="text-sm text-gray-600 mb-4">輸入目前密碼後，我們會寄送一封確認信到您的 Email，請透過信中的連結完成新密碼設定。</p>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label class="block text-sm text-gray-600 mb-1">目前密碼</label>
              <input v-model.trim="pwd.current" type="password" autocomplete="current-password" class="w-full border px-3 py-2" />
            </div>
          </div>
          <div class="mt-4 flex gap-3 flex-col sm:flex-row">
            <button class="btn btn-outline w-full sm:w-auto" :disabled="savingPwd" @click="changePassword">寄送驗證信</button>
          </div>
        </AppCard>
      </section>

      <!-- 資料匯出 -->
      <section class="mb-6 slide-up">
        <AppCard>
          <h2 class="font-semibold mb-2">下載我的帳號資料（JSON）</h2>
          <p class="text-sm text-gray-600 mb-3">出於安全，匯出前請先輸入一次目前密碼以驗證身分。</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm text-gray-600 mb-1">目前密碼</label>
              <input v-model.trim="exportPwd" type="password" autocomplete="current-password" class="w-full border px-3 py-2" />
            </div>
          </div>
          <div class="mt-4 flex gap-3 flex-col sm:flex-row">
            <button class="btn btn-outline w-full sm:w-auto" :disabled="exporting || !exportPwd" @click="exportAccountData">下載 JSON</button>
          </div>
        </AppCard>
      </section>

      <!-- 第三方登入綁定 -->
      <section class="mb-6 slide-up">
        <AppCard>
          <h2 class="font-semibold mb-2">第三方登入</h2>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm text-gray-600">Google：<strong>{{ providers.includes('google') ? '已綁定' : '未綁定' }}</strong></div>
              <div class="flex gap-2">
                <button v-if="!providers.includes('google')" class="btn btn-outline" @click="linkGoogle">
                  綁定 Google 登入
                </button>
                <button v-else class="btn btn-outline" @click="unlinkGoogle">解除綁定</button>
              </div>
            </div>
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm text-gray-600">LINE：<strong>{{ providers.includes('line') ? '已綁定' : '未綁定' }}</strong></div>
              <div class="flex gap-2">
                <button v-if="!providers.includes('line')" class="btn btn-outline" @click="linkLine">
                  綁定 LINE 登入
                </button>
                <button v-else class="btn btn-outline" @click="unlinkLine">解除綁定</button>
              </div>
            </div>
          </div>
        </AppCard>
      </section>

      <!-- 刪除帳號 -->
      <section class="mb-6 slide-up">
        <AppCard>
          <h2 class="font-semibold mb-2 text-red-700">刪除帳號</h2>
          <p class="text-sm text-gray-600 mb-2">此動作會刪除您的登入資格並匿名化個人資料，無法復原。若有既有訂單/預約/票券，將保留其紀錄但不再能與您帳號關聯。</p>
          <p class="text-sm text-gray-600 mb-3">出於安全，刪除前請先輸入一次目前密碼以驗證身分。</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm text-gray-600 mb-1">目前密碼</label>
              <input v-model.trim="deletePwd" type="password" autocomplete="current-password" class="w-full border px-3 py-2" />
            </div>
          </div>
          <div class="mt-4 flex gap-3 flex-col sm:flex-row">
            <button class="btn btn-primary text-white w-full sm:w-auto bg-red-600 border-red-600 hover:brightness-95" :disabled="deleting || !deletePwd" @click="deleteAccount">永久刪除帳號</button>
          </div>
        </AppCard>
      </section>

      <!-- Danger / Logout -->
      <section class="slide-up">
        <AppCard>
          <h2 class="font-semibold mb-4">其他</h2>
          <div class="flex flex-col sm:flex-row gap-3">
            <button class="btn btn-outline w-full sm:w-auto" @click="logout"><AppIcon name="logout" class="h-4 w-4" /> 登出</button>
          </div>
        </AppCard>
      </section>

    </div>
  </main>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from '../api/axios'
import { useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AppCard from '../components/AppCard.vue'
import { showNotice, showConfirm } from '../utils/sheet'

const API = 'https://api.xiaozhi.moe/uat/leader_online'
const router = useRouter()

const form = ref({ username: '', email: '' })
const role = ref('USER')
const savingProfile = ref(false)
const savingPwd = ref(false)
const exportPwd = ref('')
const deletePwd = ref('')
const exporting = ref(false)
const deleting = ref(false)
const providers = ref([])
const pwd = ref({ current: '', next: '' })

async function loadMe(){
  try{
    const { data } = await axios.get(`${API}/me`)
    if (data?.ok){
      form.value.username = data.data.username || ''
      form.value.email = data.data.email || ''
      role.value = String(data.data.role || 'USER').toUpperCase()
      // 若後端有回傳 providers，一併寫入（避免另一次請求失敗造成顯示為未綁定）
      try{
        const list = Array.isArray(data?.data?.providers) ? data.data.providers : []
        if (list.length){
          providers.value = Array.from(new Set(list.map(p => String(p || '').trim().toLowerCase()))).filter(Boolean)
        }
      } catch {}
    }
  } catch(e){
    if (e?.response?.status === 401){ router.push('/login') }
    else await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  }
}

async function refreshLocalUser(){
  try{
    const { data } = await axios.get(`${API}/whoami`)
    if (data?.ok){
      localStorage.setItem('user_info', JSON.stringify(data.data))
      window.dispatchEvent(new Event('auth-changed'))
    }
  } catch {}
}

async function saveProfile(){
  savingProfile.value = true
  try{
    const payload = {}
    if (form.value.username) payload.username = form.value.username
    if (form.value.email) payload.email = form.value.email
    const { data } = await axios.patch(`${API}/me`, payload)
    if (data?.ok){ await refreshLocalUser(); await showNotice('已更新基本資料') }
    else await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally { savingProfile.value = false }
}

async function changePassword(){
  if (!pwd.value.current){ await showNotice('請輸入目前密碼', { title: '格式錯誤' }); return }
  savingPwd.value = true
  try{
    const { data } = await axios.post(`${API}/me/password/send_reset`, { currentPassword: pwd.value.current })
    if (data?.ok){ await showNotice('已寄出驗證信，請至信箱點擊連結後設定新密碼'); pwd.value = { current: '', next: '' } }
    else await showNotice(data?.message || '寄送失敗', { title: '寄送失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally { savingPwd.value = false }
}

onMounted(loadMe)

async function logout(){
  try { await axios.post(`${API}/logout`) } catch {}
  finally {
    try { localStorage.removeItem('user_info'); localStorage.removeItem('auth_bearer') } catch {}
    window.dispatchEvent(new Event('auth-changed'))
    router.push('/login')
  }
}

async function loadProviders(){
  try{
    const { data } = await axios.get(`${API}/auth/providers`)
    const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
    // 正規化：trim + lowercase，並去重，避免舊資料格式影響顯示
    providers.value = Array.from(new Set(list.map(p => String(p || '').trim().toLowerCase()))).filter(Boolean)
  } catch(_){}
}

function linkGoogle(){
  window.location.href = `${API}/auth/google/start?mode=link&redirect=/account`
}
async function unlinkGoogle(){
  try{
    const { data } = await axios.delete(`${API}/auth/providers/google`)
    if (data?.ok){ await showNotice('已解除綁定 Google'); await loadProviders() }
    else await showNotice(data?.message || '解除失敗', { title: '解除失敗' })
  } catch (e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
}

function linkLine(){
  window.location.href = `${API}/auth/line/start?mode=link&redirect=/account`
}
async function unlinkLine(){
  try{
    const { data } = await axios.delete(`${API}/auth/providers/line`)
    if (data?.ok){ await showNotice('已解除綁定 LINE'); await loadProviders() }
    else await showNotice(data?.message || '解除失敗', { title: '解除失敗' })
  } catch (e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
}

onMounted(() => { loadProviders() })

function fileDownload(filename, content){
  try{
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { try { URL.revokeObjectURL(url); a.remove() } catch {} }, 0)
  } catch {}
}

function todayStr(){
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth()+1).padStart(2,'0')
  const day = String(d.getDate()).padStart(2,'0')
  return `${y}${m}${day}`
}

async function exportAccountData(){
  if (!exportPwd.value) { await showNotice('請輸入目前密碼', { title: '需要驗證' }); return }
  exporting.value = true
  try{
    const { data } = await axios.post(`${API}/me/export`, { currentPassword: exportPwd.value })
    if (data?.ok){
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

async function deleteAccount(){
  if (!deletePwd.value) { await showNotice('請輸入目前密碼', { title: '需要驗證' }); return }
  if (!(await showConfirm('此操作無法復原，確定要永久刪除帳號嗎？', { title: '刪除帳號確認' }))) return
  deleting.value = true
  try{
    const { data } = await axios.post(`${API}/me/delete`, { currentPassword: deletePwd.value })
    if (data?.ok){
      await showNotice('您的帳號已刪除與匿名化')
      // 清除本地登入狀態並回登入頁
      try { localStorage.removeItem('user_info'); localStorage.removeItem('auth_bearer') } catch {}
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
button,.bg-white,.border{border-radius:0!important}
</style>
