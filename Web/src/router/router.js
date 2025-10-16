import { createRouter, createWebHistory } from 'vue-router'

const routes = [
    { path: '/', redirect: '/store' },
    { name: '登入', path: '/login', component: () => import('../pages/login.vue'), meta: { seo: { title: '登入', description: '登入 Leader Online，管理票券、預約賽事並查看最新訂單狀態。' } } },
    { name: '票券', path: '/wallet', component: () => import('../pages/wallet.vue'), meta: { requiresAuth: true, seo: { title: '我的票券', description: '查看已購買的鐵人競賽票券、預約紀錄與票券使用狀態。' } } },
    { name: '商店', path: '/store', component: () => import('../pages/store.vue'), meta: { seo: { title: '鐵人競賽購票中心', description: '選購鐵人競賽票券、同步雲端購物車並輕鬆完成賽事預約。' } } },
    { name: '帳戶', path: '/account', component: () => import('../pages/account.vue'), meta: { requiresAuth: true, seo: { title: '帳戶設定', description: '更新個人資料、變更密碼並管理 Leader Online 的登入方式。' } } },
    { name: '重設密碼', path: '/reset', component: () => import('../pages/reset.vue'), meta: { seo: { title: '重設密碼', description: '透過電子郵件重設 Leader Online 帳號密碼，快速恢復使用權限。' } } },
    { name: '後台', path: '/admin', component: () => import('../pages/admin.vue'), meta: { requiresAdmin: true, seo: { title: '後台管理', description: '管理票券庫存、訂單與賽事設定的後台介面。', noindex: true } } },
    { name: '訂單', path: '/order', component: () => import('../pages/order.vue'), meta: { seo: { title: '訂單查詢', description: '查詢鐵人競賽票券與預約訂單的付款與匯款狀態。' } } },
    { name: '預約場次', path: '/booking/:code', component: () => import('../pages/booking.vue'), meta: { seo: { title: '預約場次', description: '瀏覽賽事門市方案、使用票券折抵並完成預約手續。' } } },
    { name: '放車', path: '/dropoff', component: () => import('../pages/dropoff.vue'), meta: { seo: { title: '賽前放車資訊', description: '了解賽前放車流程、時程與注意事項，準備參賽無負擔。' } } },
    { name: '取車', path: '/pickup', component: () => import('../pages/pickup.vue'), meta: { seo: { title: '賽後取車資訊', description: '掌握賽後取車流程與注意事項，輕鬆完成賽事後續。' } } },
    { name: '使用者條款', path: '/terms', component: () => import('../pages/terms.vue'), meta: { seo: { title: '使用者條款', description: '閱讀 Leader Online 服務使用者條款與平台規範。' } } },
    { name: '隱私權政策', path: '/privacy', component: () => import('../pages/privacy.vue'), meta: { seo: { title: '隱私權政策', description: '了解 Leader Online 如何蒐集、使用與保護個人資料。' } } },
    { name: '預約購買須知', path: '/reservation-notice', component: () => import('../pages/reservation-notice.vue'), meta: { seo: { title: '預約購買須知', description: '了解 Leader Online 預約購買須知與流程注意事項。' } } },
    { name: '預約使用規定', path: '/reservation-rules', component: () => import('../pages/reservation-rules.vue'), meta: { seo: { title: '預約使用規定', description: '閱讀 Leader Online 預約使用規定與重要提醒。' } } },
    { name: 'NotFound', path: '/404', component: () => import('../pages/404.vue'), meta: { seo: { title: '找不到頁面', description: '找不到對應的頁面，請返回首頁或重新搜尋。', noindex: true } } },
    { path: '/:pathMatch(.*)*', redirect: '/404' }
]

const router = createRouter({
    scrollBehavior() {
        return { top: 0 }
    },
    history: createWebHistory(),
    routes
})

// 全域路由守衛：限制後台（ADMIN/STORE）；指定頁需要登入
router.beforeEach((to) => {
    const user = JSON.parse(localStorage.getItem('user_info') || 'null')
    if (to.meta?.requiresAdmin || to.path.startsWith('/admin')) {
        if (!user) return { path: '/login', query: { redirect: to.fullPath } }
        const r = String(user.role || '').toUpperCase()
        if (r !== 'ADMIN' && r !== 'STORE') {
            // Defer UI notice to page components via global sheet if needed
            return { path: '/' }
        }
    }
    if (to.meta?.requiresAuth) {
        if (!user) return { path: '/login', query: { redirect: to.fullPath } }
    }
})

export default router
