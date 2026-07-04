<template>
  <nav v-if="showBottomNav" class="mobile-bottom-nav md:hidden" aria-label="主要導覽">
    <router-link
      v-for="item in navMenu"
      :key="item.path"
      :to="item.path"
      class="mobile-bottom-nav__item"
      :class="{ 'mobile-bottom-nav__item--active': isActiveItem(item) }"
      :aria-current="isActiveItem(item) ? 'page' : undefined"
    >
      <span class="mobile-bottom-nav__icon" aria-hidden="true">
        <AppIcon :name="item.icon" />
      </span>
      <span class="mobile-bottom-nav__label">{{ item.label }}</span>
    </router-link>
  </nav>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from './AppIcon.vue'

const route = useRoute()

const mainNavItems = [
  { path: '/wallet', label: '皮夾', icon: 'ticket', activePaths: ['/wallet'] },
  { path: '/store', label: '商店', icon: 'store', activePaths: ['/store', '/booking'] },
  { path: '/account', label: '帳戶', icon: 'user', activePaths: ['/account'] },
  { path: '/admin', label: '後台', icon: 'settings', activePaths: ['/admin'] },
]

const guestNavItems = [
  { path: '/wallet', label: '皮夾', icon: 'ticket', activePaths: ['/wallet'] },
  { path: '/store', label: '商店', icon: 'store', activePaths: ['/store', '/booking'] },
  { path: '/login', label: '登入', icon: 'user', activePaths: ['/login'] },
]

const hiddenRoutePrefixes = ['/booking', '/reset', '/offline', '/404']

const readStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user_info') || 'null')
  } catch {
    return null
  }
}

const user = ref(readStoredUser())
const isAuthed = computed(() => Boolean(user.value))
const isStaff = computed(() => {
  const role = String(user.value?.role || '').toUpperCase()
  return ['ADMIN', 'SERVICE_PROVIDER', 'DRIVER', 'DELIVERY_POINT', 'STORE', 'EDITOR'].includes(role)
})

const navMenu = computed(() => {
  if (!isAuthed.value) return guestNavItems
  return mainNavItems.filter(item => item.path !== '/admin' || isStaff.value)
})

const showBottomNav = computed(() => {
  const path = route.path || ''
  return !hiddenRoutePrefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
})

const isActiveItem = (item) => {
  const path = route.path || ''
  return (item.activePaths || [item.path]).some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

const syncFromLocal = () => {
  user.value = readStoredUser()
}

const onStorage = (event) => {
  if (!event || event.key === 'user_info') syncFromLocal()
}

onMounted(() => {
  window.addEventListener('storage', onStorage)
  window.addEventListener('auth-changed', syncFromLocal)
})

onBeforeUnmount(() => {
  window.removeEventListener('storage', onStorage)
  window.removeEventListener('auth-changed', syncFromLocal)
})
</script>
