// Global bottom-sheet notification system
import { reactive } from 'vue'

export const ORDER_REFUND_REASONS = [
  '客戶申請退款',
  '重複下單',
  '訂單資料有誤',
  '活動／課程取消',
  '無法提供服務',
  '其他',
]

export const sheetState = reactive({
  open: false,
  mode: 'notice', // notice | confirm | prompt | refund-reason
  title: '',
  message: '',
  input: '',
  selectedReason: '',
  inputType: 'text',
  placeholder: '',
  confirmText: '',
  cancelText: '',
  _resolver: null,
  _rejecter: null,
  _timer: null,
})

const resetSheet = () => {
  try { if (sheetState._timer) { clearTimeout(sheetState._timer); sheetState._timer = null } } catch {}
  sheetState.open = false
  sheetState.input = ''
  sheetState.selectedReason = ''
  sheetState.inputType = 'text'
  sheetState._resolver = null
  sheetState._rejecter = null
}

export function closeSheet(){
  const resolver = sheetState._resolver
  const rejecter = sheetState._rejecter
  const mode = sheetState.mode
  resetSheet()
  if (mode === 'prompt' || mode === 'refund-reason') {
    try { rejecter?.(new Error('CANCELLED')) } catch {}
  } else {
    try { resolver?.(mode === 'notice') } catch {}
  }
}

export function sheetResolve(){
  if (sheetState.mode === 'refund-reason' && !ORDER_REFUND_REASONS.includes(sheetState.selectedReason)) return
  const val = sheetState.mode === 'refund-reason'
    ? [sheetState.selectedReason, String(sheetState.input || '').trim().slice(0, 480)].filter(Boolean).join('：')
    : sheetState.mode === 'prompt'
    ? (sheetState.inputType === 'password'
        ? String(sheetState.input || '')
        : String(sheetState.input || '').trim())
    : true
  const resolver = sheetState._resolver
  resetSheet()
  resolver?.(val)
}

export function sheetReject(){
  closeSheet()
}

export function showNotice(message, { title = '', timeout = 1500 } = {}){
  if (sheetState.open) closeSheet()
  return new Promise((resolve) => {
    Object.assign(sheetState, { open: true, mode: 'notice', title, message, confirmText: '知道了', cancelText: '', _resolver: resolve, _rejecter: null })
    sheetState._timer = setTimeout(sheetResolve, timeout)
  })
}

export function showConfirm(message, { title = '確認', confirmText = '確定', cancelText = '取消' } = {}){
  if (sheetState.open) closeSheet()
  return new Promise((resolve) => {
    Object.assign(sheetState, { open: true, mode: 'confirm', title, message, confirmText, cancelText, _resolver: (v)=>resolve(!!v), _rejecter: ()=>resolve(false) })
  })
}

export function showPrompt(message, { title = '輸入', placeholder = '', inputType = 'text', confirmText = '送出', cancelText = '取消', initial = '' } = {}){
  if (sheetState.open) closeSheet()
  return new Promise((resolve, reject) => {
    Object.assign(sheetState, { open: true, mode: 'prompt', title, message, confirmText, cancelText, input: initial, placeholder, inputType, _resolver: resolve, _rejecter: reject })
  })
}

export function showOrderRefundReason(count = 1) {
  if (sheetState.open) closeSheet()
  return new Promise((resolve, reject) => {
    Object.assign(sheetState, {
      open: true,
      mode: 'refund-reason',
      title: '整單退款並作廢',
      message: `請選擇${count > 1 ? `這 ${count} 筆訂單` : '此訂單'}的退款原因，補充說明可留白。原因會寫入操作紀錄。`,
      selectedReason: '',
      input: '',
      confirmText: '繼續',
      cancelText: '取消',
      _resolver: resolve,
      _rejecter: reject,
    })
  })
}
