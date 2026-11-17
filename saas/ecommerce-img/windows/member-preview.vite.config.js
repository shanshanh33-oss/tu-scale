import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { defineConfig } from 'vite'
import baseConfig from '../vite.config.js'
import { onRequest } from '../functions/api/auth/[[path]].js'

const origin = 'http://127.0.0.1:5184'
const demoEmail = 'demo@example.test'
const demoPhone = '+8613800138000'

function createD1() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../migrations/0001_members.sql', import.meta.url), 'utf8'))
  const prepare = sql => {
    let args = []
    const statement = {
      bind(...values) { args = values; return statement },
      async all() {
        const before = sqlite.prepare('SELECT total_changes() AS n').get().n
        const command = sqlite.prepare(sql)
        const rows = command.columns().length ? command.all(...args) : (command.run(...args), [])
        const after = sqlite.prepare('SELECT total_changes() AS n').get().n
        return { results: rows, success: true, meta: { changes: after - before } }
      },
      async first() { return (await statement.all()).results[0] || null },
      async run() { return statement.all() },
    }
    return statement
  }
  return { prepare, async batch(statements) { return Promise.all(statements.map(item => item.all())) }, async exec(sql) { sqlite.exec(sql) } }
}

function memberPreview() {
  const codes = new Map()
  const env = {
    MEMBER_DB: createD1(),
    MEMBER_AUTH_URL: origin,
    MEMBER_AUTH_SECRET: randomBytes(32).toString('hex'),
    MEMBER_EMAIL_DAILY_LIMIT: '30',
    MEMBER_SMS_DAILY_LIMIT: '30',
    MEMBER_DELIVERY: {
      async fetch(request) {
        const { kind, contact, code } = await request.json()
        if ((kind === 'email' && contact === demoEmail) || (kind === 'phone' && contact === demoPhone)) {
          codes.set(kind, code)
          return new Response(null, { status: 204 })
        }
        return new Response(null, { status: 422 })
      },
    },
  }

  return {
    name: 'tuscale-local-member-preview',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = new URL(req.url || '/', origin).pathname
        if (!path.startsWith('/api/auth/') && path !== '/api/member-preview/code') return next()
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
          || req.headers.host !== '127.0.0.1:5184') {
          res.writeHead(403).end()
          return
        }

        if (path === '/api/member-preview/code') {
          const kind = new URL(req.url || '/', origin).searchParams.get('kind')
          const code = codes.get(kind)
          res.writeHead(code ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify(code ? { code } : { error: 'NO_CODE' }))
          return
        }

        try {
          const chunks = []
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 16384) {
              res.writeHead(413).end()
              return
            }
            chunks.push(chunk)
          }
          const headers = new Headers()
          for (const [name, value] of Object.entries(req.headers)) {
            if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
          }
          headers.set('CF-Connecting-IP', '127.0.0.1')
          const request = new Request(new URL(req.url || '/', origin), {
            method: req.method,
            headers,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          })
          const response = await onRequest({ env, request })
          for (const [name, value] of response.headers) res.setHeader(name, value)
          res.writeHead(response.status)
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ error: 'LOCAL_PREVIEW_ERROR' }))
        }
      })
    },
  }
}

process.env.VITE_MEMBER_PREVIEW = '1'

export default defineConfig({
  ...baseConfig,
  plugins: [...baseConfig.plugins, memberPreview()],
})
