<template>
  <div
    class="flex min-w-max gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1"
    role="tablist"
    :aria-label="label"
  >
    <button
      v-for="option in options"
      :key="option.key"
      type="button"
      class="min-h-[40px] rounded-md px-4 py-2 text-sm font-medium transition"
      :class="modelValue === option.key ? 'bg-white text-primary shadow-sm' : 'text-slate-600 hover:text-primary'"
      role="tab"
      :aria-selected="modelValue === option.key"
      @click="$emit('update:modelValue', option.key)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup>
defineProps({
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

defineEmits(['update:modelValue'])
</script>
