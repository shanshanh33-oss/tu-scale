import { createAdminSession, getAdminAuth, renderAdminLogin } from './admin-auth.js'

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

const TYPE_LABELS = {
  feature: '功能建议',
  bug: '问题反馈',
  format: '格式支持',
  business: '商务合作',
}

const TYPE_TONES = {
  feature: 'blue',
  bug: 'red',
  format: 'violet',
  business: 'green',
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]))

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

const countBy = (records, field) => records.reduce((acc, record) => {
  const key = record[field] || 'unknown'
  acc[key] = (acc[key] || 0) + 1
  return acc
}, {})

const formatTime = (value) => {
  if (!value) return '未知时间'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

const getHost = (page) => {
  try {
    return new URL(page).host
  } catch {
    return page || '-'
  }
}

const buildPayload = async (kv) => {
  const keys = await readKvList(kv, 'contact:')
  const values = await Promise.all(keys.map(({ name }) => kv.get(name)))
  const records = values.map((value, index) => {
    try {
      return { key: keys[index].name, ...JSON.parse(value || '{}') }
    } catch {
      return null
    }
  }).filter(Boolean).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

  return {
    ok: true,
    configured: true,
    total: records.length,
    withContact: records.filter(record => record.contact).length,
    businessCount: records.filter(record => record.type === 'business').length,
    latestAt: records[0]?.createdAt || '',
    summary: {
      type: countBy(records, 'type'),
    },
    recent: records.slice(0, 200),
  }
}

const typeCards = (counts) => Object.entries(TYPE_LABELS).map(([type, label]) => `
  <div class="mini-card">
    <span>${escapeHtml(label)}</span>
    <strong>${counts[type] || 0}</strong>
  </div>
`).join('')

const renderRows = (records) => {
  if (!records.length) {
    return '<div class="empty">还没有联系页反馈。可以先到 /contact 提交一条测试。</div>'
  }

  return records.map((record) => {
    const type = record.type || 'feature'
    const tone = TYPE_TONES[type] || 'slate'
    const page = record.page || ''
    return `
      <article class="feedback-card">
        <div class="feedback-head">
          <div>
            <span class="badge ${tone}">${escapeHtml(TYPE_LABELS[type] || type)}</span>
            <time>${escapeHtml(formatTime(record.createdAt))}</time>
          </div>
          <div class="source">${escapeHtml(getHost(page))}</div>
        </div>
        <p class="message">${escapeHtml(record.message || '-')}</p>
        <div class="meta-grid">
          <div>
            <span>联系方式</span>
            <strong>${escapeHtml(record.contact || '未填写')}</strong>
          </div>
          <div>
            <span>来源页面</span>
            ${page ? `<a href="${escapeHtml(page)}" target="_blank" rel="noreferrer">${escapeHtml(page)}</a>` : '<strong>-</strong>'}
          </div>
        </div>
      </article>
    `
  }).join('')
}

const renderDashboard = (payload) => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TU Scale 联系反馈看板</title>
  <style>
    :root {
      color-scheme: light;
      --bg:#f4f7fb;
      --card:#ffffff;
      --ink:#172033;
      --muted:#667085;
      --line:#d8e0ed;
      --blue:#2563eb;
      --shadow:0 16px 42px rgba(15,23,42,.08);
    }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .wrap { max-width:1160px; margin:0 auto; padding:30px 18px 56px; }
    .top { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; margin-bottom:18px; }
    h1 { margin:0; font-size:30px; letter-spacing:0; }
    .sub { margin:8px 0 0; color:var(--muted); line-height:1.7; font-size:14px; max-width:720px; }
    .pill { display:inline-flex; align-items:center; min-height:34px; padding:0 12px; border:1px solid var(--line); border-radius:999px; background:#fff; color:#475467; font-size:13px; font-weight:700; white-space:nowrap; }
    .stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin:20px 0 14px; }
    .stat, .panel, .feedback-card { background:var(--card); border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow); }
    .stat { padding:18px; }
    .stat span, .mini-card span, .meta-grid span { display:block; color:var(--muted); font-size:12px; font-weight:700; }
    .stat strong { display:block; margin-top:8px; font-size:30px; line-height:1; }
    .panel { padding:16px; margin-bottom:14px; }
    .panel-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
    h2 { margin:0; font-size:16px; }
    .mini-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
    .mini-card { border:1px solid #e4eaf3; background:#f8fafc; border-radius:12px; padding:14px; }
    .mini-card strong { display:block; margin-top:8px; font-size:24px; }
    .list { display:grid; gap:12px; }
    .feedback-card { padding:16px; }
    .feedback-head { display:flex; justify-content:space-between; gap:14px; align-items:flex-start; }
    .feedback-head time { margin-left:8px; color:var(--muted); font-size:12px; font-weight:700; }
    .source { color:#667085; font-size:12px; font-weight:700; text-align:right; word-break:break-all; }
    .badge { display:inline-flex; align-items:center; min-height:26px; padding:0 9px; border-radius:999px; font-size:12px; font-weight:800; border:1px solid transparent; }
    .badge.blue { color:#1d4ed8; background:#eff6ff; border-color:#bfdbfe; }
    .badge.red { color:#b42318; background:#fff1f0; border-color:#fecaca; }
    .badge.violet { color:#6d28d9; background:#f5f3ff; border-color:#ddd6fe; }
    .badge.green { color:#047857; background:#ecfdf3; border-color:#a7f3d0; }
    .badge.slate { color:#475467; background:#f2f4f7; border-color:#e4e7ec; }
    .message { margin:14px 0; white-space:pre-wrap; line-height:1.75; font-size:15px; }
    .meta-grid { display:grid; grid-template-columns:minmax(180px,.7fr) 1.3fr; gap:10px; border-top:1px solid #edf2f7; padding-top:12px; }
    .meta-grid strong, .meta-grid a { display:block; margin-top:5px; color:#1f2937; font-size:13px; line-height:1.5; word-break:break-all; }
    .meta-grid a { color:var(--blue); text-decoration:none; }
    .empty { padding:42px 18px; color:#98a2b3; text-align:center; border:1px dashed #cbd5e1; border-radius:14px; background:#fff; }
    .hint { margin-top:14px; color:var(--muted); font-size:13px; line-height:1.7; }
    @media (max-width:820px) {
      .top { display:block; }
      .pill { margin-top:12px; }
      .stats, .mini-grid, .meta-grid { grid-template-columns:1fr; }
      h1 { font-size:24px; }
      .feedback-head { display:block; }
      .source { text-align:left; margin-top:8px; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="top">
      <div>
        <h1>TU Scale 联系反馈看板</h1>
        <p class="sub">这里汇总联系页提交的功能建议、问题反馈、格式支持和商务合作线索。优先关注带联系方式和商务合作类型的反馈。</p>
      </div>
      <div class="pill">已启用管理访问保护</div>
    </div>

    <section class="stats">
      <div class="stat"><span>反馈总数</span><strong>${payload.total}</strong></div>
      <div class="stat"><span>留下联系方式</span><strong>${payload.withContact}</strong></div>
      <div class="stat"><span>商务合作</span><strong>${payload.businessCount}</strong></div>
      <div class="stat"><span>最近反馈</span><strong>${payload.latestAt ? escapeHtml(formatTime(payload.latestAt)).slice(5) : '-'}</strong></div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>类型分布</h2>
      </div>
      <div class="mini-grid">${typeCards(payload.summary.type)}</div>
    </section>

    <section class="list">
      ${renderRows(payload.recent)}
    </section>

    <p class="hint">此看板仅限授权管理人员访问。请勿通过网址传递或分享管理口令。</p>
  </main>
</body>
</html>`

export async function onRequestGet(context) {
  const kv = context.env.TUSCALE_ANALYTICS
  const url = new URL(context.request.url)
  const wantsJson = url.searchParams.get('format') === 'json'
  const auth = getAdminAuth(context, 'CONTACT_ADMIN_TOKEN')

  if (!auth.authorized) {
    const body = { ok: false, error: auth.configured ? 'UNAUTHORIZED' : 'ADMIN_TOKEN_NOT_CONFIGURED' }
    return wantsJson ? json(body, auth.configured ? 401 : 503) : html(renderAdminLogin('联系反馈看板登录'), auth.configured ? 401 : 503)
  }
  if (!kv) return json({ ok: false, configured: false }, 202)

  const payload = await buildPayload(kv)
  if (wantsJson) return json(payload)
  return html(renderDashboard(payload))
}

export async function onRequestPost(context) {
  return createAdminSession(context, 'CONTACT_ADMIN_TOKEN')
}
