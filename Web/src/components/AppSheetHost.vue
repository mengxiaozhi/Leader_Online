<template>
  <AppOverlayPanel
    v-model="state.open"
    placement="auto"
    size="sm"
    :title="state.title || defaultTitle"
    :description="state.message"
    :close-on-backdrop="state.mode === 'notice'"
    @close="closeSheet"
  >
    <form v-if="state.mode === 'prompt'" class="space-y-2" @submit.prevent="sheetResolve">
      <label for="global-sheet-prompt" class="meta-label">{{ state.placeholder || '請輸入內容' }}</label>
      <input
        id="global-sheet-prompt"
        v-model="state.input"
        data-overlay-initial-focus
        :type="state.inputType || 'text'"
        :placeholder="state.placeholder || ''"
        class="w-full"
      />
    </form>

    <template #actions>
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row">
        <button v-if="state.mode !== 'notice'" class="btn btn-outline w-full" type="button" @click="sheetReject">
          {{ state.cancelText || '取消' }}
        </button>
        <button class="btn btn-primary w-full text-white" type="button" @click="sheetResolve">
          {{ state.confirmText || (state.mode === 'notice' ? '知道了' : '確定') }}
        </button>
      </div>
    </template>
  </AppOverlayPanel>
</template>

<script setup>
import { computed } from 'vue'
import { sheetState as state, closeSheet, sheetResolve, sheetReject } from '../utils/sheet'
import AppOverlayPanel from './AppOverlayPanel.vue'

const defaultTitle = computed(() => {
  if (state.mode === 'prompt') return '請輸入資料'
  if (state.mode === 'confirm') return '請確認'
  return '提示'
})
</script>
