<template>
    <main class="pt-6 pb-12 px-4 pt-safe pb-safe">
        <div class="max-w-5xl mx-auto">
            <h1 class="text-2xl font-bold text-primary mb-6 text-center">票券訂單</h1>

            <div v-if="orders.length > 0" class="space-y-4">
                <div v-for="order in orders" :key="order.id"
                    class="bg-white border border-gray-200 p-5 shadow-sm hover:shadow-md transition">
                    <div class="flex flex-col space-y-2">
                        <p class="text-sm text-gray-600">
                            <span class="font-medium">訂單編號：</span>{{ order.id }}
                        </p>
                        <p class="text-sm text-gray-600">
                            <span class="font-medium">票券種類：</span>{{ order.ticketType }}
                        </p>
                        <p class="text-sm text-gray-600">
                            <span class="font-medium">數量：</span>{{ order.quantity }}
                        </p>
                        <p class="text-sm text-gray-600">
                            <span class="font-medium">總金額：</span>NT$ {{ order.total }}
                        </p>
                        <p class="text-sm text-gray-600">
                            <span class="font-medium">建立時間：</span>{{ order.createdAt }}
                        </p>
                        <p class="text-sm text-gray-600">
                            <span class="font-medium">狀態：</span>
                            <span :class="order.status === '已完成' ? 'text-green-600' : 'text-yellow-600'">
                                {{ order.status }}
                            </span>
                        </p>
                    </div>
                </div>
            </div>

            <p v-else class="text-center text-gray-500">尚無訂單紀錄</p>
        </div>
    </main>
</template>

<script setup>
    import { ref, onMounted } from 'vue'
    import axios from 'axios'
    import { formatDateTime } from '../utils/datetime'

    const orders = ref([])

    onMounted(async () => {
        const user = JSON.parse(localStorage.getItem('user'))
        if (!user) return
        try {
            const { data } = await axios.get(`http://localhost:3000/api/orders/${user.id}`)
            orders.value = data.map(o => {
                let details = {}
                try { details = JSON.parse(o.details) } catch {}
                return {
                    id: o.id,
                    ticketType: details.ticketType || '',
                    quantity: details.quantity || 0,
                    total: details.total || 0,
                    createdAt: formatDateTime(o.created_at, { fallback: o.created_at || '' }),
                    status: details.status || ''
                }
            })
        } catch (err) {
            console.error(err)
        }
    })
</script>
