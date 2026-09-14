<template>
  <Teleport to="body">
    <Transition name="backdrop-fade">
      <div
        v-if="modelValue"
        class="app-overlay-backdrop"
        aria-hidden="true"
        @click.self="onBackdrop"
      ></div>
    </Transition>

    <Transition
      :css="false"
      appear
      @enter="enterPanel"
      @leave="leavePanel"
      @enter-cancelled="cancelAnimation"
      @leave-cancelled="cancelAnimation"
      @after-enter="afterEnter"
      @after-leave="afterLeave"
    >
      <section
        v-if="modelValue"
        ref="panelRef"
        class="app-overlay-panel"
        :class="`app-overlay-panel--${resolvedPlacement}`"
        :data-size="size"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        :aria-describedby="description ? descriptionId : undefined"
        :aria-label="!title ? ariaLabel : undefined"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <header
          v-if="hasHeader"
          class="app-overlay-panel__header"
          :class="{ 'app-overlay-panel__header--draggable': canDrag }"
        >
          <div
            v-if="canDrag"
            class="app-overlay-panel__handle"
            aria-hidden="true"
            @pointerdown="onPointerDown"
          >
            <span aria-hidden="true"></span>
          </div>

          <div v-if="title || description" class="min-w-0 flex-1">
            <h2 v-if="title" :id="titleId" class="app-overlay-panel__title">{{ title }}</h2>
            <p v-if="description" :id="descriptionId" class="app-overlay-panel__description">
              {{ description }}
            </p>
          </div>

          <button
            v-if="closable"
            type="button"
            class="app-overlay-panel__close"
            aria-label="關閉"
            @click="requestClose('button')"
          >
            <AppIcon name="x" class="h-5 w-5" />
          </button>
        </header>

        <div
          class="app-overlay-panel__body"
          :class="{ 'app-overlay-panel__body--contained': !bodyScroll }"
        >
          <slot />
        </div>

        <footer v-if="$slots.actions" class="app-overlay-panel__actions">
          <slot name="actions" />
        </footer>
      </section>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { rubberBand, shouldDismissOverlay } from '../utils/overlayMotion.js'
import { acquireOverlayEnvironment, releaseOverlayEnvironment } from '../utils/overlayEnvironment.js'
import { createMotionController, motionDuration } from '../utils/motion.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  placement: {
    type: String,
    default: 'auto',
    validator: (value) => ['auto', 'bottom', 'right', 'center'].includes(value),
  },
  size: { type: String, default: 'md' },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  ariaLabel: { type: String, default: '內容面板' },
  closable: { type: Boolean, default: true },
  closeOnBackdrop: { type: Boolean, default: true },
  closeOnEscape: { type: Boolean, default: true },
  dragToClose: { type: Boolean, default: true },
  bodyScroll: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue', 'close', 'after-open', 'after-close'])
const panelRef = ref(null)
const resolvedPlacement = ref('bottom')
const titleId = `overlay-title-${useId()}`
const descriptionId = `overlay-description-${useId()}`
const hasHeader = computed(() => Boolean(props.title || props.description || props.closable || canDrag.value))
const canDrag = computed(() => props.closable && props.dragToClose && resolvedPlacement.value === 'bottom')

const panelMotion = createMotionController()
let completeEnter = null
let previousActiveElement = null
let backgroundPanelsState = []
const environmentToken = {}
let environmentLocked = false
let mediaQuery = null
let pointerId = null
let dragStarted = false
let startY = 0
let startOffset = 0
let lastY = 0
let lastTime = 0
let releaseVelocity = 0

const updatePlacement = () => {
  resolvedPlacement.value = props.placement === 'auto'
    ? (window.matchMedia('(min-width: 768px)').matches ? 'center' : 'bottom')
    : props.placement
}

const cancelAnimation = () => {
  completeEnter = null
  panelMotion.stop()
}

const panelDistance = (element) => {
  return resolvedPlacement.value === 'right'
    ? element.offsetWidth
    : element.offsetHeight
}

const closedTransform = (element) => {
  if (resolvedPlacement.value === 'right') return `translate3d(${panelDistance(element) + 24}px, 0, 0)`
  if (resolvedPlacement.value === 'bottom') return `translate3d(0, ${panelDistance(element) + 24}px, 0)`
  return 'translate3d(0, 8px, 0) scale(.975)'
}

const enterPanel = (element, done) => {
  element.inert = false
  completeEnter = () => {
    completeEnter = null
    done()
  }
  const interrupted = Boolean(element.style.transform || element.style.opacity)
  const current = getComputedStyle(element)
  panelMotion.run(element, [
    { opacity: interrupted ? current.opacity : 0, transform: interrupted ? current.transform : closedTransform(element) },
    { opacity: 1, transform: 'none' },
  ], { duration: motionDuration(resolvedPlacement.value === 'center' ? 'open' : 'panel', 280) }, () => completeEnter?.())
}

const leavePanel = (element, done) => {
  element.inert = true
  resetPointer()
  const current = getComputedStyle(element)
  panelMotion.run(element, [
    { opacity: current.opacity, transform: current.transform },
    { opacity: 0, transform: closedTransform(element) },
  ], { duration: motionDuration('close', 160) }, done)
}

const afterEnter = (element) => {
  element.style.opacity = ''
  element.style.transform = ''
  emit('after-open')
}

const lockBackground = () => {
  backgroundPanelsState = Array.from(document.querySelectorAll('.app-overlay-panel'))
    .filter((element) => element !== panelRef.value)
    .map((element) => {
      const state = {
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute('aria-hidden'),
        visibility: element.style.visibility,
      }
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
      element.style.visibility = 'hidden'
      return state
    })

  acquireOverlayEnvironment(environmentToken)
  environmentLocked = true
}

const unlockBackground = () => {
  for (const state of backgroundPanelsState) {
    const element = state.element
    if (!element?.isConnected) continue
    element.inert = state.inert
    if (state.ariaHidden == null) element.removeAttribute('aria-hidden')
    else element.setAttribute('aria-hidden', state.ariaHidden)
    element.style.visibility = state.visibility
  }
  backgroundPanelsState = []

  releaseOverlayEnvironment(environmentToken)
  environmentLocked = false
}

const getFocusable = () => {
  const panel = panelRef.value
  if (!panel) return []
  return Array.from(panel.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0)
}

const focusInitialControl = () => {
  const panel = panelRef.value
  if (!panel) return
  const explicit = panel.querySelector('[data-overlay-initial-focus], [autofocus]')
  const first = explicit || getFocusable()[0] || panel
  first.focus({ preventScroll: true })
}

const requestClose = (reason = 'programmatic') => {
  if (!props.closable && ['button', 'escape'].includes(reason)) return
  emit('update:modelValue', false)
  emit('close', reason)
}

const onBackdrop = () => {
  if (props.closeOnBackdrop) requestClose('backdrop')
}

const onKeydown = (event) => {
  if (event.key === 'Escape' && props.closeOnEscape && props.closable) {
    event.preventDefault()
    requestClose('escape')
    return
  }
  if (event.key !== 'Tab') return

  const focusable = getFocusable()
  if (!focusable.length) {
    event.preventDefault()
    panelRef.value?.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

const readTranslateY = (element) => {
  const transform = getComputedStyle(element).transform
  if (!transform || transform === 'none') return 0
  try {
    return new DOMMatrixReadOnly(transform).m42
  } catch {
    return 0
  }
}

const onPointerDown = (event) => {
  if (!canDrag.value || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
  // A drag can take over an entering panel; settle its enter hook after snapping.
  panelMotion.stop()
  resetPointer()
  pointerId = event.pointerId
  dragStarted = false
  startY = event.clientY
  startOffset = readTranslateY(panelRef.value)
  lastY = event.clientY
  lastTime = event.timeStamp
  releaseVelocity = 0
  event.currentTarget.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', onPointerMove, { passive: false })
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
}

const onPointerMove = (event) => {
  if (pointerId !== event.pointerId || !panelRef.value) return
  const delta = event.clientY - startY
  if (!dragStarted) {
    if (Math.abs(delta) < 10) return
    dragStarted = true
  }
  event.preventDefault()

  const rawOffset = startOffset + delta
  const size = Math.max(1, panelRef.value.offsetHeight)
  const offset = rawOffset < 0 ? rubberBand(rawOffset, size, 0.42) : rawOffset
  panelRef.value.style.transform = `translate3d(0, ${offset}px, 0)`

  const elapsed = Math.max(1, event.timeStamp - lastTime)
  const measuredVelocity = ((event.clientY - lastY) / elapsed) * 1000
  releaseVelocity = Math.max(-2400, Math.min(2400, measuredVelocity))
  lastY = event.clientY
  lastTime = event.timeStamp
}

const resetPointer = () => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  pointerId = null
  dragStarted = false
}

const snapOpen = () => {
  const panel = panelRef.value
  if (!panel || !props.modelValue) return
  panelMotion.run(panel, [
    { opacity: getComputedStyle(panel).opacity, transform: getComputedStyle(panel).transform },
    { opacity: 1, transform: 'none' },
  ], { duration: motionDuration('standard', 220) }, () => completeEnter?.())
}

const finishPointer = (event, cancelled = false) => {
  if (pointerId !== event.pointerId) return
  const panel = panelRef.value
  const offset = panel ? Math.max(0, readTranslateY(panel)) : 0
  const dismiss = !cancelled && dragStarted && props.dragToClose && shouldDismissOverlay({
    offset,
    velocity: event.timeStamp - lastTime > 100 ? 0 : releaseVelocity,
    size: panel?.offsetHeight || 1,
  })
  resetPointer()
  if (dismiss) requestClose('drag')
  else snapOpen()
}

const onPointerUp = (event) => finishPointer(event)
const onPointerCancel = (event) => finishPointer(event, true)

const afterLeave = () => {
  if (props.modelValue) return
  cancelAnimation()
  unlockBackground()
  const target = previousActiveElement
  previousActiveElement = null
  if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true })
  emit('after-close')
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    updatePlacement()
    if (!environmentLocked) {
      previousActiveElement = document.activeElement
      lockBackground()
    }
    await nextTick()
    if (props.modelValue) focusInitialControl()
  },
  { immediate: true }
)

watch(() => props.placement, updatePlacement)

onMounted(() => {
  updatePlacement()
  mediaQuery = window.matchMedia('(min-width: 768px)')
  mediaQuery.addEventListener?.('change', updatePlacement)
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener?.('change', updatePlacement)
  resetPointer()
  cancelAnimation()
  if (environmentLocked || backgroundPanelsState.length) unlockBackground()
})
</script>
