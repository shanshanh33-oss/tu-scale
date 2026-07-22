import { createAdminSession, getAdminAuth, renderAdminLogin } from './admin-auth.js'

const html = (body, status = 200) => new Response(body, {
  status,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const renderDashboard = () => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TU Scale 运营总览</title>
  <style>
    :root { color-scheme: light; --ink:#172033; --muted:#667085; --line:#dbe3ef; --bg:#f4f7fb; --card:#fff; --primary:#2563eb; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { max-width:1440px; margin:0 auto; padding:26px 18px 36px; }
    h1 { margin:0; font-size:28px; }
    .sub { margin:8px 0 20px; color:var(--muted); line-height:1.6; }
    .tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
    button { appearance:none; border:1px solid var(--line); background:var(--card); color:#344054; border-radius:10px; padding:10px 14px; font:inherit; font-weight:700; cursor:pointer; }
    button[aria-selected="true"] { background:var(--primary); border-color:var(--primary); color:#fff; }
    .panel { display:none; background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; box-shadow:0 12px 30px rgba(15,23,42,.06); }
    .panel.active { display:block; }
    iframe { display:block; width:100%; min-height:calc(100vh - 190px); border:0; background:#fff; }
    .hint { margin:14px 0 0; color:var(--muted); font-size:13px; }
  </style>
</head>
<body>
  <main>
    <h1>TU Scale 运营总览</h1>
    <p class="sub">在一个入口中查看流量、用户联系反馈和 AI 抠图需求。登录状态会在本浏览器中安全保留一段时间。</p>
    <div class="tabs" role="tablist" aria-label="运营数据">
      <button type="button" role="tab" aria-selected="true" aria-controls="stats" data-panel="stats">流量统计</button>
      <button type="button" role="tab" aria-selected="false" aria-controls="contact" data-panel="contact">联系反馈</button>
      <button type="button" role="tab" aria-selected="false" aria-controls="survey" data-panel="survey">抠图需求</button>
    </div>
    <section id="stats" class="panel active" role="tabpanel"><iframe title="流量统计" src="/api/stats"></iframe></section>
    <section id="contact" class="panel" role="tabpanel"><iframe title="联系反馈" data-src="/api/contact-results"></iframe></section>
    <section id="survey" class="panel" role="tabpanel"><iframe title="抠图需求" data-src="/api/survey-results"></iframe></section>
    <p class="hint">所有数据页均受相同管理口令保护，请勿分享登录设备或口令。</p>
  </main>
  <script>
    const tabs = [...document.querySelectorAll('[role="tab"]')]
    const show = (name) => {
      tabs.forEach((tab) => {
        const active = tab.dataset.panel === name
        tab.setAttribute('aria-selected', String(active))
      })
      document.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
        const active = panel.id === name
        panel.classList.toggle('active', active)
        if (active) {
          const frame = panel.querySelector('iframe[data-src]')
          if (frame) frame.src = frame.dataset.src
        }
      })
    }
    tabs.forEach((tab) => tab.addEventListener('click', () => show(tab.dataset.panel)))
  </script>
</body>
</html>`

export async function onRequestGet(context) {
  const auth = getAdminAuth(context, 'STATS_ADMIN_TOKEN')
  if (!auth.authorized) return html(renderAdminLogin('TU Scale 运营总览登录'), auth.configured ? 401 : 503)
  return html(renderDashboard())
}

export async function onRequestPost(context) {
  return createAdminSession(context, 'STATS_ADMIN_TOKEN')
}
