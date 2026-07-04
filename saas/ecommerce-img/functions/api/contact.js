const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const clean = (value, max = 1000) => String(value || '').trim().slice(0, max)

export async function onRequestPost(context) {
  const kv = context.env.TUSCALE_ANALYTICS
  if (!kv) return json({ ok: false, configured: false, error: 'KV_NOT_CONFIGURED' }, 202)

  let body
  try {
    body = await context.request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }

  const record = {
    type: clean(body.type, 40) || 'feature',
    message: clean(body.message, 2000),
    contact: clean(body.contact, 160),
    page: clean(body.page, 200),
    userAgent: clean(context.request.headers.get('user-agent'), 300),
    createdAt: new Date().toISOString(),
  }

  if (record.message.length < 3) {
    return json({ ok: false, error: 'MESSAGE_REQUIRED' }, 400)
  }

  const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  await kv.put(`contact:${record.type}:${Date.now()}:${id}`, JSON.stringify(record))

  return json({ ok: true, configured: true })
}

export function onRequestOptions() {
  return json({ ok: true })
}
