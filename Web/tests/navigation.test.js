import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isBottomNavigationVisible,
  isNavigationItemActive,
  itemsForUser,
  resolveMobileTask,
} from '../src/utils/navigation.js'

test('booking and nested routes belong to Store without partial-name collisions', () => {
  const store = itemsForUser(null, { surface: 'mobile' }).find((item) => item.id === 'store')
  assert.equal(isNavigationItemActive('/booking/IRONMAN-2026', store), true)
  assert.equal(isNavigationItemActive('/store', store), true)
  assert.equal(isNavigationItemActive('/storefront', store), false)
})

test('navigation applies the same auth and role rules to each surface', () => {
  assert.deepEqual(itemsForUser(null, { surface: 'mobile' }).map((item) => item.id), ['brand', 'store', 'login'])
  assert.deepEqual(itemsForUser({ role: 'MEMBER' }, { surface: 'desktop' }).map((item) => item.id), ['wallet', 'store', 'account'])
  assert.deepEqual(itemsForUser({ role: 'STORE' }, { surface: 'mobile' }).map((item) => item.id), ['wallet', 'store', 'account', 'admin'])
})

test('task routes hide bottom navigation and expose a deterministic fallback', () => {
  assert.equal(isBottomNavigationVisible('/booking/ABC'), false)
  assert.equal(isBottomNavigationVisible('/store'), true)
  assert.deepEqual(resolveMobileTask('/booking/ABC'), {
    title: '服務預約',
    fallback: '/store',
    fallbackLabel: '返回商店',
  })
  assert.equal(isBottomNavigationVisible('/register/complete'), false)
  assert.deepEqual(resolveMobileTask('/register/complete'), {
    title: '完成註冊',
    fallback: '/login?mode=register',
    fallbackLabel: '返回註冊',
  })
})
