import { betterAuth } from 'better-auth'
import { emailOTP, phoneNumber } from 'better-auth/plugins'

const DELIVERY_URL = 'https://member-delivery.internal/send'

export class MemberConfigError extends Error {}

function dailyLimit(env, kind) {
  const limit = Number(env[kind === 'email' ? 'MEMBER_EMAIL_DAILY_LIMIT' : 'MEMBER_SMS_DAILY_LIMIT'])
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new MemberConfigError('Invalid member send limit')
  return limit
}

async function sendCode(env, kind, contact, code, deliveryState) {
  deliveryState.attempted = true
  const day = new Date().toISOString().slice(0, 10)
  const limit = dailyLimit(env, kind)
  const reserved = await env.MEMBER_DB.prepare(`INSERT INTO member_send_budget (kind, day, sent) VALUES (?, ?, 1)
    ON CONFLICT(kind, day) DO UPDATE SET sent = sent + 1 WHERE sent < ? RETURNING sent`)
    .bind(kind, day, limit).first()
  if (!reserved) return

  try {
    const response = await env.MEMBER_DELIVERY.fetch(new Request(DELIVERY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, contact, code }),
    }))
    deliveryState.accepted = response.ok
  } catch {
    console.error('Member delivery request failed')
  }
}

export function createMemberAuth(env, deliveryState = { attempted: false, accepted: false }) {
  const origin = env.MEMBER_AUTH_URL
  if (!env.MEMBER_DB || typeof env.MEMBER_DB.prepare !== 'function'
    || !env.MEMBER_DELIVERY || typeof env.MEMBER_DELIVERY.fetch !== 'function'
    || typeof env.MEMBER_AUTH_SECRET !== 'string' || env.MEMBER_AUTH_SECRET.length < 32
    || typeof origin !== 'string' || !/^https?:\/\/[^/]+$/.test(origin)) {
    throw new MemberConfigError('Member authentication is not configured')
  }
  dailyLimit(env, 'email')
  dailyLimit(env, 'phone')

  return betterAuth({
    appName: 'TU Scale',
    baseURL: origin,
    basePath: '/api/auth',
    secret: env.MEMBER_AUTH_SECRET,
    database: env.MEMBER_DB,
    emailAndPassword: { enabled: false },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 20 },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== 'sign-in') throw new Error('Unsupported email code type')
          await sendCode(env, 'email', email, otp, deliveryState)
        },
      }),
      phoneNumber({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        phoneNumberValidator: phone => /^\+[1-9]\d{7,14}$/.test(phone),
        async sendOTP({ phoneNumber: phone, code }) {
          await sendCode(env, 'phone', phone, code, deliveryState)
        },
      }),
    ],
  })
}
