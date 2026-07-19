<template>
  <header class="material-chrome sticky top-0 z-40 hidden px-4 pt-safe md:block">
    <div class="mx-auto flex max-w-7xl items-center justify-between gap-4 py-3 md:px-2">
      <router-link to="/" class="flex min-w-0 items-center gap-3" aria-label="Leader Online 首頁">
        <img src="/logo.png" alt="Leader Online" class="h-10 w-auto max-w-[174px] object-contain" />
        <span class="hidden border-l border-slate-200 pl-3 text-sm font-medium text-slate-600 lg:inline">
          自行車運輸・專業安全可靠
        </span>
      </router-link>

      <nav class="hidden items-center gap-1 text-[0.95rem] font-medium md:flex" aria-label="主要導覽">
        <router-link v-for="item in navMenu" :key="item.id || item.path" :to="item.path"
          class="interactive-press flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 transition"
          :class="isActiveItem(item) ? 'bg-primary/10 text-primary' : 'text-slate-700 hover:bg-slate-100 hover:text-primary'"
          :aria-current="isActiveItem(item) ? 'page' : undefined">
          <AppIcon v-if="item.icon" :name="item.icon" class="h-4 w-4" /> {{ item.label }}
        </router-link>

        <router-link v-if="isBrandPage" to="/store"
          class="interactive-press ml-2 flex min-h-11 items-center rounded-xl border border-primary bg-primary px-4 py-2 text-white transition hover:bg-secondary">
          前往商店
        </router-link>
        <router-link v-else-if="!isAuthed" to="/login"
          class="interactive-press ml-2 flex min-h-11 items-center gap-2 rounded-xl border border-primary bg-primary px-3 py-2 text-white transition hover:bg-secondary"
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
    import { isNavigationItemActive, itemsForUser } from '../utils/navigation.js'

    const route = useRoute()

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
    const navMenu = computed(() => itemsForUser(user.value, {
        surface: 'desktop',
        brandPage: isBrandPage.value,
    }))
    const isActiveItem = (item) => isNavigationItemActive(`${route.path}${route.hash || ''}`, item)

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
