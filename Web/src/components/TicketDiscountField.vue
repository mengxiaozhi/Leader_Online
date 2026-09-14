<template>
  <div class="space-y-2 text-sm">
    <label class="block space-y-1">
      <span>票券抵免方式</span>
      <select class="w-full border px-3 py-2" :value="modelValue === 0 ? 'full' : 'fixed'" :disabled="disabled" @change="$emit('update:modelValue', $event.target.value === 'full' ? 0 : 1)">
        <option value="full">對應服務全額抵免</option>
        <option value="fixed">固定金額抵免</option>
      </select>
    </label>
    <label v-if="modelValue !== 0" class="block space-y-1">
      <span>每張抵免金額（NT$）</span>
      <input :value="modelValue" type="number" inputmode="numeric" min="1" max="99999999" step="1" class="w-full border px-3 py-2" :disabled="disabled" @input="$emit('update:modelValue', ($event.target.value === '0' ? '' : $event.target.value))" />
    </label>
    <p class="text-xs leading-5 text-slate-600">每張限用一次，最高抵免對應服務費；差額與包材費另付，不找零。</p>
  </div>
</template>
<script setup>
defineProps({ modelValue: { type: [Number, String], default: 0 }, disabled: Boolean })
defineEmits(['update:modelValue'])
</script>
