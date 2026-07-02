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

const TOOLS = ['upscale', 'converter', 'unknown']

const TOOL_LABELS = {
  upscale: '图片放大',
  converter: '格式转换',
  unknown: '未细分旧数据',
}

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

const createEmptyMetrics = () => Object.fromEntries(METRICS.map((metric) => [metric, 0]))

const createToolBreakdown = () => Object.fromEntries(TOOLS.map((tool) => [tool, createEmptyMetrics()]))

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

const getToolMetrics = async (kv, scope, day = '') => {
  const tools = createToolBreakdown()

  await Promise.all(TOOLS.filter((tool) => tool !== 'unknown').map(async (tool) => {
    await Promise.all(EVENTS.map(async (event) => {
      const key = scope === 'day'
        ? `tool:${tool}:day:${day}:${event}`
        : `tool:${tool}:total:${event}`
      tools[tool][event] = await readCount(kv, key)
    }))

    const visitorKey = scope === 'day'
      ? `tool:${tool}:day:${day}:unique_visitor`
      : `tool:${tool}:total:unique_visitor`
    tools[tool].unique_visitor = await readCount(kv, visitorKey)
  }))

  return tools
}

const renderStatsPage = ({ labels, totals, days, toolBreakdown = {}, configured = true, message = '' }) => {
  const today = getToday(days)
  const exportedToday = sumEvents(today, ['download', 'download_zip'])
  const exportedTotal = sumEvents(totals, ['download', 'download_zip'])
  const processTotal = sumEvents(totals, ['process_success', 'batch_item_success'])
  const processErrors = sumEvents(totals, ['process_error', 'batch_item_error'])
  const uploadMax = getMax(days, ['image_uploaded'])
  const exportMax = getMax(days, ['download', 'download_zip'])
  const visitMax = getMax(days, ['page_view'])
  const recentDays = [...days].reverse()
  const metricCards = [
    { label: '今日独立访客', value: today.unique_visitor, hint: `访问会话 ${formatNumber(today.session_start)}` },
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

  const toolRows = ['upscale', 'converter'].map((tool) => {
    const total = toolBreakdown?.totals?.[tool] || createEmptyMetrics()
    const todayValue = toolBreakdown?.today?.[tool] || createEmptyMetrics()
    const totalProcessed = sumEvents(total, ['process_success', 'batch_item_success'])
    const todayProcessed = sumEvents(todayValue, ['process_success', 'batch_item_success'])
    const totalExported = sumEvents(total, ['download', 'download_zip'])
    const todayExported = sumEvents(todayValue, ['download', 'download_zip'])

    return `
      <tr>
        <td><b>${TOOL_LABELS[tool]}</b></td>
        <td>${formatNumber(total.unique_visitor)}</td>
        <td>${formatNumber(todayValue.unique_visitor)}</td>
        <td>${formatNumber(total.image_uploaded)} / ${formatNumber(todayValue.image_uploaded)}</td>
        <td>${formatNumber(totalProcessed)} / ${formatNumber(todayProcessed)}</td>
        <td>${formatNumber(totalExported)} / ${formatNumber(todayExported)}</td>
      </tr>
    `
  }).join('')

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
    @media (max-width: 760px) {
      main { width: min(100% - 24px, 1120px); padding-top: 22px; }
      header { display: block; }
      .status { margin-top: 14px; }
      .metrics { grid-template-columns: 1fr; }
      .metric-card { padding: 16px; }
      .section-head { display: block; }
      .section-head p { margin-top: 4px; }
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

    <section>
      <div class="section-head">
        <h2>功能使用情况</h2>
        <p>按图片放大和格式转换拆分；部署后使用固定计数器统计。</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>功能</th>
              <th>累计独立访客</th>
              <th>今日独立访客</th>
              <th>上传 累计/今日</th>
              <th>成功 累计/今日</th>
              <th>导出 累计/今日</th>
            </tr>
          </thead>
          <tbody>${toolRows}</tbody>
        </table>
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>最近 30 天</h2>
        <p>独立访客是全站去重来访；浏览事件仅作参考。</p>
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

    <p class="note">口径说明：准确来访量以“独立访客”为准；2026-07-02 之后的独立访客和功能细分由固定计数器记录，统计页不再扫描原始访客列表。ZIP 数值表示 ZIP 包内导出的图片数量，不是点击 ZIP 按钮的次数。只统计产品事件，不收集图片内容、文件名、邮箱、用户身份或 IP。需要原始数据可打开 <a href="?format=json">JSON 版本</a>。</p>
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
  for (let i = 0; i < 30; i++) {
    const day = getChinaDate(i)
    const counterValues = {}
    await Promise.all(METRICS.map(async (metric) => {
      counterValues[metric] = await readCount(kv, `day:${day}:${metric}`)
    }))
    days.push({ day, ...counterValues })
  }

  const today = days[0]?.day
  const totals = counterTotals
  const [todayTools, totalTools] = today ? await Promise.all([
    getToolMetrics(kv, 'day', today),
    getToolMetrics(kv, 'total'),
  ]) : [
    createToolBreakdown(),
    createToolBreakdown(),
  ]
  const toolBreakdown = {
    labels: TOOL_LABELS,
    note: '功能细分从 2026-07-02 起使用固定计数器统计；更早事件无法准确反推属于图片放大还是格式转换。',
    today: todayTools,
    totals: totalTools,
  }

  const body = {
    ok: true,
    timezone: 'Asia/Shanghai',
    returningVisitors: { returning: 0, trackedToday: today?.unique_visitor || 0 },
    toolBreakdown,
    labels: LABELS,
    totals,
    days,
  }

  return wantsHtml && !wantsJson ? html(renderStatsPage(body)) : json(body)
}
