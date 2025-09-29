<template>
  <main class="pt-6 pb-12 px-4">
    <div class="max-w-3xl mx-auto">
      <AppCard>
        <template #default>
          <div class="space-y-4">
            <h1 class="text-2xl font-bold text-primary">使用者條款</h1>
            <div v-if="loading" class="text-gray-500 text-sm">內容載入中…</div>
            <div v-else-if="error" class="text-sm text-red-600">{{ error }}</div>
            <div v-else-if="!content" class="text-sm text-gray-500">尚未提供使用者條款。</div>
            <div v-else class="content-body" v-html="content"></div>
          </div>
        </template>
      </AppCard>
    </div>
  </main>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from '../api/axios'
import AppCard from '../components/AppCard.vue'
import { normalizeRichText, summarizeText } from '../utils/content'
import { setPageMeta } from '../utils/meta'

const API = 'https://api.xiaozhi.moe/uat/leader_online'
const content = ref('')
const loading = ref(true)
const error = ref('')

const applyTermsMeta = (raw) => {
  const fallback = '閱讀 Leader Online 服務使用者條款與平台規範。'
  const summary = summarizeText(raw)
  setPageMeta({ title: '使用者條款', description: summary || fallback })
}

async function fetchPage() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await axios.get(`${API}/pages/terms`)
    if (data?.ok) {
      const raw = data.data?.content || ''
      content.value = normalizeRichText(raw)
      applyTermsMeta(raw)
    } else {
      error.value = data?.message || '無法載入使用者條款'
      applyTermsMeta('')
    }
  } catch (e) {
    error.value = e?.response?.data?.message || e.message || '無法載入使用者條款'
    applyTermsMeta('')
  } finally {
    loading.value = false
  }
}

onMounted(fetchPage)
</script>

<style scoped>
.content-body :deep(p) {
  margin-bottom: 1rem;
  line-height: 1.7;
}
.content-body :deep(h2) {
  font-weight: 600;
  margin-top: 2rem;
  margin-bottom: 1rem;
}
.content-body :deep(ul), .content-body :deep(ol) {
  margin-left: 1.5rem;
  margin-bottom: 1rem;
  list-style: disc;
}
</style>
