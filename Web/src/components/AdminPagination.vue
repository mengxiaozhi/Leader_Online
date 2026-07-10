<template>
  <div class="admin-pagination">
    <div class="admin-pagination__summary">
      共 {{ normalizedTotal }} 筆，頁面 {{ currentPage }} / {{ totalPages }}
    </div>
    <div class="admin-pagination__actions">
      <button
        type="button"
        class="btn btn-outline btn-sm"
        :disabled="loading || currentPage <= 1"
        @click="emitPage(currentPage - 1)"
      >
        上一頁
      </button>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        :disabled="loading || currentPage >= totalPages"
        @click="emitPage(currentPage + 1)"
      >
        下一頁
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  total: { type: Number, default: 0 },
  limit: { type: Number, default: 50 },
  offset: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['change'])

const normalizedTotal = computed(() => Math.max(0, Number(props.total) || 0))
const normalizedLimit = computed(() => Math.max(1, Number(props.limit) || 50))
const totalPages = computed(() => Math.max(1, Math.ceil(normalizedTotal.value / normalizedLimit.value)))
const currentPage = computed(() => Math.min(
  totalPages.value,
  Math.floor(Math.max(0, Number(props.offset) || 0) / normalizedLimit.value) + 1
))

function emitPage(page) {
  const target = Math.min(totalPages.value, Math.max(1, Number(page) || 1))
  emit('change', {
    page: target,
    offset: (target - 1) * normalizedLimit.value,
  })
}
</script>

<style scoped>
.admin-pagination {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1rem;
}

.admin-pagination__summary {
  color: #4b5563;
  font-size: 0.875rem;
}

.admin-pagination__actions {
  display: flex;
  gap: 0.5rem;
}

@media (min-width: 640px) {
  .admin-pagination {
    align-items: center;
    flex-direction: row;
    justify-content: space-between;
  }
}
</style>
