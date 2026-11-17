import test from 'node:test'
import assert from 'node:assert/strict'
import { createSendGridDelivery } from '../server/member-sendgrid.js'

const config = { SENDGRID_API_KEY: 'test-key-not-for-production', MEMBER_FROM_EMAIL: 'sender@example.test' }
const message = (kind = 'email') => new Request('https://member-delivery.internal/send', {
  method: 'POST', body: JSON.stringify({ kind, contact: 'friend@example.test', code: '123456' }),
})

test('SendGrid delivery sends only server-side email and accepts only HTTP 202', async () => {
  let outbound
  const delivery = createSendGridDelivery(config, async (url, options) => {
    outbound = { url, options }
    return new Response(null, { status: 202 })
  })
  assert.equal((await delivery.fetch(message())).status, 204)
  assert.equal(outbound.url, 'https://api.sendgrid.com/v3/mail/send')
  assert.equal(outbound.options.headers.Authorization, `Bearer ${config.SENDGRID_API_KEY}`)
  const body = JSON.parse(outbound.options.body)
  assert.equal(body.personalizations[0].to[0].email, 'friend@example.test')
  assert.equal(body.from.email, config.MEMBER_FROM_EMAIL)
  assert.match(body.content[0].value, /123456/)
})

test('SendGrid rejects phone use and provider errors without claiming delivery', async () => {
  let calls = 0
  const delivery = createSendGridDelivery(config, async () => { calls++; return new Response(null, { status: 403 }) })
  assert.equal((await delivery.fetch(message('phone'))).status, 422)
  assert.equal(calls, 0)
  assert.equal((await delivery.fetch(message())).status, 502)
  assert.equal(calls, 1)
  assert.equal(createSendGridDelivery({}), null)
})
