import { ref } from 'vue'
import { normalizeTableDensity } from '../utils/adminTable.js'

const key = 'leader-admin-table-density'
let initial = 'comfortable'
try { initial = normalizeTableDensity(localStorage.getItem(key)) } catch { /* Storage may be unavailable. */ }
const density = ref(initial)

export function useAdminTableDensity() {
  return { density, setDensity(value) {
    density.value = normalizeTableDensity(value)
    try { localStorage.setItem(key, density.value) } catch { /* Preference remains usable in memory. */ }
  } }
}
