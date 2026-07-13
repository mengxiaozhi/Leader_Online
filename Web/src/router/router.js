import { createRouter, createWebHistory } from 'vue-router'

const routes = [
    { path: '/', redirect: '/store' },
    { name: '品牌故事', path: '/brand', component: () => import('../pages/brand.vue'), meta: { seo: { title: '品牌故事', description: 'Leader Online 專注自行車與鐵人賽事託運，以專業固定、節點通知與賽事協作，安心守護每一段路程。', image: '/brand/hero-transport.jpg', imageAlt: 'Leader Online 自行車與鐵人賽事託運服務', imageType: 'image/jpeg', imageWidth: 1586, imageHeight: 992, keywords: ['Leader Online', '自行車託運', '鐵人賽事託運', '單車運輸', '賽事運輸'] } } },
    { name: '登入', path: '/login', component: () => import('../pages/login.vue'), meta: { seo: { title: '登入', description: '登入 Leader Online，管理票券、預約單車託運服務並查看最新訂單狀態。', noindex: true } } },
    { name: '票券', path: '/wallet', component: () => import('../pages/wallet.vue'), meta: { requiresAuth: true, keepAlive: true, seo: { title: '我的票券', description: '查看已購買的單車託運票券、預約紀錄與票券使用狀態。', noindex: true } } },
    { name: '商店', path: '/store', component: () => import('../pages/store.vue'), meta: { keepAlive: true, seo: { title: '單車託運購票中心', description: '選購單車託運票券、查看服務檔期與交車點資訊，並同步雲端購物車完成預約。', keywords: ['單車託運', '自行車託運', '貨車預約', '票券購買', '交車點'] } } },
    { name: '帳戶', path: '/account', component: () => import('../pages/account.vue'), meta: { requiresAuth: true, keepAlive: true, seo: { title: '帳戶設定', description: '更新個人資料、變更密碼並管理 Leader Online 的登入方式。', noindex: true } } },
    { name: '重設密碼', path: '/reset', component: () => import('../pages/reset.vue'), meta: { seo: { title: '重設密碼', description: '透過電子郵件重設 Leader Online 帳號密碼，快速恢復使用權限。', noindex: true } } },
    { name: '後台', path: '/admin', component: () => import('../pages/admin.vue'), meta: { requiresAdmin: true, keepAlive: true, seo: { title: '後台管理', description: '管理票券庫存、訂單與服務檔期設定的後台介面。', noindex: true } } },
    { name: '預約服務', path: '/booking/:code', component: () => import('../pages/booking.vue'), meta: { keepAlive: true, seo: { title: '單車託運服務預約', description: '瀏覽服務檔期、交車點資訊與價格方案，使用票券折抵並完成預約手續。', keywords: ['單車託運預約', '交車點', '服務檔期', '票券折抵'] } } },
    { name: '使用者條款', path: '/terms', component: () => import('../pages/terms.vue'), meta: { seo: { title: '使用者條款', description: '閱讀 Leader Online 服務使用者條款與平台規範。', keywords: ['Leader Online 使用者條款', '單車託運平台規範'] } } },
    { name: '服務商條款', path: '/provider-terms', component: () => import('../pages/provider-terms.vue'), meta: { seo: { title: '服務商條款', description: '查看 Leader Online 各服務商提供的服務條款。', keywords: ['Leader Online 服務商條款', '單車託運服務條款'] } } },
    { name: '隱私權政策', path: '/privacy', component: () => import('../pages/privacy.vue'), meta: { seo: { title: '隱私權政策', description: '了解 Leader Online 如何蒐集、使用與保護個人資料。', keywords: ['Leader Online 隱私權政策', '個人資料保護'] } } },
    { name: '預約購買須知', path: '/reservation-notice', component: () => import('../pages/reservation-notice.vue'), meta: { seo: { title: '預約購買須知', description: '了解 Leader Online 單車託運預約購買須知與流程注意事項。', keywords: ['單車託運購買須知', '預約流程'] } } },
    { name: '預約使用規定', path: '/reservation-rules', component: () => import('../pages/reservation-rules.vue'), meta: { seo: { title: '預約使用規定', description: '閱讀 Leader Online 單車託運預約使用規定與重要提醒。', keywords: ['單車託運使用規定', '預約規範'] } } },
    { name: 'NotFound', path: '/404', component: () => import('../pages/404.vue'), meta: { seo: { title: '找不到頁面', description: '找不到對應的頁面，請返回首頁或重新搜尋。', noindex: true } } },
    { name: 'Offline', path: '/offline', component: () => import('../pages/offline.vue'), meta: { seo: { title: '伺服器離線', description: '伺服器離線', noindex: true } } },
    { path: '/:pathMatch(.*)*', redirect: '/404' }
]

const router = createRouter({
    scrollBehavior(to) {
        if (to.hash) {
            return { el: to.hash, top: 80, behavior: 'smooth' }
        }
        return { top: 0 }
    },
    history: createWebHistory(),
    routes
})

// 全域路由守衛：限制後台（ADMIN/SERVICE_PROVIDER/DRIVER/DELIVERY_POINT/STORE/EDITOR）；指定頁需要登入
router.beforeEach((to) => {
    let user = null
    try { user = JSON.parse(localStorage.getItem('user_info') || 'null') } catch { localStorage.removeItem('user_info') }
    if (to.meta?.requiresAdmin || to.path.startsWith('/admin')) {
        if (!user) return { path: '/login', query: { redirect: to.fullPath } }
        const r = String(user.role || '').toUpperCase()
        const allowed = ['ADMIN','SERVICE_PROVIDER','DRIVER','DELIVERY_POINT','STORE','EDITOR']
        if (!allowed.includes(r)) {
            // Defer UI notice to page components via global sheet if needed
            return { path: '/' }
        }
    }
    if (to.meta?.requiresAuth) {
        if (!user) return { path: '/login', query: { redirect: to.fullPath } }
    }
})

export default router
