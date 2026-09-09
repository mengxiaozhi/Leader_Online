<template>
  <section class="space-y-4" aria-label="修改訂單金額">
    <div v-for="line in lines" :key="line.key" class="rounded-lg border border-slate-200 p-3">
      <p class="text-sm font-medium">{{ line.name }} <span class="text-slate-500">× {{ line.quantity }} 份</span></p>
      <label :for="`${idPrefix}-${line.key}`" class="mt-2 block text-sm">單價（NT$）</label>
      <div class="mt-1 flex items-center gap-2">
        <input :id="`${idPrefix}-${line.key}`" :value="unitValue(line)" type="text" inputmode="decimal" class="min-w-0 flex-1 border px-3 py-2" :disabled="disabled" @input="setUnit(line.key, $event.target.value)" />
        <button type="button" class="btn btn-outline btn-sm shrink-0" :disabled="disabled" @click="setUnit(line.key, null)">恢復原單價</button>
      </div>
      <p v-if="line.byTicket" class="mt-1 text-xs text-slate-500">此項由票券全額抵扣，修改單價不增加應付金額。</p>
    </div>
    <label class="flex items-center gap-2 text-sm font-medium"><input type="checkbox" :checked="draft.manualTotal" :disabled="disabled" @change="toggleTotal($event.target.checked)" />直接指定應付總額</label>
    <div v-if="draft.manualTotal" class="space-y-2">
      <label :for="`${idPrefix}-total`" class="block text-sm">指定總額（NT$）</label>
      <input :id="`${idPrefix}-total`" :value="draft.totalOverride" type="text" inputmode="decimal" class="w-full border px-3 py-2" :disabled="disabled" @input="draft.totalOverride = $event.target.value; draft.dirty = true" />
      <p class="text-xs text-slate-600">修改單價或數量仍保持此總額。</p>
      <button type="button" class="btn btn-outline btn-sm" :disabled="disabled" @click="toggleTotal(false)">恢復自動加總</button>
    </div>
    <p v-if="preview.error" class="text-sm text-red-700" role="alert">{{ preview.error }}</p>
    <OrderPricingSummary v-else :pricing="preview" />
    <p v-if="!preview.error && preview.total === 0" class="text-sm text-amber-800">0 元訂單仍需由後台確認，確認後才會完成發券或預約。</p>
    <label :for="`${idPrefix}-note`" class="block text-sm">改價備註（選填）</label>
    <textarea :id="`${idPrefix}-note`" v-model="draft.note" maxlength="500" rows="2" class="w-full border px-3 py-2" :disabled="disabled" @input="draft.dirty = true" />
  </section>
</template>
<script setup>
import { computed } from 'vue'
import { previewPricing } from '../utils/managedOrderPricing'
import OrderPricingSummary from './OrderPricingSummary.vue'
const props = defineProps({ pricing: { type: Object, required: true }, draft: { type: Object, required: true }, lines: { type: Array, required: true }, disabled: Boolean, idPrefix: { type: String, default: 'order-price' } })
const preview = computed(() => previewPricing(props.pricing, props.draft, props.lines))
function unitValue(line) { return props.draft.unitPriceOverrides[line.key] ?? line.baseUnitPrice }
function setUnit(key, value) { props.draft.unitPriceOverrides[key] = value; props.draft.dirty = true }
function toggleTotal(enabled) {
  if (enabled) props.draft.totalOverride = preview.value.total ?? props.pricing.total ?? 0
  props.draft.manualTotal = enabled
  props.draft.dirty = true
}
</script>
