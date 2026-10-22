<template>
  <div class="reservation-roster" :class="{ 'reservation-roster--payment': hasPayments }">
    <AdminTableFrame label="託運預約" :count="reservations.length">
      <table class="admin-data-table reservation-roster__table" :class="{ 'reservation-roster__table--payment': hasPayments }" aria-label="託運清單">
        <caption class="roster-sr-only">託運者與會員分別顯示；展開預約明細可查看交取車時段及更新作業階段。</caption>
        <thead>
          <tr>
            <th scope="col" class="admin-table-identity">預約編號</th>
            <th scope="col">託運者</th>
            <th scope="col">會員／持有人</th>
            <th scope="col">服務檔期</th>
            <th scope="col">交車點</th>
            <th scope="col">目前階段</th>
            <th v-if="hasPayments" scope="col">付款</th>
            <th scope="col" class="admin-table-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="record in reservations" :key="record.id">
            <tr class="reservation-roster__row" :class="{ 'reservation-roster__row--expanded': isExpanded(record), 'admin-table-row-selected': isExpanded(record) }">
              <th scope="row" class="admin-table-identity reservation-roster__identity">
                <button
                  type="button" class="reservation-roster__row-toggle"
                  :ref="element => setToggleRef(record, element)"
                  :aria-expanded="isExpanded(record)" :aria-controls="detailsId(record)"
                  :aria-label="`${isExpanded(record) ? '收合' : '展開'}預約 ${record.id} 明細`"
                  @click="toggleDetails(record)"
                >
                  <span class="reservation-roster__chevron" :class="{ 'reservation-roster__chevron--open': isExpanded(record) }"><AppIcon name="arrow-left" class="reservation-roster__arrow-icon" /></span>
                  <span>#{{ record.id }}</span>
                </button>
              </th>
              <td class="reservation-roster__consignor" data-label="託運者">
                <strong>{{ formatConsignorName(record.consignor_name) }}</strong>
              </td>
              <td class="reservation-roster__member" data-label="會員／持有人">
                <span>{{ record.username || '未提供會員姓名' }}</span>
                <small v-if="record.email">{{ record.email }}</small>
                <AccountStatusNotice :record="record" class="reservation-roster__account-notice" />
              </td>
              <td class="reservation-roster__event" data-label="服務檔期">
                <span class="reservation-roster__event-name" :title="record.event">{{ record.event || '未提供服務檔期' }}</span>
              </td>
              <td class="reservation-roster__store" data-label="交車點">{{ record.store || '未提供交車點' }}</td>
              <td class="reservation-roster__stage" data-label="目前階段">
                <span class="reservation-roster__status" :class="`reservation-roster__status--${statusTone(record)}`">{{ statusLabel(record) }}</span>
              </td>
              <td v-if="hasPayments" class="reservation-roster__payment" data-label="付款">
                <span v-if="paymentForRecord(record)" :class="`reservation-roster__payment--${paymentForRecord(record).tone}`">{{ paymentForRecord(record).label }}</span>
                <span v-else class="reservation-roster__muted">未提供</span>
              </td>
              <td class="admin-table-actions reservation-roster__actions" data-label="操作">
                <div>
                  <button type="button" class="reservation-roster__mobile-details" :aria-expanded="isExpanded(record)" :aria-controls="detailsId(record)" @click="toggleDetails(record)">{{ isExpanded(record) ? '收合明細' : '展開明細' }}</button>
                  <button type="button" class="reservation-roster__text-action" :aria-label="`查看預約 ${record.id} 的檢核紀錄`" @click="emit('open-detail', record)">檢核紀錄</button>
                </div>
              </td>
            </tr>
            <tr v-if="isExpanded(record)" class="reservation-roster__detail-row">
              <td :colspan="columnCount">
                <section :id="detailsId(record)" class="reservation-roster__detail" :aria-labelledby="headingId(record)">
                  <header class="reservation-roster__detail-heading">
                    <h3 :id="headingId(record)">預約 #{{ record.id }} 託運明細</h3>
                    <button type="button" class="reservation-roster__text-action" :aria-controls="detailsId(record)" aria-expanded="true" @click="toggleDetails(record, true)">收合明細</button>
                  </header>
                  <dl class="reservation-roster__facts">
                    <div><dt>服務檔期</dt><dd>{{ record.event || '未提供' }}</dd></div>
                    <div><dt>票種</dt><dd>{{ record.ticket_type || '未提供' }}</dd></div>
                    <div><dt>預約時間</dt><dd>{{ formatDate(record.reserved_at) || '未提供' }}</dd></div>
                    <div>
                      <dt>目前階段驗證碼</dt>
                      <dd class="reservation-roster__code">
                        <span>{{ record.stage_verify_code || '未提供' }}</span>
                        <button v-if="canCopyCode && record.stage_verify_code" type="button" class="reservation-roster__text-action" :aria-label="`複製預約 ${record.id} 的驗證碼`" @click="emit('copy-code', record.stage_verify_code)"><AppIcon name="copy" />複製</button>
                      </dd>
                    </div>
                  </dl>

                  <div class="reservation-roster__progress-heading">
                    <h4>交取車進度</h4>
                    <p>目前：<strong>{{ statusLabel(record) }}</strong></p>
                  </div>
                  <ol class="reservation-roster__progress" aria-label="四階段交取車進度">
                    <li v-for="stage in stages" :key="stage.key" :class="`reservation-roster__step--${stageState(record, stage.key)}`" :aria-current="stageState(record, stage.key) === 'current' ? 'step' : undefined">
                      <span class="reservation-roster__step-marker"><AppIcon v-if="stageState(record, stage.key) === 'complete'" name="check" /></span>
                      <span class="reservation-roster__step-label">{{ stage.label }}</span>
                      <small>{{ stageStateLabel(record, stage.key) }}</small>
                    </li>
                  </ol>

                  <div class="reservation-roster__detail-bottom">
                    <section class="reservation-roster__schedule" aria-label="交車點與時段">
                      <h4>{{ record.store || '交車點未提供' }}</h4>
                      <p v-if="record.store_address" class="reservation-roster__store-address">{{ record.store_address }}</p>
                      <HandoverSchedule :schedule="record.handoverSchedule" :store-name="record.store || ''" :store-address="record.store_address || ''" />
                    </section>
                    <div class="reservation-roster__status-editor">
                      <label :for="statusInputId(record)">更新作業階段</label>
                      <select
                        :id="statusInputId(record)" :value="record.newStatus ?? record.status"
                        :disabled="record.saving || record.status === 'cancelled'"
                        @change="emit('status-change', record, $event.target.value)"
                      >
                        <option v-if="record.status === 'cancelled'" value="cancelled">已取消</option>
                        <option v-for="option in statusOptions" :key="option.value" :value="option.value" :title="option.label">{{ shortLabel(option.label) }}</option>
                      </select>
                      <p>儲存後，預約將以所選階段繼續作業。</p>
                      <div class="reservation-roster__editor-actions">
                        <button type="button" class="btn btn-primary" :disabled="record.saving || record.status === 'cancelled'" @click="emit('save-status', record)">{{ record.saving ? '儲存中…' : '儲存階段' }}</button>
                        <button type="button" class="btn btn-outline" @click="emit('open-detail', record)">檢核紀錄</button>
                      </div>
                    </div>
                  </div>
                </section>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </AdminTableFrame>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, useId, watch } from 'vue'
import AccountStatusNotice from './AccountStatusNotice.vue'
import AdminTableFrame from './AdminTableFrame.vue'
import AppIcon from './AppIcon.vue'
import HandoverSchedule from './HandoverSchedule.vue'
import { formatConsignorName as defaultConsignorName } from '../utils/consignorName.js'
import { formatDateTime } from '../utils/datetime.js'

const props = defineProps({
  reservations: { type: Array, default: () => [] },
  statusOptions: { type: Array, required: true },
  stageLabels: { type: Object, default: () => ({}) },
  formatDate: { type: Function, default: formatDateTime },
  formatConsignorName: { type: Function, default: defaultConsignorName },
  // A parent-supplied presenter is the only source for payment information.
  // Reservations currently do not expose it through their list DTO.
  paymentFor: { type: Function, default: null },
  canCopyCode: { type: Boolean, default: false },
})
const emit = defineEmits(['status-change', 'save-status', 'open-detail', 'copy-code'])
const id = useId()
const expandedIds = ref(new Set())
const toggleRefs = new Map()
const stages = [
  { key: 'pre_dropoff', label: '賽前交車' },
  { key: 'pre_pickup', label: '賽前取車' },
  { key: 'post_dropoff', label: '賽後交車' },
  { key: 'post_pickup', label: '賽後取車' },
]
const stageIndex = Object.fromEntries(stages.map((stage, index) => [stage.key, index]))
const rowKey = record => String(record.id)
const detailsId = record => `reservation-${id}-${rowKey(record)}-details`
const headingId = record => `reservation-${id}-${rowKey(record)}-heading`
const statusInputId = record => `reservation-${id}-${rowKey(record)}-status`
const isExpanded = record => expandedIds.value.has(rowKey(record))
function setToggleRef(record, element) {
  if (element) toggleRefs.set(rowKey(record), element)
  else toggleRefs.delete(rowKey(record))
}
function toggleDetails(record, restoreFocus = false) {
  const next = new Set(expandedIds.value)
  const key = rowKey(record)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedIds.value = next
  if (restoreFocus) nextTick(() => toggleRefs.get(key)?.focus())
}
watch(() => props.reservations.map(rowKey), keys => {
  const visible = new Set(keys)
  expandedIds.value = new Set([...expandedIds.value].filter(key => visible.has(key)))
})

const shortLabel = label => String(label || '').split('（')[0].trim()
function normalizedStatus(record) {
  if (!record.status || ['pending', 'service_booking'].includes(record.status)) return 'pre_dropoff'
  return record.status === 'pickup' ? 'pre_pickup' : record.status
}
function statusLabel(record) {
  const status = normalizedStatus(record)
  const stage = stages.find(item => item.key === status)
  if (stage) return `待${stage.label}`
  if (status === 'done') return '已完成'
  if (status === 'cancelled') return '已取消'
  return shortLabel(props.stageLabels[status] || status) || '未提供'
}
function statusTone(record) {
  const status = normalizedStatus(record)
  if (status === 'done') return 'success'
  if (status === 'cancelled') return 'neutral'
  return status.includes('pickup') ? 'info' : 'pending'
}
function stageState(record, key) {
  const status = normalizedStatus(record)
  if (status === 'cancelled') return 'cancelled'
  if (status === 'done') return 'complete'
  if (stageIndex[status] == null) return 'upcoming'
  if (stageIndex[key] < stageIndex[status]) return 'complete'
  return key === status ? 'current' : 'upcoming'
}
function stageStateLabel(record, key) {
  const state = stageState(record, key)
  return { complete: '已完成', current: '目前待執行', upcoming: '尚未執行', cancelled: '已取消' }[state]
}

const payments = computed(() => {
  const values = new Map()
  if (!props.paymentFor) return values
  for (const record of props.reservations) {
    const raw = props.paymentFor(record)
    const label = typeof raw === 'string' ? raw.trim() : String(raw?.label || '').trim()
    if (!label) continue
    const tone = ['neutral', 'success', 'warning', 'danger'].includes(raw?.tone) ? raw.tone : 'neutral'
    values.set(rowKey(record), { label, tone })
  }
  return values
})
const paymentForRecord = record => payments.value.get(rowKey(record)) || null
const hasPayments = computed(() => payments.value.size > 0)
const columnCount = computed(() => 7 + (hasPayments.value ? 1 : 0))
</script>

<style scoped>
.reservation-roster { --admin-table-width: 64rem; min-width: 0; color: #253047; }
.reservation-roster--payment { --admin-table-width: 70rem; }
.reservation-roster__table { width: 100%; min-width: 64rem; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
.reservation-roster__table--payment { min-width: 70rem; }
.reservation-roster__table > thead > tr > th { padding: .85rem .8rem; background: #f6f8fb; border-bottom: 1px solid #e0e6ef; color: #667287; font-size: .8125rem; font-weight: 500; text-align: left; }
.reservation-roster__table > thead > tr > th:nth-child(1) { width: 8rem; }
.reservation-roster__table > thead > tr > th:nth-child(2) { width: 9rem; }
.reservation-roster__table > thead > tr > th:nth-child(3) { width: 11rem; }
.reservation-roster__table > thead > tr > th:nth-child(4) { width: 12rem; }
.reservation-roster__table > thead > tr > th:nth-child(5) { width: 9rem; }
.reservation-roster__table > thead > tr > th:nth-child(6) { width: 8rem; }
.reservation-roster__table > thead > tr > .admin-table-actions { width: 7rem; }
.reservation-roster__row > th, .reservation-roster__row > td { padding: var(--admin-cell-y, .875rem) var(--admin-cell-x, .8rem); border-bottom: 1px solid #e2e7ef; vertical-align: top; text-align: left; color: #334155; font-size: .875rem; font-weight: 400; line-height: 1.65; overflow-wrap: anywhere; background: var(--admin-row-bg, #fff); }
.reservation-roster__row--expanded { --admin-row-bg: #fff5f5; }
.reservation-roster__row strong { color: #1c283b; font-weight: 600; }
.reservation-roster__member > span, .reservation-roster__member > small { display: block; }
.reservation-roster__member > small { margin-top: .2rem; color: #6b7587; font-size: .75rem; line-height: 1.5; }
.reservation-roster__account-notice { margin-top: .4rem; }
.reservation-roster__account-notice :deep(p) { font-size: .75rem; line-height: 1.5; }
.reservation-roster__event-name { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.reservation-roster__row-toggle { display: inline-flex; align-items: center; gap: .35rem; min-height: 2.75rem; padding: .25rem 0; margin-top: -.4rem; font-variant-numeric: tabular-nums; color: #334155; font-weight: 500; text-align: left; cursor: pointer; }
.reservation-roster__chevron { display: inline-flex; width: .875rem; height: .875rem; flex: 0 0 auto; transform: rotate(180deg); transition: transform 160ms ease; }
.reservation-roster__arrow-icon { width: .875rem; height: .875rem; }
.reservation-roster__chevron--open { transform: rotate(270deg); color: var(--color-primary, #b4232a); }
.reservation-roster__status { display: inline-flex; padding: .25rem .55rem; border-radius: .3rem; font-size: .75rem; line-height: 1.5; font-weight: 500; white-space: nowrap; }
.reservation-roster__status--pending { color: #a72b35; background: #fce6e8; }
.reservation-roster__status--info { color: #2459a9; background: #e6efff; }
.reservation-roster__status--success { color: #157244; background: #e8f4eb; }
.reservation-roster__status--neutral { color: #596577; background: #eef1f5; }
.reservation-roster__payment--success { color: #157244; }
.reservation-roster__payment--warning { color: #a2550d; }
.reservation-roster__payment--danger { color: #b4232a; }
.reservation-roster__muted { color: #6b7587; }
.reservation-roster__text-action, .reservation-roster__mobile-details { display: inline-flex; align-items: center; justify-content: center; gap: .35rem; min-height: 2.75rem; padding: .25rem .15rem; color: var(--color-primary, #b4232a); font-size: .8125rem; font-weight: 500; cursor: pointer; }
.reservation-roster__text-action > svg { width: .9rem; height: .9rem; }
.reservation-roster__mobile-details { display: none; }
.reservation-roster__row-toggle:focus-visible, .reservation-roster__text-action:focus-visible, .reservation-roster__mobile-details:focus-visible { outline: 2px solid var(--color-primary, #b4232a); outline-offset: 3px; border-radius: .25rem; }
.reservation-roster__detail-row > td { padding: 0 !important; border-bottom: 1px solid #e2e7ef; white-space: normal; }
.reservation-roster__detail { padding: 1.25rem 1.5rem 1.5rem; background: #fff8f8; }
.reservation-roster__detail-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.reservation-roster__detail-heading h3 { margin: 0; font-size: .9375rem; line-height: 1.5; font-weight: 600; color: #1c283b; }
.reservation-roster__facts { display: grid; grid-template-columns: minmax(0, 1.8fr) repeat(3, minmax(0, 1fr)); gap: 1rem; margin: 0 0 1.5rem; }
.reservation-roster__facts > div { min-width: 0; padding-right: 1rem; border-right: 1px solid #e5dfe3; }
.reservation-roster__facts > div:last-child { border-right: 0; }
.reservation-roster__facts dt { color: #6b7587; font-size: .75rem; line-height: 1.5; }
.reservation-roster__facts dd { margin: .35rem 0 0; color: #334155; font-size: .875rem; line-height: 1.65; overflow-wrap: anywhere; }
.reservation-roster__code { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; font-variant-numeric: tabular-nums; }
.reservation-roster__code > .reservation-roster__text-action { min-height: 1.75rem; }
.reservation-roster__progress-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 1.1rem; }
.reservation-roster__progress-heading h4, .reservation-roster__schedule h4 { margin: 0; color: #334155; font-size: .875rem; font-weight: 600; }
.reservation-roster__progress-heading p { margin: 0; color: #6b7587; font-size: .8125rem; }
.reservation-roster__progress-heading strong { color: var(--color-primary, #b4232a); font-weight: 500; }
.reservation-roster__progress { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; padding: .25rem 0 1.5rem; margin: 0 0 1.25rem; border-bottom: 1px solid #e5dfe3; list-style: none; }
.reservation-roster__progress li { position: relative; display: grid; justify-items: center; align-content: start; gap: .45rem; min-width: 0; padding: 0 .5rem; color: #7b8798; text-align: center; }
.reservation-roster__progress li:not(:last-child)::after { position: absolute; z-index: 0; top: .6rem; left: calc(50% + .7rem); right: calc(-50% + .7rem); height: 2px; background: #d3d8e0; content: ''; }
.reservation-roster__step-marker { position: relative; z-index: 1; display: grid; place-items: center; width: 1.3rem; height: 1.3rem; border: 2px solid #aab4c3; border-radius: 50%; background: #fff; }
.reservation-roster__step-marker > svg { width: .85rem; height: .85rem; }
.reservation-roster__step-label { font-size: .8125rem; font-weight: 500; line-height: 1.5; }
.reservation-roster__progress small { font-size: .6875rem; line-height: 1.5; }
.reservation-roster__step--complete .reservation-roster__step-marker, .reservation-roster__step--current .reservation-roster__step-marker { border-color: var(--color-primary, #b4232a); background: var(--color-primary, #b4232a); color: #fff; }
.reservation-roster__step--complete::after { background: var(--color-primary, #b4232a) !important; }
.reservation-roster__step--complete .reservation-roster__step-label, .reservation-roster__step--current .reservation-roster__step-label { color: var(--color-primary, #b4232a); }
.reservation-roster__step--cancelled .reservation-roster__step-marker { background: #eef1f5; }
.reservation-roster__detail-bottom { display: grid; grid-template-columns: minmax(0, 1fr) minmax(16rem, .55fr); gap: 1.5rem; }
.reservation-roster__schedule { min-width: 0; }
.reservation-roster__store-address { margin: .25rem 0 .75rem; color: #6b7587; font-size: .8125rem; overflow-wrap: anywhere; }
.reservation-roster__schedule :deep(.handover-schedule) { margin: .65rem 0 0; padding: 0; border: 0; border-radius: 0; background: transparent; }
.reservation-roster__schedule :deep(.handover-schedule__title) { font-size: .75rem; color: #6b7587; }
.reservation-roster__schedule :deep(.handover-schedule dd) { font-size: .8125rem; }
.reservation-roster__status-editor { display: grid; align-content: start; gap: .65rem; padding-left: 1.5rem; border-left: 1px solid #e5dfe3; min-width: 0; }
.reservation-roster__status-editor > label { color: #334155; font-size: .8125rem; font-weight: 600; }
.reservation-roster__status-editor > select { min-height: 2.75rem; padding: .6rem .75rem; border: 1px solid #d3dae5; border-radius: .4rem; background: #fff; color: #334155; font-size: .8125rem; }
.reservation-roster__status-editor > p { margin: 0; color: #6b7587; font-size: .75rem; line-height: 1.6; }
.reservation-roster__editor-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.reservation-roster__editor-actions > .btn { min-height: 2.75rem; flex: 1 1 auto; border-radius: .4rem; font-size: .8125rem; }
.roster-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 767px) {
  .reservation-roster { --admin-table-width: 100%; }
  .reservation-roster :deep(.admin-table-frame) { border: 0; border-radius: 0; background: transparent; }
  .reservation-roster :deep(.admin-table-frame__toolbar) { padding: 12px 16px; }
  .reservation-roster :deep(.admin-table-frame__controls), .reservation-roster :deep(.admin-table-frame__hint) { display: none; }
  .reservation-roster :deep(.admin-table-frame__viewport) { max-height: none; overflow: visible; }
  .reservation-roster__table, .reservation-roster__table--payment { display: block; min-width: 0; width: 100%; }
  .reservation-roster .reservation-roster__table > thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .reservation-roster__table > tbody { display: block; }
  .reservation-roster__row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: .75rem; margin-top: .75rem; border: 1px solid #dce2e9; border-radius: .6rem; background: var(--admin-row-bg, #fff); }
  .reservation-roster .reservation-roster__table .reservation-roster__row > th, .reservation-roster .reservation-roster__table .reservation-roster__row > td { display: block; width: auto; padding: .5rem; border: 0; background: transparent; min-width: 0; }
  .reservation-roster__row > td[data-label]::before { display: block; margin-bottom: .25rem; color: #6b7587; font-size: .75rem; font-weight: 400; content: attr(data-label); }
  .reservation-roster__identity { grid-column: 1; grid-row: 1; }
  .reservation-roster__stage { grid-column: 2; grid-row: 1; justify-self: end; }
  .reservation-roster__row > td.reservation-roster__stage::before, .reservation-roster__row > td.reservation-roster__actions::before { display: none; }
  .reservation-roster__row-toggle { margin-top: -.35rem; }
  .reservation-roster__consignor { grid-column: 1; grid-row: 2; }
  .reservation-roster__member { grid-column: 2; grid-row: 2; }
  .reservation-roster__event { grid-column: 1 / -1; grid-row: 3; }
  .reservation-roster__event-name { display: block; }
  .reservation-roster__store { grid-column: 1; grid-row: 4; }
  .reservation-roster__payment { grid-column: 2; grid-row: 4; }
  .reservation-roster__actions { grid-column: 1 / -1; grid-row: 5; margin-top: .35rem; border-top: 1px solid #e2e7ef !important; }
  .reservation-roster__actions > div { justify-content: space-between; }
  .reservation-roster__mobile-details { display: inline-flex; }
  .reservation-roster__status { white-space: normal; }
  .reservation-roster__detail-row, .reservation-roster__detail-row > td { display: block; width: 100%; }
  .reservation-roster .reservation-roster__table .reservation-roster__detail-row > td:last-child { border: 1px solid #dce2e9; border-top: 0; border-radius: 0 0 .6rem .6rem; }
  .reservation-roster__row--expanded { border-bottom: 0; border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .reservation-roster__detail { padding: 1rem; border-radius: 0 0 .6rem .6rem; }
  .reservation-roster__detail-heading { gap: .5rem; margin-bottom: .75rem; }
  .reservation-roster__detail-heading h3 { font-size: .875rem; }
  .reservation-roster__facts { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem 1rem; }
  .reservation-roster__facts > div { border: 0; padding-right: 0; }
  .reservation-roster__facts > div:first-child { grid-column: 1 / -1; }
  .reservation-roster__progress-heading { display: grid; gap: .4rem; }
  .reservation-roster__progress { row-gap: .65rem; padding-bottom: 1rem; }
  .reservation-roster__progress li { padding: 0 .15rem; }
  .reservation-roster__step-label { font-size: .75rem; }
  .reservation-roster__progress small { font-size: .6875rem; }
  .reservation-roster__detail-bottom { grid-template-columns: minmax(0, 1fr); gap: 1rem; }
  .reservation-roster__status-editor { border-left: 0; border-top: 1px solid #e5dfe3; padding: 1rem 0 0; }
}
@media (prefers-reduced-motion: reduce) { .reservation-roster__chevron { transition: none; } }
@media (prefers-contrast: more) { .reservation-roster__row > th, .reservation-roster__row > td, .reservation-roster__detail-row > td { border-color: #64748b; } }
</style>
