<template>
    <main class="pt-6 pb-12 px-4">
        <div class="max-w-5xl mx-auto">
            <h1 class="text-2xl font-bold text-[#D90000] mb-6 text-center">我的訂單</h1>

            <div v-if="orders.length > 0" class="space-y-4">
                <div v-for="order in orders" :key="order.id"
                    class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition">
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
    import { ref } from 'vue'

    const orders = ref([
        {
            id: 'ORD-001',
            ticketType: '小鐵人',
            quantity: 2,
            total: 600,
            createdAt: '2025-07-21 14:22',
            status: '已完成'
        },
        {
            id: 'ORD-002',
            ticketType: '滑步車',
            quantity: 1,
            total: 200,
            createdAt: '2025-07-22 09:45',
            status: '處理中'
        }
    ])
</script>
