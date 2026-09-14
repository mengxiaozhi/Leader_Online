import { createMotionController, motionDuration } from './motion.js'

const controllers = new WeakMap()

// Animate the existing route host, preserving KeepAlive, scroll and form state.
// Opacity leaves fixed drawers and sticky navigation in their existing coordinates.
export const vPageMotion = {
  mounted(element) { controllers.set(element, createMotionController()) },
  updated(element, { value, oldValue }) {
    if (value === oldValue) return
    controllers.get(element)?.run(element, [{ opacity: 0.65 }, { opacity: 1 }], {
      duration: motionDuration('page', 220),
    }, () => { element.style.opacity = '' })
  },
  beforeUnmount(element) {
    controllers.get(element)?.stop()
    controllers.delete(element)
  },
}
