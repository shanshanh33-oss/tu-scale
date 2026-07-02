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

const ID_PATTERN = /^[a-z]_[a-zA-Z0-9-]{8,80}$/
const EVENT_LOG_TTL = 60 * 60 * 24 * 60
const ALLOWED_TOOLS = new Set(['upscale', 'converter'])

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

const countIdentityEvent = async (kv, type, id, day, event, amount) => {
  if (!ID_PATTERN.test(id)) return
  await addCount(kv, `${type}:day:${day}:${id}:${event}`, amount)
}

const countUniqueVisitor = async (kv, visitorId, day) => {
  if (!ID_PATTERN.test(visitorId)) return

  const totalKey = `visitor:total:${visitorId}`
  const dayKey = `visitor:day:${day}:${visitorId}`
  await Promise.all([
    kv.put(totalKey, '1'),
    kv.put(dayKey, '1', { expirationTtl: EVENT_LOG_TTL }),
  ])
}

const countToolEvent = async (kv, tool, event, day, amount) => {
  const normalizedTool = normalizeTool(tool)
  if (normalizedTool === 'unknown') return
  await Promise.all([
    addCount(kv, `tool:${normalizedTool}:total:${event}`, amount),
    addCount(kv, `tool:${normalizedTool}:day:${day}:${event}`, amount),
  ])
}

const countToolVisitor = async (kv, tool, visitorId, day) => {
  const normalizedTool = normalizeTool(tool)
  if (normalizedTool === 'unknown' || !ID_PATTERN.test(visitorId)) return
  await Promise.all([
    kv.put(`tool:${normalizedTool}:visitor:total:${visitorId}`, '1'),
    kv.put(`tool:${normalizedTool}:visitor:day:${day}:${visitorId}`, '1', { expirationTtl: EVENT_LOG_TTL }),
  ])
}

const normalizeTool = (tool) => ALLOWED_TOOLS.has(tool) ? tool : 'unknown'

const writeEventLog = async (kv, { day, event, amount, visitorId, sessionId, tool }) => {
  const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const key = `event:${day}:${Date.now()}:${id}`
  await kv.put(key, JSON.stringify({
    event,
    amount,
    tool: normalizeTool(tool),
    visitorId: ID_PATTERN.test(visitorId) ? visitorId : '',
    sessionId: ID_PATTERN.test(sessionId) ? sessionId : '',
  }), { expirationTtl: EVENT_LOG_TTL })
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
  const sessionId = String(body?.data?.sessionId || '').trim()
  const tool = normalizeTool(String(body?.data?.tool || '').trim())

  await Promise.all([
    writeEventLog(kv, { day, event, amount, visitorId, sessionId, tool }),
    addCount(kv, `total:${event}`, amount),
    addCount(kv, `day:${day}:${event}`, amount),
    countUniqueVisitor(kv, visitorId, day),
    countToolEvent(kv, tool, event, day, amount),
    countToolVisitor(kv, tool, visitorId, day),
    countIdentityEvent(kv, 'visitor', visitorId, day, event, amount),
    countIdentityEvent(kv, 'session', sessionId, day, event, amount),
  ])

  return json({ ok: true })
}

export function onRequestOptions() {
  return json({ ok: true })
}
