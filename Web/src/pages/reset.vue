<template>
  <main class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-rose-50 px-4 pt-safe pb-safe">
    <div class="w-full max-w-md card p-8">
      <div class="text-center mb-6">
        <h1 class="text-2xl font-bold text-primary">{{ isFirst ? '設定密碼' : '重設密碼' }}</h1>
        <p class="text-slate-600 text-sm mt-1">請輸入新密碼並確認</p>
      </div>

      <div v-if="msg.text" class="mb-4">
        <div :class="[
          'px-4 py-3 text-sm',
          msg.type==='success' ? 'bg-green-50 text-green-700 border border-green-200'
          : msg.type==='error' ? 'bg-red-50 text-red-700 border border-red-200'
          : 'bg-slate-50 text-slate-700 border border-slate-200']">
          {{ msg.text }}
        </div>
      </div>

      <div v-if="loadingValidate" class="text-slate-500">驗證連結中…</div>
      <template v-else>
        <div v-if="!tokenValid" class="text-sm text-red-600">
          連結無效或已過期。請回到登入頁重新申請重設密碼。
          <div class="mt-4">
            <router-link class="text-primary underline" to="/login">返回登入</router-link>
          </div>
        </div>
        <form v-else @submit.prevent="submit" class="space-y-4">
          <div v-if="email" class="text-sm text-slate-600">帳號 Email：<span class="font-mono">{{ email }}</span></div>
          <div>
            <label class="block text-slate-800 mb-1 font-medium">新密碼</label>
            <input :type="show1 ? 'text' : 'password'" v-model.trim="p1" placeholder="至少 8 碼"
                   class="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-sm text-slate-800 focus:border-primary focus:ring-2 focus:ring-primary/30 transition" />
            <div class="text-right mt-1">
              <button type="button" @click="show1=!show1" class="text-xs text-slate-500 hover:text-slate-700 underline">
                {{ show1 ? '隱藏' : '顯示' }}
              </button>
            </div>
          </div>
          <div>
            <label class="block text-slate-800 mb-1 font-medium">確認新密碼</label>
            <input :type="show2 ? 'text' : 'password'" v-model.trim="p2" placeholder="再次輸入新密碼"
                   class="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-sm text-slate-800 focus:border-primary focus:ring-2 focus:ring-primary/30 transition" />
            <div class="text-right mt-1">
              <button type="button" @click="show2=!show2" class="text-xs text-slate-500 hover:text-slate-700 underline">
                {{ show2 ? '隱藏' : '顯示' }}
              </button>
            </div>
          </div>

          <button type="submit" :disabled="submitting"
                  class="w-full btn btn-primary text-white py-3 font-semibold">
            {{ submitting ? '處理中…' : (isFirst ? '設定密碼' : '重設密碼') }}
          </button>
        </form>
      </template>
    </div>
  </main>
  </template>

  <script setup>
  import { ref, onMounted } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import axios from '../api/axios'

  const API = 'https://api.xiaozhi.moe/uat/leader_online'
  const route = useRoute()
  const router = useRouter()

  const token = ref('')
  const isFirst = ref(false)
  const email = ref('')
  const tokenValid = ref(false)
  const loadingValidate = ref(true)
  const submitting = ref(false)
  const msg = ref({ type: '', text: '' })
  const p1 = ref('')
  const p2 = ref('')
  const show1 = ref(false)
  const show2 = ref(false)

  function setMsg(type, text){ msg.value = { type, text } }

  async function validateToken(){
    loadingValidate.value = true
    try {
      const { token: t } = { token: (route.query.token || route.query.reset_token || '').toString() }
      token.value = t
      isFirst.value = String(route.query.first || '') === '1'
      if (!t) { tokenValid.value = false; return }
      const { data } = await axios.get(`${API}/password_resets/validate`, { params: { token: t } })
      tokenValid.value = !!(data?.ok ? data?.data?.valid : data?.valid)
      email.value = (data?.ok ? data?.data?.email : data?.email) || ''
      if (!tokenValid.value) setMsg('error', '連結無效或已過期')
    } catch (e) {
      tokenValid.value = false
      setMsg('error', e?.response?.data?.message || e.message)
    } finally { loadingValidate.value = false }
  }

  function validateForm(){
    if (!p1.value || p1.value.length < 8) return '新密碼至少 8 碼'
    if (p1.value !== p2.value) return '兩次輸入的新密碼不一致'
    return ''
  }

  async function submit(){
    const err = validateForm()
    if (err) { setMsg('error', err); return }
    submitting.value = true
    try {
      const { data } = await axios.post(`${API}/reset-password`, { token: token.value, password: p1.value })
      if (data?.ok){
        try { localStorage.setItem('user_info', JSON.stringify(data.data || {})) } catch {}
        if (data?.data?.token) try { localStorage.setItem('auth_bearer', data.data.token) } catch {}
        setMsg('success', '密碼已重設，正在導向…')
        setTimeout(() => router.push('/store'), 600)
      } else {
        setMsg('error', data?.message || '重設失敗')
      }
    } catch (e) {
      setMsg('error', e?.response?.data?.message || e.message)
    } finally { submitting.value = false }
  }

  onMounted(validateToken)
  </script>
