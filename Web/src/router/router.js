import { createRouter, createWebHistory } from 'vue-router'
import axios from '../api/axios'
import { API_BASE } from '../utils/api'
import {
    classifyCourseStaffAccessError,
    COURSE_V2_ENDPOINTS,
    normalizeCourseStaffAccess,
} from '../utils/courseV2'
import { clearAuthSession, setUserProfile } from '../utils/authSession'
import { resolveWalletRecordLocation } from '../utils/userRecordCategories.js'

const resolveLegacyCourseAccountRedirect = (to) => {
    const requestedTab = typeof to.query.tab === 'string' ? to.query.tab.trim().toLowerCase() : ''
    if (requestedTab === 'orders') {
        return { path: '/store', query: { tab: 'courses', orders: '1', category: 'course' } }
    }

    const walletLocation = requestedTab === 'bookings' || requestedTab === 'reservations'
        ? resolveWalletRecordLocation('reservations', 'course')
        : resolveWalletRecordLocation('courses', 'course')
    return {
        path: '/wallet',
        query: {
            tab: walletLocation.tab,
            ...(walletLocation.category ? { category: walletLocation.category } : {}),
        },
    }
}

const publicCourseSurface = task => ({
    component: () => import('../pages/courses.vue'),
    props: { initialTask: task },
    meta: { keepAlive: true, seo: { title: task === 'classes' ? '固定班課程' : task === 'sessions' ? '課程場次' : '課程計次方案', description: '瀏覽 Leader Online 課程、固定班與開放場次。' } },
})

const memberCourseSurface = task => ({
    component: () => import('../pages/course-account.vue'),
    props: { productizedTask: task },
    meta: { requiresAuth: true, keepAlive: true, seo: { title: '我的課程中心', description: '管理課表、固定班、請假補課、續報與課程訂單。', noindex: true } },
})

const adminCourseSurface = task => ({
    component: () => import('../pages/course-admin.vue'),
    props: { productizedTask: task },
    meta: { requiresAdmin: true, keepAlive: true, courseStaffSurface: true, seo: { title: '課程管理中心', description: '管理課程商品、固定班、課務、學員與報表。', noindex: true } },
})

const routes = [
    { path: '/', redirect: '/store' },
    { name: '品牌故事', path: '/brand', component: () => import('../pages/brand.vue'), meta: { seo: { title: '品牌與服務', description: 'Leader Online 整合自行車與鐵人賽事託運、運動課程選購、團練預約、計次票、Google Wallet 會員卡與到場核銷，陪你完成每一次訓練與出賽。', image: '/brand/hero-transport.jpg', imageAlt: 'Leader Online 自行車託運與運動課程服務', imageType: 'image/jpeg', imageWidth: 1586, imageHeight: 992, keywords: ['Leader Online', '自行車託運', '鐵人賽事託運', '運動課程', '團練預約', '課程計次票', 'Google Wallet 會員卡'] } } },
    { name: '登入', path: '/login', component: () => import('../pages/login.vue'), meta: { seo: { title: '登入', description: '登入 Leader Online，管理票券、預約單車託運服務並查看最新訂單狀態。', noindex: true } } },
    { name: '票券', path: '/wallet', component: () => import('../pages/wallet.vue'), meta: { requiresAuth: true, keepAlive: true, seo: { title: '我的票券', description: '查看已購買的單車託運票券、預約紀錄與票券使用狀態。', noindex: true } } },
    { name: '商店', path: '/store', component: () => import('../pages/store.vue'), meta: { keepAlive: true, seo: { title: '購票與課程中心', description: '選購單車託運票券與 LEADER 運動課程，查看服務檔期、課程場次並完成預約。', keywords: ['單車託運', '自行車託運', '票券購買', 'LEADER 課程', '課程預約'] } } },
    { path: '/courses', redirect: to => ({ path: to.query.tab === 'sessions' || to.query.courseView === 'sessions' ? '/courses/sessions' : '/courses/passes', query: { ...to.query } }) },
    { name: '課程計次方案', path: '/courses/passes', ...publicCourseSurface('passes') },
    { name: '固定班課程', path: '/courses/classes', ...publicCourseSurface('classes') },
    { name: '固定班結帳', path: '/courses/classes/:id/checkout', component: () => import('../pages/course-term.vue'), props: { checkoutMode: true }, meta: { requiresAuth: true, seo: { title: '固定班報名結帳', description: '檢查固定班資格、鎖定報價並完成付款。', noindex: true } } },
    { name: '固定班詳情', path: '/courses/classes/:id', component: () => import('../pages/course-term.vue'), props: { checkoutMode: false }, meta: { seo: { title: '固定班詳情', description: '查看固定班班期、程度、堂次、報名與候補資訊。' } } },
    { name: '課程開放場次', path: '/courses/sessions', ...publicCourseSurface('sessions') },
    { path: '/courses/me', redirect: resolveLegacyCourseAccountRedirect },
    { name: '我的課表', path: '/courses/me/schedule', ...memberCourseSurface('schedule') },
    { name: '我的課程計次票', path: '/courses/me/passes', ...memberCourseSurface('passes') },
    { name: '我的固定班', path: '/courses/me/enrollments', ...memberCourseSurface('enrollments') },
    { name: '我的請假補課', path: '/courses/me/makeup', ...memberCourseSurface('makeup') },
    { name: '我的續報', path: '/courses/me/renewals', ...memberCourseSurface('renewals') },
    { name: '我的課程訂單', path: '/courses/me/orders', ...memberCourseSurface('orders') },
    { name: '我的課程通知', path: '/courses/me/notifications', ...memberCourseSurface('notifications') },
    { path: '/me/courses', redirect: '/courses/me/schedule' },
    { path: '/me/courses/schedule', redirect: '/courses/me/schedule' },
    { path: '/me/courses/passes', redirect: '/courses/me/passes' },
    { path: '/me/courses/enrollments', redirect: '/courses/me/enrollments' },
    { path: '/me/courses/makeup', redirect: '/courses/me/makeup' },
    { path: '/me/courses/renewals', redirect: '/courses/me/renewals' },
    { path: '/me/courses/orders', redirect: '/courses/me/orders' },
    { path: '/me/courses/notifications', redirect: '/courses/me/notifications' },
    { name: '帳戶', path: '/account', component: () => import('../pages/account.vue'), meta: { requiresAuth: true, keepAlive: true, seo: { title: '帳戶設定', description: '更新個人資料、變更密碼並管理 Leader Online 的登入方式。', noindex: true } } },
    { name: '重設密碼', path: '/reset', component: () => import('../pages/reset.vue'), meta: { seo: { title: '重設密碼', description: '透過電子郵件重設 Leader Online 帳號密碼，快速恢復使用權限。', noindex: true } } },
    { name: '完成註冊', path: '/register/complete', component: () => import('../pages/register-complete.vue'), meta: { seo: { title: '完成帳號註冊', description: '驗證電子信箱並設定 Leader Online 帳號密碼。', noindex: true } } },
    { name: '後台', path: '/admin', component: () => import('../pages/admin.vue'), meta: { requiresAdmin: true, keepAlive: true, seo: { title: '後台管理', description: '管理票券庫存、訂單與服務檔期設定的後台介面。', noindex: true } } },
    { path: '/admin/courses', redirect: '/admin/courses/catalog' },
    { name: '課程商品目錄', path: '/admin/courses/catalog', ...adminCourseSurface('catalog') },
    { name: '課程核銷情境', path: '/admin/courses/redeem-contexts', ...adminCourseSurface('redeem-contexts') },
    { name: '固定班管理', path: '/admin/courses/classes', ...adminCourseSurface('classes') },
    { name: '課程排程管理', path: '/admin/courses/schedule', ...adminCourseSurface('schedule') },
    { name: '課務作業中心', path: '/admin/courses/operations', ...adminCourseSurface('operations') },
    { name: '課程報名管理', path: '/admin/courses/enrollments', ...adminCourseSurface('enrollments') },
    { name: '課程學員管理', path: '/admin/courses/students', ...adminCourseSurface('students') },
    { name: '課程報表', path: '/admin/courses/reports', ...adminCourseSurface('reports') },
    { name: '課程設定', path: '/admin/courses/settings', ...adminCourseSurface('settings') },
    { name: '教練課程場次', path: '/coach/courses/sessions/:sessionId', component: () => import('../pages/course-admin.vue'), props: route => ({ productizedTask: 'coach-session', coachSessionId: route.params.sessionId }), meta: { requiresAdmin: true, courseStaffSurface: true, seo: { title: '教練場次名冊', noindex: true } } },
    { name: '教練課程報到', path: '/coach/courses/sessions/:sessionId/check-in', component: () => import('../pages/course-admin.vue'), props: route => ({ productizedTask: 'coach-check-in', coachSessionId: route.params.sessionId }), meta: { requiresAdmin: true, courseStaffSurface: true, seo: { title: '課程報到', noindex: true } } },
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
            const hashParams = new URLSearchParams(String(to.hash).replace(/^#/, ''))
            if (hashParams.has('token') || hashParams.has('reset_token')) return { top: 0 }
            const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
            return { el: to.hash, top: 80, behavior: reduceMotion ? 'auto' : 'smooth' }
        }
        return { top: 0 }
    },
    history: createWebHistory(),
    routes
})

const loadCurrentUserForGuard = async () => {
    try {
        const { data } = await axios.get(`${API_BASE}/whoami`)
        const user = data?.ok && data?.data && typeof data.data === 'object'
            ? data.data
            : null
        if (!user) return { state: 'unavailable', user: null }
        setUserProfile(user)
        return { state: 'ready', user }
    } catch (error) {
        const state = classifyCourseStaffAccessError(error)
        if (state === 'unauthorized') clearAuthSession()
        return { state, user: null }
    }
}

const loadCourseStaffAccessForGuard = async (platformRole = '') => {
    try {
        const { data } = await axios.get(`${API_BASE}${COURSE_V2_ENDPOINTS.staffMe}`)
        return {
            state: 'ready',
            access: normalizeCourseStaffAccess(data, { platformRole }),
        }
    } catch (error) {
        const state = classifyCourseStaffAccessError(error)
        if (state === 'unauthorized') clearAuthSession()
        return {
            state,
            access: normalizeCourseStaffAccess(),
        }
    }
}

// 全域路由守衛：平台角色維持既有範圍；tenant staff 僅能依伺服器 capability
// 進入課程管理或掃碼入口，不把平台 COACH 視為 SERVICE_PROVIDER。
router.beforeEach(async (to) => {
    let user = null
    try { user = JSON.parse(localStorage.getItem('user_info') || 'null') } catch { localStorage.removeItem('user_info') }
    if (to.meta?.requiresAdmin || to.path.startsWith('/admin') || to.meta?.courseStaffSurface) {
        const requestedTab = String(to.query?.tab || '').trim().toLowerCase()
        const requestedCourseSurface = Boolean(to.meta?.courseStaffSurface) || to.path.startsWith('/admin/courses') || to.path.startsWith('/coach/courses') || requestedTab === 'courses' || requestedTab === 'scan'
        if (requestedCourseSurface) {
            const session = await loadCurrentUserForGuard()
            if (session.state === 'unauthorized') {
                return { path: '/login', query: { redirect: to.fullPath } }
            }
            if (session.state === 'ready') user = session.user
        }
        if (!user) return { path: '/login', query: { redirect: to.fullPath } }
        const r = String(user.role || '').toUpperCase()
        const platformAllowed = ['ADMIN','SERVICE_PROVIDER','DRIVER','DELIVERY_POINT','STORE','EDITOR']
        const generalScannerRole = ['ADMIN','SERVICE_PROVIDER','DRIVER','DELIVERY_POINT','STORE','EDITOR'].includes(r)
        if (requestedCourseSurface || !platformAllowed.includes(r)) {
            const result = await loadCourseStaffAccessForGuard(r)
            if (result.state === 'unauthorized') {
                return { path: '/login', query: { redirect: to.fullPath } }
            }
            const access = result.access
            const canManageCourses = result.state === 'ready' && access.hasCourseAccess
            const canScanCourse = result.state === 'ready' && Boolean(access.capabilities.manageAttendance)
            if (to.meta?.courseStaffSurface) {
                return canManageCourses ? undefined : { path: '/' }
            }
            // Course capability errors are rendered by admin.vue. Keep the
            // route fail-closed without silently sending authenticated staff
            // back to the storefront.
            if (requestedTab === 'courses') return undefined
            if (requestedTab === 'scan' && !canScanCourse && !generalScannerRole) return { path: '/' }
            if (!requestedTab && !platformAllowed.includes(r)) {
                if (canManageCourses) {
                    return {
                        path: '/admin',
                        query: { ...to.query, tab: canScanCourse && !access.capabilities.manageCatalog ? 'scan' : 'courses' },
                    }
                }
                return { path: '/' }
            }
        } else if (!platformAllowed.includes(r)) {
            return { path: '/' }
        }
    }
    if (to.meta?.requiresAuth) {
        if (!user) return { path: '/login', query: { redirect: to.fullPath } }
    }
})

export default router
