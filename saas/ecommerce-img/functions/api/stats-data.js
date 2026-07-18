const EVENTS = [
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
]

const METRICS = [...EVENTS, 'unique_visitor']
const TOOLS = ['upscale', 'converter', 'product_image', 'unknown']
const PAGE_SIZE = 1000
const MAX_SETTLEMENT_PAGES = 20
const STATS_START_DATE = '2026-06-28'

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const getChinaDate = (offset = 0) => {
  const time = Date.now() + 8 * 60 * 60 * 1000 - offset * 24 * 60 * 60 * 1000
  return new Date(time).toISOString().slice(0, 10)
}

const getDailySummaryKey = (day) => `daily-summary:${day}`

const isValidDay = (day) => /^\d{4}-\d{2}-\d{2}$/.test(day)

const createEmptyMetrics = () => Object.fromEntries(METRICS.map((metric) => [metric, 0]))

const createToolBreakdown = () => Object.fromEntries(TOOLS.map((tool) => [tool, createEmptyMetrics()]))

const BUSINESS_FIELDS = ['edition', 'source', 'scale', 'aiMode', 'aiDetailMode', 'inputPixels', 'outputPixels', 'batchSize', 'duration', 'downloadDelay', 'errorCode']
const createBusinessSummary = () => Object.fromEntries(BUSINESS_FIELDS.map((field) => [field, {}]))

const normalizeEvent = (event) => EVENTS.includes(event) ? event : ''

const normalizeTool = (tool) => {
  if (tool === 'compressor') return 'converter'
  return TOOLS.includes(tool) ? tool : 'unknown'
}

const getStatsToken = (request) => {
  const authorization = request.headers.get('authorization') || ''
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim()
  return new URL(request.url).searchParams.get('token') || ''
}

const isStatsAuthorized = (context) => {
  const expected = String(context.env.STATS_ADMIN_TOKEN || '')
  return !expected || getStatsToken(context.request) === expected
}

const hashVisitorIds = async (day, ids) => {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  return Promise.all(uniqueIds.map(async (id) => {
    const bytes = new TextEncoder().encode(`${day}:${id}`)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].slice(0, 12).map(byte => byte.toString(16).padStart(2, '0')).join('')
  }))
}

const addEvent = (summary, item) => {
  const event = normalizeEvent(String(item?.event || ''))
  if (!event) return

  const amount = Math.max(1, Number.parseInt(item?.amount || '1', 10) || 1)
  const visitorId = String(item?.visitorId || '')
  const tool = normalizeTool(String(item?.tool || 'unknown'))

  summary.totals[event] += amount
  summary.tools[tool][event] += amount

  if (visitorId) {
    summary.visitors.push(visitorId)
    summary.toolVisitors[tool].push(visitorId)
  }

  BUSINESS_FIELDS.forEach((field) => {
    const value = String(item?.analytics?.[field] || '')
    if (value) summary.business[field][value] = (summary.business[field][value] || 0) + 1
  })
}

const getRecordEvents = (record) => {
  if (Array.isArray(record?.events)) return record.events
  if (record?.event) return [record]
  return []
}

const getMetadataEvents = (metadata) => {
  if (Array.isArray(metadata?.events)) return metadata.events
  return []
}

const createSummary = () => ({
  totals: createEmptyMetrics(),
  tools: createToolBreakdown(),
  visitors: [],
  toolVisitors: Object.fromEntries(TOOLS.map((tool) => [tool, []])),
  eventLogCount: 0,
  legacyReadCount: 0,
  metadataReadCount: 0,
  business: createBusinessSummary(),
})

const toPublicSummary = async (day, summary) => {
  const visitorKeys = await hashVisitorIds(day, summary.visitors)
  const toolVisitorKeys = Object.fromEntries(await Promise.all(TOOLS.map(async (tool) => [
    tool,
    await hashVisitorIds(day, summary.toolVisitors[tool]),
  ])))

  summary.totals.unique_visitor = new Set(visitorKeys).size
  TOOLS.forEach((tool) => {
    summary.tools[tool].unique_visitor = new Set(toolVisitorKeys[tool]).size
  })

  return {
    totals: summary.totals,
    tools: summary.tools,
    visitorKeys,
    toolVisitorKeys,
    eventLogCount: summary.eventLogCount,
    legacyReadCount: summary.legacyReadCount,
    metadataReadCount: summary.metadataReadCount,
    business: summary.business,
  }
}

const readDailySummary = async (kv, day) => {
  const value = await kv.get(getDailySummaryKey(day))
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const settleDay = async (kv, day) => {
  const summary = createSummary()
  let cursor = ''
  let pageCount = 0

  do {
    const listOptions = { prefix: `event:${day}:`, limit: PAGE_SIZE }
    if (cursor) listOptions.cursor = cursor
    const listed = await kv.list(listOptions)
    pageCount += 1
    if (pageCount > MAX_SETTLEMENT_PAGES) throw new Error('Daily settlement is too large')

    for (const key of listed.keys || []) {
      summary.eventLogCount += 1
      const metadataEvents = getMetadataEvents(key.metadata)
      if (metadataEvents.length) {
        metadataEvents.forEach((item) => addEvent(summary, item))
        summary.metadataReadCount += 1
        continue
      }

      const value = await kv.get(key.name)
      summary.legacyReadCount += 1
      try {
        getRecordEvents(JSON.parse(value || '{}')).forEach((item) => addEvent(summary, item))
      } catch {
        // Broken analytics records are ignored so one bad row cannot break settlement.
      }
    }
    cursor = listed.list_complete ? '' : listed.cursor
  } while (cursor)

  const publicSummary = await toPublicSummary(day, summary)
  const storedSummary = {
    version: 1,
    day,
    finalizedAt: new Date().toISOString(),
    ...publicSummary,
  }
  await kv.put(getDailySummaryKey(day), JSON.stringify(storedSummary))
  return storedSummary
}

export async function onRequestGet(context) {
  if (!isStatsAuthorized(context)) return json({ ok: false, error: 'UNAUTHORIZED' }, 401)

  const kv = context.env.TUSCALE_ANALYTICS
  if (!kv) return json({ ok: false, configured: false }, 202)

  const url = new URL(context.request.url)
  const day = url.searchParams.get('day') || getChinaDate()

  if (!isValidDay(day)) return json({ ok: false, error: 'INVALID_DAY' }, 400)
  if (day < STATS_START_DATE) return json({ ok: false, error: 'ARCHIVED_DAY' }, 410)

  let storedSummary
  try {
    storedSummary = await readDailySummary(kv, day)
  } catch (error) {
    console.error('Stats daily summary read failed', error)
    return json({
      ok: false,
      error: 'KV_SUMMARY_READ_FAILED',
      errorType: String(error?.name || 'Error'),
      errorMessage: String(error?.message || 'Unknown KV summary read error').slice(0, 160),
    }, 503)
  }

  if (storedSummary) {
    return json({
      ok: true,
      configured: true,
      day,
      status: 'finalized',
      complete: true,
      summary: storedSummary,
    })
  }

  if (day === getChinaDate(1)) {
    try {
      storedSummary = await settleDay(kv, day)
    } catch (error) {
      console.error('Stats daily settlement failed', error)
      return json({
        ok: true,
        configured: true,
        day,
        status: 'pending',
        complete: true,
        summary: await toPublicSummary(day, createSummary()),
      })
    }
    return json({ ok: true, configured: true, day, status: 'finalized', complete: true, summary: storedSummary })
  }

  return json({
    ok: true,
    configured: true,
    day,
    status: day === getChinaDate() ? 'collecting' : 'pending',
    complete: true,
    summary: await toPublicSummary(day, createSummary()),
  })
}
