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
]

const METRICS = [
  ...EVENTS,
  'unique_visitor',
]

const LABELS = {
  page_view: '页面浏览事件',
  session_start: '访问会话',
  unique_visitor: '独立访客（6月28日起）',
  image_uploaded: '上传图片数',
  ai_enabled: '开启 AI',
  process_start: '开始处理',
  process_success: '单图处理成功',
  process_error: '单图处理失败',
  batch_start: '批量待处理图片数',
  batch_item_success: '批量成功图片',
  batch_item_error: '批量失败图片',
  download: '单张下载图片数',
  download_zip: 'ZIP 导出图片数',
}

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const html = (body, status = 200) => new Response(body, {
  status,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const getChinaDate = (offset = 0) => {
  const time = Date.now() + 8 * 60 * 60 * 1000 - offset * 24 * 60 * 60 * 1000
  return new Date(time).toISOString().slice(0, 10)
}

const readCount = async (kv, key) => {
  const value = await kv.get(key)
  const count = Number.parseInt(value || '0', 10)
  return Number.isFinite(count) ? count : 0
}

const readKvList = async (kv, prefix) => {
  const keys = []
  let cursor
  do {
    const result = await kv.list({ prefix, cursor })
    keys.push(...(result.keys || []))
    cursor = result.list_complete ? undefined : result.cursor
  } while (cursor && keys.length < 5000)
  return keys
}

const createEmptyMetrics = () => Object.fromEntries(METRICS.map((metric) => [metric, 0]))

const formatNumber = (value) => new Intl.NumberFormat('zh-CN').format(value || 0)

const getToday = (days) => days[0] || {}

const sumEvents = (source, events) => events.reduce((total, event) => total + (source[event] || 0), 0)

const percent = (value, total) => {
  if (!total) return '0%'
  return `${Math.round((value / total) * 100)}%`
}

const getMax = (days, events) => Math.max(1, ...days.map((day) => sumEvents(day, events)))

const renderMetricCard = ({ label, value, hint }) => `
  <article class="metric-card">
    <span>${label}</span>
    <strong>${formatNumber(value)}</strong>
    <small>${hint}</small>
  </article>
`

const renderBar = (value, max) => {
  const width = Math.max(4, Math.round((value / max) * 100))
  return `<div class="bar" aria-label="${formatNumber(value)}"><i style="width:${width}%"></i></div>`
}

const maskId = (id) => {
  if (!id) return '-'
  const prefix = id.slice(0, 2)
  const tail = id.slice(-6)
  return `${prefix}...${tail}`
}

const addIdentityRecord = (records, id, event, amount) => {
  if (!id || !EVENTS.includes(event)) return
  const current = records.get(id) || { id }
  current[event] = (current[event] || 0) + amount
  records.set(id, current)
}

const normalizeIdentityRows = (records) => [...records.values()].map((record) => {
  const processed = sumEvents(record, ['process_success', 'batch_item_success'])
  const errors = sumEvents(record, ['process_error', 'batch_item_error'])
  const exportedImages = sumEvents(record, ['download', 'download_zip'])
  const score = (record.image_uploaded || 0) + processed + exportedImages
  return {
    ...record,
    exportedImages,
    errors,
    processed,
    score,
  }
}).sort((a, b) => b.score - a.score)

const getEventLogStats = async (kv, day) => {
  const keys = await readKvList(kv, `event:${day}:`)
  const totals = createEmptyMetrics()
  const visitors = new Map()
  const sessions = new Map()
  const uniqueVisitors = new Set()

  await Promise.all(keys.map(async ({ name }) => {
    let record
    try {
      record = JSON.parse(await kv.get(name) || '{}')
    } catch {
      return
    }

    const event = String(record.event || '')
    if (!EVENTS.includes(event)) return
    const amount = Math.max(1, Number.parseInt(record.amount || '1', 10) || 1)
    const visitorId = String(record.visitorId || '')
    const sessionId = String(record.sessionId || '')

    totals[event] += amount
    if (visitorId) {
      uniqueVisitors.add(visitorId)
      addIdentityRecord(visitors, visitorId, event, amount)
    }
    if (sessionId) addIdentityRecord(sessions, sessionId, event, amount)
  }))

  totals.unique_visitor = uniqueVisitors.size

  return {
    hasLogs: keys.length > 0,
    sessions: normalizeIdentityRows(sessions).slice(0, 8),
    totals,
    visitors: normalizeIdentityRows(visitors).slice(0, 8),
  }
}

const getIdentityTotals = async (kv, type, day) => {
  const prefix = `${type}:day:${day}:`
  const keys = await readKvList(kv, prefix)
  const totals = createEmptyMetrics()
  const ids = new Set()

  await Promise.all(keys.map(async ({ name }) => {
    const rest = name.slice(prefix.length)
    const parts = rest.split(':')
    const id = parts[0]
    if (id) ids.add(id)
    if (parts.length !== 2) return
    const event = parts[1]
    if (!EVENTS.includes(event)) return
    totals[event] += await readCount(kv, name)
  }))

  if (type === 'visitor') totals.unique_visitor = ids.size
  return totals
}

const mergeMetricMaximums = (...sources) => {
  const merged = createEmptyMetrics()
  METRICS.forEach((metric) => {
    merged[metric] = Math.max(...sources.map((source) => source?.[metric] || 0))
  })
  return merged
}

const getIdentityStats = async (kv, type, day) => {
  const prefix = `${type}:day:${day}:`
  const keys = await readKvList(kv, prefix)
  const records = new Map()

  await Promise.all(keys.map(async ({ name }) => {
    const rest = name.slice(prefix.length)
    const parts = rest.split(':')
    if (parts.length !== 2) return
    const [id, event] = parts
    if (!EVENTS.includes(event)) return
    const current = records.get(id) || { id }
    current[event] = await readCount(kv, name)
    records.set(id, current)
  }))

  return normalizeIdentityRows(records).slice(0, 8)
}

const getTodayReturningVisitors = async (kv, days) => {
  const today = days[0]?.day
  if (!today) return { returning: 0, trackedToday: 0 }

  const todayKeys = await readKvList(kv, `visitor:day:${today}:`)
  const todayIds = todayKeys
    .map(({ name }) => name.slice(`visitor:day:${today}:`.length).split(':')[0])
    .filter(Boolean)

  const previousIds = new Set()
  for (const day of days.slice(1, 8)) {
    const keys = await readKvList(kv, `visitor:day:${day.day}:`)
    keys.forEach(({ name }) => {
      const id = name.slice(`visitor:day:${day.day}:`.length).split(':')[0]
      if (id) previousIds.add(id)
    })
  }

  const uniqueToday = [...new Set(todayIds)]
  return {
    returning: uniqueToday.filter((id) => previousIds.has(id)).length,
    trackedToday: uniqueToday.length,
  }
}

const getRiskLevel = (score) => {
  if (score >= 7) return { label: '高', className: 'high', text: '存在明显批量使用迹象，免费资源和未来 API 成本容易被少数用户快速消耗。' }
  if (score >= 4) return { label: '中', className: 'medium', text: '有批量使用迹象，建议继续观察并限制超大任务。' }
  return { label: '低', className: 'low', text: '目前更像正常试用，可以继续免费观察。' }
}

const buildAnalysis = ({ today, totals, identityStats }) => {
  const visitors = today.unique_visitor || 0
  const uploads = today.image_uploaded || 0
  const processed = sumEvents(today, ['process_success', 'batch_item_success'])
  const errors = sumEvents(today, ['process_error', 'batch_item_error'])
  const exportedImages = sumEvents(today, ['download', 'download_zip'])
  const zipExportedImages = today.download_zip || 0
  const batchSuccess = today.batch_item_success || 0
  const totalProcessed = sumEvents(totals, ['process_success', 'batch_item_success'])
  const totalErrors = sumEvents(totals, ['process_error', 'batch_item_error'])
  const topVisitor = identityStats?.visitors?.[0]
  const returning = identityStats?.returningVisitors?.returning || 0
  const trackedToday = identityStats?.returningVisitors?.trackedToday || 0

  const uploadPerVisitor = visitors ? uploads / visitors : 0
  const exportPerVisitor = visitors ? exportedImages / visitors : 0
  const zipShare = exportedImages ? zipExportedImages / exportedImages : 0
  const processSuccessRate = uploads ? processed / uploads : 0

  let riskScore = 0
  if (uploadPerVisitor >= 50) riskScore += 3
  else if (uploadPerVisitor >= 20) riskScore += 2
  else if (uploadPerVisitor >= 8) riskScore += 1

  if (exportPerVisitor >= 50) riskScore += 3
  else if (exportPerVisitor >= 20) riskScore += 2
  else if (exportPerVisitor >= 8) riskScore += 1

  if (zipShare >= 0.8 && zipExportedImages >= 20) riskScore += 2
  else if (zipShare >= 0.5 && zipExportedImages >= 10) riskScore += 1

  if (batchSuccess >= 50) riskScore += 2
  else if (batchSuccess >= 10) riskScore += 1

  const risk = getRiskLevel(riskScore)
  const demandSignal = uploads >= 50 && exportedImages >= 20 && processSuccessRate >= 0.25
  const likelyBatch = uploadPerVisitor >= 20 || exportPerVisitor >= 20 || zipShare >= 0.7 || batchSuccess >= 20
    || (topVisitor && ((topVisitor.image_uploaded || 0) >= 50 || topVisitor.exportedImages >= 50))
  const shouldCharge = demandSignal && (likelyBatch || exportedImages >= processed)
  const hasReturningSignal = returning > 0

  const summary = likelyBatch
    ? '今天高度疑似存在批量放大/批量导出行为。部署匿名明细统计后，可以继续观察是否集中在同一个 visitor。'
    : '今天暂未看到强烈批量使用迹象，更像普通免费试用或低频使用。'

  const recommendation = shouldCharge
    ? '保留免费入口，但建议尽快上线软限制：未登录每日少量免费，批量 ZIP、优先队列和更高额度引导注册或积分。'
    : '继续免费观察，同时补充 visitor/session 维度统计，为后续判断回头用户和真实付费意愿做准备。'

  const facts = [
    `平均每位独立访客上传 ${uploadPerVisitor.toFixed(1)} 张，导出 ${exportPerVisitor.toFixed(1)} 张。`,
    `ZIP 导出图片占今日导出图片 ${percent(zipExportedImages, exportedImages)}，ZIP 内图片数为 ${formatNumber(zipExportedImages)}。`,
    `今日上传到成功处理比例约 ${percent(processed, uploads)}，今日处理错误率 ${percent(errors, processed + errors)}。`,
    `今日识别到 ${formatNumber(trackedToday)} 个匿名访客，其中 ${formatNumber(returning)} 个近 7 天曾来过。`,
    `累计处理错误率 ${percent(totalErrors, totalProcessed + totalErrors)}。`,
  ]

  const nextActions = shouldCharge
    ? [
        '暂不取消免费，先把大批量任务放入慢速队列。',
        '未登录用户保留少量免费次数，ZIP 导出或批量处理提示注册。',
        hasReturningSignal ? '已有回头访客迹象，继续观察是否持续批量使用。' : '继续观察 visitor/session 明细，确认是否为回头用户。',
      ]
    : [
        '继续免费开放，避免过早打断种子用户。',
        '先记录单个 visitor 的上传、处理、ZIP 导出图片数和隔日回访。',
        '如果连续 2-3 天出现高上传/高 ZIP，再开启软限制。',
      ]

  return {
    demandSignal,
    facts,
    likelyBatch,
    nextActions,
    recommendation,
    risk,
    summary,
    hasReturningSignal,
  }
}

const renderIdentityTable = (title, rows) => `
  <section>
    <div class="section-head">
      <h2>${title}</h2>
      <p>匿名 ID 已打码，只用于判断是否集中在少数用户。</p>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>匿名 ID</th>
            <th>上传</th>
            <th>处理成功</th>
            <th>处理失败</th>
            <th>导出图片</th>
            <th>ZIP 内图片</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map((row) => `
            <tr>
              <td>${maskId(row.id)}</td>
              <td><b>${formatNumber(row.image_uploaded)}</b></td>
              <td><b>${formatNumber(row.processed)}</b></td>
              <td>${formatNumber(row.errors)}</td>
              <td><b>${formatNumber(row.exportedImages)}</b></td>
              <td>${formatNumber(row.download_zip)}</td>
            </tr>
          `).join('') : '<tr><td colspan="6">部署后开始积累匿名明细；目前暂无可展示数据。</td></tr>'}
        </tbody>
      </table>
    </div>
  </section>
`

const renderAnalysis = (analysis) => `
  <section class="analysis-section">
    <div class="section-head">
      <div>
        <h2>每日分析报告</h2>
        <p>根据当前统计自动判断批量使用、需求信号和下一步动作。</p>
      </div>
      <span class="risk-pill ${analysis.risk.className}">资源风险 ${analysis.risk.label}</span>
    </div>
    <div class="analysis-grid">
      <article class="analysis-card">
        <span>批量使用判断</span>
        <strong>${analysis.likelyBatch ? '疑似批量使用' : '暂未明显异常'}</strong>
        <p>${analysis.summary}</p>
      </article>
      <article class="analysis-card">
        <span>需求信号</span>
        <strong>${analysis.demandSignal ? '有付费验证价值' : '继续观察'}</strong>
        <p>${analysis.recommendation}</p>
      </article>
      <article class="analysis-card">
        <span>资源风险说明</span>
        <strong>${analysis.risk.text}</strong>
        <p>${analysis.hasReturningSignal ? '已经看到回头访客迹象。' : '回头用户需要持续观察 2-7 天。'}</p>
      </article>
    </div>
    <div class="analysis-lists">
      <div>
        <h3>关键依据</h3>
        <ul>${analysis.facts.map((item) => `<li>${item}</li>`).join('')}</ul>
      </div>
      <div>
        <h3>建议动作</h3>
        <ul>${analysis.nextActions.map((item) => `<li>${item}</li>`).join('')}</ul>
      </div>
    </div>
  </section>
`

const renderStatsPage = ({ labels, totals, days, identityStats = {}, configured = true, message = '' }) => {
  const today = getToday(days)
  const exportedToday = sumEvents(today, ['download', 'download_zip'])
  const exportedTotal = sumEvents(totals, ['download', 'download_zip'])
  const processTotal = sumEvents(totals, ['process_success', 'batch_item_success'])
  const processErrors = sumEvents(totals, ['process_error', 'batch_item_error'])
  const uploadMax = getMax(days, ['image_uploaded'])
  const exportMax = getMax(days, ['download', 'download_zip'])
  const visitMax = getMax(days, ['page_view'])
  const recentDays = [...days].reverse()
  const analysis = buildAnalysis({ today, totals, identityStats })
  const returningVisitors = identityStats?.returningVisitors?.returning || 0

  const metricCards = [
    { label: '今日独立访客', value: today.unique_visitor, hint: `访问会话 ${formatNumber(today.session_start)}` },
    { label: '今日回访访客', value: returningVisitors, hint: '近 7 天曾访问过' },
    { label: '今天上传', value: today.image_uploaded, hint: `处理成功 ${formatNumber(sumEvents(today, ['process_success', 'batch_item_success']))}` },
    { label: '今天导出图片', value: exportedToday, hint: `ZIP 内图片 ${formatNumber(today.download_zip)}` },
    { label: '累计独立访客', value: totals.unique_visitor, hint: `累计会话 ${formatNumber(totals.session_start)}` },
    { label: '累计上传', value: totals.image_uploaded, hint: `成功处理 ${formatNumber(processTotal)}` },
    { label: '累计导出图片', value: exportedTotal, hint: `处理错误率 ${percent(processErrors, processTotal + processErrors)}` },
  ].map(renderMetricCard).join('')

  const tableRows = recentDays.map((day) => {
    const processed = sumEvents(day, ['process_success', 'batch_item_success'])
    const exportedImages = sumEvents(day, ['download', 'download_zip'])
    return `
      <tr>
        <td>${day.day}</td>
        <td><b>${formatNumber(day.page_view)}</b>${renderBar(day.page_view || 0, visitMax)}</td>
        <td><b>${formatNumber(day.unique_visitor)}</b></td>
        <td><b>${formatNumber(day.session_start)}</b></td>
        <td><b>${formatNumber(day.image_uploaded)}</b>${renderBar(day.image_uploaded || 0, uploadMax)}</td>
        <td><b>${formatNumber(processed)}</b></td>
        <td><b>${formatNumber(exportedImages)}</b>${renderBar(exportedImages, exportMax)}</td>
      </tr>
    `
  }).join('')

  const eventRows = EVENTS.map((event) => `
    <tr>
      <td>${labels[event] || event}</td>
      <td>${event}</td>
      <td><b>${formatNumber(totals[event])}</b></td>
      <td>${formatNumber(today[event])}</td>
    </tr>
  `).join('')

  const status = configured
    ? '<span class="status ok">统计正常</span>'
    : `<span class="status warn">${message || '统计未配置'}</span>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TU Scale 流量统计</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #18202a;
      --muted: #687385;
      --line: #e4e8ee;
      --accent: #1677ff;
      --accent-soft: #dbeafe;
      --good: #0f9f6e;
      --warn: #c07900;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      line-height: 1.5;
    }
    main {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0 48px;
    }
    header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: clamp(28px, 4vw, 42px);
      letter-spacing: 0;
    }
    p { margin: 0; color: var(--muted); }
    a { color: var(--accent); text-decoration: none; }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--muted);
      white-space: nowrap;
      font-size: 14px;
    }
    .status.ok { color: var(--good); }
    .status.warn { color: var(--warn); }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin: 20px 0;
    }
    .metric-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }
    .metric-card span,
    .metric-card small {
      display: block;
      color: var(--muted);
      font-size: 14px;
    }
    .metric-card strong {
      display: block;
      margin: 6px 0 4px;
      font-size: clamp(28px, 5vw, 40px);
      line-height: 1.05;
      letter-spacing: 0;
    }
    section {
      margin-top: 18px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
    }
    h2 {
      margin: 0;
      font-size: 18px;
      letter-spacing: 0;
    }
    .table-wrap { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
    }
    th, td {
      padding: 12px 18px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }
    th {
      color: var(--muted);
      font-weight: 600;
      font-size: 13px;
      background: #fbfcfd;
    }
    tr:last-child td { border-bottom: 0; }
    td b {
      display: inline-block;
      min-width: 42px;
      font-weight: 650;
    }
    .bar {
      display: inline-block;
      width: 96px;
      height: 8px;
      margin-left: 10px;
      overflow: hidden;
      border-radius: 99px;
      background: var(--accent-soft);
      vertical-align: middle;
    }
    .bar i {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--accent);
    }
    .note {
      margin-top: 14px;
      font-size: 13px;
      color: var(--muted);
    }
    .analysis-section {
      border-color: #d8e6ff;
    }
    .risk-pill {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 0 12px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 650;
      white-space: nowrap;
    }
    .risk-pill.low {
      color: #0f7a55;
      background: #edfdf6;
      border: 1px solid #bdebd8;
    }
    .risk-pill.medium {
      color: #9a5a00;
      background: #fff7e6;
      border: 1px solid #f3d49a;
    }
    .risk-pill.high {
      color: #b42318;
      background: #fff1f0;
      border: 1px solid #ffccc7;
    }
    .analysis-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      padding: 18px;
    }
    .analysis-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: #fbfcfd;
    }
    .analysis-card span {
      display: block;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 6px;
    }
    .analysis-card strong {
      display: block;
      margin-bottom: 8px;
      font-size: 18px;
      line-height: 1.35;
    }
    .analysis-card p {
      font-size: 14px;
    }
    .analysis-lists {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
      padding: 0 18px 18px;
    }
    .analysis-lists > div {
      border-top: 1px solid var(--line);
      padding-top: 14px;
    }
    h3 {
      margin: 0 0 8px;
      font-size: 15px;
    }
    ul {
      margin: 0;
      padding-left: 20px;
      color: var(--muted);
    }
    li + li {
      margin-top: 6px;
    }
    @media (max-width: 760px) {
      main { width: min(100% - 24px, 1120px); padding-top: 22px; }
      header { display: block; }
      .status { margin-top: 14px; }
      .metrics { grid-template-columns: 1fr; }
      .metric-card { padding: 16px; }
      .section-head { display: block; }
      .section-head p { margin-top: 4px; }
      .risk-pill { margin-top: 12px; }
      .analysis-grid,
      .analysis-lists { grid-template-columns: 1fr; }
      th, td { padding: 11px 14px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>TU Scale 流量统计</h1>
        <p>按北京时间统计。独立访客为匿名浏览器 ID 统计；旧页面浏览事件可能因 KV 非原子计数丢失。</p>
      </div>
      ${status}
    </header>

    <div class="metrics">${metricCards}</div>

    ${renderAnalysis(analysis)}

    ${renderIdentityTable('今日 Top 匿名访客', identityStats.visitors || [])}

    ${renderIdentityTable('今日 Top 会话', identityStats.sessions || [])}

    <section>
      <div class="section-head">
        <h2>最近 30 天</h2>
        <p>横条越长，代表当天数值越高。</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>浏览事件（参考）</th>
              <th>独立访客</th>
              <th>访客粗略值</th>
              <th>上传图片</th>
              <th>处理成功</th>
              <th>导出图片</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>事件明细</h2>
        <p>给调试和判断功能使用情况时看。</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>中文名称</th>
              <th>事件名</th>
              <th>累计</th>
              <th>今天</th>
            </tr>
          </thead>
          <tbody>${eventRows}</tbody>
        </table>
      </div>
    </section>

    <p class="note">口径说明：准确来访量以“独立访客”为准；页面浏览事件在旧版本中使用非原子 KV 计数，历史值可能低估且无法精确还原。ZIP 数值表示 ZIP 包内导出的图片数量，不是点击 ZIP 按钮的次数。只统计产品事件，不收集图片内容、文件名、邮箱、用户身份或 IP。需要原始数据可打开 <a href="?format=json">JSON 版本</a>。</p>
  </main>
</body>
</html>`
}

export async function onRequestGet(context) {
  const kv = context.env.TUSCALE_ANALYTICS
  const requestUrl = new URL(context.request.url)
  const accept = context.request.headers.get('accept') || ''
  const wantsHtml = requestUrl.searchParams.get('format') === 'html'
    || !accept.includes('application/json')
    || accept.includes('text/html')
  const wantsJson = requestUrl.searchParams.get('format') === 'json'

  if (!kv) {
    const body = {
      ok: false,
      configured: false,
      message: 'Missing Cloudflare KV binding: TUSCALE_ANALYTICS',
      labels: LABELS,
      totals: Object.fromEntries(METRICS.map((metric) => [metric, 0])),
      days: [],
    }
    return wantsHtml && !wantsJson ? html(renderStatsPage(body), 202) : json(body, 202)
  }

  const counterTotals = {}
  await Promise.all(METRICS.map(async (metric) => {
    counterTotals[metric] = await readCount(kv, `total:${metric}`)
  }))

  const days = []
  const eventLogStatsByDay = {}
  for (let i = 0; i < 30; i++) {
    const day = getChinaDate(i)
    const counterValues = {}
    await Promise.all(METRICS.map(async (metric) => {
      counterValues[metric] = await readCount(kv, `day:${day}:${metric}`)
    }))
    const [eventLogStats, visitorTotals] = await Promise.all([
      getEventLogStats(kv, day),
      getIdentityTotals(kv, 'visitor', day),
    ])
    const values = mergeMetricMaximums(counterValues, visitorTotals, eventLogStats.totals)
    eventLogStatsByDay[day] = eventLogStats
    days.push({ day, ...values })
  }

  const dayTotals = createEmptyMetrics()
  days.forEach((day) => {
    METRICS.forEach((metric) => {
      dayTotals[metric] += day[metric] || 0
    })
  })

  const totalVisitorKeys = await readKvList(kv, 'visitor:total:')
  const totals = mergeMetricMaximums(counterTotals, dayTotals)
  totals.unique_visitor = Math.max(counterTotals.unique_visitor || 0, totalVisitorKeys.length)

  const today = days[0]?.day
  const [counterSessions, counterVisitors, returningVisitors] = today ? await Promise.all([
    getIdentityStats(kv, 'session', today),
    getIdentityStats(kv, 'visitor', today),
    getTodayReturningVisitors(kv, days),
  ]) : [[], [], { returning: 0, trackedToday: 0 }]

  const identityStats = today ? {
    returningVisitors,
    sessions: counterSessions,
    visitors: counterVisitors,
  } : {
    returningVisitors: { returning: 0, trackedToday: 0 },
    sessions: [],
    visitors: [],
  }

  const body = {
    ok: true,
    timezone: 'Asia/Shanghai',
    identityStats,
    labels: LABELS,
    totals,
    days,
  }

  return wantsHtml && !wantsJson ? html(renderStatsPage(body)) : json(body)
}
