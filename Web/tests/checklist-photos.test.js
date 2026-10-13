import test from 'node:test'
import assert from 'node:assert/strict'
import { checklistHasMinimumPhotos } from '../src/utils/checklistPhotos.js'
import { CHECKLIST_STAGE_KEYS, ensureChecklistHasPhotos, isStageChecklistCompleted } from '../src/utils/reservationStages.js'
import { normalizeChecklistPhotoPolicy, reservationChecklistDisplayStatus } from '../src/utils/reservationWallet.js'

test('minimum defaults to two before policy load and cannot be lowered by an older server', () => {
    assert.equal(normalizeChecklistPhotoPolicy().minCount, 2)
    assert.equal(normalizeChecklistPhotoPolicy({ minCount: 1 }).minCount, 2)
    assert.equal(normalizeChecklistPhotoPolicy({ minCount: 3 }).minCount, 3)
})

for (const stage of CHECKLIST_STAGE_KEYS) {
    test(`${stage}: viewing a photo is independent from checklist readiness`, () => {
        for (const count of [0, 1, 2, 3]) {
            for (const completed of [false, true]) {
                const checklist = { completed, photoCount: count, photos: Array(count).fill({ id: 1 }) }
                const reservation = { status: stage, checklists: { [stage]: checklist } }
                assert.equal(ensureChecklistHasPhotos(checklist), count > 0)
                assert.equal(checklistHasMinimumPhotos(checklist), count >= 2)
                assert.equal(isStageChecklistCompleted(reservation, stage), completed && count >= 2)
                assert.equal(reservationChecklistDisplayStatus(reservation), count < 2 ? '待上傳照片' : completed ? '檢核完成' : '待完成檢核')
            }
        }
        const otherStage = CHECKLIST_STAGE_KEYS.find(key => key !== stage)
        const reservation = { status: stage, checklists: {
            [stage]: { completed: true, photoCount: 1 },
            [otherStage]: { completed: true, photoCount: 6 },
        } }
        assert.equal(isStageChecklistCompleted(reservation, stage), false)
        assert.equal(reservationChecklistDisplayStatus(reservation), '待上傳照片')
        assert.equal(checklistHasMinimumPhotos({ photoCount: 1, photos: [{}, {}] }), false)
    })
}

test('metadata-only stages and explicit policy minimum use the same readiness rule', () => {
    const reservation = { status: 'pre_pickup', stageChecklist: { pre_pickup: { completed: true, photoCount: 2 } } }
    assert.equal(isStageChecklistCompleted(reservation, 'pre_pickup'), true)
    assert.equal(isStageChecklistCompleted(reservation, 'pre_pickup', 3), false)
    assert.equal(reservationChecklistDisplayStatus(reservation, 3), '待上傳照片')
})
