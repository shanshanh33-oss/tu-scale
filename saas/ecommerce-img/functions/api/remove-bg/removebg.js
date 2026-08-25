const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const removed = () => json({
  ok: false,
  error: 'FEATURE_REMOVED',
  message: '白底抠图测试已停止，接口不再调用付费服务。',
}, 410)

export async function onRequestPost() {
  return removed()
}

export function onRequestOptions() {
  return json({ ok: true, removed: true })
}
