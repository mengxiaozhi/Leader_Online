<template>
  <div :class="containerClass">
    <AppIcon
      name="search"
      class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
    />
    <input
      :value="modelValue"
      :placeholder="placeholder"
      :type="type"
      class="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-12 text-[0.92rem] text-slate-900 placeholder-slate-500 shadow-sm transition focus:border-primary focus:ring-2 focus:ring-primary/20"
      @input="onInput"
    />
    <button
      v-if="showClear"
      type="button"
      class="absolute right-2 top-1/2 min-h-8 -translate-y-1/2 rounded-md px-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
      @click="onClear"
    >
      清除
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
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
  }
})

const emit = defineEmits(['update:modelValue', 'clear'])

const showClear = computed(() => String(props.modelValue || '').length > 0)

const onInput = (event) => {
  emit('update:modelValue', event?.target?.value || '')
}

const onClear = () => {
  emit('update:modelValue', '')
  emit('clear')
}
</script>
