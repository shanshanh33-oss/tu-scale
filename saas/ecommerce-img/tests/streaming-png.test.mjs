import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'

import { encodeRgbaToPng, StreamingPngEncoder } from '../src/ai/streamingPng.js'
import { createStreamingRowResampler } from '../src/ai/streamingResize.js'

test('streaming PNG encoder preserves RGBA rows across multiple writes', async () => {
  const width = 5
  const height = 4
  const rgba = new Uint8Array(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgba[pixel * 4] = (pixel * 31) % 256
    rgba[pixel * 4 + 1] = (pixel * 17 + 9) % 256
    rgba[pixel * 4 + 2] = (pixel * 7 + 41) % 256
    rgba[pixel * 4 + 3] = [0, 64, 128, 255][pixel % 4]
  }

  const png = await encodeRgbaToPng(width, height, rgba, 2)
  const decoded = await sharp(await png.arrayBuffer()).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  assert.equal(decoded.info.width, width)
  assert.equal(decoded.info.height, height)
  assert.deepEqual(decoded.data, Buffer.from(rgba))
})

test('streaming PNG encoder handles a large image without a full output canvas', async () => {
  const width = 4096
  const height = 2048
  const rowsPerWrite = 8
  const rows = new Uint8Array(width * rowsPerWrite * 4)
  for (let pixel = 0; pixel < width * rowsPerWrite; pixel++) {
    rows[pixel * 4] = pixel % 251
    rows[pixel * 4 + 1] = (pixel * 3) % 253
    rows[pixel * 4 + 2] = (pixel * 7) % 255
    rows[pixel * 4 + 3] = 255
  }

  const encoder = new StreamingPngEncoder(width, height)
  for (let row = 0; row < height; row += rowsPerWrite) await encoder.writeRows(rows, rowsPerWrite)
  const png = await encoder.finish()
  const metadata = await sharp(await png.arrayBuffer()).metadata()

  assert.equal(metadata.width, width)
  assert.equal(metadata.height, height)
  assert.equal(metadata.hasAlpha, true)
})

test('streaming PNG encoder supports its JavaScript compression fallback', async () => {
  const rgba = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 128,
    0, 0, 255, 64,
    255, 255, 255, 0,
  ])
  const encoder = new StreamingPngEncoder(2, 2, { forceJavaScript: true })
  await encoder.writeRows(rgba, 2)
  const png = await encoder.finish()
  const decoded = await sharp(await png.arrayBuffer()).ensureAlpha().raw().toBuffer()

  assert.deepEqual(decoded, Buffer.from(rgba))
})

test('streaming row resampler preserves premultiplied transparent edges', async () => {
  const source = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 0,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ])
  const chunks = []
  const resampler = createStreamingRowResampler(2, 2, 3, 3, false, async rows => {
    chunks.push(new Uint8Array(rows))
  })

  await resampler.pushRows(source.subarray(0, 8), 1)
  await resampler.pushRows(source.subarray(8), 1)
  await resampler.finish()
  const result = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
  const center = Array.from(result.subarray((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4))

  assert.equal(result.length, 3 * 3 * 4)
  assert.deepEqual(center, [170, 85, 170, 191])
})
