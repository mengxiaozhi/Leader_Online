<template>
  <main class="page-container">
    <div class="space-y-8">

      <!-- Header -->
      <header class="card mb-8 p-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div class="space-y-1">
          <h1 class="ui-title text-2xl font-medium text-slate-900">帳戶中心</h1>
          <p class="text-slate-600 text-sm">管理個人資料與登入設定</p>
        </div>
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          <div class="w-full sm:w-auto flex items-center justify-center gap-2 bg-slate-100 text-slate-800 px-3 py-2 text-sm font-medium border border-slate-300 rounded-xl">
            <AppIcon name="user" class="h-4 w-4" /> 角色：{{ roleLabel }}
          </div>
        </div>
      </header>

      <div class="material-chrome relative mb-6 sticky top-0 z-30 rounded-2xl border md:top-[65px]">
        <div class="flex justify-center relative" role="tablist" aria-label="帳戶中心分頁" @keydown="handleTabKeydown">
          <div class="tab-indicator" :style="indicatorStyle"></div>
          <button
            v-for="(tab, index) in tabs"
            :id="`account-tab-${tab.key}`"
            :key="tab.key"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.key"
            :aria-controls="`account-panel-${tab.key}`"
            :tabindex="activeTab === tab.key ? 0 : -1"
            @click="setActiveTab(tab.key, index)"
            :class="[
              'relative flex-1 px-3 py-3 sm:px-6 sm:py-4 font-medium transition-all duration-300 text-sm sm:text-lg whitespace-nowrap flex items-center gap-1 justify-center',
              activeTab === tab.key ? 'text-primary' : 'text-slate-600 hover:text-primary'
            ]">
            <AppIcon v-if="tab.icon" :name="tab.icon" class="h-4 w-4" />
            {{ tab.label }}
          </button>
        </div>
      </div>

      <div v-if="activeTab === 'card'" id="account-panel-card" role="tabpanel"
        aria-labelledby="account-tab-card" tabindex="0" class="space-y-6">
        <!-- Member Card -->
        <section v-if="form.id" class="flex flex-col items-center gap-5">
          <div class="w-full max-w-[560px] [perspective:1400px]">
            <div
              class="member-card-flipper relative grid w-full text-left [transform-style:preserve-3d]"
              :data-flipped="isMemberCardFlipped ? 'true' : 'false'"
              :class="[
                'transition-transform duration-700 ease-out',
                isMemberCardFlipped ? '[transform:rotateY(180deg)]' : ''
              ]">
              <div
                :aria-hidden="isMemberCardFlipped"
                :class="[
                  'member-card-face relative [grid-area:1/1] overflow-hidden rounded-[28px] border p-5 text-white [backface-visibility:hidden] sm:p-8',
                  memberCardTheme.front
                ]">
                <div :class="['pointer-events-none absolute -left-8 top-12 h-28 w-44 rotate-45 border-y-4 opacity-70', memberCardTheme.frontStripePrimary]"></div>
                <div :class="['pointer-events-none absolute bottom-12 right-[-28px] h-28 w-44 rotate-45 border-y-4 opacity-55', memberCardTheme.frontStripeSecondary]"></div>

                <div class="relative flex min-h-[32rem] flex-col sm:min-h-[36rem]">
                  <div class="flex items-start justify-between gap-4">
                    <div>
                      <p :class="['text-sm font-medium tracking-[0.16em]', memberCardTheme.frontEyebrow]">LEADER ONLINE</p>
                      <p :class="['mt-2 text-[0.95rem]', memberCardTheme.frontMuted]">{{ memberCardTitle }}</p>
                    </div>
                    <span :class="['inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border', memberCardTheme.frontControl]">
                      <AppIcon name="refresh" class="h-5 w-5" />
                    </span>
                  </div>

                  <div class="mt-12">
                    <span :class="['inline-flex items-center gap-2 border px-3 py-1.5 text-sm font-medium', memberCardTheme.frontControl]">
                      <AppIcon name="shield" class="h-4 w-4" />
                      {{ membershipLabel }}
                    </span>
                    <h2 :class="['ui-title mt-5 break-words text-4xl font-medium leading-tight sm:text-5xl', memberCardTheme.frontTitle]">{{ displayName }}</h2>
                    <p :class="['mt-3 break-all font-mono text-base tracking-[0.12em]', memberCardTheme.frontId]">{{ form.id }}</p>
                  </div>

                  <div class="mt-auto flex flex-col gap-5 pt-8 sm:flex-row sm:items-end sm:justify-between">
                    <div :class="['max-w-[240px] text-sm leading-6', memberCardTheme.frontMuted]">
                      <p v-if="form.email" class="break-all">{{ form.email }}</p>
                      <p>{{ roleLabel }}</p>
                    </div>
                    <div class="shrink-0 self-center bg-white p-3 text-slate-950 sm:self-end">
                      <QrcodeVue v-if="memberQrValue" :value="memberQrValue" :size="memberCardQrSize" level="M" />
                    </div>
                  </div>
                </div>
              </div>

              <div
                :aria-hidden="!isMemberCardFlipped"
                :class="[
                  'member-card-face member-card-face--back relative [grid-area:1/1] overflow-hidden rounded-[28px] border p-5 [backface-visibility:hidden] [transform:rotateY(180deg)] sm:p-8',
                  memberCardTheme.back
                ]">
                <div :class="['pointer-events-none absolute -right-8 top-12 h-28 w-44 rotate-45 border-y-4 opacity-60', memberCardTheme.backStripe]"></div>

                <div class="relative flex min-h-[32rem] flex-col sm:min-h-[36rem]">
                  <div class="flex items-start justify-between gap-4">
                    <div>
                      <p :class="['text-sm font-medium tracking-[0.16em]', memberCardTheme.backAccent]">MEMBER DETAILS</p>
                      <h2 :class="['ui-title mt-2 text-2xl font-medium', memberCardTheme.backTitle]">會員詳細資訊</h2>
                    </div>
                    <span :class="['inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border', memberCardTheme.backControl]">
                      <AppIcon name="refresh" class="h-5 w-5" />
                    </span>
                  </div>

                  <div :class="['mt-8 divide-y', memberCardTheme.backDivider]">
                    <div v-for="item in memberDetailRows" :key="item.label" class="grid grid-cols-[24px_minmax(0,1fr)] gap-3 py-3.5">
                      <AppIcon :name="item.icon" :class="['mt-0.5 h-5 w-5', memberCardTheme.backAccent]" />
                      <div class="min-w-0">
                        <p :class="['text-xs font-medium tracking-[0.06em]', memberCardTheme.backLabel]">{{ item.label }}</p>
                        <p :class="['mt-1 break-words text-[0.95rem] font-medium leading-6', memberCardTheme.backValue]">{{ item.value }}</p>
                      </div>
                    </div>
                  </div>

                  <div :class="['mt-auto border-t pt-5 text-sm leading-6', memberCardTheme.backFooter]">
                    會員碼用於現場身份驗證，詳細資料以帳戶中心目前紀錄為準。
                  </div>
                </div>
              </div>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-outline min-h-[44px] min-w-[144px]"
            :aria-pressed="isMemberCardFlipped"
            @click="isMemberCardFlipped = !isMemberCardFlipped">
            <AppIcon name="refresh" class="h-4 w-4" />
            {{ isMemberCardFlipped ? '返回正面' : '查看詳細' }}
          </button>
          <div class="flex flex-col items-center px-2 text-center">
            <button
              type="button"
              class="rounded-full p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 disabled:cursor-wait"
              :disabled="addingToGoogleWallet"
              :aria-busy="addingToGoogleWallet"
              @click="addToGoogleWallet">
              <img
                src="/google-wallet/zhTW_add_to_google_wallet_wallet-button.svg"
                alt="加入 Google 錢包"
                width="263"
                height="50"
                class="h-[50px] w-auto"
                draggable="false"
              />
            </button>
            <p class="text-sm text-slate-600">
              {{ addingToGoogleWallet ? '正在準備會員卡…' : '將會員編號與驗證 QR Code 儲存到 Google 錢包' }}
            </p>
          </div>
        </section>
      </div>

      <div v-else-if="activeTab === 'profile'" id="account-panel-profile" role="tabpanel"
        aria-labelledby="account-tab-profile" tabindex="0" class="space-y-6">
        <!-- Profile -->
        <section>
          <AppCard>
            <h2 class="ui-title font-medium mb-4">基本資料</h2>
            <p class="text-sm text-slate-600 mb-3">購買票券或預約前，需要先補齊手機號碼與匯款帳號後五碼。</p>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label for="account-name" class="block text-sm text-slate-600 mb-1">姓名</label>
                <input id="account-name" v-model.trim="form.username" autocomplete="name" required class="w-full border px-3 py-2" />
              </div>
              <div>
                <label for="account-email" class="block text-sm text-slate-600 mb-1">電子信箱</label>
                <input
                  id="account-email"
                  v-model.trim="form.email"
                  type="email"
                  autocomplete="email"
                  disabled
                  required
                  class="w-full border px-3 py-2 bg-slate-100 text-slate-700 opacity-100"
                />
              </div>
              <div>
                <label for="account-phone" class="block text-sm text-slate-600 mb-1">手機號碼</label>
                <input
                  id="account-phone"
                  v-model="form.phone"
                  @input="onPhoneInput"
                  inputmode="tel"
                  maxlength="20"
                  class="w-full border px-3 py-2"
                  placeholder="例：0912-345678"
                />
              </div>
              <div>
                <label for="account-remittance-last5" class="block text-sm text-slate-600 mb-1">匯款帳號後五碼</label>
                <input
                  id="account-remittance-last5"
                  v-model="form.remittanceLast5"
                  @input="onRemittanceInput"
                  inputmode="numeric"
                  maxlength="5"
                  class="w-full border px-3 py-2 tracking-widest"
                  placeholder="12345"
                />
              </div>
            </div>
            <p class="text-sm text-slate-600 mb-4">會員識別碼：{{ form.id }}</p>
            <div class="mt-4 flex gap-3 flex-col sm:flex-row">
              <button class="btn btn-primary text-white w-full sm:w-auto" :disabled="savingProfile"
                @click="saveProfile">儲存基本資料</button>
            </div>
          </AppCard>
        </section>

        <!-- Password -->
        <section>
          <AppCard>
            <h2 class="ui-title font-medium mb-1">變更密碼（需電子信箱驗證）</h2>
            <p class="text-sm text-slate-600 mb-4">輸入目前密碼後，我們會寄送一封確認信到您的電子信箱，請透過信中的連結完成新密碼設定。</p>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label for="account-current-password" class="block text-sm text-slate-600 mb-1">目前密碼</label>
                <input id="account-current-password" v-model.trim="pwd.current" type="password" autocomplete="current-password"
                  class="w-full border px-3 py-2" />
              </div>
            </div>
            <div class="mt-4 flex gap-3 flex-col sm:flex-row">
              <button class="btn btn-outline w-full sm:w-auto" :disabled="savingPwd"
                @click="changePassword">寄送驗證信</button>
            </div>
          </AppCard>
        </section>

        <!-- 資料匯出 -->
        <section>
          <AppCard>
            <h2 class="ui-title font-medium mb-2">下載我的帳號資料</h2>
            <p class="text-sm text-slate-600 mb-3">出於安全，匯出前請先輸入一次目前密碼以驗證身分。</p>
            <p class="text-sm text-slate-600 mb-4">
              匯出檔案包含基本個人資料、購物車內容、票券與訂單、預約紀錄、票券轉贈紀錄，以及第三方登入與安全相關紀錄；請妥善保管此檔案。
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="account-export-password" class="block text-sm text-slate-600 mb-1">目前密碼</label>
                <input id="account-export-password" v-model.trim="exportPwd" type="password" autocomplete="current-password"
                  class="w-full border px-3 py-2" />
              </div>
            </div>
            <div class="mt-4 flex gap-3 flex-col sm:flex-row">
              <button class="btn btn-outline w-full sm:w-auto" :disabled="exporting || !exportPwd"
                @click="exportAccountData">下載資料檔</button>
            </div>
          </AppCard>
        </section>
      </div>

      <div v-else-if="activeTab === 'other'" id="account-panel-other" role="tabpanel"
        aria-labelledby="account-tab-other" tabindex="0" class="space-y-6">
        <!-- 第三方登入綁定 -->
        <section>
          <AppCard>
            <h2 class="ui-title font-medium mb-2">第三方登入</h2>
            <div class="flex flex-col gap-4">
              <div class="flex items-center justify-between gap-3">
                    <div class="text-sm text-slate-600">Google：<strong>{{ providers.includes('google') ? '已綁定' : '未綁定'
                    }}</strong></div>
                <div class="flex gap-2">
                  <button v-if="!providers.includes('google')" class="btn btn-outline" @click="linkGoogle">
                    綁定 Google 登入
                  </button>
                  <button v-else class="btn btn-outline" @click="unlinkGoogle">解除綁定</button>
                </div>
              </div>

              <div class="border-t border-gray-200 pt-4">
                <div class="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
                  <div class="flex-1">
                    <div class="flex items-center gap-2 mb-2">
                      <div class="text-sm text-slate-600">LINE：<strong>{{ providers.includes('line') ? '已綁定' : '未綁定' }}</strong></div>
                    </div>
                    <div class="flex gap-2 flex-wrap mb-3">
                      <button v-if="!providers.includes('line')" class="btn btn-outline" @click="linkLine">
                        綁定 LINE 登入
                      </button>
                      <button v-else class="btn btn-outline" @click="unlinkLine">解除綁定</button>
                      <a :href="lineOfficialUrl" target="_blank" rel="noopener noreferrer" class="btn btn-primary text-white">
                        加入官方帳號
                      </a>
                    </div>
                    <ul class="text-sm text-slate-600 space-y-1">
                      <li>・ 綁定後可用 LINE 一鍵登入，免輸入帳密。</li>
                      <li>・ 加入官方帳號即可收到最新活動通知與預約提醒。</li>
                      <li>・ 官方帳號中可快速查看預約資訊與客服聯繫方式。</li>
                    </ul>
                  </div>
                  <div class="flex flex-col items-center gap-2 border border-gray-300 p-3 bg-slate-100">
                    <img :src="lineOfficialQr" alt="LINE 官方帳號碼" class="w-32 h-32 object-contain" />
                    <p class="text-sm text-slate-600 text-center leading-snug">掃描官方帳號碼加入<br>Leader Online 官方帳號</p>
                  </div>
                </div>
              </div>
            </div>
          </AppCard>
        </section>

        <!-- 刪除帳號 -->
        <section>
          <AppCard>
            <h2 class="ui-title font-medium mb-2 text-red-700">刪除帳號</h2>
            <p class="text-sm text-slate-600 mb-2">此動作會刪除您的登入資格並匿名化個人資料，無法復原。若有既有訂單/預約/票券，將保留其紀錄但不再能與您帳號關聯。</p>
            <p class="text-sm text-slate-600 mb-3">出於安全，刪除前請先輸入一次目前密碼以驗證身分。</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="account-delete-password" class="block text-sm text-slate-600 mb-1">目前密碼</label>
                <input id="account-delete-password" v-model.trim="deletePwd" type="password" autocomplete="current-password"
                  class="w-full border px-3 py-2" />
              </div>
            </div>
            <div class="mt-4 flex gap-3 flex-col sm:flex-row">
              <button class="btn btn-primary text-white w-full sm:w-auto bg-red-600 border-red-600 hover:brightness-95"
                :disabled="deleting || !deletePwd" @click="deleteAccount">永久刪除帳號</button>
            </div>
          </AppCard>
        </section>

        <!-- Danger / Logout -->
        <section>
          <AppCard>
            <h2 class="ui-title font-medium mb-4">登入與安全</h2>
            <div class="flex flex-col sm:flex-row gap-3">
              <button class="btn btn-outline w-full sm:w-auto" @click="logout">
                <AppIcon name="logout" class="h-4 w-4" /> 登出
              </button>
            </div>
          </AppCard>
        </section>
      </div>

    </div>
  </main>
</template>

<script setup>
  import { ref, onMounted, computed, nextTick, watch } from 'vue'
  import { API_BASE } from '../utils/api'
  import axios from '../api/axios'
  import { useRouter, useRoute } from 'vue-router'
  import QrcodeVue from 'qrcode.vue'
  import AppIcon from '../components/AppIcon.vue'
  import AppCard from '../components/AppCard.vue'
  import { showNotice, showConfirm } from '../utils/sheet'
  import { clearAuthSession, setUserProfile } from '../utils/authSession'

  const API = API_BASE
  const router = useRouter()
  const route = useRoute()

  const form = ref({ username: '', email: '', id: '', phone: '', remittanceLast5: '', isVip: false })
  const role = ref('USER')
  const roleNames = {
    USER: '一般會員',
    ADMIN: '管理員',
    SERVICE_PROVIDER: '服務商',
    DRIVER: '司機',
    DELIVERY_POINT: '交車點',
    STORE: '服務商',
    EDITOR: '編輯'
  }
  const roleLabel = computed(() => roleNames[role.value] || role.value || '一般會員')
  const addingToGoogleWallet = ref(false)
  const savingProfile = ref(false)
  const savingPwd = ref(false)
  const exportPwd = ref('')
  const deletePwd = ref('')
  const exporting = ref(false)
  const deleting = ref(false)
  const providers = ref([])
  const lineOfficialUrl = 'https://line.me/R/ti/p/@855wwpug'
  const lineOfficialQr = `https://qr-official.line.me/gs/M_855wwpug_GW.png`
  const pwd = ref({ current: '', next: '' })
  const memberCardQrSize = 156
  const isMemberCardFlipped = ref(false)
  const displayName = computed(() => form.value.username || '會員')
  const memberQrValue = computed(() => form.value.id || '')
  const isAdminMember = computed(() => role.value === 'ADMIN')
  const membershipLabel = computed(() => isAdminMember.value ? '管理員' : (form.value.isVip ? 'VIP 會員' : roleLabel.value))
  const memberCardTitle = computed(() => isAdminMember.value ? '管理員會員卡' : (form.value.isVip ? 'VIP 會員卡' : '會員卡'))
  const memberCardTheme = computed(() => {
    if (isAdminMember.value) {
      return {
        front: 'border-sky-300/70 bg-[linear-gradient(145deg,#071a33_0%,#0d47a1_52%,#1686d9_100%)]',
        frontStripePrimary: 'border-sky-200/60',
        frontStripeSecondary: 'border-blue-200/45',
        frontEyebrow: 'text-sky-100/90',
        frontMuted: 'text-sky-50/80',
        frontControl: 'border-sky-200/60 bg-sky-100/15 text-sky-100',
        frontTitle: 'text-white',
        frontId: 'text-sky-50/85',
        back: 'border-sky-300/70 bg-[#eaf6ff] text-slate-900',
        backStripe: 'border-sky-500/25',
        backAccent: 'text-blue-700',
        backTitle: 'text-slate-950',
        backControl: 'border-sky-400/40 bg-white/60 text-blue-700',
        backDivider: 'divide-sky-900/15',
        backLabel: 'text-blue-900/70',
        backValue: 'text-slate-900',
        backFooter: 'border-sky-900/15 text-blue-950/70'
      }
    }
    if (form.value.isVip) {
      return {
        front: 'border-amber-300/70 bg-[linear-gradient(145deg,#151515_0%,#252017_52%,#5b4520_100%)]',
        frontStripePrimary: 'border-amber-200/55',
        frontStripeSecondary: 'border-amber-300/45',
        frontEyebrow: 'text-amber-100/90',
        frontMuted: 'text-amber-50/75',
        frontControl: 'border-amber-200/60 bg-amber-100/15 text-amber-100',
        frontTitle: 'text-amber-100',
        frontId: 'text-amber-50/80',
        back: 'border-amber-300/70 bg-[#f7efd9] text-[#2b2417]',
        backStripe: 'border-amber-500/30',
        backAccent: 'text-amber-800',
        backTitle: 'text-[#5b4520]',
        backControl: 'border-amber-500/35 bg-white/45 text-[#5b4520]',
        backDivider: 'divide-amber-800/20',
        backLabel: 'text-amber-900/70',
        backValue: 'text-[#2b2417]',
        backFooter: 'border-amber-800/20 text-amber-900/75'
      }
    }
    return {
      front: 'border-primary/35 bg-[linear-gradient(145deg,#2b2225_0%,#842d34_58%,#29313d_100%)]',
      frontStripePrimary: 'border-white/45',
      frontStripeSecondary: 'border-white/35',
      frontEyebrow: 'text-white/80',
      frontMuted: 'text-white/70',
      frontControl: 'border-white/45 bg-white/10 text-white',
      frontTitle: 'text-white',
      frontId: 'text-white/80',
      back: 'border-slate-300 bg-white text-slate-900',
      backStripe: 'border-primary/20',
      backAccent: 'text-primary',
      backTitle: 'text-slate-950',
      backControl: 'border-slate-300 bg-slate-50 text-primary',
      backDivider: 'divide-slate-300',
      backLabel: 'text-slate-600',
      backValue: 'text-slate-900',
      backFooter: 'border-slate-300 text-slate-600'
    }
  })
  const providerNames = {
    google: 'Google',
    line: 'LINE'
  }
  const connectedProviderLabel = computed(() => {
    if (!providers.value.length) return '未綁定'
    return providers.value.map(provider => providerNames[provider] || provider).join('、')
  })
  const maskedRemittanceLast5 = computed(() => (
    form.value.remittanceLast5 ? `末五碼 ${form.value.remittanceLast5}` : '未設定'
  ))
  const memberDetailRows = computed(() => [
    { label: '會員編號', value: form.value.id || '未建立', icon: 'ticket' },
    { label: '會員身份', value: membershipLabel.value, icon: 'shield' },
    { label: '電子信箱', value: form.value.email || '未設定', icon: 'user' },
    { label: '手機號碼', value: form.value.phone || '未設定', icon: 'info' },
    { label: '匯款帳號後五碼', value: maskedRemittanceLast5.value, icon: 'lock' },
    { label: '第三方登入', value: connectedProviderLabel.value, icon: 'link' }
  ])

  const normalizePhoneValue = (value) => String(value || '').replace(/[^0-9+\-()\s]/g, '').slice(0, 20)
  const normalizeRemittanceValue = (value) => String(value || '').replace(/\D/g, '').slice(0, 5)
  const onPhoneInput = (event) => {
    const sanitized = normalizePhoneValue(event?.target?.value ?? form.value.phone)
    if (event?.target) event.target.value = sanitized
    form.value.phone = sanitized
  }
  const onRemittanceInput = (event) => {
    const sanitized = normalizeRemittanceValue(event?.target?.value ?? form.value.remittanceLast5)
    if (event?.target) event.target.value = sanitized
    form.value.remittanceLast5 = sanitized
  }

  const tabs = [
    { key: 'card', label: '會員卡', icon: 'ticket' },
    { key: 'profile', label: '資料管理', icon: 'user' },
    { key: 'other', label: '登入與安全', icon: 'settings' },
  ]
  const activeTab = ref(tabs[0].key)
  const activeTabIndex = ref(0)
  const tabCount = computed(() => tabs.length || 1)
  const indicatorStyle = computed(() => {
    const count = tabCount.value
    return {
      left: `${activeTabIndex.value * (100 / count)}%`,
      width: `${100 / count}%`
    }
  })
  const updateTabQuery = (key) => {
    const current = typeof route.query.tab === 'string' ? route.query.tab : ''
    if (current === key) return
    router.push({ query: { ...route.query, tab: key } }).catch(() => {})
  }
  const setActiveTab = (key, index, options = {}) => {
    const nextIndex = typeof index === 'number' && index >= 0
      ? index
      : tabs.findIndex(t => t.key === key)
    if (nextIndex < 0 || nextIndex >= tabs.length) return
    activeTab.value = tabs[nextIndex].key
    activeTabIndex.value = nextIndex
    if (!options.skipRouteSync) updateTabQuery(activeTab.value)
  }
  const syncTabFromRoute = () => {
    const requested = typeof route.query.tab === 'string' ? route.query.tab : ''
    const nextIndex = tabs.findIndex(tab => tab.key === requested)
    setActiveTab(nextIndex >= 0 ? tabs[nextIndex].key : tabs[0].key, nextIndex >= 0 ? nextIndex : 0, {
      skipRouteSync: true,
    })
  }
  const handleTabKeydown = (event) => {
    let nextIndex = activeTabIndex.value
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (nextIndex + 1) % tabs.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (nextIndex - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = tabs.length - 1
    else return
    event.preventDefault()
    setActiveTab(tabs[nextIndex].key, nextIndex)
    nextTick(() => document.getElementById(`account-tab-${tabs[nextIndex].key}`)?.focus())
  }

  async function loadMe() {
    try {
      const { data } = await axios.get(`${API}/me`)
      if (data?.ok) {
        form.value.username = data.data.username || ''
        form.value.email = data.data.email || ''
        form.value.id = data.data.id ? String(data.data.id) : ''
        form.value.phone = normalizePhoneValue(data.data.phone || '')
        const last5 = data.data.remittanceLast5 ?? data.data.remittance_last5 ?? ''
        form.value.remittanceLast5 = normalizeRemittanceValue(last5)
        form.value.isVip = !!(data.data.isVip ?? data.data.is_vip ?? data.data.vip)
        role.value = String(data.data.role || 'USER').toUpperCase()
        // 若後端有回傳 providers，一併寫入（避免另一次請求失敗造成顯示為未綁定）
        try {
          const list = Array.isArray(data?.data?.providers) ? data.data.providers : []
          if (list.length) {
            providers.value = Array.from(new Set(list.map(p => String(p || '').trim().toLowerCase()))).filter(Boolean)
          }
        } catch { }
      }
    } catch (e) {
      if (e?.response?.status === 401) { router.push('/login') }
      else await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
    }
  }

  async function refreshLocalUser() {
    try {
      const { data } = await axios.get(`${API}/whoami`)
      if (data?.ok) {
        setUserProfile(data.data)
        window.dispatchEvent(new Event('auth-changed'))
      }
    } catch { }
  }

  const normalizeGoogleWalletSaveUrl = (value) => {
    try {
      const url = new URL(String(value || ''))
      if (url.protocol !== 'https:' || url.hostname !== 'pay.google.com') return ''
      if (!url.pathname.startsWith('/gp/v/save/')) return ''
      return url.href
    } catch {
      return ''
    }
  }

  async function addToGoogleWallet() {
    if (!form.value.id || addingToGoogleWallet.value) return
    addingToGoogleWallet.value = true
    try {
      const { data } = await axios.post(`${API}/me/google-wallet`)
      const saveUrl = normalizeGoogleWalletSaveUrl(data?.data?.saveUrl)
      if (!data?.ok || !saveUrl) throw new Error(data?.message || '無法建立 Google 錢包會員卡')
      window.location.assign(saveUrl)
    } catch (e) {
      await showNotice(e?.response?.data?.message || e.message || '請稍後再試', { title: '無法加入 Google 錢包' })
    } finally {
      addingToGoogleWallet.value = false
    }
  }

  async function saveProfile() {
    const username = String(form.value.username || '').trim()
    const email = String(form.value.email || '').trim()
    if (!username) { await showNotice('請填寫姓名', { title: '資料不足' }); return }
    if (!email) { await showNotice('電子信箱不得為空白，請聯絡客服處理', { title: '資料不足' }); return }
    form.value.username = username
    form.value.email = email
    savingProfile.value = true
    try {
      const payload = { username }
      payload.phone = normalizePhoneValue(form.value.phone)
      payload.remittanceLast5 = normalizeRemittanceValue(form.value.remittanceLast5)
      const { data } = await axios.patch(`${API}/me`, payload)
      if (data?.ok) { await refreshLocalUser(); await showNotice('已更新基本資料') }
      else await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
    } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
    finally { savingProfile.value = false }
  }

  async function changePassword() {
    if (!pwd.value.current) { await showNotice('請輸入目前密碼', { title: '格式錯誤' }); return }
    savingPwd.value = true
    try {
      const { data } = await axios.post(`${API}/me/password/send_reset`, { currentPassword: pwd.value.current })
      if (data?.ok) { await showNotice('已寄出驗證信，請至信箱點擊連結後設定新密碼'); pwd.value = { current: '', next: '' } }
      else await showNotice(data?.message || '寄送失敗', { title: '寄送失敗' })
    } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
    finally { savingPwd.value = false }
  }

  onMounted(async () => {
    syncTabFromRoute()
    await loadMe()
    if (!providers.value.length) await loadProviders()
  })

  watch(() => route.query.tab, syncTabFromRoute)

  async function logout() {
    try { await axios.post(`${API}/logout`) } catch { }
    finally {
      clearAuthSession()
      window.dispatchEvent(new Event('auth-changed'))
      router.push('/login')
    }
  }

  async function loadProviders() {
    try {
      const { data } = await axios.get(`${API}/auth/providers`)
      const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
      // 正規化：trim + lowercase，並去重，避免舊資料格式影響顯示
      providers.value = Array.from(new Set(list.map(p => String(p || '').trim().toLowerCase()))).filter(Boolean)
    } catch (_) { }
  }

  function linkGoogle() {
    window.location.href = `${API}/auth/google/start?mode=link&redirect=/account`
  }
  async function unlinkGoogle() {
    try {
      const { data } = await axios.delete(`${API}/auth/providers/google`)
      if (data?.ok) { await showNotice('已解除綁定 Google'); await loadProviders() }
      else await showNotice(data?.message || '解除失敗', { title: '解除失敗' })
    } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  }

  function linkLine() {
    window.location.href = `${API}/auth/line/start?mode=link&redirect=/account`
  }
  async function unlinkLine() {
    try {
      const { data } = await axios.delete(`${API}/auth/providers/line`)
      if (data?.ok) { await showNotice('已解除綁定 LINE'); await loadProviders() }
      else await showNotice(data?.message || '解除失敗', { title: '解除失敗' })
    } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  }

  function fileDownload(filename, content) {
    try {
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      setTimeout(() => { try { URL.revokeObjectURL(url); a.remove() } catch { } }, 0)
    } catch { }
  }

  function todayStr() {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}${m}${day}`
  }

  async function exportAccountData() {
    if (!exportPwd.value) { await showNotice('請輸入目前密碼', { title: '需要驗證' }); return }
    exporting.value = true
    try {
      const { data } = await axios.post(`${API}/me/export`, { currentPassword: exportPwd.value })
      if (data?.ok) {
        const json = JSON.stringify(data.data, null, 2)
        fileDownload(`account_export_${todayStr()}.json`, json)
        await showNotice('已下載帳號資料檔')
        exportPwd.value = ''
      } else {
        await showNotice(data?.message || '匯出失敗', { title: '匯出失敗' })
      }
    } catch (e) {
      await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
    } finally {
      exporting.value = false
    }
  }

  async function deleteAccount() {
    if (!deletePwd.value) { await showNotice('請輸入目前密碼', { title: '需要驗證' }); return }
    if (!(await showConfirm('此操作無法復原，確定要永久刪除帳號嗎？', { title: '刪除帳號確認' }))) return
    deleting.value = true
    try {
      const { data } = await axios.post(`${API}/me/delete`, { currentPassword: deletePwd.value })
      if (data?.ok) {
        await showNotice('您的帳號已刪除與匿名化')
        // 清除本地登入狀態並回登入頁
        clearAuthSession()
        window.dispatchEvent(new Event('auth-changed'))
        router.push('/login')
      } else {
        await showNotice(data?.message || '刪除失敗', { title: '刪除失敗' })
      }
    } catch (e) {
      await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
    } finally {
      deleting.value = false
    }
  }
</script>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .member-card-flipper,
  .member-card-face {
    transform: none !important;
    transition: opacity 120ms ease !important;
  }

  .member-card-flipper[data-flipped='true'] .member-card-face:not(.member-card-face--back),
  .member-card-flipper[data-flipped='false'] .member-card-face--back {
    opacity: 0;
    visibility: hidden;
  }

  .member-card-flipper[data-flipped='true'] .member-card-face--back,
  .member-card-flipper[data-flipped='false'] .member-card-face:not(.member-card-face--back) {
    opacity: 1;
    visibility: visible;
  }
}
</style>
