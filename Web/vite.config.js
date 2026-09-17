import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { seoBuild } from './scripts/seo-build.js'

export default defineConfig({
  plugins: [vue(), tailwindcss(), seoBuild()],
  build: { manifest: true },
})
