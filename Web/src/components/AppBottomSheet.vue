<template>
  <AppOverlayPanel
    :model-value="modelValue"
    :title="title"
    :description="description"
    :placement="placement"
    :size="size"
    :closable="closable"
    :close-on-backdrop="closeOnBackdrop"
    :close-on-escape="closeOnEscape"
    :drag-to-close="dragToClose"
    @update:model-value="emit('update:modelValue', $event)"
    @close="emit('close', $event)"
    @after-open="emit('after-open')"
    @after-close="emit('after-close')"
  >
    <slot />
    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
  </AppOverlayPanel>
</template>

<script setup>
import AppOverlayPanel from './AppOverlayPanel.vue'

defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  placement: { type: String, default: 'auto' },
  size: { type: String, default: 'md' },
  closable: { type: Boolean, default: true },
  closeOnBackdrop: { type: Boolean, default: true },
  closeOnEscape: { type: Boolean, default: true },
  dragToClose: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue', 'close', 'after-open', 'after-close'])
</script>
