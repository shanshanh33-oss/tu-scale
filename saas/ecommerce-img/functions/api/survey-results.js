const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const countBy = (records, field) => records.reduce((acc, record) => {
  const key = record[field] || '未填写'
  acc[key] = (acc[key] || 0) + 1
  return acc
}, {})

const readKvList = async (kv, prefix, maxKeys = 1000) => {
  const keys = []
  let cursor
  do {
    const result = await kv.list({ prefix, cursor })
    keys.push(...(result.keys || []))
    cursor = result.list_complete ? undefined : result.cursor
  } while (cursor && keys.length < maxKeys)
  return keys
}

export async function onRequestGet(context) {
  const kv = context.env.TUSCALE_ANALYTICS
  if (!kv) return json({ ok: false, configured: false }, 202)

  const surveyKeys = await readKvList(kv, 'survey:removebg_willingness:')
  const usageKeys = await readKvList(kv, 'removebg-usage:')
  const values = await Promise.all(surveyKeys.map(({ name }) => kv.get(name)))
  const records = values.map((value) => {
    try { return JSON.parse(value || '{}') } catch { return null }
  }).filter(Boolean).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

  return json({
    ok: true,
    configured: true,
    total: records.length,
    removeBgUsageTotal: usageKeys.length,
    summary: {
      want: countBy(records, 'want'),
      plan: countBy(records, 'plan'),
      batchNeed: countBy(records, 'batchNeed'),
      monthlyVolume: countBy(records, 'monthlyVolume'),
    },
    recent: records.slice(0, 100),
  })
}
