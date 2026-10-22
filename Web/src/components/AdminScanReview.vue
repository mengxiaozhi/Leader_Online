<template>
  <article v-if="review" class="admin-scan-review" :aria-busy="confirming">
    <header class="scan-review-header">
      <div>
        <div class="scan-review-heading-row">
          <h3 ref="reviewHeading" tabindex="-1">{{ isCourse ? '課程核銷確認' : '預約確認' }}</h3>
          <span class="scan-review-pending" role="status">{{ confirming ? '正在確認…' : '已掃描・待確認' }}</span>
        </div>
        <p class="scan-review-reference">{{ referenceLabel }}</p>
      </div>
      <p class="scan-review-current">{{ currentStageLabel }}</p>
    </header>

    <dl class="scan-review-details" :class="{ 'scan-review-details--course': isCourse }">
      <div v-if="!isCourse">
        <dt>託運者</dt>
        <dd>{{ formatConsignorName(reservation.consignor_name) }}</dd>
      </div>
      <div>
        <dt>{{ isCourse ? '出席會員' : '會員' }}</dt>
        <dd>{{ reservation.username || reservation.email || reservation.user_id || '—' }}</dd>
        <dd v-if="reservation.username && reservation.email" class="scan-review-secondary">{{ reservation.email }}</dd>
      </div>
      <div>
        <dt>{{ isCourse ? '課程場次' : '活動賽事' }}</dt>
        <dd>{{ reservation.event || '—' }}</dd>
        <dd v-if="isCourse && booking.sessionCode" class="scan-review-secondary">{{ booking.sessionCode }}</dd>
      </div>
      <div :class="{ 'scan-review-location': !isCourse }">
        <dt>{{ isCourse ? '場次時間／地點' : `${RESERVATION_STATUS_LABEL_MAP[review.stage] || '交取車'}地點` }}</dt>
        <dd v-if="isCourse">{{ formatDateTimeRange(booking.startsAt, booking.endsAt) || '時間待公告' }}</dd>
        <dd>{{ isCourse ? (reservation.store || '地點待公告') : reservationHandoverLocation(reservation, review.stage) }}</dd>
      </div>
      <div v-if="isCourse">
        <dt>課程票券</dt>
        <dd>{{ booking.ticketCode || '—' }}</dd>
        <dd class="scan-review-secondary">核銷前剩餘 {{ booking.remainingUses ?? '—' }} 堂</dd>
      </div>
    </dl>

    <div class="scan-review-body">
      <ol v-if="!isCourse" class="scan-review-stages" aria-label="託運四階段">
        <li
          v-for="(stage, index) in CHECKLIST_STAGE_KEYS"
          :key="stage"
          :class="{ 'is-current': review.stage === stage }"
          :aria-current="review.stage === stage ? 'step' : undefined"
        >
          <span class="scan-review-step" aria-hidden="true">{{ index + 1 }}</span>
          <span>{{ RESERVATION_STATUS_LABEL_MAP[stage] }}</span>
        </li>
      </ol>

      <p class="scan-review-transition">本次確認後：<strong>{{ nextStageLabel }}</strong></p>

      <div v-if="!isCourse" class="scan-review-checks">
        <section class="scan-review-checklist" aria-label="本階段檢核結果">
          <div class="scan-review-section-heading">
            <h4>檢核結果</h4>
            <span :class="review.checklistReady ? 'scan-review-ready' : 'scan-review-incomplete'">
              {{ review.checklistReady ? '已完成' : '尚未完成' }}
            </span>
          </div>
          <p class="scan-review-checklist-title">{{ checklist.title || currentStageLabel }}</p>
          <ul v-if="checklistItems.length" class="scan-review-items">
            <li v-for="(item, index) in checklistItems" :key="`${index}-${item.label}`">
              <span class="scan-review-item-icon" :class="item.checked ? 'is-checked' : 'is-unchecked'" aria-hidden="true">
                <AppIcon :name="item.checked ? 'check' : 'x'" class="h-4 w-4" />
              </span>
              <span class="sr-only">{{ item.checked ? '已勾選：' : '未勾選：' }}</span>
              <span>{{ item.label }}</span>
            </li>
          </ul>
          <p v-else class="scan-review-empty">尚無檢核項目紀錄。</p>
        </section>

        <section class="scan-review-photos" aria-label="本階段檢核照片">
          <div class="scan-review-section-heading">
            <h4>檢核照片</h4>
            <span class="scan-review-photo-count">{{ photoCount }} 張／至少 {{ minPhotoCount }} 張</span>
          </div>
          <div v-if="photos.length" class="scan-review-photo-grid">
            <button
              v-for="(photo, index) in photos"
              :key="photo.id ?? index"
              type="button"
              class="scan-review-photo"
              :aria-label="`預覽檢核照片 ${index + 1}${photo.originalName ? `：${photo.originalName}` : ''}`"
              @click="previewPhoto(photo)"
            >
              <img
                :src="photoSrc(photo, reservation.id, review.stage)"
                :alt="photo.originalName || `檢核照片 ${index + 1}`"
                crossorigin="use-credentials"
              />
              <span>{{ photo.originalName || `照片 ${index + 1}` }}</span>
            </button>
          </div>
          <div v-else class="scan-review-photo-empty">
            <p>{{ photoCount > 0 ? '照片預覽資料尚未提供，請返回重新掃描。' : '尚無檢核照片' }}</p>
          </div>
          <p v-if="minPhotoCount === 2" class="scan-review-photo-hint">請確認已拍攝單車左側與右側。</p>
        </section>
      </div>

      <p v-if="!isCourse && !review.checklistReady" class="scan-review-warning" role="status">
        <template v-if="minPhotoCount === 1">此階段需完成檢核並至少上傳 1 張照片，請會員補齊後再繼續。</template>
        <template v-else-if="minPhotoCount === 2">此階段需完成檢核並至少上傳 2 張照片，請會員分別拍攝單車左側與右側後再繼續。</template>
        <template v-else>此階段需完成檢核並至少上傳 {{ minPhotoCount }} 張照片，請會員補齊後再繼續。</template>
      </p>
    </div>

    <footer class="scan-review-footer">
      <p>{{ isCourse ? '請核對會員、場次與剩餘堂數後確認核銷。' : `確認完成後，預約將進入${nextStageLabel}。` }}</p>
      <div class="scan-review-actions">
        <button type="button" class="btn btn-outline scan-review-cancel" :disabled="confirming" @click="cancel">
          返回重新掃描
        </button>
        <CourseAttendanceActions
          v-if="isCourse"
          class="scan-review-course-actions"
          :booking="booking"
          :capabilities="booking.capabilities"
          :redeemable="courseRedeemable"
          :busy="confirming"
          busy-action="attend"
          primary-only
          @action="confirm"
        />
        <button v-else type="button" class="btn btn-primary scan-review-confirm" :disabled="!canConfirm" @click="confirm()">
          <AppIcon v-if="confirming" name="refresh" class="h-4 w-4 animate-spin motion-reduce:animate-none" />
          {{ completionLabel(review.stage) }}
        </button>
      </div>
    </footer>
  </article>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import CourseAttendanceActions from './CourseAttendanceActions.vue'
import { reservationStageLabels } from '../utils/adminOperations.js'
import { checklistPhotoMinimum } from '../utils/checklistPhotos.js'
import { formatConsignorName } from '../utils/consignorName.js'
import { formatDateTimeRange } from '../utils/datetime.js'
import { CHECKLIST_STAGE_KEYS, RESERVATION_STATUS_LABEL_MAP } from '../utils/reservationStages.js'
import { reservationHandoverLocation } from '../utils/handoverSchedule.js'

const props = defineProps({
  review: { type: Object, required: true },
  confirming: { type: Boolean, default: false },
  stageName: { type: Function, default: stage => RESERVATION_STATUS_LABEL_MAP[stage] || stage || '—' },
  completionLabel: { type: Function, default: stage => `${RESERVATION_STATUS_LABEL_MAP[stage] || '本次作業'}完成` },
  photoSrc: { type: Function, required: true },
})

const emit = defineEmits(['confirm', 'cancel', 'preview'])
const reviewHeading = ref(null)
onMounted(async () => {
  await nextTick()
  const heading = reviewHeading.value
  if (!heading || typeof window === 'undefined') return
  heading.focus({ preventScroll: true })
  if (window.matchMedia('(max-width: 767px)').matches) {
    heading.scrollIntoView({ behavior: 'instant', block: 'start' })
  }
})
const isCourse = computed(() => props.review?.kind === 'course')
const reservation = computed(() => props.review?.reservation || {})
const booking = computed(() => props.review?.courseBooking || {})
const checklist = computed(() => props.review?.checklist || {})
const checklistItems = computed(() => Array.isArray(checklist.value.items) ? checklist.value.items : [])
const photos = computed(() => Array.isArray(checklist.value.photos) ? checklist.value.photos : [])
const photoCount = computed(() => checklist.value.photoCount ?? photos.value.length)
const minPhotoCount = computed(() => checklistPhotoMinimum(checklist.value))
const currentStageLabel = computed(() => props.review?.stageLabel || props.stageName(props.review?.stage))
const nextStageLabel = computed(() => {
  if (!isCourse.value && reservationStageLabels[props.review?.nextStage]) return reservationStageLabels[props.review.nextStage]
  return props.review?.nextStageLabel || (props.review?.nextStage ? props.stageName(props.review.nextStage) : '完成')
})
const referenceLabel = computed(() => {
  if (isCourse.value) return booking.value.sessionCode || (reservation.value.id != null ? `課程預約 #${reservation.value.id}` : '課程預約')
  return reservation.value.id != null ? `預約 #${reservation.value.id}` : '託運預約'
})
const courseRedeemable = computed(() => (
  (booking.value.redeemableNow ?? booking.value.redeemable_now ?? booking.value.redeemable) !== false
))
const canConfirm = computed(() => !props.confirming && (isCourse.value ? courseRedeemable.value : !!props.review?.checklistReady))

function confirm(action) {
  if (!canConfirm.value) return
  emit('confirm', action)
}

function cancel() {
  if (!props.confirming) emit('cancel')
}

function previewPhoto(photo) {
  emit('preview', photo, reservation.value.id, props.review.stage, {
    checklist: props.review.checklist,
    reservation: props.review.reservation,
  })
}
</script>

<style scoped>
.admin-scan-review { min-width: 0; overflow: hidden; border: 1px solid var(--ui-border, #d8dee7); border-radius: 1rem; background: #fff; color: var(--ui-text, #111827); }
.scan-review-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1.5rem 1.5rem 1.25rem; }
.scan-review-heading-row { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
.scan-review-heading-row h3 { margin: 0; font-size: 1.125rem; line-height: 1.5; scroll-margin-top: calc(46px + env(safe-area-inset-top, 0px) + 1rem); }
.scan-review-pending { border-radius: .5rem; background: #fff4e8; padding: .25rem .625rem; color: #9a4b10; font-size: .8125rem; font-weight: 600; }
.scan-review-reference { margin: .75rem 0 0; overflow-wrap: anywhere; font-size: clamp(1.5rem, 3vw, 2rem); font-weight: 650; line-height: 1.2; letter-spacing: -.025em; }
.scan-review-current { margin: .25rem 0 0; max-width: 45%; color: var(--ui-muted, #5f6b7a); font-size: .875rem; line-height: 1.6; text-align: right; overflow-wrap: anywhere; }
.scan-review-details { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr); gap: 1rem; margin: 0 1.5rem; padding: 1.25rem 0; border-top: 1px solid var(--ui-border-soft, #e7ebf0); border-bottom: 1px solid var(--ui-border-soft, #e7ebf0); }
.scan-review-details > div { min-width: 0; padding-right: .75rem; border-right: 1px solid var(--ui-border-soft, #e7ebf0); }
.scan-review-details > div:last-child { padding-right: 0; border-right: 0; }
.scan-review-details dt { margin-bottom: .375rem; color: var(--ui-muted, #5f6b7a); font-size: .8125rem; }
.scan-review-details dd { margin: 0; font-size: .9375rem; line-height: 1.6; overflow-wrap: anywhere; }
.scan-review-details .scan-review-secondary { margin-top: .25rem; color: var(--ui-muted, #5f6b7a); font-size: .8125rem; }
.scan-review-body { padding: 1.5rem; }
.scan-review-stages { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); list-style: none; margin: 0 0 1.25rem; padding: 0; }
.scan-review-stages li { position: relative; display: flex; align-items: center; flex-direction: column; gap: .5rem; min-width: 0; color: var(--ui-muted, #5f6b7a); font-size: .875rem; line-height: 1.5; text-align: center; }
.scan-review-stages li:not(:last-child)::after { position: absolute; z-index: 0; top: 1rem; left: calc(50% + 1.25rem); right: calc(-50% + 1.25rem); height: 1px; background: var(--ui-border, #d8dee7); content: ''; }
.scan-review-step { position: relative; z-index: 1; display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: 50%; background: #edf0f4; color: #536174; font-size: .875rem; font-weight: 600; }
.scan-review-stages .is-current { color: var(--color-primary, #b4232a); font-weight: 600; }
.scan-review-stages .is-current .scan-review-step { background: var(--color-primary, #b4232a); color: #fff; }
.scan-review-transition { margin: 0 0 1.5rem; padding: .75rem 1rem; border-radius: .5rem; background: var(--ui-surface-muted, #f8fafc); color: var(--ui-muted, #5f6b7a); font-size: .9375rem; line-height: 1.6; text-align: center; overflow-wrap: anywhere; }
.scan-review-transition strong { color: var(--ui-text, #111827); }
.scan-review-checks { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr); gap: 1.5rem; }
.scan-review-checklist, .scan-review-photos { min-width: 0; }
.scan-review-checklist { padding-right: 1.5rem; border-right: 1px solid var(--ui-border-soft, #e7ebf0); }
.scan-review-section-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .5rem; margin-bottom: 1rem; }
.scan-review-section-heading h4 { margin: 0; font-size: 1rem; line-height: 1.5; }
.scan-review-ready, .scan-review-incomplete, .scan-review-photo-count { font-size: .8125rem; line-height: 1.5; }
.scan-review-ready { color: #157f54; }
.scan-review-incomplete { color: #b4232a; }
.scan-review-photo-count { color: var(--ui-muted, #5f6b7a); }
.scan-review-checklist-title { margin: 0 0 .5rem; color: var(--ui-muted, #5f6b7a); font-size: .8125rem; line-height: 1.6; }
.scan-review-items { list-style: none; margin: 0; padding: 0; }
.scan-review-items li { display: flex; align-items: flex-start; gap: .75rem; border-top: 1px solid var(--ui-border-soft, #e7ebf0); padding: .875rem 0; font-size: .9375rem; line-height: 1.65; overflow-wrap: anywhere; }
.scan-review-item-icon { display: grid; flex: 0 0 auto; width: 1.75rem; height: 1.75rem; place-items: center; border-radius: 50%; }
.scan-review-item-icon.is-checked { background: #e5f4eb; color: #157f54; }
.scan-review-item-icon.is-unchecked { background: #fcebea; color: #b4232a; }
.scan-review-photo-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .875rem; }
.scan-review-photo { min-width: 0; overflow: hidden; border: 1px solid var(--ui-border, #d8dee7); border-radius: .5rem; padding: 0; background: #fff; text-align: left; cursor: pointer; }
.scan-review-photo img { display: block; width: 100%; aspect-ratio: 4 / 3; height: auto; object-fit: cover; background: #f1f5f9; }
.scan-review-photo > span { display: block; overflow: hidden; padding: .5rem .625rem; color: var(--ui-muted, #5f6b7a); font-size: .8125rem; line-height: 1.5; text-overflow: ellipsis; white-space: nowrap; }
.scan-review-photo:focus-visible { outline: 2px solid var(--color-primary, #b4232a); outline-offset: 3px; }
.scan-review-photo-empty { display: grid; min-height: 10rem; place-content: center; justify-items: center; gap: .5rem; border: 1px dashed var(--ui-border, #d8dee7); border-radius: .5rem; background: var(--ui-surface-muted, #f8fafc); padding: 1rem; color: var(--ui-muted, #5f6b7a); text-align: center; }
.scan-review-photo-empty p, .scan-review-empty { margin: 0; color: var(--ui-muted, #5f6b7a); font-size: .875rem; line-height: 1.6; }
.scan-review-photo-hint { margin: .75rem 0 0; color: var(--ui-muted, #5f6b7a); font-size: .8125rem; line-height: 1.6; }
.scan-review-warning { margin: 1.25rem 0 0; border: 1px solid #fecaca; border-radius: .5rem; background: #fef2f2; padding: .75rem 1rem; color: #991b1b; font-size: .875rem; line-height: 1.65; }
.scan-review-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; border-top: 1px solid var(--ui-border-soft, #e7ebf0); padding: 1rem 1.5rem; }
.scan-review-footer > p { flex: 1 1 13rem; margin: 0; color: var(--ui-muted, #5f6b7a); font-size: .875rem; line-height: 1.6; overflow-wrap: anywhere; }
.scan-review-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: .75rem; }
.scan-review-cancel, .scan-review-confirm { min-height: 3rem; min-width: 10rem; }
.scan-review-course-actions { min-width: 10rem; max-width: 26rem; }
@media (max-width: 900px) {
  .scan-review-details { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .scan-review-details > div:nth-child(2n) { border-right: 0; }
  .scan-review-checks { grid-template-columns: minmax(0, 1fr); }
  .scan-review-checklist { border-right: 0; border-bottom: 1px solid var(--ui-border-soft, #e7ebf0); padding: 0 0 .5rem; }
}
@media (max-width: 540px) {
  .scan-review-header { flex-direction: column; padding: 1.125rem 1rem; gap: .75rem; }
  .scan-review-current { max-width: none; margin: 0; text-align: left; }
  .scan-review-details { gap: 1rem .75rem; margin: 0 1rem; padding: 1rem 0; }
  .scan-review-details > .scan-review-location { grid-column: 1 / -1; }
  .scan-review-body { padding: 1.25rem 1rem; }
  .scan-review-stages li { gap: .5rem; font-size: .75rem; }
  .scan-review-stages li:not(:last-child)::after { left: calc(50% + 1.125rem); right: calc(-50% + 1.125rem); }
  .scan-review-transition { margin-bottom: 1.25rem; padding: .75rem; font-size: .875rem; }
  .scan-review-photo-grid { gap: .625rem; }
  .scan-review-footer { padding: 1rem; }
  .scan-review-footer > p { flex-basis: 100%; }
  .scan-review-actions { display: grid; grid-template-columns: minmax(0, 1fr); width: 100%; }
  .scan-review-cancel, .scan-review-confirm, .scan-review-course-actions { width: 100%; min-width: 0; max-width: none; }
  .scan-review-cancel { order: 2; }
}
</style>
