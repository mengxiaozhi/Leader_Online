<template>
  <section class="handover-schedule" aria-label="交取車時間">
    <p class="handover-schedule__title">交取車時間 <span>台灣時間</span></p>
    <p v-if="schedule?.available === false" class="text-sm text-amber-700">時程暫時無法載入，請稍後再試。</p>
    <dl v-else class="handover-schedule__grid">
      <div v-for="stage in handoverStages" :key="stage.key">
        <dt>{{ stage.label }}</dt>
        <dd :class="{ 'handover-schedule__pending': !schedule?.stages?.[stage.key] }">{{ handoverWindow(schedule?.stages?.[stage.key]) }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup>
import { handoverStages, handoverWindow } from '../utils/handoverSchedule'
defineProps({ schedule: { type: Object, default: null } })
</script>

<style scoped>
.handover-schedule { margin: 1rem 0; padding: 1rem; border: 1px solid #dce3eb; border-radius: .75rem; background: #f8fafc; min-width: 0; }
.handover-schedule__title { margin-bottom: .75rem; font-weight: 600; color: #1e293b; font-size: .875rem; }
.handover-schedule__title span { margin-left: .5rem; font-weight: 400; color: #64748b; font-size: .75rem; }
.handover-schedule__grid { display: grid; gap: .75rem; }
dt { font-size: .75rem; color: #475569; margin-bottom: .15rem; }
dd { font-size: .875rem; line-height: 1.65; color: #0f172a; overflow-wrap: anywhere; }
.handover-schedule__pending { color: #64748b; }
@media (min-width: 640px) { .handover-schedule__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
