// Global bottom-sheet notification system
import { reactive } from 'vue'

export const sheetState = reactive({
  open: false,
  mode: 'notice', // notice | confirm | prompt
  title: '',
  message: '',
  input: '',
  inputType: 'text',
  placeholder: '',
  confirmText: '',
  cancelText: '',
  _resolver: null,
  _rejecter: null,
  _timer: null,
})

export function closeSheet(){
  try { if (sheetState._timer) { clearTimeout(sheetState._timer); sheetState._timer = null } } catch {}
  sheetState.open = false
}

export function sheetResolve(){
  const val = (sheetState.mode === 'prompt') ? (sheetState.input || '') : true
  try { sheetState._resolver && sheetState._resolver(val) } finally { closeSheet() }
}

export function sheetReject(){
  try { sheetState._rejecter && sheetState._rejecter(new Error('CANCELLED')) } finally { closeSheet() }
}

export function showNotice(message, { title = '', timeout = 1500 } = {}){
  if (sheetState.open) closeSheet()
  return new Promise((resolve) => {
    Object.assign(sheetState, { open: true, mode: 'notice', title, message, confirmText: '知道了', cancelText: '', _resolver: resolve, _rejecter: null })
    sheetState._timer = setTimeout(() => { resolve(true); closeSheet() }, timeout)
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

