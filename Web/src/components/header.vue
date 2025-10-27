<template>
    <header class="w-full bg-white shadow-sm py-3 px-4 border-b border-gray-200">
        <div class="max-w-6xl mx-auto flex items-center justify-between gap-2">
            <!-- Logo -->
            <router-link to="/" class="flex items-center gap-2">
                <img src="/logo.png" alt="logo" class="h-10 w-auto object-contain" />
            </router-link>

            <!-- 桌面端導航 -->
            <nav class="hidden md:flex items-center gap-6 text-sm font-medium">
                <router-link v-for="item in navMenu" :key="item.path" :to="item.path"
                    class="hover:text-primary transition flex items-center gap-1"
                    :class="{ 'text-primary border-b-2 border-primary': $route.path === item.path }">
                    <AppIcon :name="item.icon" class="h-4 w-4" /> {{ item.label }}
                </router-link>

                <!-- 登入連結（登出放在帳戶頁） -->
                <router-link v-if="!isAuthed" to="/login" class="hover:text-primary transition flex items-center gap-1"
                    :class="{ 'text-primary border-b-2 border-primary': $route.path === '/login' }">
                    <AppIcon name="user" class="h-4 w-4" /> 登入
                </router-link>
            </nav>

            <!-- 手機端漢堡菜單 -->
            <button class="md:hidden p-2 hover:bg-gray-100" @click="isMenuOpen = !isMenuOpen">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
            </button>
        </div>

        <!-- 手機端抽屜選單 -->
        <transition name="slide-fade">
            <div v-if="isMenuOpen"
                class="md:hidden fixed top-0 right-0 h-full w-[80vw] max-w-xs bg-white shadow-lg border-l border-gray-200 z-50 p-6 flex flex-col gap-4">
                <button class="self-end mb-4" @click="isMenuOpen = false">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <router-link v-for="item in navMenu" :key="item.path" :to="item.path"
                    class="py-2 px-4 hover:bg-gray-100 flex items-center gap-2"
                    :class="{ 'text-primary font-semibold bg-red-50': $route.path === item.path }"
                    @click="isMenuOpen = false">
                    <AppIcon :name="item.icon" class="h-4 w-4" /> {{ item.label }}
                </router-link>

                <!-- 登入（手機；登出放在帳戶頁） -->
                <router-link v-if="!isAuthed" to="/login" class="py-2 px-4 hover:bg-gray-100 flex items-center gap-2"
                    :class="{ 'text-primary font-semibold bg-red-50': $route.path === '/login' }"
                    @click="isMenuOpen = false">
                    <AppIcon name="user" class="h-4 w-4" /> 登入
                </router-link>
                
            </div>
        </transition>
    </header>
</template>

<script setup>
    import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
    import { useRouter } from 'vue-router'
    import AppIcon from './AppIcon.vue'
    import api from '../api/axios'

    const router = useRouter()
    const isMenuOpen = ref(false)

    // 固定導覽（不含登入/登出）
    const navItems = [
        { path: '/wallet', label: '皮夾', icon: 'ticket' },
        { path: '/store', label: '商店', icon: 'store' },
        { path: '/account', label: '帳戶', icon: 'user' },
        { path: '/admin', label: '後台', icon: 'user' },
    ]

    // 登入狀態：以 localStorage 的 user_info 判斷 + 支援跨分頁同步
    const user = ref(JSON.parse(localStorage.getItem('user_info') || 'null'))
    const isAuthed = computed(() => !!user.value)
    const isStaff = computed(() => ['ADMIN','STORE','EDITOR','OPERATOR'].includes(String(user.value?.role || '').toUpperCase()))
    const navMenu = computed(() => {
        if (!isAuthed.value) {
            // 未登入僅顯示「商店」
            return navItems.filter(i => i.path === '/store')
        }
        // 已登入：顯示全部一般導覽；後台依權限顯示
        return navItems.filter(i => i.path !== '/admin' || isStaff.value)
    })

    // 監聽別的分頁登入/登出
    const syncFromLocal = () => {
        user.value = JSON.parse(localStorage.getItem('user_info') || 'null')
    }
    const onStorage = (e) => {
        if (e.key === 'user_info') {
            syncFromLocal()
        }
    }
    const onAuthChanged = () => { syncFromLocal() }
    onMounted(() => {
        window.addEventListener('storage', onStorage)
        window.addEventListener('auth-changed', onAuthChanged)
    })
    onBeforeUnmount(() => {
        window.removeEventListener('storage', onStorage)
        window.removeEventListener('auth-changed', onAuthChanged)
    })

    // 登出改置於帳戶頁
    const API = 'https://api.xiaozhi.moe/uat/leader_online'
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
