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
  'download_success',
  'exported_image',
  'survey_submit',
])

const ID_PATTERN = /^[a-z]_[a-zA-Z0-9-]{8,80}$/
const EVENT_LOG_TTL = 60 * 60 * 24 * 60
const ALLOWED_TOOLS = new Set(['upscale', 'converter', 'product_image'])
const IDEMPOTENT_EVENTS = new Set(['download_success', 'exported_image'])
const MAX_BATCH_EVENTS = 5

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const getChinaDate = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)

const normalizeTool = (tool) => {
  if (tool === 'compressor') return 'converter'
  return ALLOWED_TOOLS.has(tool) ? tool : 'unknown'
}

const normalizeEventPayload = (item) => {
  const event = String(item?.event || '').trim()
  if (!ALLOWED_EVENTS.has(event)) return null

  const data = item?.data || {}
  const rawCount = Number(data.count || 1)
  const amount = Math.max(1, Math.min(Number.isFinite(rawCount) ? Math.round(rawCount) : 1, 100))
  const visitorId = String(data.visitorId || '').trim()
  const sessionId = String(data.sessionId || '').trim()
  const eventId = String(item?.eventId || data.eventId || '').trim()
  const tool = normalizeTool(String(data.tool || '').trim())

  return {
    event,
    eventId: ID_PATTERN.test(eventId) ? eventId : '',
    amount,
    tool,
    visitorId: ID_PATTERN.test(visitorId) ? visitorId : '',
    sessionId: ID_PATTERN.test(sessionId) ? sessionId : '',
  }
}

const reserveIdempotentEvents = async (kv, day, events) => {
  const accepted = []
  let deduplicated = 0

  for (const event of events) {
    if (!event.eventId || !IDEMPOTENT_EVENTS.has(event.event)) {
      accepted.push(event)
      continue
    }

    const dedupeKey = `event-id:${day}:${event.eventId}`
    if (await kv.get(dedupeKey)) {
      deduplicated += 1
      continue
    }

    await kv.put(dedupeKey, '1', { expirationTtl: EVENT_LOG_TTL })
    accepted.push(event)
  }

  return { accepted, deduplicated }
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
  const normalizedEvents = rawEvents
    .slice(0, MAX_BATCH_EVENTS)
    .map(normalizeEventPayload)
    .filter(Boolean)

  if (!normalizedEvents.length) return json({ ok: false, error: 'INVALID_EVENT' }, 400)

  const { accepted: events, deduplicated } = await reserveIdempotentEvents(kv, day, normalizedEvents)
  if (!events.length) return json({ ok: true, count: 0, deduplicated })

  await writeEventLog(kv, { day, events })

  return json({ ok: true, count: events.length, deduplicated })
}

export function onRequestOptions() {
  return json({ ok: true })
}
