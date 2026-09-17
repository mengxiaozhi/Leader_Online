<template>
  <span ref="pill" class="t-tabs-pill app-sliding-indicator" :data-ready="ready" aria-hidden="true"></span>
</template>

<script setup>
import { nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({ active: { type: [String, Number], required: true } })
const pill = ref(null)
const ready = ref(false)
let observer
let frame = 0
let disposed = false

function measure(animate = false) {
  const element = pill.value
  const tab = element?.parentElement?.querySelector('[role="tab"][aria-selected="true"]')
  if (!tab?.offsetWidth) {
    ready.value = false
    return
  }
  const transition = element.style.transition
  if (!animate || !ready.value) element.style.transition = 'none'
  element.style.transform = `translateX(${tab.offsetLeft}px)`
  element.style.width = `${tab.offsetWidth}px`
  element.style.height = `${tab.offsetHeight}px`
  element.style.top = `${tab.offsetTop}px`
  if (!animate || !ready.value) {
    void element.offsetWidth
    element.style.transition = transition
  }
  ready.value = true
}

function measureLayout() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => measure(false))
}

watch(() => props.active, async () => { await nextTick(); if (!disposed) measure(true) })
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measureLayout)
    observer.observe(pill.value.parentElement)
    pill.value.parentElement.querySelectorAll('[role="tab"]').forEach(tab => observer.observe(tab))
  }
  window.addEventListener('resize', measureLayout)
  document.fonts?.addEventListener?.('loadingdone', measureLayout)
})
onActivated(() => nextTick(() => { if (!disposed) measureLayout() }))
onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(frame)
  observer?.disconnect()
  window.removeEventListener('resize', measureLayout)
  document.fonts?.removeEventListener?.('loadingdone', measureLayout)
})
</script>
