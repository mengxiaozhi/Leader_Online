<template>
  <AppBottomSheet
    :model-value="modelValue"
    :closable="closable"
    :close-on-backdrop="closeOnBackdrop"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <div class="space-y-5 pr-1">
      <header class="space-y-2 pr-10">
        <p v-if="eyebrow" class="text-sm font-medium tracking-[0.08em] text-slate-500">{{ eyebrow }}</p>
        <h2 class="ui-title text-xl font-medium text-slate-950">{{ title }}</h2>
        <p v-if="description" class="text-sm leading-6 text-slate-600">{{ description }}</p>
      </header>

      <div v-if="statusItems.length" class="grid grid-cols-1 gap-2">
        <div
          v-for="item in statusItems"
          :key="item.key || `${item.label}-${item.value}`"
          class="flex items-start gap-3 rounded-xl border px-3 py-3"
          :class="statusToneClass(item.tone)"
        >
          <AppIcon :name="item.icon || 'info'" class="mt-0.5 h-4 w-4 shrink-0" />
          <div class="min-w-0">
            <p class="text-sm font-medium">{{ item.label }}</p>
            <p v-if="item.value" class="mt-0.5 text-sm leading-5 opacity-85">{{ item.value }}</p>
          </div>
        </div>
      </div>

      <ol v-if="steps.length" class="space-y-3">
        <li v-for="(step, index) in steps" :key="step.key || step.title || index" class="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
          <span class="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
            {{ index + 1 }}
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-medium text-slate-900">{{ step.title || step }}</span>
            <span v-if="step.detail" class="mt-0.5 block text-sm leading-5 text-slate-600">{{ step.detail }}</span>
          </span>
        </li>
      </ol>

      <div v-if="note" class="rounded-xl border border-slate-300 bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-700">
        {{ note }}
      </div>

      <div class="flex flex-col gap-2 pt-1 sm:flex-row">
        <button
          v-if="secondaryLabel"
          type="button"
          class="btn btn-outline w-full"
          @click="emit('secondary')"
        >
          {{ secondaryLabel }}
        </button>
        <button
          type="button"
          class="btn btn-primary w-full text-white"
          :disabled="primaryDisabled"
          @click="emit('primary')"
        >
          {{ primaryLabel }}
        </button>
      </div>
    </div>
  </AppBottomSheet>
</template>

<script setup>
import AppBottomSheet from './AppBottomSheet.vue'
import AppIcon from './AppIcon.vue'

defineProps({
  modelValue: { type: Boolean, default: false },
  closable: { type: Boolean, default: true },
  closeOnBackdrop: { type: Boolean, default: true },
  eyebrow: { type: String, default: '' },
  title: { type: String, default: '下一步' },
  description: { type: String, default: '' },
  statusItems: { type: Array, default: () => [] },
  steps: { type: Array, default: () => [] },
  note: { type: String, default: '' },
  primaryLabel: { type: String, default: '繼續' },
  secondaryLabel: { type: String, default: '' },
  primaryDisabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'primary', 'secondary'])

const statusToneClass = (tone = '') => {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (tone === 'danger') return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-300 bg-white text-slate-800'
}
</script>
