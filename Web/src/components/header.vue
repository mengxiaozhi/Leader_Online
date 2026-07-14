<template>
  <header class="sticky top-0 z-40 hidden border-b border-slate-200 bg-white/95 px-4 pt-safe shadow-sm backdrop-blur md:block">
    <div class="mx-auto flex max-w-7xl items-center justify-between gap-4 py-3 md:px-2">
      <router-link to="/" class="flex min-w-0 items-center gap-3" aria-label="Leader Online 首頁">
        <img src="/logo.png" alt="Leader Online" class="h-10 w-auto max-w-[174px] object-contain" />
        <span class="hidden border-l border-slate-200 pl-3 text-sm font-medium text-slate-600 lg:inline">
          自行車運輸・專業安全可靠
        </span>
      </router-link>

      <nav class="hidden items-center gap-1 text-[0.95rem] font-medium md:flex" aria-label="主要導覽">
        <router-link v-for="item in navMenu" :key="item.path" :to="item.path"
          class="flex min-h-[40px] items-center gap-2 rounded-lg px-3 py-2 transition"
          :class="$route.path === item.path ? 'bg-primary/10 text-primary' : 'text-slate-700 hover:bg-slate-100 hover:text-primary'">
          <AppIcon v-if="item.icon" :name="item.icon" class="h-4 w-4" /> {{ item.label }}
        </router-link>

        <router-link v-if="isBrandPage" to="/store"
          class="ml-2 flex min-h-[40px] items-center rounded-lg border border-primary bg-primary px-4 py-2 text-white transition hover:bg-secondary">
          前往商店
        </router-link>
        <router-link v-else-if="!isAuthed" to="/login"
          class="ml-2 flex min-h-[40px] items-center gap-2 rounded-lg border border-primary bg-primary px-3 py-2 text-white transition hover:bg-secondary"
          :class="$route.path === '/login' ? 'bg-secondary' : ''">
          <AppIcon name="user" class="h-4 w-4" /> 登入
        </router-link>
      </nav>
    </div>
  </header>
</template>

<script setup>
    import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
    import { useRoute } from 'vue-router'
    import AppIcon from './AppIcon.vue'

    const route = useRoute()

    // 固定導覽（不含登入/登出）
    const navItems = [
        { path: '/wallet', label: '皮夾', icon: 'ticket' },
        { path: '/store', label: '商店', icon: 'store' },
        { path: '/account', label: '帳戶', icon: 'user' },
        { path: '/admin', label: '後台', icon: 'settings' },
    ]

    const brandNavItems = [
        { path: '/brand#story', label: '品牌故事' },
        { path: '/brand#features', label: '服務特色' },
        { path: '/brand#courses', label: '課程服務' },
        { path: '/brand#process', label: '安心流程' },
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
    const isBrandPage = computed(() => route.path === '/brand')
    const isStaff = computed(() => ['ADMIN','SERVICE_PROVIDER','DRIVER','DELIVERY_POINT','STORE','COACH','EDITOR'].includes(String(user.value?.role || '').toUpperCase()))
    const navMenu = computed(() => {
        if (isBrandPage.value) return brandNavItems
        if (!isAuthed.value) {
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
