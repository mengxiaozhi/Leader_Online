<template>
  <main class="min-h-screen flex items-center justify-center px-4 py-8 pt-safe pb-safe">
    <section class="w-full max-w-md card p-6 sm:p-8" aria-labelledby="password-reset-title">
      <header class="text-center mb-6">
        <h1 id="password-reset-title" class="ui-title text-2xl font-medium text-primary">
          {{ isFirst ? '設定密碼' : '重設密碼' }}
        </h1>
        <p class="text-slate-600 text-sm mt-2">請輸入新密碼並再次確認</p>
      </header>

      <div aria-live="polite">
        <div v-if="state === 'loading'" class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-slate-700">
          驗證連結中…
        </div>

        <div v-else-if="state === 'error'" class="space-y-4">
          <div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800" role="alert">
            {{ message || '暫時無法驗證連結，請確認網路後再試。' }}
          </div>
          <button type="button" class="btn btn-primary w-full" :disabled="validating" @click="validateToken">
            {{ validating ? '重新驗證中…' : '重新驗證連結' }}
          </button>
          <router-link class="btn btn-outline w-full" to="/login">返回登入</router-link>
        </div>

        <div v-else-if="state === 'invalid'" class="space-y-4">
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700" role="alert">
            {{ message || '連結無效或已過期，請重新申請重設密碼。' }}
          </div>
          <router-link class="btn btn-primary w-full" to="/login">返回登入並重新申請</router-link>
        </div>

        <div v-else-if="state === 'success'" class="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700" role="status">
          密碼已重設，正在導向…
        </div>

        <form v-else-if="state === 'valid'" class="space-y-4" novalidate @submit.prevent="submit">
          <div v-if="email" class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            帳號電子信箱：<span class="font-mono">{{ email }}</span>
          </div>

          <label class="block space-y-1">
            <span class="text-sm font-medium text-slate-800">新密碼</span>
            <div class="relative">
              <input
                v-model="p1"
                :type="show1 ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="至少 8 碼"
                class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-20 text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                aria-describedby="reset-password-help"
                :disabled="submitting"
              />
              <button type="button" class="absolute inset-y-0 right-0 min-h-11 px-4 text-sm text-slate-600 hover:text-slate-900" :disabled="submitting" @click="show1 = !show1">
                {{ show1 ? '隱藏' : '顯示' }}
              </button>
            </div>
            <span id="reset-password-help" class="block text-sm leading-6 text-slate-600">
              至少 8 碼，最多 72 個 UTF-8 bytes；空白也會視為密碼的一部分。
            </span>
          </label>

          <label class="block space-y-1">
            <span class="text-sm font-medium text-slate-800">確認新密碼</span>
            <div class="relative">
              <input
                v-model="p2"
                :type="show2 ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="再次輸入新密碼"
                class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-20 text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                :disabled="submitting"
              />
              <button type="button" class="absolute inset-y-0 right-0 min-h-11 px-4 text-sm text-slate-600 hover:text-slate-900" :disabled="submitting" @click="show2 = !show2">
                {{ show2 ? '隱藏' : '顯示' }}
              </button>
            </div>
          </label>

          <div v-if="message" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {{ message }}
          </div>

          <button type="submit" class="w-full btn btn-primary min-h-11 text-white" :disabled="submitting">
            {{ submitting ? '處理中…' : (isFirst ? '設定密碼' : '重設密碼') }}
          </button>
        </form>
      </div>
    </section>
  </main>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { setAuthSession } from '../utils/authSession'
import { passwordConfirmationError } from '../utils/passwordPolicy'
import {
  captureSensitiveAuthToken,
  notifySensitiveAuthFlowComplete,
} from '../utils/sensitiveAuthFlow'

const API = API_BASE
const route = useRoute()
const router = useRouter()

const token = ref('')
const isFirst = ref(false)
const email = ref('')
const state = ref('loading')
const validating = ref(false)
const submitting = ref(false)
const message = ref('')
const p1 = ref('')
const p2 = ref('')
const show1 = ref(false)
const show2 = ref(false)

const responsePayload = (data) => (data?.data && typeof data.data === 'object' ? data.data : data || {})

const isConfirmedTokenFailure = (status, payload = {}) => {
  const code = String(payload.code || payload.reason || '').toUpperCase()
  return status === 404
    || status === 410
    || code.includes('TOKEN_INVALID')
    || code.includes('TOKEN_EXPIRED')
    || code.includes('TOKEN_USED')
}

const confirmInvalid = (payload = {}) => {
  state.value = 'invalid'
  message.value = payload.message || '連結無效或已過期，請重新申請重設密碼。'
  notifySensitiveAuthFlowComplete({ flow: 'reset' })
}

async function validateToken() {
  if (!token.value) {
    confirmInvalid({ message: '網址中沒有可用的重設密碼資料，請重新申請。' })
    return
  }
  validating.value = true
  state.value = 'loading'
  message.value = ''
  try {
    const { data } = await axios.get(`${API}/password_resets/validate`, { params: { token: token.value } })
    const payload = responsePayload(data)
    if (!data?.ok || payload.valid === false) {
      confirmInvalid(payload)
      return
    }
    email.value = payload.maskedEmail || payload.email || ''
    state.value = 'valid'
  } catch (error) {
    const status = Number(error?.response?.status || 0)
    const payload = error?.response?.data || {}
    if (isConfirmedTokenFailure(status, payload)) confirmInvalid(payload)
    else {
      state.value = 'error'
      message.value = payload.message || '暫時無法驗證連結，密碼重設資料已保留，請稍後再試。'
    }
  } finally {
    validating.value = false
  }
}

async function submit() {
  message.value = passwordConfirmationError(p1.value, p2.value)
  if (message.value) return
  submitting.value = true
  try {
    const { data } = await axios.post(`${API}/reset-password`, { token: token.value, password: p1.value })
    if (!data?.ok) throw Object.assign(new Error(data?.message || '重設失敗'), { response: { data } })
    const payload = responsePayload(data)
    const authPayload = payload.user && typeof payload.user === 'object'
      ? { ...payload.user, token: payload.token || payload.user.token }
      : payload
    const authenticated = Boolean(authPayload?.token || authPayload?.id)
    if (authenticated) {
      setAuthSession(authPayload)
      window.dispatchEvent(new Event('auth-changed'))
    }
    state.value = 'success'
    message.value = ''
    await router.replace(authenticated ? '/store' : '/login')
    notifySensitiveAuthFlowComplete({ flow: 'reset' })
  } catch (error) {
    const status = Number(error?.response?.status || 0)
    const payload = error?.response?.data || {}
    if (isConfirmedTokenFailure(status, payload)) {
      confirmInvalid(payload)
      return
    }
    message.value = payload.message || error.message || '暫時無法重設密碼，連結與輸入內容已保留，請稍後再試。'
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''))
  isFirst.value = String(route.query.first || hashParams.get('first') || '') === '1'
  const queryToken = typeof route.query.token === 'string'
    ? route.query.token
    : (typeof route.query.reset_token === 'string' ? route.query.reset_token : '')
  token.value = captureSensitiveAuthToken({
    flow: 'reset',
    queryToken,
    aliases: ['token', 'reset_token'],
  })
  await validateToken()
})
</script>
