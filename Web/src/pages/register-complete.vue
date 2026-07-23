<template>
  <main class="min-h-screen flex items-center justify-center px-4 py-8 pt-safe pb-safe">
    <section class="w-full max-w-md card p-6 sm:p-8" aria-labelledby="registration-complete-title">
      <header class="text-center mb-6">
        <p class="text-sm font-medium tracking-[0.12em] text-primary">LEADER ONLINE</p>
        <h1 id="registration-complete-title" class="ui-title mt-2 text-2xl font-medium text-slate-900">
          完成帳號註冊
        </h1>
        <p class="mt-2 text-sm leading-6 text-slate-600">
          驗證連結後設定密碼，送出完成前不會建立帳號。
        </p>
      </header>

      <div aria-live="polite">
        <div v-if="state === 'loading'" class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-slate-700">
          正在驗證註冊連結…
        </div>

        <div v-else-if="state === 'error'" class="space-y-4">
          <div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800" role="alert">
            {{ message || '暫時無法驗證連結，請確認網路後再試一次。' }}
          </div>
          <button type="button" class="btn btn-primary w-full" :disabled="validating" @click="validateToken">
            {{ validating ? '重新驗證中…' : '重新驗證連結' }}
          </button>
          <router-link class="btn btn-outline w-full" to="/login?mode=register">重新寄送驗證信</router-link>
        </div>

        <div v-else-if="state === 'invalid'" class="space-y-4">
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700" role="alert">
            {{ message || '這個註冊連結無效或已失效。' }}
          </div>
          <router-link class="btn btn-primary w-full" to="/login?mode=register">重新申請註冊連結</router-link>
          <router-link class="btn btn-outline w-full" to="/login">返回登入</router-link>
        </div>

        <div v-else-if="state === 'complete'" class="space-y-4">
          <div class="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm leading-6 text-green-700" role="status">
            帳號已建立，正在為您登入…
          </div>
        </div>

        <form v-else-if="state === 'valid'" class="space-y-4" novalidate @submit.prevent="submit">
          <div v-if="email" class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            註冊信箱：<span class="font-mono">{{ email }}</span>
          </div>
          <p v-if="expiresAtLabel" class="text-sm text-slate-600">連結有效至：{{ expiresAtLabel }}</p>

          <label class="block space-y-1">
            <span class="text-sm font-medium text-slate-800">設定密碼</span>
            <div class="relative">
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="new-password"
                class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-20 text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                aria-describedby="registration-password-help"
                :disabled="submitting"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 min-h-11 px-4 text-sm text-slate-600 hover:text-slate-900"
                :disabled="submitting"
                @click="showPassword = !showPassword"
              >
                {{ showPassword ? '隱藏' : '顯示' }}
              </button>
            </div>
            <span id="registration-password-help" class="block text-sm leading-6 text-slate-600">
              至少 8 碼，最多 72 個 UTF-8 bytes；空白也會視為密碼的一部分。
            </span>
          </label>

          <label class="block space-y-1">
            <span class="text-sm font-medium text-slate-800">確認密碼</span>
            <input
              v-model="confirmation"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              :disabled="submitting"
            />
          </label>

          <div v-if="message" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {{ message }}
          </div>

          <button type="submit" class="btn btn-primary w-full min-h-11" :disabled="submitting">
            {{ submitting ? '建立帳號中…' : '設定密碼並完成註冊' }}
          </button>
        </form>
      </div>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
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
const state = ref('loading')
const validating = ref(false)
const submitting = ref(false)
const email = ref('')
const expiresAt = ref('')
const password = ref('')
const confirmation = ref('')
const showPassword = ref(false)
const message = ref('')

const expiresAtLabel = computed(() => {
  if (!expiresAt.value) return ''
  const date = new Date(expiresAt.value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
})

const responsePayload = (data) => (data?.data && typeof data.data === 'object' ? data.data : data || {})

const isConfirmedTokenFailure = (status, payload = {}) => {
  const reason = String(payload.status || payload.reason || payload.code || '').toUpperCase()
  return status === 404
    || status === 410
    || ['INVALID', 'EXPIRED', 'USED'].includes(reason)
    || [
      'REGISTRATION_TOKEN_INVALID',
      'REGISTRATION_TOKEN_EXPIRED',
      'REGISTRATION_TOKEN_USED',
      'REGISTRATION_ALREADY_COMPLETED',
      'REGISTRATION_DATA_INVALID',
      'EMAIL_TAKEN',
    ].includes(reason)
}

const invalidMessage = (payload = {}) => {
  const reason = String(payload.status || payload.reason || payload.code || '').toUpperCase()
  if (reason.includes('USED') || reason.includes('COMPLETE')) return '這個連結已經完成註冊，請直接登入。'
  if (reason.includes('EXPIRED')) return '這個註冊連結已過期，請重新申請。'
  if (reason === 'EMAIL_TAKEN') return '此電子信箱已完成註冊，請直接登入或使用忘記密碼。'
  return payload.message || '這個註冊連結無效或已失效。'
}

const confirmInvalid = (payload = {}) => {
  state.value = 'invalid'
  message.value = invalidMessage(payload)
  notifySensitiveAuthFlowComplete({ flow: 'registration' })
}

async function validateToken() {
  if (!token.value) {
    confirmInvalid({ message: '網址中沒有可用的註冊驗證資料，請重新申請。' })
    return
  }
  validating.value = true
  state.value = 'loading'
  message.value = ''
  try {
    const { data } = await axios.post(`${API}/email-verifications/validate`, { token: token.value })
    const payload = responsePayload(data)
    if (!data?.ok || payload.valid === false) {
      confirmInvalid(payload)
      return
    }
    email.value = payload.maskedEmail || payload.email || ''
    expiresAt.value = payload.expiresAt || payload.expires_at || ''
    state.value = 'valid'
  } catch (error) {
    const status = Number(error?.response?.status || 0)
    const payload = error?.response?.data || {}
    if (isConfirmedTokenFailure(status, payload)) {
      confirmInvalid(payload)
    } else {
      state.value = 'error'
      message.value = payload.message || '暫時無法驗證註冊連結，請確認網路後再試一次。'
    }
  } finally {
    validating.value = false
  }
}

async function submit() {
  message.value = passwordConfirmationError(password.value, confirmation.value)
  if (message.value) return
  submitting.value = true
  try {
    const { data } = await axios.post(`${API}/registrations/complete`, {
      token: token.value,
      password: password.value,
    })
    if (!data?.ok) throw Object.assign(new Error(data?.message || '無法完成註冊'), { response: { data } })
    const payload = responsePayload(data)
    setAuthSession(payload.user && typeof payload.user === 'object'
      ? { ...payload.user, token: payload.token || payload.user.token }
      : payload)
    window.dispatchEvent(new Event('auth-changed'))
    state.value = 'complete'
    message.value = ''
    await router.replace('/store')
    notifySensitiveAuthFlowComplete({ flow: 'registration' })
  } catch (error) {
    const status = Number(error?.response?.status || 0)
    const payload = error?.response?.data || {}
    if (status === 404 || status === 410 || [
      'REGISTRATION_TOKEN_INVALID',
      'REGISTRATION_TOKEN_EXPIRED',
      'REGISTRATION_TOKEN_USED',
      'REGISTRATION_ALREADY_COMPLETED',
      'REGISTRATION_DATA_INVALID',
      'EMAIL_TAKEN',
    ].includes(payload.code)) {
      confirmInvalid(payload)
      return
    }
    message.value = payload.message || error.message || '暫時無法完成註冊，密碼與連結已保留，請稍後再試。'
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  const queryToken = typeof route.query.token === 'string' ? route.query.token : ''
  token.value = captureSensitiveAuthToken({
    flow: 'registration',
    queryToken,
    aliases: ['token'],
  })
  await validateToken()
})
</script>
