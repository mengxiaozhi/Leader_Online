import { createApp } from 'vue'
import './tailwind.css'
import App from './App.vue'
import router from './router/router.js'
import hammerDirective from './directives/hammer.js'
import { registerServiceWorker } from './pwa/registerServiceWorker.js'

const app = createApp(App)
app.use(router)
app.directive('hammer', hammerDirective)

app.mount("#app")
registerServiceWorker()
