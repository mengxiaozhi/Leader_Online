<template>
  <header v-if="task" class="mobile-task-header material-chrome md:hidden">
    <button type="button" class="mobile-task-header__back" :aria-label="task.fallbackLabel" @click="goBack">
      <AppIcon name="arrow-left" class="h-5 w-5" />
      <span>{{ task.fallbackLabel }}</span>
    </button>
    <p class="mobile-task-header__title">{{ task.title }}</p>
    <span class="mobile-task-header__spacer" aria-hidden="true"></span>
  </header>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { resolveMobileTask } from '../utils/navigation.js'

const route = useRoute()
const router = useRouter()
const task = computed(() => resolveMobileTask(route.path))

const goBack = () => {
  if (window.history.state?.back) {
    router.back()
    return
  }
  router.push(task.value?.fallback || '/store')
}
</script>
