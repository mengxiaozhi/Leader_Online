import Hammer from 'hammerjs'

const DEFAULT_TOUCH_ACTION = 'pan-y'

const normalizeBinding = (binding) => {
    const config = {
        events: {},
        options: undefined,
        touchAction: DEFAULT_TOUCH_ACTION
    }

    if (!binding) return config

    const { value, arg } = binding

    if (typeof value === 'function') {
        const eventName = typeof arg === 'string' ? arg : 'tap'
        config.events[eventName] = value
        return config
    }

    if (value && typeof value === 'object') {
        const eventsSource = value.events && typeof value.events === 'object' ? value.events : value
        for (const [event, handler] of Object.entries(eventsSource)) {
            if (typeof handler === 'function') config.events[event] = handler
        }
        if (typeof value.touchAction === 'string') config.touchAction = value.touchAction
        if (value.touchAction === false) config.touchAction = undefined
        if (value.options) config.options = value.options
    }

    if (typeof arg === 'string' && !config.events[arg] && value && typeof value[arg] === 'function') {
        config.events[arg] = value[arg]
    }

    return config
}

const applyOptions = (manager, options) => {
    if (!options) return

    if (typeof options === 'function') {
        options(manager)
        return
    }

    if (options.recognizers && typeof options.recognizers === 'object') {
        for (const [name, recognizerOptions] of Object.entries(options.recognizers)) {
            const recognizer = manager.get(name)
            if (recognizer && recognizer.set && recognizerOptions && typeof recognizerOptions === 'object') {
                recognizer.set(recognizerOptions)
            }
        }
    }

    if (options.cssProps && typeof options.cssProps === 'object') {
        manager.set({ cssProps: { ...manager.options?.cssProps, ...options.cssProps } })
    }
}

const updateHandlers = (el, manager, events = {}) => {
    const previous = el.__hammerHandlers || {}

    for (const [event, handler] of Object.entries(previous)) {
        if (!events[event] || events[event] !== handler) manager.off(event, handler)
    }

    const nextHandlers = {}
    for (const [event, handler] of Object.entries(events)) {
        if (typeof handler !== 'function') continue
        const shouldAttach = !previous[event] || previous[event] !== handler
        if (shouldAttach) manager.on(event, handler)
        nextHandlers[event] = handler
    }

    el.__hammerHandlers = nextHandlers
}

const setTouchAction = (el, touchAction) => {
    if (el.__hammerOriginalTouchAction === undefined) el.__hammerOriginalTouchAction = el.style.touchAction
    if (typeof touchAction === 'string') {
        el.style.touchAction = touchAction
    } else if (touchAction === undefined) {
        el.style.touchAction = el.__hammerOriginalTouchAction ?? ''
    }
}

const cleanup = (el) => {
    const manager = el.__hammerManager
    if (manager) {
        const handlers = el.__hammerHandlers || {}
        for (const [event, handler] of Object.entries(handlers)) {
            manager.off(event, handler)
        }
        manager.destroy()
    }
    if (el.__hammerOriginalTouchAction !== undefined) {
        el.style.touchAction = el.__hammerOriginalTouchAction
    }
    delete el.__hammerManager
    delete el.__hammerHandlers
    delete el.__hammerOriginalTouchAction
}

const ensureManager = (el) => {
    if (el.__hammerManager) return el.__hammerManager
    const manager = new Hammer(el)
    try {
        manager.get('swipe')?.set({ direction: Hammer.DIRECTION_HORIZONTAL })
        manager.get('pan')?.set({ direction: Hammer.DIRECTION_HORIZONTAL })
    } catch (_) {
        // no-op if recognizer not available
    }
    el.__hammerManager = manager
    return manager
}

export default {
    mounted(el, binding) {
        const config = normalizeBinding(binding)
        const manager = ensureManager(el)
        applyOptions(manager, config.options)
        setTouchAction(el, config.touchAction)
        updateHandlers(el, manager, config.events)
    },
    updated(el, binding) {
        const config = normalizeBinding(binding)
        const manager = ensureManager(el)
        applyOptions(manager, config.options)
        setTouchAction(el, config.touchAction)
        updateHandlers(el, manager, config.events)
    },
    unmounted(el) {
        cleanup(el)
    }
}
