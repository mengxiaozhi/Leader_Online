<template>
  <AppOverlayPanel
    v-model="openState"
    placement="auto"
    size="lg"
    title="您先前已下單過相同項目"
    :close-on-backdrop="false"
    :drag-to-close="false"
    @close="finish(false)"
    @after-close="resolveAfterClose"
  >
    <p class="whitespace-pre-line break-words text-sm leading-7 text-slate-700">{{ message }}</p>
    <template #actions>
      <div class="flex w-full flex-col gap-2 sm:flex-row">
        <button type="button" class="btn btn-outline w-full" data-overlay-initial-focus @click="finish(false)">先不下單</button>
        <button type="button" class="btn btn-primary w-full text-white" @click="finish(true)">確認仍要繼續下單</button>
      </div>
    </template>
  </AppOverlayPanel>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue'
import AppOverlayPanel from './AppOverlayPanel.vue'
import { duplicateReservationOrderMessage } from '../utils/duplicateReservationOrders.js'

const openState = ref(false)
const message = ref('')
let resolver = null
let accepted = false

function finish(result) {
  accepted = result === true
  openState.value = false
}
function resolveAfterClose() {
  const resolve = resolver
  resolver = null
  resolve?.(accepted)
}
function open(matches) {
  resolver?.(false)
  accepted = false
  message.value = duplicateReservationOrderMessage(matches)
  openState.value = true
  return new Promise(resolve => { resolver = resolve })
}
onBeforeUnmount(() => { resolver?.(false); resolver = null })
defineExpose({ open })
</script>
