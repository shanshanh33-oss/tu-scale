const ENDPOINT = 'https://api.sendgrid.com/v3/mail/send'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function createSendGridDelivery(env, httpFetch = fetch) {
  const key = env.SENDGRID_API_KEY
  const from = env.MEMBER_FROM_EMAIL
  if (typeof key !== 'string' || key.length < 12 || typeof from !== 'string'
    || from.length > 254 || !EMAIL.test(from)) return null

  return {
    async fetch(request) {
      const { kind, contact, code } = await request.json()
      if (kind !== 'email' || typeof contact !== 'string' || !EMAIL.test(contact)
        || !/^\d{6}$/.test(code)) return new Response(null, { status: 422 })
      try {
        const result = await httpFetch(ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: contact }] }],
            from: { email: from, name: 'TU Scale' },
            subject: 'TU Scale 邮箱验证码',
            content: [{ type: 'text/plain', value: `您的 TU Scale 验证码是 ${code}，10 分钟内有效。如果不是您本人操作，请忽略此邮件。` }],
          }),
          signal: AbortSignal.timeout(8000),
        })
        return new Response(null, { status: result.status === 202 ? 204 : 502 })
      } catch {
        return new Response(null, { status: 502 })
      }
    },
  }
}
