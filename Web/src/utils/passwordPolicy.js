export const NEW_PASSWORD_MIN_CHARACTERS = 8
export const NEW_PASSWORD_MAX_BYTES = 72
export const EXISTING_PASSWORD_MAX_CHARACTERS = 120

const utf8Encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null

export const passwordCharacterLength = (value) => Array.from(String(value ?? '')).length

export const passwordUtf8ByteLength = (value) => {
  const password = String(value ?? '')
  if (utf8Encoder) return utf8Encoder.encode(password).length
  return unescape(encodeURIComponent(password)).length
}

export const newPasswordError = (value) => {
  const password = String(value ?? '')
  if (!password) return '請輸入新密碼'
  if (passwordCharacterLength(password) < NEW_PASSWORD_MIN_CHARACTERS) {
    return `密碼至少 ${NEW_PASSWORD_MIN_CHARACTERS} 碼`
  }
  if (passwordUtf8ByteLength(password) > NEW_PASSWORD_MAX_BYTES) {
    return `密碼不可超過 ${NEW_PASSWORD_MAX_BYTES} 個 UTF-8 bytes`
  }
  return ''
}

export const passwordConfirmationError = (password, confirmation) => {
  const policyError = newPasswordError(password)
  if (policyError) return policyError
  if (String(password ?? '') !== String(confirmation ?? '')) return '兩次輸入的密碼不一致'
  return ''
}

