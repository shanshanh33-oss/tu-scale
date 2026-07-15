import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

const WASM_ROOT = '/mediapipe/wasm'
const MODEL_PATH = '/models/face_landmarker.task'
const MAX_DETECTION_EDGE = 768

let landmarkerPromise = null

const getFaceLandmarker = async () => {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_PATH },
        runningMode: 'IMAGE',
        numFaces: 5,
        minFaceDetectionConfidence: 0.55,
        minFacePresenceConfidence: 0.55,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      })
    })().catch((error) => {
      landmarkerPromise = null
      throw error
    })
  }
  return landmarkerPromise
}

const connectionIndices = (connections) => {
  const indices = new Set()
  connections.forEach(({ start, end }) => {
    indices.add(start)
    indices.add(end)
  })
  return [...indices]
}

const pointFor = (landmarks, index, width, height) => {
  const point = landmarks[index]
  return point ? { x: point.x * width, y: point.y * height } : null
}

const pointsFor = (landmarks, indices, width, height) => (
  indices.map(index => pointFor(landmarks, index, width, height)).filter(Boolean)
)

const cross = (origin, a, b) => (
  (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
)

const convexHull = (points) => {
  if (points.length <= 3) return points
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const lower = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

const expandedHull = (points, scale = 1) => {
  const hull = convexHull(points)
  if (hull.length < 3 || scale === 1) return hull
  const center = hull.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 })
  center.x /= hull.length
  center.y /= hull.length
  return hull.map(point => ({
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale,
  }))
}

const tracePolygon = (ctx, points) => {
  if (points.length < 3) return false
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.closePath()
  return true
}

const faceOvalIndices = connectionIndices(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL)
const leftEyeIndices = connectionIndices([
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
])
const rightEyeIndices = connectionIndices([
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
])
const lipIndices = connectionIndices(FaceLandmarker.FACE_LANDMARKS_LIPS)
const noseIndices = [1, 2, 4, 5, 6, 19, 94, 97, 98, 168, 195, 197, 326, 327]

const getFaceGeometry = (landmarks, width, height, sensitivity) => {
  const response = Math.pow(sensitivity, 1.25)
  const oval = expandedHull(pointsFor(landmarks, faceOvalIndices, width, height), 0.88 + response * 0.12)
  if (oval.length < 3) return null
  const xs = oval.map(point => point.x)
  const ys = oval.map(point => point.y)
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
  return {
    oval,
    bounds,
    sensitivity: response,
    leftEye: expandedHull(pointsFor(landmarks, leftEyeIndices, width, height), 1.55 - response * 0.43),
    rightEye: expandedHull(pointsFor(landmarks, rightEyeIndices, width, height), 1.55 - response * 0.43),
    lips: expandedHull(pointsFor(landmarks, lipIndices, width, height), 1.45 - response * 0.3),
    nose: pointsFor(landmarks, noseIndices, width, height),
  }
}

const cutOutFaceFeatures = (ctx, face) => {
  ctx.globalCompositeOperation = 'destination-out'
  for (const feature of [face.leftEye, face.rightEye, face.lips]) {
    if (tracePolygon(ctx, feature)) ctx.fill()
  }

  if (face.nose.length >= 3) {
    const xs = face.nose.map(point => point.x)
    const ys = face.nose.map(point => point.y)
    const faceWidth = face.bounds.maxX - face.bounds.minX
    const faceHeight = face.bounds.maxY - face.bounds.minY
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const featureProtection = 1.32 - face.sensitivity * 0.37
    ctx.beginPath()
    ctx.ellipse(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      Math.max((maxX - minX) / 2 + faceWidth * 0.025, faceWidth * 0.09) * featureProtection,
      Math.max((maxY - minY) / 2 + faceHeight * 0.018, faceHeight * 0.16) * featureProtection,
      0,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }

  if (tracePolygon(ctx, face.oval)) {
    ctx.lineWidth = Math.max(2, (face.bounds.maxX - face.bounds.minX) * (0.05 - face.sensitivity * 0.032))
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
}

export const createFaceSkinMask = async (sourceCanvas, sensitivity = 0.6) => {
  const normalizedSensitivity = Math.max(0, Math.min(1, sensitivity))
  const scale = Math.min(1, MAX_DETECTION_EDGE / Math.max(sourceCanvas.width, sourceCanvas.height))
  const width = Math.max(1, Math.round(sourceCanvas.width * scale))
  const height = Math.max(1, Math.round(sourceCanvas.height * scale))
  const detectionCanvas = document.createElement('canvas')
  detectionCanvas.width = width
  detectionCanvas.height = height
  const detectionCtx = detectionCanvas.getContext('2d', { willReadFrequently: true })
  detectionCtx.imageSmoothingEnabled = true
  detectionCtx.imageSmoothingQuality = 'high'
  detectionCtx.drawImage(sourceCanvas, 0, 0, width, height)

  const landmarker = await getFaceLandmarker()
  const result = landmarker.detect(detectionCanvas)
  const faces = (result.faceLandmarks || [])
    .map(landmarks => getFaceGeometry(landmarks, width, height, normalizedSensitivity))
    .filter(Boolean)
  if (faces.length === 0) return null

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = width
  maskCanvas.height = height
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
  maskCtx.fillStyle = '#fff'
  maskCtx.strokeStyle = '#fff'
  for (const face of faces) {
    if (tracePolygon(maskCtx, face.oval)) maskCtx.fill()
  }
  for (const face of faces) cutOutFaceFeatures(maskCtx, face)

  const rgba = maskCtx.getImageData(0, 0, width, height).data
  const data = new Uint8Array(width * height)
  for (let i = 0, pixel = 0; i < rgba.length; i += 4, pixel++) data[pixel] = rgba[i + 3]

  return { data, width, height, faceCount: faces.length }
}
