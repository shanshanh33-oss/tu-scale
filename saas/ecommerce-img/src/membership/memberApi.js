const ENDPOINTS = Object.freeze({
  session: ['/api/auth/get-session', 'GET'],
  emailStart: ['/api/auth/email-otp/send-verification-otp', 'POST'],
  emailVerify: ['/api/auth/sign-in/email-otp', 'POST'],
  phoneStart: ['/api/auth/phone-number/send-otp', 'POST'],
  phoneVerify: ['/api/auth/phone-number/verify', 'POST'],
  logout: ['/api/auth/sign-out', 'POST'],
})

export class MemberApiError extends Error {
  constructor(code) {
    super(code)
    this.name = 'MemberApiError'
    this.code = code
  }
}

const maskEmail = email => {
  const [name, domain] = email.split('@')
  return `${name[0]}***@${domain}`
}

const maskPhone = phone => `${phone.slice(0, 3)}******${phone.slice(-4)}`

export async function memberRequest(action, body, fetcher = fetch) {
  const endpoint = ENDPOINTS[action]
  if (!endpoint) throw new MemberApiError('INVALID_ACTION')
  const [path, method] = endpoint
  const payload = action === 'emailStart' ? { email: body?.email, type: 'sign-in' }
    : action === 'emailVerify' ? { email: body?.email, otp: body?.code }
      : action === 'phoneStart' ? { phoneNumber: body?.phone }
        : action === 'phoneVerify' ? { phoneNumber: body?.phone, code: body?.code, updatePhoneNumber: true, disableSession: true }
          : {}
  let response
  try {
    response = await fetcher(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(payload) : undefined,
    })
  } catch {
    throw new MemberApiError('NETWORK_ERROR')
  }
  let result
  try {
    result = await response.json()
  } catch {
    throw new MemberApiError('SERVICE_UNAVAILABLE')
  }
  if (response.status === 404 || response.status === 503) throw new MemberApiError('SERVICE_UNAVAILABLE')
  if (response.status === 429) throw new MemberApiError('RATE_LIMITED')
  if (!response.ok) throw new MemberApiError(result?.code || result?.error?.code || result?.error || 'REQUEST_FAILED')
  if (action !== 'session') return { ok: true }
  const user = result?.user
  return {
    ok: true,
    member: user ? {
      id: user.id,
      emailMasked: user.email ? maskEmail(user.email) : null,
      phoneMasked: user.phoneNumberVerified && user.phoneNumber ? maskPhone(user.phoneNumber) : null,
    } : null,
  }
}

export function getMemberErrorMessage(error) {
  switch (error?.code) {
    case 'SERVICE_UNAVAILABLE': return '会员服务尚未启用，请稍后再试。'
    case 'RATE_LIMITED':
    case 'TOO_MANY_REQUESTS': return '请求过于频繁，请稍后再试。'
    case 'INVALID_OTP':
    case 'TOO_MANY_ATTEMPTS':
    case 'INVALID_CODE': return '验证码无效或已过期，请重新获取。'
    case 'INVALID_EMAIL': return '请填写有效的邮箱地址。'
    case 'INVALID_PHONE_NUMBER': return '请填写带国家区号的手机号，例如 +86。'
    case 'PHONE_NUMBER_ALREADY_EXISTS': return '该手机号已绑定其他账号，请联系客服。'
    case 'NETWORK_ERROR': return '网络连接失败，请检查网络后重试。'
    default: return '操作没有完成，请稍后重试。'
  }
}
