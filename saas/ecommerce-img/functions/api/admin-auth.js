const COOKIE_NAME = '__Host-tuscale_admin'
const SESSION_SECONDS = 8 * 60 * 60

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  },
})

const getCookie = (request, name) => {
  const header = request.headers.get('cookie') || ''
  const item = header.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))
  if (!item) return ''
  try {
    return decodeURIComponent(item.slice(name.length + 1))
  } catch {
    return ''
  }
}

const getRequestToken = (request) => {
  const authorization = request.headers.get('authorization') || ''
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim()
  return getCookie(request, COOKIE_NAME)
}

export const getAdminAuth = (context, legacyTokenName) => {
  const token = String(context.env.ADMIN_DASHBOARD_TOKEN || context.env[legacyTokenName] || '')
  return {
    configured: Boolean(token),
    authorized: Boolean(token) && getRequestToken(context.request) === token,
  }
}

export const createAdminSession = async (context, legacyTokenName) => {
  const expected = String(context.env.ADMIN_DASHBOARD_TOKEN || context.env[legacyTokenName] || '')
  if (!expected) return json({ ok: false, error: 'ADMIN_TOKEN_NOT_CONFIGURED' }, 503)

  let body
  try {
    body = await context.request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }

  if (String(body?.token || '') !== expected) return json({ ok: false, error: 'UNAUTHORIZED' }, 401)

  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(expected)}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`,
  })
}

export const renderAdminLogin = (title) => `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="margin:0;padding:40px;background:#f6f8fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <main style="max-width:420px;margin:8vh auto;background:#fff;border:1px solid #dbe3ef;border-radius:16px;padding:24px;box-shadow:0 16px 42px rgba(15,23,42,.08)">
    <h1 style="margin:0 0 10px;font-size:24px">${title}</h1><p style="color:#64748b;line-height:1.7">请输入管理口令。口令只通过加密连接提交，不会出现在网址中。</p>
    <form id="login"><label for="token" style="display:block;margin:18px 0 7px;font-weight:700">管理口令</label><input id="token" type="password" autocomplete="current-password" required style="width:100%;padding:11px;border:1px solid #cbd5e1;border-radius:9px;font:inherit"><button style="width:100%;margin-top:14px;padding:11px;border:0;border-radius:9px;background:#2563eb;color:#fff;font:inherit;font-weight:700;cursor:pointer">进入看板</button><p id="error" style="min-height:20px;color:#b42318"></p></form>
  </main>
  <script>document.getElementById('login').addEventListener('submit',async(e)=>{e.preventDefault();const error=document.getElementById('error');error.textContent='';const response=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:document.getElementById('token').value})});if(response.ok){location.reload();return}error.textContent=response.status===503?'管理口令尚未配置。':'口令不正确，请重试。'})</script>
</body></html>`
