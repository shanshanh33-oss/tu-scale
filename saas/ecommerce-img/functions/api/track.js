const ALLOWED_EVENTS = new Set([
  'page_view',
  'session_start',
  'image_uploaded',
  'ai_enabled',
  'process_start',
  'process_success',
  'process_error',
  'batch_start',
  'batch_item_success',
  'batch_item_error',
  'download',
  'download_zip',
])

const UNIQUE_VISITOR_EVENT = 'unique_visitor'
const ID_PATTERN = /^[a-z]_[a-zA-Z0-9-]{8,80}$/

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const getChinaDate = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)

const readCount = async (kv, key) => {
  const value = await kv.get(key)
  const count = Number.parseInt(value || '0', 10)
  return Number.isFinite(count) ? count : 0
}

const addCount = async (kv, key, amount) => {
  const current = await readCount(kv, key)
  await kv.put(key, String(current + amount))
}

const countUniqueVisitor = async (kv, visitorId, day) => {
  if (!ID_PATTERN.test(visitorId)) return

  const totalKey = `visitor:total:${visitorId}`
  const dayKey = `visitor:day:${day}:${visitorId}`
  const [seenEver, seenToday] = await Promise.all([
    kv.get(totalKey),
    kv.get(dayKey),
  ])

  const writes = []
  if (!seenEver) {
    writes.push(
      kv.put(totalKey, '1'),
      addCount(kv, `total:${UNIQUE_VISITOR_EVENT}`, 1),
    )
  }
  if (!seenToday) {
    writes.push(
      kv.put(dayKey, '1', { expirationTtl: 60 * 60 * 24 * 45 }),
      addCount(kv, `day:${day}:${UNIQUE_VISITOR_EVENT}`, 1),
    )
  }
  await Promise.all(writes)
}

export async function onRequestPost(context) {
  const kv = context.env.TUSCALE_ANALYTICS
  if (!kv) return json({ ok: false, configured: false }, 202)

  let body
  try {
    body = await context.request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }

  const event = String(body?.event || '').trim()
  if (!ALLOWED_EVENTS.has(event)) return json({ ok: false, error: 'INVALID_EVENT' }, 400)

  const rawCount = Number(body?.data?.count || 1)
  const amount = Math.max(1, Math.min(Number.isFinite(rawCount) ? Math.round(rawCount) : 1, 100))
  const day = getChinaDate()
  const visitorId = String(body?.data?.visitorId || '').trim()

  await Promise.all([
    addCount(kv, `total:${event}`, amount),
    addCount(kv, `day:${day}:${event}`, amount),
    countUniqueVisitor(kv, visitorId, day),
  ])

  return json({ ok: true })
}

export function onRequestOptions() {
  return json({ ok: true })
}
