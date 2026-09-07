// Keep display URLs separate from event payloads. In-flight responses must never
// resurrect a removed/replaced preview or allocate a Blob URL after unmount.
export function createAdminEventCoverCache({ loadBlob, createObjectURL, revokeObjectURL, onChange = () => {} }) {
  const entries = new Map()
  const remove = (id) => {
    const entry = entries.get(String(id))
    if (!entry) return
    entries.delete(String(id))
    if (entry.objectUrl) revokeObjectURL(entry.objectUrl)
    onChange()
  }
  const load = (event) => {
    if (!event?.id) return Promise.resolve()
    const id = String(event.id)
    const version = `${event.updated_at || ''}:${event.cover || ''}`
    const previous = entries.get(id)
    if (previous?.version === version) return previous.promise
    remove(id)
    const entry = { version, url: event.cover || '', loading: !event.cover, error: '', objectUrl: '' }
    entries.set(id, entry)
    entry.promise = (async () => {
      try {
        // Existing external cover URLs continue to render directly, without
        // forwarding API credentials to a third-party image host.
        if (event.cover) return
        const blob = await loadBlob(event.id)
        if (entries.get(id) !== entry) return
        entry.objectUrl = createObjectURL(blob)
        entry.url = entry.objectUrl
      } catch (error) {
        if (entries.get(id) !== entry) return
        if (error?.response?.status !== 404 || event.cover_type) {
          entry.error = '目前無法載入封面預覽，請重試。'
        }
      } finally {
        if (entries.get(id) === entry) {
          entry.loading = false
          onChange()
        }
      }
    })()
    onChange()
    return entry.promise
  }
  return {
    get: (id) => entries.get(String(id)),
    load,
    invalidate: remove,
    retain(ids) {
      const keep = new Set(ids.map(String))
      for (const id of entries.keys()) if (!keep.has(id)) remove(id)
    },
    clear() { for (const id of entries.keys()) remove(id) },
  }
}

// Record the persisted ID before the second request, so an upload retry updates
// the same event even when its first save was a create.
export async function saveEventWithCover({ eventId, payload, coverData, save, upload, onSaved }) {
  const response = await save(eventId, payload)
  if (!response?.ok) throw new Error(response?.message || '場次儲存失敗')
  const id = eventId || response.data?.id
  if (!id) throw new Error('無法取得已儲存的場次編號')
  onSaved(id)
  if (coverData) {
    try {
      const result = await upload(id, coverData)
      if (!result?.ok) throw new Error(result?.message || '封面上傳失敗')
    } catch (error) {
      return { id, coverError: error?.response?.data?.message || error.message || '封面上傳失敗' }
    }
  }
  return { id, coverError: '' }
}
