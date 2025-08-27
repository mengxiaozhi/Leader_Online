<template>
    <main class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div
            class="w-full max-w-md bg-white shadow-lg rounded-2xl p-8 border border-gray-200 transition-all duration-300 hover:shadow-2xl">
            <div class="flex justify-center mb-6">
                <img src="/logo.png" alt="LEADER LOGO" class="h-14 drop-shadow-md" />
            </div>

            <div class="text-center mb-6">
                <h1 class="text-3xl font-bold text-[#D90000] mb-2 tracking-wide">
                    {{ isLogin ? '登入' : '註冊' }}帳號
                </h1>
                <p class="text-gray-500 text-sm">
                    {{ isLogin ? '歡迎回來，請輸入帳號密碼' : '建立一個新帳號，加入我們的社群' }}
                </p>
            </div>

            <div v-if="message.text" class="mb-4">
                <div :class="[
                    'px-4 py-3 rounded-md text-sm',
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
                        class="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D90000] transition" />
                </div>

                <div>
                    <label class="block text-gray-700 mb-1 font-medium">Email</label>
                    <input type="email" v-model.trim="form.email" placeholder="請輸入 Email"
                        class="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D90000] transition" />
                </div>

                <div>
                    <label class="block text-gray-700 mb-1 font-medium">密碼</label>
                    <input :type="showPassword ? 'text' : 'password'" v-model.trim="form.password"
                        placeholder="請輸入密碼（至少 8 碼）"
                        class="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D90000] transition" />
                    <div class="text-right mt-1">
                        <button type="button" @click="showPassword = !showPassword"
                            class="text-xs text-gray-500 hover:text-gray-700 underline">
                            {{ showPassword ? '隱藏密碼' : '顯示密碼' }}
                        </button>
                    </div>
                </div>

                <button type="submit" :disabled="loading"
                    class="w-full red-gradient text-white py-3 rounded-lg font-semibold hover:shadow-lg hover:shadow-red-500/30 transform hover:scale-[1.02] transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed">
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
                <button @click="toggleMode" class="ml-1 text-[#D90000] font-semibold hover:underline transition">
                    {{ isLogin ? '前往註冊' : '前往登入' }}
                </button>
            </div>
        </div>
    </main>
</template>

<script setup>
    import { ref } from 'vue'
    import axios from '../api/axios'   // 全域攔截器版本
    import { useRouter } from 'vue-router'

    const router = useRouter()
    const API = 'https://api.xiaozhi.moe/uat/leader_online'

    const isLogin = ref(true)
    const loading = ref(false)
    const showPassword = ref(false)
    const message = ref({ type: '', text: '' })

    const form = ref({ username: '', email: '', password: '' })

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
                    setMessage('success', '登入成功，前往商店')
                    setTimeout(() => router.push('/store'), 300)
                } else {
                    setMessage('error', data?.message || '登入失敗')
                }
            } else {
                const { data } = await axios.post(`${API}/users`, {
                    username: form.value.username,
                    email: form.value.email,
                    password: form.value.password
                })
                if (data?.ok) {
                    localStorage.setItem('user_info', JSON.stringify(data.data))
                    localStorage.setItem('auth_bearer', data.data.token) // 重要：Bearer 備援
                    setMessage('success', '註冊成功，前往商店')
                    setTimeout(() => router.push('/store'), 300)
                } else {
                    setMessage('error', data?.message || '註冊失敗')
                }
            }
        } catch (e) {
            const msg = e?.response?.data?.message || e.message || '系統錯誤'
            setMessage('error', msg)
        } finally {
            loading.value = false
        }
    }
</script>

<style scoped>
    .red-gradient {
        background: linear-gradient(135deg, #D90000 0%, #B00000 100%);
    }
</style>
