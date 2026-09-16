const DEFAULT_ANALYSIS_SIDE = 900
const BORDER_BAND_RATIO = 0.018
const MIN_BORDER_DOMINANCE = 0.58
const MIN_BACKGROUND_RATIO = 0.2
const MIN_RECTANGULAR_BACKGROUND_RATIO = 0.12
const MAX_CROP_AREA_RATIO = 0.9
const RECTANGULAR_CONTENT_RATIO = 0.28
const MAX_RECTANGULAR_MARGIN_FOREGROUND_RATIO = 0.1

const colorDistanceSquared = (red, green, blue, color) => {
  const redDifference = red - color.red
  const greenDifference = green - color.green
  const blueDifference = blue - color.blue
  return (redDifference * redDifference) + (greenDifference * greenDifference) + (blueDifference * blueDifference)
}

const getDominantBorderColor = (pixels, width, height) => {
  const band = Math.max(1, Math.round(Math.min(width, height) * BORDER_BAND_RATIO))
  const sampleStep = Math.max(1, Math.floor(Math.max(width, height) / 700))
  const buckets = new Map()
  let sampleCount = 0

  const addPixel = (x, y) => {
    const offset = ((y * width) + x) * 4
    if (pixels[offset + 3] < 220) return
    const red = pixels[offset]
    const green = pixels[offset + 1]
    const blue = pixels[offset + 2]
    const bucket = `${red >> 4},${green >> 4},${blue >> 4}`
    const current = buckets.get(bucket) || { count: 0, red: 0, green: 0, blue: 0 }
    current.count += 1
    current.red += red
    current.green += green
    current.blue += blue
    buckets.set(bucket, current)
    sampleCount += 1
  }

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < band; x += sampleStep) addPixel(x, y)
    for (let x = Math.max(band, width - band); x < width; x += sampleStep) addPixel(x, y)
  }
  for (let x = band; x < width - band; x += sampleStep) {
    for (let y = 0; y < band; y += sampleStep) addPixel(x, y)
    for (let y = Math.max(band, height - band); y < height; y += sampleStep) addPixel(x, y)
  }

  let dominant = null
  buckets.forEach((bucket) => {
    if (!dominant || bucket.count > dominant.count) dominant = bucket
  })
  if (!dominant || !sampleCount) return null

  return {
    red: dominant.red / dominant.count,
    green: dominant.green / dominant.count,
    blue: dominant.blue / dominant.count,
    dominance: dominant.count / sampleCount,
  }
}

const createForegroundMask = (pixels, width, height, background) => {
  const total = width * height
  const mask = new Uint8Array(total)
  const distanceThreshold = 38 * 38
  let backgroundCount = 0

  for (let pixelIndex = 0; pixelIndex < total; pixelIndex += 1) {
    const offset = pixelIndex * 4
    const isBackground = pixels[offset + 3] >= 220
      && colorDistanceSquared(pixels[offset], pixels[offset + 1], pixels[offset + 2], background) <= distanceThreshold
    if (isBackground) backgroundCount += 1
    else if (pixels[offset + 3] >= 48) mask[pixelIndex] = 1
  }

  return { mask, backgroundRatio: backgroundCount / total }
}

const closeSmallGaps = (mask, width, height) => {
  const output = mask.slice()
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width) + x
      if (mask[index]) continue
      let neighbors = 0
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if ((offsetX || offsetY) && mask[index + (offsetY * width) + offsetX]) neighbors += 1
        }
      }
      if (neighbors >= 5) output[index] = 1
    }
  }
  return output
}

const findComponents = (mask, width, height) => {
  const total = width * height
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)
  const components = []

  for (let start = 0; start < total; start += 1) {
    if (!mask[start] || visited[start]) continue
    let head = 0
    let tail = 0
    let count = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    queue[tail++] = start
    visited[start] = 1

    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const y = Math.floor(index / width)
      count += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const nextY = y + offsetY
        if (nextY < 0 || nextY >= height) continue
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue
          const nextX = x + offsetX
          if (nextX < 0 || nextX >= width) continue
          const nextIndex = (nextY * width) + nextX
          if (!mask[nextIndex] || visited[nextIndex]) continue
          visited[nextIndex] = 1
          queue[tail++] = nextIndex
        }
      }
    }

    components.push({ count, minX, minY, maxX, maxY })
  }

  return components.sort((left, right) => right.count - left.count)
}

const getForegroundProfiles = (mask, width, height) => {
  const rows = new Float32Array(height)
  const columns = new Float32Array(width)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[(y * width) + x]) continue
      rows[y] += 1
      columns[x] += 1
    }
  }

  for (let y = 0; y < height; y += 1) rows[y] /= width
  for (let x = 0; x < width; x += 1) columns[x] /= height
  return { rows, columns }
}

const findRectangularInset = (profile, fromEnd = false) => {
  const length = profile.length
  const minInset = Math.max(2, Math.round(length * 0.008))
  const maxInset = Math.floor(length * 0.42)
  const windowSize = Math.max(2, Math.round(length * 0.006))
  let outsideForeground = 0

  for (let distance = 0; distance < maxInset; distance += 1) {
    const index = fromEnd ? length - distance - 1 : distance
    outsideForeground += profile[index]
    if (distance + 1 < minInset) continue

    let contentForeground = 0
    let contentSamples = 0
    for (let offset = 1; offset <= windowSize; offset += 1) {
      const contentIndex = fromEnd ? index - offset : index + offset
      if (contentIndex < 0 || contentIndex >= length) break
      contentForeground += profile[contentIndex]
      contentSamples += 1
    }
    if (!contentSamples) break

    const marginForegroundRatio = outsideForeground / (distance + 1)
    const contentForegroundRatio = contentForeground / contentSamples
    if (marginForegroundRatio <= MAX_RECTANGULAR_MARGIN_FOREGROUND_RATIO
      && contentForegroundRatio >= RECTANGULAR_CONTENT_RATIO) {
      for (let offset = 1; offset <= contentSamples; offset += 1) {
        const contentIndex = fromEnd ? index - offset : index + offset
        if (profile[contentIndex] >= RECTANGULAR_CONTENT_RATIO) return contentIndex
      }
    }
  }

  return null
}

const findRectangularContentBounds = (mask, width, height) => {
  const { rows, columns } = getForegroundProfiles(mask, width, height)
  const top = findRectangularInset(rows)
  const bottom = findRectangularInset(rows, true)
  const left = findRectangularInset(columns)
  const right = findRectangularInset(columns, true)
  const horizontalSides = Number(left !== null) + Number(right !== null)
  const verticalSides = Number(top !== null) + Number(bottom !== null)

  // Two perpendicular frame edges are required. This avoids treating a dark
  // strip inside an ordinary photo as an external canvas border.
  if (!horizontalSides || !verticalSides) return null

  return {
    minX: left ?? 0,
    minY: top ?? 0,
    maxX: right ?? width - 1,
    maxY: bottom ?? height - 1,
  }
}

const trimOverlappingVividDecoration = (pixels, width, height, bounds) => {
  const totalArea = width * height
  const vividMask = new Uint8Array(totalArea)

  for (let pixelIndex = 0; pixelIndex < totalArea; pixelIndex += 1) {
    const offset = pixelIndex * 4
    if (pixels[offset + 3] < 128) continue
    const red = pixels[offset]
    const green = pixels[offset + 1]
    const blue = pixels[offset + 2]
    const maximum = Math.max(red, green, blue)
    const minimum = Math.min(red, green, blue)
    if (maximum >= 110 && maximum - minimum >= 72) vividMask[pixelIndex] = 1
  }

  const components = findComponents(closeSmallGaps(vividMask, width, height), width, height)
  const candidates = components.filter(component => (
    component.count >= totalArea * 0.00035
    && component.count <= totalArea * 0.04
    && component.minX <= bounds.maxX
    && component.maxX >= bounds.minX
    && component.minY <= bounds.maxY
    && component.maxY >= bounds.minY
    && (component.minX < bounds.minX
      || component.maxX > bounds.maxX
      || component.minY < bounds.minY
      || component.maxY > bounds.maxY)
  ))
  if (!candidates.length) return bounds

  const adjusted = { ...bounds }
  candidates.forEach((component) => {
    const options = []
    if (component.minX < adjusted.minX && component.maxX >= adjusted.minX) {
      const next = Math.min(adjusted.maxX, component.maxX + 2)
      options.push({ side: 'left', value: next, cost: (next - adjusted.minX) / width })
    }
    if (component.maxX > adjusted.maxX && component.minX <= adjusted.maxX) {
      const next = Math.max(adjusted.minX, component.minX - 2)
      options.push({ side: 'right', value: next, cost: (adjusted.maxX - next) / width })
    }
    if (component.minY < adjusted.minY && component.maxY >= adjusted.minY) {
      const next = Math.min(adjusted.maxY, component.maxY + 2)
      options.push({ side: 'top', value: next, cost: (next - adjusted.minY) / height })
    }
    if (component.maxY > adjusted.maxY && component.minY <= adjusted.maxY) {
      const next = Math.max(adjusted.minY, component.minY - 2)
      options.push({ side: 'bottom', value: next, cost: (adjusted.maxY - next) / height })
    }

    const best = options.filter(option => option.cost <= 0.08).sort((left, right) => left.cost - right.cost)[0]
    if (!best) return
    if (best.side === 'left') adjusted.minX = best.value
    else if (best.side === 'right') adjusted.maxX = best.value
    else if (best.side === 'top') adjusted.minY = best.value
    else adjusted.maxY = best.value
  })

  return adjusted
}

const getOutsideBackgroundRatio = (pixels, width, height, background, bounds) => {
  const distanceThreshold = 38 * 38
  let outsideCount = 0
  let backgroundCount = 0
  const sampleStep = Math.max(1, Math.floor(Math.max(width, height) / 700))

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) continue
      const offset = ((y * width) + x) * 4
      outsideCount += 1
      if (pixels[offset + 3] >= 220
        && colorDistanceSquared(pixels[offset], pixels[offset + 1], pixels[offset + 2], background) <= distanceThreshold) {
        backgroundCount += 1
      }
    }
  }

  return outsideCount ? backgroundCount / outsideCount : 0
}

export const detectEmbeddedContentCrop = (imageData, width, height) => {
  const pixels = imageData?.data || imageData
  if (!pixels || width < 160 || height < 120 || pixels.length < width * height * 4) return null

  const background = getDominantBorderColor(pixels, width, height)
  if (!background || background.dominance < MIN_BORDER_DOMINANCE) return null

  const { mask: initialMask, backgroundRatio } = createForegroundMask(pixels, width, height, background)
  if (backgroundRatio < MIN_RECTANGULAR_BACKGROUND_RATIO) return null

  const components = findComponents(closeSmallGaps(initialMask, width, height), width, height)
  const main = components[0]
  if (!main) return null

  const totalArea = width * height
  const boxWidth = main.maxX - main.minX + 1
  const boxHeight = main.maxY - main.minY + 1
  const boxArea = boxWidth * boxHeight
  const secondLargest = components[1]?.count || 0
  const foregroundDensity = main.count / boxArea
  const cropAreaRatio = boxArea / totalArea

  if (main.count < totalArea * 0.055) return null
  if (secondLargest > totalArea * 0.018 && main.count < secondLargest * 2.5) return null

  const detectedRectangularBounds = findRectangularContentBounds(initialMask, width, height)
  if (detectedRectangularBounds
    && getOutsideBackgroundRatio(pixels, width, height, background, detectedRectangularBounds) >= 0.82) {
    const rectangularBounds = trimOverlappingVividDecoration(
      pixels,
      width,
      height,
      detectedRectangularBounds,
    )
    const rectangularWidth = rectangularBounds.maxX - rectangularBounds.minX + 1
    const rectangularHeight = rectangularBounds.maxY - rectangularBounds.minY + 1
    const rectangularArea = rectangularWidth * rectangularHeight
    const rectangularAreaRatio = rectangularArea / totalArea

    if (rectangularArea >= totalArea * 0.1
      && rectangularWidth >= width * 0.24
      && rectangularHeight >= height * 0.2
      && rectangularAreaRatio <= MAX_CROP_AREA_RATIO) {
      return {
        x: rectangularBounds.minX,
        y: rectangularBounds.minY,
        width: rectangularWidth,
        height: rectangularHeight,
        backgroundRatio,
        borderDominance: background.dominance,
        isRectangularFrame: true,
      }
    }
  }

  if (backgroundRatio < MIN_BACKGROUND_RATIO
    || boxArea < totalArea * 0.1
    || boxWidth < width * 0.24
    || boxHeight < height * 0.2
    || foregroundDensity < 0.34
    || cropAreaRatio > MAX_CROP_AREA_RATIO) return null

  if (getOutsideBackgroundRatio(pixels, width, height, background, main) < 0.78) return null

  const padding = Math.max(2, Math.round(Math.min(width, height) * 0.004))
  const x = Math.max(0, main.minX - padding)
  const y = Math.max(0, main.minY - padding)
  const right = Math.min(width, main.maxX + padding + 1)
  const bottom = Math.min(height, main.maxY + padding + 1)

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    backgroundRatio,
    borderDominance: background.dominance,
  }
}

export const cleanupExtractedImageCanvas = (sourceCanvas, maxAnalysisSide = DEFAULT_ANALYSIS_SIDE) => {
  const sourceWidth = sourceCanvas.width
  const sourceHeight = sourceCanvas.height
  if (sourceWidth < 160 || sourceHeight < 120) {
    return { canvas: sourceCanvas, width: sourceWidth, height: sourceHeight, wasContentCropped: false }
  }

  const scale = Math.min(1, maxAnalysisSide / Math.max(sourceWidth, sourceHeight))
  const analysisCanvas = document.createElement('canvas')
  analysisCanvas.width = Math.max(1, Math.round(sourceWidth * scale))
  analysisCanvas.height = Math.max(1, Math.round(sourceHeight * scale))
  const analysisContext = analysisCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
  if (!analysisContext) return { canvas: sourceCanvas, width: sourceWidth, height: sourceHeight, wasContentCropped: false }
  analysisContext.imageSmoothingEnabled = true
  analysisContext.imageSmoothingQuality = 'high'
  analysisContext.drawImage(sourceCanvas, 0, 0, analysisCanvas.width, analysisCanvas.height)

  const analysisData = analysisContext.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height)
  const detected = detectEmbeddedContentCrop(analysisData, analysisCanvas.width, analysisCanvas.height)
  analysisCanvas.width = 1
  analysisCanvas.height = 1
  if (!detected) return { canvas: sourceCanvas, width: sourceWidth, height: sourceHeight, wasContentCropped: false }

  const x = Math.max(0, detected.isRectangularFrame
    ? Math.ceil(detected.x / scale)
    : Math.floor(detected.x / scale))
  const y = Math.max(0, detected.isRectangularFrame
    ? Math.ceil(detected.y / scale)
    : Math.floor(detected.y / scale))
  const right = Math.min(sourceWidth, detected.isRectangularFrame
    ? Math.floor((detected.x + detected.width) / scale)
    : Math.ceil((detected.x + detected.width) / scale))
  const bottom = Math.min(sourceHeight, detected.isRectangularFrame
    ? Math.floor((detected.y + detected.height) / scale)
    : Math.ceil((detected.y + detected.height) / scale))
  const width = right - x
  const height = bottom - y
  if (width <= 0 || height <= 0 || (width * height) > sourceWidth * sourceHeight * MAX_CROP_AREA_RATIO) {
    return { canvas: sourceCanvas, width: sourceWidth, height: sourceHeight, wasContentCropped: false }
  }

  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = width
  outputCanvas.height = height
  const outputContext = outputCanvas.getContext('2d', { alpha: true })
  if (!outputContext) return { canvas: sourceCanvas, width: sourceWidth, height: sourceHeight, wasContentCropped: false }
  outputContext.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height)

  return {
    canvas: outputCanvas,
    width,
    height,
    wasContentCropped: true,
    originalWidth: sourceWidth,
    originalHeight: sourceHeight,
    contentCrop: { x, y, width, height },
  }
}
