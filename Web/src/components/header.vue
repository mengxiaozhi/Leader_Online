<template>
  <header class="sticky top-0 z-40 hidden border-b border-slate-300 bg-white/95 px-4 pt-safe backdrop-blur md:block">
    <div class="max-w-6xl mx-auto flex items-center justify-between gap-3 py-3 md:px-2">
      <!-- Logo -->
      <router-link to="/" class="flex items-center gap-2">
        <img src="/logo.png" alt="logo" class="h-10 w-auto object-contain" />
      </router-link>

      <!-- 桌面端導航 -->
      <nav class="hidden md:flex items-center gap-2 text-[0.95rem] font-medium">
        <router-link v-for="item in navMenu" :key="item.path" :to="item.path"
          class="flex items-center gap-2 px-3 py-2 rounded-xl transition"
          :class="$route.path === item.path ? 'text-primary bg-primary/10' : 'text-slate-600 hover:text-primary hover:bg-white/70'">
          <AppIcon :name="item.icon" class="h-4 w-4" /> {{ item.label }}
        </router-link>

        <!-- 登入連結（登出放在帳戶頁） -->
        <router-link v-if="!isAuthed" to="/login"
          class="flex items-center gap-2 px-3 py-2 rounded-xl transition"
          :class="$route.path === '/login' ? 'text-primary bg-primary/10' : 'text-slate-600 hover:text-primary hover:bg-white/70'">
          <AppIcon name="user" class="h-4 w-4" /> 登入
        </router-link>
      </nav>
    </div>
  </header>
</template>

<script setup>
    import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
    import AppIcon from './AppIcon.vue'

    // 固定導覽（不含登入/登出）
    const navItems = [
        { path: '/wallet', label: '皮夾', icon: 'ticket' },
        { path: '/store', label: '商店', icon: 'store' },
        { path: '/account', label: '帳戶', icon: 'user' },
        { path: '/admin', label: '後台', icon: 'settings' },
    ]

    const readStoredUser = () => {
        try {
            return JSON.parse(localStorage.getItem('user_info') || 'null')
        } catch {
            return null
        }
    }

    // 登入狀態：以 localStorage 的 user_info 判斷 + 支援跨分頁同步
    const user = ref(readStoredUser())
    const isAuthed = computed(() => !!user.value)
    const isStaff = computed(() => ['ADMIN','SERVICE_PROVIDER','DRIVER','DELIVERY_POINT','STORE','EDITOR'].includes(String(user.value?.role || '').toUpperCase()))
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
        user.value = readStoredUser()
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
</script>
