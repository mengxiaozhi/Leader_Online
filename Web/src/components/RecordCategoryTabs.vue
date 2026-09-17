<template>
  <div
    class="t-tabs app-segmented-tabs flex min-w-max gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1"
    role="tablist"
    :aria-label="label"
    @keydown="handleKeydown"
  >
    <AppSlidingIndicator :active="modelValue" />
    <button
      v-for="option in options"
      :key="option.key"
      type="button"
      class="t-tab min-h-[44px] rounded-md px-4 py-2 text-sm font-medium transition"
      :class="modelValue === option.key ? 'bg-white text-primary shadow-sm' : 'text-slate-600 hover:text-primary'"
      role="tab"
      :aria-selected="modelValue === option.key"
      :tabindex="modelValue === option.key ? 0 : -1"
      @click="$emit('update:modelValue', option.key)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup>
import AppSlidingIndicator from './AppSlidingIndicator.vue'

const props = defineProps({
  modelValue: {
    type: String,
    required: true,
  },
  options: {
    type: Array,
    default: () => [],
  },
  label: {
    type: String,
    default: '資料分類',
  },
})

const emit = defineEmits(['update:modelValue'])

function handleKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || !props.options.length) return
  const tabs = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'))
  const index = tabs.indexOf(event.target.closest('[role="tab"]'))
  if (index < 0) return
  let next
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.length - 1
  else return
  event.preventDefault()
  emit('update:modelValue', props.options[next].key)
  tabs[next].focus({ preventScroll: true })
}
</script>
