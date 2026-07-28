import test from 'node:test'
import assert from 'node:assert/strict'

import {
  checklistPhotoAccept,
  normalizeChecklistPhotoPolicy,
  reservationChecklistDisplayStatus,
  resolveReservationChecklistDeepLink,
  validateChecklistPhoto,
} from '../src/utils/reservationWallet.js'

const stage = 'pre_dropoff'
const reservation = (checklist = {}, stageChecklist = {}) => ({
  id: 42,
  status: stage,
  checklists: { [stage]: checklist },
  stageChecklist: { [stage]: stageChecklist },
})

test('photo policy is entirely derived from the backend contract', () => {
  const policy = normalizeChecklistPhotoPolicy({
    maxCount: 6,
    maxBytes: 8_388_608,
    allowedMimeTypes: ['image/jpeg', 'IMAGE/PNG', 'image/jpeg', ''],
  })

  assert.deepEqual(policy, {
    maxCount: 6,
    maxBytes: 8_388_608,
    allowedMimeTypes: ['image/jpeg', 'image/png'],
  })
  assert.equal(checklistPhotoAccept(policy), 'image/jpeg,image/png')
  assert.deepEqual(
    validateChecklistPhoto({ type: 'image/png', size: 8_388_608 }, policy),
    { ok: true, code: '' },
  )
  assert.equal(
    validateChecklistPhoto({ type: 'image/gif', size: 100 }, policy).code,
    'UNSUPPORTED_MIME',
  )
  assert.equal(
    validateChecklistPhoto({ type: 'image/png', size: 8_388_609 }, policy).code,
    'FILE_TOO_LARGE',
  )
  assert.deepEqual(
    validateChecklistPhoto(
      { type: 'image/heif', size: 100 },
      normalizeChecklistPhotoPolicy({
        maxCount: 6,
        maxBytes: 8_388_608,
        allowedMimeTypes: ['image/heic'],
      }),
    ),
    { ok: true, code: '' },
  )
  assert.equal(
    validateChecklistPhoto({ type: 'image/png', size: 100 }, normalizeChecklistPhotoPolicy()).code,
    'POLICY_UNAVAILABLE',
  )
})

test('reservation checklist status covers upload, completion, and transport completion', () => {
  assert.equal(reservationChecklistDisplayStatus(reservation()), '待上傳照片')
  assert.equal(
    reservationChecklistDisplayStatus(reservation({ photos: [{ id: 1 }], completed: false })),
    '待完成檢核',
  )
  assert.equal(
    reservationChecklistDisplayStatus(reservation({ photoCount: 1, completed: true })),
    '檢核完成',
  )
  assert.equal(reservationChecklistDisplayStatus({ status: 'done' }), '托運完成')
})

test('reservation checklist deep links accept only a positive id and checklist action', () => {
  assert.deepEqual(resolveReservationChecklistDeepLink({}), {
    requested: false,
    valid: false,
    reservationId: null,
  })
  assert.deepEqual(
    resolveReservationChecklistDeepLink({ reservation: '42', action: 'checklist' }),
    { requested: true, valid: true, reservationId: 42 },
  )
  assert.equal(
    resolveReservationChecklistDeepLink({ reservation: '42', action: 'other' }).valid,
    false,
  )
  assert.equal(
    resolveReservationChecklistDeepLink({ reservation: '42 OR 1=1', action: 'checklist' }).valid,
    false,
  )
  assert.equal(
    resolveReservationChecklistDeepLink({ reservation: ['42'], action: 'checklist' }).valid,
    false,
  )
})
