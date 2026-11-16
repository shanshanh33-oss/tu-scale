import test from 'node:test'
import assert from 'node:assert/strict'

import { getMemberErrorMessage, MemberApiError, memberRequest } from '../src/membership/memberApi.js'

const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })

test('session lookup stays on the same origin and does not cache account data', async () => {
  let call
  const result = await memberRequest('session', undefined, async (...args) => {
    call = args
    return reply(200, null)
  })
  assert.deepEqual(result, { ok: true, member: null })
  assert.equal(call[0], '/api/auth/get-session')
  assert.equal(call[1].method, 'GET')
  assert.equal(call[1].credentials, 'same-origin')
  assert.equal(call[1].cache, 'no-store')
  assert.equal(call[1].body, undefined)
})

test('email and phone codes only go to fixed same-origin endpoints', async () => {
  const calls = []
  const fetcher = async (...args) => {
    calls.push(args)
    return reply(200, { ok: true })
  }
  await memberRequest('emailStart', { email: 'sample@example.test' }, fetcher)
  await memberRequest('phoneVerify', { phone: '+8613800138000', code: '123456' }, fetcher)
  assert.deepEqual(calls.map(call => call[0]), ['/api/auth/email-otp/send-verification-otp', '/api/auth/phone-number/verify'])
  assert.equal(calls[0][1].credentials, 'same-origin')
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0][1].body), { email: 'sample@example.test', type: 'sign-in' })
  assert.deepEqual(JSON.parse(calls[1][1].body), { phoneNumber: '+8613800138000', code: '123456', updatePhoneNumber: true, disableSession: true })
  await assert.rejects(memberRequest('https://other.example/', {}, fetcher), /INVALID_ACTION/)
})

test('unconfigured service and rate limits fail without claiming registration succeeded', async () => {
  await assert.rejects(memberRequest('emailStart', { email: 'sample@example.test' }, async () => reply(404, null)), error => error instanceof MemberApiError && error.code === 'SERVICE_UNAVAILABLE')
  await assert.rejects(memberRequest('phoneStart', {}, async () => reply(429, { ok: false })), error => error.code === 'RATE_LIMITED')
  assert.match(getMemberErrorMessage(new MemberApiError('SERVICE_UNAVAILABLE')), /尚未启用/)
  await assert.rejects(memberRequest('emailStart', { email: 'sample@example.test' }, async () => new Response('<html>Vite fallback</html>', {
    status: 200, headers: { 'Content-Type': 'text/html' },
  })), error => error.code === 'SERVICE_UNAVAILABLE')
})

test('verification errors use a safe message and network errors are handled', async () => {
  await assert.rejects(memberRequest('emailVerify', {}, async () => reply(400, { code: 'INVALID_OTP' })), error => {
    assert.equal(error.code, 'INVALID_OTP')
    assert.match(getMemberErrorMessage(error), /无效或已过期/)
    return true
  })
  await assert.rejects(memberRequest('session', undefined, async () => { throw new Error('offline') }), error => error.code === 'NETWORK_ERROR')
})

test('verified contacts are masked before reaching the member page', async () => {
  const result = await memberRequest('session', undefined, async () => reply(200, {
    user: { id: 'member-1', email: 'sample@example.test', phoneNumber: '+8613800138000', phoneNumberVerified: true },
    session: { id: 'session-1' },
  }))
  assert.deepEqual(result.member, { id: 'member-1', emailMasked: 's***@example.test', phoneMasked: '+86******8000' })
})
