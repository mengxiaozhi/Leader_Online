import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { publicPages, isPrivatePath } from '../src/seo/pages.js'
import { buildPageMeta, canonicalUrl, renderPageHead, siteOrigin } from '../src/seo/metadata.js'
import { renderRobots, renderSitemap, replaceSeoHead } from '../scripts/seo-build.js'

test('public pages have unique metadata, canonical URLs and connected structured data', () => {
  const pages = Object.keys(publicPages).map(path => buildPageMeta({}, path))
  assert.equal(new Set(pages.map(page => page.title)).size, pages.length)
  assert.equal(new Set(pages.map(page => page.description)).size, pages.length)
  pages.forEach(page => {
    assert.match(page.robots, /^index, follow/)
    assert.equal(page.structuredData['@graph'][2].url, page.url)
    assert.equal(page.structuredData['@graph'][2].isPartOf['@id'], page.structuredData['@graph'][1]['@id'])
  })
})

test('canonical URLs remove tracking, hashes and slash duplicates and respect deployment origin', () => {
  assert.equal(canonicalUrl('/store/?utm_source=test#tickets', 'https://example.test/'), 'https://example.test/store')
  assert.equal(canonicalUrl('/'), 'https://spono.tw/store')
  assert.equal(canonicalUrl('https://untrusted.test/brand'), 'https://spono.tw/brand')
  assert.equal(buildPageMeta({}, '/courses/classes/12?utm_source=test').url, 'https://spono.tw/courses/classes/12')
  for (const origin of ['javascript:alert(1)', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test?key=1']) assert.throws(() => siteOrigin(origin))
})

test('private routes and missing records remove canonical and structured data even with a public-looking title', () => {
  for (const path of ['/admin', '/admin/courses/students', '/coach/courses/sessions/1', '/wallet', '/login', '/account', '/reset', '/register/complete', '/me/courses', '/courses/me/orders', '/courses/classes/9/checkout', '/offline', '/404']) {
    assert.equal(isPrivatePath(path), true, path)
    const page = buildPageMeta({ title: '測試班期', noindex: false }, path)
    assert.equal(page.url, null, path)
    assert.equal(page.structuredData, null, path)
    assert.match(page.robots, /^noindex/)
  }
  assert.equal(buildPageMeta({ noindex: true }, '/booking/missing').url, null)
  assert.equal(isPrivatePath('/courses/classes/9'), false)
  assert.equal(isPrivatePath('/booking/EV000001'), false)
})

test('HTML and JSON-LD cannot be broken out of by dynamic titles and descriptions', () => {
  const dangerous = '</script><script>alert("x")</script>& $& $`'
  const html = renderPageHead(buildPageMeta({ title: dangerous, description: dangerous }, '/booking/1'))
  assert.equal((html.match(/<script/g) || []).length, 1)
  assert.ok(html.includes('\\u003c/script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  const data = JSON.parse(html.match(/type="application\/ld\+json">(.*?)<\/script>/s)[1])
  assert.equal(data['@graph'][2].description, dangerous)
  const template = '<head><!-- SEO:START -->old<!-- SEO:END --></head><body>body</body>'
  const replacement = replaceSeoHead(template, html)
  assert.ok(replacement.endsWith('</head><body>body</body>'))
  assert.ok(!replacement.includes('old'))
  assert.ok(replacement.includes(html))
})

test('share image metadata reports known dimensions and omits unknown cover dimensions', () => {
  const known = buildPageMeta({}, '/store')
  assert.equal(known.imageWidth, 1264)
  assert.equal(known.imageHeight, 842)
  const cover = buildPageMeta({ image: 'https://api.spono.tw/events/1/cover' }, '/booking/1')
  assert.equal(cover.imageWidth, null)
  assert.equal(cover.imageType, null)
  const invalid = buildPageMeta({ image: 'javascript:alert(1)' }, '/booking/1')
  assert.equal(invalid.image, 'https://spono.tw/og_img.png')
})

test('sitemap includes every public landing page without fabricated dates or private paths', () => {
  const sitemap = renderSitemap('https://example.test')
  assert.equal((sitemap.match(/<loc>/g) || []).length, Object.keys(publicPages).length)
  Object.keys(publicPages).forEach(path => assert.ok(sitemap.includes(`<loc>https://example.test${path}</loc>`)))
  assert.doesNotMatch(sitemap, /lastmod|wallet|checkout|\/admin/)
  const robots = renderRobots('https://example.test')
  assert.ok(robots.includes('Sitemap: https://example.test/sitemap.xml'))
  assert.doesNotMatch(robots, /Disallow:/)
})

test('deployment serves each public HTML, private noindex, real 404 and dynamic SPA paths', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
  const resolve = path => config.routes.find(route => route.src && new RegExp(route.src).test(path))
  for (const path of Object.keys(publicPages)) assert.equal(resolve(path).dest, `${path}.html`)
  assert.equal(resolve('/').status, 308)
  assert.equal(resolve('/').headers.Location, '/store')
  assert.equal(resolve('/courses/classes/9/checkout').headers['X-Robots-Tag'], 'noindex, follow')
  assert.equal(resolve('/wallet').dest, '/private.html')
  assert.equal(resolve('/courses/classes/9').dest, '/index.html')
  assert.equal(resolve('/booking/EV000009').dest, '/index.html')
  assert.equal(resolve('/unknown').status, 404)
  assert.equal(resolve('/404').status, 404)
})
