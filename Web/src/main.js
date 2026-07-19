import { createApp } from 'vue'
import './tailwind.css'
import App from './App.vue'
import router from './router/router.js'
import { registerServiceWorker } from './pwa/registerServiceWorker.js'

const app = createApp(App)
app.use(router)

app.mount("#app")
registerServiceWorker()
