export const readImage = (src) => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'))
  img.src = src
})

export const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(new Error('FILE_READ_FAILED'))
  reader.readAsDataURL(file)
})

export const canvasToBlob = (canvas, mimeType, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob)
    else reject(new Error('EXPORT_FAILED'))
  }, mimeType, quality)
})

export const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const getBaseName = (name) => name.replace(/\.[^.]+$/, '')

export const formatBytes = (bytes) => {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const revokeObjectUrl = (url) => {
  if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url)
}

const ANALYTICS_VISITOR_KEY = 'tuscale_visitor_id'
const ANALYTICS_SESSION_KEY = 'tuscale_session_id'
const ANALYTICS_BATCH_SIZE = 5
const ANALYTICS_FLUSH_DELAY = 1200
let analyticsQueue = []
let analyticsFlushTimer = null
let analyticsListenersReady = false

const isLocalAnalyticsEnvironment = () => {
  if (typeof window === 'undefined') return false
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname)
}

const createAnalyticsId = (prefix) => {
  const random = crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}_${random}`
}

const getStoredAnalyticsId = (storage, key, prefix) => {
  let value = storage.getItem(key)
  if (!value) {
    value = createAnalyticsId(prefix)
    storage.setItem(key, value)
  }
  return value
}

const getAnalyticsIdentity = () => {
  if (typeof window === 'undefined') return {}
  try {
    return {
      visitorId: getStoredAnalyticsId(localStorage, ANALYTICS_VISITOR_KEY, 'v'),
      sessionId: getStoredAnalyticsId(sessionStorage, ANALYTICS_SESSION_KEY, 's'),
    }
  } catch {
    return {}
  }
}

const inferTool = () => {
  if (typeof window === 'undefined') return 'unknown'
  if (window.location.pathname === '/product-image') return 'product_image'
  return window.location.pathname === '/format-converter' ? 'converter' : 'upscale'
}

const sendAnalyticsEvents = (events, useBeacon = false) => {
  if (typeof window === 'undefined') return
  const payload = JSON.stringify({ events })
  try {
    if (useBeacon && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' })
      navigator.sendBeacon('/api/track', blob)
      return
    }
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Analytics should never interrupt image processing.
  }
}

const flushAnalytics = (useBeacon = false) => {
  if (analyticsFlushTimer) {
    clearTimeout(analyticsFlushTimer)
    analyticsFlushTimer = null
  }
  if (!analyticsQueue.length) return
  const events = analyticsQueue
  analyticsQueue = []
  sendAnalyticsEvents(events, useBeacon)
}

const ensureAnalyticsFlushListeners = () => {
  if (analyticsListenersReady || typeof window === 'undefined') return
  analyticsListenersReady = true
  window.addEventListener('pagehide', () => flushAnalytics(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAnalytics(true)
  })
}

export const trackEvent = (event, data = {}) => {
  if (typeof window === 'undefined' || isLocalAnalyticsEnvironment()) return
  ensureAnalyticsFlushListeners()
  analyticsQueue.push({
    event,
    eventId: data.eventId || createAnalyticsId('e'),
    data: {
      tool: inferTool(),
      ...data,
      ...getAnalyticsIdentity(),
    },
  })
  if (analyticsQueue.length >= ANALYTICS_BATCH_SIZE) {
    flushAnalytics()
    return
  }
  if (!analyticsFlushTimer) {
    analyticsFlushTimer = setTimeout(() => flushAnalytics(), ANALYTICS_FLUSH_DELAY)
  }
}

export const fitSize = (sourceW, sourceH, targetW, targetH, mode = 'contain', focus = 'center') => {
  const focusMap = {
    top: { x: 0.5, y: 0 },
    bottom: { x: 0.5, y: 1 },
    left: { x: 0, y: 0.5 },
    right: { x: 1, y: 0.5 },
    center: { x: 0.5, y: 0.5 },
  }
  const point = focusMap[focus] || focusMap.center

  if (mode === 'cover') {
    const ratio = Math.max(targetW / sourceW, targetH / sourceH)
    const w = Math.round(sourceW * ratio)
    const h = Math.round(sourceH * ratio)
    return {
      w,
      h,
      x: Math.round((targetW - w) * point.x),
      y: Math.round((targetH - h) * point.y),
    }
  }

  const ratio = Math.min(targetW / sourceW, targetH / sourceH)
  const w = Math.round(sourceW * ratio)
  const h = Math.round(sourceH * ratio)
  return {
    w,
    h,
    x: Math.round((targetW - w) / 2),
    y: Math.round((targetH - h) / 2),
  }
}
