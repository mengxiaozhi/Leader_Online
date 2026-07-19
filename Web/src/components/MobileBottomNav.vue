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
import { isBottomNavigationVisible, isNavigationItemActive, itemsForUser } from '../utils/navigation.js'

const route = useRoute()

const readStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user_info') || 'null')
  } catch {
    return null
  }
}

const user = ref(readStoredUser())
const navMenu = computed(() => itemsForUser(user.value, { surface: 'mobile' }))
const showBottomNav = computed(() => isBottomNavigationVisible(route.path || ''))
const isActiveItem = (item) => isNavigationItemActive(`${route.path}${route.hash || ''}`, item)

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
