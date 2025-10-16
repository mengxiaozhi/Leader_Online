import { ref, onMounted, onBeforeUnmount } from 'vue'

export const useIsMobile = (breakpoint = 768) => {
    const isMobile = ref(false)
    let cleanup = null

    const setup = () => {
        if (typeof window === 'undefined') return

        if (cleanup) {
            cleanup()
            cleanup = null
        }

        if (typeof window.matchMedia === 'function') {
            const media = window.matchMedia(`(max-width: ${breakpoint}px)`)
            const update = () => { isMobile.value = media.matches }
            update()
            if (typeof media.addEventListener === 'function') {
                media.addEventListener('change', update)
                cleanup = () => media.removeEventListener('change', update)
            } else if (typeof media.addListener === 'function') {
                media.addListener(update)
                cleanup = () => media.removeListener(update)
            } else {
                cleanup = null
            }
            return
        }

        const update = () => { isMobile.value = window.innerWidth <= breakpoint }
        update()
        const handleResize = () => update()
        window.addEventListener('resize', handleResize)
        window.addEventListener('orientationchange', handleResize)
        cleanup = () => {
            window.removeEventListener('resize', handleResize)
            window.removeEventListener('orientationchange', handleResize)
        }
    }

    onMounted(setup)
    onBeforeUnmount(() => {
        if (cleanup) {
            cleanup()
            cleanup = null
        }
    })

    return { isMobile }
}
