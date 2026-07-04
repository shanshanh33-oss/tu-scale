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
  'survey_submit',
])

const ID_PATTERN = /^[a-z]_[a-zA-Z0-9-]{8,80}$/
const EVENT_LOG_TTL = 60 * 60 * 24 * 60
const ALLOWED_TOOLS = new Set(['upscale', 'converter', 'product_image'])
const MAX_BATCH_EVENTS = 5

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const getChinaDate = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)

const normalizeTool = (tool) => ALLOWED_TOOLS.has(tool) ? tool : 'unknown'

const normalizeEventPayload = (item) => {
  const event = String(item?.event || '').trim()
  if (!ALLOWED_EVENTS.has(event)) return null

  const data = item?.data || {}
  const rawCount = Number(data.count || 1)
  const amount = Math.max(1, Math.min(Number.isFinite(rawCount) ? Math.round(rawCount) : 1, 100))
  const visitorId = String(data.visitorId || '').trim()
  const sessionId = String(data.sessionId || '').trim()
  const tool = normalizeTool(String(data.tool || '').trim())

  return {
    event,
    amount,
    tool,
    visitorId: ID_PATTERN.test(visitorId) ? visitorId : '',
    sessionId: ID_PATTERN.test(sessionId) ? sessionId : '',
  }
}

const writeEventLog = async (kv, { day, events }) => {
  const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const key = `event:${day}:${Date.now()}:${id}`
  const body = events.length === 1
    ? events[0]
    : { version: 2, events }
  await kv.put(key, JSON.stringify(body), {
    expirationTtl: EVENT_LOG_TTL,
    metadata: {
      version: 2,
      events,
    },
  })
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

  const day = getChinaDate()
  const rawEvents = Array.isArray(body?.events) ? body.events : [body]
  const events = rawEvents
    .slice(0, MAX_BATCH_EVENTS)
    .map(normalizeEventPayload)
    .filter(Boolean)

  if (!events.length) return json({ ok: false, error: 'INVALID_EVENT' }, 400)

  await writeEventLog(kv, { day, events })

  return json({ ok: true, count: events.length })
}

export function onRequestOptions() {
  return json({ ok: true })
}
