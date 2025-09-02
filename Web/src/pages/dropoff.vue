<template>
    <main class="pt-6 pb-12 px-4">
        <div class="max-w-2xl mx-auto">
            <h1 class="text-2xl font-bold text-primary mb-6 text-center">放車檢查與提交</h1>

            <!-- 檢核表 -->
            <div class="space-y-2 mb-6">
                <h2 class="text-lg font-semibold text-gray-800">放車檢查項目</h2>
                <label v-for="(item, index) in checklist" :key="index"
                    class="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" v-model="item.checked" />
                    {{ item.label }}
                </label>
            </div>

            <!-- 拍照上傳 -->
            <div class="mb-6">
                <label class="block text-sm font-medium text-gray-700 mb-1">上傳車輛照片（最多 3 張）</label>
                <div class="text-xs text-gray-500 mb-2">建議橫向清晰照片，單張 10MB 以內</div>
                <input type="file" accept="image/*" multiple @change="handleUpload" class="text-sm" />
                <div class="mt-2 grid grid-cols-3 gap-2">
                    <img v-for="(img, i) in imagePreviews" :key="i" :src="img"
                        class="h-24 w-full object-cover border" />
                </div>
            </div>

            <!-- 提交放車 -->
            <button @click="completeDropOff"
                class="w-full py-2 btn btn-primary text-white transition"
                :disabled="!canSubmit">
                完成放車，產生取車驗證碼
            </button>

            <!-- 顯示驗證碼 -->
            <div v-if="verifyCode" class="mt-6 text-center">
                <p class="text-gray-700 text-sm">✅ 放車完成，請保存以下驗證碼</p>
                <div class="flex items-center justify-center gap-2 mt-2">
                    <p class="text-2xl font-bold text-primary tracking-widest">{{ verifyCode }}</p>
                    <button class="btn-ghost" title="複製" @click="copyText(verifyCode)"><AppIcon name="copy" class="h-5 w-5" /></button>
                </div>
                <qrcode-vue :value="verifyCode" :size="160" class="mt-4 mx-auto" />
            </div>
        </div>
    </main>
</template>

<script setup>
    import { ref, computed } from 'vue'
    import QrcodeVue from 'qrcode.vue'
    import axios from 'axios'
    import { useRoute } from 'vue-router'
    import AppIcon from '../components/AppIcon.vue'

    const API = 'http://localhost:3000/api'
    const route = useRoute()
    const reservationId = route.query.id

    const checklist = ref([
        { label: '車體無明顯損壞', checked: false },
        { label: '輪胎充氣正常', checked: false },
        { label: '煞車正常作動', checked: false },
        { label: '外觀無刮痕', checked: false },
    ])

    const images = ref([])
    const imagePreviews = ref([])
    const verifyCode = ref('')

    const canSubmit = computed(() => {
        return checklist.value.every(i => i.checked) && imagePreviews.value.length > 0
    })

    const handleUpload = (e) => {
        const files = Array.from(e.target.files).slice(0, 3)
        imagePreviews.value = []
        images.value = []

        files.forEach(file => {
            const reader = new FileReader()
            reader.onload = (e) => {
                imagePreviews.value.push(e.target.result)
                images.value.push(file)
            }
            reader.readAsDataURL(file)
        })
    }

    const completeDropOff = async () => {
        if (!canSubmit.value) {
            alert('請完成所有檢查項目並上傳車輛照片')
            return
        }
        try {
            const { data } = await axios.post(`${API}/dropoff`, { reservationId })
            verifyCode.value = data.verifyCode
            alert('✅ 放車成功，請妥善保存驗證碼')
        } catch (err) {
            console.error(err)
        }
    }

    const copyText = (t) => { try { if (t) navigator.clipboard?.writeText(String(t)) } catch {} }
</script>
