import test from 'node:test'
import assert from 'node:assert/strict'

import { applyNightDenoiseFilter, estimateNightNoise, getNightDenoisePassStrengths } from '../src/ai/nightDenoise.js'

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

  const original = new Uint8ClampedArray(source)
  const result = applyNightDenoiseFilter({ data: source, width, height })
  const deviation = (data, xStart, xEnd) => {
    const samples = []
    for (let y = 8; y < height - 8; y++) {
      for (let x = xStart; x < xEnd; x++) {
        const offset = (y * width + x) * 4
        const luma = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
        samples.push(data[offset + 2] - luma, data[offset] - luma)
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

  const beforeEdge = averageLuma(original, 66, 72) - averageLuma(original, 56, 62)
  const afterEdge = averageLuma(result.data, 66, 72) - averageLuma(result.data, 56, 62)
  assert.ok(deviation(result.data, 8, 56) < deviation(original, 8, 56) * 0.88)
  assert.ok(afterEdge > beforeEdge * 0.9)
  for (let pixel = 0; pixel < width * height; pixel++) {
    assert.equal(result.data[pixel * 4 + 3], original[pixel * 4 + 3])
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
  assert.deepEqual(applyNightDenoiseFilter({ data: source, width, height }).data, original)
})

test('night denoise detects multi-pixel grain and uses adaptive passes', () => {
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
  const estimate = estimateNightNoise({ data: source, width, height })
  assert.ok(estimate.coarseLumaNoise > estimate.fineLumaNoise)
  assert.deepEqual(getNightDenoisePassStrengths(0.45), [0.45])
  assert.deepEqual(getNightDenoisePassStrengths(0.75), [0.75, 0.6428571428571429])
  assert.deepEqual(getNightDenoisePassStrengths(1), [1, 1])
})
