import { reactive } from 'vue'

export const toastState = reactive({ items: [] })

const timers = new Map()
let nextToastId = 1

export const dismissToast = (id) => {
  const timer = timers.get(id)
  if (timer) window.clearTimeout(timer)
  timers.delete(id)
  const index = toastState.items.findIndex((item) => item.id === id)
  if (index >= 0) toastState.items.splice(index, 1)
}

export const showToast = (message, options = {}) => {
  const text = String(message || '').trim()
  if (!text) return null

  const id = nextToastId++
  const duration = Math.max(0, Number(options.duration ?? 3600) || 0)
  const item = {
    id,
    message: text,
    tone: ['success', 'error', 'warning'].includes(options.tone) ? options.tone : 'info',
    actionLabel: String(options.actionLabel || options.action || '').trim(),
    onAction: typeof options.onAction === 'function' ? options.onAction : null,
  }
  toastState.items.push(item)

  if (duration > 0) {
    timers.set(id, window.setTimeout(() => dismissToast(id), duration))
  }
  return id
}

export const runToastAction = async (item) => {
  try {
    await item?.onAction?.()
  } finally {
    if (item?.id) dismissToast(item.id)
  }
}
