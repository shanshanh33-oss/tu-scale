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

const LABELS = {
  page_view: '页面浏览',
  session_start: '访问人数粗略值',
  image_uploaded: '上传图片',
  ai_enabled: '开启 AI',
  process_start: '开始处理',
  process_success: '单图处理成功',
  process_error: '单图处理失败',
  batch_start: '批量开始',
  batch_item_success: '批量成功图片',
  batch_item_error: '批量失败图片',
  download: '下载图片',
  download_zip: '下载 ZIP',
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

const renderStatsPage = ({ labels, totals, days, configured = true, message = '' }) => {
  const today = getToday(days)
  const downloadsToday = sumEvents(today, ['download', 'download_zip'])
  const downloadsTotal = sumEvents(totals, ['download', 'download_zip'])
  const processTotal = sumEvents(totals, ['process_success', 'batch_item_success'])
  const processErrors = sumEvents(totals, ['process_error', 'batch_item_error'])
  const uploadMax = getMax(days, ['image_uploaded'])
  const downloadMax = getMax(days, ['download', 'download_zip'])
  const visitMax = getMax(days, ['page_view'])
  const recentDays = [...days].reverse()

  const metricCards = [
    { label: '今天访问', value: today.page_view, hint: `访客粗略值 ${formatNumber(today.session_start)}` },
    { label: '今天上传', value: today.image_uploaded, hint: `处理成功 ${formatNumber(sumEvents(today, ['process_success', 'batch_item_success']))}` },
    { label: '今天下载', value: downloadsToday, hint: `ZIP 下载 ${formatNumber(today.download_zip)}` },
    { label: '累计访问', value: totals.page_view, hint: `累计访客粗略值 ${formatNumber(totals.session_start)}` },
    { label: '累计上传', value: totals.image_uploaded, hint: `成功处理 ${formatNumber(processTotal)}` },
    { label: '累计下载', value: downloadsTotal, hint: `处理错误率 ${percent(processErrors, processTotal + processErrors)}` },
  ].map(renderMetricCard).join('')

  const tableRows = recentDays.map((day) => {
    const processed = sumEvents(day, ['process_success', 'batch_item_success'])
    const downloads = sumEvents(day, ['download', 'download_zip'])
    return `
      <tr>
        <td>${day.day}</td>
        <td><b>${formatNumber(day.page_view)}</b>${renderBar(day.page_view || 0, visitMax)}</td>
        <td><b>${formatNumber(day.session_start)}</b></td>
        <td><b>${formatNumber(day.image_uploaded)}</b>${renderBar(day.image_uploaded || 0, uploadMax)}</td>
        <td><b>${formatNumber(processed)}</b></td>
        <td><b>${formatNumber(downloads)}</b>${renderBar(downloads, downloadMax)}</td>
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
        <p>按北京时间统计，展示最近 30 天的访问、上传、处理和下载情况。</p>
      </div>
      ${status}
    </header>

    <div class="metrics">${metricCards}</div>

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
              <th>浏览</th>
              <th>访客粗略值</th>
              <th>上传图片</th>
              <th>处理成功</th>
              <th>下载</th>
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

    <p class="note">只统计产品事件，不收集图片内容、文件名、邮箱或用户身份。需要原始数据可打开 <a href="?format=json">JSON 版本</a>。</p>
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
      totals: Object.fromEntries(EVENTS.map((event) => [event, 0])),
      days: [],
    }
    return wantsHtml && !wantsJson ? html(renderStatsPage(body), 202) : json(body, 202)
  }

  const totals = {}
  await Promise.all(EVENTS.map(async (event) => {
    totals[event] = await readCount(kv, `total:${event}`)
  }))

  const days = []
  for (let i = 0; i < 30; i++) {
    const day = getChinaDate(i)
    const values = {}
    await Promise.all(EVENTS.map(async (event) => {
      values[event] = await readCount(kv, `day:${day}:${event}`)
    }))
    days.push({ day, ...values })
  }

  const body = {
    ok: true,
    timezone: 'Asia/Shanghai',
    labels: LABELS,
    totals,
    days,
  }

  return wantsHtml && !wantsJson ? html(renderStatsPage(body)) : json(body)
}
