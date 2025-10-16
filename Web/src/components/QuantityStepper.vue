<template>
  <div class="flex items-center gap-2" :class="$attrs.class">
    <button
      type="button"
      class="btn btn-outline btn-sm"
      title="減少"
      @click="decrease"
      :disabled="disabled || valueComputed <= min"
    >
      <AppIcon name="minus" class="h-4 w-4" />
    </button>

    <input
      v-if="showInput"
      :aria-label="ariaLabel"
      type="number"
      inputmode="numeric"
      pattern="[0-9]*"
      @wheel.prevent
      class="w-20 px-2 py-1 border text-center"
      :min="min"
      :max="max"
      :disabled="disabled"
      :value="valueComputed"
      @input="onInput"
      @blur="onBlur"
    />

    <button
      type="button"
      class="btn btn-outline btn-sm"
      title="增加"
      @click="increase"
      :disabled="disabled || valueComputed >= max"
    >
      <AppIcon name="plus" class="h-4 w-4" />
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  modelValue: { type: Number, default: 1 },
  min: { type: Number, default: 1 },
  max: { type: Number, default: 10 },
  disabled: { type: Boolean, default: false },
  showInput: { type: Boolean, default: true },
  ariaLabel: { type: String, default: '數量' },
})
const emit = defineEmits(['update:modelValue'])

const clamp = (v) => {
  const n = Number.isFinite(+v) ? +v : props.min
  return Math.min(props.max, Math.max(props.min, n))
}

const valueComputed = computed({
  get: () => clamp(props.modelValue),
  set: (v) => emit('update:modelValue', clamp(v)),
})

const increase = () => { valueComputed.value = valueComputed.value + 1 }
const decrease = () => { valueComputed.value = valueComputed.value - 1 }

const onInput = (e) => {
  valueComputed.value = e?.target?.value
}
const onBlur = (e) => {
  // Ensure clamping applies when leaving the field
  valueComputed.value = e?.target?.value
}
</script>

<style scoped>
/* Inherit button/input rounded style from global project */
</style>

