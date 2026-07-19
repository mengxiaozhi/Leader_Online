export const STAFF_ROLES = Object.freeze([
  'ADMIN',
  'SERVICE_PROVIDER',
  'DRIVER',
  'DELIVERY_POINT',
  'STORE',
  'COACH',
  'EDITOR',
])

const MAIN_ITEMS = Object.freeze([
  {
    id: 'brand',
    path: '/brand',
    label: '品牌',
    icon: 'info',
    activePaths: ['/brand'],
    guestMobile: true,
  },
  {
    id: 'wallet',
    path: '/wallet',
    label: '皮夾',
    icon: 'ticket',
    activePaths: ['/wallet'],
    requiresAuth: true,
    desktop: true,
    authedMobile: true,
  },
  {
    id: 'store',
    path: '/store',
    label: '商店',
    icon: 'store',
    activePaths: ['/store', '/booking', '/courses'],
    desktop: true,
    guestMobile: true,
    authedMobile: true,
  },
  {
    id: 'account',
    path: '/account',
    label: '帳戶',
    icon: 'user',
    activePaths: ['/account'],
    requiresAuth: true,
    desktop: true,
    authedMobile: true,
  },
  {
    id: 'admin',
    path: '/admin',
    label: '後台',
    icon: 'settings',
    activePaths: ['/admin'],
    roles: STAFF_ROLES,
    desktop: true,
    authedMobile: true,
  },
  {
    id: 'login',
    path: '/login',
    label: '登入',
    icon: 'user',
    activePaths: ['/login', '/reset'],
    guestMobile: true,
  },
])

export const BRAND_NAV_ITEMS = Object.freeze([
  { id: 'brand-story', path: '/brand#story', label: '品牌故事', activePaths: ['/brand#story'] },
  { id: 'brand-features', path: '/brand#features', label: '服務特色', activePaths: ['/brand#features'] },
  { id: 'brand-courses', path: '/brand#courses', label: '課程服務', activePaths: ['/brand#courses'] },
  { id: 'brand-process', path: '/brand#process', label: '安心流程', activePaths: ['/brand#process'] },
])

const HIDDEN_BOTTOM_NAV_PREFIXES = Object.freeze(['/brand', '/booking', '/reset', '/offline', '/404'])

const normalizeRole = (user) => String(user?.role || '').trim().toUpperCase()

const pathMatchesPrefix = (currentPath, prefix) => {
  if (!prefix) return false
  const [prefixPath, prefixHash = ''] = String(prefix).split('#')
  const [path, hash = ''] = String(currentPath || '/').split('#')
  if (prefixHash && hash !== prefixHash) return false
  return path === prefixPath || path.startsWith(`${prefixPath}/`)
}

export const isNavigationItemActive = (currentPath, item) => {
  return (item?.activePaths || [item?.path]).some((prefix) => pathMatchesPrefix(currentPath, prefix))
}

export const itemsForUser = (user, { surface = 'desktop', brandPage = false } = {}) => {
  if (surface === 'desktop' && brandPage) return BRAND_NAV_ITEMS

  const authed = Boolean(user)
  const role = normalizeRole(user)
  return MAIN_ITEMS.filter((item) => {
    if (surface === 'mobile') {
      if (authed && !item.authedMobile) return false
      if (!authed && !item.guestMobile) return false
    } else if (!item.desktop) {
      return false
    }

    if (item.requiresAuth && !authed) return false
    if (Array.isArray(item.roles) && !item.roles.includes(role)) return false
    return true
  })
}

export const isBottomNavigationVisible = (currentPath) => {
  return !HIDDEN_BOTTOM_NAV_PREFIXES.some((prefix) => pathMatchesPrefix(currentPath, prefix))
}

export const resolveMobileTask = (currentPath) => {
  if (pathMatchesPrefix(currentPath, '/booking')) {
    return { title: '服務預約', fallback: '/store', fallbackLabel: '返回商店' }
  }
  if (pathMatchesPrefix(currentPath, '/reset')) {
    return { title: '重設密碼', fallback: '/login', fallbackLabel: '返回登入' }
  }
  if (pathMatchesPrefix(currentPath, '/offline')) {
    return { title: '連線狀態', fallback: '/store', fallbackLabel: '返回商店' }
  }
  if (pathMatchesPrefix(currentPath, '/404')) {
    return { title: '找不到頁面', fallback: '/store', fallbackLabel: '返回商店' }
  }
  return null
}
