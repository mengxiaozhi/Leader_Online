import { createRouter, createWebHistory } from 'vue-router'

const routes = [
    { path: '/', redirect: '/store' },
    { name: '登入', path: '/login', component: () => import('../pages/login.vue') },
    { name: '票券', path: '/wallet', component: () => import('../pages/wallet.vue') },
    { name: '商店', path: '/store', component: () => import('../pages/store.vue') },
    { name: '後台', path: '/admin', component: () => import('../pages/admin.vue') },
    { name: '訂單', path: '/order', component: () => import('../pages/order.vue') },
    { name: 'booking-detail', path: '/booking/:id', component: () => import('../pages/booking.vue') },
    { name: '放車', path: '/dropoff', component: () => import('../pages/dropoff.vue') },
    { name: '取車', path: '/pickup', component: () => import('../pages/pickup.vue') },
    { name: 'NotFound', path: '/404', component: () => import('../pages/404.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/404' }
]

const router = createRouter({
    scrollBehavior() {
        return { top: 0 }
    },
    history: createWebHistory(),
    routes
})

export default router
