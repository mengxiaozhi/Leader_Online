<template>
  <main class="pt-6 pb-12 px-4">
    <div class="mx-auto max-w-5xl space-y-5">
      <header class="space-y-2">
        <h1 class="ui-title text-2xl font-medium text-primary">服務商條款</h1>
        <p class="text-sm text-gray-600">各服務商提供的服務條款會彙整於此頁。</p>
      </header>

      <div v-if="loading" class="text-gray-600 text-sm">內容載入中…</div>
      <div v-else-if="error" class="text-sm text-red-600">{{ error }}</div>
      <div v-else-if="!providers.length" class="text-sm text-gray-600">目前尚未提供服務商條款。</div>
      <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AppCard v-for="provider in providers" :key="provider.id || provider.name">
          <template #default>
            <article class="space-y-4">
              <div class="border-b border-gray-200 pb-3">
                <h2 class="ui-title text-xl font-medium text-gray-900">{{ provider.name || '服務商' }}</h2>
                <p v-if="provider.updatedAt" class="mt-1 text-sm text-gray-600">更新時間：{{ provider.updatedAt }}</p>
              </div>
              <div class="content-body whitespace-pre-wrap">{{ provider.content }}</div>
            </article>
          </template>
        </AppCard>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { API_BASE } from '../utils/api'
import axios from '../api/axios'
import AppCard from '../components/AppCard.vue'
import { summarizeText } from '../utils/content'
import { setPageMeta } from '../utils/meta'
import { formatDateTime } from '../utils/datetime'

const API = API_BASE
const providers = ref([])
const loading = ref(true)
const error = ref('')

const applyProviderTermsMeta = (items = []) => {
  const combined = items.map(item => item.raw || '').filter(Boolean).join(' ')
  const summary = summarizeText(combined)
  setPageMeta({
    title: '服務商條款',
    description: summary || '查看 Leader Online 各服務商提供的服務條款。'
  })
}

async function fetchProviderTerms() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await axios.get(`${API}/providers/legal_terms`)
    if (!data?.ok) {
      throw new Error(data?.message || '無法載入服務商條款')
    }
    const items = Array.isArray(data.data) ? data.data : []
    providers.value = items
      .map((item) => {
        const raw = item?.content || ''
        return {
          id: item?.id || '',
          name: item?.name || '服務商',
          raw,
          content: String(raw || '').trim(),
          updatedAt: item?.updated_at ? formatDateTime(item.updated_at) : ''
        }
      })
      .filter(item => item.content)
    applyProviderTermsMeta(providers.value)
  } catch (e) {
    error.value = e?.response?.data?.message || e.message || '無法載入服務商條款'
    applyProviderTermsMeta([])
  } finally {
    loading.value = false
  }
}

onMounted(fetchProviderTerms)
</script>
