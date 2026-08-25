import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  assertWaifu2xTileOutput,
  getExpectedWaifu2xTileOutputSize,
} from '../src/ai/waifu2xContract.js'

const CORRECTED_MODEL_SHA256 = '57547e0acf5e7b0353e7cf95122acb0459dd453553e26e89f989b4cfefe13536'

test('browser waifu2x model is the corrected tiled model', async () => {
  const modelPath = fileURLToPath(new URL('../public/models/waifu2x.onnx', import.meta.url))
  const model = await readFile(modelPath)
  const digest = createHash('sha256').update(model).digest('hex')

  assert.equal(digest, CORRECTED_MODEL_SHA256)
})

test('waifu2x tile contract accepts even and odd edge tiles', () => {
  assert.deepEqual(
    getExpectedWaifu2xTileOutputSize({ coreWidth: 192, coreHeight: 160 }),
    { width: 384, height: 320 },
  )
  assert.deepEqual(
    getExpectedWaifu2xTileOutputSize({ coreWidth: 191, coreHeight: 159 }),
    { width: 384, height: 320 },
  )

  const output = {
    dims: [1, 3, 320, 384],
    data: new Float32Array(3 * 320 * 384),
  }
  assert.deepEqual(
    assertWaifu2xTileOutput(output, { coreWidth: 191, coreHeight: 159 }),
    { width: 384, height: 320 },
  )
})

test('waifu2x tile contract rejects the incompatible legacy model output', () => {
  const legacyOutput = {
    dims: [1, 3, 412, 412],
    data: new Float32Array(3 * 412 * 412),
  }

  assert.throws(
    () => assertWaifu2xTileOutput(legacyOutput, { coreWidth: 192, coreHeight: 192 }),
    /AI_MODEL_OUTPUT_MISMATCH/,
  )
})
