<script setup>
    import headerVue from './components/header.vue'
    import AppSheetHost from './components/AppSheetHost.vue'
    import { ref, onMounted, watch } from 'vue'
    import { useRoute } from 'vue-router'
    import Cookies from 'js-cookie'

    const route = useRoute()
    const closeDisclaimer = ref(false)

    const updateTitle = () => {
        document.title = `${route.name} - Leader Online`
    }

    onMounted(() => {
        updateTitle()

        // 讀取 cookie 是否已同意
        const agreed = Cookies.get('disclaimer_accepted')
        if (!agreed) {
            closeDisclaimer.value = false
        } else {
            closeDisclaimer.value = true
        }
    })

    watch(
        () => route.name,
        (newName) => {
            document.title = `${route.name} - Leader Online`
        },
        { immediate: true }
    )

    const acceptDisclaimer = () => {
        Cookies.set('disclaimer_accepted', 'true', { expires: 365 }) // 一年內不再提醒
        closeDisclaimer.value = true
    }
</script>


<template>
    <headerVue />
    <router-view></router-view>
    <AppSheetHost />
</template>
