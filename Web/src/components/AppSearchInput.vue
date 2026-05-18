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
      class="w-full pl-10 pr-10 py-2 rounded-xl border border-slate-300 bg-white text-[0.95rem] text-slate-800 placeholder-slate-500 focus:border-primary focus:ring-2 focus:ring-primary/20"
      @input="onInput"
    />
    <button
      v-if="showClear"
      type="button"
      class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-600 hover:text-slate-800"
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
