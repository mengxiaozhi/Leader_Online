// Shared clocks live in styles/motion.css; JavaScript animations use the same tokens.
export const prefersReducedMotion = () => typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true

export const motionScrollBehavior = () => prefersReducedMotion() ? 'auto' : 'smooth'

export const motionDuration = (name, fallback) => {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--ui-motion-${name}`).trim()
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? Math.max(0, number * (value.endsWith('ms') ? 1 : 1000)) : fallback
}

export const motionEase = 'cubic-bezier(0.22, 1, 0.36, 1)'

// One owner per surface: interrupted animations never complete a newer transition.
// Only active animations promote a layer, and changing the OS preference finishes
// the transition immediately so a dialog cannot remain hidden or keep input locked.
export const createMotionController = () => {
  let current = null

  const stop = () => {
    if (!current) return
    const record = current
    current = null
    const computed = getComputedStyle(record.element)
    const presentation = {}
    for (const property of record.properties) {
      presentation[property] = computed[property]
      record.element.style[property] = computed[property]
    }
    record.animation.cancel()
    record.element.style.willChange = record.willChange
    record.media?.removeEventListener?.('change', record.onPreferenceChange)
    return { element: record.element, presentation }
  }

  const run = (element, frames, options, done = () => {}) => {
    const interrupted = stop()
    // Inline styles alone cannot override explicit WAAPI keyframes. Retarget
    // from the actual visible frame, including during rapid route changes.
    const keyframes = frames.map(frame => ({ ...frame }))
    if (interrupted?.element === element) {
      for (const property of Object.keys(keyframes[0])) {
        if (property in interrupted.presentation) keyframes[0][property] = interrupted.presentation[property]
      }
    }
    const last = frames[frames.length - 1]
    const properties = Object.keys(last)
    const applyFinalFrame = () => {
      for (const property of properties) element.style[property] = last[property] === 'none' ? '' : last[property]
    }
    if (prefersReducedMotion() || !element.animate) {
      applyFinalFrame()
      done()
      return
    }

    const willChange = element.style.willChange
    element.style.willChange = properties.join(', ')
    let animation
    try {
      animation = element.animate(keyframes, { fill: 'both', easing: motionEase, ...options })
    } catch {
      element.style.willChange = willChange
      applyFinalFrame()
      done()
      return
    }
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const record = { element, animation, properties, willChange, media }
    const finish = () => {
      if (current !== record) return
      current = null
      applyFinalFrame()
      animation.cancel()
      element.style.willChange = willChange
      media?.removeEventListener?.('change', record.onPreferenceChange)
      done()
    }
    record.onPreferenceChange = (event) => { if (event.matches) finish() }
    current = record
    media?.addEventListener?.('change', record.onPreferenceChange)
    animation.finished.then(finish, () => { if (current === record) finish() })
  }

  return { run, stop }
}
