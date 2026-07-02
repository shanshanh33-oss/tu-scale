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

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const getChinaDate = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)

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

  await writeEventLog(kv, { day, event, amount, visitorId, sessionId, tool })

  return json({ ok: true })
}

export function onRequestOptions() {
  return json({ ok: true })
}
