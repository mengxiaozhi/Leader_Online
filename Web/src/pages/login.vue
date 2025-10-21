<template>
    <main class="login-page min-h-screen flex items-center justify-center px-4 pt-safe pb-safe">
        <div
            class="login-card w-full max-w-3xl bg-white shadow-lg p-6 sm:p-8 border border-gray-100 rounded-2xl transition-all duration-300 hover:shadow-2xl">
            <div class="login-card__inner">
                <section class="login-card__main">
                    <div class="login-card__brand">
                    <!-- <div class="login-card__logo">
                            <img src="/logo.png" alt="LEADER LOGO" class="h-14 drop-shadow-md" />
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
                        <div :class="['relative px-4 py-3 text-sm rounded-md border shadow-sm', messageClass]" role="alert"
                            aria-live="assertive">
                            <span class="block pr-6">{{ message.text }}</span>
                            <button type="button" @click="resetMessage"
                                class="absolute top-2 right-2 text-gray-400 hover:text-gray-600 transition" aria-label="關閉訊息">
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
                            <p v-if="errors.username" class="mt-1 text-xs text-red-500">{{ errors.username }}</p>
                        </div>

                        <div>
                            <label :for="ids.email" class="block text-gray-700 mb-1 font-medium">Email</label>
                            <input :id="ids.email" type="email" v-model.trim="form.email" placeholder="請輸入 Email"
                                autocomplete="username email" :class="fieldClasses('email')" @blur="validateField('email')"
                                :disabled="loading" />
                            <p v-if="!isLogin" class="mt-1 text-xs text-gray-500">
                                我們會寄送驗證信至此 Email，點擊連結即可完成註冊與設定密碼。
                            </p>
                            <p v-if="errors.email" class="mt-1 text-xs text-red-500">{{ errors.email }}</p>
                        </div>

                        <div v-if="isLogin">
                            <label :for="ids.password" class="block text-gray-700 mb-1 font-medium">密碼</label>
                            <div class="relative">
                                <input :id="ids.password" :type="showPassword ? 'text' : 'password'" v-model.trim="form.password"
                                    placeholder="請輸入密碼（至少 8 碼）" autocomplete="current-password"
                                    :class="[...fieldClasses('password'), 'pr-24']" @blur="validateField('password')"
                                    :disabled="loading" />
                                <button type="button" @click="togglePassword" :aria-pressed="showPassword"
                                    class="absolute inset-y-0 right-0 px-4 text-sm text-gray-500 hover:text-gray-700 focus:outline-none"
                                    :disabled="loading">
                                    {{ showPassword ? '隱藏密碼' : '顯示密碼' }}
                                </button>
                            </div>
                            <p v-if="errors.password" class="mt-1 text-xs text-red-500">{{ errors.password }}</p>
                            <div class="text-left mt-3">
                                <button type="button" @click="forgotPassword"
                                    class="text-xs text-gray-500 hover:text-gray-700 underline disabled:opacity-60 disabled:cursor-not-allowed"
                                    :disabled="loading">
                                    忘記密碼？
                                </button>
                            </div>
                        </div>

                        <button type="submit" :disabled="loading"
                            class="w-full btn btn-primary login-card__submit text-white py-3 font-semibold hover:shadow-lg hover:shadow-red-500/30 transform hover:scale-[1.01] transition-all duration-300 disabled:opacity-60 disabled:cursor-wait">
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
                                class="login-card__link ml-1 text-primary font-semibold hover:underline transition disabled:opacity-60 disabled:cursor-not-allowed"
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
    import axios from '../api/axios'   // 全域攔截器版本
    import { useRouter, useRoute } from 'vue-router'

    const router = useRouter()
    const route = useRoute()
    const API = 'https://api.xiaozhi.moe/uat/leader_online'

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
                return 'bg-gray-50 text-gray-700 border-gray-200'
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
                    errors.email = '請輸入 Email'
                } else if (!emailPattern.test(form.email)) {
                    errors.email = 'Email 格式不正確'
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
        const base = 'w-full px-4 py-3 border rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-40 transition disabled:opacity-60 disabled:cursor-not-allowed shadow-sm'
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
                setMessage('success', '驗證信已寄出，請至信箱點擊連結，系統會帶您設定密碼並完成註冊')
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
        if (!email) { setMessage('error', '請先輸入 Email'); return }
        try {
            const { data } = await axios.post(`${API}/forgot-password`, { email })
            if (data?.ok) setMessage('success', '若該 Email 存在，我們已寄出重設密碼信')
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

<style scoped>
    .login-page {
        position: relative;
        overflow: hidden;
    }

    .login-page::before {
        content: '';
        position: absolute;
        inset: 0;
        background:
            radial-gradient(circle at top, rgba(217, 0, 0, 0.05), transparent 55%),
            radial-gradient(circle at bottom, rgba(217, 0, 0, 0.04), transparent 50%);
        opacity: 0.85;
        pointer-events: none;
    }

    .login-card {
        position: relative;
        overflow: hidden;
        backdrop-filter: blur(6px);
    }

    .login-card::before {
        content: '';
        position: absolute;
        top: -90px;
        left: 50%;
        transform: translateX(-50%);
        width: 130%;
        height: 150px;
        background: radial-gradient(circle, rgba(217, 0, 0, 0.12), transparent 72%);
        opacity: 0.75;
        pointer-events: none;
    }

    .login-card::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), transparent 38%);
        pointer-events: none;
    }

    .login-card > * {
        position: relative;
        z-index: 1;
    }

    .login-card__inner {
        display: grid;
        gap: 2rem;
    }

    @media (min-width: 768px) {
        .login-card__inner {
            grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
            gap: 2.5rem;
        }
    }

    .login-card__main {
        display: flex;
        flex-direction: column;
        gap: 1.75rem;
    }

    .login-card__brand {
        display: flex;
        align-items: center;
        gap: 1.25rem;
    }

    .login-card__logo {
        display: inline-flex;
        padding: 0.65rem;
        border-radius: 1.2rem;
        background: rgba(217, 0, 0, 0.05);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
    }

    .login-card__intro {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .login-card__title {
        font-size: clamp(1.75rem, 3vw, 2.25rem);
        font-weight: 700;
        color: var(--color-primary);
        letter-spacing: 0.08em;
        margin: 0;
    }

    .login-card__subtitle {
        margin: 0;
        color: rgba(55, 65, 81, 0.75);
        font-size: 0.95rem;
    }

    .login-card__alert {
        margin-top: -0.5rem;
    }

    .login-card__alert > div {
        box-shadow: 0 12px 20px -14px rgba(15, 23, 42, 0.4);
    }

    .login-card__form {
        display: flex;
        flex-direction: column;
        gap: 1.35rem;
    }

    .login-card__submit {
        position: relative;
        overflow: hidden;
    }

    .login-card__submit::after {
        content: '';
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at top, rgba(255, 255, 255, 0.3), transparent 70%);
        opacity: 0;
        transition: opacity 0.2s ease;
    }

    .login-card__submit:hover::after {
        opacity: 1;
    }

    .login-card__side {
        border-radius: 1.5rem;
        background: rgba(248, 250, 252, 0.96);
        border: 1px solid rgba(226, 232, 240, 0.7);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
        padding: 1.5rem;
        display: flex;
        align-items: stretch;
    }

    .login-card__side-inner {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        width: 100%;
    }

    @media (min-width: 768px) {
        .login-card__side {
            padding: 2rem;
        }
    }

    .login-card__side-title {
        font-size: 1.1rem;
        font-weight: 700;
        color: rgba(30, 41, 59, 0.88);
        margin: 0;
    }

    .login-card__side-text {
        margin: 0;
        font-size: 0.9rem;
        color: rgba(71, 85, 105, 0.78);
    }

    .login-card__side-divider {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        color: rgba(100, 116, 139, 0.7);
        font-size: 0.8rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
    }

    .login-card__side-divider::before,
    .login-card__side-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: rgba(148, 163, 184, 0.35);
    }

    .login-card__social-btn {
        border-radius: 0.75rem;
        background: rgba(255, 255, 255, 0.85);
        box-shadow: inset 0 1px 0 rgba(148, 163, 184, 0.15);
    }

    .login-card__social-btn:hover {
        box-shadow: 0 10px 22px -18px rgba(217, 0, 0, 0.35);
    }

    .login-card__switcher {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.35rem;
        font-size: 0.92rem;
    }

    .login-card__link {
        position: relative;
    }

    .login-card__link::after {
        content: '';
        position: absolute;
        left: 0;
        bottom: -2px;
        width: 100%;
        height: 2px;
        background: linear-gradient(90deg, rgba(217, 0, 0, 0.8), rgba(176, 0, 0, 0.8));
        transform: scaleX(0);
        transform-origin: left;
        transition: transform 0.2s ease;
    }

    .login-card__link:hover::after {
        transform: scaleX(1);
    }

    @media (max-width: 767px) {
        .login-card__brand {
            flex-direction: column;
            text-align: center;
        }

        .login-card__side {
            background: rgba(248, 250, 252, 0.9);
            border-radius: 1.25rem;
        }
    }

    @media (max-width: 640px) {
        .login-card {
            border-radius: 1.5rem;
        }
    }
</style>
