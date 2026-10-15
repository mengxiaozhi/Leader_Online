<template>
  <div class="quantity-stepper" :class="$attrs.class">
    <button
      type="button"
      class="quantity-stepper__button"
      title="減少"
      :aria-label="`減少${ariaLabel}`"
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
      class="quantity-stepper__input"
      :min="min"
      :max="max"
      :step="integer ? 1 : undefined"
      :disabled="disabled"
      :value="valueComputed"
      @input="onInput"
      @blur="onBlur"
    />

    <button
      type="button"
      class="quantity-stepper__button"
      title="增加"
      :aria-label="`增加${ariaLabel}`"
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
  integer: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const clamp = (v) => {
  const raw = Number.isFinite(+v) ? +v : props.min
  const n = props.integer ? Math.floor(raw) : raw
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
  // Normalize the displayed value even when clamping leaves the prop unchanged.
  if (props.integer && e?.target?.value !== '' && Number(e.target.value) !== valueComputed.value) {
    e.target.value = String(clamp(e.target.value))
  }
}
const onBlur = (e) => {
  // Ensure clamping applies when leaving the field
  valueComputed.value = e?.target?.value
  if (props.integer && e?.target) e.target.value = String(clamp(e.target.value))
}
</script>
