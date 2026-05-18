const rawBase =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_URL ||
  'https://api.spono.tw'

export const API_BASE = String(rawBase).replace(/\/+$/, '')
