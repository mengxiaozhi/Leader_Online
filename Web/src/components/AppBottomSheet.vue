<template>
  <transition name="backdrop-fade">
    <div v-if="modelValue" class="fixed inset-0 bg-black/40 z-40" @click.self="onBackdrop"></div>
  </transition>
  <transition name="sheet-pop">
    <div v-if="modelValue" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel rounded-t-2xl">
      <div class="relative max-h-full overflow-y-auto p-4 sm:p-6">
        <button v-if="closable" class="btn-ghost absolute top-3 right-3 text-gray-500 hover:text-gray-700" @click="close" title="關閉">
          <AppIcon name="x" class="h-5 w-5" />
        </button>
        <slot />
      </div>
    </div>
  </transition>
</template>

<script setup>
import AppIcon from './AppIcon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  closable: { type: Boolean, default: true },
  closeOnBackdrop: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue', 'close'])

const close = () => {
  emit('update:modelValue', false)
  emit('close')
}

const onBackdrop = () => {
  if (props.closeOnBackdrop) close()
}
</script>
