import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload, Download, Loader2, Sparkles, CheckCircle, AlertCircle, Brush, Eraser, RotateCcw } from 'lucide-react'
import JSZip from 'jszip'
import RewardButton from './RewardButton'
import { canvasToBlob, downloadBlob, formatBytes, getBaseName, readFileAsDataUrl, readImage, revokeObjectUrl, trackEvent } from './shared'

const mb = (value) => value * 1024 * 1024
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const NORMALIZE_PRESETS = [
  { id: 'universal-main', platform: '通用', label: '全平台安全方主图', size: '800 x 800', w: 800, h: 800, maxBytes: mb(1), fill: 82, background: '纯白', note: '按拼多多 1MB 严格上限做通用安全版' },
  { id: 'taobao-main', platform: '淘宝/天猫', label: '方主图推荐', size: '1440 x 1440', w: 1440, h: 1440, maxBytes: mb(3), fill: 82, background: '白底/实拍' },
  { id: 'taobao-vertical', platform: '淘宝/天猫', label: '3:4 竖版主图', size: '750 x 1000', w: 750, h: 1000, maxBytes: mb(3), fill: 82, background: '白底/实拍' },
  { id: 'taobao-detail', platform: '淘宝/天猫', label: '手机详情页', size: '750 x 3000', w: 750, h: 3000, maxBytes: mb(2.5), fill: 92, background: '白底/详情' },
  { id: 'pdd-main', platform: '拼多多', label: '轮播主图', size: '800 x 800', w: 800, h: 800, maxBytes: mb(1), fill: 82, background: '纯白/实拍', note: '拼多多体积限制更严，默认压到 1MB 内' },
  { id: 'pdd-long', platform: '拼多多', label: '商品长图', size: '750 x 1125', w: 750, h: 1125, maxBytes: mb(1), fill: 84, background: '白底/实拍' },
  { id: 'pdd-detail', platform: '拼多多', label: '详情页单图', size: '750 x 3000', w: 750, h: 3000, maxBytes: mb(1), fill: 94, background: '详情图' },
  { id: 'douyin-main', platform: '抖店', label: '搜索白底主图', size: '800 x 800', w: 800, h: 800, maxBytes: mb(5), fill: 82, background: '纯白' },
  { id: 'douyin-vertical', platform: '抖店', label: '3:4 信息流图', size: '750 x 1000', w: 750, h: 1000, maxBytes: mb(5), fill: 82, background: '白底/场景' },
  { id: 'jd-main', platform: '京东', label: '白底主图', size: '800 x 800', w: 800, h: 800, maxBytes: mb(2), fill: 82, background: '纯白' },
  { id: 'jd-detail-pc', platform: '京东', label: 'PC 详情页', size: '790 x 1500', w: 790, h: 1500, maxBytes: mb(3), fill: 94, background: '详情图' },
  { id: '1688-main', platform: '1688', label: '高清批发主图', size: '1920 x 1920', w: 1920, h: 1920, maxBytes: mb(5), fill: 84, background: '白底/实拍' },
  { id: '1688-detail', platform: '1688', label: '商品详情页', size: '790 x 3000', w: 790, h: 3000, maxBytes: mb(5), fill: 94, background: '详情图' },
  { id: 'kuaishou-main', platform: '快手小店', label: '1:1 主图', size: '800 x 800', w: 800, h: 800, maxBytes: mb(3), fill: 82, background: '白底/实拍' },
  { id: 'kuaishou-vertical', platform: '快手小店', label: '3:4 种草竖图', size: '750 x 1000', w: 750, h: 1000, maxBytes: mb(3), fill: 82, background: '白底/场景' },
  { id: 'amazon-main', platform: 'Amazon', label: '主图白底', size: '2000 x 2000', w: 2000, h: 2000, maxBytes: mb(10), fill: 85, background: '纯白', note: '主图按商品占画面 85% 设计' },
  { id: 'amazon-a-plus', platform: 'Amazon', label: 'A+ 详情图', size: '1500 x 1500', w: 1500, h: 1500, maxBytes: mb(10), fill: 92, background: '详情图' },
]

const WHITE_BG_PRESETS = [
  { id: 'white-universal', platform: '通用', label: '全平台白底安全图', size: '800 x 800', w: 800, h: 800, maxBytes: mb(1), fill: 82, background: '纯白', note: '适合测试和多平台通用上传' },
  { id: 'white-taobao', platform: '淘宝/天猫', label: '白底主图/第5张', size: '1440 x 1440', w: 1440, h: 1440, maxBytes: mb(3), fill: 82, background: '纯白' },
  { id: 'white-pdd', platform: '拼多多', label: '白底主图', size: '800 x 800', w: 800, h: 800, maxBytes: mb(1), fill: 82, background: '纯白', note: '拼多多体积限制更严，默认压到 1MB 内' },
  { id: 'white-douyin', platform: '抖店', label: '商城搜索白底图', size: '800 x 800', w: 800, h: 800, maxBytes: mb(5), fill: 82, background: '纯白' },
  { id: 'white-jd', platform: '京东', label: '首图白底', size: '800 x 800', w: 800, h: 800, maxBytes: mb(2), fill: 82, background: '纯白' },
  { id: 'white-1688', platform: '1688', label: '高清白底批发图', size: '1920 x 1920', w: 1920, h: 1920, maxBytes: mb(5), fill: 84, background: '纯白' },
  { id: 'white-kuaishou', platform: '快手小店', label: '白底主图', size: '800 x 800', w: 800, h: 800, maxBytes: mb(3), fill: 82, background: '纯白' },
  { id: 'white-amazon', platform: 'Amazon', label: '主图纯白底', size: '2000 x 2000', w: 2000, h: 2000, maxBytes: mb(10), fill: 85, background: '纯白', note: '主图按商品占画面 85% 设计' },
]

const WILLINGNESS = [
  { value: 'free', label: '只想免费试用' },
  { value: 'pay_once', label: '愿意小额购买' },
  { value: 'credits', label: '愿意购买积分包' },
  { value: 'batch', label: '需要批量套餐' },
  { value: 'unsure', label: '先看效果再决定' },
]

const REMOVE_BG_PRICE_PLANS = [
  { value: 'trial_9_10', label: '¥9.9 / 10 张', note: '低门槛体验价' },
  { value: 'basic_19_20', label: '¥19.9 / 20 张', note: '测试期推荐，不容易亏' },
  { value: 'standard_39_50', label: '¥39.9 / 50 张', note: '适合稳定小批量' },
  { value: 'batch_99_120', label: '¥99 / 120 张', note: '批量需求价，需足够用户量' },
]

const BATCH_NEEDS = [
  { value: 'no', label: '不需要批量' },
  { value: 'sometimes', label: '偶尔需要批量' },
  { value: 'often', label: '经常批量处理' },
  { value: 'must', label: '必须支持文件夹批量' },
]

const MONTHLY_VOLUMES = [
  { value: '1-10', label: '1-10 张/月' },
  { value: '11-50', label: '11-50 张/月' },
  { value: '51-200', label: '51-200 张/月' },
  { value: '200+', label: '200 张以上/月' },
]

const PRODUCT_IMAGE_FAQ = [
  ['商品图规范化免费吗？', '尺寸规范化、裁切、留白和格式导出都可以免费在浏览器本地处理；AI 抠图属于付费 API 测试功能，目前限制每个 IP 每天试用 1 张。'],
  ['图片会上传服务器吗？', '普通商品图规范化在浏览器本地完成，不上传图片。只有你主动使用 AI 抠图时，才会把当前图片发送到抠图服务处理。'],
  ['适合哪些平台？', '页面内置淘宝/天猫、拼多多、抖店、京东、1688、快手小店、Amazon 等常见尺寸，可按平台选择预设后批量导出。'],
  ['白底图主体占比不准怎么办？', '浅色商品或白衣服可能会影响自动识别，可以进入调整工作区手动框选主体范围，再生成规范图。'],
]

const MAX_BATCH_NORMALIZE_FILES = 50

const TOOL_NAV = [
  { id: 'upscale', label: '图片放大', path: '/' },
  { id: 'converter', label: '图片压缩', path: '/format-converter' },
  { id: 'product-image', label: '商品图规范化', path: '/product-image' },
  { id: 'contact', label: '反馈联系', path: '/contact' },
]

const OUTPUT_FORMATS = [
  { id: 'jpeg', label: 'JPG 电商常用', mime: 'image/jpeg', ext: 'jpg', quality: 0.92 },
  { id: 'png', label: 'PNG 高质量', mime: 'image/png', ext: 'png' },
  { id: 'webp', label: 'WebP 体积更小', mime: 'image/webp', ext: 'webp', quality: 0.92 },
]

const getFormat = (id) => OUTPUT_FORMATS.find(item => item.id === id) || OUTPUT_FORMATS[0]

const toRgb = (color) => {
  if (!color) return '#ffffff'
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
}

const getDefaultCropRectForRatio = (width, height, ratio) => {
  if (!ratio || !width || !height) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
  const imageRatio = width / height
  if (imageRatio > ratio) {
    const cropW = clamp((height * ratio) / width, 0.1, 1)
    return { x: (1 - cropW) / 2, y: 0, w: cropW, h: 1 }
  }
  const cropH = clamp(width / ratio / height, 0.1, 1)
  return { x: 0, y: (1 - cropH) / 2, w: 1, h: cropH }
}

const normalizeCropRect = (rect) => {
  const next = {
    x: clamp(rect.x, 0, 0.98),
    y: clamp(rect.y, 0, 0.98),
    w: clamp(rect.w, 0.02, 1),
    h: clamp(rect.h, 0.02, 1),
  }
  if (next.x + next.w > 1) next.x = 1 - next.w
  if (next.y + next.h > 1) next.y = 1 - next.h
  return next
}

const boundsToRect = (bounds, width, height) => {
  if (!bounds || !width || !height) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
  return normalizeCropRect({
    x: bounds.x / width,
    y: bounds.y / height,
    w: bounds.w / width,
    h: bounds.h / height,
  })
}

const rectToBounds = (rect, width, height) => {
  const safe = normalizeCropRect(rect)
  return {
    x: Math.max(0, Math.round(safe.x * width)),
    y: Math.max(0, Math.round(safe.y * height)),
    w: Math.max(1, Math.round(safe.w * width)),
    h: Math.max(1, Math.round(safe.h * height)),
  }
}

const getSubjectRatioFromRect = (rect) => {
  if (!rect) return 0
  const safe = normalizeCropRect(rect)
  return Math.round(Math.max(safe.w, safe.h) * 100)
}

const resizeRectFromHandle = (startRect, handle, dx, dy) => {
  const minSize = 0.04
  let next = { ...startRect }
  if (handle.includes('e')) next.w = clamp(startRect.w + dx, minSize, 1 - startRect.x)
  if (handle.includes('s')) next.h = clamp(startRect.h + dy, minSize, 1 - startRect.y)
  if (handle.includes('w')) {
    const newX = clamp(startRect.x + dx, 0, startRect.x + startRect.w - minSize)
    next.w = startRect.w + (startRect.x - newX)
    next.x = newX
  }
  if (handle.includes('n')) {
    const newY = clamp(startRect.y + dy, 0, startRect.y + startRect.h - minSize)
    next.h = startRect.h + (startRect.y - newY)
    next.y = newY
  }
  return normalizeCropRect(next)
}

const imageToCanvas = async (src) => {
  const img = await readImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  canvas.getContext('2d').drawImage(img, 0, 0)
  return canvas
}

const resizeExactCanvas = async (src, preset) => {
  const img = await readImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = preset.w
  canvas.height = preset.h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, preset.w, preset.h)
  return { canvas }
}

const scaleCanvasBySubjectBounds = (sourceCanvas, preset, bounds, fillRatio = 0.82, background = '#ffffff') => {
  const canvas = document.createElement('canvas')
  canvas.width = preset.w
  canvas.height = preset.h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = typeof background === 'string' ? background : toRgb(background)
  ctx.fillRect(0, 0, preset.w, preset.h)
  const sourceBounds = bounds || { x: 0, y: 0, w: sourceCanvas.width, h: sourceCanvas.height }
  const targetW = preset.w * fillRatio
  const targetH = preset.h * fillRatio
  const scale = Math.min(targetW / sourceBounds.w, targetH / sourceBounds.h)
  const subjectCenterX = sourceBounds.x + sourceBounds.w / 2
  const subjectCenterY = sourceBounds.y + sourceBounds.h / 2
  const dx = Math.round(preset.w / 2 - subjectCenterX * scale)
  const dy = Math.round(preset.h / 2 - subjectCenterY * scale)
  const dw = Math.round(sourceCanvas.width * scale)
  const dh = Math.round(sourceCanvas.height * scale)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(sourceCanvas, dx, dy, dw, dh)
  return { canvas, placement: { dx, dy, dw, dh } }
}

const containOnBackgroundCanvas = async (src, preset, background = '#ffffff', offset = { x: 0.5, y: 0.5 }) => {
  const img = await readImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = preset.w
  canvas.height = preset.h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = typeof background === 'string' ? background : toRgb(background)
  ctx.fillRect(0, 0, preset.w, preset.h)
  const scale = Math.min(preset.w / img.width, preset.h / img.height)
  const dw = Math.max(1, Math.round(img.width * scale))
  const dh = Math.max(1, Math.round(img.height * scale))
  const maxX = preset.w - dw
  const maxY = preset.h - dh
  const safeOffset = { x: clamp(offset?.x ?? 0.5, 0, 1), y: clamp(offset?.y ?? 0.5, 0, 1) }
  const dx = Math.round(maxX * safeOffset.x)
  const dy = Math.round(maxY * safeOffset.y)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, dx, dy, dw, dh)
  return { canvas, placement: { dx, dy, dw, dh } }
}

const getImageMeta = async (file) => {
  const src = await readFileAsDataUrl(file)
  const img = await readImage(src)
  return { src, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height }
}

const estimateWhiteSubjectInfo = async (src) => {
  const source = await imageToCanvas(src)
  const ctx = source.getContext('2d', { willReadFrequently: true })
  const { data, width, height } = ctx.getImageData(0, 0, source.width, source.height)
  let minX = width, minY = height, maxX = -1, maxY = -1
  let nonWhite = 0
  let edgeBg = 0
  let edgeTotal = 0
  const cornerSamples = []
  const addCornerSample = (x, y) => {
    const index = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4
    cornerSamples.push([data[index], data[index + 1], data[index + 2]])
  }
  for (let i = 0; i < 12; i++) {
    const t = i / 11
    addCornerSample(Math.round(t * (width - 1)), 0)
    addCornerSample(Math.round(t * (width - 1)), height - 1)
    addCornerSample(0, Math.round(t * (height - 1)))
    addCornerSample(width - 1, Math.round(t * (height - 1)))
  }
  const bg = cornerSamples.reduce((sum, color) => ({
    r: sum.r + color[0],
    g: sum.g + color[1],
    b: sum.b + color[2],
  }), { r: 0, g: 0, b: 0 })
  bg.r /= cornerSamples.length
  bg.g /= cornerSamples.length
  bg.b /= cornerSamples.length
  const bgAvg = (bg.r + bg.g + bg.b) / 3
  const bgSpread = Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b)
  const isLightPlainCandidate = bgAvg > 205 && bgSpread < 42
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4
      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]
      const a = data[index + 3]
      const spread = Math.max(r, g, b) - Math.min(r, g, b)
      const avg = (r + g + b) / 3
      const distToBg = Math.hypot(r - bg.r, g - bg.g, b - bg.b)
      const lightNeutralBg = avg > 185 && spread < 48 && distToBg < 86
      const nearWhiteBg = avg > 225 && spread < 36
      const isPlainBg = a < 8 || nearWhiteBg || (isLightPlainCandidate && lightNeutralBg)
      const isSubject = !isPlainBg
      const inEdge = x < width * 0.08 || x > width * 0.92 || y < height * 0.08 || y > height * 0.92
      if (inEdge) {
        edgeTotal++
        if (isPlainBg) edgeBg++
      }
      if (isSubject) {
        nonWhite++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const isWhiteBg = edgeTotal > 0 && edgeBg / edgeTotal > 0.58 && isLightPlainCandidate
  if (!nonWhite || maxX < minX || maxY < minY) return { isWhiteBg, subjectRatio: 0, bounds: null, bgColor: bg }
  return {
    isWhiteBg,
    subjectRatio: Math.round(Math.max((maxX - minX + 1) / width, (maxY - minY + 1) / height) * 100),
    bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    bgColor: bg,
  }
}

const normalizeByCropCanvas = async (src, preset, crop = { x: 50, y: 50 }) => {
  const img = await readImage(src)
  const sourceRatio = img.width / img.height
  const targetRatio = preset.w / preset.h
  let sw = img.width
  let sh = img.height
  if (sourceRatio > targetRatio) sw = Math.round(img.height * targetRatio)
  else sh = Math.round(img.width / targetRatio)
  const sx = Math.round((img.width - sw) * (crop.x / 100))
  const sy = Math.round((img.height - sh) * (crop.y / 100))
  const canvas = document.createElement('canvas')
  canvas.width = preset.w
  canvas.height = preset.h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, preset.w, preset.h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, preset.w, preset.h)
  return { canvas, cropBox: { sx, sy, sw, sh } }
}

const normalizeByCropRectCanvas = async (src, preset, rect) => {
  const img = await readImage(src)
  const crop = normalizeCropRect(rect || getDefaultCropRectForRatio(img.width, img.height, preset.w / preset.h))
  const sx = Math.round(img.width * crop.x)
  const sy = Math.round(img.height * crop.y)
  const sw = Math.max(1, Math.round(img.width * crop.w))
  const sh = Math.max(1, Math.round(img.height * crop.h))
  const canvas = document.createElement('canvas')
  canvas.width = preset.w
  canvas.height = preset.h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, preset.w, preset.h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, preset.w, preset.h)
  return { canvas, cropBox: { sx, sy, sw, sh } }
}

const renderNormalizeOutputCanvas = async ({ src, preset, analysis, settings = {}, fallbackMode = 'auto', fillRatio = 82, background = '#ffffff' }) => {
  const mode = settings.mode || fallbackMode
  const bg = settings.bgColor || analysis?.bgColor || background
  const treatAsWhiteBg = settings.forceWhiteBg || analysis?.isWhiteBg
  if (treatAsWhiteBg) {
    const { canvas: baseCanvas } = await renderBaseNormalizeCanvas({ src, preset, analysis, settings, fallbackMode: mode, background })
    const subjectBounds = settings.subjectRect
      ? rectToBounds(settings.subjectRect, baseCanvas.width, baseCanvas.height)
      : settings.subjectBounds || estimateSubjectBoundsFromCanvas(baseCanvas, bg)
    return scaleCanvasBySubjectBounds(baseCanvas, preset, subjectBounds, fillRatio / 100, bg)
  }
  if (mode === 'contain') {
    return await containOnBackgroundCanvas(src, preset, bg, settings.containOffset)
  }
  if (mode === 'crop' || (mode === 'auto' && analysis?.aspectStatus === 'crop' && !treatAsWhiteBg)) {
    return settings.rect
      ? await normalizeByCropRectCanvas(src, preset, settings.rect)
      : await normalizeByCropCanvas(src, preset, settings)
  }
  return analysis?.aspectStatus === 'crop'
    ? await containOnBackgroundCanvas(src, preset, bg, settings.containOffset)
    : await resizeExactCanvas(src, preset)
}

const renderBaseNormalizeCanvas = async ({ src, preset, analysis, settings = {}, fallbackMode = 'auto', background = '#ffffff' }) => {
  const mode = settings.mode || fallbackMode
  const bg = settings.bgColor || analysis?.bgColor || background
  if (mode === 'contain') return await containOnBackgroundCanvas(src, preset, bg, settings.containOffset)
  if (mode === 'crop' || (mode === 'auto' && analysis?.aspectStatus === 'crop')) {
    return settings.rect
      ? await normalizeByCropRectCanvas(src, preset, settings.rect)
      : await normalizeByCropCanvas(src, preset, settings)
  }
  return await resizeExactCanvas(src, preset)
}

const estimateSubjectBoundsFromCanvas = (canvas, background = '#ffffff') => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const bg = typeof background === 'string'
    ? { r: 255, g: 255, b: 255 }
    : background
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4
      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]
      const a = data[index + 3]
      const avg = (r + g + b) / 3
      const spread = Math.max(r, g, b) - Math.min(r, g, b)
      const distToBg = Math.hypot(r - bg.r, g - bg.g, b - bg.b)
      const isBg = a < 8 || (avg > 225 && spread < 38) || distToBg < 42
      if (!isBg) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return { x: width * 0.08, y: height * 0.08, w: width * 0.84, h: height * 0.84 }
  const bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  if (bounds.w < width * 0.08 || bounds.h < height * 0.08) return { x: width * 0.08, y: height * 0.08, w: width * 0.84, h: height * 0.84 }
  return bounds
}

const analyzeFilesForPreset = async (files, preset, targetFillRatio) => {
  const targetRatio = preset.w / preset.h
  const rows = []
  for (let index = 0; index < files.length; index++) {
    const item = files[index]
    const meta = await getImageMeta(item)
    const sourceRatio = meta.width / meta.height
    const aspectDiff = Math.abs(sourceRatio - targetRatio) / targetRatio
    const subject = await estimateWhiteSubjectInfo(meta.src)
    const fillStatus = !subject.isWhiteBg
      ? 'skip'
      : subject.subjectRatio < targetFillRatio - 8
        ? 'low'
        : subject.subjectRatio > targetFillRatio + 10
          ? 'high'
          : 'ok'
    rows.push({
      id: `${item.name}_${item.size}_${item.lastModified}`,
      file: item,
      name: item.name,
      size: item.size,
      width: meta.width,
      height: meta.height,
      src: meta.src,
      aspectStatus: aspectDiff <= 0.015 ? 'match' : 'crop',
      aspectDiff,
      isWhiteBg: subject.isWhiteBg,
      subjectRatio: subject.subjectRatio,
      bounds: subject.bounds,
      bgColor: subject.bgColor,
      fillStatus,
      sizeStatus: preset.maxBytes && item.size > preset.maxBytes ? 'large' : 'ok',
    })
  }
  return rows
}

const exportCompliantBlob = async (canvas, preset, formatId) => {
  const requested = getFormat(formatId)
  const canCompress = requested.mime !== 'image/png'
  const tryExport = async (format, quality) => ({
    blob: await canvasToBlob(canvas, format.mime, quality),
    format,
    quality,
  })

  if (!preset.maxBytes) return tryExport(requested, requested.quality)

  if (requested.mime === 'image/png') {
    const png = await tryExport(requested)
    if (png.blob.size <= preset.maxBytes) return png
    const jpeg = getFormat('jpeg')
    let best = await tryExport(jpeg, 0.92)
    for (let quality = 0.86; best.blob.size > preset.maxBytes && quality >= 0.62; quality -= 0.06) {
      best = await tryExport(jpeg, Number(quality.toFixed(2)))
    }
    return best
  }

  let best = await tryExport(requested, requested.quality || 0.92)
  if (!canCompress) return best
  for (let quality = 0.86; best.blob.size > preset.maxBytes && quality >= 0.58; quality -= 0.04) {
    best = await tryExport(requested, Number(quality.toFixed(2)))
  }
  return best
}

const prepareImageForCutout = async (src, preset, oversample = 1.35) => {
  const img = await readImage(src)
  const targetLong = Math.max(preset.w, preset.h)
  const sourceLong = Math.max(img.width, img.height)
  const processLong = Math.min(sourceLong, Math.max(targetLong * oversample, targetLong + 240, 1200))
  const scale = Math.min(1, processLong / sourceLong)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * scale))
  canvas.height = Math.max(1, Math.round(img.height * scale))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95)
  return {
    blob,
    dataUrl: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
  }
}

const colorDistance = (data, index, color) => {
  const dr = data[index] - color.r
  const dg = data[index + 1] - color.g
  const db = data[index + 2] - color.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

const estimateCornerBackground = (data, width, height) => {
  const points = [
    [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1],
    [Math.floor(width * 0.04), Math.floor(height * 0.04)],
    [Math.floor(width * 0.96), Math.floor(height * 0.04)],
    [Math.floor(width * 0.04), Math.floor(height * 0.96)],
    [Math.floor(width * 0.96), Math.floor(height * 0.96)],
  ]
  const colors = points.map(([x, y]) => {
    const i = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4
    return { r: data[i], g: data[i + 1], b: data[i + 2] }
  })
  const avg = colors.reduce((sum, color) => ({
    r: sum.r + color.r,
    g: sum.g + color.g,
    b: sum.b + color.b,
  }), { r: 0, g: 0, b: 0 })
  return {
    r: avg.r / colors.length,
    g: avg.g / colors.length,
    b: avg.b / colors.length,
  }
}

const isBackgroundPixel = (data, index, bg, threshold) => {
  const dist = colorDistance(data, index, bg)
  const bright = (data[index] + data[index + 1] + data[index + 2]) / 3
  const sat = Math.max(data[index], data[index + 1], data[index + 2]) - Math.min(data[index], data[index + 1], data[index + 2])
  return dist < threshold || (bright > 242 && sat < 30)
}

const localCutoutCanvas = async (src, threshold = 62) => {
  const source = await imageToCanvas(src)
  const ctx = source.getContext('2d', { willReadFrequently: true })
  const imageData = ctx.getImageData(0, 0, source.width, source.height)
  const { data, width, height } = imageData
  const bg = estimateCornerBackground(data, width, height)
  const visited = new Uint8Array(width * height)
  const queue = []

  for (let x = 0; x < width; x += 3) {
    queue.push([x, 0], [x, height - 1])
  }
  for (let y = 0; y < height; y += 3) {
    queue.push([0, y], [width - 1, y])
  }

  while (queue.length) {
    const [x, y] = queue.pop()
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    const pixel = y * width + x
    if (visited[pixel]) continue
    visited[pixel] = 1
    const index = pixel * 4
    if (!isBackgroundPixel(data, index, bg, threshold)) continue
    data[index + 3] = 0
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const pixel = y * width + x
      const index = pixel * 4
      if (data[index + 3] === 0) continue
      let transparentNeighbors = 0
      if (data[(pixel - 1) * 4 + 3] === 0) transparentNeighbors++
      if (data[(pixel + 1) * 4 + 3] === 0) transparentNeighbors++
      if (data[(pixel - width) * 4 + 3] === 0) transparentNeighbors++
      if (data[(pixel + width) * 4 + 3] === 0) transparentNeighbors++
      if (transparentNeighbors >= 2 && isBackgroundPixel(data, index, bg, threshold * 1.25)) data[index + 3] = 80
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return source
}

const getAlphaBounds = (canvas) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, w: width, h: height }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

const composeProductCanvas = async ({ cutoutSrc, preset, fillRatio = 0.78, shadow = 8 }) => {
  const cutout = typeof cutoutSrc === 'string' ? await imageToCanvas(cutoutSrc) : cutoutSrc
  const bounds = getAlphaBounds(cutout)
  const canvas = document.createElement('canvas')
  canvas.width = preset.w
  canvas.height = preset.h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, preset.w, preset.h)
  const targetW = preset.w * fillRatio
  const targetH = preset.h * fillRatio
  const scale = Math.min(targetW / bounds.w, targetH / bounds.h)
  const dw = Math.max(1, Math.round(bounds.w * scale))
  const dh = Math.max(1, Math.round(bounds.h * scale))
  const dx = Math.round((preset.w - dw) / 2)
  const dy = Math.round((preset.h - dh) / 2)

  if (shadow > 0) {
    ctx.save()
    ctx.shadowColor = 'rgba(15, 23, 42, .18)'
    ctx.shadowBlur = shadow
    ctx.shadowOffsetY = Math.round(shadow * 0.45)
    ctx.drawImage(cutout, bounds.x, bounds.y, bounds.w, bounds.h, dx, dy, dw, dh)
    ctx.restore()
  }
  ctx.drawImage(cutout, bounds.x, bounds.y, bounds.w, bounds.h, dx, dy, dw, dh)
  return { canvas, placement: { sx: bounds.x, sy: bounds.y, sw: bounds.w, sh: bounds.h, dx, dy, dw, dh } }
}

const buildAlignedSourceCanvas = async (src, preset, placement) => {
  if (!src || !placement) return null
  const source = typeof src === 'string' ? await imageToCanvas(src) : src
  const canvas = document.createElement('canvas')
  canvas.width = preset.w
  canvas.height = preset.h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, preset.w, preset.h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    source,
    placement.sx,
    placement.sy,
    placement.sw,
    placement.sh,
    placement.dx,
    placement.dy,
    placement.dw,
    placement.dh,
  )
  return canvas
}


export default function BackgroundTool({ navigate }) {
  const fileRef = useRef(null)
  const batchFileRef = useRef(null)
  const batchFolderRef = useRef(null)
  const resultCanvasRef = useRef(null)
  const containPreviewRef = useRef(null)
  const fillPreviewCanvasRef = useRef(null)
  const subjectBaseCanvasRef = useRef(null)
  const normalizeCropStageRef = useRef(null)
  const subjectStageRef = useRef(null)
  const editStateRef = useRef({ drawing: false, snapshot: null })
  const sourceCanvasRef = useRef(null)
  const [file, setFile] = useState(null)
  const [batchFiles, setBatchFiles] = useState([])
  const [preview, setPreview] = useState('')
  const [result, setResult] = useState('')
  const [resultMode, setResultMode] = useState('empty')
  const [resultBlob, setResultBlob] = useState(null)
  const [resultSize, setResultSize] = useState(0)
  const [normalizePresetId, setNormalizePresetId] = useState('universal-main')
  const [normalizeFillRatio, setNormalizeFillRatio] = useState(82)
  const [, setNormalizeMode] = useState('auto')
  const [normalizePanel, setNormalizePanel] = useState('summary')
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 1, h: 1 })
  const [cropDrag, setCropDrag] = useState(null)
  const [subjectRect, setSubjectRect] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
  const [subjectDrag, setSubjectDrag] = useState(null)
  const [containDrag, setContainDrag] = useState(null)
  const [colorPickerEnabled, setColorPickerEnabled] = useState(false)
  const [globalBgColor, setGlobalBgColor] = useState('#ffffff')
  const [selectedReviewIndex, setSelectedReviewIndex] = useState(0)
  const [cropOverrides, setCropOverrides] = useState({})
  const [justConfirmedId, setJustConfirmedId] = useState('')
  const [subjectCanvasReadyKey, setSubjectCanvasReadyKey] = useState(0)
  const [batchAnalysis, setBatchAnalysis] = useState([])
  const [presetId, setPresetId] = useState('white-universal')
  const [method, setMethod] = useState('removebg')
  const [fillRatio, setFillRatio] = useState(82)
  const [shadow, setShadow] = useState(8)
  const [outputFormat, setOutputFormat] = useState('jpeg')
  const preprocessScale = 1.18
  const [preparedInfo, setPreparedInfo] = useState(null)
  const [brushMode, setBrushMode] = useState('erase')
  const [brushSize, setBrushSize] = useState(36)
  const [brushPoint, setBrushPoint] = useState(null)
  const [bgStrength, setBgStrength] = useState(62)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [cutoutUrl, setCutoutUrl] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [, setComposeInfo] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [cutoutStatus, setCutoutStatus] = useState('')
  const [normalizeStatus, setNormalizeStatus] = useState('')
  const [cutoutError, setCutoutError] = useState('')
  const [normalizeError, setNormalizeError] = useState('')
  const [survey, setSurvey] = useState({
    want: 'unsure',
    service: 'removebg',
    price: 'basic_19_20',
    plan: 'basic_19_20',
    batchNeed: 'sometimes',
    monthlyVolume: '11-50',
    contact: '',
    note: '',
  })
  const [surveyStatus, setSurveyStatus] = useState('')

  const normalizePreset = useMemo(() => NORMALIZE_PRESETS.find(item => item.id === normalizePresetId) || NORMALIZE_PRESETS[0], [normalizePresetId])
  const preset = useMemo(() => WHITE_BG_PRESETS.find(item => item.id === presetId) || WHITE_BG_PRESETS[0], [presetId])
  const analysisStats = useMemo(() => {
    const matched = batchAnalysis.filter(item => item.aspectStatus === 'match').length
    const needsCrop = batchAnalysis.filter(item => item.aspectStatus === 'crop').length
    const fillIssue = batchAnalysis.filter(item => item.fillStatus === 'low' || item.fillStatus === 'high').length
    const needsBoth = batchAnalysis.filter(item => item.aspectStatus === 'crop' && (item.fillStatus === 'low' || item.fillStatus === 'high')).length
    const whiteCount = batchAnalysis.filter(item => item.isWhiteBg).length
    const confirmed = batchAnalysis.filter(item => cropOverrides[item.id]?.confirmed).length
    return { matched, needsCrop, fillIssue, needsBoth, whiteCount, confirmed }
  }, [batchAnalysis, cropOverrides])
  const selectedReview = batchAnalysis[selectedReviewIndex]
  const selectedOverride = selectedReview ? cropOverrides[selectedReview.id] || {} : {}
  const selectedMode = selectedOverride.mode || (selectedReview?.aspectStatus === 'crop' ? 'crop' : 'auto')
  const selectedFillProblem = selectedReview ? selectedReview.fillStatus === 'low' || selectedReview.fillStatus === 'high' : false
  const showSubjectEditor = Boolean(selectedReview && (selectedReview.isWhiteBg || selectedOverride.forceWhiteBg || selectedFillProblem))
  const getDisplayedSubjectRatio = useCallback((item) => {
    const override = cropOverrides[item.id]
    if (override?.subjectRect) return getSubjectRatioFromRect(override.subjectRect)
    if (override?.subjectBounds) return Math.round(Math.max(override.subjectBounds.w / normalizePreset.w, override.subjectBounds.h / normalizePreset.h) * 100)
    return item.subjectRatio
  }, [cropOverrides, normalizePreset])

  const updateSelectedOverride = useCallback((patch) => {
    if (!selectedReview) return
    setCropOverrides(data => ({
      ...data,
      [selectedReview.id]: {
        ...(data[selectedReview.id] || {}),
        ...patch,
        confirmed: false,
      },
    }))
  }, [selectedReview])

  const getItemIssue = useCallback((item) => {
    const fillProblem = item.fillStatus === 'low' || item.fillStatus === 'high'
    if (item.aspectStatus === 'crop' && fillProblem) return { label: '裁切+占比', tone: 'text-fuchsia-600', badge: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' }
    if (item.aspectStatus === 'crop') return { label: '仅裁切', tone: 'text-amber-600', badge: 'border-amber-200 bg-amber-50 text-amber-700' }
    if (fillProblem) return { label: '仅占比', tone: 'text-red-600', badge: 'border-red-200 bg-red-50 text-red-700' }
    return { label: '待确认', tone: 'text-slate-500', badge: 'border-slate-200 bg-slate-50 text-slate-600' }
  }, [])

  const setSubjectBaseCanvas = useCallback((node) => {
    subjectBaseCanvasRef.current = node
    if (node) setSubjectCanvasReadyKey(value => value + 1)
  }, [])

  useEffect(() => {
    if (batchFolderRef.current) batchFolderRef.current.setAttribute('webkitdirectory', '')
  }, [])

  useEffect(() => {
    if (!selectedReview) return
    const ratio = normalizePreset.w / normalizePreset.h
    const defaultRect = getDefaultCropRectForRatio(selectedReview.width, selectedReview.height, ratio)
    const saved = cropOverrides[selectedReview.id]?.rect
    setCropRect(normalizeCropRect(saved || defaultRect))
  }, [cropOverrides, normalizePreset, selectedReview])

  useEffect(() => {
    if (!selectedReview) return
    const saved = cropOverrides[selectedReview.id]?.subjectRect
    setSubjectRect(normalizeCropRect(saved || { x: 0.08, y: 0.08, w: 0.84, h: 0.84 }))
  }, [cropOverrides, selectedReview])

  const updateNormalizeCropFromPointer = useCallback((event) => {
    if (!cropDrag || !normalizeCropStageRef.current || !selectedReview) return
    const bounds = normalizeCropStageRef.current.getBoundingClientRect()
    const dx = (event.clientX - cropDrag.startX) / bounds.width
    const dy = (event.clientY - cropDrag.startY) / bounds.height
    const next = normalizeCropRect({
      ...cropDrag.startRect,
      x: cropDrag.startRect.x + dx,
      y: cropDrag.startRect.y + dy,
    })
    setCropRect(next)
    setCropOverrides(data => ({
      ...data,
      [selectedReview.id]: {
        ...(data[selectedReview.id] || {}),
        rect: next,
        mode: 'crop',
        confirmed: false,
      },
    }))
  }, [cropDrag, selectedReview])

  useEffect(() => {
    if (!cropDrag) return undefined
    const handleMove = (event) => updateNormalizeCropFromPointer(event)
    const handleUp = () => setCropDrag(null)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [cropDrag, updateNormalizeCropFromPointer])

  const updateSubjectRectFromPointer = useCallback((event) => {
    if (!subjectDrag || !subjectStageRef.current || !selectedReview) return
    const bounds = subjectStageRef.current.getBoundingClientRect()
    const dx = (event.clientX - subjectDrag.startX) / bounds.width
    const dy = (event.clientY - subjectDrag.startY) / bounds.height
    const next = subjectDrag.mode === 'move'
      ? normalizeCropRect({
        ...subjectDrag.startRect,
        x: subjectDrag.startRect.x + dx,
        y: subjectDrag.startRect.y + dy,
      })
      : resizeRectFromHandle(subjectDrag.startRect, subjectDrag.mode, dx, dy)
    setSubjectRect(next)
    setCropOverrides(data => ({
      ...data,
      [selectedReview.id]: {
        ...(data[selectedReview.id] || {}),
        subjectRect: next,
        subjectBounds: rectToBounds(next, normalizePreset.w, normalizePreset.h),
        confirmed: false,
      },
    }))
  }, [normalizePreset, selectedReview, subjectDrag])

  useEffect(() => {
    if (!subjectDrag) return undefined
    const handleMove = (event) => updateSubjectRectFromPointer(event)
    const handleUp = () => setSubjectDrag(null)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [subjectDrag, updateSubjectRectFromPointer])

  const updateContainOffsetFromPointer = useCallback((event) => {
    if (!containDrag || !fillPreviewCanvasRef.current || !selectedReview) return
    const bounds = fillPreviewCanvasRef.current.getBoundingClientRect()
    const dx = (event.clientX - containDrag.startX) / bounds.width
    const dy = (event.clientY - containDrag.startY) / bounds.height
    const next = {
      x: clamp(containDrag.startOffset.x + dx, 0, 1),
      y: clamp(containDrag.startOffset.y + dy, 0, 1),
    }
    updateSelectedOverride({ containOffset: next, mode: 'contain' })
  }, [containDrag, selectedReview, updateSelectedOverride])

  useEffect(() => {
    if (!containDrag) return undefined
    const handleMove = (event) => updateContainOffsetFromPointer(event)
    const handleUp = () => setContainDrag(null)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [containDrag, updateContainOffsetFromPointer])

  const sampleContainBackground = useCallback(async (event) => {
    if (!colorPickerEnabled || !selectedReview) return
    const targetEl = event.currentTarget
    const rect = targetEl.getBoundingClientRect()
    try {
      const canvas = targetEl instanceof HTMLCanvasElement ? targetEl : await imageToCanvas(selectedReview.src)
      const x = Math.round(((event.clientX - rect.left) / rect.width) * canvas.width)
      const y = Math.round(((event.clientY - rect.top) / rect.height) * canvas.height)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const px = ctx.getImageData(clamp(x, 0, canvas.width - 1), clamp(y, 0, canvas.height - 1), 1, 1).data
      const color = { r: px[0], g: px[1], b: px[2] }
      setCropOverrides(data => ({
        ...data,
        [selectedReview.id]: {
          ...(data[selectedReview.id] || {}),
          bgColor: color,
          confirmed: false,
        },
      }))
      setColorPickerEnabled(false)
    } catch {
      setColorPickerEnabled(false)
    }
  }, [colorPickerEnabled, selectedReview])

  useEffect(() => {
    if (!['crop', 'fill', 'edit'].includes(normalizePanel) || !selectedReview || !fillPreviewCanvasRef.current) return
    let cancelled = false
    const drawPreview = async () => {
      try {
        const settings = cropOverrides[selectedReview.id] || {}
        const background = settings.bgColor || selectedReview.bgColor || globalBgColor
        const { canvas: baseCanvas } = await renderBaseNormalizeCanvas({
          src: selectedReview.src,
          preset: normalizePreset,
          analysis: selectedReview,
          settings,
          fallbackMode: selectedMode,
          background: globalBgColor,
        })
        if (cancelled) return
        if (showSubjectEditor && subjectBaseCanvasRef.current) {
          subjectBaseCanvasRef.current.width = baseCanvas.width
          subjectBaseCanvasRef.current.height = baseCanvas.height
          subjectBaseCanvasRef.current.getContext('2d').drawImage(baseCanvas, 0, 0)
        }
        let canvas = baseCanvas
        if (showSubjectEditor) {
          const autoBounds = estimateSubjectBoundsFromCanvas(baseCanvas, background)
          const subjectBounds = settings.subjectRect
            ? rectToBounds(settings.subjectRect, baseCanvas.width, baseCanvas.height)
            : settings.subjectBounds || autoBounds
          if (!settings.subjectRect && !settings.subjectBounds) {
            const nextRect = boundsToRect(subjectBounds, baseCanvas.width, baseCanvas.height)
            setSubjectRect(current => {
              const changed = Math.abs(current.x - nextRect.x) + Math.abs(current.y - nextRect.y) + Math.abs(current.w - nextRect.w) + Math.abs(current.h - nextRect.h) > 0.01
              return changed ? nextRect : current
            })
          }
          canvas = scaleCanvasBySubjectBounds(baseCanvas, normalizePreset, subjectBounds, normalizeFillRatio / 100, background).canvas
        }
        if (cancelled || !fillPreviewCanvasRef.current) return
        const target = fillPreviewCanvasRef.current
        target.width = canvas.width
        target.height = canvas.height
        target.getContext('2d').drawImage(canvas, 0, 0)
      } catch {
        // Keep the current preview if decoding is interrupted.
      }
    }
    drawPreview()
    return () => { cancelled = true }
  }, [cropOverrides, globalBgColor, normalizeFillRatio, normalizePanel, normalizePreset, selectedMode, selectedReview, showSubjectEditor, subjectCanvasReadyKey])

  const handlePresetChange = useCallback((nextPresetId) => {
    const nextPreset = WHITE_BG_PRESETS.find(item => item.id === nextPresetId) || WHITE_BG_PRESETS[0]
    setPresetId(nextPreset.id)
    setFillRatio(nextPreset.fill)
  }, [])

  const handleNormalizePresetChange = useCallback((nextPresetId) => {
    const nextPreset = NORMALIZE_PRESETS.find(item => item.id === nextPresetId) || NORMALIZE_PRESETS[0]
    setNormalizePresetId(nextPreset.id)
    setNormalizeFillRatio(nextPreset.fill)
  }, [])

  useEffect(() => {
    if (!result || result === 'canvas' || !resultCanvasRef.current) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled || !resultCanvasRef.current) return
      const canvas = resultCanvasRef.current
      canvas.width = img.width
      canvas.height = img.height
      canvas.getContext('2d').drawImage(img, 0, 0)
    }
    img.src = result
    return () => { cancelled = true }
  }, [result])

  const handleFile = useCallback(async (nextFile, syncBatch = true) => {
    if (!nextFile) return
    revokeObjectUrl(result)
    revokeObjectUrl(cutoutUrl)
    setResult('')
    setResultMode('empty')
    sourceCanvasRef.current = null
    setCutoutUrl('')
    setSourceUrl('')
    setPreparedInfo(null)
    setComposeInfo(null)
    setBrushPoint(null)
    setPreviewZoom(1)
    setResultBlob(null)
    setResultSize(0)
    setCutoutError('')
    setCutoutStatus('')
    setFile(nextFile)
    if (syncBatch) setBatchFiles([nextFile])
    const dataUrl = await readFileAsDataUrl(nextFile)
    setPreview(dataUrl)
    trackEvent('image_uploaded', { tool: 'product_image', count: 1 })
  }, [cutoutUrl, result])

  const handleFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []).filter(item => item.type.startsWith('image/'))
    if (!files.length) return
    await handleFile(files[0], false)
    if (files.length > 1) setCutoutStatus(`已选择第 1 张用于白底抠图；抠图功能当前按单张处理。`)
  }, [handleFile])

  const handleNormalizeFiles = useCallback(async (fileList) => {
    const allFiles = Array.from(fileList || []).filter(item => item.type.startsWith('image/'))
    const files = allFiles.slice(0, MAX_BATCH_NORMALIZE_FILES)
    if (!files.length) return
    setBatchAnalysis([])
    setCropOverrides({})
    setSelectedReviewIndex(0)
    setBatchFiles(files)
    setNormalizePanel('summary')
    setNormalizeError('')
    setNormalizeStatus(allFiles.length > MAX_BATCH_NORMALIZE_FILES
      ? `一次最多批量处理 ${MAX_BATCH_NORMALIZE_FILES} 张，已自动取前 ${MAX_BATCH_NORMALIZE_FILES} 张；剩余图片请分批处理。`
      : `已选择 ${files.length} 张用于商品图规范化缩放；不会调用抠图 API。`)
  }, [])

  const handleNormalizeFolderSelect = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
        const dirHandle = await window.showDirectoryPicker()
        const allFiles = []
        const collectFiles = async (handle) => {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
              const nextFile = await entry.getFile()
              if (nextFile.type.startsWith('image/')) allFiles.push(nextFile)
            } else if (entry.kind === 'directory') {
              await collectFiles(entry)
            }
          }
        }
        await collectFiles(dirHandle)
        if (allFiles.length > 0) await handleNormalizeFiles(allFiles)
      } else {
        batchFolderRef.current?.click()
      }
    } catch (error) {
      if (error?.name !== 'AbortError') batchFolderRef.current?.click()
    }
  }, [handleNormalizeFiles])

  const analyzeNormalizeFiles = useCallback(async () => {
    if (!batchFiles.length) return
    setProcessing(true)
    setNormalizeError('')
    setNormalizeStatus(`正在识别 ${batchFiles.length} 张图片的比例、体积和白底主体占比...`)
    try {
      const rows = await analyzeFilesForPreset(batchFiles, normalizePreset, normalizeFillRatio)
      setBatchAnalysis(rows)
      setSelectedReviewIndex(0)
      const matched = rows.filter(item => item.aspectStatus === 'match').length
      const crop = rows.length - matched
      const whiteIssue = rows.filter(item => item.fillStatus === 'low' || item.fillStatus === 'high').length
      if (crop > 0 || whiteIssue > 0) setNormalizePanel('edit')
      else setNormalizePanel('summary')
      setNormalizeStatus(`识别完成：${matched} 张比例匹配可直接缩放，${crop} 张需要裁切，${whiteIssue} 张白底主体占比建议调整。`)
    } catch (err) {
      setNormalizeError(err?.message || '筛选识别失败')
    } finally {
      setProcessing(false)
    }
  }, [batchFiles, normalizeFillRatio, normalizePreset])

  const confirmSelectedNormalize = useCallback(() => {
    if (!selectedReview) return
    const mode = selectedMode
    const patch = {
      mode,
      bgColor: selectedOverride.bgColor || selectedReview.bgColor || globalBgColor,
      rect: selectedOverride.rect || cropRect,
      subjectRect,
      subjectBounds: selectedOverride.subjectBounds || rectToBounds(subjectRect, normalizePreset.w, normalizePreset.h),
      containOffset: selectedOverride.containOffset || { x: 0.5, y: 0.5 },
      forceWhiteBg: selectedOverride.forceWhiteBg || selectedReview.isWhiteBg,
      confirmed: true,
    }
    setCropOverrides(data => ({
      ...data,
      [selectedReview.id]: {
        ...(data[selectedReview.id] || {}),
        ...patch,
      },
    }))
    setNormalizeStatus(`已确认：${selectedReview.name}`)
    setJustConfirmedId(selectedReview.id)
    window.setTimeout(() => {
      setJustConfirmedId(current => current === selectedReview.id ? '' : current)
    }, 1200)
  }, [cropRect, globalBgColor, normalizePreset, selectedMode, selectedOverride, selectedReview, subjectRect])

  const confirmAllNormalize = useCallback(() => {
    if (!batchAnalysis.length) return
    setCropOverrides(data => {
      const next = { ...data }
      batchAnalysis.forEach(item => {
        const current = next[item.id] || {}
        const defaultRect = getDefaultCropRectForRatio(item.width, item.height, normalizePreset.w / normalizePreset.h)
        const defaultSubjectRect = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 }
        next[item.id] = {
          ...current,
          mode: current.mode || (item.aspectStatus === 'crop' ? 'crop' : 'auto'),
          bgColor: current.bgColor || item.bgColor || globalBgColor,
          rect: current.rect || defaultRect,
          subjectRect: current.subjectRect || defaultSubjectRect,
          subjectBounds: current.subjectBounds || rectToBounds(current.subjectRect || defaultSubjectRect, normalizePreset.w, normalizePreset.h),
          containOffset: current.containOffset || { x: 0.5, y: 0.5 },
          forceWhiteBg: current.forceWhiteBg || item.isWhiteBg,
          confirmed: true,
        }
      })
      return next
    })
    setNormalizeStatus(`已批量确认 ${batchAnalysis.length} 张图片，可以批量规范下载。`)
  }, [batchAnalysis, globalBgColor, normalizePreset])

  const runApiCutout = useCallback(async (imageBlob, fileName = file?.name || 'product.jpg') => {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('FILE_READ_FAILED'))
      reader.readAsDataURL(imageBlob)
    })
    const endpoint = '/api/remove-bg/removebg'
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: String(dataUrl).split(',')[1],
        fileName,
        mimeType: imageBlob.type || 'image/jpeg',
      }),
    })
    const contentType = response.headers.get('content-type') || ''
    if (!response.ok) {
      const body = contentType.includes('application/json') ? await response.json() : { error: await response.text() }
      const error = new Error(body.message || body.error || 'REMOVEBG_FAILED')
      error.code = body.error
      throw error
    }
    return await response.blob()
  }, [file])

  const updateBrushPoint = useCallback((event) => {
    const canvas = resultCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    setBrushPoint({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      r: brushSize * (rect.width / canvas.width),
    })
  }, [brushSize])

  const paintToResult = useCallback(async (event) => {
    updateBrushPoint(event)
    const canvas = resultCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = (event.clientX - rect.left) * (canvas.width / rect.width)
    const y = (event.clientY - rect.top) * (canvas.height / rect.height)
    const ctx = canvas.getContext('2d')
    const r = brushSize
    if (brushMode === 'erase') {
      ctx.save()
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else {
      let source = sourceCanvasRef.current
      if (!source && sourceUrl) {
        source = await buildAlignedSourceCanvas(sourceUrl, { w: canvas.width, h: canvas.height }, {
          sx: 0,
          sy: 0,
          sw: canvas.width,
          sh: canvas.height,
          dx: 0,
          dy: 0,
          dw: canvas.width,
          dh: canvas.height,
        })
        sourceCanvasRef.current = source
      }
      if (!source) return
      ctx.save()
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
      ctx.restore()
    }
    setResult('canvas')
    setResultMode('edited')
  }, [brushMode, brushSize, sourceUrl, updateBrushPoint])

  const startBrush = useCallback((event) => {
    updateBrushPoint(event)
    if (!resultCanvasRef.current || resultMode === 'empty' || resultMode === 'prepared') return
    event.currentTarget?.setPointerCapture?.(event.pointerId)
    editStateRef.current.drawing = true
    paintToResult(event)
  }, [paintToResult, resultMode, updateBrushPoint])

  const moveBrush = useCallback((event) => {
    updateBrushPoint(event)
    if (!editStateRef.current.drawing) return
    paintToResult(event)
  }, [paintToResult, updateBrushPoint])

  const stopBrush = useCallback(async (event) => {
    if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const wasDrawing = editStateRef.current.drawing
    editStateRef.current.drawing = false
    const canvas = resultCanvasRef.current
    if (!wasDrawing || !canvas) return
    const blob = await canvasToBlob(canvas, 'image/png')
    setResultBlob(blob)
    setResultSize(blob.size)
  }, [])

  const recomposeFromCutout = useCallback(async () => {
    if (!cutoutUrl) return
    setCutoutError('')
    try {
      const { canvas, placement } = await composeProductCanvas({ cutoutSrc: cutoutUrl, preset, fillRatio: fillRatio / 100, shadow })
      const { blob } = await exportCompliantBlob(canvas, preset, outputFormat)
      sourceCanvasRef.current = await buildAlignedSourceCanvas(sourceUrl || preview, preset, placement)
      setResult('canvas')
      setResultMode('cutout')
      setResultBlob(blob)
      setResultSize(blob.size)
      setComposeInfo(placement)
      const resultCanvas = resultCanvasRef.current
      if (resultCanvas) {
        resultCanvas.width = canvas.width
        resultCanvas.height = canvas.height
        resultCanvas.getContext('2d').drawImage(canvas, 0, 0)
      }
    } catch (err) {
      setCutoutError(err?.message || '重新生成失败')
    }
  }, [cutoutUrl, fillRatio, outputFormat, preset, preview, shadow, sourceUrl])

  const handlePrepareForApi = useCallback(async () => {
    if (!preview) return null
    setProcessing(true)
    setCutoutError('')
    setCutoutStatus('正在按所选尺寸预处理图片...')
    try {
      revokeObjectUrl(preparedInfo?.dataUrl)
      const prepared = await prepareImageForCutout(preview, preset, preprocessScale)
      setPreparedInfo(prepared)
      setResult('canvas')
      setResultMode('prepared')
      setResultBlob(prepared.blob)
      setResultSize(prepared.blob.size)
      requestAnimationFrame(async () => {
        const canvas = resultCanvasRef.current
        if (!canvas) return
        const preparedCanvas = await imageToCanvas(prepared.dataUrl)
        canvas.width = preparedCanvas.width
        canvas.height = preparedCanvas.height
        canvas.getContext('2d').drawImage(preparedCanvas, 0, 0)
      })
      setCutoutStatus(`已生成用于抠图的临时图：${prepared.width} x ${prepared.height}`)
      return prepared
    } catch (err) {
      setCutoutError(err?.message || '预处理失败')
      return null
    } finally {
      setProcessing(false)
    }
  }, [preparedInfo?.dataUrl, preset, preprocessScale, preview])

  useEffect(() => {
    if (!cutoutUrl || !resultBlob || resultMode === 'prepared') return undefined
    const timer = window.setTimeout(() => {
      recomposeFromCutout()
    }, 60)
    return () => window.clearTimeout(timer)
  }, [fillRatio, shadow, presetId])

  useEffect(() => {
    if (method !== 'local-white' || !preview || resultMode === 'prepared' || resultMode === 'edited') return undefined
    const timer = window.setTimeout(async () => {
      try {
        const cutoutCanvas = await localCutoutCanvas(preview, bgStrength)
        const cutoutBlob = await canvasToBlob(cutoutCanvas, 'image/png')
        const nextCutoutUrl = URL.createObjectURL(cutoutBlob)
        const { canvas, placement } = await composeProductCanvas({ cutoutSrc: cutoutCanvas, preset, fillRatio: fillRatio / 100, shadow })
        const { blob } = await exportCompliantBlob(canvas, preset, outputFormat)
        sourceCanvasRef.current = await buildAlignedSourceCanvas(preview, preset, placement)
        revokeObjectUrl(cutoutUrl)
        setCutoutUrl(nextCutoutUrl)
        setSourceUrl(preview)
        setComposeInfo(placement)
        setResult('canvas')
        setResultMode('cutout')
        setResultBlob(blob)
        setResultSize(blob.size)
        const resultCanvas = resultCanvasRef.current
        if (resultCanvas) {
          resultCanvas.width = canvas.width
          resultCanvas.height = canvas.height
          resultCanvas.getContext('2d').drawImage(canvas, 0, 0)
        }
      } catch {
        // Keep the current preview stable while the user is dragging.
      }
    }, 120)
    return () => window.clearTimeout(timer)
  }, [bgStrength, fillRatio, method, outputFormat, preset, preview, resultMode, shadow])

  const handleProcess = useCallback(async () => {
    if (!file || !preview) return
    setProcessing(true)
    setCutoutError('')
    setCutoutStatus(method === 'removebg' ? '正在调用 AI 抠图...' : '正在清理纯色背景并生成白底图...')
    try {
      let cutoutSource
      let sourceForBrush = preview
      if (method === 'removebg') {
        const prepared = preparedInfo || await prepareImageForCutout(preview, preset, preprocessScale)
        if (!preparedInfo) setPreparedInfo(prepared)
        const cutoutBlob = await runApiCutout(prepared.blob, `${getBaseName(file.name)}_prepared.jpg`)
        cutoutSource = URL.createObjectURL(cutoutBlob)
        sourceForBrush = prepared.dataUrl
      } else if (method === 'local-white') {
        cutoutSource = await localCutoutCanvas(preview, bgStrength)
        sourceForBrush = preview
      }
      const { canvas, placement } = await composeProductCanvas({ cutoutSrc: cutoutSource, preset, fillRatio: fillRatio / 100, shadow })
      const { blob, format } = await exportCompliantBlob(canvas, preset, outputFormat)
      const storedCutoutUrl = typeof cutoutSource === 'string' ? cutoutSource : URL.createObjectURL(await canvasToBlob(cutoutSource, 'image/png'))
      sourceCanvasRef.current = await buildAlignedSourceCanvas(sourceForBrush, preset, placement)
      revokeObjectUrl(cutoutUrl)
      setCutoutUrl(storedCutoutUrl)
      setSourceUrl(sourceForBrush)
      setComposeInfo(placement)
      setResult('canvas')
      setResultMode('cutout')
      setResultBlob(blob)
      setResultSize(blob.size)
      requestAnimationFrame(() => {
        const resultCanvas = resultCanvasRef.current
        if (resultCanvas) {
          resultCanvas.width = canvas.width
          resultCanvas.height = canvas.height
          resultCanvas.getContext('2d').drawImage(canvas, 0, 0)
        }
      })
      setCutoutStatus(`${method === 'removebg' ? 'AI 抠图完成' : '已生成白底规范图'}，输出 ${preset.w} x ${preset.h}，${format.label}，${formatBytes(blob.size)}${preset.maxBytes ? ` / 上限 ${formatBytes(preset.maxBytes)}` : ''}。`)
      trackEvent('process_success', { tool: 'product_image', method, preset: preset.id })
    } catch (err) {
      const message = err?.message || '处理失败'
      const friendly = err?.code === 'DAILY_FREE_LIMIT_REACHED' || message.includes('DAILY_FREE_LIMIT_REACHED')
        ? '功能测试期每个 IP 每天只能免费抠 1 张图。你可以填写下面的付费/批量需求调查，帮助我们决定是否开放更多额度。'
        : message.includes('Failed to fetch')
        ? '后台抠图服务没有启动，请先启动 remove-bg-server。'
        : message.includes('REMOVEBG_KEY_MISSING')
          ? '后台还没有配置 remove.bg API Key。'
          : message
      setCutoutError(friendly)
      trackEvent('process_error', { tool: 'product_image', method })
    } finally {
      setProcessing(false)
    }
  }, [bgStrength, cutoutUrl, file, fillRatio, method, outputFormat, preparedInfo, preset, preprocessScale, preview, result, runApiCutout, shadow])

  const handleDownload = useCallback(async () => {
    if (!resultCanvasRef.current || !file || resultMode === 'prepared') return
    const { blob, format } = await exportCompliantBlob(resultCanvasRef.current, preset, outputFormat)
    setResultBlob(blob)
    setResultSize(blob.size)
    downloadBlob(blob, `${getBaseName(file.name)}_${preset.platform}_${preset.w}x${preset.h}.${format.ext}`)
    trackEvent('download', { tool: 'product_image', count: 1, format: format.id, preset: preset.id })
  }, [file, outputFormat, preset, resultMode])

  const handleBatchNormalize = useCallback(async () => {
    if (!batchFiles.length) return
    setProcessing(true)
    setNormalizeError('')
    try {
      if (!batchAnalysis.length) throw new Error('请先点击“筛选识别”，再确认每张图的规范设置。')
      const unconfirmed = batchAnalysis.filter(item => !cropOverrides[item.id]?.confirmed)
      if (unconfirmed.length) throw new Error(`还有 ${unconfirmed.length} 张图片未确认，请先单张确认或批量确认。`)
      setNormalizeStatus(`正在生成 ${batchFiles.length} 张规范图并打包...`)
      const zip = new JSZip()
      const folderName = `${normalizePreset.platform}_${normalizePreset.w}x${normalizePreset.h}_商品图`
      const folder = zip.folder(folderName)
      for (let index = 0; index < batchFiles.length; index++) {
        const item = batchFiles[index]
        const src = await readFileAsDataUrl(item)
        const key = `${item.name}_${item.size}_${item.lastModified}`
        const analysis = batchAnalysis.find(row => row.id === key)
        const { canvas } = await renderNormalizeOutputCanvas({
          src,
          preset: normalizePreset,
          analysis,
          settings: cropOverrides[key] || {},
          fallbackMode: 'auto',
          fillRatio: normalizeFillRatio,
          background: globalBgColor,
        })
        const { blob, format } = await exportCompliantBlob(canvas, normalizePreset, outputFormat)
        folder.file(`${getBaseName(item.name)}_${normalizePreset.platform}_${normalizePreset.w}x${normalizePreset.h}.${format.ext}`, blob)
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(zipBlob, `${folderName}.zip`)
      setNormalizeStatus(`已批量生成并打包 ${batchFiles.length} 张：${normalizePreset.platform} ${normalizePreset.label}，${normalizePreset.w} x ${normalizePreset.h}${normalizePreset.maxBytes ? `，单张上限 ${formatBytes(normalizePreset.maxBytes)}` : ''}。`)
      trackEvent('batch_normalize', { tool: 'product_image', count: batchFiles.length, preset: normalizePreset.id })
    } catch (err) {
      setNormalizeError(err?.message || '批量规范失败')
    } finally {
      setProcessing(false)
    }
  }, [batchAnalysis, batchFiles, cropOverrides, globalBgColor, normalizeFillRatio, normalizePreset, outputFormat])

  const submitSurvey = useCallback(async () => {
    setSurveyStatus('提交中...')
    try {
      await fetch('/api/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'removebg_willingness',
          want: survey.want,
          service: survey.service,
          price: survey.price,
          plan: survey.plan,
          batchNeed: survey.batchNeed,
          monthlyVolume: survey.monthlyVolume,
          contact: survey.contact,
          note: survey.note,
          method,
          preset: preset.id,
        }),
      })
      setSurveyStatus('已记录，谢谢。')
      trackEvent('survey_submit', { tool: 'product_image', price: survey.price })
    } catch {
      setSurveyStatus('暂时无法提交，但你的选择已保留在本机。')
      localStorage.setItem('tuscale_removebg_survey', JSON.stringify({ ...survey, time: Date.now() }))
    }
  }, [method, preset.id, survey])

  const canUseBrush = Boolean(result && resultMode !== 'empty' && resultMode !== 'prepared')

  return (
    <div className="min-h-screen bg-gray-50/80 text-slate-950">
      <header className="bg-white/95 backdrop-blur-sm border-b border-gray-100 px-6 py-3 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <img src="/logo.png" alt="TU Scale" className="h-16 sm:h-18 w-auto shrink-0" />
          <div className="flex flex-col min-w-0 mr-auto justify-center">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight truncate leading-tight" style={{ color: '#8040f0' }}>TU Scale 本地图片工具箱-商品图规范化</h1>
            <p className="mt-2 text-xs sm:text-sm font-semibold text-gray-400 leading-none">白底、留白、尺寸统一</p>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {TOOL_NAV.map(item => (
              <button key={item.id} onClick={() => navigate(item.path)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${item.id === 'product-image' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}>
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 pb-24">
        <div className="flex md:hidden items-center gap-1 overflow-x-auto">
          {TOOL_NAV.map(item => (
            <button key={item.id} onClick={() => navigate(item.path)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap ${item.id === 'product-image' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'text-gray-500 border-gray-200 bg-white'}`}>
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex sm:hidden flex-wrap gap-2">
          {['白底图', '尺寸规范', '商品图留白', '抠图测试'].map(item => (
            <span key={item} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-500 shadow-sm">{item}</span>
          ))}
        </div>
        <section className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">商品图规范化缩放</h1>
                <p className="mt-1 text-sm text-slate-500">用于已经是白底图或不需要抠图的主图，批量统一平台像素、文件体积和主体留白。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => batchFileRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
                  <Upload size={18} /> 上传图片
                </button>
                <button onClick={handleNormalizeFolderSelect} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">
                  <Upload size={18} /> 上传文件夹
                </button>
                <input ref={batchFileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleNormalizeFiles(e.target.files)} />
                <input ref={batchFolderRef} type="file" className="hidden" onChange={(e) => handleNormalizeFiles(e.target.files)} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[1.2fr_.8fr]">
              <label className="space-y-2 text-sm font-medium text-slate-700">平台规范
                <select value={normalizePresetId} onChange={(e) => handleNormalizePresetChange(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900">
                  {NORMALIZE_PRESETS.map(item => <option key={item.id} value={item.id}>{item.platform} · {item.label} · {item.size}</option>)}
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">输出格式
                <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900">
                  {OUTPUT_FORMATS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
            </div>

            <div className="mt-3 grid gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800 sm:grid-cols-2">
              <p>当前规范：{normalizePreset.platform} · {normalizePreset.label}，输出 {normalizePreset.w} x {normalizePreset.h}。</p>
              <p>文件上限：{normalizePreset.maxBytes ? formatBytes(normalizePreset.maxBytes) : '未限制'}；批量下载会自动压缩，PNG 超限会转 JPG。</p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button disabled={!batchFiles.length || processing} onClick={analyzeNormalizeFiles} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300">
                {processing ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />} 筛选识别
              </button>
              {batchFiles.length > 0 && <span className="inline-flex h-10 items-center rounded-lg bg-slate-100 px-3 text-sm font-medium text-slate-600">已选择 {batchFiles.length} 张{batchAnalysis.length ? ` · 已确认 ${analysisStats.confirmed} 张` : ''}</span>}
            </div>
            {normalizeStatus && <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle size={16} />{normalizeStatus}</p>}
            {normalizeError && <p className="mt-3 flex items-center gap-2 text-sm text-red-600"><AlertCircle size={16} />{normalizeError}</p>}

            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              <button type="button" onClick={() => setNormalizePanel('summary')} className={`rounded-lg border p-3 text-left ${normalizePanel === 'summary' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}>
                <p className="text-sm font-semibold text-slate-800">比例匹配</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-600">{analysisStats.matched}</p>
                <p className="mt-1 text-xs text-slate-500">可直接缩放导出</p>
              </button>
              <button type="button" onClick={() => setNormalizePanel('edit')} className={`rounded-lg border p-3 text-left ${normalizePanel === 'edit' ? 'border-fuchsia-300 bg-fuchsia-50' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}>
                <p className="text-sm font-semibold text-slate-800">裁切+占比</p>
                <p className="mt-1 text-2xl font-semibold text-fuchsia-600">{analysisStats.needsBoth}</p>
                <p className="mt-1 text-xs text-slate-500">需两项都处理</p>
              </button>
              <button type="button" onClick={() => setNormalizePanel('edit')} className={`rounded-lg border p-3 text-left ${['crop', 'edit'].includes(normalizePanel) ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}>
                <p className="text-sm font-semibold text-slate-800">需要裁切</p>
                <p className="mt-1 text-2xl font-semibold text-amber-600">{analysisStats.needsCrop}</p>
                <p className="mt-1 text-xs text-slate-500">含裁切+占比</p>
              </button>
              <button type="button" onClick={() => setNormalizePanel('edit')} className={`rounded-lg border p-3 text-left ${['fill', 'edit'].includes(normalizePanel) ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}>
                <p className="text-sm font-semibold text-slate-800">主体占比异常</p>
                <p className="mt-1 text-2xl font-semibold text-red-600">{analysisStats.fillIssue}</p>
                <p className="mt-1 text-xs text-slate-500">仅检测白底图，点击调整留白</p>
              </button>
            </div>

            <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
              <div className="min-w-0 rounded-lg border border-slate-200 bg-white">
                <div className="grid grid-cols-[1fr_72px] border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">
                  <span>文件列表</span><span>状态</span>
                </div>
                <div className="max-h-72 overflow-auto">
                  {batchAnalysis.length ? batchAnalysis.map((item, index) => (
                    <button key={item.id} type="button" onClick={() => setSelectedReviewIndex(index)} className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_72px] gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs ${selectedReviewIndex === index ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-700">{item.name}</span>
                        <span className="mt-0.5 block text-slate-400">
                          {item.width}x{item.height}
                          {item.isWhiteBg
                            ? cropOverrides[item.id]?.subjectRect
                              ? ` · 手动主体 ${getDisplayedSubjectRatio(item)}%`
                              : ` · 自动估算主体 ${getDisplayedSubjectRatio(item)}%`
                            : ' · 非浅色底不检测主体'}
                        </span>
                      </span>
                      <span className={cropOverrides[item.id]?.confirmed ? 'text-emerald-600' : getItemIssue(item).tone}>
                        {cropOverrides[item.id]?.confirmed ? '已确认' : getItemIssue(item).label}
                      </span>
                    </button>
                  )) : (
                    <div className="px-3 py-8 text-center text-sm text-slate-400">上传图片后点击“筛选识别”</div>
                  )}
                </div>
                <div className="space-y-2 border-t border-slate-100 p-3">
                  <button disabled={!batchAnalysis.length || processing} onClick={confirmAllNormalize} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                    <CheckCircle size={17} /> 批量确认
                  </button>
                  <button disabled={!batchFiles.length || processing} onClick={handleBatchNormalize} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300">
                    {processing ? <Loader2 className="animate-spin" size={17} /> : <Download size={17} />} 批量规范下载
                  </button>
                  {batchAnalysis.length > 0 && <p className="text-center text-xs text-slate-400">已确认 {analysisStats.confirmed} / {batchAnalysis.length} 张</p>}
                </div>
              </div>

              <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4">
                {['crop', 'fill', 'edit'].includes(normalizePanel) && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">规范调整工作区</p>
                        <p className="mt-1 text-xs text-slate-500">同一张图里处理裁切/补背景、背景色、主体范围和最终主体占比。</p>
                      </div>
                      <div className="flex gap-2 text-sm">
                        <button type="button" onClick={() => { setNormalizeMode('crop'); updateSelectedOverride({ mode: 'crop', rect: cropRect }) }} className={`rounded-lg border px-3 py-2 font-medium ${selectedMode === 'crop' || selectedMode === 'auto' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-600'}`}>裁切填满</button>
                        <button type="button" onClick={() => { setNormalizeMode('contain'); updateSelectedOverride({ mode: 'contain', containOffset: selectedOverride.containOffset || { x: 0.5, y: 0.5 } }) }} className={`rounded-lg border px-3 py-2 font-medium ${selectedMode === 'contain' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-600'}`}>补背景适配</button>
                      </div>
                    </div>
                    {selectedReview ? (
                      <div className="mt-4 min-w-0 rounded-lg bg-white p-3">
                        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="min-w-0 truncate font-semibold text-slate-700">当前调整：{selectedReview.name}</span>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 ${cropOverrides[selectedReview.id]?.confirmed ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : getItemIssue(selectedReview).badge}`}>
                              {cropOverrides[selectedReview.id]?.confirmed ? '已确认' : getItemIssue(selectedReview).label}
                            </span>
                            <span>{normalizePreset.w}:{normalizePreset.h}</span>
                          </div>
                        </div>
                        {selectedReview.aspectStatus === 'crop' && (selectedReview.fillStatus === 'low' || selectedReview.fillStatus === 'high') && (
                          <div className="mb-3 rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-3 py-2 text-xs leading-5 text-fuchsia-700">
                            这张图同时需要处理比例和主体占比：先选择“裁切填满”或“补背景适配”，再检查下方主体范围和输出占比，最后点击工作区底部的“确认当前图”。
                          </div>
                        )}
                        {selectedMode !== 'contain' && (
                          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                            <span>补充背景色</span>
                            <span className="h-6 w-10 rounded border border-slate-300" style={{ background: toRgb(cropOverrides[selectedReview.id]?.bgColor || selectedReview.bgColor || globalBgColor) }} />
                            <input type="color" value={globalBgColor} onChange={(e) => setGlobalBgColor(e.target.value)} className="h-8 w-12 rounded border border-slate-300 bg-white p-1" />
                            <button type="button" onClick={() => setColorPickerEnabled(value => !value)} className={`rounded-lg border px-3 py-1.5 font-medium ${colorPickerEnabled ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-600'}`}>吸取背景色</button>
                            <span className="text-slate-400">用于补背景和主体占比输出预览</span>
                          </div>
                        )}
                        {selectedMode === 'contain' ? (
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                              <span>补充背景色</span>
                              <span className="h-6 w-10 rounded border border-slate-300" style={{ background: toRgb(cropOverrides[selectedReview.id]?.bgColor || selectedReview.bgColor || globalBgColor) }} />
                              <input type="color" value={globalBgColor} onChange={(e) => setGlobalBgColor(e.target.value)} className="h-8 w-12 rounded border border-slate-300 bg-white p-1" />
                              <button type="button" onClick={() => setColorPickerEnabled(value => !value)} className={`rounded-lg border px-3 py-1.5 font-medium ${colorPickerEnabled ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-600'}`}>吸取背景色</button>
                            </div>
                            <div className="mx-auto flex h-[360px] max-w-full items-center justify-center rounded-xl border border-slate-200 p-3" style={{ aspectRatio: `${normalizePreset.w} / ${normalizePreset.h}`, background: toRgb(cropOverrides[selectedReview.id]?.bgColor || selectedReview.bgColor || globalBgColor) }}>
                              <img
                                ref={containPreviewRef}
                                src={selectedReview.src}
                                alt="补背景预览"
                                className={`max-h-full max-w-full object-contain ${colorPickerEnabled ? 'cursor-crosshair' : ''}`}
                                draggable={false}
                                onClick={sampleContainBackground}
                              />
                            </div>
                            <p className="text-xs text-slate-500">吸取背景色开启后，在图片背景位置点一下，会把该颜色用于这张图的补背景导出。</p>
                          </div>
                        ) : (
                          <div
                            ref={normalizeCropStageRef}
                            className="relative mx-auto h-[360px] max-w-full overflow-hidden rounded-xl bg-slate-950/90 select-none touch-none"
                            style={{ aspectRatio: `${selectedReview.width} / ${selectedReview.height}` }}
                            onPointerDown={(event) => event.preventDefault()}
                          >
                            <img src={selectedReview.src} alt="裁切预览" className="block h-full w-full opacity-80" draggable={false} />
                            <div className="pointer-events-none absolute inset-0 bg-black/10" />
                            <div
                              className="absolute cursor-move touch-none border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.42)]"
                              style={{
                                left: `${cropRect.x * 100}%`,
                                top: `${cropRect.y * 100}%`,
                                width: `${cropRect.w * 100}%`,
                                height: `${cropRect.h * 100}%`,
                              }}
                              onPointerDown={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                setCropDrag({ startX: event.clientX, startY: event.clientY, startRect: cropRect })
                              }}
                            >
                              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                                {Array.from({ length: 9 }).map((_, index) => (
                                  <div key={index} className="border border-white/30" />
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                        <p className="mt-2 text-xs text-slate-500">点击左侧文件名可逐张修改裁切位置。没有单独修改的图片会使用默认居中裁切。</p>
                        <div className={`mt-4 grid min-w-0 gap-4 rounded-lg border border-slate-100 bg-slate-50 p-3 ${showSubjectEditor ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
                          {showSubjectEditor && <div className="min-w-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-xs font-semibold text-slate-700">主体范围和留白</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {(selectedReview.isWhiteBg || cropOverrides[selectedReview.id]?.forceWhiteBg)
                                    ? `${cropOverrides[selectedReview.id]?.subjectRect ? '手动主体' : '自动估算主体'} ${getDisplayedSubjectRatio(selectedReview)}%，输出目标 ${normalizeFillRatio}%`
                                    : '未识别为浅色纯底，可手动纳入调整'}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => setCropOverrides(data => ({
                                    ...data,
                                    [selectedReview.id]: {
                                      ...(data[selectedReview.id] || {}),
                                      forceWhiteBg: true,
                                      subjectRect,
                                      subjectBounds: rectToBounds(subjectRect, normalizePreset.w, normalizePreset.h),
                                      confirmed: false,
                                    },
                                  }))}
                                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${(selectedReview.isWhiteBg || cropOverrides[selectedReview.id]?.forceWhiteBg) ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-600'}`}
                                >
                                  按浅色底处理
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 }
                                    setSubjectRect(next)
                                    setCropOverrides(data => ({
                                      ...data,
                                      [selectedReview.id]: {
                                        ...(data[selectedReview.id] || {}),
                                        subjectRect: next,
                                        subjectBounds: rectToBounds(next, normalizePreset.w, normalizePreset.h),
                                        confirmed: false,
                                      },
                                    }))
                                  }}
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
                                >
                                  重置自动框
                                </button>
                              </div>
                            </div>
                            <label className="mt-3 block text-xs font-medium text-slate-700">输出图主体占比目标：{normalizeFillRatio}%
                              <span className="ml-2 font-normal text-slate-400">平台默认约 {normalizePreset.fill}%</span>
                              <input
                                type="range"
                                min="45"
                                max="96"
                                value={normalizeFillRatio}
                                onChange={(e) => {
                                  setNormalizeFillRatio(Number(e.target.value))
                                  updateSelectedOverride({})
                                }}
                                className="mt-2 w-full"
                              />
                            </label>
                            <p className="mt-1 text-xs text-slate-500">默认按当前平台规范设置；如果平台或类目要求不同，可以手动调整。</p>
                            <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
                              拖动蓝框内部只调整主体中心位置；拖动蓝框边缘或圆点改变主体范围大小，才会改变主体占比和白底留白。
                            </div>
                            <div className="mt-3 flex h-[360px] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-2">
                              <div
                                ref={subjectStageRef}
                                className="relative max-h-full max-w-full overflow-hidden rounded-md select-none touch-none"
                                style={{
                                  width: `min(100%, ${Math.round(344 * normalizePreset.w / normalizePreset.h)}px)`,
                                  aspectRatio: `${normalizePreset.w} / ${normalizePreset.h}`,
                                }}
                                onPointerDown={(event) => event.preventDefault()}
                              >
                                <canvas
                                  ref={setSubjectBaseCanvas}
                                  className={`block h-full w-full rounded-md ${colorPickerEnabled ? 'cursor-crosshair' : ''}`}
                                  width={normalizePreset.w}
                                  height={normalizePreset.h}
                                  onClick={sampleContainBackground}
                                />
                                <div
                                  className="absolute cursor-move touch-none border-2 border-blue-500 shadow-[0_0_0_9999px_rgba(15,23,42,0.24)]"
                                  style={{
                                    left: `${subjectRect.x * 100}%`,
                                    top: `${subjectRect.y * 100}%`,
                                    width: `${subjectRect.w * 100}%`,
                                    height: `${subjectRect.h * 100}%`,
                                  }}
                                  onPointerDown={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    setSubjectDrag({ mode: 'move', startX: event.clientX, startY: event.clientY, startRect: subjectRect })
                                  }}
                                >
                                  <span className="pointer-events-none absolute left-1 top-1 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">主体范围</span>
                                  {[
                                    ['nw', 'left-[-6px] top-[-6px] cursor-nwse-resize'],
                                    ['n', 'left-1/2 top-[-6px] -translate-x-1/2 cursor-ns-resize'],
                                    ['ne', 'right-[-6px] top-[-6px] cursor-nesw-resize'],
                                    ['e', 'right-[-6px] top-1/2 -translate-y-1/2 cursor-ew-resize'],
                                    ['se', 'bottom-[-6px] right-[-6px] cursor-nwse-resize'],
                                    ['s', 'bottom-[-6px] left-1/2 -translate-x-1/2 cursor-ns-resize'],
                                    ['sw', 'bottom-[-6px] left-[-6px] cursor-nesw-resize'],
                                    ['w', 'left-[-6px] top-1/2 -translate-y-1/2 cursor-ew-resize'],
                                  ].map(([handle, className]) => (
                                    <span
                                      key={handle}
                                      className={`absolute h-3 w-3 rounded-full border border-white bg-blue-600 ${className}`}
                                      onPointerDown={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        setSubjectDrag({ mode: handle, startX: event.clientX, startY: event.clientY, startRect: subjectRect })
                                      }}
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">当前蓝框主体占比约 {getSubjectRatioFromRect(subjectRect)}%。移动蓝框会改变主体居中位置；缩放蓝框会改变主体大小和留白。</p>
                          </div>}
                          <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                            <p className="mb-2 text-xs font-semibold text-slate-600">最终输出预览</p>
                            <div className="flex h-[420px] items-center justify-center overflow-hidden rounded-md bg-slate-100 p-2">
                              <canvas
                                ref={fillPreviewCanvasRef}
                                className={`block max-h-full max-w-full rounded-md ${selectedMode === 'contain' ? 'cursor-move touch-none' : ''}`}
                                width={normalizePreset.w}
                                height={normalizePreset.h}
                                style={{
                                  aspectRatio: `${normalizePreset.w} / ${normalizePreset.h}`,
                                  background: toRgb(cropOverrides[selectedReview.id]?.bgColor || selectedReview.bgColor || globalBgColor),
                                }}
                                onPointerDown={(event) => {
                                  if (selectedMode !== 'contain') return
                                  event.preventDefault()
                                  setContainDrag({
                                    startX: event.clientX,
                                    startY: event.clientY,
                                    startOffset: selectedOverride.containOffset || { x: 0.5, y: 0.5 },
                                  })
                                }}
                              />
                            </div>
                            {selectedMode === 'contain' && <p className="mt-2 text-xs text-slate-500">拖动预览图可以调整完整原图在输出画布里的位置。</p>}
                            {!showSubjectEditor && (
                              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                                <p className="text-xs text-slate-500">这张当前只需要处理比例；如果它也是白底/浅色底图，可以继续调整主体占比。</p>
                                <button
                                  type="button"
                                  onClick={() => updateSelectedOverride({
                                    forceWhiteBg: true,
                                    subjectRect,
                                    subjectBounds: rectToBounds(subjectRect, normalizePreset.w, normalizePreset.h),
                                  })}
                                  className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"
                                >
                                  按浅色底处理
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-3">
                          <p className="text-xs text-emerald-700">
                            {cropOverrides[selectedReview.id]?.confirmed ? '当前图已确认；如果继续修改，会自动变回未确认。' : '确认后会锁定这张图的裁切/补背景方式、背景色、主体范围和输出占比。'}
                          </p>
                          <button
                            disabled={!selectedReview || processing}
                            onClick={confirmSelectedNormalize}
                            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300 ${justConfirmedId === selectedReview.id || cropOverrides[selectedReview.id]?.confirmed ? 'bg-emerald-500' : 'bg-emerald-600'} ${justConfirmedId === selectedReview.id ? 'animate-pulse' : ''}`}
                          >
                            <CheckCircle size={17} /> {justConfirmedId === selectedReview.id || cropOverrides[selectedReview.id]?.confirmed ? '已确认当前图' : '确认当前图'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 flex min-h-64 items-center justify-center rounded-lg bg-white p-6 text-center text-sm text-slate-400">请先点击左侧需要裁切的图片</div>
                    )}
                  </>
                )}

                {normalizePanel === 'fill-legacy' && (
                  <>
                    <p className="text-sm font-semibold text-slate-800">留白调整工作区</p>
                    <p className="mt-1 text-xs text-slate-500">这里只针对浅色纯底/白底图。原图占比用于识别问题，滑杆控制的是最终输出图里的主体占比。</p>
                    <div className="mt-4 rounded-lg bg-white p-3">
                      <label className="block text-sm font-medium text-slate-700">输出图主体占比目标：{normalizeFillRatio}%
                        <input type="range" min="45" max="96" value={normalizeFillRatio} onChange={(e) => setNormalizeFillRatio(Number(e.target.value))} className="mt-2 w-full" />
                      </label>
                      <p className="mt-2 text-xs text-slate-500">调低会增加留白，调高会让商品更大。调整后请重新点击“筛选识别”，再批量下载。</p>
                    </div>
                    {selectedReview && (
                      <div className="mt-4 grid gap-4 rounded-lg bg-white p-3 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-700">当前选中</p>
                          <p className="mt-1 truncate text-sm text-slate-600">{selectedReview.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {(selectedReview.isWhiteBg || cropOverrides[selectedReview.id]?.forceWhiteBg)
                              ? `${cropOverrides[selectedReview.id]?.subjectRect ? '手动主体' : '自动估算主体'} ${getDisplayedSubjectRatio(selectedReview)}%，输出目标 ${normalizeFillRatio}%`
                              : '未识别为浅色纯底；如实际是白底/浅色底，可手动纳入调整'}
                          </p>
                          <p className="mt-2 text-xs text-slate-400">预览输出：{normalizePreset.w} x {normalizePreset.h}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setCropOverrides(data => ({
                                ...data,
                                [selectedReview.id]: {
                                  ...(data[selectedReview.id] || {}),
                                  forceWhiteBg: true,
                                  subjectRect,
                                  subjectBounds: rectToBounds(subjectRect, selectedReview.width, selectedReview.height),
                                },
                              }))}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${(selectedReview.isWhiteBg || cropOverrides[selectedReview.id]?.forceWhiteBg) ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-600'}`}
                            >
                              按浅色底处理
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const next = boundsToRect(selectedReview.bounds, selectedReview.width, selectedReview.height)
                                setSubjectRect(next)
                                setCropOverrides(data => ({
                                  ...data,
                                  [selectedReview.id]: {
                                    ...(data[selectedReview.id] || {}),
                                    subjectRect: next,
                                    subjectBounds: rectToBounds(next, selectedReview.width, selectedReview.height),
                                  },
                                }))
                              }}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
                            >
                              重置自动框
                            </button>
                          </div>
                          <div
                            ref={subjectStageRef}
                            className="relative mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 select-none touch-none"
                            onPointerDown={(event) => event.preventDefault()}
                          >
                            <img src={selectedReview.src} alt="主体框选" className="block h-auto w-full" draggable={false} />
                            <div
                              className="absolute cursor-move touch-none border-2 border-blue-500 shadow-[0_0_0_9999px_rgba(15,23,42,0.24)]"
                              style={{
                                left: `${subjectRect.x * 100}%`,
                                top: `${subjectRect.y * 100}%`,
                                width: `${subjectRect.w * 100}%`,
                                height: `${subjectRect.h * 100}%`,
                              }}
                              onPointerDown={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                setSubjectDrag({ mode: 'move', startX: event.clientX, startY: event.clientY, startRect: subjectRect })
                              }}
                            >
                              <span className="pointer-events-none absolute left-1 top-1 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">主体范围</span>
                              {[
                                ['nw', 'left-[-6px] top-[-6px] cursor-nwse-resize'],
                                ['n', 'left-1/2 top-[-6px] -translate-x-1/2 cursor-ns-resize'],
                                ['ne', 'right-[-6px] top-[-6px] cursor-nesw-resize'],
                                ['e', 'right-[-6px] top-1/2 -translate-y-1/2 cursor-ew-resize'],
                                ['se', 'bottom-[-6px] right-[-6px] cursor-nwse-resize'],
                                ['s', 'bottom-[-6px] left-1/2 -translate-x-1/2 cursor-ns-resize'],
                                ['sw', 'bottom-[-6px] left-[-6px] cursor-nesw-resize'],
                                ['w', 'left-[-6px] top-1/2 -translate-y-1/2 cursor-ew-resize'],
                              ].map(([handle, className]) => (
                                <span
                                  key={handle}
                                  className={`absolute h-3 w-3 rounded-full border border-white bg-blue-600 ${className}`}
                                  onPointerDown={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    setSubjectDrag({ mode: handle, startX: event.clientX, startY: event.clientY, startRect: subjectRect })
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">白衣服、透明/浅色商品容易被自动估算漏掉或算大；拖动蓝框框住真正主体，最终下载按这个框生成留白。</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          {selectedReview.isWhiteBg || cropOverrides[selectedReview.id]?.forceWhiteBg ? (
                            <>
                              <p className="mb-2 text-xs font-semibold text-slate-600">最终输出预览</p>
                              <canvas ref={fillPreviewCanvasRef} className="mx-auto block max-h-[420px] max-w-full rounded-md bg-white object-contain" />
                            </>
                          ) : (
                            <div className="flex h-52 items-center justify-center text-center text-sm text-slate-400">这张不是浅色纯底图。点击“按浅色底处理”后可手动框选并预览。</div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {normalizePanel === 'summary' && (
                  <div className="flex min-h-56 items-center justify-center rounded-lg bg-white p-6 text-center text-sm text-slate-500">
                    点击上方“需要裁切”或“主体占比异常”，都会进入同一个规范调整工作区。
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">白底抠图功能</h2>
                <p className="mt-1 text-sm text-slate-500">用于需要去背景、换纯白底、手动修边的单张商品图。</p>
              </div>
              <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
                <Upload size={18} /> 上传抠图图片
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            </div>

            <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-800">
              <p className="font-semibold">功能测试说明</p>
              <p>AI 抠图目前使用付费 API 进行效果测试。为避免测试期产生不可控成本，每个 IP 每天可免费试用 1 张。</p>
              <p className="text-xs text-amber-700">“先优化抠图临时图”会先把原图缩放到略大于最终平台尺寸，减少 API 消耗并保留边缘清晰度；确认临时图没问题后再点“生成规范图”。</p>
              <button type="button" onClick={() => document.getElementById('removebg-survey')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="mt-3 inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100">
                有批量需求？申请内测
              </button>
            </div>

            <div className="mb-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="min-w-0 space-y-4">
              <div className="min-w-0 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
                <div className="mb-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-sm text-slate-500"><span>原图预览</span>{file && <span className="truncate text-right">{file.name}</span>}</div>
                {preview ? <img src={preview} className="mx-auto max-h-[520px] max-w-full rounded-md object-contain" /> : (
                  <button onClick={() => fileRef.current?.click()} className="flex h-[280px] w-full flex-col items-center justify-center gap-3 text-slate-400">
                    <Upload size={34} /><span>点击上传抠图图片</span>
                  </button>
                )}
              </div>

              <div className="grid min-w-0 gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm font-medium text-slate-700">白底图预设
                  <select value={presetId} onChange={(e) => handlePresetChange(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900">
                    {WHITE_BG_PRESETS.map(item => <option key={item.id} value={item.id}>{item.platform} · {item.label} · {item.size}</option>)}
                  </select>
                </label>
                <label className="space-y-2 text-sm font-medium text-slate-700">单张抠图方式
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900">
                    <option value="removebg">AI 抠图</option>
                    <option value="local-white">免费纯色背景清理</option>
                  </select>
                </label>
              </div>
              <div className="grid gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
                <p>当前白底规范：{preset.platform} · {preset.label}，输出 {preset.w} x {preset.h}，建议主体约 {preset.fill}%。</p>
                <p>AI 抠图前会自动生成一张略大于所选输出尺寸的临时图；最终下载仍按平台规范导出。</p>
              </div>
              </div>

              <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between text-sm text-slate-500"><span>{resultMode === 'prepared' ? '抠图临时图' : '结果'}</span>{resultSize > 0 && <span>{formatBytes(resultSize)}</span>}</div>
                {result ? (
                  <div className="max-h-[420px] min-w-0 overflow-auto rounded-md border border-slate-100 bg-slate-50 p-3">
                    <div className="relative mx-auto w-fit" style={{ transform: `scale(${previewZoom})`, transformOrigin: 'top center', marginBottom: `${(previewZoom - 1) * 120}px` }}>
                      <canvas
                        ref={resultCanvasRef}
                        className={`block max-h-[480px] max-w-full touch-none select-none rounded-md bg-white object-contain ${canUseBrush ? 'cursor-crosshair' : 'cursor-not-allowed'}`}
                        onPointerDown={(event) => { event.preventDefault(); startBrush(event) }}
                        onPointerMove={moveBrush}
                        onPointerUp={stopBrush}
                        onPointerCancel={stopBrush}
                        onPointerLeave={() => { stopBrush(); setBrushPoint(null) }}
                      />
                      {brushPoint && (
                        <span
                          className={`pointer-events-none absolute rounded-full border-2 ${brushMode === 'erase' ? 'border-red-500 bg-red-500/10' : 'border-emerald-500 bg-emerald-500/10'}`}
                          style={{ left: brushPoint.x - brushPoint.r, top: brushPoint.y - brushPoint.r, width: brushPoint.r * 2, height: brushPoint.r * 2 }}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-[300px] items-center justify-center rounded-md bg-[linear-gradient(45deg,#f1f5f9_25%,transparent_25%),linear-gradient(-45deg,#f1f5f9_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f1f5f9_75%),linear-gradient(-45deg,transparent_75%,#f1f5f9_75%)] bg-[length:22px_22px] bg-[position:0_0,0_11px,11px_-11px,-11px_0] text-slate-400">等待处理结果</div>
                )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button disabled={!file || processing} onClick={handlePrepareForApi} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 font-medium text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                {processing ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />} 先优化抠图临时图
              </button>
              <button disabled={!file || processing} onClick={handleProcess} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300">
                {processing ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />} 生成规范图
              </button>
              <button disabled={!resultBlob || resultMode === 'prepared'} onClick={handleDownload} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 font-medium text-slate-700 disabled:opacity-40"><Download size={18} />下载</button>
            </div>
            {preparedInfo && <p className="mt-2 text-xs text-slate-500">已准备清晰抠图临时图：{preparedInfo.width} x {preparedInfo.height}</p>}
            {(cutoutStatus || cutoutError) && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                {cutoutStatus && <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle size={16} />{cutoutStatus}</p>}
                {cutoutError && <p className="flex items-center gap-2 text-sm text-red-600"><AlertCircle size={16} />{cutoutError}</p>}
              </div>
            )}

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-slate-700">背景识别强度：{bgStrength}
                <input type="range" min="30" max="120" value={bgStrength} onChange={(e) => setBgStrength(Number(e.target.value))} className="w-full" />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">主体占白底比例：{fillRatio}%
                <input type="range" min="45" max="92" value={fillRatio} onChange={(e) => setFillRatio(Number(e.target.value))} className="w-full" />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">轻阴影：{shadow}
                <input type="range" min="0" max="28" value={shadow} onChange={(e) => setShadow(Number(e.target.value))} className="w-full" />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">局部放大：{previewZoom.toFixed(1)}x
                <input type="range" min="1" max="4" step="0.25" value={previewZoom} onChange={(e) => setPreviewZoom(Number(e.target.value))} className="w-full" />
              </label>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button type="button" disabled={!canUseBrush} onClick={() => setBrushMode('erase')} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-45 ${brushMode === 'erase' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-300 bg-white text-slate-600'}`}><Eraser size={16} />去除</button>
                <button type="button" disabled={!canUseBrush} onClick={() => setBrushMode('keep')} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-45 ${brushMode === 'keep' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-600'}`}><Brush size={16} />保留</button>
                <button type="button" disabled={!cutoutUrl} onClick={recomposeFromCutout} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 disabled:opacity-40"><RotateCcw size={16} />重置修边</button>
              </div>
              <label className="block text-sm font-medium text-slate-700">画笔大小：{brushSize}px
                <input type="range" min="8" max="120" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="mt-2 w-full" />
              </label>
              <p className="mt-2 text-xs text-slate-500">{canUseBrush ? '去除会把涂抹区域变成白底；保留会从原图同位置补回内容。' : '请先点击“生成规范图”，得到抠图结果后再使用保留/去除画笔修边。'}</p>
            </div>
              </div>
            </div>

            <div id="removebg-survey" className="mt-5 scroll-mt-28 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3">
                <p className="text-sm font-semibold text-slate-800">AI 抠图付费与批量需求调查</p>
                <p className="mt-1 text-xs text-slate-500">以下价格是测试期备选方案，用来判断是否值得正式上线；不会在这里直接扣费。</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm font-medium text-slate-700">是否愿意付费使用
                  <select value={survey.want} onChange={(e) => setSurvey(data => ({ ...data, want: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900">
                    {WILLINGNESS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="space-y-2 text-sm font-medium text-slate-700">你能接受的积分方案
                  <select value={survey.plan} onChange={(e) => setSurvey(data => ({ ...data, plan: e.target.value, price: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900">
                    {REMOVE_BG_PRICE_PLANS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="space-y-2 text-sm font-medium text-slate-700">是否需要批量抠白底图
                  <select value={survey.batchNeed} onChange={(e) => setSurvey(data => ({ ...data, batchNeed: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900">
                    {BATCH_NEEDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="space-y-2 text-sm font-medium text-slate-700">每月大概需要处理多少张
                  <select value={survey.monthlyVolume} onChange={(e) => setSurvey(data => ({ ...data, monthlyVolume: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900">
                    {MONTHLY_VOLUMES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-[.8fr_1.2fr]">
                <label className="space-y-2 text-sm font-medium text-slate-700">联系方式（选填）
                  <input value={survey.contact} onChange={(e) => setSurvey(data => ({ ...data, contact: e.target.value }))} placeholder="微信/邮箱，方便后续通知内测" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" />
                </label>
                <label className="space-y-2 text-sm font-medium text-slate-700">补充需求（选填）
                  <input value={survey.note} onChange={(e) => setSurvey(data => ({ ...data, note: e.target.value }))} placeholder="例如：需要文件夹批量、透明 PNG、自动压缩到平台尺寸等" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={submitSurvey} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white">
                  <CheckCircle size={17} /> 提交需求反馈
                </button>
                {surveyStatus && <span className="text-sm text-emerald-700">{surveyStatus}</span>}
                <span className="text-xs text-slate-500">提交后会记录你的选择。</span>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">工具介绍</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              商品图规范化用于把原始商品照片整理成平台可用的主图、白底图、长图或详情图尺寸。普通裁切、留白、压缩和批量导出都在本地浏览器完成，适合先快速检查图片是否符合常见平台尺寸。
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ['平台预设', '内置淘宝、拼多多、抖店、京东、1688、快手和 Amazon 常用尺寸。'],
                ['批量规范', '可一次导入多张图片，统一输出尺寸、格式和主体占比。'],
                ['白底调整', '浅色底商品可手动框选主体，减少留白过多或主体过小的问题。'],
                ['导出控制', '支持 JPG、PNG、WebP，并尽量按平台体积限制压缩。'],
              ].map(([title, text]) => (
                <div key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">常见问题</h2>
            <div className="mt-4 space-y-3">
              {PRODUCT_IMAGE_FAQ.map(([question, answer]) => (
                <div key={question} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">{question}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

      </main>
      <RewardButton />
    </div>
  )
}
