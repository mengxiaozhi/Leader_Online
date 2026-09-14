<template>
  <div class="admin-pagination" :class="{ 'admin-pagination--detailed': detailed }" :aria-busy="loading">
    <div class="admin-pagination__summary" role="status">
      <template v-if="detailed">{{ normalizedTotal ? `第 ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} 筆，共 ${normalizedTotal.toLocaleString()} 筆` : '共 0 筆' }}</template>
      <template v-else>共 {{ normalizedTotal }} 筆，頁面 {{ currentPage }} / {{ totalPages }}</template>
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
      <template v-if="detailed">
        <div class="admin-pagination__pages" aria-label="選擇頁碼">
          <template v-for="(page, index) in pageItems" :key="`${page}-${index}`">
            <span v-if="page === '…'" class="admin-pagination__ellipsis" aria-hidden="true">…</span>
            <button v-else type="button" class="admin-pagination__page" :aria-label="`第 ${page} 頁`" :aria-current="currentPage === page ? 'page' : undefined" :disabled="loading" @click="emitPage(page)">{{ page }}</button>
          </template>
        </div>
        <form class="admin-pagination__jump" @submit.prevent="emitPage($event.target.elements.page.value)">
          <input :key="currentPage" name="page" type="number" inputmode="numeric" :value="currentPage" :min="1" :max="totalPages" :disabled="loading" aria-label="前往頁碼" />
          <span>/ {{ totalPages }}</span>
          <button type="submit" class="admin-pagination__go" :disabled="loading">前往</button>
        </form>
      </template>
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
  detailed: { type: Boolean, default: false },
})

const emit = defineEmits(['change'])

const normalizedTotal = computed(() => Math.max(0, Number(props.total) || 0))
const normalizedLimit = computed(() => Math.max(1, Number(props.limit) || 50))
const totalPages = computed(() => Math.max(1, Math.ceil(normalizedTotal.value / normalizedLimit.value)))
const currentPage = computed(() => Math.min(
  totalPages.value,
  Math.floor(Math.max(0, Number(props.offset) || 0) / normalizedLimit.value) + 1
))
const rangeStart = computed(() => normalizedTotal.value ? (currentPage.value - 1) * normalizedLimit.value + 1 : 0)
const rangeEnd = computed(() => Math.min(normalizedTotal.value, currentPage.value * normalizedLimit.value))
const pageItems = computed(() => {
  if (totalPages.value <= 7) return Array.from({ length: totalPages.value }, (_, index) => index + 1)
  const pages = new Set([1, totalPages.value])
  const start = Math.max(2, Math.min(currentPage.value - 1, totalPages.value - 3))
  for (let page = start; page <= Math.min(totalPages.value - 1, start + 2); page++) pages.add(page)
  const sorted = Array.from(pages).sort((a, b) => a - b)
  return sorted.flatMap((page, index) => index && page - sorted[index - 1] > 1 ? ['…', page] : [page])
})

function emitPage(page) {
  if (props.loading) return
  const target = Math.min(totalPages.value, Math.max(1, Math.floor(Number(page) || 1)))
  if (!Number.isFinite(target) || target === currentPage.value) return
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

.admin-pagination--detailed { padding-top: 1rem; border-top: 1px solid #e2e8f0; font-variant-numeric: tabular-nums; }
.admin-pagination--detailed .admin-pagination__actions { align-items: center; justify-content: space-between; }
.admin-pagination__pages { display: none; align-items: center; gap: .25rem; }
.admin-pagination__page { display: grid; place-items: center; min-width: 36px; height: 40px; border: 1px solid transparent; border-radius: .5rem; color: #475569; font-size: .875rem; }
.admin-pagination__page[aria-current] { border-color: #e3c9cc; background: #fbefef; color: #9f1f27; font-weight: 600; }
.admin-pagination__page:focus-visible { outline: 2px solid #a9363c; outline-offset: 2px; }
.admin-pagination__ellipsis { color: #64748b; padding: 0 .25rem; }
.admin-pagination__jump { display: flex; align-items: center; gap: .4rem; font-size: .875rem; color: #64748b; }
.admin-pagination__jump input { width: 3.5rem; min-height: 44px; border: 1px solid #cbd5e1; border-radius: .5rem; padding: .4rem; text-align: center; background: #fff; color: #334155; }
.admin-pagination__go { min-width: 44px; min-height: 44px; border-radius: .5rem; color: #9f1f27; background: #fbefef; font-size: .8125rem; }
.admin-pagination__go:focus-visible { outline: 2px solid #a9363c; outline-offset: 2px; }
@media (hover: hover) { .admin-pagination__page:hover { background: #f1f5f9; } }
@media (min-width: 768px) { .admin-pagination__pages { display: flex; } .admin-pagination__jump { display: none; } }
@media (max-width: 767px) { .admin-pagination--detailed .admin-pagination__actions > button { min-height: 44px; } }

@media (min-width: 640px) {
  .admin-pagination {
    align-items: center;
    flex-direction: row;
    justify-content: space-between;
  }
}
</style>
