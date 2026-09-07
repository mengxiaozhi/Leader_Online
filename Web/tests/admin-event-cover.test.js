import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdminEventCoverCache, saveEventWithCover } from '../src/utils/adminEventCover.js'

function cacheHarness(loadBlob = async () => new Blob(['image'])) {
  const revoked = []
  let created = 0
  const cache = createAdminEventCoverCache({
    loadBlob,
    createObjectURL: () => `blob:test-${++created}`,
    revokeObjectURL: url => revoked.push(url),
  })
  return { cache, revoked, created: () => created }
}

test('draft/published changes share authenticated bytes without changing event data', async () => {
  const calls = []
  const { cache, revoked } = cacheHarness(async id => { calls.push(id); return new Blob(['cover']) })
  const event = { id: 9, cover: null, updated_at: 'v1', listing_status: 'draft' }
  await Promise.all([cache.load(event), cache.load(event)])
  assert.deepEqual(calls, [9])
  assert.equal(cache.get(9).url, 'blob:test-1')
  assert.equal(event.cover, null)
  for (const status of ['published', 'draft', 'published']) {
    await cache.load({ ...event, listing_status: status })
    assert.equal(cache.get(9).url, 'blob:test-1')
  }
  cache.clear()
  assert.deepEqual(revoked, ['blob:test-1'])
})

test('reload/replacement and deletion revoke URLs even with identical timestamps', async () => {
  const { cache, revoked } = cacheHarness()
  const event = { id: 3, updated_at: 'same-second' }
  await cache.load(event)
  cache.invalidate(3)
  await cache.load(event)
  assert.equal(cache.get(3).url, 'blob:test-2')
  cache.retain([])
  assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2'])
  assert.equal(cache.get(3), undefined)
})

test('late responses after removal cannot restore stale previews or leak Blob URLs', async () => {
  const resolve = []
  const { cache, created } = cacheHarness(() => new Promise(done => resolve.push(done)))
  const old = cache.load({ id: 1, updated_at: 'old' })
  const current = cache.load({ id: 1, updated_at: 'new' })
  resolve[1](new Blob(['new']))
  await current
  resolve[0](new Blob(['old']))
  await old
  assert.equal(created(), 1)
  assert.equal(cache.get(1).url, 'blob:test-1')
  const pending = cache.load({ id: 2 })
  cache.clear()
  resolve[2](new Blob(['unmounted']))
  await pending
  assert.equal(created(), 1)
  assert.equal(cache.get(2), undefined)
})

test('failed preview can be retried and missing covers are handled without a broken URL', async () => {
  let failure = true
  const { cache } = cacheHarness(async () => {
    if (failure) throw { response: { status: 404 } }
    return new Blob(['image'])
  })
  await cache.load({ id: 1, cover_type: 'image/png' })
  assert.match(cache.get(1).error, /重試/)
  await cache.load({ id: 2 })
  assert.equal(cache.get(2).error, '')
  failure = false
  cache.invalidate(1)
  await cache.load({ id: 1, cover_type: 'image/png' })
  assert.equal(cache.get(1).error, '')
  assert.match(cache.get(1).url, /^blob:/)
})

test('external covers are rendered without forwarding credentials or mutating the URL', async () => {
  const { cache, created, revoked } = cacheHarness(() => assert.fail('must not fetch external URLs with API credentials'))
  await cache.load({ id: 1, cover: 'https://images.example/cover.png' })
  assert.equal(cache.get(1).url, 'https://images.example/cover.png')
  cache.clear()
  assert.equal(created(), 0)
  assert.deepEqual(revoked, [])
})

for (const failure of ['network', 'application']) {
  test(`create then ${failure} upload failure keeps ID and image for retry without another insert`, async () => {
    let id = null
    const saves = []
    const uploads = []
    let failUpload = true
    const options = {
      payload: { title: 'Test', listing_status: 'draft' },
      coverData: 'data:image/png;base64,test',
      save: async (eventId, payload) => { saves.push({ eventId, payload }); return { ok: true, data: { id: 42 } } },
      onSaved: value => { id = value },
      upload: async (eventId, data) => {
        assert.equal(id, 42, 'ID must be recorded before upload')
        uploads.push({ eventId, data })
        if (failUpload && failure === 'network') throw new Error('offline')
        return { ok: !failUpload, message: 'upload failed' }
      },
    }
    const first = await saveEventWithCover({ ...options, eventId: id })
    assert.equal(first.id, 42)
    assert.ok(first.coverError)
    failUpload = false
    const retry = await saveEventWithCover({ ...options, eventId: id })
    assert.equal(retry.coverError, '')
    assert.deepEqual(saves.map(s => s.eventId), [null, 42])
    assert.deepEqual(uploads, [uploads[0], uploads[0]])
    assert.equal(uploads[0].data, options.coverData)
    assert.equal('cover' in saves[1].payload, false)
  })
}

test('failed event save never advances the ID or uploads; status-only update does not upload', async () => {
  await assert.rejects(saveEventWithCover({
    save: async () => ({ ok: false, message: 'save failed' }),
    onSaved: () => assert.fail('save failed'), upload: () => assert.fail('save failed'),
  }), /save failed/)
  const result = await saveEventWithCover({
    eventId: 8, payload: { listing_status: 'draft' }, coverData: '',
    save: async () => ({ ok: true }), onSaved: id => assert.equal(id, 8),
    upload: () => assert.fail('no new image'),
  })
  assert.deepEqual(result, { id: 8, coverError: '' })
})
