import { createMemberAuth, MemberConfigError } from '../../../server/member-auth.js'

const ROUTES = new Map([
  ['/api/auth/get-session', 'GET'],
  ['/api/auth/email-otp/send-verification-otp', 'POST'],
  ['/api/auth/sign-in/email-otp', 'POST'],
  ['/api/auth/phone-number/send-otp', 'POST'],
  ['/api/auth/phone-number/verify', 'POST'],
  ['/api/auth/sign-out', 'POST'],
])

export async function onRequest(context) {
  try {
    const origin = new URL(context.request.url).origin
    if (context.env.MEMBER_AUTH_URL !== origin) {
      return Response.json({ error: 'MEMBER_NOT_CONFIGURED' }, { status: 503 })
    }
    const deliveryState = { attempted: false, accepted: false }
    const auth = createMemberAuth(context.env, deliveryState)
    const pathname = new URL(context.request.url).pathname
    if (ROUTES.get(pathname) !== context.request.method) {
      return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    }
    if (pathname.startsWith('/api/auth/phone-number/')) {
      const session = await auth.api.getSession({ headers: context.request.headers })
      if (!session?.user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      if (pathname.endsWith('/verify')) {
        const body = await context.request.clone().json().catch(() => null)
        if (body?.updatePhoneNumber !== true || body?.disableSession !== true) {
          return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })
        }
      }
    }
    const response = await auth.handler(context.request)
    if (response.ok && (pathname === '/api/auth/email-otp/send-verification-otp'
      || pathname === '/api/auth/phone-number/send-otp') && !deliveryState.accepted) {
      return Response.json({ error: 'DELIVERY_UNAVAILABLE' }, { status: 503 })
    }
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    if (!(error instanceof MemberConfigError)) console.error('Member authentication request failed')
    return Response.json({ error: 'MEMBER_NOT_CONFIGURED' }, { status: 503 })
  }
}
