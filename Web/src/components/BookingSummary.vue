<template>
  <section :aria-labelledby="headingId" class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h3 :id="headingId" class="ui-title text-xl text-slate-950">預約明細</h3>
      <span class="text-sm text-slate-600">共 {{ quantity }} 輛</span>
    </div>
    <p v-if="!items.length" class="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
      選擇交車點與預約輛數後，這裡會顯示費用與票券抵免。
    </p>
    <ul v-else class="space-y-3">
      <li v-for="item in items" :key="item.key" class="rounded-xl border border-slate-200 p-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="break-words text-sm font-semibold text-slate-950">{{ item.store }}</p>
            <p class="mt-1 text-sm text-slate-600">{{ item.type }} · {{ money(item.unit) }} / 輛</p>
          </div>
          <button type="button" class="summary-edit" :aria-label="`修改${item.store} ${item.type}`" @click="$emit('edit', item)">修改</button>
        </div>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>預約 {{ item.total }} 輛<span v-if="item.tickets"> · 其中票券 {{ item.tickets }} 張</span></span>
          <span class="money-value font-semibold text-slate-950">{{ money(item.payable) }}</span>
        </div>
        <p v-if="item.tickets" class="mt-1 text-xs leading-5 text-slate-600">票券抵免 {{ money(item.discount) }}，已從本項費用扣除。</p>
      </li>
    </ul>
    <p v-if="items.length" class="break-words text-sm text-slate-600">託運者：{{ consignorName }}</p>
    <dl class="space-y-2 border-t border-slate-200 pt-4 text-sm text-slate-600">
      <div class="flex items-center justify-between gap-2"><dt>託運服務費</dt><dd class="money-value">{{ money(subtotal) }}</dd></div>
      <div v-if="ticketDiscount" class="flex items-center justify-between gap-2"><dt>票券抵免</dt><dd class="money-value text-primary">−{{ money(ticketDiscount) }}</dd></div>
      <div v-if="addOnCost" class="flex items-center justify-between gap-2"><dt>加購包材</dt><dd class="money-value">{{ money(addOnCost) }}</dd></div>
      <div class="flex flex-wrap items-end justify-between gap-2 pt-2 text-slate-950"><dt class="font-semibold">應付金額</dt><dd class="money-value text-2xl text-primary">{{ money(total) }}</dd></div>
    </dl>
    <p class="text-xs leading-5 text-slate-600">票券用於預約總輛數內；抵免不足時需補差額，包材費另計。</p>
  </section>
</template>

<script setup>
import { computed, useId } from 'vue'
const props = defineProps({
  items: { type: Array, default: () => [] },
  consignorName: { type: String, default: '' },
  subtotal: { type: Number, default: 0 },
  ticketDiscount: { type: Number, default: 0 },
  addOnCost: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
})
defineEmits(['edit'])
const headingId = `booking-summary-${useId()}`
const quantity = computed(() => props.items.reduce((sum, item) => sum + item.total, 0))
const money = value => `TWD ${Number(value || 0).toLocaleString('zh-TW')}`
</script>

<style scoped>
.summary-edit { min-height: 2.75rem; min-width: 2.75rem; flex-shrink: 0; color: var(--color-primary, #a83335); border-radius: .5rem; font-size: .875rem; font-weight: 500; }
.summary-edit:hover { background: #fff1f2; }
.summary-edit:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
