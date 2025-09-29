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
  ],
  plus: [
    'M12 5v14',
    'M5 12h14'
  ],
  check: [
    'M5 13l4 4L19 7'
  ],
  x: [
    'M6 18L18 6',
    'M6 6l12 12'
  ],
  edit: [
    'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z',
    'M14.06 4.94l3.75 3.75'
  ],
  trash: [
    'M3 6h18',
    'M8 6V4h8v2',
    'M6 6l1 14h10l1-14',
    'M10 11v6',
    'M14 11v6'
  ],
  image: [
    'M3 5h18v14H3z',
    'M8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M21 15l-4-5-5 6-3-3-6 7'
  ],
  copy: [
    'M9 9h11v11H9z',
    'M4 4h11v11H4z'
  ],
  minus: [
    'M5 12h14'
  ],
  camera: [
    'M3 7h4l2-2h6l2 2h4v12H3z',
    'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'
  ],
  focus: [
    'M12 5V3',
    'M12 21v-2',
    'M5 12H3',
    'M21 12h-2',
    'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z'
  ],
  pause: [
    'M10 5v14',
    'M14 5v14'
  ],
  shield: [
    'M12 3l8 4v5c0 5-3.5 9.1-8 9.9C7.5 21.1 4 17 4 12V7l8-4z'
  ],
  settings: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2v2',
    'M12 20v2',
    'M4.93 4.93l1.41 1.41',
    'M17.66 17.66l1.41 1.41',
    'M4.93 19.07l1.41-1.41',
    'M17.66 6.34l1.41-1.41',
    'M2 12h2',
    'M20 12h2'
  ]
}

const iconPath = paths[props.name] || null
const cls = props.class || 'h-5 w-5'
</script>
