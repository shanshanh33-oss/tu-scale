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

export async function onRequestPost(context) {
  const apiKey = context.env.PHOTOROOM_API_KEY || context.env.PHOTOROOM_SANDBOX_API_KEY
  if (!apiKey) return json({ error: 'PHOTOROOM_KEY_MISSING' }, 500)

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

  const response = await fetch('https://sdk.photoroom.com/v1/segment', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body: form,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return json({ error: text || `PHOTOROOM_${response.status}` }, response.status)
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
