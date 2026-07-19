<template>
  <Teleport to="body">
    <div class="app-toast-region" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="toast-list" tag="ol" class="app-toast-list">
        <li
          v-for="item in toastState.items"
          :key="item.id"
          class="app-toast"
          :class="[`app-toast--${item.tone}`, { 'app-toast--passive': overlayEnvironmentState.activeCount > 0 }]"
          :role="item.tone === 'error' ? 'alert' : 'status'"
        >
          <span class="min-w-0 flex-1">{{ item.message }}</span>
          <button
            v-if="item.actionLabel && overlayEnvironmentState.activeCount === 0"
            type="button"
            class="app-toast__action"
            @click="runToastAction(item)"
          >
            {{ item.actionLabel }}
          </button>
          <button
            v-if="overlayEnvironmentState.activeCount === 0"
            type="button"
            class="app-toast__close"
            aria-label="關閉通知"
            @click="dismissToast(item.id)"
          >
            <AppIcon name="x" class="h-4 w-4" />
          </button>
        </li>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import AppIcon from './AppIcon.vue'
import { overlayEnvironmentState } from '../utils/overlayEnvironment.js'
import { dismissToast, runToastAction, toastState } from '../utils/toast.js'
</script>
