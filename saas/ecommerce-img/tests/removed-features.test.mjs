import test from 'node:test'
import assert from 'node:assert/strict'

import { onRequestPost as removeBg } from '../functions/api/remove-bg/removebg.js'
import { onRequestPost as photoRoom } from '../functions/api/remove-bg/photoroom.js'
import { onRequestPost as submitSurvey } from '../functions/api/survey.js'

test('retired paid cutout endpoints cannot call third-party services', async () => {
  for (const handler of [removeBg, photoRoom]) {
    const response = await handler({ env: {}, request: new Request('https://tu-scale.pages.dev/') })
    assert.equal(response.status, 410)
    assert.equal((await response.json()).error, 'FEATURE_REMOVED')
  }
})

test('retired cutout survey no longer accepts submissions', async () => {
  const response = await submitSurvey({ env: {}, request: new Request('https://tu-scale.pages.dev/') })
  assert.equal(response.status, 410)
  assert.equal((await response.json()).error, 'SURVEY_CLOSED')
})
