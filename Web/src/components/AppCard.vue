<template>
  <div class="ticket-card bg-white border-2 border-gray-100 p-0 shadow-sm hover:shadow-lg transition overflow-hidden">
    <div v-if="hasCover" class="relative w-full overflow-hidden" :style="{ aspectRatio: aspect }">
      <slot name="cover">
        <img :src="currentCover" :alt="alt" loading="lazy" decoding="async" :sizes="sizes"
             @error="onError"
             class="absolute inset-0 w-full h-full object-cover" />
        <div class="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-red-700/10 pointer-events-none"></div>
      </slot>
    </div>
    <div class="p-4 sm:p-5">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { computed, useSlots, ref, watch } from 'vue'

const props = defineProps({
  coverSrc: { type: String, default: '' },
  alt: { type: String, default: 'cover' },
  aspect: { type: String, default: '3 / 2' },
  sizes: { type: String, default: '(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw' },
})

const slots = useSlots()
const hasCover = computed(() => !!props.coverSrc || !!slots.cover)
const currentCover = ref(props.coverSrc || '/logo.png')
watch(() => props.coverSrc, (v) => { currentCover.value = v || '/logo.png' })
const onError = (e) => { try { e.target.src = '/logo.png' } catch {} }
</script>

<style scoped>
/* Card visual is standardized via utility classes */
</style>

