import { createSSRApp, h } from 'vue'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import { renderToString } from 'vue/server-renderer'
import { publicPages } from './pages.js'

const components = import.meta.glob('../pages/*.vue')

// Render public components only: no authentication, API requests, cookies or account state at build time.
export async function renderPublicPage(path) {
  const page = publicPages[path]
  const router = createRouter({ history: createMemoryHistory(), routes: Object.entries(publicPages).map(([path, page]) => ({
    path, component: components[`../pages/${page.component}.vue`], props: { courseTask: page.courseTask || '' },
  })) })
  const app = createSSRApp({ render: () => h('div', { class: 'app-shell' }, [
    h('div', { class: 'app-main' }, [h(RouterView)]),
    h('footer', { class: 'app-footer' }, [h('nav', { 'aria-label': '網站導覽', class: 'flex flex-wrap gap-4 text-sm' },
      Object.entries(publicPages).map(([url, item]) => h('a', { href: url }, item.label)),
    )]),
  ]) })
  app.use(router)
  await router.push(path)
  await router.isReady()
  const context = {}
  const html = await renderToString(app, context)
  return { html, modules: [...(context.modules || [])], page }
}
