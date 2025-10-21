<template>
  <main class="pt-6 pb-12 px-4">
    <div class="max-w-6xl mx-auto">
      <header class="bg-white shadow-sm border-b border-gray-100 mb-8 p-6 pt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between fade-in">
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

      <!-- Users -->
      <section v-if="tab==='users'" class="slide-up">
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
                    <div class="text-xs text-gray-500">建立：{{ u.created_at || u.createdAt }}</div>
                  </div>
                  <span class="badge">{{ (u.role || 'USER') }}</span>
                </div>
                <div v-if="u._edit && selfRole==='ADMIN'" class="mt-3 grid grid-cols-1 gap-2">
                  <input v-model.trim="u._username" placeholder="名稱" class="border px-2 py-1 w-full" />
                  <input v-model.trim="u._email" placeholder="Email" class="border px-2 py-1 w-full" />
                  <select v-model="u._newRole" class="border px-2 py-1">
                    <option value="USER">USER</option>
                    <option value="STORE">STORE</option>
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
                    <td class="px-3 py-2 border">{{ u.created_at || u.createdAt }}</td>
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
        <div v-if="coverConfirm.visible" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel" style="padding-bottom: env(safe-area-inset-bottom)">
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

      <!-- 第三方綁定管理（Admin） -->
      <transition name="backdrop-fade">
        <div v-if="oauthPanel.visible" class="fixed inset-0 bg-black/40 z-50" @click.self="closeOAuthManager"></div>
      </transition>
      <transition name="sheet-pop">
        <div v-if="oauthPanel.visible" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel" style="padding-bottom: env(safe-area-inset-bottom)">
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
      <section v-if="tab==='reservations'" class="slide-up">
        <AppCard>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
          <h2 class="font-bold">預約狀態管理</h2>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <input v-model.trim="reservationQuery" placeholder="搜尋姓名/Email/賽事/門市/票種/狀態" class="border px-2 py-2 text-sm w-full sm:w-80" @keydown.enter.prevent="performReservationSearch" />
            <button class="btn btn-outline text-sm w-full sm:w-auto" @click="performReservationSearch" :disabled="reservationsLoading"><AppIcon name="refresh" class="h-4 w-4" /> 搜尋 / 重新整理</button>
            <button class="btn btn-primary text-sm w-full sm:w-auto" @click="openScan"><AppIcon name="camera" class="h-4 w-4" /> 掃描 QR 進度</button>
          </div>
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
                  <div class="text-xs text-gray-500">時間：{{ r.reserved_at }}</div>
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
                    <div class="mt-1 text-sm text-gray-900">{{ r.reserved_at }}</div>
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

      <!-- 掃描 QR 進度：底部抽屜 -->
      <transition name="backdrop-fade">
        <div v-if="scan.open" class="fixed inset-0 bg-black/40 z-50" @click.self="closeScan"></div>
      </transition>
      <transition name="sheet-pop">
        <div v-if="scan.open" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t shadow-lg sheet-panel" style="padding-bottom: env(safe-area-inset-bottom)">
          <div class="relative p-4 sm:p-6 space-y-4">
            <button class="btn-ghost absolute top-3 right-3" title="關閉" @click="closeScan"><AppIcon name="x" class="h-5 w-5" /></button>
            <div class="mx-auto h-1.5 w-10 bg-gray-300"></div>
            <div class="scan-admin-header">
              <h3 class="scan-admin-title">掃描 QR 更新預約</h3>
              <p class="scan-admin-subtitle">辨識驗證碼後系統會自動推進下一階段。</p>
            </div>
            <div v-if="scan.error" class="text-sm text-red-600">{{ scan.error }}</div>

            <div class="scan-admin-body">
              <section class="scan-admin-camera">
                <p class="scan-admin-label">即時掃描</p>
                <div class="scan-admin-camera-wrapper">
                  <video ref="scanVideo" autoplay playsinline class="scan-admin-video"></video>
                  <div class="scan-admin-frame"></div>
                  <div v-if="scan.scanning" class="scan-admin-laser"></div>
                </div>
                <p class="scan-admin-hint">掃描完成後會自動進入下一階段，如需離開可直接關閉視窗。</p>
              </section>

              <section class="scan-admin-manual">
                <p class="scan-admin-label">備援工具</p>
                <div class="scan-admin-card">
                  <div class="scan-admin-input">
                    <input v-model.trim="scan.manual" placeholder="輸入 6 碼驗證碼" inputmode="numeric" pattern="[0-9]*" class="scan-admin-field" />
                    <button class="btn btn-primary" @click="submitManual" :disabled="!scan.manual">送出</button>
                  </div>
                  <ul class="scan-admin-tips">
                    <li><AppIcon name="check" class="h-4 w-4" /> 確認預約顯示的當前階段與掃描碼一致</li>
                    <li><AppIcon name="refresh" class="h-4 w-4" /> 若顯示階段錯誤，可請會員重新開啟最新 QR</li>
                    <li><AppIcon name="shield" class="h-4 w-4" /> 成功後系統會寄出 LINE / Email 通知</li>
                  </ul>
                </div>
              </section>
            </div>
          </div>
        </div>
      </transition>

      <!-- Products -->
      <section v-if="tab==='products'" class="slide-up">
        <AppCard>
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
          <h2 class="font-bold">商品列表</h2>
          <div class="flex items-center gap-2">
            <button class="btn btn-outline text-sm" @click="showProductForm = !showProductForm"><AppIcon name="plus" class="h-4 w-4" /> 新增商品</button>
          </div>
        </div>
        <div v-if="showProductForm" class="mb-4 border p-3 bg-gray-50">
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
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <AppCard v-for="p in products" :key="p.id || p.name" :cover-src="productCoverUrl(p)">
              <div class="flex flex-col gap-2">
              <!-- View mode -->
              <template v-if="!p._editing">
                <div class="flex items-center gap-2 flex-wrap">
                  <div class="font-semibold text-primary">{{ p.name }}</div>
                  <span v-if="p.code" class="badge gray font-mono flex items-center gap-1">商品編號 {{ p.code }}
                    <button class="btn-ghost" title="複製" @click.stop="copyToClipboard(p.code)"><AppIcon name="copy" class="h-4 w-4" /></button>
                  </span>
                </div>
                <div class="text-gray-600 text-sm min-h-[2.5rem]">{{ p.description }}</div>
                <div class="mt-1">NT$ {{ p.price }}</div>
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
      <section v-if="tab==='events'" class="slide-up">
        <AppCard>
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
          <h2 class="font-bold">活動列表</h2>
          <div class="flex items-center gap-2">
            <input v-model.trim="eventQuery" placeholder="搜尋標題/代碼/地點" class="border px-2 py-2 text-sm w-full md:w-64" />
            <button class="btn btn-outline text-sm" @click="showEventForm = !showEventForm"><AppIcon name="plus" class="h-4 w-4" /> 新增活動</button>
          </div>
        </div>
        <div v-if="showEventForm" class="mb-4 border p-3 bg-gray-50">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input v-model.trim="newEvent.title" placeholder="標題" class="border px-2 py-1" />
            <input v-model.trim="newEvent.code" placeholder="代碼（可選）" class="border px-2 py-1" />
            <input v-model.trim="newEvent.location" placeholder="地點（可選）" class="border px-2 py-1" />
            <input v-model.trim="newEvent.cover" placeholder="封面圖片 URL（可選）" class="border px-2 py-1 sm:col-span-2" />
            <div class="sm:col-span-2 flex items-center gap-3 flex-wrap">
              <input id="cover-file" type="file" accept="image/*" @change="onCoverFileChange" class="text-sm" />
              <span class="text-xs text-gray-500">封面尺寸 900×600px</span>
              <span class="text-xs text-gray-500">或貼上上方 URL</span>
            </div>
            <div v-if="coverPreview" class="sm:col-span-2">
              <img :src="coverPreview" alt="預覽" class="w-full max-w-md h-40 object-cover border" />
            </div>
            <input v-model="newEvent.deadline" type="datetime-local" placeholder="截止（可選）" class="border px-2 py-1" />
            <input v-model="newEvent.starts_at" type="datetime-local" placeholder="開始時間" class="border px-2 py-1" />
            <input v-model="newEvent.ends_at" type="datetime-local" placeholder="結束時間" class="border px-2 py-1" />
          </div>
          <div class="grid grid-cols-1 gap-2 mt-2">
            <input v-model.trim="newEvent.description" placeholder="描述（可選）" class="border px-2 py-1" />
            <input v-model.trim="newEvent.rules" placeholder="規則（以逗號分隔，可選）" class="border px-2 py-1" />
          </div>
          <div class="mt-2 flex gap-2">
            <button class="btn btn-primary text-sm" @click="createEvent" :disabled="loading">儲存</button>
            <button class="btn btn-outline text-sm" @click="showEventForm=false">取消</button>
          </div>
        </div>
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
                <div v-if="e.deadline || e.ends_at" class="text-xs text-gray-600 mt-1">🛑 截止：{{ e.deadline || e.ends_at }}</div>
                <div class="mt-3 grid grid-cols-2 gap-2">
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
                  <td class="px-3 py-2 border">{{ e.deadline || e.ends_at }}</td>
                  <td class="px-3 py-2 border">
                    <div class="flex items-center gap-2 flex-wrap">
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

        <!-- 店面管理 -->
        <transition name="slide-fade">
        <div v-if="selectedEvent" class="mt-6 border p-4 bg-gray-50 slide-up">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold">店面管理：{{ selectedEvent.name || selectedEvent.title }}（ID: {{ selectedEvent.id }}）</h3>
            <button class="btn btn-outline text-sm" @click="selectedEvent=null">關閉</button>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div class="border p-3 bg-white">
              <h4 class="font-semibold mb-2">新增店面</h4>
              <div class="flex items-center gap-2 mb-2 flex-wrap">
                <select v-model="selectedTemplateId" class="border px-2 py-1 text-sm">
                  <option value="">選擇模板</option>
                  <option v-for="t in storeTemplates" :key="t.id" :value="t.id">{{ t.name }}</option>
                </select>
                <button class="btn btn-outline text-sm" @click="applyTemplate" :disabled="!selectedTemplateId || templateLoading">套用模板</button>
                <button class="btn btn-outline text-sm" @click="saveAsTemplate" :disabled="templateLoading">另存為模板</button>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <input v-model.trim="newStore.name" placeholder="名稱（含地區）" class="border px-2 py-1 col-span-2" />
                <label class="text-xs text-gray-600">賽前開始</label>
                <label class="text-xs text-gray-600">賽前結束</label>
                <input type="date" v-model="newStore.pre_start" class="border px-2 py-1" />
                <input type="date" v-model="newStore.pre_end" class="border px-2 py-1" />
                <label class="text-xs text-gray-600">賽後開始</label>
                <label class="text-xs text-gray-600">賽後結束</label>
                <input type="date" v-model="newStore.post_start" class="border px-2 py-1" />
                <input type="date" v-model="newStore.post_end" class="border px-2 py-1" />
              </div>
              <div class="mt-3">
                <div class="flex items-center justify-between mb-1">
                  <h5 class="font-medium">價目（車型 / 原價 / 早鳥 / 綁定商品）</h5>
                  <button class="px-2 py-1 border text-xs" @click="addPriceItem()">+ 車型</button>
                </div>
                <div v-for="(it, idx) in newStore.priceItems" :key="idx" class="grid grid-cols-4 gap-2 mb-2">
                  <input v-model.trim="it.type" placeholder="車型" class="border px-2 py-1" />
                  <input type="number" min="0" v-model.number="it.normal" placeholder="原價" class="border px-2 py-1" />
                  <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" class="border px-2 py-1" />
                  <select v-model="it.productId" class="border px-2 py-1 text-sm">
                    <option value="">未綁定商品</option>
                    <option v-for="p in products" :key="p.id" :value="String(p.id)">
                      {{ p.name }}（#{{ p.id }}）
                    </option>
                  </select>
                </div>
              </div>
              <div class="mt-2 flex flex-wrap gap-2">
                <button class="btn btn-primary btn-sm" @click="createStore" :disabled="storeLoading">新增</button>
                <button class="btn btn-outline btn-sm" @click="resetNewStore" :disabled="storeLoading">清空</button>
              </div>
            </div>
            <div class="border p-3 bg-white">
              <h4 class="font-semibold mb-2">已設定店面（{{ eventStores.length }}）</h4>
              <div v-if="storeLoading" class="text-gray-500">載入中…</div>
              <div v-else-if="eventStores.length===0" class="text-gray-500">尚無資料</div>
              <div v-else class="space-y-3">
                <div v-for="s in eventStores" :key="s.id" class="border p-2">
                  <template v-if="!s._editing">
                    <div class="font-medium text-primary">{{ s.name }}</div>
                    <div class="text-sm text-gray-600">賽前：{{ s.pre_start }} ~ {{ s.pre_end }} ｜ 賽後：{{ s.post_start }} ~ {{ s.post_end }}</div>
                    <div class="text-sm mt-1">
                      <div v-for="(pv, tk) in s.prices" :key="tk">
                        {{ tk }}：原價 {{ pv.normal }}，早鳥 {{ pv.early }}
                        <div class="text-xs text-gray-500">綁定商品：{{ productLabel(pv) }}</div>
                      </div>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <button class="btn btn-outline text-sm" @click="startEditStore(s)"><AppIcon name="edit" class="h-4 w-4" /> 編輯</button>
                      <button class="btn btn-outline text-sm" @click="deleteStore(s)" :disabled="storeLoading"><AppIcon name="trash" class="h-4 w-4" /> 刪除</button>
                    </div>
                  </template>
                  <template v-else>
                    <input v-model.trim="s._editing.name" placeholder="名稱" class="border px-2 py-1 w-full mb-2" />
                    <div class="grid grid-cols-2 gap-2 mb-2">
                      <input type="date" v-model="s._editing.pre_start" class="border px-2 py-1" />
                      <input type="date" v-model="s._editing.pre_end" class="border px-2 py-1" />
                      <input type="date" v-model="s._editing.post_start" class="border px-2 py-1" />
                      <input type="date" v-model="s._editing.post_end" class="border px-2 py-1" />
                    </div>
                    <div class="mb-2">
                      <div class="flex items-center justify-between mb-1">
                        <span class="font-medium">價目</span>
                        <button class="px-2 py-1 border text-xs" @click="s._editing.priceItems.push({type:'', normal:0, early:0, productId:''})">+ 車型</button>
                      </div>
                      <div v-for="(it, idx) in s._editing.priceItems" :key="idx" class="grid grid-cols-4 gap-2 mb-2">
                        <input v-model.trim="it.type" placeholder="車型" class="border px-2 py-1" />
                        <input type="number" min="0" v-model.number="it.normal" placeholder="原價" class="border px-2 py-1" />
                        <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" class="border px-2 py-1" />
                        <select v-model="it.productId" class="border px-2 py-1 text-sm">
                          <option value="">未綁定商品</option>
                          <option v-for="p in products" :key="p.id" :value="String(p.id)">
                            {{ p.name }}（#{{ p.id }}）
                          </option>
                        </select>
                      </div>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <button class="btn btn-primary btn-sm" @click="saveEditStore(s)" :disabled="storeLoading"><AppIcon name="check" class="h-4 w-4" /> 儲存</button>
                      <button class="btn btn-outline btn-sm" @click="cancelEditStore(s)" :disabled="storeLoading"><AppIcon name="x" class="h-4 w-4" /> 取消</button>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
        </transition>
        </AppCard>
      </section>

      <!-- Orders -->
      <section v-if="tab==='orders'" class="slide-up">
        <AppCard>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
          <h2 class="font-bold">訂單狀態管理</h2>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <input v-model.trim="orderQuery" placeholder="搜尋代碼/姓名/Email/票種/狀態" class="border px-2 py-2 text-sm w-full sm:w-72" />
            <button class="btn btn-outline text-sm w-full sm:w-auto" @click="loadOrders" :disabled="ordersLoading"><AppIcon name="refresh" class="h-4 w-4" /> 重新整理</button>
          </div>
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
      <section v-if="tab==='settings'" class="slide-up">
        <AppCard>
          <div class="mb-4">
            <h2 class="font-bold">全局設定</h2>
            <p class="text-sm text-gray-600">更新後，所有新訂單的通知與檢視都會同步使用最新的匯款資訊。</p>
          </div>
          <div class="space-y-4">
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
            <div class="pt-4 mt-6 border-t border-gray-200 space-y-4">
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
          </div>
        </AppCard>
      </section>

      <!-- Tombstones -->
      <section v-if="tab==='tombstones'" class="slide-up">
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
              <p><strong>預約時間：</strong>{{ reservationDetail.record.reserved_at }}</p>
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
                    <a v-for="photo in reservationDetail.record.checklists?.[stageKey]?.photos" :key="photo.id"
                      :href="photo.url" target="_blank" rel="noopener noreferrer"
                      class="block border border-gray-200 hover:border-primary transition">
                      <img :src="photo.url" alt="檢核照片" class="w-full h-32 object-cover" />
                      <div class="px-2 py-1 bg-gray-50 text-[11px] text-gray-600 truncate">
                        {{ formatChecklistUploadedAt(photo.uploadedAt) || '—' }}
                      </div>
                    </a>
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
import { startQrScanner } from '../utils/qrScanner'

const router = useRouter()
const API = 'https://api.xiaozhi.moe/uat/leader_online'
const selfRole = ref('USER')

const tab = ref('users')
const tabIndex = ref(0)
const groupKey = ref('user')
const loading = ref(false)

const allTabs = [
  { key: 'users', label: '使用者', icon: 'user', requireAdmin: true },
  { key: 'products', label: '商品', icon: 'store', requireAdmin: true },
  { key: 'events', label: '活動', icon: 'ticket' },
  { key: 'reservations', label: '預約', icon: 'orders' },
  { key: 'orders', label: '訂單', icon: 'orders' },
  { key: 'tombstones', label: '墓碑', icon: 'lock', requireAdmin: true },
  { key: 'settings', label: '全局設定', icon: 'settings', requireAdmin: true },
]
// Group definitions
const groupDefs = [
  { key: 'user', label: '用戶管理', short: '用戶', tabs: ['users', 'tombstones'] },
  { key: 'product', label: '商品管理', short: '商品', tabs: ['products', 'events'] },
  { key: 'status', label: '狀態管理', short: '狀態', tabs: ['reservations', 'orders'] },
  { key: 'global', label: '全局設定', short: '設定', tabs: ['settings'] },
]
const displayGroupDefs = computed(() => {
  return groupDefs.filter(g => g.tabs.some(tabKey => {
    const tabDef = allTabs.find(t => t.key === tabKey)
    return tabDef && (!tabDef.requireAdmin || selfRole.value === 'ADMIN')
  }))
})

const visibleTabs = computed(() => {
  const g = groupDefs.find(x => x.key === groupKey.value)
  const keys = g ? g.tabs : []
  return allTabs.filter(t => keys.includes(t.key) && (!t.requireAdmin || selfRole.value === 'ADMIN'))
})
const setTab = (t, i) => {
  tab.value = t; tabIndex.value = i;
  try { localStorage.setItem('admin_tab', t) } catch {}
  refreshActive()
}
function defaultTabForGroup(role = selfRole.value) {
  if (groupKey.value === 'user') return 'users'
  if (groupKey.value === 'product') return role === 'ADMIN' ? 'products' : 'events'
  if (groupKey.value === 'global') return 'settings'
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
const ADMIN_ORDERS_DEFAULT_LIMIT = 50
const adminOrders = ref([])
const adminOrdersMeta = reactive({
  total: 0,
  limit: ADMIN_ORDERS_DEFAULT_LIMIT,
  offset: 0,
  hasMore: false
})
const ordersLoading = ref(false)
const orderQuery = ref('')
const orderStatuses = ['待匯款', '處理中', '已完成']
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
const CHECKLIST_STAGE_KEYS = ['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup']
const reservationStatusOptions = [
  { value: 'service_booking', label: '預約託運服務（購買票券、付款、憑證產生）' },
  { value: 'pre_dropoff', label: '賽前交車（刷碼、檢核、上傳照片、掛車牌、生成取車碼）' },
  { value: 'pre_pickup', label: '賽前取車（出示取車碼、領車、檢查、上傳合照）' },
  { value: 'post_dropoff', label: '賽後交車（刷碼、檢核、上傳照片、掛車牌、生成取車碼）' },
  { value: 'post_pickup', label: '賽後取車（出示取車碼、領車、檢查、合照存檔）' },
  { value: 'done', label: '服務結束' },
]
const adminChecklistDefinitions = {
  pre_dropoff: {
    title: '賽前交車檢核表',
    items: [
      '車輛與配件與預約資訊相符',
      '托運文件、標籤與聯絡方式已確認',
      '完成車況拍照（含序號、特殊配件）'
    ]
  },
  pre_pickup: {
    title: '賽前取車檢核表',
    items: [
      '車輛外觀、輪胎與配件無異常',
      '車牌、證件與隨車用品已領取',
      '與店員完成車況紀錄或拍照存證'
    ]
  },
  post_dropoff: {
    title: '賽後交車檢核表',
    items: [
      '車輛停放於指定區域並妥善固定',
      '與店員核對賽後車況與隨車用品',
      '拍攝交車現場與車況照片備查'
    ]
  },
  post_pickup: {
    title: '賽後取車檢核表',
    items: [
      '車輛外觀無新增損傷與污漬',
      '賽前寄存的隨車用品已領回',
      '與店員完成賽後車況點交紀錄'
    ]
  }
}
const ensureChecklistPhotos = (data) => {
  if (!data) return false
  if (typeof data.photoCount === 'number') return data.photoCount > 0
  return Array.isArray(data?.photos) && data.photos.length > 0
}
const stageLabelMap = Object.fromEntries(reservationStatusOptions.map(opt => [opt.value, opt.label]))
const checklistStageName = (stage) => adminChecklistDefinitions[stage]?.title || stageLabelMap[stage] || stage
const normalizeAdminChecklist = (stage, raw) => {
  const def = adminChecklistDefinitions[stage] || { items: [] }
  const base = raw && typeof raw === 'object' ? raw : {}
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
    mime: photo.mime,
    originalName: photo.originalName,
    uploadedAt: photo.uploadedAt,
    size: photo.size
  })).filter(photo => photo.id && photo.url) : []
  return {
    title: def.title || '',
    items: normalizedItems,
    photos,
    completed: !!base.completed,
    completedAt: base.completedAt || null,
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
    stageChecklist[stage] = {
      found: info.found != null ? !!info.found : photoCount > 0,
      completed: info.completed != null ? !!info.completed : !!checklists[stage]?.completed,
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

// Tombstones
const tombstones = ref([])
const tombstoneLoading = ref(false)
const tombstoneFilters = ref({ provider: '', subject: '', email: '' })
const tombstoneForm = ref({ provider: 'google', subject: '', email: '', reason: '' })
// 掃描進度（QR）
const scan = ref({ open: false, scanning: false, error: '', manual: '' })
const scanVideo = ref(null)
let qrController = null

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
  scan.value.open = true
}
function closeScan(){
  if (qrController) { try { qrController.stop() } catch {} qrController = null }
  resetScannerVideo()
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

async function submitManual(){ if (scan.value.manual) await submitCode(scan.value.manual) }

async function submitCode(raw){
  try{
    const code = String(raw).replace(/\s+/g,'')
    const { data } = await axios.post(`${API}/admin/reservations/progress_scan`, { code })
    if (data?.ok){
      await showNotice(`✅ 已進入下一階段：${data.data.from} → ${data.data.to}`)
      await loadAdminReservations()
      closeScan()
    } else {
      await showNotice(data?.message || '進度更新失敗', { title: '更新失敗' })
    }
  } catch(e){
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  }
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
const newProduct = ref({ name: '', price: 0, description: '' })
const newEvent = ref({ code: '', title: '', starts_at: '', ends_at: '', deadline: '', location: '', description: '', cover: '', rules: '' })
const coverFile = ref(null)
const coverPreview = ref('')
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
  if (!file) { coverPreview.value = ''; return }
  try{
    const { dataUrl } = await processImageToRatio(file)
    coverPreview.value = dataUrl
  } catch (err){
    await showNotice(err.message, { title: '錯誤' })
    coverPreview.value = ''
  }
}
const newStore = ref({ name: '', pre_start: '', pre_end: '', post_start: '', post_end: '', priceItems: [{ type: '大鐵人', normal: 0, early: 0, productId: '' }] })

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
  const q = orderQuery.value.trim().toLowerCase()
  if (!q) return adminOrders.value
  return adminOrders.value.filter(o => {
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

const filteredAdminReservations = computed(() => {
  const q = reservationQuery.value.trim().toLowerCase()
  if (!q) return adminReservations.value
  return adminReservations.value.filter(r => {
    return String(r.username || '').toLowerCase().includes(q)
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

const formatDate = (input) => {
  if (!input) return ''
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return input
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
}
const formatChecklistUploadedAt = (value) => {
  if (!value) return ''
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return ''
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  const hh = String(dt.getHours()).padStart(2, '0')
  const mm = String(dt.getMinutes()).padStart(2, '0')
  return `${y}/${m}/${d} ${hh}:${mm}`
}
const formatRange = (a,b) => {
  const A = formatDate(a), B = formatDate(b)
  return A && B ? `${A} ~ ${B}` : (A || B || '')
}

async function checkSession() {
  try {
    const { data } = await axios.get(`${API}/whoami`);
    const r = String(data?.data?.role || '').toUpperCase()
    selfRole.value = r
    return !!data?.ok && (r === 'ADMIN' || r === 'STORE');
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
      if (!['USER','STORE','ADMIN'].includes(role)) throw new Error('角色不正確')
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
      return { ...store, prices: pricesNormalized }
    })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ storeLoading.value = false }
}

async function loadStoreTemplates(){
  templateLoading.value = true
  try{
    const { data } = await axios.get(`${API}/admin/store_templates`)
    storeTemplates.value = Array.isArray(data?.data) ? data.data : []
  } catch(e){ /* silent */ }
  finally{ templateLoading.value = false }
}

function applyTemplate(){
  const id = Number(selectedTemplateId.value)
  if (!id) return
  const t = storeTemplates.value.find(x => Number(x.id) === id)
  if (!t) return
  newStore.value.name = t.name || ''
  newStore.value.pre_start = t.pre_start || ''
  newStore.value.pre_end = t.pre_end || ''
  newStore.value.post_start = t.post_start || ''
  newStore.value.post_end = t.post_end || ''
  newStore.value.priceItems = fromPricesMap(t.prices || {})
}

async function saveAsTemplate(){
  const prices = toPricesMap(newStore.value.priceItems)
  if (!Object.keys(prices).length) { await showNotice('至少設定一個車型價格再儲存模板', { title: '格式錯誤' }); return }
  let name = newStore.value.name || ''
  name = await showPrompt('模板名稱', { title: '儲存模板', initial: name, confirmText: '儲存' }).catch(()=> '')
  if (!name.trim()) return
  templateLoading.value = true
  try{
    const payload = { name: name.trim(), pre_start: newStore.value.pre_start || undefined, pre_end: newStore.value.pre_end || undefined, post_start: newStore.value.post_start || undefined, post_end: newStore.value.post_end || undefined, prices }
    const { data } = await axios.post(`${API}/admin/store_templates`, payload)
    if (data?.ok){ await loadStoreTemplates(); selectedTemplateId.value = String(data.data?.id || '') }
    else await showNotice(data?.message || '儲存模板失敗', { title: '儲存失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ templateLoading.value = false }
}

function openStoreManager(e){ selectedEvent.value = e; loadEventStores(e.id); loadStoreTemplates(); loadProducts() }
function addPriceItem(){ newStore.value.priceItems.push({ type: '', normal: 0, early: 0, productId: '' }) }
function resetNewStore(){ newStore.value = { name: '', pre_start: '', pre_end: '', post_start: '', post_end: '', priceItems: [{ type: '大鐵人', normal: 0, early: 0, productId: '' }] } }
async function createStore(){
  if (!selectedEvent.value) return
  if (!newStore.value.name) { await showNotice('請輸入名稱', { title: '格式錯誤' }); return }
  const prices = toPricesMap(newStore.value.priceItems)
  if (!Object.keys(prices).length) { await showNotice('至少設定一個車型價格', { title: '格式錯誤' }); return }
  storeLoading.value = true
  try{
    const payload = { name: newStore.value.name, pre_start: newStore.value.pre_start||undefined, pre_end: newStore.value.pre_end||undefined, post_start: newStore.value.post_start||undefined, post_end: newStore.value.post_end||undefined, prices }
    const { data } = await axios.post(`${API}/admin/events/${selectedEvent.value.id}/stores`, payload)
    if (data?.ok){ resetNewStore(); await loadEventStores(selectedEvent.value.id) }
    else await showNotice(data?.message || '新增失敗', { title: '新增失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ storeLoading.value = false }
}

function startEditStore(s){ s._editing = { name: s.name, pre_start: s.pre_start||'', pre_end: s.pre_end||'', post_start: s.post_start||'', post_end: s.post_end||'', priceItems: fromPricesMap(s.prices||{}) } }
function cancelEditStore(s){ delete s._editing }
async function saveEditStore(s){
  if (!s?._editing) return
  const body = {}
  if (s._editing.name !== s.name) body.name = s._editing.name
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
        createdAt: o.created_at || o.createdAt || '',
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
  if (!newEvent.value.title || !newEvent.value.starts_at || !newEvent.value.ends_at) { await showNotice('請輸入標題與時間', { title: '格式錯誤' }); return }
  loading.value = true
  try {
    const rules = newEvent.value.rules
      ? newEvent.value.rules.split(',').map(s => s.trim()).filter(Boolean)
      : []
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
      if (newId && coverPreview.value){
        try { await axios.post(`${API}/admin/events/${newId}/cover_json`, { dataUrl: coverPreview.value }) } catch (e) { await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
      }
      showEventForm.value = false
      newEvent.value = { code: '', title: '', starts_at: '', ends_at: '', deadline: '', location: '', description: '', cover: '', rules: '' }
      coverFile.value = null
      coverPreview.value = ''
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

async function refreshActive() {
  if (tab.value === 'users') await loadUsers()
  if (tab.value === 'products') await loadProducts()
  if (tab.value === 'events') await loadEvents()
  if (tab.value === 'reservations') await loadAdminReservations()
  if (tab.value === 'orders') await loadOrders()
  if (tab.value === 'settings') await Promise.all([loadRemittanceSettings(), loadSitePages()])
  if (tab.value === 'tombstones') await loadTombstones()
}

onMounted(async () => {
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
  if (!['user','product','status','global'].includes(groupKey.value)) groupKey.value = (selfRole.value === 'ADMIN') ? 'user' : 'product'
  // Resolve initial tab
  let initialTab = defaultTabForGroup()
  try {
    const tSaved = localStorage.getItem('admin_tab')
    if (tSaved && allTabs.find(t => t.key === tSaved)) initialTab = tSaved
  } catch {}
  const idx = Math.max(0, visibleTabs.value.findIndex(t => t.key === initialTab))
  setTab(visibleTabs.value[idx]?.key || (visibleTabs.value[0]?.key || initialTab), idx)
  await refreshActive()
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
  const state = coverConfirm.value
  if (!state.visible) return
  if (state.uploading) { e.preventDefault(); return }
  if (e.key === 'Escape') { e.preventDefault(); closeCoverConfirm() }
  if (e.key === 'Enter') { e.preventDefault(); confirmCoverApply() }
}
onMounted(() => { window.addEventListener('keydown', onKeydown) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKeydown) })
</script>

<style scoped>
/* moved .tab-indicator to global style.css */

.scan-admin-header {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 1.25rem 1rem;
  border: 1px solid #e5e7eb;
  background: #fff;
  border-radius: 0;
}

.scan-admin-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
}

.scan-admin-subtitle {
  margin: 0;
  font-size: 0.88rem;
  color: #4b5563;
  line-height: 1.5;
}

.scan-admin-body {
  display: grid;
  gap: 1.25rem;
}

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

@media (min-width: 768px) {
  .scan-admin-body {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.scan-admin-label {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 600;
  color: #6b7280;
  margin-bottom: 0.5rem;
}

.scan-admin-camera-wrapper {
  position: relative;
  border: 1px solid #e5e7eb;
  border-radius: 0;
  overflow: hidden;
  background: #111827;
  aspect-ratio: 16 / 10;
}

.scan-admin-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scan-admin-frame {
  position: absolute;
  inset: 8%;
  border: 2px solid rgba(255, 255, 255, 0.55);
  border-radius: 0;
  box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.scan-admin-laser {
  position: absolute;
  left: 16%;
  right: 16%;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(217, 0, 0, 0.9), transparent);
  animation: adminScanSweep 1.8s ease-in-out infinite;
}

@keyframes adminScanSweep {
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

.scan-admin-hint {
  margin-top: 0.75rem;
  font-size: 0.82rem;
  color: #6b7280;
}

.scan-admin-manual {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.scan-admin-card {
  padding: 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 0;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.scan-admin-input {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.scan-admin-field {
  flex: 1;
  border: 1px solid #d1d5db;
  border-radius: 0;
  padding: 0.75rem 1rem;
  font-family: 'SFMono-Regular', ui-monospace, SFMono, Menlo, Monaco, Consolas, monospace;
  font-size: 1rem;
  letter-spacing: 0.18em;
  min-width: 0;
}

.scan-admin-field:focus {
  outline: none;
  border-color: #d90000;
  box-shadow: inset 0 0 0 1px rgba(217, 0, 0, 0.4);
}

.scan-admin-tips {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #4b5563;
}

.scan-admin-tips li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
