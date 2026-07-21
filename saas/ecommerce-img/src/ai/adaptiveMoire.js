const BLOCK_SIZE = 64
const MIN_PERIOD = 5
const MAX_PERIOD = 32

const clamp01 = value => Math.max(0, Math.min(1, value))

const createImageData = (data, width, height) => (
  typeof ImageData === 'undefined' ? { data, width, height } : new ImageData(data, width, height)
)

const makeLuma = imageData => {
  const luma = new Float32Array(imageData.width * imageData.height)
  for (let source = 0, pixel = 0; source < imageData.data.length; source += 4, pixel++) {
    luma[pixel] = 0.299 * imageData.data[source] + 0.587 * imageData.data[source + 1] + 0.114 * imageData.data[source + 2]
  }
  return luma
}

const buildProfile = (luma, width, left, top, blockWidth, blockHeight, orientation) => {
  const diagonal = orientation === 'diag-down' || orientation === 'diag-up'
  const length = diagonal
    ? blockWidth + blockHeight - 1
    : orientation === 'vertical' ? blockWidth : blockHeight
  const sums = new Float32Array(length)
  const counts = new Uint16Array(length)

  for (let localY = 0; localY < blockHeight; localY++) {
    const row = (top + localY) * width + left
    for (let localX = 0; localX < blockWidth; localX++) {
      let bin
      if (orientation === 'vertical') bin = localX
      else if (orientation === 'horizontal') bin = localY
      else if (orientation === 'diag-down') bin = localX + localY
      else bin = localX - localY + blockHeight - 1
      sums[bin] += luma[row + localX]
      counts[bin] += 1
    }
  }

  for (let index = 0; index < length; index++) {
    if (counts[index]) sums[index] /= counts[index]
  }
  return sums
}

const analyzeProfile = profile => {
  const length = profile.length
  if (length < 16) return null
  const detrended = new Float32Array(length)
  let variance = 0
  const smoothRadius = Math.min(15, Math.max(4, Math.floor(length / 8)))
  for (let index = 0; index < length; index++) {
    let local = 0
    let count = 0
    for (let offset = -smoothRadius; offset <= smoothRadius; offset++) {
      const sample = index + offset
      if (sample >= 0 && sample < length) {
        local += profile[sample]
        count += 1
      }
    }
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / Math.max(1, length - 1))
    const value = (profile[index] - local / count) * window
    detrended[index] = value
    variance += value * value
  }
  variance /= length
  if (variance < 1.2) return null

  const minFrequency = Math.max(2, Math.ceil(length / MAX_PERIOD))
  const maxFrequency = Math.min(Math.floor(length / MIN_PERIOD), Math.floor(length / 2) - 1)
  let best = null
  let totalPower = 0
  const powers = []
  for (let frequency = minFrequency; frequency <= maxFrequency; frequency++) {
    let real = 0
    let imaginary = 0
    for (let index = 0; index < length; index++) {
      const angle = 2 * Math.PI * frequency * index / length
      real += detrended[index] * Math.cos(angle)
      imaginary -= detrended[index] * Math.sin(angle)
    }
    const power = real * real + imaginary * imaginary
    powers.push(power)
    totalPower += power
    if (!best || power > best.power) best = { frequency, power }
  }
  if (!best || totalPower <= 1e-5) return null

  const sorted = [...powers].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 1e-5
  const concentration = best.power / totalPower
  const prominence = best.power / Math.max(median, 1e-5)
  if (concentration < 0.34 || prominence < 5.5) return null

  return {
    period: length / best.frequency,
    confidence: clamp01((concentration - 0.34) / 0.42) * clamp01((prominence - 5.5) / 14),
    concentration,
    prominence,
  }
}

const detectBlockPattern = (luma, width, left, top, blockWidth, blockHeight) => {
  const candidates = ['vertical', 'horizontal', 'diag-down', 'diag-up']
    .map(orientation => {
      const detection = analyzeProfile(buildProfile(luma, width, left, top, blockWidth, blockHeight, orientation))
      return detection ? { orientation, ...detection } : null
    })
    .filter(Boolean)
    .sort((a, b) => (b.confidence + b.concentration) - (a.confidence + a.concentration))

  const best = candidates[0]
  if (!best || best.confidence < 0.08) return null
  return best
}

const getDirectionOffset = detection => {
  const step = Math.max(1, Math.min(8, Math.round(detection.period / 4)))
  if (detection.orientation === 'vertical') return { dx: step, dy: 0 }
  if (detection.orientation === 'horizontal') return { dx: 0, dy: step }
  const diagonalStep = Math.max(1, Math.round(step / Math.SQRT2))
  if (detection.orientation === 'diag-down') return { dx: diagonalStep, dy: diagonalStep }
  return { dx: diagonalStep, dy: -diagonalStep }
}

const maskValueAt = (faceSkinMask, x, y, width, height) => {
  if (!faceSkinMask) return 0
  const maskX = Math.min(faceSkinMask.width - 1, Math.floor(x * faceSkinMask.width / width))
  const maskY = Math.min(faceSkinMask.height - 1, Math.floor(y * faceSkinMask.height / height))
  return faceSkinMask.data[maskY * faceSkinMask.width + maskX] / 255
}

export const adaptiveMoireReductionFilter = (imageData, strength = 0.75, faceSkinMask = null, skinStrength = 0.6) => {
  const { data, width, height } = imageData
  if (width < 16 || height < 16 || strength <= 0) return imageData
  const luma = makeLuma(imageData)
  const output = new Uint8ClampedArray(data)

  for (let top = 0; top < height; top += BLOCK_SIZE) {
    for (let left = 0; left < width; left += BLOCK_SIZE) {
      const blockWidth = Math.min(BLOCK_SIZE, width - left)
      const blockHeight = Math.min(BLOCK_SIZE, height - top)
      if (blockWidth < 16 || blockHeight < 16) continue
      const detection = detectBlockPattern(luma, width, left, top, blockWidth, blockHeight)
      if (!detection) continue
      const { dx, dy } = getDirectionOffset(detection)
      const baseBlend = strength * (0.34 + 0.56 * detection.confidence)

      for (let y = top; y < top + blockHeight; y++) {
        for (let x = left; x < left + blockWidth; x++) {
          const x0 = Math.max(0, Math.min(width - 1, x - dx))
          const y0 = Math.max(0, Math.min(height - 1, y - dy))
          const x1 = Math.max(0, Math.min(width - 1, x + dx))
          const y1 = Math.max(0, Math.min(height - 1, y + dy))
          const index = y * width + x
          const before = y * width + Math.max(0, x - 1)
          const after = y * width + Math.min(width - 1, x + 1)
          const above = Math.max(0, y - 1) * width + x
          const below = Math.min(height - 1, y + 1) * width + x
          const gradient = Math.abs(luma[before] - luma[after]) + Math.abs(luma[above] - luma[below])
          // Screen stripes are themselves small gradients. Protect only broader,
          // high-contrast structures so periodic lines are not mistaken for text.
          const edgeProtection = clamp01((gradient - 30) / 90)
          const skinWeight = maskValueAt(faceSkinMask, x, y, width, height)
          const skinResponse = Math.pow(clamp01(skinStrength), 1.35)
          const skinMultiplier = 1 + skinWeight * (-0.70 + skinResponse * 1.35)
          const lumaBlend = baseBlend * (1 - 0.90 * edgeProtection) * skinMultiplier
          const colorBlend = Math.min(1, baseBlend * 1.14 * (1 - 0.72 * edgeProtection) * skinMultiplier)
          if (lumaBlend < 0.015 && colorBlend < 0.015) continue

          const pixelIndex = index * 4
          const sample0 = (y0 * width + x0) * 4
          const sample1 = (y1 * width + x1) * 4
          const centerY = luma[index]
          const filteredR = (data[sample0] + data[pixelIndex] + data[sample1]) / 3
          const filteredG = (data[sample0 + 1] + data[pixelIndex + 1] + data[sample1 + 1]) / 3
          const filteredB = (data[sample0 + 2] + data[pixelIndex + 2] + data[sample1 + 2]) / 3
          const filteredY = 0.299 * filteredR + 0.587 * filteredG + 0.114 * filteredB
          const nextY = centerY + (filteredY - centerY) * lumaBlend
          const centerCb = data[pixelIndex + 2] - centerY
          const centerCr = data[pixelIndex] - centerY
          const filteredCb = filteredB - filteredY
          const filteredCr = filteredR - filteredY
          const nextCb = centerCb + (filteredCb - centerCb) * colorBlend
          const nextCr = centerCr + (filteredCr - centerCr) * colorBlend
          const nextR = nextY + nextCr
          const nextB = nextY + nextCb
          const nextG = (nextY - 0.299 * nextR - 0.114 * nextB) / 0.587
          output[pixelIndex] = Math.max(0, Math.min(255, Math.round(nextR)))
          output[pixelIndex + 1] = Math.max(0, Math.min(255, Math.round(nextG)))
          output[pixelIndex + 2] = Math.max(0, Math.min(255, Math.round(nextB)))
        }
      }
    }
  }
  return createImageData(output, width, height)
}

export const analyzeMoireForTest = imageData => {
  const luma = makeLuma(imageData)
  let blocks = 0
  let detected = 0
  for (let top = 0; top < imageData.height; top += BLOCK_SIZE) {
    for (let left = 0; left < imageData.width; left += BLOCK_SIZE) {
      const blockWidth = Math.min(BLOCK_SIZE, imageData.width - left)
      const blockHeight = Math.min(BLOCK_SIZE, imageData.height - top)
      if (blockWidth < 16 || blockHeight < 16) continue
      blocks += 1
      if (detectBlockPattern(luma, imageData.width, left, top, blockWidth, blockHeight)) detected += 1
    }
  }
  return { blocks, detected }
}
