// Shared by the browser, static HTML generation and sitemap. Only public URLs belong here.
export const publicPages = Object.freeze({
  '/brand': {
    title: '自行車與鐵人賽事託運・運動課程',
    description: '認識 Leader Online 自行車與鐵人賽事託運服務，了解交車、運送與取車流程，探索運動課程、團練預約及數位會員卡。',
    image: '/brand/hero-transport.jpg', imageAlt: 'Leader Online 自行車託運與運動課程服務',
    imageType: 'image/jpeg', imageWidth: 1586, imageHeight: 992, pageType: 'AboutPage',
    component: 'brand', label: '品牌與服務',
  },
  '/store': {
    title: '單車託運票券・賽事託運預約',
    description: '選購 Leader Online 單車託運票券，查看賽事服務檔期、交車點與價格方案，完成自行車託運預約並掌握交取車時間。',
    component: 'store', label: '託運購票與預約', pageType: 'CollectionPage',
  },
  '/courses/passes': {
    title: '運動課程計次方案',
    description: '瀏覽 Leader Online 運動課程計次方案，查看適用課程、使用次數與效期，依訓練需求選購並預約開放場次。',
    component: 'store', courseTask: 'passes', label: '課程計次方案', pageType: 'CollectionPage',
  },
  '/courses/classes': {
    title: '固定班課程與班期報名',
    description: '瀏覽 Leader Online 固定班課程，查看班期、上課時間、程度與報名名額，選擇適合自己的運動訓練課程。',
    component: 'store', courseTask: 'classes', label: '固定班課程', pageType: 'CollectionPage',
  },
  '/courses/sessions': {
    title: '運動課程場次與團練預約',
    description: '查看 Leader Online 開放課程與團練場次，依教練、上課時間及地點選擇訓練，使用適用計次票完成預約。',
    component: 'store', courseTask: 'sessions', label: '課程場次', pageType: 'CollectionPage',
  },
  '/terms': { title: '使用者條款', description: '閱讀 Leader Online 服務使用者條款與平台規範。', component: 'terms', label: '使用者條款' },
  '/provider-terms': { title: '服務商條款', description: '查看 Leader Online 各服務商提供的服務條款。', component: 'provider-terms', label: '服務商條款' },
  '/privacy': { title: '隱私權政策', description: '了解 Leader Online 如何蒐集、使用與保護個人資料。', component: 'privacy', label: '隱私權政策' },
  '/reservation-notice': { title: '預約購買須知', description: '了解 Leader Online 單車託運預約購買須知與流程注意事項。', component: 'reservation-notice', label: '預約購買須知' },
  '/reservation-rules': { title: '預約使用規定', description: '閱讀 Leader Online 單車託運預約使用規定與重要提醒。', component: 'reservation-rules', label: '預約使用規定' },
})

export function isPrivatePath(path) {
  return /^\/(?:admin|coach|account|wallet|login|reset|register|me|offline|404)(?:\/|$)/.test(path)
    || /^\/courses\/me(?:\/|$)/.test(path)
    || /^\/courses\/classes\/[^/]+\/checkout\/?$/.test(path)
}
