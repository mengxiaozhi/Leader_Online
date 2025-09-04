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
      <section class="bg-white border p-4 shadow-sm mb-6 slide-up">
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
      </section>

      <!-- Password -->
      <section class="bg-white border p-4 shadow-sm mb-6 slide-up">
        <h2 class="font-semibold mb-4">變更密碼</h2>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-sm text-gray-600 mb-1">目前密碼</label>
            <input v-model.trim="pwd.current" type="password" class="w-full border px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">新密碼</label>
            <input v-model.trim="pwd.next" type="password" class="w-full border px-3 py-2" />
          </div>
        </div>
        <div class="mt-4 flex gap-3 flex-col sm:flex-row">
          <button class="btn btn-outline w-full sm:w-auto" :disabled="savingPwd" @click="changePassword">更新密碼</button>
        </div>
      </section>

      <!-- Danger / Logout -->
      <section class="bg-white border p-4 shadow-sm slide-up">
        <h2 class="font-semibold mb-4">其他</h2>
        <div class="flex flex-col sm:flex-row gap-3">
          <button class="btn btn-outline w-full sm:w-auto" @click="logout"><AppIcon name="logout" class="h-4 w-4" /> 登出</button>
        </div>
      </section>

    </div>
  </main>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from '../api/axios'
import { useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'

const API = 'https://api.xiaozhi.moe/uat/leader_online'
const router = useRouter()

const form = ref({ username: '', email: '' })
const role = ref('USER')
const savingProfile = ref(false)
const savingPwd = ref(false)
const pwd = ref({ current: '', next: '' })

async function loadMe(){
  try{
    const { data } = await axios.get(`${API}/me`)
    if (data?.ok){
      form.value.username = data.data.username || ''
      form.value.email = data.data.email || ''
      role.value = String(data.data.role || 'USER').toUpperCase()
    }
  } catch(e){
    if (e?.response?.status === 401){ router.push('/login') }
    else alert(e?.response?.data?.message || e.message)
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
    if (data?.ok){ await refreshLocalUser(); alert('已更新基本資料') }
    else alert(data?.message || '更新失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally { savingProfile.value = false }
}

async function changePassword(){
  if (!pwd.value.current || !pwd.value.next){ alert('請輸入目前與新密碼'); return }
  if (pwd.value.next.length < 8){ alert('新密碼至少 8 碼'); return }
  savingPwd.value = true
  try{
    const { data } = await axios.patch(`${API}/me/password`, { currentPassword: pwd.value.current, newPassword: pwd.value.next })
    if (data?.ok){ await refreshLocalUser(); alert('已更新密碼'); pwd.value = { current: '', next: '' } }
    else alert(data?.message || '更新失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
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
</script>

<style scoped>
button,.bg-white,.border{border-radius:0!important}
</style>
