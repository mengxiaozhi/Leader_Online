<template>
  <section class="handover-timeline" :aria-label="mode === 'preview' ? '交取車安排' : '交取車進度'">
    <header class="handover-timeline__header">
      <p class="handover-timeline__title">{{ mode === 'preview' ? '交取車安排' : '交取車進度' }}</p>
      <span>預定時間・台灣時間</span>
    </header>
    <p v-if="progress.summary" class="handover-timeline__summary">{{ progress.summary }}</p>
    <p v-if="schedule?.available === false" class="handover-timeline__notice" role="status">時程暫時無法載入，請稍後再試。</p>
    <ol class="handover-timeline__steps" :aria-label="mode === 'preview' ? '四階段交取車安排' : '四階段交取車進度'">
      <li v-for="(step, index) in progress.steps" :key="step.key" :class="`handover-timeline__step--${step.state}`" :aria-current="step.state === 'current' ? 'step' : undefined">
        <span class="handover-timeline__marker" aria-hidden="true">{{ index + 1 }}</span>
        <div class="handover-timeline__content">
          <div class="handover-timeline__step-heading">
            <strong>{{ step.label }}</strong>
            <span v-if="step.stateLabel" class="handover-timeline__state">{{ step.stateLabel }}</span>
          </div>
          <template v-if="schedule?.available !== false">
            <p class="handover-timeline__time">{{ handoverTimelineWindow(schedule?.stages?.[step.key]) }}</p>
            <p class="handover-timeline__location"><span>地點：</span>{{ handoverLocation(schedule, step.key, storeName, storeAddress) }}</p>
          </template>
        </div>
      </li>
    </ol>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { handoverLocation } from '../utils/handoverSchedule.js'
import { handoverTimelineProgress, handoverTimelineWindow } from '../utils/handoverTimeline.js'

const props = defineProps({
  schedule: { type: Object, default: null },
  storeName: { type: String, default: '' },
  storeAddress: { type: String, default: '' },
  status: { type: String, default: null },
  mode: { type: String, default: 'preview' },
})
const progress = computed(() => handoverTimelineProgress(props.status, props.mode))
</script>

<style scoped>
.handover-timeline { container: handover-flow / inline-size; min-width: 0; margin: 1rem 0; padding: 1rem; border: 1px solid #e0e5eb; border-radius: .875rem; background: #fafbfc; color: #334155; }
.handover-timeline__header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .4rem .75rem; }
.handover-timeline__title { font-size: .9375rem; font-weight: 650; color: #1e293b; }
.handover-timeline__header > span { font-size: .75rem; color: #64748b; }
.handover-timeline__summary { margin-top: .45rem; font-size: .8125rem; font-weight: 500; color: #475569; }
.handover-timeline__notice { margin-top: .75rem; font-size: .8125rem; line-height: 1.7; color: #92400e; }
.handover-timeline__steps { display: grid; margin: 1.125rem 0 0; padding: 0; list-style: none; }
.handover-timeline__steps > li { position: relative; display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: .75rem; min-width: 0; padding-bottom: 1.25rem; }
.handover-timeline__steps > li:last-child { padding-bottom: 0; }
.handover-timeline__steps > li::before { content: ''; position: absolute; top: 24px; bottom: 0; left: 11px; width: 2px; background: #dbe1e8; }
.handover-timeline__steps > li:last-child::before { display: none; }
.handover-timeline__marker { position: relative; z-index: 1; display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid #b9c3d0; border-radius: 50%; background: #fafbfc; color: #64748b; font-size: .6875rem; font-weight: 600; }
.handover-timeline__content { min-width: 0; padding-top: 1px; }
.handover-timeline__step-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .2rem .75rem; }
.handover-timeline__step-heading strong { font-size: .875rem; font-weight: 600; color: #334155; }
.handover-timeline__state { font-size: .6875rem; color: #64748b; }
.handover-timeline__time { margin: .35rem 0 0; color: #334155; font-size: .8125rem; line-height: 1.65; overflow-wrap: anywhere; }
.handover-timeline__location { margin: .25rem 0 0; color: #64748b; font-size: .75rem; line-height: 1.65; white-space: pre-line; overflow-wrap: anywhere; }
.handover-timeline__step--current .handover-timeline__marker { background: var(--color-primary, #b4232a); border-color: var(--color-primary, #b4232a); color: #fff; box-shadow: 0 0 0 4px #b4232a12; }
.handover-timeline__step--current .handover-timeline__step-heading strong, .handover-timeline__step--current .handover-timeline__state { color: var(--color-primary, #b4232a); }
.handover-timeline__step--complete .handover-timeline__marker { border-color: #a8cbbb; background: #eaf4ef; color: #25614c; }
.handover-timeline__step--complete .handover-timeline__state { color: #25614c; }
.handover-timeline__steps > .handover-timeline__step--complete::before { background: #a8cbbb; }
.handover-timeline__step--cancelled .handover-timeline__marker { background: #f1f5f9; border-color: #dbe1e8; }
@container handover-flow (min-width: 36rem) {
  .handover-timeline__steps { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; }
  .handover-timeline__steps > li { display: flex; flex-direction: column; gap: .65rem; padding-bottom: 0; }
  .handover-timeline__steps > li::before { top: 11px; bottom: auto; left: 24px; right: -1rem; width: auto; height: 2px; }
  .handover-timeline__step-heading { flex-direction: column; align-items: flex-start; gap: .25rem; }
}
</style>
