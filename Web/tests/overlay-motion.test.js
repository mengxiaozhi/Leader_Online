import test from 'node:test'
import assert from 'node:assert/strict'
import { projectPosition, rubberBand, shouldDismissOverlay } from '../src/utils/overlayMotion.js'

test('projectPosition hands pointer velocity into the release destination', () => {
  assert.equal(projectPosition(40, 500), 140)
  assert.equal(projectPosition(40, -200, 0.1), 20)
})

test('rubberBand preserves direction while compressing overscroll', () => {
  assert.equal(rubberBand(0, 500), 0)
  assert.ok(rubberBand(-120, 500) < 0)
  assert.ok(Math.abs(rubberBand(-120, 500)) < 120)
})

test('snap decision combines distance and release velocity', () => {
  assert.equal(shouldDismissOverlay({ offset: 30, velocity: 1200, size: 600 }), true)
  assert.equal(shouldDismissOverlay({ offset: 230, velocity: 0, size: 600 }), true)
  assert.equal(shouldDismissOverlay({ offset: 45, velocity: 80, size: 600 }), false)
})
