const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export const BROWSER_AI_INPUT_LIMITS = {
  edge: 6000,
  pixels: 24_000_000,
}

export const BROWSER_AI_OUTPUT_LIMITS = {
  safeModePixels: 32_000_000,
  confirmationPixels: 70_000_000,
  maxPixels: 80_000_000,
}

export function getAiOutputMode(outputPixels) {
  if (outputPixels > BROWSER_AI_OUTPUT_LIMITS.maxPixels) return 'blocked'
  if (outputPixels > BROWSER_AI_OUTPUT_LIMITS.confirmationPixels) return 'confirm'
  if (outputPixels > BROWSER_AI_OUTPUT_LIMITS.safeModePixels) return 'safe'
  return 'normal'
}

export function getAiModelInputDimensions(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const scale = Math.min(
    targetWidth / (sourceWidth * 2),
    targetHeight / (sourceHeight * 2),
    1,
  )
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  }
}

export function canUseDesktopAiService(locationLike = globalThis.location) {
  if (!locationLike) return false
  const protocol = String(locationLike.protocol || '')
  const hostname = String(locationLike.hostname || '').toLowerCase()
  return (protocol === 'http:' || protocol === 'https:') && LOOPBACK_HOSTS.has(hostname)
}

export function getAiBackendLabel(status) {
  if (status === 'server') return '桌面本地 AI 服务已连接，图片只在这台电脑处理。'
  if (status === 'webgpu') return '浏览器 WebGPU AI 模型已就绪，图片不会上传服务器。'
  if (status === 'wasm') return '浏览器 WASM AI 模型已就绪，图片不会上传服务器。'
  return 'AI 放大会下载模型到浏览器运行，图片内容不上传服务器。'
}

export function getAiRuntimeErrorMessage(code) {
  if (code === 'AI_MODEL_LOAD_FAILED') {
    return '浏览器 AI 模型加载失败，请稍后重试，或关闭 AI 放大。'
  }
  if (code === 'AI_LOCAL_SERVICE_FAILED') {
    return '桌面本地 AI 服务处理失败，请重新打开 TU Scale 桌面版，或关闭 AI 放大。'
  }
  if (code === 'AI_MEMORY_FAILED' || code === 'AI_TILED_MEMORY_FAILED') {
    return 'AI 处理时浏览器内存不足，请降低输出尺寸、先裁切图片，或关闭 AI 放大。'
  }
  if (code === 'AI_INFERENCE_FAILED') {
    return 'AI 模型已加载，但本次推理失败。请降低图片尺寸后重试，或关闭 AI 放大。'
  }
  return ''
}
