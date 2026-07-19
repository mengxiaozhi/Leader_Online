<template>
    <main class="login-page px-4 py-6 pt-safe pb-safe sm:py-10">
        <section class="login-card" aria-labelledby="login-title">
            <div class="login-card__inner">
                <section class="login-card__main">
                    <div class="login-card__brand">
                        <img src="/logo.png" alt="Leader Online" class="login-card__logo" />
                        <div class="login-card__intro">
                            <p class="login-card__eyebrow">Leader Online 帳戶</p>
                            <h1 id="login-title" class="login-card__title">
                                {{ isLogin ? '登入帳號' : '建立帳號' }}
                            </h1>
                            <p class="login-card__subtitle">
                                {{ authSubtitle }}
                            </p>
                        </div>
                    </div>

                    <div class="login-card__benefits" aria-label="帳戶功能">
                        <span>票券管理</span>
                        <span>場次預約</span>
                        <span>訂單追蹤</span>
                    </div>
                </section>

                <section class="login-card__form-area" aria-label="帳號登入表單">

                    <div v-if="isLogin" class="grid grid-cols-2 gap-1 rounded-xl border border-slate-300 bg-slate-100 p-1"
                        role="tablist" aria-label="登入方式" @keydown="handleLoginMethodKeydown">
                        <button id="login-method-password" type="button" role="tab"
                            :aria-selected="loginMethod === 'password'"
                            :aria-controls="ids.loginPanel" :tabindex="loginMethod === 'password' ? 0 : -1"
                            :class="loginMethodClass('password')" :disabled="loading"
                            @click="selectLoginMethod('password')">
                            密碼登入
                        </button>
                        <button id="login-method-email-code" type="button" role="tab"
                            :aria-selected="loginMethod === 'emailCode'"
                            :aria-controls="ids.loginPanel" :tabindex="loginMethod === 'emailCode' ? 0 : -1"
                            :class="loginMethodClass('emailCode')" :disabled="loading"
                            @click="selectLoginMethod('emailCode')">
                            驗證碼登入
                        </button>
                    </div>

                    <div v-if="message.text" class="login-card__alert">
                        <div :class="['relative px-4 py-3 text-[0.95rem] leading-6 rounded-xl border', messageClass]" role="alert"
                            aria-live="assertive">
                            <span class="block pr-6">{{ message.text }}</span>
                            <button type="button" @click="resetMessage"
                                class="absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-xl text-gray-600 transition hover:bg-black/5 hover:text-gray-900" aria-label="關閉訊息">
                                <span aria-hidden="true">×</span>
                            </button>
                        </div>
                    </div>

                    <form :id="ids.loginPanel" @submit.prevent="handleSubmit" class="login-card__form" autocomplete="off" novalidate
                        :role="isLogin ? 'tabpanel' : undefined"
                        :aria-labelledby="isLogin ? activeLoginMethodTabId : undefined" :aria-busy="loading">
                        <div v-if="!isLogin" class="login-card__field">
                            <label :for="ids.username" class="login-card__label">使用者名稱（可稍後設定）</label>
                            <input :id="ids.username" type="text" v-model.trim="form.username" placeholder="請輸入使用者名稱"
                                autocomplete="nickname" :class="fieldClasses('username')" @blur="validateField('username')"
                                :disabled="loading" />
                            <p v-if="errors.username" class="login-card__error">{{ errors.username }}</p>
                        </div>

                        <div class="login-card__field">
                            <label :for="ids.email" class="login-card__label">電子信箱</label>
                            <input :id="ids.email" type="email" v-model.trim="form.email" placeholder="請輸入電子信箱"
                                autocomplete="username email" :class="fieldClasses('email')" @blur="validateField('email')"
                                :disabled="loading || isOtpCodeStep" />
                            <p v-if="!isLogin" class="login-card__hint">
                                我們會寄送驗證信至此電子信箱，點擊連結即可完成註冊與設定密碼。
                            </p>
                            <p v-else-if="isOtpEmailStep" class="login-card__hint">
                                我們會寄出 6 位數驗證碼；尚未註冊的 Email 驗證後會自動建立帳號。
                            </p>
                            <p v-if="errors.email" class="login-card__error">{{ errors.email }}</p>
                        </div>

                        <div v-if="isPasswordLogin" class="login-card__field">
                            <label :for="ids.password" class="login-card__label">密碼</label>
                            <div class="relative">
                                <input :id="ids.password" :type="showPassword ? 'text' : 'password'" v-model.trim="form.password"
                                    placeholder="請輸入密碼（至少 8 碼）" autocomplete="current-password"
                                    :class="[...fieldClasses('password'), 'pr-24']" @blur="validateField('password')"
                                    :disabled="loading" />
                                <button type="button" @click="togglePassword" :aria-pressed="showPassword"
                                    class="absolute inset-y-0 right-0 px-4 text-[0.95rem] text-slate-700 hover:text-slate-950 focus:outline-none"
                                    :disabled="loading">
                                    {{ showPassword ? '隱藏密碼' : '顯示密碼' }}
                                </button>
                            </div>
                            <p v-if="errors.password" class="login-card__error">{{ errors.password }}</p>
                            <div class="text-left mt-3">
                                <button type="button" @click="forgotPassword"
                                    class="text-[0.95rem] text-slate-700 hover:text-slate-950 underline disabled:opacity-60 disabled:cursor-not-allowed"
                                    :disabled="loading">
                                    忘記密碼？
                                </button>
                            </div>
                        </div>

                        <div v-if="isOtpCodeStep" class="login-card__field">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <label :for="ids.otpCode" class="login-card__label">Email 驗證碼</label>
                                <button type="button" class="login-card__link text-[0.9rem]" :disabled="loading"
                                    @click="changeOtpEmail">
                                    更換電子信箱
                                </button>
                            </div>
                            <input :id="ids.otpCode" :value="otpCode" type="text" inputmode="numeric" pattern="[0-9]*"
                                maxlength="6" autocomplete="one-time-code" placeholder="請輸入 6 位數驗證碼"
                                :class="fieldClasses('otpCode')" :disabled="loading" @input="handleOtpCodeInput"
                                @blur="validateField('otpCode')" />
                            <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[0.9rem] leading-6">
                                <span :class="otpExpiresSeconds > 0 ? 'text-slate-600' : 'text-red-700'">
                                    {{ otpExpiresSeconds > 0 ? `驗證碼有效時間：${otpExpiryLabel}` : '驗證碼已逾期，請重新寄送' }}
                                </span>
                                <button type="button" class="login-card__link" :disabled="loading || resendSeconds > 0"
                                    @click="requestEmailCode">
                                    {{ resendSeconds > 0 ? `${resendSeconds} 秒後可重寄` : '重新寄送驗證碼' }}
                                </button>
                            </div>
                            <p v-if="errors.otpCode" class="login-card__error">{{ errors.otpCode }}</p>
                        </div>

                        <button type="submit" :disabled="submitDisabled"
                            class="w-full btn btn-primary login-card__submit text-white py-3 font-medium transition-all duration-300 disabled:opacity-60 disabled:cursor-wait">
                            <span v-if="!loading">{{ actionLabel }}</span>
                            <span v-else>處理中...</span>
                        </button>
                    </form>

                    <div class="login-card__quick" aria-label="快速登入選項">
                        <div class="login-card__side-divider" role="separator" aria-hidden="true">
                            <span>或使用常用帳號</span>
                        </div>
                        <div class="login-card__social-list">
                            <button type="button" @click="googleLogin"
                                class="login-card__social-btn"
                                :disabled="loading">
                                <AppIcon name="user" class="h-4 w-4" />
                                使用 Google 登入
                            </button>
                            <button type="button" @click="lineLogin"
                                class="login-card__social-btn"
                                :disabled="loading">
                                <AppIcon name="link" class="h-4 w-4" />
                                使用 Line 登入
                            </button>
                        </div>

                        <div class="login-card__switcher">
                            <span>{{ isLogin ? '還沒有帳號嗎？' : '已經有帳號？' }}</span>
                            <button type="button" @click="toggleMode"
                                class="login-card__link"
                                :disabled="loading">
                                {{ isLogin ? '前往註冊' : '前往登入' }}
                            </button>
                        </div>
                    </div>
                </section>
            </div>
        </section>
    </main>
</template>

<script setup>
    import { ref, onMounted, onBeforeUnmount, reactive, computed, nextTick, watch } from 'vue'
    import { API_BASE } from '../utils/api'
    import axios from '../api/axios'   // 全域攔截器版本
    import { useRouter, useRoute } from 'vue-router'
    import AppIcon from '../components/AppIcon.vue'
    import { setAuthSession, setBearerToken, setUserProfile } from '../utils/authSession'
    import { normalizeLocalPath } from '../utils/safeUrl'

    const router = useRouter()
    const route = useRoute()
    const API = API_BASE

    const isLogin = ref(true)
    const loading = ref(false)
    const showPassword = ref(false)
    const message = ref({ type: '', text: '' })
    const messageTimer = ref(null)
    const loginMethod = ref('password')
    const otpStep = ref('email')
    const otpCode = ref('')
    const otpEmail = ref('')
    const resendSeconds = ref(0)
    const otpExpiresSeconds = ref(0)
    const resendAvailableAt = ref(0)
    const otpExpiresAt = ref(0)
    const otpTimer = ref(null)

    const form = reactive({ username: '', email: '', password: '' })
    const errors = reactive({ username: '', email: '', password: '', otpCode: '' })
    const ids = {
        username: 'auth-username',
        email: 'auth-email',
        password: 'auth-password',
        otpCode: 'auth-email-code',
        loginPanel: 'login-method-panel'
    }
    const isPasswordLogin = computed(() => isLogin.value && loginMethod.value === 'password')
    const isOtpLogin = computed(() => isLogin.value && loginMethod.value === 'emailCode')
    const isOtpEmailStep = computed(() => isOtpLogin.value && otpStep.value === 'email')
    const isOtpCodeStep = computed(() => isOtpLogin.value && otpStep.value === 'code')
    const activeLoginMethodTabId = computed(() => loginMethod.value === 'emailCode'
        ? 'login-method-email-code'
        : 'login-method-password')
    const authSubtitle = computed(() => {
        if (!isLogin.value) return '輸入電子信箱後，我們會寄出驗證連結。'
        if (isOtpLogin.value) return '使用 Email 驗證碼快速登入，無需輸入密碼。'
        return '管理票券、預約與訂單前，請先登入。'
    })
    const actionLabel = computed(() => {
        if (!isLogin.value) return '註冊'
        if (isPasswordLogin.value) return '登入'
        return isOtpEmailStep.value ? '寄送驗證碼' : '驗證並登入'
    })
    const submitDisabled = computed(() => {
        if (loading.value) return true
        if (isOtpEmailStep.value) return resendSeconds.value > 0
        if (isOtpCodeStep.value) return otpExpiresSeconds.value <= 0
        return false
    })
    const otpExpiryLabel = computed(() => {
        const minutes = Math.floor(otpExpiresSeconds.value / 60)
        const seconds = otpExpiresSeconds.value % 60
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    })
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
        if (!isLogin.value) validateField('username')
        validateField('email')
        if (isPasswordLogin.value) validateField('password')
        if (isOtpCodeStep.value) validateField('otpCode')
        return !errors.email
            && (isLogin.value || !errors.username)
            && (!isPasswordLogin.value || !errors.password)
            && (!isOtpCodeStep.value || !errors.otpCode)
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
                if (isPasswordLogin.value) {
                    if (!form.password) errors.password = '請輸入密碼'
                    else if (form.password.length < 8) errors.password = '密碼至少 8 碼'
                }
                break
            case 'otpCode':
                errors.otpCode = ''
                if (isOtpCodeStep.value) {
                    if (otpExpiresSeconds.value <= 0) errors.otpCode = '驗證碼已逾期，請重新寄送'
                    else if (!/^\d{6}$/.test(otpCode.value)) errors.otpCode = '請輸入 6 位數驗證碼'
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
        resetOtpState()
    }

    function fieldClasses(field) {
        const base = 'w-full px-4 py-3 border rounded-xl bg-white text-[1rem] text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/20 transition disabled:opacity-60 disabled:cursor-not-allowed'
        return [base, errors[field] ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-slate-300 focus:border-primary']
    }

    function syncAuthQuery() {
        const query = { ...route.query }
        if (isLogin.value) {
            query.mode = 'login'
            query.method = loginMethod.value
            delete query.register
        } else {
            query.mode = 'register'
            delete query.method
            delete query.register
        }
        const currentMode = typeof route.query.mode === 'string' ? route.query.mode : ''
        const currentMethod = typeof route.query.method === 'string' ? route.query.method : ''
        if (currentMode === query.mode && currentMethod === (query.method || '')) return
        router.push({ query }).catch(() => {})
    }

    function applyAuthQuery() {
        const mode = typeof route.query.mode === 'string' ? route.query.mode : ''
        const method = typeof route.query.method === 'string' ? route.query.method : ''
        const wantRegister = mode === 'register' || String(route.query.register || '') === '1'
        const nextLogin = !wantRegister
        const nextMethod = method === 'emailCode' ? 'emailCode' : 'password'
        if (isLogin.value !== nextLogin) {
            isLogin.value = nextLogin
            clearForm()
            resetMessage()
        }
        if (nextLogin && loginMethod.value !== nextMethod) {
            loginMethod.value = nextMethod
            showPassword.value = false
            errors.password = ''
        }
    }

    function toggleMode() {
        isLogin.value = !isLogin.value
        loginMethod.value = 'password'
        showPassword.value = false
        clearForm()
        resetMessage()
        syncAuthQuery()
    }

    function loginMethodClass(method) {
        const base = 'min-h-[44px] rounded-lg px-3 py-2 text-[0.95rem] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60'
        return [base, loginMethod.value === method
            ? 'bg-white text-primary shadow-sm'
            : 'text-slate-600 hover:text-slate-900']
    }

    function selectLoginMethod(method, options = {}) {
        if (loading.value || loginMethod.value === method) return
        loginMethod.value = method
        if (method === 'emailCode' && otpStep.value === 'code' && otpEmail.value) {
            form.email = otpEmail.value
        }
        showPassword.value = false
        errors.email = ''
        errors.password = ''
        errors.otpCode = ''
        resetMessage()
        if (!options.skipRouteSync) syncAuthQuery()
    }

    function handleLoginMethodKeydown(event) {
        const order = ['password', 'emailCode']
        const currentIndex = order.indexOf(loginMethod.value)
        let nextIndex = currentIndex
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % order.length
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + order.length) % order.length
        else if (event.key === 'Home') nextIndex = 0
        else if (event.key === 'End') nextIndex = order.length - 1
        else return
        event.preventDefault()
        const nextMethod = order[nextIndex]
        if (nextMethod !== loginMethod.value) selectLoginMethod(nextMethod)
        nextTick(() => document.getElementById(nextMethod === 'emailCode'
            ? 'login-method-email-code'
            : 'login-method-password')?.focus())
    }

    function stopOtpTimer() {
        if (otpTimer.value) {
            clearInterval(otpTimer.value)
            otpTimer.value = null
        }
    }

    function updateOtpCountdowns() {
        const now = Date.now()
        resendSeconds.value = Math.max(0, Math.ceil((resendAvailableAt.value - now) / 1000))
        otpExpiresSeconds.value = Math.max(0, Math.ceil((otpExpiresAt.value - now) / 1000))
        if (resendSeconds.value <= 0 && otpExpiresSeconds.value <= 0) stopOtpTimer()
    }

    function startOtpCountdowns(expiresIn = 600, resendAfter = 60) {
        const now = Date.now()
        otpExpiresAt.value = now + Math.max(0, Number(expiresIn) || 600) * 1000
        resendAvailableAt.value = now + Math.max(0, Number(resendAfter) || 60) * 1000
        stopOtpTimer()
        updateOtpCountdowns()
        otpTimer.value = setInterval(updateOtpCountdowns, 1000)
    }

    function startResendCountdown(retryAfter = 60) {
        resendAvailableAt.value = Date.now() + Math.max(1, Number(retryAfter) || 60) * 1000
        stopOtpTimer()
        updateOtpCountdowns()
        otpTimer.value = setInterval(updateOtpCountdowns, 1000)
    }

    function resetOtpState() {
        stopOtpTimer()
        otpStep.value = 'email'
        otpCode.value = ''
        otpEmail.value = ''
        resendSeconds.value = 0
        otpExpiresSeconds.value = 0
        resendAvailableAt.value = 0
        otpExpiresAt.value = 0
        errors.otpCode = ''
    }

    function changeOtpEmail() {
        if (loading.value) return
        resetOtpState()
        resetMessage()
        nextTick(() => document.getElementById(ids.email)?.focus())
    }

    function handleOtpCodeInput(event) {
        const value = String(event?.target?.value || '').replace(/\D/g, '').slice(0, 6)
        otpCode.value = value
        if (event?.target && event.target.value !== value) event.target.value = value
        errors.otpCode = ''
    }

    async function requestEmailCode() {
        resetMessage()
        validateField('email')
        if (errors.email) {
            setMessage('error', errors.email)
            return
        }

        const email = form.email.trim().toLowerCase()
        loading.value = true
        try {
            const { data } = await axios.post(`${API}/auth/email-code/request`, { email })
            if (data?.ok === false) {
                setMessage('error', data?.message || '驗證碼寄送失敗')
                return
            }
            const responseData = data?.data || {}
            otpEmail.value = email
            otpStep.value = 'code'
            otpCode.value = ''
            errors.otpCode = ''
            startOtpCountdowns(responseData.expiresIn, responseData.resendAfter)
            setMessage('success', '驗證碼已寄出，請至電子信箱查收')
            nextTick(() => document.getElementById(ids.otpCode)?.focus())
        } catch (e) {
            const retryAfter = Number(e?.response?.data?.data?.retryAfter || 0)
            if (e?.response?.status === 429 && retryAfter > 0) startResendCountdown(retryAfter)
            setMessage('error', e?.response?.data?.message || e.message || '驗證碼寄送失敗')
        } finally {
            loading.value = false
        }
    }

    async function verifyEmailCode() {
        if (!validate()) {
            setMessage('error', '請確認欄位資料')
            return
        }

        loading.value = true
        try {
            const { data } = await axios.post(`${API}/auth/email-code/verify`, {
                email: otpEmail.value || form.email.trim().toLowerCase(),
                code: otpCode.value
            })
            if (!data?.ok) {
                setMessage('error', data?.message || '驗證碼無效或已逾期')
                return
            }
            setAuthSession(data.data)
            window.dispatchEvent(new Event('auth-changed'))
            setMessage('success', '登入成功')
            const redirect = normalizeLocalPath(route.query.redirect, '/store')
            setTimeout(() => router.push(redirect), 200)
        } catch (e) {
            otpCode.value = ''
            setMessage('error', e?.response?.data?.message || e.message || '驗證碼無效或已逾期')
            nextTick(() => document.getElementById(ids.otpCode)?.focus())
        } finally {
            loading.value = false
        }
    }

    // 註冊不再直接建立帳號；改寄送驗證信，使用者點擊後自動完成註冊並前往設定密碼。

    async function handleSubmit() {
        resetMessage()
        if (isOtpEmailStep.value) {
            await requestEmailCode()
            return
        }
        if (isOtpCodeStep.value) {
            await verifyEmailCode()
            return
        }
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
                    setAuthSession(data.data)
                    window.dispatchEvent(new Event('auth-changed'))
                    setMessage('success', '登入成功')
                    const redirect = normalizeLocalPath(route.query.redirect, '/store')
                    setTimeout(() => router.push(redirect), 200)
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
                    setBearerToken(t)
                    // 以 whoami 取回使用者資料，填入 user_info
                    try {
                        const { data } = await axios.get(`${API}/whoami`)
                        if (data?.ok) setUserProfile(data.data)
                        window.dispatchEvent(new Event('auth-changed'))
                    } catch (_) { }
                    // 清除網址上的 token fragment
                    try { history.replaceState(null, document.title, window.location.pathname + window.location.search) } catch { }
                    const redirect = normalizeLocalPath(route.query.redirect, '/store')
                    return router.replace(redirect)
                }
            }
        } catch (_) { }
        const emailFromQuery = typeof route.query.email === 'string' ? route.query.email : ''
        applyAuthQuery()
        if (emailFromQuery && !isLogin.value && !form.email) form.email = emailFromQuery
        // 密碼重設：若帶有 reset_token，導向專用重設頁面
        const resetToken = typeof route.query.reset_token === 'string' ? route.query.reset_token : ''
        if (resetToken) {
            router.replace({ path: '/reset', query: { token: resetToken } })
        }
    })

    watch(
        () => [route.query.mode, route.query.method, route.query.register],
        applyAuthQuery
    )

    onBeforeUnmount(() => {
        if (messageTimer.value) clearTimeout(messageTimer.value)
        stopOtpTimer()
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
        const redirect = normalizeLocalPath(route.query.redirect, '/store')
        window.location.href = `${API}/auth/google/start?redirect=${encodeURIComponent(redirect)}`
    }

    function lineLogin() {
        if (loading.value) return
        const redirect = normalizeLocalPath(route.query.redirect, '/store')
        window.location.href = `${API}/auth/line/start?redirect=${encodeURIComponent(redirect)}`
    }
</script>
