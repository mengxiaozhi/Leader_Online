<template>
  <div class="space-y-2">
    <p
      v-if="reason && !canPrimaryRedeem"
      class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
      role="status"
    >
      {{ reason }}
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="action in visibleActions"
        :key="action.key"
        type="button"
        class="btn min-h-[44px] flex-1"
        :class="action.tone === 'primary' ? 'btn-primary text-white' : 'btn-outline'"
        :disabled="busy || (action.requiresRedeemable && !redeemableValue)"
        @click="$emit('action', action.key)"
      >
        <AppIcon v-if="busy && busyAction === action.key" name="refresh" class="h-4 w-4 animate-spin" />
        {{ action.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  courseActionDefinition,
  courseActionReason,
  normalizeCourseCapabilities,
} from '../utils/courseV2'

const props = defineProps({
  booking: { type: Object, default: () => ({}) },
  capabilities: { type: [Object, Array], default: null },
  redeemable: { type: Boolean, default: undefined },
  busy: { type: Boolean, default: false },
  busyAction: { type: String, default: '' },
  primaryOnly: { type: Boolean, default: false },
  legacyAttend: { type: Boolean, default: true },
})

defineEmits(['action'])

const normalizedCapabilities = computed(() => {
  const normalized = normalizeCourseCapabilities(props.capabilities || props.booking?.capabilities || {})
  if (!normalized.raw.length && props.legacyAttend) normalized.attend = true
  return normalized
})

const redeemableValue = computed(() => {
  if (typeof props.redeemable === 'boolean') return props.redeemable
  if (typeof props.booking?.redeemable === 'boolean') return props.booking.redeemable
  return true
})

const reason = computed(() => courseActionReason(props.booking))
const canPrimaryRedeem = computed(() => (
  redeemableValue.value
  && (normalizedCapabilities.value.attend || normalizedCapabilities.value.makeupRedeem)
))

const visibleActions = computed(() => {
  const capabilities = normalizedCapabilities.value
  const definitions = [
    { key: 'attend', enabled: capabilities.attend, requiresRedeemable: true },
    { key: 'makeupRedeem', enabled: capabilities.makeupRedeem, requiresRedeemable: true },
    { key: 'undo', enabled: capabilities.undo, requiresRedeemable: false },
    { key: 'excusedLeave', enabled: capabilities.excusedLeave, requiresRedeemable: false },
    { key: 'noShow', enabled: capabilities.noShow, requiresRedeemable: false },
  ]
  return definitions
    .filter(item => item.enabled)
    .filter(item => !props.primaryOnly || ['attend', 'makeupRedeem'].includes(item.key))
    .map(item => ({ ...item, ...courseActionDefinition(item.key) }))
})
</script>
