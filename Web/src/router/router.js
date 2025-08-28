import { createRouter, createWebHistory } from 'vue-router'

const routes = [
    { path: '/', redirect: '/store' },
    { name: '登入', path: '/login', component: () => import('../pages/login.vue') },
    { name: '票券', path: '/wallet', component: () => import('../pages/wallet.vue'), meta: { requiresAuth: true } },
    { name: '商店', path: '/store', component: () => import('../pages/store.vue') },
    { name: '後台', path: '/admin', component: () => import('../pages/admin.vue'), meta: { requiresAdmin: true } },
    { name: '訂單', path: '/order', component: () => import('../pages/order.vue') },
    { name: '預約場次', path: '/booking/:id', component: () => import('../pages/booking.vue') },
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

// 全域路由守衛：限制後台僅限管理員；指定頁需要登入
router.beforeEach((to) => {
    const user = JSON.parse(localStorage.getItem('user_info') || 'null')
    if (to.meta?.requiresAdmin || to.path.startsWith('/admin')) {
        if (!user) return { path: '/login', query: { redirect: to.fullPath } }
        if (user.role !== 'admin') { if (typeof window !== 'undefined') alert('需要管理員權限'); return { path: '/' } }
    }
    if (to.meta?.requiresAuth) {
        if (!user) return { path: '/login', query: { redirect: to.fullPath } }
    }
})

export default router
