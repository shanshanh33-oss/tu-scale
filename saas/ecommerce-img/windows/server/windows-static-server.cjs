'use strict'

const fs = require('fs')
const http = require('http')
const path = require('path')

const HOST = '127.0.0.1'
const PORT = Number(process.env.TUSCALE_WEB_PORT || 5174)
const DIST = path.resolve(process.env.TUSCALE_DIST_DIR || path.join(__dirname, '..', 'dist'))

const MIME_TYPES = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.gz': 'application/gzip',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.task': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function setIsolationHeaders(response) {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  setIsolationHeaders(response)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function sendFile(request, response, filePath) {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendJson(response, 404, { error: 'Not found' })
      return
    }

    setIsolationHeaders(response)
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    const stream = fs.createReadStream(filePath)
    stream.on('error', () => response.destroy())
    stream.pipe(response)
  })
}

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'Method not allowed' })
    return
  }

  const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`)
  if (requestUrl.pathname === '/__tuscale/health') {
    sendJson(response, 200, { service: 'tuscale-web', status: 'ok' })
    return
  }
  if (requestUrl.pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'Local desktop mode does not expose cloud APIs' })
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(requestUrl.pathname)
  } catch {
    sendJson(response, 400, { error: 'Invalid URL' })
    return
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const candidate = path.resolve(DIST, relativePath)
  if (candidate !== DIST && !candidate.startsWith(`${DIST}${path.sep}`)) {
    sendJson(response, 403, { error: 'Forbidden' })
    return
  }

  fs.stat(candidate, (error, stat) => {
    if (!error && stat.isFile()) {
      sendFile(request, response, candidate)
      return
    }

    // History API routes use index.html. Missing assets keep a real 404 so a
    // broken model or WASM path is visible instead of returning HTML.
    if (!path.extname(relativePath)) {
      sendFile(request, response, path.join(DIST, 'index.html'))
      return
    }
    sendJson(response, 404, { error: 'Not found' })
  })
})

server.on('error', error => {
  console.error(`TU Scale web server failed: ${error.message}`)
  process.exitCode = 1
})

server.listen(PORT, HOST, () => {
  console.log(`TU Scale web server: http://${HOST}:${PORT}`)
  console.log(`Static files: ${DIST}`)
})
