import { getAdminAuth } from './admin-auth.js'

const EVENTS = [
  'page_view',
  'session_start',
  'image_uploaded',
  'ai_enabled',
  'crop_preset_selected',
  'process_start',
  'process_success',
  'process_error',
  'batch_start',
  'batch_item_success',
  'batch_item_error',
  'batch_normalize',
  'download',
  'download_zip',
  'download_success',
  'exported_image',
  'survey_submit',
]

const METRICS = [...EVENTS, 'unique_visitor']
const TOOLS = ['upscale', 'converter', 'product_image', 'contact', 'unknown']
const PAGE_SIZE = 1000
const MAX_SETTLEMENT_PAGES = 20
const MAX_BACKFILL_DAYS = 1
const LEGACY_READ_CONCURRENCY = 25
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

const listDays = (start, end) => {
  const days = []
  const cursor = new Date(`${start}T00:00:00.000Z`)
  const last = new Date(`${end}T00:00:00.000Z`)
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

const createEmptyMetrics = () => Object.fromEntries(METRICS.map((metric) => [metric, 0]))

const createToolBreakdown = () => Object.fromEntries(TOOLS.map((tool) => [tool, createEmptyMetrics()]))

const BUSINESS_FIELDS = ['edition', 'source', 'scale', 'aiMode', 'aiDetailMode', 'inputPixels', 'outputPixels', 'batchSize', 'duration', 'downloadDelay', 'errorCode']
const createBusinessSummary = () => Object.fromEntries(BUSINESS_FIELDS.map((field) => [field, {}]))

const normalizeEvent = (event) => EVENTS.includes(event) ? event : ''

const normalizeTool = (tool) => {
  if (tool === 'compressor') return 'converter'
  return TOOLS.includes(tool) ? tool : 'unknown'
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

const mergeSummary = (target, source) => {
  METRICS.forEach((metric) => {
    target.totals[metric] += source.totals?.[metric] || 0
  })
  TOOLS.forEach((tool) => {
    METRICS.forEach((metric) => {
      target.tools[tool][metric] += source.tools?.[tool]?.[metric] || 0
    })
    target.toolVisitors[tool].push(...(source.toolVisitors?.[tool] || []))
  })
  target.visitors.push(...(source.visitors || []))
  target.eventLogCount += source.eventLogCount || 0
  target.legacyReadCount += source.legacyReadCount || 0
  target.metadataReadCount += source.metadataReadCount || 0
  BUSINESS_FIELDS.forEach((field) => {
    Object.entries(source.business?.[field] || {}).forEach(([value, count]) => {
      target.business[field][value] = (target.business[field][value] || 0) + count
    })
  })
}

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

const readEventPage = async (kv, day, cursor = '') => {
  const listOptions = { prefix: `event:${day}:`, limit: PAGE_SIZE }
  if (cursor) listOptions.cursor = cursor
  const listed = await kv.list(listOptions)
  const summary = createSummary()
  const legacyKeys = []

  for (const key of listed.keys || []) {
    summary.eventLogCount += 1
    const metadataEvents = getMetadataEvents(key.metadata)
    if (metadataEvents.length) {
      metadataEvents.forEach((item) => addEvent(summary, item))
      summary.metadataReadCount += 1
      continue
    }
    legacyKeys.push(key.name)
  }

  for (let offset = 0; offset < legacyKeys.length; offset += LEGACY_READ_CONCURRENCY) {
    const names = legacyKeys.slice(offset, offset + LEGACY_READ_CONCURRENCY)
    const values = await Promise.all(names.map((name) => kv.get(name)))
    summary.legacyReadCount += values.length
    values.forEach((value) => {
      try {
        getRecordEvents(JSON.parse(value || '{}')).forEach((item) => addEvent(summary, item))
      } catch {
        // Broken analytics records are ignored so one bad row cannot break settlement.
      }
    })
  }

  return {
    summary,
    cursor: listed.list_complete ? '' : listed.cursor,
    complete: Boolean(listed.list_complete),
  }
}

const settleDay = async (kv, day) => {
  const summary = createSummary()
  let cursor = ''
  let pageCount = 0

  do {
    pageCount += 1
    if (pageCount > MAX_SETTLEMENT_PAGES) throw new Error('Daily settlement is too large')
    const page = await readEventPage(kv, day, cursor)
    mergeSummary(summary, page.summary)
    cursor = page.cursor
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
  const auth = getAdminAuth(context, 'STATS_ADMIN_TOKEN')
  if (!auth.authorized) return json({ ok: false, error: auth.configured ? 'UNAUTHORIZED' : 'ADMIN_TOKEN_NOT_CONFIGURED' }, auth.configured ? 401 : 503)

  const kv = context.env.TUSCALE_ANALYTICS
  if (!kv) return json({ ok: false, configured: false }, 202)

  const url = new URL(context.request.url)
  const day = url.searchParams.get('day') || getChinaDate()
  const cursor = url.searchParams.get('cursor') || ''

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

  if (day === getChinaDate()) {
    try {
      const page = await readEventPage(kv, day, cursor)
      return json({
        ok: true,
        configured: true,
        day,
        status: 'collecting',
        complete: page.complete,
        cursor: page.cursor,
        summary: await toPublicSummary(day, page.summary),
      })
    } catch (error) {
      console.error('Stats live event read failed', error)
      return json({ ok: false, error: 'KV_EVENT_READ_FAILED' }, 503)
    }
  }

  if (day < getChinaDate()) {
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
    status: 'pending',
    complete: true,
    summary: await toPublicSummary(day, createSummary()),
  })
}

export async function onRequestPost(context) {
  const auth = getAdminAuth(context, 'STATS_ADMIN_TOKEN')
  if (!auth.authorized) return json({ ok: false, error: auth.configured ? 'UNAUTHORIZED' : 'ADMIN_TOKEN_NOT_CONFIGURED' }, auth.configured ? 401 : 503)

  const kv = context.env.TUSCALE_ANALYTICS
  if (!kv) return json({ ok: false, configured: false }, 202)

  let body
  try {
    body = await context.request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }

  const start = String(body?.start || STATS_START_DATE)
  const end = String(body?.end || getChinaDate(1))
  const yesterday = getChinaDate(1)
  if (!isValidDay(start) || !isValidDay(end) || start < STATS_START_DATE || end < start || end > yesterday) {
    return json({ ok: false, error: 'INVALID_BACKFILL_RANGE' }, 400)
  }

  const days = listDays(start, end)
  if (days.length > MAX_BACKFILL_DAYS) return json({ ok: false, error: 'BACKFILL_RANGE_TOO_LARGE' }, 400)

  const finalized = []
  const skipped = []
  try {
    for (const day of days) {
      const existing = await readDailySummary(kv, day)
      if (existing) {
        skipped.push(day)
        continue
      }
      const summary = await settleDay(kv, day)
      finalized.push({ day, eventLogCount: summary.eventLogCount })
    }
  } catch (error) {
    console.error('Stats historical backfill failed', error)
    return json({ ok: false, error: 'BACKFILL_FAILED', completedDays: finalized.map((item) => item.day) }, 503)
  }

  return json({ ok: true, start, end, finalized, skipped })
}
