<template>
  <main class="ops-page course-center-shell" :aria-labelledby="titleId">
    <header class="ops-header course-center-shell__header">
      <div v-if="$slots.breadcrumb" class="course-center-shell__breadcrumb">
        <slot name="breadcrumb" />
      </div>

      <div class="course-center-shell__heading-row">
        <div class="min-w-0">
          <p v-if="eyebrow" class="course-center-shell__eyebrow">{{ eyebrow }}</p>
          <h1 :id="titleId" class="course-center-shell__title">{{ title }}</h1>
          <p v-if="description" class="course-center-shell__description">{{ description }}</p>
        </div>

        <div v-if="$slots['header-actions']" class="course-center-shell__header-actions">
          <slot name="header-actions" />
        </div>
      </div>

      <nav
        v-if="visibleTasks.length"
        ref="navRef"
        class="course-task-nav"
        :class="{ 'course-task-nav--dense': visibleTasks.length > 3 }"
        :style="taskColumnStyle"
        :aria-label="navLabel"
      >
        <component
          :is="taskComponent(task)"
          v-for="task in visibleTasks"
          :key="task.key"
          :to="taskTarget(task) || undefined"
          :type="taskTarget(task) ? undefined : 'button'"
          class="course-task-nav__item interactive-press"
          :class="{ 'course-task-nav__item--active': isActive(task) }"
          :aria-current="isActive(task) ? 'page' : undefined"
          @click="emit('select', task)"
        >
          <span v-if="task.icon" class="course-task-nav__icon" aria-hidden="true">
            <AppIcon :name="task.icon" class="h-5 w-5" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="course-task-nav__label">{{ task.label }}</span>
          </span>
        </component>
      </nav>

      <div v-if="$slots.context" class="course-center-shell__context">
        <slot name="context" />
      </div>
    </header>

    <section class="course-center-shell__body">
      <slot />
    </section>
  </main>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { RouterLink } from 'vue-router'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  eyebrow: { type: String, default: '' },
  tasks: { type: Array, default: () => [] },
  activeKey: { type: [String, Number], default: '' },
  navLabel: { type: String, default: '課程中心導覽' },
})

const emit = defineEmits(['select'])
const titleId = `course-center-title-${useId()}`
const navRef = ref(null)

const visibleTasks = computed(() => (Array.isArray(props.tasks) ? props.tasks : [])
  .filter(task => task && String(task.key ?? '').trim() && String(task.label ?? '').trim()))

const taskColumnStyle = computed(() => ({
  '--course-task-columns': String(Math.max(1, Math.min(3, visibleTasks.value.length))),
}))

const taskTarget = task => task?.to || task?.path || ''
const taskComponent = task => taskTarget(task) ? RouterLink : 'button'
const isActive = task => String(task?.key ?? '') === String(props.activeKey ?? '')

async function revealActiveTask() {
  await nextTick()
  navRef.value?.querySelector('[aria-current="page"]')?.scrollIntoView?.({
    block: 'nearest',
    inline: 'nearest',
    behavior: 'auto',
  })
}

watch(() => props.activeKey, revealActiveTask)
onMounted(revealActiveTask)
</script>
