const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const clean = (value, max = 500) => String(value || '').trim().slice(0, max)

export async function onRequestPost(context) {
  const kv = context.env.TUSCALE_ANALYTICS
  let body
  try {
    body = await context.request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }

  const record = {
    type: clean(body.type, 80),
    want: clean(body.want, 20),
    service: clean(body.service, 40),
    price: clean(body.price, 20),
    plan: clean(body.plan, 40),
    batchNeed: clean(body.batchNeed, 40),
    monthlyVolume: clean(body.monthlyVolume, 40),
    contact: clean(body.contact, 120),
    note: clean(body.note, 500),
    method: clean(body.method, 40),
    preset: clean(body.preset, 40),
    createdAt: new Date().toISOString(),
  }

  if (kv) {
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    await kv.put(`survey:${record.type || 'general'}:${Date.now()}:${id}`, JSON.stringify(record))
  }

  return json({ ok: true, configured: !!kv })
}

export function onRequestOptions() {
  return json({ ok: true })
}
