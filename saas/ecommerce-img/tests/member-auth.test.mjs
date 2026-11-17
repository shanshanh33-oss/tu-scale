import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { getMigrations } from 'better-auth/db/migration'
import { createMemberAuth, MemberConfigError } from '../server/member-auth.js'
import { onRequest } from '../functions/api/auth/[[path]].js'

const origin = 'http://127.0.0.1:8788'
const migrationSql = readFileSync(new URL('../migrations/0001_members.sql', import.meta.url), 'utf8')

function createD1() {
  const sqlite = new DatabaseSync(':memory:')
  const prepare = sql => {
    let args = []
    const statement = {
      bind(...values) { args = values; return statement },
      async all() {
        const before = sqlite.prepare('SELECT total_changes() AS n').get().n
        const command = sqlite.prepare(sql)
        const rows = command.columns().length ? command.all(...args) : (command.run(...args), [])
        const after = sqlite.prepare('SELECT total_changes() AS n').get().n
        return { results: rows, success: true, meta: { changes: after - before } }
      },
      async first() { return (await statement.all()).results[0] || null },
      async run() { return statement.all() },
    }
    return statement
  }
  return { sqlite, prepare, async batch(statements) { return Promise.all(statements.map(item => item.all())) }, async exec(sql) { sqlite.exec(sql) } }
}

async function setup(overrides = {}) {
  const MEMBER_DB = createD1()
  const sent = []
  const env = {
    MEMBER_DB,
    MEMBER_AUTH_URL: origin,
    MEMBER_AUTH_SECRET: 'local-test-only-secret-not-for-production-123456',
    MEMBER_EMAIL_DAILY_LIMIT: '10',
    MEMBER_SMS_DAILY_LIMIT: '10',
    MEMBER_DELIVERY: { async fetch(request) { sent.push(await request.json()); return new Response('ok') } },
    ...overrides,
  }
  const auth = createMemberAuth(env)
  MEMBER_DB.sqlite.exec(migrationSql)
  const migration = await getMigrations(auth.options)
  return { env, sent, sqlite: MEMBER_DB.sqlite, migration }
}

async function call(env, path, body, cookie) {
  const request = new Request(`${origin}/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }),
      'CF-Connecting-IP': '127.0.0.1',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const response = await onRequest({ env, request })
  return { response, data: await response.json().catch(() => null) }
}

test('Better Auth D1 schema and verified email registration, phone binding and logout', async () => {
  const { env, sent, sqlite, migration } = await setup()
  assert.equal(migration.toBeCreated.length, 0)
  assert.equal(migration.toBeAdded.length, 0)
  assert.equal((await call(env, 'get-session')).data, null)

  const start = await call(env, 'email-otp/send-verification-otp', { email: 'owner@example.test', type: 'sign-in' })
  assert.equal(start.response.status, 200)
  assert.equal(sent.at(-1).contact, 'owner@example.test')
  const signedIn = await call(env, 'sign-in/email-otp', { email: 'owner@example.test', otp: sent.at(-1).code })
  assert.equal(signedIn.response.status, 200)
  const cookie = signedIn.response.headers.get('Set-Cookie')?.split(';')[0]
  assert.ok(cookie)
  const session = await call(env, 'get-session', undefined, cookie)
  assert.equal(session.data.user.email, 'owner@example.test')

  const phoneStart = await call(env, 'phone-number/send-otp', { phoneNumber: '+8613800138000' }, cookie)
  assert.equal(phoneStart.response.status, 200)
  assert.equal(sent.at(-1).kind, 'phone')
  const phoneVerify = await call(env, 'phone-number/verify', {
    phoneNumber: '+8613800138000', code: sent.at(-1).code, updatePhoneNumber: true, disableSession: true,
  }, cookie)
  assert.equal(phoneVerify.response.status, 200)
  assert.equal((await call(env, 'get-session', undefined, cookie)).data.user.phoneNumber, '+8613800138000')
  assert.equal((await call(env, 'get-session', undefined, cookie)).data.user.phoneNumberVerified, true)

  assert.equal((await call(env, 'sign-out', {}, cookie)).response.status, 200)
  assert.equal((await call(env, 'get-session', undefined, cookie)).data, null)
  sqlite.close()
})

test('missing service bindings fail closed', async () => {
  assert.throws(() => createMemberAuth({}), MemberConfigError)
  const unavailable = await call({ MEMBER_AUTH_URL: origin }, 'get-session')
  assert.equal(unavailable.response.status, 503)
})

test('phone delivery and verification require the email account session', async () => {
  const { env, sent, sqlite } = await setup()
  const started = await call(env, 'phone-number/send-otp', { phoneNumber: '+8613800138000' })
  assert.equal(started.response.status, 401)
  assert.equal(sent.length, 0)
  const attempted = await call(env, 'phone-number/verify', {
    phoneNumber: '+8613800138000', code: '123456', updatePhoneNumber: true, disableSession: true,
  })
  assert.equal(attempted.response.status, 401)
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM "user"').get().n, 0)
  sqlite.close()
})

test('delivery provider rejection is reported as unavailable', async () => {
  const { env, sqlite } = await setup({ MEMBER_DELIVERY: { async fetch() { return new Response('unavailable', { status: 503 }) } } })
  const result = await call(env, 'email-otp/send-verification-otp', { email: 'one@example.test', type: 'sign-in' })
  assert.equal(result.response.status, 503)
  sqlite.close()
})

test('unused Better Auth account routes are unavailable', async () => {
  const { env, sqlite } = await setup()
  assert.equal((await call(env, 'sign-up/email', { email: 'one@example.test', password: 'guess' })).response.status, 404)
  sqlite.close()
})

test('email-only test site blocks phone routes before sending SMS', async () => {
  const { env, sent, sqlite } = await setup({ MEMBER_EMAIL_ONLY: '1' })
  const result = await call(env, 'phone-number/send-otp', { phoneNumber: '+8613800138000' })
  assert.equal(result.response.status, 404)
  assert.equal(sent.length, 0)
  sqlite.close()
})

test('global daily budget stops further email sends without claiming success', async () => {
  const { env, sent, sqlite } = await setup({ MEMBER_EMAIL_DAILY_LIMIT: '1' })
  const first = await call(env, 'email-otp/send-verification-otp', { email: 'one@example.test', type: 'sign-in' })
  const second = await call(env, 'email-otp/send-verification-otp', { email: 'two@example.test', type: 'sign-in' })
  assert.equal(first.response.status, 200)
  assert.notEqual(second.response.status, 200)
  assert.equal(sent.length, 1)
  sqlite.close()
})
