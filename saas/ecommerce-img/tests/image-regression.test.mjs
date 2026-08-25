import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import sharp from 'sharp'

import { applyLocalizedChromaMoireFilter } from '../src/ai/localizedChromaMoire.js'
import { applyNightDenoiseFilter, estimateNightNoise, getNightDenoisePassStrengths, recoverNightDenoiseDetails } from '../src/ai/nightDenoise.js'
import { runSequentialBatch } from '../src/tools/batchQueue.js'
import { decodeInputImage, getInputDecodeErrorMessage, isHeicFile } from '../src/tools/heic.js'
import { createImageZipBlob } from '../src/tools/imageZip.js'
import { encodeRgbaToPng } from '../src/ai/streamingPng.js'
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

test('streaming PNG encoder handles a large image without allocating a full encoded canvas', async () => {
  const width = 4096
  const height = 2048
  const rowsPerWrite = 8
  const encoderInput = new Uint8Array(width * rowsPerWrite * 4)
  for (let pixel = 0; pixel < width * rowsPerWrite; pixel++) {
    encoderInput[pixel * 4] = pixel % 251
    encoderInput[pixel * 4 + 1] = (pixel * 3) % 253
    encoderInput[pixel * 4 + 2] = (pixel * 7) % 255
    encoderInput[pixel * 4 + 3] = 255
  }

  const { StreamingPngEncoder } = await import('../src/ai/streamingPng.js')
  const encoder = new StreamingPngEncoder(width, height)
  for (let row = 0; row < height; row += rowsPerWrite) {
    await encoder.writeRows(encoderInput, rowsPerWrite)
  }
  const png = await encoder.finish()
  const metadata = await sharp(await png.arrayBuffer()).metadata()

  assert.equal(metadata.width, width)
  assert.equal(metadata.height, height)
  assert.equal(metadata.hasAlpha, true)
})

test('streaming PNG encoder falls back when the browser compression stream is unavailable', async () => {
  const { StreamingPngEncoder } = await import('../src/ai/streamingPng.js')
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

test('transparent PNG round-trip preserves every alpha value', async () => {
  const rgba = Buffer.from([
    255, 0, 0, 0,
    0, 255, 0, 64,
    0, 0, 255, 128,
    255, 255, 255, 255,
  ])
  const png = await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer()
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  assert.equal(decoded.info.width, 2)
  assert.equal(decoded.info.height, 2)
  assert.deepEqual(
    [decoded.data[3], decoded.data[7], decoded.data[11], decoded.data[15]],
    [0, 64, 128, 255],
  )
})

test('localized moire processing preserves dimensions, alpha, and RGB outside the mask', () => {
  const width = 256
  const height = 192
  const source = new Uint8ClampedArray(width * height * 4)
  const mask = new Uint8ClampedArray(source.length)

  for (let y = 0; y < height; y++) {
    const wave = 13 * Math.sin(2 * Math.PI * y / 36)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const texture = 3 * Math.sin(2 * Math.PI * x / 9)
      source[offset] = Math.round(118 + wave + texture)
      source[offset + 1] = Math.round(126 + wave + texture)
      source[offset + 2] = Math.round(153 - wave * 0.55 + texture)
      source[offset + 3] = [0, 64, 128, 255][(x + y) % 4]
      if (x >= 32 && x < 224 && y >= 24 && y < 168) mask[offset + 3] = 255
    }
  }

  const result = applyLocalizedChromaMoireFilter(
    { data: source, width, height },
    { data: mask, width, height },
  )

  assert.equal(result.width, width)
  assert.equal(result.height, height)
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4
    assert.equal(result.data[offset + 3], source[offset + 3], `alpha changed at pixel ${pixel}`)
    if (mask[offset + 3] === 0) {
      assert.deepEqual(
        Array.from(result.data.slice(offset, offset + 3)),
        Array.from(source.slice(offset, offset + 3)),
        `RGB changed outside mask at pixel ${pixel}`,
      )
    }
  }
})

test('night denoise reduces dark chroma noise while preserving alpha and a strong edge', () => {
  const width = 128
  const height = 96
  const source = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const base = x < width / 2 ? 58 : 118
      const lumaNoise = ((x * 17 + y * 29) % 23) - 11
      const chromaNoise = ((x * 31 + y * 7) % 19) - 9
      source[offset] = base + lumaNoise + chromaNoise
      source[offset + 1] = base + lumaNoise
      source[offset + 2] = base + lumaNoise - chromaNoise
      source[offset + 3] = [0, 64, 128, 255][(x + y) % 4]
    }
  }

  const hotOffset = (20 * width + 20) * 4
  source[hotOffset] = 225
  source[hotOffset + 1] = 20
  source[hotOffset + 2] = 24
  source[hotOffset + 3] = 255
  const original = new Uint8ClampedArray(source)
  const diagnostics = {}
  const result = applyNightDenoiseFilter(
    { data: source, width, height },
    { diagnostics },
  )

  const chromaDeviation = (data, xStart, xEnd) => {
    const samples = []
    for (let y = 8; y < height - 8; y++) {
      for (let x = xStart; x < xEnd; x++) {
        if (x === 20 && y === 20) continue
        const offset = (y * width + x) * 4
        const luma = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
        samples.push(data[offset + 2] - luma, data[offset] - luma)
      }
    }
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
    return Math.sqrt(samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length)
  }
  const lumaDeviation = (data, xStart, xEnd) => {
    const samples = []
    for (let y = 8; y < height - 8; y++) {
      for (let x = xStart; x < xEnd; x++) {
        if (x === 20 && y === 20) continue
        const offset = (y * width + x) * 4
        if (data[offset + 3] === 0) continue
        samples.push(data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114)
      }
    }
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
    return Math.sqrt(samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length)
  }
  const averageLuma = (data, xStart, xEnd) => {
    let sum = 0
    let count = 0
    for (let y = 8; y < height - 8; y++) {
      for (let x = xStart; x < xEnd; x++) {
        const offset = (y * width + x) * 4
        sum += data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
        count++
      }
    }
    return sum / count
  }

  const beforeNoise = chromaDeviation(original, 8, 56)
  const afterNoise = chromaDeviation(result.data, 8, 56)
  const beforeLumaNoise = lumaDeviation(original, 8, 56)
  const afterLumaNoise = lumaDeviation(result.data, 8, 56)
  const beforeEdge = averageLuma(original, 66, 72) - averageLuma(original, 56, 62)
  const afterEdge = averageLuma(result.data, 66, 72) - averageLuma(result.data, 56, 62)
  const beforeHotChroma = Math.max(original[hotOffset], original[hotOffset + 1], original[hotOffset + 2])
    - Math.min(original[hotOffset], original[hotOffset + 1], original[hotOffset + 2])
  const afterHotChroma = Math.max(result.data[hotOffset], result.data[hotOffset + 1], result.data[hotOffset + 2])
    - Math.min(result.data[hotOffset], result.data[hotOffset + 1], result.data[hotOffset + 2])

  assert.equal(result.width, width)
  assert.equal(result.height, height)
  assert.ok(afterNoise < beforeNoise * 0.88, `chroma noise ${beforeNoise} -> ${afterNoise}`)
  assert.ok(afterLumaNoise < beforeLumaNoise * 0.9, `luma noise ${beforeLumaNoise} -> ${afterLumaNoise}`)
  assert.ok(afterEdge > beforeEdge * 0.9, `edge contrast ${beforeEdge} -> ${afterEdge}`)
  assert.ok(afterHotChroma < beforeHotChroma * 0.45, `hot pixel chroma ${beforeHotChroma} -> ${afterHotChroma}`)
  assert.ok(diagnostics.changedPixels > 0)
  assert.ok(diagnostics.hotPixels > 0)
  for (let pixel = 0; pixel < width * height; pixel++) {
    assert.equal(result.data[pixel * 4 + 3], original[pixel * 4 + 3], `alpha changed at pixel ${pixel}`)
  }
})

test('night denoise leaves a clean bright image unchanged', () => {
  const width = 32
  const height = 24
  const source = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      source[offset] = 232 + Math.floor(x / 16)
      source[offset + 1] = 228 + Math.floor(y / 12)
      source[offset + 2] = 224
      source[offset + 3] = [0, 85, 170, 255][(x + y) % 4]
    }
  }

  const original = new Uint8ClampedArray(source)
  const result = applyNightDenoiseFilter({ data: source, width, height })
  assert.deepEqual(result.data, original)
})

test('night denoise detects and reduces camera-like multi-pixel luma grain', () => {
  const width = 144
  const height = 108
  const source = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const blockNoise = ((Math.floor(x / 3) * 17 + Math.floor(y / 3) * 29) % 17) - 8
      source[offset] = 62 + blockNoise
      source[offset + 1] = 62 + blockNoise
      source[offset + 2] = 62 + blockNoise
      source[offset + 3] = 255
    }
  }

  const original = new Uint8ClampedArray(source)
  const estimate = estimateNightNoise({ data: source, width, height })
  const result = applyNightDenoiseFilter(
    { data: source, width, height },
    { strength: 0.75 },
  )
  const radiusTwoResidual = data => {
    let sum = 0
    let count = 0
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const center = data[(y * width + x) * 4]
        const neighbors = [
          data[(y * width + x - 2) * 4],
          data[(y * width + x + 2) * 4],
          data[((y - 2) * width + x) * 4],
          data[((y + 2) * width + x) * 4],
        ]
        sum += Math.abs(center - neighbors.reduce((total, value) => total + value, 0) / 4)
        count++
      }
    }
    return sum / count
  }

  const beforeResidual = radiusTwoResidual(original)
  const afterResidual = radiusTwoResidual(result.data)
  assert.ok(estimate.coarseLumaNoise > estimate.fineLumaNoise)
  assert.ok(afterResidual < beforeResidual * 0.8, `multi-pixel luma noise ${beforeResidual} -> ${afterResidual}`)
})

test('night denoise uses one light pass and two adaptive standard or strong passes', () => {
  assert.deepEqual(getNightDenoisePassStrengths(0.45), [0.45])
  assert.deepEqual(getNightDenoisePassStrengths(0.75), [0.75, 0.6428571428571429])
  assert.deepEqual(getNightDenoisePassStrengths(1), [1, 1])
})

test('night denoise detail recovery sharpens real edges without restoring flat-area chroma grain', () => {
  const width = 160
  const height = 112
  const source = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const base = x < 80 ? 54 : 112
      const texture = x >= 92 ? Math.round(7 * Math.sin(x * 0.72) * Math.sin(y * 0.45)) : 0
      const lumaNoise = ((x * 19 + y * 23) % 15) - 7
      const chromaNoise = ((x * 31 + y * 11) % 13) - 6
      source[offset] = base + texture + lumaNoise + chromaNoise
      source[offset + 1] = base + texture + lumaNoise
      source[offset + 2] = base + texture + lumaNoise - chromaNoise
      source[offset + 3] = [0, 96, 192, 255][(x + y) % 4]
    }
  }

  const firstPass = applyNightDenoiseFilter(
    { data: source, width, height },
    { strength: 0.75, lumaStrengthScale: 0.72 },
  )
  const chromaPass = applyNightDenoiseFilter(firstPass, {
    strength: 0.6428571428571429,
    lumaStrengthScale: 0,
    chromaStrengthScale: 0.82,
  })
  const recovered = recoverNightDenoiseDetails(chromaPass, {
    sourceImageData: { data: source, width, height },
    strength: 0.75,
    amount: 0.56,
  })

  const lumaAt = (data, x, y) => {
    const offset = (y * width + x) * 4
    return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
  }
  const edgeEnergy = data => {
    let total = 0
    let count = 0
    for (let y = 8; y < height - 8; y++) {
      for (let x = 76; x < width - 8; x++) {
        total += Math.abs(lumaAt(data, x + 1, y) - lumaAt(data, x - 1, y))
        count++
      }
    }
    return total / count
  }
  const flatChromaResidual = data => {
    let total = 0
    let count = 0
    for (let y = 8; y < height - 8; y++) {
      for (let x = 8; x < 68; x++) {
        const offset = (y * width + x) * 4
        const right = offset + 4
        const luma = lumaAt(data, x, y)
        const rightLuma = lumaAt(data, x + 1, y)
        total += Math.abs((data[offset] - luma) - (data[right] - rightLuma))
        total += Math.abs((data[offset + 2] - luma) - (data[right + 2] - rightLuma))
        count += 2
      }
    }
    return total / count
  }
  const flatLumaResidual = data => {
    let total = 0
    let count = 0
    for (let y = 8; y < height - 8; y++) {
      for (let x = 8; x < 68; x++) {
        total += Math.abs(lumaAt(data, x, y) - lumaAt(data, x + 1, y))
        count++
      }
    }
    return total / count
  }
  const lumaDifferenceFromSource = (data, xStart, xEnd) => {
    let total = 0
    let count = 0
    for (let y = 8; y < height - 8; y++) {
      for (let x = xStart; x < xEnd; x++) {
        total += Math.abs(lumaAt(source, x, y) - lumaAt(data, x, y))
        count++
      }
    }
    return total / count
  }

  const filteredEdgeEnergy = edgeEnergy(chromaPass.data)
  const recoveredEdgeEnergy = edgeEnergy(recovered.data)
  const filteredChroma = flatChromaResidual(chromaPass.data)
  const recoveredChroma = flatChromaResidual(recovered.data)
  const filteredFlatLuma = flatLumaResidual(chromaPass.data)
  const recoveredFlatLuma = flatLumaResidual(recovered.data)
  const filteredTextureDifference = lumaDifferenceFromSource(chromaPass.data, 92, width - 8)
  const recoveredTextureDifference = lumaDifferenceFromSource(recovered.data, 92, width - 8)

  assert.ok(recoveredEdgeEnergy > filteredEdgeEnergy * 1.015, `edge energy ${filteredEdgeEnergy} -> ${recoveredEdgeEnergy}`)
  assert.ok(
    recoveredTextureDifference < filteredTextureDifference,
    `texture difference ${filteredTextureDifference} -> ${recoveredTextureDifference}`,
  )
  assert.ok(
    recoveredFlatLuma <= filteredFlatLuma * 1.03,
    `flat luma ${filteredFlatLuma} -> ${recoveredFlatLuma}`,
  )
  assert.ok(recoveredChroma <= filteredChroma * 1.015, `flat chroma ${filteredChroma} -> ${recoveredChroma}`)
  for (let pixel = 0; pixel < width * height; pixel++) {
    assert.equal(recovered.data[pixel * 4 + 3], source[pixel * 4 + 3], `alpha changed at pixel ${pixel}`)
  }
})

test('HEIC detection covers names and MIME variants', () => {
  assert.equal(isHeicFile({ name: 'photo.HEIC', type: '' }), true)
  assert.equal(isHeicFile({ name: 'photo.bin', type: 'image/heif-sequence' }), true)
  assert.equal(isHeicFile({ name: 'photo.png', type: 'image/png' }), false)
})

test('HEIC size and corrupt-file failures return stable user messages', async () => {
  const oversized = { name: 'large.heic', type: 'image/heic', size: 50 * 1024 * 1024 + 1 }
  await assert.rejects(() => decodeInputImage(oversized), { message: 'HEIC_TOO_LARGE' })
  assert.match(getInputDecodeErrorMessage(new Error('HEIC_TOO_LARGE')), /超过 50MB/)

  const corrupt = new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'image/heic' })
  Object.defineProperty(corrupt, 'name', { value: 'broken.heic' })
  await assert.rejects(() => decodeInputImage(corrupt), { message: 'HEIC_DECODE_FAILED' })
  assert.match(getInputDecodeErrorMessage(new Error('HEIC_DECODE_FAILED')), /无法读取这张 HEIC\/HEIF 图片/)
})

test('sequential queue covers one-item success and multi-item failure continuation', async () => {
  const single = []
  const singleSummary = await runSequentialBatch({
    items: ['only'],
    processItem: async item => item.toUpperCase(),
    onItemSuccess: (item, result) => single.push([item, result]),
  })
  assert.deepEqual(single, [['only', 'ONLY']])
  assert.deepEqual(singleSummary, { completed: 1, failed: 0, cancelled: false })

  const completed = []
  const failed = []
  const batchSummary = await runSequentialBatch({
    items: ['first', 'broken', 'last'],
    processItem: async item => {
      if (item === 'broken') throw new Error('EXPECTED_FAILURE')
      return `${item}-done`
    },
    onItemSuccess: (item, result) => completed.push([item, result]),
    onItemError: (item, error) => failed.push([item, error.message]),
  })
  assert.deepEqual(completed, [['first', 'first-done'], ['last', 'last-done']])
  assert.deepEqual(failed, [['broken', 'EXPECTED_FAILURE']])
  assert.deepEqual(batchSummary, { completed: 2, failed: 1, cancelled: false })
})

test('sequential queue stops before the next item after cancellation', async () => {
  let cancelled = false
  const processed = []
  const summary = await runSequentialBatch({
    items: ['first', 'second', 'third'],
    shouldCancel: () => cancelled,
    processItem: async item => item,
    onItemSuccess: item => {
      processed.push(item)
      cancelled = true
    },
  })

  assert.deepEqual(processed, ['first'])
  assert.deepEqual(summary, { completed: 1, failed: 0, cancelled: true })
})

test('ZIP generation includes Blob and data URL results with stable names', async () => {
  const transparentPng = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 0.5 } },
  }).png().toBuffer()
  const opaquePng = await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 1 } },
  }).png().toBuffer()

  const blob = await createImageZipBlob([
    { id: 'a', resultBlob: new Blob([transparentPng], { type: 'image/png' }) },
    { id: 'b', result: `data:image/png;base64,${opaquePng.toString('base64')}` },
  ], {
    format: 'png',
    getFileName: item => `result-${item.id}`,
  })

  const archive = await JSZip.loadAsync(await blob.arrayBuffer())
  assert.deepEqual(Object.keys(archive.files).sort(), ['result-a.png', 'result-b.png'])
  assert.deepEqual(
    Buffer.from(await archive.file('result-a.png').async('uint8array')),
    transparentPng,
  )
  assert.deepEqual(
    Buffer.from(await archive.file('result-b.png').async('uint8array')),
    opaquePng,
  )
})
