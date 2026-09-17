<template>
  <section class="handover-editor" aria-label="設定交取車時間">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div><h4 class="font-medium text-slate-900">交取車時間</h4><p class="mt-1 text-sm text-slate-600">台灣時間，可分階段公布；時間未定仍可接受預約。</p></div>
      <button type="button" class="btn btn-outline btn-sm" :disabled="loading || saving" @click="load">重新載入時程</button>
    </div>
    <p v-if="loading" class="mt-3 text-sm" role="status">載入時程中…</p>
    <template v-else-if="loaded">
      <div class="handover-editor__grid">
        <fieldset v-for="stage in handoverStages" :key="stage.key" :disabled="saving || conflict">
          <legend>{{ stage.label }}</legend>
          <label :for="`handover-${storeId}-${stage.key}-start`">開始時間</label>
          <input :id="`handover-${storeId}-${stage.key}-start`" v-model="draft[stage.key].startsAt" type="datetime-local" :aria-label="`${stage.label}開始時間`" />
          <label :for="`handover-${storeId}-${stage.key}-end`">結束時間</label>
          <input :id="`handover-${storeId}-${stage.key}-end`" v-model="draft[stage.key].endsAt" type="datetime-local" :aria-label="`${stage.label}結束時間`" />
          <button type="button" class="handover-editor__clear" :aria-label="`清除${stage.label}時間`" @click="draft[stage.key] = { startsAt: '', endsAt: '' }">清除時間</button>
        </fieldset>
      </div>
      <p class="mt-4 text-sm text-amber-800">公布或變更後將自動寄送 Email。清除已公布的時間會通知用戶「時間待重新公布」。</p>
      <p class="mt-1 text-sm text-slate-600">各階段開始前 24 小時提醒；不足 24 小時時以即時通知取代提醒。</p>
      <button type="button" class="btn btn-primary mt-4" :disabled="saving || conflict" @click="save">{{ saving ? '儲存中…' : '儲存交取車時間並通知' }}</button>
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
import { ref, watch, onBeforeUnmount } from 'vue'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import { handoverStages, handoverDraft, handoverPayload } from '../utils/handoverSchedule'
const props = defineProps({ storeId: { type: [Number, String], required: true } })
const emit = defineEmits(['saved'])
const draft = ref(handoverDraft(null))
const version = ref(1)
const loading = ref(false), loaded = ref(false), saving = ref(false), refreshing = ref(false), conflict = ref(false)
const error = ref(''), message = ref(''), notifications = ref(null)
let requestSerial = 0
const endpoint = () => `${API_BASE}/admin/events/stores/${props.storeId}/schedule`
const errorMessage = e => e?.response?.data?.message || e.message || '操作失敗，請稍後再試'
async function load() {
  const serial = ++requestSerial
  loading.value = true; loaded.value = false; error.value = ''; message.value = ''
  try {
    const { data } = await axios.get(endpoint())
    if (serial !== requestSerial) return
    if (!data?.ok) throw new Error(data?.message || '無法載入時程')
    draft.value = handoverDraft(data.data.handoverSchedule)
    version.value = data.data.handoverSchedule.version
    notifications.value = data.data.notifications
    conflict.value = false; loaded.value = true
  } catch (e) { if (serial === requestSerial) error.value = errorMessage(e) }
  finally { if (serial === requestSerial) loading.value = false }
}
async function save() {
  saving.value = true; error.value = ''; message.value = ''
  const serial = requestSerial
  try {
    const { data } = await axios.patch(endpoint(), { stages: handoverPayload(draft.value) }, { headers: { 'If-Match': String(version.value) } })
    if (serial !== requestSerial) return
    if (!data?.ok) throw new Error(data?.message || '無法儲存時程')
    version.value = data.data.handoverSchedule.version
    notifications.value = data.data.notifications
    message.value = data.data.changed ? '交取車時間已儲存，相關通知已排入寄送。' : '時間未變更，沒有重複寄送通知。'
    emit('saved', data.data.handoverSchedule)
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
fieldset { min-width: 0; padding: .875rem; border: 1px solid #e2e8f0; border-radius: .5rem; background: white; }
legend { padding: 0 .3rem; color: #334155; font-weight: 500; }
label { display: block; font-size: .8125rem; color: #475569; margin: .35rem 0; }
input { display: block; width: 100%; min-width: 0; min-height: 44px; box-sizing: border-box; padding: .5rem; border: 1px solid #cbd5e1; border-radius: .375rem; background: white; font-size: 1rem; }
.handover-editor__clear { min-height: 44px; font-size: .8125rem; text-decoration: underline; color: #475569; }
button:disabled, fieldset:disabled { opacity: .6; }
@media (min-width: 640px) { .handover-editor__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
