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
    <form v-else-if="state.mode === 'refund-reason'" class="space-y-4" @submit.prevent="sheetResolve">
      <div class="space-y-2">
        <label for="global-sheet-refund-reason" class="meta-label">退款原因</label>
        <select id="global-sheet-refund-reason" v-model="state.selectedReason" data-overlay-initial-focus required class="w-full">
          <option value="" disabled>請選擇退款原因</option>
          <option v-for="reason in ORDER_REFUND_REASONS" :key="reason" :value="reason">{{ reason }}</option>
        </select>
      </div>
      <div class="space-y-2">
        <label for="global-sheet-refund-note" class="meta-label">補充原因（選填）</label>
        <textarea id="global-sheet-refund-note" v-model="state.input" rows="3" maxlength="480" placeholder="如需補充退款原因，可在此填寫" class="w-full"></textarea>
      </div>
    </form>

    <template #actions>
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row">
        <button v-if="state.mode !== 'notice'" class="btn btn-outline w-full" type="button" @click="sheetReject">
          {{ state.cancelText || '取消' }}
        </button>
        <button class="btn btn-primary w-full text-white" type="button" :disabled="state.mode === 'refund-reason' && !state.selectedReason" @click="sheetResolve">
          {{ state.confirmText || (state.mode === 'notice' ? '知道了' : '確定') }}
        </button>
      </div>
    </template>
  </AppOverlayPanel>
</template>

<script setup>
import { computed } from 'vue'
import { sheetState as state, ORDER_REFUND_REASONS, closeSheet, sheetResolve, sheetReject } from '../utils/sheet'
import AppOverlayPanel from './AppOverlayPanel.vue'

const defaultTitle = computed(() => {
  if (state.mode === 'prompt') return '請輸入資料'
  if (state.mode === 'confirm') return '請確認'
  return '提示'
})
</script>
