<template>
  <main class="pt-6 pb-12 px-4">
    <div class="max-w-6xl mx-auto">
      <header class="bg-white shadow-sm border-b border-gray-100 mb-8 p-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between fade-in">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">管理後台 Dashboard</h1>
          <p class="text-gray-600 mt-1">使用者、商品、活動與訂單管理</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-outline text-sm" @click="refreshActive" :disabled="loading">
            <AppIcon name="refresh" class="h-4 w-4" /> 重新整理
          </button>
        </div>
      </header>

      <div class="relative mb-6">
        <div class="relative flex border-b border-gray-200">
          <div class="tab-indicator" :style="indicatorStyle"></div>
          <button v-for="(t, i) in visibleTabs" :key="t.key" class="relative flex-1 px-2 py-2 text-sm sm:px-4 sm:py-3 sm:text-base font-semibold text-center flex items-center gap-1 justify-center" :class="tabClass(t.key)" @click="setTab(t.key, i)">
            <AppIcon :name="t.icon" class="h-4 w-4" /> {{ t.label }}
          </button>
        </div>
      </div>

      <!-- Users -->
      <section v-if="tab==='users'" class="bg-white border p-4 shadow-sm slide-up">
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
          <h2 class="font-bold">使用者列表</h2>
          <input v-model.trim="userQuery" placeholder="搜尋名稱/Email" class="border px-2 py-2 w-full md:w-60" />
        </div>
        <div v-if="loading" class="text-gray-500">載入中…</div>
        <div v-else>
          <div v-if="filteredUsers.length===0" class="text-gray-500">沒有資料</div>
          <div v-else class="overflow-x-auto">
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
                          <button class="btn btn-outline btn-sm" @click="resetUserPassword(u)"><AppIcon name="lock" class="h-4 w-4" /> 重設密碼</button>
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
      </section>

      <!-- 封面更換預覽 Modal（全域，供活動/商品共用） -->
      <transition name="fade">
        <div v-if="coverConfirm.visible" class="fixed inset-0 bg-black/40 z-50" @click.self="closeCoverConfirm"></div>
      </transition>
      <transition name="slide-fade">
        <div v-if="coverConfirm.visible" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="bg-white border shadow-lg w-full max-w-lg p-4">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-semibold text-gray-800">確認更換封面</h3>
              <button class="btn-ghost" title="關閉" @click="closeCoverConfirm"><AppIcon name="x" class="h-5 w-5" /></button>
            </div>
            <p class="text-sm text-gray-600 mb-2">目標：{{ coverConfirm.name }}（固定裁切為 900×600）</p>
            <div class="border aspect-[3/2] w-full overflow-hidden bg-gray-50">
              <img :src="coverConfirm.dataUrl" alt="預覽" class="w-full h-full object-cover" />
            </div>
            <div class="mt-3 flex flex-col sm:flex-row gap-2">
              <button class="btn btn-primary w-full sm:w-auto" @click="confirmCoverApply"><AppIcon name="check" class="h-4 w-4" /> 確定更換</button>
              <button class="btn btn-outline w-full sm:w-auto" @click="closeCoverConfirm"><AppIcon name="x" class="h-4 w-4" /> 取消</button>
            </div>
          </div>
        </div>
      </transition>

      

      <!-- Reservations -->
      <section v-if="tab==='reservations'" class="bg-white border p-4 shadow-sm slide-up">
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
          <h2 class="font-bold">預約狀態管理</h2>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <input v-model.trim="reservationQuery" placeholder="搜尋姓名/Email/賽事/門市/票種/狀態" class="border px-2 py-2 text-sm w-full sm:w-80" />
            <button class="btn btn-outline text-sm w-full sm:w-auto" @click="loadAdminReservations" :disabled="reservationsLoading"><AppIcon name="refresh" class="h-4 w-4" /> 重新整理</button>
          </div>
        </div>
        <div v-if="reservationsLoading" class="text-gray-500">載入中…</div>
        <div v-else>
          <div v-if="adminReservations.length===0" class="text-gray-500">沒有資料</div>
          <div v-else class="overflow-x-auto">
            <table class="min-w-[880px] w-full text-sm table-default">
              <thead class="sticky top-0 z-10">
                <tr class="bg-gray-50 text-left">
                  <th class="px-3 py-2 border">ID</th>
                  <th class="px-3 py-2 border">使用者</th>
                  <th class="px-3 py-2 border">賽事</th>
                  <th class="px-3 py-2 border">門市</th>
                  <th class="px-3 py-2 border">票種</th>
                  <th class="px-3 py-2 border">預約時間</th>
                  <th class="px-3 py-2 border">驗證碼</th>
                  <th class="px-3 py-2 border">狀態</th>
                  <th class="px-3 py-2 border">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in filteredAdminReservations" :key="r.id">
                  <td class="px-3 py-2 border">{{ r.id }}</td>
                  <td class="px-3 py-2 border">{{ r.username }}<br/><small class="text-gray-500">{{ r.email }}</small></td>
                  <td class="px-3 py-2 border">{{ r.event }}</td>
                  <td class="px-3 py-2 border">{{ r.store }}</td>
                  <td class="px-3 py-2 border">{{ r.ticket_type }}</td>
                  <td class="px-3 py-2 border">{{ r.reserved_at }}</td>
                  <td class="px-3 py-2 border font-mono">{{ r.verify_code || '-' }}</td>
                  <td class="px-3 py-2 border">
                    <select v-model="r.newStatus" class="border px-2 py-1 w-full sm:w-auto">
                      <option v-for="opt in reservationStatusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                    </select>
                  </td>
                  <td class="px-3 py-2 border">
                    <div class="flex flex-col sm:flex-row gap-2">
                      <button class="btn btn-primary btn-sm w-full sm:w-auto" @click="saveReservationStatus(r)" :disabled="r.saving">儲存</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Products -->
      <section v-if="tab==='products'" class="bg-white border p-4 shadow-sm slide-up">
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
            <div v-for="p in products" :key="p.id || p.name" class="border p-0 flex flex-col gap-0 overflow-hidden">
              <div class="relative w-full overflow-hidden" style="aspect-ratio: 3/2;">
                <img :src="productCoverUrl(p)" @error="(e)=>e.target.src='/logo.png'" alt="封面" class="absolute inset-0 w-full h-full object-cover" />
                <div class="absolute inset-0 bg-gradient-to-tr from-black/10 via-transparent to-red-700/10 pointer-events-none"></div>
              </div>
              <div class="p-3 flex flex-col gap-2">
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
            </div>
          </div>
        </div>
      </section>

      <!-- Events -->
      <section v-if="tab==='events'" class="bg-white border p-4 shadow-sm slide-up">
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
          <div v-else class="overflow-x-auto">
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
                      <span class="text-xs text-gray-500 ml-1">建議尺寸 900×600px</span>
                      </div>
                  </td>
                </tr>
              </tbody>
            </table>
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
                  <h5 class="font-medium">價目（車型 / 原價 / 早鳥）</h5>
                  <button class="px-2 py-1 border text-xs" @click="addPriceItem()">+ 車型</button>
                </div>
                <div v-for="(it, idx) in newStore.priceItems" :key="idx" class="grid grid-cols-3 gap-2 mb-2">
                  <input v-model.trim="it.type" placeholder="車型" class="border px-2 py-1" />
                  <input type="number" min="0" v-model.number="it.normal" placeholder="原價" class="border px-2 py-1" />
                  <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" class="border px-2 py-1" />
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
                      <div v-for="(pv, tk) in s.prices" :key="tk">{{ tk }}：原價 {{ pv.normal }}，早鳥 {{ pv.early }}</div>
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
                        <button class="px-2 py-1 border text-xs" @click="s._editing.priceItems.push({type:'', normal:0, early:0})">+ 車型</button>
                      </div>
                      <div v-for="(it, idx) in s._editing.priceItems" :key="idx" class="grid grid-cols-3 gap-2 mb-2">
                        <input v-model.trim="it.type" placeholder="車型" class="border px-2 py-1" />
                        <input type="number" min="0" v-model.number="it.normal" placeholder="原價" class="border px-2 py-1" />
                        <input type="number" min="0" v-model.number="it.early" placeholder="早鳥" class="border px-2 py-1" />
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

      </section>

      <!-- Orders -->
      <section v-if="tab==='orders'" class="bg-white border p-4 shadow-sm slide-up">
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
          <div v-else class="overflow-x-auto">
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
                  <td class="px-3 py-2 border">{{ o.username }}<br/><small class="text-gray-500">{{ o.email }}</small></td>
                  <td class="px-3 py-2 border">
                    <div>票券：{{ o.ticketType || '-' }}</div>
                    <div>數量：{{ o.quantity || 0 }}</div>
                    <div>總額：{{ o.total || 0 }}</div>
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
      </section>
    </div>
  </main>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import axios from '../api/axios'
import { useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'

const router = useRouter()
const API = 'https://api.xiaozhi.moe/uat/leader_online'
const selfRole = ref('USER')

const tab = ref('users')
const tabIndex = ref(0)
const loading = ref(false)

const allTabs = [
  { key: 'users', label: '使用者', icon: 'user', requireAdmin: true },
  { key: 'products', label: '商品', icon: 'store', requireAdmin: true },
  { key: 'events', label: '活動', icon: 'ticket' },
  { key: 'reservations', label: '預約', icon: 'orders' },
  { key: 'orders', label: '訂單', icon: 'orders' },
]
const visibleTabs = computed(() => allTabs.filter(t => !t.requireAdmin || selfRole.value === 'ADMIN'))
const setTab = (t, i) => { tab.value = t; tabIndex.value = i; refreshActive() }
const tabClass = (t) => tab.value === t ? 'text-primary' : 'text-gray-600 hover:text-secondary'
const tabCount = computed(() => visibleTabs.value.length)
const indicatorStyle = computed(() => ({ left: `${tabIndex.value * (100/tabCount.value)}%`, width: `${100/tabCount.value}%` }))

// Data
const users = ref([])
const userQuery = ref('')
const products = ref([])
const events = ref([])
const eventQuery = ref('')
const selectedEvent = ref(null)
const eventStores = ref([])
const storeLoading = ref(false)
// Shared templates for event stores (common across store accounts)
const storeTemplates = ref([])
const templateLoading = ref(false)
const selectedTemplateId = ref('')
const adminOrders = ref([])
const ordersLoading = ref(false)
const orderQuery = ref('')
const orderStatuses = ['待匯款', '處理中', '已完成']
const adminReservations = ref([])
const reservationsLoading = ref(false)
const reservationQuery = ref('')
const reservationStatusOptions = [
  { value: 'service_booking', label: '預約託運服務（購買票券、付款、憑證產生）' },
  { value: 'pre_dropoff', label: '賽前交車（刷碼、檢核、上傳照片、掛車牌、生成取車碼）' },
  { value: 'pre_pickup', label: '賽前取車（出示取車碼、領車、檢查、上傳合照）' },
  { value: 'post_dropoff', label: '賽後交車（刷碼、檢核、上傳照片、掛車牌、生成取車碼）' },
  { value: 'post_pickup', label: '賽後取車（出示取車碼、領車、檢查、合照存檔）' },
  { value: 'done', label: '服務結束' },
]
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
    alert(err.message)
    coverPreview.value = ''
  }
}
const newStore = ref({ name: '', pre_start: '', pre_end: '', post_start: '', post_end: '', priceItems: [{ type: '大鐵人', normal: 0, early: 0 }] })

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
      || String(o.status || '').toLowerCase().includes(q)
  })
})

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

function triggerEventCoverInput(id){
  const el = document.getElementById(`upload-${id}`)
  if (el) el.click()
}

async function changeEventCover(ev, row){
  const file = ev?.target?.files?.[0]
  if (!file) return
  try{
    const { dataUrl } = await processImageToRatio(file)
    // Open confirmation modal instead of immediate upload
    openCoverConfirm({ kind: 'event', eventId: row.id, name: (row.name || row.title || `#${row.id}`), dataUrl })
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally { ev.target.value = '' }
}

async function deleteEventCover(row){
  if (!confirm(`確定刪除活動「${row.name || row.title}」封面？`)) return
  try{
    const { data } = await axios.delete(`${API}/admin/events/${row.id}/cover`)
    if (data?.ok){ alert('已刪除'); await loadEvents() }
    else alert(data?.message || '刪除失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
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
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally { ev.target.value = '' }
}

async function deleteProductCover(p){
  if (!confirm(`確定刪除「${p.name}」封面？`)) return
  try{
    const type = encodeURIComponent(p.name || '')
    const { data } = await axios.delete(`${API}/admin/tickets/types/${type}/cover`)
    if (data?.ok){ alert('已刪除') }
    else alert(data?.message || '刪除失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
}

const formatDate = (input) => {
  if (!input) return ''
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return input
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
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

async function loadUsers() {
  loading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/users`)
    users.value = (Array.isArray(data?.data) ? data.data : []).map(u => ({
      ...u,
      _newRole: String(u.role || 'USER').toUpperCase(),
      _saving: false,
      _edit: false,
      _username: u.username,
      _email: u.email,
    }))
  } catch (e) {
    if (e?.response?.status === 401) router.push('/login')
    else if (e?.response?.status === 403) alert('需要管理員權限')
  } finally { loading.value = false }
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
    alert('已更新')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally { u._saving = false; u._edit = false }
}
async function resetUserPassword(u){
  if (selfRole.value !== 'ADMIN') return
  const pwd = window.prompt(`為使用者 ${u.username} 設定新密碼（至少 8 碼）：`)
  if (!pwd) return
  if (pwd.length < 8) { alert('密碼至少 8 碼'); return }
  u._saving = true
  try{
    const { data } = await axios.patch(`${API}/admin/users/${u.id}/password`, { password: pwd })
    if (data?.ok) alert('已重設密碼')
    else alert(data?.message || '重設失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally { u._saving = false }
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

async function loadEvents() {
  loading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/events`)
    events.value = Array.isArray(data?.data) ? data.data : []
  } finally { loading.value = false }
}

function toPricesMap(items){
  const m = {}
  for (const it of items) {
    if (!it.type) continue
    m[it.type] = { normal: Number(it.normal||0), early: Number(it.early||0) }
  }
  return m
}
function fromPricesMap(m){
  const arr = []
  for (const k of Object.keys(m||{})) { const v = m[k]||{}; arr.push({ type: k, normal: Number(v.normal||0), early: Number(v.early||0) }) }
  return arr.length ? arr : [{ type: '', normal: 0, early: 0 }]
}

async function loadEventStores(eventId){
  storeLoading.value = true
  try{
    const { data } = await axios.get(`${API}/admin/events/${eventId}/stores`)
    eventStores.value = Array.isArray(data?.data) ? data.data : []
  } catch(e){ alert(e?.response?.data?.message || e.message) }
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
  if (!Object.keys(prices).length) return alert('至少設定一個車型價格再儲存模板')
  let name = newStore.value.name || ''
  name = window.prompt('模板名稱', name) || ''
  if (!name.trim()) return
  templateLoading.value = true
  try{
    const payload = { name: name.trim(), pre_start: newStore.value.pre_start || undefined, pre_end: newStore.value.pre_end || undefined, post_start: newStore.value.post_start || undefined, post_end: newStore.value.post_end || undefined, prices }
    const { data } = await axios.post(`${API}/admin/store_templates`, payload)
    if (data?.ok){ await loadStoreTemplates(); selectedTemplateId.value = String(data.data?.id || '') }
    else alert(data?.message || '儲存模板失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally{ templateLoading.value = false }
}

function openStoreManager(e){ selectedEvent.value = e; loadEventStores(e.id); loadStoreTemplates() }
function addPriceItem(){ newStore.value.priceItems.push({ type: '', normal: 0, early: 0 }) }
function resetNewStore(){ newStore.value = { name: '', pre_start: '', pre_end: '', post_start: '', post_end: '', priceItems: [{ type: '大鐵人', normal: 0, early: 0 }] } }
async function createStore(){
  if (!selectedEvent.value) return
  if (!newStore.value.name) return alert('請輸入名稱')
  const prices = toPricesMap(newStore.value.priceItems)
  if (!Object.keys(prices).length) return alert('至少設定一個車型價格')
  storeLoading.value = true
  try{
    const payload = { name: newStore.value.name, pre_start: newStore.value.pre_start||undefined, pre_end: newStore.value.pre_end||undefined, post_start: newStore.value.post_start||undefined, post_end: newStore.value.post_end||undefined, prices }
    const { data } = await axios.post(`${API}/admin/events/${selectedEvent.value.id}/stores`, payload)
    if (data?.ok){ resetNewStore(); await loadEventStores(selectedEvent.value.id) }
    else alert(data?.message || '新增失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
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
    else alert(data?.message || '更新失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally{ storeLoading.value = false }
}

async function deleteStore(s){
  if (!confirm(`確定刪除店面「${s.name}」？`)) return
  storeLoading.value = true
  try{
    const { data } = await axios.delete(`${API}/admin/events/stores/${s.id}`)
    if (data?.ok){ await loadEventStores(selectedEvent.value.id) }
    else alert(data?.message || '刪除失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally{ storeLoading.value = false }
}

async function loadOrders() {
  ordersLoading.value = true
  try {
    const { data } = await axios.get(`${API}/admin/orders`)
    if (data?.ok && Array.isArray(data.data)) {
      adminOrders.value = data.data.map(o => {
        const d = safeParse(o.details)
        const base = {
          id: o.id,
          code: o.code || '',
          username: o.username || '',
          email: o.email || '',
          total: d.total || 0,
          quantity: d.quantity || 0,
          ticketType: d.ticketType || d?.event?.name || '',
          status: d.status || '處理中',
        }
        return { ...base, newStatus: base.status, saving: false }
      })
    } else {
      adminOrders.value = []
    }
  } catch (e) {
    alert(e?.response?.data?.message || e.message)
  } finally {
    ordersLoading.value = false
  }
}


async function loadAdminReservations(){
  reservationsLoading.value = true
  try{
    const { data } = await axios.get(`${API}/admin/reservations`)
    if (data?.ok && Array.isArray(data.data)){
      const toNewStatus = (s) => {
        if (s === 'pending') return 'pre_dropoff'
        if (s === 'pickup') return 'pre_pickup'
        return s
      }
      adminReservations.value = data.data.map(r => ({
        id: r.id,
        username: r.username || '',
        email: r.email || '',
        ticket_type: r.ticket_type,
        store: r.store,
        event: r.event,
        reserved_at: r.reserved_at,
        verify_code: r.verify_code,
        status: toNewStatus(r.status),
        newStatus: toNewStatus(r.status),
        saving: false,
      }))
    } else adminReservations.value = []
  } catch(e){
    alert(e?.response?.data?.message || e.message)
  } finally {
    reservationsLoading.value = false
  }
}

async function saveReservationStatus(row){
  const allowed = reservationStatusOptions.map(o => o.value)
  if (!allowed.includes(row.newStatus)) return alert('狀態不正確')
  row.saving = true
  try{
    const { data } = await axios.patch(`${API}/admin/reservations/${row.id}/status`, { status: row.newStatus })
    if (data?.ok){ await loadAdminReservations(); alert('已更新') }
    else alert(data?.message || '更新失敗')
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally { row.saving = false }
}

function safeParse(v){ try { return typeof v === 'string' ? JSON.parse(v) : (v || {}) } catch { return {} } }

async function saveOrderStatus(o){
  if (!orderStatuses.includes(o.newStatus)) return alert('狀態不正確')
  o.saving = true
  try {
    const { data } = await axios.patch(`${API}/admin/orders/${o.id}/status`, { status: o.newStatus })
    if (data?.ok) {
      await loadOrders()
      alert('已更新')
    } else {
      alert(data?.message || '更新失敗')
    }
  } catch (e) {
    alert(e?.response?.data?.message || e.message)
  } finally {
    o.saving = false
  }
}

async function createProduct() {
  if (!newProduct.value.name || newProduct.value.price < 0) return alert('請輸入正確的商品資料')
  loading.value = true
  try {
    const payload = { name: newProduct.value.name, description: newProduct.value.description || '', price: Number(newProduct.value.price) }
    const { data } = await axios.post(`${API}/admin/products`, payload)
    if (data?.ok) {
      showProductForm.value = false
      newProduct.value = { name: '', price: 0, description: '' }
      await loadProducts()
    } else {
      alert(data?.message || '新增失敗')
    }
  } catch (e) {
    alert(e?.response?.data?.message || e.message)
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
      alert(data?.message || '更新失敗')
    }
  } catch (e) {
    alert(e?.response?.data?.message || e.message)
  } finally {
    loading.value = false
  }
}

async function deleteProduct(p) {
  if (!confirm(`確定要刪除「${p.name}」？`)) return
  loading.value = true
  try {
    const { data } = await axios.delete(`${API}/admin/products/${p.id}`)
    if (data?.ok) {
      await loadProducts()
    } else {
      alert(data?.message || '刪除失敗')
    }
  } catch (e) {
    alert(e?.response?.data?.message || e.message)
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
  if (!newEvent.value.title || !newEvent.value.starts_at || !newEvent.value.ends_at) return alert('請輸入標題與時間')
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
        try { await axios.post(`${API}/admin/events/${newId}/cover_json`, { dataUrl: coverPreview.value }) } catch (e) { alert(e?.response?.data?.message || e.message) }
      }
      showEventForm.value = false
      newEvent.value = { code: '', title: '', starts_at: '', ends_at: '', deadline: '', location: '', description: '', cover: '', rules: '' }
      coverFile.value = null
      coverPreview.value = ''
      await loadEvents()
    } else {
      alert(data?.message || '新增失敗')
    }
  } catch (e) {
    alert(e?.response?.data?.message || e.message)
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
}

onMounted(async () => {
  const ok = await checkSession()
  if (!ok) {
    alert('需要後台權限');
    return router.push('/login')
  }
  // 預設定位到第一個可見 tab
  const idx = Math.max(0, visibleTabs.value.findIndex(t => t.key === (selfRole.value === 'ADMIN' ? 'users' : 'events')))
  setTab(visibleTabs.value[idx]?.key || 'events', idx)
  await refreshActive()
})
// 美化頂部按鈕（保持輕量，不侵入既有邏輯）

// ===== 封面更換：預覽確認 Modal =====
const coverConfirm = ref({ visible: false, kind: '', eventId: null, productType: '', name: '', dataUrl: '' })
function openCoverConfirm(payload){
  coverConfirm.value = { visible: true, kind: payload.kind, eventId: payload.eventId || null, productType: payload.productType || '', name: payload.name || '', dataUrl: payload.dataUrl || '' }
}
function closeCoverConfirm(){ coverConfirm.value = { visible: false, kind: '', eventId: null, productType: '', name: '', dataUrl: '' } }
async function confirmCoverApply(){
  const cc = coverConfirm.value
  if (!cc?.visible || !cc.dataUrl) return closeCoverConfirm()
  try{
    if (cc.kind === 'event' && cc.eventId){
      const { data } = await axios.post(`${API}/admin/events/${cc.eventId}/cover_json`, { dataUrl: cc.dataUrl })
      if (data?.ok){ alert('封面已更新'); await loadEvents() }
      else alert(data?.message || '更新失敗')
    } else if (cc.kind === 'product' && cc.productType){
      const type = encodeURIComponent(cc.productType)
      const { data } = await axios.post(`${API}/admin/tickets/types/${type}/cover_json`, { dataUrl: cc.dataUrl })
      if (data?.ok){ alert('票券封面已更新') }
      else alert(data?.message || '更新失敗')
    }
  } catch(e){ alert(e?.response?.data?.message || e.message) }
  finally { closeCoverConfirm() }
}

function onKeydown(e){
  if (!coverConfirm.value.visible) return
  if (e.key === 'Escape') { e.preventDefault(); closeCoverConfirm() }
  if (e.key === 'Enter') { e.preventDefault(); confirmCoverApply() }
}
onMounted(() => { window.addEventListener('keydown', onKeydown) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKeydown) })
</script>

<style scoped>
.tab-indicator{position:absolute;bottom:0;height:3px;background:linear-gradient(90deg,var(--color-primary),var(--color-secondary));transition:all .3s ease}
</style>
