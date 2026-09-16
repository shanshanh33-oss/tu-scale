const MAX_ANALYSIS_SIDE = 960
const MAX_SPLIT_PARTS = 30
const MAX_SPLIT_DEPTH = 7

const abortError = () => new DOMException('OCR 已取消', 'AbortError')

const assertNotAborted = (signal) => {
  if (signal?.aborted) throw abortError()
}

const getPixels = imageData => imageData?.data || imageData

const colorDistance = (left, right) => Math.sqrt(
  ((left.r - right.r) ** 2)
  + ((left.g - right.g) ** 2)
  + ((left.b - right.b) ** 2),
)

const getLineStats = (pixels, imageWidth, region, axis, position) => {
  const horizontal = axis === 'horizontal'
  const start = horizontal ? region.x : region.y
  const length = horizontal ? region.width : region.height
  const sampleStep = Math.max(1, Math.floor(length / 260))
  const buckets = new Map()
  let samples = 0
  let transparent = 0
  let dark = 0
  let light = 0
  let red = 0
  let green = 0
  let blue = 0

  for (let offset = 0; offset < length; offset += sampleStep) {
    const x = horizontal ? start + offset : position
    const y = horizontal ? position : start + offset
    const pixelIndex = ((y * imageWidth) + x) * 4
    const r = pixels[pixelIndex]
    const g = pixels[pixelIndex + 1]
    const b = pixels[pixelIndex + 2]
    const a = pixels[pixelIndex + 3]
    const luminance = (r * 0.299) + (g * 0.587) + (b * 0.114)
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    const bucket = a < 32 ? -1 : ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1)
    samples += 1
    if (a < 32) transparent += 1
    if (a >= 32 && luminance < 30) dark += 1
    if (a >= 32 && luminance > 242 && chroma < 18) light += 1
    red += r
    green += g
    blue += b
  }

  const dominant = Math.max(0, ...buckets.values()) / Math.max(1, samples)
  return {
    dominant,
    transparent: transparent / Math.max(1, samples),
    dark: dark / Math.max(1, samples),
    light: light / Math.max(1, samples),
    mean: {
      r: red / Math.max(1, samples),
      g: green / Math.max(1, samples),
      b: blue / Math.max(1, samples),
    },
  }
}

const getGutterStrength = stats => Math.max(stats.transparent, stats.dark, stats.light, stats.dominant)

const isFlatLine = stats => stats.transparent >= 0.9
  || stats.dark >= 0.94
  || stats.light >= 0.94
  || stats.dominant >= 0.96

const getRegionActivity = (pixels, imageWidth, region) => {
  const stepX = Math.max(1, Math.floor(region.width / 24))
  const stepY = Math.max(1, Math.floor(region.height / 24))
  const buckets = new Map()
  let count = 0
  let luminanceSum = 0
  let luminanceSquaredSum = 0
  let visible = 0

  for (let y = region.y; y < region.y + region.height; y += stepY) {
    for (let x = region.x; x < region.x + region.width; x += stepX) {
      const pixelIndex = ((y * imageWidth) + x) * 4
      const r = pixels[pixelIndex]
      const g = pixels[pixelIndex + 1]
      const b = pixels[pixelIndex + 2]
      const a = pixels[pixelIndex + 3]
      const luminance = (r * 0.299) + (g * 0.587) + (b * 0.114)
      const bucket = a < 32 ? -1 : ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1)
      count += 1
      if (a >= 32) visible += 1
      luminanceSum += luminance
      luminanceSquaredSum += luminance * luminance
    }
  }

  const mean = luminanceSum / Math.max(1, count)
  const variance = (luminanceSquaredSum / Math.max(1, count)) - (mean * mean)
  const dominant = Math.max(0, ...buckets.values()) / Math.max(1, count)
  return {
    dominant,
    variance,
    visibleRatio: visible / Math.max(1, count),
  }
}

const hasVisualContent = (pixels, imageWidth, region) => {
  const activity = getRegionActivity(pixels, imageWidth, region)
  return activity.visibleRatio >= 0.08 && (activity.variance >= 70 || activity.dominant <= 0.975)
}

const findSeparatorCandidates = (pixels, imageWidth, region, axis, minimumPanelSide) => {
  const horizontal = axis === 'horizontal'
  const axisStart = horizontal ? region.y : region.x
  const axisLength = horizontal ? region.height : region.width
  const axisEnd = axisStart + axisLength
  const positions = []

  for (let position = axisStart + minimumPanelSide; position < axisEnd - minimumPanelSide; position += 1) {
    const stats = getLineStats(pixels, imageWidth, region, axis, position)
    if (isFlatLine(stats)) positions.push({ position, stats })
  }

  if (!positions.length) return []
  const bands = []
  let current = [positions[0]]
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index].position === positions[index - 1].position + 1) current.push(positions[index])
    else {
      bands.push(current)
      current = [positions[index]]
    }
  }
  bands.push(current)

  return bands.flatMap((band) => {
    const start = band[0].position
    const end = band.at(-1).position
    const bandWidth = end - start + 1
    if (bandWidth > Math.max(18, Math.round(axisLength * 0.09))) return []
    const before = getLineStats(pixels, imageWidth, region, axis, start - 1)
    const after = getLineStats(pixels, imageWidth, region, axis, end + 1)
    const middle = band[Math.floor(band.length / 2)].stats
    const contrastBefore = colorDistance(middle.mean, before.mean)
    const contrastAfter = colorDistance(middle.mean, after.mean)
    const isTransparentGap = middle.transparent >= 0.9
    const hasBoundaryContrast = Math.max(contrastBefore, contrastAfter) >= 18
      && contrastBefore + contrastAfter >= 28
    if (!isTransparentGap && !hasBoundaryContrast) return []

    const first = horizontal
      ? { x: region.x, y: region.y, width: region.width, height: start - region.y }
      : { x: region.x, y: region.y, width: start - region.x, height: region.height }
    const second = horizontal
      ? { x: region.x, y: end + 1, width: region.width, height: (region.y + region.height) - end - 1 }
      : { x: end + 1, y: region.y, width: (region.x + region.width) - end - 1, height: region.height }
    if (!hasVisualContent(pixels, imageWidth, first) || !hasVisualContent(pixels, imageWidth, second)) return []

    const middlePoint = (start + end) / 2
    const balance = 1 - Math.abs(((middlePoint - axisStart) / axisLength) - 0.5)
    const contrastScore = Math.min(1, (contrastBefore + contrastAfter) / 180)
    const thinness = 1 - Math.min(1, bandWidth / Math.max(1, axisLength * 0.09))
    const score = getGutterStrength(middle) + (contrastScore * 0.7) + (balance * 0.08) + (thinness * 0.08)
    return [{ axis, start, end, first, second, score }]
  })
}

const trimPanelBorders = (pixels, imageWidth, region) => {
  const trimmed = { ...region }
  const maximumTrimX = Math.min(12, Math.floor(region.width * 0.025))
  const maximumTrimY = Math.min(12, Math.floor(region.height * 0.025))
  const isBorderLine = stats => stats.transparent >= 0.96 || stats.dark >= 0.98 || stats.light >= 0.98

  for (let count = 0; count < maximumTrimX && trimmed.width > 2; count += 1) {
    if (!isBorderLine(getLineStats(pixels, imageWidth, trimmed, 'vertical', trimmed.x))) break
    trimmed.x += 1
    trimmed.width -= 1
  }
  for (let count = 0; count < maximumTrimX && trimmed.width > 2; count += 1) {
    const position = trimmed.x + trimmed.width - 1
    if (!isBorderLine(getLineStats(pixels, imageWidth, trimmed, 'vertical', position))) break
    trimmed.width -= 1
  }
  for (let count = 0; count < maximumTrimY && trimmed.height > 2; count += 1) {
    if (!isBorderLine(getLineStats(pixels, imageWidth, trimmed, 'horizontal', trimmed.y))) break
    trimmed.y += 1
    trimmed.height -= 1
  }
  for (let count = 0; count < maximumTrimY && trimmed.height > 2; count += 1) {
    const position = trimmed.y + trimmed.height - 1
    if (!isBorderLine(getLineStats(pixels, imageWidth, trimmed, 'horizontal', position))) break
    trimmed.height -= 1
  }
  return trimmed
}

const sortRegionsReadingOrder = (regions) => {
  const rows = []
  const byTop = [...regions].sort((left, right) => left.y - right.y || left.x - right.x)
  byTop.forEach((region) => {
    const row = rows.find(candidate => Math.abs(candidate.top - region.y) <= Math.max(5, Math.min(candidate.height, region.height) * 0.18))
    if (row) {
      row.regions.push(region)
      row.top = Math.min(row.top, region.y)
      row.height = Math.min(row.height, region.height)
    } else {
      rows.push({ top: region.y, height: region.height, regions: [region] })
    }
  })
  return rows
    .sort((left, right) => left.top - right.top)
    .flatMap(row => row.regions.sort((left, right) => left.x - right.x))
}

export const detectCollageRegions = (imageData, width, height, {
  maxParts = MAX_SPLIT_PARTS,
  maxDepth = MAX_SPLIT_DEPTH,
} = {}) => {
  const pixels = getPixels(imageData)
  if (!pixels || !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    return []
  }
  const minimumPanelSide = Math.max(36, Math.round(Math.min(width, height) * 0.065))
  const root = { x: 0, y: 0, width, height }

  const splitRegion = (region, depth) => {
    if (depth >= maxDepth || (region.width < minimumPanelSide * 2 && region.height < minimumPanelSide * 2)) return [region]
    const candidates = [
      ...findSeparatorCandidates(pixels, width, region, 'vertical', minimumPanelSide),
      ...findSeparatorCandidates(pixels, width, region, 'horizontal', minimumPanelSide),
    ].sort((left, right) => right.score - left.score)
    const selected = candidates[0]
    if (!selected) return [region]
    const first = splitRegion(selected.first, depth + 1)
    const second = splitRegion(selected.second, depth + 1)
    if (first.length + second.length > maxParts) return [region]
    return [...first, ...second]
  }

  const regions = splitRegion(root, 0)
  if (regions.length <= 1) return [root]
  return sortRegionsReadingOrder(regions).map(region => trimPanelBorders(pixels, width, region))
}

const canvasToBlob = (canvas, type = 'image/png', quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob)
    else reject(new Error('拼图区域无法生成图片'))
  }, type, quality)
})

const loadDrawable = async (blob) => {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    return {
      drawable: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    }
  }
  const url = URL.createObjectURL(blob)
  let image
  try {
    image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('图片无法解码'))
      element.src = url
    })
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  return {
    drawable: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(url),
  }
}

const getSplitFileName = (name, index, count, extension) => {
  const safeName = String(name || '图片').split('/').at(-1)
  const baseName = safeName.replace(/\.[^.]+$/, '') || '图片'
  const digits = Math.max(2, String(count).length)
  return `${baseName}_拆分${String(index).padStart(digits, '0')}.${extension}`
}

const getSplitRelativePath = (file, name) => {
  const relativePath = file.webkitRelativePath || ''
  const separator = relativePath.lastIndexOf('/')
  return separator >= 0 ? `${relativePath.slice(0, separator + 1)}${name}` : ''
}

export const splitCollageImage = async (file, { signal, enabled = true } = {}) => {
  assertNotAborted(signal)
  const loaded = await loadDrawable(file)
  try {
    const original = {
      blob: file,
      width: loaded.width,
      height: loaded.height,
      originalFileName: file.name,
      relativePath: file.webkitRelativePath || '',
      sourceFileName: file.name,
      splitIndex: 1,
      splitCount: 1,
      wasSplit: false,
    }
    if (!enabled || loaded.width < 160 || loaded.height < 160) return [original]

    const scale = Math.min(1, MAX_ANALYSIS_SIDE / Math.max(loaded.width, loaded.height))
    const analysisWidth = Math.max(1, Math.round(loaded.width * scale))
    const analysisHeight = Math.max(1, Math.round(loaded.height * scale))
    const analysisCanvas = document.createElement('canvas')
    analysisCanvas.width = analysisWidth
    analysisCanvas.height = analysisHeight
    const analysisContext = analysisCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!analysisContext) throw new Error('浏览器无法分析拼图')
    analysisContext.imageSmoothingEnabled = true
    analysisContext.imageSmoothingQuality = 'high'
    analysisContext.drawImage(loaded.drawable, 0, 0, analysisWidth, analysisHeight)
    const regions = detectCollageRegions(
      analysisContext.getImageData(0, 0, analysisWidth, analysisHeight),
      analysisWidth,
      analysisHeight,
    )
    analysisCanvas.width = 1
    analysisCanvas.height = 1
    if (regions.length <= 1) return [original]

    const scaleX = loaded.width / analysisWidth
    const scaleY = loaded.height / analysisHeight
    const output = file.type === 'image/jpeg'
      ? { type: 'image/jpeg', extension: 'jpg', quality: 0.94 }
      : { type: 'image/png', extension: 'png', quality: undefined }
    const parts = []
    for (let index = 0; index < regions.length; index += 1) {
      assertNotAborted(signal)
      const region = regions[index]
      const x = Math.max(0, Math.round(region.x * scaleX))
      const y = Math.max(0, Math.round(region.y * scaleY))
      const right = Math.min(loaded.width, Math.round((region.x + region.width) * scaleX))
      const bottom = Math.min(loaded.height, Math.round((region.y + region.height) * scaleY))
      const width = Math.max(1, right - x)
      const height = Math.max(1, bottom - y)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { alpha: true })
      if (!context) throw new Error('浏览器无法拆分拼图')
      context.drawImage(loaded.drawable, x, y, width, height, 0, 0, width, height)
      const blob = await canvasToBlob(canvas, output.type, output.quality)
      canvas.width = 1
      canvas.height = 1
      const splitIndex = index + 1
      const originalFileName = getSplitFileName(file.name, splitIndex, regions.length, output.extension)
      parts.push({
        blob,
        width,
        height,
        originalFileName,
        relativePath: getSplitRelativePath(file, originalFileName),
        sourceFileName: file.name,
        splitIndex,
        splitCount: regions.length,
        wasSplit: true,
      })
    }
    return parts
  } finally {
    loaded.close()
  }
}

export const prepareImageForOcr = async (blob, width, height, { signal } = {}) => {
  const scale = Math.min(3, Math.max(1, 1600 / Math.max(width || 1, height || 1)))
  if (scale < 1.15) return blob
  assertNotAborted(signal)
  const loaded = await loadDrawable(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(loaded.width * scale))
    canvas.height = Math.max(1, Math.round(loaded.height * scale))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return blob
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.filter = 'contrast(1.12)'
    context.drawImage(loaded.drawable, 0, 0, canvas.width, canvas.height)
    const prepared = await canvasToBlob(canvas, 'image/png')
    canvas.width = 1
    canvas.height = 1
    return prepared
  } finally {
    loaded.close()
  }
}
