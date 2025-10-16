<script setup>
    import headerVue from './components/header.vue'
    import AppSheetHost from './components/AppSheetHost.vue'
    import { ref, onMounted, watch, computed } from 'vue'
    import { useRoute } from 'vue-router'
    import Cookies from 'js-cookie'
    import { setPageMeta } from './utils/meta'
    import { provideSwipeRegistry } from './composables/useSwipeRegistry'

    const route = useRoute()
    const closeDisclaimer = ref(false)
    const swipeRegistry = provideSwipeRegistry()
    const rawGlobalBinding = swipeRegistry.getBinding()
    const globalSwipeBinding = computed(() => rawGlobalBinding.value || {})

    const applyRouteMeta = () => {
        const meta = route.meta?.seo ? { ...route.meta.seo } : {}
        if (!meta.title && typeof route.name === 'string') meta.title = String(route.name)
        setPageMeta(meta)
    }

    onMounted(() => {
        applyRouteMeta()

        // 讀取 cookie 是否已同意
        const agreed = Cookies.get('disclaimer_accepted')
        if (!agreed) {
            closeDisclaimer.value = false
        } else {
            closeDisclaimer.value = true
        }
    })

    watch(
        () => route.fullPath,
        () => {
            applyRouteMeta()
        },
        { immediate: true }
    )

    const acceptDisclaimer = () => {
        Cookies.set('disclaimer_accepted', 'true', { expires: 365 }) // 一年內不再提醒
        closeDisclaimer.value = true
    }
</script>


<template>
    <div class="app-shell" v-hammer="globalSwipeBinding">
        <headerVue />
        <RouterView v-slot="{ Component, route }">
            <transition name="route-slide" mode="out-in">
                <component :is="Component" :key="route.fullPath" />
            </transition>
        </RouterView>
        <AppSheetHost />
        <footer class="bg-gray-100 border-t border-gray-200 py-4 px-4 mt-10">
            <div class="max-w-6xl mx-auto text-sm text-gray-600 flex flex-wrap items-center gap-4">
                <router-link to="/terms" class="hover:text-primary">使用者條款</router-link>
                <span class="hidden sm:inline text-gray-300">|</span>
                <router-link to="/privacy" class="hover:text-primary">隱私權政策</router-link>
                <span class="hidden sm:inline text-gray-300">|</span>
                <router-link to="/reservation-notice" class="hover:text-primary">預約購買須知</router-link>
                <span class="hidden sm:inline text-gray-300">|</span>
                <router-link to="/reservation-rules" class="hover:text-primary">預約使用規定</router-link>
            </div>
        </footer>
    </div>
</template>
