import test from 'node:test'
import assert from 'node:assert/strict'

import { applyNightDenoiseFilter, estimateNightNoise, getNightDenoisePassStrengths, recoverNightDenoiseDetails } from '../src/ai/nightDenoise.js'

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
