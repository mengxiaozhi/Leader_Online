<template>
  <section class="course-resource-state" :aria-busy="loading ? 'true' : 'false'">
    <div v-if="loading && !hasContent" class="course-resource-state__panel" role="status" aria-live="polite">
      <slot name="loading">
        <span class="course-resource-state__indicator" aria-hidden="true"></span>
        <span>{{ loadingText }}</span>
      </slot>
    </div>

    <div v-else-if="error && !hasContent" class="course-resource-state__panel course-resource-state__panel--error" role="alert">
      <slot name="error" :error="error" :retry="retry">
        <div class="min-w-0 flex-1">
          <strong class="block text-slate-950">{{ errorTitle }}</strong>
          <p class="mt-1 text-sm leading-6">{{ error }}</p>
        </div>
        <button type="button" class="btn btn-outline btn-sm shrink-0" @click="retry">{{ retryLabel }}</button>
      </slot>
    </div>

    <div v-else-if="empty" class="course-resource-state__panel course-resource-state__panel--empty">
      <slot name="empty">
        <div>
          <strong class="block text-slate-950">{{ emptyTitle }}</strong>
          <p v-if="emptyText" class="mt-1 text-sm leading-6 text-slate-600">{{ emptyText }}</p>
        </div>
      </slot>
    </div>

    <template v-else>
      <div v-if="loading" class="course-resource-state__refreshing" role="status" aria-live="polite">
        <span class="course-resource-state__indicator" aria-hidden="true"></span>
        <span>{{ refreshingText }}</span>
      </div>
      <div v-if="error" class="course-resource-state__inline-error" role="alert">
        <span class="min-w-0 flex-1">{{ error }}</span>
        <button type="button" class="btn btn-outline btn-sm shrink-0" @click="retry">{{ retryLabel }}</button>
      </div>
      <slot />
    </template>
  </section>
</template>

<script setup>
defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  empty: { type: Boolean, default: false },
  hasContent: { type: Boolean, default: false },
  loadingText: { type: String, default: '課程資料載入中…' },
  refreshingText: { type: String, default: '正在更新課程資料…' },
  errorTitle: { type: String, default: '暫時無法載入' },
  emptyTitle: { type: String, default: '目前沒有資料' },
  emptyText: { type: String, default: '' },
  retryLabel: { type: String, default: '重新載入' },
})

const emit = defineEmits(['retry'])
const retry = () => emit('retry')
</script>
