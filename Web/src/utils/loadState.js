const hasItems = (items) => Array.isArray(items) && items.length > 0

export const resolveLoadState = ({ loading = false, error = '', items = [] } = {}) => {
  if (loading) return { status: 'loading', message: '' }
  const message = String(error || '').trim()
  if (message) return { status: 'error', message }
  if (!hasItems(items)) return { status: 'empty', message: '' }
  return { status: 'success', message: '' }
}
