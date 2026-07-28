import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = () => readFile(new URL('../src/pages/brand.vue', import.meta.url), 'utf8')

test('brand page exposes an accessible Google Wallet member-card entry', async () => {
  const brand = await source()
  assert.match(brand, /id="google-wallet"/)
  assert.match(brand, /to="\/account\?tab=card"/)
  assert.match(brand, /zhTW_add_to_google_wallet_wallet-button\.svg/)
  assert.match(brand, /\/brand\/google-wallet-phone-cutout\.png/)
  assert.match(brand, /它不是付款卡/)
})

test('brand page answers common service and Google Wallet questions with native disclosures', async () => {
  const brand = await source()
  assert.match(brand, /id="faq"/)
  assert.match(brand, /<details v-for=/)
  assert.match(brand, /課程計次票會在預約時立刻扣堂嗎/)
  assert.match(brand, /如何把 Leader Online 會員卡加入 Google Wallet/)
})
