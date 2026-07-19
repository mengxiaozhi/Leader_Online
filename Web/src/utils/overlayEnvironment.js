import { reactive } from 'vue'

const activeLocks = new Set()
let sharedState = null

export const overlayEnvironmentState = reactive({ activeCount: 0 })

const readElementState = (element) => element ? {
  element,
  inert: element.inert,
  ariaHidden: element.getAttribute('aria-hidden'),
} : null

const restoreElementState = (state) => {
  const element = state?.element
  if (!element?.isConnected) return
  element.inert = state.inert
  if (state.ariaHidden == null) element.removeAttribute('aria-hidden')
  else element.setAttribute('aria-hidden', state.ariaHidden)
}

export const acquireOverlayEnvironment = (token) => {
  if (!token || activeLocks.has(token) || typeof document === 'undefined') return

  if (!activeLocks.size) {
    const appRoot = document.querySelector('#app')
    sharedState = {
      appRoot: readElementState(appRoot),
      body: {
        overflow: document.body.style.overflow,
        paddingRight: document.body.style.paddingRight,
      },
    }

    if (appRoot) {
      appRoot.inert = true
      appRoot.setAttribute('aria-hidden', 'true')
    }
    const scrollbarGap = Math.max(0, window.innerWidth - document.documentElement.clientWidth)
    document.body.style.overflow = 'hidden'
    if (scrollbarGap) document.body.style.paddingRight = `${scrollbarGap}px`
  }

  activeLocks.add(token)
  overlayEnvironmentState.activeCount = activeLocks.size
}

export const releaseOverlayEnvironment = (token) => {
  if (!token || !activeLocks.delete(token) || typeof document === 'undefined') return
  overlayEnvironmentState.activeCount = activeLocks.size
  if (activeLocks.size) return

  restoreElementState(sharedState?.appRoot)
  if (sharedState?.body) {
    document.body.style.overflow = sharedState.body.overflow
    document.body.style.paddingRight = sharedState.body.paddingRight
  }
  sharedState = null
}
