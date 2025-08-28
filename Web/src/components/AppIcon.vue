<template>
  <svg v-if="iconPath" :class="cls" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-for="(d, i) in iconPath" :key="i" :d="d" />
  </svg>
</template>

<script setup>
const props = defineProps({ name: { type: String, required: true }, class: { type: String, default: '' } })

const paths = {
  cart: [
    'M6 6h15l-1.5 9h-12z',
    'M6 6L5 3H2',
    'M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    'M18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'
  ],
  orders: [
    'M9 2h6a2 2 0 0 1 2 2v16l-5-3-5 3V4a2 2 0 0 1 2-2z'
  ],
  refresh: [
    'M4 4v6h6',
    'M20 20v-6h-6',
    'M5.1 15A7 7 0 0 0 20 12',
    'M4 12a7 7 0 0 1 10.9-5'
  ],
  lock: [
    'M6 10V7a6 6 0 1 1 12 0v3',
    'M5 10h14v10H5z',
    'M12 15v3'
  ],
  store: [
    'M3 9l1.5-5h15L21 9',
    'M3 9h18v10H3z',
    'M9 19v-6h6v6'
  ],
  ticket: [
    'M3 9h18v2a2 2 0 1 0 0 4v2H3v-2a2 2 0 1 0 0-4z'
  ],
  user: [
    'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
    'M4 22a8 8 0 0 1 16 0'
  ],
  logout: [
    'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
    'M16 17l5-5-5-5',
    'M21 12H9'
  ]
}

const iconPath = paths[props.name] || null
const cls = props.class || 'h-5 w-5'
</script>

