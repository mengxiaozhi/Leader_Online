import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicPages } from '../src/seo/pages.js'
import { buildPageMeta, renderPageHead } from '../src/seo/metadata.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = resolve(root, 'dist')
const sitemap = await readFile(resolve(output, 'sitemap.xml'), 'utf8')
const origin = new URL(sitemap.match(/<loc>(.*?)<\/loc>/)[1]).origin
for (const [path, page] of Object.entries(publicPages)) {
  const html = await readFile(resolve(output, `${path.slice(1)}.html`), 'utf8')
  assert.ok(html.includes(renderPageHead(buildPageMeta(page, path, origin))), `${path}: exact shared metadata`)
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1, path)
  assert.equal((html.match(/application\/ld\+json/g) || []).length, 1, path)
  assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, `${path}: main heading`)
  assert.ok(html.includes('data-prerendered="true"'), `${path}: public body rendered`)
  assert.ok(html.includes('href="/brand"'), `${path}: crawlable internal links`)
  assert.doesNotMatch(html, /[\w.-]+@example\.test|Bearer\s|user_info/, `${path}: no fixture or account data`)
  for (const [, href] of html.matchAll(/<link rel="stylesheet" href="(.*?)"/g)) await access(resolve(output, href.slice(1)))
}
const brand = await readFile(resolve(output, 'brand.html'), 'utf8')
assert.ok(brand.includes('如何預約自行車與鐵人賽事託運？'))
assert.ok(brand.includes('安全送到起點。'))
assert.match(brand, /href="\/assets\/brand-[^"]+\.css"/)
for (const file of ['private.html', '404.html']) {
  const html = await readFile(resolve(output, file), 'utf8')
  assert.match(html, /content="noindex, follow"/)
  assert.doesNotMatch(html, /rel="canonical"|application\/ld\+json/)
}
const fallback = await readFile(resolve(output, 'index.html'), 'utf8')
assert.doesNotMatch(fallback, /rel="canonical"|noindex|application\/ld\+json/)
console.log(`SEO build verified: ${Object.keys(publicPages).length} public HTML pages, private/404 directives, styles and SPA fallback`)
