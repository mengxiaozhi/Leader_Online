import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { publicPages } from '../src/seo/pages.js'
import { buildPageMeta, renderPageHead, siteOrigin, escapeHtml } from '../src/seo/metadata.js'

export function renderSitemap(origin) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Object.keys(publicPages).map(path => `  <url><loc>${escapeHtml(siteOrigin(origin) + path)}</loc></url>`).join('\n')}\n</urlset>\n`
}

export function renderRobots(origin) {
  // Crawlers must be able to read the noindex directive on private pages.
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin(origin)}/sitemap.xml\n`
}

export function replaceSeoHead(html, head) {
  return html.replace(/<!-- SEO:START -->[\s\S]*?<!-- SEO:END -->/, () => `<!-- SEO:START -->\n  ${head}\n  <!-- SEO:END -->`)
}

export function seoBuild() {
  let config
  return {
    name: 'leader-public-seo',
    configResolved(value) { config = value },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]
        if (!['/robots.txt', '/sitemap.xml'].includes(path)) return next()
        res.setHeader('Content-Type', path.endsWith('.xml') ? 'application/xml' : 'text/plain')
        res.end(path.endsWith('.xml') ? renderSitemap(config.env.VITE_SITE_URL) : renderRobots(config.env.VITE_SITE_URL))
      })
    },
    async writeBundle() {
      const origin = siteOrigin(config.env.VITE_SITE_URL)
      const output = resolve(config.root, config.build.outDir)
      const template = await readFile(resolve(output, 'index.html'), 'utf8')
      const manifest = JSON.parse(await readFile(resolve(output, '.vite/manifest.json'), 'utf8'))
      const cacheDir = await mkdtemp(join(tmpdir(), 'leader-seo-'))
      const renderer = await createServer({
        root: config.root, configFile: false, cacheDir, plugins: [vue()],
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom',
      })
      try {
        const { renderPublicPage } = await renderer.ssrLoadModule('/src/seo/prerender.js')
        for (const [path, page] of Object.entries(publicPages)) {
          const rendered = await renderPublicPage(path)
          const css = new Set()
          const visited = new Set()
          const collectCss = key => {
            if (visited.has(key)) return
            visited.add(key)
            const chunk = manifest[key]
            chunk?.css?.forEach(file => css.add(file))
            chunk?.imports?.forEach(collectCss)
          }
          collectCss(`src/pages/${page.component}.vue`)
          rendered.modules.forEach(collectCss)
          let html = replaceSeoHead(template, renderPageHead(buildPageMeta(page, path, origin)))
            .replace('<div id="app"></div>', () => `<div id="app" data-prerendered="true">${rendered.html}</div>`)
          const styles = [...css].filter(file => !html.includes(`href="/${file}"`)).map(file => `<link rel="stylesheet" href="/${file}" />`).join('\n')
          html = html.replace('</head>', `${styles}\n</head>`)
          const file = resolve(output, `${path.slice(1)}.html`)
          await mkdir(dirname(file), { recursive: true })
          await writeFile(file, html)
        }
        // Generic SPA fallback must not point every dynamic URL at /store.
        const fallback = buildPageMeta({ structuredData: false }, '/', origin)
        fallback.url = null
        await writeFile(resolve(output, 'index.html'), replaceSeoHead(template, renderPageHead(fallback)))
        await writeFile(resolve(output, 'private.html'), replaceSeoHead(template, renderPageHead(buildPageMeta({ noindex: true, title: '會員與管理服務' }, '/login', origin))))
        await writeFile(resolve(output, '404.html'), replaceSeoHead(template, renderPageHead(buildPageMeta({ noindex: true, title: '找不到頁面' }, '/404', origin))))
        await writeFile(resolve(output, 'sitemap.xml'), renderSitemap(origin))
        await writeFile(resolve(output, 'robots.txt'), renderRobots(origin))
        console.log(`SEO: generated ${Object.keys(publicPages).length} public pages, sitemap.xml and robots.txt`)
      } finally { await renderer.close(); await rm(cacheDir, { recursive: true, force: true }) }
    },
  }
}
