<template>
    <main class="pt-6 pb-12 px-4">
        <div class="max-w-2xl mx-auto">
            <h1 class="text-2xl font-bold text-[#D90000] mb-6 text-center">放車檢查與提交</h1>

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
                <input type="file" accept="image/*" multiple @change="handleUpload" />
                <div class="mt-2 grid grid-cols-3 gap-2">
                    <img v-for="(img, i) in imagePreviews" :key="i" :src="img"
                        class="h-24 w-full object-cover rounded-md border" />
                </div>
            </div>

            <!-- 提交放車 -->
            <button @click="completeDropOff"
                class="w-full py-2 bg-[#D90000] text-white rounded-md hover:bg-[#B00000] transition"
                :disabled="!canSubmit">
                完成放車，產生取車驗證碼
            </button>

            <!-- 顯示驗證碼 -->
            <div v-if="verifyCode" class="mt-6 text-center">
                <p class="text-gray-700 text-sm">✅ 放車完成，請保存以下驗證碼</p>
                <p class="text-2xl font-bold text-[#D90000] tracking-widest mt-2">{{ verifyCode }}</p>
                <qrcode-vue :value="verifyCode" :size="160" class="mt-4 mx-auto" />
            </div>
        </div>
    </main>
</template>

<script setup>
    import { ref, computed } from 'vue'
    import QrcodeVue from 'qrcode.vue'

    const checklist = ref([
        { label: '車體無明顯損壞', checked: false },
        { label: '輪胎充氣正常', checked: false },
        { label: '煞車正常作動', checked: false },
        { label: '外觀無刮痕', checked: false },
    ])

    const images = ref([])
    const imagePreviews = ref([])
    const verifyCode = ref('')

    // 是否可以送出（所有勾選 && 至少一張圖）
    const canSubmit = computed(() => {
        return checklist.value.every(i => i.checked) && imagePreviews.value.length > 0
    })

    // 圖片處理
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

    // 模擬完成放車，產生驗證碼
    const completeDropOff = () => {
        if (!canSubmit.value) {
            alert('請完成所有檢查項目並上傳車輛照片')
            return
        }

        verifyCode.value = Math.random().toString().slice(2, 8)

        // 這裡你可以改為呼叫 API，例如：
        // await axios.post('/api/dropoff', { checklist, images, verifyCode })

        alert('✅ 放車成功，請妥善保存驗證碼')
    }
</script>
