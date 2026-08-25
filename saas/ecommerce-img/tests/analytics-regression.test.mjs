import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

import { onRequestGet as readStats } from '../functions/api/stats-data.js'
import { onRequestGet as renderStats } from '../functions/api/stats.js'
import { onRequestPost as trackEvents } from '../functions/api/track.js'

const chinaDay = (offset = 0) => new Date(
  Date.now() + 8 * 60 * 60 * 1000 - offset * 24 * 60 * 60 * 1000,
).toISOString().slice(0, 10)

class FakeKv {
  constructor(pageSize = 1000) {
    this.pageSize = pageSize
    this.values = new Map()
    this.metadata = new Map()
  }

  async get(key) {
    return this.values.get(key) ?? null
  }

  async put(key, value, options = {}) {
    this.values.set(key, value)
    if (options.metadata) this.metadata.set(key, options.metadata)
  }

  async list({ prefix = '', cursor = '' }) {
    const names = [...this.values.keys()].filter(name => name.startsWith(prefix)).sort()
    const start = Number.parseInt(cursor || '0', 10) || 0
    const end = Math.min(names.length, start + this.pageSize)
    return {
      keys: names.slice(start, end).map(name => ({ name, metadata: this.metadata.get(name) })),
      list_complete: end >= names.length,
      cursor: end >= names.length ? '' : String(end),
    }
  }
}

const statsContext = (kv, day, cursor = '') => ({
  env: {
    TUSCALE_ANALYTICS: kv,
    ADMIN_DASHBOARD_TOKEN: 'test-token',
  },
  request: new Request(`https://tu-scale.pages.dev/api/stats-data?day=${day}${cursor ? `&cursor=${cursor}` : ''}`, {
    headers: { Authorization: 'Bearer test-token' },
  }),
})

test('tracking accepts the previously missing events and preserves safe dimensions', async () => {
  const kv = new FakeKv()
  const response = await trackEvents({
    env: { TUSCALE_ANALYTICS: kv },
    request: new Request('https://tu-scale.pages.dev/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [
          {
            event: 'crop_preset_selected',
            data: { tool: 'contact', edition: 'mobile', visitorId: 'v_abcdefgh', sessionId: 's_abcdefgh' },
          },
          {
            event: 'batch_normalize',
            data: { tool: 'product_image', count: 4, batchSize: 4, aiDetailMode: 'preserve' },
          },
          {
            event: 'feature_click',
            data: { tool: 'upscale', feature: 'smart_denoise' },
          },
        ],
      }),
    }),
  })

  assert.equal(response.status, 200)
  assert.equal((await response.json()).count, 3)
  const eventKey = [...kv.values.keys()].find(key => key.startsWith('event:'))
  const events = kv.metadata.get(eventKey).events
  assert.equal(events[0].event, 'crop_preset_selected')
  assert.equal(events[0].tool, 'contact')
  assert.equal(events[0].analytics.edition, 'mobile')
  assert.equal(events[1].event, 'batch_normalize')
  assert.equal(events[1].amount, 4)
  assert.equal(events[1].analytics.aiDetailMode, 'preserve')
  assert.equal(events[2].event, 'feature_click')
  assert.equal(events[2].tool, 'upscale')
  assert.equal(events[2].analytics.feature, 'smart_denoise')
})

test('tracking still rejects unknown event names', async () => {
  const response = await trackEvents({
    env: { TUSCALE_ANALYTICS: new FakeKv() },
    request: new Request('https://tu-scale.pages.dev/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'not_allowed' }),
    }),
  })

  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'INVALID_EVENT')
})

test('tracking rejects arbitrary feature names and non-upscale feature clicks', async () => {
  for (const data of [
    { tool: 'upscale', feature: 'raw-button-text' },
    { tool: 'converter', feature: 'smart_denoise' },
  ]) {
    const response = await trackEvents({
      env: { TUSCALE_ANALYTICS: new FakeKv() },
      request: new Request('https://tu-scale.pages.dev/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'feature_click', data }),
      }),
    })

    assert.equal(response.status, 400)
    assert.equal((await response.json()).error, 'INVALID_EVENT')
  }
})

test('current-day statistics return live paginated event data', async () => {
  const day = chinaDay()
  const kv = new FakeKv(1)
  await kv.put(`event:${day}:1:a`, '{}', {
    metadata: { events: [{ event: 'page_view', amount: 1, tool: 'contact', visitorId: 'v_first', analytics: { edition: 'mobile' } }] },
  })
  await kv.put(`event:${day}:2:b`, '{}', {
    metadata: { events: [{ event: 'feature_click', amount: 1, tool: 'upscale', visitorId: 'v_second', analytics: { feature: 'moire_repair' } }] },
  })

  const firstResponse = await readStats(statsContext(kv, day))
  const first = await firstResponse.json()
  assert.equal(first.status, 'collecting')
  assert.equal(first.complete, false)
  assert.equal(first.summary.totals.page_view, 1)
  assert.equal(first.summary.tools.contact.page_view, 1)
  assert.deepEqual(first.summary.business.edition, { mobile: 1 })

  const secondResponse = await readStats(statsContext(kv, day, first.cursor))
  const second = await secondResponse.json()
  assert.equal(second.complete, true)
  assert.equal(second.summary.totals.feature_click, 1)
  assert.equal(second.summary.tools.upscale.feature_click, 1)
  assert.deepEqual(second.summary.business.feature, { moire_repair: 1 })
})

test('any unfinalized historical day is backfilled and stored', async () => {
  const day = chinaDay(3)
  const kv = new FakeKv(1)
  await kv.put(`event:${day}:1:a`, '{}', {
    metadata: { events: [{ event: 'batch_normalize', amount: 3, tool: 'product_image', visitorId: 'v_history', analytics: { edition: 'desktop' } }] },
  })
  await kv.put(`event:${day}:2:b`, JSON.stringify({ event: 'page_view', amount: 1, tool: 'contact', visitorId: 'v_history' }))

  const response = await readStats(statsContext(kv, day))
  const data = await response.json()
  assert.equal(data.status, 'finalized')
  assert.equal(data.summary.totals.batch_normalize, 3)
  assert.equal(data.summary.totals.page_view, 1)
  assert.equal(data.summary.totals.unique_visitor, 1)
  assert.equal(data.summary.tools.contact.page_view, 1)
  assert.equal(data.summary.business.edition.desktop, 1)
  assert.ok(kv.values.has(`daily-summary:${day}`))
})

test('statistics dashboard exposes the completed metrics and valid client script', async () => {
  const response = await renderStats({
    env: { ADMIN_DASHBOARD_TOKEN: 'test-token' },
    request: new Request('https://tu-scale.pages.dev/api/stats', {
      headers: {
        Accept: 'text/html',
        Authorization: 'Bearer test-token',
      },
    }),
  })
  const body = await response.text()
  assert.equal(response.status, 200)
  assert.match(body, /反馈联系/)
  assert.match(body, /crop_preset_selected/)
  assert.match(body, /batch_normalize/)
  assert.match(body, /feature_click/)
  assert.match(body, /图片放大内部功能点击/)
  assert.match(body, /彩色摩尔纹修复/)
  assert.match(body, /AI 细节模式/)
  assert.match(body, /当天实时汇总/)

  const script = body.match(/<script>([\s\S]*)<\/script>/)?.[1]
  assert.ok(script)
  assert.doesNotThrow(() => new vm.Script(script))
})
