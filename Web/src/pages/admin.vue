<template>
  <main class="admin-page pt-6 pb-12 px-4">
    <div class="max-w-6xl mx-auto">
      <header class="admin-hero bg-white shadow-sm border border-gray-100 mb-8 p-6 pt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between fade-in rounded-2xl">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">管理後台 Dashboard</h1>
          <p class="text-gray-600 mt-1">使用者、商品、活動與訂單管理</p>
        </div>
        <!--
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          <button class="w-full sm:w-auto flex items-center justify-center gap-1 btn btn-outline text-sm"
            @click="refreshActive" :disabled="loading">
            <AppIcon name="refresh" class="h-4 w-4" /> 重新整理
          </button>
        </div>
        -->
      </header>

      <div class="relative mb-6 sticky top-0 z-20 bg-white">
        <!-- Top-level groups -->
        <div class="flex items-center justify-center gap-2 py-2">
          <button
            v-for="g in displayGroupDefs"
            :key="g.key"
            class="px-3 py-1.5 text-sm border rounded transition"
            :class="groupKey === g.key ? 'bg-red-50 border-primary text-primary' : 'border-gray-200 text-gray-600 hover:text-primary'"
            @click="setGroup(g.key)"
          >
            <span class="hidden sm:inline">{{ g.label }}</span>
            <span class="sm:hidden">{{ g.short }}</span>
          </button>
        </div>

        <!-- Tabs within selected group -->
        <div class="relative flex border-b border-gray-200">
          <div class="tab-indicator" :style="indicatorStyle"></div>
          <button
            v-for="(t, i) in visibleTabs"
            :key="t.key"
            class="relative flex-1 px-2 py-2 text-sm sm:px-4 sm:py-3 sm:text-base font-semibold text-center flex items-center gap-1 justify-center"
            :class="tabClass(t.key)"
            @click="setTab(t.key, i)"
          >
            <AppIcon :name="t.icon" class="h-4 w-4" /> {{ t.label }}
          </button>
        </div>
      </div>

      <section v-if="overviewCards.length" class="admin-section admin-section--overview">
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <button
            v-for="card in overviewCards"
            :key="card.key"
            type="button"
            :class="['text-left border shadow-sm px-4 py-4 flex flex-col gap-1 rounded-xl transition focus:outline-none focus:ring-2 focus:ring-primary/40', overviewCardClass(card)]"
            @click="handleOverviewCard(card)"
          >
            <span :class="['uppercase tracking-wide font-semibold', overviewCardLabelClass(card)]">{{ card.label }}</span>
            <span :class="['font-bold', overviewCardValueClass(card)]">{{ card.value }}</span>
            <span v-if="card.hint" :class="['text-sm', overviewCardHintClass(card)]">{{ card.hint }}</span>
          </button>
        </div>
      </section>

      <!-- Users -->
      <section v-if="tab==='users'" class="admin-section slide-up">
        <AppCard>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
            <h2 class="font-bold">使用者列表</h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <input v-model.trim="userQuery" placeholder="搜尋名稱/Email" class="border px-2 py-2 w-full md:w-60" />
              <button class="btn btn-outline btn-sm whitespace-nowrap" @click="cleanupOAuthProviders" :disabled="oauthTools.cleaning">
                <AppIcon name="refresh" class="h-4 w-4" /> 一鍵清理第三方 Provider
              </button>
            </div>
          </div>
          <div v-if="loading" class="text-gray-500">載入中…</div>
          <div v-else>
            <div v-if="filteredUsers.length===0" class="text-gray-500">沒有資料</div>
            <!-- Mobile: Cards -->
            <div class="grid grid-cols-1 gap-3 md:hidden">
              <div v-for="u in filteredUsers" :key="u.id" class="border p-3 bg-white">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="font-semibold text-primary">{{ u.username }}</div>
                    <div class="text-xs text-gray-500 break-all">{{ u.email }}</div>
                    <div class="text-xs text-gray-500 mt-1">ID：<span class="font-mono">{{ u.id }}</span></div>
                    <div class="text-xs text-gray-500">建立：{{ formatDate(u.created_at || u.createdAt) }}</div>
                  </div>
                  <span class="badge">{{ (u.role || 'USER') }}</span>
                </div>
                <div v-if="u._edit && selfRole==='ADMIN'" class="mt-3 grid grid-cols-1 gap-2">
                  <input v-model.trim="u._username" placeholder="名稱" class="border px-2 py-1 w-full" />
                  <input v-model.trim="u._email" placeholder="Email" class="border px-2 py-1 w-full" />
                  <select v-model="u._newRole" class="border px-2 py-1">
                    <option value="USER">USER</option>
                    <option value="STORE">STORE</option>
                    <option value="EDITOR">EDITOR</option>
                    <option value="OPERATOR">OPERATOR</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                  <div class="flex flex-wrap gap-2">
                    <button class="btn btn-primary btn-sm" @click="saveUserProfile(u)" :disabled="u._saving">儲存</button>
                    <button class="btn btn-outline btn-sm" @click="cancelEditUser(u)" :disabled="u._saving">取消</button>
                  </div>
                </div>
                <div v-else class="mt-3 grid grid-cols-2 gap-2">
                  <button class="btn btn-outline btn-sm" @click="startEditUser(u)">編輯</button>
                  <button class="btn btn-outline btn-sm" @click="exportUser(u)"><AppIcon name="copy" class="h-4 w-4" /> 匯出</button>
                  <button class="btn btn-outline btn-sm" @click="resetUserPassword(u)"><AppIcon name="lock" class="h-4 w-4" /> 重設密碼</button>
                  <button class="btn btn-outline btn-sm" @click="openOAuthManager(u)"><AppIcon name="user" class="h-4 w-4" /> 第三方綁定</button>
                  <button class="btn btn-outline btn-sm" @click="deleteUser(u)"><AppIcon name="trash" class="h-4 w-4" /> 刪除</button>
                </div>
              </div>
            </div>
            <!-- Desktop: Table -->
            <div class="overflow-x-auto hidden md:block">
              <table class="min-w-[720px] w-full text-sm table-default">
                <thead class="sticky top-0 z-10">
                  <tr class="bg-gray-50 text-left">
                    <th class="px-3 py-2 border">ID</th>
                    <th class="px-3 py-2 border">名稱</th>
                    <th class="px-3 py-2 border">Email</th>
                    <th class="px-3 py-2 border">角色</th>
                    <th class="px-3 py-2 border">建立時間</th>
                    <th class="px-3 py-2 border">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="u in filteredUsers" :key="u.id" class="hover:bg-gray-50">
                    <td class="px-3 py-2 border font-mono truncate max-w-[240px]" :title="u.id">{{ u.id }}</td>
                    <td class="px-3 py-2 border">
                      <template v-if="u._edit && selfRole==='ADMIN'">
                        <input v-model.trim="u._username" class="border px-2 py-1 w-full" />
                      </template>
                      <template v-else>{{ u.username }}</template>
                    </td>
                    <td class="px-3 py-2 border">
                      <template v-if="u._edit && selfRole==='ADMIN'">
                        <input v-model.trim="u._email" class="border px-2 py-1 w-full" />
                      </template>
                      <template v-else>{{ u.email }}</template>
                    </td>
                    <td class="px-3 py-2 border uppercase">
                      <template v-if="selfRole==='ADMIN'">
                        <template v-if="u._edit">
                          <select v-model="u._newRole" class="border px-2 py-1">
                            <option value="USER">USER</option>
                            <option value="STORE">STORE</option>
                            <option value="EDITOR">EDITOR</option>
                            <option value="OPERATOR">OPERATOR</option>
                            <option value="ADMIN">ADMIN</option>
                          </select>
                        </template>
                        <template v-else>
                          {{ (u.role || 'USER') }}
                        </template>
                      </template>
                      <template v-else>
                        {{ (u.role || 'USER') }}
                      </template>
                    </td>
                    <td class="px-3 py-2 border">{{ formatDate(u.created_at || u.createdAt) }}</td>
                    <td class="px-3 py-2 border">
                      <template v-if="selfRole==='ADMIN'">
                        <div class="flex flex-wrap gap-2">
                          <template v-if="u._edit">
                            <button class="btn btn-primary btn-sm" @click="saveUserProfile(u)" :disabled="u._saving">儲存</button>
                            <button class="btn btn-outline btn-sm" @click="cancelEditUser(u)" :disabled="u._saving">取消</button>
                          </template>
                          <template v-else>
                            <button class="btn btn-outline btn-sm" @click="startEditUser(u)">編輯</button>
                            <button class="btn btn-outline btn-sm" @click="exportUser(u)"><AppIcon name="copy" class="h-4 w-4" /> 匯出</button>
                            <button class="btn btn-outline btn-sm" @click="resetUserPassword(u)"><AppIcon name="lock" class="h-4 w-4" /> 重設密碼</button>
                            <button class="btn btn-outline btn-sm" @click="openOAuthManager(u)"><AppIcon name="user" class="h-4 w-4" /> 第三方綁定</button>
                            <button class="btn btn-outline btn-sm" @click="deleteUser(u)"><AppIcon name="trash" class="h-4 w-4" /> 刪除</button>
                          </template>
                        </div>
                      </template>
                      <template v-else>-</template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </AppCard>
      </section>

      <!-- 封面更換預覽 Modal（全域，供活動/商品共用） -->
      <transition name="backdrop-fade">
        <div v-if="coverConfirm.visible" class="fixed inset-0 bg-black/40 z-50" @click.self="!coverConfirm.uploading && closeCoverConfirm()"></div>
      </transition>
      <transition name="sheet-pop">
        <div v-if="coverConfirm.visible" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel rounded-t-2xl" style="padding-bottom: env(safe-area-inset-bottom)">
          <div class="relative p-4 sm:p-5 space-y-3">
            <button class="btn-ghost absolute top-3 right-3" title="關閉" @click="closeCoverConfirm" :disabled="coverConfirm.uploading"><AppIcon name="x" class="h-5 w-5" /></button>
            <div class="mx-auto h-1.5 w-10 bg-gray-300"></div>
            <h3 class="font-semibold text-primary">確認更換封面</h3>
            <p class="text-sm text-gray-600">目標：{{ coverConfirm.name }}（固定裁切為 900×600）</p>
            <div class="relative border aspect-[3/2] w-full overflow-hidden bg-gray-50">
              <img :src="coverConfirm.dataUrl" alt="預覽" class="w-full h-full object-cover" />
              <div v-if="coverConfirm.uploading" class="cover-upload-overlay">
                <div class="cover-upload-overlay__content">
                  <span class="upload-spinner" aria-hidden="true"></span>
                  <span class="cover-upload-text">
                    {{ coverConfirm.uploadMessage || '圖片上傳中…' }}
                  </span>
                  <div v-if="coverConfirm.uploadProgress > 0" class="upload-progress">
                    <div class="upload-progress__bar">
                      <div class="upload-progress__fill" :style="{ width: `${Math.min(coverConfirm.uploadProgress, 100)}%` }"></div>
                    </div>
                    <span class="upload-progress__value">
                      {{ Math.min(coverConfirm.uploadProgress, 100) }}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div class="mt-1 flex flex-col sm:flex-row gap-2">
              <button class="btn btn-primary w-full sm:w-auto" @click="confirmCoverApply" :disabled="coverConfirm.uploading">
                <template v-if="coverConfirm.uploading">
                  <span class="btn-spinner" aria-hidden="true"></span>
                  上傳中…
                </template>
                <template v-else>
                  <AppIcon name="check" class="h-4 w-4" /> 確定更換
                </template>
              </button>
              <button class="btn btn-outline w-full sm:w-auto" @click="closeCoverConfirm" :disabled="coverConfirm.uploading">
                <AppIcon name="x" class="h-4 w-4" /> 取消
              </button>
            </div>
          </div>
        </div>
      </transition>

      <!-- Scan (Operator) -->
      <section v-if="tab==='scan'" class="admin-section slide-up">
        <AppCard>
          <header class="rounded border border-gray-200 bg-white px-4 py-5 sm:px-6">
            <h2 class="text-lg font-semibold text-gray-900">掃描 QR 更新預約</h2>
            <p class="mt-1 text-sm text-gray-600">僅供操作員使用的快速掃描工具。</p>
          </header>
          <p v-if="scan.error" class="mt-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {{ scan.error }}
          </p>
          <div class="mt-6 grid gap-6 md:grid-cols-2">
            <section class="flex flex-col">
              <p class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">即時掃描</p>
              <div class="relative aspect-[16/10] overflow-hidden border border-gray-200 bg-slate-900">
                <video ref="scanVideo" autoplay playsinline class="h-full w-full object-cover"></video>
                <div class="pointer-events-none absolute inset-[8%] border-2 border-white/60 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]"></div>
                <div
                  v-if="scan.scanning"
                  class="absolute left-[16%] right-[16%] h-0.5 bg-gradient-to-r from-transparent via-red-700/90 to-transparent animate-scan-sweep top-[18%]"
                ></div>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <button class="btn btn-primary btn-sm" @click="openScan" :disabled="scan.scanning || !!scan.review">開始掃描</button>
                <button class="btn btn-outline btn-sm" @click="closeScan" :disabled="!scan.scanning">停止掃描</button>
              </div>
              <p class="mt-3 text-sm text-gray-500">掃描後會顯示檢核內容，確認無誤再推進下一階段。</p>
            </section>

            <section class="flex flex-col">
              <p class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">備援工具</p>
              <div class="flex flex-col gap-4 border border-gray-200 bg-white p-4">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    v-model.trim="scan.manual"
                    placeholder="輸入 6 碼驗證碼"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    class="min-w-0 flex-1 border border-gray-300 px-4 py-3 font-mono text-base tracking-[0.18em] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <button class="btn btn-primary w-full sm:w-auto" @click="submitManual" :disabled="!scan.manual || !!scan.review">送出</button>
                </div>
                <ul class="flex flex-col gap-2 text-sm text-gray-600">
                  <li class="flex items-center gap-2"><AppIcon name="check" class="h-4 w-4" /> 確認預約顯示的當前階段與掃描碼一致</li>
                  <li class="flex items-center gap-2"><AppIcon name="refresh" class="h-4 w-4" /> 若顯示階段錯誤，可請會員重新開啟最新 QR</li>
                  <li class="flex items-center gap-2"><AppIcon name="shield" class="h-4 w-4" /> 成功後系統會寄出 LINE / Email 通知</li>
                </ul>
              </div>
            </section>

            <section v-if="scan.review" class="md:col-span-2">
              <p class="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">檢核確認</p>
              <div class="flex flex-col gap-4 border border-gray-200 bg-slate-50 p-5">
                <div class="flex flex-wrap items-center gap-2 font-semibold text-gray-800">
                  <span class="rounded bg-red-100 px-2 py-1 text-sm text-red-700">{{ scan.review.stageLabel || checklistStageName(scan.review.stage) }}</span>
                  <AppIcon name="arrow-right" class="h-4 w-4 text-gray-400" />
                  <span class="rounded bg-blue-100 px-2 py-1 text-sm text-blue-700">{{ scan.review.nextStageLabel || '完成' }}</span>
                </div>
                <dl class="grid gap-4 text-sm text-slate-600 md:grid-cols-2">
                  <div>
                    <dt class="text-[0.7rem] uppercase tracking-[0.08em] text-slate-400">活動</dt>
                    <dd>{{ scan.review.reservation?.event || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-[0.7rem] uppercase tracking-[0.08em] text-slate-400">門市</dt>
                    <dd>{{ scan.review.reservation?.store || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-[0.7rem] uppercase tracking-[0.08em] text-slate-400">會員</dt>
                    <dd>{{ scan.review.reservation?.username || scan.review.reservation?.email || scan.review.reservation?.user_id || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-[0.7rem] uppercase tracking-[0.08em] text-slate-400">檢核狀態</dt>
                    <dd class="flex flex-wrap items-center gap-2">
                      <span v-if="scan.review.checklistReady" class="font-medium text-green-600">已完成</span>
                      <span v-else class="font-medium text-red-600">尚未完成</span>
                      <span class="text-gray-500">（照片 {{ scan.review.checklist?.photoCount || 0 }} 張）</span>
                    </dd>
                  </div>
                </dl>
                <div>
                  <h4 class="text-base font-semibold text-slate-900">{{ scan.review.checklist?.title || checklistStageName(scan.review.stage) }}</h4>
                  <ul class="mt-3 flex flex-col gap-2 text-sm text-slate-700">
                    <li v-for="item in scan.review.checklist?.items" :key="item.label" class="flex items-center gap-2">
                      <AppIcon :name="item.checked ? 'check' : 'x'" class="h-4 w-4" :class="item.checked ? 'text-green-500' : 'text-red-500'" />
                      <span>{{ item.label }}</span>
                    </li>
                  </ul>
                </div>
                <div v-if="ensureChecklistPhotos(scan.review.checklist)" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <button
                    v-for="photo in scan.review.checklist.photos"
                    :key="photo.id"
                    type="button"
                    class="group relative overflow-hidden border border-slate-300 bg-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-primary/40 hover:border-primary"
                    @click="previewChecklistPhoto(photo, scan.review.reservation?.id, scan.review.stage, { checklist: scan.review.checklist, reservation: scan.review.reservation })"
                  >
                    <img
                      :src="adminChecklistPhotoSrc(photo, scan.review.reservation?.id, scan.review.stage)"
                      :alt="photo.originalName || '檢核照片'"
                      class="h-24 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                      crossorigin="use-credentials"
                    />
                  </button>
                </div>
                <p v-if="!scan.review.checklistReady" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  此階段檢核尚未完成或缺少照片，請會員補齊後再繼續。
                </p>
                <div class="flex flex-wrap gap-3">
                  <button class="btn btn-primary flex-1 min-w-[160px]" @click="confirmScanReview" :disabled="scan.confirming || !scan.review.checklistReady">
                    <AppIcon v-if="scan.confirming" name="refresh" class="h-4 w-4 animate-spin" />
                    <span>{{ checklistStageCompletionLabel(scan.review.stage) }}</span>
                  </button>
                  <button class="btn btn-outline flex-1 min-w-[160px]" @click="cancelScanReview" :disabled="scan.confirming">返回重新掃描</button>
                </div>
              </div>
            </section>
          </div>
        </AppCard>
      </section>

      <!-- 第三方綁定管理（Admin） -->
      <transition name="backdrop-fade">
        <div v-if="oauthPanel.visible" class="fixed inset-0 bg-black/40 z-50" @click.self="closeOAuthManager"></div>
      </transition>
      <transition name="sheet-pop">
        <div v-if="oauthPanel.visible" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel rounded-t-2xl" style="padding-bottom: env(safe-area-inset-bottom)">
          <div class="relative p-4 sm:p-5 space-y-4">
            <button class="btn-ghost absolute top-3 right-3" title="關閉" @click="closeOAuthManager"><AppIcon name="x" class="h-5 w-5" /></button>
            <div class="mx-auto h-1.5 w-10 bg-gray-300"></div>
            <h3 class="font-semibold text-primary">管理第三方綁定</h3>
            <p class="text-sm text-gray-600">使用者：<span class="font-mono">{{ oauthPanel.user?.username || oauthPanel.user?.email || oauthPanel.user?.id }}</span></p>

            <div class="space-y-2">
              <div class="font-semibold">已綁定</div>
              <div v-if="oauthPanel.loading" class="text-gray-500">載入中…</div>
              <div v-else>
                <div v-if="oauthPanel.list.length===0" class="text-gray-500">沒有綁定紀錄</div>
                <div v-else class="space-y-2">
                  <div v-for="it in oauthPanel.list" :key="it.id" class="flex items-center justify-between border p-2">
                    <div class="text-sm">
                      <div>Provider：<span class="uppercase font-semibold">{{ it.provider }}</span></div>
                      <div class="font-mono break-all">subject：{{ it.subject }}</div>
                      <div class="text-xs text-gray-600 break-all" v-if="it.email">email：{{ it.email }}</div>
                    </div>
                    <button class="btn btn-outline btn-sm" @click="removeOAuthBinding(it)">解除</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <div class="font-semibold">新增綁定</div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select v-model="oauthPanel.form.provider" class="border px-2 py-2">
                  <option value="line">LINE</option>
                  <option value="google">Google</option>
                </select>
                <input v-model.trim="oauthPanel.form.subject" placeholder="subject（LINE userId / Google sub）" class="border px-2 py-2" />
                <input v-model.trim="oauthPanel.form.email" placeholder="email（選填，用於顯示）" class="border px-2 py-2" />
              </div>
              <div class="flex gap-2">
                <button class="btn btn-primary" @click="addOAuthBinding" :disabled="oauthPanel.saving">新增綁定</button>
                <button class="btn btn-outline" @click="reloadOAuthList" :disabled="oauthPanel.loading"><AppIcon name="refresh" class="h-4 w-4" /> 重新整理</button>
              </div>
              <p class="text-xs text-gray-500">注意：同一 provider+subject 僅能綁定一個帳號。</p>
            </div>
          </div>
        </div>
      </transition>

      

      <!-- Reservations -->
      <section v-if="tab==='reservations'" class="admin-section slide-up">
        <AppCard>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
          <h2 class="font-bold">預約狀態管理</h2>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <input v-model.trim="reservationQuery" placeholder="搜尋 ID / 姓名 / Email / 賽事 / 門市 / 票種 / 狀態" class="border px-2 py-2 text-sm w-full sm:w-80" @keydown.enter.prevent="performReservationSearch" />
            <button class="btn btn-outline text-sm w-full sm:w-auto" @click="performReservationSearch" :disabled="reservationsLoading"><AppIcon name="refresh" class="h-4 w-4" /> 搜尋 / 重新整理</button>
            <button v-if="hasReservationFilters" class="btn btn-outline text-sm w-full sm:w-auto" @click="clearReservationFilters" :disabled="reservationsLoading">
              <AppIcon name="x" class="h-4 w-4" /> 清除篩選
            </button>
            <button class="btn btn-primary text-sm w-full sm:w-auto" @click="openScan"><AppIcon name="camera" class="h-4 w-4" /> 掃描 QR 進度</button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 mb-3">
          <button
            v-for="item in reservationStatusSummary"
            :key="`reservation-filter-${item.key}`"
            class="px-3 py-1 text-sm border transition"
            :class="reservationStatusFilter === item.key ? 'bg-primary text-white border-primary shadow-sm' : 'border-gray-200 text-gray-600 hover:border-primary hover:text-primary'"
            @click="reservationStatusFilter = item.key"
          >
            {{ item.label }}
            <span class="ml-1 text-xs text-gray-500">({{ item.count }})</span>
          </button>
        </div>
        <div v-if="reservationsLoading" class="text-gray-500">載入中…</div>
        <div v-else>
          <div v-if="adminReservations.length===0" class="text-gray-500">沒有資料</div>
          <!-- Mobile: Cards -->
          <div class="grid grid-cols-1 gap-3 md:hidden">
            <div v-for="r in filteredAdminReservations" :key="r.id" class="border p-3 bg-white">
              <div class="flex items-start justify-between mb-2">
                <div>
                  <div class="font-semibold text-primary">{{ r.event }}</div>
                  <div class="text-xs text-gray-600">使用者：{{ r.username }}（{{ r.email }}）</div>
                  <div class="text-xs text-gray-600">門市：{{ r.store }}</div>
                  <div class="text-xs text-gray-600">票種：{{ r.ticket_type }}</div>
                  <div class="text-xs text-gray-500">時間：{{ formatDate(r.reserved_at) }}</div>
                </div>
                <span class="badge">{{ r.status }}</span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select v-model="r.newStatus" class="border px-2 py-1">
                  <option v-for="opt in reservationStatusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
                <div class="flex gap-2">
                  <button class="btn btn-primary btn-sm flex-1" @click="saveReservationStatus(r)" :disabled="r.saving">儲存</button>
                  <button class="btn btn-outline btn-sm flex-1" @click="openReservationDetail(r)">檢核紀錄</button>
                </div>
              </div>
            </div>
          </div>
          <!-- Desktop: Panels -->
          <div class="hidden md:flex md:flex-col gap-3">
            <div
              v-for="r in filteredAdminReservations"
              :key="r.id"
              class="border border-gray-200 bg-white rounded-lg p-4 shadow-sm"
            >
              <div class="flex flex-wrap gap-4">
                <div class="grid flex-1 min-w-[280px] grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-3 xl:grid-cols-4">
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">ID</div>
                    <div class="mt-1 font-mono text-sm text-gray-900 break-all">{{ r.id }}</div>
                  </div>
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">使用者</div>
                    <div class="mt-1 text-sm text-gray-900">
                      {{ r.username }}
                      <div class="text-xs text-gray-500 break-all">{{ r.email }}</div>
                    </div>
                  </div>
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">賽事</div>
                    <div class="mt-1 text-sm text-gray-900">{{ r.event }}</div>
                  </div>
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">門市</div>
                    <div class="mt-1 text-sm text-gray-900">{{ r.store }}</div>
                  </div>
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">票種</div>
                    <div class="mt-1 text-sm text-gray-900">{{ r.ticket_type }}</div>
                  </div>
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">預約時間</div>
                    <div class="mt-1 text-sm text-gray-900">{{ formatDate(r.reserved_at) }}</div>
                  </div>
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">驗證碼</div>
                    <div class="mt-1 font-mono text-sm text-gray-900">{{ r.stage_verify_code || '-' }}</div>
                  </div>
                </div>
                <div class="flex flex-col gap-3 w-full md:w-60">
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">狀態</div>
                    <select v-model="r.newStatus" class="mt-1 border px-2 py-1 text-sm w-full">
                      <option v-for="opt in reservationStatusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                    </select>
                    <div class="mt-1 text-xs text-gray-500">目前：<span class="font-semibold text-gray-700">{{ r.status }}</span></div>
                    <div class="mt-2">
                      <span class="badge">{{ r.status }}</span>
                    </div>
                  </div>
                  <div class="flex flex-col gap-2">
                    <button class="btn btn-primary btn-sm w-full" @click="saveReservationStatus(r)" :disabled="r.saving">儲存</button>
                    <button class="btn btn-outline btn-sm w-full" @click="openReservationDetail(r)">檢核紀錄</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="adminReservationsMeta.total > adminReservationsMeta.limit || adminReservationTotalPages > 1" class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-4">
            <div class="text-sm text-gray-600">
              共 {{ adminReservationsMeta.total }} 筆，頁面 {{ adminReservationCurrentPage }} / {{ adminReservationTotalPages }}
            </div>
            <div class="flex gap-2">
              <button class="btn btn-outline btn-sm" @click="goAdminReservationPrev" :disabled="!adminReservationsHasPrev || reservationsLoading">
                上一頁
              </button>
              <button class="btn btn-outline btn-sm" @click="goAdminReservationNext" :disabled="!adminReservationsHasNext || reservationsLoading">
                下一頁
              </button>
            </div>
          </div>
        </div>
        </AppCard>
      </section>

      <!-- Tickets -->
      <section v-if="tab==='tickets'" class="admin-section slide-up">
        <AppCard>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
            <h2 class="font-bold">票券追蹤</h2>
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
              <input v-model.trim="ticketQuery" placeholder="搜尋 ID / UUID / 姓名 / Email / 票種" class="border px-2 py-2 text-sm w-full sm:w-72" @keydown.enter.prevent="performTicketSearch()" />
              <select v-model="ticketStatusFilter" class="border px-2 py-2 text-sm w-full sm:w-auto">
                <option value="all">全部狀態</option>
                <option value="available">可用</option>
                <option value="used">已使用</option>
                <option value="expired">已過期</option>
              </select>
              <button class="btn btn-outline text-sm w-full sm:w-auto" @click="performTicketSearch()" :disabled="ticketsLoading">
                <AppIcon name="refresh" class="h-4 w-4" /> 搜尋 / 重新整理
              </button>
              <button v-if="hasTicketFilters" class="btn btn-outline text-sm w-full sm:w-auto" @click="clearTicketFilters" :disabled="ticketsLoading">
                <AppIcon name="x" class="h-4 w-4" /> 清除篩選
              </button>
            </div>
          </div>
<!--
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div class="border shadow-sm p-4 bg-white rounded-xl">
              <div class="text-xs text-gray-500 uppercase font-semibold">總票券</div>
              <div class="text-2xl font-bold text-gray-900">{{ ticketSummary.total }}</div>
              <div class="text-xs text-gray-500">累積所有票券</div>
            </div>
            <div class="border shadow-sm p-4 bg-white rounded-xl">
              <div class="text-xs text-gray-500 uppercase font-semibold">可用</div>
              <div class="text-2xl font-bold text-green-600">{{ ticketSummary.available }}</div>
              <div class="text-xs text-gray-500">未過期且未使用</div>
            </div>
            <div class="border shadow-sm p-4 bg-white rounded-xl">
              <div class="text-xs text-gray-500 uppercase font-semibold">已使用</div>
              <div class="text-2xl font-bold text-gray-600">{{ ticketSummary.used }}</div>
              <div class="text-xs text-gray-500">使用者已核銷</div>
            </div>
            <div class="border shadow-sm p-4 bg-white rounded-xl">
              <div class="text-xs text-gray-500 uppercase font-semibold">已過期</div>
              <div class="text-2xl font-bold text-red-600">{{ ticketSummary.expired }}</div>
              <div class="text-xs text-gray-500">未使用但已過期</div>
            </div>
          </div>
-->
          <div v-if="ticketsLoading" class="text-gray-500">載入中…</div>
          <div v-else>
            <div v-if="adminTickets.length===0" class="text-gray-500">沒有資料</div>
            <div v-else class="overflow-x-auto">
              <table class="min-w-[960px] w-full text-sm table-default">
                <thead class="sticky top-0 z-10">
                  <tr class="bg-gray-50 text-left">
                    <th class="px-3 py-2 border">ID / UUID</th>
                    <th class="px-3 py-2 border">票券資訊</th>
                    <th class="px-3 py-2 border">持有人</th>
                    <th class="px-3 py-2 border">建立時間</th>
                    <th class="px-3 py-2 border">狀態</th>
                    <th class="px-3 py-2 border">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in adminTickets" :key="row.id">
                    <td class="px-3 py-2 border align-top">
                      <div class="font-mono text-xs text-gray-500">#{{ row.id }}</div>
                      <div class="font-mono text-xs text-gray-500 break-all">{{ row.uuid }}</div>
                    </td>
                    <td class="px-3 py-2 border align-top">
                      <div class="font-semibold text-primary">{{ row.type || '未命名票券' }}</div>
                      <div class="text-xs text-gray-500">折扣：{{ row.discount || 0 }}</div>
                    </td>
                    <td class="px-3 py-2 border align-top">
                      <div class="font-semibold">{{ row.username || '未綁定' }}</div>
                      <div class="text-xs text-gray-500 break-all">{{ row.email || '—' }}</div>
                    </td>
                    <td class="px-3 py-2 border align-top">
                      <div class="text-sm text-gray-700">{{ formatDate(row.created_at) }}</div>
                    </td>
                    <td class="px-3 py-2 border align-top">
                      <span class="badge" :class="row.badgeClass">{{ row.statusLabel }}</span>
                      <div v-if="row.expiryText" class="text-xs text-gray-500 mt-1">{{ row.expiryText }}</div>
                    </td>
                    <td class="px-3 py-2 border align-top">
                      <div class="flex flex-col gap-2">
                        <button class="btn btn-outline btn-sm w-full" @click="openTicketDetail(row)">檢視 / 編輯</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="adminTicketsMeta.total > adminTicketsMeta.limit" class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-4">
              <div class="text-sm text-gray-600">共 {{ adminTicketsMeta.total }} 張，頁面 {{ adminTicketsCurrentPage }} / {{ adminTicketsTotalPages }}</div>
              <div class="flex gap-2">
                <button class="btn btn-outline btn-sm" @click="goAdminTicketPrev" :disabled="!adminTicketsHasPrev || ticketsLoading">上一頁</button>
                <button class="btn btn-outline btn-sm" @click="goAdminTicketNext" :disabled="!adminTicketsHasNext || ticketsLoading">下一頁</button>
              </div>
            </div>
          </div>
        </AppCard>
      </section>

      <!-- 掃描 QR 進度：底部抽屜 -->
      <transition name="backdrop-fade">
        <div v-if="scan.open" class="fixed inset-0 bg-black/40 z-50" @click.self="closeScan"></div>
      </transition>
      <transition name="sheet-pop">
        <div v-if="scan.open" class="fixed inset-x-0 bottom-0 z-50 max-h-[90vh] bg-white border-t shadow-lg sheet-panel rounded-t-2xl">
          <div class="relative flex max-h-full flex-col min-h-0">
            <button class="btn-ghost absolute right-3 top-3 text-gray-500 hover:text-gray-700" title="關閉" @click="closeScan">
              <AppIcon name="x" class="h-5 w-5" />
            </button>
            <div class="mx-auto mt-2 h-1.5 w-10 bg-gray-300"></div>
            <div class="flex-1 min-h-0 overflow-y-auto px-4 pb-6 pt-6 sm:px-6">
              <header class="rounded border border-gray-200 bg-white px-4 py-4 sm:px-6">
                <h3 class="text-lg font-semibold text-gray-900">掃描 QR 更新預約</h3>
                <p class="mt-1 text-sm text-gray-600">掃描後請確認檢核內容，再推進下一階段。</p>
              </header>
              <p v-if="scan.error" class="mt-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {{ scan.error }}
              </p>

              <div class="mt-6 grid gap-6 md:grid-cols-2">
                <section class="flex flex-col">
                  <p class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">即時掃描</p>
                  <div class="relative aspect-[16/10] overflow-hidden border border-gray-200 bg-slate-900">
                    <video ref="scanVideo" autoplay playsinline class="h-full w-full object-cover"></video>
                    <div class="pointer-events-none absolute inset-[8%] border-2 border-white/60 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]"></div>
                    <div
                      v-if="scan.scanning"
                      class="absolute left-[16%] right-[16%] h-0.5 bg-gradient-to-r from-transparent via-red-700/90 to-transparent animate-scan-sweep top-[18%]"
                    ></div>
                  </div>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button class="btn btn-primary btn-sm" @click="openScan" :disabled="scan.scanning || !!scan.review">開始掃描</button>
                    <button class="btn btn-outline btn-sm" @click="closeScan" :disabled="!scan.scanning">停止掃描</button>
                  </div>
                  <p class="mt-3 text-sm text-gray-500">掃描完成後會顯示檢核表，確認無誤再繼續。</p>
                </section>

                <section class="flex flex-col">
                  <p class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">備援工具</p>
                  <div class="flex flex-col gap-4 border border-gray-200 bg-white p-4">
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <input
                        v-model.trim="scan.manual"
                        placeholder="輸入 6 碼驗證碼"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        class="min-w-0 flex-1 border border-gray-300 px-4 py-3 font-mono text-base tracking-[0.18em] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                      />
                      <button class="btn btn-primary w-full sm:w-auto" @click="submitManual" :disabled="!scan.manual || !!scan.review">送出</button>
                    </div>
                    <ul class="flex flex-col gap-2 text-sm text-gray-600">
                      <li class="flex items-center gap-2"><AppIcon name="check" class="h-4 w-4" /> 確認預約顯示的當前階段與掃描碼一致</li>
                      <li class="flex items-center gap-2"><AppIcon name="refresh" class="h-4 w-4" /> 若顯示階段錯誤，可請會員重新開啟最新 QR</li>
                      <li class="flex items-center gap-2"><AppIcon name="shield" class="h-4 w-4" /> 成功後系統會寄出 LINE / Email 通知</li>
                    </ul>
                  </div>
                </section>

                <section v-if="scan.review" class="md:col-span-2">
                  <p class="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">檢核確認</p>
                  <div class="flex flex-col gap-4 border border-gray-200 bg-slate-50 p-5">
                    <div class="flex flex-wrap items-center gap-2 font-semibold text-gray-800">
                      <span class="rounded bg-red-100 px-2 py-1 text-sm text-red-700">{{ scan.review.stageLabel || checklistStageName(scan.review.stage) }}</span>
                      <AppIcon name="arrow-right" class="h-4 w-4 text-gray-400" />
                      <span class="rounded bg-blue-100 px-2 py-1 text-sm text-blue-700">{{ scan.review.nextStageLabel || '完成' }}</span>
                    </div>
                    <dl class="grid gap-4 text-sm text-slate-600 md:grid-cols-2">
                      <div>
                        <dt class="text-[0.7rem] uppercase tracking-[0.08em] text-slate-400">活動</dt>
                        <dd>{{ scan.review.reservation?.event || '—' }}</dd>
                      </div>
                      <div>
                        <dt class="text-[0.7rem] uppercase tracking-[0.08em] text-slate-400">門市</dt>
                        <dd>{{ scan.review.reservation?.store || '—' }}</dd>
                      </div>
                      <div>
                        <dt class="text-[0.7rem] uppercase tracking-[0.08em] text-slate-400">會員</dt>
                        <dd>{{ scan.review.reservation?.username || scan.review.reservation?.email || scan.review.reservation?.user_id || '—' }}</dd>
                      </div>
                      <div>
                        <dt class="text-[0.7rem] uppercase tracking-[0.08em] text-slate-400">檢核狀態</dt>
                        <dd class="flex flex-wrap items-center gap-2">
                          <span v-if="scan.review.checklistReady" class="font-medium text-green-600">已完成</span>
                          <span v-else class="font-medium text-red-600">尚未完成</span>
                          <span class="text-gray-500">（照片 {{ scan.review.checklist?.photoCount || 0 }} 張）</span>
                        </dd>
                      </div>
                    </dl>
                    <div>
                      <h4 class="text-base font-semibold text-slate-900">{{ scan.review.checklist?.title || checklistStageName(scan.review.stage) }}</h4>
                      <ul class="mt-3 flex flex-col gap-2 text-sm text-slate-700">
                        <li v-for="item in scan.review.checklist?.items" :key="item.label" class="flex items-center gap-2">
                          <AppIcon :name="item.checked ? 'check' : 'x'" class="h-4 w-4" :class="item.checked ? 'text-green-500' : 'text-red-500'" />
                          <span>{{ item.label }}</span>
                        </li>
                      </ul>
                    </div>
                    <div v-if="ensureChecklistPhotos(scan.review.checklist)" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <button
                        v-for="photo in scan.review.checklist.photos"
                        :key="photo.id"
                        type="button"
                        class="group relative overflow-hidden border border-slate-300 bg-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-primary/40 hover:border-primary"
                        @click="previewChecklistPhoto(photo, scan.review.reservation?.id, scan.review.stage, { checklist: scan.review.checklist, reservation: scan.review.reservation })"
                      >
                        <img
                          :src="adminChecklistPhotoSrc(photo, scan.review.reservation?.id, scan.review.stage)"
                          :alt="photo.originalName || '檢核照片'"
                          class="h-24 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                          crossorigin="use-credentials"
                        />
                      </button>
                    </div>
                    <p v-if="!scan.review.checklistReady" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      此階段檢核尚未完成或缺少照片，請會員補齊後再繼續。
                    </p>
                    <div class="flex flex-wrap gap-3">
                      <button class="btn btn-primary flex-1 min-w-[160px]" @click="confirmScanReview" :disabled="scan.confirming || !scan.review.checklistReady">
                        <AppIcon v-if="scan.confirming" name="refresh" class="h-4 w-4 animate-spin" />
                        <span>{{ checklistStageCompletionLabel(scan.review.stage) }}</span>
                      </button>
                      <button class="btn btn-outline flex-1 min-w-[160px]" @click="cancelScanReview" :disabled="scan.confirming">返回重新掃描</button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </transition>

      <!-- 圖片預覽 -->
      <transition name="backdrop-fade">
        <div
          v-if="imagePreview.open"
          class="fixed inset-0 z-99 flex items-center justify-center bg-black/70 px-4 py-8"
          @click.self="closeImagePreview"
        >
          <div class="relative w-full max-w-4xl overflow-hidden border border-white/20 bg-black/80 shadow-2xl">
            <button
              class="btn-ghost absolute right-3 top-3 text-white/80 hover:text-white"
              title="關閉"
              @click="closeImagePreview"
              type="button"
            >
              <AppIcon name="x" class="h-5 w-5" />
            </button>
            <img
              :src="imagePreview.src"
              :alt="imagePreview.title || '檢核照片預覽'"
              class="max-h-[75vh] w-full object-contain"
              crossorigin="use-credentials"
            />
            <div class="border-t border-white/10 bg-black/60 px-4 py-3 text-sm text-gray-100">
              <div v-if="imagePreview.title" class="font-semibold">{{ imagePreview.title }}</div>
              <div v-if="imagePreview.subtitle" class="mt-1 text-xs text-gray-300">{{ imagePreview.subtitle }}</div>
              <div v-if="imagePreview.meta?.uploadedAt || imagePreview.meta?.originalName" class="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-400">
                <span v-if="imagePreview.meta?.uploadedAt">上傳：{{ imagePreview.meta.uploadedAt }}</span>
                <span v-if="imagePreview.meta?.originalName" class="truncate">原檔名：{{ imagePreview.meta.originalName }}</span>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <a
                  v-if="imagePreview.downloadUrl"
                  :href="imagePreview.downloadUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-outline btn-sm text-xs"
                >
                  新分頁開啟
                </a>
                <button class="btn btn-primary btn-sm text-xs" type="button" @click="closeImagePreview">關閉預覽</button>
              </div>
            </div>
          </div>
        </div>
      </transition>

      <!-- Products -->
      <section v-if="tab==='products'" class="admin-section slide-up">
        <AppCard>
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-4">
          <div class="space-y-1">
            <h2 class="font-bold">商品列表</h2>
            <div class="flex flex-wrap gap-2 text-xs text-gray-600">
              <span class="badge gray">共 {{ productStats.total }} 項</span>
              <span v-if="productStats.zeroPrice" class="badge gray">免費 {{ productStats.zeroPrice }}</span>
              <span v-if="productStats.missingDesc" class="badge gray">缺描述 {{ productStats.missingDesc }}</span>
              <span v-if="productStats.total" class="badge gray">平均 {{ formatCurrency(productStats.avgPrice) }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap w-full md:w-auto">
            <div class="relative w-full md:w-64">
              <AppIcon name="search" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input v-model.trim="productQuery" placeholder="搜尋名稱/編號/描述" class="border px-3 py-2 text-sm w-full rounded-md pl-9 focus:border-primary focus:ring-2 focus:ring-primary/20" />
              <button v-if="productQuery" class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700" @click="productQuery=''">清除</button>
            </div>
            <select v-model="productSort" class="border px-2 py-2 text-sm rounded-md focus:border-primary focus:ring-1 focus:ring-primary/30">
              <option value="recent">最新在前</option>
              <option value="name">名稱 A → Z</option>
              <option value="price-desc">價格：高到低</option>
              <option value="price-asc">價格：低到高</option>
            </select>
            <button class="btn btn-outline text-sm" @click="showProductForm = !showProductForm"><AppIcon name="plus" class="h-4 w-4" /> {{ showProductForm ? '收合表單' : '新增商品' }}</button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 mb-3">
          <button
            class="px-3 py-1 text-xs border rounded-full transition"
            :class="productFilters.onlyFree ? 'bg-primary text-white border-primary shadow-sm' : 'border-gray-200 text-gray-600 hover:border-primary hover:text-primary'"
            @click="toggleProductFilter('onlyFree')"
          >
            只看免費項目
          </button>
          <button
            class="px-3 py-1 text-xs border rounded-full transition"
            :class="productFilters.onlyMissingDesc ? 'bg-primary text-white border-primary shadow-sm' : 'border-gray-200 text-gray-600 hover:border-primary hover:text-primary'"
            @click="toggleProductFilter('onlyMissingDesc')"
          >
            需要描述
          </button>
          <button
            v-if="hasProductFilters"
            class="px-3 py-1 text-xs border border-gray-200 rounded-full text-gray-600 hover:border-primary hover:text-primary"
            @click="resetProductFilters"
          >
            清除篩選
          </button>
        </div>
        <div v-if="showProductForm" class="mb-4 border p-3 bg-gray-50 rounded-md">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input v-model.trim="newProduct.name" placeholder="名稱" class="border px-2 py-1" />
            <input v-model.number="newProduct.price" type="number" min="0" step="1" placeholder="價格" class="border px-2 py-1" />
            <input v-model.trim="newProduct.description" placeholder="描述" class="border px-2 py-1" />
          </div>
          <div class="mt-2 flex gap-2">
            <button class="btn btn-primary text-sm" @click="createProduct" :disabled="loading">儲存</button>
            <button class="btn btn-outline text-sm" @click="showProductForm=false">取消</button>
          </div>
        </div>
        <div v-if="loading" class="text-gray-500">載入中…</div>
        <div v-else>
          <div v-if="products.length===0" class="text-gray-500">沒有資料</div>
          <div v-else-if="!filteredProducts.length" class="text-gray-500">沒有符合搜尋或篩選的商品，請調整條件。</div>
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <AppCard v-for="p in filteredProducts" :key="p.id || p.name" :cover-src="productCoverUrl(p)">
              <div class="flex flex-col gap-2">
              <!-- View mode -->
              <template v-if="!p._editing">
                <div class="flex items-center gap-2 flex-wrap">
                  <div class="font-semibold text-primary">{{ p.name }}</div>
                  <span v-if="p.code" class="badge gray font-mono flex items-center gap-1">商品編號 {{ p.code }}
                    <button class="btn-ghost" title="複製" @click.stop="copyToClipboard(p.code)"><AppIcon name="copy" class="h-4 w-4" /></button>
                  </span>
                </div>
                <div class="flex flex-wrap gap-2 text-xs">
                  <span v-if="Number(p.price) === 0" class="badge gray">免費項目</span>
                  <span v-if="!(p.description || '').trim()" class="badge gray">缺描述</span>
                </div>
                <div class="text-gray-600 text-sm min-h-[2.5rem]">
                  <span v-if="p.description && p.description.trim()">{{ p.description }}</span>
                  <span v-else class="text-gray-400 italic">尚未填寫描述</span>
                </div>
                <div class="mt-1 font-semibold text-lg text-gray-900">{{ formatCurrency(p.price) }}</div>
                <div class="mt-2 flex flex-wrap gap-2 items-center">
                  <button class="btn btn-outline text-sm" @click="startEditProduct(p)"><AppIcon name="edit" class="h-4 w-4" /> 編輯</button>
                  <button class="btn btn-outline text-sm" @click="deleteProduct(p)" :disabled="loading"><AppIcon name="trash" class="h-4 w-4" /> 刪除</button>
                  <input :id="`upload-ticket-${encodeURIComponent(p.name || '')}`" type="file" accept="image/*" class="hidden" @change="(ev)=>changeProductCover(ev, p)" />
                  <button class="btn btn-outline text-sm" @click="triggerProductCoverInput(p)"><AppIcon name="image" class="h-4 w-4" /> 上傳封面</button>
                  <button class="btn btn-outline text-sm" @click="deleteProductCover(p)"><AppIcon name="trash" class="h-4 w-4" /> 刪除封面</button>
                  <span class="text-xs text-gray-500 ml-1">建議尺寸 900×600px</span>
                </div>
              </template>
              <!-- Edit mode -->
              <template v-else>
                <input v-model.trim="p._editing.name" placeholder="名稱" class="border px-2 py-1" />
                <input v-model.number="p._editing.price" type="number" min="0" step="1" placeholder="價格" class="border px-2 py-1" />
                <input v-model.trim="p._editing.description" placeholder="描述" class="border px-2 py-1" />
                <div class="mt-2 flex flex-wrap gap-2">
                  <button class="btn btn-primary btn-sm" @click="saveEditProduct(p)" :disabled="loading"><AppIcon name="check" class="h-4 w-4" /> 儲存</button>
                  <button class="btn btn-outline btn-sm" @click="cancelEditProduct(p)" :disabled="loading"><AppIcon name="x" class="h-4 w-4" /> 取消</button>
                </div>
              </template>
              </div>
            </AppCard>
          </div>
        </div>
        </AppCard>
      </section>

      <!-- Events -->
      <section v-if="tab==='events'" class="admin-section slide-up">
        <AppCard>
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
          <h2 class="font-bold">活動列表</h2>
          <div class="flex items-center gap-2">
            <input v-model.trim="eventQuery" placeholder="搜尋標題/代碼/地點" class="border px-2 py-2 text-sm w-full md:w-64" />
            <button class="btn btn-outline text-sm" @click="openCreateEventForm"><AppIcon name="plus" class="h-4 w-4" /> 新增活動</button>
          </div>
        </div>
        <Teleport to="body">
          <transition name="backdrop-fade">
            <div v-if="showEventForm" class="admin-drawer" :class="{ 'admin-drawer--mobile': isMobileViewport }" @click.self="cancelEventForm">
              <transition :name="drawerTransitionName">
                <div class="admin-drawer__panel" role="dialog" aria-modal="true">
                  <div class="admin-drawer__header">
                    <h3 class="text-lg font-semibold text-gray-900">{{ isEditingEvent ? '編輯活動' : '新增活動' }}</h3>
                    <button class="btn-ghost" title="關閉" @click="cancelEventForm"><AppIcon name="x" class="h-5 w-5" /></button>
                  </div>
                  <div class="admin-card admin-card--form admin-drawer__card overflow-hidden">
                    <div class="admin-card__header">
                      <div>
                        <p class="admin-card__eyebrow">{{ eventFormHeading }}</p>
                        <h3 class="admin-card__title">
                          {{ isEditingEvent ? (newEvent.title || editingEvent?.title || editingEvent?.name || '-') : '建立新的活動' }}
                        </h3>
                        <p v-if="isEditingEvent" class="admin-card__subtitle">目前編輯：#{{ editingEvent?.id }} · {{ editingEvent?.code }}</p>
                        <p v-else class="admin-card__subtitle">填寫活動資料後即可建立，稍後可繼續管理店面與價目。</p>
                        <div class="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-600">
                          <span class="badge gray">{{ isEditingEvent ? '編輯模式' : '新增模式' }}</span>
                          <span v-if="isEditingEvent && editingEvent?.code" class="badge gray">代碼 {{ editingEvent.code }}</span>
                          <span v-if="eventSchedulePreview" class="badge gray">時程 {{ eventSchedulePreview }}</span>
                          <span v-if="eventFormDirty" class="px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-700">未儲存變更</span>
                        </div>
                      </div>
                      <div class="admin-card__actions">
                        <button class="btn btn-outline btn-sm" @click="cancelEventForm">關閉</button>
                        <button v-if="isEditingEvent" class="btn btn-outline btn-sm" @click="restoreEditingSnapshot">還原原始內容</button>
                      </div>
                    </div>
                    <div class="admin-card__body">
                      <div v-if="showEventFormErrors" class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        <div class="font-semibold">請先修正以下欄位：</div>
                        <ul class="list-disc list-inside space-y-1">
                          <li v-for="(err, idx) in eventFormErrors" :key="`event-err-${idx}`">{{ err }}</li>
                        </ul>
                      </div>
                      <div class="admin-form space-y-6">
                        <section class="admin-form__card">
                          <header class="admin-form__card-header">
                            <h4>基本資訊</h4>
                            <p>名稱、代碼與地點會顯示在前台活動列表。</p>
                          </header>
                          <div class="admin-form__grid admin-form__grid--2">
                            <label class="admin-field">
                              <span>活動名稱 *</span>
                              <input v-model.trim="newEvent.title" placeholder="例：鐵人三項挑戰賽" />
                            </label>
                            <label class="admin-field">
                              <span>活動代碼</span>
                              <input v-model.trim="newEvent.code" placeholder="可留空自動生成" />
                            </label>
                            <label class="admin-field">
                              <span>活動地點</span>
                              <input v-model.trim="newEvent.location" placeholder="例：台中軟體園區" />
                            </label>
                            <label class="admin-field">
                              <span>封面圖片 URL</span>
                              <input v-model.trim="newEvent.cover" placeholder="可貼上外部圖片連結" />
                            </label>
                          </div>
                        </section>

                        <section class="admin-form__card admin-form__card--split">
                          <div class="admin-form__split-block">
                            <header class="admin-form__card-header">
                              <h4>封面上傳</h4>
                              <p>建議尺寸 900×600px，系統會自動裁切 3:2。</p>
                            </header>
                            <div class="admin-dropzone">
                              <div v-if="coverPreview" class="admin-dropzone__preview">
                                <img :src="coverPreview" alt="封面預覽" />
                              </div>
                              <div class="admin-dropzone__hint">拖曳或選擇圖片上傳</div>
                              <div class="flex flex-wrap gap-2">
                                <label class="btn btn-outline btn-sm cursor-pointer">
                                  <input id="cover-file" type="file" accept="image/*" class="hidden" @change="onCoverFileChange" />
                                  <AppIcon name="image" class="h-4 w-4" /> 選擇圖片
                                </label>
                                <button v-if="coverPreview" class="btn btn-outline btn-sm" @click="clearEventCoverPreview">清除預覽</button>
                              </div>
                            </div>
                          </div>
                          <div class="admin-form__split-block">
                            <header class="admin-form__card-header">
                              <h4>描述與規則</h4>
                              <p>提供活動亮點、注意事項或報到流程。</p>
                            </header>
                            <label class="admin-field admin-field--textarea">
                              <span>活動描述</span>
                              <textarea v-model.trim="newEvent.description" rows="4" placeholder="簡短介紹、注意事項等"></textarea>
                            </label>
                            <label class="admin-field admin-field--textarea">
                              <span>活動規則（以逗號分隔）</span>
                              <textarea v-model.trim="newEvent.rules" rows="3" placeholder="例：須攜帶身分證, 需提前 15 分鐘報到"></textarea>
                            </label>
                          </div>
                        </section>

                        <section class="admin-form__card">
                          <header class="admin-form__card-header">
                            <h4>時程設定</h4>
                            <p>使用 datetime 控件輸入正確的開始、結束與截止時間。</p>
                          </header>
                          <div class="admin-form__grid admin-form__grid--3">
                            <label class="admin-field">
                              <span>開始時間 *</span>
                              <input v-model="newEvent.starts_at" type="datetime-local" />
                            </label>
                            <label class="admin-field">
                              <span>結束時間 *</span>
                              <input v-model="newEvent.ends_at" type="datetime-local" />
                            </label>
                            <label class="admin-field">
                              <span>報名截止</span>
                              <input v-model="newEvent.deadline" type="datetime-local" />
                            </label>
                          </div>
                        </section>
                      </div>
                    </div>
                    <div class="admin-card__footer admin-drawer__footer">
                      <p class="admin-card__note">儲存後可於店面管理區進一步設定價目與門市。</p>
                      <div class="admin-card__actions">
                        <button class="btn btn-primary" @click="submitEventForm" :disabled="loading">
                          <span v-if="loading" class="btn-spinner mr-2" aria-hidden="true"></span>
                          {{ eventFormActionLabel }}
                        </button>
                        <button class="btn btn-outline" @click="cancelEventForm">取消</button>
                      </div>
                    </div>
                  </div>
                </div>
              </transition>
            </div>
          </transition>
        </Teleport>
        <div v-if="loading" class="text-gray-500">載入中…</div>
        <div v-else>
          <div v-if="events.length===0" class="text-gray-500">沒有資料</div>
          <div v-else>
            <!-- Mobile: Cards -->
            <div class="grid grid-cols-1 gap-3 md:hidden">
              <AppCard v-for="e in filteredEvents" :key="e.id" :cover-src="e.cover || `${API}/events/${e.id}/cover`">
                <div class="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div class="font-semibold text-primary">{{ e.name || e.title }}</div>
                    <div class="text-xs text-gray-500 font-mono flex items-center gap-1">
                      商品編號 {{ e.code || (`EV${String(e.id).padStart(6,'0')}`) }}
                      <button class="btn-ghost" title="複製" @click.stop="copyToClipboard(e.code || `EV${String(e.id).padStart(6,'0')}`)"><AppIcon name="copy" class="h-3 w-3" /></button>
                    </div>
                  </div>
                </div>
                <div class="text-sm text-gray-700">📅 {{ e.date || formatRange(e.starts_at, e.ends_at) }}</div>
                <div v-if="e.deadline || e.ends_at" class="text-xs text-gray-600 mt-1">🛑 截止：{{ formatDate(e.deadline || e.ends_at) }}</div>
                <div class="mt-3 grid grid-cols-2 gap-2">
                  <button class="btn btn-primary text-sm col-span-2" @click="startEditEvent(e)"><AppIcon name="edit" class="h-4 w-4" /> 編輯</button>
                  <button class="btn btn-outline text-sm" @click="openStoreManager(e)"><AppIcon name="store" class="h-4 w-4" /> 店面</button>
                  <button class="btn btn-outline text-sm" @click="triggerEventCoverInput(e.id)"><AppIcon name="image" class="h-4 w-4" /> 上傳封面</button>
                  <input :id="`upload-event-${e.id}`" type="file" accept="image/*" class="hidden" @change="(ev)=>changeEventCover(ev, e)" />
                  <button class="btn btn-outline text-sm" @click="deleteEventCover(e)"><AppIcon name="trash" class="h-4 w-4" /> 刪除封面</button>
                  <button class="btn btn-outline text-sm text-red-600 border-red-200 hover:bg-red-50 col-span-2" @click="deleteEvent(e)"><AppIcon name="trash" class="h-4 w-4" /> 刪除活動</button>
                </div>
              </AppCard>
            </div>
            <!-- Desktop: Table -->
            <div class="overflow-x-auto hidden md:block">
            <table class="min-w-[720px] w-full text-sm table-default">
              <thead class="sticky top-0 z-10">
                <tr class="bg-gray-50 text-left">
                  <th class="px-3 py-2 border">ID</th>
                  <th class="px-3 py-2 border">名稱</th>
                  <th class="px-3 py-2 border">日期/區間</th>
                  <th class="px-3 py-2 border">截止</th>
                  <th class="px-3 py-2 border">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in filteredEvents" :key="e.id" class="hover:bg-gray-50">
                  <td class="px-3 py-2 border">{{ e.id }}</td>
                  <td class="px-3 py-2 border">
                    <div class="flex items-center gap-3">
                      <img :src="e.cover || `${API}/events/${e.id}/cover`" @error="(ev)=>ev.target.src='/logo.png'" alt="cover" class="w-12 h-8 object-cover border" />
                      <div>
                        <div>{{ e.name || e.title }}</div>
                        <div class="text-xs text-gray-500 font-mono flex items-center gap-1">商品編號 {{ e.code || (`EV${String(e.id).padStart(6,'0')}`) }}
                          <button class="btn-ghost" title="複製" @click.stop="copyToClipboard(e.code || `EV${String(e.id).padStart(6,'0')}`)"><AppIcon name="copy" class="h-3 w-3" /></button>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td class="px-3 py-2 border">{{ e.date || formatRange(e.starts_at, e.ends_at) }}</td>
                  <td class="px-3 py-2 border">{{ formatDate(e.deadline || e.ends_at) }}</td>
                  <td class="px-3 py-2 border">
                    <div class="flex items-center gap-2 flex-wrap">
                      <button class="btn btn-primary text-sm" @click="startEditEvent(e)"><AppIcon name="edit" class="h-4 w-4" /> 編輯</button>
                      <button class="btn btn-outline text-sm" @click="openStoreManager(e)"><AppIcon name="store" class="h-4 w-4" /> 管理店面</button>
                      <input :id="`upload-${e.id}`" type="file" accept="image/*" class="hidden" @change="(ev)=>changeEventCover(ev, e)" />
                      <button class="btn btn-outline text-sm" @click="triggerEventCoverInput(e.id)"><AppIcon name="image" class="h-4 w-4" /> 上傳封面</button>
                      <button class="btn btn-outline text-sm" @click="deleteEventCover(e)"><AppIcon name="trash" class="h-4 w-4" /> 刪除封面</button>
                      <button class="btn btn-outline text-sm text-red-600 border-red-200 hover:bg-red-50" @click="deleteEvent(e)"><AppIcon name="trash" class="h-4 w-4" /> 刪除活動</button>
                      <span class="text-xs text-gray-500 ml-1">建議尺寸 900×600px</span>
                      </div>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </div>

        <!-- 店面管理 Drawer -->
        <Teleport to="body">
          <transition name="backdrop-fade">
            <div v-if="selectedEvent" class="admin-drawer" :class="{ 'admin-drawer--mobile': isMobileViewport }" @click.self="closeStoreManager">
              <transition :name="drawerTransitionName">
                <div v-if="selectedEvent" class="admin-drawer__panel admin-store-panel">
                  <div class="admin-drawer__header">
                    <div>
                      <p class="admin-card__eyebrow mb-0">店面管理</p>
                      <h3 class="admin-card__title">{{ selectedEvent.name || selectedEvent.title }}（ID：{{ selectedEvent.id }}）</h3>
                      <p class="admin-card__subtitle">設定活動期間可預約的門市時程與價目，支援套用模板快速建立。</p>
                    </div>
                    <button class="btn-ghost" title="關閉" @click="closeStoreManager"><AppIcon name="x" class="h-5 w-5" /></button>
                  </div>
                  <div class="admin-card admin-card--form admin-store-panel__body admin-drawer__card">
                    <div class="admin-card__body admin-store-panel__body">
                      <div class="admin-store-panel__grid">
                        <div class="admin-store-panel__form">
                          <div class="admin-form space-y-6">
                            <section class="admin-form__card">
                              <header class="admin-form__card-header">
                                <h4>新增店面</h4>
                                <p>選擇模板或自訂門市資訊，後續可重複使用。</p>
                              </header>
                              <div class="admin-store-template-row">
                                <div class="flex flex-wrap gap-2 items-center">
                                  <button class="btn btn-outline btn-sm" @click="applyTemplate" :disabled="!selectedTemplateId || templateLoading">套用模板</button>
                                  <button class="btn btn-outline btn-sm" @click="saveAsTemplate" :disabled="templateLoading">另存為模板</button>
                                  <button class="btn btn-ghost btn-sm" @click="loadStoreTemplates" :disabled="templateLoading"><AppIcon name="refresh" class="h-4 w-4" /> 重載模板</button>
                                </div>
                                <div class="admin-template-grid" v-if="storeTemplates.length">
                                  <article
                                    v-for="t in storeTemplates"
                                    :key="t.id"
                                    class="admin-template-card"
                                    :class="{ 'admin-template-card--selected': String(selectedTemplateId) === String(t.id) }"
                                    @click="selectedTemplateId = String(t.id)"
                                  >
                                    <div class="admin-template-card__header">
                                      <div>
                                        <p class="admin-template-card__title">{{ t.name }}</p>
                                        <div class="admin-template-card__meta" v-if="templateInfo(t)?.dateText">{{ templateInfo(t).dateText }}</div>
                                      </div>
                                      <span class="badge gray">#{{ t.id }}</span>
                                    </div>
                                    <div class="admin-template-card__badges">
                                      <span class="badge gray">價目 {{ templateInfo(t)?.priceCount || 0 }}</span>
                                      <span v-if="templateInfo(t)?.boundProducts" class="badge gray">綁定 {{ templateInfo(t)?.boundProducts }}</span>
                                    </div>
                                    <p v-if="t.address" class="admin-template-card__hint">地址：{{ t.address }}</p>
                                    <p v-if="t.business_hours" class="admin-template-card__hint">營業：{{ t.business_hours }}</p>
                                    <button
                                      class="btn btn-primary btn-sm w-full"
                                      type="button"
                                      :disabled="templateLoading || String(selectedTemplateId) === String(t.id)"
                                      @click.stop="selectedTemplateId = String(t.id); applyTemplate()"
                                    >
                                      套用此模板
                                    </button>
                                  </article>
                                </div>
                                <div v-else-if="!templateLoading" class="text-xs text-gray-500 mt-2">尚未建立模板，先輸入下方表單可直接另存為模板。</div>
                              </div>
                              <div class="admin-form__grid admin-form__grid--2">
                                <label class="admin-field">
                                  <span>店面名稱 *</span>
                                  <input v-model.trim="newStore.name" placeholder="例：台北車店（光復店）" />
                                </label>
                                <div></div>
                              </div>
                              <div class="admin-form__grid admin-form__grid--2">
                                <label class="admin-field">
                                  <span>地址</span>
                                  <input v-model.trim="newStore.address" placeholder="例：台北市信義區松仁路 100 號" />
                                </label>
                                <label class="admin-field">
                                  <span>外部網址</span>
                                  <input v-model.trim="newStore.external_url" placeholder="Google 地圖、門市頁或客服連結" />
                                </label>
                              </div>
                              <label class="admin-field">
                                <span>營業時間</span>
                                <textarea rows="2" v-model.trim="newStore.business_hours" placeholder="例：週一至週五 10:00-20:00；週末 11:00-18:00"></textarea>
                              </label>
                              <div class="admin-form__grid admin-form__grid--2 admin-store-dates-grid">
                                <label class="admin-field">
                                  <span>賽前開始</span>
                                  <input type="date" v-model="newStore.pre_start" />
                                </label>
                                <label class="admin-field">
                                  <span>賽前結束</span>
                                  <input type="date" v-model="newStore.pre_end" />
                                </label>
                                <label class="admin-field">
                                  <span>賽後開始</span>
                                  <input type="date" v-model="newStore.post_start" />
                                </label>
                                <label class="admin-field">
                                  <span>賽後結束</span>
                                  <input type="date" v-model="newStore.post_end" />
                                </label>
                              </div>
                              <div class="admin-store-pricing">
                                <div class="admin-store-pricing__header">
                                  <div>
                                    <h5>價目表</h5>
                                    <p>輸入各車型原價、早鳥價與綁定商品。</p>
                                  </div>
                                  <button class="btn btn-outline btn-sm" @click="addPriceItem"><AppIcon name="plus" class="h-4 w-4" /> 車型</button>
                                </div>
                                <div v-for="(it, idx) in newStore.priceItems" :key="idx" class="admin-store-pricing__row">
                                  <input v-model.trim="it.type" placeholder="車型" />
                                  <input type="number" min="0" v-model.number="it.normal" placeholder="原價" />
                                  <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" />
                                  <div class="admin-store-pricing__product">
                                    <select v-model="it.productId">
                                      <option value="">未綁定商品</option>
                                      <option v-for="p in products" :key="p.id" :value="String(p.id)">
                                        {{ p.name }}（#{{ p.id }}）
                                      </option>
                                    </select>
                                    <button class="admin-store-pricing__remove" v-if="newStore.priceItems.length > 1" @click="newStore.priceItems.splice(idx,1)">
                                      <AppIcon name="trash" class="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                              <div class="pt-6 admin-card__actions admin-store-panel__actions">
                                <button class="btn btn-primary" @click="createStore" :disabled="storeLoading">
                                  <span v-if="storeLoading" class="btn-spinner mr-2"></span>
                                  新增店面
                                </button>
                                <button class="btn btn-outline" @click="resetNewStore" :disabled="storeLoading">清空</button>
                              </div>
                            </section>
                          </div>
                        </div>
                        <div class="admin-store-panel__list">
                          <section class="admin-form__card admin-store-list">
                            <header class="admin-form__card-header">
                              <h4>已設定店面（{{ eventStores.length }}）</h4>
                              <p>調整既有店面的營運時程與價目，或刪除不再使用的門市。</p>
                            </header>
                            <div v-if="storeLoading && !eventStores.length" class="admin-store-empty">載入中…</div>
                            <div v-else-if="!eventStores.length" class="admin-store-empty">尚未新增店面</div>
                            <div v-else class="admin-store-list__items">
                              <article v-for="s in eventStores" :key="s.id" class="admin-store-card" :class="{ 'admin-store-card--editing': s._editing }">
                                <template v-if="s._editing">
                                  <div class="admin-form__grid admin-form__grid--2">
                                    <label class="admin-field">
                                      <span>店面名稱</span>
                                      <input v-model.trim="s._editing.name" />
                                    </label>
                                    <div></div>
                                  </div>
                                  <div class="admin-form__grid admin-form__grid--2">
                                    <label class="admin-field">
                                      <span>地址</span>
                                      <input v-model.trim="s._editing.address" placeholder="例：台北市信義區松仁路 100 號" />
                                    </label>
                                    <label class="admin-field">
                                      <span>外部網址</span>
                                      <input v-model.trim="s._editing.external_url" placeholder="Google 地圖、門市頁或客服連結" />
                                    </label>
                                  </div>
                                  <label class="admin-field">
                                    <span>營業時間</span>
                                    <textarea rows="2" v-model.trim="s._editing.business_hours" placeholder="例：週一至週五 10:00-20:00；週末 11:00-18:00"></textarea>
                                  </label>
                                  <div class="admin-form__grid admin-form__grid--2 admin-store-dates-grid">
                                    <label class="admin-field">
                                      <span>賽前開始</span>
                                      <input type="date" v-model="s._editing.pre_start" />
                                    </label>
                                    <label class="admin-field">
                                      <span>賽前結束</span>
                                      <input type="date" v-model="s._editing.pre_end" />
                                    </label>
                                    <label class="admin-field">
                                      <span>賽後開始</span>
                                      <input type="date" v-model="s._editing.post_start" />
                                    </label>
                                    <label class="admin-field">
                                      <span>賽後結束</span>
                                      <input type="date" v-model="s._editing.post_end" />
                                    </label>
                                  </div>
                                  <div class="admin-store-pricing admin-store-pricing--compact">
                                    <div class="admin-store-pricing__header">
                                      <div>
                                        <h5>價目表</h5>
                                        <p>可新增或調整車型定價。</p>
                                      </div>
                                      <button class="btn btn-outline btn-sm" @click="s._editing.priceItems.push({type:'', normal:0, early:0, productId:''})">+ 車型</button>
                                    </div>
                                    <div v-for="(it, idx) in s._editing.priceItems" :key="idx" class="admin-store-pricing__row">
                                      <input v-model.trim="it.type" placeholder="車型" />
                                      <input type="number" min="0" v-model.number="it.normal" placeholder="原價" />
                                      <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" />
                                      <div class="admin-store-pricing__product">
                                        <select v-model="it.productId">
                                          <option value="">未綁定商品</option>
                                          <option v-for="p in products" :key="p.id" :value="String(p.id)">
                                            {{ p.name }}（#{{ p.id }}）
                                          </option>
                                        </select>
                                        <button class="admin-store-pricing__remove" v-if="s._editing.priceItems.length > 1" @click="s._editing.priceItems.splice(idx,1)">
                                          <AppIcon name="trash" class="h-4 w-4" />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                  <div class="admin-card__actions">
                                    <button class="btn btn-primary btn-sm" @click="saveEditStore(s)" :disabled="storeLoading"><AppIcon name="check" class="h-4 w-4" /> 儲存</button>
                                    <button class="btn btn-outline btn-sm" @click="cancelEditStore(s)" :disabled="storeLoading"><AppIcon name="x" class="h-4 w-4" /> 取消</button>
                                  </div>
                                </template>
                                <template v-else>
                                  <div class="admin-store-card__header">
                                    <div>
                                      <p class="admin-store-card__title">{{ s.name }}</p>
                                      <p class="admin-store-card__meta">賽前：{{ formatDate(s.pre_start) || '未設定' }} → {{ formatDate(s.pre_end) || '未設定' }}</p>
                                      <p class="admin-store-card__meta">賽後：{{ formatDate(s.post_start) || '未設定' }} → {{ formatDate(s.post_end) || '未設定' }}</p>
                                      <p v-if="s.address" class="admin-store-card__meta">地址：{{ s.address }}</p>
                                      <p v-if="s.business_hours" class="admin-store-card__meta">營業時間：{{ s.business_hours }}</p>
                                      <p v-if="s.external_url" class="admin-store-card__meta break-all">
                                        外部網址：
                                        <a :href="s.external_url" target="_blank" rel="noreferrer" class="text-primary underline">{{ s.external_url }}</a>
                                      </p>
                                    </div>
                                    <div class="admin-card__actions">
                                      <button class="btn btn-outline btn-sm" @click="startEditStore(s)"><AppIcon name="edit" class="h-4 w-4" /> 編輯</button>
                                      <button class="btn btn-outline btn-sm" @click="deleteStore(s)" :disabled="storeLoading"><AppIcon name="trash" class="h-4 w-4" /> 刪除</button>
                                    </div>
                                  </div>
                                  <div class="admin-store-card__prices">
                                    <div v-for="(info, type) in s.prices" :key="type" class="admin-store-card__price">
                                      <div>
                                        <span class="admin-store-card__price-type">{{ type }}</span>
                                        <span class="admin-store-card__price-meta">{{ productLabel(info) }}</span>
                                      </div>
                                      <div class="admin-store-card__price-values">
                                        <span>原價 {{ info.normal }}</span>
                                        <span>早鳥 {{ info.early }}</span>
                                      </div>
                                    </div>
                                  </div>
                                </template>
                              </article>
                            </div>
                          </section>
                        </div>
                      </div>
                    </div>
                    <div class="admin-card__footer admin-drawer__footer">
                      <p class="admin-card__note">儲存後，活動將套用店面時程與價目設定。</p>
                    </div>
                  </div>
                </div>
              </transition>
            </div>
          </transition>
        </Teleport>

        </AppCard>
      </section>

      <!-- Orders -->
      <section v-if="tab==='orders'" class="admin-section slide-up">
        <AppCard>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
          <h2 class="font-bold">訂單狀態管理</h2>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <input v-model.trim="orderQuery" placeholder="搜尋代碼/姓名/Email/票種/狀態" class="border px-2 py-2 text-sm w-full sm:w-72" />
            <button class="btn btn-outline text-sm w-full sm:w-auto" @click="loadOrders" :disabled="ordersLoading"><AppIcon name="refresh" class="h-4 w-4" /> 重新整理</button>
            <button v-if="hasOrderFilters" class="btn btn-outline text-sm w-full sm:w-auto" @click="clearOrderFilters" :disabled="ordersLoading">
              <AppIcon name="x" class="h-4 w-4" /> 清除篩選
            </button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 mb-3">
          <button
            v-for="item in orderStatusSummary"
            :key="`order-filter-${item.key}`"
            class="px-3 py-1 text-sm border transition"
            :class="orderStatusFilter === item.key ? 'bg-primary text-white border-primary shadow-sm' : 'border-gray-200 text-gray-600 hover:border-primary hover:text-primary'"
            @click="orderStatusFilter = item.key"
          >
            {{ item.label }}
            <span class="ml-1 text-xs text-gray-500">({{ item.count }})</span>
          </button>
        </div>
        <div v-if="ordersLoading" class="text-gray-500">載入中…</div>
        <div v-else>
          <div v-if="adminOrders.length===0" class="text-gray-500">沒有資料</div>
          <!-- Mobile: Cards -->
          <div class="grid grid-cols-1 gap-3 md:hidden">
            <div v-for="o in filteredAdminOrders" :key="o.id" class="border p-3 bg-white">
              <div class="flex items-start justify-between mb-2">
                <div>
                  <div class="font-semibold">訂單 #{{ o.id }} <span v-if="o.code" class="font-mono text-xs">({{ o.code }})</span></div>
                  <div class="text-xs text-gray-600">使用者：{{ o.username }}（{{ o.email }}）</div>
                  <div v-if="o.phone" class="text-xs text-gray-600 mt-0.5">手機：{{ o.phone }}</div>
                  <div v-if="o.remittanceLast5" class="text-xs text-gray-600">帳戶後五碼：{{ o.remittanceLast5 }}</div>
                  <template v-if="o.isReservation">
                    <div class="text-xs text-gray-600">場次：{{ o.eventName || '-' }}</div>
                    <div class="text-xs text-gray-500" v-if="o.eventDate">時間：{{ o.eventDate }}</div>
                  </template>
                  <template v-else>
                    <div class="text-xs text-gray-600">票券：{{ o.ticketType || '-' }}</div>
                    <div class="text-xs text-gray-600">數量：{{ o.quantity || 0 }}｜總額：{{ formatCurrency(o.total || 0) }}</div>
                  </template>
                </div>
                <span class="badge">{{ o.status }}</span>
              </div>
                <div v-if="o.isReservation" class="space-y-2 text-xs text-gray-600">
                <div class="border border-gray-200 divide-y">
                  <div v-for="line in o.selections" :key="line.key" class="p-2">
                    <div class="font-semibold text-gray-700">{{ line.store || '—' }}｜{{ line.type || '—' }}</div>
                    <div>單價：{{ line.byTicket ? '票券抵扣' : formatCurrency(line.unitPrice) }}</div>
                    <div>數量：{{ line.qty }}</div>
                    <div>優惠折扣：
                      <span v-if="line.byTicket">票券抵扣</span>
                      <span v-else-if="line.discount > 0">-{{ formatCurrency(line.discount) }}</span>
                      <span v-else>—</span>
                    </div>
                    <div>小計：{{ formatCurrency(line.subtotal) }}</div>
                  </div>
                </div>
                <div>
                  <div>總件數：{{ o.quantity || 0 }}</div>
                  <div v-if="o.subtotal !== undefined">小計：{{ formatCurrency(o.subtotal) }}</div>
                  <div v-if="o.discountTotal > 0">優惠折扣：-{{ formatCurrency(o.discountTotal) }}</div>
                  <div v-if="o.addOnCost > 0">加購費用：{{ formatCurrency(o.addOnCost) }}</div>
                  <div class="font-semibold text-gray-800">總計：{{ formatCurrency(o.total) }}</div>
                </div>
              </div>
                <div v-if="o.hasRemittance" class="mt-2 bg-red-50/80 border border-primary/30 p-2 text-xs text-gray-700 space-y-1">
                <div class="font-semibold text-primary">匯款資訊</div>
                <div v-if="o.remittance.bankName">銀行名稱：{{ o.remittance.bankName }}</div>
                <div v-if="o.remittance.info">{{ o.remittance.info }}</div>
                <div v-if="o.remittance.bankCode">銀行代碼：{{ o.remittance.bankCode }}</div>
                <div v-if="o.remittance.bankAccount" class="flex items-center gap-2">
                  <span>銀行帳戶：{{ o.remittance.bankAccount }}</span>
                  <button class="btn-ghost" title="複製帳號" @click="copyToClipboard(o.remittance.bankAccount)"><AppIcon name="copy" class="h-4 w-4" /></button>
                </div>
                <div v-if="o.remittance.accountName">帳戶名稱：{{ o.remittance.accountName }}</div>
                <div v-if="o.remittanceLast5">帳戶後五碼：{{ o.remittanceLast5 }}</div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select v-model="o.newStatus" class="border px-2 py-1">
                  <option v-for="s in orderStatuses" :key="s" :value="s">{{ s }}</option>
                </select>
                <button class="btn btn-primary btn-sm" @click="saveOrderStatus(o)" :disabled="o.saving">儲存</button>
              </div>
            </div>
          </div>
          <!-- Desktop: Table -->
          <div class="overflow-x-auto hidden md:block">
            <table class="min-w-[720px] w-full text-sm table-default">
              <thead class="sticky top-0 z-10">
                <tr class="bg-gray-50 text-left">
                  <th class="px-3 py-2 border">ID</th>
                  <th class="px-3 py-2 border">代碼</th>
                  <th class="px-3 py-2 border">使用者</th>
                  <th class="px-3 py-2 border">內容</th>
                  <th class="px-3 py-2 border">狀態</th>
                  <th class="px-3 py-2 border">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="o in filteredAdminOrders" :key="o.id">
                  <td class="px-3 py-2 border">{{ o.id }}</td>
                  <td class="px-3 py-2 border font-mono">{{ o.code || '-' }}</td>
                  <td class="px-3 py-2 border">
                    <div>{{ o.username }}</div>
                    <div class="text-xs text-gray-500">{{ o.email }}</div>
                    <div v-if="o.phone" class="text-xs text-gray-600 mt-1">手機：{{ o.phone }}</div>
                    <div v-if="o.remittanceLast5" class="text-xs text-gray-600">帳戶後五碼：{{ o.remittanceLast5 }}</div>
                  </td>
                  <td class="px-3 py-2 border">
                    <template v-if="o.isReservation">
                      <div><strong>場次：</strong>{{ o.eventName || '-' }}</div>
                      <div v-if="o.eventDate"><strong>時間：</strong>{{ o.eventDate }}</div>
                      <table class="w-full text-xs text-gray-600 mt-2 border border-gray-200">
                        <thead class="bg-gray-50">
                          <tr>
                            <th class="px-2 py-1 border">交車門市</th>
                            <th class="px-2 py-1 border">車型</th>
                            <th class="px-2 py-1 border text-right">單價</th>
                            <th class="px-2 py-1 border text-right">數量</th>
                            <th class="px-2 py-1 border text-right">優惠折扣</th>
                            <th class="px-2 py-1 border text-right">小計</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="line in o.selections" :key="line.key">
                            <td class="px-2 py-1 border">{{ line.store || '—' }}</td>
                            <td class="px-2 py-1 border">{{ line.type || '—' }}</td>
                            <td class="px-2 py-1 border text-right">{{ line.byTicket ? '票券抵扣' : formatCurrency(line.unitPrice) }}</td>
                            <td class="px-2 py-1 border text-right">{{ line.qty }}</td>
                            <td class="px-2 py-1 border text-right">
                              <span v-if="line.byTicket">票券抵扣</span>
                              <span v-else-if="line.discount > 0">-{{ formatCurrency(line.discount) }}</span>
                              <span v-else>—</span>
                            </td>
                            <td class="px-2 py-1 border text-right">{{ formatCurrency(line.subtotal) }}</td>
                          </tr>
                        </tbody>
                      </table>
                      <div class="text-xs text-gray-600 mt-2 space-y-1">
                        <div>總件數：{{ o.quantity || 0 }}</div>
                        <div v-if="o.subtotal !== undefined">小計：{{ formatCurrency(o.subtotal) }}</div>
                        <div v-if="o.discountTotal > 0">優惠折扣：-{{ formatCurrency(o.discountTotal) }}</div>
                        <div v-if="o.addOnCost > 0">加購費用：{{ formatCurrency(o.addOnCost) }}</div>
                        <div class="font-semibold text-gray-800">總計：{{ formatCurrency(o.total) }}</div>
                      </div>
                    </template>
                    <template v-else>
                      <div>票券：{{ o.ticketType || '-' }}</div>
                      <div>數量：{{ o.quantity || 0 }}</div>
                      <div>總額：{{ formatCurrency(o.total) }}</div>
                    </template>
                    <div v-if="o.hasRemittance" class="mt-2 bg-red-50/70 border border-primary/40 px-2 py-2 text-xs text-gray-700 space-y-1">
                      <div class="font-semibold text-primary">匯款資訊</div>
                      <div v-if="o.remittance.bankName">銀行名稱：{{ o.remittance.bankName }}</div>
                      <div v-if="o.remittance.info">{{ o.remittance.info }}</div>
                      <div v-if="o.remittance.bankCode">銀行代碼：{{ o.remittance.bankCode }}</div>
                    <div v-if="o.remittance.bankAccount" class="flex items-center gap-1">
                      <span>銀行帳戶：{{ o.remittance.bankAccount }}</span>
                      <button class="btn-ghost" title="複製帳號" @click="copyToClipboard(o.remittance.bankAccount)"><AppIcon name="copy" class="h-4 w-4" /></button>
                    </div>
                    <div v-if="o.remittance.accountName">帳戶名稱：{{ o.remittance.accountName }}</div>
                    <div v-if="o.remittanceLast5">帳戶後五碼：{{ o.remittanceLast5 }}</div>
                  </div>
                  </td>
                  <td class="px-3 py-2 border">
                    <select v-model="o.newStatus" class="border px-2 py-1 w-full sm:w-auto">
                      <option v-for="s in orderStatuses" :key="s" :value="s">{{ s }}</option>
                    </select>
                  </td>
                  <td class="px-3 py-2 border">
                    <div class="flex flex-col sm:flex-row gap-2">
                      <button class="btn btn-primary btn-sm w-full sm:w-auto" @click="saveOrderStatus(o)" :disabled="o.saving">儲存</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        </AppCard>
      </section>

      <!-- Settings -->
      <section v-if="tab==='settings'" class="admin-section slide-up">
        <AppCard>
          <div class="mb-4">
            <h2 class="font-bold">全局設定</h2>
            <p class="text-sm text-gray-600">更新後，所有新訂單的通知與檢視都會同步使用最新的匯款資訊。</p>
          </div>
          <div class="mb-4 flex flex-wrap items-center gap-2 border-b border-gray-200 pb-2">
            <button
              v-for="s in settingsTabs"
              :key="s.key"
              class="px-4 py-2 text-sm font-medium rounded transition"
              :class="settingsTab === s.key ? 'bg-primary text-white shadow' : 'text-gray-600 hover:text-primary hover:bg-gray-100'"
              @click="setSettingsTab(s.key)"
            >
              {{ s.label }}
            </button>
          </div>
          <div v-if="settingsTab === 'remittance'" class="space-y-4">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="text-sm text-gray-600">匯款資訊</div>
              <div class="flex items-center gap-2">
                <button class="btn btn-outline btn-sm" @click="loadRemittanceSettings" :disabled="remittanceLoading || remittanceSaving">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                </button>
                <button class="btn btn-primary btn-sm" @click="saveRemittanceSettings" :disabled="remittanceSaving || !remittanceDirty">
                  {{ remittanceSaving ? '儲存中…' : '儲存設定' }}
                </button>
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label class="md:col-span-2 text-xs text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">匯款說明</span>
                <textarea v-model="remittanceForm.info" rows="3" class="border px-3 py-2 w-full" placeholder="例：請於三日內完成匯款" :disabled="remittanceSaving"></textarea>
              </label>
              <label class="text-xs text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">銀行名稱</span>
                <input v-model.trim="remittanceForm.bankName" class="border px-3 py-2 w-full" placeholder="例：臺灣銀行" :disabled="remittanceSaving" />
              </label>
              <label class="text-xs text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">銀行代碼</span>
                <input v-model.trim="remittanceForm.bankCode" class="border px-3 py-2 w-full" placeholder="例：123" :disabled="remittanceSaving" />
              </label>
              <label class="text-xs text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">銀行帳號</span>
                <input v-model.trim="remittanceForm.bankAccount" class="border px-3 py-2 w-full" placeholder="例：1234567890" :disabled="remittanceSaving" />
              </label>
              <label class="text-xs text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">帳戶名稱</span>
                <input v-model.trim="remittanceForm.accountName" class="border px-3 py-2 w-full" placeholder="例：王小明" :disabled="remittanceSaving" />
              </label>
            </div>
            <p v-if="remittanceLoading" class="text-xs text-gray-500">匯款資訊載入中…</p>
          </div>
          <div v-else-if="settingsTab === 'legal'" class="space-y-4">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="text-sm text-gray-600">條款與預約說明頁面</div>
              <div class="flex items-center gap-2">
                <button class="btn btn-outline btn-sm" @click="loadSitePages" :disabled="sitePagesLoading || sitePagesSaving">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                </button>
                <button class="btn btn-primary btn-sm" @click="saveSitePages" :disabled="sitePagesSaving || !sitePagesDirty">
                  {{ sitePagesSaving ? '儲存中…' : '儲存內容' }}
                </button>
              </div>
            </div>
            <div class="space-y-4">
              <label class="text-xs text-gray-600 space-y-1 block">
                <span class="font-medium text-gray-700">使用者條款內容</span>
                <textarea v-model="sitePagesForm.terms" rows="10" class="border px-3 py-2 w-full" placeholder="支援 HTML 內容" :disabled="sitePagesSaving"></textarea>
              </label>
              <label class="text-xs text-gray-600 space-y-1 block">
                <span class="font-medium text-gray-700">隱私權條款內容</span>
                <textarea v-model="sitePagesForm.privacy" rows="10" class="border px-3 py-2 w-full" placeholder="支援 HTML 內容" :disabled="sitePagesSaving"></textarea>
              </label>
              <label class="text-xs text-gray-600 space-y-1 block">
                <span class="font-medium text-gray-700">預約購買須知</span>
                <textarea v-model="sitePagesForm.reservationNotice" rows="10" class="border px-3 py-2 w-full" placeholder="支援 HTML 內容" :disabled="sitePagesSaving"></textarea>
              </label>
              <label class="text-xs text-gray-600 space-y-1 block">
                <span class="font-medium text-gray-700">預約使用規定</span>
                <textarea v-model="sitePagesForm.reservationRules" rows="10" class="border px-3 py-2 w-full" placeholder="支援 HTML 內容" :disabled="sitePagesSaving"></textarea>
              </label>
            </div>
            <p v-if="sitePagesLoading" class="text-xs text-gray-500">條款內容載入中…</p>
          </div>
          <div v-else-if="settingsTab === 'checklists'" class="space-y-4">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="text-sm text-gray-600">檢核表預設項目</div>
              <div class="flex items-center gap-2">
                <button class="btn btn-outline btn-sm" @click="loadChecklistDefinitions" :disabled="checklistDefinitionsLoading || checklistDefinitionsSaving">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                </button>
                <button class="btn btn-outline btn-sm" @click="resetChecklistDefinitions" :disabled="checklistDefinitionsSaving || checklistDefinitionsLoading">
                  恢復預設
                </button>
                <button class="btn btn-primary btn-sm" @click="saveChecklistDefinitions" :disabled="checklistDefinitionsSaving || checklistDefinitionsLoading || !checklistDefinitionsDirty">
                  {{ checklistDefinitionsSaving ? '儲存中…' : '儲存項目' }}
                </button>
              </div>
            </div>
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div
                v-for="stageKey in CHECKLIST_STAGE_KEYS"
                :key="`checklist-editor-${stageKey}`"
                class="rounded-lg border border-gray-200 bg-white p-4 space-y-3 shadow-sm"
              >
                <div>
                  <h3 class="text-sm font-semibold text-gray-800">
                    {{ adminChecklistDefinitions[stageKey]?.title || stageLabelMap[stageKey] || stageKey }}
                  </h3>
                  <p class="text-xs text-gray-500 mt-1">每行輸入一項檢核內容，未填寫則套用預設項目。</p>
                </div>
                <label class="text-xs text-gray-600 space-y-1 block">
                  <span class="font-medium text-gray-700">檢核表標題</span>
                  <input
                    v-model.trim="checklistDefinitionsForm[stageKey].title"
                    class="border px-3 py-2 w-full"
                    :placeholder="DEFAULT_ADMIN_CHECKLIST_DEFINITIONS[stageKey]?.title || '檢核表標題'"
                    :disabled="checklistDefinitionsSaving"
                  />
                </label>
                <label class="text-xs text-gray-600 space-y-1 block">
                  <span class="font-medium text-gray-700">檢核項目（每行一項）</span>
                  <textarea
                    v-model="checklistDefinitionsForm[stageKey].itemsText"
                    rows="5"
                    class="border px-3 py-2 w-full font-mono text-xs leading-relaxed"
                    placeholder="例：車輛與配件與預約資訊相符"
                    :disabled="checklistDefinitionsSaving"
                  ></textarea>
                </label>
                <p class="text-[0.7rem] text-gray-500">系統會依序顯示最多 12 項檢核內容。</p>
              </div>
            </div>
            <p v-if="checklistDefinitionsLoading" class="text-xs text-gray-500">檢核項目載入中…</p>
          </div>
        </AppCard>
      </section>

      <!-- Store Templates -->
      <section v-if="tab==='store-templates'" class="admin-section slide-up">
        <AppCard>
          <div class="mb-4">
            <h2 class="font-bold">門市模板</h2>
            <p class="text-sm text-gray-600">集中管理所有門市模板，活動開店可直接套用。</p>
          </div>
          <div class="mb-4 flex items-center gap-2 border-b border-gray-200 pb-2 justify-between">
            <div class="text-sm text-gray-600">共 {{ storeTemplates.length }} 筆</div>
            <div class="flex items-center gap-2">
              <button class="btn btn-outline btn-sm" @click="loadStoreTemplates" :disabled="templateLoading">
                <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
              </button>
            </div>
          </div>
          <div class="admin-form__card admin-form__card--split">
            <div class="admin-form__split-block space-y-3">
              <header class="admin-form__card-header">
                <h4>新增門市模板</h4>
                <p>建立共用模板，後續活動可快速套用。</p>
              </header>
              <div class="admin-form__grid admin-form__grid--2">
                <label class="admin-field">
                  <span>模板名稱 *</span>
                  <input v-model.trim="storeTemplateForm.name" placeholder="例：北區門市模板" />
                </label>
                <div></div>
              </div>
              <div class="admin-form__grid admin-form__grid--2">
                <label class="admin-field">
                  <span>地址</span>
                  <input v-model.trim="storeTemplateForm.address" placeholder="例：台北市信義區松仁路 100 號" />
                </label>
                <label class="admin-field">
                  <span>外部網址</span>
                  <input v-model.trim="storeTemplateForm.external_url" placeholder="Google 地圖、門市頁或客服連結" />
                </label>
              </div>
              <label class="admin-field">
                <span>營業時間</span>
                <textarea rows="2" v-model.trim="storeTemplateForm.business_hours" placeholder="例：週一至週五 10:00-20:00；週末 11:00-18:00"></textarea>
              </label>
              <div class="admin-form__grid admin-form__grid--2 admin-store-dates-grid">
                <label class="admin-field">
                  <span>賽前開始</span>
                  <input type="date" v-model="storeTemplateForm.pre_start" />
                </label>
                <label class="admin-field">
                  <span>賽前結束</span>
                  <input type="date" v-model="storeTemplateForm.pre_end" />
                </label>
                <label class="admin-field">
                  <span>賽後開始</span>
                  <input type="date" v-model="storeTemplateForm.post_start" />
                </label>
                <label class="admin-field">
                  <span>賽後結束</span>
                  <input type="date" v-model="storeTemplateForm.post_end" />
                </label>
              </div>
              <div class="admin-store-pricing">
                <div class="admin-store-pricing__header">
                  <div>
                    <h5>價目表</h5>
                    <p>輸入各車型原價、早鳥價與綁定商品。</p>
                  </div>
                  <button class="btn btn-outline btn-sm" @click="addTemplatePriceItem"><AppIcon name="plus" class="h-4 w-4" /> 車型</button>
                </div>
                <div v-for="(it, idx) in storeTemplateForm.priceItems" :key="`store-template-price-${idx}`" class="admin-store-pricing__row">
                  <input v-model.trim="it.type" placeholder="車型" />
                  <input type="number" min="0" v-model.number="it.normal" placeholder="原價" />
                  <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" />
                  <div class="admin-store-pricing__product">
                    <select v-model="it.productId">
                      <option value="">未綁定商品</option>
                      <option v-for="p in products" :key="p.id" :value="String(p.id)">
                        {{ p.name }}（#{{ p.id }}）
                      </option>
                    </select>
                    <button class="admin-store-pricing__remove" v-if="storeTemplateForm.priceItems.length > 1" @click="storeTemplateForm.priceItems.splice(idx,1)">
                      <AppIcon name="trash" class="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
              <div class="admin-card__actions">
                <button class="btn btn-primary" @click="createStoreTemplate" :disabled="storeTemplateSaving || templateLoading">
                  <span v-if="storeTemplateSaving" class="btn-spinner mr-2"></span>
                  新增模板
                </button>
                <button class="btn btn-outline" @click="resetStoreTemplateForm" :disabled="storeTemplateSaving">清空</button>
              </div>
            </div>
            <div class="admin-form__split-block space-y-3">
              <header class="admin-form__card-header">
                <h4>已建立模板（{{ storeTemplates.length }}）</h4>
                <p>調整模板內容或刪除未使用的模板。</p>
              </header>
              <div v-if="templateLoading" class="admin-store-empty">載入中…</div>
              <div v-else-if="!storeTemplates.length" class="admin-store-empty">尚未新增模板</div>
              <div v-else class="admin-store-list__items max-h-[640px]">
                <article v-for="t in storeTemplates" :key="t.id" class="admin-store-card" :class="{ 'admin-store-card--editing': t._editing }">
                  <template v-if="t._editing">
                    <div class="admin-form__grid admin-form__grid--2">
                      <label class="admin-field">
                        <span>模板名稱</span>
                        <input v-model.trim="t._editing.name" />
                      </label>
                      <div></div>
                    </div>
                    <div class="admin-form__grid admin-form__grid--2">
                      <label class="admin-field">
                        <span>地址</span>
                        <input v-model.trim="t._editing.address" placeholder="例：台北市信義區松仁路 100 號" />
                      </label>
                      <label class="admin-field">
                        <span>外部網址</span>
                        <input v-model.trim="t._editing.external_url" placeholder="Google 地圖、門市頁或客服連結" />
                      </label>
                    </div>
                    <label class="admin-field">
                      <span>營業時間</span>
                      <textarea rows="2" v-model.trim="t._editing.business_hours" placeholder="例：週一至週五 10:00-20:00；週末 11:00-18:00"></textarea>
                    </label>
                    <div class="admin-form__grid admin-form__grid--2 admin-store-dates-grid">
                      <label class="admin-field">
                        <span>賽前開始</span>
                        <input type="date" v-model="t._editing.pre_start" />
                      </label>
                      <label class="admin-field">
                        <span>賽前結束</span>
                        <input type="date" v-model="t._editing.pre_end" />
                      </label>
                      <label class="admin-field">
                        <span>賽後開始</span>
                        <input type="date" v-model="t._editing.post_start" />
                      </label>
                      <label class="admin-field">
                        <span>賽後結束</span>
                        <input type="date" v-model="t._editing.post_end" />
                      </label>
                    </div>
                    <div class="admin-store-pricing admin-store-pricing--compact">
                      <div class="admin-store-pricing__header">
                        <div>
                          <h5>價目表</h5>
                          <p>可新增或調整車型定價。</p>
                        </div>
                        <button class="btn btn-outline btn-sm" @click="t._editing.priceItems.push({type:'', normal:0, early:0, productId:''})">+ 車型</button>
                      </div>
                      <div v-for="(it, idx) in t._editing.priceItems" :key="`store-template-edit-price-${idx}`" class="admin-store-pricing__row">
                        <input v-model.trim="it.type" placeholder="車型" />
                        <input type="number" min="0" v-model.number="it.normal" placeholder="原價" />
                        <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" />
                        <div class="admin-store-pricing__product">
                          <select v-model="it.productId">
                            <option value="">未綁定商品</option>
                            <option v-for="p in products" :key="p.id" :value="String(p.id)">
                              {{ p.name }}（#{{ p.id }}）
                            </option>
                          </select>
                          <button class="admin-store-pricing__remove" v-if="t._editing.priceItems.length > 1" @click="t._editing.priceItems.splice(idx,1)">
                            <AppIcon name="trash" class="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div class="admin-card__actions">
                      <button class="btn btn-primary btn-sm" @click="saveStoreTemplate(t)" :disabled="t._saving">
                        <span v-if="t._saving" class="btn-spinner mr-2"></span>
                        <AppIcon name="check" class="h-4 w-4" /> 儲存
                      </button>
                      <button class="btn btn-outline btn-sm" @click="cancelEditStoreTemplate(t)" :disabled="t._saving"><AppIcon name="x" class="h-4 w-4" /> 取消</button>
                    </div>
                  </template>
                  <template v-else>
                    <div class="admin-store-card__header">
                      <div>
                        <p class="admin-store-card__title">{{ t.name }}</p>
                        <p class="admin-store-card__meta">賽前：{{ formatDate(t.pre_start) || '未設定' }} → {{ formatDate(t.pre_end) || '未設定' }}</p>
                        <p class="admin-store-card__meta">賽後：{{ formatDate(t.post_start) || '未設定' }} → {{ formatDate(t.post_end) || '未設定' }}</p>
                        <p v-if="t.address" class="admin-store-card__meta">地址：{{ t.address }}</p>
                        <p v-if="t.business_hours" class="admin-store-card__meta">營業時間：{{ t.business_hours }}</p>
                        <p v-if="t.external_url" class="admin-store-card__meta break-all">
                          外部網址：
                          <a :href="t.external_url" target="_blank" rel="noreferrer" class="text-primary underline">{{ t.external_url }}</a>
                        </p>
                      </div>
                      <div class="admin-card__actions">
                        <button class="btn btn-outline btn-sm" @click="startEditStoreTemplate(t)"><AppIcon name="edit" class="h-4 w-4" /> 編輯</button>
                        <button class="btn btn-outline btn-sm" @click="deleteStoreTemplate(t)" :disabled="t._deleting">
                          <span v-if="t._deleting" class="btn-spinner mr-2"></span>
                          <AppIcon name="trash" class="h-4 w-4" /> 刪除
                        </button>
                      </div>
                    </div>
                    <div class="admin-store-card__prices">
                      <div v-for="(info, type) in t.prices" :key="type" class="admin-store-card__price">
                        <div>
                          <span class="admin-store-card__price-type">{{ type }}</span>
                          <span class="admin-store-card__price-meta">{{ productLabel(info) }}</span>
                        </div>
                        <div class="admin-store-card__price-values">
                          <span>原價 {{ info.normal }}</span>
                          <span>早鳥 {{ info.early }}</span>
                        </div>
                      </div>
                    </div>
                  </template>
                </article>
              </div>
            </div>
          </div>
        </AppCard>
      </section>

      <!-- Tombstones -->
      <section v-if="tab==='tombstones'" class="admin-section slide-up">
        <AppCard>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
            <h2 class="font-bold">墓碑（封鎖第三方登入）</h2>
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
              <select v-model="tombstoneFilters.provider" class="border px-2 py-2 text-sm w-full sm:w-auto">
                <option value="">全部 Provider</option>
                <option value="google">Google</option>
                <option value="line">LINE</option>
              </select>
              <input v-model.trim="tombstoneFilters.subject" placeholder="subject（部分符合）" class="border px-2 py-2 text-sm w-full sm:w-56" />
              <input v-model.trim="tombstoneFilters.email" placeholder="email（完全符合）" class="border px-2 py-2 text-sm w-full sm:w-56" />
              <button class="btn btn-outline text-sm w-full sm:w-auto" @click="loadTombstones" :disabled="tombstoneLoading"><AppIcon name="refresh" class="h-4 w-4" /> 查詢</button>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
            <select v-model="tombstoneForm.provider" class="border px-2 py-2">
              <option value="google">Google</option>
              <option value="line">LINE</option>
            </select>
            <input v-model.trim="tombstoneForm.subject" placeholder="subject（擇一填 subject/email）" class="border px-2 py-2" />
            <input v-model.trim="tombstoneForm.email" placeholder="email（擇一填 subject/email）" class="border px-2 py-2" />
            <input v-model.trim="tombstoneForm.reason" placeholder="原因（選填）" class="border px-2 py-2" />
          </div>
          <div class="mb-4">
            <button class="btn btn-primary btn-sm" @click="addTombstone" :disabled="tombstoneLoading">新增封鎖</button>
          </div>
          <div v-if="tombstoneLoading" class="text-gray-500">載入中…</div>
          <div v-else class="overflow-x-auto">
            <table class="min-w-[720px] w-full text-sm table-default">
              <thead class="sticky top-0 z-10">
                <tr class="bg-gray-50 text-left">
                  <th class="px-3 py-2 border">ID</th>
                  <th class="px-3 py-2 border">Provider</th>
                  <th class="px-3 py-2 border">Subject</th>
                  <th class="px-3 py-2 border">Email</th>
                  <th class="px-3 py-2 border">Reason</th>
                  <th class="px-3 py-2 border">建立時間</th>
                  <th class="px-3 py-2 border">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in tombstones" :key="r.id">
                  <td class="px-3 py-2 border">{{ r.id }}</td>
                  <td class="px-3 py-2 border uppercase">{{ r.provider || '-' }}</td>
                  <td class="px-3 py-2 border font-mono break-all">{{ r.subject || '-' }}</td>
                  <td class="px-3 py-2 border break-all">{{ r.email || '-' }}</td>
                  <td class="px-3 py-2 border">{{ r.reason || '-' }}</td>
                  <td class="px-3 py-2 border">{{ formatDate(r.created_at) }}</td>
                  <td class="px-3 py-2 border">
                    <button class="btn btn-outline btn-sm" @click="deleteTombstone(r)">解除封鎖</button>
                  </td>
                </tr>
              </tbody>
            </table>
        </div>
        </AppCard>
      </section>

      <AppBottomSheet v-model="ticketDetail.open">
        <div class="max-h-[75vh] overflow-y-auto">
          <div class="mx-auto h-1.5 w-10 bg-gray-300 mb-3"></div>
          <h3 class="text-lg font-bold text-primary mb-4">票券詳情</h3>
          <div v-if="!ticketDetail.ticket" class="text-sm text-gray-500">尚未選擇票券</div>
          <div v-else class="space-y-4 text-sm text-gray-800">
            <div class="bg-white border border-gray-200 p-3 rounded">
              <p><strong>票券：</strong>{{ ticketDetail.ticket.type || '未命名票券' }}</p>
              <p class="break-all"><strong>票號：</strong><span class="font-mono">{{ ticketDetail.ticket.uuid }}</span></p>
              <p><strong>持有人：</strong>{{ ticketDetail.ticket.username || '未綁定' }}（{{ ticketDetail.ticket.email || '—' }}）</p>
              <p><strong>狀態：</strong>{{ ticketStatusLabel(ticketDetail.ticket) }}</p>
              <p><strong>建立時間：</strong>{{ formatDate(ticketDetail.ticket.created_at) }}</p>
            </div>
            <section class="border border-gray-200 bg-white p-3 rounded space-y-3">
              <h4 class="font-semibold text-gray-700">編輯票券</h4>
              <label class="block text-sm">
                <span class="text-xs text-gray-500">票券名稱</span>
                <input class="border px-2 py-2 w-full mt-1" v-model.trim="ticketDetail.edit.type" placeholder="例如 VIP / 入場券" />
              </label>
              <label class="block text-sm">
                <span class="text-xs text-gray-500">到期日</span>
                <input type="date" class="border px-2 py-2 w-full mt-1" v-model="ticketDetail.edit.expiry" />
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" v-model="ticketDetail.edit.used" />
                <span>標記為已使用</span>
              </label>
              <label class="block text-sm">
                <span class="text-xs text-gray-500">持有人 Email（重新指派）</span>
                <input class="border px-2 py-2 w-full mt-1" v-model.trim="ticketDetail.edit.userEmail" placeholder="輸入 Email 指派新使用者" />
                <p class="text-xs text-gray-500 mt-1">若保持與原 Email 相同則不變更。</p>
              </label>
              <div class="flex flex-col sm:flex-row gap-2">
                <button class="btn btn-primary btn-sm flex-1" @click="saveTicketEdit" :disabled="ticketDetail.saving">
                  <AppIcon name="check" class="h-4 w-4" /> 儲存
                </button>
                <button class="btn btn-outline btn-sm flex-1" @click="ticketDetail.ticket && loadTicketLogs(ticketDetail.ticket.id)" :disabled="ticketDetail.logsLoading">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新整理紀錄
                </button>
              </div>
            </section>
            <section class="border border-gray-200 bg-white p-3 rounded">
              <div class="flex items-center justify-between mb-2">
                <h4 class="font-semibold text-gray-700">流向紀錄</h4>
                <button class="btn btn-outline btn-sm" @click="ticketDetail.ticket && loadTicketLogs(ticketDetail.ticket.id)" :disabled="ticketDetail.logsLoading">
                  <AppIcon name="refresh" class="h-4 w-4" /> 更新
                </button>
              </div>
              <div v-if="ticketDetail.logsLoading" class="text-gray-500">載入中…</div>
              <div v-else-if="!ticketDetail.logs.length" class="text-gray-500">目前沒有紀錄</div>
              <div v-else class="space-y-2">
                <article v-for="log in ticketDetail.logs" :key="log.id" class="border border-gray-200 bg-gray-50 p-2 leading-relaxed">
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-gray-800">{{ ticketLogActionLabel(log.action) }}</span>
                    <span class="text-xs text-gray-500">{{ formatDate(log.created_at) }}</span>
                  </div>
                  <div class="text-xs text-gray-500 mt-1">{{ log.username || log.email || log.user_id || '—' }}</div>
                  <div v-if="log.metaText" class="text-xs text-gray-600 mt-1 break-all">
                    {{ log.metaText }}
                  </div>
                </article>
              </div>
            </section>
          </div>
        </div>
      </AppBottomSheet>

      <AppBottomSheet v-model="reservationDetail.open">
        <div class="max-h-[75vh] overflow-y-auto">
          <div class="mx-auto h-1.5 w-10 bg-gray-300 mb-3"></div>
          <h3 class="text-lg font-bold text-primary mb-4">檢核紀錄</h3>
          <div v-if="reservationDetail.loading" class="text-sm text-gray-500">載入中…</div>
          <div v-else-if="reservationDetail.record" class="space-y-4">
            <div class="bg-white border border-gray-200 p-3 text-sm leading-relaxed">
              <p><strong>使用者：</strong>{{ reservationDetail.record.username }}（{{ reservationDetail.record.email }}）</p>
              <p><strong>賽事：</strong>{{ reservationDetail.record.event }}</p>
              <p><strong>門市：</strong>{{ reservationDetail.record.store }}</p>
              <p><strong>票種：</strong>{{ reservationDetail.record.ticket_type }}</p>
              <p><strong>預約時間：</strong>{{ formatDate(reservationDetail.record.reserved_at) }}</p>
            </div>
            <div class="bg-white border border-gray-200 p-3 text-sm leading-relaxed">
              <div class="flex items-center justify-between mb-2">
                <h4 class="font-semibold text-gray-800">狀態時間紀錄</h4>
                <span class="text-xs text-gray-500">檢核完成時間</span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div
                  v-for="stageKey in CHECKLIST_STAGE_KEYS"
                  :key="`checklist-time-${stageKey}`"
                  class="flex items-center justify-between border border-gray-100 px-3 py-2 rounded"
                >
                  <div class="text-xs text-gray-600">{{ adminChecklistDefinitions[stageKey]?.title || (stageLabelMap[stageKey] || '檢核') }}</div>
                  <div class="text-xs font-mono text-gray-800 text-right" v-if="checklistCompletedAt(reservationDetail.record, stageKey)">
                    {{ formatChecklistCompletedAt(checklistCompletedAt(reservationDetail.record, stageKey)) }}
                  </div>
                  <div class="text-xs text-gray-400" v-else>—</div>
                </div>
              </div>
            </div>
            <div v-for="stageKey in CHECKLIST_STAGE_KEYS" :key="stageKey"
              class="border border-gray-200 bg-white">
              <div class="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                <div>
                  <h4 class="font-semibold text-gray-800">
                    {{ adminChecklistDefinitions[stageKey]?.title || (stageLabelMap[stageKey] || '檢核表') }}
                  </h4>
                  <p class="text-xs text-gray-500">
                    {{ stageLabelMap[stageKey] || checklistStageName(stageKey) }} ·
                    {{ reservationDetail.record.stageChecklist?.[stageKey]?.completed ? '已完成檢核' : '尚未完成檢核' }}
                  </p>
                  <div class="flex items-center gap-1 text-xs text-gray-500 mt-1">
                    <AppIcon name="clock" class="h-3.5 w-3.5" />
                    <span v-if="checklistCompletedAt(reservationDetail.record, stageKey)">
                      完成時間：{{ formatChecklistCompletedAt(checklistCompletedAt(reservationDetail.record, stageKey)) }}
                    </span>
                    <span v-else>尚未有完成時間紀錄</span>
                  </div>
                </div>
                <span class="text-xs px-2 py-1 border"
                  :class="reservationDetail.record.stageChecklist?.[stageKey]?.completed ? 'border-green-500 text-green-600' : 'border-gray-300 text-gray-500'">
                  照片 {{ reservationDetail.record.checklists?.[stageKey]?.photoCount ?? (reservationDetail.record.checklists?.[stageKey]?.photos?.length || 0) }}
                </span>
              </div>
              <div class="p-3 space-y-3 text-sm">
                <div>
                  <p class="text-xs text-gray-500 mb-1">檢核項目</p>
                  <ul class="space-y-1">
                    <li v-for="item in reservationDetail.record.checklists?.[stageKey]?.items || []" :key="item.label"
                      class="flex items-center gap-2">
                      <AppIcon :name="item.checked ? 'check' : 'x'"
                        :class="item.checked ? 'text-green-600 h-4 w-4' : 'text-gray-400 h-4 w-4'" />
                      <span :class="item.checked ? 'text-gray-800' : 'text-gray-500'">{{ item.label }}</span>
                    </li>
                  </ul>
                </div>
                <div>
                  <p class="text-xs text-gray-500 mb-2">檢核照片</p>
                  <div v-if="reservationDetail.record.checklists?.[stageKey]?.photos?.length"
                    class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <button
                      v-for="photo in reservationDetail.record.checklists?.[stageKey]?.photos"
                      :key="photo.id"
                      type="button"
                      class="group flex flex-col overflow-hidden border border-gray-200 bg-white text-left transition focus:outline-none focus:ring-2 focus:ring-primary/40 hover:border-primary"
                      @click="previewChecklistPhoto(photo, reservationDetail.record.id, stageKey, { checklist: reservationDetail.record.checklists?.[stageKey], reservation: reservationDetail.record })"
                    >
                      <img
                        :src="adminChecklistPhotoSrc(photo, reservationDetail.record.id, stageKey)"
                        alt="檢核照片"
                        class="h-32 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                        crossorigin="use-credentials"
                      />
                      <div class="px-2 py-1 bg-gray-50 text-[11px] text-gray-600">
                        <div class="truncate">{{ formatChecklistUploadedAt(photo.uploadedAt) || '—' }}</div>
                        <div v-if="photo.originalName" class="truncate text-[10px] text-gray-400">{{ photo.originalName }}</div>
                      </div>
                    </button>
                  </div>
                  <div v-else class="text-xs text-gray-500">尚未上傳檢核照片</div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-sm text-gray-500">沒有檢核資料</div>
        </div>
        <div class="mt-4">
          <button class="btn btn-outline w-full" @click="closeReservationDetail">關閉</button>
        </div>
      </AppBottomSheet>

    </div>
  </main>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, reactive, nextTick } from 'vue'
import axios from '../api/axios'
import { useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AppCard from '../components/AppCard.vue'
import AppBottomSheet from '../components/AppBottomSheet.vue'
import { showNotice, showConfirm, showPrompt } from '../utils/sheet'
import { formatDateTime, formatDateTimeRange } from '../utils/datetime'
import { startQrScanner } from '../utils/qrScanner'
import {
  CHECKLIST_STAGE_KEYS,
  DEFAULT_STAGE_CHECKLIST_DEFINITIONS,
  cloneStageChecklistDefinitions,
  ensureChecklistHasPhotos
} from '../utils/reservationStages'

const router = useRouter()
const API = 'https://api.xiaozhi.moe/uat/leader_online'
const selfRole = ref('USER')

const tab = ref('users')
const tabIndex = ref(0)
const groupKey = ref('user')
const loading = ref(false)

// 角色分級：ADMIN 管理員、STORE 車店、EDITOR 編輯、OPERATOR 操作員
const allTabs = [
  { key: 'users', label: '使用者', icon: 'user', roles: ['ADMIN'] },
  { key: 'products', label: '商品', icon: 'store', roles: ['ADMIN','EDITOR'] },
  { key: 'events', label: '活動', icon: 'ticket', roles: ['ADMIN','EDITOR'] },
  { key: 'reservations', label: '預約', icon: 'orders', roles: ['ADMIN','STORE'] },
  { key: 'tickets', label: '票券', icon: 'ticket', roles: ['ADMIN'] },
  { key: 'orders', label: '訂單', icon: 'orders', roles: ['ADMIN'] },
  { key: 'tombstones', label: '墓碑', icon: 'lock', roles: ['ADMIN'] },
  { key: 'settings', label: '全局設定', icon: 'settings', roles: ['ADMIN'] },
  { key: 'store-templates', label: '門市模板', icon: 'store', roles: ['ADMIN'] },
  // 專用掃描頁（供操作員使用）
  { key: 'scan', label: '掃描', icon: 'camera', roles: ['OPERATOR'] },
]
// Group definitions
const groupDefs = [
  { key: 'user', label: '用戶管理', short: '用戶', tabs: ['users', 'tombstones'] },
  { key: 'product', label: '商品管理', short: '商品', tabs: ['products', 'events'] },
  { key: 'status', label: '狀態管理', short: '狀態', tabs: ['reservations', 'tickets', 'orders', 'scan'] },
  { key: 'global', label: '全局設定', short: '設定', tabs: ['settings', 'store-templates'] },
]
const displayGroupDefs = computed(() => {
  const role = String(selfRole.value || '').toUpperCase()
  return groupDefs.filter(g => g.tabs.some(tabKey => {
    const tabDef = allTabs.find(t => t.key === tabKey)
    return tabDef && (!Array.isArray(tabDef.roles) || tabDef.roles.includes(role))
  }))
})

const visibleTabs = computed(() => {
  const g = groupDefs.find(x => x.key === groupKey.value)
  const keys = g ? g.tabs : []
  const role = String(selfRole.value || '').toUpperCase()
  return allTabs.filter(t => keys.includes(t.key) && (!Array.isArray(t.roles) || t.roles.includes(role)))
})
const setTab = (t, i) => {
  tab.value = t; tabIndex.value = i;
  try { localStorage.setItem('admin_tab', t) } catch {}
  refreshActive()
}
function defaultTabForGroup(role = selfRole.value) {
  const r = String(role || '').toUpperCase()
  if (groupKey.value === 'user') return 'users'
  if (groupKey.value === 'product') return r === 'ADMIN' ? 'products' : 'events'
  if (groupKey.value === 'global') return 'settings'
  // 狀態管理：操作員預設顯示掃描，其餘顯示預約
  if (groupKey.value === 'status') return r === 'OPERATOR' ? 'scan' : 'reservations'
  return 'reservations'
}
const setGroup = (g) => {
  if (groupKey.value === g) return
  groupKey.value = g
  try { localStorage.setItem('admin_group', g) } catch {}
  const target = defaultTabForGroup()
  const idx = Math.max(0, visibleTabs.value.findIndex(t => t.key === target))
  setTab(visibleTabs.value[idx]?.key || (visibleTabs.value[0]?.key || target), idx >= 0 ? idx : 0)
}
const tabClass = (t) => tab.value === t ? 'text-primary' : 'text-gray-500 hover:text-secondary'
const tabCount = computed(() => Math.max(1, visibleTabs.value.length))
const indicatorStyle = computed(() => ({ left: `${tabIndex.value * (100/tabCount.value)}%`, width: `${100/tabCount.value}%` }))
const isMobileViewport = ref(false)
const updateViewport = () => { isMobileViewport.value = (window.innerWidth || 0) < 768 }
const drawerTransitionName = computed(() => isMobileViewport.value ? 'drawer-slide-up' : 'drawer-slide')

// Data
const ADMIN_USERS_DEFAULT_LIMIT = 50
const users = ref([])
const usersMeta = reactive({
  total: 0,
  limit: ADMIN_USERS_DEFAULT_LIMIT,
  offset: 0,
  hasMore: false
})
const userQuery = ref('')
const products = ref([])
const productQuery = ref('')
const productFilters = reactive({ onlyFree: false, onlyMissingDesc: false })
const productSort = ref('recent')
const productStats = computed(() => {
  const list = products.value
  const zeroPrice = list.filter(p => Number(p.price) === 0).length
  const missingDesc = list.filter(p => !(p.description || '').trim()).length
  const avgPrice = list.length
    ? Math.round(list.reduce((sum, p) => sum + (Number(p.price) || 0), 0) / list.length)
    : 0
  return { total: list.length, zeroPrice, missingDesc, avgPrice }
})
const filteredProducts = computed(() => {
  const q = productQuery.value.trim().toLowerCase()
  const sortKey = productSort.value
  let list = products.value.slice()
  if (q) {
    list = list.filter(p => {
      const name = (p.name || '').toLowerCase()
      const code = (p.code || '').toLowerCase()
      const desc = (p.description || '').toLowerCase()
      return name.includes(q) || code.includes(q) || desc.includes(q)
    })
  }
  if (productFilters.onlyFree) list = list.filter(p => Number(p.price) === 0)
  if (productFilters.onlyMissingDesc) list = list.filter(p => !(p.description || '').trim())
  list.sort((a, b) => {
    const priceA = Number(a.price) || 0
    const priceB = Number(b.price) || 0
    if (sortKey === 'price-desc') return priceB - priceA
    if (sortKey === 'price-asc') return priceA - priceB
    if (sortKey === 'name') return (a.name || '').localeCompare(b.name || '', 'zh-Hant')
    const idA = Number(a.id) || 0
    const idB = Number(b.id) || 0
    return idB - idA
  })
  return list
})
const hasProductFilters = computed(() => {
  return !!productQuery.value.trim() || productFilters.onlyFree || productFilters.onlyMissingDesc
})
const resetProductFilters = () => {
  productQuery.value = ''
  productFilters.onlyFree = false
  productFilters.onlyMissingDesc = false
  productSort.value = 'recent'
}
const toggleProductFilter = (key) => {
  if (!(key in productFilters)) return
  productFilters[key] = !productFilters[key]
}
const readProductId = (source) => {
  if (!source || typeof source !== 'object') {
    const n = Number(source)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const raw = source.product_id ?? source.productId ?? source.productID ?? source.product?.id
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}
const productLabel = (entry) => {
  const productId = readProductId(entry)
  if (!productId) return '未綁定'
  const match = products.value.find(p => Number(p.id) === productId)
  if (match) return `${match.name} (#${match.id})`
  return `商品 #${productId}`
}
const ADMIN_EVENTS_DEFAULT_LIMIT = 50
const events = ref([])
const eventsMeta = reactive({
  total: 0,
  limit: ADMIN_EVENTS_DEFAULT_LIMIT,
  offset: 0,
  hasMore: false
})
const eventQuery = ref('')
const selectedEvent = ref(null)
const eventStores = ref([])
const storeLoading = ref(false)
// Shared templates for event stores (common across store accounts)
const storeTemplates = ref([])
const templateLoading = ref(false)
const selectedTemplateId = ref('')
const storeTemplateSaving = ref(false)
const ADMIN_ORDERS_DEFAULT_LIMIT = 50
const adminOrders = ref([])
const usersLoaded = ref(false)
const productsLoaded = ref(false)
const eventsLoaded = ref(false)
const reservationsLoaded = ref(false)
const ordersLoaded = ref(false)
const tombstonesLoaded = ref(false)
const adminOrdersMeta = reactive({
  total: 0,
  limit: ADMIN_ORDERS_DEFAULT_LIMIT,
  offset: 0,
  hasMore: false
})
const ordersLoading = ref(false)
const orderQuery = ref('')
const orderStatuses = ['待匯款', '處理中', '已完成']
const orderStatusFilter = ref('all')
const ordersAwaitingRemittance = computed(() => adminOrders.value.filter(o => o.status === '待匯款').length)
const ordersProcessingCount = computed(() => adminOrders.value.filter(o => o.status === '處理中').length)
const orderStatusSummary = computed(() => {
  const list = adminOrders.value
  const summary = [
    { key: 'all', label: '全部', count: list.length },
    { key: '待匯款', label: '待匯款', count: ordersAwaitingRemittance.value },
    { key: '處理中', label: '處理中', count: ordersProcessingCount.value },
    { key: '已完成', label: '已完成', count: list.filter(o => o.status === '已完成').length }
  ]
  return summary
})
const ADMIN_TICKETS_DEFAULT_LIMIT = 50
const adminTickets = ref([])
const adminTicketsMeta = reactive({
  total: 0,
  limit: ADMIN_TICKETS_DEFAULT_LIMIT,
  offset: 0,
  hasMore: false
})
const ticketsLoading = ref(false)
const ticketQuery = ref('')
const ticketStatusFilter = ref('all')
const ticketSummary = reactive({ total: 0, available: 0, used: 0, expired: 0 })
const ticketSummaryLoaded = ref(false)
const hasTicketFilters = computed(() => ticketStatusFilter.value !== 'all' || !!ticketQuery.value.trim())
const adminTicketsTotalPages = computed(() => {
  if (!adminTicketsMeta.limit) return 1
  return Math.max(1, Math.ceil(Math.max(0, adminTicketsMeta.total) / adminTicketsMeta.limit))
})
const adminTicketsCurrentPage = computed(() => {
  if (!adminTicketsMeta.limit) return 1
  return Math.floor(adminTicketsMeta.offset / adminTicketsMeta.limit) + 1
})
const adminTicketsHasPrev = computed(() => adminTicketsCurrentPage.value > 1)
const adminTicketsHasNext = computed(() => adminTicketsCurrentPage.value < adminTicketsTotalPages.value)
const ticketDetail = reactive({
  open: false,
  ticket: null,
  logs: [],
  logsLoading: false,
  saving: false,
  edit: {
    type: '',
    expiry: '',
    used: false,
    userEmail: ''
  }
})
const ticketStatusBadgeMap = {
  available: 'bg-green-100 text-green-700',
  used: 'bg-gray-200 text-gray-600',
  expired: 'bg-red-100 text-red-700',
  unknown: 'bg-gray-100 text-gray-600'
}
const ticketStateLabels = {
  available: '可用',
  used: '已使用',
  expired: '已過期',
  unknown: '未知'
}
const ticketLogActionMap = {
  issued: '系統發券',
  used: '使用',
  transferred_in: '轉入',
  transferred_out: '轉出',
  admin_updated: '後台更新',
  admin_reassign_in: '後台指派（入）',
  admin_reassign_out: '後台指派（出）'
}
const isTicketExpired = (ticket) => {
  if (!ticket || !ticket.expiry) return false
  const expiry = new Date(ticket.expiry)
  if (Number.isNaN(expiry.getTime())) return false
  const today = new Date()
  expiry.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return expiry < today
}
const computeTicketStateFromFields = (ticket = {}) => {
  if (ticket.used) return 'used'
  if (isTicketExpired(ticket)) return 'expired'
  return 'available'
}
const ticketStateKey = (ticket) => {
  if (!ticket) return 'unknown'
  if (typeof ticket.state === 'string' && ticket.state) return ticket.state
  return computeTicketStateFromFields(ticket)
}
const ticketStatusLabel = (ticket) => ticket?.statusLabel || ticketStateLabels[ticketStateKey(ticket)] || ticketStateLabels.unknown
const ticketStatusBadgeClass = (ticket) => ticket?.badgeClass || ticketStatusBadgeMap[ticketStateKey(ticket)] || ticketStatusBadgeMap.unknown
const ticketExpiryText = (ticket) => {
  if (ticket?.expiryText) return ticket.expiryText
  if (!ticket?.expiry) return ''
  return `到期：${formatDateTime(ticket.expiry)}`
}
const formatAdminTicket = (entry = {}) => {
  const normalized = {
    id: Number(entry.id),
    uuid: entry.uuid || '',
    type: entry.type || '',
    discount: entry.discount == null ? 0 : Number(entry.discount),
    used: entry.used === true || entry.used === 1 || entry.used === '1',
    expiry: entry.expiry || null,
    user_id: entry.user_id == null ? null : String(entry.user_id),
    username: entry.username || '',
    email: entry.email || '',
    created_at: entry.created_at || null,
  }
  normalized.state = computeTicketStateFromFields(normalized)
  normalized.statusLabel = ticketStateLabels[normalized.state] || ticketStateLabels.unknown
  normalized.badgeClass = ticketStatusBadgeMap[normalized.state] || ticketStatusBadgeMap.unknown
  normalized.expiryText = normalized.expiry ? `到期：${formatDateTime(normalized.expiry)}` : ''
  return normalized
}
const formatDateInput = (value) => {
  if (!value && value !== 0) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
const ticketLogActionLabel = (action) => ticketLogActionMap[action] || action || '紀錄'
const ticketLogMetaText = (meta) => {
  if (!meta || typeof meta !== 'object') return ''
  const entries = []
  if (meta.order_code || meta.orderId || meta.order_id) entries.push(`訂單 ${meta.order_code || meta.orderId || meta.order_id}`)
  if (meta.type) entries.push(`票種 ${meta.type}`)
  if (meta.to_user_id) entries.push(`→ ${meta.to_user_id}`)
  if (meta.from_user_id) entries.push(`← ${meta.from_user_id}`)
  if (meta.admin_email) entries.push(`管理員：${meta.admin_email}`)
  if (meta.changes && typeof meta.changes === 'object') {
    const changeKeys = Object.keys(meta.changes)
    if (changeKeys.length) entries.push(`變更：${changeKeys.join(', ')}`)
  }
  return entries.join(' · ')
}
const decrementTicketSummary = (state) => {
  if (state === 'available') ticketSummary.available = Math.max(0, ticketSummary.available - 1)
  else if (state === 'used') ticketSummary.used = Math.max(0, ticketSummary.used - 1)
  else if (state === 'expired') ticketSummary.expired = Math.max(0, ticketSummary.expired - 1)
}
const incrementTicketSummary = (state) => {
  if (state === 'available') ticketSummary.available += 1
  else if (state === 'used') ticketSummary.used += 1
  else if (state === 'expired') ticketSummary.expired += 1
}
const syncTicketSummaryState = (prevTicket, nextTicket) => {
  const prevState = ticketStateKey(prevTicket)
  const nextState = ticketStateKey(nextTicket)
  if (prevState === nextState) return
  decrementTicketSummary(prevState)
  incrementTicketSummary(nextState)
}
let suppressTicketFilterWatch = false
const setTicketStatusFilterSilently = (value) => {
  suppressTicketFilterWatch = true
  ticketStatusFilter.value = value
  nextTick(() => { suppressTicketFilterWatch = false })
}
const goAdminTicketPage = (page) => {
  if (!Number.isFinite(page) || page < 1 || page > adminTicketsTotalPages.value) return
  const target = Math.floor(page)
  const nextOffset = (target - 1) * adminTicketsMeta.limit
  adminTicketsMeta.offset = nextOffset
  loadAdminTickets({ offset: nextOffset })
}
const goAdminTicketPrev = () => {
  if (!adminTicketsHasPrev.value) return
  goAdminTicketPage(adminTicketsCurrentPage.value - 1)
}
const goAdminTicketNext = () => {
  if (!adminTicketsHasNext.value) return
  goAdminTicketPage(adminTicketsCurrentPage.value + 1)
}
const performTicketSearch = (options = {}) => {
  const { forceSummary = true } = options
  adminTicketsMeta.offset = 0
  if (forceSummary) ticketSummaryLoaded.value = false
  loadAdminTickets({ offset: 0, forceSummary })
}
const clearTicketFilters = () => {
  if (!hasTicketFilters.value) return
  setTicketStatusFilterSilently('all')
  ticketQuery.value = ''
  performTicketSearch()
}
const prepareTicketEdit = (ticket) => {
  ticketDetail.edit.type = ticket?.type || ''
  ticketDetail.edit.expiry = formatDateInput(ticket?.expiry)
  ticketDetail.edit.used = !!ticket?.used
  ticketDetail.edit.userEmail = ticket?.email || ''
}
const openTicketDetail = (ticket) => {
  if (!ticket) return
  ticketDetail.ticket = formatAdminTicket(ticket)
  prepareTicketEdit(ticketDetail.ticket)
  ticketDetail.open = true
  loadTicketLogs(ticketDetail.ticket.id)
}
const updateTicketRow = (updated) => {
  if (!updated || updated.id == null) return formatAdminTicket(updated)
  const normalized = formatAdminTicket(updated)
  const targetId = Number(normalized.id)
  const idx = adminTickets.value.findIndex(t => Number(t.id) === targetId)
  if (idx !== -1) {
    adminTickets.value[idx] = normalized
  }
  return normalized
}
const totalUsersCount = computed(() => usersMeta.total || users.value.length)
const tombstoneCount = computed(() => tombstones.value.length)
const productCount = computed(() => products.value.length)
const eventsTotalCount = computed(() => eventsMeta.total || events.value.length)
const overviewCards = computed(() => {
  const cards = []
  if (groupKey.value === 'user') {
    cards.push({
      key: 'users-total',
      label: '總用戶',
      value: totalUsersCount.value,
      hint: '目前的帳號數',
      tab: 'users'
    })
    if (selfRole.value === 'ADMIN') {
      cards.push({
        key: 'tombstones',
        label: '封鎖紀錄',
        value: tombstoneCount.value,
        hint: '封鎖第三方登入',
        tab: 'tombstones'
      })
    }
  } else if (groupKey.value === 'product') {
    cards.push({
      key: 'products',
      label: '商品',
      value: productCount.value,
      hint: '可用票券/商品',
      tab: 'products'
    })
    cards.push({
      key: 'events',
      label: '活動',
      value: eventsTotalCount.value,
      hint: '活動與場次',
      tab: 'events'
    })
  } else if (groupKey.value === 'status') {
    cards.push({
      key: 'tickets-available',
      label: '可用票券',
      value: ticketSummary.available,
      hint: `總數 ${ticketSummary.total}`,
      tab: 'tickets',
      ticketFilter: 'available'
    })
    cards.push({
      key: 'tickets-expired',
      label: '過期票券',
      value: ticketSummary.expired,
      hint: '未使用但已過期',
      tab: 'tickets',
      ticketFilter: 'expired'
    })
    cards.push({
      key: 'reservation-checklist',
      label: '待檢核',
      value: reservationChecklistPendingCount.value,
      hint: '檢核未完成',
      tab: 'reservations',
      reservationFilter: 'pending'
    })
    cards.push({
      key: 'order-awaiting',
      label: '待匯款訂單',
      value: ordersAwaitingRemittance.value,
      hint: '等待匯款確認',
      tab: 'orders',
      orderFilter: '待匯款'
    })
    cards.push({
      key: 'order-processing',
      label: '處理中訂單',
      value: ordersProcessingCount.value,
      hint: '尚未完成',
      tab: 'orders',
      orderFilter: '處理中'
    })
  }
  return cards.filter(card => card.value !== null && card.value !== undefined)
})
const handleOverviewCard = async (card) => {
  if (!card) return
  if (card.reservationFilter) {
    reservationStatusFilter.value = card.reservationFilter
  }
  if (card.orderFilter) {
    orderStatusFilter.value = card.orderFilter
  }
  if (card.ticketFilter) {
    setTicketStatusFilterSilently(card.ticketFilter)
  }
  if (card.tab) {
    const idx = Math.max(0, visibleTabs.value.findIndex(t => t.key === card.tab))
    if (visibleTabs.value[idx]) {
      setTab(card.tab, idx)
    }
  }
}

const isOverviewCardActive = (card) => {
  if (!card) return false
  if (card.tab && tab.value !== card.tab) return false
  if (card.reservationFilter && reservationStatusFilter.value !== card.reservationFilter) return false
  if (card.orderFilter && orderStatusFilter.value !== card.orderFilter) return false
  if (card.ticketFilter && ticketStatusFilter.value !== card.ticketFilter) return false
  return !!(card.tab || card.reservationFilter || card.orderFilter || card.ticketFilter)
}

const overviewCardClass = (card) => isOverviewCardActive(card)
  ? 'bg-gray-700 border-gray-900 text-white shadow-lg'
  : 'bg-white border-gray-200 text-gray-900 hover:border-primary/60'

const overviewCardLabelClass = (card) => isOverviewCardActive(card)
  ? 'text-white/80 text-sm'
  : 'text-gray-500 text-xs'

const overviewCardValueClass = (card) => isOverviewCardActive(card)
  ? 'text-3xl text-white'
  : 'text-3xl text-primary'

const overviewCardHintClass = (card) => isOverviewCardActive(card)
  ? 'text-white/80'
  : 'text-gray-500'
const settingsTabs = [
  { key: 'remittance', label: '匯款資訊' },
  { key: 'legal', label: '條款說明' },
  { key: 'checklists', label: '檢核表' }
]
const SETTINGS_TAB_STORAGE_KEY = 'admin_settings_tab'
const loadSavedSettingsTab = () => {
  try {
    const stored = localStorage.getItem(SETTINGS_TAB_STORAGE_KEY)
    if (stored && settingsTabs.some(t => t.key === stored)) return stored
  } catch {}
  return 'remittance'
}
const settingsTab = ref(loadSavedSettingsTab())
const setSettingsTab = (key) => {
  if (!settingsTabs.some(t => t.key === key)) return
  settingsTab.value = key
  try { localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, key) } catch {}
}
const cloneChecklistDefinitions = (source = {}) => {
  const normalized = cloneStageChecklistDefinitions(source)
  const result = {}
  CHECKLIST_STAGE_KEYS.forEach(stage => {
    const entry = normalized && typeof normalized === 'object' ? normalized[stage] : {}
    const title = typeof entry?.title === 'string' ? entry.title : ''
    const items = Array.isArray(entry?.items) ? entry.items.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : []
    result[stage] = { title, items }
  })
  return result
}
const DEFAULT_ADMIN_CHECKLIST_DEFINITIONS = Object.freeze(cloneChecklistDefinitions(DEFAULT_STAGE_CHECKLIST_DEFINITIONS))
const createChecklistFormState = (source = {}) => {
  const result = {}
  CHECKLIST_STAGE_KEYS.forEach(stage => {
    const entry = source && typeof source === 'object' ? source[stage] : {}
    const title = typeof entry?.title === 'string' ? entry.title : ''
    const items = Array.isArray(entry?.items) ? entry.items.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : []
    result[stage] = {
      title,
      itemsText: items.join('\n')
    }
  })
  return result
}
const parseChecklistItemsText = (text = '') => text
  .split(/\r?\n/)
  .map(item => item.trim())
  .filter(Boolean)
const remittanceForm = reactive({ info: '', bankCode: '', bankAccount: '', accountName: '', bankName: '' })
const remittanceOriginal = ref('')
const remittanceLoading = ref(false)
const remittanceSaving = ref(false)
const remittanceSnapshot = () => JSON.stringify({
  info: remittanceForm.info || '',
  bankCode: remittanceForm.bankCode || '',
  bankAccount: remittanceForm.bankAccount || '',
  accountName: remittanceForm.accountName || '',
  bankName: remittanceForm.bankName || '',
})
const remittanceDirty = computed(() => remittanceSnapshot() !== remittanceOriginal.value)
remittanceOriginal.value = remittanceSnapshot()
const sitePagesForm = reactive({ terms: '', privacy: '', reservationNotice: '', reservationRules: '' })
const sitePagesOriginal = ref(JSON.stringify({ terms: '', privacy: '', reservationNotice: '', reservationRules: '' }))
const sitePagesLoading = ref(false)
const sitePagesSaving = ref(false)
const sitePagesSnapshot = () => JSON.stringify({
  terms: sitePagesForm.terms || '',
  privacy: sitePagesForm.privacy || '',
  reservationNotice: sitePagesForm.reservationNotice || '',
  reservationRules: sitePagesForm.reservationRules || '',
})
const sitePagesDirty = computed(() => sitePagesSnapshot() !== sitePagesOriginal.value)
sitePagesOriginal.value = sitePagesSnapshot()
const checklistDefinitionsForm = reactive(createChecklistFormState(DEFAULT_ADMIN_CHECKLIST_DEFINITIONS))
const checklistDefinitionsOriginal = ref('')
const checklistDefinitionsLoading = ref(false)
const checklistDefinitionsSaving = ref(false)
const checklistDefinitionsLoaded = ref(false)
const checklistDefinitionsSnapshot = () => JSON.stringify(
  CHECKLIST_STAGE_KEYS.reduce((acc, stage) => {
    const entry = checklistDefinitionsForm[stage] || { title: '', itemsText: '' }
    acc[stage] = {
      title: (entry.title || '').trim(),
      items: parseChecklistItemsText(entry.itemsText || '')
    }
    return acc
  }, {})
)
const checklistDefinitionsDirty = computed(() => checklistDefinitionsSnapshot() !== checklistDefinitionsOriginal.value)
checklistDefinitionsOriginal.value = checklistDefinitionsSnapshot()
const ADMIN_RESERVATION_DEFAULT_LIMIT = 50
const adminReservations = ref([])
const adminReservationsMeta = reactive({
  total: 0,
  limit: ADMIN_RESERVATION_DEFAULT_LIMIT,
  offset: 0,
  hasMore: false
})
const reservationsLoading = ref(false)
const reservationQuery = ref('')
const reservationDetail = reactive({ open: false, record: null, loading: false })
watch(ticketStatusFilter, () => {
  if (suppressTicketFilterWatch) return
  if (tab.value !== 'tickets') return
  performTicketSearch({ forceSummary: false })
})
const openReservationDetail = async (row) => {
  reservationDetail.open = true
  reservationDetail.loading = true
  reservationDetail.record = mapAdminReservation(row)
  try {
    const { data } = await axios.get(`${API}/admin/reservations/${row.id}/checklists`, { params: { includePhotos: 1 } })
    if (data?.ok) {
      const detail = mapAdminReservation(data.data)
      if (detail) {
        detail.newStatus = reservationDetail.record?.newStatus || detail.status
        reservationDetail.record = detail
        const idx = adminReservations.value.findIndex(item => item.id === detail.id)
        if (idx !== -1) {
          adminReservations.value[idx] = {
            ...adminReservations.value[idx],
            stageChecklist: detail.stageChecklist,
            checklists: detail.checklists,
            stage_verify_code: detail.stage_verify_code,
            status: detail.status,
            newStatus: adminReservations.value[idx].newStatus || detail.status
          }
        }
      }
    } else {
      await showNotice(data?.message || '讀取檢核紀錄失敗', { title: '錯誤' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    reservationDetail.loading = false
  }
}
const closeReservationDetail = () => {
  reservationDetail.open = false
  reservationDetail.record = null
  reservationDetail.loading = false
}
watch(() => reservationDetail.open, (value) => {
  if (!value) {
    reservationDetail.record = null
    reservationDetail.loading = false
  }
})
const reservationStatusOptions = [
  { value: 'service_booking', label: '預約託運服務（購買票券、付款、憑證產生）' },
  { value: 'pre_dropoff', label: '賽前交車（刷碼、檢核、上傳照片、掛車牌、生成取車碼）' },
  { value: 'pre_pickup', label: '賽前取車（出示取車碼、領車、檢查、上傳合照）' },
  { value: 'post_dropoff', label: '賽後交車（刷碼、檢核、上傳照片、掛車牌、生成取車碼）' },
  { value: 'post_pickup', label: '賽後取車（出示取車碼、領車、檢查、合照存檔）' },
  { value: 'done', label: '服務結束' },
]
const reservationStatusFilter = ref('all')
const reservationPendingCount = computed(() => adminReservations.value.filter(r => r.status !== 'done').length)
const reservationChecklistPendingCount = computed(() => {
  return adminReservations.value.filter(r => {
    if (!r || !r.status || r.status === 'done') return false
    const stageInfo = r.stageChecklist?.[r.status]
    if (stageInfo) return !stageInfo.completed
    return false
  }).length
})
const reservationStatusSummary = computed(() => {
  const list = adminReservations.value
  const shortLabel = (label) => {
    if (!label) return ''
    const idx = label.indexOf('（')
    return idx === -1 ? label : label.slice(0, idx)
  }
  const summary = [
    { key: 'all', label: '全部', count: list.length },
    { key: 'pending', label: '進行中', count: reservationPendingCount.value }
  ]
  reservationStatusOptions.forEach(opt => {
    if (opt.value === 'service_booking') return
    summary.push({
      key: opt.value,
      label: shortLabel(opt.label),
      count: list.filter(item => item.status === opt.value).length
    })
  })
  return summary
})
const adminChecklistDefinitions = reactive(cloneChecklistDefinitions(DEFAULT_ADMIN_CHECKLIST_DEFINITIONS))
const ensureChecklistPhotos = ensureChecklistHasPhotos
const toAbsolutePhotoUrl = (url) => {
  if (!url) return ''
  if (typeof url !== 'string') return ''
  if (url.startsWith('data:') || url.startsWith('blob:')) return url
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('/')) return `${API}${url}`
  return `${API}/${url.replace(/^\/+/, '')}`
}
const adminChecklistPhotoSrc = (photo, reservationId = null, stage = null) => {
  if (!photo) return ''
  if (photo.url) return toAbsolutePhotoUrl(photo.url)
  const targetReservationId = reservationId ?? photo.reservationId
  const targetStage = stage ?? photo.stage
  if (photo.storagePath && targetReservationId && targetStage && photo.id != null) {
    return `${API}/reservations/${targetReservationId}/checklists/${targetStage}/photos/${photo.id}/raw`
  }
  if (photo.legacy && photo.dataUrl) return toAbsolutePhotoUrl(photo.dataUrl)
  return ''
}
const stageLabelMap = Object.fromEntries(reservationStatusOptions.map(opt => [opt.value, opt.label]))
const checklistStageName = (stage) => adminChecklistDefinitions[stage]?.title || stageLabelMap[stage] || stage
const stageCompletionLabels = {
  pre_dropoff: '賽前交車完成',
  pre_pickup: '賽前取車完成',
  post_dropoff: '賽後交車完成',
  post_pickup: '賽後取車完成'
}
const checklistStageCompletionLabel = (stage) => stageCompletionLabels?.[stage] || '確認推進下一階段'
const normalizeAdminChecklist = (stage, raw) => {
  const def = adminChecklistDefinitions[stage] || { items: [] }
  const base = raw && typeof raw === 'object' ? raw : {}
  const completedAt = base.completedAt || base.completed_at || null
  const items = Array.isArray(base.items) ? base.items : []
  const defItems = Array.isArray(def.items) ? def.items : []
  const normalizedItems = defItems.length
    ? defItems.map(label => {
      const existed = items.find(item => item && item.label === label)
      return { label, checked: !!existed?.checked }
    })
    : items.map(item => ({ label: item?.label || String(item?.text || ''), checked: !!item?.checked })).filter(i => i.label)
  const photos = Array.isArray(base.photos) ? base.photos.map(photo => ({
    id: photo.id,
    url: photo.url,
    storagePath: photo.storagePath || null,
    mime: photo.mime,
    originalName: photo.originalName,
    uploadedAt: photo.uploadedAt,
    size: photo.size,
    stage: photo.stage,
    reservationId: photo.reservationId
  })).filter(photo => photo.id) : []
  return {
    title: def.title || '',
    items: normalizedItems,
    photos,
    completed: !!base.completed,
    completedAt,
    photoCount: typeof base.photoCount === 'number' ? base.photoCount : photos.length
  }
}

const normalizeAdminReservationStatus = (status) => {
  const value = String(status || '').toLowerCase()
  if (!value || value === 'pending' || value === 'service_booking') return 'pre_dropoff'
  if (value === 'pickup') return 'pre_pickup'
  return status
}

const mapAdminReservation = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const status = normalizeAdminReservationStatus(raw.status)
  const codeByStage = {
    pre_dropoff: raw.verify_code_pre_dropoff || null,
    pre_pickup: raw.verify_code_pre_pickup || null,
    post_dropoff: raw.verify_code_post_dropoff || null,
    post_pickup: raw.verify_code_post_pickup || null,
  }
  const stageChecklistRaw = raw.stage_checklist && typeof raw.stage_checklist === 'object' ? raw.stage_checklist : {}
  const checklists = {}
  CHECKLIST_STAGE_KEYS.forEach(stage => {
    const rawChecklist = raw?.[`${stage}_checklist`] || raw?.checklists?.[stage] || {}
    const normalized = normalizeAdminChecklist(stage, rawChecklist)
    const stageInfo = stageChecklistRaw[stage] || {}
    const photoCount = typeof stageInfo.photoCount === 'number'
      ? stageInfo.photoCount
      : (typeof normalized.photoCount === 'number' ? normalized.photoCount : normalized.photos.length)
    normalized.photoCount = photoCount
    checklists[stage] = normalized
  })
  const stageChecklist = {}
  CHECKLIST_STAGE_KEYS.forEach(stage => {
    const info = stageChecklistRaw[stage] || {}
    const photoCount = typeof info.photoCount === 'number'
      ? info.photoCount
      : (checklists[stage]?.photoCount || 0)
    const completedAt = info.completedAt || info.completed_at || checklists[stage]?.completedAt || null
    stageChecklist[stage] = {
      found: info.found != null ? !!info.found : photoCount > 0,
      completed: info.completed != null ? !!info.completed : !!checklists[stage]?.completed,
      completedAt,
      photoCount
    }
  })
  const stageVerifyCode = status === 'done'
    ? (codeByStage.post_pickup || raw.verify_code || null)
    : (codeByStage[status] || raw.verify_code || null)
  return {
    id: raw.id,
    username: raw.username || '',
    email: raw.email || '',
    ticket_type: raw.ticket_type,
    store: raw.store,
    event: raw.event,
    reserved_at: raw.reserved_at,
    status,
    newStatus: status,
    saving: false,
    stage_verify_code: stageVerifyCode,
    verify_code_pre_dropoff: codeByStage.pre_dropoff,
    verify_code_pre_pickup: codeByStage.pre_pickup,
    verify_code_post_dropoff: codeByStage.post_dropoff,
    verify_code_post_pickup: codeByStage.post_pickup,
    stageChecklist,
    checklists
  }
}

const checklistCompletedAt = (record, stageKey) => {
  if (!record || !stageKey) return null
  const stageInfo = record.stageChecklist?.[stageKey]
  const checklist = record.checklists?.[stageKey]
  const completed = stageInfo?.completed ?? checklist?.completed
  if (!completed) return null
  return (
    stageInfo?.completedAt ||
    stageInfo?.completed_at ||
    checklist?.completedAt ||
    checklist?.completed_at ||
    null
  )
}

// Tombstones
const tombstones = ref([])
const tombstoneLoading = ref(false)
const tombstoneFilters = ref({ provider: '', subject: '', email: '' })
const tombstoneForm = ref({ provider: 'google', subject: '', email: '', reason: '' })
// 掃描進度（QR）
const scan = ref({ open: false, scanning: false, error: '', manual: '', review: null, confirming: false })
const scanVideo = ref(null)
let qrController = null
const imagePreview = reactive({
  open: false,
  src: '',
  title: '',
  subtitle: '',
  meta: { uploadedAt: '', originalName: '' },
  downloadUrl: ''
})

function previewChecklistPhoto(photo, reservationId, stageKey, context = {}) {
  if (!photo) return
  const src = adminChecklistPhotoSrc(photo, reservationId, stageKey)
  const reservation = context.reservation || null
  const checklist = context.checklist || null
  const title = context.title || checklist?.title || checklistStageName(stageKey)
  const subtitle = context.subtitle || [reservation?.event, reservation?.store, reservation?.username].filter(Boolean).join(' · ')
  imagePreview.src = src
  imagePreview.downloadUrl = context.downloadUrl || src
  imagePreview.title = title || '檢核照片'
  imagePreview.subtitle = subtitle
  imagePreview.meta = {
    uploadedAt: context.uploadedAt ?? (formatChecklistUploadedAt(photo?.uploadedAt) || ''),
    originalName: context.originalName ?? (photo?.originalName || '')
  }
  imagePreview.open = true
}

function closeImagePreview() {
  imagePreview.open = false
  imagePreview.src = ''
  imagePreview.title = ''
  imagePreview.subtitle = ''
  imagePreview.meta = { uploadedAt: '', originalName: '' }
  imagePreview.downloadUrl = ''
}

function resetScannerVideo(){
  const videoEl = scanVideo.value
  if (videoEl) {
    try { videoEl.pause?.() } catch {}
    try { videoEl.srcObject = null } catch {}
  }
}

function openScan(){
  scan.value.error = ''
  scan.value.manual = ''
  scan.value.review = null
  scan.value.confirming = false
  scan.value.open = true
}
function closeScan(){
  if (qrController) { try { qrController.stop() } catch {} qrController = null }
  resetScannerVideo()
  scan.value.review = null
  scan.value.confirming = false
  scan.value.scanning = false
  scan.value.open = false
}

watch(() => scan.value.open, async (v) => {
  if (v) {
    // Auto start scanner
    try {
      scan.value.error = ''
      scan.value.scanning = false
      await nextTick()
      const videoEl = scanVideo.value
      if (!videoEl) {
        scan.value.error = '相機元件載入中，請稍後再試'
        return
      }
      if (!(navigator?.mediaDevices?.getUserMedia)) {
        scan.value.error = '此裝置或瀏覽器不支援相機存取'
        return
      }
      resetScannerVideo()
      const { stop } = await startQrScanner({
        video: videoEl,
        onDecode: async (raw) => { if (!scan.value.scanning) return; await submitCode(raw) },
        onError: (err) => {
          if (!scan.value.error) {
            scan.value.error = err?.message || '相機讀取發生錯誤'
          }
        }
      })
      qrController = { stop }
      scan.value.scanning = true
    } catch (e) {
      console.error('startQrScanner error:', e)
      scan.value.error = '無法啟動相機，請檢查權限或改用手動輸入'
    }
  } else {
    if (qrController) { try { qrController.stop() } catch {} qrController = null }
    resetScannerVideo()
    scan.value.scanning = false
  }
})

// 自動在掃描分頁啟動/停止相機
watch(tab, (t) => {
  if (t === 'scan') {
    if (!scan.value.open) openScan()
  } else {
    if (scan.value.open) closeScan()
  }
})

async function submitManual(){ if (scan.value.manual) await submitCode(scan.value.manual) }

async function submitCode(raw){
  try{
    const code = String(raw).replace(/\s+/g,'')
    if (!code) return
    scan.value.error = ''
    const { data } = await axios.post(`${API}/admin/reservations/progress_scan`, { code, preview: true })
    if (data?.ok){
      const payload = data.data || {}
      const stageRaw = payload.stage || payload.from || ''
      const nextStageRaw = payload.nextStage || payload.to || ''
      const stage = stageRaw ? normalizeAdminReservationStatus(stageRaw) : ''
      const nextStage = nextStageRaw ? normalizeAdminReservationStatus(nextStageRaw) : ''
      const normalizedChecklist = normalizeAdminChecklist(stage, payload.checklist || {})
      const stageChecklistMap = payload.stageChecklist && typeof payload.stageChecklist === 'object' ? payload.stageChecklist : {}
      const stageInfo = stage && stageChecklistMap[stage] ? stageChecklistMap[stage] : null
      const normalizedPhotoCount = typeof normalizedChecklist.photoCount === 'number'
        ? normalizedChecklist.photoCount
        : normalizedChecklist.photos.length
      const stagePhotoCount = stageInfo && typeof stageInfo.photoCount === 'number'
        ? stageInfo.photoCount
        : normalizedPhotoCount
      normalizedChecklist.photoCount = stagePhotoCount
      const requiresChecklistStage = stage ? CHECKLIST_STAGE_KEYS.includes(stage) : false
      const requiresChecklist = payload.requiresChecklist === true
        ? true
        : (payload.requiresChecklist === false ? false : requiresChecklistStage)
      const needsConfirmation = payload.needsConfirmation === undefined ? false : !!payload.needsConfirmation
      const checklistReady = payload.checklistReady !== undefined
        ? !!payload.checklistReady
        : (requiresChecklist ? (normalizedChecklist.completed && stagePhotoCount > 0) : true)
      const shouldReview = needsConfirmation || requiresChecklist
      if (shouldReview){
        scan.value.review = {
          code,
          stage,
          nextStage,
          stageLabel: payload.stageLabel || checklistStageName(stage),
          nextStageLabel: payload.nextStageLabel || (nextStage ? checklistStageName(nextStage) : ''),
          reservation: payload.reservation || {},
          checklist: normalizedChecklist,
          checklistReady,
          requiresChecklist,
          stageChecklist: stageChecklistMap,
          pendingTransition: { from: payload.from, to: payload.to }
        }
        scan.value.manual = ''
        scan.value.scanning = false
      } else if (payload.from && payload.to) {
        scan.value.manual = ''
        const fromStageNormalized = payload.from ? normalizeAdminReservationStatus(payload.from) : ''
        const toStageNormalized = payload.to ? normalizeAdminReservationStatus(payload.to) : ''
        const fromLabel = fromStageNormalized ? (checklistStageName(fromStageNormalized) || payload.from) : (payload.from || '')
        const toLabel = toStageNormalized ? (checklistStageName(toStageNormalized) || payload.to) : (payload.to || '')
        const stageMessage = toLabel ? `${fromLabel} → ${toLabel}` : fromLabel
        await showNotice(`✅ 已進入下一階段：${stageMessage}`)
        await loadAdminReservations()
        closeScan()
      } else {
        scan.value.manual = ''
        await loadAdminReservations()
        closeScan()
      }
    } else {
      const msg = data?.message || '進度更新失敗'
      scan.value.error = msg
      await showNotice(msg, { title: '更新失敗' })
    }
  } catch(e){
    const message = e?.response?.data?.message || e.message
    scan.value.error = message
    await showNotice(message, { title: '錯誤' })
  }
}

function resumeScanAfterReview(){
  scan.value.review = null
  scan.value.confirming = false
  scan.value.error = ''
  scan.value.manual = ''
  scan.value.scanning = true
}

async function confirmScanReview(){
  const review = scan.value.review
  if (!review) return
  if (review.requiresChecklist && !review.checklistReady) return
  scan.value.confirming = true
  try{
    const { data } = await axios.post(`${API}/admin/reservations/progress_scan`, { code: review.code, confirm: true })
    if (data?.ok){
      const result = data.data || {}
      const fromStage = result.from || review.stage
      const toStage = result.to || review.nextStage || ''
      const fromLabel = fromStage ? (checklistStageName(fromStage) || review.stageLabel || fromStage) : (review.stageLabel || review.stage)
      const toLabelRaw = toStage ? (checklistStageName(toStage) || review.nextStageLabel || toStage) : (review.nextStageLabel || '')
      const stageMessage = toLabelRaw ? `${fromLabel} → ${toLabelRaw}` : fromLabel
      await showNotice(`✅ 已進入下一階段：${stageMessage}`)
      await loadAdminReservations()
      closeScan()
    } else {
      const msg = data?.message || '更新失敗'
      await showNotice(msg, { title: '更新失敗' })
      scan.value.error = msg
      if (scan.value.review) scan.value.review.checklistReady = false
    }
  } catch (e){
    const message = e?.response?.data?.message || e.message
    scan.value.error = message
    await showNotice(message, { title: '錯誤' })
    if (scan.value.review) scan.value.review.checklistReady = false
  } finally {
    scan.value.confirming = false
  }
}

function cancelScanReview(){
  if (scan.value.confirming) return
  resumeScanAfterReview()
}

async function loadTombstones(){
  tombstoneLoading.value = true
  try{
    const params = {}
    if (tombstoneFilters.value.provider) params.provider = tombstoneFilters.value.provider
    if (tombstoneFilters.value.subject) params.subject = tombstoneFilters.value.subject
    if (tombstoneFilters.value.email) params.email = tombstoneFilters.value.email
    const { data } = await axios.get(`${API}/admin/tombstones`, { params })
    tombstones.value = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
    tombstonesLoaded.value = true
  } catch (e){
    await showNotice(e?.response?.data?.message || e.message, { title: '讀取失敗' })
  } finally { tombstoneLoading.value = false }
}

async function addTombstone(){
  if (!tombstoneForm.value.subject && !tombstoneForm.value.email){ await showNotice('請至少輸入 subject 或 email', { title: '格式錯誤' }); return }
  tombstoneLoading.value = true
  try{
    const body = { provider: tombstoneForm.value.provider }
    if (tombstoneForm.value.subject) body.subject = tombstoneForm.value.subject
    if (tombstoneForm.value.email) body.email = tombstoneForm.value.email
    if (tombstoneForm.value.reason) body.reason = tombstoneForm.value.reason
    const { data } = await axios.post(`${API}/admin/tombstones`, body)
    if (data?.ok){
      tombstoneForm.value = { provider: tombstoneForm.value.provider, subject: '', email: '', reason: '' }
      await loadTombstones()
      await showNotice('已新增封鎖')
    } else {
      await showNotice(data?.message || '新增失敗', { title: '新增失敗' })
    }
  } catch (e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally { tombstoneLoading.value = false }
}

async function deleteTombstone(row){
  if (!row?.id) return
  if (!(await showConfirm('確定解除封鎖？', { title: '解除確認' }))) return
  tombstoneLoading.value = true
  try{
    const { data } = await axios.delete(`${API}/admin/tombstones/${row.id}`)
    if (data?.ok){ await loadTombstones(); await showNotice('已解除封鎖') }
    else await showNotice(data?.message || '解除失敗', { title: '解除失敗' })
  } catch (e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally { tombstoneLoading.value = false }
}

const showProductForm = ref(false)
const showEventForm = ref(false)
const eventFormMode = ref('create')
const editingEvent = ref(null)
const newProduct = ref({ name: '', price: 0, description: '' })
const defaultEventForm = () => ({ code: '', title: '', starts_at: '', ends_at: '', deadline: '', location: '', description: '', cover: '', rules: '' })
const newEvent = ref(defaultEventForm())
const coverFile = ref(null)
const coverPreview = ref('')
const coverUploadData = ref('')
const COVER_TARGET_WIDTH = 900
const COVER_TARGET_HEIGHT = 600
const COVER_TARGET_RATIO = COVER_TARGET_WIDTH / COVER_TARGET_HEIGHT // 固定 900x600（3:2）
const productCoverUrl = (p) => `${API}/tickets/cover/${encodeURIComponent(p?.name || '')}`
// Ticket cover list
// removed ticket cover list tab; manage covers inside Products section

function copyToClipboard(text){
  if (!text) return
  try { navigator.clipboard?.writeText(String(text)) } catch {}
}

const isEditingEvent = computed(() => eventFormMode.value === 'edit' && !!editingEvent.value)
const eventFormHeading = computed(() => isEditingEvent.value ? '編輯活動' : '新增活動')
const eventFormActionLabel = computed(() => isEditingEvent.value ? '儲存變更' : '建立活動')
const normalizeLocalInput = (value) => {
  if (!value && value !== 0) return ''
  const str = String(value).trim().replace(' ', 'T')
  return str.length > 16 ? str.slice(0, 16) : str
}
const eventFormComparable = (form) => ({
  code: (form?.code || '').trim(),
  title: (form?.title || '').trim(),
  starts_at: normalizeLocalInput(form?.starts_at || ''),
  ends_at: normalizeLocalInput(form?.ends_at || ''),
  deadline: normalizeLocalInput(form?.deadline || ''),
  location: (form?.location || '').trim(),
  description: (form?.description || '').trim(),
  cover: (form?.cover || '').trim(),
  rules: formatRulesInput(form?.rules || '')
})
const eventFormFromEvent = (event) => {
  if (!event) return defaultEventForm()
  return {
    code: event.code || '',
    title: event.title || event.name || '',
    starts_at: toDatetimeLocal(event.starts_at || event.start_at || ''),
    ends_at: toDatetimeLocal(event.ends_at || event.end_at || ''),
    deadline: toDatetimeLocal(event.deadline || ''),
    location: event.location || '',
    description: event.description || '',
    cover: event.cover || '',
    rules: formatRulesInput(event.rules)
  }
}
const eventFormBaseline = computed(() => eventFormComparable(isEditingEvent.value ? eventFormFromEvent(editingEvent.value) : defaultEventForm()))
const eventFormDirty = computed(() => JSON.stringify(eventFormComparable(newEvent.value)) !== JSON.stringify(eventFormBaseline.value))
const parseLocalDateTimeInput = (value) => {
  const normalized = normalizeLocalInput(value)
  if (!normalized) return null
  const date = new Date(normalized.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}
const eventSchedulePreview = computed(() => {
  const start = parseLocalDateTimeInput(newEvent.value.starts_at)
  const end = parseLocalDateTimeInput(newEvent.value.ends_at)
  if (start && end) return formatDateTimeRange(start, end)
  if (start) return formatDateTime(start)
  return ''
})
const eventFormErrors = computed(() => {
  const errors = []
  const form = eventFormComparable(newEvent.value)
  const start = parseLocalDateTimeInput(form.starts_at)
  const end = parseLocalDateTimeInput(form.ends_at)
  const deadline = parseLocalDateTimeInput(form.deadline)
  if (!form.title) errors.push('請輸入活動名稱')
  if (!form.starts_at || !start) errors.push('請輸入有效的開始時間')
  if (!form.ends_at || !end) errors.push('請輸入有效的結束時間')
  if (start && end && end < start) errors.push('結束時間需晚於開始時間')
  if (deadline && start && deadline > start) errors.push('截止時間應早於開始時間')
  return errors
})
const showEventFormErrors = computed(() => eventFormErrors.value.length > 0 && (eventFormDirty.value || isEditingEvent.value))
const ensureEventValid = async () => {
  if (!eventFormErrors.value.length) return true
  await showNotice(eventFormErrors.value[0], { title: '格式錯誤' })
  return false
}

const resetEventForm = (options = {}) => {
  newEvent.value = defaultEventForm()
  coverFile.value = null
  coverPreview.value = ''
  coverUploadData.value = ''
  if (!options.keepEditing) editingEvent.value = null
  if (!options.keepMode) eventFormMode.value = 'create'
}

const toDatetimeLocal = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) {
    const pad = (n) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  const normalized = String(value).replace(' ', 'T')
  return normalized.length >= 16 ? normalized.slice(0, 16) : normalized
}

const formatRulesInput = (value) => {
  if (Array.isArray(value)) return value.join(', ')
  if (!value) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.join(', ')
    } catch {}
    return trimmed
  }
  return ''
}

const parseRulesInput = (value) => {
  if (!value) return []
  return String(value)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

const hydrateEventForm = (event) => {
  if (!event) {
    resetEventForm({ keepMode: true, keepEditing: false })
    return
  }
  newEvent.value = eventFormFromEvent(event)
  coverPreview.value = event.cover || `${API}/events/${event.id}/cover`
  coverUploadData.value = ''
}

const clearEventCoverPreview = () => {
  coverPreview.value = ''
  coverUploadData.value = ''
  coverFile.value = null
}

const openCreateEventForm = () => {
  if (showEventForm.value && eventFormMode.value === 'create') {
    cancelEventForm()
    return
  }
  eventFormMode.value = 'create'
  resetEventForm({ keepMode: true })
  showEventForm.value = true
}

const startEditEvent = (event) => {
  if (!event) return
  editingEvent.value = { ...event }
  eventFormMode.value = 'edit'
  hydrateEventForm(event)
  showEventForm.value = true
}

const confirmDiscardEventForm = async () => {
  if (!eventFormDirty.value) return true
  return await showConfirm('尚有未儲存的變更，確定要放棄？', { title: '放棄變更' }).catch(() => false)
}

const cancelEventForm = async () => {
  if (!(await confirmDiscardEventForm())) return
  showEventForm.value = false
  resetEventForm()
}

const restoreEditingSnapshot = () => {
  if (editingEvent.value) hydrateEventForm(editingEvent.value)
}

// ===== 第三方綁定（Admin） =====
// OAuth provider 清理工具
const oauthTools = ref({ cleaning: false })

async function cleanupOAuthProviders(){
  if (!(await showConfirm('將會清理並正規化 oauth_identities.provider（trim+lower），繼而移除重複與空值。確定執行？', { title: '一鍵清理確認' }))) return
  oauthTools.value.cleaning = true
  try{
    const { data } = await axios.post(`${API}/admin/oauth/cleanup_providers`)
    if (data?.ok){
      const d = data?.data || data
      await showNotice(`已清理完成\n去除重複：${d.duplicates_removed || 0}\n正規化：${d.normalized || 0}\n移除空值：${d.emptied_removed || 0}`)
    } else {
      await showNotice(data?.message || '清理失敗', { title: '清理失敗' })
    }
  } catch(e){
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally { oauthTools.value.cleaning = false }
}
const oauthPanel = ref({
  visible: false,
  user: null,
  list: [],
  loading: false,
  saving: false,
  form: { provider: 'line', subject: '', email: '' },
})

function openOAuthManager(u){
  oauthPanel.value.visible = true
  oauthPanel.value.user = u
  oauthPanel.value.form = { provider: 'line', subject: '', email: '' }
  reloadOAuthList()
}
function closeOAuthManager(){ oauthPanel.value.visible = false; oauthPanel.value.user = null; oauthPanel.value.list = [] }
async function reloadOAuthList(){
  if (!oauthPanel.value.user?.id) return
  oauthPanel.value.loading = true
  try{
    const { data } = await axios.get(`${API}/admin/users/${oauthPanel.value.user.id}/oauth_identities`)
    oauthPanel.value.list = Array.isArray(data?.data) ? data.data : []
  } catch (e){ await showNotice(e?.response?.data?.message || e.message, { title: '讀取失敗' }) }
  finally { oauthPanel.value.loading = false }
}
async function addOAuthBinding(){
  const f = oauthPanel.value.form
  const provider = String(f.provider || '').toLowerCase()
  if (!['line','google'].includes(provider)) { await showNotice('provider 僅能為 line 或 google', { title: '格式錯誤' }); return }
  if (!f.subject || f.subject.length < 3) { await showNotice('請輸入正確 subject', { title: '格式錯誤' }); return }
  oauthPanel.value.saving = true
  try{
    const body = { provider, subject: f.subject.trim() }
    if (f.email && /@/.test(f.email)) body.email = f.email.trim()
    const { data } = await axios.post(`${API}/admin/users/${oauthPanel.value.user.id}/oauth_identities`, body)
    if (data?.ok){
      await reloadOAuthList()
      oauthPanel.value.form = { provider, subject: '', email: f.email || '' }
      await showNotice('已綁定')
    } else {
      await showNotice(data?.message || '綁定失敗', { title: '綁定失敗' })
    }
  } catch (e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally { oauthPanel.value.saving = false }
}
async function removeOAuthBinding(it){
  if (!it?.provider) return
  if (!(await showConfirm(`確定解除 ${String(it.provider).toUpperCase()} 綁定？`, { title: '解除綁定確認' }))) return
  try{
    const { data } = await axios.delete(`${API}/admin/users/${oauthPanel.value.user.id}/oauth_identities/${encodeURIComponent(String(it.provider || '').toLowerCase())}`)
    if (data?.ok){ await reloadOAuthList(); await showNotice('已解除綁定') }
    else await showNotice(data?.message || '解除失敗', { title: '解除失敗' })
  } catch (e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
}

function processImageToRatio(file, { mime = 'image/jpeg', quality = 0.85 } = {}){
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('請選擇圖片檔案'))
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('讀取檔案失敗'))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const w = img.naturalWidth || img.width
        const h = img.naturalHeight || img.height
        if (!w || !h) return reject(new Error('圖片尺寸無效'))
        // 中心裁切到指定比例
        let cropW, cropH
        if (w / h > COVER_TARGET_RATIO) { // 太寬，裁寬度
          cropH = h
          cropW = Math.floor(h * COVER_TARGET_RATIO)
        } else { // 太高，裁高度
          cropW = w
          cropH = Math.floor(w / COVER_TARGET_RATIO)
        }
        const sx = Math.floor((w - cropW) / 2)
        const sy = Math.floor((h - cropH) / 2)

        // 輸出固定 900x600
        const targetW = COVER_TARGET_WIDTH
        const targetH = COVER_TARGET_HEIGHT

        const canvas = document.createElement('canvas')
        canvas.width = targetW
        canvas.height = targetH
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, targetW, targetH)
        const dataUrl = canvas.toDataURL(mime, quality)
        resolve({ dataUrl, width: targetW, height: targetH })
      }
      img.onerror = () => reject(new Error('圖片載入失敗'))
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

async function onCoverFileChange(e){
  const file = e?.target?.files?.[0]
  coverFile.value = file || null
  if (!file) { coverPreview.value = ''; coverUploadData.value = ''; return }
  try{
    const { dataUrl } = await processImageToRatio(file)
    coverPreview.value = dataUrl
    coverUploadData.value = dataUrl
  } catch (err){
    await showNotice(err.message, { title: '錯誤' })
    coverPreview.value = ''
    coverUploadData.value = ''
  }
}
const defaultStoreForm = () => ({
  name: '',
  address: '',
  external_url: '',
  business_hours: '',
  pre_start: '',
  pre_end: '',
  post_start: '',
  post_end: '',
  priceItems: [{ type: '大鐵人', normal: 0, early: 0, productId: '' }]
})
const newStore = ref(defaultStoreForm())
const storeTemplateForm = ref(defaultStoreForm())

const filteredUsers = computed(() => {
  const q = userQuery.value.toLowerCase()
  if (!q) return users.value
  return users.value.filter(u =>
    String(u.username || '').toLowerCase().includes(q) ||
    String(u.email || '').toLowerCase().includes(q)
  )
})

const filteredEvents = computed(() => {
  const q = eventQuery.value.trim().toLowerCase()
  if (!q) return events.value
  return events.value.filter(e => {
    const name = String(e.name || e.title || '').toLowerCase()
    const code = String(e.code || '').toLowerCase()
    const loc = String(e.location || '').toLowerCase()
    return name.includes(q) || code.includes(q) || loc.includes(q)
  })
})

const filteredAdminOrders = computed(() => {
  let list = adminOrders.value
  if (orderStatusFilter.value !== 'all') {
    list = list.filter(o => o.status === orderStatusFilter.value)
  }
  const q = orderQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(o => {
    return String(o.code || '').toLowerCase().includes(q)
      || String(o.username || '').toLowerCase().includes(q)
      || String(o.email || '').toLowerCase().includes(q)
      || String(o.ticketType || '').toLowerCase().includes(q)
      || String(o.eventName || '').toLowerCase().includes(q)
      || String(o.status || '').toLowerCase().includes(q)
      || String(o.remittance?.bankCode || '').toLowerCase().includes(q)
      || String(o.remittance?.bankAccount || '').toLowerCase().includes(q)
      || String(o.remittance?.accountName || '').toLowerCase().includes(q)
      || String(o.remittance?.bankName || '').toLowerCase().includes(q)
      || String(o.remittance?.info || '').toLowerCase().includes(q)
  })
})

const usersTotalPages = computed(() => {
  if (!usersMeta.limit) return 1
  return Math.max(1, Math.ceil(Math.max(0, usersMeta.total) / usersMeta.limit))
})
const usersCurrentPage = computed(() => {
  if (!usersMeta.limit) return 1
  return Math.min(usersTotalPages.value, Math.floor(usersMeta.offset / usersMeta.limit) + 1)
})
const usersHasPrev = computed(() => usersCurrentPage.value > 1)
const usersHasNext = computed(() => usersCurrentPage.value < usersTotalPages.value)

const eventsTotalPages = computed(() => {
  if (!eventsMeta.limit) return 1
  return Math.max(1, Math.ceil(Math.max(0, eventsMeta.total) / eventsMeta.limit))
})
const eventsCurrentPage = computed(() => {
  if (!eventsMeta.limit) return 1
  return Math.min(eventsTotalPages.value, Math.floor(eventsMeta.offset / eventsMeta.limit) + 1)
})
const eventsHasPrev = computed(() => eventsCurrentPage.value > 1)
const eventsHasNext = computed(() => eventsCurrentPage.value < eventsTotalPages.value)

const adminOrdersTotalPages = computed(() => {
  if (!adminOrdersMeta.limit) return 1
  return Math.max(1, Math.ceil(Math.max(0, adminOrdersMeta.total) / adminOrdersMeta.limit))
})
const adminOrdersCurrentPage = computed(() => {
  if (!adminOrdersMeta.limit) return 1
  return Math.min(adminOrdersTotalPages.value, Math.floor(adminOrdersMeta.offset / adminOrdersMeta.limit) + 1)
})
const adminOrdersHasPrev = computed(() => adminOrdersCurrentPage.value > 1)
const adminOrdersHasNext = computed(() => adminOrdersCurrentPage.value < adminOrdersTotalPages.value)

function goUserPage(page) {
  const target = Math.min(Math.max(1, Number(page) || 1), usersTotalPages.value)
  const nextOffset = (target - 1) * usersMeta.limit
  loadUsers({ offset: nextOffset })
}
function goUserPrev() {
  if (!usersHasPrev.value) return
  goUserPage(usersCurrentPage.value - 1)
}
function goUserNext() {
  if (!usersHasNext.value) return
  goUserPage(usersCurrentPage.value + 1)
}
function performUserSearch() {
  if (loading.value) return
  usersMeta.offset = 0
  loadUsers({ offset: 0 })
}

function goEventPage(page) {
  const target = Math.min(Math.max(1, Number(page) || 1), eventsTotalPages.value)
  const nextOffset = (target - 1) * eventsMeta.limit
  loadEvents({ offset: nextOffset })
}
function goEventPrev() {
  if (!eventsHasPrev.value) return
  goEventPage(eventsCurrentPage.value - 1)
}
function goEventNext() {
  if (!eventsHasNext.value) return
  goEventPage(eventsCurrentPage.value + 1)
}
function performEventSearch() {
  if (loading.value) return
  eventsMeta.offset = 0
  loadEvents({ offset: 0 })
}

function goAdminOrderPage(page) {
  const target = Math.min(Math.max(1, Number(page) || 1), adminOrdersTotalPages.value)
  const nextOffset = (target - 1) * adminOrdersMeta.limit
  loadOrders({ offset: nextOffset })
}
function goAdminOrderPrev() {
  if (!adminOrdersHasPrev.value) return
  goAdminOrderPage(adminOrdersCurrentPage.value - 1)
}
function goAdminOrderNext() {
  if (!adminOrdersHasNext.value) return
  goAdminOrderPage(adminOrdersCurrentPage.value + 1)
}
function performOrderSearch() {
  if (ordersLoading.value) return
  adminOrdersMeta.offset = 0
  loadOrders({ offset: 0 })
}
const hasOrderFilters = computed(() => {
  return orderStatusFilter.value !== 'all' || orderQuery.value.trim().length > 0
})
async function clearOrderFilters() {
  if (ordersLoading.value) return
  orderStatusFilter.value = 'all'
  orderQuery.value = ''
  adminOrdersMeta.offset = 0
  await loadOrders({ offset: 0 })
}

const filteredAdminReservations = computed(() => {
  let list = adminReservations.value
  if (reservationStatusFilter.value === 'pending') {
    list = list.filter(r => r.status !== 'done')
  } else if (reservationStatusFilter.value !== 'all') {
    list = list.filter(r => r.status === reservationStatusFilter.value)
  }
  const q = reservationQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(r => {
    return String(r.id ?? '').toLowerCase().includes(q)
      || String(r.username || '').toLowerCase().includes(q)
      || String(r.email || '').toLowerCase().includes(q)
      || String(r.event || '').toLowerCase().includes(q)
      || String(r.store || '').toLowerCase().includes(q)
      || String(r.ticket_type || '').toLowerCase().includes(q)
      || String(r.status || '').toLowerCase().includes(q)
  })
})

const adminReservationTotalPages = computed(() => {
  if (!adminReservationsMeta.limit) return 1
  return Math.max(1, Math.ceil(Math.max(0, adminReservationsMeta.total) / adminReservationsMeta.limit))
})

const adminReservationCurrentPage = computed(() => {
  if (!adminReservationsMeta.limit) return 1
  return Math.min(
    adminReservationTotalPages.value,
    Math.floor(adminReservationsMeta.offset / adminReservationsMeta.limit) + 1
  )
})

const adminReservationsHasPrev = computed(() => adminReservationCurrentPage.value > 1)
const adminReservationsHasNext = computed(() => adminReservationCurrentPage.value < adminReservationTotalPages.value)

function goAdminReservationPage(page) {
  const target = Math.min(Math.max(1, Number(page) || 1), adminReservationTotalPages.value)
  const nextOffset = (target - 1) * adminReservationsMeta.limit
  loadAdminReservations({ offset: nextOffset })
}

function goAdminReservationPrev() {
  if (!adminReservationsHasPrev.value) return
  goAdminReservationPage(adminReservationCurrentPage.value - 1)
}

function goAdminReservationNext() {
  if (!adminReservationsHasNext.value) return
  goAdminReservationPage(adminReservationCurrentPage.value + 1)
}

function performReservationSearch() {
  if (reservationsLoading.value) return
  adminReservationsMeta.offset = 0
  loadAdminReservations({ offset: 0 })
}
const hasReservationFilters = computed(() => {
  return reservationStatusFilter.value !== 'all' || reservationQuery.value.trim().length > 0
})
async function clearReservationFilters() {
  if (reservationsLoading.value) return
  reservationStatusFilter.value = 'all'
  reservationQuery.value = ''
  adminReservationsMeta.offset = 0
  await loadAdminReservations({ offset: 0 })
}

function triggerEventCoverInput(id){
  const el = document.getElementById(`upload-${id}`) || document.getElementById(`upload-event-${id}`)
  if (el) el.click()
}

async function changeEventCover(ev, row){
  const file = ev?.target?.files?.[0]
  if (!file) return
  try{
    const { dataUrl } = await processImageToRatio(file)
    // Open confirmation modal instead of immediate upload
    openCoverConfirm({ kind: 'event', eventId: row.id, name: (row.name || row.title || `#${row.id}`), dataUrl })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally { ev.target.value = '' }
}

async function deleteEventCover(row){
  if (!(await showConfirm(`確定刪除活動「${row.name || row.title}」封面？`, { title: '刪除封面' }))) return
  try{
    const { data } = await axios.delete(`${API}/admin/events/${row.id}/cover`)
    if (data?.ok){ await showNotice('已刪除'); await loadEvents() }
    else await showNotice(data?.message || '刪除失敗', { title: '刪除失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
}

async function deleteEvent(row){
  if (!row || !row.id) return
  const name = row.name || row.title || `#${row.id}`
  const sure = await showConfirm(`確定刪除活動「${name}」？此動作無法復原。`, { title: '刪除活動' }).catch(()=>false)
  if (!sure) return
  try{
    const { data } = await axios.delete(`${API}/admin/events/${row.id}`)
    if (data?.ok){
      if (selectedEvent.value && Number(selectedEvent.value.id) === Number(row.id)) selectedEvent.value = null
      await showNotice('活動已刪除')
      await loadEvents()
    } else {
      await showNotice(data?.message || '刪除失敗', { title: '刪除失敗' })
    }
  } catch(e){
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  }
}

function triggerProductCoverInput(p){
  const el = document.getElementById(`upload-ticket-${encodeURIComponent(p.name || '')}`)
  if (el) el.click()
}

async function changeProductCover(ev, p){
  const file = ev?.target?.files?.[0]
  if (!file) return
  try{
    const { dataUrl } = await processImageToRatio(file)
    openCoverConfirm({ kind: 'product', productType: (p.name || ''), name: (p.name || ''), dataUrl })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally { ev.target.value = '' }
}

async function deleteProductCover(p){
  if (!(await showConfirm(`確定刪除「${p.name}」封面？`, { title: '刪除封面' }))) return
  try{
    const type = encodeURIComponent(p.name || '')
    const { data } = await axios.delete(`${API}/admin/tickets/types/${type}/cover`)
    if (data?.ok){ await showNotice('已刪除') }
    else await showNotice(data?.message || '刪除失敗', { title: '刪除失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
}

const formatDate = (input) => formatDateTime(input)
const formatChecklistUploadedAt = (value) => formatDateTime(value, { fallback: '' })
const formatChecklistCompletedAt = (value) => formatDateTime(value, { fallback: '' })
const formatRange = (a,b) => formatDateTimeRange(a, b)

async function checkSession() {
  try {
    const { data } = await axios.get(`${API}/whoami`);
    const r = String(data?.data?.role || '').toUpperCase()
    selfRole.value = r
    const allowed = ['ADMIN','STORE','EDITOR','OPERATOR']
    return !!data?.ok && allowed.includes(r);
  } catch {
    return false;
  }
}

async function loadUsers(options = {}) {
  if (options && typeof options.offset === 'number' && Number.isFinite(options.offset)) {
    usersMeta.offset = Math.max(0, Math.floor(options.offset))
  }
  if (options && typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    usersMeta.limit = Math.max(1, Math.min(200, Math.floor(options.limit)))
  }
  const params = {
    limit: usersMeta.limit,
    offset: usersMeta.offset
  }
  const queryTrimmed = userQuery.value.trim()
  if (queryTrimmed) params.q = queryTrimmed
  loading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/users`, { params })
    if (data?.ok) {
      const payload = data.data || {}
      const itemsRaw = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : [])
      users.value = itemsRaw.map(u => {
        const role = String(u.role || 'USER').toUpperCase()
        return {
          ...u,
          role,
          _newRole: role,
          _saving: false,
          _edit: false,
          _username: u.username,
          _email: u.email,
        }
      })
      const meta = payload.meta || {}
      const responseLimit = Number.isFinite(meta.limit) ? Number(meta.limit) : params.limit
      const responseOffset = Number.isFinite(meta.offset) ? Number(meta.offset) : params.offset
      const responseTotal = Number.isFinite(meta.total) ? Number(meta.total) : users.value.length
      usersMeta.limit = Math.max(1, responseLimit)
      usersMeta.offset = Math.max(0, responseOffset)
      usersMeta.total = Math.max(0, responseTotal)
      const hasMore = meta.hasMore != null
        ? !!meta.hasMore
        : (usersMeta.offset + users.value.length) < usersMeta.total
      usersMeta.hasMore = hasMore

      if (
        usersMeta.total > 0 &&
        users.value.length === 0 &&
        usersMeta.offset >= usersMeta.total
      ) {
        const totalPages = Math.max(1, Math.ceil(usersMeta.total / usersMeta.limit))
        const lastPageOffset = Math.max(0, (totalPages - 1) * usersMeta.limit)
        if (lastPageOffset !== usersMeta.offset) {
          usersMeta.offset = lastPageOffset
          return loadUsers({ offset: lastPageOffset })
        }
      }
      usersLoaded.value = true
    } else {
      users.value = []
    }
  } catch (e) {
    if (e?.response?.status === 401) router.push('/login')
    else if (e?.response?.status === 403) await showNotice('需要管理員權限', { title: '權限不足' })
  } finally {
    loading.value = false
  }
}

function startEditUser(u){ if (selfRole.value !== 'ADMIN') return; u._edit = true }
function cancelEditUser(u){ u._edit = false; u._username = u.username; u._email = u.email }
async function saveUserProfile(u){
  if (selfRole.value !== 'ADMIN') return
  const payload = {}
  if ((u._username||'') !== (u.username||'')) payload.username = u._username
  if ((u._email||'') !== (u.email||'')) payload.email = u._email
  const roleChanged = String(u._newRole || '').toUpperCase() !== String(u.role || 'USER').toUpperCase()
  if (!Object.keys(payload).length && !roleChanged) { u._edit = false; return }
  u._saving = true
  try{
    // 先更新角色，後更新基本資料（或反之），確保部分成功也能提示
    if (roleChanged){
      const role = String(u._newRole || '').toUpperCase()
      if (!['USER','STORE','ADMIN','EDITOR','OPERATOR'].includes(role)) throw new Error('角色不正確')
      const r1 = await axios.patch(`${API}/admin/users/${u.id}/role`, { role })
      if (!(r1?.data?.ok)) throw new Error(r1?.data?.message || '更新角色失敗')
    }
    if (Object.keys(payload).length){
      const r2 = await axios.patch(`${API}/admin/users/${u.id}`, payload)
      if (!(r2?.data?.ok)) throw new Error(r2?.data?.message || '更新資料失敗')
    }
    await loadUsers();
    await showNotice('已更新')
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally { u._saving = false; u._edit = false }
}
async function resetUserPassword(u){
  if (selfRole.value !== 'ADMIN') return
  const pwd = await showPrompt(`為使用者 ${u.username} 設定新密碼（至少 8 碼）：`, { title: '重設密碼', inputType: 'password', confirmText: '送出' }).catch(()=> '')
  if (!pwd) return
  if (pwd.length < 8) { await showNotice('密碼至少 8 碼', { title: '格式錯誤' }); return }
  u._saving = true
  try{
    const { data } = await axios.patch(`${API}/admin/users/${u.id}/password`, { password: pwd })
    if (data?.ok) await showNotice('已重設密碼')
    else await showNotice(data?.message || '重設失敗', { title: '重設失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally { u._saving = false }
}

async function deleteUser(u){
  if (selfRole.value !== 'ADMIN') return
  if (!u?.id) return
  const name = u.username || u.email || u.id
  const msg = `確定刪除使用者「${name}」？此動作將一併刪除該用戶的訂單、預約、票券與轉贈紀錄，並移除活動擁有權。`
  if (!(await showConfirm(msg, { title: '刪除店面' }))) return
  try{
    const { data } = await axios.delete(`${API}/admin/users/${u.id}`)
    if (data?.ok){
      await showNotice('已刪除')
      await loadUsers()
    } else {
      await showNotice(data?.message || '刪除失敗', { title: '刪除失敗' })
    }
  } catch(e){
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  }
}

async function loadProducts() {
  loading.value = true
  try {
    const { data } = await axios.get(`${API}/products`)
    const list = Array.isArray(data?.data) ? data.data : []
    products.value = list.map(p => ({
      ...p,
      price: Number(p.price),
      code: p.code || (p?.id != null ? `PD${String(p.id).padStart(6,'0')}` : '')
    }))
    productsLoaded.value = true
  } finally { loading.value = false }
}

async function loadEvents(options = {}) {
  if (options && typeof options.offset === 'number' && Number.isFinite(options.offset)) {
    eventsMeta.offset = Math.max(0, Math.floor(options.offset))
  }
  if (options && typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    eventsMeta.limit = Math.max(1, Math.min(200, Math.floor(options.limit)))
  }
  const params = {
    limit: eventsMeta.limit,
    offset: eventsMeta.offset
  }
  const queryTrimmed = eventQuery.value.trim()
  if (queryTrimmed) params.q = queryTrimmed
  loading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/events`, { params })
    if (data?.ok) {
      const payload = data.data || {}
      const itemsRaw = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : [])
      events.value = itemsRaw.map(e => ({
        ...e,
        code: e.code || `EV${String(e.id).padStart(6, '0')}`,
      }))
      eventsLoaded.value = true
      const meta = payload.meta || {}
      const responseLimit = Number.isFinite(meta.limit) ? Number(meta.limit) : params.limit
      const responseOffset = Number.isFinite(meta.offset) ? Number(meta.offset) : params.offset
      const responseTotal = Number.isFinite(meta.total) ? Number(meta.total) : events.value.length
      eventsMeta.limit = Math.max(1, responseLimit)
      eventsMeta.offset = Math.max(0, responseOffset)
      eventsMeta.total = Math.max(0, responseTotal)
      const hasMore = meta.hasMore != null
        ? !!meta.hasMore
        : (eventsMeta.offset + events.value.length) < eventsMeta.total
      eventsMeta.hasMore = hasMore

      if (
        eventsMeta.total > 0 &&
        events.value.length === 0 &&
        eventsMeta.offset >= eventsMeta.total
      ) {
        const totalPages = Math.max(1, Math.ceil(eventsMeta.total / eventsMeta.limit))
        const lastPageOffset = Math.max(0, (totalPages - 1) * eventsMeta.limit)
        if (lastPageOffset !== eventsMeta.offset) {
          eventsMeta.offset = lastPageOffset
          return loadEvents({ offset: lastPageOffset })
        }
      }
    } else {
      events.value = []
    }
  } finally {
    loading.value = false
  }
}

function toPricesMap(items){
  const m = {}
  for (const it of items) {
    const type = String(it.type || '').trim()
    if (!type) continue
    const entry = {
      normal: Number(it.normal || 0),
      early: Number(it.early || 0)
    }
    const productId = readProductId(it)
    if (productId) entry.product_id = productId
    m[type] = entry
  }
  return m
}
function fromPricesMap(m){
  const arr = []
  for (const k of Object.keys(m||{})) {
    const v = m[k] || {}
    const productId = readProductId(v)
    arr.push({
      type: k,
      normal: Number(v.normal || 0),
      early: Number(v.early || 0),
      productId: productId ? String(productId) : ''
    })
  }
  return arr.length ? arr : [{ type: '', normal: 0, early: 0, productId: '' }]
}
const serializeStoreForm = (form = {}) => {
  const normalizeItem = (it) => ({
    type: (it?.type || '').trim(),
    normal: Number(it?.normal || 0),
    early: Number(it?.early || 0),
    productId: it?.productId ? String(it.productId) : ''
  })
  return {
    name: (form.name || '').trim(),
    address: (form.address || '').trim(),
    external_url: (form.external_url || '').trim(),
    business_hours: (form.business_hours || '').trim(),
    pre_start: form.pre_start || '',
    pre_end: form.pre_end || '',
    post_start: form.post_start || '',
    post_end: form.post_end || '',
    priceItems: Array.isArray(form.priceItems) ? form.priceItems.map(normalizeItem) : []
  }
}
const isStoreFormDirty = () => JSON.stringify(serializeStoreForm(newStore.value)) !== JSON.stringify(serializeStoreForm(defaultStoreForm()))
const hydrateStoreFormFromTemplate = (template) => {
  if (!template) return
  newStore.value = {
    name: template.name || '',
    address: template.address || '',
    external_url: template.external_url || '',
    business_hours: template.business_hours || '',
    pre_start: template.pre_start || '',
    pre_end: template.pre_end || '',
    post_start: template.post_start || '',
    post_end: template.post_end || '',
    priceItems: fromPricesMap(template.prices || {})
  }
  if (!newStore.value.priceItems.length) newStore.value.priceItems = defaultStoreForm().priceItems.slice()
}
const selectedTemplate = computed(() => {
  const id = String(selectedTemplateId.value || '')
  return storeTemplates.value.find(t => String(t.id) === id) || null
})
const templateInfo = (t) => {
  if (!t) return null
  const prices = t.prices || {}
  const bound = new Set()
  Object.keys(prices).forEach(key => {
    const pid = readProductId(prices[key])
    if (pid) bound.add(pid)
  })
  const dateBits = []
  const preRange = (t.pre_start || t.pre_end) ? `賽前 ${formatDateTime(t.pre_start || '') || '未設定'} → ${formatDateTime(t.pre_end || '') || '未設定'}` : ''
  const postRange = (t.post_start || t.post_end) ? `賽後 ${formatDateTime(t.post_start || '') || '未設定'} → ${formatDateTime(t.post_end || '') || '未設定'}` : ''
  if (preRange) dateBits.push(preRange)
  if (postRange) dateBits.push(postRange)
  return {
    priceCount: Math.max(1, Object.keys(prices).length),
    dateText: dateBits.join('｜'),
    boundProducts: bound.size || ''
  }
}
const selectedTemplateInfo = computed(() => {
  const t = selectedTemplate.value
  return templateInfo(t)
})

async function loadEventStores(eventId){
  storeLoading.value = true
  try{
    const { data } = await axios.get(`${API}/admin/events/${eventId}/stores`)
    const list = Array.isArray(data?.data) ? data.data : []
    eventStores.value = list.map(store => {
      const pricesNormalized = {}
      const rawPrices = store?.prices || {}
      Object.keys(rawPrices).forEach(type => {
        const entry = rawPrices[type] || {}
        const info = {
          normal: Number(entry.normal || 0),
          early: Number(entry.early || 0)
        }
        const productId = readProductId(entry)
        if (productId) info.product_id = productId
        pricesNormalized[type] = info
      })
      return {
        ...store,
        address: store.address || '',
        external_url: store.external_url || store.externalUrl || '',
        business_hours: store.business_hours || store.businessHours || '',
        prices: pricesNormalized
      }
    })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ storeLoading.value = false }
}

async function loadStoreTemplates(){
  templateLoading.value = true
  try{
    const { data } = await axios.get(`${API}/admin/store_templates`)
    const list = Array.isArray(data?.data) ? data.data : []
    storeTemplates.value = list.map(t => {
      const prices = t && typeof t.prices === 'object' && !Array.isArray(t.prices) ? t.prices : {}
      return {
        ...t,
        address: t.address || t.storeAddress || '',
        external_url: t.external_url || t.externalUrl || '',
        business_hours: t.business_hours || t.businessHours || '',
        pre_start: formatDateInput(t.pre_start || t.preStart),
        pre_end: formatDateInput(t.pre_end || t.preEnd),
        post_start: formatDateInput(t.post_start || t.postStart),
        post_end: formatDateInput(t.post_end || t.postEnd),
        prices
      }
    })
  } catch(e){ /* silent */ }
  finally{ templateLoading.value = false }
}

async function applyTemplate(){
  const template = selectedTemplate.value
  if (!template) return
  if (isStoreFormDirty()) {
    const ok = await showConfirm('套用模板會覆蓋目前輸入的店面資料，確定要套用嗎？', { title: '套用模板' }).catch(() => false)
    if (!ok) return
  }
  hydrateStoreFormFromTemplate(template)
}

async function saveAsTemplate(){
  const prices = toPricesMap(newStore.value.priceItems)
  if (!Object.keys(prices).length) { await showNotice('至少設定一個車型價格再儲存模板', { title: '格式錯誤' }); return }
  let name = newStore.value.name || ''
  name = await showPrompt('模板名稱', { title: '儲存模板', initial: name, confirmText: '儲存' }).catch(()=> '')
  if (!name.trim()) return
  templateLoading.value = true
  try{
    const payload = {
      name: name.trim(),
      address: newStore.value.address || undefined,
      external_url: newStore.value.external_url || undefined,
      business_hours: newStore.value.business_hours || undefined,
      pre_start: newStore.value.pre_start || undefined,
      pre_end: newStore.value.pre_end || undefined,
      post_start: newStore.value.post_start || undefined,
      post_end: newStore.value.post_end || undefined,
      prices
    }
    const { data } = await axios.post(`${API}/admin/store_templates`, payload)
    if (data?.ok){ await loadStoreTemplates(); selectedTemplateId.value = String(data.data?.id || '') }
    else await showNotice(data?.message || '儲存模板失敗', { title: '儲存失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ templateLoading.value = false }
}

function resetStoreTemplateForm(){ storeTemplateForm.value = defaultStoreForm() }
function addTemplatePriceItem(){ storeTemplateForm.value.priceItems.push({ type: '', normal: 0, early: 0, productId: '' }) }
async function createStoreTemplate(){
  if (!storeTemplateForm.value.name.trim()) { await showNotice('請輸入模板名稱', { title: '格式錯誤' }); return }
  const prices = toPricesMap(storeTemplateForm.value.priceItems)
  if (!Object.keys(prices).length) { await showNotice('至少設定一個車型價格', { title: '格式錯誤' }); return }
  storeTemplateSaving.value = true
  try{
    const payload = {
      name: storeTemplateForm.value.name.trim(),
      address: storeTemplateForm.value.address || undefined,
      external_url: storeTemplateForm.value.external_url || undefined,
      business_hours: storeTemplateForm.value.business_hours || undefined,
      pre_start: storeTemplateForm.value.pre_start || undefined,
      pre_end: storeTemplateForm.value.pre_end || undefined,
      post_start: storeTemplateForm.value.post_start || undefined,
      post_end: storeTemplateForm.value.post_end || undefined,
      prices
    }
    const { data } = await axios.post(`${API}/admin/store_templates`, payload)
    if (data?.ok){
      resetStoreTemplateForm()
      await loadStoreTemplates()
      await showNotice('模板已新增')
    } else {
      await showNotice(data?.message || '新增模板失敗', { title: '新增失敗' })
    }
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ storeTemplateSaving.value = false }
}
function startEditStoreTemplate(t){
  t._editing = {
    name: t.name,
    address: t.address || '',
    external_url: t.external_url || '',
    business_hours: t.business_hours || '',
    pre_start: t.pre_start || '',
    pre_end: t.pre_end || '',
    post_start: t.post_start || '',
    post_end: t.post_end || '',
    priceItems: fromPricesMap(t.prices || {})
  }
}
function cancelEditStoreTemplate(t){ delete t._editing }
async function saveStoreTemplate(t){
  if (!t?._editing) return
  if (!t._editing.name.trim()) { await showNotice('請輸入模板名稱', { title: '格式錯誤' }); return }
  const body = {}
  const nextName = t._editing.name.trim()
  if (nextName !== t.name) body.name = nextName
  if ((t._editing.address||'') !== (t.address||'')) body.address = t._editing.address || null
  if ((t._editing.external_url||'') !== (t.external_url||'')) body.external_url = t._editing.external_url || null
  if ((t._editing.business_hours||'') !== (t.business_hours||'')) body.business_hours = t._editing.business_hours || null
  if ((t._editing.pre_start||'') !== (t.pre_start||'')) body.pre_start = t._editing.pre_start || null
  if ((t._editing.pre_end||'') !== (t.pre_end||'')) body.pre_end = t._editing.pre_end || null
  if ((t._editing.post_start||'') !== (t.post_start||'')) body.post_start = t._editing.post_start || null
  if ((t._editing.post_end||'') !== (t.post_end||'')) body.post_end = t._editing.post_end || null
  const newPrices = toPricesMap(t._editing.priceItems)
  if (!Object.keys(newPrices).length) { await showNotice('至少設定一個車型價格', { title: '格式錯誤' }); return }
  if (JSON.stringify(newPrices) !== JSON.stringify(t.prices||{})) body.prices = newPrices
  if (!Object.keys(body).length) { delete t._editing; return }
  t._saving = true
  try{
    const { data } = await axios.patch(`${API}/admin/store_templates/${t.id}`, body)
    if (data?.ok){
      await loadStoreTemplates()
      await showNotice('模板已更新')
    } else {
      await showNotice(data?.message || '更新模板失敗', { title: '更新失敗' })
    }
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ t._saving = false }
}
async function deleteStoreTemplate(t){
  if (!t?.id) return
  if (!(await showConfirm(`確定刪除模板「${t.name}」？`, { title: '刪除模板' }))) return
  t._deleting = true
  try{
    const { data } = await axios.delete(`${API}/admin/store_templates/${t.id}`)
    if (data?.ok){
      if (String(selectedTemplateId.value || '') === String(t.id || '')) selectedTemplateId.value = ''
      await loadStoreTemplates()
      await showNotice('模板已刪除')
    } else {
      await showNotice(data?.message || '刪除模板失敗', { title: '刪除失敗' })
    }
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ t._deleting = false }
}

function openStoreManager(e){ selectedEvent.value = e; loadEventStores(e.id); loadStoreTemplates(); loadProducts() }
function closeStoreManager(){ selectedEvent.value = null }
function addPriceItem(){ newStore.value.priceItems.push({ type: '', normal: 0, early: 0, productId: '' }) }
function resetNewStore(){ newStore.value = defaultStoreForm() }
async function createStore(){
  if (!selectedEvent.value) return
  if (!newStore.value.name) { await showNotice('請輸入名稱', { title: '格式錯誤' }); return }
  const prices = toPricesMap(newStore.value.priceItems)
  if (!Object.keys(prices).length) { await showNotice('至少設定一個車型價格', { title: '格式錯誤' }); return }
  storeLoading.value = true
  try{
    const payload = {
      name: newStore.value.name,
      address: newStore.value.address || undefined,
      external_url: newStore.value.external_url || undefined,
      business_hours: newStore.value.business_hours || undefined,
      pre_start: newStore.value.pre_start||undefined,
      pre_end: newStore.value.pre_end||undefined,
      post_start: newStore.value.post_start||undefined,
      post_end: newStore.value.post_end||undefined,
      prices
    }
    const { data } = await axios.post(`${API}/admin/events/${selectedEvent.value.id}/stores`, payload)
    if (data?.ok){ resetNewStore(); await loadEventStores(selectedEvent.value.id) }
    else await showNotice(data?.message || '新增失敗', { title: '新增失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ storeLoading.value = false }
}

function startEditStore(s){
  s._editing = {
    name: s.name,
    address: s.address || '',
    external_url: s.external_url || '',
    business_hours: s.business_hours || '',
    pre_start: s.pre_start||'',
    pre_end: s.pre_end||'',
    post_start: s.post_start||'',
    post_end: s.post_end||'',
    priceItems: fromPricesMap(s.prices||{})
  }
}
function cancelEditStore(s){ delete s._editing }
async function saveEditStore(s){
  if (!s?._editing) return
  const body = {}
  if (s._editing.name !== s.name) body.name = s._editing.name
  if ((s._editing.address||'') !== (s.address||'')) body.address = s._editing.address || null
  if ((s._editing.external_url||'') !== (s.external_url||'')) body.external_url = s._editing.external_url || null
  if ((s._editing.business_hours||'') !== (s.business_hours||'')) body.business_hours = s._editing.business_hours || null
  if ((s._editing.pre_start||'') !== (s.pre_start||'')) body.pre_start = s._editing.pre_start||null
  if ((s._editing.pre_end||'') !== (s.pre_end||'')) body.pre_end = s._editing.pre_end||null
  if ((s._editing.post_start||'') !== (s.post_start||'')) body.post_start = s._editing.post_start||null
  if ((s._editing.post_end||'') !== (s.post_end||'')) body.post_end = s._editing.post_end||null
  const newPrices = toPricesMap(s._editing.priceItems)
  if (JSON.stringify(newPrices) !== JSON.stringify(s.prices||{})) body.prices = newPrices
  if (!Object.keys(body).length) { delete s._editing; return }
  storeLoading.value = true
  try{
    const { data } = await axios.patch(`${API}/admin/events/stores/${s.id}`, body)
    if (data?.ok){ await loadEventStores(selectedEvent.value.id) }
    else await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ storeLoading.value = false }
}

async function deleteStore(s){
  if (!(await showConfirm(`確定刪除店面「${s.name}」？`, { title: '刪除店面' }))) return
  storeLoading.value = true
  try{
    const { data } = await axios.delete(`${API}/admin/events/stores/${s.id}`)
    if (data?.ok){ await loadEventStores(selectedEvent.value.id) }
    else await showNotice(data?.message || '刪除失敗', { title: '刪除失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ storeLoading.value = false }
}

async function loadOrders(options = {}) {
  if (options && typeof options.offset === 'number' && Number.isFinite(options.offset)) {
    adminOrdersMeta.offset = Math.max(0, Math.floor(options.offset))
  }
  if (options && typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    adminOrdersMeta.limit = Math.max(1, Math.min(200, Math.floor(options.limit)))
  }
  const params = {
    limit: adminOrdersMeta.limit,
    offset: adminOrdersMeta.offset
  }
  const queryTrimmed = orderQuery.value.trim()
  if (queryTrimmed) params.q = queryTrimmed
  ordersLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/orders`, { params })
    let items = []
    if (data?.ok) {
      const payload = data.data || {}
      items = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : [])
      const meta = payload.meta || {}
      const responseLimit = Number.isFinite(meta.limit) ? Number(meta.limit) : params.limit
      const responseOffset = Number.isFinite(meta.offset) ? Number(meta.offset) : params.offset
      const responseTotal = Number.isFinite(meta.total) ? Number(meta.total) : items.length
      adminOrdersMeta.limit = Math.max(1, responseLimit)
      adminOrdersMeta.offset = Math.max(0, responseOffset)
      adminOrdersMeta.total = Math.max(0, responseTotal)
      const hasMore = meta.hasMore != null
        ? !!meta.hasMore
        : (adminOrdersMeta.offset + items.length) < adminOrdersMeta.total
      adminOrdersMeta.hasMore = hasMore

      if (
        adminOrdersMeta.total > 0 &&
        items.length === 0 &&
        adminOrdersMeta.offset >= adminOrdersMeta.total
      ) {
        const totalPages = Math.max(1, Math.ceil(adminOrdersMeta.total / adminOrdersMeta.limit))
        const lastPageOffset = Math.max(0, (totalPages - 1) * adminOrdersMeta.limit)
        if (lastPageOffset !== adminOrdersMeta.offset) {
          adminOrdersMeta.offset = lastPageOffset
          await loadOrders({ offset: lastPageOffset })
          return
        }
      }
    } else {
      items = []
    }

    adminOrders.value = items.map(o => {
      const details = safeParse(o.details)
      const rawSelections = Array.isArray(details.selections) ? details.selections : []
      const selections = rawSelections.map((sel, idx) => {
        const qty = toNumber(sel.qty)
        const unitPrice = toNumber(sel.unitPrice)
        const subtotal = toNumber(sel.subtotal || unitPrice * qty)
        const rawDiscount = Number(sel.discount)
        const discount = Number.isFinite(rawDiscount) ? Math.max(0, rawDiscount) : Math.max(0, (unitPrice * qty) - subtotal)
        return {
          key: `${o.id}-${idx}`,
          store: sel.store || '',
          type: sel.type || '',
          qty,
          unitPrice,
          subtotal,
          discount,
          byTicket: Boolean(sel.byTicket),
        }
      })
      const isReservation = selections.length > 0 || details.kind === 'event-reservation'
      const subtotal = toNumber(details.subtotal)
      const addOnCost = toNumber(details.addOnCost)
      const total = toNumber(details.total)
      let discountTotal = toNumber(details.discount)
      if (!discountTotal) {
        discountTotal = Math.max(0, (subtotal + addOnCost) - total)
      }
      const remittanceRaw = {
        info: details?.remittance?.info || details.bankInfo || '',
        bankCode: details?.remittance?.bankCode || details.bankCode || '',
        bankAccount: details?.remittance?.bankAccount || details.bankAccount || '',
        accountName: details?.remittance?.accountName || details.bankAccountName || '',
        bankName: details?.remittance?.bankName || details.bankName || ''
      }
      const hasRemittance = Object.values(remittanceRaw).some(val => String(val || '').trim())
      const status = details.status || '處理中'
      const phone = o.phone != null ? String(o.phone).trim() : ''
      const remittanceLast5 = o.remittance_last5 != null ? String(o.remittance_last5).trim() : ''
      const base = {
        id: o.id,
        code: o.code || '',
        username: o.username || '',
        email: o.email || '',
        phone,
        remittanceLast5,
        total,
        quantity: toNumber(details.quantity || 0),
        ticketType: details.ticketType || details?.event?.name || '',
        status,
        newStatus: status,
        saving: false,
        createdAt: formatDateTime(o.created_at || o.createdAt, { fallback: o.created_at || o.createdAt || '' }),
        remittance: remittanceRaw,
        hasRemittance,
      }
      if (isReservation) {
        base.isReservation = true
        base.eventName = details?.event?.name || base.ticketType || ''
        base.eventDate = details?.event?.date || details?.event?.when || ''
        base.eventCode = details?.event?.code || ''
        base.ticketType = base.eventName
        base.subtotal = subtotal
        base.addOnCost = addOnCost
        base.discountTotal = discountTotal
        base.selections = selections
      }
      return base
    })
    ordersLoaded.value = true
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    ordersLoading.value = false
  }
}

function applyRemittanceSettings(payload = {}) {
  remittanceForm.info = payload.info || ''
  remittanceForm.bankCode = payload.bankCode || ''
  remittanceForm.bankAccount = payload.bankAccount || ''
  remittanceForm.accountName = payload.accountName || ''
  remittanceForm.bankName = payload.bankName || ''
  remittanceOriginal.value = remittanceSnapshot()
}

async function loadRemittanceSettings() {
  remittanceLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/remittance`)
    if (data?.ok) applyRemittanceSettings(data.data || {})
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '讀取匯款資訊失敗' })
  } finally {
    remittanceLoading.value = false
  }
}

async function saveRemittanceSettings() {
  remittanceSaving.value = true
  try {
    const payload = {
      info: remittanceForm.info,
      bankCode: remittanceForm.bankCode,
      bankAccount: remittanceForm.bankAccount,
      accountName: remittanceForm.accountName,
      bankName: remittanceForm.bankName
    }
    const { data } = await axios.patch(`${API}/admin/remittance`, payload)
    if (data?.ok) {
      applyRemittanceSettings(data.data || {})
      await showNotice('匯款資訊已更新')
    } else {
      await showNotice(data?.message || '更新匯款資訊失敗', { title: '更新失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '更新匯款資訊失敗' })
  } finally {
    remittanceSaving.value = false
  }
}

function applySitePages(payload = {}) {
  sitePagesForm.terms = payload.terms || ''
  sitePagesForm.privacy = payload.privacy || ''
  sitePagesForm.reservationNotice = payload.reservationNotice || ''
  sitePagesForm.reservationRules = payload.reservationRules || ''
  sitePagesOriginal.value = sitePagesSnapshot()
}

async function loadSitePages() {
  sitePagesLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/site_pages`)
    if (data?.ok) applySitePages(data.data || {})
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '讀取條款失敗' })
  } finally {
    sitePagesLoading.value = false
  }
}

async function saveSitePages() {
  sitePagesSaving.value = true
  try {
    const payload = {
      terms: sitePagesForm.terms,
      privacy: sitePagesForm.privacy,
      reservationNotice: sitePagesForm.reservationNotice,
      reservationRules: sitePagesForm.reservationRules
    }
    const { data } = await axios.patch(`${API}/admin/site_pages`, payload)
    if (data?.ok) {
      applySitePages(data.data || {})
      await showNotice('條款內容已更新')
    } else {
      await showNotice(data?.message || '更新條款失敗', { title: '更新失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '更新條款失敗' })
  } finally {
    sitePagesSaving.value = false
  }
}

function applyChecklistDefinitions(payload = {}) {
  const mapped = cloneChecklistDefinitions(payload)
  CHECKLIST_STAGE_KEYS.forEach(stage => {
    const defaults = DEFAULT_ADMIN_CHECKLIST_DEFINITIONS[stage] || { title: stage, items: [] }
    const entry = mapped[stage] || { title: '', items: [] }
    const title = entry.title || defaults.title || ''
    const items = entry.items.length ? entry.items : defaults.items
    adminChecklistDefinitions[stage].title = title
    adminChecklistDefinitions[stage].items = [...items]
    if (!checklistDefinitionsForm[stage]) checklistDefinitionsForm[stage] = { title: '', itemsText: '' }
    checklistDefinitionsForm[stage].title = title
    checklistDefinitionsForm[stage].itemsText = items.join('\n')
  })
  checklistDefinitionsLoaded.value = true
  checklistDefinitionsOriginal.value = checklistDefinitionsSnapshot()
}

async function loadChecklistDefinitions(options = {}) {
  const silent = options?.silent === true
  if (!silent) checklistDefinitionsLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/reservation_checklists`)
    if (data?.ok) {
      applyChecklistDefinitions(data.data || {})
    } else if (!silent) {
      await showNotice(data?.message || '讀取檢核項目失敗', { title: '讀取失敗' })
    }
  } catch (e) {
    if (!silent) {
      await showNotice(e?.response?.data?.message || e.message, { title: '讀取檢核項目失敗' })
    } else {
      console.error('loadChecklistDefinitions error:', e?.message || e)
    }
  } finally {
    if (!silent) checklistDefinitionsLoading.value = false
  }
}

async function saveChecklistDefinitions() {
  if (checklistDefinitionsSaving.value) return
  checklistDefinitionsSaving.value = true
  try {
    const definitions = {}
    CHECKLIST_STAGE_KEYS.forEach(stage => {
      const entry = checklistDefinitionsForm[stage] || { title: '', itemsText: '' }
      definitions[stage] = {
        title: (entry.title || '').trim(),
        items: parseChecklistItemsText(entry.itemsText || '')
      }
    })
    const { data } = await axios.patch(`${API}/admin/reservation_checklists`, { definitions })
    if (data?.ok) {
      applyChecklistDefinitions(data.data || definitions)
      await showNotice('檢核項目已更新')
      if (tab.value === 'reservations') await loadAdminReservations()
    } else {
      await showNotice(data?.message || '更新檢核項目失敗', { title: '更新失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '更新檢核項目失敗' })
  } finally {
    checklistDefinitionsSaving.value = false
  }
}

async function resetChecklistDefinitions() {
  if (checklistDefinitionsSaving.value) return
  if (!(await showConfirm('確定恢復預設檢核項目？', { title: '重置確認' }))) return
  checklistDefinitionsSaving.value = true
  try {
    const { data } = await axios.patch(`${API}/admin/reservation_checklists`, { reset: true })
    if (data?.ok) {
      applyChecklistDefinitions(data.data || DEFAULT_ADMIN_CHECKLIST_DEFINITIONS)
      await showNotice('檢核項目已重置')
      if (tab.value === 'reservations') await loadAdminReservations()
    } else {
      await showNotice(data?.message || '重置檢核項目失敗', { title: '重置失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '重置檢核項目失敗' })
  } finally {
    checklistDefinitionsSaving.value = false
  }
}


async function loadAdminTickets(options = {}){
  if (options && typeof options.offset === 'number' && Number.isFinite(options.offset)) {
    adminTicketsMeta.offset = Math.max(0, Math.floor(options.offset))
  }
  if (options && typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    adminTicketsMeta.limit = Math.max(1, Math.min(200, Math.floor(options.limit)))
  }
  const requestSummary = !!(options && options.forceSummary) || !ticketSummaryLoaded.value
  const params = {
    limit: adminTicketsMeta.limit,
    offset: adminTicketsMeta.offset,
    status: ticketStatusFilter.value || 'all',
    includeSummary: requestSummary ? 1 : 0
  }
  if (requestSummary) ticketSummaryLoaded.value = false
  const queryTrimmed = ticketQuery.value.trim()
  if (queryTrimmed) params.q = queryTrimmed
  ticketsLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/tickets`, { params })
    if (data?.ok) {
      const payload = data.data || {}
      const itemsRaw = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : [])
      adminTickets.value = itemsRaw.map(formatAdminTicket)
      const meta = payload.meta || {}
      const responseLimit = Number.isFinite(meta.limit) ? Number(meta.limit) : params.limit
      const responseOffset = Number.isFinite(meta.offset) ? Number(meta.offset) : params.offset
      const responseTotal = Number.isFinite(meta.total) ? Number(meta.total) : adminTickets.value.length
      adminTicketsMeta.limit = Math.max(1, responseLimit)
      adminTicketsMeta.offset = Math.max(0, responseOffset)
      adminTicketsMeta.total = Math.max(0, responseTotal)
      adminTicketsMeta.hasMore = meta.hasMore != null
        ? !!meta.hasMore
        : (adminTicketsMeta.offset + adminTickets.value.length) < adminTicketsMeta.total
      const summary = payload.summary || null
      if (summary && typeof summary === 'object') {
        ticketSummary.total = Number(summary.total || 0)
        ticketSummary.available = Number(summary.available || 0)
        ticketSummary.used = Number(summary.used || 0)
        ticketSummary.expired = Number(summary.expired || 0)
        ticketSummaryLoaded.value = true
      }

      if (
        adminTicketsMeta.total > 0 &&
        adminTickets.value.length === 0 &&
        adminTicketsMeta.offset >= adminTicketsMeta.total
      ) {
        const totalPages = Math.max(1, Math.ceil(adminTicketsMeta.total / adminTicketsMeta.limit))
        const lastPageOffset = Math.max(0, (totalPages - 1) * adminTicketsMeta.limit)
        if (lastPageOffset !== adminTicketsMeta.offset) {
          adminTicketsMeta.offset = lastPageOffset
          return loadAdminTickets({ offset: lastPageOffset })
        }
      }
    } else {
      adminTickets.value = []
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    ticketsLoading.value = false
  }
}

async function loadTicketLogs(ticketId) {
  const id = Number(ticketId || ticketDetail.ticket?.id)
  if (!Number.isFinite(id) || id <= 0) return
  ticketDetail.logsLoading = true
  try {
    const { data } = await axios.get(`${API}/admin/tickets/${id}/logs`, { params: { limit: 200 } })
    if (data?.ok) {
      const list = Array.isArray(data.data?.items) ? data.data.items : (Array.isArray(data.data) ? data.data : [])
      ticketDetail.logs = list.map(log => ({
        ...log,
        metaText: ticketLogMetaText(log.meta)
      }))
    } else {
      ticketDetail.logs = []
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    ticketDetail.logsLoading = false
  }
}

async function saveTicketEdit() {
  if (!ticketDetail.ticket) return
  const ticketId = ticketDetail.ticket.id
  const payload = {}
  const current = ticketDetail.ticket
  if ((ticketDetail.edit.type || '') !== (current.type || '')) {
    payload.type = ticketDetail.edit.type || ''
  }
  const currentExpiry = formatDateInput(current.expiry)
  const editExpiry = ticketDetail.edit.expiry ? ticketDetail.edit.expiry : ''
  if ((editExpiry || '') !== (currentExpiry || '')) {
    payload.expiry = editExpiry || ''
  }
  if (!!ticketDetail.edit.used !== !!current.used) {
    payload.used = ticketDetail.edit.used
  }
  const normalizedEmail = (ticketDetail.edit.userEmail || '').trim()
  const currentEmail = (current.email || '').trim()
  if (normalizedEmail && normalizedEmail.toLowerCase() !== currentEmail.toLowerCase()) {
    payload.userEmail = normalizedEmail
  }
  if (!Object.keys(payload).length) {
    await showNotice('沒有變更')
    return
  }
  ticketDetail.saving = true
  try {
    const { data } = await axios.patch(`${API}/admin/tickets/${ticketId}`, payload)
    if (data?.ok) {
      const updated = data.data?.ticket || data.data
      if (updated) {
        const nextTicket = updateTicketRow(updated)
        syncTicketSummaryState(ticketDetail.ticket, nextTicket)
        ticketDetail.ticket = nextTicket
        prepareTicketEdit(ticketDetail.ticket)
      }
      await loadTicketLogs(ticketId)
      await showNotice('票券已更新')
    } else {
      await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    ticketDetail.saving = false
  }
}

async function loadAdminReservations(options = {}){
  if (options && typeof options.offset === 'number' && Number.isFinite(options.offset)) {
    adminReservationsMeta.offset = Math.max(0, Math.floor(options.offset))
  }
  if (options && typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    adminReservationsMeta.limit = Math.max(1, Math.min(200, Math.floor(options.limit)))
  }
  const params = {
    limit: adminReservationsMeta.limit,
    offset: adminReservationsMeta.offset,
    includePhotos: 0
  }
  const queryTrimmed = reservationQuery.value.trim()
  if (queryTrimmed) params.q = queryTrimmed
  reservationsLoading.value = true
  try{
    const { data } = await axios.get(`${API}/admin/reservations`, { params })
    if (data?.ok) {
      const payload = data.data || {}
      const itemsRaw = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : [])
      adminReservations.value = itemsRaw.map(mapAdminReservation)
      reservationsLoaded.value = true
      const meta = payload.meta || {}
      const responseLimit = Number.isFinite(meta.limit) ? Number(meta.limit) : params.limit
      const responseOffset = Number.isFinite(meta.offset) ? Number(meta.offset) : params.offset
      const responseTotal = Number.isFinite(meta.total) ? Number(meta.total) : adminReservations.value.length
      adminReservationsMeta.limit = Math.max(1, responseLimit)
      adminReservationsMeta.offset = Math.max(0, responseOffset)
      adminReservationsMeta.total = Math.max(0, responseTotal)
      const hasMore = meta.hasMore != null
        ? !!meta.hasMore
        : (adminReservationsMeta.offset + adminReservations.value.length) < adminReservationsMeta.total
      adminReservationsMeta.hasMore = hasMore

      if (
        adminReservationsMeta.total > 0 &&
        adminReservations.value.length === 0 &&
        adminReservationsMeta.offset >= adminReservationsMeta.total
      ) {
        const totalPages = Math.max(1, Math.ceil(adminReservationsMeta.total / adminReservationsMeta.limit))
        const lastPageOffset = Math.max(0, (totalPages - 1) * adminReservationsMeta.limit)
        if (lastPageOffset !== adminReservationsMeta.offset) {
          adminReservationsMeta.offset = lastPageOffset
          return loadAdminReservations({ offset: lastPageOffset })
        }
      }
    } else {
      adminReservations.value = []
    }
  } catch(e){
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    reservationsLoading.value = false
  }
}

async function saveReservationStatus(row){
  const allowed = reservationStatusOptions.map(o => o.value)
  if (!allowed.includes(row.newStatus)) { await showNotice('狀態不正確', { title: '格式錯誤' }); return }
  row.saving = true
  try{
    const { data } = await axios.patch(`${API}/admin/reservations/${row.id}/status`, { status: row.newStatus })
    if (data?.ok){ await loadAdminReservations(); await showNotice('已更新') }
    else await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally { row.saving = false }
}

function safeParse(v){ try { return typeof v === 'string' ? JSON.parse(v) : (v || {}) } catch { return {} } }
const toNumber = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const formatCurrency = (val) => `NT$ ${toNumber(val).toLocaleString('zh-TW')}`

// ===== 匯出工具 =====
function todayStr(){ const d = new Date(); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}${m}${day}` }
function fileDownload(filename, content){
  try{ const blob = new Blob([content], { type: 'application/json;charset=utf-8' }); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); setTimeout(()=>{ try{ URL.revokeObjectURL(url); a.remove() } catch{} },0) } catch{}
}
async function exportUser(u){
  try{
    const { data } = await axios.get(`${API}/admin/users/${u.id}/export`)
    if (data?.ok){ const json = JSON.stringify(data.data, null, 2); fileDownload(`user_${u.id}_export_${todayStr()}.json`, json); await showNotice('已下載使用者資料 JSON') }
    else await showNotice(data?.message || '匯出失敗', { title: '匯出失敗' })
  } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
}

async function saveOrderStatus(o){
  if (!orderStatuses.includes(o.newStatus)) { await showNotice('狀態不正確', { title: '格式錯誤' }); return }
  o.saving = true
  try {
    const { data } = await axios.patch(`${API}/admin/orders/${o.id}/status`, { status: o.newStatus })
    if (data?.ok) {
      await loadOrders()
      await showNotice('已更新')
    } else {
      await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    o.saving = false
  }
}

async function createProduct() {
  if (!newProduct.value.name || newProduct.value.price < 0) { await showNotice('請輸入正確的商品資料', { title: '格式錯誤' }); return }
  loading.value = true
  try {
    const payload = { name: newProduct.value.name, description: newProduct.value.description || '', price: Number(newProduct.value.price) }
    const { data } = await axios.post(`${API}/admin/products`, payload)
    if (data?.ok) {
      showProductForm.value = false
      newProduct.value = { name: '', price: 0, description: '' }
      await loadProducts()
    } else {
      await showNotice(data?.message || '新增失敗', { title: '新增失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    loading.value = false
  }
}

function startEditProduct(p) {
  p._editing = { name: p.name, price: Number(p.price) || 0, description: p.description || '' }
}
function cancelEditProduct(p) { delete p._editing }
async function saveEditProduct(p) {
  if (!p?._editing) return
  const body = {}
  if (p._editing.name !== p.name) body.name = p._editing.name
  if (Number(p._editing.price) !== Number(p.price)) body.price = Number(p._editing.price)
  if ((p._editing.description || '') !== (p.description || '')) body.description = p._editing.description || ''
  if (!Object.keys(body).length) { delete p._editing; return }
  loading.value = true
  try {
    const { data } = await axios.patch(`${API}/admin/products/${p.id}`, body)
    if (data?.ok) {
      await loadProducts()
    } else {
      await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    loading.value = false
  }
}

async function deleteProduct(p) {
  if (!(await showConfirm(`確定要刪除「${p.name}」？`, { title: '刪除商品' }))) return
  loading.value = true
  try {
    const { data } = await axios.delete(`${API}/admin/products/${p.id}`)
    if (data?.ok) {
      await loadProducts()
    } else {
      await showNotice(data?.message || '刪除失敗', { title: '刪除失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    loading.value = false
  }
}

function normalizeDT(dt) {
  if (!dt) return ''
  // datetime-local => 'YYYY-MM-DDTHH:mm' => convert to 'YYYY-MM-DD HH:mm:00'
  return dt.replace('T', ' ') + (dt.length === 16 ? ':00' : '')
}

async function createEvent() {
  if (!(await ensureEventValid())) return
  loading.value = true
  try {
    const rules = parseRulesInput(newEvent.value.rules)
    const payload = {
      code: newEvent.value.code || undefined,
      title: newEvent.value.title,
      starts_at: normalizeDT(newEvent.value.starts_at),
      ends_at: normalizeDT(newEvent.value.ends_at),
      deadline: newEvent.value.deadline ? normalizeDT(newEvent.value.deadline) : undefined,
      location: newEvent.value.location || undefined,
      description: newEvent.value.description || '',
      cover: newEvent.value.cover || undefined,
      rules
    }
    const { data } = await axios.post(`${API}/admin/events`, payload)
    if (data?.ok) {
      const newId = data.data?.id
      if (newId && coverUploadData.value){
        try {
          await axios.post(`${API}/admin/events/${newId}/cover_json`, { dataUrl: coverUploadData.value })
        } catch (e) {
          await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
        }
      }
      coverUploadData.value = ''
      showEventForm.value = false
      resetEventForm()
      await loadEvents()
    } else {
      await showNotice(data?.message || '新增失敗', { title: '新增失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    loading.value = false
  }
}

async function updateEvent() {
  if (!editingEvent.value) return
  if (!(await ensureEventValid())) return
  loading.value = true
  try {
    const rules = parseRulesInput(newEvent.value.rules)
    const payload = {
      code: newEvent.value.code || undefined,
      title: newEvent.value.title,
      starts_at: normalizeDT(newEvent.value.starts_at),
      ends_at: normalizeDT(newEvent.value.ends_at),
      deadline: newEvent.value.deadline ? normalizeDT(newEvent.value.deadline) : undefined,
      location: newEvent.value.location || undefined,
      description: newEvent.value.description || '',
      cover: newEvent.value.cover || undefined,
      rules
    }
    const { data } = await axios.patch(`${API}/admin/events/${editingEvent.value.id}`, payload)
    if (data?.ok) {
      if (coverUploadData.value) {
        try {
          await axios.post(`${API}/admin/events/${editingEvent.value.id}/cover_json`, { dataUrl: coverUploadData.value })
        } catch (e) {
          await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
        }
      }
      coverUploadData.value = ''
      await showNotice('活動已更新')
      showEventForm.value = false
      resetEventForm()
      await loadEvents()
    } else {
      await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    loading.value = false
  }
}

const submitEventForm = () => {
  if (isEditingEvent.value) return updateEvent()
  return createEvent()
}

async function refreshActive() {
  if (tab.value === 'users') await loadUsers()
  if (tab.value === 'products') await loadProducts()
  if (tab.value === 'events') await loadEvents()
  if (tab.value === 'reservations') await loadAdminReservations()
  if (tab.value === 'tickets') await loadAdminTickets()
  if (tab.value === 'orders') await loadOrders()
  if (tab.value === 'settings') await Promise.all([loadRemittanceSettings(), loadSitePages(), loadChecklistDefinitions()])
  if (tab.value === 'store-templates') {
    const tasks = [loadStoreTemplates()]
    if (!productsLoaded.value) tasks.push(loadProducts())
    await Promise.all(tasks)
  }
  if (tab.value === 'tombstones') await loadTombstones()
}

const prefetchGroupData = async (value) => {
  const visible = visibleTabs.value.map(t => t.key)
  if (value === 'user') {
    if (visible.includes('users') && !usersLoaded.value && tab.value !== 'users') await loadUsers()
    if (selfRole.value === 'ADMIN' && visible.includes('tombstones') && !tombstonesLoaded.value && !tombstoneLoading.value) await loadTombstones()
  } else if (value === 'product') {
    if (visible.includes('products') && !productsLoaded.value && tab.value !== 'products') await loadProducts()
    if (visible.includes('events') && !eventsLoaded.value && tab.value !== 'events') await loadEvents()
  } else if (value === 'status') {
    if (visible.includes('reservations') && !reservationsLoaded.value && !reservationsLoading.value) await loadAdminReservations()
    if (visible.includes('orders') && !ordersLoaded.value && !ordersLoading.value) await loadOrders()
  } else if (value === 'global') {
    if (visible.includes('store-templates') && !templateLoading.value && !storeTemplates.value.length) {
      await loadStoreTemplates()
      if (!productsLoaded.value) await loadProducts()
    }
  }
}
watch(groupKey, (value) => {
  prefetchGroupData(value)
})

onMounted(async () => {
  updateViewport()
  const ok = await checkSession()
  if (!ok) {
    await showNotice('需要後台權限', { title: '權限不足' });
    return router.push('/login')
  }
  // Restore saved group/tab
  try {
    const gSaved = localStorage.getItem('admin_group')
    if (gSaved && ['user','product','status','global'].includes(gSaved)) groupKey.value = gSaved
  } catch {}
  // Default group by role if not saved
  if (!['user','product','status','global'].includes(groupKey.value)) {
    const r = String(selfRole.value || '').toUpperCase()
    if (r === 'ADMIN') groupKey.value = 'user'
    else if (r === 'EDITOR') groupKey.value = 'product'
    else if (r === 'STORE' || r === 'OPERATOR') groupKey.value = 'status'
    else groupKey.value = 'product'
  }
  // Resolve initial tab
  let initialTab = defaultTabForGroup()
  try {
    const tSaved = localStorage.getItem('admin_tab')
    if (tSaved && allTabs.find(t => t.key === tSaved)) initialTab = tSaved
  } catch {}
  const idx = Math.max(0, visibleTabs.value.findIndex(t => t.key === initialTab))
  setTab(visibleTabs.value[idx]?.key || (visibleTabs.value[0]?.key || initialTab), idx)
  await loadChecklistDefinitions({ silent: true })
  await refreshActive()
  await prefetchGroupData(groupKey.value)
  window.addEventListener('resize', updateViewport)
})
// 美化頂部按鈕（保持輕量，不侵入既有邏輯）

// ===== 封面更換：預覽確認 Modal =====
const createCoverConfirmState = () => ({
  visible: false,
  kind: '',
  eventId: null,
  productType: '',
  name: '',
  dataUrl: '',
  uploading: false,
  uploadProgress: 0,
  uploadMessage: ''
})
const coverConfirm = ref(createCoverConfirmState())
function openCoverConfirm(payload){
  coverConfirm.value = {
    ...createCoverConfirmState(),
    visible: true,
    kind: payload.kind,
    eventId: payload.eventId || null,
    productType: payload.productType || '',
    name: payload.name || '',
    dataUrl: payload.dataUrl || ''
  }
}
function closeCoverConfirm(){
  coverConfirm.value = createCoverConfirmState()
}
async function confirmCoverApply(){
  const cc = coverConfirm.value
  if (!cc?.visible || !cc.dataUrl || cc.uploading) return
  try{
    coverConfirm.value.uploading = true
    coverConfirm.value.uploadMessage = '圖片上傳中…'
    coverConfirm.value.uploadProgress = 5
    const progressHandler = (event) => {
      if (!event) return
      if (event.total) {
        const percent = Math.round((event.loaded / event.total) * 100)
        coverConfirm.value.uploadProgress = Math.min(99, Math.max(percent, 5))
      } else {
        coverConfirm.value.uploadProgress = Math.min(90, (coverConfirm.value.uploadProgress || 0) + 10)
      }
    }
    if (cc.kind === 'event' && cc.eventId){
      const { data } = await axios.post(
        `${API}/admin/events/${cc.eventId}/cover_json`,
        { dataUrl: cc.dataUrl },
        { onUploadProgress: progressHandler }
      )
      if (data?.ok){
        coverConfirm.value.uploadProgress = 100
        coverConfirm.value.uploadMessage = '上傳完成'
        await showNotice('封面已更新')
        await loadEvents()
      } else {
        coverConfirm.value.uploadMessage = '上傳失敗'
        await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
      }
    } else if (cc.kind === 'product' && cc.productType){
      const type = encodeURIComponent(cc.productType)
      const { data } = await axios.post(
        `${API}/admin/tickets/types/${type}/cover_json`,
        { dataUrl: cc.dataUrl },
        { onUploadProgress: progressHandler }
      )
      if (data?.ok){
        coverConfirm.value.uploadProgress = 100
        coverConfirm.value.uploadMessage = '上傳完成'
        await showNotice('票券封面已更新')
      } else {
        coverConfirm.value.uploadMessage = '上傳失敗'
        await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
      }
    }
  } catch(e){
    coverConfirm.value.uploadMessage = '上傳失敗'
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    closeCoverConfirm()
  }
}

function onKeydown(e){
  if (imagePreview.open) {
    if (e.key === 'Escape') { e.preventDefault(); closeImagePreview(); return }
  }
  const state = coverConfirm.value
  if (!state.visible) return
  if (state.uploading) { e.preventDefault(); return }
  if (e.key === 'Escape') { e.preventDefault(); closeCoverConfirm(); return }
  if (e.key === 'Enter') { e.preventDefault(); confirmCoverApply() }
}
onMounted(() => { window.addEventListener('keydown', onKeydown) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKeydown); window.removeEventListener('resize', updateViewport) })
</script>

<style scoped>
.admin-page {
  min-height: 100vh;
  background: radial-gradient(circle at top, rgba(248, 113, 113, 0.08), transparent 55%), #f8fafc;
}
.admin-hero {
  position: relative;
  overflow: hidden;
}

.admin-section {
  margin-bottom: 2.5rem;
}
.admin-section:last-of-type {
  margin-bottom: 0;
}
.admin-section--overview button {
  min-height: 9rem;
}
.admin-section--overview button span:first-child {
  letter-spacing: 0.1em;
}
.admin-section--overview .grid {
  gap: 1rem;
}
.admin-section--overview button:hover {
  transform: translateY(-1px);
}
.admin-section .section-divider {
  height: 1px;
  background: #e2e8f0;
  margin: 1.25rem 0;
}
.admin-select {
  border: 1px solid #dfe3ea;
  padding: 0.55rem 0.9rem;
  font-size: 0.92rem;
  background: #fff;
}
.admin-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 15px 35px -25px rgba(15, 23, 42, 0.35);
}
.admin-card__header,
.admin-card__footer {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.admin-card__footer {
  border-top: 1px solid #e2e8f0;
  border-bottom: none;
  flex-direction: column;
  align-items: flex-start;
}
.admin-card__body {
  padding: 1.5rem;
}
@media (min-width: 768px) {
  .admin-card__header,
  .admin-card__footer {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
  .admin-card__footer {
    align-items: center;
  }
}
.admin-card__eyebrow {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.35em;
  color: #dc2626;
  font-weight: 600;
}
.admin-card__title {
  font-size: 1.35rem;
  font-weight: 700;
  color: #0f172a;
  margin-top: 0.35rem;
}
.admin-card__subtitle {
  font-size: 0.9rem;
  color: #64748b;
}
.admin-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.admin-card__note {
  font-size: 0.8rem;
  color: #94a3b8;
}
.admin-form__card {
  border: 1px solid #edf2f7;
  padding: 1.25rem;
  background: #fff;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.35);
}
.admin-form__card-header h4 {
  font-size: 1rem;
  font-weight: 600;
  color: #0f172a;
}
.admin-form__card-header p {
  font-size: 0.85rem;
  color: #94a3b8;
  margin-top: 0.15rem;
}
.admin-form__grid {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
}
.admin-form__grid--2 {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.admin-form__grid--3 {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
.admin-form__card--split {
  display: grid;
  gap: 1.25rem;
}
@media (min-width: 992px) {
  .admin-form__card--split {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.admin-form__split-block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.admin-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.83rem;
  color: #475569;
}
.admin-field input,
.admin-field textarea {
  border: 1px solid #dfe3ea;
  padding: 0.6rem 0.9rem;
  font-size: 0.92rem;
  transition: border-color 0.2s, box-shadow 0.2s;
  background: #fff;
}
.admin-field textarea {
  min-height: 3rem;
  resize: vertical;
}
.admin-field--textarea textarea {
  min-height: 7rem;
}
.admin-field input:focus,
.admin-field textarea:focus {
  border-color: #fb7185;
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.2);
  outline: none;
}
.admin-dropzone {
  border: 2px dashed #d4d8e1;
  padding: 1.25rem;
  text-align: center;
  background: #fff7f7;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
  justify-content: center;
}
.admin-dropzone__preview img {
  width: 100%;
  max-height: 11rem;
  object-fit: cover;
  border: 1px solid #f1f5f9;
}
.admin-dropzone__hint {
  font-size: 0.9rem;
  color: #94a3b8;
}
.admin-card--form .admin-card__body {
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.65), rgba(255, 255, 255, 0));
}
.admin-store-panel__body {
  padding: 1.5rem;
}
.admin-store-panel__grid {
  display: grid;
  gap: 1.5rem;
}
@media (min-width: 1024px) {
  .admin-store-panel__grid {
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  }
}
.admin-store-template-row {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
}
.admin-store-dates-grid label span {
  font-weight: 500;
  color: #475569;
}
.admin-store-pricing {
  margin-top: 1rem;
  border: 1px dashed #e2e8f0;
  padding: 1rem;
  background: #fffdfd;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.admin-store-pricing__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}
.admin-store-pricing__header h5 {
  font-size: 0.95rem;
  font-weight: 600;
  color: #0f172a;
}
.admin-store-pricing__header p {
  font-size: 0.82rem;
  color: #94a3b8;
}
.admin-store-pricing__row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.6rem;
  align-items: center;
}
.admin-store-pricing__row input,
.admin-store-pricing__row select {
  border: 1px solid #dfe3ea;
  padding: 0.5rem 0.75rem;
  font-size: 0.9rem;
}
.admin-store-pricing__product {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.admin-store-pricing__product select {
  flex: 1;
}
.admin-store-pricing__remove {
  border: 1px solid #fecaca;
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  color: #dc2626;
}
.admin-store-panel__actions {
  justify-content: flex-start;
  gap: 0.75rem;
}
.admin-store-panel__list {
  max-height: 520px;
  overflow: hidden;
}
.admin-store-list__items {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 450px;
  overflow-y: auto;
  padding-right: 0.25rem;
}
.admin-template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.75rem;
  width: 100%;
}
.admin-template-card {
  border: 1px solid #e2e8f0;
  background: #fff;
  border-radius: 0.9rem;
  padding: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}
.admin-template-card:hover {
  border-color: #fecdd3;
  box-shadow: 0 8px 20px -14px rgba(220, 38, 38, 0.35);
  transform: translateY(-2px);
}
.admin-template-card--selected {
  border-color: #d90000;
  box-shadow: 0 10px 26px -18px rgba(217, 0, 0, 0.45);
}
.admin-template-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}
.admin-template-card__title {
  font-weight: 700;
  color: #0f172a;
}
.admin-template-card__meta {
  font-size: 0.78rem;
  color: #94a3b8;
  margin-top: 0.1rem;
}
.admin-template-card__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.admin-template-card__hint {
  font-size: 0.82rem;
  color: #475569;
}
.admin-store-empty {
  padding: 1rem;
  color: #94a3b8;
  font-size: 0.9rem;
}
.admin-drawer {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  justify-content: flex-end;
  padding: 1rem;
}
.admin-drawer__panel {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  box-shadow: -16px 0 36px -28px rgba(15, 23, 42, 0.4), 0 20px 50px -40px rgba(15, 23, 42, 0.35);
  width: min(1040px, 100%);
  max-width: 92vw;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 1rem 0 0 1rem;
  overflow: hidden;
  min-height: 0;
}
.admin-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}
.admin-drawer__card {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  border: none;
  border-radius: 0;
  box-shadow: none;
}
.admin-drawer__card .admin-card__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  max-height: none;
}
.admin-drawer__footer {
  position: sticky;
  bottom: 0;
  background: linear-gradient(#fff, #fff 60%, rgba(255,255,255,0.95));
}
.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 0.25s ease, opacity 0.2s ease;
}
.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(24px);
  opacity: 0;
}
.drawer-slide-up-enter-active,
.drawer-slide-up-leave-active {
  transition: transform 0.25s ease, opacity 0.2s ease;
}
.drawer-slide-up-enter-from,
.drawer-slide-up-leave-to {
  transform: translateY(24px);
  opacity: 0;
}

@media (max-width: 768px) {
  .admin-drawer {
    align-items: flex-end;
    padding: 0;
  }
  .admin-drawer__panel {
    width: 100%;
    max-width: 100%;
    height: auto;
    max-height: 90vh;
    border-radius: 1rem 1rem 0 0;
    overflow: hidden;
  }
  .admin-drawer__card .admin-card__body {
    max-height: calc(90vh - 140px);
  }
}
.admin-store-card {
  border: 1px solid #e2e8f0;
  padding: 1rem;
  background: #fff;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.4);
}
.admin-store-card--editing {
  background: #fff7f7;
  border-color: #fecdd3;
}
.admin-store-card__header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
  align-items: flex-start;
}
.admin-store-card__title {
  font-size: 1rem;
  font-weight: 600;
  color: #0f172a;
}
.admin-store-card__meta {
  font-size: 0.8rem;
  color: #94a3b8;
}
.admin-store-card__prices {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.admin-store-card__price {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.85rem;
  color: #475569;
}
.admin-store-card__price-type {
  font-weight: 600;
  color: #1f2937;
  margin-right: 0.3rem;
}
.admin-store-card__price-meta {
  display: block;
  font-size: 0.7rem;
  color: #a1a1aa;
}
.admin-store-card__price-values {
  display: flex;
  gap: 0.75rem;
  font-weight: 500;
  color: #dc2626;
}

/* moved .tab-indicator to global style.css */
.cover-upload-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  z-index: 10;
  backdrop-filter: blur(3px);
}

.cover-upload-overlay__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  text-align: center;
}

.cover-upload-text {
  font-size: 0.9rem;
  color: #b91c1c;
  font-weight: 600;
}

.upload-spinner {
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 9999px;
  border: 3px solid rgba(217, 0, 0, 0.25);
  border-top-color: #d90000;
  animation: uploadSpin 0.8s linear infinite;
}

.upload-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  max-width: 220px;
}

.upload-progress__bar {
  width: 100%;
  height: 0.35rem;
  background: rgba(15, 23, 42, 0.12);
  border-radius: 999px;
  overflow: hidden;
}

.upload-progress__fill {
  height: 100%;
  background: #d90000;
  transition: width 0.25s ease;
}

.upload-progress__value {
  font-size: 0.76rem;
  color: #6b7280;
}

.btn-spinner {
  display: inline-block;
  width: 1rem;
  height: 1rem;
  margin-right: 0.5rem;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.65);
  border-top-color: #ffffff;
  animation: uploadSpin 0.75s linear infinite;
  vertical-align: middle;
}

@keyframes uploadSpin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@layer utilities {
  @keyframes scan-sweep {
    0% {
      top: 18%;
    }

    50% {
      top: 82%;
    }

    100% {
      top: 18%;
    }
  }

  .animate-scan-sweep {
    animation: scan-sweep 1.8s ease-in-out infinite;
  }
}
</style>
