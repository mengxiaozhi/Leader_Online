<template>
  <div class="admin-table-frame" :class="{ 'admin-table-frame--compact': density === 'compact', 'admin-table-frame--pinned': pinned }">
    <div class="admin-table-frame__toolbar">
      <div class="admin-table-frame__heading">
        <strong>{{ label }}</strong>
        <span v-if="count != null" class="admin-table-frame__count">本頁 {{ count }} 筆</span>
      </div>
      <div class="admin-table-frame__controls">
        <div class="admin-table-frame__density" role="group" aria-label="表格密度">
          <button type="button" :aria-pressed="density === 'comfortable'" @click="setDensity('comfortable')">舒適</button>
          <button type="button" :aria-pressed="density === 'compact'" @click="setDensity('compact')">精簡</button>
        </div>
        <div v-if="overflow" class="admin-table-frame__scroll-actions" role="group" :aria-label="`${label}橫向捲動`">
          <button type="button" :disabled="!canScrollLeft" :aria-label="`${label}向左捲動`" :aria-controls="viewportId" @click="scrollColumns(-1)"><AppIcon name="arrow-left" class="h-4 w-4" /></button>
          <button type="button" :disabled="!canScrollRight" :aria-label="`${label}向右捲動`" :aria-controls="viewportId" @click="scrollColumns(1)"><AppIcon name="arrow-left" class="h-4 w-4 rotate-180" /></button>
        </div>
      </div>
    </div>
    <p v-if="overflow" :id="hintId" class="admin-table-frame__hint">左右捲動查看完整欄位；聚焦表格後也可使用方向鍵。</p>
    <div
      :id="viewportId" ref="viewport" class="admin-table-frame__viewport"
      role="region" :aria-label="label" :aria-describedby="overflow ? hintId : undefined"
      :tabindex="overflow || verticalOverflow ? 0 : undefined" @scroll.passive="measure"
    >
      <slot />
    </div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref, useId } from 'vue'
import AppIcon from './AppIcon.vue'
import { useAdminTableDensity } from '../composables/useAdminTableDensity.js'
import { tableScrollState } from '../utils/adminTable.js'

defineProps({ label: { type: String, required: true }, count: { type: Number, default: null } })
const { density, setDensity } = useAdminTableDensity()
const viewport = ref(null)
const overflow = ref(false)
const pinned = ref(false)
const verticalOverflow = ref(false)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
const id = useId()
const viewportId = `admin-table-${id}`
const hintId = `${viewportId}-hint`
let observer

function measure() {
  const element = viewport.value
  if (!element) return
  const state = tableScrollState(element)
  const identity = element.querySelector('thead > tr > .admin-table-identity')?.getBoundingClientRect().width || 0
  const actions = element.querySelector('thead > tr > .admin-table-actions')?.getBoundingClientRect().width || 0
  // Keep at least 256px available for the columns between the pinned edges.
  pinned.value = element.clientWidth >= identity + actions + 256
  overflow.value = state.overflow
  verticalOverflow.value = state.verticalOverflow
  canScrollLeft.value = state.canScrollLeft
  canScrollRight.value = state.canScrollRight
}
function scrollColumns(direction) {
  viewport.value?.scrollBy({ left: direction * Math.max(160, viewport.value.clientWidth * 0.65), behavior: 'instant' })
}
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(viewport.value)
    const table = viewport.value.querySelector('table')
    if (table) observer.observe(table)
  }
  window.addEventListener('resize', measure)
  measure()
})
onUpdated(() => nextTick(measure))
onBeforeUnmount(() => { observer?.disconnect(); window.removeEventListener('resize', measure) })
</script>

<style scoped>
.admin-table-frame {
  --admin-cell-y: .8rem;
  --admin-cell-x: .875rem;
  min-width: 0;
  max-width: 100%;
  border: 1px solid #dce2e9;
  border-radius: .75rem;
  background: #fff;
  color: #334155;
}
.admin-table-frame--compact { --admin-cell-y: .4rem; --admin-cell-x: .75rem; }
.admin-table-frame__toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem 1rem; padding: .55rem .875rem; border-bottom: 1px solid #e2e8f0; }
.admin-table-frame__heading, .admin-table-frame__controls { display: flex; flex-wrap: wrap; align-items: center; gap: .625rem; min-width: 0; }
.admin-table-frame__heading strong { font-size: .875rem; font-weight: 600; }
.admin-table-frame__count { color: #64748b; font-size: .75rem; font-variant-numeric: tabular-nums; }
.admin-table-frame__density { display: inline-flex; padding: .2rem; border: 1px solid #e2e8f0; border-radius: .5rem; background: #f8fafc; }
.admin-table-frame__density button { min-width: 3rem; min-height: 2.25rem; padding: .3rem .65rem; border-radius: .35rem; color: #64748b; font-size: .8125rem; }
.admin-table-frame__density button[aria-pressed='true'] { background: #fff; color: #9f1f27; font-weight: 600; box-shadow: 0 0 0 1px #dce2e9; }
.admin-table-frame__scroll-actions { display: flex; gap: .25rem; }
.admin-table-frame__scroll-actions button { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border: 1px solid #dce2e9; border-radius: .5rem; background: #fff; }
.admin-table-frame__scroll-actions button:disabled { opacity: .35; cursor: default; }
.admin-table-frame__controls button:focus-visible { outline: 2px solid #a9363c; outline-offset: 2px; }
.admin-table-frame__controls button:active:not(:disabled) { background: #f1f5f9; }
.admin-table-frame__hint { margin: 0; padding: .4rem .875rem; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: .75rem; line-height: 1.5; }
.admin-table-frame__viewport { max-height: min(65svh, 44rem); overflow: auto; overscroll-behavior-inline: contain; scrollbar-color: #aab5c4 #f1f5f9; border-radius: 0 0 .75rem .75rem; }
.admin-table-frame__viewport:focus-visible { outline: 2px solid #a9363c; outline-offset: -2px; }
.admin-table-frame :deep(.admin-data-table) { table-layout: fixed; width: max(100%, var(--admin-table-width)); min-width: var(--admin-table-width); border: 0; border-collapse: separate; border-spacing: 0; font-size: .875rem; text-align: left; line-height: 1.55; font-variant-numeric: tabular-nums; }
.admin-table-frame :deep(.admin-data-table > thead) { position: static; }
.admin-table-frame :deep(.admin-data-table > thead > tr > th) { position: sticky; top: 0; z-index: 3; height: 3.25rem; padding: .35rem var(--admin-cell-x); border: 0; border-bottom: 1px solid #cbd5e1; background: #f1f4f8; color: #475569; font-weight: 600; vertical-align: middle; white-space: nowrap; }
.admin-table-frame :deep(.admin-data-table > tbody > tr) { --admin-row-bg: #fff; background: var(--admin-row-bg); }
.admin-table-frame :deep(.admin-data-table > tbody > tr:nth-child(even)) { --admin-row-bg: #fafbfc; }
.admin-table-frame :deep(.admin-data-table > tbody > tr > td) { padding: var(--admin-cell-y) var(--admin-cell-x); border: 0; border-bottom: 1px solid #e7ebf0; background: var(--admin-row-bg); vertical-align: top; white-space: normal; overflow-wrap: anywhere; }
.admin-table-frame :deep(.admin-data-table > tbody > tr:last-child > td) { border-bottom: 0; }
.admin-table-frame :deep(.admin-data-table > tbody > tr:focus-within) { --admin-row-bg: #f5f7fb; }
.admin-table-frame :deep(.admin-data-table > tbody > tr.admin-table-row-selected) { --admin-row-bg: #fcf0f1; }
.admin-table-frame :deep(.admin-data-table .admin-table-actions > div) { display: flex; flex-wrap: wrap; align-items: flex-start; gap: .5rem; }
.admin-table-frame :deep(.admin-data-table .admin-table-actions .btn) { width: auto; min-height: 2.5rem; padding: .4rem .6rem; white-space: normal; text-align: center; line-height: 1.4; font-size: .8125rem; }
.admin-table-frame :deep(.admin-data-table .badge), .admin-table-frame :deep(.admin-data-table .ops-chip) { display: inline-flex; max-width: 100%; padding: .2rem .5rem; white-space: normal; line-height: 1.5; font-size: .75rem; }
.admin-table-frame :deep(.admin-data-table input:not([type='checkbox']):not([type='radio'])), .admin-table-frame :deep(.admin-data-table select) { width: 100%; min-width: 0; min-height: 2.5rem; }
.admin-table-frame :deep(.admin-data-table input[type='checkbox']) { width: 1rem; height: 1rem; accent-color: #a9363c; cursor: pointer; }
.admin-table-frame :deep(.admin-data-table .admin-table-number) { text-align: right; font-variant-numeric: tabular-nums; }
.admin-table-frame :deep(.admin-data-table .admin-table-number .table-filter__button) { justify-content: flex-end; text-align: right; }
.admin-table-frame :deep(.admin-data-table .admin-table-number .table-filter__label) { flex: 0 1 auto; }
.admin-table-frame :deep(.admin-data-table .table-filter) { width: 100%; }
.admin-table-frame :deep(.admin-data-table .table-filter__label) { white-space: nowrap; overflow: visible; text-overflow: clip; }
.admin-table-frame :deep(.admin-table-disclosure) { margin-top: .5rem; }
.admin-table-frame :deep(.admin-table-disclosure > summary) { width: fit-content; min-height: 2.5rem; padding: .5rem 0; color: #9f1f27; font-size: .8125rem; font-weight: 500; cursor: pointer; }
.admin-table-frame :deep(.admin-table-disclosure > summary:focus-visible) { outline: 2px solid #a9363c; outline-offset: 2px; border-radius: .25rem; }
.admin-table-frame :deep(.admin-order-lines) { margin-top: .5rem; padding: .65rem; border: 1px solid #e2e8f0; border-radius: .5rem; background: #fff; }
.admin-table-frame :deep(.admin-order-lines > div + div) { margin-top: .65rem; padding-top: .65rem; border-top: 1px solid #e2e8f0; }
.admin-table-frame :deep(.admin-order-lines dl) { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: .4rem .75rem; margin-top: .5rem; font-size: .75rem; }
.admin-table-frame :deep(.admin-order-lines dt) { color: #64748b; }
.admin-table-frame :deep(.admin-order-lines dd) { margin: 0; font-variant-numeric: tabular-nums; }
@media (min-width: 1024px) {
  .admin-table-frame--pinned :deep(.admin-data-table > thead > tr > .admin-table-identity), .admin-table-frame--pinned :deep(.admin-data-table > tbody > tr > .admin-table-identity) { position: sticky; left: 0; z-index: 2; border-right: 1px solid #dce2e9; }
  .admin-table-frame--pinned :deep(.admin-data-table > thead > tr > .admin-table-actions), .admin-table-frame--pinned :deep(.admin-data-table > tbody > tr > .admin-table-actions) { position: sticky; right: 0; z-index: 2; border-left: 1px solid #dce2e9; }
  .admin-table-frame--pinned :deep(.admin-data-table > thead > tr > .admin-table-identity), .admin-table-frame--pinned :deep(.admin-data-table > thead > tr > .admin-table-actions) { z-index: 4; }
}
@media (hover: hover) and (pointer: fine) {
  .admin-table-frame :deep(.admin-data-table > tbody > tr:hover) { --admin-row-bg: #f5f7fb; }
  .admin-table-frame :deep(.admin-data-table > tbody > tr.admin-table-row-selected:hover) { --admin-row-bg: #fbe9eb; }
  .admin-table-frame__controls button:hover:not(:disabled) { color: #9f1f27; }
}
@media (pointer: coarse) { .admin-table-frame__controls button, .admin-table-frame :deep(.admin-data-table .admin-table-actions .btn) { min-height: 2.75rem; min-width: 2.75rem; } }
@media (pointer: coarse) { .admin-table-frame :deep(.admin-table-disclosure > summary) { min-height: 2.75rem; } }
@media (prefers-contrast: more) { .admin-table-frame { border-color: #475569; } .admin-table-frame :deep(.admin-data-table > tbody > tr > td) { border-bottom-color: #64748b; } }
</style>
