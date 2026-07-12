<template>
    <main class="login-page min-h-screen px-4 py-10 pt-safe pb-safe">
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
                                {{ isLogin ? '管理票券、預約與訂單前，請先登入。' : '輸入電子信箱後，我們會寄出驗證連結。' }}
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

                    <div v-if="message.text" class="login-card__alert">
                        <div :class="['relative px-4 py-3 text-[0.95rem] leading-6 rounded-xl border', messageClass]" role="alert"
                            aria-live="assertive">
                            <span class="block pr-6">{{ message.text }}</span>
                            <button type="button" @click="resetMessage"
                                class="absolute top-2.5 right-3 text-gray-600 hover:text-gray-900 transition" aria-label="關閉訊息">
                                <span aria-hidden="true">×</span>
                            </button>
                        </div>
                    </div>

                    <form @submit.prevent="handleSubmit" class="login-card__form" autocomplete="off" novalidate
                        :aria-busy="loading">
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
                                :disabled="loading" />
                            <p v-if="!isLogin" class="login-card__hint">
                                我們會寄送驗證信至此電子信箱，點擊連結即可完成註冊與設定密碼。
                            </p>
                            <p v-if="errors.email" class="login-card__error">{{ errors.email }}</p>
                        </div>

                        <div v-if="isLogin" class="login-card__field">
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

                        <button type="submit" :disabled="loading"
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
    import { ref, onMounted, onBeforeUnmount, reactive, computed } from 'vue'
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
        const base = 'w-full px-4 py-3 border rounded-xl bg-white text-[1rem] text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/20 transition disabled:opacity-60 disabled:cursor-not-allowed'
        return [base, errors[field] ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-slate-300 focus:border-primary']
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
        const redirect = normalizeLocalPath(route.query.redirect, '/store')
        window.location.href = `${API}/auth/google/start?redirect=${encodeURIComponent(redirect)}`
    }

    function lineLogin() {
        if (loading.value) return
        const redirect = normalizeLocalPath(route.query.redirect, '/store')
        window.location.href = `${API}/auth/line/start?redirect=${encodeURIComponent(redirect)}`
    }
</script>
