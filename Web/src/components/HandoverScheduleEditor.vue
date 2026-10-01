<template>
  <section class="handover-editor" aria-label="設定交取車時間">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div><h4 class="font-medium text-slate-900">交取車時間</h4><p class="mt-1 text-sm text-slate-600">台灣時間，可分階段公布；時間未定仍可接受預約。</p></div>
      <button type="button" class="btn btn-outline btn-sm" :disabled="loading || saving" @click="load">重新載入時程</button>
    </div>
    <p v-if="loading" class="mt-3 text-sm" role="status">載入時程中…</p>
    <template v-else-if="loaded">
      <p v-if="hasDraft" class="handover-editor__draft-note" role="status">有尚未公布的草稿，以下已載入暫存內容。客戶時間與提醒仍依上次公布的設定。</p>
      <details class="mt-3 text-sm text-slate-600">
        <summary class="cursor-pointer py-2">查看客戶目前看到的時間</summary>
        <HandoverSchedule :schedule="publishedSchedule" />
        <dl class="handover-editor__published-reminders">
          <div v-for="stage in handoverStages" :key="stage.key"><dt>{{ stage.label }}提醒</dt><dd>{{ publishedReminders[stage.key]?.map(handoverReminderLabel).join('、') || '不提前提醒' }}</dd></div>
        </dl>
      </details>
      <div class="handover-editor__grid">
        <fieldset v-for="stage in handoverStages" :key="stage.key" :disabled="saving || conflict">
          <legend>{{ stage.label }}</legend>
          <label :for="`handover-${storeId}-${stage.key}-start`">開始時間</label>
          <input :id="`handover-${storeId}-${stage.key}-start`" v-model="draft[stage.key].startsAt" type="datetime-local" :aria-label="`${stage.label}開始時間`" />
          <label :for="`handover-${storeId}-${stage.key}-end`">結束時間</label>
          <input :id="`handover-${storeId}-${stage.key}-end`" v-model="draft[stage.key].endsAt" type="datetime-local" :aria-label="`${stage.label}結束時間`" />
          <button type="button" class="handover-editor__clear" :aria-label="`清除${stage.label}時間`" @click="draft[stage.key] = { startsAt: '', endsAt: '' }">清除時間</button>
          <div class="handover-editor__reminders" role="group" :aria-label="`${stage.label}提醒設定`">
            <p class="font-medium text-sm text-slate-700">提前提醒</p>
            <p v-if="!reminders[stage.key].length" class="mt-2 text-sm text-slate-500">不提前提醒，公布或改期通知仍會寄送。</p>
            <div v-for="(reminder, index) in reminders[stage.key]" :key="reminder.id" class="handover-editor__reminder">
              <div class="handover-editor__reminder-controls">
                <span aria-hidden="true">提前</span>
                <input :id="`reminder-${storeId}-${reminder.id}`" v-model.number="reminder.value" type="number" min="1" :max="Math.floor(43200 / reminder.unit)" step="1" inputmode="numeric" :aria-label="`${stage.label}第 ${index + 1} 次提醒數值`" />
                <select v-model.number="reminder.unit" :aria-label="`${stage.label}第 ${index + 1} 次提醒單位`"><option v-for="unit in handoverReminderUnits" :key="unit.value" :value="unit.value">{{ unit.label }}</option></select>
                <button type="button" class="handover-editor__remove-reminder" :aria-label="`移除${stage.label}第 ${index + 1} 次提醒`" @click="removeReminder(stage.key, index)">移除</button>
              </div>
              <p v-if="handoverReminderAt(draft[stage.key].startsAt, reminder)" class="handover-editor__reminder-preview">預計 {{ handoverReminderAt(draft[stage.key].startsAt, reminder) }} 寄送</p>
            </div>
            <button :id="`add-reminder-${storeId}-${stage.key}`" type="button" class="handover-editor__add-reminder" :aria-label="`新增${stage.label}提醒`" :disabled="reminders[stage.key].length >= maxHandoverReminders" @click="addReminder(stage.key)">＋ 新增提醒<span v-if="reminders[stage.key].length >= maxHandoverReminders">（已達 {{ maxHandoverReminders }} 次）</span></button>
          </div>
        </fieldset>
      </div>
      <p class="mt-4 text-sm text-slate-600">暫存只儲存草稿，不通知客戶；客戶仍看到上次公布的時間，原有提醒照常寄送。</p>
      <p class="mt-1 text-sm text-amber-800">選擇「公布並通知客戶」後，時間有變更才會寄送 Email。清除已公布時間會通知用戶「時間待重新公布」。</p>
      <p class="mt-1 text-sm text-slate-600">每階段可設定最多 5 次提醒，提前 1 分鐘至 30 天，皆為台灣時間。改期會依新開始時間重排；只修改提醒設定時，只安排尚未到期的提醒，不另寄改期通知。</p>
      <p class="mt-1 text-sm text-slate-600">公布或新取得預約時，已錯過的提醒由即時通知取代，其餘提醒照常寄送。</p>
      <div class="handover-editor__actions mt-4">
        <button type="button" class="btn btn-outline" :disabled="saving || conflict" @click="save('draft')">{{ saving && savingMode === 'draft' ? '暫存中…' : '暫存，不通知客戶' }}</button>
        <button type="button" class="btn btn-primary" :disabled="saving || conflict" @click="save('publish')">{{ saving && savingMode === 'publish' ? '公布中…' : '公布並通知客戶' }}</button>
      </div>
      <div v-if="notifications" class="mt-5 border-t border-slate-200 pt-4 text-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p>Email：待寄 {{ notifications.pending }} · 已寄 {{ notifications.sent }} · 失敗 {{ notifications.failed }}</p>
          <button type="button" class="btn btn-outline btn-sm" :disabled="refreshing" @click="refreshNotifications">更新寄送狀態</button>
        </div>
        <template v-if="notifications.failed">
          <ul class="mt-2 space-y-1 text-red-700"><li v-for="failure in notifications.failures" :key="failure.id">{{ failure.lastError }}</li></ul>
          <button type="button" class="btn btn-outline btn-sm mt-3" :disabled="saving" @click="retry">重試失敗通知</button>
        </template>
      </div>
    </template>
    <p v-if="error" role="alert" class="mt-3 text-sm text-red-700">{{ error }}</p>
    <p v-if="message" role="status" class="mt-3 text-sm text-emerald-800">{{ message }}</p>
  </section>
</template>

<script setup>
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { handoverStages, handoverDraft, handoverPayload, handoverReminderDraft, handoverReminderPayload, handoverReminderEntry, handoverReminderLabel, handoverReminderAt, handoverReminderUnits, maxHandoverReminders } from '../utils/handoverSchedule'
import HandoverSchedule from './HandoverSchedule.vue'
const props = defineProps({ storeId: { type: [Number, String], required: true } })
const emit = defineEmits(['saved'])
const draft = ref(handoverDraft(null))
const reminders = ref(handoverReminderDraft(null)), publishedReminders = ref({})
let nextReminderId = 0
const version = ref(1)
const hasDraft = ref(false), publishedSchedule = ref(null), savingMode = ref('')
const loading = ref(false), loaded = ref(false), saving = ref(false), refreshing = ref(false), conflict = ref(false)
const error = ref(''), message = ref(''), notifications = ref(null)
let requestSerial = 0
const endpoint = () => `${API_BASE}/admin/events/stores/${props.storeId}/schedule`
const errorMessage = e => e?.response?.data?.message || e.message || '操作失敗，請稍後再試'
function applyState(data) {
  // Refuse to submit against an older backend that would silently publish a draft.
  if (!Number.isSafeInteger(data?.editVersion)) throw new Error('時程暫存功能尚未完成更新，請稍後再試。')
  if (!data?.handoverReminders) throw new Error('自訂提醒功能尚未完成更新，請稍後再試。')
  version.value = data.editVersion
  publishedSchedule.value = data.handoverSchedule
  hasDraft.value = !!data.handoverDraft
  draft.value = handoverDraft(data.handoverDraft || data.handoverSchedule)
  publishedReminders.value = data.handoverReminders
  reminders.value = handoverReminderDraft(data.handoverDraft?.reminders || data.handoverReminders)
  Object.values(reminders.value).flat().forEach(entry => { entry.id = ++nextReminderId })
  notifications.value = data.notifications
}
async function addReminder(stage) {
  if (reminders.value[stage].length >= maxHandoverReminders) return
  const used = reminders.value[stage].map(entry => Number(entry.value) * Number(entry.unit))
  const minutes = [1440, 120, 4320, 60, 30].find(value => !used.includes(value))
  const entry = { ...handoverReminderEntry(minutes), id: ++nextReminderId }
  reminders.value[stage].push(entry)
  await nextTick()
  document.getElementById(`reminder-${props.storeId}-${entry.id}`)?.focus()
}
async function removeReminder(stage, index) {
  reminders.value[stage].splice(index, 1)
  await nextTick()
  const entry = reminders.value[stage][index] || reminders.value[stage].at(-1)
  document.getElementById(entry ? `reminder-${props.storeId}-${entry.id}` : `add-reminder-${props.storeId}-${stage}`)?.focus()
}
async function load() {
  const serial = ++requestSerial
  loading.value = true; loaded.value = false; error.value = ''; message.value = ''
  try {
    const { data } = await axios.get(endpoint())
    if (serial !== requestSerial) return
    if (!data?.ok) throw new Error(data?.message || '無法載入時程')
    applyState(data.data)
    conflict.value = false; loaded.value = true
  } catch (e) { if (serial === requestSerial) error.value = errorMessage(e) }
  finally { if (serial === requestSerial) loading.value = false }
}
async function save(mode) {
  if (saving.value || conflict.value || !loaded.value) return
  savingMode.value = mode; saving.value = true; error.value = ''; message.value = ''
  const serial = requestSerial
  try {
    const { data } = await axios.patch(endpoint(), { mode, stages: handoverPayload(draft.value), reminders: handoverReminderPayload(reminders.value) }, { headers: { 'If-Match': String(version.value) } })
    if (serial !== requestSerial) return
    if (!data?.ok) throw new Error(data?.message || '無法儲存時程')
    applyState(data.data)
    message.value = mode === 'draft'
      ? (hasDraft.value ? '時程與提醒草稿已暫存，未發送變更通知；已公布設定維持不變。' : '內容與已公布設定相同，沒有待公布草稿，也未發送變更通知。')
      : (data.data.changed ? (data.data.scheduleChanged ? '交取車時間已公布，相關通知與提醒已排入寄送。' : '提醒設定已公布，未到期的提醒已更新，沒有另寄改期通知。') : '已公布設定未變更，沒有重複寄送通知。')
    if (mode === 'publish') emit('saved', data.data.handoverSchedule)
  } catch (e) {
    if (serial !== requestSerial) return
    error.value = errorMessage(e)
    conflict.value = [409, 428].includes(e?.response?.status)
  } finally { saving.value = false }
}
async function refreshNotifications() {
  refreshing.value = true; error.value = ''
  const serial = requestSerial
  try {
    const { data } = await axios.get(endpoint())
    if (serial === requestSerial && data?.ok) notifications.value = data.data.notifications
  } catch (e) { if (serial === requestSerial) error.value = errorMessage(e) }
  finally { refreshing.value = false }
}
async function retry() {
  saving.value = true; error.value = ''; message.value = ''
  const serial = requestSerial
  try {
    const { data } = await axios.post(`${endpoint()}/notifications/retry`)
    if (serial !== requestSerial) return
    if (!data?.ok) throw new Error(data?.message || '重試失敗')
    notifications.value = data.data.notifications
    message.value = '失敗通知已重新排程，寄送前會再次核對最新預約與時間。'
  } catch (e) { if (serial === requestSerial) error.value = errorMessage(e) }
  finally { saving.value = false }
}
watch(() => props.storeId, load, { immediate: true })
onBeforeUnmount(() => { requestSerial++ })
</script>

<style scoped>
.handover-editor { margin: 1.25rem 0; padding: 1rem; border: 1px solid #cbd5e1; border-radius: .75rem; background: #f8fafc; min-width: 0; }
.handover-editor__grid { display: grid; gap: 1rem; margin-top: 1rem; }
.handover-editor__draft-note { margin-top: 1rem; padding: .75rem; border-radius: .5rem; background: #eff6ff; color: #1e40af; font-size: .875rem; line-height: 1.6; }
.handover-editor__actions { display: flex; flex-wrap: wrap; gap: .75rem; }
.handover-editor__actions button { min-height: 44px; }
.handover-editor__reminders { margin-top: .5rem; padding-top: .875rem; border-top: 1px solid #e2e8f0; }
.handover-editor__reminder { margin-top: .625rem; }
.handover-editor__reminder-controls { display: grid; grid-template-columns: auto minmax(3rem, 1fr) minmax(4rem, 1fr) auto; gap: .5rem; align-items: center; font-size: .8125rem; }
.handover-editor__reminder-controls select { width: 100%; min-width: 0; min-height: 44px; padding: .5rem; border: 1px solid #cbd5e1; border-radius: .375rem; background: white; font-size: 1rem; }
.handover-editor__reminder-preview { margin-top: .375rem; color: #64748b; font-size: .75rem; overflow-wrap: anywhere; }
.handover-editor__remove-reminder { min-height: 44px; padding: 0 .25rem; color: #9f1239; text-decoration: underline; }
.handover-editor__add-reminder { min-height: 44px; margin-top: .375rem; font-size: .8125rem; color: #334155; }
.handover-editor__published-reminders { display: grid; gap: .75rem; margin-bottom: 1rem; }
.handover-editor__published-reminders dt { font-weight: 500; color: #334155; }
fieldset { min-width: 0; padding: .875rem; border: 1px solid #e2e8f0; border-radius: .5rem; background: white; }
legend { padding: 0 .3rem; color: #334155; font-weight: 500; }
label { display: block; font-size: .8125rem; color: #475569; margin: .35rem 0; }
input { display: block; width: 100%; min-width: 0; min-height: 44px; box-sizing: border-box; padding: .5rem; border: 1px solid #cbd5e1; border-radius: .375rem; background: white; font-size: 1rem; }
.handover-editor__clear { min-height: 44px; font-size: .8125rem; text-decoration: underline; color: #475569; }
button:disabled, fieldset:disabled { opacity: .6; }
@media (min-width: 640px) { .handover-editor__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 639px) { .handover-editor__actions button { width: 100%; } }
</style>
