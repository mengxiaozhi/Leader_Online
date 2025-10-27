<template>
    <main class="min-h-screen flex items-center justify-center bg-gray-50 px-4 text-center">
        <div class="w-full max-w-md">
            <div class="bg-white p-8 border border-gray-200 shadow-lg">
                <div class="mx-auto h-12 w-12 text-primary">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round"
                            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                </div>
                <h1 class="mt-4 text-2xl font-bold text-gray-900">404｜沒有找到對應的分頁</h1>
                <div class="mt-6">
                    <button @click="retry" class="w-full btn btn-primary text-white py-2.5">
                        去商店看看
                    </button>
                </div>
            </div>
        </div>
    </main>
</template>

<script setup>
    import { useRouter } from 'vue-router';

    const router = useRouter();

    const retry = () => {
        router.replace('/store');
    };
</script>

<style scoped>
    button {
        border-radius: 0 !important;
    }
</style>