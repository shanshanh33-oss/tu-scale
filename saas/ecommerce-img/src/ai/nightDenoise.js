const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const clamp01 = value => clamp(value, 0, 1)

const getLuma = (data, offset) => (
  data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
)

const getChroma = (data, offset, luma) => ({
  cb: data[offset + 2] - luma,
  cr: data[offset] - luma,
})

const getDirectionalScaleCoherence = (fineGradient, coarseGradient) => {
  if (fineGradient * coarseGradient <= 0) return 0
  const fineMagnitude = Math.abs(fineGradient)
  const coarseMagnitude = Math.abs(coarseGradient) * 0.5
  return Math.min(fineMagnitude, coarseMagnitude)
    / Math.max(0.0001, fineMagnitude, coarseMagnitude)
}

const histogramPercentile = (histogram, sampleCount, percentile) => {
  if (sampleCount <= 0) return 0
  const target = Math.max(1, Math.ceil(sampleCount * percentile))
  let seen = 0
  for (let value = 0; value < histogram.length; value++) {
    seen += histogram[value]
    if (seen >= target) return value
  }
  return histogram.length - 1
}

const createResultImageData = (data, width, height) => {
  if (typeof ImageData === 'function') return new ImageData(data, width, height)
  return { data, width, height }
}

export const getNightDenoisePassStrengths = strength => {
  const normalized = clamp(strength ?? 0.75, 0.35, 1)
  if (normalized < 0.6) return [normalized]
  const secondPass = clamp((normalized - 0.3) / 0.7, 0.45, 1)
  return [normalized, secondPass]
}

/**
 * Estimate fine-grained noise from dark, locally-flat parts of an image.
 * The returned values are high-pass residuals in 8-bit pixel units.
 */
export const estimateNightNoise = imageData => {
  const { data, width, height } = imageData
  if (!data || width < 5 || height < 5) {
    return {
      lumaNoise: 0,
      chromaNoise: 0,
      fineLumaNoise: 0,
      coarseLumaNoise: 0,
      fineChromaNoise: 0,
      coarseChromaNoise: 0,
      sampleCount: 0,
      coarseSampleCount: 0,
    }
  }

  const lumaHistogram = new Uint32Array(65)
  const chromaHistogram = new Uint32Array(65)
  const coarseLumaHistogram = new Uint32Array(65)
  const coarseChromaHistogram = new Uint32Array(65)
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / 250_000)))
  let sampleCount = 0
  let coarseSampleCount = 0

  for (let y = 2; y < height - 2; y += stride) {
    for (let x = 2; x < width - 2; x += stride) {
      const centerOffset = (y * width + x) * 4
      if (data[centerOffset + 3] === 0) continue

      const leftOffset = centerOffset - 4
      const rightOffset = centerOffset + 4
      const topOffset = centerOffset - width * 4
      const bottomOffset = centerOffset + width * 4
      const centerLuma = getLuma(data, centerOffset)
      if (centerLuma > 210) continue

      const leftLuma = getLuma(data, leftOffset)
      const rightLuma = getLuma(data, rightOffset)
      const topLuma = getLuma(data, topOffset)
      const bottomLuma = getLuma(data, bottomOffset)
      const localMin = Math.min(leftLuma, rightLuma, topLuma, bottomLuma)
      const localMax = Math.max(leftLuma, rightLuma, topLuma, bottomLuma)
      if (localMax - localMin > 42) continue

      const neighborLuma = (leftLuma + rightLuma + topLuma + bottomLuma) / 4
      const centerChroma = getChroma(data, centerOffset, centerLuma)
      const leftChroma = getChroma(data, leftOffset, leftLuma)
      const rightChroma = getChroma(data, rightOffset, rightLuma)
      const topChroma = getChroma(data, topOffset, topLuma)
      const bottomChroma = getChroma(data, bottomOffset, bottomLuma)
      const neighborCb = (leftChroma.cb + rightChroma.cb + topChroma.cb + bottomChroma.cb) / 4
      const neighborCr = (leftChroma.cr + rightChroma.cr + topChroma.cr + bottomChroma.cr) / 4

      const lumaResidual = Math.min(64, Math.round(Math.abs(centerLuma - neighborLuma)))
      const chromaResidual = Math.min(64, Math.round(Math.hypot(
        centerChroma.cb - neighborCb,
        centerChroma.cr - neighborCr,
      ) / Math.SQRT2))
      lumaHistogram[lumaResidual]++
      chromaHistogram[chromaResidual]++
      sampleCount++

      const farLeftOffset = centerOffset - 8
      const farRightOffset = centerOffset + 8
      const farTopOffset = centerOffset - width * 8
      const farBottomOffset = centerOffset + width * 8
      const farLeftLuma = getLuma(data, farLeftOffset)
      const farRightLuma = getLuma(data, farRightOffset)
      const farTopLuma = getLuma(data, farTopOffset)
      const farBottomLuma = getLuma(data, farBottomOffset)
      const coarseRange = Math.max(farLeftLuma, farRightLuma, farTopLuma, farBottomLuma)
        - Math.min(farLeftLuma, farRightLuma, farTopLuma, farBottomLuma)
      if (coarseRange <= 42) {
        const coarseNeighborLuma = (farLeftLuma + farRightLuma + farTopLuma + farBottomLuma) / 4
        const farLeftChroma = getChroma(data, farLeftOffset, farLeftLuma)
        const farRightChroma = getChroma(data, farRightOffset, farRightLuma)
        const farTopChroma = getChroma(data, farTopOffset, farTopLuma)
        const farBottomChroma = getChroma(data, farBottomOffset, farBottomLuma)
        const coarseNeighborCb = (farLeftChroma.cb + farRightChroma.cb + farTopChroma.cb + farBottomChroma.cb) / 4
        const coarseNeighborCr = (farLeftChroma.cr + farRightChroma.cr + farTopChroma.cr + farBottomChroma.cr) / 4
        const coarseLumaResidual = Math.min(64, Math.round(Math.abs(centerLuma - coarseNeighborLuma)))
        const coarseChromaResidual = Math.min(64, Math.round(Math.hypot(
          centerChroma.cb - coarseNeighborCb,
          centerChroma.cr - coarseNeighborCr,
        ) / Math.SQRT2))
        coarseLumaHistogram[coarseLumaResidual]++
        coarseChromaHistogram[coarseChromaResidual]++
        coarseSampleCount++
      }
    }
  }

  const fineLumaNoise = histogramPercentile(lumaHistogram, sampleCount, 0.55)
  const fineChromaNoise = histogramPercentile(chromaHistogram, sampleCount, 0.55)
  const coarseLumaNoise = histogramPercentile(coarseLumaHistogram, coarseSampleCount, 0.6)
  const coarseChromaNoise = histogramPercentile(coarseChromaHistogram, coarseSampleCount, 0.6)
  return {
    lumaNoise: Math.max(fineLumaNoise, coarseLumaNoise),
    chromaNoise: Math.max(fineChromaNoise, coarseChromaNoise),
    fineLumaNoise,
    coarseLumaNoise,
    fineChromaNoise,
    coarseChromaNoise,
    sampleCount,
    coarseSampleCount,
  }
}

const sampleSkinMask = (faceSkinMask, x, y, width, height) => {
  if (!faceSkinMask?.data || !faceSkinMask.width || !faceSkinMask.height) return 0
  const maskX = Math.min(faceSkinMask.width - 1, Math.floor(x * faceSkinMask.width / width))
  const maskY = Math.min(faceSkinMask.height - 1, Math.floor(y * faceSkinMask.height / height))
  return faceSkinMask.data[maskY * faceSkinMask.width + maskX] / 255
}

/**
 * Local night-photo denoise. Chroma is filtered more strongly than luma so that
 * coloured high-ISO speckles are reduced without turning texture into plastic.
 * Processing is tiled with a small halo to avoid full-size float buffers.
 */
export const applyNightDenoiseFilter = (imageData, options = {}) => {
  const { data, width, height } = imageData
  if (!data || width < 3 || height < 3) return imageData

  const estimate = estimateNightNoise(imageData)
  const minimumSamples = Math.min(64, Math.max(12, Math.floor(width * height * 0.002)))
  const enoughSamples = estimate.sampleCount >= minimumSamples
  const lumaActivation = enoughSamples ? clamp01((estimate.lumaNoise - 0.75) / 6) : 0
  const chromaActivation = enoughSamples ? clamp01((estimate.chromaNoise - 0.5) / 8) : 0
  const requestedStrength = clamp(options.strength ?? 0.75, 0.35, 1)
  const strengthResponse = 0.45 + requestedStrength * 1.2
  // The user explicitly opted into denoise, so locally-flat dark regions get
  // a useful baseline even when a camera/JPEG pipeline has correlated the grain.
  const baseLumaBlend = enoughSamples
    ? (0.24 + lumaActivation * 0.3) * strengthResponse
    : 0
  const baseChromaBlend = enoughSamples
    ? (0.28 + chromaActivation * 0.48) * strengthResponse
    : 0
  const strengthScale = clamp(options.strengthScale ?? 1, 0.25, 1.25)
  const lumaStrengthScale = clamp(options.lumaStrengthScale ?? 1, 0, 1.25)
  const chromaStrengthScale = clamp(options.chromaStrengthScale ?? 1, 0, 1.25)
  const skinStrength = clamp01(options.skinStrength ?? 0.6)
  const output = new Uint8ClampedArray(data)
  const radius = 2
  const tileSize = 256
  let changedPixels = 0
  let hotPixels = 0

  for (let tileY = 0; tileY < height; tileY += tileSize) {
    for (let tileX = 0; tileX < width; tileX += tileSize) {
      const coreRight = Math.min(width, tileX + tileSize)
      const coreBottom = Math.min(height, tileY + tileSize)
      const extLeft = Math.max(0, tileX - radius)
      const extTop = Math.max(0, tileY - radius)
      const extRight = Math.min(width, coreRight + radius)
      const extBottom = Math.min(height, coreBottom + radius)
      const extWidth = extRight - extLeft
      const extHeight = extBottom - extTop
      const extLength = extWidth * extHeight
      const luma = new Float32Array(extLength)
      const cb = new Float32Array(extLength)
      const cr = new Float32Array(extLength)

      for (let y = extTop; y < extBottom; y++) {
        for (let x = extLeft; x < extRight; x++) {
          const sourceOffset = (y * width + x) * 4
          const localOffset = (y - extTop) * extWidth + x - extLeft
          const yValue = getLuma(data, sourceOffset)
          luma[localOffset] = yValue
          cb[localOffset] = data[sourceOffset + 2] - yValue
          cr[localOffset] = data[sourceOffset] - yValue
        }
      }

      for (let y = tileY; y < coreBottom; y++) {
        for (let x = tileX; x < coreRight; x++) {
          const sourceOffset = (y * width + x) * 4
          if (data[sourceOffset + 3] === 0) continue

          const localX = x - extLeft
          const localY = y - extTop
          const centerIndex = localY * extWidth + localX
          const leftIndex = localY * extWidth + Math.max(0, localX - 1)
          const rightIndex = localY * extWidth + Math.min(extWidth - 1, localX + 1)
          const topIndex = Math.max(0, localY - 1) * extWidth + localX
          const bottomIndex = Math.min(extHeight - 1, localY + 1) * extWidth + localX
          const centerLuma = luma[centerIndex]
          const neighborLuma = (luma[leftIndex] + luma[rightIndex] + luma[topIndex] + luma[bottomIndex]) / 4
          const gradient = Math.max(
            Math.abs(luma[leftIndex] - luma[rightIndex]),
            Math.abs(luma[topIndex] - luma[bottomIndex]),
            Math.abs(centerLuma - neighborLuma),
          )
          const directionalGradient = Math.max(
            Math.abs(luma[leftIndex] - luma[rightIndex]),
            Math.abs(luma[topIndex] - luma[bottomIndex]),
          )
          const darkness = clamp01((215 - centerLuma) / 175)
          // Fine high-ISO grain also raises the local gradient. Allow for the
          // measured noise floor before deciding that a pixel is a real edge.
          const noiseGradientAllowance = Math.min(16, estimate.lumaNoise * 0.75)
          const flatness = 1 - clamp01(
            (gradient - 2 - noiseGradientAllowance) / (34 + estimate.lumaNoise),
          )
          const edgeProtection = clamp01(
            (directionalGradient - 3 - estimate.lumaNoise * 0.55) / (18 + estimate.lumaNoise),
          )
          const saturation = Math.max(data[sourceOffset], data[sourceOffset + 1], data[sourceOffset + 2])
            - Math.min(data[sourceOffset], data[sourceOffset + 1], data[sourceOffset + 2])
          const colourProtection = 1 - 0.65 * clamp01((saturation - 50) / 100)
          const skin = sampleSkinMask(options.faceSkinMask, x, y, width, height)

          let chromaBlend = baseChromaBlend * strengthScale * chromaStrengthScale * darkness * (0.18 + 0.82 * flatness) * colourProtection
          let lumaBlend = baseLumaBlend * strengthScale * lumaStrengthScale * darkness * flatness * (1 - 0.82 * edgeProtection)
          chromaBlend *= 1 + skin * skinStrength * 0.18
          lumaBlend *= 1 - skin * 0.25

          let chromaWeight = 0
          let targetCb = 0
          let targetCr = 0
          let lumaWeight = 0
          let targetLuma = 0
          const centerCb = cb[centerIndex]
          const centerCr = cr[centerIndex]

          for (let dy = -radius; dy <= radius; dy++) {
            const sampleY = clamp(localY + dy, 0, extHeight - 1)
            for (let dx = -radius; dx <= radius; dx++) {
              const sampleX = clamp(localX + dx, 0, extWidth - 1)
              const sampleIndex = sampleY * extWidth + sampleX
              const distanceSquared = dx * dx + dy * dy
              const spatialWeight = 1 / (1 + distanceSquared)
              const lumaDifference = luma[sampleIndex] - centerLuma
              const rangeWeight = 1 / (1 + (lumaDifference * lumaDifference) / 324)
              const weight = spatialWeight * rangeWeight
              targetCb += cb[sampleIndex] * weight
              targetCr += cr[sampleIndex] * weight
              chromaWeight += weight

              targetLuma += luma[sampleIndex] * weight
              lumaWeight += weight
            }
          }

          targetCb /= chromaWeight || 1
          targetCr /= chromaWeight || 1
          targetLuma /= lumaWeight || 1

          const neighborCb = (cb[leftIndex] + cb[rightIndex] + cb[topIndex] + cb[bottomIndex]) / 4
          const neighborCr = (cr[leftIndex] + cr[rightIndex] + cr[topIndex] + cr[bottomIndex]) / 4
          const chromaOutlier = Math.hypot(centerCb - neighborCb, centerCr - neighborCr)
          const hotPixelThreshold = Math.max(28, estimate.chromaNoise * 3.2)
          if (darkness > 0.2 && chromaOutlier > hotPixelThreshold) {
            const neighborSpread = Math.max(
              Math.abs(cb[leftIndex] - cb[rightIndex]),
              Math.abs(cb[topIndex] - cb[bottomIndex]),
              Math.abs(cr[leftIndex] - cr[rightIndex]),
              Math.abs(cr[topIndex] - cr[bottomIndex]),
            )
            if (neighborSpread < Math.max(18, estimate.chromaNoise * 2.5)) {
              chromaBlend = Math.max(chromaBlend, 0.9 * strengthScale)
              lumaBlend = Math.max(lumaBlend, 0.16 * strengthScale * lumaStrengthScale)
              targetCb = neighborCb
              targetCr = neighborCr
              targetLuma = neighborLuma
              hotPixels++
            }
          }

          const filteredLuma = centerLuma + (targetLuma - centerLuma) * clamp01(lumaBlend)
          const filteredCb = centerCb + (targetCb - centerCb) * clamp01(chromaBlend)
          const filteredCr = centerCr + (targetCr - centerCr) * clamp01(chromaBlend)
          const red = filteredLuma + filteredCr
          const blue = filteredLuma + filteredCb
          const green = (filteredLuma - red * 0.299 - blue * 0.114) / 0.587
          const nextRed = Math.round(clamp(red, 0, 255))
          const nextGreen = Math.round(clamp(green, 0, 255))
          const nextBlue = Math.round(clamp(blue, 0, 255))

          if (
            nextRed !== data[sourceOffset]
            || nextGreen !== data[sourceOffset + 1]
            || nextBlue !== data[sourceOffset + 2]
          ) changedPixels++

          output[sourceOffset] = nextRed
          output[sourceOffset + 1] = nextGreen
          output[sourceOffset + 2] = nextBlue
        }
      }
    }
  }

  if (options.diagnostics && typeof options.diagnostics === 'object') {
    Object.assign(options.diagnostics, {
      ...estimate,
      applied: changedPixels > 0,
      changedPixels,
      hotPixels,
    })
  }

  return createResultImageData(output, width, height)
}

/**
 * Recover directional detail after denoising without bringing flat-area grain
 * back. When the pre-denoise source is available, only the source detail that
 * is still supported by a coherent edge in the filtered image is mixed back.
 * This avoids trying to recreate lost texture with global sharpening.
 */
export const recoverNightDenoiseDetails = (imageData, options = {}) => {
  const { data, width, height } = imageData
  if (!data || width < 3 || height < 3) return imageData

  const estimate = options.noiseEstimate || estimateNightNoise(imageData)
  const sourceImageData = options.sourceImageData
  const hasSource = sourceImageData?.data
    && sourceImageData.width === width
    && sourceImageData.height === height
  const sourceData = hasSource ? sourceImageData.data : null
  const sourceEstimate = hasSource
    ? (options.sourceNoiseEstimate || estimateNightNoise(sourceImageData))
    : estimate
  const requestedStrength = clamp(options.strength ?? 0.75, 0.35, 1)
  const amount = clamp(options.amount ?? (0.32 + requestedStrength * 0.26), 0, 0.7)
  const sourceRestoreAmount = clamp(amount * 0.9, 0, 0.65)
  const detailThreshold = Math.max(2, estimate.lumaNoise * 0.35)
  const sourceDetailThreshold = Math.max(2.25, sourceEstimate.lumaNoise * 0.42)
  const output = new Uint8ClampedArray(data)

  const inset = hasSource && width >= 5 && height >= 5 ? 2 : 1
  for (let y = inset; y < height - inset; y++) {
    for (let x = inset; x < width - inset; x++) {
      const offset = (y * width + x) * 4
      if (data[offset + 3] === 0) continue
      const leftOffset = offset - 4
      const rightOffset = offset + 4
      const topOffset = offset - width * 4
      const bottomOffset = offset + width * 4
      const center = getLuma(data, offset)
      const left = getLuma(data, leftOffset)
      const right = getLuma(data, rightOffset)
      const top = getLuma(data, topOffset)
      const bottom = getLuma(data, bottomOffset)
      const blurred = (center * 4 + (left + right + top + bottom) * 2) / 12
      const detail = center - blurred
      const directionalGradient = Math.max(Math.abs(left - right), Math.abs(top - bottom))

      if (hasSource) {
        const farLeftOffset = offset - 8
        const farRightOffset = offset + 8
        const farTopOffset = offset - width * 8
        const farBottomOffset = offset + width * 8
        const sourceCenter = getLuma(sourceData, offset)
        const sourceLeft = getLuma(sourceData, leftOffset)
        const sourceRight = getLuma(sourceData, rightOffset)
        const sourceTop = getLuma(sourceData, topOffset)
        const sourceBottom = getLuma(sourceData, bottomOffset)
        const sourceBlurred = (
          sourceCenter * 4
          + (sourceLeft + sourceRight + sourceTop + sourceBottom) * 2
        ) / 12
        const sourceDetail = sourceCenter - sourceBlurred
        const missingDetail = sourceDetail - detail
        const sourceFarLeft = getLuma(sourceData, farLeftOffset)
        const sourceFarRight = getLuma(sourceData, farRightOffset)
        const sourceFarTop = getLuma(sourceData, farTopOffset)
        const sourceFarBottom = getLuma(sourceData, farBottomOffset)
        const sourceFineX = sourceRight - sourceLeft
        const sourceFineY = sourceBottom - sourceTop
        const sourceCoarseX = sourceFarRight - sourceFarLeft
        const sourceCoarseY = sourceFarBottom - sourceFarTop
        const sourceCoarseGradient = Math.max(
          Math.abs(sourceCoarseX),
          Math.abs(sourceCoarseY),
        ) * 0.5
        const sourceDirectionalGradient = Math.max(
          Math.abs(sourceFineX),
          Math.abs(sourceFineY),
        )
        const filteredFarLeft = getLuma(data, farLeftOffset)
        const filteredFarRight = getLuma(data, farRightOffset)
        const filteredFarTop = getLuma(data, farTopOffset)
        const filteredFarBottom = getLuma(data, farBottomOffset)
        const filteredFineX = right - left
        const filteredFineY = bottom - top
        const filteredCoarseX = filteredFarRight - filteredFarLeft
        const filteredCoarseY = filteredFarBottom - filteredFarTop
        const filteredCoarseGradient = Math.max(
          Math.abs(filteredCoarseX),
          Math.abs(filteredCoarseY),
        ) * 0.5
        const sourceScaleCoherence = Math.max(
          getDirectionalScaleCoherence(sourceFineX, sourceCoarseX),
          getDirectionalScaleCoherence(sourceFineY, sourceCoarseY),
        )
        const filteredScaleCoherence = Math.max(
          getDirectionalScaleCoherence(filteredFineX, filteredCoarseX),
          getDirectionalScaleCoherence(filteredFineY, filteredCoarseY),
        )
        const scaleCoherence = Math.sqrt(sourceScaleCoherence * filteredScaleCoherence)
        const filteredStructure = Math.max(filteredCoarseGradient, directionalGradient * 0.72)
        const sourceStructureEvidence = Math.max(sourceCoarseGradient, sourceDirectionalGradient * 0.72)
        const sourceStructure = clamp01(
          (sourceStructureEvidence - sourceDetailThreshold * 0.35)
          / (11 + sourceEstimate.lumaNoise * 0.65),
        )
        const structureSupport = clamp01(
          (filteredStructure - sourceDetailThreshold * 0.35)
          / (9 + sourceEstimate.lumaNoise * 0.55),
        )
        const detailSupport = clamp01(
          (Math.abs(sourceDetail) - sourceDetailThreshold * 0.55)
          / (6 + sourceEstimate.lumaNoise * 0.45),
        )
        const signSupport = sourceDetail * detail > 0 ? 1 : 0
        const structureWeight = Math.sqrt(Math.cbrt(
          sourceStructure * structureSupport * detailSupport,
        )) * signSupport

        if (structureWeight > 0.001 && Math.abs(missingDetail) > 0.05 && scaleCoherence > 0.55) {
          const darkProtection = 0.58 + 0.42 * clamp01((center - 12) / 108)
          const maxDelta = Math.min(7, 2.5 + sourceEstimate.lumaNoise * 0.45)
          const delta = clamp(
            missingDetail * sourceRestoreAmount * structureWeight * darkProtection,
            -maxDelta,
            maxDelta,
          )
          // ImageData is 8-bit. Preserve a supported sub-pixel residual as one
          // luminance step, otherwise useful bark/hair texture rounds to zero.
          const quantizedDelta = Math.abs(delta) >= 0.5
            ? Math.round(delta)
            : Math.abs(missingDetail) > 0.35 && structureWeight > 0.34 && scaleCoherence > 0.65
              ? Math.sign(missingDetail)
              : 0
          if (quantizedDelta !== 0) {
            output[offset] = Math.round(clamp(data[offset] + quantizedDelta, 0, 255))
            output[offset + 1] = Math.round(clamp(data[offset + 1] + quantizedDelta, 0, 255))
            output[offset + 2] = Math.round(clamp(data[offset + 2] + quantizedDelta, 0, 255))
          }
        }
        continue
      }

      const edgeWeight = clamp01((directionalGradient - detailThreshold) / (14 + estimate.lumaNoise * 0.8))
      const detailWeight = clamp01((Math.abs(detail) - detailThreshold) / (7 + estimate.lumaNoise * 0.45))
      if (edgeWeight <= 0 || detailWeight <= 0) continue

      const darkProtection = 0.28 + 0.72 * clamp01((center - 18) / 112)
      const delta = detail * amount * edgeWeight * detailWeight * darkProtection
      const targetLuma = Math.max(1, center + delta)
      const ratio = clamp(targetLuma / Math.max(1, center), 0.88, 1.12)
      output[offset] = Math.round(clamp(data[offset] * ratio, 0, 255))
      output[offset + 1] = Math.round(clamp(data[offset + 1] * ratio, 0, 255))
      output[offset + 2] = Math.round(clamp(data[offset + 2] * ratio, 0, 255))
    }
  }

  return createResultImageData(output, width, height)
}
