<template>
    <main class="pt-6 pb-12 px-4">
        <div class="max-w-md mx-auto">
            <h1 class="text-2xl font-bold text-[#D90000] mb-6 text-center">取車驗證</h1>

            <label class="block text-sm font-medium text-gray-700 mb-2">輸入驗證碼</label>
            <input type="text" v-model="inputCode" placeholder="請輸入 6 碼驗證碼"
                class="w-full border border-gray-300 rounded-md px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-[#D90000]" />

            <button @click="verify" class="w-full py-2 bg-[#D90000] text-white rounded-md hover:bg-[#B00000]">
                驗證取車
            </button>

            <div v-if="verified" class="mt-6 text-center text-green-600 font-semibold">
                ✅ 驗證成功，完成取車！
            </div>
        </div>
    </main>
</template>

<script setup>
    import { ref } from 'vue'
    import axios from 'axios'

    const API = 'http://localhost:3000/api'

    const inputCode = ref('')
    const verified = ref(false)

    const verify = async () => {
        try {
            await axios.post(`${API}/pickup`, { verifyCode: inputCode.value })
            verified.value = true
        } catch (err) {
            alert('驗證碼錯誤')
        }
    }
</script>
