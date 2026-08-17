import { canUseDesktopAiService } from './runtimePolicy'

const LOCAL_AI_URL = 'http://127.0.0.1:5179'
const AVAILABILITY_TTL_MS = 30_000

let lastAvailabilityCheck = 0
let lastAvailability = { scunet: false, drunet: false }
let availabilityPromise = null

function canvasToPngData(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('LOCAL_DENOISE_ENCODE_FAILED'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
      reader.onerror = () => reject(new Error('LOCAL_DENOISE_ENCODE_FAILED'))
      reader.readAsDataURL(blob)
    }, 'image/png')
  })
}

function dataUrlToImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('LOCAL_DENOISE_DECODE_FAILED'))
    image.src = dataUrl
  })
}

async function checkAvailability(model) {
  if (!canUseDesktopAiService()) return false
  const now = Date.now()
  if (now - lastAvailabilityCheck < AVAILABILITY_TTL_MS) return !!lastAvailability[model]
  if (availabilityPromise) return availabilityPromise.then(models => !!models[model])
  availabilityPromise = (async () => {
    try {
      const response = await fetch(`${LOCAL_AI_URL}/denoise/status`, {
        signal: AbortSignal.timeout(900),
      })
      const payload = await response.json().catch(() => ({}))
      lastAvailability = response.ok && payload.models
        ? { scunet: !!payload.models.scunet, drunet: !!payload.models.drunet }
        : { scunet: false, drunet: false }
    } catch {
      lastAvailability = { scunet: false, drunet: false }
    }
    lastAvailabilityCheck = Date.now()
    return lastAvailability
  })().finally(() => {
    availabilityPromise = null
  })
  return availabilityPromise.then(models => !!models[model])
}

export async function denoiseCanvasWithLocalAI(sourceCanvas, options = {}) {
  if (!canUseDesktopAiService()) throw new Error('LOCAL_DENOISE_DESKTOP_ONLY')
  const model = options.model === 'drunet' ? 'drunet' : 'scunet'
  if (!await checkAvailability(model)) throw new Error(`LOCAL_DENOISE_${model.toUpperCase()}_UNAVAILABLE`)
  const image = await canvasToPngData(sourceCanvas)
  const response = await fetch(`${LOCAL_AI_URL}/denoise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image,
      backend: model,
      strength: Math.max(0.35, Math.min(1, Number(options.strength) || 0.75)),
      clarity: Math.max(0, Math.min(1, Number(options.clarity) || 0)),
    }),
    signal: AbortSignal.timeout(300_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.image) {
    throw new Error(payload.error || 'LOCAL_DENOISE_FAILED')
  }
  const resultImage = await dataUrlToImage(`data:image/png;base64,${payload.image}`)
  const output = document.createElement('canvas')
  output.width = resultImage.naturalWidth || resultImage.width
  output.height = resultImage.naturalHeight || resultImage.height
  output.getContext('2d').drawImage(resultImage, 0, 0)
  output.dataset.denoiseBackend = payload.backend || model
  resultImage.src = ''
  return output
}
