import { reactive, computed, provide, inject, watch, unref, onBeforeUnmount } from 'vue'

const SwipeRegistrySymbol = Symbol('SwipeRegistry')
const RESERVED_KEYS = new Set(['events', 'touchAction', 'options', 'priority'])

const normalizeConfig = (input) => {
    if (!input) return null
    if (typeof input === 'function') {
        return { events: { tap: input } }
    }
    if (typeof input !== 'object') return null

    const events = {}
    if (input.events && typeof input.events === 'object') {
        for (const [event, handler] of Object.entries(input.events)) {
            if (typeof handler === 'function') events[event] = handler
        }
    }

    for (const [key, handler] of Object.entries(input)) {
        if (RESERVED_KEYS.has(key)) continue
        if (typeof handler === 'function') events[key] = handler
    }

    if (!Object.keys(events).length) return null

    const normalized = { events }
    if ('touchAction' in input) normalized.touchAction = input.touchAction
    if ('options' in input) normalized.options = input.options
    return normalized
}

const compileAggregate = (entries) => {
    if (!entries.length) return {}

    const sorted = entries
        .filter(entry => entry && entry.config)
        .slice()
        .sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority
            return a.index - b.index
        })

    if (!sorted.length) return {}

    const eventBuckets = {}
    let touchAction
    let options

    for (const entry of sorted) {
        const normalized = normalizeConfig(entry.config)
        if (!normalized) continue

        if (touchAction === undefined && normalized.touchAction !== undefined) {
            touchAction = normalized.touchAction
        }
        if (!options && normalized.options) {
            options = normalized.options
        }

        for (const [event, handler] of Object.entries(normalized.events)) {
            if (typeof handler !== 'function') continue
            if (!eventBuckets[event]) eventBuckets[event] = []
            eventBuckets[event].push(handler)
        }
    }

    const events = {}
    for (const [event, handlers] of Object.entries(eventBuckets)) {
        if (!handlers.length) continue
        if (handlers.length === 1) {
            events[event] = handlers[0]
        } else {
            events[event] = (ev) => {
                for (const fn of handlers) {
                    try {
                        fn(ev)
                    } catch (err) {
                        console.error('[SwipeRegistry] handler error', err)
                    }
                }
            }
        }
    }

    const binding = {}
    if (Object.keys(events).length) binding.events = events
    if (touchAction !== undefined) binding.touchAction = touchAction
    if (options) binding.options = options

    return binding
}

const createTargetRegistry = () => {
    const entries = reactive(new Map())
    const aggregated = computed(() => compileAggregate(Array.from(entries.values())))
    return { entries, aggregated }
}

const createSwipeRegistry = () => {
    const targets = new Map()
    let sequence = 0

    const ensureTarget = (target = 'global') => {
        if (!targets.has(target)) {
            targets.set(target, createTargetRegistry())
        }
        return targets.get(target)
    }

    const registerSwipeHandlers = (id, source, { target = 'global' } = {}) => {
        const registry = ensureTarget(target)
        if (registry.entries.has(id)) {
            const existing = registry.entries.get(id)
            if (existing?.stop) existing.stop()
            registry.entries.delete(id)
        }

        const entry = reactive({
            id,
            config: null,
            priority: 0,
            index: sequence++,
            stop: null
        })
        registry.entries.set(id, entry)

        const stop = watch(
            () => unref(source),
            (value) => {
                entry.config = value || null
                if (value && typeof value === 'object' && value !== null && 'priority' in value) {
                    const nextPriority = Number(value.priority)
                    entry.priority = Number.isFinite(nextPriority) ? nextPriority : 0
                } else {
                    entry.priority = 0
                }
            },
            { immediate: true, deep: true }
        )

        entry.stop = stop

        const cleanup = () => {
            stop()
            registry.entries.delete(id)
        }

        onBeforeUnmount(cleanup)

        return cleanup
    }

    const getBinding = (target = 'global') => ensureTarget(target).aggregated

    const unregisterSwipeHandlers = (id, target = 'global') => {
        const registry = targets.get(target)
        if (!registry) return
        const entry = registry.entries.get(id)
        if (!entry) return
        if (typeof entry.stop === 'function') {
            entry.stop()
        }
        registry.entries.delete(id)
    }

    return { registerSwipeHandlers, unregisterSwipeHandlers, getBinding }
}

export const provideSwipeRegistry = () => {
    const registry = createSwipeRegistry()
    provide(SwipeRegistrySymbol, registry)
    return registry
}

export const useSwipeRegistry = () => {
    const registry = inject(SwipeRegistrySymbol, null)
    if (!registry) throw new Error('useSwipeRegistry must be used within provider')
    return registry
}

export const SWIPE_GLOBAL_TARGET = 'global'
