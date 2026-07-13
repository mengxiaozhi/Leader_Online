<script setup>
    import headerVue from './components/header.vue'
    import AppSheetHost from './components/AppSheetHost.vue'
    import MobileBottomNav from './components/MobileBottomNav.vue'
    import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
    import { useRoute } from 'vue-router'
    import Cookies from 'js-cookie'
    import { setPageMeta } from './utils/meta'
    import { provideSwipeRegistry } from './composables/useSwipeRegistry'
    import { API_BASE } from './utils/api'
    import axios, { getApiActivity, subscribeApiActivity } from './api/axios'

    const route = useRoute()
    const API = API_BASE
    const currentYear = new Date().getFullYear()
    const closeDisclaimer = ref(false)
    const insuranceTermsUrl = ref('')
    const socialLinks = ref([])
    const apiActivity = ref(getApiActivity())
    const showApiProcessing = ref(false)
    let apiProcessingTimer = null
    let unsubscribeApiActivity = null
    const swipeRegistry = provideSwipeRegistry()
    const rawGlobalBinding = swipeRegistry.getBinding()
    const globalSwipeBinding = computed(() => rawGlobalBinding.value || {})
    const apiProcessingMessage = computed(() => (
        apiActivity.value.mutating ? '資料處理中，請稍候' : '資料載入中'
    ))
    const apiProcessingBlocksInput = computed(() => apiActivity.value.mutating)
    const normalizeHttpUrl = (value = '') => {
        const text = String(value || '').trim()
        if (!text) return ''
        try {
            const parsed = new URL(text)
            return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : ''
        } catch {
            return ''
        }
    }
    const normalizedInsuranceTermsUrl = computed(() => {
        return normalizeHttpUrl(insuranceTermsUrl.value)
    })
    const normalizedSocialLinks = computed(() => {
        const seen = new Set()
        return (Array.isArray(socialLinks.value) ? socialLinks.value : [])
            .map(item => {
                const url = normalizeHttpUrl(item?.url)
                const label = String(item?.label || '').trim()
                return url && label ? { label, url } : null
            })
            .filter(item => {
                if (!item || seen.has(item.url)) return false
                seen.add(item.url)
                return true
            })
    })

    const applyRouteMeta = () => {
        const meta = route.meta?.seo ? { ...route.meta.seo } : {}
        if (!meta.title && typeof route.name === 'string') meta.title = String(route.name)
        setPageMeta(meta)
    }

    const updateApiActivity = (state) => {
        apiActivity.value = state
        if (state.active) {
            if (!showApiProcessing.value && !apiProcessingTimer) {
                apiProcessingTimer = window.setTimeout(() => {
                    if (apiActivity.value.active) showApiProcessing.value = true
                    apiProcessingTimer = null
                }, 180)
            }
            return
        }
        if (apiProcessingTimer) {
            window.clearTimeout(apiProcessingTimer)
            apiProcessingTimer = null
        }
        showApiProcessing.value = false
    }

    onMounted(() => {
        unsubscribeApiActivity = subscribeApiActivity(updateApiActivity)
        loadLegalLinks()

        // 讀取 cookie 是否已同意
        const agreed = Cookies.get('disclaimer_accepted')
        if (!agreed) {
            closeDisclaimer.value = false
        } else {
            closeDisclaimer.value = true
        }
    })

    onBeforeUnmount(() => {
        if (unsubscribeApiActivity) unsubscribeApiActivity()
        if (apiProcessingTimer) window.clearTimeout(apiProcessingTimer)
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
            if (data?.ok) {
                insuranceTermsUrl.value = data.data?.insuranceTermsUrl || ''
                socialLinks.value = Array.isArray(data.data?.socialLinks) ? data.data.socialLinks : []
            }
        } catch {
            insuranceTermsUrl.value = ''
            socialLinks.value = []
        }
    }
</script>


<template>
    <div class="app-shell" v-hammer="globalSwipeBinding">
        <headerVue />
        <RouterView v-slot="{ Component, route }">
            <transition name="route-slide" mode="out-in">
                <KeepAlive v-if="route.meta?.keepAlive" :max="4">
                    <component :is="Component" :key="route.path || route.fullPath" />
                </KeepAlive>
                <component v-else :is="Component" :key="route.fullPath" />
            </transition>
        </RouterView>
        <AppSheetHost />
        <MobileBottomNav />
        <transition name="api-processing-fade">
            <div
                v-if="showApiProcessing"
                class="global-api-processing"
                :class="{ 'global-api-processing--blocking': apiProcessingBlocksInput }"
                role="status"
                aria-live="polite"
                :aria-busy="apiActivity.active ? 'true' : 'false'"
            >
                <div class="global-api-processing__bar" aria-hidden="true"></div>
                <div class="global-api-processing__pill">
                    <span class="global-api-processing__spinner" aria-hidden="true"></span>
                    <span>{{ apiProcessingMessage }}</span>
                </div>
            </div>
        </transition>
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
                        <router-link to="/brand" class="hover:text-primary">品牌故事</router-link>
                        <router-link to="/terms" class="hover:text-primary">使用者條款</router-link>
                        <router-link to="/provider-terms" class="hover:text-primary">服務商條款</router-link>
                        <router-link to="/privacy" class="hover:text-primary">隱私權政策</router-link>
                        <router-link to="/reservation-notice" class="hover:text-primary">預約購買須知</router-link>
                        <router-link to="/reservation-rules" class="hover:text-primary">預約使用規定</router-link>
                        <a v-if="normalizedInsuranceTermsUrl" :href="normalizedInsuranceTermsUrl" target="_blank" rel="noopener noreferrer" class="hover:text-primary">產險條款</a>
                    </div>
                </nav>
                <nav v-if="normalizedSocialLinks.length" class="flex flex-col gap-3 md:items-end" aria-label="社群連結">
                    <p class="font-medium text-slate-900">社群連結</p>
                    <div class="flex flex-wrap gap-x-4 gap-y-2 md:justify-end">
                        <a
                            v-for="link in normalizedSocialLinks"
                            :key="link.url"
                            :href="link.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="hover:text-primary"
                        >
                            {{ link.label }}
                        </a>
                    </div>
                </nav>
            </div>
        </footer>
    </div>
</template>
