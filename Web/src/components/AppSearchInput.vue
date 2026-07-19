<template>
  <div class="app-search-field" :class="containerClass">
    <label v-if="label" :for="resolvedInputId" class="app-search-field__label">{{ label }}</label>
    <div class="relative w-full">
      <AppIcon
        name="search"
        class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
      />
      <input
        :id="resolvedInputId"
        :name="name || undefined"
        :value="modelValue"
        :placeholder="placeholder"
        :type="type"
        :aria-label="resolvedAriaLabel"
        class="app-search-field__input"
        @input="onInput"
      />
      <button
        v-if="showClear"
        type="button"
        class="app-search-field__clear"
        :aria-label="`清除${label || '搜尋'}內容`"
        @click="onClear"
      >
        清除
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, useId } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    default: 'text'
  },
  containerClass: {
    type: String,
    default: 'relative w-full'
  },
  label: { type: String, default: '' },
  ariaLabel: { type: String, default: '' },
  inputId: { type: String, default: '' },
  name: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'clear'])

const showClear = computed(() => String(props.modelValue || '').length > 0)
const generatedId = `search-${useId()}`
const resolvedInputId = computed(() => props.inputId || generatedId)
const resolvedAriaLabel = computed(() => props.ariaLabel || props.label || props.placeholder || '搜尋')

const onInput = (event) => {
  emit('update:modelValue', event?.target?.value || '')
}

const onClear = () => {
  emit('update:modelValue', '')
  emit('clear')
}
</script>
