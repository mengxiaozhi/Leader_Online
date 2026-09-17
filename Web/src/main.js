import { createApp } from 'vue'
import './tailwind.css'
import './styles/motion.css'
import App from './App.vue'
import router from './router/router.js'
import { registerServiceWorker } from './pwa/registerServiceWorker.js'

const app = createApp(App)
app.use(router)

// Keep prerendered content visible while the initial lazy route loads.
router.isReady().then(() => {
    app.mount('#app')
})
registerServiceWorker()
