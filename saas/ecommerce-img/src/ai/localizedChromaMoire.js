const clamp01 = value => Math.max(0, Math.min(1, value))

const fitChromaToGamut = (luma, redDelta, greenDelta, blueDelta) => {
  let scale = 1
  for (const delta of [redDelta, greenDelta, blueDelta]) {
    if (delta > 0) scale = Math.min(scale, (255 - luma) / delta)
    else if (delta < 0) scale = Math.min(scale, -luma / delta)
  }
  return Math.max(0, Math.min(1, scale))
}

const createImageData = (data, width, height) => (
  typeof ImageData === 'undefined' ? { data, width, height } : new ImageData(data, width, height)
)

const boxBlur = (source, width, height, radius) => {
  if (radius <= 0) return new Float32Array(source)
  const temp = new Float32Array(source.length)
  const output = new Float32Array(source.length)

  for (let y = 0; y < height; y++) {
    let sum = 0
    for (let x = -radius; x <= radius; x++) {
      sum += source[y * width + Math.max(0, Math.min(width - 1, x))]
    }
    for (let x = 0; x < width; x++) {
      temp[y * width + x] = sum / (radius * 2 + 1)
      const removeX = Math.max(0, x - radius)
      const addX = Math.min(width - 1, x + radius + 1)
      sum += source[y * width + addX] - source[y * width + removeX]
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) {
      sum += temp[Math.max(0, Math.min(height - 1, y)) * width + x]
    }
    for (let y = 0; y < height; y++) {
      output[y * width + x] = sum / (radius * 2 + 1)
      const removeY = Math.max(0, y - radius)
      const addY = Math.min(height - 1, y + radius + 1)
      sum += temp[addY * width + x] - temp[removeY * width + x]
    }
  }
  return output
}

const edgeAwareSmooth = (source, luma, width, height, radius, rangeSigma, iterations) => {
  let current = new Float32Array(source)
  const horizontal = new Float32Array(source.length)
  let next = new Float32Array(source.length)
  const iterationScale = Math.sqrt(Math.pow(4, iterations) - 1)

  for (let iteration = 0; iteration < iterations; iteration++) {
    const spatialSigma = radius * Math.sqrt(3) *
      Math.pow(2, iterations - iteration - 1) / iterationScale
    const baseWeight = Math.exp(-Math.SQRT2 / Math.max(1, spatialSigma))
    const edgeScale = radius / Math.max(1, rangeSigma)

    for (let y = 0; y < height; y++) {
      const row = y * width
      horizontal[row] = current[row]
      for (let x = 1; x < width; x++) {
        const index = row + x
        const domainDistance = 1 + edgeScale * Math.abs(luma[index] - luma[index - 1])
        const weight = Math.pow(baseWeight, domainDistance)
        horizontal[index] = current[index] + weight * (horizontal[index - 1] - current[index])
      }
      for (let x = width - 2; x >= 0; x--) {
        const index = row + x
        const domainDistance = 1 + edgeScale * Math.abs(luma[index] - luma[index + 1])
        const weight = Math.pow(baseWeight, domainDistance)
        horizontal[index] += weight * (horizontal[index + 1] - horizontal[index])
      }
    }

    for (let x = 0; x < width; x++) {
      next[x] = horizontal[x]
      for (let y = 1; y < height; y++) {
        const index = y * width + x
        const domainDistance = 1 + edgeScale * Math.abs(luma[index] - luma[index - width])
        const weight = Math.pow(baseWeight, domainDistance)
        next[index] = horizontal[index] + weight * (next[index - width] - horizontal[index])
      }
      for (let y = height - 2; y >= 0; y--) {
        const index = y * width + x
        const domainDistance = 1 + edgeScale * Math.abs(luma[index] - luma[index + width])
        const weight = Math.pow(baseWeight, domainDistance)
        next[index] += weight * (next[index + width] - next[index])
      }
    }

    const previous = current
    current = next
    next = previous
  }
  return current
}

const edgeAwareSmoothPair = (first, second, luma, width, height, radius, rangeSigma, iterations) => {
  let currentFirst = new Float32Array(first)
  let currentSecond = new Float32Array(second)
  const horizontalFirst = new Float32Array(first.length)
  const horizontalSecond = new Float32Array(second.length)
  let nextFirst = new Float32Array(first.length)
  let nextSecond = new Float32Array(second.length)
  const iterationScale = Math.sqrt(Math.pow(4, iterations) - 1)

  for (let iteration = 0; iteration < iterations; iteration++) {
    const spatialSigma = radius * Math.sqrt(3) *
      Math.pow(2, iterations - iteration - 1) / iterationScale
    const baseWeight = Math.exp(-Math.SQRT2 / Math.max(1, spatialSigma))
    const edgeScale = radius / Math.max(1, rangeSigma)

    for (let y = 0; y < height; y++) {
      const row = y * width
      horizontalFirst[row] = currentFirst[row]
      horizontalSecond[row] = currentSecond[row]
      for (let x = 1; x < width; x++) {
        const index = row + x
        const weight = Math.pow(baseWeight, 1 + edgeScale * Math.abs(luma[index] - luma[index - 1]))
        horizontalFirst[index] = currentFirst[index] + weight * (horizontalFirst[index - 1] - currentFirst[index])
        horizontalSecond[index] = currentSecond[index] + weight * (horizontalSecond[index - 1] - currentSecond[index])
      }
      for (let x = width - 2; x >= 0; x--) {
        const index = row + x
        const weight = Math.pow(baseWeight, 1 + edgeScale * Math.abs(luma[index] - luma[index + 1]))
        horizontalFirst[index] += weight * (horizontalFirst[index + 1] - horizontalFirst[index])
        horizontalSecond[index] += weight * (horizontalSecond[index + 1] - horizontalSecond[index])
      }
    }

    for (let x = 0; x < width; x++) {
      nextFirst[x] = horizontalFirst[x]
      nextSecond[x] = horizontalSecond[x]
      for (let y = 1; y < height; y++) {
        const index = y * width + x
        const weight = Math.pow(baseWeight, 1 + edgeScale * Math.abs(luma[index] - luma[index - width]))
        nextFirst[index] = horizontalFirst[index] + weight * (nextFirst[index - width] - horizontalFirst[index])
        nextSecond[index] = horizontalSecond[index] + weight * (nextSecond[index - width] - horizontalSecond[index])
      }
      for (let y = height - 2; y >= 0; y--) {
        const index = y * width + x
        const weight = Math.pow(baseWeight, 1 + edgeScale * Math.abs(luma[index] - luma[index + width]))
        nextFirst[index] += weight * (nextFirst[index + width] - nextFirst[index])
        nextSecond[index] += weight * (nextSecond[index + width] - nextSecond[index])
      }
    }

    const previousFirst = currentFirst
    const previousSecond = currentSecond
    currentFirst = nextFirst
    currentSecond = nextSecond
    nextFirst = previousFirst
    nextSecond = previousSecond
  }
  return { first: currentFirst, second: currentSecond }
}

const buildMaskedProfile = (source, mask, width, height, orientation, sampling = 1) => {
  const diagonal = orientation === 'diag-down' || orientation === 'diag-up'
  const diagonalCenter = orientation === 'diag-down'
    ? (width - height) / 2
    : (width + height - 2) / 2
  const diagonalHalfBand = Math.max(4, Math.round(Math.min(width, height) * 0.08))
  const rawLength = diagonal
    ? width + height - 1
    : orientation === 'vertical' ? width : height
  const length = Math.ceil(rawLength / sampling)
  const sums = new Float64Array(length)
  const weights = new Float64Array(length)

  for (let y = 0; y < height; y += sampling) {
    const row = y * width
    for (let x = 0; x < width; x += sampling) {
      const index = row + x
      const weight = mask[index]
      if (weight <= 0.05) continue
      if (diagonal) {
        const orthogonal = orientation === 'diag-down' ? x - y : x + y
        if (Math.abs(orthogonal - diagonalCenter) > diagonalHalfBand) continue
      }
      let bin
      if (orientation === 'vertical') bin = Math.floor(x / sampling)
      else if (orientation === 'horizontal') bin = Math.floor(y / sampling)
      else if (orientation === 'diag-down') bin = Math.floor((x + y) / sampling)
      else bin = Math.floor((x - y + height - 1) / sampling)
      sums[bin] += source[index] * weight
      weights[bin] += weight
    }
  }

  let first = 0
  let last = length - 1
  while (first < length && weights[first] <= 0.05) first += 1
  while (last >= first && weights[last] <= 0.05) last -= 1
  if (last - first + 1 < 64) return null

  const profile = new Float32Array(last - first + 1)
  let previousValue = 0
  let hasPrevious = false
  for (let bin = first; bin <= last; bin++) {
    const target = bin - first
    if (weights[bin] > 0.05) {
      profile[target] = sums[bin] / weights[bin]
      previousValue = profile[target]
      hasPrevious = true
    } else if (hasPrevious) {
      profile[target] = previousValue
    }
  }
  for (let index = profile.length - 2; index >= 0; index--) {
    if (!profile[index]) profile[index] = profile[index + 1]
  }
  return profile
}

const analyzeRippleProfile = (profile, minPeriod, maxPeriod, includeWeak = false) => {
  if (!profile || profile.length < minPeriod * 2) return null
  const length = profile.length
  const safeMaxPeriod = Math.min(maxPeriod, Math.floor(length / 2))
  if (safeMaxPeriod <= minPeriod) return null
  const meanX = (length - 1) / 2
  let meanY = 0
  for (let index = 0; index < length; index++) meanY += profile[index]
  meanY /= length
  let covariance = 0
  let varianceX = 0
  for (let index = 0; index < length; index++) {
    const centeredX = index - meanX
    covariance += centeredX * (profile[index] - meanY)
    varianceX += centeredX * centeredX
  }
  const trendSlope = varianceX > 1e-5 ? covariance / varianceX : 0
  const detrended = new Float32Array(length)
  let variance = 0
  for (let index = 0; index < length; index++) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / Math.max(1, length - 1))
    const linearTrend = meanY + trendSlope * (index - meanX)
    const value = (profile[index] - linearTrend) * window
    detrended[index] = value
    variance += value * value
  }
  variance /= length
  if (variance < 0.08) return null

  const minFrequency = Math.max(2, Math.ceil(length / safeMaxPeriod))
  const maxFrequency = Math.min(Math.floor(length / minPeriod), Math.floor(length / 2) - 1)
  const powers = []
  let best = null
  let totalPower = 0
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

  const sortedPowers = [...powers].sort((a, b) => a - b)
  const medianPower = sortedPowers[Math.floor(sortedPowers.length / 2)] || 1e-5
  const concentration = best.power / totalPower
  const prominence = best.power / Math.max(medianPower, 1e-5)
  const lag = Math.max(1, Math.round(length / best.frequency))
  let correlationNumerator = 0
  let correlationFirstEnergy = 0
  let correlationSecondEnergy = 0
  for (let index = 0; index + lag < length; index++) {
    correlationNumerator += detrended[index] * detrended[index + lag]
    correlationFirstEnergy += detrended[index] * detrended[index]
    correlationSecondEnergy += detrended[index + lag] * detrended[index + lag]
  }
  const periodicCorrelation = correlationNumerator / Math.max(
    1e-5,
    Math.sqrt(correlationFirstEnergy * correlationSecondEnergy),
  )
  const confidence = clamp01((concentration - 0.11) / 0.3) *
    clamp01((prominence - 3.2) / 12) *
    clamp01((variance - 0.08) / 1.8) *
    clamp01((periodicCorrelation - 0.32) / 0.45)
  if (
    !includeWeak &&
    (confidence < 0.07 || prominence < 3.2 || periodicCorrelation < 0.32)
  ) return null
  return {
    period: length / best.frequency,
    confidence,
    concentration,
    prominence,
    periodicCorrelation,
    variance,
  }
}

const detectDirectionalRipples = (
  source,
  mask,
  width,
  height,
  periodLimits = null,
  includeWeak = false,
) => {
  const minEdge = Math.min(width, height)
  const sampling = Math.max(1, Math.ceil(Math.max(width, height) / 900))
  const minPeriod = periodLimits?.minPeriod
    ? Math.max(8, Math.round(periodLimits.minPeriod / sampling))
    : Math.max(12, Math.round(Math.max(32, minEdge * 0.018) / sampling))
  const maxPeriod = periodLimits?.maxPeriod
    ? Math.max(minPeriod + 4, Math.round(periodLimits.maxPeriod / sampling))
    : Math.max(minPeriod + 4, Math.round(Math.min(520, minEdge * 0.24) / sampling))
  const detections = ['vertical', 'horizontal', 'diag-down', 'diag-up']
    .map(orientation => {
      const profile = buildMaskedProfile(source, mask, width, height, orientation, sampling)
      const detection = analyzeRippleProfile(profile, minPeriod, maxPeriod, includeWeak)
      return detection ? { orientation, ...detection, period: detection.period * sampling } : null
    })
    .filter(Boolean)
    .sort((a, b) => (
      b.confidence * Math.sqrt(b.variance) - a.confidence * Math.sqrt(a.variance)
    ))
  return detections
}

const detectDirectionalRipple = (source, mask, width, height) => (
  detectDirectionalRipples(source, mask, width, height)[0] || null
)

const getDirectionalBin = (x, y, width, height, orientation) => {
  if (orientation === 'vertical') return x
  if (orientation === 'horizontal') return y
  if (orientation === 'diag-down') return x + y
  return x - y + height - 1
}

const fitDirectionalPeriodicCorrection = (
  source,
  mask,
  width,
  height,
  detection,
  amplitudeFloor,
  amplitudeLimit,
) => {
  if (!detection || detection.period < 8) return null
  const diagonal = detection.orientation === 'diag-down' || detection.orientation === 'diag-up'
  const length = diagonal
    ? width + height - 1
    : detection.orientation === 'vertical' ? width : height
  const sums = new Float64Array(length)
  const weights = new Float64Array(length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const index = row + x
      const weight = mask[index]
      if (weight <= 0.05) continue
      const bin = getDirectionalBin(x, y, width, height, detection.orientation)
      sums[bin] += source[index] * weight
      weights[bin] += weight
    }
  }

  let first = 0
  let last = length - 1
  while (first < length && weights[first] <= 0.05) first += 1
  while (last >= first && weights[last] <= 0.05) last -= 1
  if (last - first + 1 < detection.period * 2) return null

  let totalWeight = 0
  let meanBin = 0
  let meanValue = 0
  for (let bin = first; bin <= last; bin++) {
    if (weights[bin] <= 0.05) continue
    totalWeight += weights[bin]
    meanBin += bin * weights[bin]
    meanValue += sums[bin]
  }
  if (totalWeight <= 1e-5) return null
  meanBin /= totalWeight
  meanValue /= totalWeight

  let slopeNumerator = 0
  let slopeDenominator = 0
  for (let bin = first; bin <= last; bin++) {
    if (weights[bin] <= 0.05) continue
    const centeredBin = bin - meanBin
    const value = sums[bin] / weights[bin]
    slopeNumerator += centeredBin * (value - meanValue) * weights[bin]
    slopeDenominator += centeredBin * centeredBin * weights[bin]
  }
  const slope = slopeDenominator > 1e-5 ? slopeNumerator / slopeDenominator : 0
  const omega = 2 * Math.PI / detection.period
  let cosCos = 0
  let sinSin = 0
  let cosSin = 0
  let valueCos = 0
  let valueSin = 0
  for (let bin = first; bin <= last; bin++) {
    if (weights[bin] <= 0.05) continue
    const weight = weights[bin]
    const value = sums[bin] / weight - meanValue - slope * (bin - meanBin)
    const cosine = Math.cos(omega * bin)
    const sine = Math.sin(omega * bin)
    cosCos += cosine * cosine * weight
    sinSin += sine * sine * weight
    cosSin += cosine * sine * weight
    valueCos += value * cosine * weight
    valueSin += value * sine * weight
  }
  const determinant = cosCos * sinSin - cosSin * cosSin
  if (Math.abs(determinant) <= 1e-5) return null
  let cosineCoefficient = (valueCos * sinSin - valueSin * cosSin) / determinant
  let sineCoefficient = (valueSin * cosCos - valueCos * cosSin) / determinant
  const amplitude = Math.hypot(cosineCoefficient, sineCoefficient)
  if (amplitude < amplitudeFloor) return null
  const amplitudeScale = Math.min(1, amplitudeLimit / amplitude)
  cosineCoefficient *= amplitudeScale
  sineCoefficient *= amplitudeScale
  const correction = new Float32Array(length)
  for (let bin = first; bin <= last; bin++) {
    correction[bin] = cosineCoefficient * Math.cos(omega * bin) +
      sineCoefficient * Math.sin(omega * bin)
  }
  return { values: correction, amplitude: Math.min(amplitude, amplitudeLimit) }
}

const buildDirectionalLumaTarget = (source, guidance, width, height, detection) => {
  if (!detection) return source
  const quarterPeriod = Math.max(2, Math.round(detection.period / 4))
  let dx = 0
  let dy = 0
  if (detection.orientation === 'vertical') dx = quarterPeriod
  else if (detection.orientation === 'horizontal') dy = quarterPeriod
  else {
    const diagonalStep = Math.max(1, Math.round(quarterPeriod / 2))
    dx = diagonalStep
    dy = detection.orientation === 'diag-down' ? diagonalStep : -diagonalStep
  }

  const output = new Float32Array(source.length)
  const coefficients = [1, 4, 6, 4, 1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = y * width + x
      let weightedSum = 0
      let totalWeight = 0
      for (let tap = -2; tap <= 2; tap++) {
        const sampleX = Math.max(0, Math.min(width - 1, x + tap * dx))
        const sampleY = Math.max(0, Math.min(height - 1, y + tap * dy))
        const sample = sampleY * width + sampleX
        const edgeWeight = Math.exp(-Math.abs(guidance[sample] - guidance[target]) / 16)
        const weight = coefficients[tap + 2] * edgeWeight
        weightedSum += source[sample] * weight
        totalWeight += weight
      }
      output[target] = totalWeight > 1e-5 ? weightedSum / totalWeight : source[target]
    }
  }
  return output
}

const boxBlur1d = (source, radius) => {
  if (radius <= 0) return new Float32Array(source)
  const output = new Float32Array(source.length)
  let sum = 0
  for (let offset = -radius; offset <= radius; offset++) {
    sum += source[Math.max(0, Math.min(source.length - 1, offset))]
  }
  for (let index = 0; index < source.length; index++) {
    output[index] = sum / (radius * 2 + 1)
    const removeIndex = Math.max(0, index - radius)
    const addIndex = Math.min(source.length - 1, index + radius + 1)
    sum += source[addIndex] - source[removeIndex]
  }
  return output
}

const buildBroadDirectionalCorrection = (
  source,
  mask,
  width,
  height,
  detection,
  limit,
) => {
  if (!detection || detection.period < 16 || limit <= 0) return null
  const diagonal = detection.orientation === 'diag-down' || detection.orientation === 'diag-up'
  const length = diagonal
    ? width + height - 1
    : detection.orientation === 'vertical' ? width : height
  const sums = new Float64Array(length)
  const weights = new Float64Array(length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const pixel = row + x
      const weight = mask[pixel]
      if (weight <= 0.05) continue
      const bin = getDirectionalBin(x, y, width, height, detection.orientation)
      sums[bin] += source[pixel] * weight
      weights[bin] += weight
    }
  }

  let first = 0
  let last = length - 1
  while (first < length && weights[first] <= 0.05) first += 1
  while (last >= first && weights[last] <= 0.05) last -= 1
  if (last - first + 1 < detection.period * 1.5) return null

  const profile = new Float32Array(last - first + 1)
  let previous = 0
  let hasPrevious = false
  for (let bin = first; bin <= last; bin++) {
    const target = bin - first
    if (weights[bin] > 0.05) {
      profile[target] = sums[bin] / weights[bin]
      previous = profile[target]
      hasPrevious = true
    } else if (hasPrevious) {
      profile[target] = previous
    }
  }
  for (let index = profile.length - 2; index >= 0; index--) {
    if (!profile[index]) profile[index] = profile[index + 1]
  }

  const waveRadius = Math.max(4, Math.round(detection.period * 0.13))
  const trendRadius = Math.max(waveRadius + 4, Math.round(detection.period * 0.72))
  const waveProfile = boxBlur1d(profile, waveRadius)
  const trendProfile = boxBlur1d(profile, trendRadius)
  const correction = new Float32Array(length)
  for (let index = 0; index < profile.length; index++) {
    correction[first + index] = Math.max(
      -limit,
      Math.min(limit, waveProfile[index] - trendProfile[index]),
    )
  }
  return correction
}

const sampleBilinear = (source, width, height, x, y) => {
  const safeX = Math.max(0, Math.min(width - 1, x))
  const safeY = Math.max(0, Math.min(height - 1, y))
  const left = Math.floor(safeX)
  const top = Math.floor(safeY)
  const right = Math.min(width - 1, left + 1)
  const bottom = Math.min(height - 1, top + 1)
  const mixX = safeX - left
  const mixY = safeY - top
  const topValue = source[top * width + left] * (1 - mixX) +
    source[top * width + right] * mixX
  const bottomValue = source[bottom * width + left] * (1 - mixX) +
    source[bottom * width + right] * mixX
  return topValue * (1 - mixY) + bottomValue * mixY
}

const removeDirectionalSurfaceMean = (
  source,
  weights,
  width,
  height,
  orientation,
) => {
  if (!orientation) return source
  const diagonal = orientation === 'diag-down' || orientation === 'diag-up'
  const length = diagonal
    ? width + height - 1
    : orientation === 'vertical' ? width : height
  const sums = new Float64Array(length)
  const totals = new Float64Array(length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x
      const weight = weights[pixel]
      if (weight <= 1e-4) continue
      const bin = getDirectionalBin(x, y, width, height, orientation)
      sums[bin] += source[pixel] * weight
      totals[bin] += weight
    }
  }
  const means = new Float32Array(length)
  for (let bin = 0; bin < length; bin++) {
    if (totals[bin] > 1e-4) means[bin] = sums[bin] / totals[bin]
  }
  const output = new Float32Array(source.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x
      const bin = getDirectionalBin(x, y, width, height, orientation)
      output[pixel] = source[pixel] - means[bin]
    }
  }
  return output
}

const buildRegionalSurfaceCorrections = (
  luma,
  cb,
  cr,
  mask,
  patternProtection,
  width,
  height,
  options,
) => {
  if (!options.enabled) return null
  const scale = Math.min(1, 420 / Math.max(width, height))
  const coarseWidth = Math.max(32, Math.round(width * scale))
  const coarseHeight = Math.max(32, Math.round(height * scale))
  const coarsePixels = coarseWidth * coarseHeight
  const weights = new Float32Array(coarsePixels)
  const lumaSums = new Float32Array(coarsePixels)
  const cbSums = new Float32Array(coarsePixels)
  const crSums = new Float32Array(coarsePixels)

  for (let y = 0; y < height; y++) {
    const coarseY = Math.min(coarseHeight - 1, Math.floor((y + 0.5) * coarseHeight / height))
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x
      const weight = mask[pixel] * (1 - patternProtection[pixel])
      if (weight <= 0.015) continue
      const coarseX = Math.min(coarseWidth - 1, Math.floor((x + 0.5) * coarseWidth / width))
      const coarsePixel = coarseY * coarseWidth + coarseX
      const chromaScale = Math.max(24, luma[pixel])
      weights[coarsePixel] += weight
      lumaSums[coarsePixel] += luma[pixel] * weight
      cbSums[coarsePixel] += cb[pixel] * chromaScale * weight
      crSums[coarsePixel] += cr[pixel] * chromaScale * weight
    }
  }

  const localRadius = Math.max(2, Math.round(options.localRadius * scale))
  const referenceRadius = Math.max(
    localRadius + 3,
    Math.round(options.referenceRadius * scale),
  )
  const localWeights = boxBlur(weights, coarseWidth, coarseHeight, localRadius)
  const referenceWeights = boxBlur(weights, coarseWidth, coarseHeight, referenceRadius)
  const localLuma = boxBlur(lumaSums, coarseWidth, coarseHeight, localRadius)
  const referenceLuma = boxBlur(lumaSums, coarseWidth, coarseHeight, referenceRadius)
  const localCb = boxBlur(cbSums, coarseWidth, coarseHeight, localRadius)
  const referenceCb = boxBlur(cbSums, coarseWidth, coarseHeight, referenceRadius)
  const localCr = boxBlur(crSums, coarseWidth, coarseHeight, localRadius)
  const referenceCr = boxBlur(crSums, coarseWidth, coarseHeight, referenceRadius)
  const lumaCorrection = new Float32Array(coarsePixels)
  const cbCorrection = new Float32Array(coarsePixels)
  const crCorrection = new Float32Array(coarsePixels)

  for (let pixel = 0; pixel < coarsePixels; pixel++) {
    if (localWeights[pixel] <= 1e-4 || referenceWeights[pixel] <= 1e-4) continue
    const localLumaValue = localLuma[pixel] / localWeights[pixel]
    const referenceLumaValue = referenceLuma[pixel] / referenceWeights[pixel]
    const localCbValue = localCb[pixel] / localWeights[pixel]
    const referenceCbValue = referenceCb[pixel] / referenceWeights[pixel]
    const localCrValue = localCr[pixel] / localWeights[pixel]
    const referenceCrValue = referenceCr[pixel] / referenceWeights[pixel]
    cbCorrection[pixel] = Math.max(
      -options.chromaLimit,
      Math.min(options.chromaLimit, localCbValue - referenceCbValue),
    )
    crCorrection[pixel] = Math.max(
      -options.chromaLimit,
      Math.min(options.chromaLimit, localCrValue - referenceCrValue),
    )
    lumaCorrection[pixel] = Math.max(
      -options.lumaLimit,
      Math.min(options.lumaLimit, localLumaValue - referenceLumaValue),
    )
  }

  return {
    width: coarseWidth,
    height: coarseHeight,
    luma: lumaCorrection,
    cb: cbCorrection,
    cr: crCorrection,
    weights: localWeights,
    scaleX: coarseWidth / width,
    scaleY: coarseHeight / height,
  }
}

const getMaskBounds = (mask, width, height) => {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[(y * width + x) * 4 + 3] <= 2) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  return right >= left ? { left, top, right, bottom } : null
}

// A painted mark is a seed, rather than a request to blur every nearby pixel.
// Ripple analysis needs surrounding fabric, but write-back may only grow into
// nearby, non-pattern pixels after a directional ripple has passed admission.
const buildAnalysisContextMask = (mask, patternProtection, width, height) => {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] <= 0.05) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left) return new Float32Array(mask)

  const selectedWidth = right - left + 1
  const selectedHeight = bottom - top + 1
  const maxDetectablePeriod = Math.min(520, Math.min(width, height) * 0.24)
  const requiredSpan = Math.max(96, Math.round(maxDetectablePeriod * 2))
  const selectionAlreadyProvidesContext = selectedWidth >= requiredSpan &&
    selectedHeight >= requiredSpan

  // Large selections already carry enough evidence.  Keeping their original
  // footprint avoids letting unrelated folds or prints outside the selection
  // change a previously stable detection.
  if (selectionAlreadyProvidesContext) {
    const output = new Float32Array(mask.length)
    for (let pixel = 0; pixel < mask.length; pixel++) {
      output[pixel] = mask[pixel] * (1 - patternProtection[pixel])
    }
    return output
  }

  // The processing ROI already includes a conservative safety padding.  Use
  // that available fabric context for analysis, while excluding printed areas.
  const output = new Float32Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x
      output[pixel] = Math.max(mask[pixel], 1 - patternProtection[pixel])
    }
  }
  return output
}

const buildSeedRepairMask = (
  seedMask,
  analysisMask,
  patternProtection,
  width,
  height,
  maximumDistance,
) => {
  const pixels = width * height
  const distance = new Float32Array(pixels)
  distance.fill(Infinity)
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (seedMask[pixel] > 0.05) distance[pixel] = 0
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x
      let value = distance[pixel]
      if (x > 0) value = Math.min(value, distance[pixel - 1] + 1)
      if (y > 0) value = Math.min(value, distance[pixel - width] + 1)
      distance[pixel] = value
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const pixel = y * width + x
      let value = distance[pixel]
      if (x + 1 < width) value = Math.min(value, distance[pixel + 1] + 1)
      if (y + 1 < height) value = Math.min(value, distance[pixel + width] + 1)
      distance[pixel] = value
    }
  }
  const output = new Float32Array(pixels)
  const feather = Math.max(4, Math.min(18, Math.round(maximumDistance * 0.22)))
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (seedMask[pixel] > 0.05) {
      output[pixel] = seedMask[pixel]
      continue
    }
    if (analysisMask[pixel] < 0.45 || patternProtection[pixel] > 0.52) continue
    const remaining = maximumDistance - distance[pixel]
    if (remaining <= 0) continue
    output[pixel] = clamp01(remaining / feather) *
      clamp01((0.62 - patternProtection[pixel]) / 0.1)
  }
  return output
}

export const applyLocalizedChromaMoireFilter = (imageData, maskImageData, options = {}) => {
  const { data, width, height } = imageData
  if (!maskImageData || maskImageData.width !== width || maskImageData.height !== height) return imageData
  const bounds = getMaskBounds(maskImageData.data, width, height)
  if (!bounds) return imageData

  const minEdge = Math.min(width, height)
  const settings = {
    radius: Math.round(minEdge * 0.07),
    blend: 0.99,
    activityFloor: 0.9,
    smoothIterations: 4,
    rangeSigma: 32,
    // Strong mode must never trade a broad colour/brightness patch for fewer
    // ripples.  Keep the non-periodic directional smoothing modest and use a
    // bounded zero-mean periodic correction for the rest.
    lumaBlend: options.strength === 'strong' ? 0.55 : 0,
    lumaLimit: options.strength === 'strong' ? 5 : 0,
    lumaRangeSigma: 18,
    periodicChromaBlend: 1.05,
    broadChromaBlend: 1,
    broadChromaLimit: 8,
    periodicLumaBlend: options.strength === 'strong' ? 2 : 0,
    periodicLumaLimit: options.strength === 'strong' ? 12 : 3.2,
    // The correction is gated by a reliable chroma period and applied equally
    // to RGB.  A sub-unit blend was quantized away after feathering, making
    // the visible "strong" result byte-identical to standard on real fabric.
    chromaGuidedPeriodicLumaBlend: options.strength === 'strong' ? 3 : 0,
    chromaGuidedPeriodicLumaLimit: options.strength === 'strong' ? 5 : 0,
    broadLumaBlend: 0,
    broadLumaLimit: 0,
    regional: {
      enabled: false,
      localRadius: 52,
      referenceRadius: 280,
      chromaLimit: 10,
      lumaLimit: 8,
      chromaBlend: 0,
      lumaBlend: 0,
    },
  }
  const radius = Math.max(5, Math.min(180, settings.radius))
  const featherRadius = Math.max(4, Math.min(28, Math.round(radius * 0.35)))
  // A tiny seed still needs several wavelength candidates before it can earn
  // an expanded write-back range.  This is analysis-only padding; growth is
  // capped separately below.
  const padding = Math.max(
    radius * 2 + featherRadius,
    Math.round(minEdge * 0.34),
  )
  const left = Math.max(0, bounds.left - padding)
  const top = Math.max(0, bounds.top - padding)
  const right = Math.min(width - 1, bounds.right + padding)
  const bottom = Math.min(height - 1, bounds.bottom + padding)
  const roiWidth = right - left + 1
  const roiHeight = bottom - top + 1
  const pixels = roiWidth * roiHeight

  const luma = new Float32Array(pixels)
  const cb = new Float32Array(pixels)
  const cr = new Float32Array(pixels)
  const mask = new Float32Array(pixels)

  for (let y = 0; y < roiHeight; y++) {
    for (let x = 0; x < roiWidth; x++) {
      const sourcePixel = ((top + y) * width + left + x) * 4
      const target = y * roiWidth + x
      const red = data[sourcePixel]
      const green = data[sourcePixel + 1]
      const blue = data[sourcePixel + 2]
      const yValue = 0.299 * red + 0.587 * green + 0.114 * blue
      const chromaScale = Math.max(24, yValue)
      luma[target] = yValue
      cb[target] = (blue - yValue) / chromaScale
      cr[target] = (red - yValue) / chromaScale
      mask[target] = clamp01(maskImageData.data[sourcePixel + 3] / 158)
    }
  }

  const guidanceRadius = Math.max(2, Math.min(8, Math.round(radius * 0.06)))
  const guidanceLuma = boxBlur(luma, roiWidth, roiHeight, guidanceRadius)
  const textureRadius = 4
  const lumaBase = boxBlur(luma, roiWidth, roiHeight, textureRadius)
  const lumaGuidance = boxBlur(lumaBase, roiWidth, roiHeight, guidanceRadius)
  const patternSeeds = new Float32Array(pixels)
  for (let y = 0; y < roiHeight; y++) {
    for (let x = 0; x < roiWidth; x++) {
      const pixel = y * roiWidth + x
      const leftPixel = y * roiWidth + Math.max(0, x - 1)
      const rightPixel = y * roiWidth + Math.min(roiWidth - 1, x + 1)
      const topPixel = Math.max(0, y - 1) * roiWidth + x
      const bottomPixel = Math.min(roiHeight - 1, y + 1) * roiWidth + x
      const chromaScale = Math.max(24, luma[pixel])
      const chromaMagnitude = Math.hypot(cb[pixel], cr[pixel]) * chromaScale
      const chromaDetail = (
        Math.hypot(cb[pixel] - cb[leftPixel], cr[pixel] - cr[leftPixel]) +
        Math.hypot(cb[pixel] - cb[rightPixel], cr[pixel] - cr[rightPixel]) +
        Math.hypot(cb[pixel] - cb[topPixel], cr[pixel] - cr[topPixel]) +
        Math.hypot(cb[pixel] - cb[bottomPixel], cr[pixel] - cr[bottomPixel])
      ) * chromaScale / 4
      const saturatedColor = clamp01((chromaMagnitude - 38) / 26)
      const darkColor = clamp01((112 - luma[pixel]) / 42) *
        clamp01((chromaMagnitude - 16) / 22)
      const printedEdge = clamp01((chromaDetail - 2.5) / 10) *
        clamp01((chromaMagnitude - 12) / 20)
      patternSeeds[pixel] = Math.max(saturatedColor, darkColor, printedEdge)
    }
  }
  const patternSpreadRadius = Math.max(3, Math.min(12, Math.round(radius * 0.07)))
  const spreadPattern = boxBlur(
    patternSeeds, roiWidth, roiHeight, patternSpreadRadius,
  )
  for (let pixel = 0; pixel < pixels; pixel++) {
    const spreadProtection = clamp01((spreadPattern[pixel] - 0.06) / 0.28) * 0.9
    patternSeeds[pixel] = Math.max(patternSeeds[pixel], spreadProtection)
    spreadPattern[pixel] = mask[pixel] * (1 - patternSeeds[pixel])
  }
  const patternProtection = patternSeeds
  const regionalPatternProtection = new Float32Array(pixels)
  for (let pixel = 0; pixel < pixels; pixel++) {
    // Regional harmonization targets broad fabric colour bands. Only the most
    // certain printed details stay protected here so ordinary woven texture
    // does not suppress the correction twice.
    regionalPatternProtection[pixel] = clamp01(
      (patternProtection[pixel] - 0.72) / 0.18,
    )
  }
  const moireAnalysisMask = buildAnalysisContextMask(
    mask, patternProtection, roiWidth, roiHeight,
  )
  const chromaValidity = new Float32Array(pixels)
  const weightedCb = new Float32Array(pixels)
  const weightedCr = new Float32Array(pixels)
  for (let pixel = 0; pixel < pixels; pixel++) {
    const validity = Math.max(0.015, 1 - patternProtection[pixel])
    chromaValidity[pixel] = validity
    weightedCb[pixel] = cb[pixel] * validity
    weightedCr[pixel] = cr[pixel] * validity
  }
  const blurredWeightedChroma = edgeAwareSmoothPair(
    weightedCb,
    weightedCr,
    guidanceLuma,
    roiWidth,
    roiHeight,
    radius,
    settings.rangeSigma,
    settings.smoothIterations,
  )
  const blurredValidity = edgeAwareSmooth(
    chromaValidity,
    guidanceLuma,
    roiWidth,
    roiHeight,
    radius,
    settings.rangeSigma,
    settings.smoothIterations,
  )
  const blurredCb = new Float32Array(pixels)
  const blurredCr = new Float32Array(pixels)
  for (let pixel = 0; pixel < pixels; pixel++) {
    const validity = Math.max(0.015, blurredValidity[pixel])
    blurredCb[pixel] = blurredWeightedChroma.first[pixel] / validity
    blurredCr[pixel] = blurredWeightedChroma.second[pixel] / validity
  }
  const lumaRippleCandidates = detectDirectionalRipples(
    lumaBase, mask, roiWidth, roiHeight,
  ).filter(detection => detection.confidence >= 0.24)
  let reliableDirectionalRipple = null
  let periodicLumaCorrection = null
  let reliableLumaStrength = 0
  for (const candidate of lumaRippleCandidates) {
    // Real fabric sits close to the admission threshold; a clean synthetic
    // ripple has much higher confidence.  Ramp correction only after that
    // threshold rather than giving both the same large luma swing.
    const confidenceStrength = clamp01((candidate.confidence - 0.3) / 0.4)
    const correction = fitDirectionalPeriodicCorrection(
      lumaBase, moireAnalysisMask, roiWidth, roiHeight,
      candidate,
      0.55,
      4 + (settings.periodicLumaLimit - 4) * confidenceStrength,
    )
    if (!correction) continue
    reliableDirectionalRipple = candidate
    periodicLumaCorrection = correction
    reliableLumaStrength = confidenceStrength
    break
  }
  const broadLumaCorrection = null
  const repairedLumaBase = lumaBase
  const directionalLumaBase = buildDirectionalLumaTarget(
    lumaBase, lumaGuidance, roiWidth, roiHeight, reliableDirectionalRipple,
  )
  const cbSignal = new Float32Array(pixels)
  const crSignal = new Float32Array(pixels)
  for (let pixel = 0; pixel < pixels; pixel++) {
    const scale = Math.max(24, lumaBase[pixel])
    cbSignal[pixel] = blurredCb[pixel] * scale
    crSignal[pixel] = blurredCr[pixel] * scale
  }
  const chromaRippleCandidates = [
    ...detectDirectionalRipples(cbSignal, moireAnalysisMask, roiWidth, roiHeight),
    ...detectDirectionalRipples(crSignal, moireAnalysisMask, roiWidth, roiHeight),
  ]
    .filter(detection => detection.confidence >= 0.1)
    .sort((first, second) => (
      second.confidence * Math.sqrt(second.variance) -
      first.confidence * Math.sqrt(first.variance)
    ))
  let chromaRipple = null
  let periodicCbCorrection = null
  let periodicCrCorrection = null
  for (const candidate of chromaRippleCandidates) {
    const cbCorrection = fitDirectionalPeriodicCorrection(
      cbSignal, moireAnalysisMask, roiWidth, roiHeight, candidate, 0.35, 5,
    )
    const crCorrection = fitDirectionalPeriodicCorrection(
      crSignal, moireAnalysisMask, roiWidth, roiHeight, candidate, 0.35, 5,
    )
    if (!cbCorrection && !crCorrection) continue
    chromaRipple = candidate
    periodicCbCorrection = cbCorrection
    periodicCrCorrection = crCorrection
    break
  }
  if (options.diagnostics) {
    options.diagnostics.lumaCandidates = lumaRippleCandidates
    options.diagnostics.chromaCandidates = chromaRippleCandidates
    options.diagnostics.selectedLuma = reliableDirectionalRipple
    options.diagnostics.selectedChroma = chromaRipple
  }
  const broadChromaRipple = chromaRipple || reliableDirectionalRipple
  const chromaGuidedLumaRipple = (
    options.strength === 'strong' &&
    !reliableDirectionalRipple &&
    chromaRipple?.confidence >= 0.18 &&
    chromaRipple.periodicCorrelation >= 0.4
  ) ? chromaRipple : null
  // A chroma match is enough to propose the period, but not enough to justify
  // broad luma smoothing: fabric folds can share the same direction.  Fit only
  // the zero-mean periodic component and cap it tightly in this fallback.
  const chromaGuidedPeriodicLumaCorrection = chromaGuidedLumaRipple
    ? fitDirectionalPeriodicCorrection(
        lumaBase,
        moireAnalysisMask,
        roiWidth,
        roiHeight,
        chromaGuidedLumaRipple,
        0.7,
        settings.chromaGuidedPeriodicLumaLimit,
      )
    : null
  const lumaCorrectionRipple = reliableDirectionalRipple || (
    chromaGuidedPeriodicLumaCorrection ? chromaGuidedLumaRipple : null
  )
  const effectiveDirectionalLumaBase = directionalLumaBase
  const effectiveBroadLumaCorrection = broadLumaCorrection
  const effectivePeriodicLumaCorrection = periodicLumaCorrection ||
    chromaGuidedPeriodicLumaCorrection
  const repairEvidence = reliableDirectionalRipple || chromaRipple
  const canGrowRepairMask = Boolean(
    repairEvidence &&
    repairEvidence.confidence >= 0.24 &&
    repairEvidence.periodicCorrelation >= 0.38,
  )
  // Keep growth local to the seed.  The period only chooses a conservative
  // upper bound; it never authorizes an unbounded ROI-wide correction.
  const repairMask = canGrowRepairMask
    ? buildSeedRepairMask(
        mask,
        moireAnalysisMask,
        patternProtection,
        roiWidth,
        roiHeight,
        Math.min(padding * 0.82, Math.max(radius * 1.2, repairEvidence.period * 0.16)),
      )
    : mask
  if (options.diagnostics) {
    options.diagnostics.selectedLumaGuide = lumaCorrectionRipple
    options.diagnostics.lumaGuideSource = chromaGuidedLumaRipple
      ? 'chroma'
      : reliableDirectionalRipple ? 'luma' : null
    options.diagnostics.analysisMaskPixels = moireAnalysisMask.reduce(
      (total, value) => total + (value > 0.05 ? 1 : 0),
      0,
    )
    options.diagnostics.seedMaskPixels = mask.reduce(
      (total, value) => total + (value > 0.05 ? 1 : 0),
      0,
    )
    options.diagnostics.repairMaskPixels = repairMask.reduce(
      (total, value) => total + (value > 0.05 ? 1 : 0),
      0,
    )
    options.diagnostics.repairMaskExpanded = canGrowRepairMask
  }
  const broadCbCorrection = buildBroadDirectionalCorrection(
    cbSignal,
    moireAnalysisMask,
    roiWidth,
    roiHeight,
    broadChromaRipple,
    settings.broadChromaLimit,
  )
  const broadCrCorrection = buildBroadDirectionalCorrection(
    crSignal,
    moireAnalysisMask,
    roiWidth,
    roiHeight,
    broadChromaRipple,
    settings.broadChromaLimit,
  )
  const regionalCorrections = buildRegionalSurfaceCorrections(
    lumaBase,
    cb,
    cr,
    mask,
    regionalPatternProtection,
    roiWidth,
    roiHeight,
    settings.regional,
  )
  if (regionalCorrections && broadChromaRipple) {
    regionalCorrections.cb = removeDirectionalSurfaceMean(
      regionalCorrections.cb,
      regionalCorrections.weights,
      regionalCorrections.width,
      regionalCorrections.height,
      broadChromaRipple.orientation,
    )
    regionalCorrections.cr = removeDirectionalSurfaceMean(
      regionalCorrections.cr,
      regionalCorrections.weights,
      regionalCorrections.width,
      regionalCorrections.height,
      broadChromaRipple.orientation,
    )
  }
  const featheredMask = boxBlur(repairMask, roiWidth, roiHeight, featherRadius)
  const output = new Uint8ClampedArray(data)

  for (let y = 0; y < roiHeight; y++) {
    for (let x = 0; x < roiWidth; x++) {
      const target = y * roiWidth + x
      if (repairMask[target] <= 0.003 || featheredMask[target] <= 0.003) continue
      const leftPixel = y * roiWidth + Math.max(0, x - 1)
      const rightPixel = y * roiWidth + Math.min(roiWidth - 1, x + 1)
      const topPixel = Math.max(0, y - 1) * roiWidth + x
      const bottomPixel = Math.min(roiHeight - 1, y + 1) * roiWidth + x
      const lumaGradient = (
        Math.abs(luma[leftPixel] - luma[rightPixel]) +
        Math.abs(luma[topPixel] - luma[bottomPixel])
      )
      const edgeProtection = clamp01((lumaGradient - 16) / 54) * 0.92
      const chromaDeviation = Math.hypot(
        cb[target] - blurredCb[target],
        cr[target] - blurredCr[target],
      )
      const activity = settings.activityFloor +
        (1 - settings.activityFloor) * clamp01((chromaDeviation - 0.004) / 0.055)
      const chromaMagnitude = Math.hypot(cb[target], cr[target]) * Math.max(24, luma[target])
      const printProtection = Math.max(
        clamp01((chromaMagnitude - 44) / 34) * 0.995,
        patternProtection[target] * 0.995,
      )
      const blend = settings.blend * featheredMask[target] * activity *
        (1 - edgeProtection) * (1 - printProtection)
      const directionalBin = chromaRipple
        ? getDirectionalBin(x, y, roiWidth, roiHeight, chromaRipple.orientation)
        : 0
      const signalScale = Math.max(24, lumaBase[target])
      const periodicChromaProtection = (1 - edgeProtection) * (1 - printProtection)
      const periodicChromaStrength = settings.periodicChromaBlend *
        featheredMask[target] * periodicChromaProtection
      const broadChromaBin = broadChromaRipple
        ? getDirectionalBin(x, y, roiWidth, roiHeight, broadChromaRipple.orientation)
        : 0
      const broadChromaStrength = settings.broadChromaBlend *
        featheredMask[target] * periodicChromaProtection
      const regionalX = regionalCorrections
        ? (x + 0.5) * regionalCorrections.scaleX - 0.5
        : 0
      const regionalY = regionalCorrections
        ? (y + 0.5) * regionalCorrections.scaleY - 0.5
        : 0
      const regionalCb = regionalCorrections
        ? sampleBilinear(
            regionalCorrections.cb,
            regionalCorrections.width,
            regionalCorrections.height,
            regionalX,
            regionalY,
          )
        : 0
      const regionalCr = regionalCorrections
        ? sampleBilinear(
            regionalCorrections.cr,
            regionalCorrections.width,
            regionalCorrections.height,
            regionalX,
            regionalY,
          )
        : 0
      const regionalLuma = regionalCorrections
        ? sampleBilinear(
            regionalCorrections.luma,
            regionalCorrections.width,
            regionalCorrections.height,
            regionalX,
            regionalY,
          )
        : 0
      const regionalChromaActivity = clamp01(
        (Math.hypot(regionalCb, regionalCr) - 0.35) / 1.8,
      )
      const regionalLumaActivity = regionalChromaActivity * 0.72
      const regionalPrintProtection = Math.max(
        clamp01((chromaMagnitude - 52) / 18) * 0.995,
        regionalPatternProtection[target] * 0.995,
      )
      const regionalProtection = (1 - edgeProtection) *
        (1 - regionalPrintProtection)
      const regionalChromaStrength = settings.regional.chromaBlend *
        regionalChromaActivity * featheredMask[target] * regionalProtection
      const repairedCb = blurredCb[target] - (
        periodicCbCorrection?.values[directionalBin] || 0
      ) / signalScale * periodicChromaStrength - (
        broadCbCorrection?.[broadChromaBin] || 0
      ) / signalScale * broadChromaStrength
      const repairedCr = blurredCr[target] - (
        periodicCrCorrection?.values[directionalBin] || 0
      ) / signalScale * periodicChromaStrength - (
        broadCrCorrection?.[broadChromaBin] || 0
      ) / signalScale * broadChromaStrength
      const baseGradient = (
        Math.abs(lumaBase[leftPixel] - lumaBase[rightPixel]) +
        Math.abs(lumaBase[topPixel] - lumaBase[bottomPixel])
      )
      const isotropicLumaDelta = reliableDirectionalRipple
        ? (repairedLumaBase[target] - lumaBase[target]) *
          (0.25 + 0.35 * lumaCorrectionRipple.confidence)
        : 0
      const directionalLumaDelta = reliableDirectionalRipple
        ? (effectiveDirectionalLumaBase[target] - lumaBase[target]) *
          (0.48 + 0.24 * lumaCorrectionRipple.confidence)
        : 0
      const lumaDelta = isotropicLumaDelta + directionalLumaDelta
      const lumaStructureProtection = clamp01((Math.abs(lumaDelta) - 9) / 18) * 0.98
      const lumaGradientProtection = clamp01((baseGradient - 4) / 20) * 0.92
      const lumaBlend = settings.lumaBlend * featheredMask[target] *
        (1 - printProtection) * (1 - lumaStructureProtection) * (1 - lumaGradientProtection)
      const boundedLumaDelta = Math.max(-settings.lumaLimit, Math.min(settings.lumaLimit, lumaDelta))
      const lumaDirectionalBin = lumaCorrectionRipple
        ? getDirectionalBin(x, y, roiWidth, roiHeight, lumaCorrectionRipple.orientation)
        : 0
      const periodicLumaDelta = -(effectivePeriodicLumaCorrection?.values[lumaDirectionalBin] || 0)
      const periodicLumaBlend = reliableDirectionalRipple
        ? 0.82 + (settings.periodicLumaBlend - 0.82) * reliableLumaStrength
        : settings.chromaGuidedPeriodicLumaBlend
      const periodicLumaProtection = (1 - printProtection) *
        (1 - clamp01((baseGradient - 5) / 24))
      const regionalLumaProtection = (1 - regionalPrintProtection) *
        (1 - clamp01((baseGradient - 5) / 24))
      const broadLumaDelta = -(effectiveBroadLumaCorrection?.[lumaDirectionalBin] || 0)
      const regionalLumaDelta = -regionalLuma * settings.regional.lumaBlend *
        regionalLumaActivity * featheredMask[target] * regionalLumaProtection
      const nextLuma = luma[target] + boundedLumaDelta * lumaBlend +
        periodicLumaDelta * periodicLumaBlend * featheredMask[target] *
        periodicLumaProtection +
        broadLumaDelta * settings.broadLumaBlend * featheredMask[target] *
        periodicLumaProtection + regionalLumaDelta
      if (
        blend <= 0.003 &&
        regionalChromaStrength <= 0.003 &&
        Math.abs(nextLuma - luma[target]) <= 0.003
      ) continue

      const nextCb = cb[target] + (repairedCb - cb[target]) * blend -
        regionalCb / signalScale * regionalChromaStrength
      const nextCr = cr[target] + (repairedCr - cr[target]) * blend -
        regionalCr / signalScale * regionalChromaStrength
      const chromaScale = Math.max(24, luma[target])
      const redDelta = nextCr * chromaScale
      const blueDelta = nextCb * chromaScale
      const greenDelta = (-0.299 * redDelta - 0.114 * blueDelta) / 0.587
      const gamutScale = fitChromaToGamut(luma[target], redDelta, greenDelta, blueDelta)
      const baseRed = Math.round(luma[target] + redDelta * gamutScale)
      const baseGreen = Math.round(luma[target] + greenDelta * gamutScale)
      const baseBlue = Math.round(luma[target] + blueDelta * gamutScale)
      const requestedLumaShift = Math.round(nextLuma - luma[target])
      const safeLumaShift = Math.max(
        -Math.min(baseRed, baseGreen, baseBlue),
        Math.min(255 - Math.max(baseRed, baseGreen, baseBlue), requestedLumaShift),
      )
      const nextRed = baseRed + safeLumaShift
      const nextGreen = baseGreen + safeLumaShift
      const nextBlue = baseBlue + safeLumaShift
      const sourcePixel = ((top + y) * width + left + x) * 4
      output[sourcePixel] = Math.max(0, Math.min(255, Math.round(nextRed)))
      output[sourcePixel + 1] = Math.max(0, Math.min(255, Math.round(nextGreen)))
      output[sourcePixel + 2] = Math.max(0, Math.min(255, Math.round(nextBlue)))
    }
  }
  return createImageData(output, width, height)
}

const compatibleRipples = (first, second) => (
  first && second &&
  first.orientation === second.orientation &&
  Math.max(first.period, second.period) / Math.max(1, Math.min(first.period, second.period)) <= 1.28
)

const chooseAutomaticTileRipple = (lumaCandidates, cbCandidates, crCandidates) => {
  let best = null
  for (const cbCandidate of cbCandidates) {
    for (const crCandidate of crCandidates) {
      if (!compatibleRipples(cbCandidate, crCandidate)) continue
      const averageConfidence = (cbCandidate.confidence + crCandidate.confidence) / 2
      const minimumCorrelation = Math.min(
        cbCandidate.periodicCorrelation,
        crCandidate.periodicCorrelation,
      )
      let score = clamp01((averageConfidence - 0.12) / 0.45) * 0.55 +
        clamp01((minimumCorrelation - 0.3) / 0.35) * 0.45
      const matchingLuma = lumaCandidates.find(candidate => (
        compatibleRipples(candidate, cbCandidate)
      ))
      if (matchingLuma) score = Math.min(1, score + matchingLuma.confidence * 0.18)
      const candidate = {
        orientation: cbCandidate.orientation,
        period: (cbCandidate.period + crCandidate.period) / 2,
        confidence: score,
        channels: matchingLuma ? 3 : 2,
        rawConfidence: averageConfidence,
        periodicCorrelation: minimumCorrelation,
      }
      if (!best || candidate.confidence > best.confidence) best = candidate
    }
  }

  const allCandidates = [
    ...cbCandidates.map(candidate => ({ ...candidate, channel: 'cb' })),
    ...crCandidates.map(candidate => ({ ...candidate, channel: 'cr' })),
    ...lumaCandidates.map(candidate => ({ ...candidate, channel: 'luma' })),
  ]
  for (const ripple of allCandidates) {
    const lumaCandidate = ripple.channel === 'luma'
    const strongEnough = ripple.confidence >= (lumaCandidate ? 0.68 : 0.72) &&
      ripple.periodicCorrelation >= (lumaCandidate ? 0.58 : 0.6) &&
      ripple.concentration >= 0.18 &&
      ripple.prominence >= 6 &&
      ripple.variance >= (lumaCandidate ? 0.7 : 0.45)
    if (!strongEnough) continue
    const score = clamp01(
      (ripple.confidence - (lumaCandidate ? 0.62 : 0.66)) / 0.34,
    ) * (lumaCandidate ? 0.78 : 0.85)
    const candidate = {
      orientation: ripple.orientation,
      period: ripple.period,
      confidence: score,
      channels: 1,
      rawConfidence: ripple.confidence,
      periodicCorrelation: ripple.periodicCorrelation,
    }
    if (!best || candidate.confidence > best.confidence) best = candidate
  }
  return best
}

const buildAutomaticAnalysisPlanes = (imageData, maximumEdge) => {
  const { data, width, height } = imageData
  const scale = Math.min(1, maximumEdge / Math.max(width, height))
  const analysisWidth = Math.max(96, Math.round(width * scale))
  const analysisHeight = Math.max(96, Math.round(height * scale))
  const pixels = analysisWidth * analysisHeight
  const luma = new Float32Array(pixels)
  const cb = new Float32Array(pixels)
  const cr = new Float32Array(pixels)
  const scaleX = width / analysisWidth
  const scaleY = height / analysisHeight

  for (let y = 0; y < analysisHeight; y++) {
    for (let x = 0; x < analysisWidth; x++) {
      let red = 0
      let green = 0
      let blue = 0
      for (const offsetY of [0.3, 0.7]) {
        for (const offsetX of [0.3, 0.7]) {
          const sourceX = Math.min(width - 1, Math.floor((x + offsetX) * scaleX))
          const sourceY = Math.min(height - 1, Math.floor((y + offsetY) * scaleY))
          const source = (sourceY * width + sourceX) * 4
          red += data[source]
          green += data[source + 1]
          blue += data[source + 2]
        }
      }
      red /= 4
      green /= 4
      blue /= 4
      const target = y * analysisWidth + x
      const yValue = 0.299 * red + 0.587 * green + 0.114 * blue
      luma[target] = yValue
      cb[target] = blue - yValue
      cr[target] = red - yValue
    }
  }

  const mask = new Float32Array(pixels)
  for (let y = 0; y < analysisHeight; y++) {
    for (let x = 0; x < analysisWidth; x++) {
      const pixel = y * analysisWidth + x
      const leftPixel = y * analysisWidth + Math.max(0, x - 1)
      const rightPixel = y * analysisWidth + Math.min(analysisWidth - 1, x + 1)
      const topPixel = Math.max(0, y - 1) * analysisWidth + x
      const bottomPixel = Math.min(analysisHeight - 1, y + 1) * analysisWidth + x
      const chromaMagnitude = Math.hypot(cb[pixel], cr[pixel])
      const chromaDetail = (
        Math.hypot(cb[pixel] - cb[leftPixel], cr[pixel] - cr[leftPixel]) +
        Math.hypot(cb[pixel] - cb[rightPixel], cr[pixel] - cr[rightPixel]) +
        Math.hypot(cb[pixel] - cb[topPixel], cr[pixel] - cr[topPixel]) +
        Math.hypot(cb[pixel] - cb[bottomPixel], cr[pixel] - cr[bottomPixel])
      ) / 4
      const saturatedColor = clamp01((chromaMagnitude - 38) / 26)
      const darkColor = clamp01((112 - luma[pixel]) / 42) *
        clamp01((chromaMagnitude - 16) / 22)
      const printedEdge = clamp01((chromaDetail - 2.5) / 10) *
        clamp01((chromaMagnitude - 12) / 20)
      mask[pixel] = 1 - Math.max(saturatedColor, darkColor, printedEdge)
    }
  }

  return {
    luma: boxBlur(luma, analysisWidth, analysisHeight, 2),
    cb,
    cr,
    mask,
    width: analysisWidth,
    height: analysisHeight,
  }
}

const extractAutomaticPlaneTile = (source, planeWidth, bounds) => {
  const tileWidth = bounds.right - bounds.left
  const tileHeight = bounds.bottom - bounds.top
  const tile = new Float32Array(tileWidth * tileHeight)
  for (let y = 0; y < tileHeight; y++) {
    const sourceStart = (bounds.top + y) * planeWidth + bounds.left
    tile.set(source.subarray(sourceStart, sourceStart + tileWidth), y * tileWidth)
  }
  return tile
}

const detectAutomaticTile = (planes, bounds) => {
  const tileWidth = bounds.right - bounds.left
  const tileHeight = bounds.bottom - bounds.top
  if (tileWidth < 80 || tileHeight < 80) return null
  const tileMask = extractAutomaticPlaneTile(planes.mask, planes.width, bounds)
  let usableWeight = 0
  for (let pixel = 0; pixel < tileMask.length; pixel++) usableWeight += tileMask[pixel]
  if (usableWeight / tileMask.length < 0.42) return null
  const periodLimits = {
    minPeriod: Math.max(12, Math.round(Math.min(tileWidth, tileHeight) * 0.075)),
    maxPeriod: Math.floor(Math.min(tileWidth, tileHeight) * 0.46),
  }
  const tileLuma = extractAutomaticPlaneTile(planes.luma, planes.width, bounds)
  const tileCb = extractAutomaticPlaneTile(planes.cb, planes.width, bounds)
  const tileCr = extractAutomaticPlaneTile(planes.cr, planes.width, bounds)
  return chooseAutomaticTileRipple(
    detectDirectionalRipples(tileLuma, tileMask, tileWidth, tileHeight, periodLimits),
    detectDirectionalRipples(tileCb, tileMask, tileWidth, tileHeight, periodLimits),
    detectDirectionalRipples(tileCr, tileMask, tileWidth, tileHeight, periodLimits),
  )
}

export const createAutomaticLocalizedMoireMask = imageData => {
  const { data, width, height } = imageData
  if (!data || width < 96 || height < 96) {
    return {
      maskImageData: null,
      diagnostics: {
        detectedTiles: 0,
        coarseCandidateTiles: 0,
        totalTiles: 0,
        maskCoverage: 0,
        coarseWidth: width || 0,
        coarseHeight: height || 0,
        fineWidth: width || 0,
        fineHeight: height || 0,
      },
    }
  }

  const coarse = buildAutomaticAnalysisPlanes(imageData, 540)
  const cellSize = Math.max(
    64,
    Math.min(88, Math.round(Math.min(coarse.width, coarse.height) * 0.16)),
  )
  const columns = Math.ceil(coarse.width / cellSize)
  const rows = Math.ceil(coarse.height / cellSize)
  const totalTiles = rows * columns
  const coarseCandidates = []
  const coarsePadding = Math.round(cellSize * 0.58)

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const coreLeft = column * cellSize
      const coreTop = row * cellSize
      const coreRight = Math.min(coarse.width, coreLeft + cellSize)
      const coreBottom = Math.min(coarse.height, coreTop + cellSize)
      const bounds = {
        left: Math.max(0, coreLeft - coarsePadding),
        top: Math.max(0, coreTop - coarsePadding),
        right: Math.min(coarse.width, coreRight + coarsePadding),
        bottom: Math.min(coarse.height, coreBottom + coarsePadding),
      }
      const detection = detectAutomaticTile(coarse, bounds)
      if (!detection) continue
      if (detection.confidence < 0.16 && detection.rawConfidence < 0.65) continue
      coarseCandidates.push({ row, column, detection })
    }
  }

  if (coarseCandidates.length === 0) {
    return {
      maskImageData: null,
      diagnostics: {
        detectedTiles: 0,
        coarseCandidateTiles: 0,
        totalTiles,
        maskCoverage: 0,
        coarseWidth: coarse.width,
        coarseHeight: coarse.height,
        fineWidth: 0,
        fineHeight: 0,
      },
    }
  }

  const fine = buildAutomaticAnalysisPlanes(imageData, 900)
  const cells = new Array(totalTiles).fill(null)
  for (const candidate of coarseCandidates) {
    const coreLeft = Math.floor(candidate.column * cellSize / coarse.width * fine.width)
    const coreTop = Math.floor(candidate.row * cellSize / coarse.height * fine.height)
    const coreRight = Math.min(
      fine.width,
      Math.ceil(Math.min(coarse.width, (candidate.column + 1) * cellSize) / coarse.width * fine.width),
    )
    const coreBottom = Math.min(
      fine.height,
      Math.ceil(Math.min(coarse.height, (candidate.row + 1) * cellSize) / coarse.height * fine.height),
    )
    const paddingX = Math.round((coreRight - coreLeft) * 0.58)
    const paddingY = Math.round((coreBottom - coreTop) * 0.58)
    const bounds = {
      left: Math.max(0, coreLeft - paddingX),
      top: Math.max(0, coreTop - paddingY),
      right: Math.min(fine.width, coreRight + paddingX),
      bottom: Math.min(fine.height, coreBottom + paddingY),
    }
    cells[candidate.row * columns + candidate.column] = detectAutomaticTile(fine, bounds)
  }

  const compatibleNeighbor = (row, column, detection) => {
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        if (offsetX === 0 && offsetY === 0) continue
        const neighborRow = row + offsetY
        const neighborColumn = column + offsetX
        if (neighborRow < 0 || neighborRow >= rows ||
          neighborColumn < 0 || neighborColumn >= columns) continue
        const neighbor = cells[neighborRow * columns + neighborColumn]
        if (neighbor && neighbor.confidence >= 0.38 && compatibleRipples(detection, neighbor)) return true
      }
    }
    return false
  }

  const accepted = new Uint8Array(totalTiles)
  let detectedTiles = 0
  for (const candidate of coarseCandidates) {
    const index = candidate.row * columns + candidate.column
    const detection = cells[index]
    if (!detection) continue
    const keep = detection.confidence >= 0.38 &&
      compatibleNeighbor(candidate.row, candidate.column, detection)
    if (!keep) continue
    accepted[index] = 1
    detectedTiles += 1
  }

  if (detectedTiles === 0) {
    return {
      maskImageData: null,
      diagnostics: {
        detectedTiles,
        coarseCandidateTiles: coarseCandidates.length,
        totalTiles,
        maskCoverage: 0,
        coarseWidth: coarse.width,
        coarseHeight: coarse.height,
        fineWidth: fine.width,
        fineHeight: fine.height,
      },
    }
  }

  const maskData = new Uint8ClampedArray(width * height * 4)
  let maskedPixels = 0
  for (let y = 0; y < height; y++) {
    const coarseY = Math.min(coarse.height - 1, Math.floor(y * coarse.height / height))
    const row = Math.min(rows - 1, Math.floor(coarseY / cellSize))
    for (let x = 0; x < width; x++) {
      const coarseX = Math.min(coarse.width - 1, Math.floor(x * coarse.width / width))
      const column = Math.min(columns - 1, Math.floor(coarseX / cellSize))
      if (!accepted[row * columns + column]) continue
      maskData[(y * width + x) * 4 + 3] = 255
      maskedPixels += 1
    }
  }

  return {
    maskImageData: createImageData(maskData, width, height),
    diagnostics: {
      detectedTiles,
      coarseCandidateTiles: coarseCandidates.length,
      totalTiles,
      maskCoverage: maskedPixels / (width * height),
      coarseWidth: coarse.width,
      coarseHeight: coarse.height,
      fineWidth: fine.width,
      fineHeight: fine.height,
    },
  }
}

export const analyzeDirectionalRippleForTest = (imageData, maskImageData) => {
  const { data, width, height } = imageData
  if (!maskImageData || maskImageData.width !== width || maskImageData.height !== height) return null
  const luma = new Float32Array(width * height)
  const mask = new Float32Array(width * height)
  for (let pixel = 0; pixel < luma.length; pixel++) {
    const source = pixel * 4
    luma[pixel] = 0.299 * data[source] + 0.587 * data[source + 1] + 0.114 * data[source + 2]
    mask[pixel] = clamp01(maskImageData.data[source + 3] / 158)
  }
  return detectDirectionalRipple(boxBlur(luma, width, height, 4), mask, width, height)
}

export const analyzeDirectionalRippleCandidatesForTest = (
  imageData,
  maskImageData,
  periodLimits = null,
) => {
  const { data, width, height } = imageData
  if (!maskImageData || maskImageData.width !== width || maskImageData.height !== height) return []
  const luma = new Float32Array(width * height)
  const mask = new Float32Array(width * height)
  for (let pixel = 0; pixel < luma.length; pixel++) {
    const source = pixel * 4
    luma[pixel] = 0.299 * data[source] + 0.587 * data[source + 1] + 0.114 * data[source + 2]
    mask[pixel] = clamp01(maskImageData.data[source + 3] / 158)
  }
  return detectDirectionalRipples(
    boxBlur(luma, width, height, 4),
    mask,
    width,
    height,
    periodLimits,
    true,
  )
}
