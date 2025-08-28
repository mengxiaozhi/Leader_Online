<template>
    <header class="w-full bg-white shadow-sm py-3 px-4 border-b border-gray-200">
        <div class="max-w-6xl mx-auto flex items-center justify-between">
            <!-- Logo -->
            <router-link to="/" class="flex items-center gap-2">
                <img src="/logo.png" alt="logo" class="h-10 w-auto object-contain" />
                <span class="text-xl font-bold text-[#D90000] hidden sm:block">鐵人小秘</span>
            </router-link>

            <!-- 桌面端導航 -->
            <nav class="hidden md:flex items-center gap-6 text-sm font-medium">
                <router-link v-for="item in navItems" :key="item.path" :to="item.path"
                    class="hover:text-[#D90000] transition"
                    :class="{ 'text-[#D90000] border-b-2 border-[#D90000]': $route.path === item.path }">
                    {{ item.label }}
                </router-link>

                <!-- 登入 / 登出 -->
                <router-link v-if="!isAuthed" to="/login" class="hover:text-[#D90000] transition"
                    :class="{ 'text-[#D90000] border-b-2 border-[#D90000]': $route.path === '/login' }">
                    登入
                </router-link>
                <button v-else class="hover:text-[#D90000] transition" @click="logout(false)">
                    登出
                </button>
            </nav>

            <!-- 手機端漢堡菜單 -->
            <button class="md:hidden p-2 rounded-md hover:bg-gray-100" @click="isMenuOpen = !isMenuOpen">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
            </button>
        </div>

        <!-- 手機端抽屜選單 -->
        <transition name="slide-fade">
            <div v-if="isMenuOpen"
                class="md:hidden fixed top-0 right-0 h-full w-64 bg-white shadow-lg border-l border-gray-200 z-50 p-6 flex flex-col gap-4">
                <button class="self-end mb-4" @click="isMenuOpen = false">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <router-link v-for="item in navItems" :key="item.path" :to="item.path"
                    class="py-2 px-4 rounded hover:bg-gray-100"
                    :class="{ 'text-[#D90000] font-semibold bg-red-50': $route.path === item.path }"
                    @click="isMenuOpen = false">
                    {{ item.label }}
                </router-link>

                <!-- 登入 / 登出（手機） -->
                <router-link v-if="!isAuthed" to="/login" class="py-2 px-4 rounded hover:bg-gray-100"
                    :class="{ 'text-[#D90000] font-semibold bg-red-50': $route.path === '/login' }"
                    @click="isMenuOpen = false">
                    登入
                </router-link>
                <button v-else class="py-2 px-4 rounded hover:bg-gray-100 text-left" @click="logout(true)">
                    登出
                </button>
            </div>
        </transition>
    </header>
</template>

<script setup>
    import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
    import { useRouter } from 'vue-router'
    import api from '../api/axios'

    const router = useRouter()
    const isMenuOpen = ref(false)

    // 固定導覽（不含登入/登出）
    const navItems = [
        { path: '/wallet', label: '票券' },
        { path: '/store', label: '商店' },
    ]

    // 登入狀態：以 localStorage 的 user_info 判斷 + 支援跨分頁同步
    const user = ref(JSON.parse(localStorage.getItem('user_info') || 'null'))
    const isAuthed = computed(() => !!user.value)

    // 監聽別的分頁登入/登出
    const onStorage = (e) => {
        if (e.key === 'user_info') {
            user.value = JSON.parse(localStorage.getItem('user_info') || 'null')
        }
    }
    onMounted(() => window.addEventListener('storage', onStorage))
    onBeforeUnmount(() => window.removeEventListener('storage', onStorage))

    // 登出
    async function logout(closeDrawer) {
        try {
            await api.post('/logout') // 後端會清掉 HttpOnly cookie
        } catch (_) {
            // 忽略網路/狀態錯誤，前端仍清狀態
        } finally {
            localStorage.removeItem('user_info')
            user.value = null
            if (closeDrawer) isMenuOpen.value = false
            router.push('/login')
        }
    }
</script>

<style scoped>

    .slide-fade-enter-active,
    .slide-fade-leave-active {
        transition: all 0.3s ease;
    }

    .slide-fade-enter-from,
    .slide-fade-leave-to {
        transform: translateX(100%);
        opacity: 0;
    }
</style>
