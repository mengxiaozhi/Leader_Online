<template>
    <main class="min-h-screen flex items-center justify-center bg-gray-50 px-4 pt-safe pb-safe">
        <div
            class="w-full max-w-md bg-white shadow-lg p-8 border border-gray-200 transition-all duration-300 hover:shadow-2xl">
            <div class="flex justify-center mb-6">
                <img src="/logo.png" alt="LEADER LOGO" class="h-14 drop-shadow-md" />
            </div>

            <div class="text-center mb-6">
                <h1 class="text-3xl font-bold text-primary mb-2 tracking-wide">
                    {{ isLogin ? '登入' : '註冊' }}帳號
                </h1>
                <p class="text-gray-500 text-sm">
                    {{ isLogin ? '歡迎回來，請輸入帳號密碼' : '建立一個新帳號，加入我們的社群' }}
                </p>
            </div>

            <div v-if="message.text" class="mb-4">
                <div :class="[
                    'px-4 py-3 text-sm',
                    message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200'
                        : message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-gray-50 text-gray-700 border border-gray-200'
                ]">
                    {{ message.text }}
                </div>
            </div>

            <form @submit.prevent="handleSubmit" class="space-y-4">
                <div v-if="!isLogin">
                    <label class="block text-gray-700 mb-1 font-medium">使用者名稱</label>
                    <input type="text" v-model.trim="form.username" placeholder="請輸入使用者名稱"
                        class="w-full px-4 py-3 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary transition" />
                </div>

                <div>
                    <label class="block text-gray-700 mb-1 font-medium">Email</label>
                    <input type="email" v-model.trim="form.email" placeholder="請輸入 Email"
                        class="w-full px-4 py-3 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary transition" />
                </div>

                <div>
                    <label class="block text-gray-700 mb-1 font-medium">密碼</label>
                    <input :type="showPassword ? 'text' : 'password'" v-model.trim="form.password"
                        placeholder="請輸入密碼（至少 8 碼）"
                        class="w-full px-4 py-3 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary transition" />
                    <div class="text-right mt-1">
                        <button type="button" @click="showPassword = !showPassword"
                            class="text-xs text-gray-500 hover:text-gray-700 underline">
                            {{ showPassword ? '隱藏密碼' : '顯示密碼' }}
                        </button>
                    </div>
                    <div class="text-left mt-2">
                        <button type="button" @click="forgotPassword" class="text-xs text-gray-500 hover:text-gray-700 underline">
                            忘記密碼？
                        </button>
                    </div>
                </div>

                <button type="submit" :disabled="loading"
                    class="w-full btn btn-primary text-white py-3 font-semibold hover:shadow-lg hover:shadow-red-500/30 transform hover:scale-[1.01] transition-all duration-300">
                    <span v-if="!loading">{{ isLogin ? '登入' : '註冊' }}</span>
                    <span v-else>處理中...</span>
                </button>
            </form>

            <div class="flex items-center my-6">
                <div class="flex-1 border-t border-gray-2 00"></div>
                <span class="px-3 text-gray-400 text-sm">或</span>
                <div class="flex-1 border-t border-gray-200"></div>
            </div>

            <div class="text-center text-gray-600">
                <span>{{ isLogin ? '還沒有帳號嗎？' : '已經有帳號？' }}</span>
                <button @click="toggleMode" class="ml-1 text-primary font-semibold hover:underline transition">
                    {{ isLogin ? '前往註冊' : '前往登入' }}
                </button>
            </div>
        </div>
    </main>
</template>

<script setup>
    import { ref, onMounted, onBeforeUnmount } from 'vue'
    import axios from '../api/axios'   // 全域攔截器版本
    import { useRouter, useRoute } from 'vue-router'

    const router = useRouter()
    const route = useRoute()
    const API = 'https://api.xiaozhi.moe/uat/leader_online'

    const isLogin = ref(true)
    const loading = ref(false)
    const showPassword = ref(false)
    const message = ref({ type: '', text: '' })

    const form = ref({ username: '', email: '', password: '' })
    const awaitingVerification = ref(false)
    const verifyWatcher = ref({ timer: null, email: '' })

    const resetMessage = () => { message.value = { type: '', text: '' } }
    const setMessage = (type, text) => { message.value = { type, text } }

    function validate() {
        if (!form.value.email) return '請輸入 Email'
        if (!/\S+@\S+\.\S+/.test(form.value.email)) return 'Email 格式不正確'
        if (!form.value.password || form.value.password.length < 8) return '密碼至少 8 碼'
        if (!isLogin.value && (!form.value.username || form.value.username.length < 2)) return '使用者名稱至少 2 個字'
        return ''
    }

    function toggleMode() {
        isLogin.value = !isLogin.value
        form.value = { username: '', email: '', password: '' }
        resetMessage()
    }

    function startVerificationWatch(email){
        stopVerificationWatch()
        verifyWatcher.value.email = email
        awaitingVerification.value = true
        // 立即檢查一次，之後每 3 秒輪詢
        const tick = async () => {
            try{
                const q = verifyWatcher.value.email
                if (!q) return
                const { data } = await axios.get(`${API}/check-verification`, { params: { email: q } })
                const verified = !!(data && (data.ok ? data.data?.verified : data.verified))
                if (verified){
                    stopVerificationWatch()
                    setMessage('success', '✅ 已完成 Email 驗證，正在為您自動註冊…')
                    await doRegister()
                }
            } catch(_){}
        }
        // 先跑一次
        tick()
        verifyWatcher.value.timer = setInterval(tick, 3000)
    }

    function stopVerificationWatch(){
        if (verifyWatcher.value.timer){
            clearInterval(verifyWatcher.value.timer)
            verifyWatcher.value.timer = null
        }
        awaitingVerification.value = false
    }

    async function doRegister(){
        if (loading.value) return
        const err = validate()
        if (err) { setMessage('error', err); return }
        loading.value = true
        try{
            const { data } = await axios.post(`${API}/users`, {
                username: form.value.username,
                email: form.value.email,
                password: form.value.password
            })
            if (data?.ok) {
                localStorage.setItem('user_info', JSON.stringify(data.data))
                localStorage.setItem('auth_bearer', data.data.token)
                window.dispatchEvent(new Event('auth-changed'))
                setMessage('success', '註冊成功，前往頁面')
                const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null
                setTimeout(() => router.push(redirect || '/store'), 200)
            } else {
                setMessage('error', data?.message || '註冊失敗')
            }
        } catch (e){
            const msg = e?.response?.data?.message || e.message || '系統錯誤'
            setMessage('error', msg)
        } finally {
            loading.value = false
        }
    }

    async function handleSubmit() {
        resetMessage()
        const err = validate()
        if (err) return setMessage('error', err)

        loading.value = true
        try {
            if (isLogin.value) {
                const { data } = await axios.post(`${API}/login`, {
                    email: form.value.email,
                    password: form.value.password
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
                // 先檢查 Email 是否已完成驗證
                try {
                    const { data: chk } = await axios.get(`${API}/check-verification`, { params: { email: form.value.email } })
                    const verified = !!(chk && (chk.ok ? chk.data?.verified : chk.verified))
                    if (!verified) {
                        // 觸發寄送驗證信
                        await axios.post(`${API}/verify-email`, { email: form.value.email })
                        setMessage('success', '驗證信已寄出，完成驗證後將自動註冊')
                        // 開始監聽驗證狀態，驗證成功後自動註冊
                        startVerificationWatch(form.value.email)
                        return
                    }
                } catch (_) {
                    // 檢查或寄送失敗時，仍嘗試走既有註冊流程（後端可能不強制）
                }
                await doRegister()
            }
        } catch (e) {
            const msg = e?.response?.data?.message || e.message || '系統錯誤'
            setMessage('error', msg)
        } finally {
            loading.value = false
        }
    }

    // 若從驗證頁返回並帶有參數，可嘗試自動註冊（需使用者已填寫完整資料）
    onMounted(async () => {
        const v = String(route.query.verified || '')
        const emailFromQuery = typeof route.query.email === 'string' ? route.query.email : ''
        const wantRegister = String(route.query.register || '') === '1'
        if (emailFromQuery) {
            // 來自轉贈邀請：預填 email，必要時切到註冊頁籤
            if (!form.value.email) form.value.email = emailFromQuery
            if (wantRegister) isLogin.value = false
        }
        if (v === '1' && emailFromQuery) {
            // 自動切到註冊頁籤
            isLogin.value = false
            if (!form.value.email) form.value.email = emailFromQuery
            // 僅在必填皆有時自動送出
            if (form.value.username && form.value.password && form.value.email) {
                setMessage('success', '已驗證 Email，正在為您完成註冊…')
                await doRegister()
            }
        }

        // 密碼重設：若帶有 reset_token，導向專用重設頁面
        const resetToken = typeof route.query.reset_token === 'string' ? route.query.reset_token : ''
        if (resetToken) {
            router.replace({ path: '/reset', query: { token: resetToken } })
        }
    })

    onBeforeUnmount(() => { stopVerificationWatch() })

    async function forgotPassword(){
        // 使用目前輸入的 email
        const email = (form.value.email || '').trim()
        if (!email) { setMessage('error', '請先輸入 Email'); return }
        if (!/\S+@\S+\.\S+/.test(email)) { setMessage('error', 'Email 格式不正確'); return }
        try {
            const { data } = await axios.post(`${API}/forgot-password`, { email })
            if (data?.ok) setMessage('success', '若該 Email 存在，我們已寄出重設密碼信')
            else setMessage('error', data?.message || '寄送失敗')
        } catch (e) {
            setMessage('error', e?.response?.data?.message || e.message)
        }
    }
</script>

<style scoped>
    /* 使用全域 .btn-primary */
</style>
