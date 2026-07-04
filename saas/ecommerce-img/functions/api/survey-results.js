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

const LABELS = {
  want: {
    free: '只想免费试用',
    pay_once: '愿意小额购买',
    credits: '愿意购买积分包',
    batch: '需要批量套餐',
    unsure: '先看效果再决定',
  },
  plan: {
    trial_9_10: '¥9.9 / 10 张',
    basic_19_20: '¥19.9 / 20 张',
    standard_39_50: '¥39.9 / 50 张',
    batch_99_120: '¥99 / 120 张',
  },
  batchNeed: {
    no: '不需要批量',
    sometimes: '偶尔需要批量',
    often: '经常批量处理',
    must: '必须支持文件夹批量',
  },
  monthlyVolume: {
    '1-10': '1-10 张/月',
    '11-50': '11-50 张/月',
    '51-200': '51-200 张/月',
    '200+': '200 张以上/月',
  },
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]))

const label = (field, value) => LABELS[field]?.[value] || value || '未填写'

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

const buildPayload = async (kv) => {
  const surveyKeys = await readKvList(kv, 'survey:removebg_willingness:')
  const usageKeys = await readKvList(kv, 'removebg-usage:')
  const values = await Promise.all(surveyKeys.map(({ name }) => kv.get(name)))
  const records = values.map((value) => {
    try { return JSON.parse(value || '{}') } catch { return null }
  }).filter(Boolean).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

  return {
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
  }
}

const barRows = (title, field, counts, total) => {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1])
  const rows = entries.length ? entries.map(([key, value]) => {
    const pct = total ? Math.round((value / total) * 100) : 0
    return `
      <div class="bar-row">
        <div class="bar-head">
          <span>${escapeHtml(label(field, key))}</span>
          <strong>${value} 人 · ${pct}%</strong>
        </div>
        <div class="bar-track"><span style="width:${pct}%"></span></div>
      </div>
    `
  }).join('') : '<p class="empty">暂无数据</p>'

  return `
    <section class="panel">
      <h2>${escapeHtml(title)}</h2>
      ${rows}
    </section>
  `
}

const formatTime = (value) => {
  if (!value) return '未知时间'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

const renderDashboard = (payload) => {
  const rows = payload.recent.length ? payload.recent.map((record) => `
    <tr>
      <td>${escapeHtml(formatTime(record.createdAt))}</td>
      <td>${escapeHtml(label('want', record.want))}</td>
      <td>${escapeHtml(label('plan', record.plan || record.price))}</td>
      <td>${escapeHtml(label('batchNeed', record.batchNeed))}</td>
      <td>${escapeHtml(label('monthlyVolume', record.monthlyVolume))}</td>
      <td>${escapeHtml(record.contact || '-')}</td>
      <td>${escapeHtml(record.note || '-')}</td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="empty-cell">还没有用户提交反馈。可以先在线上页面自己提交一条测试。</td></tr>'

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TU Scale 需求反馈看板</title>
  <style>
    :root { color-scheme: light; --blue:#2563eb; --ink:#172033; --muted:#64748b; --line:#dbe3ef; --bg:#f6f8fb; --card:#fff; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 28px 18px 48px; }
    .top { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; }
    h1 { margin:0; font-size:28px; letter-spacing:0; }
    .sub { margin:8px 0 0; color:var(--muted); font-size:14px; }
    .json-link { color:var(--blue); text-decoration:none; font-weight:700; white-space:nowrap; }
    .cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin:18px 0; }
    .card, .panel { background:var(--card); border:1px solid var(--line); border-radius:14px; box-shadow:0 8px 24px rgba(15,23,42,.05); }
    .card { padding:18px; }
    .card span { display:block; color:var(--muted); font-size:13px; font-weight:700; }
    .card strong { display:block; margin-top:8px; font-size:30px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
    .panel { padding:18px; min-width:0; }
    h2 { margin:0 0 14px; font-size:16px; }
    .bar-row { margin-top:13px; }
    .bar-head { display:flex; justify-content:space-between; gap:12px; font-size:14px; }
    .bar-head strong { color:var(--muted); white-space:nowrap; }
    .bar-track { height:10px; margin-top:7px; border-radius:999px; background:#e8eef7; overflow:hidden; }
    .bar-track span { display:block; height:100%; border-radius:999px; background:linear-gradient(90deg,#2563eb,#7c3aed); min-width:3px; }
    .table-panel { margin-top:14px; overflow:hidden; }
    .table-scroll { overflow:auto; }
    table { width:100%; border-collapse:collapse; min-width:880px; font-size:13px; }
    th, td { padding:12px 14px; border-top:1px solid #edf2f7; text-align:left; vertical-align:top; }
    th { color:var(--muted); background:#f8fafc; font-size:12px; }
    td { line-height:1.5; }
    .empty, .empty-cell { color:#94a3b8; }
    .empty-cell { text-align:center; padding:36px; }
    .hint { margin-top:14px; color:var(--muted); font-size:13px; }
    @media (max-width: 820px) { .cards, .grid { grid-template-columns:1fr; } .top { display:block; } .json-link { display:inline-block; margin-top:12px; } }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="top">
      <div>
        <h1>AI 抠图付费与批量需求看板</h1>
        <p class="sub">统计来自商品图规范化页面的用户需求反馈，用来判断是否值得正式上线付费抠图和批量功能。</p>
      </div>
      <a class="json-link" href="/api/survey-results-json">查看 JSON</a>
    </div>

    <section class="cards">
      <div class="card"><span>反馈总数</span><strong>${payload.total}</strong></div>
      <div class="card"><span>AI 抠图调用记录</span><strong>${payload.removeBgUsageTotal}</strong></div>
      <div class="card"><span>愿意付费/买积分</span><strong>${(payload.summary.want.pay_once || 0) + (payload.summary.want.credits || 0) + (payload.summary.want.batch || 0)}</strong></div>
      <div class="card"><span>明确批量需求</span><strong>${(payload.summary.batchNeed.often || 0) + (payload.summary.batchNeed.must || 0)}</strong></div>
    </section>

    <section class="grid">
      ${barRows('是否愿意付费使用', 'want', payload.summary.want, payload.total)}
      ${barRows('可接受积分方案', 'plan', payload.summary.plan, payload.total)}
      ${barRows('是否需要批量抠白底图', 'batchNeed', payload.summary.batchNeed, payload.total)}
      ${barRows('每月预计处理数量', 'monthlyVolume', payload.summary.monthlyVolume, payload.total)}
    </section>

    <section class="panel table-panel">
      <h2>最近 100 条反馈</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>付费意愿</th>
              <th>方案</th>
              <th>批量需求</th>
              <th>月处理量</th>
              <th>联系方式</th>
              <th>补充需求</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>

    <p class="hint">提示：这个页面目前未加密码保护。正式公开推广前，建议加后台访问 token。</p>
  </main>
</body>
</html>`
}

export async function onRequestGet(context) {
  const kv = context.env.TUSCALE_ANALYTICS
  const url = new URL(context.request.url)
  const wantsJson = url.searchParams.get('format') === 'json'

  if (!kv) {
    const body = { ok: false, configured: false }
    return wantsJson ? json(body, 202) : html(renderDashboard({
      ...body,
      total: 0,
      removeBgUsageTotal: 0,
      summary: { want: {}, plan: {}, batchNeed: {}, monthlyVolume: {} },
      recent: [],
    }), 202)
  }

  const payload = await buildPayload(kv)
  return wantsJson ? json(payload) : html(renderDashboard(payload))
}
