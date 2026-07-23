import test from 'node:test'
import assert from 'node:assert/strict'
import {
  newPasswordError,
  passwordCharacterLength,
  passwordConfirmationError,
  passwordUtf8ByteLength,
} from '../src/utils/passwordPolicy.js'

test('new passwords require eight characters without trimming meaningful spaces', () => {
  assert.equal(newPasswordError('1234567'), '密碼至少 8 碼')
  assert.equal(newPasswordError(' 1234567'), '')
  assert.equal(passwordCharacterLength('🔐🔐🔐🔐🔐🔐🔐🔐'), 8)
})

test('new passwords are limited by UTF-8 bytes instead of JavaScript string length', () => {
  assert.equal(passwordUtf8ByteLength('密碼'), 6)
  assert.equal(newPasswordError('密'.repeat(24)), '')
  assert.equal(newPasswordError('密'.repeat(25)), '密碼不可超過 72 個 UTF-8 bytes')
})

test('password confirmation compares the exact untrimmed value', () => {
  assert.equal(passwordConfirmationError('12345678 ', '12345678'), '兩次輸入的密碼不一致')
  assert.equal(passwordConfirmationError('12345678 ', '12345678 '), '')
})

