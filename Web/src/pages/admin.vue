<template>
  <main class="admin-page pt-6 pb-12 px-4" :class="{ 'admin-page--copy-enabled': canCopyAdminContent }">
    <div class="max-w-6xl mx-auto">
      <header class="admin-hero bg-white border border-gray-300 mb-8 p-6 pt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between fade-in rounded-2xl">
        <div>
          <h1 class="ui-title text-2xl font-medium text-gray-900">管理後台總覽</h1>
          <p class="text-gray-600 mt-1">使用者、商品、活動、課程與訂單管理</p>
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

      <div class="admin-nav relative mb-6 sticky top-0 z-20 bg-white/95 backdrop-blur">
        <!-- Top-level groups -->
        <div class="admin-nav__groups flex items-center gap-2 py-2">
          <button
            v-for="g in displayGroupDefs"
            :key="g.key"
            class="admin-nav__group px-3 py-1.5 text-sm border rounded transition"
            :class="groupKey === g.key ? 'bg-red-50 border-primary text-primary' : 'border-gray-200 text-gray-600 hover:text-primary'"
            @click="setGroup(g.key)"
          >
            <span class="hidden sm:inline">{{ g.label }}</span>
            <span class="sm:hidden">{{ g.short }}</span>
          </button>
        </div>

        <!-- Tabs within selected group -->
        <div class="admin-nav__tabs relative flex border-b border-gray-200">
          <div class="tab-indicator admin-nav__indicator" :style="indicatorStyle"></div>
          <button
            v-for="(t, i) in visibleTabs"
            :key="t.key"
            class="admin-nav__tab relative px-3 py-2 text-sm sm:px-4 sm:py-3 sm:text-base font-medium text-center flex items-center gap-1 justify-center"
            :class="[tabClass(t.key), tab === t.key ? 'admin-nav__tab--active' : '']"
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
            :class="['text-left border px-4 py-4 flex flex-col gap-1 rounded-xl transition focus:outline-none focus:ring-2 focus:ring-primary/30', overviewCardClass(card)]"
            @click="handleOverviewCard(card)"
          >
            <span :class="['tracking-[0.04em] font-medium', overviewCardLabelClass(card)]">{{ card.label }}</span>
            <span :class="['stat-number font-medium', overviewCardValueClass(card)]">{{ card.value }}</span>
            <span v-if="card.hint" :class="['text-sm', overviewCardHintClass(card)]">{{ card.hint }}</span>
          </button>
        </div>
      </section>

      <section v-if="tab==='courses'" class="admin-section slide-up">
        <CourseAdminPanel @navigate="openCourseRecords" />
      </section>

      <!-- Drivers -->
      <section v-if="tab==='drivers'" class="admin-section slide-up">
        <AppCard>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
            <h2 class="ui-title font-medium">司機管理</h2>
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
              <button class="btn btn-primary btn-sm w-full sm:w-auto" @click="showDriverCreateSheet = true">
                <AppIcon name="plus" class="h-4 w-4" /> 新增司機
              </button>
              <button class="btn btn-outline btn-sm w-full sm:w-auto" @click="fetchProviderDrivers" :disabled="providerDriversLoading">
                <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
              </button>
              <button v-if="hasDriverFilters" class="btn btn-outline btn-sm w-full sm:w-auto" @click="clearTableFilters('drivers')">
                <AppIcon name="x" class="h-4 w-4" /> 清除篩選
              </button>
            </div>
          </div>
          <div class="admin-list-panel">
              <div v-if="providerDriversLoading" class="text-gray-600 text-sm">載入中…</div>
              <div v-else-if="providerDriverError" class="text-sm text-red-600">{{ providerDriverError }}</div>
              <div v-else-if="!providerDrivers.length" class="text-gray-600 text-sm">尚未建立司機</div>
              <div v-else-if="!filteredProviderDrivers.length" class="text-gray-600 text-sm">沒有符合篩選的司機</div>
              <div v-else class="overflow-x-auto">
                <table class="min-w-[520px] w-full text-sm table-default">
                  <thead>
                    <tr class="bg-gray-50 text-left">
                      <th class="px-3 py-2 border">
                        <TableColumnFilter label="姓名" :rows="providerDrivers" :value="driverTableColumns[0].value" :model-value="tableFilters.drivers.username" @update:model-value="setTableFilter('drivers', 'username', $event)" />
                      </th>
                      <th class="px-3 py-2 border">
                        <TableColumnFilter label="電子信箱" :rows="providerDrivers" :value="driverTableColumns[1].value" :model-value="tableFilters.drivers.email" @update:model-value="setTableFilter('drivers', 'email', $event)" />
                      </th>
                      <th class="px-3 py-2 border" v-if="canEditDriverProvider">
                        <TableColumnFilter label="服務商名稱" :rows="providerDrivers" :value="driverTableColumns[2].value" :model-value="tableFilters.drivers.provider" @update:model-value="setTableFilter('drivers', 'provider', $event)" />
                      </th>
                      <th class="px-3 py-2 border">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="d in filteredProviderDrivers" :key="d.id" class="hover:bg-gray-50">
                      <td class="px-3 py-2 border">{{ d.username || '-' }}</td>
                      <td class="px-3 py-2 border">{{ d.email || '-' }}</td>
                      <td class="px-3 py-2 border" v-if="canEditDriverProvider">
                        <template v-if="d._edit">
                          <input v-model.trim="d._providerId" class="border px-2 py-1 w-full" placeholder="服務商編號（可留空）" />
                          <div class="text-sm text-gray-600 mt-1">留空可解除服務商綁定</div>
                        </template>
                        <template v-else>
                          <div>{{ d.provider_username || d.provider_email || d.provider_id || '-' }}</div>
                          <div v-if="d.provider_id" class="text-sm text-gray-600 font-mono break-all">{{ d.provider_id }}</div>
                        </template>
                      </td>
                      <td class="px-3 py-2 border">
                        <div class="flex flex-wrap gap-2">
                          <template v-if="canEditDriverProvider && d._edit">
                            <button class="btn btn-primary btn-sm" @click="saveDriverProvider(d)" :disabled="driverSaving || d._saving">儲存</button>
                            <button class="btn btn-outline btn-sm" @click="cancelEditDriver(d)" :disabled="driverSaving || d._saving">取消</button>
                          </template>
                          <template v-else>
                            <button v-if="canEditDriverProvider" class="btn btn-outline btn-sm" @click="startEditDriver(d)" :disabled="driverSaving || d._saving">編輯</button>
                            <button class="btn btn-outline btn-sm" @click="deleteDriver(d)" :disabled="driverSaving || d._saving">
                              <AppIcon name="trash" class="h-4 w-4" /> 刪除
                            </button>
                          </template>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
          </div>
        </AppCard>
      </section>

      <!-- Driver Tasks -->
      <section v-if="tab==='driver-tasks'" class="admin-section slide-up">
        <AppCard>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
            <h2 class="ui-title font-medium">我的任務</h2>
            <button class="btn btn-outline btn-sm" @click="loadDriverTasks" :disabled="driverTasksLoading">
              <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
            </button>
          </div>
          <div v-if="driverTasksLoading" class="text-gray-600">載入中…</div>
          <div v-else>
            <div v-if="driverTasks.length===0" class="text-gray-600">目前沒有指派任務</div>
            <div v-else class="grid grid-cols-1 gap-3">
              <div v-for="t in driverTasks" :key="t.id" class="border rounded-xl p-4 bg-white">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div class="text-sm text-gray-600">預約 #{{ t.id }}</div>
                    <div class="font-medium text-gray-900">{{ t.event || '—' }}</div>
                    <div class="text-sm text-gray-600">交車點資訊：{{ t.store || '—' }}</div>
                    <div class="text-sm text-gray-600">
                      寄送地點：{{ formatReservationLocation(reservationRouteInfo(t).origin.name, reservationRouteInfo(t).origin.address) }}
                    </div>
                    <div class="text-sm text-gray-600">
                      送達地點：{{ formatReservationLocation(reservationRouteInfo(t).destination.name, reservationRouteInfo(t).destination.address) }}
                    </div>
                    <div class="text-sm text-gray-600">會員：{{ t.username || t.email || '-' }}</div>
                    <div class="text-sm text-gray-600">狀態：{{ stageLabelMap[t.status] || t.status }}</div>
                    <div class="text-sm text-gray-600">票種：{{ t.ticket_type || '-' }}</div>
                    <div class="text-sm text-gray-600">預約時間：{{ formatDate(t.reserved_at) }}</div>
                  </div>
                  <div class="flex flex-col gap-2 min-w-[180px]">
                    <div class="text-sm text-gray-600">驗證碼</div>
                    <div class="flex items-center gap-2 font-mono text-base tracking-[0.2em] text-gray-800">
                      <span>{{ t.stage_verify_code || '-' }}</span>
                      <button v-if="t.stage_verify_code" class="btn-ghost" title="複製驗證碼" @click="copyToClipboard(t.stage_verify_code)">
                        <AppIcon name="copy" class="h-4 w-4" />
                      </button>
                    </div>
                    <button class="btn btn-primary btn-sm" @click="startDriverScan(t)" :disabled="!t.stage_verify_code">
                      開始掃描
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </AppCard>
      </section>

      <!-- Users -->
      <section v-if="tab==='users'" class="admin-section slide-up">
        <AppCard>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
            <h2 class="ui-title font-medium">使用者列表</h2>
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
              <input v-model.trim="userQuery" placeholder="搜尋名稱、電子信箱或編號" class="border px-2 py-2 w-full md:w-60" />
              <button class="btn btn-outline btn-sm w-full sm:w-auto whitespace-nowrap" @click="performUserSearch" :disabled="usersLoading">
                <AppIcon name="refresh" class="h-4 w-4" /> 重新整理
              </button>
              <button class="btn btn-primary btn-sm w-full sm:w-auto whitespace-nowrap" @click="showUserCreateSheet = true">
                <AppIcon name="plus" class="h-4 w-4" /> 新增使用者
              </button>
              <button class="btn btn-outline btn-sm w-full sm:w-auto whitespace-nowrap" @click="openUserMerge()">
                <AppIcon name="user" class="h-4 w-4" /> 合併帳號
              </button>
              <button v-if="hasUserFilters" class="btn btn-outline btn-sm w-full sm:w-auto whitespace-nowrap" @click="clearUserFilters" :disabled="usersLoading">
                <AppIcon name="x" class="h-4 w-4" /> 清除篩選
              </button>
              <button class="btn btn-outline btn-sm w-full sm:w-auto whitespace-nowrap" @click="cleanupOAuthProviders" :disabled="oauthTools.cleaning">
                <AppIcon name="refresh" class="h-4 w-4" /> 一鍵清理第三方綁定
              </button>
              <button class="btn btn-outline btn-sm w-full sm:w-auto whitespace-nowrap" @click="cleanupLegacyDeletedAccountData" :disabled="legacyCleanupTools.cleaning">
                <AppIcon name="trash" class="h-4 w-4" /> 一次性清理舊關聯資料
              </button>
            </div>
          </div>
          <AdminFilterSheet
            v-model="tableFilters.users"
            :columns="userTableColumns"
            title="使用者欄位篩選"
            class="mb-3"
            @apply="applyServerFilterSheet('users', $event)"
          />
          <div v-if="usersLoading" class="text-gray-600">載入中…</div>
          <div v-else>
            <div v-if="filteredUsers.length===0" class="text-gray-600">沒有資料</div>
            <!-- Mobile: Cards -->
            <div class="grid grid-cols-1 gap-3 md:hidden">
              <div v-for="u in filteredUsers" :key="u.id" class="border p-3 bg-white">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="font-medium text-primary">{{ u.username }}</div>
                    <div class="text-sm text-gray-600 break-all">{{ u.email }}</div>
                    <div class="text-sm text-gray-600 mt-1">編號：<span class="font-mono">{{ u.id }}</span></div>
                    <div class="text-sm text-gray-600">建立：{{ formatDate(u.created_at || u.createdAt) }}</div>
                    <div v-if="allowsProviderBinding(u.role)" class="text-sm text-gray-600">服務商：{{ u.provider_username || u.provider_email || u.provider_id || '—' }}</div>
                  </div>
                  <div class="flex flex-col items-end gap-2">
                    <span class="badge">{{ roleLabel(u.role || 'USER') }}</span>
                    <span v-if="u.isVip" class="rounded-full border border-amber-300 bg-black px-2 py-0.5 text-xs font-semibold tracking-[0.12em] text-amber-200">VIP</span>
                  </div>
                </div>
                <div v-if="u._edit && selfRole==='ADMIN'" class="mt-3 grid grid-cols-1 gap-2">
                  <input v-model.trim="u._username" placeholder="名稱" class="border px-2 py-1 w-full" />
                  <input v-model.trim="u._email" placeholder="電子信箱" class="border px-2 py-1 w-full" />
                  <select v-model="u._newRole" class="border px-2 py-1">
                    <option value="USER">一般會員</option>
                    <option value="SERVICE_PROVIDER">服務商</option>
                    <option value="DRIVER">司機</option>
                    <option value="DELIVERY_POINT">交車點</option>
                    <option value="EDITOR">編輯</option>
                    <option value="ADMIN">管理員</option>
                  </select>
                  <label class="flex items-center gap-2 text-sm text-gray-700">
                    <input v-model="u._isVip" type="checkbox" class="h-4 w-4 accent-amber-500" />
                    VIP 會員
                  </label>
                  <input v-if="allowsProviderBinding(u._newRole)" v-model.trim="u._providerId" placeholder="服務商編號（選填）" class="border px-2 py-1 w-full" />
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
                  <button class="btn btn-outline btn-sm" @click="openUserMerge(u)"><AppIcon name="user" class="h-4 w-4" /> 合併</button>
                  <button class="btn btn-outline btn-sm" @click="deleteUser(u)"><AppIcon name="trash" class="h-4 w-4" /> 刪除</button>
                </div>
              </div>
            </div>
            <!-- Desktop: Table -->
            <div class="overflow-x-auto hidden md:block">
              <table class="min-w-[720px] w-full text-sm table-default">
                <thead class="sticky top-0 z-10">
                  <tr class="bg-gray-50 text-left">
                    <th class="px-3 py-2 border">
                      <TableColumnFilter mode="server" label="編號" :fields="userTableColumns[0].fields" :model-value="tableFilters.users.id" @update:model-value="setTableFilter('users', 'id', $event)" @apply="applyServerTableFilter('users', 'id', $event)" />
                    </th>
                    <th class="px-3 py-2 border">
                      <TableColumnFilter mode="server" label="名稱" :fields="userTableColumns[1].fields" :model-value="tableFilters.users.username" @update:model-value="setTableFilter('users', 'username', $event)" @apply="applyServerTableFilter('users', 'username', $event)" />
                    </th>
                    <th class="px-3 py-2 border">
                      <TableColumnFilter mode="server" label="電子信箱" :fields="userTableColumns[2].fields" :model-value="tableFilters.users.email" @update:model-value="setTableFilter('users', 'email', $event)" @apply="applyServerTableFilter('users', 'email', $event)" />
                    </th>
                    <th class="px-3 py-2 border">
                      <TableColumnFilter mode="server" label="角色" :fields="userTableColumns[3].fields" :model-value="tableFilters.users.role" @update:model-value="setTableFilter('users', 'role', $event)" @apply="applyServerTableFilter('users', 'role', $event)" />
                    </th>
                    <th class="px-3 py-2 border">
                      <TableColumnFilter mode="server" label="建立時間" :fields="userTableColumns[4].fields" :model-value="tableFilters.users.createdAt" @update:model-value="setTableFilter('users', 'createdAt', $event)" @apply="applyServerTableFilter('users', 'createdAt', $event)" />
                    </th>
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
                    <td class="px-3 py-2 border">
                      <template v-if="selfRole==='ADMIN'">
                        <template v-if="u._edit">
                          <select v-model="u._newRole" class="border px-2 py-1">
                            <option value="USER">一般會員</option>
                            <option value="SERVICE_PROVIDER">服務商</option>
                            <option value="DRIVER">司機</option>
                            <option value="DELIVERY_POINT">交車點</option>
                            <option value="EDITOR">編輯</option>
                            <option value="ADMIN">管理員</option>
                          </select>
                          <label class="mt-2 flex items-center gap-2 text-sm normal-case text-gray-700">
                            <input v-model="u._isVip" type="checkbox" class="h-4 w-4 accent-amber-500" />
                            VIP 會員
                          </label>
                        </template>
                        <template v-else>
                          <div>{{ roleLabel(u.role || 'USER') }}</div>
                          <span v-if="u.isVip" class="mt-1 inline-flex rounded-full border border-amber-300 bg-black px-2 py-0.5 text-xs font-semibold tracking-[0.12em] text-amber-200">VIP</span>
                          <div v-if="allowsProviderBinding(u.role)" class="text-sm normal-case text-gray-600">服務商：{{ u.provider_username || u.provider_email || u.provider_id || '—' }}</div>
                        </template>
                      </template>
                      <template v-else>
                        <div>{{ roleLabel(u.role || 'USER') }}</div>
                        <span v-if="u.isVip" class="mt-1 inline-flex rounded-full border border-amber-300 bg-black px-2 py-0.5 text-xs font-semibold tracking-[0.12em] text-amber-200">VIP</span>
                        <div v-if="allowsProviderBinding(u.role)" class="text-sm normal-case text-gray-600">服務商：{{ u.provider_username || u.provider_email || u.provider_id || '—' }}</div>
                      </template>
                    </td>
                    <td class="px-3 py-2 border">{{ formatDate(u.created_at || u.createdAt) }}</td>
                    <td class="px-3 py-2 border">
                      <template v-if="selfRole==='ADMIN'">
                        <div class="flex flex-wrap gap-2">
                          <template v-if="u._edit">
                            <input v-if="allowsProviderBinding(u._newRole)" v-model.trim="u._providerId" class="border px-2 py-1 w-full md:w-56" placeholder="服務商編號（選填）" />
                            <button class="btn btn-primary btn-sm" @click="saveUserProfile(u)" :disabled="u._saving">儲存</button>
                            <button class="btn btn-outline btn-sm" @click="cancelEditUser(u)" :disabled="u._saving">取消</button>
                          </template>
                          <template v-else>
                            <button class="btn btn-outline btn-sm" @click="startEditUser(u)">編輯</button>
                            <button class="btn btn-outline btn-sm" @click="exportUser(u)"><AppIcon name="copy" class="h-4 w-4" /> 匯出</button>
                            <button class="btn btn-outline btn-sm" @click="resetUserPassword(u)"><AppIcon name="lock" class="h-4 w-4" /> 重設密碼</button>
                            <button class="btn btn-outline btn-sm" @click="openOAuthManager(u)"><AppIcon name="user" class="h-4 w-4" /> 第三方綁定</button>
                            <button class="btn btn-outline btn-sm" @click="openUserMerge(u)"><AppIcon name="user" class="h-4 w-4" /> 合併</button>
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
            <AdminPagination
              :total="usersMeta.total"
              :limit="usersMeta.limit"
              :offset="usersMeta.offset"
              :loading="usersLoading"
              @change="loadUsers({ offset: $event.offset })"
            />
          </div>
        </AppCard>
      </section>

      <!-- 封面更換預覽 Modal（全域，供活動/商品共用） -->
      <transition name="backdrop-fade">
        <div v-if="coverConfirm.visible" class="fixed inset-0 bg-black/40 z-50" @click.self="!coverConfirm.uploading && closeCoverConfirm()"></div>
      </transition>
      <transition name="sheet-pop">
        <div v-if="coverConfirm.visible" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t border-gray-300 sheet-panel rounded-t-2xl" style="padding-bottom: env(safe-area-inset-bottom)">
          <div class="relative p-4 sm:p-5 space-y-3">
            <button class="btn-ghost absolute top-3 right-3" title="關閉" @click="closeCoverConfirm" :disabled="coverConfirm.uploading"><AppIcon name="x" class="h-5 w-5" /></button>
            <div class="mx-auto h-1.5 w-10 bg-gray-300"></div>
            <h3 class="ui-title font-medium text-primary">確認更換封面</h3>
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
          <header class="rounded-2xl border border-gray-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-5 py-5 sm:px-6">
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 class="ui-title text-lg font-medium text-gray-900">掃描碼更新預約</h2>
                <p class="mt-1 text-sm text-gray-600">掃描後確認檢核內容，再推進下一階段。</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="rounded-lg px-3 py-1 text-sm font-medium"
                  :class="scan.review ? 'bg-blue-100 text-blue-700' : (scan.scanning ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600')">
                  {{ scan.review ? '待確認' : (scan.scanning ? '掃描中' : '待機') }}
                </span>
                <button class="btn btn-primary" @click="openScan" :disabled="scan.scanning || !!scan.review">
                  <AppIcon name="camera" class="h-4 w-4" /> 開始掃描
                </button>
                <button class="btn btn-outline" @click="closeScan" :disabled="!scan.scanning">停止</button>
              </div>
            </div>
          </header>

          <p v-if="scan.error" class="mt-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {{ scan.error }}
          </p>

          <div class="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
            <section class="flex flex-col gap-3">
              <div class="relative aspect-[16/10] overflow-hidden rounded-2xl border border-gray-200 bg-slate-900">
                <video ref="scanVideo" autoplay playsinline class="h-full w-full object-cover"></video>
                <div class="pointer-events-none absolute inset-[8%] rounded-xl border-2 border-white/70 bg-white/5"></div>
                <div
                  v-if="scan.scanning"
                  class="absolute left-[16%] right-[16%] h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-scan-sweep top-[18%]"
                ></div>
              </div>
              <div class="grid gap-3 md:grid-cols-2">
                <div class="rounded-xl border border-gray-200 bg-white p-4">
                  <p class="meta-label">手動輸入</p>
                  <div class="mt-3 flex flex-col gap-2">
                    <input
                      v-model.trim="scan.manual"
                      placeholder="輸入 6 碼驗證碼"
                      inputmode="numeric"
                      pattern="[0-9]*"
                      class="w-full border border-gray-300 px-4 py-3 font-mono text-base tracking-[0.18em] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                    <button class="btn btn-primary" @click="submitManual" :disabled="!scan.manual || !!scan.review">送出</button>
                  </div>
                </div>
                <div class="rounded-xl border border-gray-200 bg-white p-4">
                  <p class="meta-label">操作提醒</p>
                  <ul class="mt-3 flex flex-col gap-2 text-sm text-gray-600">
                    <li class="flex items-center gap-2"><AppIcon name="check" class="h-4 w-4" /> 確認階段與掃描碼一致</li>
                    <li class="flex items-center gap-2"><AppIcon name="refresh" class="h-4 w-4" /> 若異常請會員更新掃描碼</li>
                    <li class="flex items-center gap-2"><AppIcon name="shield" class="h-4 w-4" /> 成功後自動通知</li>
                  </ul>
                </div>
              </div>
            </section>

            <aside class="flex flex-col gap-3">
              <div class="rounded-xl border border-gray-200 bg-white p-4">
                <p class="meta-label">目前狀態</p>
                <div class="mt-3 space-y-2 text-sm text-gray-700">
                  <div class="flex items-center justify-between">
                    <span>相機</span>
                    <span class="font-medium">{{ scan.scanning ? '已啟動' : '未啟動' }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span>待確認</span>
                    <span class="font-medium">{{ scan.review ? '是' : '否' }}</span>
                  </div>
                </div>
              </div>
              <div class="rounded-xl border border-gray-200 bg-white p-4" v-if="scan.review">
                <p class="meta-label">掃描結果</p>
                <div class="mt-3 space-y-2 text-sm text-gray-700">
                  <div class="font-medium text-gray-900">{{ scan.review.reservation?.event || '—' }}</div>
                  <div>交車點資訊：{{ scan.review.reservation?.store || '—' }}</div>
                  <div>會員：{{ scan.review.reservation?.username || scan.review.reservation?.email || scan.review.reservation?.user_id || '—' }}</div>
                </div>
              </div>
            </aside>

            <section v-if="scan.review" class="lg:col-span-2">
              <div class="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-slate-50 p-5">
                <div class="flex flex-wrap items-center gap-2 font-medium text-gray-800">
                  <span class="rounded bg-amber-100 px-2 py-1 text-sm text-amber-700">{{ scan.review.stageLabel || checklistStageName(scan.review.stage) }}</span>
                  <AppIcon name="arrow-right" class="h-4 w-4 text-gray-600" />
                  <span class="rounded bg-emerald-100 px-2 py-1 text-sm text-emerald-700">{{ scan.review.nextStageLabel || '完成' }}</span>
                </div>
                <dl class="grid gap-4 text-sm text-slate-600 md:grid-cols-2">
                  <div>
                    <dt class="meta-label">服務檔期</dt>
                    <dd>{{ scan.review.reservation?.event || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="meta-label">交車點資訊</dt>
                    <dd>{{ scan.review.reservation?.store || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="meta-label">會員</dt>
                    <dd>{{ scan.review.reservation?.username || scan.review.reservation?.email || scan.review.reservation?.user_id || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="meta-label">檢核狀態</dt>
                    <dd class="flex flex-wrap items-center gap-2">
                      <span v-if="scan.review.checklistReady" class="font-medium text-emerald-600">已完成</span>
                      <span v-else class="font-medium text-red-600">尚未完成</span>
                      <span class="text-gray-600">（照片 {{ scan.review.checklist?.photoCount || 0 }} 張）</span>
                    </dd>
                  </div>
                </dl>
                <div>
                  <h4 class="text-base font-medium text-slate-900">{{ scan.review.checklist?.title || checklistStageName(scan.review.stage) }}</h4>
                  <ul class="mt-3 flex flex-col gap-2 text-sm text-slate-700">
                    <li v-for="item in scan.review.checklist?.items" :key="item.label" class="flex items-center gap-2">
                      <AppIcon :name="item.checked ? 'check' : 'x'" class="h-4 w-4" :class="item.checked ? 'text-emerald-500' : 'text-red-500'" />
                      <span>{{ item.label }}</span>
                    </li>
                  </ul>
                </div>
                <div v-if="ensureChecklistPhotos(scan.review.checklist)" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <button
                    v-for="photo in scan.review.checklist.photos"
                    :key="photo.id"
                    type="button"
                    class="group relative overflow-hidden border border-slate-300 bg-white transition focus:outline-none focus:ring-2 focus:ring-primary/40 hover:border-primary"
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
        <div v-if="oauthPanel.visible" class="fixed inset-x-0 bottom-0 z-50 bg-white border-t border-gray-300 sheet-panel rounded-t-2xl" style="padding-bottom: env(safe-area-inset-bottom)">
          <div class="relative p-4 sm:p-5 space-y-4">
            <button class="btn-ghost absolute top-3 right-3" title="關閉" @click="closeOAuthManager"><AppIcon name="x" class="h-5 w-5" /></button>
            <div class="mx-auto h-1.5 w-10 bg-gray-300"></div>
            <h3 class="ui-title font-medium text-primary">管理第三方綁定</h3>
            <p class="text-sm text-gray-600">使用者：<span class="font-mono">{{ oauthPanel.user?.username || oauthPanel.user?.email || oauthPanel.user?.id }}</span></p>

            <div class="space-y-2">
              <div class="font-medium">已綁定</div>
              <div v-if="oauthPanel.loading" class="text-gray-600">載入中…</div>
              <div v-else>
                <div v-if="oauthPanel.list.length===0" class="text-gray-600">沒有綁定紀錄</div>
                <div v-else class="space-y-2">
                  <div v-for="it in oauthPanel.list" :key="it.id" class="flex items-center justify-between border p-2">
                    <div class="text-sm">
                      <div>第三方平台：<span class="font-medium">{{ it.provider }}</span></div>
                      <div class="font-mono break-all">subject：{{ it.subject }}</div>
                      <div class="text-sm text-gray-600 break-all" v-if="it.email">電子信箱：{{ it.email }}</div>
                    </div>
                    <button class="btn btn-outline btn-sm" @click="removeOAuthBinding(it)">解除</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <div class="font-medium">新增綁定</div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select v-model="oauthPanel.form.provider" class="border px-2 py-2">
                  <option value="line">LINE</option>
                  <option value="google">Google</option>
                </select>
                <input v-model.trim="oauthPanel.form.subject" placeholder="subject（LINE userId / Google sub）" class="border px-2 py-2" />
                <input v-model.trim="oauthPanel.form.email" placeholder="電子信箱（選填，用於顯示）" class="border px-2 py-2" />
              </div>
              <div class="flex gap-2">
                <button class="btn btn-primary" @click="addOAuthBinding" :disabled="oauthPanel.saving">新增綁定</button>
                <button class="btn btn-outline" @click="reloadOAuthList" :disabled="oauthPanel.loading"><AppIcon name="refresh" class="h-4 w-4" /> 重新整理</button>
              </div>
              <p class="text-sm text-gray-600">注意：同一第三方平台與 subject 僅能綁定一個帳號。</p>
            </div>
          </div>
        </div>
      </transition>

      

      <!-- Reservations -->
      <section v-if="tab==='reservations'" class="admin-section slide-up">
        <AppCard>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
          <h2 class="ui-title font-medium">預約狀態管理</h2>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <input v-model.trim="reservationQuery" placeholder="搜尋編號、姓名、電子信箱、服務檔期、交車點資訊、票種或狀態" class="border px-2 py-2 text-sm w-full sm:w-80" @keydown.enter.prevent="performReservationSearch" />
            <button class="btn btn-outline text-sm w-full sm:w-auto" @click="performReservationSearch" :disabled="reservationsLoading"><AppIcon name="refresh" class="h-4 w-4" /> 搜尋 / 重新整理</button>
            <button v-if="hasReservationFilters" class="btn btn-outline text-sm w-full sm:w-auto" @click="clearReservationFilters" :disabled="reservationsLoading">
              <AppIcon name="x" class="h-4 w-4" /> 清除篩選
            </button>
            <button class="btn btn-primary text-sm w-full sm:w-auto" @click="openScan"><AppIcon name="camera" class="h-4 w-4" /> 掃描碼進度</button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 mb-3">
          <button
            v-for="item in reservationStatusSummary"
            :key="`reservation-filter-${item.key}`"
            class="px-3 py-1 text-sm border transition"
            :class="reservationStatusFilter === item.key ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary hover:text-primary'"
            @click="setReservationStatusFilter(item.key)"
          >
            {{ item.label }}
            <span class="ml-1 text-sm text-gray-600">({{ item.count }})</span>
          </button>
        </div>
        <div v-if="adminReservations.length" class="hidden md:flex flex-wrap gap-2 mb-3">
          <TableColumnFilter
            v-for="column in reservationTableColumns"
            :key="`reservation-column-filter-${column.key}`"
            mode="server"
            class="border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700"
            :label="column.label"
            :fields="column.fields"
            :model-value="tableFilters.reservations[column.key]"
            @update:model-value="setTableFilter('reservations', column.key, $event)"
            @apply="applyServerTableFilter('reservations', column.key, $event)"
          />
        </div>
        <AdminFilterSheet
          v-model="tableFilters.reservations"
          :columns="reservationTableColumns"
          title="預約欄位篩選"
          class="mb-3"
          @apply="applyServerFilterSheet('reservations', $event)"
        />
        <div v-if="reservationsLoading" class="text-gray-600">載入中…</div>
        <div v-else>
          <div v-if="adminReservations.length===0" class="text-gray-600">沒有資料</div>
          <div v-else-if="filteredAdminReservations.length===0" class="text-gray-600">沒有符合篩選的預約</div>
          <!-- Mobile: Cards -->
          <div v-else class="grid grid-cols-1 gap-3 md:hidden">
            <div v-for="r in filteredAdminReservations" :key="r.id" class="border p-3 bg-white">
              <div class="flex items-start justify-between mb-2">
                <div>
                  <div class="font-medium text-primary">{{ r.event }}</div>
                  <div class="text-sm text-gray-600">使用者：{{ r.username }}（{{ r.email }}）</div>
                  <div class="text-sm text-gray-600">交車點資訊：{{ r.store }}</div>
                  <div class="text-sm text-gray-600">票種：{{ r.ticket_type }}</div>
                  <div class="text-sm text-gray-600">時間：{{ formatDate(r.reserved_at) }}</div>
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
          <div v-if="filteredAdminReservations.length" class="hidden md:flex md:flex-col gap-3">
            <div
              v-for="r in filteredAdminReservations"
              :key="r.id"
              class="border-y border-gray-300 bg-transparent py-4"
            >
              <div class="flex flex-wrap gap-4">
                <div class="grid flex-1 min-w-[280px] grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-3 xl:grid-cols-4">
                  <div>
                    <div class="meta-label">編號</div>
                    <div class="mt-1 font-mono text-sm text-gray-900 break-all">{{ r.id }}</div>
                  </div>
                  <div>
                    <div class="meta-label">使用者</div>
                    <div class="mt-1 text-sm text-gray-900">
                      {{ r.username }}
                      <div class="text-sm text-gray-600 break-all">{{ r.email }}</div>
                    </div>
                  </div>
                  <div>
                    <div class="meta-label">服務檔期</div>
                    <div class="mt-1 text-sm text-gray-900">{{ r.event }}</div>
                  </div>
                  <div>
                    <div class="meta-label">交車點資訊</div>
                    <div class="mt-1 text-sm text-gray-900">{{ r.store }}</div>
                  </div>
                  <div>
                    <div class="meta-label">票種</div>
                    <div class="mt-1 text-sm text-gray-900">{{ r.ticket_type }}</div>
                  </div>
                  <div>
                    <div class="meta-label">預約時間</div>
                    <div class="mt-1 text-sm text-gray-900">{{ formatDate(r.reserved_at) }}</div>
                  </div>
                  <div>
                    <div class="meta-label">驗證碼</div>
                    <div class="mt-1 flex items-center gap-2 font-mono text-sm text-gray-900">
                      <span>{{ r.stage_verify_code || '-' }}</span>
                      <button v-if="r.stage_verify_code" class="btn-ghost" title="複製驗證碼" @click="copyToClipboard(r.stage_verify_code)">
                        <AppIcon name="copy" class="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
                <div class="flex flex-col gap-3 w-full md:w-60">
                  <div>
                    <div class="meta-label">狀態</div>
                    <select v-model="r.newStatus" class="mt-1 border px-2 py-1 text-sm w-full">
                      <option v-for="opt in reservationStatusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                    </select>
                    <div class="mt-1 text-sm text-gray-600">目前：<span class="font-medium text-gray-700">{{ r.status }}</span></div>
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
          <AdminPagination
            :total="adminReservationsMeta.total"
            :limit="adminReservationsMeta.limit"
            :offset="adminReservationsMeta.offset"
            :loading="reservationsLoading"
            @change="loadAdminReservations({ offset: $event.offset })"
          />
        </div>
        </AppCard>
      </section>

      <!-- Tickets -->
      <section v-if="tab==='tickets'" class="admin-section slide-up">
        <div class="mb-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="font-medium text-gray-900">票券分類</p>
            <p class="mt-1 text-sm text-gray-600">一般票券與課程計次票分開管理，不混用狀態與核銷操作。</p>
          </div>
          <div class="flex min-w-max gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1" role="tablist" aria-label="票券分類">
            <button
              v-for="option in ticketCategoryOptions"
              :key="`ticket-category-${option.key}`"
              type="button"
              class="min-h-[40px] rounded-md px-4 py-2 text-sm font-medium transition"
              :class="ticketCategory === option.key ? 'bg-white text-primary shadow-sm' : 'text-gray-600 hover:text-primary'"
              role="tab"
              :aria-selected="ticketCategory === option.key"
              @click="setTicketCategory(option.key)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <CourseAdminPanel v-if="ticketCategory === 'course'" mode="tickets" />
        <AppCard v-else>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
            <h2 class="ui-title font-medium">票券追蹤</h2>
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
              <input v-model.trim="ticketQuery" placeholder="搜尋編號、姓名、電子信箱或票種" class="border px-2 py-2 text-sm w-full sm:w-72" @keydown.enter.prevent="performTicketSearch()" />
              <select v-model="ticketStatusFilter" class="border px-2 py-2 text-sm w-full sm:w-auto">
                <option value="all">全部狀態</option>
                <option value="multiple" disabled>多個狀態</option>
                <option value="available">可用</option>
                <option value="used">已使用</option>
                <option value="expired">已過期</option>
              </select>
              <button class="btn btn-outline text-sm w-full sm:w-auto" @click="performTicketSearch()" :disabled="ticketsLoading">
                <AppIcon name="refresh" class="h-4 w-4" /> 搜尋 / 重新整理
              </button>
              <button class="btn btn-outline text-sm w-full sm:w-auto" @click="backfillTicketProductBindings" :disabled="ticketProductBackfillTools.running || ticketsLoading">
                <AppIcon name="refresh" class="h-4 w-4" /> 一次性回填票券商品
              </button>
              <button v-if="hasTicketFilters" class="btn btn-outline text-sm w-full sm:w-auto" @click="clearTicketFilters" :disabled="ticketsLoading">
                <AppIcon name="x" class="h-4 w-4" /> 清除篩選
              </button>
            </div>
          </div>
          <div v-if="ticketsLoading" class="text-gray-600">載入中…</div>
          <div v-else>
            <AdminFilterSheet
              v-model="tableFilters.tickets"
              :columns="ticketTableColumns"
              title="票券欄位篩選"
              class="mb-3"
              @apply="applyServerFilterSheet('tickets', $event)"
            />
            <div v-if="adminTickets.length===0" class="text-gray-600">沒有資料</div>
            <div v-else-if="filteredAdminTickets.length===0" class="text-gray-600">沒有符合篩選的票券</div>
            <template v-else>
              <div class="grid grid-cols-1 gap-3 md:hidden">
                <article v-for="row in filteredAdminTickets" :key="`ticket-card-${row.id}`" class="border border-gray-300 bg-white p-3 rounded-xl">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="font-medium text-primary truncate">{{ row.type || '未命名票券' }}</div>
                      <div class="font-mono text-sm text-gray-600 break-all">#{{ row.id }} · {{ row.uuid }}</div>
                    </div>
                    <span class="badge shrink-0" :class="row.badgeClass">{{ row.statusLabel }}</span>
                  </div>
                  <div class="mt-3 grid gap-1 text-sm text-gray-600">
                    <div>折扣：{{ row.discount || 0 }}</div>
                    <div>綁定商品：{{ productLabel(row) }}</div>
                    <div>持有人：{{ row.username || '未綁定' }}</div>
                    <div class="break-all">電子信箱：{{ row.email || '—' }}</div>
                    <div>建立：{{ formatDate(row.created_at) }}</div>
                    <div v-if="row.expiryText">{{ row.expiryText }}</div>
                  </div>
                  <button class="btn btn-outline btn-sm w-full mt-3" @click="openTicketDetail(row)">檢視 / 編輯</button>
                </article>
              </div>
              <div class="overflow-x-auto hidden md:block">
                <table class="min-w-[960px] w-full text-sm table-default">
                  <thead class="sticky top-0 z-10">
                    <tr class="bg-gray-50 text-left">
                      <th class="px-3 py-2 border">
                        <TableColumnFilter mode="server" label="票券編號" :fields="ticketTableColumns[0].fields" :model-value="tableFilters.tickets.id" @update:model-value="setTableFilter('tickets', 'id', $event)" @apply="applyServerTableFilter('tickets', 'id', $event)" />
                      </th>
                      <th class="px-3 py-2 border">
                        <TableColumnFilter mode="server" label="票券資訊" :fields="ticketTableColumns[1].fields" :model-value="tableFilters.tickets.info" @update:model-value="setTableFilter('tickets', 'info', $event)" @apply="applyServerTableFilter('tickets', 'info', $event)" />
                      </th>
                      <th class="px-3 py-2 border">
                        <TableColumnFilter mode="server" label="持有人" :fields="ticketTableColumns[2].fields" :model-value="tableFilters.tickets.holder" @update:model-value="setTableFilter('tickets', 'holder', $event)" @apply="applyServerTableFilter('tickets', 'holder', $event)" />
                      </th>
                      <th class="px-3 py-2 border">
                        <TableColumnFilter mode="server" label="建立時間" :fields="ticketTableColumns[3].fields" :model-value="tableFilters.tickets.createdAt" @update:model-value="setTableFilter('tickets', 'createdAt', $event)" @apply="applyServerTableFilter('tickets', 'createdAt', $event)" />
                      </th>
                      <th class="px-3 py-2 border">
                        <TableColumnFilter mode="server" label="狀態" :fields="ticketTableColumns[4].fields" :model-value="tableFilters.tickets.status" @update:model-value="setTableFilter('tickets', 'status', $event)" @apply="applyServerTableFilter('tickets', 'status', $event)" />
                      </th>
                      <th class="px-3 py-2 border">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in filteredAdminTickets" :key="row.id">
                      <td class="px-3 py-2 border align-top">
                        <div class="font-mono text-sm text-gray-600">#{{ row.id }}</div>
                        <div class="font-mono text-sm text-gray-600 break-all">{{ row.uuid }}</div>
                      </td>
                      <td class="px-3 py-2 border align-top">
                        <div class="font-medium text-primary">{{ row.type || '未命名票券' }}</div>
                        <div class="text-sm text-gray-600">綁定商品：{{ productLabel(row) }}</div>
                        <div class="text-sm text-gray-600">折扣：{{ row.discount || 0 }}</div>
                      </td>
                      <td class="px-3 py-2 border align-top">
                        <div class="font-medium">{{ row.username || '未綁定' }}</div>
                        <div class="text-sm text-gray-600 break-all">{{ row.email || '—' }}</div>
                      </td>
                      <td class="px-3 py-2 border align-top">
                        <div class="text-sm text-gray-700">{{ formatDate(row.created_at) }}</div>
                      </td>
                      <td class="px-3 py-2 border align-top">
                        <span class="badge" :class="row.badgeClass">{{ row.statusLabel }}</span>
                        <div v-if="row.expiryText" class="text-sm text-gray-600 mt-1">{{ row.expiryText }}</div>
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
            </template>
            <AdminPagination
              :total="adminTicketsMeta.total"
              :limit="adminTicketsMeta.limit"
              :offset="adminTicketsMeta.offset"
              :loading="ticketsLoading"
              @change="loadAdminTickets({ offset: $event.offset, forceSummary: false })"
            />
          </div>
        </AppCard>
      </section>

      <!-- 掃描碼進度：底部抽屜 -->
      <transition name="backdrop-fade">
        <div v-if="scan.open" class="fixed inset-0 bg-black/40 z-50" @click.self="closeScan"></div>
      </transition>
      <transition name="sheet-pop">
        <div v-if="scan.open" class="fixed inset-x-0 bottom-0 z-50 max-h-[90vh] bg-white border-t border-gray-300 sheet-panel rounded-t-2xl">
          <div class="relative flex max-h-full flex-col min-h-0">
            <button class="btn-ghost absolute right-3 top-3 text-gray-600 hover:text-gray-800" title="關閉" @click="closeScan">
              <AppIcon name="x" class="h-5 w-5" />
            </button>
            <div class="mx-auto mt-2 h-1.5 w-10 bg-gray-300"></div>
            <div class="flex-1 min-h-0 overflow-y-auto px-4 pb-6 pt-6 sm:px-6">
              <header class="rounded border border-gray-200 bg-white px-4 py-4 sm:px-6">
                <h3 class="ui-title text-lg font-medium text-gray-900">掃描碼更新預約</h3>
                <p class="mt-1 text-sm text-gray-600">掃描後請確認檢核內容，再推進下一階段。</p>
              </header>
              <p v-if="scan.error" class="mt-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {{ scan.error }}
              </p>

              <div class="mt-6 grid gap-6 md:grid-cols-2">
                <section class="flex flex-col">
                  <p class="mb-2 meta-label">即時掃描</p>
                  <div class="relative aspect-[16/10] overflow-hidden border border-gray-200 bg-slate-900">
                    <video ref="scanVideo" autoplay playsinline class="h-full w-full object-cover"></video>
                    <div class="pointer-events-none absolute inset-[8%] border-2 border-white/70 bg-white/5"></div>
                    <div
                      v-if="scan.scanning"
                      class="absolute left-[16%] right-[16%] h-0.5 bg-gradient-to-r from-transparent via-red-700/90 to-transparent animate-scan-sweep top-[18%]"
                    ></div>
                  </div>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button class="btn btn-primary btn-sm" @click="openScan" :disabled="scan.scanning || !!scan.review">開始掃描</button>
                    <button class="btn btn-outline btn-sm" @click="closeScan" :disabled="!scan.scanning">停止掃描</button>
                  </div>
                  <p class="mt-3 text-sm text-gray-600">掃描完成後會顯示檢核表，確認無誤再繼續。</p>
                </section>

                <section class="flex flex-col">
                  <p class="mb-2 meta-label">備援工具</p>
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
                      <li class="flex items-center gap-2"><AppIcon name="refresh" class="h-4 w-4" /> 若顯示階段錯誤，可請會員重新開啟最新掃描碼</li>
                      <li class="flex items-center gap-2"><AppIcon name="shield" class="h-4 w-4" /> 成功後系統會寄出 LINE 或電子信箱通知</li>
                    </ul>
                  </div>
                </section>

                <section v-if="scan.review" class="md:col-span-2">
                  <p class="mb-3 meta-label">檢核確認</p>
                  <div class="flex flex-col gap-4 border border-gray-200 bg-slate-50 p-5">
                    <div class="flex flex-wrap items-center gap-2 font-medium text-gray-800">
                      <span class="rounded bg-red-100 px-2 py-1 text-sm text-red-700">{{ scan.review.stageLabel || checklistStageName(scan.review.stage) }}</span>
                      <AppIcon name="arrow-right" class="h-4 w-4 text-gray-600" />
                      <span class="rounded bg-blue-100 px-2 py-1 text-sm text-blue-700">{{ scan.review.nextStageLabel || '完成' }}</span>
                    </div>
                    <dl class="grid gap-4 text-sm text-slate-600 md:grid-cols-2">
                      <div>
                        <dt class="meta-label">活動</dt>
                        <dd>{{ scan.review.reservation?.event || '—' }}</dd>
                      </div>
                      <div>
                        <dt class="meta-label">交車點資訊</dt>
                        <dd>{{ scan.review.reservation?.store || '—' }}</dd>
                      </div>
                      <div>
                        <dt class="meta-label">會員</dt>
                        <dd>{{ scan.review.reservation?.username || scan.review.reservation?.email || scan.review.reservation?.user_id || '—' }}</dd>
                      </div>
                      <div>
                        <dt class="meta-label">檢核狀態</dt>
                        <dd class="flex flex-wrap items-center gap-2">
                          <span v-if="scan.review.checklistReady" class="font-medium text-green-600">已完成</span>
                          <span v-else class="font-medium text-red-600">尚未完成</span>
                          <span class="text-gray-600">（照片 {{ scan.review.checklist?.photoCount || 0 }} 張）</span>
                        </dd>
                      </div>
                    </dl>
                    <div>
                      <h4 class="text-base font-medium text-slate-900">{{ scan.review.checklist?.title || checklistStageName(scan.review.stage) }}</h4>
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
                        class="group relative overflow-hidden border border-slate-300 bg-white transition focus:outline-none focus:ring-2 focus:ring-primary/40 hover:border-primary"
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
          <div class="relative w-full max-w-4xl overflow-hidden border border-white/20 bg-black/80">
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
              <div v-if="imagePreview.title" class="font-medium">{{ imagePreview.title }}</div>
              <div v-if="imagePreview.subtitle" class="mt-1 text-sm text-gray-300">{{ imagePreview.subtitle }}</div>
              <div v-if="imagePreview.meta?.uploadedAt || imagePreview.meta?.originalName" class="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-300">
                <span v-if="imagePreview.meta?.uploadedAt">上傳：{{ imagePreview.meta.uploadedAt }}</span>
                <span v-if="imagePreview.meta?.originalName" class="truncate">原檔名：{{ imagePreview.meta.originalName }}</span>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <a
                  v-if="imagePreview.downloadUrl"
                  :href="imagePreview.downloadUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-outline btn-sm text-sm"
                >
                  新分頁開啟
                </a>
                <button class="btn btn-primary btn-sm text-sm" type="button" @click="closeImagePreview">關閉預覽</button>
              </div>
            </div>
          </div>
        </div>
      </transition>

      <!-- 服務檔期預覽 -->
      <transition name="backdrop-fade">
        <div
          v-if="eventPreview.visible && eventPreviewEvent"
          class="fixed inset-0 z-98 flex items-center justify-center bg-black/60 px-4 py-8"
          @click.self="closeEventPreview"
        >
          <div class="event-preview-modal w-full max-w-5xl overflow-hidden border border-gray-200 bg-white" role="dialog" aria-modal="true" aria-label="服務檔期預覽">
            <div class="event-preview-modal__header">
              <div>
                <h3 class="event-preview-modal__heading">{{ eventPreviewEvent.title || eventPreviewEvent.name || '未命名服務檔期' }}</h3>
              </div>
              <button class="btn-ghost" title="關閉" @click="closeEventPreview" type="button">
                <AppIcon name="x" class="h-5 w-5" />
              </button>
            </div>
            <div class="event-preview-modal__body">
              <section class="event-preview-hero">
                <img :src="eventPreviewCover" :alt="eventPreviewEvent.title || eventPreviewEvent.name || '服務檔期封面'" @error="(ev)=>ev.target.src='/logo.png'" />
                <div class="event-preview-hero__shade"></div>
                <div class="event-preview-hero__content">
                  <h2>{{ eventPreviewEvent.title || eventPreviewEvent.name || '未命名服務檔期' }}</h2>
                  <p v-if="eventPreviewSchedule">📅 {{ eventPreviewSchedule }}</p>
                </div>
              </section>

              <section class="event-preview-section">
                <div class="flex flex-wrap gap-2">
                  <span class="badge" :class="listingStatusBadgeClass(eventPreviewEvent.listing_status)">{{ listingStatusLabel(eventPreviewEvent.listing_status) }}</span>
                  <span v-if="eventIsExclusive(eventPreviewEvent)" class="text-sm text-gray-600">獨佔服務</span>
                </div>
                <div class="event-preview-meta-grid">
                  <div class="event-preview-meta-card">
                    <AppIcon name="orders" class="h-4 w-4 text-primary" />
                    <span>報名截止</span>
                    <strong>{{ eventPreviewDeadline || '未設定' }}</strong>
                  </div>
                  <div class="event-preview-meta-card">
                    <AppIcon name="map-pin" class="h-4 w-4 text-primary" />
                    <span>活動地點</span>
                    <strong>{{ eventPreviewEvent.location || '未設定' }}</strong>
                  </div>
                </div>
                <p v-if="eventPreviewEvent.description" class="event-preview-description">{{ eventPreviewEvent.description }}</p>
                <p v-else class="event-preview-description text-gray-500">尚未填寫活動描述。</p>
                <ul v-if="eventPreviewRules.length" class="event-preview-rules">
                  <li v-for="rule in eventPreviewRules" :key="rule">{{ rule }}</li>
                </ul>
                <p v-if="normalizeListingStatus(eventPreviewEvent.listing_status) === LISTING_STATUS_DRAFT" class="event-preview-draft-note">
                  此服務檔期目前為暫存狀態；這裡會用後台資料預覽發布後會員看到的預約頁，不會出現在前台列表。
                </p>
              </section>

              <section class="event-preview-section">
                <div class="event-preview-section__heading">
                  <div>
                    <h4><AppIcon name="store" class="h-5 w-5 text-primary" /> 交車點選擇</h4>
                    <p>會員會在這裡選擇交車點、查看價目並調整購買或票券抵扣數量。</p>
                  </div>
                </div>

                <div v-if="eventPreview.loading" class="event-preview-empty">交車點資訊載入中…</div>
                <div v-else-if="eventPreview.error" class="event-preview-empty event-preview-empty--error">{{ eventPreview.error }}</div>
                <div v-else-if="!eventPreviewStores.length" class="event-preview-empty">目前尚無可用交車點資訊。</div>
                <div v-else class="event-preview-store-list">
                  <article v-for="store in eventPreviewStores" :key="`event-preview-store-${store.id}`" class="event-preview-store">
                    <div class="event-preview-store__header">
                      <div>
                        <h5>{{ store.name || `交車點 #${store.id}` }}</h5>
                        <p>{{ storeCapacityDisplay(store) }}</p>
                      </div>
                      <button class="btn btn-outline btn-sm" type="button" disabled>
                        <AppIcon name="info" class="h-4 w-4" /> 交車點資訊
                      </button>
                    </div>
                    <div v-if="eventPreviewStorePriceEntries(store).length" class="event-preview-price-grid">
                      <div v-for="item in eventPreviewStorePriceEntries(store)" :key="`${store.id}-${item.type}`" class="event-preview-price-card">
                        <p>{{ item.type }}</p>
                        <strong>{{ priceStageText(item) }}</strong>
                        <span v-if="priceEarlyWindowText(item)">{{ priceEarlyWindowText(item) }}</span>
                        <span>{{ productLabel(item) }}</span>
                        <div class="event-preview-quantity-row">
                          <span>立即買票並預約</span>
                          <em>0</em>
                        </div>
                        <div class="event-preview-quantity-row">
                          <span>使用票券抵扣</span>
                          <em>0</em>
                        </div>
                      </div>
                    </div>
                    <div v-else class="event-preview-empty">此交車點尚未設定價格。</div>
                  </article>
                </div>
              </section>

              <section class="event-preview-section event-preview-confirm">
                <h4>加值服務與確認</h4>
                <label><input type="checkbox" disabled /> 加購包材 100 元/份</label>
                <label><input type="checkbox" disabled /> 我已了解未妥善包裝之貨物不予託運</label>
                <label><input type="checkbox" disabled /> 我已詳閱購買須知與使用規定</label>
              </section>
            </div>
            <div class="event-preview-modal__footer">
              <div class="text-sm text-gray-600">
                <span v-if="eventPreviewCanOpenFrontend">此檔期已發布，可開啟實際前台頁面比對。</span>
                <span v-else>暫存檔期只能在後台預覽，發布後才會開放前台連結。</span>
              </div>
              <div class="flex flex-wrap gap-2">
                <a
                  v-if="eventPreviewCanOpenFrontend"
                  class="btn btn-outline btn-sm"
                  :href="eventPreviewFrontPath"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <AppIcon name="link" class="h-4 w-4" /> 開啟前台頁面
                </a>
                <button class="btn btn-primary btn-sm" type="button" @click="closeEventPreview">關閉預覽</button>
              </div>
            </div>
          </div>
        </div>
      </transition>

      <!-- 商品預覽 -->
      <transition name="backdrop-fade">
        <div
          v-if="productPreview.visible && productPreviewProduct"
          class="fixed inset-0 z-98 flex items-center justify-center bg-black/60 px-4 py-8"
          @click.self="closeProductPreview"
        >
          <div class="product-preview-modal relative w-full max-w-2xl overflow-hidden border border-gray-200 bg-white" role="dialog" aria-modal="true" aria-label="商品預覽">
            <button
              class="btn-ghost absolute right-3 top-3 z-10 bg-white/90 text-gray-600 hover:text-gray-900"
              title="關閉"
              @click="closeProductPreview"
              type="button"
            >
              <AppIcon name="x" class="h-5 w-5" />
            </button>
            <div class="product-preview-modal__grid">
              <div class="product-preview-modal__media">
                <img
                  :src="productCoverUrl(productPreviewProduct)"
                  :alt="productPreviewProduct.name || '商品封面'"
                  @error="(ev)=>ev.target.src='/logo.png'"
                />
              </div>
              <div class="product-preview-modal__body">
                <div class="flex flex-wrap gap-2">
                  <span class="badge" :class="listingStatusBadgeClass(productPreviewProduct.listing_status)">{{ listingStatusLabel(productPreviewProduct.listing_status) }}</span>
                </div>
                <div>
                  <p v-if="productPreviewProduct.code" class="product-preview-modal__code">#{{ productPreviewProduct.code }}</p>
                  <h3 class="product-preview-modal__title">{{ productPreviewProduct.name || '未命名商品' }}</h3>
                </div>
                <p class="product-preview-modal__description">
                  {{ productPreviewProduct.description || '尚未填寫描述' }}
                </p>
                <div class="product-preview-modal__price">{{ formatCurrency(productPreviewProduct.price) }}</div>
                <p
                  v-if="normalizeListingStatus(productPreviewProduct.listing_status) === LISTING_STATUS_DRAFT"
                  class="product-preview-modal__draft-note"
                >
                  此商品目前為暫存狀態，只會在後台服務檔期與商品管理中預覽，不會出現在前台票券商店。
                </p>
                <div class="product-preview-modal__actions">
                  <button class="btn btn-outline btn-sm" type="button" @click="copyToClipboard(productPreviewProduct.code || productPreviewProduct.id)">
                    <AppIcon name="copy" class="h-4 w-4" /> 複製編號
                  </button>
                  <button class="btn btn-primary btn-sm" type="button" @click="closeProductPreview">關閉預覽</button>
                </div>
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
            <h2 class="ui-title font-medium">商品列表</h2>
            <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-600">
              <span>共 {{ productStats.total }} 項</span>
              <span v-if="productStats.published">發布 {{ productStats.published }}</span>
              <span v-if="productStats.draft">暫存 {{ productStats.draft }}</span>
              <span v-if="productStats.missingDesc">需補描述 {{ productStats.missingDesc }}</span>
              <span v-if="productStats.total">平均 {{ formatCurrency(productStats.avgPrice) }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap w-full md:w-auto">
            <div class="relative w-full md:w-64">
              <AppIcon name="search" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
              <input v-model.trim="productQuery" placeholder="搜尋名稱/編號/描述" class="border px-3 py-2 text-sm w-full rounded-md pl-9 focus:border-primary focus:ring-2 focus:ring-primary/20" />
              <button v-if="productQuery" class="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-gray-600 hover:text-gray-800" @click="productQuery=''">清除</button>
            </div>
            <select v-model="productSort" class="border px-2 py-2 text-sm rounded-md focus:border-primary focus:ring-1 focus:ring-primary/30 w-full sm:w-auto">
              <option value="recent">最新在前</option>
              <option value="name">名稱 A → Z</option>
              <option value="price-desc">價格：高到低</option>
              <option value="price-asc">價格：低到高</option>
            </select>
            <button class="btn btn-primary text-sm w-full sm:w-auto" @click="showProductForm = true"><AppIcon name="plus" class="h-4 w-4" /> 新增商品</button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 mb-3">
          <button
            class="px-3 py-1 text-sm border rounded-lg transition"
            :class="productFilters.onlyFree ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary hover:text-primary'"
            @click="toggleProductFilter('onlyFree')"
          >
            只看免費項目
          </button>
          <button
            class="px-3 py-1 text-sm border rounded-lg transition"
            :class="productFilters.onlyMissingDesc ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary hover:text-primary'"
            @click="toggleProductFilter('onlyMissingDesc')"
          >
            需要描述
          </button>
          <button
            v-if="hasProductFilters"
            class="px-3 py-1 text-sm border border-gray-200 rounded-lg text-gray-600 hover:border-primary hover:text-primary"
            @click="resetProductFilters"
          >
            清除篩選
          </button>
        </div>
        <div v-if="productsLoading || loading" class="text-gray-600">載入中…</div>
        <div v-else>
          <div v-if="products.length===0" class="text-gray-600">沒有資料</div>
          <div v-else-if="!filteredProducts.length" class="text-gray-600">沒有符合搜尋或篩選的商品，請調整條件。</div>
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <AppCard v-for="p in filteredProducts" :key="p.id || p.name" :cover-src="productCoverUrl(p)">
              <div class="flex flex-col gap-2">
              <!-- View mode -->
              <template v-if="!p._editing">
                <div class="flex items-start justify-between gap-2">
                  <div class="font-medium text-primary">{{ p.name }}</div>
                  <span class="badge" :class="listingStatusBadgeClass(p.listing_status)">{{ listingStatusLabel(p.listing_status) }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
                  <span v-if="p.code" class="font-mono flex items-center gap-1">#{{ p.code }}
                    <button class="btn-ghost" title="複製" @click.stop="copyToClipboard(p.code)"><AppIcon name="copy" class="h-4 w-4" /></button>
                  </span>
                  <span v-if="!(p.description || '').trim()" class="text-amber-700">需補描述</span>
                </div>
                <div class="text-gray-600 text-sm min-h-[2.5rem] whitespace-pre-line">
                  <span v-if="p.description && p.description.trim()">{{ p.description }}</span>
                  <span v-else class="text-gray-600 italic">尚未填寫描述</span>
                </div>
                <div class="money-value mt-1 text-lg text-gray-900">{{ formatCurrency(p.price) }}</div>
                <div class="mt-2 flex flex-wrap gap-2 items-center">
                  <button class="btn btn-outline text-sm" @click="startEditProduct(p)"><AppIcon name="edit" class="h-4 w-4" /> 編輯</button>
                  <button class="btn btn-outline text-sm" @click="openProductPreview(p, '商品列表')"><AppIcon name="info" class="h-4 w-4" /> 預覽</button>
                  <button class="btn btn-outline text-sm" @click="deleteProduct(p)" :disabled="loading"><AppIcon name="trash" class="h-4 w-4" /> 刪除</button>
                  <input :id="`upload-product-${p.id || encodeURIComponent(p.name || '')}`" type="file" accept="image/*" class="hidden" @change="(ev)=>changeProductCover(ev, p)" />
                  <button class="btn btn-outline text-sm" @click="triggerProductCoverInput(p)"><AppIcon name="image" class="h-4 w-4" /> 上傳封面</button>
                  <button class="btn btn-outline text-sm" @click="deleteProductCover(p)"><AppIcon name="trash" class="h-4 w-4" /> 刪除封面</button>
                </div>
              </template>
              <!-- Edit mode -->
              <template v-else>
                <input v-model.trim="p._editing.name" placeholder="名稱" class="border px-2 py-1" />
                <input v-model.number="p._editing.price" type="number" min="0" step="1" placeholder="價格" class="border px-2 py-1" />
                <select v-model="p._editing.listing_status" class="border px-2 py-1">
                  <option v-for="status in listingStatusOptions" :key="`product-edit-${status.value}`" :value="status.value">{{ status.label }}</option>
                </select>
                <textarea v-model.trim="p._editing.description" rows="3" placeholder="描述" class="border px-2 py-1"></textarea>
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
          <h2 class="ui-title font-medium">活動列表</h2>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <input v-model.trim="eventQuery" placeholder="搜尋標題/代碼/地點" class="border px-2 py-2 text-sm w-full md:w-64" />
            <button class="btn btn-outline text-sm w-full sm:w-auto" @click="performEventSearch" :disabled="eventsLoading"><AppIcon name="refresh" class="h-4 w-4" /> 重新整理</button>
            <button v-if="hasEventFilters" class="btn btn-outline text-sm w-full sm:w-auto" @click="clearEventFilters" :disabled="eventsLoading">
              <AppIcon name="x" class="h-4 w-4" /> 清除篩選
            </button>
            <button v-if="canCreateEvents" class="btn btn-primary text-sm w-full sm:w-auto" @click="openCreateEventForm"><AppIcon name="plus" class="h-4 w-4" /> 新增活動</button>
          </div>
        </div>
        <Teleport to="body">
          <transition name="backdrop-fade">
            <div v-if="showEventForm && canCreateEvents" class="admin-drawer" :class="{ 'admin-drawer--mobile': isMobileViewport }" @click.self="cancelEventForm">
              <transition :name="drawerTransitionName">
                <div class="admin-drawer__panel" role="dialog" aria-modal="true">
                  <div class="admin-drawer__header">
                    <h3 class="ui-title text-lg font-medium text-gray-900">{{ isEditingEvent ? '編輯活動' : '新增活動' }}</h3>
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
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm text-gray-600">
                          <span v-if="eventSchedulePreview">時程 {{ eventSchedulePreview }}</span>
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
                        <div class="font-medium">請先修正以下欄位：</div>
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
                            <label class="admin-field">
                              <span>上架狀態</span>
                              <select v-model="newEvent.listing_status">
                                <option v-for="status in listingStatusOptions" :key="`event-form-${status.value}`" :value="status.value">{{ status.label }}</option>
                              </select>
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
                        <section class="admin-form__card">
                          <header class="admin-form__card-header">
                            <h4>服務權限</h4>
                            <p>限制此場次可提供服務的服務商、交車點與司機。</p>
                          </header>
                          <label class="admin-field">
                            <span>獨佔服務</span>
                            <div class="flex items-start gap-3 rounded-lg border border-gray-300 bg-white px-3 py-3">
                              <input v-model="newEvent.is_exclusive" type="checkbox" class="mt-1 h-4 w-4" />
                              <div class="min-w-0 text-sm leading-relaxed text-gray-700">
                                <p class="font-medium text-gray-900">只有建立此場次的服務商可以提供服務</p>
                                <p>啟用後，其他服務商不可綁定交車點，也不可設定旗下司機；前台只會顯示建立服務商自己的交車點。</p>
                              </div>
                            </div>
                          </label>
                        </section>
                      </div>
                    </div>
                    <div class="admin-card__footer admin-drawer__footer">
                      <p class="admin-card__note">儲存後可於方案管理區進一步設定價目與交車點資訊。</p>
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
        <AdminFilterSheet
          v-model="tableFilters.events"
          :columns="eventTableColumns"
          title="活動欄位篩選"
          class="mb-3"
          @apply="applyServerFilterSheet('events', $event)"
        />
        <div v-if="eventsLoading" class="text-gray-600">載入中…</div>
        <div v-else>
          <div v-if="events.length===0" class="text-gray-600">沒有資料</div>
          <div v-else-if="filteredEvents.length===0" class="text-gray-600">沒有符合篩選的活動</div>
          <div v-else>
            <!-- Mobile: Cards -->
            <div class="grid grid-cols-1 gap-3 md:hidden">
	              <AppCard v-for="e in filteredEvents" :key="e.id" :cover-src="e.cover || `${API}/events/${e.id}/cover`">
	                <div class="flex items-start justify-between gap-3 mb-2">
	                  <div>
	                    <div class="font-medium text-primary">{{ e.name || e.title }}</div>
	                    <div class="mt-1 flex flex-wrap gap-1">
	                      <span class="badge" :class="listingStatusBadgeClass(e.listing_status)">{{ listingStatusLabel(e.listing_status) }}</span>
	                      <span v-if="eventIsExclusive(e)" class="text-sm text-gray-600">獨佔</span>
	                    </div>
                  </div>
                </div>
                <div class="text-sm text-gray-700">📅 {{ e.date || formatRange(e.starts_at, e.ends_at) }}</div>
                <div v-if="e.deadline || e.ends_at" class="text-sm text-gray-600 mt-1">截止：{{ formatDate(e.deadline || e.ends_at) }}</div>
                <div class="mt-3 grid grid-cols-2 gap-2">
                  <button v-if="canEditEvent(e)" class="btn btn-primary text-sm col-span-2" @click="startEditEvent(e)"><AppIcon name="edit" class="h-4 w-4" /> 編輯</button>
                  <button class="btn btn-outline text-sm" :class="{ 'col-span-2': !canEditEvent(e) }" @click="openEventPreview(e)"><AppIcon name="info" class="h-4 w-4" /> 預覽</button>
                  <button class="btn btn-outline text-sm" :class="{ 'col-span-2': !canEditEvent(e) }" @click="openStoreManager(e)"><AppIcon name="store" class="h-4 w-4" /> 店面</button>
                  <button v-if="canEditEvent(e)" class="btn btn-outline text-sm" @click="triggerEventCoverInput(e.id)"><AppIcon name="image" class="h-4 w-4" /> 上傳封面</button>
                  <input :id="`upload-event-${e.id}`" type="file" accept="image/*" class="hidden" @change="(ev)=>changeEventCover(ev, e)" />
                  <button v-if="canEditEvent(e)" class="btn btn-outline text-sm" @click="deleteEventCover(e)"><AppIcon name="trash" class="h-4 w-4" /> 刪除封面</button>
                  <button v-if="canEditEvent(e)" class="btn btn-outline text-sm text-red-600 border-red-200 hover:bg-red-50 col-span-2" @click="deleteEvent(e)"><AppIcon name="trash" class="h-4 w-4" /> 刪除活動</button>
                </div>
              </AppCard>
            </div>
            <!-- Desktop: Table -->
            <div class="overflow-x-auto hidden md:block">
            <table class="min-w-[720px] w-full text-sm table-default">
              <thead class="sticky top-0 z-10">
                <tr class="bg-gray-50 text-left">
                  <th class="px-3 py-2 border">
                    <TableColumnFilter mode="server" label="編號" :fields="eventTableColumns[0].fields" :model-value="tableFilters.events.id" @update:model-value="setTableFilter('events', 'id', $event)" @apply="applyServerTableFilter('events', 'id', $event)" />
                  </th>
                  <th class="px-3 py-2 border">
                    <TableColumnFilter mode="server" label="名稱" :fields="eventTableColumns[1].fields" :model-value="tableFilters.events.name" @update:model-value="setTableFilter('events', 'name', $event)" @apply="applyServerTableFilter('events', 'name', $event)" />
                  </th>
                  <th class="px-3 py-2 border">
                    <TableColumnFilter mode="server" label="日期/區間" :fields="eventTableColumns[2].fields" :model-value="tableFilters.events.date" @update:model-value="setTableFilter('events', 'date', $event)" @apply="applyServerTableFilter('events', 'date', $event)" />
                  </th>
                  <th class="px-3 py-2 border">
                    <TableColumnFilter mode="server" label="截止" :fields="eventTableColumns[3].fields" :model-value="tableFilters.events.deadline" @update:model-value="setTableFilter('events', 'deadline', $event)" @apply="applyServerTableFilter('events', 'deadline', $event)" />
                  </th>
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
	                        <div class="flex items-center gap-2 flex-wrap">
	                          <span>{{ e.name || e.title }}</span>
	                          <span class="badge" :class="listingStatusBadgeClass(e.listing_status)">{{ listingStatusLabel(e.listing_status) }}</span>
	                          <span v-if="eventIsExclusive(e)" class="text-sm text-gray-600">獨佔</span>
	                        </div>
                      </div>
                    </div>
                  </td>
                  <td class="px-3 py-2 border">{{ e.date || formatRange(e.starts_at, e.ends_at) }}</td>
                  <td class="px-3 py-2 border">{{ formatDate(e.deadline || e.ends_at) }}</td>
                  <td class="px-3 py-2 border">
                    <div class="flex items-center gap-2 flex-wrap">
                      <button v-if="canEditEvent(e)" class="btn btn-primary text-sm" @click="startEditEvent(e)"><AppIcon name="edit" class="h-4 w-4" /> 編輯</button>
                      <button class="btn btn-outline text-sm" @click="openEventPreview(e)"><AppIcon name="info" class="h-4 w-4" /> 預覽</button>
                      <button class="btn btn-outline text-sm" @click="openStoreManager(e)"><AppIcon name="store" class="h-4 w-4" /> 管理店面</button>
                      <input :id="`upload-${e.id}`" type="file" accept="image/*" class="hidden" @change="(ev)=>changeEventCover(ev, e)" />
                      <button v-if="canEditEvent(e)" class="btn btn-outline text-sm" @click="triggerEventCoverInput(e.id)"><AppIcon name="image" class="h-4 w-4" /> 上傳封面</button>
                      <button v-if="canEditEvent(e)" class="btn btn-outline text-sm" @click="deleteEventCover(e)"><AppIcon name="trash" class="h-4 w-4" /> 刪除封面</button>
                      <button v-if="canEditEvent(e)" class="btn btn-outline text-sm text-red-600 border-red-200 hover:bg-red-50" @click="deleteEvent(e)"><AppIcon name="trash" class="h-4 w-4" /> 刪除活動</button>
                       </div>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
            <AdminPagination
              :total="eventsMeta.total"
              :limit="eventsMeta.limit"
              :offset="eventsMeta.offset"
              :loading="eventsLoading"
              @change="loadEvents({ offset: $event.offset })"
            />
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
                      <h3 class="admin-card__title">{{ selectedEvent.name || selectedEvent.title }}（編號：{{ selectedEvent.id }}）</h3>
                      <p class="admin-card__subtitle">
                        <span v-if="storeManagerMode === 'list'">主畫面只保留摘要與已設定店面，新增與編輯移到二級頁面。</span>
                        <span v-else-if="storeManagerMode === 'create'">新增店面：選擇交車點帳號並設定此賽事價目。</span>
                        <span v-else>編輯店面：調整交車點與此賽事價目。</span>
                      </p>
                    </div>
                    <div class="admin-card__actions">
                      <button v-if="storeManagerMode !== 'list'" class="btn btn-outline btn-sm" @click="backToStoreList">
                        返回列表
                      </button>
                      <button class="btn-ghost" title="關閉" @click="closeStoreManager"><AppIcon name="x" class="h-5 w-5" /></button>
                    </div>
                  </div>
                  <div class="admin-card admin-card--form admin-store-panel__body admin-drawer__card">
                    <div class="admin-card__body admin-store-panel__body">
                      <div class="admin-store-panel__grid" :class="`admin-store-panel__grid--${storeManagerMode}`">
                        <div v-if="storeManagerMode === 'create'" class="admin-store-panel__form">
                          <div class="admin-form space-y-6">
                            <section class="admin-form__card">
                              <header class="admin-form__card-header">
                                <h4>新增店面</h4>
                                <p>選擇已核准綁定的交車點帳號，並設定此賽事的服務內容。</p>
                              </header>
                              <div class="admin-form__grid admin-form__grid--2">
	                                <label class="admin-field md:col-span-2">
	                                  <span>交車點帳號 *</span>
	                                  <select v-model="newStore.delivery_point_id">
	                                    <option value="">{{ deliveryPointSelectPlaceholder }}</option>
	                                    <option v-for="dp in deliveryPoints" :key="dp.id" :value="String(dp.id)">
	                                      {{ deliveryPointOptionLabel(dp) }}
	                                    </option>
	                                  </select>
	                                </label>
	                                <label class="admin-field">
	                                  <span>數量上限</span>
	                                  <input v-model.trim="newStore.capacity" type="number" min="1" step="1" placeholder="例：5，留空不限制" />
	                                </label>
	                              </div>
                              <div v-if="deliveryPointsLoading || deliveryPointsError || shouldShowDeliveryPointEmptyState" class="rounded-lg border px-3 py-3 text-sm space-y-2" :class="deliveryPointsError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'">
                                <p v-if="deliveryPointsLoading">交車點清單載入中…</p>
                                <p v-else-if="deliveryPointsError">{{ deliveryPointsError }}</p>
                                <template v-else-if="shouldShowDeliveryPointEmptyState">
                                  <p class="font-medium">目前沒有可選擇的交車點帳號。</p>
                                  <p v-if="isProviderSettingsRole()">請先到「設定 > 交車點綁定」核准交車點申請，或請管理員在總覽中強制核准。</p>
                                  <p v-else>請先建立交車點帳號，並確認帳號已啟用。</p>
                                </template>
                                <div class="flex flex-wrap gap-2">
                                  <button class="btn btn-outline btn-sm" @click="loadDeliveryPoints" :disabled="deliveryPointsLoading">重新載入交車點</button>
                                  <button v-if="isProviderSettingsRole()" class="btn btn-primary btn-sm" @click="openProviderBindingSettings">前往交車點綁定</button>
                                </div>
                              </div>
                              <div class="border-y border-gray-300 bg-transparent py-2 text-sm text-gray-600 space-y-1">
                                <p class="font-medium text-gray-700">綁定後會同步交車點主資料，價格由服務商在此設定；收款資訊未設定時使用平台匯款資訊</p>
                                <p v-if="!selectedNewStoreDeliveryPoint" class="text-gray-600">請先選擇交車點帳號。</p>
                                <template v-else>
	                                  <p class="text-gray-700">名稱：{{ selectedNewStoreDeliveryPoint.name || `交車點 #${selectedNewStoreDeliveryPoint.id}` }}</p>
	                                  <p v-for="line in deliveryPointPreviewLines(selectedNewStoreDeliveryPoint)" :key="`new-store-preview-${line}`">{{ line }}</p>
	                                  <p class="text-gray-700">本場次數量上限：{{ storeCapacityDisplay(newStore) }}</p>
	                                  <p v-for="(info, idx) in newStore.priceItems.filter(item => String(item.type || '').trim())" :key="`new-store-service-price-${idx}`" class="text-gray-700">{{ info.type }}｜{{ priceStageText(info) }}<span v-if="priceEarlyWindowText(info)">｜{{ priceEarlyWindowText(info) }}</span></p>
                                  <p v-if="!newStore.priceItems.some(item => String(item.type || '').trim())" class="text-amber-600">尚未設定此賽事的價格表。</p>
                                </template>
                              </div>
                              <div class="border rounded-lg bg-white p-3 space-y-3">
                                <div class="flex items-center justify-between gap-2 flex-wrap">
                                  <p class="text-sm font-medium text-gray-700">價格表（此賽事）</p>
                                  <button class="btn btn-outline btn-sm" @click="addPriceItem">+ 方案項目</button>
                                </div>
                                <div v-for="(it, idx) in newStore.priceItems" :key="`event-store-price-${idx}`" class="admin-store-pricing__row">
                                  <input v-model.trim="it.type" placeholder="方案項目" />
                                  <input type="number" min="0" v-model.number="it.normal" placeholder="原價" />
                                  <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" />
                                  <label class="admin-store-pricing__date">
                                    <span>早鳥開始 <span v-if="hasPriceValue(it.early)" class="text-red-500">*</span></span>
                                    <input type="datetime-local" v-model="it.early_start" :required="hasPriceValue(it.early)" />
                                  </label>
                                  <label class="admin-store-pricing__date">
                                    <span>早鳥結束</span>
                                    <input type="datetime-local" v-model="it.early_end" />
                                  </label>
                                  <div class="admin-store-pricing__product">
                                    <select v-model="it.productId" required>
                                      <option :value="UNBOUND_PRODUCT_OPTION">未綁定商品</option>
                                      <option v-if="readProductId(it) && !hasProductOption(it)" :value="String(readProductId(it))">
                                        {{ missingProductOptionLabel(it) }}
                                      </option>
                                      <option v-for="p in products" :key="p.id" :value="String(p.id)">
                                        {{ p.name }}（#{{ p.id }}）
                                      </option>
                                    </select>
                                    <button
                                      class="admin-store-pricing__preview"
                                      type="button"
                                      :disabled="!resolveProductForPreview(it)"
                                      :title="productPreviewButtonTitle(it)"
                                      :aria-label="productPreviewButtonTitle(it)"
                                      @click="openProductPreview(it, '服務檔期價目')"
                                    >
                                      <AppIcon name="info" class="h-4 w-4" />
                                    </button>
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
                        <div v-else-if="storeManagerMode === 'list'" class="admin-store-panel__list">
                          <section class="admin-form__card admin-store-list">
                            <header class="admin-form__card-header">
                              <div>
                                <h4>已設定店面（{{ eventStores.length }}）</h4>
                                <p>查看已綁定交車點服務；新增與編輯都在二級頁面完成。</p>
                              </div>
                              <div class="admin-card__actions">
                                <button class="btn btn-primary btn-sm" @click="openStoreCreatePanel"><AppIcon name="plus" class="h-4 w-4" /> 新增店面</button>
                                <button class="btn btn-outline btn-sm" @click="loadEventStores(selectedEvent.id)" :disabled="storeLoading"><AppIcon name="refresh" class="h-4 w-4" /> 重新載入</button>
                              </div>
                            </header>
                            <div class="admin-store-overview-grid">
                              <div class="admin-store-overview-card">
                                <span>已設定店面</span>
                                <strong>{{ eventStores.length }}</strong>
                              </div>
                              <div class="admin-store-overview-card">
                                <span>可用交車點</span>
                                <strong>{{ deliveryPoints.length }}</strong>
                              </div>
                            </div>
                            <div v-if="canManageEventDriverAssignment" class="admin-store-driver-panel">
                              <div class="admin-store-driver-panel__heading">
                                <div>
                                  <h5>司機安排</h5>
                                  <p>此賽事預設司機</p>
                                </div>
                                <button class="btn btn-outline btn-sm" @click="loadEventDriverAssignment(selectedEvent.id)" :disabled="eventDriverAssignment.loading || eventDriverAssignment.saving">
                                  <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                                </button>
                              </div>
                              <div class="admin-store-driver-panel__controls">
                                <label class="admin-field admin-store-driver-panel__select">
                                  <span>司機</span>
                                  <select v-model="eventDriverAssignment.driverId" :disabled="eventDriverAssignment.loading || eventDriverAssignment.saving || providerDriversLoading">
                                    <option value="">未指定</option>
                                    <option v-for="d in providerDrivers" :key="d.id" :value="String(d.id)">
                                      {{ d.username || d.email || d.id }}
                                    </option>
                                  </select>
                                </label>
                                <button class="btn btn-primary" @click="saveEventDriverAssignment" :disabled="eventDriverAssignment.loading || eventDriverAssignment.saving || providerDriversLoading">
                                  <span v-if="eventDriverAssignment.saving" class="btn-spinner mr-2"></span>
                                  儲存
                                </button>
                              </div>
                              <p v-if="eventDriverAssignment.loading || providerDriversLoading" class="admin-store-driver-panel__meta">載入中…</p>
                              <p v-else-if="eventDriverAssignment.error" class="admin-store-driver-panel__error">{{ eventDriverAssignment.error }}</p>
                              <p v-else-if="providerDriverError" class="admin-store-driver-panel__error">{{ providerDriverError }}</p>
                              <p v-else-if="!providerDrivers.length" class="admin-store-driver-panel__meta">尚未建立司機</p>
                              <p v-else-if="eventDriverAssignment.syncedReservations !== null" class="admin-store-driver-panel__meta">已同步 {{ eventDriverAssignment.syncedReservations }} 筆未指派預約</p>
                            </div>
                            <div v-if="storeLoading && !eventStores.length" class="admin-store-empty">載入中…</div>
                            <div v-else-if="!eventStores.length" class="admin-store-empty">尚未新增店面</div>
                            <div v-else class="admin-store-list__items">
                              <article v-for="s in eventStores" :key="s.id" class="admin-store-card" :class="{ 'admin-store-card--editing': s._editing }">
                                <template v-if="s._editing">
                                  <div class="admin-form__grid admin-form__grid--2">
	                                    <label class="admin-field md:col-span-2">
	                                      <span>交車點帳號 *</span>
	                                      <select v-model="s._editing.delivery_point_id">
	                                        <option value="">{{ deliveryPointSelectPlaceholder }}</option>
	                                        <option v-for="dp in deliveryPoints" :key="dp.id" :value="String(dp.id)">
	                                          {{ deliveryPointOptionLabel(dp) }}
	                                        </option>
	                                      </select>
	                                    </label>
	                                    <label class="admin-field">
	                                      <span>數量上限</span>
	                                      <input v-model.trim="s._editing.capacity" type="number" min="1" step="1" placeholder="例：5，留空不限制" />
	                                    </label>
	                                  </div>
                                  <div v-if="deliveryPointsLoading || deliveryPointsError || shouldShowDeliveryPointEmptyState" class="rounded-lg border px-3 py-3 text-sm space-y-2" :class="deliveryPointsError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'">
                                    <p v-if="deliveryPointsLoading">交車點清單載入中…</p>
                                    <p v-else-if="deliveryPointsError">{{ deliveryPointsError }}</p>
                                    <template v-else-if="shouldShowDeliveryPointEmptyState">
                                      <p class="font-medium">目前沒有可選擇的交車點帳號。</p>
                                      <p v-if="isProviderSettingsRole()">請先到「設定 > 交車點綁定」核准交車點申請，或請管理員在總覽中強制核准。</p>
                                      <p v-else>請先建立交車點帳號，並確認帳號已啟用。</p>
                                    </template>
                                    <div class="flex flex-wrap gap-2">
                                      <button class="btn btn-outline btn-sm" @click="loadDeliveryPoints" :disabled="deliveryPointsLoading">重新載入交車點</button>
                                      <button v-if="isProviderSettingsRole()" class="btn btn-primary btn-sm" @click="openProviderBindingSettings">前往交車點綁定</button>
                                    </div>
                                  </div>
                                  <div class="border-y border-gray-300 bg-transparent py-2 text-sm text-gray-600 space-y-1">
                                    <p class="font-medium text-gray-700">綁定後會同步交車點主資料，價格由服務商在此設定；收款資訊未設定時使用平台匯款資訊</p>
                                    <p v-if="!resolveEditingDeliveryPoint(s)" class="text-gray-600">請先選擇交車點帳號。</p>
                                    <template v-else>
	                                      <p class="text-gray-700">名稱：{{ resolveEditingDeliveryPoint(s)?.name || `交車點 #${resolveEditingDeliveryPoint(s)?.id || ''}` }}</p>
	                                      <p v-for="line in deliveryPointPreviewLines(resolveEditingDeliveryPoint(s))" :key="`edit-store-preview-${s.id}-${line}`">{{ line }}</p>
	                                      <p class="text-gray-700">本場次數量上限：{{ storeCapacityDisplay(s._editing) }}</p>
	                                      <p v-for="(info, idx) in s._editing.priceItems.filter(item => String(item.type || '').trim())" :key="`edit-store-service-price-${s.id}-${idx}`" class="text-gray-700">{{ info.type }}｜{{ priceStageText(info) }}<span v-if="priceEarlyWindowText(info)">｜{{ priceEarlyWindowText(info) }}</span></p>
                                      <p v-if="!s._editing.priceItems.some(item => String(item.type || '').trim())" class="text-amber-600">尚未設定此賽事的價格表。</p>
                                    </template>
                                  </div>
                                  <div class="border rounded-lg bg-white p-3 space-y-3">
                                    <div class="flex items-center justify-between gap-2 flex-wrap">
                                      <p class="text-sm font-medium text-gray-700">價格表（此賽事）</p>
                                      <button class="btn btn-outline btn-sm" @click="s._editing.priceItems.push(createPriceItem())">+ 方案項目</button>
                                    </div>
                                    <div v-for="(it, idx) in s._editing.priceItems" :key="`edit-event-store-price-${s.id}-${idx}`" class="admin-store-pricing__row">
                                      <input v-model.trim="it.type" placeholder="方案項目" />
                                      <input type="number" min="0" v-model.number="it.normal" placeholder="原價" />
                                      <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" />
                                      <label class="admin-store-pricing__date">
                                        <span>早鳥開始 <span v-if="hasPriceValue(it.early)" class="text-red-500">*</span></span>
                                        <input type="datetime-local" v-model="it.early_start" :required="hasPriceValue(it.early)" />
                                      </label>
                                      <label class="admin-store-pricing__date">
                                        <span>早鳥結束</span>
                                        <input type="datetime-local" v-model="it.early_end" />
                                      </label>
                                      <div class="admin-store-pricing__product">
                                        <select v-model="it.productId" required>
                                          <option :value="UNBOUND_PRODUCT_OPTION">未綁定商品</option>
                                          <option v-if="readProductId(it) && !hasProductOption(it)" :value="String(readProductId(it))">
                                            {{ missingProductOptionLabel(it) }}
                                          </option>
                                          <option v-for="p in products" :key="p.id" :value="String(p.id)">
                                            {{ p.name }}（#{{ p.id }}）
                                          </option>
                                        </select>
                                        <button
                                          class="admin-store-pricing__preview"
                                          type="button"
                                          :disabled="!resolveProductForPreview(it)"
                                          :title="productPreviewButtonTitle(it)"
                                          :aria-label="productPreviewButtonTitle(it)"
                                          @click="openProductPreview(it, '服務檔期價目')"
                                        >
                                          <AppIcon name="info" class="h-4 w-4" />
                                        </button>
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
                                      <p class="admin-store-card__meta">交車點：{{ deliveryPointOptionLabel(findDeliveryPointById(s.delivery_point_id) || { id: s.delivery_point_id, name: s.name }) }}</p>
	                                      <p v-if="s.address" class="admin-store-card__meta">地址：{{ s.address }}</p>
	                                      <p v-if="s.business_hours" class="admin-store-card__meta">營業時間：{{ s.business_hours }}</p>
	                                      <p class="admin-store-card__meta">數量上限：{{ storeCapacityDisplay(s) }}</p>
	                                      <p class="admin-store-card__meta">匯款設定：{{ storeRemittanceModeLabel(s) }}</p>
                                      <p v-if="normalizeHttpUrl(s.external_url)" class="admin-store-card__meta break-all">
                                        外部網址：
                                        <a :href="normalizeHttpUrl(s.external_url)" target="_blank" rel="noopener noreferrer" class="text-primary underline">{{ s.external_url }}</a>
                                      </p>
                                      <p v-for="line in remittanceDisplayLines(s.remittance)" :key="`${s.id}-${line}`" class="admin-store-card__meta">{{ line }}</p>
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
                                        <span>{{ priceStageText(info) }}</span>
                                        <span v-if="priceEarlyWindowText(info)">{{ priceEarlyWindowText(info) }}</span>
                                      </div>
                                    </div>
                                  </div>
                                </template>
                              </article>
                            </div>
                          </section>
                        </div>
                        <div v-else-if="storeManagerMode === 'edit' && editingStore" class="admin-store-panel__form">
                          <section class="admin-form__card">
                            <header class="admin-form__card-header">
                              <div>
                                <h4>編輯店面</h4>
                                <p>{{ editingStore.name || `店面 #${editingStore.id}` }} 的交車點與此賽事價目。</p>
                              </div>
                              <button class="btn btn-outline btn-sm" @click="cancelEditStore(editingStore)" :disabled="storeLoading">取消編輯</button>
                            </header>
                            <div class="admin-form__grid admin-form__grid--2">
	                              <label class="admin-field md:col-span-2">
	                                <span>交車點帳號 *</span>
	                                <select v-model="editingStore._editing.delivery_point_id">
	                                  <option value="">{{ deliveryPointSelectPlaceholder }}</option>
	                                  <option v-for="dp in deliveryPoints" :key="dp.id" :value="String(dp.id)">
	                                    {{ deliveryPointOptionLabel(dp) }}
	                                  </option>
	                                </select>
	                              </label>
	                              <label class="admin-field">
	                                <span>數量上限</span>
	                                <input v-model.trim="editingStore._editing.capacity" type="number" min="1" step="1" placeholder="例：5，留空不限制" />
	                              </label>
	                            </div>
                            <div v-if="deliveryPointsLoading || deliveryPointsError || shouldShowDeliveryPointEmptyState" class="rounded-lg border px-3 py-3 text-sm space-y-2" :class="deliveryPointsError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'">
                              <p v-if="deliveryPointsLoading">交車點清單載入中…</p>
                              <p v-else-if="deliveryPointsError">{{ deliveryPointsError }}</p>
                              <template v-else-if="shouldShowDeliveryPointEmptyState">
                                <p class="font-medium">目前沒有可選擇的交車點帳號。</p>
                                <p v-if="isProviderSettingsRole()">請先到「設定 > 交車點綁定」核准交車點申請，或請管理員在總覽中強制核准。</p>
                                <p v-else>請先建立交車點帳號，並確認帳號已啟用。</p>
                              </template>
                              <div class="flex flex-wrap gap-2">
                                <button class="btn btn-outline btn-sm" @click="loadDeliveryPoints" :disabled="deliveryPointsLoading">重新載入交車點</button>
                                <button v-if="isProviderSettingsRole()" class="btn btn-primary btn-sm" @click="openProviderBindingSettings">前往交車點綁定</button>
                              </div>
                            </div>
                            <div class="border-y border-gray-300 bg-transparent py-2 text-sm text-gray-600 space-y-1">
                              <p class="font-medium text-gray-700">綁定後會同步交車點主資料，價格由服務商在此設定；收款資訊未設定時使用平台匯款資訊</p>
                              <p v-if="!resolveEditingDeliveryPoint(editingStore)" class="text-gray-600">請先選擇交車點帳號。</p>
                              <template v-else>
	                                <p class="text-gray-700">名稱：{{ resolveEditingDeliveryPoint(editingStore)?.name || `交車點 #${resolveEditingDeliveryPoint(editingStore)?.id || ''}` }}</p>
	                                <p v-for="line in deliveryPointPreviewLines(resolveEditingDeliveryPoint(editingStore))" :key="`edit-store-preview-${editingStore.id}-${line}`">{{ line }}</p>
	                                <p class="text-gray-700">本場次數量上限：{{ storeCapacityDisplay(editingStore._editing) }}</p>
	                                <p v-for="(info, idx) in editingStore._editing.priceItems.filter(item => String(item.type || '').trim())" :key="`edit-store-service-price-${editingStore.id}-${idx}`" class="text-gray-700">{{ info.type }}｜{{ priceStageText(info) }}<span v-if="priceEarlyWindowText(info)">｜{{ priceEarlyWindowText(info) }}</span></p>
                                <p v-if="!editingStore._editing.priceItems.some(item => String(item.type || '').trim())" class="text-amber-600">尚未設定此賽事的價格表。</p>
                              </template>
                            </div>
                            <div class="border rounded-lg bg-white p-3 space-y-3">
                              <div class="flex items-center justify-between gap-2 flex-wrap">
                                <p class="text-sm font-medium text-gray-700">價格表（此賽事）</p>
                                <button class="btn btn-outline btn-sm" @click="editingStore._editing.priceItems.push(createPriceItem())">+ 方案項目</button>
                              </div>
                              <div v-for="(it, idx) in editingStore._editing.priceItems" :key="`edit-event-store-price-${editingStore.id}-${idx}`" class="admin-store-pricing__row">
                                <input v-model.trim="it.type" placeholder="方案項目" />
                                <input type="number" min="0" v-model.number="it.normal" placeholder="原價" />
                                <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" />
                                <label class="admin-store-pricing__date">
                                  <span>早鳥開始 <span v-if="hasPriceValue(it.early)" class="text-red-500">*</span></span>
                                  <input type="datetime-local" v-model="it.early_start" :required="hasPriceValue(it.early)" />
                                </label>
                                <label class="admin-store-pricing__date">
                                  <span>早鳥結束</span>
                                  <input type="datetime-local" v-model="it.early_end" />
                                </label>
                                <div class="admin-store-pricing__product">
                                  <select v-model="it.productId" required>
                                    <option :value="UNBOUND_PRODUCT_OPTION">未綁定商品</option>
                                    <option v-if="readProductId(it) && !hasProductOption(it)" :value="String(readProductId(it))">
                                      {{ missingProductOptionLabel(it) }}
                                    </option>
                                    <option v-for="p in products" :key="p.id" :value="String(p.id)">
                                      {{ p.name }}（#{{ p.id }}）
                                    </option>
                                  </select>
                                  <button
                                    class="admin-store-pricing__preview"
                                    type="button"
                                    :disabled="!resolveProductForPreview(it)"
                                    :title="productPreviewButtonTitle(it)"
                                    :aria-label="productPreviewButtonTitle(it)"
                                    @click="openProductPreview(it, '服務檔期價目')"
                                  >
                                    <AppIcon name="info" class="h-4 w-4" />
                                  </button>
                                  <button class="admin-store-pricing__remove" v-if="editingStore._editing.priceItems.length > 1" @click="editingStore._editing.priceItems.splice(idx,1)">
                                    <AppIcon name="trash" class="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div class="pt-6 admin-card__actions admin-store-panel__actions">
                              <button class="btn btn-primary" @click="saveEditStore(editingStore)" :disabled="storeLoading">
                                <span v-if="storeLoading" class="btn-spinner mr-2"></span>
                                儲存變更
                              </button>
                              <button class="btn btn-outline" @click="cancelEditStore(editingStore)" :disabled="storeLoading">取消</button>
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
        <div class="mb-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="font-medium text-gray-900">訂單分類</p>
            <p class="mt-1 text-sm text-gray-600">一般服務訂單與課程訂單分開管理，保留各自的付款、發券與編輯流程。</p>
          </div>
          <div class="flex min-w-max gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1" role="tablist" aria-label="訂單分類">
            <button
              v-for="option in orderCategoryOptions"
              :key="`order-category-${option.key}`"
              type="button"
              class="min-h-[40px] rounded-md px-4 py-2 text-sm font-medium transition"
              :class="orderCategory === option.key ? 'bg-white text-primary shadow-sm' : 'text-gray-600 hover:text-primary'"
              role="tab"
              :aria-selected="orderCategory === option.key"
              @click="setOrderCategory(option.key)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <CourseAdminPanel v-if="orderCategory === 'course'" mode="orders" />
        <AppCard v-else>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
          <h2 class="ui-title font-medium">訂單狀態管理</h2>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <input v-model.trim="orderQuery" placeholder="搜尋代碼、姓名、電子信箱、末五碼、票種或狀態" class="border px-2 py-2 text-sm w-full sm:w-72" />
            <button class="btn btn-outline text-sm w-full sm:w-auto" @click="performOrderSearch" :disabled="ordersLoading"><AppIcon name="refresh" class="h-4 w-4" /> 重新整理</button>
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
            :class="orderStatusFilter === item.key ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary hover:text-primary'"
            @click="setOrderStatusFilter(item.key)"
          >
            {{ item.label }}
            <span class="ml-1 text-sm text-gray-600">({{ item.count }})</span>
          </button>
        </div>
        <div class="mb-3 border border-gray-300 bg-white px-3 py-3">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="text-sm text-gray-700">
              <span class="font-medium">批量修改</span>
              <span class="ml-2">{{ selectedOrderCount ? `已選 ${selectedOrderCount} 筆訂單` : '勾選訂單後可一次修改狀態' }}</span>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button class="btn btn-outline btn-sm" @click="toggleVisibleOrderSelection(!allVisibleOrdersSelected)" :disabled="ordersLoading || ordersBulkSaving || filteredAdminOrders.length === 0">
                {{ allVisibleOrdersSelected ? '取消全選' : '全選目前列表' }}
              </button>
              <select v-model="orderBulkStatus" class="border px-2 py-1 text-sm w-full sm:w-auto" :disabled="ordersLoading || ordersBulkSaving">
                <option value="">選擇狀態</option>
                <option v-for="s in orderPaymentStatuses" :key="`bulk-order-status-${s}`" :value="s">{{ s }}</option>
              </select>
              <button class="btn btn-primary btn-sm" @click="saveSelectedOrderStatuses" :disabled="ordersLoading || ordersBulkSaving || selectedOrderCount === 0 || !orderBulkStatus">
                {{ ordersBulkSaving ? '更新中…' : '批量儲存' }}
              </button>
              <button v-if="selectedOrderCount" class="btn btn-outline btn-sm" @click="clearOrderSelection" :disabled="ordersLoading || ordersBulkSaving">清除選取</button>
            </div>
          </div>
        </div>
        <AdminFilterSheet
          v-model="tableFilters.orders"
          :columns="orderTableColumns"
          title="訂單欄位篩選"
          class="mb-3"
          @apply="applyServerFilterSheet('orders', $event)"
        />
        <div v-if="ordersLoading" class="text-gray-600">載入中…</div>
        <div v-else>
          <div v-if="adminOrders.length===0" class="text-gray-600">沒有資料</div>
          <div v-else-if="filteredAdminOrders.length===0" class="text-gray-600">沒有符合篩選的訂單</div>
          <!-- Mobile: Cards -->
          <div v-else class="grid grid-cols-1 gap-3 md:hidden">
            <div v-for="o in filteredAdminOrders" :key="o.id" class="border p-3 bg-white">
              <div class="flex items-start justify-between gap-3 mb-2">
                <div class="flex items-start gap-3 min-w-0">
                  <input type="checkbox" class="mt-1 h-4 w-4" :checked="isOrderSelected(o)" :disabled="ordersBulkSaving || o.saving" :aria-label="`選取訂單 ${o.code || o.id}`" @change="toggleOrderSelection(o, $event.target.checked)" />
                  <div class="min-w-0">
                  <div class="font-medium">訂單 #{{ o.id }} <span v-if="o.code" class="font-mono text-sm">({{ o.code }})</span></div>
                  <div class="text-sm text-gray-600">訂單時間：{{ o.createdAt || '-' }}</div>
                  <div class="text-sm text-gray-600">使用者：{{ o.username }}（{{ o.email }}）</div>
                  <div v-if="o.userRole === 'ADMIN' || o.isVip" class="mt-1 flex flex-wrap gap-1.5">
                    <span v-if="o.userRole === 'ADMIN'" class="inline-flex rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">管理員</span>
                    <span v-if="o.isVip" class="inline-flex rounded-full border border-amber-300 bg-black px-2 py-0.5 text-xs font-semibold tracking-[0.12em] text-amber-200">VIP</span>
                  </div>
                  <div v-if="o.phone" class="text-sm text-gray-600 mt-0.5">手機：{{ o.phone }}</div>
                  <div v-if="o.remittanceLast5" class="text-sm text-gray-600">帳戶後五碼：{{ o.remittanceLast5 }}</div>
                  <template v-if="o.isReservation">
                    <div class="text-sm text-gray-600">服務檔期：{{ o.eventName || '-' }}</div>
                    <div class="text-sm text-gray-600" v-if="o.eventDate">時間：{{ o.eventDate }}</div>
                  </template>
                  <template v-else>
                    <div class="text-sm text-gray-600">票券：{{ o.ticketType || '-' }}</div>
                    <div class="text-sm text-gray-600">數量：{{ o.quantity || 0 }}｜總額：{{ formatCurrency(o.total || 0) }}</div>
                  </template>
                  </div>
                </div>
                <span class="badge">{{ o.status }}</span>
              </div>
                <div v-if="o.isReservation" class="space-y-2 text-sm text-gray-600">
                <div class="border border-gray-200 divide-y">
                  <div v-for="line in o.selections" :key="line.key" class="p-2">
                    <div class="font-medium text-gray-700">{{ line.store || '—' }}｜{{ line.type || '—' }}</div>
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
                  <div v-for="item in o.addOns || []" :key="`order-addon-card-${o.id}-${item.key}`">加購項目：{{ item.label }} x {{ item.quantity }}（{{ formatCurrency(item.amount) }}）</div>
                  <div v-if="o.addOnCost > 0">加購費用：{{ formatCurrency(o.addOnCost) }}</div>
                  <div class="money-value text-gray-800">總計：{{ formatCurrency(o.total) }}</div>
                </div>
              </div>
                <div v-if="o.hasRemittance" class="mt-2 bg-red-50/80 border border-primary/30 p-2 text-sm text-gray-700 space-y-1">
                <div class="font-medium text-primary">匯款資訊</div>
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
                  <option v-for="s in getOrderStatusOptions(o)" :key="s" :value="s">{{ s }}</option>
                </select>
                <button class="btn btn-primary btn-sm" @click="saveOrderStatus(o)" :disabled="o.saving || ordersBulkSaving">儲存</button>
                <button v-if="o.status === ORDER_STATUS_PAID" class="btn btn-outline btn-sm sm:col-span-2" @click="openOrderEditor(o)" :disabled="o.saving || ordersBulkSaving">
                  <AppIcon name="edit" class="h-4 w-4" /> 修改訂單內容
                </button>
              </div>
            </div>
          </div>
          <!-- Desktop: Table -->
          <div v-if="filteredAdminOrders.length" class="overflow-x-auto hidden md:block">
            <table class="min-w-[860px] w-full text-sm table-default">
              <thead class="sticky top-0 z-10">
                <tr class="bg-gray-50 text-left">
                  <th class="px-3 py-2 border w-10">
                    <input type="checkbox" class="h-4 w-4" :checked="allVisibleOrdersSelected" :disabled="ordersBulkSaving || filteredAdminOrders.length === 0" aria-label="全選目前列表訂單" @change="toggleVisibleOrderSelection($event.target.checked)" />
                  </th>
                  <th class="px-3 py-2 border">
                    <TableColumnFilter mode="server" label="編號" :fields="orderTableColumns[0].fields" :model-value="tableFilters.orders.id" @update:model-value="setTableFilter('orders', 'id', $event)" @apply="applyServerTableFilter('orders', 'id', $event)" />
                  </th>
                  <th class="px-3 py-2 border">
                    <TableColumnFilter mode="server" label="代碼" :fields="orderTableColumns[1].fields" :model-value="tableFilters.orders.code" @update:model-value="setTableFilter('orders', 'code', $event)" @apply="applyServerTableFilter('orders', 'code', $event)" />
                  </th>
                  <th class="px-3 py-2 border">
                    <TableColumnFilter mode="server" label="訂單時間" :fields="orderTableColumns[2].fields" :model-value="tableFilters.orders.createdAt" @update:model-value="setTableFilter('orders', 'createdAt', $event)" @apply="applyServerTableFilter('orders', 'createdAt', $event)" />
                  </th>
                  <th class="px-3 py-2 border">
                    <TableColumnFilter mode="server" label="使用者" :fields="orderTableColumns[3].fields" :model-value="tableFilters.orders.user" @update:model-value="setTableFilter('orders', 'user', $event)" @apply="applyServerTableFilter('orders', 'user', $event)" />
                  </th>
                  <th class="px-3 py-2 border">
                    <TableColumnFilter mode="server" label="內容" :fields="orderTableColumns[4].fields" :model-value="tableFilters.orders.content" @update:model-value="setTableFilter('orders', 'content', $event)" @apply="applyServerTableFilter('orders', 'content', $event)" />
                  </th>
                  <th class="px-3 py-2 border">
                    <TableColumnFilter mode="server" label="狀態" :fields="orderTableColumns[5].fields" :model-value="tableFilters.orders.status" @update:model-value="setTableFilter('orders', 'status', $event)" @apply="applyServerTableFilter('orders', 'status', $event)" />
                  </th>
                  <th class="px-3 py-2 border">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="o in filteredAdminOrders" :key="o.id">
                  <td class="px-3 py-2 border">
                    <input type="checkbox" class="h-4 w-4" :checked="isOrderSelected(o)" :disabled="ordersBulkSaving || o.saving" :aria-label="`選取訂單 ${o.code || o.id}`" @change="toggleOrderSelection(o, $event.target.checked)" />
                  </td>
                  <td class="px-3 py-2 border">{{ o.id }}</td>
                  <td class="px-3 py-2 border font-mono">{{ o.code || '-' }}</td>
                  <td class="px-3 py-2 border whitespace-nowrap">{{ o.createdAt || '-' }}</td>
                  <td class="px-3 py-2 border">
                    <div>{{ o.username }}</div>
                    <div class="text-sm text-gray-600">{{ o.email }}</div>
                    <div v-if="o.userRole === 'ADMIN' || o.isVip" class="mt-1 flex flex-wrap gap-1.5">
                      <span v-if="o.userRole === 'ADMIN'" class="inline-flex rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">管理員</span>
                      <span v-if="o.isVip" class="inline-flex rounded-full border border-amber-300 bg-black px-2 py-0.5 text-xs font-semibold tracking-[0.12em] text-amber-200">VIP</span>
                    </div>
                    <div v-if="o.phone" class="text-sm text-gray-600 mt-1">手機：{{ o.phone }}</div>
                    <div v-if="o.remittanceLast5" class="text-sm text-gray-600">帳戶後五碼：{{ o.remittanceLast5 }}</div>
                  </td>
                  <td class="px-3 py-2 border">
                    <template v-if="o.isReservation">
                      <div><strong>服務檔期：</strong>{{ o.eventName || '-' }}</div>
                      <div v-if="o.eventDate"><strong>時間：</strong>{{ o.eventDate }}</div>
                      <table class="w-full text-sm text-gray-600 mt-2 border border-gray-200">
                        <thead class="bg-gray-50">
                          <tr>
                            <th class="px-2 py-1 border">交車點資訊</th>
                            <th class="px-2 py-1 border">方案項目</th>
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
                      <div class="text-sm text-gray-600 mt-2 space-y-1">
                        <div>總件數：{{ o.quantity || 0 }}</div>
                        <div v-if="o.subtotal !== undefined">小計：{{ formatCurrency(o.subtotal) }}</div>
                        <div v-if="o.discountTotal > 0">優惠折扣：-{{ formatCurrency(o.discountTotal) }}</div>
                        <div v-for="item in o.addOns || []" :key="`order-addon-table-${o.id}-${item.key}`">加購項目：{{ item.label }} x {{ item.quantity }}（{{ formatCurrency(item.amount) }}）</div>
                        <div v-if="o.addOnCost > 0">加購費用：{{ formatCurrency(o.addOnCost) }}</div>
                        <div class="money-value text-gray-800">總計：{{ formatCurrency(o.total) }}</div>
                      </div>
                    </template>
                    <template v-else>
                      <div>票券：{{ o.ticketType || '-' }}</div>
                      <div>數量：{{ o.quantity || 0 }}</div>
                      <div>總額：{{ formatCurrency(o.total) }}</div>
                    </template>
                    <div v-if="o.hasRemittance" class="mt-2 bg-red-50/70 border border-primary/40 px-2 py-2 text-sm text-gray-700 space-y-1">
                      <div class="font-medium text-primary">匯款資訊</div>
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
                      <option v-for="s in getOrderStatusOptions(o)" :key="s" :value="s">{{ s }}</option>
                    </select>
                  </td>
	                  <td class="px-3 py-2 border">
	                    <div class="flex flex-col sm:flex-row gap-2">
	                      <button class="btn btn-primary btn-sm w-full sm:w-auto" @click="saveOrderStatus(o)" :disabled="o.saving || ordersBulkSaving">儲存</button>
	                      <button v-if="o.status === ORDER_STATUS_PAID" class="btn btn-outline btn-sm w-full sm:w-auto" @click="openOrderEditor(o)" :disabled="o.saving || ordersBulkSaving">
	                        <AppIcon name="edit" class="h-4 w-4" /> 修改內容
	                      </button>
	                    </div>
	                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <AdminPagination
            :total="adminOrdersMeta.total"
            :limit="adminOrdersMeta.limit"
            :offset="adminOrdersMeta.offset"
            :loading="ordersLoading"
            @change="loadOrders({ offset: $event.offset })"
          />
        </div>
        </AppCard>
      </section>

      <Teleport to="body">
        <transition name="fade">
          <div v-if="orderEditor.visible" class="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-6" @click.self="closeOrderEditor">
            <div class="w-full max-w-2xl overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-label="修改訂單內容">
              <div class="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                <div>
                  <h3 class="text-lg font-semibold text-gray-900">修改訂單內容</h3>
                  <p class="mt-1 text-sm text-gray-600">
                    訂單 {{ orderEditor.order?.code || `#${orderEditor.order?.id || ''}` }}
                    <span v-if="orderEditor.order?.status">・{{ orderEditor.order.status }}</span>
                  </p>
                </div>
                <button class="btn-ghost" type="button" aria-label="關閉" :disabled="orderEditor.saving" @click="closeOrderEditor">
                  <AppIcon name="x" class="h-5 w-5" />
                </button>
              </div>

              <div class="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-5">
                <div class="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                  儲存後會同步更新付款後已建立的票券或預約，並寄送 Email 通知 {{ orderEditor.order?.email || '用戶' }}。
                </div>

                <template v-if="orderEditor.order?.isReservation">
                  <div class="space-y-3">
                    <div v-for="(line, index) in orderEditor.selections" :key="line.key || index" class="rounded-lg border border-gray-200 p-3">
                      <div class="font-medium text-gray-800">{{ line.store || '交車點' }}｜{{ line.type || '服務項目' }}</div>
                      <div class="mt-1 text-sm text-gray-600">
                        {{ line.byTicket ? '票券抵扣' : `單價 ${formatCurrency(line.unitPrice)}` }}
                      </div>
                      <label class="mt-3 block text-sm font-medium text-gray-700" :for="`managed-order-selection-${index}`">數量</label>
                      <input
                        :id="`managed-order-selection-${index}`"
                        v-model.number="line.qty"
                        type="number"
                        min="1"
                        max="99"
                        step="1"
                        class="mt-1 w-full border px-3 py-2"
                        :disabled="orderEditor.saving || (line.byTicket && orderEditor.order?.status === ORDER_STATUS_PAID)"
                      />
                      <p v-if="line.byTicket && orderEditor.order?.status === ORDER_STATUS_PAID" class="mt-1 text-xs text-amber-700">此項已使用票券抵扣，付款後不可調整數量。</p>
                    </div>
                  </div>

                  <div class="rounded-lg border border-gray-200 p-3">
                    <label class="flex items-center gap-2 text-sm font-medium text-gray-800">
                      <input
                        v-model="orderEditor.material"
                        type="checkbox"
                        :disabled="orderEditor.saving"
                        @change="orderEditor.materialCount = orderEditor.material ? Math.max(1, Number(orderEditor.materialCount || 0)) : 0"
                      />
                      加購包材（每件 NT$ 100）
                    </label>
                    <div v-if="orderEditor.material" class="mt-3">
                      <label class="block text-sm text-gray-700" for="managed-order-material-count">包材數量</label>
                      <input id="managed-order-material-count" v-model.number="orderEditor.materialCount" type="number" min="1" max="99" step="1" class="mt-1 w-full border px-3 py-2" :disabled="orderEditor.saving" />
                    </div>
                  </div>
                </template>

                <template v-else>
                  <div>
                    <label class="block text-sm font-medium text-gray-700" for="managed-order-product">票券商品</label>
                    <select id="managed-order-product" v-model="orderEditor.productId" class="mt-1 w-full border px-3 py-2" :disabled="orderEditor.saving">
                      <option value="" disabled>選擇商品</option>
                      <option
                        v-if="orderEditor.productId && !orderEditorProducts.some(item => Number(item.id) === Number(orderEditor.productId))"
                        :value="orderEditor.productId"
                      >
                        {{ orderEditor.order?.ticketType || `商品 #${orderEditor.productId}` }}
                      </option>
                      <option v-for="product in orderEditorProducts" :key="`managed-order-product-${product.id}`" :value="String(product.id)">
                        {{ product.name }}（{{ formatCurrency(product.price) }}）
                      </option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700" for="managed-order-ticket-quantity">票券數量</label>
                    <input id="managed-order-ticket-quantity" v-model.number="orderEditor.quantity" type="number" min="1" max="99" step="1" class="mt-1 w-full border px-3 py-2" :disabled="orderEditor.saving" />
                  </div>
                </template>

                <div class="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                  <span class="text-sm text-gray-600">更新後預估總額</span>
                  <span class="money-value text-lg text-gray-900">{{ formatCurrency(orderEditorEstimatedTotal) }}</span>
                </div>
              </div>

              <div class="flex flex-col-reverse gap-2 border-t border-gray-200 bg-gray-50 px-5 py-4 sm:flex-row sm:justify-end">
                <button type="button" class="btn btn-outline" :disabled="orderEditor.saving" @click="closeOrderEditor">取消</button>
                <button type="button" class="btn btn-primary" :disabled="orderEditor.saving" @click="saveOrderDetails">
                  <span v-if="orderEditor.saving" class="btn-spinner mr-2"></span>
                  {{ orderEditor.saving ? '更新並通知中…' : '儲存並寄送 Email' }}
                </button>
              </div>
            </div>
          </div>
        </transition>
      </Teleport>

      <!-- Settings -->
      <section v-if="tab==='settings'" class="admin-section slide-up">
        <AppCard>
          <div class="mb-4">
            <h2 class="ui-title font-medium">{{ settingsPanelTitle }}</h2>
            <p class="text-sm text-gray-600">{{ settingsPanelDescription }}</p>
          </div>
          <div class="mb-4 flex flex-wrap items-center gap-2 border-b border-gray-200 pb-2">
            <button
              v-for="s in settingsTabs"
              :key="s.key"
              class="px-4 py-2 text-sm font-medium rounded transition"
              :class="settingsTab === s.key ? 'bg-primary text-white' : 'text-gray-600 hover:text-primary hover:bg-gray-100'"
              @click="setSettingsTab(s.key)"
            >
              {{ s.label }}
            </button>
          </div>
          <div v-if="settingsTab === 'provider-contact'" class="space-y-4">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div class="text-sm text-gray-600">服務商聯絡資訊</div>
                <p class="text-sm text-gray-600">前台若顯示服務商電話，會使用這裡設定的號碼。</p>
              </div>
              <div class="flex items-center gap-2">
                <button class="btn btn-outline btn-sm" @click="loadProviderContactSettings" :disabled="providerContactLoading || providerContactSaving">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                </button>
                <button class="btn btn-primary btn-sm" @click="saveProviderContactSettings" :disabled="providerContactSaving || !providerContactDirty">
                  {{ providerContactSaving ? '儲存中…' : '儲存設定' }}
                </button>
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label class="text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">電話號碼</span>
                <input
                  v-model="providerContactForm.phone"
                  @input="onProviderContactPhoneInput"
                  inputmode="tel"
                  maxlength="20"
                  autocomplete="tel"
                  class="border px-3 py-2 w-full"
                  placeholder="例：0912-345678"
                  :disabled="providerContactSaving"
                />
              </label>
              <div class="text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">服務商帳號</span>
                <div class="border px-3 py-2 w-full bg-gray-50 text-gray-700 min-h-[42px]">
                  {{ selfProviderAccountLabel }}
                </div>
              </div>
            </div>
            <p v-if="providerContactLoading" class="text-sm text-gray-600">聯絡資訊載入中…</p>
          </div>
          <div v-else-if="settingsTab === 'delivery-point'" class="space-y-4">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="text-sm text-gray-600">交車點主資料</div>
              <div class="flex items-center gap-2">
                <button class="btn btn-outline btn-sm" @click="loadDeliveryPointProfile" :disabled="deliveryPointProfileLoading || deliveryPointProfileSaving">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                </button>
                <button class="btn btn-primary btn-sm" @click="saveDeliveryPointProfile" :disabled="deliveryPointProfileSaving || !deliveryPointProfileDirty">
                  {{ deliveryPointProfileSaving ? '儲存中…' : '儲存設定' }}
                </button>
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label class="text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">交車點名稱</span>
                <input v-model.trim="deliveryPointProfileForm.name" class="border px-3 py-2 w-full" placeholder="例：台北交車點" :disabled="deliveryPointProfileSaving" />
              </label>
              <label class="text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">地址</span>
                <input v-model.trim="deliveryPointProfileForm.address" class="border px-3 py-2 w-full" placeholder="例：台北市信義區松仁路 100 號" :disabled="deliveryPointProfileSaving" />
              </label>
              <label class="text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">電話</span>
                <input v-model.trim="deliveryPointProfileForm.phone" maxlength="20" autocomplete="tel" class="border px-3 py-2 w-full" placeholder="例：0912-345678" :disabled="deliveryPointProfileSaving" />
              </label>
              <label class="text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">收容數量</span>
                <input v-model.trim="deliveryPointProfileForm.capacity" type="number" min="1" step="1" class="border px-3 py-2 w-full" placeholder="留空代表不限制" :disabled="deliveryPointProfileSaving" />
              </label>
              <label class="md:col-span-2 text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">外部網址</span>
                <input v-model.trim="deliveryPointProfileForm.external_url" class="border px-3 py-2 w-full" placeholder="客服頁或說明連結" :disabled="deliveryPointProfileSaving" />
              </label>
              <label class="md:col-span-2 text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">營業時間</span>
                <textarea v-model="deliveryPointProfileForm.business_hours" rows="3" class="border px-3 py-2 w-full" placeholder="例：週一至週五 10:00-20:00" :disabled="deliveryPointProfileSaving"></textarea>
              </label>
            </div>
            <p v-if="deliveryPointProfileLoading" class="text-sm text-gray-600">交車點資訊載入中…</p>
            <div class="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-800">
              服務賽事由服務商統一設定；收款資訊以服務商設定為主，未設定時使用平台匯款資訊。交車點可主動向多個服務商送出綁定申請，待對方核准後，服務商即可把活動服務綁到此交車點；交車點本身只需維護資料並處理任務。
            </div>
            <div class="border-y border-gray-300 py-4 bg-transparent space-y-4">
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 class="text-sm font-medium text-gray-800">服務商綁定申請</h3>
                  <p class="text-sm text-gray-600">可同時綁定多個服務商；每個申請都需由服務商核准後才會生效。</p>
                </div>
                <button class="btn btn-outline btn-sm" @click="loadDeliveryPointProviderBindings" :disabled="deliveryPointProviderBindingsLoading || deliveryPointProviderBindingSaving">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                </button>
              </div>
              <div v-if="deliveryPointProviderBindingsLoading && !deliveryPointProviderBindings.length" class="text-sm text-gray-600">綁定資料載入中…</div>
              <div v-else-if="!deliveryPointProviderBindings.length" class="text-sm text-gray-600">目前尚未綁定任何服務商，也沒有待審核申請。</div>
              <div v-else class="space-y-2">
                <article v-for="item in deliveryPointProviderBindings" :key="`delivery-point-binding-${item.id}`" class="border-y border-gray-300 py-3 bg-transparent flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div class="font-medium text-gray-800">{{ item.provider?.username || item.provider?.email || item.provider_user_id }}</div>
                    <div class="text-sm text-gray-600">{{ item.provider?.email || '未提供電子信箱' }}</div>
                    <div class="text-sm text-gray-600 font-mono">服務商編號：{{ item.provider_user_id }}</div>
                    <div class="text-sm text-gray-600">申請時間：{{ formatDate(item.requested_at) }}</div>
                    <div v-if="item.responded_at" class="text-sm text-gray-600">審核時間：{{ formatDate(item.responded_at) }}</div>
                  </div>
                  <div class="flex items-center gap-2 flex-wrap justify-end">
                    <span class="badge" :class="providerBindingStatusClass(item)">{{ providerBindingStatusLabel(item) }}</span>
                    <span v-if="shouldShowProviderBindingRawStatus(item)" class="text-sm text-orange-700 font-mono">原始狀態：{{ providerBindingRawStatus(item) }}</span>
                    <button v-if="isProviderBindingStatus(item, 'PENDING')" class="btn btn-outline btn-sm" @click="cancelDeliveryPointProviderBinding(item)" :disabled="deliveryPointProviderBindingSaving">取消申請</button>
                    <button v-else-if="isProviderBindingStatus(item, 'APPROVED')" class="btn btn-outline btn-sm" @click="removeDeliveryPointProviderBinding(item)" :disabled="deliveryPointProviderBindingSaving">解除綁定</button>
                  </div>
                </article>
              </div>
              <div class="border-t border-gray-200 pt-4 space-y-3">
                <div class="flex flex-col md:flex-row gap-2">
                  <input v-model.trim="deliveryPointProviderQuery" class="border px-3 py-2 w-full" placeholder="搜尋服務商名稱、電子信箱或編號" @keyup.enter="searchDeliveryPointProviders" />
                  <button class="btn btn-primary btn-sm md:self-start" @click="searchDeliveryPointProviders" :disabled="deliveryPointProviderSearchLoading || deliveryPointProviderBindingSaving">
                    {{ deliveryPointProviderSearchLoading ? '搜尋中…' : '搜尋服務商' }}
                  </button>
                </div>
                <div v-if="deliveryPointProviderSearchLoading" class="text-sm text-gray-600">搜尋服務商中…</div>
                <div v-else-if="deliveryPointProviderQuery.trim() && !deliveryPointProviderOptions.length" class="text-sm text-gray-600">查無符合的服務商。</div>
                <div v-else-if="deliveryPointProviderOptions.length" class="space-y-2">
                  <article v-for="provider in deliveryPointProviderOptions" :key="`provider-search-${provider.id}`" class="border-y border-gray-300 py-3 bg-transparent flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div class="font-medium text-gray-800">{{ provider.username || provider.email || provider.id }}</div>
                      <div class="text-sm text-gray-600">{{ provider.email || '未提供電子信箱' }}</div>
                      <div v-if="provider.role" class="text-sm text-gray-600">角色：{{ roleLabel(provider.role) }}</div>
                      <div class="text-sm text-gray-600 font-mono">{{ provider.id }}</div>
                    </div>
                    <div class="flex items-center gap-2">
                      <span v-if="deliveryPointProviderBindingMap[provider.id]" class="badge" :class="providerBindingStatusClass(deliveryPointProviderBindingMap[provider.id])">
                        {{ providerBindingStatusLabel(deliveryPointProviderBindingMap[provider.id]) }}
                      </span>
                      <button class="btn btn-primary btn-sm" @click="requestDeliveryPointProviderBinding(provider)" :disabled="deliveryPointProviderBindingSaving || !!deliveryPointProviderBindingMap[provider.id] && ['PENDING','APPROVED'].includes(providerBindingStatusValue(deliveryPointProviderBindingMap[provider.id]))">
                        {{ deliveryPointProviderBindingMap[provider.id] && ['REJECTED','CANCELLED','REMOVED'].includes(providerBindingStatusValue(deliveryPointProviderBindingMap[provider.id])) ? '重新申請' : '送出申請' }}
                      </button>
                    </div>
                  </article>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="settingsTab === 'delivery-point-bindings'" class="space-y-4">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div class="text-sm text-gray-600">交車點綁定申請</div>
                <p class="text-sm text-gray-600">核准後，對應交車點就會出現在你的活動交車點清單中。</p>
                <p v-if="selfUserId" class="text-sm text-gray-600 mt-1">目前登入服務商：{{ selfProviderAccountLabel }}，編號：<span class="font-mono">{{ selfUserId }}</span></p>
              </div>
              <button class="btn btn-outline btn-sm" @click="loadProviderDeliveryPointBindings" :disabled="providerDeliveryPointBindingsLoading || providerDeliveryPointBindingSaving">
                <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
              </button>
            </div>
            <div class="flex flex-col md:flex-row gap-2 md:items-center">
              <select v-model="providerDeliveryPointBindingStatus" class="border px-3 py-2 w-full md:w-52" @change="loadProviderDeliveryPointBindings">
                <option value="PENDING">待審核</option>
                <option value="APPROVED">已核准</option>
                <option value="REJECTED">已拒絕</option>
                <option value="CANCELLED">已取消</option>
                <option value="REMOVED">已解除</option>
                <option value="ALL">全部狀態</option>
              </select>
              <p class="text-sm text-gray-600">目前顯示：{{ providerDeliveryPointBindingStatus === 'ALL' ? '全部狀態' : providerBindingStatusLabel(providerDeliveryPointBindingStatus) }}</p>
            </div>
            <div v-if="providerDeliveryPointBindingsError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
              {{ providerDeliveryPointBindingsError }}
            </div>
            <div v-if="providerDeliveryPointBindingsHint" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              {{ providerDeliveryPointBindingsHint }}
            </div>
            <div v-if="providerDeliveryPointBindingsLoading && !providerDeliveryPointBindings.length" class="text-sm text-gray-600">綁定申請載入中…</div>
            <div v-else-if="!providerDeliveryPointBindings.length" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800 space-y-2">
              <p>{{ providerDeliveryPointBindingStatus === 'PENDING' ? '目前沒有待審核的交車點綁定申請。' : '目前沒有符合此狀態的交車點綁定資料。' }}</p>
              <p v-if="providerDeliveryPointBindingStatus === 'PENDING' && selfUserId">請確認交車點送出申請時選的是目前登入服務商 ID：<span class="font-mono">{{ selfUserId }}</span>。</p>
              <div class="flex flex-wrap items-center gap-2">
                <button v-if="providerDeliveryPointBindingStatus === 'PENDING'" class="btn btn-outline btn-sm" @click="showAllProviderDeliveryPointBindings" :disabled="providerDeliveryPointBindingsLoading">查看全部狀態</button>
                <button class="btn btn-outline btn-sm" @click="loadProviderDeliveryPointBindings" :disabled="providerDeliveryPointBindingsLoading">重新載入</button>
              </div>
            </div>
            <div v-else class="space-y-3">
              <article v-for="item in providerDeliveryPointBindings" :key="`provider-binding-${item.id}`" class="border-y border-gray-300 py-4 bg-transparent space-y-3">
                <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div>
                    <div class="font-medium text-gray-900">{{ item.delivery_point?.name || `交車點 #${item.delivery_point_id}` }}</div>
                    <div class="text-sm text-gray-600">帳號：{{ item.delivery_point?.owner_username || item.delivery_point?.owner_email || item.delivery_point?.owner_user_id || '未綁定使用者' }}</div>
                    <div v-if="item.delivery_point?.address" class="text-sm text-gray-600">地址：{{ item.delivery_point.address }}</div>
                    <div class="text-sm text-gray-600">申請時間：{{ formatDate(item.requested_at) }}</div>
                    <div v-if="item.responded_at" class="text-sm text-gray-600">審核時間：{{ formatDate(item.responded_at) }}</div>
                  </div>
                  <span class="badge" :class="providerBindingStatusClass(item)">{{ providerBindingStatusLabel(item) }}</span>
                </div>
                <div v-if="shouldShowProviderBindingRawStatus(item)" class="text-sm text-orange-700 font-mono">原始狀態：{{ providerBindingRawStatus(item) }}</div>
                <div v-if="isProviderBindingStatus(item, 'PENDING')" class="flex flex-wrap items-center gap-2">
                  <button class="btn btn-primary btn-sm" @click="reviewProviderDeliveryPointBinding(item, 'APPROVED')" :disabled="providerDeliveryPointBindingSaving">核准</button>
                  <button class="btn btn-outline btn-sm" @click="reviewProviderDeliveryPointBinding(item, 'REJECTED')" :disabled="providerDeliveryPointBindingSaving">拒絕</button>
                </div>
              </article>
            </div>
          </div>
          <div v-else-if="settingsTab === 'delivery-point-bindings-overview'" class="space-y-4">
            <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <div class="text-sm text-gray-600">交車點綁定總覽</div>
                <p class="text-sm text-gray-600">查看所有交車點與服務商的待審核、已核准、已拒絕、已取消與已解除關係。</p>
              </div>
              <button class="btn btn-outline btn-sm" @click="loadAdminDeliveryPointBindings" :disabled="adminDeliveryPointBindingsLoading || adminDeliveryPointBindingSaving">
                <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
              </button>
            </div>
            <div class="flex flex-col md:flex-row gap-2">
              <input v-model.trim="adminDeliveryPointBindingQuery" class="border px-3 py-2 w-full" placeholder="搜尋交車點 / 交車點帳號 / 服務商" @keyup.enter="loadAdminDeliveryPointBindings" />
              <select v-model="adminDeliveryPointBindingStatus" class="border px-3 py-2 w-full md:w-48">
                <option value="ALL">全部狀態</option>
                <option value="PENDING">待審核</option>
                <option value="APPROVED">已核准</option>
                <option value="REJECTED">已拒絕</option>
                <option value="CANCELLED">已取消</option>
                <option value="REMOVED">已解除</option>
              </select>
              <button class="btn btn-primary btn-sm md:self-start" @click="loadAdminDeliveryPointBindings" :disabled="adminDeliveryPointBindingsLoading || adminDeliveryPointBindingSaving">
                {{ adminDeliveryPointBindingsLoading ? '查詢中…' : '查詢' }}
              </button>
            </div>
            <div v-if="adminDeliveryPointBindingsLoading && !adminDeliveryPointBindings.length" class="text-sm text-gray-600">綁定關係載入中…</div>
            <div v-else-if="!adminDeliveryPointBindings.length" class="text-sm text-gray-600">目前沒有符合條件的綁定關係。</div>
            <div v-else class="space-y-3">
              <article v-for="item in adminDeliveryPointBindings" :key="`admin-binding-${item.id}`" class="border-y border-gray-300 py-4 bg-transparent space-y-2">
                <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div class="space-y-1">
                    <div class="font-medium text-gray-900">{{ item.delivery_point?.name || `交車點 #${item.delivery_point_id}` }}</div>
                    <div class="text-sm text-gray-600">交車點帳號：{{ item.delivery_point?.owner_username || item.delivery_point?.owner_email || item.delivery_point?.owner_user_id || '未綁定使用者' }}</div>
                    <div class="text-sm text-gray-600">服務商：{{ item.provider?.username || item.provider?.email || item.provider_user_id }}</div>
                    <div class="text-sm text-gray-600">服務商電子信箱：{{ item.provider?.email || '未提供電子信箱' }}</div>
                  </div>
                  <span class="badge" :class="providerBindingStatusClass(item)">{{ providerBindingStatusLabel(item) }}</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-600">
                  <div>申請時間：{{ formatDate(item.requested_at) }}</div>
                  <div v-if="item.responded_at">審核時間：{{ formatDate(item.responded_at) }}</div>
                  <div v-if="item.delivery_point?.address">地址：{{ item.delivery_point.address }}</div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button v-if="!isProviderBindingStatus(item, 'APPROVED')" class="btn btn-primary btn-sm" @click="forceAdminDeliveryPointBinding(item, 'APPROVE')" :disabled="adminDeliveryPointBindingSaving">強制核准</button>
                  <button v-if="isProviderBindingStatus(item, 'APPROVED')" class="btn btn-outline btn-sm" @click="forceAdminDeliveryPointBinding(item, 'REMOVE')" :disabled="adminDeliveryPointBindingSaving">強制解除</button>
                </div>
              </article>
            </div>
          </div>
          <div v-else-if="settingsTab === 'remittance'" class="space-y-4">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="text-sm text-gray-600">{{ remittanceSectionTitle }}</div>
              <div class="flex items-center gap-2">
                <button class="btn btn-outline btn-sm" @click="loadRemittanceSettings" :disabled="remittanceLoading || remittanceSaving">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                </button>
                <button class="btn btn-primary btn-sm" @click="saveRemittanceSettings" :disabled="remittanceSaving || !remittanceDirty">
                  {{ remittanceSaving ? '儲存中…' : '儲存設定' }}
                </button>
              </div>
            </div>
            <p v-if="remittanceHelperText" class="text-sm text-gray-600">{{ remittanceHelperText }}</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label class="md:col-span-2 text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">匯款說明</span>
                <textarea v-model="remittanceForm.info" rows="3" class="border px-3 py-2 w-full" placeholder="例：請於三日內完成匯款" :disabled="remittanceSaving"></textarea>
              </label>
              <label class="text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">銀行名稱</span>
                <input v-model.trim="remittanceForm.bankName" class="border px-3 py-2 w-full" placeholder="例：臺灣銀行" :disabled="remittanceSaving" />
              </label>
              <label class="text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">銀行代碼</span>
                <input v-model.trim="remittanceForm.bankCode" class="border px-3 py-2 w-full" placeholder="例：123" :disabled="remittanceSaving" />
              </label>
              <label class="text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">銀行帳號</span>
                <input v-model.trim="remittanceForm.bankAccount" class="border px-3 py-2 w-full" placeholder="例：1234567890" :disabled="remittanceSaving" />
              </label>
              <label class="text-sm text-gray-600 space-y-1">
                <span class="font-medium text-gray-700">帳戶名稱</span>
                <input v-model.trim="remittanceForm.accountName" class="border px-3 py-2 w-full" placeholder="例：王小明" :disabled="remittanceSaving" />
              </label>
            </div>
            <p v-if="remittanceLoading" class="text-sm text-gray-600">匯款資訊載入中…</p>
          </div>
          <div v-else-if="settingsTab === 'legal-terms'" class="space-y-4">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div class="text-sm text-gray-600">服務商條款內容</div>
                <p class="text-sm text-gray-600">此內容會顯示在頁尾「服務商條款」的公開彙整頁。</p>
              </div>
              <div class="flex items-center gap-2">
                <button class="btn btn-outline btn-sm" @click="loadProviderLegalTerms" :disabled="providerLegalTermsLoading || providerLegalTermsSaving">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                </button>
                <button class="btn btn-primary btn-sm" @click="saveProviderLegalTerms" :disabled="providerLegalTermsSaving || !providerLegalTermsDirty">
                  {{ providerLegalTermsSaving ? '儲存中…' : '儲存條款' }}
                </button>
              </div>
            </div>
            <label class="text-sm text-gray-600 space-y-1 block">
              <span class="font-medium text-gray-700">條款內容</span>
              <textarea v-model="providerLegalTermsForm.content" rows="14" class="border px-3 py-2 w-full" placeholder="請輸入純文字條款內容，換行會保留" :disabled="providerLegalTermsSaving"></textarea>
              <span class="text-xs text-gray-500">留空時不會出現在公開服務商條款頁。</span>
            </label>
            <p v-if="providerLegalTermsLoading" class="text-sm text-gray-600">服務商條款載入中…</p>
          </div>
          <div v-else-if="settingsTab === 'order-email'" class="space-y-4">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div class="text-sm text-gray-600">訂單 Email 副本收件人</div>
                <p class="text-sm text-gray-600">訂單建立與付款確認 Email 會副本寄送給下列 Email 或帳號目前綁定的 Email。</p>
              </div>
              <div class="flex items-center gap-2">
                <button class="btn btn-outline btn-sm" @click="loadOrderEmailCcSettings" :disabled="orderEmailCcLoading || orderEmailCcSaving">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                </button>
                <button class="btn btn-primary btn-sm" @click="saveOrderEmailCcSettings" :disabled="orderEmailCcSaving || !orderEmailCcDirty || orderEmailCcInvalidEmails.length > 0">
                  {{ orderEmailCcSaving ? '儲存中…' : '儲存設定' }}
                </button>
              </div>
            </div>
            <label class="text-sm text-gray-600 space-y-1 block">
              <span class="font-medium text-gray-700">指定 Email 地址</span>
              <textarea v-model="orderEmailCcForm.emailsText" rows="4" class="border px-3 py-2 w-full" placeholder="ops@example.com&#10;finance@example.com" :disabled="orderEmailCcSaving"></textarea>
              <span class="text-xs text-gray-500">可用換行、逗號或分號分隔。</span>
            </label>
            <p v-if="orderEmailCcInvalidEmails.length" class="text-sm text-red-600">
              Email 格式不正確：{{ orderEmailCcInvalidEmails.join('、') }}
            </p>
            <div class="border-y border-gray-300 py-4 bg-transparent space-y-3">
              <div class="text-sm font-medium text-gray-700">指定帳號綁定 Email</div>
              <div class="flex flex-col md:flex-row gap-2">
                <input v-model.trim="orderEmailCcAccountQuery" class="border px-3 py-2 w-full" placeholder="搜尋帳號名稱、Email 或編號" @keyup.enter="searchOrderEmailCcAccounts" :disabled="orderEmailCcSaving" />
                <button class="btn btn-primary btn-sm md:self-start" @click="searchOrderEmailCcAccounts" :disabled="orderEmailCcAccountSearching || orderEmailCcSaving">
                  {{ orderEmailCcAccountSearching ? '搜尋中…' : '搜尋帳號' }}
                </button>
              </div>
              <div v-if="orderEmailCcAccountSearching" class="text-sm text-gray-600">帳號搜尋中…</div>
              <div v-else-if="orderEmailCcAccountSearchDone && !orderEmailCcAccountOptions.length" class="text-sm text-gray-600">查無符合的帳號。</div>
              <div v-else-if="orderEmailCcAccountOptions.length" class="space-y-2">
                <article v-for="account in orderEmailCcAccountOptions" :key="`order-email-option-${account.id}`" class="border-y border-gray-300 py-3 bg-transparent flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div class="font-medium text-gray-800">{{ account.username || account.email || account.id }}</div>
                    <div class="text-sm text-gray-600">{{ account.email || '未提供電子信箱' }}</div>
                    <div class="text-sm text-gray-600">角色：{{ roleLabel(account.role) }}</div>
                    <div class="text-sm text-gray-600 font-mono">{{ account.id }}</div>
                  </div>
                  <button class="btn btn-outline btn-sm" @click="addOrderEmailCcAccount(account)" :disabled="orderEmailCcSaving || orderEmailCcHasAccount(account.id) || !account.email">
                    {{ orderEmailCcHasAccount(account.id) ? '已加入' : '加入' }}
                  </button>
                </article>
              </div>
              <div v-if="orderEmailCcSelectedAccounts.length" class="space-y-2">
                <div class="text-sm font-medium text-gray-700">已加入帳號</div>
                <article v-for="account in orderEmailCcSelectedAccounts" :key="`order-email-selected-${account.id}`" class="border-y border-gray-300 py-3 bg-transparent flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div class="font-medium text-gray-800">{{ account.username || account.email || account.id }}</div>
                    <div class="text-sm text-gray-600">{{ account.email || '未提供電子信箱' }}</div>
                    <div v-if="account.missing" class="text-sm text-red-600">此帳號目前不存在，儲存時會被拒絕。</div>
                    <div class="text-sm text-gray-600 font-mono">{{ account.id }}</div>
                  </div>
                  <button class="btn btn-outline btn-sm" @click="removeOrderEmailCcAccount(account.id)" :disabled="orderEmailCcSaving">移除</button>
                </article>
              </div>
              <p v-else class="text-sm text-gray-600">尚未指定帳號。</p>
            </div>
            <p v-if="orderEmailCcLoading" class="text-sm text-gray-600">訂單 Email 副本設定載入中…</p>
          </div>
          <div v-else-if="settingsTab === 'legal'" class="space-y-4">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="text-sm text-gray-600">條款、產險連結與預約說明</div>
              <div class="flex items-center gap-2">
                <button class="btn btn-outline btn-sm" @click="loadSitePages" :disabled="sitePagesLoading || sitePagesSaving">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                </button>
                <button class="btn btn-primary btn-sm" @click="saveSitePages" :disabled="sitePagesSaving || !siteLegalPagesDirty">
                  {{ sitePagesSaving ? '儲存中…' : '儲存內容' }}
                </button>
              </div>
            </div>
            <div class="space-y-4">
              <label class="text-sm text-gray-600 space-y-1 block">
                <span class="font-medium text-gray-700">使用者條款內容</span>
                <textarea v-model="sitePagesForm.terms" rows="10" class="border px-3 py-2 w-full" placeholder="支援 HTML 內容" :disabled="sitePagesSaving"></textarea>
              </label>
              <label class="text-sm text-gray-600 space-y-1 block">
                <span class="font-medium text-gray-700">隱私權條款內容</span>
                <textarea v-model="sitePagesForm.privacy" rows="10" class="border px-3 py-2 w-full" placeholder="支援 HTML 內容" :disabled="sitePagesSaving"></textarea>
              </label>
              <label class="text-sm text-gray-600 space-y-1 block">
                <span class="font-medium text-gray-700">產險條款連結</span>
                <input v-model.trim="sitePagesForm.insuranceTermsUrl" type="url" class="border px-3 py-2 w-full" placeholder="https://example.com/insurance-terms" :disabled="sitePagesSaving" />
                <span class="text-xs text-gray-500">頁尾連結，留空不顯示。</span>
              </label>
              <label class="text-sm text-gray-600 space-y-1 block">
                <span class="font-medium text-gray-700">預約購買須知</span>
                <textarea v-model="sitePagesForm.reservationNotice" rows="10" class="border px-3 py-2 w-full" placeholder="支援 HTML 內容" :disabled="sitePagesSaving"></textarea>
              </label>
              <label class="text-sm text-gray-600 space-y-1 block">
                <span class="font-medium text-gray-700">預約使用規定</span>
                <textarea v-model="sitePagesForm.reservationRules" rows="10" class="border px-3 py-2 w-full" placeholder="支援 HTML 內容" :disabled="sitePagesSaving"></textarea>
              </label>
            </div>
            <p v-if="sitePagesLoading" class="text-sm text-gray-600">條款內容載入中…</p>
          </div>
          <div v-else-if="settingsTab === 'social-media'" class="space-y-4">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div class="text-sm text-gray-600">Footer 社群媒體連結</div>
                <p class="text-sm text-gray-600">設定顯示在網站頁尾的社群平台或外部連結。</p>
              </div>
              <div class="flex items-center gap-2">
                <button class="btn btn-outline btn-sm" @click="loadSitePages" :disabled="sitePagesLoading || sitePagesSaving">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新載入
                </button>
                <button class="btn btn-primary btn-sm" @click="saveSiteSocialLinks" :disabled="sitePagesSaving || !siteSocialLinksDirty || siteSocialLinkInvalidRows.length > 0">
                  {{ sitePagesSaving ? '儲存中…' : '儲存社群連結' }}
                </button>
              </div>
            </div>
            <section class="border-y border-gray-300 py-4 bg-transparent space-y-3">
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <div class="text-sm font-medium text-gray-700">社群連結清單</div>
                <button class="btn btn-outline btn-sm" @click="addSiteSocialLink" :disabled="sitePagesSaving || sitePagesForm.socialLinks.length >= MAX_SITE_SOCIAL_LINKS">
                  <AppIcon name="plus" class="h-4 w-4" /> 新增連結
                </button>
              </div>
              <div class="space-y-3">
                <div
                  v-for="(link, idx) in sitePagesForm.socialLinks"
                  :key="`site-social-link-${idx}`"
                  class="grid grid-cols-1 gap-2 md:grid-cols-[minmax(140px,0.8fr)_minmax(220px,1.6fr)_auto]"
                >
                  <label class="text-sm text-gray-600 space-y-1">
                    <span class="font-medium text-gray-700">顯示名稱</span>
                    <input v-model.trim="link.label" class="border px-3 py-2 w-full" placeholder="Instagram" :disabled="sitePagesSaving" />
                  </label>
                  <label class="text-sm text-gray-600 space-y-1">
                    <span class="font-medium text-gray-700">連結 URL</span>
                    <input v-model.trim="link.url" type="url" class="border px-3 py-2 w-full" placeholder="https://instagram.com/leaderonline" :disabled="sitePagesSaving" />
                  </label>
                  <div class="flex items-end">
                    <button class="btn btn-outline btn-sm w-full md:w-auto" @click="removeSiteSocialLink(idx)" :disabled="sitePagesSaving">
                      <AppIcon name="trash" class="h-4 w-4" /> 移除
                    </button>
                  </div>
                </div>
              </div>
              <p v-if="siteSocialLinkInvalidRows.length" class="text-sm text-red-600">
                社群連結 URL 請使用 http:// 或 https:// 開頭。
              </p>
              <p class="text-xs text-gray-500">空白列不會儲存；已填寫的列需包含有效 URL，最多可設定 {{ MAX_SITE_SOCIAL_LINKS }} 筆。</p>
            </section>
            <p v-if="sitePagesLoading" class="text-sm text-gray-600">社群連結載入中…</p>
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
                class="border-y border-gray-300 bg-transparent py-4 space-y-3"
              >
                <div>
                  <h3 class="text-sm font-medium text-gray-800">
                    {{ adminChecklistDefinitions[stageKey]?.title || stageLabelMap[stageKey] || stageKey }}
                  </h3>
                  <p class="text-sm text-gray-600 mt-1">每行輸入一項檢核內容，未填寫則套用預設項目。</p>
                </div>
                <label class="text-sm text-gray-600 space-y-1 block">
                  <span class="font-medium text-gray-700">檢核表標題</span>
                  <input
                    v-model.trim="checklistDefinitionsForm[stageKey].title"
                    class="border px-3 py-2 w-full"
                    :placeholder="DEFAULT_ADMIN_CHECKLIST_DEFINITIONS[stageKey]?.title || '檢核表標題'"
                    :disabled="checklistDefinitionsSaving"
                  />
                </label>
                <label class="text-sm text-gray-600 space-y-1 block">
                  <span class="font-medium text-gray-700">檢核項目（每行一項）</span>
                  <textarea
                    v-model="checklistDefinitionsForm[stageKey].itemsText"
                    rows="5"
                    class="border px-3 py-2 w-full font-mono text-sm leading-relaxed"
                    placeholder="例：車輛與配件與預約資訊相符"
                    :disabled="checklistDefinitionsSaving"
                  ></textarea>
                </label>
                <p class="text-sm text-gray-600">系統會依序顯示最多 12 項檢核內容。</p>
              </div>
            </div>
            <p v-if="checklistDefinitionsLoading" class="text-sm text-gray-600">檢核項目載入中…</p>
          </div>
        </AppCard>
      </section>

      <!-- Tombstones -->
      <section v-if="tab==='tombstones'" class="admin-section slide-up">
        <AppCard>
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
            <h2 class="ui-title font-medium">封鎖第三方登入</h2>
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
              <select v-model="tombstoneFilters.provider" class="border px-2 py-2 text-sm w-full sm:w-auto">
                <option value="">全部第三方平台</option>
                <option value="multiple" disabled>多個平台</option>
                <option value="google">Google</option>
                <option value="line">LINE</option>
              </select>
              <input v-model.trim="tombstoneFilters.subject" placeholder="subject（部分符合）" class="border px-2 py-2 text-sm w-full sm:w-56" />
              <input v-model.trim="tombstoneFilters.email" placeholder="電子信箱（部分符合）" class="border px-2 py-2 text-sm w-full sm:w-56" />
              <button class="btn btn-outline text-sm w-full sm:w-auto" @click="loadTombstones" :disabled="tombstoneLoading"><AppIcon name="refresh" class="h-4 w-4" /> 查詢</button>
              <button v-if="hasTombstoneFilters" class="btn btn-outline text-sm w-full sm:w-auto" @click="clearTombstoneFilters" :disabled="tombstoneLoading"><AppIcon name="x" class="h-4 w-4" /> 清除篩選</button>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
            <select v-model="tombstoneForm.provider" class="border px-2 py-2">
              <option value="google">Google</option>
              <option value="line">LINE</option>
            </select>
            <input v-model.trim="tombstoneForm.subject" placeholder="subject（擇一填 subject/email）" class="border px-2 py-2" />
            <input v-model.trim="tombstoneForm.email" placeholder="電子信箱（擇一填 subject 或電子信箱）" class="border px-2 py-2" />
            <input v-model.trim="tombstoneForm.reason" placeholder="原因（選填）" class="border px-2 py-2" />
          </div>
          <div class="mb-4">
            <button class="btn btn-primary btn-sm" @click="addTombstone" :disabled="tombstoneLoading">新增封鎖</button>
          </div>
          <div v-if="tombstoneLoading" class="text-gray-600">載入中…</div>
          <template v-else>
            <AdminFilterSheet
              v-model="tableFilters.tombstones"
              :columns="tombstoneTableColumns"
              title="封鎖紀錄欄位篩選"
              class="mb-3"
              @apply="applyServerFilterSheet('tombstones', $event)"
            />
            <div v-if="tombstones.length===0" class="text-gray-600">沒有資料</div>
            <div v-else-if="filteredTombstones.length===0" class="text-gray-600">沒有符合篩選的封鎖紀錄</div>
            <div v-else class="grid grid-cols-1 gap-3 md:hidden">
              <article v-for="r in filteredTombstones" :key="`tombstone-card-${r.id}`" class="border border-gray-300 bg-white p-3 rounded-xl">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="font-medium text-primary">{{ r.provider || '-' }}</div>
                    <div class="text-sm text-gray-600">編號：{{ r.id }}</div>
                  </div>
                  <button class="btn btn-outline btn-sm shrink-0" @click="deleteTombstone(r)">解除</button>
                </div>
                <div class="mt-3 space-y-1 text-sm text-gray-600">
                  <div class="font-mono break-all">Subject：{{ r.subject || '-' }}</div>
                  <div class="break-all">電子信箱：{{ r.email || '-' }}</div>
                  <div>原因：{{ r.reason || '-' }}</div>
                  <div>建立：{{ formatDate(r.created_at) }}</div>
                </div>
              </article>
            </div>
            <div v-if="filteredTombstones.length" class="overflow-x-auto hidden md:block">
              <table class="min-w-[720px] w-full text-sm table-default">
                <thead class="sticky top-0 z-10">
                  <tr class="bg-gray-50 text-left">
                    <th class="px-3 py-2 border">
                      <TableColumnFilter mode="server" label="編號" :fields="tombstoneTableColumns[0].fields" :model-value="tableFilters.tombstones.id" @update:model-value="setTableFilter('tombstones', 'id', $event)" @apply="applyServerTableFilter('tombstones', 'id', $event)" />
                    </th>
                    <th class="px-3 py-2 border">
                      <TableColumnFilter mode="server" label="第三方平台" :fields="tombstoneTableColumns[1].fields" :model-value="tableFilters.tombstones.provider" @update:model-value="setTableFilter('tombstones', 'provider', $event)" @apply="applyServerTableFilter('tombstones', 'provider', $event)" />
                    </th>
                    <th class="px-3 py-2 border">
                      <TableColumnFilter mode="server" label="Subject" :fields="tombstoneTableColumns[2].fields" :model-value="tableFilters.tombstones.subject" @update:model-value="setTableFilter('tombstones', 'subject', $event)" @apply="applyServerTableFilter('tombstones', 'subject', $event)" />
                    </th>
                    <th class="px-3 py-2 border">
                      <TableColumnFilter mode="server" label="電子信箱" :fields="tombstoneTableColumns[3].fields" :model-value="tableFilters.tombstones.email" @update:model-value="setTableFilter('tombstones', 'email', $event)" @apply="applyServerTableFilter('tombstones', 'email', $event)" />
                    </th>
                    <th class="px-3 py-2 border">
                      <TableColumnFilter mode="server" label="原因" :fields="tombstoneTableColumns[4].fields" :model-value="tableFilters.tombstones.reason" @update:model-value="setTableFilter('tombstones', 'reason', $event)" @apply="applyServerTableFilter('tombstones', 'reason', $event)" />
                    </th>
                    <th class="px-3 py-2 border">
                      <TableColumnFilter mode="server" label="建立時間" :fields="tombstoneTableColumns[5].fields" :model-value="tableFilters.tombstones.createdAt" @update:model-value="setTableFilter('tombstones', 'createdAt', $event)" @apply="applyServerTableFilter('tombstones', 'createdAt', $event)" />
                    </th>
                    <th class="px-3 py-2 border">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in filteredTombstones" :key="r.id">
                    <td class="px-3 py-2 border">{{ r.id }}</td>
                    <td class="px-3 py-2 border">{{ r.provider || '-' }}</td>
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
            <AdminPagination
              :total="tombstonesMeta.total"
              :limit="tombstonesMeta.limit"
              :offset="tombstonesMeta.offset"
              :loading="tombstoneLoading"
              @change="loadTombstones({ offset: $event.offset })"
            />
          </template>
        </AppCard>
      </section>

      <AppBottomSheet v-model="showDriverCreateSheet">
        <div class="max-h-[75vh] overflow-y-auto">
          <div class="mx-auto h-1.5 w-10 bg-gray-300 mb-3"></div>
          <h3 class="ui-title text-lg font-medium text-primary mb-1">新增司機</h3>
          <p class="text-sm text-gray-600 mb-4">建立司機帳號後即可在預約中進行指派。</p>
          <div class="grid grid-cols-1 gap-3">
            <label class="text-sm text-gray-600 space-y-1">
              <span class="font-medium text-gray-700">司機姓名</span>
              <input v-model.trim="newDriver.username" placeholder="司機姓名" class="border px-3 py-2 w-full" />
            </label>
            <label class="text-sm text-gray-600 space-y-1">
              <span class="font-medium text-gray-700">電子信箱</span>
              <input v-model.trim="newDriver.email" placeholder="電子信箱" class="border px-3 py-2 w-full" />
            </label>
            <label class="text-sm text-gray-600 space-y-1">
              <span class="font-medium text-gray-700">初始密碼</span>
              <input v-model.trim="newDriver.password" type="password" placeholder="初始密碼" class="border px-3 py-2 w-full" />
            </label>
            <label v-if="String(selfRole || '').toUpperCase()==='ADMIN'" class="text-sm text-gray-600 space-y-1">
              <span class="font-medium text-gray-700">服務商 ID（選填）</span>
              <input v-model.trim="newDriver.providerId" placeholder="服務商 ID" class="border px-3 py-2 w-full" />
            </label>
          </div>
          <div class="mt-4 flex flex-col sm:flex-row gap-2">
            <button class="btn btn-primary flex-1" @click="createDriver" :disabled="driverSaving">建立司機</button>
            <button class="btn btn-outline flex-1" @click="showDriverCreateSheet=false" :disabled="driverSaving">取消</button>
          </div>
        </div>
      </AppBottomSheet>

      <AppBottomSheet v-model="showUserCreateSheet">
        <div class="max-h-[75vh] overflow-y-auto">
          <div class="mx-auto h-1.5 w-10 bg-gray-300 mb-3"></div>
          <h3 class="ui-title text-lg font-medium text-primary mb-1">新增使用者</h3>
          <p class="text-sm text-gray-600 mb-4">集中輸入帳號資訊，避免新增表單擠壓使用者列表。</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="text-sm text-gray-600 space-y-1">
              <span class="font-medium text-gray-700">姓名</span>
              <input v-model.trim="newUser.username" placeholder="姓名" class="border px-3 py-2 w-full" />
            </label>
            <label class="text-sm text-gray-600 space-y-1">
              <span class="font-medium text-gray-700">電子信箱</span>
              <input v-model.trim="newUser.email" placeholder="電子信箱" class="border px-3 py-2 w-full" />
            </label>
            <label class="text-sm text-gray-600 space-y-1">
              <span class="font-medium text-gray-700">初始密碼</span>
              <input v-model.trim="newUser.password" type="password" placeholder="初始密碼" class="border px-3 py-2 w-full" />
            </label>
            <label class="text-sm text-gray-600 space-y-1">
              <span class="font-medium text-gray-700">角色</span>
              <select v-model="newUser.role" class="border px-3 py-2 w-full">
                <option value="USER">一般會員</option>
                <option value="SERVICE_PROVIDER">服務商</option>
                <option value="DRIVER">司機</option>
                <option value="DELIVERY_POINT">交車點</option>
                <option value="EDITOR">編輯</option>
                <option value="ADMIN">管理員</option>
              </select>
            </label>
            <label v-if="allowsProviderBinding(newUser.role)" class="text-sm text-gray-600 space-y-1 sm:col-span-2">
              <span class="font-medium text-gray-700">服務商 ID（選填）</span>
              <input v-model.trim="newUser.providerId" placeholder="服務商 ID" class="border px-3 py-2 w-full" />
            </label>
            <label class="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
              <input v-model="newUser.isVip" type="checkbox" class="h-4 w-4 accent-amber-500" />
              建立為 VIP 會員
            </label>
          </div>
          <div class="mt-4 flex flex-col sm:flex-row gap-2">
            <button class="btn btn-primary flex-1" @click="createAdminUser" :disabled="newUserSaving">建立使用者</button>
            <button class="btn btn-outline flex-1" @click="showUserCreateSheet=false" :disabled="newUserSaving">取消</button>
          </div>
        </div>
      </AppBottomSheet>

      <AppBottomSheet v-model="userMergeSheet.visible">
        <div class="max-h-[75vh] overflow-y-auto">
          <div class="mx-auto h-1.5 w-10 bg-gray-300 mb-3"></div>
          <h3 class="ui-title text-lg font-medium text-primary mb-1">合併帳號資料</h3>
          <p class="text-sm text-gray-600 mb-4">主帳號保留登入資料與基本資料；次帳號資料轉移後會被刪除。</p>
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section class="border border-gray-300 bg-white p-3">
              <div class="mb-2 text-sm font-medium text-gray-800">主帳號</div>
              <div class="flex flex-col gap-2 sm:flex-row">
                <input v-model.trim="userMergeSheet.primaryQuery" class="border px-3 py-2 w-full" placeholder="搜尋主帳號姓名、Email 或編號" @keyup.enter="searchMergeUsers('primary')" :disabled="userMergeSheet.saving" />
                <button class="btn btn-outline btn-sm sm:w-24" @click="searchMergeUsers('primary')" :disabled="userMergeSheet.primarySearching || userMergeSheet.saving">
                  {{ userMergeSheet.primarySearching ? '搜尋中' : '搜尋' }}
                </button>
              </div>
              <div v-if="userMergeSheet.primary" class="mt-3 border-y border-gray-300 py-2 text-sm">
                <div class="font-medium text-gray-900">{{ userMergeSheet.primary.username || userMergeSheet.primary.email || userMergeSheet.primary.id }}</div>
                <div class="break-all text-gray-600">{{ userMergeSheet.primary.email || '—' }}</div>
                <div class="text-gray-600">角色：{{ roleLabel(userMergeSheet.primary.role) }}</div>
                <div class="font-mono text-gray-600 break-all">{{ userMergeSheet.primary.id }}</div>
              </div>
              <div v-if="userMergeSheet.primaryOptions.length" class="mt-3 space-y-2">
                <button
                  v-for="option in userMergeSheet.primaryOptions"
                  :key="`merge-primary-${option.id}`"
                  type="button"
                  class="w-full border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:border-primary"
                  @click="selectMergeUser('primary', option)"
                >
                  <div class="font-medium text-gray-900">{{ option.username || option.email || option.id }}</div>
                  <div class="break-all text-gray-600">{{ option.email || '—' }}</div>
                  <div class="text-gray-600">{{ roleLabel(option.role) }} · <span class="font-mono">{{ option.id }}</span></div>
                </button>
              </div>
            </section>

            <section class="border border-gray-300 bg-white p-3">
              <div class="mb-2 text-sm font-medium text-gray-800">次帳號</div>
              <div class="flex flex-col gap-2 sm:flex-row">
                <input v-model.trim="userMergeSheet.secondaryQuery" class="border px-3 py-2 w-full" placeholder="搜尋次帳號姓名、Email 或編號" @keyup.enter="searchMergeUsers('secondary')" :disabled="userMergeSheet.saving" />
                <button class="btn btn-outline btn-sm sm:w-24" @click="searchMergeUsers('secondary')" :disabled="userMergeSheet.secondarySearching || userMergeSheet.saving">
                  {{ userMergeSheet.secondarySearching ? '搜尋中' : '搜尋' }}
                </button>
              </div>
              <div v-if="userMergeSheet.secondary" class="mt-3 border-y border-gray-300 py-2 text-sm">
                <div class="font-medium text-gray-900">{{ userMergeSheet.secondary.username || userMergeSheet.secondary.email || userMergeSheet.secondary.id }}</div>
                <div class="break-all text-gray-600">{{ userMergeSheet.secondary.email || '—' }}</div>
                <div class="text-gray-600">角色：{{ roleLabel(userMergeSheet.secondary.role) }}</div>
                <div class="font-mono text-gray-600 break-all">{{ userMergeSheet.secondary.id }}</div>
              </div>
              <div v-if="userMergeSheet.secondaryOptions.length" class="mt-3 space-y-2">
                <button
                  v-for="option in userMergeSheet.secondaryOptions"
                  :key="`merge-secondary-${option.id}`"
                  type="button"
                  class="w-full border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:border-primary"
                  @click="selectMergeUser('secondary', option)"
                >
                  <div class="font-medium text-gray-900">{{ option.username || option.email || option.id }}</div>
                  <div class="break-all text-gray-600">{{ option.email || '—' }}</div>
                  <div class="text-gray-600">{{ roleLabel(option.role) }} · <span class="font-mono">{{ option.id }}</span></div>
                </button>
              </div>
            </section>
          </div>
          <p v-if="userMergeSheet.primary?.id && userMergeSheet.secondary?.id && userMergeSheet.primary.id === userMergeSheet.secondary.id" class="mt-3 text-sm text-red-600">
            主帳號與次帳號不可相同。
          </p>
          <div class="mt-4 flex flex-col gap-2 sm:flex-row">
            <button class="btn btn-primary flex-1" @click="submitUserMerge" :disabled="!userMergeCanSubmit">
              {{ userMergeSheet.saving ? '合併中…' : '確認合併' }}
            </button>
            <button class="btn btn-outline flex-1" @click="closeUserMerge" :disabled="userMergeSheet.saving">取消</button>
          </div>
        </div>
      </AppBottomSheet>

      <AppBottomSheet v-model="showProductForm">
        <div class="max-h-[75vh] overflow-y-auto">
          <div class="mx-auto h-1.5 w-10 bg-gray-300 mb-3"></div>
          <h3 class="ui-title text-lg font-medium text-primary mb-1">新增商品</h3>
          <p class="text-sm text-gray-600 mb-4">商品基本資料移到二級頁面，主列表保留給瀏覽與篩選。</p>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label class="text-sm text-gray-600 space-y-1">
              <span class="font-medium text-gray-700">名稱</span>
              <input v-model.trim="newProduct.name" placeholder="名稱" class="border px-3 py-2 w-full" />
            </label>
            <label class="text-sm text-gray-600 space-y-1">
              <span class="font-medium text-gray-700">價格</span>
              <input v-model.number="newProduct.price" type="number" min="0" step="1" placeholder="價格" class="border px-3 py-2 w-full" />
            </label>
            <label class="text-sm text-gray-600 space-y-1">
              <span class="font-medium text-gray-700">上架狀態</span>
              <select v-model="newProduct.listing_status" class="border px-3 py-2 w-full">
                <option v-for="status in listingStatusOptions" :key="`product-create-${status.value}`" :value="status.value">{{ status.label }}</option>
              </select>
            </label>
            <label class="text-sm text-gray-600 space-y-1 sm:col-span-3">
              <span class="font-medium text-gray-700">描述</span>
              <textarea v-model.trim="newProduct.description" rows="3" placeholder="描述" class="border px-3 py-2 w-full"></textarea>
            </label>
          </div>
          <div class="mt-4 flex flex-col sm:flex-row gap-2">
            <button class="btn btn-primary flex-1" @click="createProduct" :disabled="loading">儲存商品</button>
            <button class="btn btn-outline flex-1" @click="showProductForm=false" :disabled="loading">取消</button>
          </div>
        </div>
      </AppBottomSheet>

      <AppBottomSheet v-model="ticketDetail.open">
        <div class="max-h-[75vh] overflow-y-auto">
          <div class="mx-auto h-1.5 w-10 bg-gray-300 mb-3"></div>
          <h3 class="ui-title text-lg font-medium text-primary mb-4">票券詳情</h3>
          <div v-if="!ticketDetail.ticket" class="text-sm text-gray-600">尚未選擇票券</div>
          <div v-else class="space-y-4 text-sm text-gray-800">
            <div class="border-y border-gray-300 py-3">
              <p><strong>票券：</strong>{{ ticketDetail.ticket.type || '未命名票券' }}</p>
              <p class="break-all"><strong>票號：</strong><span class="font-mono">{{ ticketDetail.ticket.uuid }}</span></p>
              <p><strong>綁定商品：</strong>{{ productLabel(ticketDetail.ticket) }}</p>
              <p><strong>持有人：</strong>{{ ticketDetail.ticket.username || '未綁定' }}（{{ ticketDetail.ticket.email || '—' }}）</p>
              <p><strong>狀態：</strong>{{ ticketStatusLabel(ticketDetail.ticket) }}</p>
              <p><strong>建立時間：</strong>{{ formatDate(ticketDetail.ticket.created_at) }}</p>
            </div>
            <section class="border-y border-gray-300 py-3 space-y-3">
              <h4 class="font-medium text-gray-700">編輯票券</h4>
              <label class="block text-sm">
                <span class="text-sm text-gray-600">票券名稱</span>
                <input class="border px-2 py-2 w-full mt-1" v-model.trim="ticketDetail.edit.type" placeholder="例如 VIP / 入場券" />
              </label>
              <label class="block text-sm">
                <span class="text-sm text-gray-600">綁定商品</span>
                <select class="border px-2 py-2 w-full mt-1" v-model="ticketDetail.edit.productId">
                  <option value="">未綁定商品</option>
                  <option v-if="readProductId(ticketDetail.edit) && !hasProductOption(ticketDetail.edit)" :value="String(readProductId(ticketDetail.edit))">
                    {{ missingProductOptionLabel(ticketDetail.edit) }}
                  </option>
                  <option v-for="p in products" :key="p.id" :value="String(p.id)">
                    {{ p.name }}（{{ p.code || `#${p.id}` }} / #{{ p.id }}）
                  </option>
                </select>
                <p class="text-sm text-gray-600 mt-1">已綁商品的方案會用這個商品 ID 判斷票券是否可用。</p>
              </label>
              <label class="block text-sm">
                <span class="text-sm text-gray-600">到期日</span>
                <input type="date" class="border px-2 py-2 w-full mt-1" v-model="ticketDetail.edit.expiry" />
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" v-model="ticketDetail.edit.used" />
                <span>標記為已使用</span>
              </label>
              <label class="block text-sm">
                <span class="text-sm text-gray-600">持有人電子信箱（重新指派）</span>
                <input class="border px-2 py-2 w-full mt-1" v-model.trim="ticketDetail.edit.userEmail" placeholder="輸入電子信箱指派新使用者" />
                <p class="text-sm text-gray-600 mt-1">若保持與原電子信箱相同則不變更。</p>
              </label>
              <div class="flex flex-col sm:flex-row gap-2">
                <button class="btn btn-primary btn-sm flex-1" @click="saveTicketEdit" :disabled="ticketDetail.saving">
                  <AppIcon name="check" class="h-4 w-4" /> 儲存
                </button>
                <button class="btn btn-outline btn-sm flex-1" @click="ticketDetail.ticket && loadTicketLogs(ticketDetail.ticket.id)" :disabled="ticketDetail.logsLoading || ticketDetail.logsLoadingMore">
                  <AppIcon name="refresh" class="h-4 w-4" /> 重新整理紀錄
                </button>
              </div>
            </section>
            <section class="border-y border-gray-300 py-3">
              <div class="flex items-center justify-between mb-2">
                <h4 class="font-medium text-gray-700">流向紀錄</h4>
                <button class="btn btn-outline btn-sm" @click="ticketDetail.ticket && loadTicketLogs(ticketDetail.ticket.id)" :disabled="ticketDetail.logsLoading || ticketDetail.logsLoadingMore">
                  <AppIcon name="refresh" class="h-4 w-4" /> 更新
                </button>
              </div>
              <div v-if="ticketDetail.logsLoading" class="text-gray-600">載入中…</div>
              <div v-else-if="!ticketDetail.logs.length" class="text-gray-600">目前沒有紀錄</div>
              <div v-else class="space-y-2">
                <article v-for="log in ticketDetail.logs" :key="log.id" class="border-y border-gray-300 bg-transparent py-2 leading-relaxed">
                  <div class="flex items-center justify-between">
                    <span class="font-medium text-gray-800">{{ ticketLogActionLabel(log.action) }}</span>
                    <span class="text-sm text-gray-600">{{ formatDate(log.created_at) }}</span>
                  </div>
                  <div class="text-sm text-gray-600 mt-1">{{ log.username || log.email || log.user_id || '—' }}</div>
                  <div v-if="log.metaText" class="text-sm text-gray-600 mt-1 break-all">
                    {{ log.metaText }}
                  </div>
                </article>
                <button
                  v-if="ticketDetail.logsHasMore"
                  class="btn btn-outline btn-sm w-full"
                  @click="ticketDetail.ticket && loadTicketLogs(ticketDetail.ticket.id, { append: true })"
                  :disabled="ticketDetail.logsLoading || ticketDetail.logsLoadingMore"
                >
                  {{ ticketDetail.logsLoadingMore ? '載入中…' : '載入更多紀錄' }}
                </button>
              </div>
            </section>
          </div>
        </div>
      </AppBottomSheet>

      <AppBottomSheet v-model="reservationDetail.open">
        <div class="max-h-[75vh] overflow-y-auto">
          <div class="mx-auto h-1.5 w-10 bg-gray-300 mb-3"></div>
          <h3 class="ui-title text-lg font-medium text-primary mb-4">檢核紀錄</h3>
          <div v-if="reservationDetail.loading" class="text-sm text-gray-600">載入中…</div>
          <div v-else-if="reservationDetail.record" class="space-y-4">
            <div class="border-y border-gray-300 py-3 text-sm leading-relaxed">
              <p><strong>使用者：</strong>{{ reservationDetail.record.username }}（{{ reservationDetail.record.email }}）</p>
              <p><strong>服務檔期：</strong>{{ reservationDetail.record.event }}</p>
              <p><strong>交車點資訊：</strong>{{ reservationDetail.record.store }}</p>
              <p><strong>票種：</strong>{{ reservationDetail.record.ticket_type }}</p>
              <p><strong>寄送地點：</strong>{{ formatReservationLocation(reservationRouteInfo(reservationDetail.record).origin.name, reservationRouteInfo(reservationDetail.record).origin.address) }}</p>
              <p><strong>送達地點：</strong>{{ formatReservationLocation(reservationRouteInfo(reservationDetail.record).destination.name, reservationRouteInfo(reservationDetail.record).destination.address) }}</p>
              <div v-if="canAssignDriver" class="border rounded-lg p-3 space-y-2">
                <div class="text-sm font-medium text-gray-700">指派司機</div>
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select v-model="reservationDetail.record.driver_id" class="border px-2 py-1 w-full sm:w-64">
                    <option value="">未指派</option>
                    <option v-for="d in providerDrivers" :key="d.id" :value="d.id">
                      {{ d.username || d.email || d.id }}
                    </option>
                  </select>
                  <button class="btn btn-primary btn-sm" @click="assignReservationDriver(reservationDetail.record)" :disabled="driverAssigning">
                    更新指派
                  </button>
                </div>
                <p v-if="providerDriversLoading" class="text-sm text-gray-600">司機列表載入中…</p>
                <p v-else-if="providerDriverError" class="text-sm text-red-600">{{ providerDriverError }}</p>
              </div>
              <div class="border rounded-lg p-3 space-y-2">
                <div class="text-sm font-medium text-gray-700">指派紀錄</div>
                <div v-if="reservationAssignmentsLoading" class="text-sm text-gray-600">載入中…</div>
                <div v-else-if="!reservationAssignments.length" class="text-sm text-gray-600">尚無指派紀錄</div>
                <ul v-else class="space-y-2 text-sm text-gray-700">
                  <li v-for="item in reservationAssignments" :key="item.id" class="border rounded-md p-2">
                    <div class="font-medium">
                      {{ item.action === 'unassign' ? '取消指派' : (item.action === 'reassign' ? '更改司機' : '指派司機') }}
                      <span v-if="item.driver_username || item.driver_email">：{{ item.driver_username || item.driver_email }}</span>
                    </div>
                    <div class="text-sm text-gray-600">
                      由 {{ item.assigned_by_username || item.assigned_by_email || item.assigned_by || '-' }}
                      • {{ formatDate(item.created_at) }}
                    </div>
                  </li>
                </ul>
                <button
                  v-if="reservationAssignmentsMeta.hasMore"
                  class="btn btn-outline btn-sm w-full"
                  @click="reservationDetail.record && fetchReservationAssignments(reservationDetail.record.id, { append: true })"
                  :disabled="reservationAssignmentsLoadingMore"
                >
                  {{ reservationAssignmentsLoadingMore ? '載入中…' : '載入更多指派紀錄' }}
                </button>
              </div>
              <p><strong>預約時間：</strong>{{ formatDate(reservationDetail.record.reserved_at) }}</p>
            </div>
            <div class="border-y border-gray-300 py-3 text-sm leading-relaxed">
              <div class="flex items-center justify-between mb-2">
                <h4 class="font-medium text-gray-800">狀態時間紀錄</h4>
                <span class="text-sm text-gray-600">檢核完成時間</span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div
                  v-for="stageKey in CHECKLIST_STAGE_KEYS"
                  :key="`checklist-time-${stageKey}`"
                  class="flex items-center justify-between border border-gray-100 px-3 py-2 rounded"
                >
                  <div class="text-sm text-gray-600">{{ adminChecklistDefinitions[stageKey]?.title || (stageLabelMap[stageKey] || '檢核') }}</div>
                  <div class="text-sm font-mono text-gray-800 text-right" v-if="checklistCompletedAt(reservationDetail.record, stageKey)">
                    {{ formatChecklistCompletedAt(checklistCompletedAt(reservationDetail.record, stageKey)) }}
                  </div>
                  <div class="text-sm text-gray-600" v-else>—</div>
                </div>
              </div>
            </div>
            <div v-for="stageKey in CHECKLIST_STAGE_KEYS" :key="stageKey"
              class="border-y border-gray-300 bg-transparent">
              <div class="flex items-center justify-between px-3 py-2 border-b border-gray-300 bg-transparent">
                <div>
                  <h4 class="font-medium text-gray-800">
                    {{ adminChecklistDefinitions[stageKey]?.title || (stageLabelMap[stageKey] || '檢核表') }}
                  </h4>
                  <p class="text-sm text-gray-600">
                    {{ stageLabelMap[stageKey] || checklistStageName(stageKey) }} ·
                    {{ reservationDetail.record.stageChecklist?.[stageKey]?.completed ? '已完成檢核' : '尚未完成檢核' }}
                  </p>
                  <div class="flex items-center gap-1 text-sm text-gray-600 mt-1">
                    <AppIcon name="clock" class="h-3.5 w-3.5" />
                    <span v-if="checklistCompletedAt(reservationDetail.record, stageKey)">
                      完成時間：{{ formatChecklistCompletedAt(checklistCompletedAt(reservationDetail.record, stageKey)) }}
                    </span>
                    <span v-else>尚未有完成時間紀錄</span>
                  </div>
                </div>
                <span class="text-sm px-2 py-1 border"
                  :class="reservationDetail.record.stageChecklist?.[stageKey]?.completed ? 'border-green-500 text-green-600' : 'border-gray-300 text-gray-600'">
                  照片 {{ reservationDetail.record.checklists?.[stageKey]?.photoCount ?? (reservationDetail.record.checklists?.[stageKey]?.photos?.length || 0) }}
                </span>
              </div>
              <div class="p-3 space-y-3 text-sm">
                <div>
                  <p class="text-sm text-gray-600 mb-1">檢核項目</p>
                  <ul class="space-y-1">
                    <li v-for="item in reservationDetail.record.checklists?.[stageKey]?.items || []" :key="item.label"
                      class="flex items-center gap-2">
                      <AppIcon :name="item.checked ? 'check' : 'x'"
                        :class="item.checked ? 'text-green-600 h-4 w-4' : 'text-gray-600 h-4 w-4'" />
                      <span :class="item.checked ? 'text-gray-800' : 'text-gray-600'">{{ item.label }}</span>
                    </li>
                  </ul>
                </div>
                <div>
                  <p class="text-sm text-gray-600 mb-2">檢核照片</p>
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
                      <div class="px-2 py-1 bg-slate-100 text-sm text-gray-600">
                        <div class="truncate">{{ formatChecklistUploadedAt(photo.uploadedAt) || '—' }}</div>
                        <div v-if="photo.originalName" class="truncate text-sm text-gray-600">{{ photo.originalName }}</div>
                      </div>
                    </button>
                  </div>
                  <div v-else class="text-sm text-gray-600">尚未上傳檢核照片</div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-sm text-gray-600">沒有檢核資料</div>
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
import { useRoute, useRouter } from 'vue-router'
import { API_BASE } from '../utils/api'
import AppIcon from '../components/AppIcon.vue'
import AppCard from '../components/AppCard.vue'
import AppBottomSheet from '../components/AppBottomSheet.vue'
import TableColumnFilter from '../components/TableColumnFilter.vue'
import AdminPagination from '../components/AdminPagination.vue'
import AdminFilterSheet from '../components/AdminFilterSheet.vue'
import CourseAdminPanel from './course-admin.vue'
import { showNotice, showConfirm, showPrompt } from '../utils/sheet'
import { formatDateTime, formatDateTimeRange } from '../utils/datetime'
import { startQrScanner } from '../utils/qrScanner'
import { normalizeHttpUrl } from '../utils/safeUrl'
import { setUserProfile } from '../utils/authSession'
import { buildAdminRecordCategoryOptions, resolveAdminRecordCategory } from '../utils/adminRecordCategories'
import {
  CHECKLIST_STAGE_KEYS,
  DEFAULT_STAGE_CHECKLIST_DEFINITIONS,
  cloneStageChecklistDefinitions,
  ensureChecklistHasPhotos
} from '../utils/reservationStages'

const router = useRouter()
const route = useRoute()
const API = API_BASE
const selfRole = ref('USER')
const selfUserId = ref('')
const selfUsername = ref('')
const selfEmail = ref('')

const normalizeFrontendRole = (role = '') => {
  const raw = String(role || '').toUpperCase()
  if (raw === 'STORE' || raw === 'COACH') return 'SERVICE_PROVIDER'
  return raw || 'USER'
}
const canCopyAdminContent = computed(() => normalizeFrontendRole(selfRole.value) !== 'USER')
const roleLabel = (role = '') => {
  const normalized = normalizeFrontendRole(role)
  if (normalized === 'SERVICE_PROVIDER') return '服務商'
  if (normalized === 'DELIVERY_POINT') return '交車點'
  if (normalized === 'DRIVER') return '司機'
  if (normalized === 'ADMIN') return '管理員'
  if (normalized === 'EDITOR') return '編輯'
  return normalized || '未設定'
}
const logBindingDebug = (label, payload = {}) => {
  try {
    console.log(`[binding-debug] ${label}`, payload)
  } catch {
    console.log(`[binding-debug] ${label}`)
  }
}
const logBindingWarn = (label, payload = {}) => {
  try {
    console.warn(`[binding-debug] ${label}`, payload)
  } catch {
    console.warn(`[binding-debug] ${label}`)
  }
}
const logBindingError = (label, error, payload = {}) => {
  const err = error || {}
  logBindingWarn(label, {
    ...payload,
    error: {
      message: err?.response?.data?.message || err?.message || String(err || ''),
      code: err?.response?.data?.code || err?.code || '',
      status: err?.response?.status || null,
      response: err?.response?.data || null,
    }
  })
}

const tab = ref('users')
const tabIndex = ref(0)
const groupKey = ref('user')
const loading = ref(false)
const usersLoading = ref(false)
const productsLoading = ref(false)
const eventsLoading = ref(false)
const listRequestSequence = Object.create(null)
const listSearchTimers = Object.create(null)
const beginListRequest = (key) => {
  listRequestSequence[key] = (listRequestSequence[key] || 0) + 1
  return listRequestSequence[key]
}
const isLatestListRequest = (key, id) => listRequestSequence[key] === id
const invalidateListRequest = (key) => {
  listRequestSequence[key] = (listRequestSequence[key] || 0) + 1
}
const cancelScheduledListSearch = (key) => {
  if (listSearchTimers[key]) clearTimeout(listSearchTimers[key])
  listSearchTimers[key] = null
}
const scheduleListSearch = (key, callback) => {
  cancelScheduledListSearch(key)
  // Invalidate an in-flight response as soon as the input changes, not only
  // after the debounced replacement request starts.
  invalidateListRequest(key)
  listSearchTimers[key] = setTimeout(() => {
    listSearchTimers[key] = null
    callback()
  }, 300)
}

// 角色分級：ADMIN 管理員、SERVICE_PROVIDER 服務商、DRIVER 司機、DELIVERY_POINT 交車點、EDITOR 編輯
const allTabs = [
  { key: 'users', label: '使用者', icon: 'user', roles: ['ADMIN'] },
  { key: 'drivers', label: '司機', icon: 'user', roles: ['ADMIN','SERVICE_PROVIDER'] },
  { key: 'products', label: '商品', icon: 'store', roles: ['ADMIN','EDITOR','SERVICE_PROVIDER'] },
  { key: 'events', label: '服務檔期', icon: 'ticket', roles: ['ADMIN','EDITOR','SERVICE_PROVIDER'] },
  { key: 'reservations', label: '預約', icon: 'orders', roles: ['ADMIN','SERVICE_PROVIDER','DELIVERY_POINT'] },
  { key: 'tickets', label: '票券', icon: 'ticket', roles: ['ADMIN','EDITOR','SERVICE_PROVIDER'] },
  { key: 'orders', label: '訂單', icon: 'orders', roles: ['ADMIN','EDITOR','SERVICE_PROVIDER'] },
  { key: 'courses', label: '課程管理', icon: 'calendar', roles: ['ADMIN','EDITOR','SERVICE_PROVIDER'] },
  { key: 'tombstones', label: '墓碑', icon: 'lock', roles: ['ADMIN'] },
  { key: 'settings', label: '設定', icon: 'settings', roles: ['ADMIN','SERVICE_PROVIDER','DELIVERY_POINT'] },
  // 專用掃描頁（供操作員使用）
  { key: 'driver-tasks', label: '我的任務', icon: 'orders', roles: ['DRIVER','DELIVERY_POINT'] },
  { key: 'scan', label: '掃描', icon: 'camera', roles: ['ADMIN','SERVICE_PROVIDER','DRIVER','DELIVERY_POINT','EDITOR'] },
]
const orderCategory = ref('general')
const ticketCategory = ref('general')
const orderCategoryOptions = computed(() => buildAdminRecordCategoryOptions('orders', selfRole.value))
const ticketCategoryOptions = computed(() => buildAdminRecordCategoryOptions('tickets', selfRole.value))
const canManageGeneralOrders = computed(() => orderCategoryOptions.value.some(option => option.key === 'general'))
const canManageGeneralTickets = computed(() => ticketCategoryOptions.value.some(option => option.key === 'general'))

function persistAdminCategory(storageKey, value) {
  try { localStorage.setItem(storageKey, value) } catch {}
}

function setOrderCategory(value, options = {}) {
  const next = resolveAdminRecordCategory('orders', selfRole.value, value)
  const changed = orderCategory.value !== next
  orderCategory.value = next
  persistAdminCategory('admin_order_category', next)
  if (changed && options.refresh !== false && tab.value === 'orders' && next === 'general') {
    loadOrders({ offset: 0 })
  }
}

function setTicketCategory(value, options = {}) {
  const next = resolveAdminRecordCategory('tickets', selfRole.value, value)
  const changed = ticketCategory.value !== next
  ticketCategory.value = next
  persistAdminCategory('admin_ticket_category', next)
  if (changed && options.refresh !== false && tab.value === 'tickets' && next === 'general') {
    ticketSummaryLoaded.value = false
    loadAdminTickets({ offset: 0, forceSummary: true })
  }
}

function restoreAdminCategories(requestedTab = '') {
  let savedOrderCategory = ''
  let savedTicketCategory = ''
  try {
    savedOrderCategory = localStorage.getItem('admin_order_category') || ''
    savedTicketCategory = localStorage.getItem('admin_ticket_category') || ''
  } catch {}
  const requestedCategory = typeof route.query.category === 'string' ? route.query.category : ''
  const orderPreference = requestedTab === 'orders' && requestedCategory ? requestedCategory : savedOrderCategory
  const ticketPreference = requestedTab === 'tickets' && requestedCategory ? requestedCategory : savedTicketCategory
  setOrderCategory(orderPreference || (canManageGeneralOrders.value ? 'general' : 'course'), { refresh: false })
  setTicketCategory(ticketPreference || (canManageGeneralTickets.value ? 'general' : 'course'), { refresh: false })
}
const canManageAllEvents = computed(() => {
  const role = String(selfRole.value || '').toUpperCase()
  return role === 'ADMIN' || role === 'EDITOR'
})
const canCreateEvents = computed(() => {
  const role = String(selfRole.value || '').toUpperCase()
  return role === 'ADMIN' || role === 'EDITOR' || role === 'SERVICE_PROVIDER'
})
const canEditEvent = (event = null) => {
  if (canManageAllEvents.value) return true
  if (String(selfRole.value || '').toUpperCase() !== 'SERVICE_PROVIDER') return false
  return String(event?.owner_user_id || '') === String(selfUserId.value || '')
}
// Group definitions
const groupDefs = [
  { key: 'user', label: '用戶管理', short: '用戶', tabs: ['users', 'drivers', 'tombstones'] },
  { key: 'product', label: '服務管理', short: '服務', tabs: ['products', 'events'] },
  { key: 'status', label: '狀態管理', short: '狀態', tabs: ['reservations', 'tickets', 'orders', 'driver-tasks', 'scan'] },
  { key: 'course', label: '課程管理', short: '課程', tabs: ['courses'] },
  { key: 'global', label: '設定管理', short: '設定', tabs: ['settings'] },
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
const setTab = (t, i, options = {}) => {
  tab.value = t; tabIndex.value = i;
  try { localStorage.setItem('admin_tab', t) } catch {}
  if (options.refresh !== false) refreshActive()
}
function defaultTabForGroup(role = selfRole.value) {
  const r = String(role || '').toUpperCase()
  if (groupKey.value === 'user') return 'users'
  if (groupKey.value === 'product') return (r === 'ADMIN' || r === 'SERVICE_PROVIDER') ? 'products' : 'events'
  if (groupKey.value === 'course') return 'courses'
  if (groupKey.value === 'global') return 'settings'
  // 狀態管理：操作員與司機預設顯示掃描，其餘顯示預約
  if (groupKey.value === 'status') return (r === 'DRIVER' || r === 'DELIVERY_POINT') ? 'driver-tasks' : 'reservations'
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
const openCourseRecords = (kind) => {
  if (kind !== 'orders' && kind !== 'tickets') return
  groupKey.value = 'status'
  try { localStorage.setItem('admin_group', 'status') } catch {}
  if (kind === 'orders') setOrderCategory('course', { refresh: false })
  else setTicketCategory('course', { refresh: false })
  const idx = visibleTabs.value.findIndex(item => item.key === kind)
  if (idx >= 0) setTab(kind, idx)
}
const tabClass = (t) => tab.value === t ? 'text-primary' : 'text-gray-600 hover:text-secondary'
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
const usersSummary = reactive({ total: 0 })
const userQuery = ref('')
const products = ref([])
const productQuery = ref('')
const productFilters = reactive({ onlyFree: false, onlyMissingDesc: false })
const productSort = ref('recent')
const productPreview = ref({ visible: false, product: null, context: '' })
const createEventPreviewState = () => ({
  visible: false,
  event: null,
  stores: [],
  loading: false,
  error: ''
})
const eventPreview = ref(createEventPreviewState())
const LISTING_STATUS_DRAFT = 'draft'
const LISTING_STATUS_PUBLISHED = 'published'
const listingStatusOptions = [
  { value: LISTING_STATUS_DRAFT, label: '暫存' },
  { value: LISTING_STATUS_PUBLISHED, label: '發布' }
]
const normalizeListingStatus = (value, fallback = LISTING_STATUS_PUBLISHED) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === LISTING_STATUS_DRAFT || normalized === LISTING_STATUS_PUBLISHED) return normalized
  if (['暫存', '草稿', 'draft', 'hidden', 'offline', '0', 'false'].includes(normalized)) return LISTING_STATUS_DRAFT
  if (['發布', '已發布', '上架', 'publish', 'published', 'active', 'online', '1', 'true'].includes(normalized)) return LISTING_STATUS_PUBLISHED
  return fallback
}
const listingStatusLabel = (value) => normalizeListingStatus(value) === LISTING_STATUS_DRAFT ? '暫存' : '發布'
const listingStatusBadgeClass = (value) => normalizeListingStatus(value) === LISTING_STATUS_DRAFT
  ? 'bg-amber-50 border-amber-200 text-amber-700'
  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
const productStats = computed(() => {
  const list = products.value
  const zeroPrice = list.filter(p => Number(p.price) === 0).length
  const missingDesc = list.filter(p => !(p.description || '').trim()).length
  const draft = list.filter(p => normalizeListingStatus(p.listing_status) === LISTING_STATUS_DRAFT).length
  const published = list.filter(p => normalizeListingStatus(p.listing_status) === LISTING_STATUS_PUBLISHED).length
  const avgPrice = list.length
    ? Math.round(list.reduce((sum, p) => sum + (Number(p.price) || 0), 0) / list.length)
    : 0
  return { total: list.length, zeroPrice, missingDesc, draft, published, avgPrice }
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
      const status = listingStatusLabel(p.listing_status).toLowerCase()
      return name.includes(q) || code.includes(q) || desc.includes(q) || status.includes(q)
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
const UNBOUND_PRODUCT_OPTION = '__unbound__'
const hasProductOption = (source) => {
  const productId = readProductId(source)
  if (!productId) return false
  return products.value.some(p => Number(p.id) === productId)
}
const productLabel = (entry) => {
  const productId = readProductId(entry)
  if (!productId) return '未綁定'
  const match = products.value.find(p => Number(p.id) === productId)
  const name = match?.name || entry?.product_name || entry?.productName || ''
  const code = match?.code || entry?.product_code || entry?.productCode || ''
  if (name || code) return `${name || '商品'}${code ? `（${code}）` : ''} #${productId}`
  return `商品 #${productId}`
}
const looksLikeProductRecord = (source) => {
  if (!source || typeof source !== 'object') return false
  if (!Number.isFinite(Number(source.id)) || Number(source.id) <= 0) return false
  return source.name !== undefined
    || source.code !== undefined
    || source.description !== undefined
    || source.price !== undefined
    || source.listing_status !== undefined
}
const resolveProductForPreview = (source) => {
  if (!source || typeof source !== 'object') return null
  if (looksLikeProductRecord(source)) {
    const productId = Number(source.id)
    return products.value.find(p => Number(p.id) === productId) || source
  }
  const productId = readProductId(source)
  if (!productId) return null
  return products.value.find(p => Number(p.id) === productId) || null
}
const productPreviewProduct = computed(() => resolveProductForPreview(productPreview.value.product))
const productPreviewButtonTitle = (source) => {
  const productId = readProductId(source)
  const product = resolveProductForPreview(source)
  if (product) return `預覽商品：${product.name || product.code || `#${product.id}`}`
  if (productId) return '商品清單載入後可預覽'
  return '請先選擇商品'
}
const closeProductPreview = () => {
  productPreview.value = { visible: false, product: null, context: '' }
}
async function openProductPreview(source, context = '') {
  let product = resolveProductForPreview(source)
  if (!product && readProductId(source) && !productsLoaded.value) {
    await loadProducts().catch(() => {})
    product = resolveProductForPreview(source)
  }
  if (!product) {
    await showNotice('請先選擇可預覽的商品', { title: '商品預覽' })
    return
  }
  productPreview.value = { visible: true, product: { ...product }, context }
}
const priceEarlyWindowText = (entry = {}) => {
  const start = entry.early_start || entry.earlyStart || ''
  const end = entry.early_end || entry.earlyEnd || ''
  if (start && end) return `早鳥期間 ${formatDateTime(start)} ~ ${formatDateTime(end)}`
  if (start) return `早鳥開始 ${formatDateTime(start)}`
  if (end) return `早鳥截止 ${formatDateTime(end)}`
  return ''
}
const missingProductOptionLabel = (entry) => {
  const productId = readProductId(entry)
  if (!productId) return '未綁定商品'
  return `目前綁定 ${productLabel({ productId })}（商品清單尚未載入）`
}
const ADMIN_EVENTS_DEFAULT_LIMIT = 50
const events = ref([])
const eventsMeta = reactive({
  total: 0,
  limit: ADMIN_EVENTS_DEFAULT_LIMIT,
  offset: 0,
  hasMore: false
})
const eventsSummary = reactive({ total: 0 })
const eventQuery = ref('')
const selectedEvent = ref(null)
const storeManagerMode = ref('list')
const editingStore = ref(null)
const eventStores = ref([])
const deliveryPoints = ref([])
const deliveryPointsLoading = ref(false)
const deliveryPointsError = ref('')
const storeLoading = ref(false)
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
const adminOrdersSummary = reactive({
  total: 0,
  byStatus: {},
})
const ordersLoading = ref(false)
const orderQuery = ref('')
const ORDER_STATUS_PAID = '已付款'
const ORDER_STATUS_CANCELLED = '已取消'
const LEGACY_PAID_ORDER_STATUSES = new Set(['已完成', '待指派'])
const normalizeOrderPaymentStatus = (status = '') => {
  const value = String(status || '').trim()
  return LEGACY_PAID_ORDER_STATUSES.has(value) ? ORDER_STATUS_PAID : value
}
const orderPaymentStatuses = ['待匯款', '處理中', ORDER_STATUS_PAID, ORDER_STATUS_CANCELLED]
const orderStatusFilter = ref('all')
const selectedOrderIds = ref([])
const orderBulkStatus = ref('')
const ordersBulkSaving = ref(false)
const orderEditor = reactive({
  visible: false,
  saving: false,
  order: null,
  productId: '',
  quantity: 1,
  selections: [],
  material: false,
  materialCount: 0,
})
const orderEditorProducts = computed(() => {
  const currentId = Number(orderEditor.productId || 0)
  return products.value.filter((product) => {
    const status = normalizeListingStatus(product.listing_status)
    return status === LISTING_STATUS_PUBLISHED || Number(product.id) === currentId
  })
})
const orderEditorEstimatedTotal = computed(() => {
  if (!orderEditor.order) return 0
  if (orderEditor.order.isReservation) {
    const serviceTotal = orderEditor.selections.reduce((sum, line) => {
      const quantity = Math.max(0, Math.floor(Number(line.qty || 0)))
      return sum + (line.byTicket ? 0 : toNumber(line.unitPrice) * quantity)
    }, 0)
    return serviceTotal + (orderEditor.material ? Math.max(0, Math.floor(Number(orderEditor.materialCount || 0))) * 100 : 0)
  }
  const product = orderEditorProducts.value.find((item) => Number(item.id) === Number(orderEditor.productId))
  const fallbackUnit = orderEditor.order.quantity > 0 ? toNumber(orderEditor.order.total) / orderEditor.order.quantity : 0
  return (product ? toNumber(product.price) : fallbackUnit) * Math.max(0, Math.floor(Number(orderEditor.quantity || 0)))
})
const orderSummaryCount = (status) => Number(adminOrdersSummary.byStatus?.[status] ?? adminOrdersSummary?.[status] ?? 0)
const ordersAwaitingRemittance = computed(() => orderSummaryCount('待匯款'))
const ordersProcessingCount = computed(() => orderSummaryCount('處理中'))
const ordersPaidCount = computed(() => orderSummaryCount(ORDER_STATUS_PAID))
const ordersCancelledCount = computed(() => orderSummaryCount(ORDER_STATUS_CANCELLED))
const getOrderStatusOptions = () => orderPaymentStatuses
const orderStatusSummary = computed(() => {
  const summary = [
    { key: 'all', label: '全部', count: Number(adminOrdersSummary.total || 0) },
    { key: '待匯款', label: '待匯款', count: ordersAwaitingRemittance.value },
    { key: '處理中', label: '處理中', count: ordersProcessingCount.value },
    { key: ORDER_STATUS_PAID, label: ORDER_STATUS_PAID, count: ordersPaidCount.value },
    { key: ORDER_STATUS_CANCELLED, label: ORDER_STATUS_CANCELLED, count: ordersCancelledCount.value }
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
const ticketProductBackfillTools = ref({ running: false })
const hasTicketFilters = computed(() => ticketStatusFilter.value !== 'all' || !!ticketQuery.value.trim() || tableHasActiveFilters('tickets'))
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
  logsLoadingMore: false,
  logsHasMore: false,
  logsCursor: null,
  saving: false,
  edit: {
    type: '',
    productId: '',
    expiry: '',
    used: false,
    userEmail: ''
  }
})
let ticketLogsRequestSequence = 0
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
const parseTicketDateOnly = (value) => {
  if (!value && value !== 0) return null
  const text = String(value).trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  const expiry = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value)
  expiry.setHours(0, 0, 0, 0)
  return Number.isNaN(expiry.getTime()) ? null : expiry
}
const isTicketExpired = (ticket) => {
  if (!ticket || !ticket.expiry) return false
  const expiry = parseTicketDateOnly(ticket.expiry)
  if (!expiry) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return expiry <= today
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
    product_id: readProductId(entry),
    productId: readProductId(entry),
    product_code: entry.product_code || entry.productCode || '',
    product_name: entry.product_name || entry.productName || '',
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
  cancelScheduledListSearch('tickets')
  adminTicketsMeta.offset = 0
  if (forceSummary) ticketSummaryLoaded.value = false
  loadAdminTickets({ offset: 0, forceSummary })
}
const clearTicketFilters = () => {
  if (!hasTicketFilters.value) return
  setTicketStatusFilterSilently('all')
  ticketQuery.value = ''
  clearTableFilters('tickets')
  performTicketSearch()
}
const prepareTicketEdit = (ticket) => {
  ticketDetail.edit.type = ticket?.type || ''
  const productId = readProductId(ticket)
  ticketDetail.edit.productId = productId ? String(productId) : ''
  ticketDetail.edit.expiry = formatDateInput(ticket?.expiry)
  ticketDetail.edit.used = !!ticket?.used
  ticketDetail.edit.userEmail = ticket?.email || ''
}
const openTicketDetail = async (ticket) => {
  if (!ticket) return
  ticketDetail.ticket = formatAdminTicket(ticket)
  ticketDetail.logs = []
  ticketDetail.logsCursor = null
  ticketDetail.logsHasMore = false
  prepareTicketEdit(ticketDetail.ticket)
  ticketDetail.open = true
  if (!productsLoaded.value) {
    await loadProducts().catch(() => {})
  }
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
const totalUsersCount = computed(() => usersSummary.total || usersMeta.total || users.value.length)
const tombstoneCount = computed(() => tombstonesSummary.total || tombstonesMeta.total || tombstones.value.length)
const productCount = computed(() => products.value.length)
const eventsTotalCount = computed(() => eventsSummary.total || eventsMeta.total || events.value.length)
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
      hint: '服務檔期',
      tab: 'events'
    })
  } else if (groupKey.value === 'status') {
    if (canManageGeneralTickets.value) {
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
    }
    if (canManageGeneralOrders.value) {
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
  }
  return cards.filter(card => card.value !== null && card.value !== undefined)
})
const handleOverviewCard = async (card) => {
  if (!card) return
  if (card.reservationFilter) {
    reservationStatusFilter.value = card.reservationFilter
  }
  if (card.orderFilter) {
    setOrderCategory('general', { refresh: false })
    orderStatusFilter.value = card.orderFilter
  }
  if (card.ticketFilter) {
    setTicketCategory('general', { refresh: false })
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
  if (card.orderFilter && (orderCategory.value !== 'general' || orderStatusFilter.value !== card.orderFilter)) return false
  if (card.ticketFilter && (ticketCategory.value !== 'general' || ticketStatusFilter.value !== card.ticketFilter)) return false
  return !!(card.tab || card.reservationFilter || card.orderFilter || card.ticketFilter)
}

const overviewCardClass = (card) => isOverviewCardActive(card)
  ? 'bg-gray-800 border-gray-900 text-white'
  : 'bg-white border-gray-200 text-gray-900 hover:border-primary/60'

const overviewCardLabelClass = (card) => isOverviewCardActive(card)
  ? 'text-white/80 text-sm'
  : 'text-gray-600 text-sm'

const overviewCardValueClass = (card) => isOverviewCardActive(card)
  ? 'text-3xl text-white'
  : 'text-3xl text-primary'

const overviewCardHintClass = (card) => isOverviewCardActive(card)
  ? 'text-white/80'
  : 'text-gray-600'
const isProviderSettingsRole = (role = selfRole.value) => {
  const normalized = normalizeFrontendRole(role)
  return normalized === 'SERVICE_PROVIDER'
}
const isDeliveryPointSettingsRole = (role = selfRole.value) => normalizeFrontendRole(role) === 'DELIVERY_POINT'
const isAdminSettingsRole = (role = selfRole.value) => normalizeFrontendRole(role) === 'ADMIN'
const allowsProviderBinding = (role = '') => ['DRIVER'].includes(String(role || '').toUpperCase())
const buildSettingsTabs = (role = selfRole.value) => {
  if (isDeliveryPointSettingsRole(role)) return [{ key: 'delivery-point', label: '交車點資訊' }]
  if (isProviderSettingsRole(role)) return [{ key: 'provider-contact', label: '聯絡資訊' }, { key: 'delivery-point-bindings', label: '交車點綁定' }, { key: 'remittance', label: '匯款資訊' }, { key: 'legal-terms', label: '服務條款' }]
  if (isAdminSettingsRole(role)) {
    return [
      { key: 'remittance', label: '匯款資訊' },
      { key: 'order-email', label: '訂單 Email' },
      { key: 'delivery-point-bindings-overview', label: '交車點綁定' },
      { key: 'legal', label: '條款說明' },
      { key: 'social-media', label: '社群媒體' },
      { key: 'checklists', label: '檢核表' }
    ]
  }
  return []
}
const settingsTabs = computed(() => buildSettingsTabs(selfRole.value))
const selfProviderAccountLabel = computed(() => selfUsername.value || selfEmail.value || selfUserId.value || '目前登入服務商')
const SETTINGS_TAB_STORAGE_KEY = 'admin_settings_tab'
const loadSavedSettingsTab = (role = selfRole.value) => {
  const availableTabs = buildSettingsTabs(role)
  try {
    const stored = localStorage.getItem(SETTINGS_TAB_STORAGE_KEY)
    if (stored && availableTabs.some(t => t.key === stored)) return stored
  } catch {}
  return availableTabs[0]?.key || 'provider-contact'
}
const settingsTab = ref('remittance')
const setSettingsTab = (key) => {
  if (!settingsTabs.value.some(t => t.key === key)) return
  settingsTab.value = key
  if (key === 'delivery-point') {
    loadDeliveryPointProfile().catch(() => {})
    loadDeliveryPointProviderBindings().catch(() => {})
  }
  if (key === 'provider-contact') {
    loadProviderContactSettings().catch(() => {})
  }
  if (key === 'delivery-point-bindings') {
    loadProviderDeliveryPointBindings().catch(() => {})
  }
  if (key === 'delivery-point-bindings-overview') {
    loadAdminDeliveryPointBindings().catch(() => {})
  }
  if (key === 'remittance') {
    loadRemittanceSettings().catch(() => {})
  }
  if (key === 'legal-terms') {
    loadProviderLegalTerms().catch(() => {})
  }
  if (key === 'order-email') {
    loadOrderEmailCcSettings().catch(() => {})
  }
  if (key === 'legal') {
    loadSitePages().catch(() => {})
  }
  if (key === 'social-media') {
    loadSitePages().catch(() => {})
  }
  try { localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, key) } catch {}
}
const canManageProviderRemittance = computed(() => isProviderSettingsRole(selfRole.value))
const canManageDeliveryPointSettings = computed(() => isDeliveryPointSettingsRole(selfRole.value))
const canManageAdminSettings = computed(() => isAdminSettingsRole(selfRole.value))
const settingsPanelTitle = computed(() => {
  if (canManageDeliveryPointSettings.value) return '交車點設定'
  return canManageProviderRemittance.value ? '服務商設定' : '平台設定'
})
const settingsPanelDescription = computed(() => {
  if (canManageDeliveryPointSettings.value) return '維護交車點名稱與聯絡資訊，並主動向服務商送出綁定申請；服務賽事由服務商設定，收款資訊未設定時使用平台匯款資訊。'
  return canManageProviderRemittance.value
    ? '設定服務商聯絡電話、預設匯款資訊、公開服務條款，並審核交車點送來的綁定申請；匯款資訊未設定時會使用平台設定。'
    : '管理平台匯款資訊、條款、檢核表，以及查看所有交車點與服務商的綁定關係。'
})
const remittanceSectionTitle = computed(() => canManageProviderRemittance.value ? '服務商預設匯款資訊' : '平台匯款資訊')
const remittanceHelperText = computed(() => canManageProviderRemittance.value
  ? '店面若未填寫對應欄位，系統會自動沿用此處設定；此處留空時會使用平台匯款資訊。'
  : '服務商沒有設定匯款資訊時，訂單會使用此處的平台匯款資訊。')
const remittanceSettingsEndpoint = computed(() => canManageProviderRemittance.value ? `${API}/provider/remittance` : `${API}/admin/remittance`)
watch(() => selfRole.value, (role) => {
  const availableTabs = buildSettingsTabs(role)
  if (!availableTabs.length) return
  if (!availableTabs.some(t => t.key === settingsTab.value)) {
    settingsTab.value = loadSavedSettingsTab(role)
  }
}, { immediate: true })
function openProviderBindingSettings() {
  closeStoreManager()
  groupKey.value = 'global'
  try { localStorage.setItem('admin_group', 'global') } catch {}
  nextTick(() => {
    const idx = Math.max(0, visibleTabs.value.findIndex(t => t.key === 'settings'))
    setTab('settings', idx >= 0 ? idx : 0)
    setSettingsTab(isAdminSettingsRole() ? 'delivery-point-bindings-overview' : 'delivery-point-bindings')
  })
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
const normalizeRemittancePayload = (source = {}) => ({
  info: String(source?.info ?? source?.remittance_info ?? '').trim(),
  bankCode: String(source?.bankCode ?? source?.remittance_bank_code ?? '').trim(),
  bankAccount: String(source?.bankAccount ?? source?.remittance_bank_account ?? '').trim(),
  accountName: String(source?.accountName ?? source?.remittance_account_name ?? '').trim(),
  bankName: String(source?.bankName ?? source?.remittance_bank_name ?? '').trim(),
})
const normalizePhoneValue = (value = '') => String(value || '').replace(/[^0-9+\-()\s]/g, '').slice(0, 20)
const createRemittanceFormState = (source = {}) => ({ ...normalizeRemittancePayload(source) })
const splitOrderEmailCcTokens = (value = '') => String(value || '')
  .split(/[\s,;，；]+/)
  .map(item => item.trim())
  .filter(Boolean)
const isValidEmailAddress = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim().toLowerCase())
const parseOrderEmailCcEmails = (value = '') => {
  const seen = new Set()
  const result = []
  splitOrderEmailCcTokens(value).forEach((token) => {
    const email = token.toLowerCase()
    if (!isValidEmailAddress(email) || seen.has(email)) return
    seen.add(email)
    result.push(email)
  })
  return result
}
const parseOrderEmailCcInvalidEmails = (value = '') => splitOrderEmailCcTokens(value)
  .filter(token => !isValidEmailAddress(token))
const normalizeOrderEmailCcAccount = (source = {}) => ({
  id: String(source?.id ?? source?.userId ?? source?.user_id ?? '').trim(),
  username: String(source?.username || '').trim(),
  email: String(source?.email || '').trim(),
  role: normalizeFrontendRole(source?.role || 'USER')
})
const remittanceHasValues = (source = {}) => Object.values(normalizeRemittancePayload(source)).some(Boolean)
const remittanceDisplayLines = (source = {}) => {
  const remittance = normalizeRemittancePayload(source)
  const lines = []
  if (remittance.bankName) lines.push(`銀行名稱：${remittance.bankName}`)
  if (remittance.bankCode) lines.push(`銀行代碼：${remittance.bankCode}`)
  if (remittance.bankAccount) lines.push(`銀行帳號：${remittance.bankAccount}`)
  if (remittance.accountName) lines.push(`帳戶名稱：${remittance.accountName}`)
  if (remittance.info) lines.push(remittance.info)
  return lines
}
const deliveryPointOptionLabel = (point = {}) => {
  const name = String(point?.name || '').trim() || `交車點 #${point?.id || ''}`
  const owner = String(point?.owner_username || point?.owner_email || '').trim()
  return owner ? `${name}｜${owner}` : name
}
const shouldShowDeliveryPointEmptyState = computed(() => selectedEvent.value && !deliveryPointsLoading.value && !deliveryPointsError.value && deliveryPoints.value.length === 0)
const deliveryPointSelectPlaceholder = computed(() => {
  if (deliveryPointsLoading.value) return '交車點清單載入中…'
  if (deliveryPointsError.value) return '交車點清單載入失敗'
  if (deliveryPoints.value.length === 0) return '目前沒有可選交車點'
  return '請選擇交車點帳號'
})
const findDeliveryPointById = (value) => {
  const id = String(value == null ? '' : value).trim()
  if (!id) return null
  return deliveryPoints.value.find((point) => String(point?.id || '') === id) || null
}
const deliveryPointPreviewLines = (point = null) => {
  if (!point) return []
  const lines = []
  if (point.address) lines.push(`地址：${point.address}`)
  if (point.phone) lines.push(`電話：${point.phone}`)
  if (point.business_hours) lines.push(`營業時間：${point.business_hours}`)
  if (point.external_url) lines.push(`網址：${point.external_url}`)
  if (point.capacity) lines.push(`收容數量：${point.capacity} 輛`)
  return lines
}
const resolveEditingDeliveryPoint = (store = {}) => findDeliveryPointById(store?._editing?.delivery_point_id || store?.delivery_point_id)
const storeRemittanceModeLabel = (store = {}) => {
  if (remittanceHasValues(store?.remittance)) return '合作服務商設定'
  return store?.owner_user_id ? '使用平台匯款資訊' : '尚未設定'
}
const createDeliveryPointProfileState = (source = {}) => ({
  name: String(source?.name || '').trim(),
  address: String(source?.address || '').trim(),
  phone: normalizePhoneValue(source?.phone || source?.telephone || source?.tel || ''),
  external_url: String(source?.external_url || source?.externalUrl || '').trim(),
  business_hours: String(source?.business_hours || source?.businessHours || '').trim(),
  capacity: source?.capacity ? String(source.capacity) : ''
})
const deliveryPointProfileForm = reactive(createDeliveryPointProfileState())
const deliveryPointProfileOriginal = ref('')
const deliveryPointProfileLoading = ref(false)
const deliveryPointProfileSaving = ref(false)
const deliveryPointProfileSnapshot = () => JSON.stringify({
  name: (deliveryPointProfileForm.name || '').trim(),
  address: (deliveryPointProfileForm.address || '').trim(),
  phone: normalizePhoneValue(deliveryPointProfileForm.phone || ''),
  external_url: (deliveryPointProfileForm.external_url || '').trim(),
  business_hours: (deliveryPointProfileForm.business_hours || '').trim(),
  capacity: (deliveryPointProfileForm.capacity || '').trim()
})
const deliveryPointProfileDirty = computed(() => deliveryPointProfileSnapshot() !== deliveryPointProfileOriginal.value)
deliveryPointProfileOriginal.value = deliveryPointProfileSnapshot()
const KNOWN_PROVIDER_BINDING_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REMOVED']
const normalizeProviderBindingStatus = (status = '') => String(status || '').trim().toUpperCase()
const providerBindingStatusValue = (source = '') => normalizeProviderBindingStatus(
  source && typeof source === 'object' ? (source.status ?? source.raw_status) : source
)
const isProviderBindingStatus = (source, status) => providerBindingStatusValue(source) === status
const providerBindingStatusLabel = (status = '') => {
  const normalized = providerBindingStatusValue(status)
  if (normalized === 'PENDING') return '待審核'
  if (normalized === 'APPROVED') return '已核准'
  if (normalized === 'REJECTED') return '已拒絕'
  if (normalized === 'CANCELLED') return '已取消'
  if (normalized === 'REMOVED') return '已解除'
  return normalized ? '未知狀態' : '未設定狀態'
}
const providerBindingStatusClass = (status = '') => {
  const normalized = providerBindingStatusValue(status)
  if (normalized === 'PENDING') return 'bg-amber-100 text-amber-700 border-amber-200'
  if (normalized === 'APPROVED') return 'bg-emerald-100 text-emerald-700 border-emerald-200'
  if (normalized === 'REJECTED') return 'bg-rose-100 text-rose-700 border-rose-200'
  if (normalized === 'CANCELLED') return 'bg-slate-100 text-slate-700 border-slate-200'
  if (normalized === 'REMOVED') return 'bg-gray-100 text-gray-700 border-gray-200'
  return 'bg-orange-100 text-orange-800 border-orange-200'
}
const providerBindingRawStatus = (item = {}) => String(item?.raw_status ?? item?.status ?? '').trim()
const shouldShowProviderBindingRawStatus = (item = {}) => {
  const raw = providerBindingRawStatus(item)
  const normalized = normalizeProviderBindingStatus(raw)
  return !!raw && (!KNOWN_PROVIDER_BINDING_STATUSES.includes(normalized) || raw !== normalized)
}
const deliveryPointProviderBindings = ref([])
const deliveryPointProviderBindingsLoading = ref(false)
const deliveryPointProviderBindingSaving = ref(false)
const deliveryPointProviderQuery = ref('')
const deliveryPointProviderSearchLoading = ref(false)
const deliveryPointProviderOptions = ref([])
const deliveryPointProviderBindingMap = computed(() => {
  return deliveryPointProviderBindings.value.reduce((acc, item) => {
    const key = String(item?.provider_user_id || item?.provider?.id || '').trim()
    if (key) acc[key] = item
    return acc
  }, {})
})
const providerDeliveryPointBindings = ref([])
const providerDeliveryPointBindingsLoading = ref(false)
const providerDeliveryPointBindingSaving = ref(false)
const providerDeliveryPointBindingsError = ref('')
const providerDeliveryPointBindingsHint = ref('')
const providerDeliveryPointBindingStatus = ref('PENDING')
const adminDeliveryPointBindings = ref([])
const adminDeliveryPointBindingsLoading = ref(false)
const adminDeliveryPointBindingSaving = ref(false)
const adminDeliveryPointBindingQuery = ref('')
const adminDeliveryPointBindingStatus = ref('ALL')
const providerContactForm = reactive({ phone: '' })
const providerContactOriginal = ref('')
const providerContactLoading = ref(false)
const providerContactSaving = ref(false)
const providerContactSnapshot = () => JSON.stringify({ phone: normalizePhoneValue(providerContactForm.phone) })
const providerContactDirty = computed(() => providerContactSnapshot() !== providerContactOriginal.value)
providerContactOriginal.value = providerContactSnapshot()
const remittanceForm = reactive(createRemittanceFormState())
const remittanceOriginal = ref('')
const remittanceLoading = ref(false)
const remittanceSaving = ref(false)
const remittanceSnapshot = () => JSON.stringify(normalizeRemittancePayload(remittanceForm))
const remittanceDirty = computed(() => remittanceSnapshot() !== remittanceOriginal.value)
remittanceOriginal.value = remittanceSnapshot()
const orderEmailCcForm = reactive({ emailsText: '', userIds: [] })
const orderEmailCcAccountsById = ref({})
const orderEmailCcOriginal = ref('')
const orderEmailCcLoading = ref(false)
const orderEmailCcSaving = ref(false)
const orderEmailCcAccountQuery = ref('')
const orderEmailCcAccountOptions = ref([])
const orderEmailCcAccountSearching = ref(false)
const orderEmailCcAccountSearchDone = ref(false)
const orderEmailCcInvalidEmails = computed(() => parseOrderEmailCcInvalidEmails(orderEmailCcForm.emailsText))
const orderEmailCcSnapshot = () => JSON.stringify({
  emails: parseOrderEmailCcEmails(orderEmailCcForm.emailsText),
  userIds: orderEmailCcForm.userIds.map(id => String(id || '').trim()).filter(Boolean)
})
const orderEmailCcDirty = computed(() => orderEmailCcSnapshot() !== orderEmailCcOriginal.value)
const orderEmailCcSelectedAccounts = computed(() => {
  const byId = orderEmailCcAccountsById.value || {}
  return orderEmailCcForm.userIds
    .map(id => String(id || '').trim())
    .filter(Boolean)
    .map(id => byId[id] || { id, username: '', email: '', role: '', missing: true })
})
orderEmailCcOriginal.value = orderEmailCcSnapshot()
const providerLegalTermsForm = reactive({ content: '' })
const providerLegalTermsOriginal = ref(JSON.stringify({ content: '' }))
const providerLegalTermsLoading = ref(false)
const providerLegalTermsSaving = ref(false)
const providerLegalTermsSnapshot = () => JSON.stringify({
  content: providerLegalTermsForm.content || ''
})
const providerLegalTermsDirty = computed(() => providerLegalTermsSnapshot() !== providerLegalTermsOriginal.value)
providerLegalTermsOriginal.value = providerLegalTermsSnapshot()
const MAX_SITE_SOCIAL_LINKS = 8
const createSiteSocialLinkRow = (source = {}) => ({
  label: String(source?.label || source?.name || source?.platform || '').trim(),
  url: String(source?.url || source?.href || '').trim()
})
const normalizeSiteSocialLinkRows = (list = []) => {
  const rows = Array.isArray(list) ? list : []
  return rows
    .map(createSiteSocialLinkRow)
    .filter(row => row.label || row.url)
    .slice(0, MAX_SITE_SOCIAL_LINKS)
}
const isValidSiteSocialUrl = (value = '') => {
  const text = String(value || '').trim()
  if (!text) return false
  try {
    const parsed = new URL(text)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
const sitePagesForm = reactive({ terms: '', privacy: '', insuranceTermsUrl: '', reservationNotice: '', reservationRules: '', socialLinks: [createSiteSocialLinkRow()] })
const siteLegalPagesOriginal = ref(JSON.stringify({ terms: '', privacy: '', insuranceTermsUrl: '', reservationNotice: '', reservationRules: '' }))
const siteSocialLinksOriginal = ref(JSON.stringify([]))
const sitePagesLoading = ref(false)
const sitePagesSaving = ref(false)
const siteSocialLinksPayload = () => normalizeSiteSocialLinkRows(sitePagesForm.socialLinks)
const siteLegalPagesSnapshot = () => JSON.stringify({
  terms: sitePagesForm.terms || '',
  privacy: sitePagesForm.privacy || '',
  insuranceTermsUrl: sitePagesForm.insuranceTermsUrl || '',
  reservationNotice: sitePagesForm.reservationNotice || '',
  reservationRules: sitePagesForm.reservationRules || '',
})
const siteSocialLinksSnapshot = () => JSON.stringify(siteSocialLinksPayload())
const siteSavedLegalPagesPayload = () => {
  try {
    const parsed = JSON.parse(siteLegalPagesOriginal.value || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
const siteSavedSocialLinksPayload = () => {
  try {
    const parsed = JSON.parse(siteSocialLinksOriginal.value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
const siteLegalPagesDirty = computed(() => siteLegalPagesSnapshot() !== siteLegalPagesOriginal.value)
const siteSocialLinksDirty = computed(() => siteSocialLinksSnapshot() !== siteSocialLinksOriginal.value)
const siteSocialLinkInvalidRows = computed(() => siteSocialLinksPayload().filter(row => !isValidSiteSocialUrl(row.url)))
siteLegalPagesOriginal.value = siteLegalPagesSnapshot()
siteSocialLinksOriginal.value = siteSocialLinksSnapshot()
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
const adminReservationsSummary = reactive({
  total: 0,
  byStatus: {},
})
const reservationsLoading = ref(false)
const reservationQuery = ref('')
const reservationDetail = reactive({ open: false, record: null, loading: false })
const driverTasks = ref([])
const driverTasksLoading = ref(false)
const providerDrivers = ref([])
const providerDriversLoading = ref(false)
const providerDriverError = ref('')
const driverAssigning = ref(false)
const eventDriverAssignment = reactive({
  loading: false,
  saving: false,
  driverId: '',
  syncedReservations: null,
  error: ''
})
const newDriver = reactive({ username: '', email: '', password: '', providerId: '' })
const showDriverCreateSheet = ref(false)
const driverSaving = ref(false)
const reservationAssignments = ref([])
const reservationAssignmentsLoading = ref(false)
const reservationAssignmentsLoadingMore = ref(false)
const reservationAssignmentsMeta = reactive({ hasMore: false, nextCursor: null })
const reservationAssignmentsTargetId = ref('')
let reservationAssignmentsRequestSequence = 0
const newUser = reactive({ username: '', email: '', password: '', role: 'USER', providerId: '', isVip: false })
const showUserCreateSheet = ref(false)
const newUserSaving = ref(false)
const userMergeSheet = reactive({
  visible: false,
  primary: null,
  secondary: null,
  primaryQuery: '',
  secondaryQuery: '',
  primaryOptions: [],
  secondaryOptions: [],
  primarySearching: false,
  secondarySearching: false,
  saving: false,
})
const normalizeMergeUser = (source = {}) => ({
  id: String(source.id || '').trim(),
  username: source.username || '',
  email: source.email || '',
  role: normalizeFrontendRole(source.role || 'USER'),
  isVip: !!(source.isVip ?? source.is_vip ?? source.vip),
})
const mergeUserLabel = (source = {}) => {
  const user = normalizeMergeUser(source)
  return [user.username || user.email || user.id, user.email && user.username ? user.email : '', user.id ? `#${user.id}` : '']
    .filter(Boolean)
    .join(' / ')
}
const userMergeCanSubmit = computed(() => {
  return !!userMergeSheet.primary?.id
    && !!userMergeSheet.secondary?.id
    && userMergeSheet.primary.id !== userMergeSheet.secondary.id
    && !userMergeSheet.saving
})
watch(ticketStatusFilter, () => {
  if (suppressTicketFilterWatch) return
  const current = tableFilters.tickets.status && typeof tableFilters.tickets.status === 'object'
    ? { ...tableFilters.tickets.status }
    : {}
  if (ticketStatusFilter.value === 'all') delete current.statuses
  else if (ticketStatusFilter.value !== 'multiple') current.statuses = [ticketStatusFilter.value]
  if (Object.keys(current).length) tableFilters.tickets.status = current
  else delete tableFilters.tickets.status
  if (tab.value !== 'tickets') return
  cancelScheduledListSearch('tickets')
  performTicketSearch({ forceSummary: false })
})
const openReservationDetail = async (row) => {
  reservationDetail.open = true
  reservationDetail.loading = true
  reservationDetail.record = mapAdminReservation(row)
  if (canAssignDriver.value) {
    fetchProviderDrivers().catch(() => {})
  }
  fetchReservationAssignments(row?.id).catch(() => {})
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

const canAssignDriver = computed(() => {
  const role = String(selfRole.value || '').toUpperCase()
  return role === 'ADMIN' || role === 'SERVICE_PROVIDER'
})
const canManageEventDriverAssignment = computed(() => String(selfRole.value || '').toUpperCase() === 'SERVICE_PROVIDER')
const canEditDriverProvider = computed(() => String(selfRole.value || '').toUpperCase() === 'ADMIN')
const mapProviderDriver = (driver = {}) => ({
  ...driver,
  _edit: false,
  _saving: false,
  _providerId: driver.provider_id || '',
})

const fetchProviderDrivers = async () => {
  if (!canAssignDriver.value) return
  providerDriversLoading.value = true
  providerDriverError.value = ''
  try {
    const { data } = await axios.get(`${API}/provider/drivers`)
    if (data?.ok) {
      providerDrivers.value = Array.isArray(data.data) ? data.data.map(mapProviderDriver) : []
    } else {
      providerDriverError.value = data?.message || '無法載入司機列表'
    }
  } catch (err) {
    providerDriverError.value = err?.response?.data?.message || err.message || '無法載入司機列表'
  } finally {
    providerDriversLoading.value = false
  }
}

const resetEventDriverAssignment = () => {
  eventDriverAssignment.loading = false
  eventDriverAssignment.saving = false
  eventDriverAssignment.driverId = ''
  eventDriverAssignment.syncedReservations = null
  eventDriverAssignment.error = ''
}

const loadEventDriverAssignment = async (eventId) => {
  if (!canManageEventDriverAssignment.value || !eventId) return
  eventDriverAssignment.loading = true
  eventDriverAssignment.error = ''
  eventDriverAssignment.syncedReservations = null
  try {
    if (!providerDrivers.value.length && !providerDriversLoading.value) {
      fetchProviderDrivers().catch(() => {})
    }
    const { data } = await axios.get(`${API}/admin/events/${eventId}/driver`)
    const payload = data?.data || data
    if (data?.ok !== false && payload) {
      eventDriverAssignment.driverId = payload?.driverId ? String(payload.driverId) : ''
    } else {
      eventDriverAssignment.error = data?.message || '無法載入司機安排'
    }
  } catch (err) {
    eventDriverAssignment.error = err?.response?.data?.message || err.message || '無法載入司機安排'
  } finally {
    eventDriverAssignment.loading = false
  }
}

const saveEventDriverAssignment = async () => {
  if (!canManageEventDriverAssignment.value || !selectedEvent.value?.id) return
  eventDriverAssignment.saving = true
  eventDriverAssignment.error = ''
  try {
    const driverId = eventDriverAssignment.driverId ? String(eventDriverAssignment.driverId) : null
    const { data } = await axios.patch(`${API}/admin/events/${selectedEvent.value.id}/driver`, { driverId })
    const payload = data?.data || data
    if (data?.ok !== false && payload) {
      eventDriverAssignment.driverId = payload?.driverId ? String(payload.driverId) : ''
      eventDriverAssignment.syncedReservations = Number(payload?.syncedReservations || 0)
      await showNotice('司機安排已更新', { title: '完成' })
    } else {
      eventDriverAssignment.error = data?.message || '更新失敗'
      await showNotice(eventDriverAssignment.error, { title: '錯誤' })
    }
  } catch (err) {
    eventDriverAssignment.error = err?.response?.data?.message || err.message || '更新失敗'
    await showNotice(eventDriverAssignment.error, { title: '錯誤' })
  } finally {
    eventDriverAssignment.saving = false
  }
}

const startEditDriver = (driver) => {
  if (!canEditDriverProvider.value || !driver) return
  driver._providerId = driver.provider_id || ''
  driver._edit = true
}

const cancelEditDriver = (driver) => {
  if (!driver) return
  driver._providerId = driver.provider_id || ''
  driver._edit = false
}

const saveDriverProvider = async (driver) => {
  if (!canEditDriverProvider.value || !driver?.id) return
  const currentProviderId = String(driver.provider_id || '').trim()
  const nextProviderId = String(driver._providerId || '').trim()
  if (nextProviderId === currentProviderId) {
    driver._edit = false
    return
  }
  driver._saving = true
  try {
    const { data } = await axios.patch(`${API}/admin/users/${driver.id}`, {
      providerId: nextProviderId || null,
    })
    if (data?.ok) {
      await fetchProviderDrivers()
      await showNotice('司機服務商已更新', { title: '完成' })
    } else {
      await showNotice(data?.message || '更新失敗', { title: '錯誤' })
    }
  } catch (err) {
    await showNotice(err?.response?.data?.message || err.message || '更新失敗', { title: '錯誤' })
  } finally {
    driver._saving = false
    driver._edit = false
  }
}

const assignReservationDriver = async (record) => {
  if (!record || !record.id) return
  if (!canAssignDriver.value) return
  driverAssigning.value = true
  try {
    const driverId = record.driver_id ? String(record.driver_id) : null
    const { data } = await axios.patch(`${API}/provider/reservations/${record.id}/driver`, {
      driverId: driverId || null
    })
    if (data?.ok) {
      record.driver_id = data.data?.driver_id || ''
      const driver = providerDrivers.value.find(d => String(d.id || '') === String(record.driver_id || ''))
      record.driver_username = driver?.username || ''
      record.driver_email = driver?.email || ''
      await fetchReservationAssignments(record.id)
      await showNotice('司機指派已更新', { title: '完成' })
    } else {
      await showNotice(data?.message || '更新失敗', { title: '錯誤' })
    }
  } catch (err) {
    await showNotice(err?.response?.data?.message || err.message || '更新失敗', { title: '錯誤' })
  } finally {
    driverAssigning.value = false
  }
}

const fetchReservationAssignments = async (reservationId, options = {}) => {
  if (!reservationId) return
  const targetId = String(reservationId)
  const append = !!options.append
  if (append && reservationAssignmentsTargetId.value !== targetId) return
  if (append && (!reservationAssignmentsMeta.hasMore || reservationAssignmentsLoadingMore.value)) return
  if (append) {
    reservationAssignmentsLoadingMore.value = true
  } else {
    reservationAssignmentsTargetId.value = targetId
    reservationAssignments.value = []
    reservationAssignmentsMeta.hasMore = false
    reservationAssignmentsMeta.nextCursor = null
    reservationAssignmentsLoading.value = true
    reservationAssignmentsLoadingMore.value = false
  }
  const requestId = ++reservationAssignmentsRequestSequence
  try {
    const params = { paged: 1, limit: 50 }
    if (append && reservationAssignmentsMeta.nextCursor) params.cursor = reservationAssignmentsMeta.nextCursor
    let response = await axios.get(`${API}/reservations/${reservationId}/assignments`, { params })
    let payload = response.data?.data || {}
    // Older backends ignore paged=1 and return an array. Re-fetch their
    // maximum supported batch so a frontend-first deploy does not regress to 50.
    if (!append && Array.isArray(payload) && payload.length === params.limit) {
      if (requestId !== reservationAssignmentsRequestSequence || reservationAssignmentsTargetId.value !== targetId) return
      response = await axios.get(`${API}/reservations/${reservationId}/assignments`, { params: { limit: 200 } })
      payload = response.data?.data || []
    }
    if (
      requestId !== reservationAssignmentsRequestSequence
      || reservationAssignmentsTargetId.value !== targetId
      || String(reservationDetail.record?.id || '') !== targetId
      || !reservationDetail.open
    ) return
    const { data } = response
    if (data?.ok) {
      const items = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : [])
      const merged = append ? [...reservationAssignments.value, ...items] : items
      reservationAssignments.value = Array.from(new Map(merged.map(item => [String(item.id), item])).values())
      reservationAssignmentsMeta.hasMore = !!payload.meta?.hasMore
      reservationAssignmentsMeta.nextCursor = payload.meta?.nextCursor ?? null
    } else {
      if (!append) reservationAssignments.value = []
      reservationAssignmentsMeta.hasMore = false
      reservationAssignmentsMeta.nextCursor = null
    }
  } catch (err) {
    if (requestId !== reservationAssignmentsRequestSequence || reservationAssignmentsTargetId.value !== targetId) return
    if (!append) reservationAssignments.value = []
  } finally {
    if (requestId === reservationAssignmentsRequestSequence && reservationAssignmentsTargetId.value === targetId) {
      if (append) reservationAssignmentsLoadingMore.value = false
      else reservationAssignmentsLoading.value = false
    }
  }
}

const createDriver = async () => {
  if (!newDriver.username || !newDriver.email || !newDriver.password) {
    await showNotice('請填寫司機姓名、電子信箱與初始密碼', { title: '資料不足' })
    return
  }
  driverSaving.value = true
  try {
    const payload = {
      username: newDriver.username,
      email: newDriver.email,
      password: newDriver.password,
    }
    if (String(selfRole.value || '').toUpperCase() === 'ADMIN' && newDriver.providerId) {
      payload.providerId = String(newDriver.providerId).trim()
    }
    const { data } = await axios.post(`${API}/provider/drivers`, payload)
    if (data?.ok) {
      newDriver.username = ''
      newDriver.email = ''
      newDriver.password = ''
      newDriver.providerId = ''
      showDriverCreateSheet.value = false
      await fetchProviderDrivers()
      await showNotice('司機已建立', { title: '完成' })
    } else {
      await showNotice(data?.message || '建立失敗', { title: '錯誤' })
    }
  } catch (err) {
    await showNotice(err?.response?.data?.message || err.message || '建立失敗', { title: '錯誤' })
  } finally {
    driverSaving.value = false
  }
}

const deleteDriver = async (driver) => {
  if (!driver?.id) return
  const okDelete = await showConfirm(`確定刪除司機「${driver.username || driver.email || driver.id}」？`, { title: '刪除司機' })
  if (!okDelete) return
  driverSaving.value = true
  try {
    const { data } = await axios.delete(`${API}/provider/drivers/${driver.id}`)
    if (data?.ok) {
      await fetchProviderDrivers()
      await showNotice('司機已刪除', { title: '完成' })
    } else {
      await showNotice(data?.message || '刪除失敗', { title: '錯誤' })
    }
  } catch (err) {
    await showNotice(err?.response?.data?.message || err.message || '刪除失敗', { title: '錯誤' })
  } finally {
    driverSaving.value = false
  }
}

const createAdminUser = async () => {
  if (!newUser.username || !newUser.email || !newUser.password) {
    await showNotice('請填寫姓名、電子信箱與初始密碼', { title: '資料不足' })
    return
  }
  newUserSaving.value = true
  try {
    const { data } = await axios.post(`${API}/admin/users`, {
      username: newUser.username,
      email: newUser.email,
      password: newUser.password,
      role: newUser.role,
      isVip: !!newUser.isVip,
      ...(allowsProviderBinding(newUser.role) && newUser.providerId ? { providerId: newUser.providerId } : {}),
    })
    if (data?.ok) {
      newUser.username = ''
      newUser.email = ''
      newUser.password = ''
      newUser.role = 'USER'
      newUser.providerId = ''
      newUser.isVip = false
      showUserCreateSheet.value = false
      await loadUsers({ offset: 0 })
      await showNotice('使用者已建立', { title: '完成' })
    } else {
      await showNotice(data?.message || '建立失敗', { title: '錯誤' })
    }
  } catch (err) {
    await showNotice(err?.response?.data?.message || err.message || '建立失敗', { title: '錯誤' })
  } finally {
    newUserSaving.value = false
  }
}

function openUserMerge(user = null) {
  userMergeSheet.visible = true
  userMergeSheet.primary = user?.id ? normalizeMergeUser(user) : null
  userMergeSheet.secondary = null
  userMergeSheet.primaryQuery = user?.id ? mergeUserLabel(user) : ''
  userMergeSheet.secondaryQuery = ''
  userMergeSheet.primaryOptions = []
  userMergeSheet.secondaryOptions = []
}

function closeUserMerge() {
  if (userMergeSheet.saving) return
  userMergeSheet.visible = false
}

function selectMergeUser(kind, user) {
  const normalized = normalizeMergeUser(user)
  if (!normalized.id) return
  if (kind === 'primary') {
    userMergeSheet.primary = normalized
    userMergeSheet.primaryQuery = mergeUserLabel(normalized)
    userMergeSheet.primaryOptions = []
  } else {
    userMergeSheet.secondary = normalized
    userMergeSheet.secondaryQuery = mergeUserLabel(normalized)
    userMergeSheet.secondaryOptions = []
  }
}

async function searchMergeUsers(kind) {
  const isPrimary = kind === 'primary'
  const query = (isPrimary ? userMergeSheet.primaryQuery : userMergeSheet.secondaryQuery).trim()
  if (!query) {
    if (isPrimary) userMergeSheet.primaryOptions = []
    else userMergeSheet.secondaryOptions = []
    return
  }
  if (isPrimary) userMergeSheet.primarySearching = true
  else userMergeSheet.secondarySearching = true
  try {
    const { data } = await axios.get(`${API}/admin/users`, { params: { q: query, limit: 20, offset: 0 } })
    const payload = data?.data || {}
    const options = (Array.isArray(payload.items) ? payload.items : []).map(normalizeMergeUser)
    if (isPrimary) userMergeSheet.primaryOptions = options
    else userMergeSheet.secondaryOptions = options
  } catch (err) {
    await showNotice(err?.response?.data?.message || err.message || '搜尋帳號失敗', { title: '搜尋失敗' })
  } finally {
    if (isPrimary) userMergeSheet.primarySearching = false
    else userMergeSheet.secondarySearching = false
  }
}

async function submitUserMerge() {
  if (!userMergeCanSubmit.value) return
  const primary = userMergeSheet.primary
  const secondary = userMergeSheet.secondary
  const message = [
    `主帳號：${mergeUserLabel(primary)}`,
    `次帳號：${mergeUserLabel(secondary)}`,
    '合併後主帳號會保留姓名、Email、角色與登入資料；次帳號的訂單、票券、預約、第三方綁定與購物車會轉移到主帳號，次帳號會被刪除。',
  ].join('\n')
  const confirmed = await showConfirm(message, { title: '確認合併帳號' }).catch(() => false)
  if (!confirmed) return
  userMergeSheet.saving = true
  try {
    const { data } = await axios.post(`${API}/admin/users/merge`, {
      primaryUserId: primary.id,
      secondaryUserId: secondary.id,
    })
    if (data?.ok) {
      const moved = data.data?.moved || {}
      const totalMoved = [
        moved.orders,
        moved.tickets,
        moved.reservations,
        moved.ticketTransfers,
        moved.ticketLogs,
        moved.oauthIdentities,
        moved.userCarts,
        moved.ownedRecords,
        moved.operationalReferences,
      ].reduce((sum, value) => sum + (Number(value) || 0), 0)
      userMergeSheet.visible = false
      await loadUsers({ offset: 0 })
      await showNotice(`帳號資料已合併，轉移/更新 ${totalMoved} 筆關聯資料。`, { title: '合併完成' })
    } else {
      await showNotice(data?.message || '合併失敗', { title: '合併失敗' })
    }
  } catch (err) {
    await showNotice(err?.response?.data?.message || err.message || '合併失敗', { title: '合併失敗' })
  } finally {
    userMergeSheet.saving = false
  }
}
const closeReservationDetail = () => {
  reservationDetail.open = false
  reservationDetail.record = null
  reservationDetail.loading = false
}
watch(() => reservationDetail.open, (value) => {
  if (!value) {
    reservationAssignmentsRequestSequence += 1
    reservationAssignmentsTargetId.value = ''
    reservationDetail.record = null
    reservationDetail.loading = false
    reservationAssignments.value = []
    reservationAssignmentsMeta.hasMore = false
    reservationAssignmentsMeta.nextCursor = null
    reservationAssignmentsLoading.value = false
    reservationAssignmentsLoadingMore.value = false
  }
})
watch(() => ticketDetail.open, (value) => {
  if (value) return
  ticketLogsRequestSequence += 1
  ticketDetail.logs = []
  ticketDetail.logsCursor = null
  ticketDetail.logsHasMore = false
  ticketDetail.logsLoading = false
  ticketDetail.logsLoadingMore = false
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
const reservationStatusSummary = computed(() => {
  const shortLabel = (label) => {
    if (!label) return ''
    const idx = label.indexOf('（')
    return idx === -1 ? label : label.slice(0, idx)
  }
  const summary = [
    { key: 'all', label: '全部', count: Number(adminReservationsSummary.total || 0) }
  ]
  reservationStatusOptions.forEach(opt => {
    if (opt.value === 'service_booking') return
    summary.push({
      key: opt.value,
      label: shortLabel(opt.label),
      count: Number(adminReservationsSummary.byStatus?.[opt.value] ?? adminReservationsSummary?.[opt.value] ?? 0)
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

const RESERVATION_RETURN_STAGES = new Set(['post_dropoff', 'post_pickup', 'done'])

const formatReservationLocation = (name, address) => {
  const nameText = String(name || '').trim()
  const addressText = String(address || '').trim()
  if (!nameText && !addressText) return '—'
  if (!addressText) return nameText || '—'
  if (!nameText) return addressText
  return `${nameText}（${addressText}）`
}

const reservationRouteInfo = (record) => {
  const status = String(record?.status || '')
  const isReturn = RESERVATION_RETURN_STAGES.has(status)
  const storeName = record?.store || ''
  const storeAddress = record?.store_address || record?.storeAddress || ''
  const eventName = record?.event || ''
  const eventAddress = record?.event_address || record?.eventAddress || ''
  if (isReturn) {
    return {
      origin: { name: eventName, address: eventAddress },
      destination: { name: storeName, address: storeAddress }
    }
  }
  return {
    origin: { name: storeName, address: storeAddress },
    destination: { name: eventName, address: eventAddress }
  }
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
    driver_id: raw.driver_id == null ? '' : raw.driver_id,
    driver_username: raw.driver_username || '',
    driver_email: raw.driver_email || '',
    ticket_type: raw.ticket_type,
    store: raw.store,
    store_address: raw.store_address || raw.storeAddress || '',
    event: raw.event,
    event_address: raw.event_address || raw.eventAddress || '',
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
const ADMIN_TOMBSTONES_DEFAULT_LIMIT = 50
const tombstonesMeta = reactive({ total: 0, limit: ADMIN_TOMBSTONES_DEFAULT_LIMIT, offset: 0, hasMore: false })
const tombstonesSummary = reactive({ total: 0 })
const tombstoneFilters = ref({ provider: '', subject: '', email: '' })
const tombstonesLegacyKnownTotal = ref(null)
let suppressTombstoneQuickFilterWatch = false
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

async function refreshAfterReservationProgress(){
  const role = String(selfRole.value || '').toUpperCase()
  if (role === 'DRIVER' || role === 'DELIVERY_POINT') {
    await loadDriverTasks()
    return
  }
  await loadAdminReservations()
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

// 切換分頁時關閉掃描器
watch(tab, (t) => {
  if (t !== 'scan' && scan.value.open) {
    closeScan()
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
        await refreshAfterReservationProgress()
        closeScan()
      } else {
        scan.value.manual = ''
        await refreshAfterReservationProgress()
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
      await refreshAfterReservationProgress()
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

async function loadTombstones(options = {}){
  if (options?.resetLegacyTotal) tombstonesLegacyKnownTotal.value = null
  if (options && typeof options.offset === 'number' && Number.isFinite(options.offset)) {
    tombstonesMeta.offset = Math.max(0, Math.floor(options.offset))
  }
  if (options && typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    tombstonesMeta.limit = Math.max(1, Math.min(200, Math.floor(options.limit)))
  }
  const requestId = beginListRequest('tombstones')
  tombstoneLoading.value = true
  try{
    const params = {
      paged: 1,
      limit: tombstonesMeta.limit,
      offset: tombstonesMeta.offset,
      ...buildServerTableFilterParams('tombstones'),
    }
    const { data } = await axios.get(`${API}/admin/tombstones`, { params })
    if (!isLatestListRequest('tombstones', requestId)) return
    const payload = data?.data || data || {}
    const isLegacyArray = Array.isArray(payload)
    const items = Array.isArray(payload.items) ? payload.items : (isLegacyArray ? payload : [])
    tombstones.value = items
    const meta = payload.meta || {}
    if (isLegacyArray) {
      const pageEnd = params.offset + items.length
      if (items.length < params.limit) tombstonesLegacyKnownTotal.value = pageEnd
      const knownTotal = Number.isFinite(tombstonesLegacyKnownTotal.value)
        ? Number(tombstonesLegacyKnownTotal.value)
        : null
      const inferredHasMore = knownTotal == null && items.length === params.limit
      tombstonesMeta.limit = params.limit
      tombstonesMeta.offset = params.offset
      tombstonesMeta.total = knownTotal ?? (pageEnd + (inferredHasMore ? 1 : 0))
      tombstonesMeta.hasMore = knownTotal == null
        ? inferredHasMore
        : pageEnd < knownTotal
    } else {
      tombstonesMeta.limit = Math.max(1, Number(meta.limit) || params.limit)
      tombstonesMeta.offset = Math.max(0, Number(meta.offset) || 0)
      tombstonesMeta.total = Math.max(0, Number(meta.total) || items.length)
      tombstonesMeta.hasMore = meta.hasMore != null
        ? !!meta.hasMore
        : tombstonesMeta.offset + items.length < tombstonesMeta.total
    }
    const summaryTotal = Number(payload.summary?.total ?? payload.summary?.globalTotal)
    if (Number.isFinite(summaryTotal)) tombstonesSummary.total = Math.max(0, summaryTotal)
    else if (!tableHasActiveFilters('tombstones') && !tombstoneFilters.value.provider && !tombstoneFilters.value.subject && !tombstoneFilters.value.email) tombstonesSummary.total = tombstonesMeta.total
    if (tombstonesMeta.total > 0 && !items.length && tombstonesMeta.offset >= tombstonesMeta.total) {
      const lastOffset = Math.max(0, (Math.ceil(tombstonesMeta.total / tombstonesMeta.limit) - 1) * tombstonesMeta.limit)
      if (lastOffset !== tombstonesMeta.offset) return loadTombstones({ offset: lastOffset })
    }
    tombstonesLoaded.value = true
  } catch (e){
    if (!isLatestListRequest('tombstones', requestId)) return
    await showNotice(e?.response?.data?.message || e.message, { title: '讀取失敗' })
  } finally {
    if (isLatestListRequest('tombstones', requestId)) tombstoneLoading.value = false
  }
}

async function clearTombstoneFilters(){
  if (tombstoneLoading.value) return
  tombstoneFilters.value = { provider: '', subject: '', email: '' }
  clearTableFilters('tombstones')
  tombstonesLegacyKnownTotal.value = null
  cancelScheduledListSearch('tombstones')
  tombstonesMeta.offset = 0
  await loadTombstones({ offset: 0, resetLegacyTotal: true })
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
      await loadTombstones({ resetLegacyTotal: true })
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
    if (data?.ok){ await loadTombstones({ resetLegacyTotal: true }); await showNotice('已解除封鎖') }
    else await showNotice(data?.message || '解除失敗', { title: '解除失敗' })
  } catch (e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally { tombstoneLoading.value = false }
}

const showProductForm = ref(false)
const showEventForm = ref(false)
const eventFormMode = ref('create')
const editingEvent = ref(null)
const defaultProductForm = () => ({ name: '', price: 0, description: '', listing_status: LISTING_STATUS_DRAFT })
const newProduct = ref(defaultProductForm())
const defaultEventForm = () => ({ code: '', title: '', starts_at: '', ends_at: '', deadline: '', location: '', description: '', cover: '', rules: '', is_exclusive: false, listing_status: LISTING_STATUS_DRAFT })
const newEvent = ref(defaultEventForm())
const coverFile = ref(null)
const coverPreview = ref('')
const coverUploadData = ref('')
const COVER_TARGET_WIDTH = 900
const COVER_TARGET_HEIGHT = 600
const COVER_TARGET_RATIO = COVER_TARGET_WIDTH / COVER_TARGET_HEIGHT // 固定 900x600（3:2）
const COVER_MAX_FILE_BYTES = 10 * 1024 * 1024
const COVER_MAX_SOURCE_PIXELS = 40_000_000
const productCoverUrl = (p) => p?.id
  ? `${API}/products/${p.id}/cover`
  : `${API}/tickets/cover/${encodeURIComponent(p?.name || '')}`
// Ticket cover list
// removed ticket cover list tab; manage covers inside Products section

function copyToClipboard(text){
  if (!text) return
  try { navigator.clipboard?.writeText(String(text)) } catch {}
}

const isEditingEvent = computed(() => eventFormMode.value === 'edit' && !!editingEvent.value)
const eventFormHeading = computed(() => isEditingEvent.value ? '編輯活動' : '新增活動')
const eventFormActionLabel = computed(() => isEditingEvent.value ? '儲存變更' : '建立活動')
const eventIsExclusive = (event = {}) => {
  const raw = event?.is_exclusive ?? event?.isExclusive
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(raw || '').trim().toLowerCase())
}
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
  rules: formatRulesInput(form?.rules || ''),
  is_exclusive: eventIsExclusive(form),
  listing_status: normalizeListingStatus(form?.listing_status, LISTING_STATUS_DRAFT)
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
    rules: formatRulesInput(event.rules),
    is_exclusive: eventIsExclusive(event),
    listing_status: normalizeListingStatus(event.listing_status)
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

const eventDisplayCode = (event = {}) => event?.code || (event?.id != null ? `EV${String(event.id).padStart(6, '0')}` : '')
const normalizeEventRulesList = (value) => {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  const text = String(value || '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed.map(item => String(item || '').trim()).filter(Boolean)
  } catch {}
  return parseRulesInput(text)
}
const eventPreviewEvent = computed(() => eventPreview.value.event)
const eventPreviewCode = computed(() => eventDisplayCode(eventPreviewEvent.value || {}))
const eventPreviewCover = computed(() => {
  const event = eventPreviewEvent.value || {}
  return event.cover || (event.id ? `${API}/events/${event.id}/cover` : '/logo.png')
})
const eventPreviewSchedule = computed(() => {
  const event = eventPreviewEvent.value || {}
  return event.date || formatRange(event.starts_at, event.ends_at)
})
const eventPreviewDeadline = computed(() => {
  const event = eventPreviewEvent.value || {}
  return event.deadline ? formatDate(event.deadline) : (event.ends_at ? formatDate(event.ends_at) : '')
})
const eventPreviewRules = computed(() => normalizeEventRulesList(eventPreviewEvent.value?.rules))
const eventPreviewFrontPath = computed(() => eventPreviewCode.value ? `/booking/${encodeURIComponent(eventPreviewCode.value)}` : '')
const eventPreviewCanOpenFrontend = computed(() => {
  return !!eventPreviewFrontPath.value && normalizeListingStatus(eventPreviewEvent.value?.listing_status) === LISTING_STATUS_PUBLISHED
})

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
  if (!canCreateEvents.value) return
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
  if (!canEditEvent(event)) return
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
const legacyCleanupTools = ref({ cleaning: false })

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

async function cleanupLegacyDeletedAccountData(){
  const confirmed = await showConfirm(
    '將會清理更新前已刪除帳號留下的舊關聯資料：停用孤立交車點與活動交車點服務、移除無效綁定、刪除孤立商品並下架孤立服務檔期。確定執行？',
    { title: '一次性清理舊關聯資料' }
  ).catch(() => false)
  if (!confirmed) return
  legacyCleanupTools.value.cleaning = true
  try{
    const { data } = await axios.post(`${API}/admin/maintenance/cleanup-deleted-account-data`)
    if (data?.ok){
      const d = data?.data || {}
      await showNotice([
        '舊資料清理完成',
        `已刪除帳號掃描：${d.deleted_users_processed || 0}`,
        `交車點停用：${d.delivery_points_deactivated || 0}`,
        `活動交車點服務停用：${d.event_stores_deactivated || 0}`,
        `交車點綁定移除：${d.delivery_point_bindings_deleted || 0}`,
        `商品刪除：${d.products_deleted || 0}`,
        `服務檔期下架：${d.events_expired || 0}`,
      ].join('\n'))
      await loadUsers()
      productsLoaded.value = false
      if (tab.value === 'products') await loadProducts()
      if (selectedEvent.value?.id) await loadEventStores(selectedEvent.value.id)
      if (deliveryPoints.value.length) await loadDeliveryPoints({ silent: true })
    } else {
      await showNotice(data?.message || '舊資料清理失敗', { title: '清理失敗' })
    }
  } catch(e){
    await showNotice(e?.response?.data?.message || e.message, { title: '舊資料清理失敗' })
  } finally { legacyCleanupTools.value.cleaning = false }
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
    if (file.size > COVER_MAX_FILE_BYTES) return reject(new Error('圖片檔案不得超過 10MB'))
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('讀取檔案失敗'))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const w = img.naturalWidth || img.width
        const h = img.naturalHeight || img.height
        if (!w || !h) return reject(new Error('圖片尺寸無效'))
        if (w * h > COVER_MAX_SOURCE_PIXELS) return reject(new Error('圖片解析度過大，請先縮小後再上傳'))
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
const createPriceItem = (type = '') => ({
  type,
  normal: '',
  early: '',
  early_start: '',
  early_end: '',
  productId: UNBOUND_PRODUCT_OPTION
})
const normalizeStoreCapacityInput = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (!/^\d+$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
const storeCapacityDisplay = (source = {}) => {
  const value = normalizeStoreCapacityInput(source && typeof source === 'object' ? source.capacity : source)
  return value ? `${value} 輛` : '不限制'
}
const defaultStoreForm = () => ({
  delivery_point_id: '',
  capacity: '',
  priceItems: [createPriceItem('大鐵人')]
})
const newStore = ref(defaultStoreForm())
const selectedNewStoreDeliveryPoint = computed(() => findDeliveryPointById(newStore.value?.delivery_point_id))

const tableFilters = reactive({
  drivers: {},
  users: {},
  events: {},
  reservations: {},
  tickets: {},
  orders: {},
  tombstones: {},
})

const tableDateText = (value) => {
  if (!value) return ''
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  return text
}
const tableFilterKey = (value) => {
  if (Array.isArray(value)) return value.map(tableFilterKey).join(' / ')
  if (value === null || value === undefined || value === '') return '空白'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value).toLowerCase()
}
function setTableFilter(tableKey, columnKey, value) {
  if (!tableFilters[tableKey]) tableFilters[tableKey] = {}
  if (value === null || value === undefined) delete tableFilters[tableKey][columnKey]
  else tableFilters[tableKey][columnKey] = value
}
function clearTableFilters(tableKey) {
  if (!tableFilters[tableKey]) return
  Object.keys(tableFilters[tableKey]).forEach((key) => delete tableFilters[tableKey][key])
}
function tableHasActiveFilters(tableKey) {
  const filters = tableFilters[tableKey] || {}
  return Object.values(filters).some((value) => {
    if (Array.isArray(value)) return true
    if (!value || typeof value !== 'object') return String(value ?? '').trim().length > 0
    return Object.values(value).some((fieldValue) => Array.isArray(fieldValue)
      ? fieldValue.length > 0
      : String(fieldValue ?? '').trim().length > 0)
  })
}

function buildServerTableFilterParams(tableKey) {
  const params = {}
  const columns = tableFilters[tableKey] || {}
  Object.values(columns).forEach((filter) => {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return
    Object.entries(filter).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        if (value.length) params[key] = value.join(',')
        return
      }
      if (value === null || value === undefined || String(value).trim() === '') return
      params[key] = value
    })
  })
  return params
}

function applyTombstoneQuickFiltersToColumns() {
  const source = tombstoneFilters.value || {}
  if (source.provider === 'multiple') {
    // Keep the multi-select value owned by the column filter.
  } else if (source.provider) tableFilters.tombstones.provider = { providers: [source.provider] }
  else delete tableFilters.tombstones.provider
  if (source.subject) tableFilters.tombstones.subject = { subject: source.subject }
  else delete tableFilters.tombstones.subject
  if (source.email) tableFilters.tombstones.email = { email: source.email }
  else delete tableFilters.tombstones.email
}

function syncTombstoneQuickFiltersFromColumns() {
  const providers = tableFilters.tombstones?.provider?.providers
  suppressTombstoneQuickFilterWatch = true
  tombstoneFilters.value = {
    provider: Array.isArray(providers) && providers.length === 1
      ? String(providers[0])
      : (Array.isArray(providers) && providers.length > 1 ? 'multiple' : ''),
    subject: String(tableFilters.tombstones?.subject?.subject || ''),
    email: String(tableFilters.tombstones?.email?.email || ''),
  }
  nextTick(() => { suppressTombstoneQuickFilterWatch = false })
}

function syncStatusFilterFromColumns(tableKey) {
  const statuses = tableFilters[tableKey]?.status?.statuses
  const next = Array.isArray(statuses) && statuses.length === 1
    ? String(statuses[0])
    : (Array.isArray(statuses) && statuses.length > 1 ? 'multiple' : 'all')
  if (tableKey === 'orders') orderStatusFilter.value = next
  if (tableKey === 'reservations') reservationStatusFilter.value = next
  if (tableKey === 'tickets') setTicketStatusFilterSilently(next)
}

async function reloadServerFilteredTable(tableKey) {
  if (tableKey === 'users') {
    usersMeta.offset = 0
    return loadUsers({ offset: 0 })
  }
  if (tableKey === 'events') {
    eventsMeta.offset = 0
    return loadEvents({ offset: 0 })
  }
  if (tableKey === 'orders') {
    adminOrdersMeta.offset = 0
    clearOrderSelection()
    return loadOrders({ offset: 0 })
  }
  if (tableKey === 'reservations') {
    adminReservationsMeta.offset = 0
    return loadAdminReservations({ offset: 0 })
  }
  if (tableKey === 'tickets') {
    adminTicketsMeta.offset = 0
    ticketSummaryLoaded.value = false
    return loadAdminTickets({ offset: 0, forceSummary: true })
  }
  if (tableKey === 'tombstones') {
    tombstonesMeta.offset = 0
    return loadTombstones({ offset: 0 })
  }
}

async function applyServerTableFilter(tableKey, columnKey, value) {
  setTableFilter(tableKey, columnKey, value)
  syncStatusFilterFromColumns(tableKey)
  if (tableKey === 'tombstones') {
    tombstonesLegacyKnownTotal.value = null
    syncTombstoneQuickFiltersFromColumns()
  }
  await nextTick()
  return reloadServerFilteredTable(tableKey)
}

async function applyServerFilterSheet(tableKey, value) {
  tableFilters[tableKey] = value && typeof value === 'object' ? value : {}
  syncStatusFilterFromColumns(tableKey)
  if (tableKey === 'tombstones') {
    tombstonesLegacyKnownTotal.value = null
    syncTombstoneQuickFiltersFromColumns()
  }
  await nextTick()
  return reloadServerFilteredTable(tableKey)
}
function applyTableFilters(list = [], tableKey, columns = []) {
  const filters = tableFilters[tableKey] || {}
  const active = columns.filter((column) => Array.isArray(filters[column.key]))
  if (!active.length) return list
  return list.filter((row) => active.every((column) => {
    const allowed = filters[column.key]
    return allowed.includes(tableFilterKey(column.value(row)))
  }))
}

const driverTableColumns = [
  { key: 'username', label: '姓名', value: d => d.username || '' },
  { key: 'email', label: '電子信箱', value: d => d.email || '' },
  { key: 'provider', label: '服務商名稱', value: d => d.provider_username || d.provider_email || d.provider_id || '' },
]
const adminRoleFilterOptions = [
  { value: 'USER', label: '一般會員' },
  { value: 'SERVICE_PROVIDER', label: '服務商' },
  { value: 'DRIVER', label: '司機' },
  { value: 'DELIVERY_POINT', label: '交車點' },
  { value: 'EDITOR', label: '編輯' },
  { value: 'ADMIN', label: '管理員' },
]
const listingStatusFilterOptions = listingStatusOptions.map(option => ({ value: option.value, label: option.label }))
const reservationStageFilterOptions = reservationStatusOptions.map(option => ({ value: option.value, label: option.label.split('（')[0] }))
const ticketStateFilterOptions = [
  { value: 'available', label: '可用' },
  { value: 'used', label: '已使用' },
  { value: 'expired', label: '已過期' },
]
const orderStatusFilterOptions = orderPaymentStatuses.map(value => ({ value, label: value }))
const userTableColumns = [
  { key: 'id', label: '編號', value: u => u.id || '', fields: [{ key: 'id', label: '編號包含', type: 'text' }] },
  { key: 'username', label: '名稱', value: u => u.username || '', fields: [{ key: 'username', label: '名稱包含', type: 'text' }] },
  { key: 'email', label: '電子信箱', value: u => u.email || '', fields: [{ key: 'email', label: '電子信箱包含', type: 'text' }] },
  {
    key: 'role',
    label: '角色',
    value: u => [roleLabel(u.role || 'USER'), u.isVip ? 'VIP' : ''].filter(Boolean).join(' / '),
    fields: [
      { key: 'roles', label: '角色', type: 'multi', options: adminRoleFilterOptions },
      { key: 'vip', label: 'VIP 狀態', type: 'select', options: [{ value: '1', label: 'VIP' }, { value: '0', label: '非 VIP' }] },
    ],
  },
  {
    key: 'createdAt',
    label: '建立時間',
    value: u => tableDateText(u.created_at || u.createdAt),
    fields: [
      { key: 'createdFrom', label: '開始日期', type: 'date' },
      { key: 'createdTo', label: '結束日期', type: 'date' },
    ],
  },
]
const eventTableColumns = [
  { key: 'id', label: '編號', value: e => e.id || '', fields: [{ key: 'id', label: '編號包含', type: 'text' }] },
  {
    key: 'name',
    label: '名稱',
    value: e => [e.name || e.title || '', e.code || '', listingStatusLabel(e.listing_status), eventIsExclusive(e) ? '獨佔' : ''].filter(Boolean).join(' / '),
    fields: [
      { key: 'name', label: '名稱或代碼包含', type: 'text' },
      { key: 'listingStatuses', label: '上架狀態', type: 'multi', options: listingStatusFilterOptions },
      { key: 'exclusive', label: '獨佔狀態', type: 'select', options: [{ value: '1', label: '獨佔' }, { value: '0', label: '非獨佔' }] },
    ],
  },
  {
    key: 'date',
    label: '日期/區間',
    value: e => e.date || tableDateText(e.starts_at) || '',
    fields: [
      { key: 'startsFrom', label: '開始日期自', type: 'date' },
      { key: 'startsTo', label: '開始日期至', type: 'date' },
    ],
  },
  {
    key: 'deadline',
    label: '截止',
    value: e => tableDateText(e.deadline || e.ends_at),
    fields: [
      { key: 'deadlineFrom', label: '截止日期自', type: 'date' },
      { key: 'deadlineTo', label: '截止日期至', type: 'date' },
    ],
  },
]
const reservationTableColumns = [
  { key: 'id', label: '編號', value: r => r.id || '', fields: [{ key: 'id', label: '編號包含', type: 'text' }] },
  { key: 'user', label: '使用者', value: r => [r.username || '', r.email || ''].filter(Boolean).join(' / '), fields: [{ key: 'user', label: '姓名、Email 或編號包含', type: 'text' }] },
  { key: 'event', label: '服務檔期', value: r => r.event || '', fields: [{ key: 'event', label: '服務檔期包含', type: 'text' }] },
  { key: 'store', label: '交車點資訊', value: r => r.store || '', fields: [{ key: 'store', label: '交車點資訊包含', type: 'text' }] },
  { key: 'ticketType', label: '票種', value: r => r.ticket_type || '', fields: [{ key: 'ticketType', label: '票種包含', type: 'text' }] },
  {
    key: 'reservedAt',
    label: '預約時間',
    value: r => tableDateText(r.reserved_at),
    fields: [
      { key: 'reservedFrom', label: '開始日期', type: 'date' },
      { key: 'reservedTo', label: '結束日期', type: 'date' },
    ],
  },
  { key: 'status', label: '狀態', value: r => stageLabelMap[r.status] || r.status || '', fields: [{ key: 'statuses', label: '狀態', type: 'multi', options: reservationStageFilterOptions }] },
]
const ticketTableColumns = [
  { key: 'id', label: '票券編號', value: row => [row.id ? `#${row.id}` : '', row.uuid || ''].filter(Boolean).join(' / '), fields: [{ key: 'id', label: '編號或 UUID 包含', type: 'text' }] },
  { key: 'info', label: '票券資訊', value: row => [row.type || '', productLabel(row), row.discount ? `折扣 ${row.discount}` : ''].filter(Boolean).join(' / '), fields: [{ key: 'info', label: '票種或商品資訊包含', type: 'text' }] },
  { key: 'holder', label: '持有人', value: row => [row.username || '', row.email || ''].filter(Boolean).join(' / '), fields: [{ key: 'holder', label: '姓名、Email 或編號包含', type: 'text' }] },
  {
    key: 'createdAt',
    label: '建立時間',
    value: row => tableDateText(row.created_at),
    fields: [
      { key: 'createdFrom', label: '開始日期', type: 'date' },
      { key: 'createdTo', label: '結束日期', type: 'date' },
    ],
  },
  {
    key: 'status',
    label: '狀態',
    value: row => [row.statusLabel || ticketStatusLabel(row), row.expiryText || ''].filter(Boolean).join(' / '),
    fields: [
      { key: 'statuses', label: '票券狀態', type: 'multi', options: ticketStateFilterOptions },
      { key: 'expiryFrom', label: '到期日自', type: 'date' },
      { key: 'expiryTo', label: '到期日至', type: 'date' },
    ],
  },
]
const orderTableColumns = [
  { key: 'id', label: '編號', value: o => o.id || '', fields: [{ key: 'id', label: '編號包含', type: 'text' }] },
  { key: 'code', label: '代碼', value: o => o.code || '', fields: [{ key: 'code', label: '代碼包含', type: 'text' }] },
  {
    key: 'createdAt',
    label: '訂單時間',
    value: o => o.createdAt || tableDateText(o.created_at),
    fields: [
      { key: 'createdFrom', label: '開始日期', type: 'date' },
      { key: 'createdTo', label: '結束日期', type: 'date' },
    ],
  },
  { key: 'user', label: '使用者', value: o => [o.username || '', o.email || '', o.phone || '', o.remittanceLast5 || ''].filter(Boolean).join(' / '), fields: [{ key: 'user', label: '姓名、Email、電話或末五碼包含', type: 'text' }] },
  { key: 'content', label: '內容', value: o => {
    if (o.isReservation) {
      return [o.eventName || '', o.eventDate || '', ...(o.selections || []).map(line => [line.store, line.type, line.qty].filter(Boolean).join(' / '))].filter(Boolean).join(' / ')
    }
    return [o.ticketType || '', o.quantity ? `數量 ${o.quantity}` : '', o.total ? String(o.total) : ''].filter(Boolean).join(' / ')
  }, fields: [{ key: 'content', label: '票券、活動或交車點內容包含', type: 'text' }] },
  { key: 'status', label: '狀態', value: o => o.status || '', fields: [{ key: 'statuses', label: '訂單狀態', type: 'multi', options: orderStatusFilterOptions }] },
]
const tombstoneTableColumns = [
  { key: 'id', label: '編號', value: r => r.id || '', fields: [{ key: 'id', label: '編號包含', type: 'text' }] },
  { key: 'provider', label: '第三方平台', value: r => r.provider || '', fields: [{ key: 'providers', label: '第三方平台', type: 'multi', options: [{ value: 'google', label: 'Google' }, { value: 'line', label: 'LINE' }] }] },
  { key: 'subject', label: 'Subject', value: r => r.subject || '', fields: [{ key: 'subject', label: 'Subject 包含', type: 'text' }] },
  { key: 'email', label: '電子信箱', value: r => r.email || '', fields: [{ key: 'email', label: '電子信箱包含', type: 'text' }] },
  { key: 'reason', label: '原因', value: r => r.reason || '', fields: [{ key: 'reason', label: '原因包含', type: 'text' }] },
  {
    key: 'createdAt',
    label: '建立時間',
    value: r => tableDateText(r.created_at),
    fields: [
      { key: 'createdFrom', label: '開始日期', type: 'date' },
      { key: 'createdTo', label: '結束日期', type: 'date' },
    ],
  },
]

const userTextFilteredUsers = computed(() => {
  return users.value
})

const filteredUsers = computed(() => applyTableFilters(userTextFilteredUsers.value, 'users', userTableColumns))
const filteredProviderDrivers = computed(() => applyTableFilters(providerDrivers.value, 'drivers', driverTableColumns))

const eventTextFilteredEvents = computed(() => {
  return events.value
})

const filteredEvents = computed(() => applyTableFilters(eventTextFilteredEvents.value, 'events', eventTableColumns))

const orderTextFilteredOrders = computed(() => {
  return adminOrders.value
})

const filteredAdminOrders = computed(() => applyTableFilters(orderTextFilteredOrders.value, 'orders', orderTableColumns))
const filteredAdminTickets = computed(() => applyTableFilters(adminTickets.value, 'tickets', ticketTableColumns))
const filteredTombstones = computed(() => applyTableFilters(tombstones.value, 'tombstones', tombstoneTableColumns))
const hasUserFilters = computed(() => !!userQuery.value.trim() || tableHasActiveFilters('users'))
const hasDriverFilters = computed(() => tableHasActiveFilters('drivers'))
const hasEventFilters = computed(() => !!eventQuery.value.trim() || tableHasActiveFilters('events'))
const hasTombstoneFilters = computed(() => {
  return !!(tombstoneFilters.value?.provider || tombstoneFilters.value?.subject || tombstoneFilters.value?.email)
    || tableHasActiveFilters('tombstones')
})

watch(userQuery, () => scheduleListSearch('users', () => performUserSearch()), { flush: 'sync' })
watch(eventQuery, () => scheduleListSearch('events', () => performEventSearch()), { flush: 'sync' })
watch(orderQuery, () => {
  clearOrderSelection()
  scheduleListSearch('orders', () => performOrderSearch())
}, { flush: 'sync' })
watch(reservationQuery, () => scheduleListSearch('reservations', () => performReservationSearch()), { flush: 'sync' })
watch(ticketQuery, () => scheduleListSearch('tickets', () => performTicketSearch({ forceSummary: false })), { flush: 'sync' })
watch(tombstoneFilters, () => {
  if (suppressTombstoneQuickFilterWatch) return
  applyTombstoneQuickFiltersToColumns()
  tombstonesLegacyKnownTotal.value = null
  scheduleListSearch('tombstones', () => {
    tombstonesMeta.offset = 0
    loadTombstones({ offset: 0, resetLegacyTotal: true })
  })
}, { deep: true, flush: 'sync' })

const normalizeOrderSelectionId = (id) => String(id ?? '').trim()
const selectedOrderIdSet = computed(() => new Set(selectedOrderIds.value.map(normalizeOrderSelectionId).filter(Boolean)))
const visibleOrderIds = computed(() => filteredAdminOrders.value.map(o => normalizeOrderSelectionId(o.id)).filter(Boolean))
const selectedAdminOrders = computed(() => adminOrders.value.filter(o => selectedOrderIdSet.value.has(normalizeOrderSelectionId(o.id))))
const selectedOrderCount = computed(() => selectedAdminOrders.value.length)
const selectedVisibleOrderCount = computed(() => visibleOrderIds.value.filter(id => selectedOrderIdSet.value.has(id)).length)
const allVisibleOrdersSelected = computed(() => visibleOrderIds.value.length > 0 && selectedVisibleOrderCount.value === visibleOrderIds.value.length)

function isOrderSelected(order) {
  return selectedOrderIdSet.value.has(normalizeOrderSelectionId(order?.id))
}
function toggleOrderSelection(order, checked) {
  const id = normalizeOrderSelectionId(order?.id)
  if (!id) return
  if (checked) {
    if (!selectedOrderIdSet.value.has(id)) selectedOrderIds.value = [...selectedOrderIds.value, id]
  } else {
    selectedOrderIds.value = selectedOrderIds.value.filter(item => normalizeOrderSelectionId(item) !== id)
  }
}
function toggleVisibleOrderSelection(checked) {
  if (checked) {
    const merged = new Set(selectedOrderIds.value.map(normalizeOrderSelectionId).filter(Boolean))
    visibleOrderIds.value.forEach(id => merged.add(id))
    selectedOrderIds.value = Array.from(merged)
  } else {
    const visible = new Set(visibleOrderIds.value)
    selectedOrderIds.value = selectedOrderIds.value.filter(id => !visible.has(normalizeOrderSelectionId(id)))
  }
}
function clearOrderSelection() {
  selectedOrderIds.value = []
}

watch(orderStatusFilter, () => {
  clearOrderSelection()
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
  cancelScheduledListSearch('users')
  usersMeta.offset = 0
  loadUsers({ offset: 0 })
}
async function clearUserFilters() {
  if (usersLoading.value) return
  userQuery.value = ''
  clearTableFilters('users')
  cancelScheduledListSearch('users')
  usersMeta.offset = 0
  await loadUsers({ offset: 0 })
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
  cancelScheduledListSearch('events')
  eventsMeta.offset = 0
  loadEvents({ offset: 0 })
}
async function clearEventFilters() {
  if (eventsLoading.value) return
  eventQuery.value = ''
  clearTableFilters('events')
  cancelScheduledListSearch('events')
  eventsMeta.offset = 0
  await loadEvents({ offset: 0 })
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
  cancelScheduledListSearch('orders')
  adminOrdersMeta.offset = 0
  loadOrders({ offset: 0 })
}
function setOrderStatusFilter(value) {
  const next = orderPaymentStatuses.includes(value) ? value : 'all'
  orderStatusFilter.value = next
  if (next === 'all') delete tableFilters.orders.status
  else tableFilters.orders.status = { statuses: [next] }
  adminOrdersMeta.offset = 0
  clearOrderSelection()
  if (tab.value === 'orders') loadOrders({ offset: 0 })
}
const hasOrderFilters = computed(() => {
  return orderStatusFilter.value !== 'all' || orderQuery.value.trim().length > 0 || tableHasActiveFilters('orders')
})
async function clearOrderFilters() {
  if (ordersLoading.value) return
  orderStatusFilter.value = 'all'
  orderQuery.value = ''
  clearTableFilters('orders')
  cancelScheduledListSearch('orders')
  adminOrdersMeta.offset = 0
  await loadOrders({ offset: 0 })
}

const reservationTextFilteredReservations = computed(() => {
  return adminReservations.value
})
const filteredAdminReservations = computed(() => applyTableFilters(reservationTextFilteredReservations.value, 'reservations', reservationTableColumns))

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
  cancelScheduledListSearch('reservations')
  adminReservationsMeta.offset = 0
  loadAdminReservations({ offset: 0 })
}
function setReservationStatusFilter(value) {
  const allowed = new Set(reservationStatusOptions.map(option => option.value))
  const next = allowed.has(value) ? value : 'all'
  reservationStatusFilter.value = next
  if (next === 'all') delete tableFilters.reservations.status
  else tableFilters.reservations.status = { statuses: [next] }
  adminReservationsMeta.offset = 0
  if (tab.value === 'reservations') loadAdminReservations({ offset: 0 })
}
const hasReservationFilters = computed(() => {
  return reservationStatusFilter.value !== 'all' || reservationQuery.value.trim().length > 0 || tableHasActiveFilters('reservations')
})
async function clearReservationFilters() {
  if (reservationsLoading.value) return
  reservationStatusFilter.value = 'all'
  reservationQuery.value = ''
  clearTableFilters('reservations')
  cancelScheduledListSearch('reservations')
  adminReservationsMeta.offset = 0
  await loadAdminReservations({ offset: 0 })
}

function triggerEventCoverInput(id){
  const el = document.getElementById(`upload-${id}`) || document.getElementById(`upload-event-${id}`)
  if (el) el.click()
}

async function changeEventCover(ev, row){
  if (!canEditEvent(row)) return
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
  if (!canEditEvent(row)) return
  if (!(await showConfirm(`確定刪除活動「${row.name || row.title}」封面？`, { title: '刪除封面' }))) return
  try{
    const { data } = await axios.delete(`${API}/admin/events/${row.id}/cover`)
    if (data?.ok){ await showNotice('已刪除'); await loadEvents() }
    else await showNotice(data?.message || '刪除失敗', { title: '刪除失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
}

async function deleteEvent(row){
  if (!row || !row.id) return
  if (!canEditEvent(row)) return
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
  const el = document.getElementById(`upload-product-${p.id || encodeURIComponent(p.name || '')}`)
  if (el) el.click()
}

async function changeProductCover(ev, p){
  const file = ev?.target?.files?.[0]
  if (!file) return
  try{
    const { dataUrl } = await processImageToRatio(file)
    openCoverConfirm({ kind: 'product', productId: p.id || null, productType: (p.name || ''), name: (p.name || ''), dataUrl })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally { ev.target.value = '' }
}

async function deleteProductCover(p){
  if (!(await showConfirm(`確定刪除「${p.name}」封面？`, { title: '刪除封面' }))) return
  try{
    const { data } = await axios.delete(`${API}/admin/products/${p.id}/cover`)
    if (data?.ok){ await showNotice('已刪除') }
    else await showNotice(data?.message || '刪除失敗', { title: '刪除失敗' })
  } catch(e){ await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
}

const formatDate = (input) => formatDateTime(input)
const formatChecklistUploadedAt = (value) => formatDateTime(value, { fallback: '' })
const formatChecklistCompletedAt = (value) => formatDateTime(value, { fallback: '' })
const formatRange = (a,b) => formatDateTimeRange(a, b)
const formatDatePretty = (value) => {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  const pad2 = (n) => String(Math.max(0, Number(n))).padStart(2, '0')
  const m = pad2(date.getMonth() + 1)
  const d = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const mm = pad2(date.getMinutes())
  return `${m}/${d} ${hh}:${mm}`
}
async function checkSession() {
  try {
    const { data } = await axios.get(`${API}/whoami`);
    const me = data?.data || {}
    const r = normalizeFrontendRole(me.role || '')
    selfRole.value = r
    selfUserId.value = String(me.id || '')
    selfUsername.value = String(me.username || '')
    selfEmail.value = String(me.email || '')
    const allowed = ['ADMIN','SERVICE_PROVIDER','DRIVER','DELIVERY_POINT','EDITOR']
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
    offset: usersMeta.offset,
    ...buildServerTableFilterParams('users'),
  }
  const queryTrimmed = userQuery.value.trim()
  if (queryTrimmed) params.q = queryTrimmed
  const requestId = beginListRequest('users')
  usersLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/users`, { params })
    if (!isLatestListRequest('users', requestId)) return
    if (data?.ok) {
      const payload = data.data || {}
      const itemsRaw = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : [])
      users.value = itemsRaw.map(u => {
        const role = String(u.role || 'USER').toUpperCase()
        const isVip = !!(u.isVip ?? u.is_vip ?? u.vip)
        return {
          ...u,
          role,
          isVip,
          _newRole: role,
          _isVip: isVip,
          _saving: false,
          _edit: false,
          _username: u.username,
          _email: u.email,
          _providerId: u.provider_id || '',
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
      const summary = payload.summary || {}
      const summaryTotal = Number(summary.total ?? summary.globalTotal)
      if (Number.isFinite(summaryTotal)) usersSummary.total = Math.max(0, summaryTotal)
      else if (!queryTrimmed && !tableHasActiveFilters('users')) usersSummary.total = usersMeta.total

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
    if (!isLatestListRequest('users', requestId)) return
    if (e?.response?.status === 401) router.push('/login')
    else if (e?.response?.status === 403) await showNotice('需要管理員權限', { title: '權限不足' })
  } finally {
    if (isLatestListRequest('users', requestId)) usersLoading.value = false
  }
}

function startEditUser(u){ if (selfRole.value !== 'ADMIN') return; u._edit = true }
function cancelEditUser(u){ u._edit = false; u._username = u.username; u._email = u.email; u._isVip = !!u.isVip; u._providerId = u.provider_id || '' }
async function saveUserProfile(u){
  if (selfRole.value !== 'ADMIN') return
  const payload = {}
  if ((u._username||'') !== (u.username||'')) payload.username = u._username
  if ((u._email||'') !== (u.email||'')) payload.email = u._email
  if (!!u._isVip !== !!u.isVip) payload.isVip = !!u._isVip
  const nextRole = String(u._newRole || '').toUpperCase()
  const roleChanged = nextRole !== String(u.role || 'USER').toUpperCase()
  const currentProviderId = String(u.provider_id || '').trim()
  const nextProviderId = String(u._providerId || '').trim()
  if (allowsProviderBinding(nextRole)) {
    if (nextProviderId !== currentProviderId) payload.providerId = nextProviderId || null
  } else if (currentProviderId) {
    payload.providerId = null
  }
  if (!Object.keys(payload).length && !roleChanged) { u._edit = false; return }
  u._saving = true
  try{
    // 先更新角色，後更新基本資料（或反之），確保部分成功也能提示
    if (roleChanged){
      const role = nextRole
      if (!['USER','SERVICE_PROVIDER','DRIVER','DELIVERY_POINT','STORE','ADMIN','EDITOR'].includes(role)) throw new Error('角色不正確')
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
  const msg = `確定刪除使用者「${name}」？此動作將一併刪除該用戶的訂單、預約、票券與轉贈紀錄，並同步隱藏或刪除交車點、活動服務、商品等帳號關聯資訊。`
  if (!(await showConfirm(msg, { title: '刪除使用者' }))) return
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
  productsLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/products`)
    const list = Array.isArray(data?.data) ? data.data : []
    products.value = list.map(p => ({
      ...p,
      price: Number(p.price),
      code: p.code || (p?.id != null ? `PD${String(p.id).padStart(6,'0')}` : ''),
      listing_status: normalizeListingStatus(p.listing_status)
    }))
    productsLoaded.value = true
  } finally { productsLoading.value = false }
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
    offset: eventsMeta.offset,
    ...buildServerTableFilterParams('events'),
  }
  const queryTrimmed = eventQuery.value.trim()
  if (queryTrimmed) params.q = queryTrimmed
  const requestId = beginListRequest('events')
  eventsLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/events`, { params })
    if (!isLatestListRequest('events', requestId)) return
    if (data?.ok) {
      const payload = data.data || {}
      const itemsRaw = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : [])
      events.value = itemsRaw.map(e => ({
        ...e,
        code: e.code || `EV${String(e.id).padStart(6, '0')}`,
        is_exclusive: eventIsExclusive(e) ? 1 : 0,
        listing_status: normalizeListingStatus(e.listing_status),
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
      const summary = payload.summary || {}
      const summaryTotal = Number(summary.total ?? summary.globalTotal)
      if (Number.isFinite(summaryTotal)) eventsSummary.total = Math.max(0, summaryTotal)
      else if (!queryTrimmed && !tableHasActiveFilters('events')) eventsSummary.total = eventsMeta.total

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
  } catch (e) {
    if (!isLatestListRequest('events', requestId)) return
    await showNotice(e?.response?.data?.message || e.message, { title: '讀取活動失敗' })
  } finally {
    if (isLatestListRequest('events', requestId)) eventsLoading.value = false
  }
}

const hasPriceValue = (value) => value !== undefined && value !== null && String(value).trim() !== '' && Number.isFinite(Number(value))
const normalizePriceValue = (value) => hasPriceValue(value) ? Math.max(0, Number(value)) : null
const priceStageText = (entry = {}) => {
  const parts = []
  if (hasPriceValue(entry.normal)) parts.push(`原價 ${formatCurrency(entry.normal)}`)
  if (hasPriceValue(entry.early)) parts.push(`早鳥 ${formatCurrency(entry.early)}`)
  return parts.join('｜') || '尚未設定價格'
}

function toPricesMap(items){
  const m = {}
  for (const it of items) {
    const type = String(it.type || '').trim()
    if (!type) continue
    const normal = normalizePriceValue(it.normal)
    const early = normalizePriceValue(it.early)
    if (normal === null && early === null) continue
    const entry = {}
    if (normal !== null) entry.normal = normal
    if (early !== null) entry.early = early
    const earlyStart = normalizeDT(it.early_start || it.earlyStart || '')
    const earlyEnd = normalizeDT(it.early_end || it.earlyEnd || '')
    if (earlyStart) entry.early_start = earlyStart
    if (earlyEnd) entry.early_end = earlyEnd
    const productId = readProductId(it)
    entry.product_id = productId || null
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
      normal: hasPriceValue(v.normal) ? Number(v.normal) : '',
      early: hasPriceValue(v.early) ? Number(v.early) : '',
      early_start: toDatetimeLocal(v.early_start || v.earlyStart || ''),
      early_end: toDatetimeLocal(v.early_end || v.earlyEnd || ''),
      productId: productId ? String(productId) : UNBOUND_PRODUCT_OPTION
    })
  }
  return arr.length ? arr : [createPriceItem()]
}
const parsePreviewPricesMap = (raw) => {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}
const normalizeEventPreviewStore = (store = {}) => {
  const prices = {}
  const rawPrices = parsePreviewPricesMap(store.prices)
  Object.keys(rawPrices).forEach(type => {
    const entry = rawPrices[type] || {}
    const info = {
      early_start: entry.early_start || entry.earlyStart || '',
      early_end: entry.early_end || entry.earlyEnd || ''
    }
    if (hasPriceValue(entry.normal)) info.normal = Number(entry.normal)
    if (hasPriceValue(entry.early)) info.early = Number(entry.early)
    const productId = readProductId(entry)
    if (productId) info.product_id = productId
    prices[type] = info
  })
  const isActive = store.is_active == null ? true : Number(store.is_active) !== 0
  return {
    ...store,
    is_active: isActive,
    delivery_point_id: store.delivery_point_id == null ? '' : String(store.delivery_point_id),
    capacity: store.capacity == null ? '' : String(store.capacity),
    name: store.name || (store.id ? `交車點 #${store.id}` : '未命名交車點'),
    address: store.address || '',
    external_url: store.external_url || store.externalUrl || '',
    business_hours: store.business_hours || store.businessHours || '',
    prices
  }
}
const eventPreviewStores = computed(() => {
  return (eventPreview.value.stores || []).filter(store => store && store.is_active !== false)
})
const eventPreviewStorePriceEntries = (store = {}) => {
  return Object.keys(store.prices || {}).map(type => ({
    type,
    ...(store.prices[type] || {})
  })).filter(item => String(item.type || '').trim())
}
const closeEventPreview = () => {
  eventPreview.value = createEventPreviewState()
}
async function openEventPreview(event) {
  if (!event) return
  const previewEvent = {
    ...event,
    code: eventDisplayCode(event),
    listing_status: normalizeListingStatus(event.listing_status)
  }
  eventPreview.value = {
    ...createEventPreviewState(),
    visible: true,
    event: previewEvent,
    loading: !!previewEvent.id
  }
  if (!previewEvent.id) return
  try {
    const { data } = await axios.get(`${API}/admin/events/${previewEvent.id}/stores`)
    const list = Array.isArray(data?.data) ? data.data : []
    if (Number(eventPreview.value.event?.id) !== Number(previewEvent.id)) return
    eventPreview.value = {
      ...eventPreview.value,
      stores: list.map(normalizeEventPreviewStore),
      loading: false,
      error: ''
    }
  } catch (e) {
    if (Number(eventPreview.value.event?.id) !== Number(previewEvent.id)) return
    eventPreview.value = {
      ...eventPreview.value,
      stores: [],
      loading: false,
      error: e?.response?.data?.message || e.message || '讀取交車點資訊失敗'
    }
  }
}
const clearStoreEditingState = () => {
  eventStores.value.forEach(store => { if (store && store._editing) delete store._editing })
}
const openStoreCreatePanel = () => {
  editingStore.value = null
  clearStoreEditingState()
  storeManagerMode.value = 'create'
}
const backToStoreList = () => {
  if (editingStore.value?._editing) delete editingStore.value._editing
  editingStore.value = null
  clearStoreEditingState()
  storeManagerMode.value = 'list'
}

async function loadEventStores(eventId){
  storeLoading.value = true
  try{
    logBindingDebug('frontend:event-stores-list:start', {
      api: `${API}/admin/events/${eventId}/stores`,
      self: { id: selfUserId.value, role: selfRole.value, email: selfEmail.value },
      eventId,
    })
    const { data } = await axios.get(`${API}/admin/events/${eventId}/stores`)
    const list = Array.isArray(data?.data) ? data.data : []
    logBindingDebug('frontend:event-stores-list:response', {
      ok: data?.ok,
      message: data?.message,
      count: list.length,
      items: list.map(store => ({ id: store?.id, delivery_point_id: store?.delivery_point_id, owner_user_id: store?.owner_user_id, name: store?.name, is_active: store?.is_active })),
	    })
	    eventStores.value = list.map(store => {
      const pricesNormalized = {}
      const rawPrices = store?.prices || {}
      Object.keys(rawPrices).forEach(type => {
        const entry = rawPrices[type] || {}
        const info = {
          early_start: entry.early_start || entry.earlyStart || '',
          early_end: entry.early_end || entry.earlyEnd || ''
        }
        if (hasPriceValue(entry.normal)) info.normal = Number(entry.normal)
        if (hasPriceValue(entry.early)) info.early = Number(entry.early)
        const productId = readProductId(entry)
        info.product_id = productId || null
        pricesNormalized[type] = info
      })
	      return {
	        ...store,
	        delivery_point_id: store.delivery_point_id == null ? '' : String(store.delivery_point_id),
	        capacity: store.capacity == null ? '' : String(store.capacity),
	        address: store.address || '',
        external_url: store.external_url || store.externalUrl || '',
        business_hours: store.business_hours || store.businessHours || '',
        remittance: createRemittanceFormState(store.remittance || store),
        prices: pricesNormalized
      }
    })
  } catch(e){ logBindingError('frontend:event-stores-list:error', e, { eventId }); await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ storeLoading.value = false }
}

async function loadDeliveryPoints(options = {}) {
  deliveryPointsLoading.value = true
  deliveryPointsError.value = ''
  try {
    logBindingDebug('frontend:load-delivery-points:start', {
      api: `${API}/admin/delivery-points`,
      self: { id: selfUserId.value, role: selfRole.value, email: selfEmail.value },
      options,
    })
    const { data } = await axios.get(`${API}/admin/delivery-points`)
    logBindingDebug('frontend:load-delivery-points:response', {
      ok: data?.ok,
      message: data?.message,
      count: Array.isArray(data?.data) ? data.data.length : 0,
      items: (Array.isArray(data?.data) ? data.data : []).map(item => ({
        id: item?.id,
        name: item?.name,
        binding_id: item?.binding_id,
        binding_status: item?.binding_status,
        binding_raw_status: item?.binding_raw_status,
        binding_provider_user_id: item?.binding_provider_user_id,
      })),
    })
    if (data?.ok) {
      deliveryPoints.value = Array.isArray(data.data) ? data.data : []
    } else {
      deliveryPoints.value = []
      deliveryPointsError.value = data?.message || '讀取交車點清單失敗'
      if (!options.silent) await showNotice(data?.message || '讀取交車點清單失敗', { title: '錯誤' })
    }
  } catch (e) {
    logBindingError('frontend:load-delivery-points:error', e, {
      self: { id: selfUserId.value, role: selfRole.value, email: selfEmail.value },
    })
    deliveryPoints.value = []
    deliveryPointsError.value = e?.response?.data?.message || e.message || '讀取交車點清單失敗'
    if (!options.silent) await showNotice(deliveryPointsError.value, { title: '讀取交車點清單失敗' })
  } finally {
    deliveryPointsLoading.value = false
  }
}

function openStoreManager(e){
  selectedEvent.value = e
  storeManagerMode.value = 'list'
  editingStore.value = null
  clearStoreEditingState()
  resetEventDriverAssignment()
  loadEventStores(e.id)
  loadProducts()
  loadDeliveryPoints({ silent: true })
  if (canManageEventDriverAssignment.value) {
    fetchProviderDrivers().catch(() => {})
    loadEventDriverAssignment(e.id).catch(() => {})
  }
}
function closeStoreManager(){
  selectedEvent.value = null
  deliveryPointsError.value = ''
  storeManagerMode.value = 'list'
  editingStore.value = null
  clearStoreEditingState()
  resetEventDriverAssignment()
}
function addPriceItem(){ newStore.value.priceItems.push(createPriceItem()) }
function resetNewStore(){ newStore.value = defaultStoreForm() }
function validateEventStoreForm(form = {}) {
  const capacityRaw = String(form.capacity ?? '').trim()
  if (capacityRaw && !normalizeStoreCapacityInput(capacityRaw)) {
    return '數量上限請輸入正整數，或留空代表不限制'
  }
  const invalid = (form.priceItems || []).find(item => String(item.type || '').trim() && !hasPriceValue(item.normal) && !hasPriceValue(item.early))
  if (invalid) {
    return '每個方案項目至少需設定原價或早鳥價'
  }
  const missingEarlyStart = (form.priceItems || []).find(item => {
    if (!String(item.type || '').trim() || !hasPriceValue(item.early)) return false
    return !normalizeDT(item.early_start || item.earlyStart || '')
  })
  if (missingEarlyStart) {
    return '設定早鳥價時，請填寫早鳥開始日'
  }
  const missingProductSelection = (form.priceItems || []).find(item => {
    if (!String(item.type || '').trim()) return false
    if (!hasPriceValue(item.normal) && !hasPriceValue(item.early)) return false
    const raw = item.productId ?? item.product_id
    return raw === undefined || raw === null || String(raw).trim() === ''
  })
  if (missingProductSelection) {
    return '請選擇綁定商品，或選擇未綁定商品'
  }
  const prices = toPricesMap(form.priceItems || [])
  if (!Object.keys(prices).length) {
    return '請至少設定一個方案項目價格'
  }
  return ''
}
async function createStore(){
  if (!selectedEvent.value) return
  logBindingDebug('frontend:event-store-create:validate-start', {
    self: { id: selfUserId.value, role: selfRole.value, email: selfEmail.value },
    selectedEventId: selectedEvent.value?.id,
    deliveryPointsLoading: deliveryPointsLoading.value,
    deliveryPointsError: deliveryPointsError.value,
    deliveryPointsCount: deliveryPoints.value.length,
    selectedDeliveryPointId: newStore.value.delivery_point_id,
    availableDeliveryPoints: deliveryPoints.value.map(point => ({ id: point?.id, name: point?.name, binding_id: point?.binding_id, binding_status: point?.binding_status, binding_raw_status: point?.binding_raw_status, binding_provider_user_id: point?.binding_provider_user_id })),
  })
  if (deliveryPointsLoading.value) { await showNotice('交車點清單仍在載入中，請稍候再試', { title: '請稍候' }); return }
  if (deliveryPointsError.value) { await showNotice(deliveryPointsError.value, { title: '交車點清單載入失敗' }); return }
  if (!deliveryPoints.value.length) { await showNotice('目前沒有已核准綁定的交車點，請先到「設定 > 交車點綁定」核准申請。', { title: '尚無可用交車點' }); return }
  const deliveryPointId = String(newStore.value.delivery_point_id || '').trim()
  if (!deliveryPointId) { await showNotice('請選擇交車點帳號', { title: '格式錯誤' }); return }
  if (!findDeliveryPointById(deliveryPointId)) { await showNotice('交車點帳號不存在，請重新整理後再試', { title: '格式錯誤' }); return }
  const validationMessage = validateEventStoreForm(newStore.value)
  if (validationMessage) { await showNotice(validationMessage, { title: '格式錯誤' }); return }
  storeLoading.value = true
  try{
	    const prices = toPricesMap(newStore.value.priceItems)
	    const payload = {
	      deliveryPointId,
	      capacity: normalizeStoreCapacityInput(newStore.value.capacity),
	      prices,
	    }
    logBindingDebug('frontend:event-store-create:request', {
      api: `${API}/admin/events/${selectedEvent.value.id}/stores`,
      payload,
    })
    const { data } = await axios.post(`${API}/admin/events/${selectedEvent.value.id}/stores`, payload)
    logBindingDebug('frontend:event-store-create:response', { ok: data?.ok, message: data?.message, data: data?.data })
    if (data?.ok){ resetNewStore(); await loadEventStores(selectedEvent.value.id); storeManagerMode.value = 'list' }
    else await showNotice(data?.message || '新增失敗', { title: '新增失敗' })
  } catch(e){ logBindingError('frontend:event-store-create:error', e, { selectedEventId: selectedEvent.value?.id, payloadDeliveryPointId: newStore.value.delivery_point_id }); await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
  finally{ storeLoading.value = false }
}

function startEditStore(s){
  eventStores.value.forEach(store => { if (store && store !== s && store._editing) delete store._editing })
	  s._editing = {
	    delivery_point_id: s.delivery_point_id == null ? '' : String(s.delivery_point_id),
	    capacity: s.capacity == null ? '' : String(s.capacity),
	    priceItems: fromPricesMap(s.prices || {}),
	  }
  editingStore.value = s
  storeManagerMode.value = 'edit'
}
function cancelEditStore(s){
  if (s?._editing) delete s._editing
  if (editingStore.value?.id === s?.id) editingStore.value = null
  storeManagerMode.value = 'list'
}
async function saveEditStore(s){
  if (!s?._editing) return
  logBindingDebug('frontend:event-store-update:validate-start', {
    self: { id: selfUserId.value, role: selfRole.value, email: selfEmail.value },
    storeId: s?.id,
    deliveryPointsLoading: deliveryPointsLoading.value,
    deliveryPointsError: deliveryPointsError.value,
    deliveryPointsCount: deliveryPoints.value.length,
    currentDeliveryPointId: s?.delivery_point_id,
    nextDeliveryPointId: s?._editing?.delivery_point_id,
    availableDeliveryPoints: deliveryPoints.value.map(point => ({ id: point?.id, name: point?.name, binding_id: point?.binding_id, binding_status: point?.binding_status, binding_raw_status: point?.binding_raw_status, binding_provider_user_id: point?.binding_provider_user_id })),
  })
  if (deliveryPointsLoading.value) { await showNotice('交車點清單仍在載入中，請稍候再試', { title: '請稍候' }); return }
  if (deliveryPointsError.value) { await showNotice(deliveryPointsError.value, { title: '交車點清單載入失敗' }); return }
  if (!deliveryPoints.value.length) { await showNotice('目前沒有已核准綁定的交車點，請先到「設定 > 交車點綁定」核准申請。', { title: '尚無可用交車點' }); return }
  const validationMessage = validateEventStoreForm(s._editing)
  if (validationMessage) {
    await showNotice(validationMessage, { title: '格式錯誤' })
    return
  }
  const body = {}
  const nextDeliveryPointId = String(s._editing.delivery_point_id || '').trim()
  if (!nextDeliveryPointId) {
    await showNotice('請選擇交車點帳號', { title: '格式錯誤' })
    return
  }
  if (!findDeliveryPointById(nextDeliveryPointId)) {
    await showNotice('交車點帳號不存在，請重新整理後再試', { title: '格式錯誤' })
    return
  }
	  if (String(s._editing.delivery_point_id || '') !== String(s.delivery_point_id || '')) body.deliveryPointId = s._editing.delivery_point_id || null
	  const nextCapacity = normalizeStoreCapacityInput(s._editing.capacity)
	  const currentCapacity = normalizeStoreCapacityInput(s.capacity)
	  if (nextCapacity !== currentCapacity) body.capacity = nextCapacity
	  const nextPrices = toPricesMap(s._editing.priceItems || [])
  if (JSON.stringify(nextPrices) !== JSON.stringify(s.prices || {})) body.prices = nextPrices
  if (!Object.keys(body).length) { delete s._editing; return }
  storeLoading.value = true
  try{
    logBindingDebug('frontend:event-store-update:request', {
      api: `${API}/admin/events/stores/${s.id}`,
      body,
    })
    const { data } = await axios.patch(`${API}/admin/events/stores/${s.id}`, body)
    logBindingDebug('frontend:event-store-update:response', { ok: data?.ok, message: data?.message, data: data?.data })
    if (data?.ok){ await loadEventStores(selectedEvent.value.id); editingStore.value = null; storeManagerMode.value = 'list' }
    else await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
  } catch(e){ logBindingError('frontend:event-store-update:error', e, { storeId: s?.id, body }); await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' }) }
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
  // A new page/query must never retain batch selections from hidden rows.
  clearOrderSelection()
  if (options && typeof options.offset === 'number' && Number.isFinite(options.offset)) {
    adminOrdersMeta.offset = Math.max(0, Math.floor(options.offset))
  }
  if (options && typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    adminOrdersMeta.limit = Math.max(1, Math.min(200, Math.floor(options.limit)))
  }
  const params = {
    limit: adminOrdersMeta.limit,
    offset: adminOrdersMeta.offset,
    ...buildServerTableFilterParams('orders'),
  }
  const queryTrimmed = orderQuery.value.trim()
  if (queryTrimmed) params.q = queryTrimmed
  if (!params.statuses && orderStatusFilter.value !== 'all') params.statuses = orderStatusFilter.value
  const requestId = beginListRequest('orders')
  ordersLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/orders`, { params })
    if (!isLatestListRequest('orders', requestId)) return
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
      const summary = payload.summary || {}
      const summaryTotal = Number(summary.total ?? summary.globalTotal)
      if (Number.isFinite(summaryTotal)) adminOrdersSummary.total = Math.max(0, summaryTotal)
      else if (!queryTrimmed && !tableHasActiveFilters('orders') && orderStatusFilter.value === 'all') adminOrdersSummary.total = adminOrdersMeta.total
      const byStatus = summary.byStatus && typeof summary.byStatus === 'object'
        ? summary.byStatus
        : Object.fromEntries(orderPaymentStatuses.map(status => [status, Number(summary[status] || 0)]))
      adminOrdersSummary.byStatus = Object.fromEntries(Object.entries(byStatus).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]))

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
      const addOns = orderAddOnItems(details)
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
      const status = normalizeOrderPaymentStatus(details.status || '處理中')
      const phone = o.phone != null ? String(o.phone).trim() : ''
      const remittanceLast5 = o.remittance_last5 != null ? String(o.remittance_last5).trim() : ''
      const userRole = String(o.user_role || o.userRole || o.role || 'USER').trim().toUpperCase()
      const isVip = !!(o.isVip ?? o.is_vip ?? o.vip)
      const base = {
        id: o.id,
        code: o.code || '',
        details,
        username: o.username || '',
        email: o.email || '',
        userRole,
        isVip,
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
        addOns,
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
	    const loadedOrderIds = new Set(adminOrders.value.map(o => normalizeOrderSelectionId(o.id)).filter(Boolean))
	    selectedOrderIds.value = selectedOrderIds.value.filter(id => loadedOrderIds.has(normalizeOrderSelectionId(id)))
	    ordersLoaded.value = true
	  } catch (e) {
    if (!isLatestListRequest('orders', requestId)) return
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    if (isLatestListRequest('orders', requestId)) ordersLoading.value = false
  }
}

async function loadDriverTasks(){
  driverTasksLoading.value = true
  try {
    const { data } = await axios.get(`${API}/tasks/me`)
    if (data?.ok) {
      const itemsRaw = Array.isArray(data.data) ? data.data : []
      driverTasks.value = itemsRaw.map(mapAdminReservation).filter(Boolean)
    } else {
      driverTasks.value = []
    }
  } catch (e) {
    driverTasks.value = []
    await showNotice(e?.response?.data?.message || e.message, { title: '載入任務失敗' })
  } finally {
    driverTasksLoading.value = false
  }
}

const startDriverScan = async (task) => {
  if (!task?.stage_verify_code) {
    await showNotice('此任務尚無可用驗證碼', { title: '無法掃描' })
    return
  }
  if (!scan.value.open) openScan()
  scan.value.manual = task.stage_verify_code
  await submitManual()
  tab.value = 'scan'
}

function applyDeliveryPointProfile(payload = {}) {
  const next = createDeliveryPointProfileState(payload)
  deliveryPointProfileForm.name = next.name
  deliveryPointProfileForm.address = next.address
  deliveryPointProfileForm.phone = next.phone
  deliveryPointProfileForm.external_url = next.external_url
  deliveryPointProfileForm.business_hours = next.business_hours
  deliveryPointProfileForm.capacity = next.capacity
  deliveryPointProfileOriginal.value = deliveryPointProfileSnapshot()
}

async function loadDeliveryPointProfile() {
  if (!settingsTabs.value.some(t => t.key === 'delivery-point')) return
  deliveryPointProfileLoading.value = true
  try {
    const { data } = await axios.get(`${API}/delivery-point/me`)
    if (data?.ok) applyDeliveryPointProfile(data.data || {})
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '讀取交車點資訊失敗' })
  } finally {
    deliveryPointProfileLoading.value = false
  }
}

async function saveDeliveryPointProfile() {
  if (!settingsTabs.value.some(t => t.key === 'delivery-point')) return
  deliveryPointProfileSaving.value = true
  try {
    const capacityRaw = String(deliveryPointProfileForm.capacity || '').trim()
    const capacity = capacityRaw ? Math.floor(Number(capacityRaw)) : null
    if (capacityRaw && (!Number.isFinite(Number(capacityRaw)) || capacity <= 0)) {
      await showNotice('收容數量請輸入正整數，或留空代表不限制', { title: '格式錯誤' })
      return
    }
    const payload = {
      name: (deliveryPointProfileForm.name || '').trim(),
      address: (deliveryPointProfileForm.address || '').trim() || null,
      phone: normalizePhoneValue(deliveryPointProfileForm.phone || '') || null,
      external_url: (deliveryPointProfileForm.external_url || '').trim() || null,
      business_hours: (deliveryPointProfileForm.business_hours || '').trim() || null,
      capacity
    }
    const { data } = await axios.patch(`${API}/delivery-point/me`, payload)
    if (data?.ok) {
      applyDeliveryPointProfile(data.data || payload)
      await showNotice('交車點資訊已更新')
    } else {
      await showNotice(data?.message || '更新交車點資訊失敗', { title: '更新失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '更新交車點資訊失敗' })
  } finally {
    deliveryPointProfileSaving.value = false
  }
}

async function loadDeliveryPointProviderBindings() {
  if (!settingsTabs.value.some(t => t.key === 'delivery-point')) return
  deliveryPointProviderBindingsLoading.value = true
  try {
    logBindingDebug('frontend:delivery-point-bindings:start', {
      api: `${API}/delivery-point/provider-bindings`,
      self: { id: selfUserId.value, role: selfRole.value, email: selfEmail.value },
    })
    const { data } = await axios.get(`${API}/delivery-point/provider-bindings`)
    logBindingDebug('frontend:delivery-point-bindings:response', {
      ok: data?.ok,
      message: data?.message,
      count: Array.isArray(data?.data) ? data.data.length : 0,
      items: (Array.isArray(data?.data) ? data.data : []).map(item => ({
        id: item?.id,
        delivery_point_id: item?.delivery_point_id,
        provider_user_id: item?.provider_user_id,
        provider_email: item?.provider?.email,
        status: item?.status,
        raw_status: item?.raw_status,
      })),
    })
    if (data?.ok) {
      deliveryPointProviderBindings.value = Array.isArray(data.data) ? data.data : []
    } else {
      deliveryPointProviderBindings.value = []
      await showNotice(data?.message || '讀取服務商綁定資料失敗', { title: '錯誤' })
    }
  } catch (e) {
    logBindingError('frontend:delivery-point-bindings:error', e, {
      self: { id: selfUserId.value, role: selfRole.value, email: selfEmail.value },
    })
    deliveryPointProviderBindings.value = []
    await showNotice(e?.response?.data?.message || e.message, { title: '讀取服務商綁定資料失敗' })
  } finally {
    deliveryPointProviderBindingsLoading.value = false
  }
}

async function searchDeliveryPointProviders() {
  const query = String(deliveryPointProviderQuery.value || '').trim()
  if (!query) {
    deliveryPointProviderOptions.value = []
    return
  }
  deliveryPointProviderSearchLoading.value = true
  try {
    logBindingDebug('frontend:search-providers:start', {
      api: `${API}/delivery-point/providers`,
      query,
      self: { id: selfUserId.value, role: selfRole.value, email: selfEmail.value },
    })
    const { data } = await axios.get(`${API}/delivery-point/providers`, { params: { q: query, limit: 20 } })
    logBindingDebug('frontend:search-providers:response', {
      ok: data?.ok,
      message: data?.message,
      count: Array.isArray(data?.data) ? data.data.length : 0,
      items: Array.isArray(data?.data) ? data.data : [],
    })
    if (data?.ok) {
      deliveryPointProviderOptions.value = Array.isArray(data.data) ? data.data : []
    } else {
      deliveryPointProviderOptions.value = []
      await showNotice(data?.message || '搜尋服務商失敗', { title: '錯誤' })
    }
  } catch (e) {
    logBindingError('frontend:search-providers:error', e, { query })
    deliveryPointProviderOptions.value = []
    await showNotice(e?.response?.data?.message || e.message, { title: '搜尋服務商失敗' })
  } finally {
    deliveryPointProviderSearchLoading.value = false
  }
}

async function requestDeliveryPointProviderBinding(provider) {
  if (!provider?.id) return
  deliveryPointProviderBindingSaving.value = true
  try {
    logBindingDebug('frontend:request-binding:start', {
      api: `${API}/delivery-point/provider-bindings`,
      self: { id: selfUserId.value, role: selfRole.value, email: selfEmail.value },
      provider,
    })
    const { data } = await axios.post(`${API}/delivery-point/provider-bindings`, { providerId: provider.id })
    logBindingDebug('frontend:request-binding:response', {
      ok: data?.ok,
      message: data?.message,
      binding: data?.data ? {
        id: data.data.id,
        delivery_point_id: data.data.delivery_point_id,
        provider_user_id: data.data.provider_user_id,
        provider_email: data.data.provider?.email,
        status: data.data.status,
        raw_status: data.data.raw_status,
      } : null,
    })
    if (data?.ok) {
      await loadDeliveryPointProviderBindings()
      await searchDeliveryPointProviders()
      const binding = data.data || {}
      const providerName = binding.provider?.username || binding.provider?.email || provider.username || provider.email || provider.id
      const providerId = binding.provider_user_id || binding.provider?.id || provider.id
      await showNotice(`${data?.message || '已送出綁定申請'}\n服務商：${providerName}\n服務商 ID：${providerId}`)
    } else {
      await showNotice(data?.message || '送出綁定申請失敗', { title: '錯誤' })
    }
  } catch (e) {
    logBindingError('frontend:request-binding:error', e, { provider })
    await showNotice(e?.response?.data?.message || e.message, { title: '送出綁定申請失敗' })
  } finally {
    deliveryPointProviderBindingSaving.value = false
  }
}

async function updateDeliveryPointProviderBinding(item, action = 'cancel') {
  if (!item?.id) return
  const isRemove = action === 'remove'
  const confirmed = await showConfirm(
    isRemove
      ? '解除綁定後，該服務商目前綁在此交車點的活動服務會自動停用。確定要解除綁定嗎？'
      : '確定要取消這筆服務商綁定申請嗎？',
    { title: isRemove ? '解除綁定' : '取消申請' }
  ).catch(() => false)
  if (!confirmed) return
  deliveryPointProviderBindingSaving.value = true
  try {
    logBindingDebug('frontend:update-delivery-point-binding:start', {
      api: `${API}/delivery-point/provider-bindings/${item.id}`,
      action,
      item: {
        id: item?.id,
        delivery_point_id: item?.delivery_point_id,
        provider_user_id: item?.provider_user_id,
        status: item?.status,
        raw_status: item?.raw_status,
      },
    })
    const { data } = await axios.delete(`${API}/delivery-point/provider-bindings/${item.id}`)
    logBindingDebug('frontend:update-delivery-point-binding:response', {
      ok: data?.ok,
      message: data?.message,
      data: data?.data,
    })
    if (data?.ok) {
      await loadDeliveryPointProviderBindings()
      if (deliveryPointProviderQuery.value.trim()) await searchDeliveryPointProviders()
      await showNotice(data?.message || (isRemove ? '已解除綁定' : '已取消申請'))
    } else {
      await showNotice(data?.message || (isRemove ? '解除綁定失敗' : '取消申請失敗'), { title: '錯誤' })
    }
  } catch (e) {
    logBindingError('frontend:update-delivery-point-binding:error', e, { action, item })
    await showNotice(e?.response?.data?.message || e.message, { title: isRemove ? '解除綁定失敗' : '取消申請失敗' })
  } finally {
    deliveryPointProviderBindingSaving.value = false
  }
}

async function cancelDeliveryPointProviderBinding(item) {
  return updateDeliveryPointProviderBinding(item, 'cancel')
}

async function removeDeliveryPointProviderBinding(item) {
  return updateDeliveryPointProviderBinding(item, 'remove')
}

async function loadProviderDeliveryPointBindings() {
  if (!settingsTabs.value.some(t => t.key === 'delivery-point-bindings')) return
  providerDeliveryPointBindingsLoading.value = true
  providerDeliveryPointBindingsError.value = ''
  providerDeliveryPointBindingsHint.value = ''
  try {
    const selectedStatus = providerDeliveryPointBindingStatus.value
    const params = selectedStatus && selectedStatus !== 'ALL' ? { status: selectedStatus } : {}
    logBindingDebug('frontend:provider-bindings:start', {
      api: `${API}/provider/delivery-point-bindings`,
      self: { id: selfUserId.value, role: selfRole.value, email: selfEmail.value },
      selectedStatus,
      params,
    })
    const fetchBindings = async (nextParams = {}) => {
      logBindingDebug('frontend:provider-bindings:fetch', { params: nextParams })
      const { data } = await axios.get(`${API}/provider/delivery-point-bindings`, { params: nextParams })
      logBindingDebug('frontend:provider-bindings:fetch-response', {
        params: nextParams,
        ok: data?.ok,
        message: data?.message,
        count: Array.isArray(data?.data) ? data.data.length : 0,
        items: (Array.isArray(data?.data) ? data.data : []).map(item => ({
          id: item?.id,
          delivery_point_id: item?.delivery_point_id,
          provider_user_id: item?.provider_user_id,
          delivery_point_owner_user_id: item?.delivery_point?.owner_user_id,
          status: item?.status,
          raw_status: item?.raw_status,
          requested_at: item?.requested_at,
          updated_at: item?.updated_at,
        })),
      })
      if (!data?.ok) throw new Error(data?.message || '讀取交車點綁定申請失敗')
      return Array.isArray(data.data) ? data.data : []
    }
    let items = await fetchBindings(params)
    if (selectedStatus === 'PENDING' && !items.length) {
      const allItems = await fetchBindings({})
      const pendingLike = allItems.filter(item => isProviderBindingStatus(item, 'PENDING'))
      logBindingWarn('frontend:provider-bindings:pending-empty-fallback', {
        allCount: allItems.length,
        pendingLikeCount: pendingLike.length,
        allItems: allItems.map(item => ({ id: item?.id, provider_user_id: item?.provider_user_id, status: item?.status, raw_status: item?.raw_status })),
      })
      if (pendingLike.length) {
        items = pendingLike
        providerDeliveryPointBindingsHint.value = '待審核精準查詢沒有資料，但全部狀態中找到疑似待審核申請，已暫時顯示。請重新部署後端或檢查資料庫 status 欄位。'
      } else if (allItems.length) {
        items = allItems
        providerDeliveryPointBindingStatus.value = 'ALL'
        providerDeliveryPointBindingsHint.value = '目前沒有待審核申請，但此服務商有其他狀態的綁定資料，已切換為全部狀態。'
      }
    }
    providerDeliveryPointBindings.value = items
    logBindingDebug('frontend:provider-bindings:final', {
      selectedStatus: providerDeliveryPointBindingStatus.value,
      count: items.length,
      hint: providerDeliveryPointBindingsHint.value,
    })
  } catch (e) {
    logBindingError('frontend:provider-bindings:error', e, {
      selectedStatus: providerDeliveryPointBindingStatus.value,
      self: { id: selfUserId.value, role: selfRole.value, email: selfEmail.value },
    })
    providerDeliveryPointBindings.value = []
    providerDeliveryPointBindingsError.value = e?.response?.data?.message || e.message || '讀取交車點綁定申請失敗'
    await showNotice(providerDeliveryPointBindingsError.value, { title: '讀取交車點綁定申請失敗' })
  } finally {
    providerDeliveryPointBindingsLoading.value = false
  }
}

async function showAllProviderDeliveryPointBindings() {
  providerDeliveryPointBindingStatus.value = 'ALL'
  await loadProviderDeliveryPointBindings()
}

async function loadAdminDeliveryPointBindings() {
  if (!settingsTabs.value.some(t => t.key === 'delivery-point-bindings-overview')) return
  adminDeliveryPointBindingsLoading.value = true
  try {
    const params = {}
    if (adminDeliveryPointBindingQuery.value.trim()) params.q = adminDeliveryPointBindingQuery.value.trim()
    if (adminDeliveryPointBindingStatus.value && adminDeliveryPointBindingStatus.value !== 'ALL') params.status = adminDeliveryPointBindingStatus.value
    logBindingDebug('frontend:admin-bindings:start', { api: `${API}/admin/delivery-point-bindings`, params })
    const { data } = await axios.get(`${API}/admin/delivery-point-bindings`, { params })
    logBindingDebug('frontend:admin-bindings:response', {
      ok: data?.ok,
      message: data?.message,
      count: Array.isArray(data?.data) ? data.data.length : 0,
      items: (Array.isArray(data?.data) ? data.data : []).map(item => ({ id: item?.id, provider_user_id: item?.provider_user_id, delivery_point_id: item?.delivery_point_id, status: item?.status, raw_status: item?.raw_status })),
    })
    if (data?.ok) {
      adminDeliveryPointBindings.value = Array.isArray(data.data) ? data.data : []
    } else {
      adminDeliveryPointBindings.value = []
      await showNotice(data?.message || '讀取交車點綁定總覽失敗', { title: '錯誤' })
    }
  } catch (e) {
    logBindingError('frontend:admin-bindings:error', e, { status: adminDeliveryPointBindingStatus.value, query: adminDeliveryPointBindingQuery.value })
    adminDeliveryPointBindings.value = []
    await showNotice(e?.response?.data?.message || e.message, { title: '讀取交車點綁定總覽失敗' })
  } finally {
    adminDeliveryPointBindingsLoading.value = false
  }
}

async function forceAdminDeliveryPointBinding(item, action) {
  if (!item?.id || !action) return
  const normalizedAction = String(action || '').toUpperCase()
  const confirmed = await showConfirm(
    normalizedAction === 'APPROVE'
      ? '確定要由管理員直接核准這筆交車點綁定嗎？'
      : '確定要由管理員直接解除這筆綁定嗎？解除後，相關活動交車點服務會自動停用。',
    { title: normalizedAction === 'APPROVE' ? '強制核准' : '強制解除' }
  ).catch(() => false)
  if (!confirmed) return
  adminDeliveryPointBindingSaving.value = true
  try {
    logBindingDebug('frontend:admin-force-binding:start', {
      action: normalizedAction,
      item: { id: item?.id, provider_user_id: item?.provider_user_id, delivery_point_id: item?.delivery_point_id, status: item?.status, raw_status: item?.raw_status },
    })
    const { data } = await axios.patch(`${API}/admin/delivery-point-bindings/${item.id}`, { action: normalizedAction })
    logBindingDebug('frontend:admin-force-binding:response', { ok: data?.ok, message: data?.message, data: data?.data })
    if (data?.ok) {
      await loadAdminDeliveryPointBindings()
      await showNotice(data?.message || (normalizedAction === 'APPROVE' ? '已強制核准綁定' : '已強制解除綁定'))
    } else {
      await showNotice(data?.message || (normalizedAction === 'APPROVE' ? '強制核准失敗' : '強制解除失敗'), { title: '錯誤' })
    }
  } catch (e) {
    logBindingError('frontend:admin-force-binding:error', e, { action: normalizedAction, item })
    await showNotice(e?.response?.data?.message || e.message, { title: normalizedAction === 'APPROVE' ? '強制核准失敗' : '強制解除失敗' })
  } finally {
    adminDeliveryPointBindingSaving.value = false
  }
}

async function reviewProviderDeliveryPointBinding(item, status) {
  if (!item?.id || !status) return
  providerDeliveryPointBindingSaving.value = true
  try {
    logBindingDebug('frontend:provider-review-binding:start', {
      status,
      self: { id: selfUserId.value, role: selfRole.value, email: selfEmail.value },
      item: { id: item?.id, provider_user_id: item?.provider_user_id, delivery_point_id: item?.delivery_point_id, status: item?.status, raw_status: item?.raw_status },
    })
    const { data } = await axios.patch(`${API}/provider/delivery-point-bindings/${item.id}`, { status })
    logBindingDebug('frontend:provider-review-binding:response', { ok: data?.ok, message: data?.message, data: data?.data })
    if (data?.ok) {
      await loadProviderDeliveryPointBindings()
      await loadDeliveryPoints({ silent: true })
      await showNotice(data?.message || '已更新綁定申請')
    } else {
      await showNotice(data?.message || '更新綁定申請失敗', { title: '錯誤' })
    }
  } catch (e) {
    logBindingError('frontend:provider-review-binding:error', e, { status, item })
    await showNotice(e?.response?.data?.message || e.message, { title: '更新綁定申請失敗' })
  } finally {
    providerDeliveryPointBindingSaving.value = false
  }
}

function applyProviderContactSettings(payload = {}) {
  providerContactForm.phone = normalizePhoneValue(payload.phone || '')
  providerContactOriginal.value = providerContactSnapshot()
}

function onProviderContactPhoneInput(event) {
  const sanitized = normalizePhoneValue(event?.target?.value ?? providerContactForm.phone)
  if (event?.target) event.target.value = sanitized
  providerContactForm.phone = sanitized
}

async function refreshSelfUserCache() {
  try {
    const { data } = await axios.get(`${API}/whoami`)
    if (!data?.ok) return
    const me = data.data || {}
    setUserProfile(me)
    window.dispatchEvent(new Event('auth-changed'))
    selfRole.value = normalizeFrontendRole(me.role || '')
    selfUserId.value = String(me.id || '')
    selfUsername.value = String(me.username || '')
    selfEmail.value = String(me.email || '')
  } catch {}
}

async function loadProviderContactSettings() {
  if (!settingsTabs.value.some(t => t.key === 'provider-contact')) return
  providerContactLoading.value = true
  try {
    const { data } = await axios.get(`${API}/me`)
    if (data?.ok) applyProviderContactSettings(data.data || {})
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '讀取聯絡資訊失敗' })
  } finally {
    providerContactLoading.value = false
  }
}

async function saveProviderContactSettings() {
  if (!settingsTabs.value.some(t => t.key === 'provider-contact')) return
  const phone = normalizePhoneValue(providerContactForm.phone)
  providerContactForm.phone = phone
  if (phone && phone.length < 8) {
    await showNotice('電話號碼需至少 8 個字元', { title: '格式錯誤' })
    return
  }
  providerContactSaving.value = true
  try {
    const { data } = await axios.patch(`${API}/me`, { phone })
    if (data?.ok) {
      applyProviderContactSettings({ phone })
      await refreshSelfUserCache()
      await showNotice('服務商聯絡電話已更新')
    } else {
      await showNotice(data?.message || '更新聯絡資訊失敗', { title: '更新失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '更新聯絡資訊失敗' })
  } finally {
    providerContactSaving.value = false
  }
}

function applyRemittanceSettings(payload = {}) {
  const next = normalizeRemittancePayload(payload)
  remittanceForm.info = next.info
  remittanceForm.bankCode = next.bankCode
  remittanceForm.bankAccount = next.bankAccount
  remittanceForm.accountName = next.accountName
  remittanceForm.bankName = next.bankName
  remittanceOriginal.value = remittanceSnapshot()
}

async function loadRemittanceSettings() {
  if (!settingsTabs.value.some(t => t.key === 'remittance')) return
  remittanceLoading.value = true
  try {
    const { data } = await axios.get(remittanceSettingsEndpoint.value)
    if (data?.ok) applyRemittanceSettings(data.data || {})
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '讀取匯款資訊失敗' })
  } finally {
    remittanceLoading.value = false
  }
}

async function saveRemittanceSettings() {
  if (!settingsTabs.value.some(t => t.key === 'remittance')) return
  remittanceSaving.value = true
  try {
    const payload = normalizeRemittancePayload(remittanceForm)
    const { data } = await axios.patch(remittanceSettingsEndpoint.value, payload)
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

function applyOrderEmailCcSettings(payload = {}) {
  const emails = Array.isArray(payload.emails) ? payload.emails : []
  const userIds = Array.isArray(payload.userIds) ? payload.userIds : []
  const accounts = Array.isArray(payload.users) ? payload.users : []
  const nextAccountsById = {}
  accounts.forEach((source) => {
    const account = normalizeOrderEmailCcAccount(source)
    if (account.id) nextAccountsById[account.id] = account
  })
  orderEmailCcForm.emailsText = emails.map(email => String(email || '').trim()).filter(Boolean).join('\n')
  orderEmailCcForm.userIds = userIds.map(id => String(id || '').trim()).filter(Boolean)
  orderEmailCcAccountsById.value = nextAccountsById
  orderEmailCcOriginal.value = orderEmailCcSnapshot()
}

async function loadOrderEmailCcSettings() {
  if (!settingsTabs.value.some(t => t.key === 'order-email')) return
  orderEmailCcLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/order_email_cc`)
    if (data?.ok) applyOrderEmailCcSettings(data.data || {})
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '讀取訂單 Email 設定失敗' })
  } finally {
    orderEmailCcLoading.value = false
  }
}

function orderEmailCcHasAccount(id) {
  const key = String(id || '').trim()
  return !!key && orderEmailCcForm.userIds.some(existing => String(existing) === key)
}

function addOrderEmailCcAccount(source = {}) {
  const account = normalizeOrderEmailCcAccount(source)
  if (!account.id || orderEmailCcHasAccount(account.id)) return
  if (!account.email) {
    void showNotice('此帳號沒有可用的 Email', { title: '無法加入' })
    return
  }
  orderEmailCcForm.userIds.push(account.id)
  orderEmailCcAccountsById.value = {
    ...orderEmailCcAccountsById.value,
    [account.id]: account
  }
}

function removeOrderEmailCcAccount(id) {
  const key = String(id || '').trim()
  orderEmailCcForm.userIds = orderEmailCcForm.userIds.filter(existing => String(existing) !== key)
}

async function searchOrderEmailCcAccounts() {
  const query = orderEmailCcAccountQuery.value.trim()
  if (!query) {
    orderEmailCcAccountOptions.value = []
    orderEmailCcAccountSearchDone.value = false
    return
  }
  orderEmailCcAccountSearching.value = true
  orderEmailCcAccountSearchDone.value = true
  try {
    const { data } = await axios.get(`${API}/admin/users`, { params: { q: query, limit: 20, offset: 0 } })
    const payload = data?.data || {}
    const items = Array.isArray(payload.items) ? payload.items : []
    orderEmailCcAccountOptions.value = items
      .map(normalizeOrderEmailCcAccount)
      .filter(account => account.id)
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '搜尋帳號失敗' })
  } finally {
    orderEmailCcAccountSearching.value = false
  }
}

async function saveOrderEmailCcSettings() {
  if (!settingsTabs.value.some(t => t.key === 'order-email')) return
  if (orderEmailCcInvalidEmails.value.length) {
    await showNotice(`Email 格式不正確：${orderEmailCcInvalidEmails.value.join('、')}`, { title: '格式錯誤' })
    return
  }
  orderEmailCcSaving.value = true
  try {
    const payload = {
      emails: parseOrderEmailCcEmails(orderEmailCcForm.emailsText),
      userIds: orderEmailCcForm.userIds.map(id => String(id || '').trim()).filter(Boolean)
    }
    const { data } = await axios.patch(`${API}/admin/order_email_cc`, payload)
    if (data?.ok) {
      applyOrderEmailCcSettings(data.data || {})
      await showNotice('訂單 Email 副本設定已更新')
    } else {
      await showNotice(data?.message || '更新訂單 Email 設定失敗', { title: '更新失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '更新訂單 Email 設定失敗' })
  } finally {
    orderEmailCcSaving.value = false
  }
}

function applyProviderLegalTerms(payload = {}) {
  providerLegalTermsForm.content = payload.content || ''
  providerLegalTermsOriginal.value = providerLegalTermsSnapshot()
}

async function loadProviderLegalTerms() {
  if (!settingsTabs.value.some(t => t.key === 'legal-terms')) return
  providerLegalTermsLoading.value = true
  try {
    const { data } = await axios.get(`${API}/provider/legal_terms`)
    if (data?.ok) applyProviderLegalTerms(data.data || {})
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '讀取服務商條款失敗' })
  } finally {
    providerLegalTermsLoading.value = false
  }
}

async function saveProviderLegalTerms() {
  if (!settingsTabs.value.some(t => t.key === 'legal-terms')) return
  providerLegalTermsSaving.value = true
  try {
    const payload = { content: providerLegalTermsForm.content || '' }
    const { data } = await axios.patch(`${API}/provider/legal_terms`, payload)
    if (data?.ok) {
      applyProviderLegalTerms(data.data || {})
      await showNotice('服務商條款已更新')
    } else {
      await showNotice(data?.message || '更新服務商條款失敗', { title: '更新失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '更新服務商條款失敗' })
  } finally {
    providerLegalTermsSaving.value = false
  }
}

function applySitePages(payload = {}) {
  sitePagesForm.terms = payload.terms || ''
  sitePagesForm.privacy = payload.privacy || ''
  sitePagesForm.insuranceTermsUrl = payload.insuranceTermsUrl || ''
  sitePagesForm.reservationNotice = payload.reservationNotice || ''
  sitePagesForm.reservationRules = payload.reservationRules || ''
  const socialRows = normalizeSiteSocialLinkRows(payload.socialLinks)
  sitePagesForm.socialLinks = socialRows.length ? socialRows : [createSiteSocialLinkRow()]
  siteLegalPagesOriginal.value = siteLegalPagesSnapshot()
  siteSocialLinksOriginal.value = siteSocialLinksSnapshot()
}

function addSiteSocialLink() {
  if (sitePagesForm.socialLinks.length >= MAX_SITE_SOCIAL_LINKS) return
  sitePagesForm.socialLinks.push(createSiteSocialLinkRow())
}

function removeSiteSocialLink(index) {
  sitePagesForm.socialLinks.splice(index, 1)
  if (!sitePagesForm.socialLinks.length) sitePagesForm.socialLinks.push(createSiteSocialLinkRow())
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
      insuranceTermsUrl: sitePagesForm.insuranceTermsUrl,
      reservationNotice: sitePagesForm.reservationNotice,
      reservationRules: sitePagesForm.reservationRules,
      socialLinks: siteSavedSocialLinksPayload()
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

async function saveSiteSocialLinks() {
  if (siteSocialLinkInvalidRows.value.length) {
    await showNotice('社群連結 URL 請使用 http:// 或 https:// 開頭', { title: '格式錯誤' })
    return
  }
  sitePagesSaving.value = true
  try {
    const savedLegal = siteSavedLegalPagesPayload()
    const payload = {
      terms: savedLegal.terms || '',
      privacy: savedLegal.privacy || '',
      insuranceTermsUrl: savedLegal.insuranceTermsUrl || '',
      reservationNotice: savedLegal.reservationNotice || '',
      reservationRules: savedLegal.reservationRules || '',
      socialLinks: siteSocialLinksPayload()
    }
    const { data } = await axios.patch(`${API}/admin/site_pages`, payload)
    if (data?.ok) {
      applySitePages(data.data || {})
      await showNotice('社群連結已更新')
    } else {
      await showNotice(data?.message || '更新社群連結失敗', { title: '更新失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '更新社群連結失敗' })
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


async function backfillTicketProductBindings(){
  const confirmed = await showConfirm(
    '將會只針對尚未綁定商品的舊票券回填商品 ID；已有商品綁定的票券不會被覆蓋。確定執行？',
    { title: '一次性回填票券商品' }
  ).catch(() => false)
  if (!confirmed) return
  ticketProductBackfillTools.value.running = true
  try{
    const { data } = await axios.post(`${API}/admin/maintenance/backfill-ticket-product-ids`)
    if (data?.ok){
      const d = data?.data || {}
      await showNotice([
        '票券商品綁定回填完成',
        `依訂單紀錄回填：${d.updated_by_order || 0}`,
        `依唯一商品名稱回填：${d.updated_by_unique_name || 0}`,
        `仍未綁定：${d.remaining_unbound || 0}`,
      ].join('\n'))
      ticketSummaryLoaded.value = false
      await loadAdminTickets({ offset: adminTicketsMeta.offset, forceSummary: true })
    } else {
      await showNotice(data?.message || '票券商品回填失敗', { title: '回填失敗' })
    }
  } catch(e){
    await showNotice(e?.response?.data?.message || e.message, { title: '票券商品回填失敗' })
  } finally {
    ticketProductBackfillTools.value.running = false
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
    includeSummary: requestSummary ? 1 : 0,
    ...buildServerTableFilterParams('tickets'),
  }
  if (params.statuses) params.status = 'all'
  if (requestSummary) ticketSummaryLoaded.value = false
  const queryTrimmed = ticketQuery.value.trim()
  if (queryTrimmed) params.q = queryTrimmed
  const requestId = beginListRequest('tickets')
  ticketsLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/tickets`, { params })
    if (!isLatestListRequest('tickets', requestId)) return
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
        const byStatus = summary.byStatus || {}
        ticketSummary.total = Number(summary.total || summary.globalTotal || 0)
        ticketSummary.available = Number(byStatus.available ?? summary.available ?? 0)
        ticketSummary.used = Number(byStatus.used ?? summary.used ?? 0)
        ticketSummary.expired = Number(byStatus.expired ?? summary.expired ?? 0)
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
    if (!isLatestListRequest('tickets', requestId)) return
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    if (isLatestListRequest('tickets', requestId)) ticketsLoading.value = false
  }
}

async function loadTicketLogs(ticketId, options = {}) {
  const id = Number(ticketId || ticketDetail.ticket?.id)
  if (!Number.isFinite(id) || id <= 0) return
  const targetId = String(id)
  const append = !!options.append
  if (append && String(ticketDetail.ticket?.id || '') !== targetId) return
  if (append && (!ticketDetail.logsHasMore || ticketDetail.logsLoading || ticketDetail.logsLoadingMore)) return
  if (append) {
    ticketDetail.logsLoadingMore = true
  } else {
    ticketDetail.logsLoading = true
    ticketDetail.logsLoadingMore = false
    ticketDetail.logsHasMore = false
    ticketDetail.logsCursor = null
  }
  const requestId = ++ticketLogsRequestSequence
  try {
    const params = { limit: 50 }
    if (append && ticketDetail.logsCursor) params.cursor = ticketDetail.logsCursor
    let response = await axios.get(`${API}/admin/tickets/${id}/logs`, { params })
    let payload = response.data?.data || {}
    const hasCursorMeta = !Array.isArray(payload) && payload.meta && typeof payload.meta === 'object'
    // Legacy endpoint returned { items } without a cursor and previously loaded
    // up to 200 records. Preserve that reach during frontend-first deployment.
    if (!append && !hasCursorMeta && Array.isArray(payload?.items) && payload.items.length === params.limit) {
      if (requestId !== ticketLogsRequestSequence || String(ticketDetail.ticket?.id || '') !== targetId) return
      response = await axios.get(`${API}/admin/tickets/${id}/logs`, { params: { limit: 200 } })
      payload = response.data?.data || {}
    }
    if (
      requestId !== ticketLogsRequestSequence
      || String(ticketDetail.ticket?.id || '') !== targetId
      || !ticketDetail.open
    ) return
    const { data } = response
    if (data?.ok) {
      const list = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : [])
      const normalized = list.map(log => ({
        ...log,
        metaText: ticketLogMetaText(log.meta)
      }))
      const merged = append ? [...ticketDetail.logs, ...normalized] : normalized
      ticketDetail.logs = Array.from(new Map(merged.map(log => [String(log.id), log])).values())
      const meta = payload.meta || {}
      ticketDetail.logsHasMore = !!meta.hasMore
      ticketDetail.logsCursor = meta.nextCursor ?? null
    } else {
      if (!append) ticketDetail.logs = []
      ticketDetail.logsHasMore = false
      ticketDetail.logsCursor = null
    }
  } catch (e) {
    if (requestId !== ticketLogsRequestSequence || String(ticketDetail.ticket?.id || '') !== targetId) return
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    if (requestId === ticketLogsRequestSequence && String(ticketDetail.ticket?.id || '') === targetId) {
      if (append) ticketDetail.logsLoadingMore = false
      else ticketDetail.logsLoading = false
    }
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
  const currentProductId = readProductId(current)
  const editProductId = readProductId({ productId: ticketDetail.edit.productId })
  if ((editProductId || null) !== (currentProductId || null)) {
    payload.productId = editProductId || null
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
      await loadAdminTickets({ offset: adminTicketsMeta.offset, forceSummary: true })
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
    includePhotos: 0,
    ...buildServerTableFilterParams('reservations'),
  }
  const queryTrimmed = reservationQuery.value.trim()
  if (queryTrimmed) params.q = queryTrimmed
  if (!params.statuses && reservationStatusFilter.value !== 'all') params.statuses = reservationStatusFilter.value
  const requestId = beginListRequest('reservations')
  reservationsLoading.value = true
  try{
    const role = String(selfRole.value || '').toUpperCase()
    const endpoint = role === 'DRIVER' ? `${API}/driver/reservations` : `${API}/admin/reservations`
    const { data } = await axios.get(endpoint, { params })
    if (!isLatestListRequest('reservations', requestId)) return
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
      const summary = payload.summary || {}
      const summaryTotal = Number(summary.total ?? summary.globalTotal)
      if (Number.isFinite(summaryTotal)) adminReservationsSummary.total = Math.max(0, summaryTotal)
      else if (!queryTrimmed && !tableHasActiveFilters('reservations') && reservationStatusFilter.value === 'all') adminReservationsSummary.total = adminReservationsMeta.total
      const byStatus = summary.byStatus && typeof summary.byStatus === 'object'
        ? summary.byStatus
        : Object.fromEntries(reservationStatusOptions.map(option => [option.value, Number(summary[option.value] || 0)]))
      adminReservationsSummary.byStatus = Object.fromEntries(Object.entries(byStatus).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]))

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
    if (!isLatestListRequest('reservations', requestId)) return
    await showNotice(e?.response?.data?.message || e.message, { title: '錯誤' })
  } finally {
    if (isLatestListRequest('reservations', requestId)) reservationsLoading.value = false
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

function closeOrderEditor() {
  if (orderEditor.saving) return
  orderEditor.visible = false
  orderEditor.order = null
  orderEditor.productId = ''
  orderEditor.quantity = 1
  orderEditor.selections = []
  orderEditor.material = false
  orderEditor.materialCount = 0
}

async function openOrderEditor(order) {
  if (!order || order.status !== ORDER_STATUS_PAID) return
  const details = order.details && typeof order.details === 'object' ? order.details : {}
  orderEditor.order = order
  orderEditor.productId = String(details.productId ?? details.product_id ?? '')
  orderEditor.quantity = Math.max(1, Math.floor(toNumber(details.quantity || order.quantity || 1)))
  orderEditor.selections = (Array.isArray(order.selections) ? order.selections : []).map((line) => ({
    ...line,
    qty: Math.max(1, Math.floor(toNumber(line.qty || 1))),
  }))
  orderEditor.material = details?.addOn?.material === true
  orderEditor.materialCount = orderEditor.material
    ? Math.max(1, Math.floor(toNumber(details?.addOn?.materialCount || 1)))
    : 0
  orderEditor.visible = true
  if (!order.isReservation && !productsLoaded.value) {
    try {
      await loadProducts()
    } catch (e) {
      await showNotice(e?.response?.data?.message || e.message || '商品清單載入失敗', { title: '載入失敗' })
    }
  }
}

async function saveOrderDetails() {
  const order = orderEditor.order
  if (!order || orderEditor.saving) return
  let payload
  if (order.isReservation) {
    const invalid = orderEditor.selections.some((line) => !Number.isSafeInteger(Number(line.qty)) || Number(line.qty) < 1 || Number(line.qty) > 99)
    if (invalid) {
      await showNotice('服務數量必須為 1 至 99 的整數', { title: '格式錯誤' })
      return
    }
    payload = {
      selections: orderEditor.selections.map((line) => ({ qty: Number(line.qty) })),
      addOn: {
        material: orderEditor.material,
        materialCount: orderEditor.material ? Math.max(0, Math.floor(Number(orderEditor.materialCount || 0))) : 0,
      },
    }
  } else {
    const quantity = Number(orderEditor.quantity)
    if (!orderEditor.productId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      await showNotice('請選擇票券商品，數量須為 1 至 99 的整數', { title: '格式錯誤' })
      return
    }
    payload = { productId: Number(orderEditor.productId), quantity }
  }
  orderEditor.saving = true
  try {
    const { data } = await axios.patch(`${API}/admin/orders/${order.id}/details`, payload)
    if (!data?.ok) {
      await showNotice(data?.message || '更新失敗', { title: '更新失敗' })
      return
    }
    const emailSent = data?.data?.emailSent === true
    orderEditor.visible = false
    orderEditor.order = null
    await loadOrders()
    if (emailSent) {
      await showNotice('訂單內容已更新，Email 通知已寄給用戶')
    } else {
      await showNotice('訂單內容已更新，但 Email 通知未寄出，請確認用戶信箱與寄信設定', { title: 'Email 通知失敗' })
    }
  } catch (e) {
    await showNotice(e?.response?.data?.message || e.message, { title: '更新失敗' })
  } finally {
    orderEditor.saving = false
  }
}

function safeParse(v){ try { return typeof v === 'string' ? JSON.parse(v) : (v || {}) } catch { return {} } }
const toNumber = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const formatCurrency = (val) => `NT$ ${toNumber(val).toLocaleString('zh-TW')}`
const orderAddOnItems = (details = {}) => {
  const items = []
  const materialCount = Math.max(0, Math.floor(toNumber(details?.addOn?.materialCount || 0)))
  const materialCost = details?.addOn?.material ? materialCount * 100 : 0
  if (details?.addOn?.material && materialCount > 0) {
    items.push({ key: 'material', label: '包材', quantity: materialCount, amount: materialCost })
  } else if (toNumber(details.addOnCost) > 0) {
    items.push({ key: 'addon', label: '加購項目', quantity: 1, amount: toNumber(details.addOnCost) })
  }
  return items
}

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
  if (!getOrderStatusOptions(o).includes(o.newStatus)) { await showNotice('狀態不正確', { title: '格式錯誤' }); return }
  o.saving = true
  try {
    const payload = { status: o.newStatus }
    const { data } = await axios.patch(`${API}/admin/orders/${o.id}/status`, payload)
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

async function saveSelectedOrderStatuses(){
  const status = orderBulkStatus.value
  if (!orderPaymentStatuses.includes(status)) { await showNotice('狀態不正確', { title: '格式錯誤' }); return }
  const targets = selectedAdminOrders.value.slice()
  if (!targets.length) { await showNotice('請先勾選訂單', { title: '沒有選取訂單' }); return }
  ordersBulkSaving.value = true
  targets.forEach(o => { o.saving = true })
  let successCount = 0
  const failures = []
  try {
    const queue = targets.slice()
    const updateNext = async () => {
      while (queue.length) {
        const order = queue.shift()
        try {
          const { data } = await axios.patch(`${API}/admin/orders/${order.id}/status`, { status })
          if (data?.ok) successCount += 1
          else failures.push(`#${order.code || order.id}：${data?.message || '更新失敗'}`)
        } catch (e) {
          failures.push(`#${order.code || order.id}：${e?.response?.data?.message || e.message}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, updateNext))
    await loadOrders()
    clearOrderSelection()
    if (failures.length) {
      const detail = failures.slice(0, 3).join('；')
      await showNotice(`已更新 ${successCount} 筆，失敗 ${failures.length} 筆。${detail}`, { title: '部分更新失敗' })
    } else {
      await showNotice(`已批量更新 ${successCount} 筆訂單`)
    }
  } finally {
    targets.forEach(o => { o.saving = false })
    ordersBulkSaving.value = false
  }
}

async function createProduct() {
  if (!newProduct.value.name || newProduct.value.price < 0) { await showNotice('請輸入正確的商品資料', { title: '格式錯誤' }); return }
  loading.value = true
  try {
    const payload = {
      name: newProduct.value.name,
      description: newProduct.value.description || '',
      price: Number(newProduct.value.price),
      listing_status: normalizeListingStatus(newProduct.value.listing_status, LISTING_STATUS_DRAFT)
    }
    const { data } = await axios.post(`${API}/admin/products`, payload)
    if (data?.ok) {
      showProductForm.value = false
      newProduct.value = defaultProductForm()
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
  p._editing = { name: p.name, price: Number(p.price) || 0, description: p.description || '', listing_status: normalizeListingStatus(p.listing_status) }
}
function cancelEditProduct(p) { delete p._editing }
async function saveEditProduct(p) {
  if (!p?._editing) return
  const body = {}
  if (p._editing.name !== p.name) body.name = p._editing.name
  if (Number(p._editing.price) !== Number(p.price)) body.price = Number(p._editing.price)
  if ((p._editing.description || '') !== (p.description || '')) body.description = p._editing.description || ''
  if (normalizeListingStatus(p._editing.listing_status) !== normalizeListingStatus(p.listing_status)) body.listing_status = normalizeListingStatus(p._editing.listing_status)
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
  if (!canCreateEvents.value) return
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
      rules,
      is_exclusive: newEvent.value.is_exclusive ? 1 : 0,
      listing_status: normalizeListingStatus(newEvent.value.listing_status, LISTING_STATUS_DRAFT)
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
  if (!canEditEvent(editingEvent.value)) return
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
      rules,
      is_exclusive: newEvent.value.is_exclusive ? 1 : 0,
      listing_status: normalizeListingStatus(newEvent.value.listing_status, LISTING_STATUS_DRAFT)
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
  if (tab.value === 'drivers') await fetchProviderDrivers()
  if (tab.value === 'driver-tasks') await loadDriverTasks()
  if (tab.value === 'products') await loadProducts()
  if (tab.value === 'events') await loadEvents()
  if (tab.value === 'reservations') await loadAdminReservations()
  if (tab.value === 'tickets' && ticketCategory.value === 'general') await loadAdminTickets()
  if (tab.value === 'orders' && orderCategory.value === 'general') await loadOrders()
  if (tab.value === 'settings') {
    const tasks = []
    if (settingsTabs.value.some(t => t.key === 'delivery-point')) {
      tasks.push(loadDeliveryPointProfile())
      tasks.push(loadDeliveryPointProviderBindings())
    }
    if (settingsTabs.value.some(t => t.key === 'provider-contact')) tasks.push(loadProviderContactSettings())
    if (settingsTabs.value.some(t => t.key === 'delivery-point-bindings')) tasks.push(loadProviderDeliveryPointBindings())
    if (settingsTabs.value.some(t => t.key === 'delivery-point-bindings-overview')) tasks.push(loadAdminDeliveryPointBindings())
    if (settingsTabs.value.some(t => t.key === 'remittance')) tasks.push(loadRemittanceSettings())
    if (settingsTabs.value.some(t => t.key === 'legal-terms')) tasks.push(loadProviderLegalTerms())
    if (settingsTabs.value.some(t => t.key === 'order-email')) tasks.push(loadOrderEmailCcSettings())
    if (settingsTabs.value.some(t => t.key === 'legal')) tasks.push(loadSitePages())
    if (settingsTabs.value.some(t => t.key === 'checklists')) tasks.push(loadChecklistDefinitions())
    await Promise.all(tasks)
  }
  if (tab.value === 'tombstones') await loadTombstones()
}

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
    if (gSaved && ['user','product','status','course','global'].includes(gSaved)) groupKey.value = gSaved
  } catch {}
  const requestedTabKey = typeof route.query.tab === 'string' ? route.query.tab : ''
  const requestedTabDef = allTabs.find(item => item.key === requestedTabKey)
  const requestedTab = requestedTabDef && (!Array.isArray(requestedTabDef.roles) || requestedTabDef.roles.includes(selfRole.value))
    ? requestedTabKey
    : ''
  restoreAdminCategories(requestedTab)
  const requestedGroup = groupDefs.find(group => group.tabs.includes(requestedTab))
  if (requestedGroup) groupKey.value = requestedGroup.key
  // Default group by role if not saved
  if (!['user','product','status','course','global'].includes(groupKey.value)) {
    const r = String(selfRole.value || '').toUpperCase()
    if (r === 'ADMIN') groupKey.value = 'user'
    else if (r === 'EDITOR') groupKey.value = 'product'
    else if (r === 'SERVICE_PROVIDER' || r === 'DRIVER' || r === 'DELIVERY_POINT') groupKey.value = 'status'
    else groupKey.value = 'product'
  }
  // Resolve initial tab
  let initialTab = requestedTab || defaultTabForGroup()
  try {
    const tSaved = localStorage.getItem('admin_tab')
    if (!requestedTab && tSaved && allTabs.find(t => t.key === tSaved)) initialTab = tSaved
  } catch {}
  const idx = Math.max(0, visibleTabs.value.findIndex(t => t.key === initialTab))
  setTab(visibleTabs.value[idx]?.key || (visibleTabs.value[0]?.key || initialTab), idx, { refresh: false })
  if (canManageAdminSettings.value) await loadChecklistDefinitions({ silent: true })
  await refreshActive()
  window.addEventListener('resize', updateViewport)
})
// 美化頂部按鈕（保持輕量，不侵入既有邏輯）

// ===== 封面更換：預覽確認 Modal =====
const createCoverConfirmState = () => ({
  visible: false,
  kind: '',
  eventId: null,
  productId: null,
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
    productId: payload.productId || null,
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
    } else if (cc.kind === 'product' && cc.productId){
      const { data } = await axios.post(
        `${API}/admin/products/${cc.productId}/cover_json`,
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
  if (productPreview.value.visible) {
    if (e.key === 'Escape') { e.preventDefault(); closeProductPreview(); return }
  }
  if (eventPreview.value.visible) {
    if (e.key === 'Escape') { e.preventDefault(); closeEventPreview(); return }
  }
  const state = coverConfirm.value
  if (!state.visible) return
  if (state.uploading) { e.preventDefault(); return }
  if (e.key === 'Escape') { e.preventDefault(); closeCoverConfirm(); return }
  if (e.key === 'Enter') { e.preventDefault(); confirmCoverApply() }
}
onMounted(() => { window.addEventListener('keydown', onKeydown) })
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', updateViewport)
  Object.keys(listSearchTimers).forEach(cancelScheduledListSearch)
})
</script>

<style scoped>
.admin-page {
  min-height: 100vh;
  background: radial-gradient(circle at top, rgba(169, 54, 60, 0.06), transparent 55%), #f7f8fa;
  overflow-x: hidden;
}

.admin-page--copy-enabled,
.admin-page--copy-enabled :deep(*) {
  -webkit-touch-callout: default;
  -webkit-user-select: text;
  user-select: text;
}

.admin-page--copy-enabled input,
.admin-page--copy-enabled select,
.admin-page--copy-enabled textarea,
.admin-page--copy-enabled button {
  -webkit-user-select: auto;
  user-select: auto;
}

.admin-hero {
  position: relative;
  overflow: hidden;
}

.admin-page input,
.admin-page select,
.admin-page textarea,
.admin-page button {
  max-width: 100%;
}

.admin-page :deep(.ticket-card) {
  min-width: 0;
}

.admin-nav {
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 1rem;
  overflow: hidden;
}

.admin-nav__groups,
.admin-nav__tabs {
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-width: none;
}

.admin-nav__groups::-webkit-scrollbar,
.admin-nav__tabs::-webkit-scrollbar {
  display: none;
}

.admin-nav__groups {
  justify-content: flex-start;
  padding-left: 0.5rem;
  padding-right: 0.5rem;
}

.admin-nav__group,
.admin-nav__tab {
  flex: 0 0 auto;
  white-space: nowrap;
}

.admin-nav__tabs {
  gap: 0.25rem;
}

.admin-nav__tab {
  min-width: max-content;
  border-bottom: 2px solid transparent;
}

.admin-nav__tab--active {
  border-bottom-color: #a9363c;
}

.admin-nav__indicator {
  display: none;
}

@media (min-width: 640px) {
  .admin-nav__groups {
    justify-content: center;
  }

  .admin-nav__tabs {
    gap: 0;
    overflow-x: visible;
  }

  .admin-nav__tab {
    flex: 1 1 0;
    min-width: 0;
    border-bottom-color: transparent;
  }

  .admin-nav__indicator {
    display: block;
  }
}

.admin-section {
  margin-bottom: 2.5rem;
  min-width: 0;
}
.admin-section:last-of-type {
  margin-bottom: 0;
}
.admin-section--overview button {
  min-height: 9rem;
}
.admin-section--overview button span:first-child {
  letter-spacing: 0.03em;
}
.admin-section--overview .grid {
  gap: 1rem;
}
.admin-section--overview button:hover {
  transform: none;
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
}
.admin-card__header,
.admin-card__footer {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  background: #ffffff;
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
  font-size: 0.8125rem;
  letter-spacing: 0.04em;
  color: #a9363c;
  font-weight: 500;
}
.admin-card__title {
  font-size: 1.35rem;
  font-family: var(--ui-display-font);
  font-weight: 500;
  color: #0f172a;
  margin-top: 0.35rem;
}
.admin-card__subtitle {
  font-size: 0.95rem;
  color: #475569;
}
.admin-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.admin-card__note {
  font-size: 0.9rem;
  color: #475569;
}
.admin-form__card {
  border-top: 1px solid #d5dde8;
  border-bottom: 1px solid #d5dde8;
  padding: 1.25rem 0;
  background: transparent;
}
.admin-form__card-header h4 {
  font-size: 1rem;
  font-weight: 500;
  color: #0f172a;
}
.admin-form__card-header p {
  font-size: 0.9rem;
  color: #475569;
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
  font-size: 0.9rem;
  color: #475569;
}
.admin-field input,
.admin-field textarea,
.admin-field select {
  border: 1px solid #dfe3ea;
  padding: 0.6rem 0.9rem;
  font-size: 0.92rem;
  transition: border-color 0.2s, box-shadow 0.2s;
  background: #fff;
  min-width: 0;
  width: 100%;
}
.admin-field textarea {
  min-height: 3rem;
  resize: vertical;
}
.admin-field--textarea textarea {
  min-height: 7rem;
}
.admin-field input:focus,
.admin-field textarea:focus,
.admin-field select:focus {
  border-color: #a9363c;
  box-shadow: none;
  outline: 2px solid rgba(169, 54, 60, 0.18);
  outline-offset: 1px;
}
.admin-dropzone {
  border: 2px dashed #d4d8e1;
  padding: 1.25rem;
  text-align: center;
  background: #fbf1f2;
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
  color: #64748b;
}
.admin-card--form .admin-card__body {
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.65), rgba(255, 255, 255, 0));
}
.admin-store-panel__body {
  padding: 1.5rem;
  min-width: 0;
}
.admin-store-panel__grid {
  display: grid;
  gap: 1.5rem;
  min-width: 0;
}
.admin-store-panel__grid--list,
.admin-store-panel__grid--create,
.admin-store-panel__grid--edit {
  grid-template-columns: minmax(0, 1fr);
}
@media (min-width: 1024px) {
  .admin-store-panel__grid {
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  }
  .admin-store-panel__grid--list,
  .admin-store-panel__grid--create,
  .admin-store-panel__grid--edit {
    grid-template-columns: minmax(0, 1fr);
  }
}
.admin-store-overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.75rem;
  margin: 1rem 0;
}
.admin-store-overview-card {
  border-top: 1px solid #d5dde8;
  border-bottom: 1px solid #d5dde8;
  background: transparent;
  padding: 0.9rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.admin-store-overview-card span {
  font-size: 0.9rem;
  color: #475569;
  font-weight: 500;
}
.admin-store-overview-card strong {
  font-size: 1.4rem;
  line-height: 1;
  font-family: var(--ui-money-font);
  font-weight: 550;
  color: #0f172a;
}
.admin-store-driver-panel {
  border-top: 1px solid #d5dde8;
  border-bottom: 1px solid #d5dde8;
  padding: 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.admin-store-driver-panel__heading,
.admin-store-driver-panel__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.8rem;
}
.admin-store-driver-panel__heading h5 {
  font-size: 1rem;
  font-weight: 500;
  color: #0f172a;
}
.admin-store-driver-panel__heading p,
.admin-store-driver-panel__meta {
  font-size: 0.9rem;
  color: #475569;
}
.admin-store-driver-panel__select {
  flex: 1 1 260px;
}
.admin-store-driver-panel__error {
  font-size: 0.9rem;
  color: #b91c1c;
}
.admin-store-pricing {
  margin-top: 1rem;
  border-top: 1px dashed #d5dde8;
  border-bottom: 1px dashed #d5dde8;
  padding: 1rem 0;
  background: transparent;
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
  font-weight: 500;
  color: #0f172a;
}
.admin-store-pricing__header p {
  font-size: 0.9rem;
  color: #475569;
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
  min-width: 0;
  width: 100%;
}
.admin-store-pricing__date {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.9rem;
  color: #475569;
}
.admin-store-pricing__date input {
  width: 100%;
}
.admin-store-pricing__product {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  min-width: 0;
}
.admin-store-pricing__product select {
  flex: 1;
  min-width: 0;
}
.admin-store-pricing__remove {
  border: 1px solid #fecaca;
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  color: #a9363c;
}
.admin-store-pricing__preview {
  border: 1px solid #d5dde8;
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  color: #475569;
  background: #fff;
}
.admin-store-pricing__preview:hover:not(:disabled) {
  border-color: #a9363c;
  color: #a9363c;
}
.admin-store-pricing__preview:disabled {
  cursor: not-allowed;
  color: #cbd5e1;
  background: #f8fafc;
}
.admin-store-panel__actions {
  justify-content: flex-start;
  gap: 0.75rem;
}
.admin-store-panel__list {
  max-height: 520px;
  overflow: hidden;
  min-width: 0;
}
.admin-store-panel__grid--list .admin-store-panel__list {
  max-height: none;
  overflow: visible;
}
.admin-store-list__items {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 450px;
  overflow-y: auto;
  padding-right: 0.25rem;
}
.admin-store-panel__grid--list .admin-store-list__items {
  max-height: min(58vh, 620px);
}
.admin-store-empty {
  padding: 1rem;
  color: #475569;
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
  .admin-card__header,
  .admin-card__body,
  .admin-card__footer,
  .admin-form__card,
  .admin-store-panel__body {
    padding: 1rem;
  }

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
  .admin-store-panel__grid--list .admin-store-list__items {
    max-height: calc(90vh - 280px);
  }
}

@media (max-width: 640px) {
  .admin-store-pricing__header,
  .admin-store-card__price,
  .admin-store-card__price-values {
    flex-direction: column;
    align-items: stretch;
  }

  .admin-store-pricing__product {
    align-items: stretch;
  }
}
.event-preview-modal {
  border-radius: 1rem;
  max-height: min(92vh, 920px);
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
}
.event-preview-modal__header,
.event-preview-modal__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}
.event-preview-modal__footer {
  border-top: 1px solid #e2e8f0;
  border-bottom: 0;
}
.event-preview-modal__heading {
  font-family: var(--ui-display-font);
  font-size: 1.25rem;
  font-weight: 500;
  color: #0f172a;
}
.event-preview-modal__body {
  overflow-y: auto;
  background: #f8fafc;
  padding: 1rem;
}
.event-preview-hero {
  position: relative;
  overflow: hidden;
  background: #e2e8f0;
  aspect-ratio: 3 / 1.35;
}
.event-preview-hero img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.event-preview-hero__shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(28deg, rgba(15, 23, 42, 0.74), rgba(15, 23, 42, 0.12) 60%, rgba(169, 54, 60, 0.2));
}
.event-preview-hero__content {
  position: absolute;
  left: 1.25rem;
  right: 1.25rem;
  bottom: 1.25rem;
  color: #fff;
}
.event-preview-hero__code {
  font-size: 0.9rem;
  letter-spacing: 0.04em;
  opacity: 0.88;
}
.event-preview-hero__content h2 {
  font-family: var(--ui-display-font);
  font-size: clamp(1.5rem, 2.2vw, 2.25rem);
  line-height: 1.15;
  font-weight: 500;
}
.event-preview-hero__content p:last-child {
  margin-top: 0.35rem;
  font-size: 0.95rem;
  opacity: 0.92;
}
.event-preview-section {
  background: #fff;
  border: 1px solid #e2e8f0;
  padding: 1rem;
  margin-top: 1rem;
}
.event-preview-section__heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}
.event-preview-section__heading h4,
.event-preview-confirm h4 {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-family: var(--ui-display-font);
  font-size: 1.1rem;
  font-weight: 500;
  color: #0f172a;
}
.event-preview-section__heading p {
  margin-top: 0.2rem;
  font-size: 0.9rem;
  color: #475569;
}
.event-preview-meta-grid,
.event-preview-choice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 0.75rem;
  margin-top: 1rem;
}
.event-preview-meta-card,
.event-preview-choice-grid > div {
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  padding: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}
.event-preview-choice-grid > div {
  align-items: flex-start;
  flex-direction: column;
}
.event-preview-meta-card span,
.event-preview-choice-grid span {
  color: #64748b;
  font-size: 0.9rem;
}
.event-preview-meta-card strong,
.event-preview-choice-grid strong {
  color: #1f2937;
  font-weight: 500;
  min-width: 0;
  overflow-wrap: anywhere;
}
.event-preview-description {
  margin-top: 1rem;
  white-space: pre-line;
  color: #475569;
  line-height: 1.7;
}
.event-preview-rules {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  color: #475569;
  font-size: 0.95rem;
}
.event-preview-rules li::before {
  content: "・";
  color: #a9363c;
}
.event-preview-draft-note {
  margin-top: 1rem;
  border: 1px solid #fde68a;
  background: #fffbeb;
  color: #92400e;
  padding: 0.75rem;
  font-size: 0.9rem;
  line-height: 1.6;
}
.event-preview-empty {
  border: 1px dashed #cbd5e1;
  background: #f8fafc;
  color: #64748b;
  padding: 1rem;
  text-align: center;
  font-size: 0.95rem;
}
.event-preview-empty--error {
  border-color: #fecaca;
  background: #fef2f2;
  color: #b91c1c;
}
.event-preview-store-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1rem;
}
.event-preview-store {
  border-top: 1px solid #d5dde8;
  border-bottom: 1px solid #d5dde8;
  padding: 1rem 0;
}
.event-preview-store__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}
.event-preview-store__header h5 {
  font-family: var(--ui-display-font);
  font-size: 1.05rem;
  font-weight: 500;
  color: #a9363c;
}
.event-preview-store__header p {
  color: #64748b;
  font-size: 0.9rem;
}
.event-preview-price-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.75rem;
}
.event-preview-price-card {
  border-top: 1px solid #fecdd3;
  border-bottom: 1px solid #fecdd3;
  background: #fff7f7;
  padding: 0.85rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.event-preview-price-card p {
  color: #1f2937;
  font-weight: 500;
}
.event-preview-price-card strong {
  font-family: var(--ui-money-font);
  color: #9f2f35;
  font-weight: 550;
}
.event-preview-price-card span {
  color: #64748b;
  font-size: 0.85rem;
}
.event-preview-quantity-row {
  margin-top: 0.35rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: #475569;
  font-size: 0.9rem;
}
.event-preview-quantity-row em {
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  border: 1px solid #d5dde8;
  background: #fff;
  color: #0f172a;
  font-style: normal;
}
.event-preview-confirm {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.event-preview-confirm label {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  color: #475569;
  font-size: 0.95rem;
}
@media (max-width: 768px) {
  .event-preview-modal {
    max-height: 94vh;
  }
  .event-preview-modal__header,
  .event-preview-modal__footer,
  .event-preview-store__header,
  .event-preview-section__heading {
    flex-direction: column;
    align-items: stretch;
  }
  .event-preview-hero {
    aspect-ratio: 3 / 2;
  }
}
.product-preview-modal {
  border-radius: 1rem;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
}
.product-preview-modal__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.product-preview-modal__media {
  position: relative;
  background: #f1f5f9;
  aspect-ratio: 3 / 2;
  min-height: 0;
}
.product-preview-modal__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.product-preview-modal__body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
}
.product-preview-modal__code {
  font-family: var(--ui-money-font);
  font-size: 0.82rem;
  color: #64748b;
  margin-bottom: 0.25rem;
}
.product-preview-modal__title {
  font-family: var(--ui-display-font);
  font-size: 1.35rem;
  font-weight: 500;
  color: #0f172a;
  line-height: 1.25;
}
.product-preview-modal__description {
  min-height: 3rem;
  white-space: pre-line;
  color: #475569;
  font-size: 0.95rem;
  line-height: 1.65;
}
.product-preview-modal__price {
  font-family: var(--ui-money-font);
  font-size: 1.45rem;
  font-weight: 550;
  color: #9f2f35;
}
.product-preview-modal__draft-note {
  border: 1px solid #fde68a;
  background: #fffbeb;
  color: #92400e;
  padding: 0.75rem;
  font-size: 0.9rem;
  line-height: 1.6;
}
.product-preview-modal__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
@media (min-width: 768px) {
  .product-preview-modal__grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  }
  .product-preview-modal__media {
    min-height: 100%;
    aspect-ratio: auto;
  }
  .product-preview-modal__body {
    padding: 1.5rem;
  }
}
.admin-store-card {
  border-top: 1px solid #d5dde8;
  border-bottom: 1px solid #d5dde8;
  padding: 1rem 0;
  background: transparent;
}
.admin-store-card--editing {
  background: #fbf1f2;
  border-color: #fecdd3;
}
.admin-store-card__header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
  align-items: flex-start;
  flex-wrap: wrap;
}
.admin-store-card__title {
  font-size: 1rem;
  font-weight: 500;
  color: #0f172a;
}
.admin-store-card__meta {
  font-size: 0.9rem;
  color: #475569;
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
  font-size: 0.9rem;
  color: #475569;
  min-width: 0;
}
.admin-store-card__price-type {
  font-weight: 500;
  color: #1f2937;
  margin-right: 0.3rem;
}
.admin-store-card__price-meta {
  display: block;
  font-size: 0.875rem;
  color: #475569;
}
.admin-store-card__price-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-family: var(--ui-money-font);
  font-weight: 550;
  color: #9f2f35;
}

/* moved .tab-indicator to global tailwind.css */
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
  color: #9f2f35;
  font-weight: 500;
}

.upload-spinner {
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 9999px;
  border: 3px solid rgba(169, 54, 60, 0.25);
  border-top-color: #a9363c;
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
  background: #a9363c;
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
