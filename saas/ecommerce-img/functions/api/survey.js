const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

export async function onRequestPost() {
  return json({
    ok: false,
    error: 'SURVEY_CLOSED',
    message: '白底抠图需求调查已结束。',
  }, 410)
}

export function onRequestOptions() {
  return json({ ok: true, closed: true })
}
