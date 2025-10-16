import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router/router.js'
import hammerDirective from './directives/hammer.js'

const app = createApp(App)
app.use(router)
app.directive('hammer', hammerDirective)

app.mount("#app")
