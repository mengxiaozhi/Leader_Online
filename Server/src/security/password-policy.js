const { z } = require('zod');

const PASSWORD_MIN_CHARACTERS = 8;
const PASSWORD_MAX_UTF8_BYTES = 72;
const EXISTING_CREDENTIAL_MAX_CHARACTERS = 120;
const PASSWORD_BCRYPT_COST = 12;

function characterLength(value) {
  return Array.from(String(value ?? '')).length;
}

function utf8ByteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

function isValidNewPassword(value) {
  return typeof value === 'string'
    && characterLength(value) >= PASSWORD_MIN_CHARACTERS
    && utf8ByteLength(value) <= PASSWORD_MAX_UTF8_BYTES;
}

function isValidExistingCredential(value) {
  return typeof value === 'string'
    && characterLength(value) >= 1
    && characterLength(value) <= EXISTING_CREDENTIAL_MAX_CHARACTERS;
}

const newPasswordSchema = z.string()
  .refine(
    (value) => characterLength(value) >= PASSWORD_MIN_CHARACTERS,
    { message: `密碼至少需要 ${PASSWORD_MIN_CHARACTERS} 個字元` }
  )
  .refine(
    (value) => utf8ByteLength(value) <= PASSWORD_MAX_UTF8_BYTES,
    { message: `密碼不可超過 ${PASSWORD_MAX_UTF8_BYTES} 個 UTF-8 bytes` }
  );

const existingCredentialSchema = z.string()
  .refine((value) => characterLength(value) >= 1, { message: '請輸入密碼' })
  .refine(
    (value) => characterLength(value) <= EXISTING_CREDENTIAL_MAX_CHARACTERS,
    { message: `密碼不可超過 ${EXISTING_CREDENTIAL_MAX_CHARACTERS} 個字元` }
  );

function passwordUpgradeRequired(value) {
  return !isValidNewPassword(value);
}

module.exports = {
  PASSWORD_MIN_CHARACTERS,
  PASSWORD_MAX_UTF8_BYTES,
  EXISTING_CREDENTIAL_MAX_CHARACTERS,
  PASSWORD_BCRYPT_COST,
  characterLength,
  utf8ByteLength,
  isValidNewPassword,
  isValidExistingCredential,
  newPasswordSchema,
  existingCredentialSchema,
  passwordUpgradeRequired,
};
