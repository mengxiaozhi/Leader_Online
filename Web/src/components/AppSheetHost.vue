<template>
  <transition name="fade">
    <div v-if="state.open" class="fixed inset-0 bg-black/40 z-40" @click.self="closeSheet"></div>
  </transition>
  <transition name="sheet">
    <div v-if="state.open" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel" style="padding-bottom: env(safe-area-inset-bottom)">
      <div class="relative p-4 sm:p-5 space-y-3">
        <button class="btn-ghost absolute top-3 right-3" title="關閉" @click="closeSheet"><AppIcon name="x" class="h-5 w-5" /></button>
        <div class="mx-auto h-1.5 w-10 bg-gray-300"></div>
        <h3 class="text-lg font-semibold text-primary" v-if="state.title">{{ state.title }}</h3>
        <div class="text-sm text-gray-700 whitespace-pre-line">{{ state.message }}</div>
        <div v-if="state.mode==='prompt'" class="pt-1">
          <input :type="state.inputType || 'text'" v-model.trim="state.input" :placeholder="state.placeholder || ''" class="border px-3 py-2 w-full" />
        </div>
        <div class="flex gap-2 pt-2">
          <button v-if="state.mode!=='notice'" class="btn btn-outline w-full" @click="sheetReject">{{ state.cancelText || '取消' }}</button>
          <button class="btn btn-primary text-white w-full" @click="sheetResolve">{{ state.confirmText || (state.mode==='notice' ? '知道了' : '確定') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { sheetState as state, closeSheet, sheetResolve, sheetReject } from '../utils/sheet'
import AppIcon from './AppIcon.vue'
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity .2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.sheet-enter-active, .sheet-leave-active { transition: transform .25s ease; }
.sheet-enter-from, .sheet-leave-to { transform: translateY(100%); }
</style>

