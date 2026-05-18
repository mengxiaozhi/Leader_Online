<template>
    <main class="login-page min-h-screen flex items-center justify-center px-4 pt-safe pb-safe">
        <div
            class="login-card w-full max-w-3xl bg-white p-6 sm:p-8 border border-gray-300 rounded-2xl transition-all duration-300">
            <div class="login-card__inner">
                <section class="login-card__main">
                    <div class="login-card__brand">
                    <!-- <div class="login-card__logo">
                            <img src="/logo.png" alt="Leader logo" class="h-14" />
                        </div>
                        -->
                        <div class="login-card__intro">
                            <h1 class="login-card__title">
                                {{ isLogin ? '登入' : '註冊' }}帳號
                            </h1>
                            <p class="login-card__subtitle">
                                {{ isLogin ? '歡迎回來，請輸入帳號密碼' : '建立一個新帳號，加入我們的社群' }}
                            </p>
                        </div>
                    </div>

                    <div v-if="message.text" class="login-card__alert">
                        <div :class="['relative px-4 py-3 text-sm rounded-md border', messageClass]" role="alert"
                            aria-live="assertive">
                            <span class="block pr-6">{{ message.text }}</span>
                            <button type="button" @click="resetMessage"
                                class="absolute top-2 right-2 text-gray-600 hover:text-gray-800 transition" aria-label="關閉訊息">
                                <span aria-hidden="true">×</span>
                            </button>
                        </div>
                    </div>

                    <form @submit.prevent="handleSubmit" class="login-card__form" autocomplete="off" novalidate
                        :aria-busy="loading">
                        <div v-if="!isLogin">
                            <label :for="ids.username" class="block text-gray-700 mb-1 font-medium">使用者名稱（可稍後設定）</label>
                            <input :id="ids.username" type="text" v-model.trim="form.username" placeholder="請輸入使用者名稱"
                                autocomplete="nickname" :class="fieldClasses('username')" @blur="validateField('username')"
                                :disabled="loading" />
                            <p v-if="errors.username" class="mt-1 text-sm text-red-600">{{ errors.username }}</p>
                        </div>

                        <div>
                            <label :for="ids.email" class="block text-gray-700 mb-1 font-medium">電子信箱</label>
                            <input :id="ids.email" type="email" v-model.trim="form.email" placeholder="請輸入電子信箱"
                                autocomplete="username email" :class="fieldClasses('email')" @blur="validateField('email')"
                                :disabled="loading" />
                            <p v-if="!isLogin" class="mt-1 text-sm text-gray-600">
                                我們會寄送驗證信至此電子信箱，點擊連結即可完成註冊與設定密碼。
                            </p>
                            <p v-if="errors.email" class="mt-1 text-sm text-red-600">{{ errors.email }}</p>
                        </div>

                        <div v-if="isLogin">
                            <label :for="ids.password" class="block text-gray-700 mb-1 font-medium">密碼</label>
                            <div class="relative">
                                <input :id="ids.password" :type="showPassword ? 'text' : 'password'" v-model.trim="form.password"
                                    placeholder="請輸入密碼（至少 8 碼）" autocomplete="current-password"
                                    :class="[...fieldClasses('password'), 'pr-24']" @blur="validateField('password')"
                                    :disabled="loading" />
                                <button type="button" @click="togglePassword" :aria-pressed="showPassword"
                                    class="absolute inset-y-0 right-0 px-4 text-sm text-gray-600 hover:text-gray-800 focus:outline-none"
                                    :disabled="loading">
                                    {{ showPassword ? '隱藏密碼' : '顯示密碼' }}
                                </button>
                            </div>
                            <p v-if="errors.password" class="mt-1 text-sm text-red-600">{{ errors.password }}</p>
                            <div class="text-left mt-3">
                                <button type="button" @click="forgotPassword"
                                    class="text-sm text-gray-600 hover:text-gray-800 underline disabled:opacity-60 disabled:cursor-not-allowed"
                                    :disabled="loading">
                                    忘記密碼？
                                </button>
                            </div>
                        </div>

                        <button type="submit" :disabled="loading"
                            class="w-full btn btn-primary login-card__submit text-white py-3 font-medium transition-all duration-300 disabled:opacity-60 disabled:cursor-wait">
                            <span v-if="!loading">{{ actionLabel }}</span>
                            <span v-else>處理中...</span>
                        </button>
                    </form>
                </section>

                <aside class="login-card__side" aria-label="快速登入選項">
                    <div class="login-card__side-inner">
                        <h2 class="login-card__side-title">快速連結</h2>
                        <p class="login-card__side-text">使用常用帳號登入，立刻開始體驗。</p>

                        <div class="login-card__side-divider" role="separator" aria-hidden="true">
                            <span>或</span>
                        </div>

                        <div class="flex flex-col gap-3">
                            <button @click="googleLogin"
                                class="login-card__social-btn w-full border px-4 py-2 rounded hover:border-primary hover:text-primary transition disabled:opacity-60 disabled:cursor-not-allowed"
                                :disabled="loading">
                                使用 Google 登入
                            </button>
                            <button @click="lineLogin"
                                class="login-card__social-btn w-full border px-4 py-2 rounded hover:border-green-600 hover:text-green-600 transition disabled:opacity-60 disabled:cursor-not-allowed"
                                :disabled="loading">
                                使用 LINE 登入
                            </button>
                        </div>

                        <div class="login-card__switcher text-gray-600">
                            <span>{{ isLogin ? '還沒有帳號嗎？' : '已經有帳號？' }}</span>
                            <button @click="toggleMode"
                                class="login-card__link ml-1 text-primary font-medium hover:underline transition disabled:opacity-60 disabled:cursor-not-allowed"
                                :disabled="loading">
                                {{ isLogin ? '前往註冊' : '前往登入' }}
                            </button>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    </main>
</template>

<script setup>
    import { ref, onMounted, onBeforeUnmount, reactive, computed } from 'vue'
    import { API_BASE } from '../utils/api'
    import axios from '../api/axios'   // 全域攔截器版本
    import { useRouter, useRoute } from 'vue-router'

    const router = useRouter()
    const route = useRoute()
    const API = API_BASE

    const isLogin = ref(true)
    const loading = ref(false)
    const showPassword = ref(false)
    const message = ref({ type: '', text: '' })
    const messageTimer = ref(null)

    const form = reactive({ username: '', email: '', password: '' })
    const errors = reactive({ username: '', email: '', password: '' })
    const ids = {
        username: 'auth-username',
        email: 'auth-email',
        password: 'auth-password'
    }
    const actionLabel = computed(() => isLogin.value ? '登入' : '註冊')
    const messageClass = computed(() => {
        switch (message.value.type) {
            case 'success':
                return 'bg-green-50 text-green-700 border-green-200'
            case 'error':
                return 'bg-red-50 text-red-700 border-red-200'
            default:
                return 'bg-slate-100 text-gray-800 border-gray-300'
        }
    })

    // 註冊流程改為「驗證信 → 設定密碼」，不再需要先填寫密碼與輪詢驗證狀態。

    const resetMessage = () => {
        if (messageTimer.value) {
            clearTimeout(messageTimer.value)
            messageTimer.value = null
        }
        message.value = { type: '', text: '' }
    }
    const setMessage = (type, text) => {
        resetMessage()
        message.value = { type, text }
        if (type === 'success') {
            messageTimer.value = setTimeout(() => {
                message.value = { type: '', text: '' }
                messageTimer.value = null
            }, 4000)
        }
    }

    function validate() {
        validateField('username')
        validateField('email')
        validateField('password')
        if (errors.email || errors.password || errors.username) return false
        return true
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    function validateField(field) {
        switch (field) {
            case 'username':
                errors.username = ''
                if (!isLogin.value && form.username && form.username.length < 2) {
                    errors.username = '使用者名稱至少 2 個字元'
                }
                break
            case 'email':
                errors.email = ''
                if (!form.email) {
                    errors.email = '請輸入電子信箱'
                } else if (!emailPattern.test(form.email)) {
                    errors.email = '電子信箱格式不正確'
                }
                break
            case 'password':
                errors.password = ''
                if (isLogin.value) {
                    if (!form.password) errors.password = '請輸入密碼'
                    else if (form.password.length < 8) errors.password = '密碼至少 8 碼'
                }
                break
            default:
                break
        }
    }

    function clearForm() {
        form.username = ''
        form.email = ''
        form.password = ''
        errors.username = ''
        errors.email = ''
        errors.password = ''
    }

    function fieldClasses(field) {
        const base = 'w-full px-4 py-3 border rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-40 transition disabled:opacity-60 disabled:cursor-not-allowed'
        return [base, errors[field] ? 'border-red-400 focus:ring-red-200' : 'border-gray-300']
    }

    function toggleMode() {
        isLogin.value = !isLogin.value
        showPassword.value = false
        clearForm()
        resetMessage()
    }

    // 註冊不再直接建立帳號；改寄送驗證信，使用者點擊後自動完成註冊並前往設定密碼。

    async function handleSubmit() {
        resetMessage()
        if (!validate()) {
            setMessage('error', '請確認欄位資料')
            return
        }

        loading.value = true
        try {
            if (isLogin.value) {
                const { data } = await axios.post(`${API}/login`, {
                    email: form.email,
                    password: form.password
                })
                if (data?.ok) {
                    localStorage.setItem('user_info', JSON.stringify(data.data))
                    localStorage.setItem('auth_bearer', data.data.token) // 重要：Bearer 備援
                    window.dispatchEvent(new Event('auth-changed'))
                    setMessage('success', '登入成功')
                    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null
                    setTimeout(() => router.push(redirect || '/store'), 200)
                } else {
                    setMessage('error', data?.message || '登入失敗')
                }
            } else {
                // 註冊：直接寄送驗證信，使用者點擊後將自動導向「設定密碼」完成註冊
                await axios.post(`${API}/verify-email`, { email: form.email })
                setMessage('success', '驗證信已寄出，請至電子信箱點擊連結，系統會帶您設定密碼並完成註冊')
                clearForm()
            }
        } catch (e) {
            const msg = e?.response?.data?.message || e.message || '系統錯誤'
            setMessage('error', msg)
        } finally {
            loading.value = false
        }
    }

    onMounted(async () => {
        // OAuth 回跳（fragment 方案）：若帶有 #token，存為 Bearer 以支援瀏覽器阻擋跨站 Cookie 的情形
        try {
            const hash = window.location.hash || ''
            if (hash.includes('token=')) {
                const sp = new URLSearchParams(hash.slice(1))
                const t = sp.get('token')
                if (t) {
                    localStorage.setItem('auth_bearer', t)
                    // 以 whoami 取回使用者資料，填入 user_info
                    try {
                        const { data } = await axios.get(`${API}/whoami`)
                        if (data?.ok) localStorage.setItem('user_info', JSON.stringify(data.data))
                        window.dispatchEvent(new Event('auth-changed'))
                    } catch (_) { }
                    // 清除網址上的 token fragment
                    try { history.replaceState(null, document.title, window.location.pathname + window.location.search) } catch { }
                    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/store'
                    return router.replace(redirect)
                }
            }
        } catch (_) { }
        const emailFromQuery = typeof route.query.email === 'string' ? route.query.email : ''
        const wantRegister = String(route.query.register || '') === '1'
        if (emailFromQuery && wantRegister) { if (!form.email) form.email = emailFromQuery; isLogin.value = false }
        // 密碼重設：若帶有 reset_token，導向專用重設頁面
        const resetToken = typeof route.query.reset_token === 'string' ? route.query.reset_token : ''
        if (resetToken) {
            router.replace({ path: '/reset', query: { token: resetToken } })
        }
    })

    onBeforeUnmount(() => {
        if (messageTimer.value) clearTimeout(messageTimer.value)
    })

    function togglePassword() {
        showPassword.value = !showPassword.value
    }

    async function forgotPassword() {
        // 使用目前輸入的 email
        validateField('email')
        const email = (form.email || '').trim()
        if (errors.email) { setMessage('error', errors.email); return }
        if (!email) { setMessage('error', '請先輸入電子信箱'); return }
        try {
            const { data } = await axios.post(`${API}/forgot-password`, { email })
            if (data?.ok) setMessage('success', '若該電子信箱存在，我們已寄出重設密碼信')
            else setMessage('error', data?.message || '寄送失敗')
        } catch (e) {
            setMessage('error', e?.response?.data?.message || e.message)
        }
    }

    function googleLogin() {
        if (loading.value) return
        const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/store'
        window.location.href = `${API}/auth/google/start?redirect=${encodeURIComponent(redirect)}`
    }

    function lineLogin() {
        if (loading.value) return
        const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/store'
        window.location.href = `${API}/auth/line/start?redirect=${encodeURIComponent(redirect)}`
    }
</script>
