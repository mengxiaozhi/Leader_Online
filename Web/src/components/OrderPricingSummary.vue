<template>
  <section v-if="pricing" class="space-y-2 rounded-lg bg-slate-50 p-4 text-sm" aria-label="訂單金額明細">
    <dl class="space-y-2">
    <div class="flex justify-between gap-3"><dt>明細合計</dt><dd class="money-value">{{ money(pricing.subtotal) }}</dd></div>
    <div class="flex justify-between gap-3"><dt>既有折抵</dt><dd class="money-value">−{{ money(pricing.discount) }}</dd></div>
    <div class="flex justify-between gap-3"><dt>人工調整差額</dt><dd class="money-value">{{ Number(pricing.adjustmentAmount) >= 0 ? '+' : '−' }}{{ money(Math.abs(pricing.adjustmentAmount || 0)) }}</dd></div>
    <div class="flex justify-between gap-3 border-t border-slate-200 pt-2 font-semibold"><dt>應付總額</dt><dd class="money-value">{{ money(pricing.total) }}</dd></div>
    </dl>
    <p v-if="pricing.managed && locked" class="pt-2 text-xs text-slate-600">金額已由後台調整；修改內容請聯繫服務人員。</p>
  </section>
</template>
<script setup>
import { formatOrderMoney as money } from '../utils/managedOrderPricing'
defineProps({ pricing: Object, locked: { type: Boolean, default: false } })
</script>
