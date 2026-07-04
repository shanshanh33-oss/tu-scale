const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
})

const extFromMime = (mime) => {
  if (/jpe?g/i.test(mime)) return 'jpg'
  if (/webp/i.test(mime)) return 'webp'
  return 'png'
}

const getClientIp = (request) => {
  const cfIp = request.headers.get('cf-connecting-ip')
  const forwarded = request.headers.get('x-forwarded-for')
  return String(cfIp || forwarded?.split(',')[0] || 'unknown').trim() || 'unknown'
}

const getChinaDate = () => {
  const time = Date.now() + 8 * 60 * 60 * 1000
  return new Date(time).toISOString().slice(0, 10)
}

export async function onRequestPost(context) {
  const apiKey = context.env.REMOVE_BG_API_KEY
  if (!apiKey) return json({ error: 'REMOVEBG_KEY_MISSING' }, 500)
  const kv = context.env.TUSCALE_ANALYTICS
  const ip = getClientIp(context.request)
  const day = getChinaDate()
  const limitKey = `removebg-limit:${day}:${ip}`

  if (kv) {
    const used = await kv.get(limitKey)
    if (used) {
      return json({
        error: 'DAILY_FREE_LIMIT_REACHED',
        message: '功能测试期每个 IP 每天只能免费抠 1 张图，请明天再试或填写付费/批量需求调查。',
      }, 429)
    }
  }

  let body
  try {
    body = await context.request.json()
  } catch {
    return json({ error: 'INVALID_JSON' }, 400)
  }
  if (!body?.image) return json({ error: 'IMAGE_MISSING' }, 400)

  const bytes = Uint8Array.from(atob(String(body.image)), char => char.charCodeAt(0))
  const mimeType = String(body.mimeType || 'image/png')
  const fileName = String(body.fileName || `image.${extFromMime(mimeType)}`)
  const form = new FormData()
  form.append('image_file', new Blob([bytes], { type: mimeType }), fileName)
  form.append('size', 'auto')

  const response = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: form,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return json({ error: text || `REMOVEBG_${response.status}` }, response.status)
  }

  if (kv) {
    await kv.put(limitKey, '1', { expirationTtl: 36 * 60 * 60 })
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    await kv.put(`removebg-usage:${day}:${Date.now()}:${id}`, JSON.stringify({
      day,
      ip,
      fileName,
      mimeType,
      createdAt: new Date().toISOString(),
    }))
  }

  return new Response(await response.arrayBuffer(), {
    headers: {
      'Content-Type': response.headers.get('content-type') || 'image/png',
      'Cache-Control': 'no-store',
    },
  })
}

export function onRequestOptions() {
  return json({ ok: true })
}
