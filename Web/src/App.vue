<script setup>
    import headerVue from './components/header.vue'
    import AppSheetHost from './components/AppSheetHost.vue'
    import { ref, onMounted, watch, computed } from 'vue'
    import { useRoute } from 'vue-router'
    import Cookies from 'js-cookie'
    import { setPageMeta } from './utils/meta'
    import { provideSwipeRegistry } from './composables/useSwipeRegistry'
    import { API_BASE } from './utils/api'
    import axios from './api/axios'

    const route = useRoute()
    const API = API_BASE
    const currentYear = new Date().getFullYear()
    const closeDisclaimer = ref(false)
    const insuranceTermsUrl = ref('')
    const swipeRegistry = provideSwipeRegistry()
    const rawGlobalBinding = swipeRegistry.getBinding()
    const globalSwipeBinding = computed(() => rawGlobalBinding.value || {})
    const normalizedInsuranceTermsUrl = computed(() => {
        const value = String(insuranceTermsUrl.value || '').trim()
        if (!value) return ''
        try {
            const parsed = new URL(value)
            return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : ''
        } catch {
            return ''
        }
    })

    const applyRouteMeta = () => {
        const meta = route.meta?.seo ? { ...route.meta.seo } : {}
        if (!meta.title && typeof route.name === 'string') meta.title = String(route.name)
        setPageMeta(meta)
    }

    onMounted(() => {
        applyRouteMeta()
        loadLegalLinks()

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

    const loadLegalLinks = async () => {
        try {
            const { data } = await axios.get(`${API}/app/legal_links`, {
                __skipOfflineHandling: true,
                __skipRetry: true
            })
            if (data?.ok) insuranceTermsUrl.value = data.data?.insuranceTermsUrl || ''
        } catch {
            insuranceTermsUrl.value = ''
        }
    }
</script>


<template>
    <div class="app-shell" v-hammer="globalSwipeBinding">
        <headerVue />
        <RouterView v-slot="{ Component, route }">
            <transition name="route-slide" mode="out-in">
                <KeepAlive v-if="route.meta?.keepAlive">
                    <component :is="Component" :key="route.path || route.fullPath" />
                </KeepAlive>
                <component v-else :is="Component" :key="route.fullPath" />
            </transition>
        </RouterView>
        <AppSheetHost />
        <footer class="mt-12 border-t border-slate-300 bg-white px-4 py-8">
            <div class="mx-auto flex max-w-6xl flex-col gap-6 text-sm text-slate-700 md:flex-row md:items-start md:justify-between">
                <div class="min-w-0">
                    <router-link to="/" class="inline-flex items-center gap-3 text-slate-900 hover:text-primary" aria-label="Leader Online 首頁">
                        <img src="/logo.png" alt="Leader Online" class="h-11 w-auto max-w-[168px] object-contain" />
                    </router-link>
                    <p class="mt-3 leading-relaxed text-slate-700">© {{ currentYear }} Leader Online. 保留所有權利。</p>
                </div>
                <nav class="flex flex-col gap-3 md:items-end" aria-label="法務資訊">
                    <p class="font-medium text-slate-900">法務資訊</p>
                    <div class="flex flex-wrap gap-x-4 gap-y-2 md:justify-end">
                        <router-link to="/terms" class="hover:text-primary">使用者條款</router-link>
                        <router-link to="/privacy" class="hover:text-primary">隱私權政策</router-link>
                        <router-link to="/reservation-notice" class="hover:text-primary">預約購買須知</router-link>
                        <router-link to="/reservation-rules" class="hover:text-primary">預約使用規定</router-link>
                        <a v-if="normalizedInsuranceTermsUrl" :href="normalizedInsuranceTermsUrl" target="_blank" rel="noopener noreferrer" class="hover:text-primary">產險條款</a>
                    </div>
                </nav>
            </div>
        </footer>
    </div>
</template>
