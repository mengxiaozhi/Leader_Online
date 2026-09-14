<template>
  <button type="button" class="admin-task-trigger" aria-haspopup="dialog" :aria-expanded="open" @click="open = true">
    <AppIcon name="search" class="h-4 w-4" />
    <span>切換功能</span>
    <kbd aria-hidden="true">{{ shortcutLabel }} K</kbd>
  </button>
  <AppBottomSheet v-model="open" title="切換後台功能" description="搜尋功能名稱，快速前往工作頁面。" size="md" @after-open="focusSearch" @after-close="query = ''">
    <div class="admin-task-switcher">
      <label for="admin-task-search" class="sr-only">搜尋後台功能</label>
      <div class="admin-task-search">
        <AppIcon name="search" class="h-5 w-5" />
        <input id="admin-task-search" ref="searchInput" v-model="query" type="search" placeholder="搜尋訂單、票券、課務…" autocomplete="off" data-overlay-initial-focus @keydown.down.prevent="focusFirstResult" @keydown.enter.prevent="selectFirstResult" />
      </div>
      <p role="status" class="admin-task-count">{{ query.trim() ? `找到 ${resultCount} 個功能` : '所有可使用的功能' }}</p>
      <div v-if="!resultCount" class="admin-task-empty">找不到符合的功能，試試其他關鍵字。</div>
      <section v-for="group in filteredGroups" :key="group.key" class="admin-task-group">
        <h3>{{ group.label }}</h3>
        <button v-for="task in group.tasks" :key="task.key" type="button" class="admin-task-result" :aria-current="task.key === activeKey ? 'page' : undefined" @click="select(task)" @keydown="navigateResults">
          <span class="admin-task-result__icon"><AppIcon :name="task.icon" class="h-5 w-5" /></span>
          <span>{{ task.label }}</span>
          <span v-if="task.key === activeKey" class="admin-task-result__current">目前頁面</span>
          <AppIcon v-else name="arrow-left" class="ml-auto h-4 w-4 rotate-180" />
        </button>
      </section>
    </div>
    <template #actions><p class="admin-task-help">↑ ↓ 選擇功能 · Enter 開啟 · Esc 關閉</p></template>
  </AppBottomSheet>
</template>

<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import AppBottomSheet from './AppBottomSheet.vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({ groups: { type: Array, default: () => [] }, activeKey: { type: String, default: '' } })
const emit = defineEmits(['select'])
const open = ref(false)
const query = ref('')
const searchInput = ref(null)
const shortcutLabel = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
const filteredGroups = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const rank = task => !terms.length ? 0 : task.label.toLocaleLowerCase() === query.value.trim().toLocaleLowerCase()
    ? 2 : terms.every(term => task.label.toLocaleLowerCase().includes(term)) ? 1 : 0
  return props.groups.map(group => ({
    ...group,
    tasks: group.tasks.filter(task => terms.every(term => `${group.label} ${task.label} ${task.section || ''}`.toLocaleLowerCase().includes(term)))
      .sort((a, b) => rank(b) - rank(a)),
  })).filter(group => group.tasks.length).sort((a, b) => rank(b.tasks[0]) - rank(a.tasks[0]))
})
const resultCount = computed(() => filteredGroups.value.reduce((total, group) => total + group.tasks.length, 0))
const focusSearch = () => searchInput.value?.focus({ preventScroll: true })
const resultButtons = () => Array.from(searchInput.value?.closest('.admin-task-switcher')?.querySelectorAll('.admin-task-result') || [])
const focusFirstResult = () => resultButtons()[0]?.focus()
function selectFirstResult() {
  const first = filteredGroups.value[0]?.tasks[0]
  if (first) select(first)
}
function select(task) {
  // Recheck against the current permission-filtered set before navigating.
  if (!props.groups.some(group => group.tasks.some(item => item.key === task.key))) return
  open.value = false
  emit('select', task.key)
}
function navigateResults(event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = resultButtons()
  const index = buttons.indexOf(event.currentTarget)
  if (event.key === 'ArrowUp' && index === 0) return focusSearch()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}
function handleShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
  if (!open.value && document.querySelector('[role="dialog"][aria-modal="true"]')) return
  event.preventDefault()
  open.value = !open.value
  if (open.value) nextTick(focusSearch)
}
const subscribe = () => window.addEventListener('keydown', handleShortcut)
const unsubscribe = () => window.removeEventListener('keydown', handleShortcut)
onMounted(subscribe)
onActivated(subscribe)
onBeforeUnmount(unsubscribe)
onDeactivated(() => { unsubscribe(); open.value = false; query.value = '' })
</script>

<style scoped>
.admin-task-trigger { display: inline-flex; align-items: center; justify-content: center; gap: .6rem; min-height: 44px; padding: .65rem .85rem; border: 1px solid #dce0e5; border-radius: .65rem; background: #fff; color: #475569; font-size: .875rem; white-space: nowrap; }
.admin-task-trigger kbd { margin-left: .25rem; border: 1px solid #e2e8f0; border-radius: .25rem; padding: .05rem .25rem; color: #64748b; font: .7rem system-ui; }
.admin-task-search { display: flex; align-items: center; gap: .75rem; padding: .25rem 1rem; border: 1px solid #cbd5e1; border-radius: .75rem; color: #64748b; background: #f8fafc; }
.admin-task-search:focus-within { border-color: #a9363c; outline: 3px solid #a9363c18; }
.admin-task-search input { min-width: 0; width: 100%; min-height: 48px; border: 0; background: transparent; outline: none; box-shadow: none; padding: 0; font-size: 1rem; }
.admin-task-count, .admin-task-group h3 { color: #64748b; font-size: .8125rem; margin: 1rem 0 .5rem; }
.admin-task-group h3 { font-weight: 600; }
.admin-task-result { width: 100%; display: flex; align-items: center; gap: .75rem; min-height: 52px; padding: .55rem .65rem; border-radius: .65rem; text-align: left; color: #334155; transition: background-color 150ms ease, color 150ms ease; }
.admin-task-result__icon { display: grid; place-items: center; width: 32px; height: 32px; background: #f1f5f9; border-radius: .5rem; flex-shrink: 0; }
.admin-task-result[aria-current] { background: #fbefef; color: #9f1f27; }
.admin-task-result__current { margin-left: auto; font-size: .75rem; }
.admin-task-help { margin: 0; color: #64748b; font-size: .75rem; }
.admin-task-empty { padding: 2rem 1rem; text-align: center; color: #64748b; }
.admin-task-trigger:focus-visible, .admin-task-result:focus-visible { outline: 2px solid #a9363c; outline-offset: 2px; }
@media (hover: hover) { .admin-task-trigger:hover, .admin-task-result:hover { background: #f1f5f9; color: #0f172a; } }
@media (max-width: 639px) { .admin-task-trigger kbd { display: none; } }
@media (prefers-reduced-motion: reduce) { .admin-task-result { transition: none; } }
</style>
