<template>
    <main class="min-h-screen flex items-center justify-center px-4 py-10 bg-gradient-to-br from-slate-50 via-white to-rose-50">
        <div class="w-full max-w-2xl">
            <div class="card rounded-3xl p-6 sm:p-10 flex flex-col gap-6 text-center">
                <div class="flex flex-col items-center gap-3">
                    <div class="h-14 w-14 rounded-full bg-rose-50 text-primary grid place-items-center shadow-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                            stroke="currentColor" class="h-7 w-7">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                    </div>
                    <h1 class="text-2xl sm:text-3xl font-bold text-slate-900">服務暫時離線</h1>
                    <p class="text-sm text-slate-600 max-w-xl">
                        目前無法連線至後端 API，我們正在持續偵測狀態。系統恢復後會立即帶您回到先前的頁面。
                    </p>
                </div>

                <section class="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left space-y-2">
                    <h2 class="text-base font-semibold text-slate-900">偵測狀態</h2>
                    <p class="text-sm text-slate-700" v-if="checking">正在檢查伺服器狀態，請稍候…</p>
                    <p class="text-sm text-slate-700" v-else>將於 <strong class="text-primary">{{ countdown }}
                            秒</strong> 後自動重試</p>
                    <p class="text-xs text-slate-500">上次檢查：{{ lastCheckedText }}</p>
                </section>

                <div v-if="lastError" class="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm p-4 text-left">{{ lastError }}</div>

                <div class="flex flex-col gap-3 sm:flex-row">
                    <button class="btn btn-primary flex-1" @click="manualRetry" :disabled="checking">
                        <span v-if="checking" class="mr-2 h-4 w-4 rounded-full border-2 border-white/60 border-t-white animate-spin" aria-hidden="true"></span>
                        {{ checking ? '檢查中…' : '立即重試' }}
                    </button>
                    <button class="btn btn-outline flex-1" @click="goHome" :disabled="checking">回到首頁</button>
                </div>
            </div>
        </div>
    </main>
</template>

<script setup>
    import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
    import { useRouter } from 'vue-router'
    import { consumeOfflineRedirect, clearApiOffline } from '../utils/offline'

    const router = useRouter()
    const API = 'https://api.xiaozhi.moe/uat/leader_online'
    const HEALTH_ENDPOINT = `${API}/healthz`
    const AUTO_RETRY_SECONDS = 15
    let retryAttempt = 0

    const checking = ref(false)
    const countdown = ref(AUTO_RETRY_SECONDS)
    const lastCheckedAt = ref(null)
    const lastError = ref('')
    let countdownTimer = null

    const formatTime = (date) => {
        if (!date) return '尚未嘗試'
        try {
            return new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
        } catch {
            return date.toLocaleTimeString?.() || '剛剛'
        }
    }

    const lastCheckedText = computed(() => formatTime(lastCheckedAt.value))

    const stopCountdown = () => { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null } }

    const scheduleNextCheck = () => {
        stopCountdown()
        if(retryAttempt <= 11){ //上限為180秒
            retryAttempt += 1
        }
        countdown.value = retryAttempt * AUTO_RETRY_SECONDS
        countdownTimer = setInterval(() => {
            if (countdown.value <= 1) {
                stopCountdown()
                manualRetry()
            } else {
                countdown.value -= 1
            }
        }, 1000)
    }

    const checkStatus = async () => {
        if (checking.value) return
        checking.value = true
        lastError.value = ''
        lastCheckedAt.value = new Date()
        try {
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
            const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null
            const response = await fetch(HEALTH_ENDPOINT, {
                method: 'GET',
                cache: 'no-store',
                signal: controller?.signal
            })
            if (timeout) clearTimeout(timeout)
            if (!response.ok) throw new Error(`伺服器尚未恢復（${response.status}）`)
            let payload = null
            try { payload = await response.json() } catch { payload = null }
            const ok = payload?.ok === true || String(payload?.message || '').toUpperCase() === 'OK'
            if (!ok) throw new Error(payload?.message || '服務尚未完全恢復')
            const target = consumeOfflineRedirect()
            retryAttempt = 0
            router.replace(target && target.startsWith('/') ? target : '/')
        } catch (err) {
            const aborted = err?.name === 'AbortError'
            lastError.value = aborted
                ? '等待伺服器回應逾時，稍後會自動重試。'
                : (err?.message || '無法連線到伺服器，稍後會自動重試。')
            scheduleNextCheck()
        } finally {
            checking.value = false
        }
    }

    const manualRetry = () => {
        stopCountdown()
        checkStatus()
    }

    const goHome = () => {
        clearApiOffline()
        router.replace('/')
    }

    const reportIssue = () => {
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'
        const subject = encodeURIComponent('Leader Online 離線通知')
        const body = encodeURIComponent(`我在 ${new Date().toLocaleString()} 無法連線到系統。\n\n瀏覽器：${ua}\n上次檢查時間：${lastCheckedText.value}\n`)
        window.open(`mailto:support@leaderonline.tw?subject=${subject}&body=${body}`, '_blank')
    }

    onMounted(() => {
        manualRetry()
    })

    onBeforeUnmount(() => {
        stopCountdown()
    })
</script>
