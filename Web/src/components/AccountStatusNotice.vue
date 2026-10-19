<template>
  <div v-if="messages.length" class="space-y-0.5 text-sm font-medium text-red-700">
    <p v-for="message in messages" :key="message">{{ message }}</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { accountStatusMessages } from '../utils/accountStatus.js'

const props = defineProps({ record: { type: Object, default: () => ({}) } })
const messages = computed(() => accountStatusMessages(props.record))
</script>
