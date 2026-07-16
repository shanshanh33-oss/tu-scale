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

const METRICS = [
  ...EVENTS,
  'unique_visitor',
]

const TOOLS = ['upscale', 'converter', 'product_image', 'unknown']

const TOOL_LABELS = {
  upscale: '图片放大',
  converter: '图片压缩',
  product_image: '商品图规范化',
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
  download: '旧版单张下载事件',
  download_zip: '旧版 ZIP 图片累计（可能重复）',
  download_success: '成功下载操作',
  exported_image: '首次成功导出图片',
  survey_submit: '功能意愿反馈',
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

const getStatsToken = (request) => {
  const authorization = request.headers.get('authorization') || ''
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim()
  return new URL(request.url).searchParams.get('token') || ''
}

const isStatsAuthorized = (context) => {
  const expected = String(context.env.STATS_ADMIN_TOKEN || '')
  return !expected || getStatsToken(context.request) === expected
}

const getChinaDate = (offset = 0) => {
  const time = Date.now() + 8 * 60 * 60 * 1000 - offset * 24 * 60 * 60 * 1000
  return new Date(time).toISOString().slice(0, 10)
}

const readKvList = async (kv, prefix, maxKeys = 20000) => {
  const keys = []
  let cursor = ''
  do {
    const listOptions = { prefix }
    if (cursor) listOptions.cursor = cursor
    const result = await kv.list(listOptions)
    keys.push(...(result.keys || []))
    cursor = result.list_complete ? undefined : result.cursor
  } while (cursor && keys.length < maxKeys)
  return keys
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

const normalizeEvent = (event) => EVENTS.includes(event) ? event : ''

const normalizeTool = (tool) => TOOLS.includes(tool) ? tool : 'unknown'

const addToolEvent = (tools, tool, event, amount) => {
  const key = normalizeTool(tool)
  tools[key][event] += amount
}

const readRecordsInChunks = async (kv, keys, chunkSize = 50) => {
  const records = []
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize)
    const values = await Promise.all(chunk.map(({ name }) => kv.get(name)))
    records.push(...values)
  }
  return records
}

const mergeMetrics = (target, source) => {
  METRICS.forEach((metric) => {
    target[metric] += source?.[metric] || 0
  })
}

const mergeToolBreakdown = (target, source) => {
  TOOLS.forEach((tool) => {
    mergeMetrics(target[tool], source?.[tool] || {})
  })
}

const summarizeEventLogsForDay = async (kv, day) => {
  const keys = await readKvList(kv, `event:${day}:`)
  const records = await readRecordsInChunks(kv, keys)
  const totals = createEmptyMetrics()
  const tools = createToolBreakdown()
  const visitors = new Set()
  const toolVisitors = Object.fromEntries(TOOLS.map((tool) => [tool, new Set()]))

  records.forEach((value) => {
    let record
    try {
      record = JSON.parse(value || '{}')
    } catch {
      return
    }

    const event = normalizeEvent(String(record.event || ''))
    if (!event) return

    const amount = Math.max(1, Number.parseInt(record.amount || '1', 10) || 1)
    const visitorId = String(record.visitorId || '')
    const tool = normalizeTool(String(record.tool || 'unknown'))

    totals[event] += amount
    addToolEvent(tools, tool, event, amount)

    if (visitorId) {
      visitors.add(visitorId)
      toolVisitors[tool].add(visitorId)
    }
  })

  totals.unique_visitor = visitors.size
  TOOLS.forEach((tool) => {
    tools[tool].unique_visitor = toolVisitors[tool].size
  })

  return {
    day,
    totals,
    tools,
    eventLogCount: keys.length,
    source: 'event_logs',
  }
}

const getDaySummary = (kv, day) => summarizeEventLogsForDay(kv, day)

const renderStatsPage = ({ labels, totals, days, toolBreakdown = {}, dataSource = {}, configured = true, message = '' }) => {
  const today = getToday(days)
  const exportedToday = today.exported_image || 0
  const exportedTotal = totals.exported_image || 0
  const processTotal = sumEvents(totals, ['process_success', 'batch_item_success'])
  const processErrors = sumEvents(totals, ['process_error', 'batch_item_error'])
  const uploadMax = getMax(days, ['image_uploaded'])
  const exportMax = getMax(days, ['exported_image'])
  const visitMax = getMax(days, ['page_view'])
  const recentDays = [...days].reverse()
  const metricCards = [
    { label: '今日独立访客', value: today.unique_visitor, hint: `访问会话 ${formatNumber(today.session_start)}` },
    { label: '今天上传', value: today.image_uploaded, hint: `处理成功 ${formatNumber(sumEvents(today, ['process_success', 'batch_item_success']))}` },
    { label: '今天首次导出图片', value: exportedToday, hint: `成功下载操作 ${formatNumber(today.download_success)}` },
    { label: '累计独立访客', value: totals.unique_visitor, hint: `累计会话 ${formatNumber(totals.session_start)}` },
    { label: '累计上传', value: totals.image_uploaded, hint: `成功处理 ${formatNumber(processTotal)}` },
    { label: '累计首次导出图片', value: exportedTotal, hint: `处理错误率 ${percent(processErrors, processTotal + processErrors)}` },
  ].map(renderMetricCard).join('')

  const tableRows = recentDays.map((day) => {
    const processed = sumEvents(day, ['process_success', 'batch_item_success'])
    const exportedImages = day.exported_image || 0
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

  const toolRows = ['upscale', 'converter', 'product_image'].map((tool) => {
    const total = toolBreakdown?.totals?.[tool] || createEmptyMetrics()
    const todayValue = toolBreakdown?.today?.[tool] || createEmptyMetrics()
    const totalProcessed = sumEvents(total, ['process_success', 'batch_item_success'])
    const todayProcessed = sumEvents(todayValue, ['process_success', 'batch_item_success'])
    const totalExported = total.exported_image || 0
    const todayExported = todayValue.exported_image || 0

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
  const dataSourceText = dataSource?.source === 'event_logs'
    ? `原始事件日志汇总，最近刷新 ${dataSource.generatedAt || ''}`
    : '统计未配置'

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
        <p>按北京时间统计。数字从原始事件日志汇总，不再用估算计数器当最终结果。</p>
      </div>
      ${status}
    </header>

    <div class="metrics">${metricCards}</div>

    <section>
      <div class="section-head">
        <h2>功能使用情况</h2>
        <p>按图片放大、图片压缩和商品图规范化拆分。</p>
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
              <th>访问会话</th>
              <th>上传图片</th>
              <th>处理成功</th>
              <th>首次导出图片</th>
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

    <p class="note">口径说明：准确来访量以“独立访客”为准；访问会话为 session_start 事件数。ZIP 数值表示 ZIP 包内导出的图片数量，不是点击 ZIP 按钮的次数。只统计产品事件，不收集图片内容、文件名、邮箱、用户身份或 IP。数据源：${dataSourceText}。需要原始数据可打开 <a href="?format=json">JSON 版本</a>。</p>
  </main>
</body>
</html>`
}

const renderStatsShell = () => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TU Scale 流量统计</title>
  <style>
    :root { color-scheme: light; --bg:#f6f7f9; --panel:#fff; --text:#18202a; --muted:#687385; --line:#e4e8ee; --accent:#1677ff; --soft:#dbeafe; --good:#0f9f6e; --warn:#c07900; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; line-height:1.5; }
    main { width:min(1120px, calc(100% - 32px)); margin:0 auto; padding:32px 0 48px; }
    header { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:20px; }
    h1 { margin:0 0 6px; font-size:clamp(28px,4vw,42px); letter-spacing:0; }
    p { margin:0; color:var(--muted); }
    .status { display:inline-flex; align-items:center; min-height:34px; padding:0 12px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--muted); white-space:nowrap; font-size:14px; }
    .status.ok { color:var(--good); }
    .status.warn { color:var(--warn); }
    .metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:20px 0; }
    .metric-card, section { background:var(--panel); border:1px solid var(--line); border-radius:8px; }
    .metric-card { padding:18px; }
    .metric-card span, .metric-card small { display:block; color:var(--muted); font-size:14px; }
    .metric-card strong { display:block; margin:6px 0 4px; font-size:clamp(28px,5vw,40px); line-height:1.05; letter-spacing:0; }
    section { margin-top:18px; overflow:hidden; }
    .section-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid var(--line); }
    h2 { margin:0; font-size:18px; letter-spacing:0; }
    .table-wrap { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; min-width:720px; }
    th, td { padding:12px 18px; border-bottom:1px solid var(--line); text-align:left; vertical-align:middle; white-space:nowrap; }
    th { color:var(--muted); font-weight:600; font-size:13px; background:#fbfcfd; }
    tr:last-child td { border-bottom:0; }
    td b { display:inline-block; min-width:42px; font-weight:650; }
    .bar { display:inline-block; width:96px; height:8px; margin-left:10px; overflow:hidden; border-radius:99px; background:var(--soft); vertical-align:middle; }
    .bar i { display:block; height:100%; border-radius:inherit; background:var(--accent); }
    .note { margin-top:14px; font-size:13px; color:var(--muted); }
    .anomaly { display:block; margin-top:4px; color:#b45309; font-size:11px; font-weight:600; white-space:normal; }
    @media (max-width:760px) { main { width:min(100% - 24px,1120px); padding-top:22px; } header, .section-head { display:block; } .status { margin-top:14px; } .metrics { grid-template-columns:1fr; } th, td { padding:11px 14px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>TU Scale 流量统计</h1>
        <p>按北京时间统计。页面会分批读取原始日志，避免单次 Worker 读取过多导致失败。</p>
      </div>
      <span id="status" class="status">正在读取</span>
    </header>
    <div id="metrics" class="metrics"></div>
    <section>
      <div class="section-head"><h2>功能使用情况</h2><p>按图片放大、图片压缩和商品图规范化拆分。</p></div>
      <div class="table-wrap"><table><thead><tr><th>功能</th><th>累计独立访客</th><th>今日独立访客</th><th>上传 累计/今日</th><th>成功 累计/今日</th><th>首次导出 累计/今日</th></tr></thead><tbody id="toolRows"></tbody></table></div>
    </section>
    <section>
      <div class="section-head"><h2>最近 30 天</h2><p>独立访客是全站去重来访；浏览事件仅作参考。</p></div>
      <div class="table-wrap"><table><thead><tr><th>日期</th><th>浏览事件（参考）</th><th>独立访客</th><th>访问会话</th><th>上传图片</th><th>处理成功</th><th>成功下载操作</th><th>首次导出图片</th><th>旧口径导出</th></tr></thead><tbody id="dayRows"></tbody></table></div>
    </section>
    <section>
      <div class="section-head"><h2>事件明细</h2><p>给调试和判断功能使用情况时看。</p></div>
      <div class="table-wrap"><table><thead><tr><th>中文名称</th><th>事件名</th><th>累计</th><th>今天</th></tr></thead><tbody id="eventRows"></tbody></table></div>
    </section>
    <p id="note" class="note">正在读取原始日志。</p>
  </main>
  <script>
    const EVENTS = ${JSON.stringify(EVENTS)};
    const METRICS = ${JSON.stringify(METRICS)};
    const TOOLS = ${JSON.stringify(TOOLS)};
    const LABELS = ${JSON.stringify(LABELS)};
    const TOOL_LABELS = ${JSON.stringify(TOOL_LABELS)};
    const STATS_TOKEN = new URLSearchParams(window.location.search).get('token') || '';
    const ANOMALOUS_DAYS = { '2026-07-12': '旧版 ZIP 重复触发：426 不是不同图片的成功导出数' };
    const emptyMetrics = () => Object.fromEntries(METRICS.map((metric) => [metric, 0]));
    const emptyTools = () => Object.fromEntries(TOOLS.map((tool) => [tool, emptyMetrics()]));
    const fmt = (value) => new Intl.NumberFormat('zh-CN').format(value || 0);
    const sum = (source, events) => events.reduce((total, event) => total + (source[event] || 0), 0);
    const percent = (value, total) => total ? Math.round((value / total) * 100) + '%' : '0%';
    const dayText = (offset = 0) => new Date(Date.now() + 8 * 3600 * 1000 - offset * 86400 * 1000).toISOString().slice(0, 10);
    const addMetrics = (target, source) => METRICS.forEach((metric) => { target[metric] += source?.[metric] || 0; });
    const addTools = (target, source) => TOOLS.forEach((tool) => addMetrics(target[tool], source?.[tool] || {}));
    const uniq = (items) => new Set(items.filter(Boolean)).size;
    const bar = (value, max) => '<div class="bar"><i style="width:' + Math.max(4, Math.round((value / Math.max(1, max)) * 100)) + '%"></i></div>';
    const card = (label, value, hint) => '<article class="metric-card"><span>' + label + '</span><strong>' + fmt(value) + '</strong><small>' + hint + '</small></article>';

    const mergeChunk = (day, chunk) => {
      addMetrics(day, chunk.totals);
      addTools(day.tools, chunk.tools);
      day.eventLogCount += chunk.eventLogCount || 0;
      day.legacyReadCount += chunk.legacyReadCount || 0;
      day.metadataReadCount += chunk.metadataReadCount || 0;
      day.visitors.push(...(chunk.visitorKeys || chunk.visitors || []));
      TOOLS.forEach((tool) => day.toolVisitors[tool].push(...(chunk.toolVisitorKeys?.[tool] || chunk.toolVisitors?.[tool] || [])));
    };

    const loadDay = async (name, onProgress) => {
      const day = { day: name, ...emptyMetrics(), tools: emptyTools(), visitors: [], toolVisitors: Object.fromEntries(TOOLS.map((tool) => [tool, []])), eventLogCount: 0, legacyReadCount: 0, metadataReadCount: 0 };
      let cursor = '';
      do {
        const headers = STATS_TOKEN ? { Authorization: 'Bearer ' + STATS_TOKEN } : {};
        const res = await fetch('/api/stats-data?day=' + encodeURIComponent(name) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), { cache: 'no-store', headers });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'STATS_DATA_FAILED');
        mergeChunk(day, data.summary);
        cursor = data.cursor || '';
        onProgress();
      } while (cursor);
      day.unique_visitor = uniq(day.visitors);
      TOOLS.forEach((tool) => { day.tools[tool].unique_visitor = uniq(day.toolVisitors[tool]); });
      return day;
    };

    const render = (days) => {
      const today = days[0] || { ...emptyMetrics(), tools: emptyTools() };
      const totals = emptyMetrics();
      const totalTools = emptyTools();
      days.forEach((day) => { addMetrics(totals, day); addTools(totalTools, day.tools); });
      const processedTotal = sum(totals, ['process_success', 'batch_item_success']);
      const errors = sum(totals, ['process_error', 'batch_item_error']);
      const exportedToday = today.exported_image || 0;
      const exportedTotal = totals.exported_image || 0;
      document.getElementById('metrics').innerHTML = [
        card('今日独立访客', today.unique_visitor, '访问会话 ' + fmt(today.session_start)),
        card('今天上传', today.image_uploaded, '处理成功 ' + fmt(sum(today, ['process_success', 'batch_item_success']))),
        card('今天首次导出图片', exportedToday, '成功下载操作 ' + fmt(today.download_success)),
        card('累计独立访客', totals.unique_visitor, '累计会话 ' + fmt(totals.session_start)),
        card('累计上传', totals.image_uploaded, '成功处理 ' + fmt(processedTotal)),
        card('累计首次导出图片', exportedTotal, '成功下载操作 ' + fmt(totals.download_success)),
      ].join('');

      document.getElementById('toolRows').innerHTML = ['upscale', 'converter', 'product_image'].map((tool) => {
        const total = totalTools[tool] || emptyMetrics();
        const todayValue = today.tools?.[tool] || emptyMetrics();
        return '<tr><td><b>' + TOOL_LABELS[tool] + '</b></td><td>' + fmt(total.unique_visitor) + '</td><td>' + fmt(todayValue.unique_visitor) + '</td><td>' + fmt(total.image_uploaded) + ' / ' + fmt(todayValue.image_uploaded) + '</td><td>' + fmt(sum(total, ['process_success', 'batch_item_success'])) + ' / ' + fmt(sum(todayValue, ['process_success', 'batch_item_success'])) + '</td><td>' + fmt(total.exported_image) + ' / ' + fmt(todayValue.exported_image) + '</td></tr>';
      }).join('');

      const recent = [...days].reverse();
      const visitMax = Math.max(1, ...days.map((day) => day.page_view || 0));
      const uploadMax = Math.max(1, ...days.map((day) => day.image_uploaded || 0));
      const exportMax = Math.max(1, ...days.map((day) => day.exported_image || 0));
      document.getElementById('dayRows').innerHTML = recent.map((day) => {
        const processed = sum(day, ['process_success', 'batch_item_success']);
        const exported = day.exported_image || 0;
        const legacyExported = sum(day, ['download', 'download_zip']);
        const anomaly = ANOMALOUS_DAYS[day.day] ? '<span class="anomaly">' + ANOMALOUS_DAYS[day.day] + '</span>' : '';
        return '<tr><td>' + day.day + anomaly + '</td><td><b>' + fmt(day.page_view) + '</b>' + bar(day.page_view, visitMax) + '</td><td><b>' + fmt(day.unique_visitor) + '</b></td><td><b>' + fmt(day.session_start) + '</b></td><td><b>' + fmt(day.image_uploaded) + '</b>' + bar(day.image_uploaded, uploadMax) + '</td><td><b>' + fmt(processed) + '</b></td><td><b>' + fmt(day.download_success) + '</b></td><td><b>' + fmt(exported) + '</b>' + bar(exported, exportMax) + '</td><td><b>' + fmt(legacyExported) + '</b></td></tr>';
      }).join('');

      document.getElementById('eventRows').innerHTML = EVENTS.map((event) => '<tr><td>' + (LABELS[event] || event) + '</td><td>' + event + '</td><td><b>' + fmt(totals[event]) + '</b></td><td>' + fmt(today[event]) + '</td></tr>').join('');
      const eventLogs = days.reduce((total, day) => total + day.eventLogCount, 0);
      const legacyReads = days.reduce((total, day) => total + day.legacyReadCount, 0);
      const metadataReads = days.reduce((total, day) => total + day.metadataReadCount, 0);
      document.getElementById('note').textContent = '口径说明：成功下载操作只在浏览器成功生成下载内容后记录；首次导出图片按同一处理结果去重。download/download_zip 是旧版点击口径，仅供历史参考。已读取原始日志 ' + fmt(eventLogs) + ' 条，其中旧格式 ' + fmt(legacyReads) + ' 条，新格式 ' + fmt(metadataReads) + ' 条。接口只返回按天散列的访客键，不返回原始访客标识。';
    };

    (async () => {
      const status = document.getElementById('status');
      let chunks = 0;
      const days = [];
      for (let i = 0; i < 30; i += 1) {
        const name = dayText(i);
        status.textContent = '读取 ' + name;
        days.push(await loadDay(name, () => { chunks += 1; status.textContent = '已读 ' + chunks + ' 批'; }));
        render(days);
      }
      status.textContent = '统计正常';
      status.className = 'status ok';
    })().catch((error) => {
      const status = document.getElementById('status');
      status.textContent = '统计读取失败';
      status.className = 'status warn';
      document.getElementById('note').textContent = '统计读取失败：' + (error?.message || error);
    });
  </script>
</body>
</html>`

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url)
  const accept = context.request.headers.get('accept') || ''
  const wantsHtml = requestUrl.searchParams.get('format') === 'html'
    || !accept.includes('application/json')
    || accept.includes('text/html')
  const wantsJson = requestUrl.searchParams.get('format') === 'json'
  const wantsDebug = requestUrl.searchParams.get('debug') === '1'

  if (!isStatsAuthorized(context)) {
    const body = { ok: false, error: 'UNAUTHORIZED', message: '需要统计管理口令' }
    return wantsHtml && !wantsJson
      ? html('<!doctype html><meta charset="utf-8"><title>需要管理口令</title><p>需要有效的统计管理口令。</p>', 401)
      : json(body, 401)
  }

  if (wantsHtml && !wantsJson) return html(renderStatsShell())
  if (wantsJson || !wantsHtml) {
    const days = Array.from({ length: 30 }, (_, index) => getChinaDate(index))
    return json({
      ok: true,
      timezone: 'Asia/Shanghai',
      message: '统计数据请通过 /api/stats-data 按 day 和 cursor 分片读取，避免单次 Worker 读取过多 KV 日志。',
      statsDataEndpoint: '/api/stats-data',
      days,
      labels: LABELS,
      metrics: METRICS,
      tools: TOOLS,
      toolLabels: TOOL_LABELS,
    })
  }

  try {
    const kv = context.env.TUSCALE_ANALYTICS

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

    const todayDate = getChinaDate()
    const summaries = []
    for (let i = 0; i < 30; i++) {
      const day = getChinaDate(i)
      summaries.push(await getDaySummary(kv, day))
    }
    const days = summaries.map((summary) => ({ day: summary.day, ...summary.totals, eventLogCount: summary.eventLogCount }))

    const totals = createEmptyMetrics()
    const totalTools = createToolBreakdown()
    const todayTools = createToolBreakdown()
    summaries.forEach((summary) => {
      mergeMetrics(totals, summary.totals)
      mergeToolBreakdown(totalTools, summary.tools)
      if (summary.day === todayDate) mergeToolBreakdown(todayTools, summary.tools)
    })

    const toolBreakdown = {
      labels: TOOL_LABELS,
      note: '功能细分从原始事件日志中的 tool 字段汇总；没有 tool 字段的旧事件会归到“未细分旧数据”。',
      today: todayTools,
      totals: totalTools,
    }

    const body = {
      ok: true,
      timezone: 'Asia/Shanghai',
      returningVisitors: { returning: 0, trackedToday: days[0]?.unique_visitor || 0 },
      toolBreakdown,
      dataSource: {
        source: 'event_logs',
        generatedAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
        cacheSeconds: 0,
      },
      labels: LABELS,
      totals,
      days,
    }

    return wantsHtml && !wantsJson ? html(renderStatsPage(body)) : json(body)
  } catch (error) {
    const body = {
      ok: false,
      configured: true,
      message: '统计接口运行错误',
      error: wantsDebug ? String(error?.message || error) : 'STATS_RUNTIME_ERROR',
      stack: wantsDebug ? String(error?.stack || '') : undefined,
      labels: LABELS,
      totals: Object.fromEntries(METRICS.map((metric) => [metric, 0])),
      days: [],
    }
    return wantsHtml && !wantsJson ? html(renderStatsPage(body), 500) : json(body, 500)
  }
}
