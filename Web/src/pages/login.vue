<template>
    <main class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div
            class="w-full max-w-md bg-white shadow-lg rounded-2xl p-8 border border-gray-200 transition-all duration-300 hover:shadow-2xl">
            <!-- LOGO -->
            <div class="flex justify-center mb-6">
                <img src="/logo.png" alt="LEADER LOGO" class="h-14 drop-shadow-md" />
            </div>

            <!-- 標題 -->
            <div class="text-center mb-8">
                <h1 class="text-3xl font-bold text-[#D90000] mb-2 tracking-wide">
                    {{ isLogin ? '登入' : '註冊' }}帳號
                </h1>
                <p class="text-gray-500 text-sm">
                    {{ isLogin ? '歡迎回來，請輸入帳號密碼' : '建立一個新帳號，加入我們的社群' }}
                </p>
            </div>

            <!-- 表單 -->
            <form @submit.prevent="handleSubmit" class="space-y-5">
                <div v-if="!isLogin">
                    <label class="block text-gray-700 mb-1 font-medium">使用者名稱</label>
                    <input type="text" v-model="form.username" placeholder="請輸入使用者名稱"
                        class="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D90000] transition" />
                </div>

                <div>
                    <label class="block text-gray-700 mb-1 font-medium">Email</label>
                    <input type="email" v-model="form.email" placeholder="請輸入 Email"
                        class="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D90000] transition" />
                </div>

                <div>
                    <label class="block text-gray-700 mb-1 font-medium">密碼</label>
                    <input type="password" v-model="form.password" placeholder="請輸入密碼"
                        class="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D90000] transition" />
                </div>

                <button type="submit"
                    class="w-full red-gradient text-white py-3 rounded-lg font-semibold hover:shadow-lg hover:shadow-red-500/30 transform hover:scale-[1.02] transition-all duration-300">
                    {{ isLogin ? '登入' : '註冊' }}
                </button>
            </form>

            <!-- 分隔線 -->
            <div class="flex items-center my-6">
                <div class="flex-1 border-t border-gray-200"></div>
                <span class="px-3 text-gray-400 text-sm">或</span>
                <div class="flex-1 border-t border-gray-200"></div>
            </div>

            <!-- 切換 -->
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
    import axios from 'axios'
    import { useRouter } from 'vue-router'

    const router = useRouter()
    const API = 'http://localhost:3000/api'

    const isLogin = ref(true)

    const form = ref({
        username: '',
        email: '',
        password: ''
    })

    const toggleMode = () => {
        isLogin.value = !isLogin.value
        form.value = { username: '', email: '', password: '' }
    }

    const handleSubmit = async () => {
        try {
            if (isLogin.value) {
                const { data } = await axios.post(`${API}/login`, {
                    email: form.value.email,
                    password: form.value.password
                })
                localStorage.setItem('user', JSON.stringify(data))
                router.push('/order')
            } else {
                const { data } = await axios.post(`${API}/users`, {
                    username: form.value.username,
                    email: form.value.email,
                    password: form.value.password
                })
                localStorage.setItem('user', JSON.stringify(data))
                isLogin.value = true
                form.value = { username: '', email: '', password: '' }
            }
        } catch (err) {
            console.error(err)
        }
    }
</script>

<style scoped>
    .red-gradient {
        background: linear-gradient(135deg, #D90000 0%, #B00000 100%);
    }
</style>
