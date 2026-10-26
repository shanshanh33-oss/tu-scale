'use strict'

const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const HOST = '127.0.0.1'
const PORT = Number(process.env.TUSCALE_AI_PORT || 5179)
const APP_ROOT = path.resolve(process.env.TUSCALE_APP_ROOT || path.join(__dirname, '..'))
const SERVER_ROOT = path.resolve(process.env.TUSCALE_SERVER_DIR || __dirname)
const PYTHON_PATH = process.env.TUSCALE_PYTHON || 'python.exe'
const MAX_BODY_BYTES = 120 * 1024 * 1024
const PROCESS_TIMEOUT_MS = 300_000

const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5174',
  'http://localhost:5174',
])

const DENOISE_BACKENDS = {
  scunet: {
    label: 'SCUNet',
    script: path.join(SERVER_ROOT, 'scunet-denoise.py'),
    model: path.join(APP_ROOT, 'waifu2x', 'models-scunet', 'scunet_color_real_psnr.onnx'),
    backend: 'scunet-proxy',
  },
  drunet: {
    label: 'DRUNet',
    script: path.join(SERVER_ROOT, 'drunet-denoise.py'),
    model: path.join(APP_ROOT, 'waifu2x', 'models-drunet', 'drunet_color.onnx'),
    backend: 'drunet-proxy',
  },
}

function getDenoiseAvailability() {
  return Object.fromEntries(Object.entries(DENOISE_BACKENDS).map(([key, config]) => [
    key,
    fs.existsSync(PYTHON_PATH) && fs.existsSync(config.script) && fs.existsSync(config.model),
  ]))
}

function setCors(request, response) {
  const origin = request.headers.origin
  if (ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('X-Content-Type-Options', 'nosniff')
}

function sendJson(request, response, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  setCors(request, response)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function cleanupDirectory(directory) {
  try {
    fs.rmSync(directory, { recursive: true, force: true })
  } catch {
    // Temporary files are best-effort cleanup only.
  }
}

function processDenoise(imageBase64, strength, requestedBackend, clarity) {
  return new Promise((resolve, reject) => {
    const backendKey = requestedBackend === 'drunet' ? 'drunet' : 'scunet'
    const config = DENOISE_BACKENDS[backendKey]
    if (!getDenoiseAvailability()[backendKey]) {
      reject(new Error(`${config.label} 本地降噪模型不可用`))
      return
    }

    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `tuscale-${backendKey}-`))
    const inputPath = path.join(temporaryDirectory, 'input.png')
    const outputPath = path.join(temporaryDirectory, 'output.png')
    let settled = false
    const finish = callback => value => {
      if (settled) return
      settled = true
      cleanupDirectory(temporaryDirectory)
      callback(value)
    }
    const finishResolve = finish(resolve)
    const finishReject = finish(reject)

    try {
      fs.writeFileSync(inputPath, Buffer.from(imageBase64, 'base64'))
      const child = spawn(PYTHON_PATH, [
        config.script,
        inputPath,
        outputPath,
        '--model', config.model,
        '--strength', String(Math.max(0.35, Math.min(1, Number(strength) || 0.75))),
        '--clarity', String(Math.max(0, Math.min(1, Number(clarity) || 0))),
      ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
      let standardError = ''
      const timeout = setTimeout(() => child.kill(), PROCESS_TIMEOUT_MS)
      child.stderr.on('data', data => {
        standardError += data.toString()
        if (standardError.length > 8_000) standardError = standardError.slice(-8_000)
      })
      child.on('error', error => {
        clearTimeout(timeout)
        finishReject(error)
      })
      child.on('close', code => {
        clearTimeout(timeout)
        if (code !== 0 || !fs.existsSync(outputPath)) {
          finishReject(new Error(`${config.label} failed (${code}): ${standardError.slice(-600)}`))
          return
        }
        try {
          finishResolve({
            image: fs.readFileSync(outputPath).toString('base64'),
            backend: config.backend,
          })
        } catch (error) {
          finishReject(error)
        }
      })
    } catch (error) {
      finishReject(error)
    }
  })
}

const server = http.createServer((request, response) => {
  setCors(request, response)

  if (request.method === 'GET' && (request.url === '/denoise/status' || request.url === '/health')) {
    sendJson(request, response, 200, {
      service: 'tuscale-denoise',
      status: 'ok',
      models: getDenoiseAvailability(),
    })
    return
  }

  // AI upscale is deliberately handled by the packaged browser ONNX model.
  // Returning a non-2xx preflight makes the existing client select that stable
  // WebGPU/WASM path while this service remains dedicated to SCUNet/DRUNet.
  if (request.url === '/process') {
    sendJson(request, response, 503, { error: 'Use packaged browser AI model' })
    return
  }

  if (request.method === 'OPTIONS') {
    const available = getDenoiseAvailability()
    if (request.url === '/denoise' && (available.scunet || available.drunet)) {
      response.writeHead(204)
      response.end()
      return
    }
    sendJson(request, response, 503, { error: 'Local denoise models are unavailable' })
    return
  }

  if (request.method !== 'POST' || request.url !== '/denoise') {
    sendJson(request, response, 404, { error: 'Not found' })
    return
  }

  const chunks = []
  let bodyBytes = 0
  let tooLarge = false
  request.on('data', chunk => {
    bodyBytes += chunk.length
    if (bodyBytes > MAX_BODY_BYTES) {
      tooLarge = true
      return
    }
    chunks.push(chunk)
  })
  request.on('end', async () => {
    if (tooLarge) {
      sendJson(request, response, 413, { error: '图片数据过大，请降低输入尺寸' })
      return
    }
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (typeof payload.image !== 'string' || !payload.image) throw new Error('No image data')
      const result = await processDenoise(
        payload.image,
        payload.strength,
        payload.backend,
        payload.clarity,
      )
      sendJson(request, response, 200, result)
    } catch (error) {
      sendJson(request, response, 500, { error: error.message })
    }
  })
})

server.on('error', error => {
  console.error(`TU Scale denoise server failed: ${error.message}`)
  process.exitCode = 1
})

server.listen(PORT, HOST, () => {
  console.log(`TU Scale denoise server: http://${HOST}:${PORT}`)
  console.log(`Python: ${PYTHON_PATH}`)
  console.log(`Models: ${JSON.stringify(getDenoiseAvailability())}`)
})
