import test from 'node:test'
import assert from 'node:assert/strict'
import { createMotionController, motionScrollBehavior } from '../src/utils/motion.js'
import { prepareListLeave, clearListLeave } from '../src/utils/listMotion.js'

const setup = (t, reduced = false) => {
  const listeners = new Set()
  const media = {
    matches: reduced,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  }
  const originals = ['window', 'getComputedStyle'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  globalThis.window = { matchMedia: () => media }
  globalThis.getComputedStyle = element => element.computed
  t.after(() => originals.forEach(([key, descriptor]) => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }))
  const animations = []
  const element = {
    style: { opacity: '', transform: '', willChange: '' },
    computed: { opacity: '0.7', transform: 'matrix(1, 0, 0, 1, 0, 40)' },
    animate: () => {
      let resolve, reject
      const finished = new Promise((yes, no) => { resolve = yes; reject = no })
      const animation = { finished, resolve, cancelled: false, cancel() { this.cancelled = true; reject(new Error('cancelled')) } }
      animations.push(animation)
      return animation
    },
  }
  return { element, animations, listeners, media }
}

const frames = [{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1, transform: 'none' }]

test('rapid reversal preserves the current frame and cannot finish a newer transition', async t => {
  const { element, animations, listeners } = setup(t)
  const motion = createMotionController()
  const completed = []
  motion.run(element, frames, { duration: 250 }, () => completed.push('open'))
  motion.run(element, frames, { duration: 160 }, () => completed.push('close'))
  assert.equal(element.style.transform, element.computed.transform)
  assert.equal(animations[0].cancelled, true)
  animations[0].resolve()
  await Promise.resolve()
  assert.deepEqual(completed, [])
  assert.equal(listeners.size, 1)
  animations[1].resolve()
  await Promise.resolve()
  assert.deepEqual(completed, ['close'])
  assert.equal(element.style.transform, '')
  assert.equal(element.style.willChange, '')
  assert.equal(listeners.size, 0)
})

test('reduced motion skips movement and completes cleanup synchronously', t => {
  const { element, animations } = setup(t, true)
  let completed = 0
  createMotionController().run(element, frames, { duration: 250 }, () => completed++)
  assert.equal(animations.length, 0)
  assert.equal(completed, 1)
  assert.equal(element.style.opacity, 1)
  assert.equal(motionScrollBehavior(), 'auto')
})

test('changing motion preference during an animation finishes once and releases listeners', async t => {
  const { element, animations, listeners, media } = setup(t)
  let completed = 0
  createMotionController().run(element, frames, { duration: 250 }, () => completed++)
  media.matches = true
  for (const listener of listeners) listener({ matches: true })
  animations[0].resolve()
  await Promise.resolve()
  assert.equal(completed, 1)
  assert.equal(element.style.transform, '')
  assert.equal(element.style.willChange, '')
  assert.equal(listeners.size, 0)
})

test('unmount cancellation never runs completion callbacks or leaves an active layer', async t => {
  const { element, animations, listeners } = setup(t)
  let completed = 0
  const motion = createMotionController()
  motion.run(element, frames, { duration: 250 }, () => completed++)
  motion.stop()
  animations[0].resolve()
  await Promise.resolve()
  assert.equal(completed, 0)
  assert.equal(element.style.willChange, '')
  assert.equal(listeners.size, 0)
})

test('unavailable animation API leaves the surface visible and usable', t => {
  const { element } = setup(t)
  delete element.animate
  let completed = 0
  createMotionController().run(element, frames, {}, () => completed++)
  assert.equal(completed, 1)
  assert.equal(element.style.transform, '')
  assert.equal(motionScrollBehavior(), 'smooth')
})

test('filter removal freezes geometry and cancellation restores original styles and interactivity', () => {
  const element = { style: { width: '50%', height: '', left: '', top: '' }, offsetWidth: 320, offsetHeight: 200, offsetLeft: 344, offsetTop: 220, inert: false }
  prepareListLeave(element)
  assert.equal(element.style.width, '320px')
  assert.equal(element.style.left, '344px')
  assert.equal(element.inert, true)
  clearListLeave(element)
  assert.equal(element.style.width, '50%')
  assert.equal(element.style.left, '')
  assert.equal(element.inert, false)
})
