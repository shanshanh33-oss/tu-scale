const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = Number(process.env.REMOVE_BG_PORT || 5180)
const SURVEY_LOG = path.join(__dirname, '..', 'tmp-survey.jsonl')
const USAGE_LOG = path.join(__dirname, '..', 'tmp-removebg-usage.jsonl')

const loadLocalEnv = () => {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) return
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  lines.forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const index = trimmed.indexOf('=')
    if (index === -1) return
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '')
    if (key && process.env[key] === undefined) process.env[key] = value
  })
}

loadLocalEnv()

const json = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(body))
}

const readJson = (req) => new Promise((resolve, reject) => {
  let body = ''
  req.on('data', chunk => {
    body += chunk
    if (body.length > 30 * 1024 * 1024) {
      req.destroy()
      reject(new Error('PAYLOAD_TOO_LARGE'))
    }
  })
  req.on('end', () => {
    try { resolve(JSON.parse(body || '{}')) }
    catch { reject(new Error('INVALID_JSON')) }
  })
  req.on('error', reject)
})

const extFromMime = (mime) => {
  if (/jpe?g/i.test(mime)) return 'jpg'
  if (/webp/i.test(mime)) return 'webp'
  return 'png'
}

const getChinaDate = () => {
  const time = Date.now() + 8 * 60 * 60 * 1000
  return new Date(time).toISOString().slice(0, 10)
}

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return String(value?.split(',')[0] || req.socket.remoteAddress || 'local').trim()
}

const hasUsedRemoveBgToday = (ip, day) => {
  if (!fs.existsSync(USAGE_LOG)) return false
  return fs.readFileSync(USAGE_LOG, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .some(line => {
      try {
        const record = JSON.parse(line)
        return record.ip === ip && record.day === day
      } catch {
        return false
      }
    })
}

const handlePhotoroom = async (req, res) => {
  const apiKey = process.env.PHOTOROOM_API_KEY || process.env.PHOTOROOM_SANDBOX_API_KEY
  if (!apiKey) return json(res, 500, { error: 'PHOTOROOM_KEY_MISSING' })

  const body = await readJson(req)
  if (!body.image) return json(res, 400, { error: 'IMAGE_MISSING' })

  const buffer = Buffer.from(String(body.image), 'base64')
  const mimeType = String(body.mimeType || 'image/png')
  const fileName = String(body.fileName || `image.${extFromMime(mimeType)}`)
  const blob = new Blob([buffer], { type: mimeType })
  const form = new FormData()
  form.append('image_file', blob, fileName)

  const response = await fetch('https://sdk.photoroom.com/v1/segment', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body: form,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return json(res, response.status, { error: text || `PHOTOROOM_${response.status}` })
  }

  const arrayBuffer = await response.arrayBuffer()
  res.writeHead(200, {
    'Content-Type': response.headers.get('content-type') || 'image/png',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(Buffer.from(arrayBuffer))
}

const handleRemoveBg = async (req, res) => {
  const apiKey = process.env.REMOVE_BG_API_KEY
  if (!apiKey) return json(res, 500, { error: 'REMOVEBG_KEY_MISSING' })
  const ip = getClientIp(req)
  const day = getChinaDate()
  if (hasUsedRemoveBgToday(ip, day)) {
    return json(res, 429, {
      error: 'DAILY_FREE_LIMIT_REACHED',
      message: '功能测试期每个 IP 每天只能免费抠 1 张图，请明天再试或填写付费/批量需求调查。',
    })
  }

  const body = await readJson(req)
  if (!body.image) return json(res, 400, { error: 'IMAGE_MISSING' })

  const buffer = Buffer.from(String(body.image), 'base64')
  const mimeType = String(body.mimeType || 'image/png')
  const fileName = String(body.fileName || `image.${extFromMime(mimeType)}`)
  const blob = new Blob([buffer], { type: mimeType })
  const form = new FormData()
  form.append('image_file', blob, fileName)
  form.append('size', 'auto')

  const response = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: form,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return json(res, response.status, { error: text || `REMOVEBG_${response.status}` })
  }

  const arrayBuffer = await response.arrayBuffer()
  fs.appendFileSync(USAGE_LOG, `${JSON.stringify({ day, ip, fileName, mimeType, createdAt: new Date().toISOString() })}\n`)
  res.writeHead(200, {
    'Content-Type': response.headers.get('content-type') || 'image/png',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(Buffer.from(arrayBuffer))
}

const handleSurvey = async (req, res) => {
  const body = await readJson(req)
  const record = {
    type: String(body.type || 'general').slice(0, 80),
    want: String(body.want || '').slice(0, 20),
    service: String(body.service || '').slice(0, 40),
    price: String(body.price || '').slice(0, 20),
    plan: String(body.plan || '').slice(0, 40),
    batchNeed: String(body.batchNeed || '').slice(0, 40),
    monthlyVolume: String(body.monthlyVolume || '').slice(0, 40),
    contact: String(body.contact || '').slice(0, 120),
    note: String(body.note || '').slice(0, 500),
    method: String(body.method || '').slice(0, 40),
    preset: String(body.preset || '').slice(0, 40),
    createdAt: new Date().toISOString(),
  }
  fs.appendFileSync(SURVEY_LOG, `${JSON.stringify(record)}\n`)
  json(res, 200, { ok: true, localLog: SURVEY_LOG })
}

const countBy = (records, field) => records.reduce((acc, record) => {
  const key = record[field] || '未填写'
  acc[key] = (acc[key] || 0) + 1
  return acc
}, {})

const handleSurveyResults = async (req, res) => {
  const records = fs.existsSync(SURVEY_LOG)
    ? fs.readFileSync(SURVEY_LOG, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
    : []
  const usage = fs.existsSync(USAGE_LOG)
    ? fs.readFileSync(USAGE_LOG, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
    : []
  json(res, 200, {
    ok: true,
    total: records.length,
    removeBgUsageTotal: usage.length,
    summary: {
      want: countBy(records, 'want'),
      plan: countBy(records, 'plan'),
      batchNeed: countBy(records, 'batchNeed'),
      monthlyVolume: countBy(records, 'monthlyVolume'),
    },
    recent: records.slice(-50).reverse(),
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true })
  try {
    if (req.method === 'POST' && req.url === '/api/remove-bg/photoroom') return await handlePhotoroom(req, res)
    if (req.method === 'POST' && req.url === '/api/remove-bg/removebg') return await handleRemoveBg(req, res)
    if (req.method === 'POST' && req.url === '/api/survey') return await handleSurvey(req, res)
    if (req.method === 'GET' && req.url === '/api/survey-results') return await handleSurveyResults(req, res)
    json(res, 404, { error: 'NOT_FOUND' })
  } catch (error) {
    json(res, error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 500, { error: error.message || 'SERVER_ERROR' })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Remove background proxy on http://127.0.0.1:${PORT}`)
  console.log('Set REMOVE_BG_API_KEY before starting this server.')
})
