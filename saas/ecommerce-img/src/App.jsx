import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { Upload, Download, ZoomIn, Maximize2, Loader2, Sparkles, X, Image as ImageIcon, FolderOpen, CheckCircle, AlertCircle, FileDown, Crop, Copy } from 'lucide-react'
import JSZip from 'jszip'
import { loadModel, processWithAI, isModelLoaded } from './ai/waifu2x'
import RewardButton from './tools/RewardButton'
import { trackEvent } from './tools/shared'

const QUALITY_PRESETS = [
  { edge: 1080, label: '1080级', desc: '最长边 1080px' },
  { edge: 2560, label: '2K级', desc: '最长边 2560px' },
  { edge: 3840, label: '4K级', desc: '最长边 3840px' },
  { edge: 7680, label: '8K级', desc: '最长边 7680px' },
]

const CROP_PRESETS = [
  { id: 'free', label: '自由', ratio: null, w: null, h: null },
  { id: '1-1', label: '1:1 方图', ratio: 1, w: 1080, h: 1080 },
  { id: '4-5', label: '4:5 竖图', ratio: 4 / 5, w: 1080, h: 1350 },
  { id: '3-4', label: '3:4 封面', ratio: 3 / 4, w: 1080, h: 1440 },
  { id: '16-9', label: '16:9 横图', ratio: 16 / 9, w: 1920, h: 1080 },
  { id: '9-16', label: '9:16 竖屏', ratio: 9 / 16, w: 1080, h: 1920 },
  { id: '2-3', label: '2:3 海报', ratio: 2 / 3, w: 1200, h: 1800 },
  { id: 'wechat', label: '公众号头图', ratio: 900 / 383, w: 900, h: 383 },
]

const FORMAT_OPTIONS = [
  { value: 'png', label: 'PNG', tip: '保留透明背景，适合截图、图标和线稿；体积通常更大。' },
  { value: 'jpeg', label: 'JPEG', tip: '适合照片、电商图和证件照；体积小，不保留透明背景。' },
  { value: 'webp', label: 'WebP', tip: '适合网页展示，画质和体积平衡好；部分平台兼容性略弱。' },
]

 let batchIdCounter = 0
 const MAX_BATCH = 50
 const STORAGE_KEY = 'tuscale_settings'
const IMAGE_EXTS = ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.tiff','.tif','.svg','.ico','.avif','.heic','.heif']
const WARN_OUTPUT_PIXELS = 45_000_000
const MAX_OUTPUT_PIXELS = 80_000_000
const MAX_AI_INPUT_EDGE = 2048
const MAX_AI_INPUT_PIXELS = 4_200_000
const MOBILE_MAX_OUTPUT_PIXELS = 24_000_000
const MOBILE_MAX_AI_INPUT_PIXELS = 4_000_000
const MOBILE_BREAKPOINT = 767
const createExportId = () => crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const revokeObjectUrl = (url) => {
  if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url)
}

const formatMegapixels = (pixels) => `${(pixels / 1_000_000).toFixed(pixels >= 10_000_000 ? 0 : 1)}MP`

const revokeBatchResultUrls = (items) => {
  items.forEach(item => revokeObjectUrl(item.result))
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const getPresetRatio = (presetId) => CROP_PRESETS.find(item => item.id === presetId)?.ratio || null

const formatRatio = (ratio) => {
  if (!ratio) return '自由比例'
  const candidates = [
    [1, 1], [4, 5], [3, 4], [16, 9], [9, 16], [2, 3], [900, 383],
  ]
  const match = candidates.find(([w, h]) => Math.abs((w / h) - ratio) < 0.01)
  if (match) return `${match[0]}:${match[1]}`
  return `${ratio.toFixed(2)}:1`
}

const getNormalizedCropRatio = (outputRatio, imageWidth, imageHeight) => {
  if (!outputRatio || !imageWidth || !imageHeight) return null
  return outputRatio / (imageWidth / imageHeight)
}

const fitEdgeToRatio = (edge, ratio = 1) => {
  if (!edge || !ratio) return { w: edge || 0, h: edge || 0 }
  if (ratio >= 1) return { w: edge, h: Math.round(edge / ratio) }
  return { w: Math.round(edge * ratio), h: edge }
}

const getDefaultCropRect = (width, height, presetId = 'free') => {
  const ratio = getPresetRatio(presetId)
  if (!ratio || !width || !height) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
  const imageRatio = width / height
  if (imageRatio > ratio) {
    const cropW = clamp((height * ratio) / width, 0.1, 1)
    return { x: (1 - cropW) / 2, y: 0, w: cropW, h: 1 }
  }
  const cropH = clamp(width / ratio / height, 0.1, 1)
  return { x: 0, y: (1 - cropH) / 2, w: 1, h: cropH }
}

const normalizeCropRect = (rect, ratio = null) => {
  let next = {
    x: clamp(rect.x, 0, 0.98),
    y: clamp(rect.y, 0, 0.98),
    w: clamp(rect.w, 0.02, 1),
    h: clamp(rect.h, 0.02, 1),
  }
  if (ratio) {
    const currentRatio = next.w / next.h
    if (currentRatio > ratio) next.w = next.h * ratio
    else next.h = next.w / ratio
  }
  if (next.x + next.w > 1) next.x = 1 - next.w
  if (next.y + next.h > 1) next.y = 1 - next.h
  return next
}

const getSourceDims = (dims, cropEnabled, rect) => {
  if (!cropEnabled || !dims) return dims
  return {
    w: Math.max(1, Math.round(dims.w * rect.w)),
    h: Math.max(1, Math.round(dims.h * rect.h)),
  }
}

const resizeCropRect = (rect, dx, dy, ratio = null) => {
  if (!ratio) {
    return normalizeCropRect({
      ...rect,
      w: rect.w + dx,
      h: rect.h + dy,
    })
  }

  const maxW = 1 - rect.x
  const maxH = 1 - rect.y
  const maxWByRatio = Math.min(maxW, maxH * ratio)
  const proposedW = Math.abs(dx) >= Math.abs(dy) ? rect.w + dx : (rect.h + dy) * ratio
  const nextW = clamp(proposedW, 0.02, maxWByRatio)

  return {
    x: rect.x,
    y: rect.y,
    w: nextW,
    h: nextW / ratio,
  }
}

 function App() {
  const [isMobileLayout, setIsMobileLayout] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT)

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    const updateMobileLayout = () => setIsMobileLayout(media.matches)
    updateMobileLayout()
    media.addEventListener?.('change', updateMobileLayout)
    return () => media.removeEventListener?.('change', updateMobileLayout)
  }, [])

  useEffect(() => {
    document.title = '免费 AI 图片放大工具 - 本地处理不上传 | TU Scale'
    let description = document.querySelector('meta[name="description"]')
    if (!description) {
      description = document.createElement('meta')
      description.setAttribute('name', 'description')
      document.head.appendChild(description)
    }
    description.setAttribute('content', 'TU Scale 是完全在浏览器本地运行的 AI 图片放大工具，支持保色 AI 放大、智能锐化和抗锯齿，图片绝不上传服务器。')
  }, [])

  // --- 单图模式状态 ---
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [origDims, setOrigDims] = useState(null)

  // --- 公共控制参数 ---
  const [scaleMode, setScaleMode] = useState('scale')
  const [scale, setScale] = useState(2)
  const [targetMode, setTargetMode] = useState('preset')
  const [targetIdx, setTargetIdx] = useState(2)
  const [customW, setCustomW] = useState(2048)
  const [customH, setCustomH] = useState(2048)
  const [format, setFormat] = useState('png')
  const [keepRatio, setKeepRatio] = useState(true)
  const [smartSharpen, setSmartSharpen] = useState(true)
  const [sharpenAmount, setSharpenAmount] = useState(1.2)
  const [aiUpscale, setAiUpscale] = useState(false)
  const [aiDetailMode] = useState('preserve')
  const [reduceArtifacts, setReduceArtifacts] = useState(false)
  const [reduceMoire, setReduceMoire] = useState(false)
  const [faceAwareProtection, setFaceAwareProtection] = useState(true)
  const [faceSkinStrength, setFaceSkinStrength] = useState(60)
  const [deblur, setDeblur] = useState(false)
  const [autoLevels, setAutoLevels] = useState(false)
  const [vibrance, setVibrance] = useState(false)
  const [clahe] = useState(false)
  const [smartDenoise, setSmartDenoise] = useState(false)
  const [edgeInterpolation, setEdgeInterpolation] = useState(false)
  const [antiAlias, setAntiAlias] = useState(false)
  const [aiModelLoading, setAiModelLoading] = useState(false)
  const [aiModelReady, setAiModelReady] = useState(false)
  const [cropEnabled, setCropEnabled] = useState(false)
  const [cropPreset, setCropPreset] = useState('free')
  const [cropRect, setCropRect] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
  const [cropDrag, setCropDrag] = useState(null)

  // --- 单图处理状态 ---
  const [processing, setProcessing] = useState(false)
    const [progress, setProgress] = useState(0)
    const [processStage, setProcessStage] = useState('')
  const [result, setResult] = useState(null)
  const [resultBlob, setResultBlob] = useState(null)
    const [resultDims, setResultDims] = useState(null)
  const [resultSize, setResultSize] = useState(null)
  const [compareSource, setCompareSource] = useState(null)
  const [compareSourceDims, setCompareSourceDims] = useState(null)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState('compare')
  const [compareZoom, setCompareZoom] = useState(1)
  const [showOriginalOnPress, setShowOriginalOnPress] = useState(false)
  const [comparePan, setComparePan] = useState({ x: 0, y: 0 })
  const compareGestureRef = useRef(null)
  const [, setImgZoom] = useState(1)
  const [, setImgPan] = useState({ x: 0, y: 0 })
  const [shareNotice, setShareNotice] = useState('')
    // --- 预加载 AI 模型 ---
    useEffect(() => {
      if (!aiUpscale) {
        setAiModelLoading(false)
        return
      }
      if (isModelLoaded()) {
        setAiModelReady(true)
        return
      }
      let cancelled = false
      setAiModelLoading(true)
      loadModel()
        .then((ok) => { if (!cancelled) setAiModelReady(!!ok) })
        .catch(() => { if (!cancelled) setAiModelReady(false) })
        .finally(() => { if (!cancelled) setAiModelLoading(false) })
      return () => { cancelled = true }
    }, [aiUpscale])

  const ensureAiModel = useCallback(async () => {
    if (!aiUpscale || aiModelReady) return
    setAiModelLoading(true)
    try {
        const ok = await loadModel()
        setAiModelReady(!!ok)
        if (!ok) {
          setAiUpscale(false)
          throw new Error('AI_MODEL_LOAD_FAILED')
        }
    } finally {
      setAiModelLoading(false)
    }
  }, [aiUpscale, aiModelReady])

  const getProcessErrorMessage = useCallback((err) => {
      const msg = err?.message || ''
      if (msg === 'AI_MODEL_LOAD_FAILED' || (aiUpscale && /ai|onnx|model|backend|fetch|server/i.test(msg))) {
        return 'AI 模型加载失败，请关闭 AI 放大后重试，或稍后再试。'
      }
      if (msg === 'EXPORT_FAILED') return '图片导出失败，请换成 PNG 或降低输出尺寸后重试。'
      return msg || '处理失败，请换一张图片或降低输出尺寸后重试。'
    }, [aiUpscale])

  // --- 批量模式状态 ---
  const [batchMode, setBatchMode] = useState(false)
  const [batchItems, setBatchItems] = useState([])
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [zipDownloading, setZipDownloading] = useState(false)
  const [batchToast, setBatchToast] = useState('')
  const [fileNameTemplate, setFileNameTemplate] = useState('{name}_{w}x{h}')
  const [dragOverIdx, setDragOverIdx] = useState(null)

  const fileRef = useRef(null)
  const folderRef = useRef(null)
  const cropStageRef = useRef(null)

  // 用 DOM 方式设置 webkitdirectory，确保浏览器识别为文件夹选择器
  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute('webkitdirectory', '')
    }
  }, [batchMode])
   const batchCancelRef = useRef(false)
const pendingCountRef = useRef(0)
const doneCountRef = useRef(0)
const keyRefs = useRef({})
const batchItemsRef = useRef([])
const singleExportIdRef = useRef('')
const batchExportRef = useRef({ signature: '', id: '' })
const zipDownloadLockRef = useRef(false)

 const leftScrollRef = useRef(null)
  const rightScrollRef = useRef(null)
  const syncingRef = useRef(false)
  const [syncedScroll, setSyncedScroll] = useState(true)
  const singleViewer = useRef({ z:1, x:0, y:0, drag:false, mx:0, my:0, sx:0, sy:0 })
  const singleImgRef = useRef(null)
  const fsLeftScrollRef = useRef(null)
  const fsRightScrollRef = useRef(null)
  const fsSyncingRef = useRef(false)

  useEffect(() => {
    return () => revokeObjectUrl(result)
  }, [result])

  useEffect(() => {
    return () => revokeObjectUrl(compareSource)
  }, [compareSource])

  useEffect(() => {
    batchItemsRef.current = batchItems
  }, [batchItems])

  useEffect(() => {
    return () => revokeBatchResultUrls(batchItemsRef.current)
  }, [])

  useEffect(() => {
    trackEvent('page_view', { path: window.location.pathname })
    if (!sessionStorage.getItem('tuscale_session_tracked')) {
      sessionStorage.setItem('tuscale_session_tracked', '1')
      trackEvent('session_start', { path: window.location.pathname })
    }
  }, [])

 // --- 键盘快捷键 ---
 useEffect(() => {
   const handler = (e) => {
     const isMac = navigator.platform.includes('Mac')
     const mod = isMac ? e.metaKey : e.ctrlKey
     const tag = document.activeElement?.tagName
     if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const k = keyRefs.current
      if (mod && e.key === 'o') { e.preventDefault(); fileRef.current?.click() }
      if (mod && e.key === 'Enter') {
        e.preventDefault()
        if (k.batchMode) { if (pendingCountRef.current > 0 && !k.batchProcessing) k.handleBatchProcess?.() }
        else if (k.preview && !k.processing) k.handleProcess?.()
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (k.batchMode && doneCountRef.current > 0) k.downloadAllAsZip?.()
        else if (k.result) k.handleDownload?.()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

 // --- 从 localStorage 读取上次设置 ---
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const s = JSON.parse(saved)
        if (s.scale) setScale(s.scale)
        if (s.format) setFormat(s.format)
        if (s.smartSharpen !== undefined) setSmartSharpen(s.smartSharpen)
        if (s.sharpenAmount !== undefined) setSharpenAmount(s.sharpenAmount)
        if (s.aiUpscale !== undefined) setAiUpscale(s.aiUpscale)
        if (s.reduceArtifacts !== undefined) setReduceArtifacts(s.reduceArtifacts)
        if (s.reduceMoire !== undefined) setReduceMoire(s.reduceMoire)
        if (s.faceAwareProtection !== undefined) setFaceAwareProtection(s.faceAwareProtection)
        if (Number.isFinite(s.faceSkinStrength)) setFaceSkinStrength(Math.max(0, Math.min(100, s.faceSkinStrength)))
        if (s.deblur !== undefined) setDeblur(s.deblur)
        if (s.autoLevels !== undefined) setAutoLevels(s.autoLevels)
        if (s.vibrance !== undefined) setVibrance(s.vibrance)
        if (s.smartDenoise !== undefined) setSmartDenoise(s.smartDenoise)
        if (s.edgeInterpolation !== undefined) setEdgeInterpolation(s.edgeInterpolation)
        if (s.antiAlias !== undefined) setAntiAlias(s.antiAlias)
        if (s.scaleMode) setScaleMode(s.scaleMode)
        if (s.targetMode) setTargetMode(s.targetMode)
        if (s.targetIdx !== undefined) setTargetIdx(s.targetIdx)
        if (s.keepRatio !== undefined) setKeepRatio(s.keepRatio)
        if (s.customW) setCustomW(s.customW)
        if (s.customH) setCustomH(s.customH)
        if (s.fileNameTemplate) setFileNameTemplate(s.fileNameTemplate)
      }
    } catch {
      // Ignore malformed saved settings and continue with defaults.
    }
  }, [])

  // 手机网页固定使用安全的单图设置，避免桌面端保存的高负载参数在隐藏后继续生效。
  useEffect(() => {
    if (!isMobileLayout) return
    setBatchMode(false)
    setBatchItems(prev => {
      revokeBatchResultUrls(prev)
      return []
    })
    setScaleMode('scale')
    setScale(2)
    setCropEnabled(false)
    setKeepRatio(true)
    setSmartSharpen(true)
    setSharpenAmount(1.2)
    setReduceArtifacts(false)
    setReduceMoire(false)
    setFaceAwareProtection(false)
    setDeblur(false)
    setAutoLevels(false)
    setVibrance(false)
    setSmartDenoise(false)
    setEdgeInterpolation(false)
    setAntiAlias(false)
  }, [isMobileLayout])

  // --- 保存设置到 localStorage ---
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      scale, format, smartSharpen, sharpenAmount, aiUpscale, aiDetailMode, reduceArtifacts, reduceMoire, faceAwareProtection, faceSkinStrength, deblur, autoLevels, vibrance, clahe, smartDenoise, edgeInterpolation, antiAlias, scaleMode, targetMode, targetIdx,
      keepRatio, customW, customH, fileNameTemplate
    }))
  }, [scale, format, smartSharpen, sharpenAmount, aiUpscale, aiDetailMode, reduceArtifacts, reduceMoire, faceAwareProtection, faceSkinStrength, deblur, autoLevels, vibrance, clahe, smartDenoise, edgeInterpolation, antiAlias, scaleMode, targetMode, targetIdx, keepRatio, customW, customH, fileNameTemplate])

  // --- 单图模式 effect ---
  useEffect(() => {
    singleExportIdRef.current = ''
    setResult(null)
    setResultBlob(null)
    setComparePan({ x: 0, y: 0 })
    setShowOriginalOnPress(false)
    setResultDims(null)
    setResultSize(null)
    setCompareSource(prev => {
      revokeObjectUrl(prev)
      return null
    })
    setCompareSourceDims(null)
    setProcessStage('')
  }, [scaleMode, scale, targetMode, targetIdx, customW, customH, format, keepRatio, smartSharpen, sharpenAmount, aiUpscale, aiDetailMode, reduceArtifacts, reduceMoire, faceAwareProtection, faceSkinStrength, deblur, autoLevels, vibrance, clahe, smartDenoise, edgeInterpolation, antiAlias, cropEnabled, cropRect])

  // --- 单图文件处理 ---
  const handleFile = useCallback((f) => {
    if (!f) return
      trackEvent('image_uploaded', { mode: 'single', count: 1 })
      setFile(f)
      setResult(null)
      setResultDims(null)
      setResultSize(null)
      revokeObjectUrl(compareSource)
      setCompareSource(null)
      setCompareSourceDims(null)
      setError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        setOrigDims({ w: img.width, h: img.height })
        setCustomW(img.width)
        setCustomH(img.height)
        setCropRect(getDefaultCropRect(img.width, img.height, cropPreset))
        setPreview(e.target.result)
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(f)
  }, [cropPreset, compareSource])

  // --- 单图拖拽 ---
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    if (batchMode) {
      addFilesWithLimit(e.dataTransfer.files)
      return
   }
   const f = e.dataTransfer.files[0]
    if (f) { const fext = '.' + f.name.split('.').pop().toLowerCase(); if (IMAGE_EXTS.includes(fext)) handleFile(f) }
 }, [handleFile, batchMode])

    const handleRemove = useCallback((e) => {
      e.stopPropagation()
      setFile(null); setPreview(null); setOrigDims(null)
      setResult(null); setResultDims(null); setResultSize(null); setCompareSource(null); setCompareSourceDims(null); setProcessStage('')
    }, [])

  // --- 批量文件处理（含上限检查）---
 const addFilesWithLimit = useCallback((fileList) => {
   const validFiles = []
   for (let i = 0; i < fileList.length; i++) {
     const f = fileList[i]
     // 排除隐藏文件（.DS_Store 等）
     if (f.name.startsWith('.') || f.name.startsWith('_')) continue
     // 同时检查 MIME type 和扩展名
     const ext = '.' + f.name.split('.').pop().toLowerCase()
      if (IMAGE_EXTS.includes(ext) && (!f.type || f.type.startsWith('image/'))) validFiles.push(f)
   }
    if (validFiles.length === 0) return
    trackEvent('image_uploaded', { mode: 'batch', count: validFiles.length })

    setBatchItems(prev => {
      const remaining = MAX_BATCH - prev.length
      if (remaining <= 0) {
        setBatchToast(`\u6700\u591a\u540c\u65f6\u4e0a\u4f20 ${MAX_BATCH} \u5f20\u56fe\u7247\uff0c\u5df2\u8fbe\u4e0a\u9650`)
        setTimeout(() => setBatchToast(''), 3500)
        return prev
      }
      const toAdd = validFiles.slice(0, remaining)
      if (validFiles.length > remaining) {
        setBatchToast(`\u6700\u591a\u540c\u65f6\u4e0a\u4f20 ${MAX_BATCH} \u5f20\u56fe\u7247\uff0c\u5df2\u5ffd\u7565 ${validFiles.length - remaining} \u5f20`)
        setTimeout(() => setBatchToast(''), 3500)
      }
      const newItems = toAdd.map(f => {
        const id = ++batchIdCounter
        const reader = new FileReader()
        reader.onload = (e) => {
          const img = new Image()
          img.onload = () => {
            setBatchItems(p => p.map(it => it.id === id ? { ...it, preview: e.target.result, origDims: { w: img.width, h: img.height } } : it))
          }
          img.src = e.target.result
        }
        reader.readAsDataURL(f)
          return { id, file: f, preview: null, origDims: null, result: null, resultBlob: null, resultDims: null, resultSize: null, status: 'pending', progress: 0, stage: '', error: null }
      })
      return [...prev, ...newItems]
    })
  }, [])

  const handleFileInputChange = useCallback((e) => {
    if (batchMode) {
      addFilesWithLimit(e.target.files)
    } else {
      handleFile(e.target.files[0])
    }
    e.target.value = ''
  }, [batchMode, handleFile, addFilesWithLimit])

    const removeBatchItem = useCallback((id) => {
      setBatchItems(prev => {
        const removed = prev.find(it => it.id === id)
        if (removed) revokeObjectUrl(removed.result)
        return prev.filter(it => it.id !== id)
      })
    }, [])

  const clearAllBatch = useCallback(() => {
    setBatchItems(prev => {
      revokeBatchResultUrls(prev)
      return []
    })
  }, [])

  const resetResultState = useCallback(() => {
    setResult(null)
    setResultDims(null)
    setResultSize(null)
    revokeObjectUrl(compareSource)
    setCompareSource(null)
    setCompareSourceDims(null)
    setProcessStage('')
    setError(null)
  }, [compareSource])

  const applyCropPreset = useCallback((presetId) => {
    const preset = CROP_PRESETS.find(item => item.id === presetId) || CROP_PRESETS[0]
    resetResultState()
    setCropPreset(preset.id)
    setCropEnabled(true)
    if (origDims) setCropRect(getDefaultCropRect(origDims.w, origDims.h, preset.id))
    if (preset.w && preset.h) {
      setScaleMode('target')
      setTargetMode('custom')
      setCustomW(preset.w)
      setCustomH(preset.h)
      setKeepRatio(false)
      setFormat(preset.id === 'wechat' ? 'jpeg' : format)
    }
    trackEvent('crop_preset_selected', { id: preset.id })
  }, [format, origDims, resetResultState])

  const setToolMode = useCallback((nextBatchMode) => {
    if (nextBatchMode === batchMode) return
    setBatchMode(nextBatchMode)
    clearAllBatch()
    setFile(null)
    setPreview(null)
    setOrigDims(null)
    setResult(null)
    setResultDims(null)
    setResultSize(null)
    revokeObjectUrl(compareSource)
    setCompareSource(null)
    setCompareSourceDims(null)
    setProcessStage('')
    setError(null)
  }, [batchMode, clearAllBatch, compareSource])

  const updateCropFromPointer = useCallback((event) => {
    if (!cropDrag || !cropStageRef.current) return
    const bounds = cropStageRef.current.getBoundingClientRect()
    const dx = (event.clientX - cropDrag.startX) / bounds.width
    const dy = (event.clientY - cropDrag.startY) / bounds.height
    const ratio = getNormalizedCropRatio(getPresetRatio(cropPreset), origDims?.w, origDims?.h)
    if (cropDrag.type === 'move') {
      setCropRect(normalizeCropRect({
        ...cropDrag.startRect,
        x: cropDrag.startRect.x + dx,
        y: cropDrag.startRect.y + dy,
      }, ratio))
      return
    }
    setCropRect(resizeCropRect(cropDrag.startRect, dx, dy, ratio))
  }, [cropDrag, cropPreset, origDims])

  useEffect(() => {
    if (!cropDrag) return undefined
    const handleMove = (event) => updateCropFromPointer(event)
    const handleUp = () => setCropDrag(null)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [cropDrag, updateCropFromPointer])


  const handleFolderSelect = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
        const dirHandle = await window.showDirectoryPicker()
        const allFiles = []
        const collectFiles = async (handle) => {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
              allFiles.push(await entry.getFile())
            } else if (entry.kind === 'directory') {
              await collectFiles(entry)
            }
          }
        }
        await collectFiles(dirHandle)
        if (allFiles.length > 0) {
          const dt = new DataTransfer()
          allFiles.forEach(f => dt.items.add(f))
          addFilesWithLimit(dt.files)
        }
      } else {
        folderRef.current?.click()
      }
    } catch(e) {
      if (e.name !== 'AbortError') {
        console.warn('Folder picker error')
        folderRef.current?.click()
      }
    }
  }, [addFilesWithLimit])

  const handleFolderUpload = useCallback((e) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesWithLimit(e.target.files)
    }
    e.target.value = ''
  }, [addFilesWithLimit])

  // --- 智能检测（分析图片并自动推荐增强选项）---
  const handleSmartDetect = useCallback(() => {
    let items = []
    if (batchMode) {
      items = batchItems.filter(it => it.preview && it.origDims)
    } else if (preview) {
      items = [{ preview, origDims: { w: 1, h: 1 } }]
    }
    if (items.length === 0) {
      setBatchToast('\u8bf7\u5148\u4e0a\u4f20\u56fe\u7247')
      setTimeout(() => setBatchToast(''), 3000)
      return
    }

    const analyze = (dataUrl) => new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        const ctx = c.getContext('2d')
        const ms = 200, s = Math.min(ms / img.width, ms / img.height)
        c.width = Math.round(img.width * s)
        c.height = Math.round(img.height * s)
        ctx.drawImage(img, 0, 0, c.width, c.height)
        const d = ctx.getImageData(0, 0, c.width, c.height).data
        const w = c.width, h = c.height

        // 模糊检测：Laplacian 方差
        let lapSum = 0
        for (let y = 1; y < h - 1; y++)
          for (let x = 1; x < w - 1; x++) {
            const i = (y * w + x) * 4
            lapSum += Math.abs(d[i] * 4 - d[(y-1)*w*4+x*4] - d[(y+1)*w*4+x*4] - d[y*w*4+(x-1)*4] - d[y*w*4+(x+1)*4])
          }
        const lapVar = lapSum / ((w-2) * (h-2))

        // 对比度检测：直方图范围
        let mn = 255, mx = 0
        for (let i = 0; i < d.length; i += 4) {
          const g = Math.round(d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114)
          if (g < mn) mn = g
          if (g > mx) mx = g
        }

        // 饱和度检测
        let satSum = 0, satN = 0
        for (let i = 0; i < d.length; i += 8) {
          const r = d[i]/255, g = d[i+1]/255, b = d[i+2]/255
          const M = Math.max(r,g,b), mm = Math.min(r,g,b)
          satSum += M === 0 ? 0 : (M-mm)/M
          satN++
        }

        resolve({
          blurry: lapVar < 12,
          lowContrast: (mx - mn) < 100,
          lowSat: (satSum / satN) < 0.12
        })
      }
      img.src = dataUrl
    })

    ;(async () => {
      const results = await Promise.all(items.map(it => analyze(it.preview)))
      const t = results.length
      const willDeblur = results.filter(r => r.blurry).length > t / 2
      const willAutoLevels = results.filter(r => r.lowContrast).length > t / 2
      const willVibrance = results.filter(r => r.lowSat).length > t / 2
      setDeblur(willDeblur)
      setAutoLevels(willAutoLevels)
      setVibrance(willVibrance)
      setSmartSharpen(true)

      // Toast feedback
      const msgs = []
      msgs.push('\u667a\u80fd\u68c0\u6d4b\u5b8c\u6210\uff1a')
      if (willDeblur) msgs.push(' \u2714\u53bb\u6a21\u7cca')
      if (willAutoLevels) msgs.push(' \u2714\u81ea\u52a8\u8272\u9636')
      if (willVibrance) msgs.push(' \u2714\u81ea\u7136\u9971\u548c\u5ea6')
      if (!willDeblur && !willAutoLevels && !willVibrance) msgs.push(' \u56fe\u7247\u8d28\u91cf\u826f\u597d\uff0c\u4ec5\u5f00\u542f\u667a\u80fd\u9510\u5316')
      setBatchToast(msgs.join(''))
      setTimeout(() => setBatchToast(''), 4000)
    })()
  }, [batchMode, batchItems, preview])

  // --- 批量拖拽排序 ---
  const moveBatchItem = useCallback((from, to) => {
    if (from === to) return
    setBatchItems(prev => {
      const arr = [...prev]
      const [moved] = arr.splice(from, 1)
      arr.splice(to, 0, moved)
      return arr
    })
  }, [])

  // --- 目标尺寸计算 ---
  const activeCropRatio = useMemo(() => (
    cropEnabled ? getPresetRatio(cropPreset) : null
  ), [cropEnabled, cropPreset])

  const activeOutputRatio = useMemo(() => {
    if (activeCropRatio) return activeCropRatio
    const sourceDims = getSourceDims(origDims, cropEnabled, cropRect)
    return sourceDims ? sourceDims.w / sourceDims.h : 16 / 9
  }, [activeCropRatio, origDims, cropEnabled, cropRect])

  const targetDims = useMemo(() => {
    if (scaleMode === 'scale') return null
    if (targetMode === 'custom') return { w: parseInt(customW) || 0, h: parseInt(customH) || 0 }
    const preset = QUALITY_PRESETS[targetIdx]
    return fitEdgeToRatio(preset.edge, activeOutputRatio)
  }, [scaleMode, targetMode, targetIdx, customW, customH, activeOutputRatio])

  const previewTargetPreset = useCallback((preset) => (
    fitEdgeToRatio(preset.edge, activeOutputRatio)
  ), [activeOutputRatio])

  const handleCustomWidthChange = useCallback((value) => {
    setCustomW(value)
    const width = parseInt(value)
    if (activeOutputRatio && !Number.isNaN(width) && width > 0) {
      setCustomH(String(Math.max(1, Math.round(width / activeOutputRatio))))
    }
  }, [activeOutputRatio])

  const handleCustomHeightChange = useCallback((value) => {
    setCustomH(value)
    const height = parseInt(value)
    if (activeOutputRatio && !Number.isNaN(height) && height > 0) {
      setCustomW(String(Math.max(1, Math.round(height * activeOutputRatio))))
    }
  }, [activeOutputRatio])

  const expectedOutput = useMemo(() => {
    if (!origDims) return null
    const sourceDims = getSourceDims(origDims, cropEnabled, cropRect)
    let w, h
    if (scaleMode === 'scale') {
      w = Math.round(sourceDims.w * scale)
      h = Math.round(sourceDims.h * scale)
    } else if (targetDims) {
      if (keepRatio && !cropEnabled) {
        const r = Math.min(targetDims.w / sourceDims.w, targetDims.h / sourceDims.h)
        w = Math.round(sourceDims.w * r)
        h = Math.round(sourceDims.h * r)
      } else {
        w = targetDims.w; h = targetDims.h
      }
    } else return null
    if (w > 10000 || h > 10000) {
      const r = Math.min(10000 / w, 10000 / h)
      w = Math.round(w * r); h = Math.round(h * r)
    }
    if (format === 'jpeg') { w += w & 1; h += h & 1 }
    const capped = !!(sourceDims && (Math.round(sourceDims.w * scale) > 10000 || Math.round(sourceDims.h * scale) > 10000))
    const effectiveScale = sourceDims ? Math.max(w / sourceDims.w, h / sourceDims.h) : scale
    return { w, h, capped, effectiveScale }
  }, [origDims, scaleMode, scale, targetDims, keepRatio, format, cropEnabled, cropRect])

  const processEstimate = useMemo(() => {
      if (!origDims || !expectedOutput) return null
      const outputPixels = expectedOutput.w * expectedOutput.h
      const estimateSourceDims = getSourceDims(origDims, cropEnabled, cropRect)
      const inputPixels = estimateSourceDims.w * estimateSourceDims.h
      const inputEdge = Math.max(estimateSourceDims.w, estimateSourceDims.h)
      const warnings = []
      let blockReason = ''
      const maxOutputPixels = isMobileLayout ? MOBILE_MAX_OUTPUT_PIXELS : MAX_OUTPUT_PIXELS
      const warnOutputPixels = isMobileLayout ? 18_000_000 : WARN_OUTPUT_PIXELS
      const maxAiInputPixels = isMobileLayout ? MOBILE_MAX_AI_INPUT_PIXELS : MAX_AI_INPUT_PIXELS

      if (outputPixels > maxOutputPixels) {
        blockReason = isMobileLayout
          ? `图片太大：2 倍输出预计 ${formatMegapixels(outputPixels)}，手机浏览器可能卡顿或退出。建议使用电脑端处理。`
          : `输出预计 ${formatMegapixels(outputPixels)}，浏览器端处理风险太高。请降低倍数或分辨率。`
      } else if (outputPixels > warnOutputPixels) {
        warnings.push(`输出预计 ${formatMegapixels(outputPixels)}，处理会更慢，也会占用更多内存。`)
      }

      const aiInputTooLarge = isMobileLayout
        ? inputPixels > maxAiInputPixels
        : inputEdge > MAX_AI_INPUT_EDGE || inputPixels > maxAiInputPixels

      if (aiUpscale && aiInputTooLarge) {
        blockReason = isMobileLayout
          ? `AI 模式支持约 400 万像素以内的图片。当前图片为 ${formatMegapixels(inputPixels)}，建议关闭 AI 或使用电脑端。`
          : `AI 模式建议输入长边不超过 ${MAX_AI_INPUT_EDGE}px。请降低尺寸或关闭 AI 放大。`
      }

      return { outputPixels, inputPixels, inputEdge, warnings, blockReason }
    }, [origDims, expectedOutput, aiUpscale, cropEnabled, cropRect, isMobileLayout])

  const sourceDimsForPreview = useMemo(() => (
    getSourceDims(origDims, cropEnabled, cropRect)
  ), [origDims, cropEnabled, cropRect])

  const maxScale = sourceDimsForPreview
    ? Math.min(20, Math.floor(Math.min(10000 / sourceDimsForPreview.w, 10000 / sourceDimsForPreview.h) * 2) / 2)
    : 20

  const createCompareSourceImage = (imageUrl, cropOptions = null) => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = async () => {
        try {
          let sourceX = 0
          let sourceY = 0
          let sourceW = img.width
          let sourceH = img.height
          if (cropOptions?.enabled) {
            const rect = cropOptions.rect || getDefaultCropRect(img.width, img.height, cropOptions.presetId)
            sourceX = Math.round(clamp(rect.x, 0, 1) * img.width)
            sourceY = Math.round(clamp(rect.y, 0, 1) * img.height)
            sourceW = Math.round(clamp(rect.w, 0.02, 1) * img.width)
            sourceH = Math.round(clamp(rect.h, 0.02, 1) * img.height)
            if (sourceX + sourceW > img.width) sourceW = img.width - sourceX
            if (sourceY + sourceH > img.height) sourceH = img.height - sourceY
          }
          const canvas = document.createElement('canvas')
          canvas.width = sourceW
          canvas.height = sourceH
          canvas.getContext('2d').drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH)
          const blob = await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, 'image/png'))
          if (!blob) throw new Error('EXPORT_FAILED')
          resolve({ dataUrl: URL.createObjectURL(blob), width: sourceW, height: sourceH })
        } catch (error) {
          reject(error)
        }
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = imageUrl
    })
  }

  // 人脸皮肤在高倍放大时降低锐化混合，避免放大前净化过的细纹再次变成摩尔纹；五官已从掩膜中排除。
  const protectFaceSkinFromSharpening = (sourceData, sharpenedData, faceSkinMask, skinStrength = 0.6) => {
    if (!faceSkinMask) return sharpenedData
    const { width, height } = sourceData
    const output = new Uint8ClampedArray(sharpenedData.data)
    const response = Math.pow(Math.max(0, Math.min(1, skinStrength)), 1.35)
    const maxProtection = response * 0.9
    if (maxProtection <= 0.01) return sharpenedData

    for (let y = 0; y < height; y++) {
      const maskY = Math.min(faceSkinMask.height - 1, Math.floor(y * faceSkinMask.height / height))
      for (let x = 0; x < width; x++) {
        const maskX = Math.min(faceSkinMask.width - 1, Math.floor(x * faceSkinMask.width / width))
        const protection = (faceSkinMask.data[maskY * faceSkinMask.width + maskX] / 255) * maxProtection
        if (protection <= 0.01) continue
        const idx = (y * width + x) * 4
        for (let c = 0; c < 3; c++) {
          output[idx + c] = Math.round(sharpenedData.data[idx + c] * (1 - protection) + sourceData.data[idx + c] * protection)
        }
      }
    }
    return new ImageData(output, width, height)
  }

  // --- Canvas 放大处理（单图和批量共用）---
  const processCanvasInTiles = async (sourceCanvas, processor, stageLabel, onStage = null, overlap = 2) => {
    const deviceMemory = Number(navigator.deviceMemory) || 0
    const lowMemoryDevice = deviceMemory > 0 && deviceMemory <= 4
    const tileSize = isMobileLayout ? (deviceMemory >= 8 ? 512 : 384) : 640
    const yieldEvery = lowMemoryDevice ? 2 : 4
    const output = document.createElement('canvas')
    output.width = sourceCanvas.width
    output.height = sourceCanvas.height
    const sourceCtx = sourceCanvas.getContext('2d')
    const outputCtx = output.getContext('2d')
    const columns = Math.ceil(sourceCanvas.width / tileSize)
    const rows = Math.ceil(sourceCanvas.height / tileSize)
    const total = columns * rows
    let completed = 0

    for (let coreY = 0; coreY < sourceCanvas.height; coreY += tileSize) {
      for (let coreX = 0; coreX < sourceCanvas.width; coreX += tileSize) {
        const coreWidth = Math.min(tileSize, sourceCanvas.width - coreX)
        const coreHeight = Math.min(tileSize, sourceCanvas.height - coreY)
        const inputX = Math.max(0, coreX - overlap)
        const inputY = Math.max(0, coreY - overlap)
        const inputRight = Math.min(sourceCanvas.width, coreX + coreWidth + overlap)
        const inputBottom = Math.min(sourceCanvas.height, coreY + coreHeight + overlap)
        const input = sourceCtx.getImageData(inputX, inputY, inputRight - inputX, inputBottom - inputY)
        const processed = processor(input)
        outputCtx.putImageData(
          processed,
          inputX,
          inputY,
          coreX - inputX,
          coreY - inputY,
          coreWidth,
          coreHeight,
        )
        completed += 1
        onStage?.(`${stageLabel} ${completed}/${total}`)
        if (completed % yieldEvery === 0 || completed === total) {
          await new Promise(resolve => requestAnimationFrame(resolve))
        }
      }
    }
    return output
  }

  const processImageWithCanvas = (imageUrl, targetW, targetH, doEnhance, fmt, cropOptions = null, onStage = null) => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = async () => {
        try {
          let sourceX = 0
          let sourceY = 0
          let sourceW = img.width
          let sourceH = img.height

          if (cropOptions?.enabled) {
            const ratio = cropOptions.ratio
            const rect = cropOptions.rect || getDefaultCropRect(img.width, img.height, cropOptions.presetId)
            if (rect) {
              sourceX = Math.round(clamp(rect.x, 0, 1) * img.width)
              sourceY = Math.round(clamp(rect.y, 0, 1) * img.height)
              sourceW = Math.round(clamp(rect.w, 0.02, 1) * img.width)
              sourceH = Math.round(clamp(rect.h, 0.02, 1) * img.height)
            } else if (ratio) {
              const centerRect = getDefaultCropRect(img.width, img.height, cropOptions.presetId)
              sourceX = Math.round(centerRect.x * img.width)
              sourceY = Math.round(centerRect.y * img.height)
              sourceW = Math.round(centerRect.w * img.width)
              sourceH = Math.round(centerRect.h * img.height)
            }
            if (sourceX + sourceW > img.width) sourceW = img.width - sourceX
            if (sourceY + sourceH > img.height) sourceH = img.height - sourceY
          }

          const avgScale = Math.max(targetW / sourceW, targetH / sourceH)
          const passes = avgScale >= 8 ? 3 : avgScale >= 4 ? 2 : avgScale >= 2.5 ? 2 : 1

          let srcCanvas = document.createElement('canvas')
          srcCanvas.width = sourceW
          srcCanvas.height = sourceH
          let srcCtx = srcCanvas.getContext('2d')
          srcCtx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH)

          // Apply pre-process enhancements to original image
          if (doEnhance.autoLevels || doEnhance.vibrance) {
            const origData = srcCtx.getImageData(0, 0, sourceW, sourceH)
            let processed = origData
            if (doEnhance.autoLevels) processed = autoLevelsFilter(processed)
            if (doEnhance.vibrance) processed = vibranceFilter(processed)
            // Create a temporary canvas to put processed data
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = sourceW
            tempCanvas.height = sourceH
            tempCanvas.getContext('2d').putImageData(processed, 0, 0)
            srcCtx.drawImage(tempCanvas, 0, 0)
          }

          // 在放大前先减少源图中的压缩色块和周期纹理，避免后续重采样放大这些伪影。
          let faceSkinMask = null
          if (doEnhance.reduceArtifacts || doEnhance.reduceMoire) {
            let sourceData = srcCtx.getImageData(0, 0, sourceW, sourceH)
            if (doEnhance.faceAwareProtection) {
              onStage?.('检测人脸与皮肤区域')
              try {
                const { createFaceSkinMask } = await import('./ai/faceLandmarker')
                faceSkinMask = await createFaceSkinMask(srcCanvas, doEnhance.faceSkinStrength)
              } catch (faceError) {
                console.warn('Face Landmarker unavailable, using the standard artifact filter.', faceError)
              }
            }
            if (doEnhance.reduceArtifacts) {
              const { faceAwareArtifactFilter } = await import('./ai/faceAwareArtifacts')
              sourceData = faceAwareArtifactFilter(
                sourceData,
                doEnhance.faceAwareProtection ? faceSkinMask : null,
                doEnhance.faceSkinStrength,
              )
            }
            if (doEnhance.reduceMoire) {
              // AI 和高倍放大会把非常轻微的周期纹理再次放大，因此在放大前进行两次边缘感知的轻量处理。
              const moirePasses = doEnhance.aiUpscale || avgScale >= 4 ? 2 : 1
              const moireStrength = doEnhance.aiUpscale || avgScale >= 4 ? 0.9 : 0.72
              for (let pass = 0; pass < moirePasses; pass++) {
                sourceData = moireReductionFilter(
                  sourceData,
                  moireStrength,
                  doEnhance.faceAwareProtection ? faceSkinMask : null,
                  doEnhance.faceSkinStrength,
                )
              }
            }
            srcCtx.putImageData(sourceData, 0, 0)
          }

          onStage?.('放大图片')

          // Pre-sharpen original image before upscaling
          if (doEnhance.smartSharpen && passes > 0) {
            if (isMobileLayout) {
              srcCanvas = await processCanvasInTiles(
                srcCanvas,
                imageData => unsharpMask(imageData, sharpenAmount * 0.8),
                '放大前分块锐化',
                onStage,
              )
              srcCtx = srcCanvas.getContext('2d')
            } else {
              const preData = srcCtx.getImageData(0, 0, sourceW, sourceH)
              const preSharp = unsharpMask(preData, sharpenAmount * 0.8)
              const protectedPreSharp = protectFaceSkinFromSharpening(preData, preSharp, faceSkinMask, doEnhance.faceSkinStrength)
              const tempPre = document.createElement('canvas')
              tempPre.width = sourceW
              tempPre.height = sourceH
              tempPre.getContext('2d').putImageData(protectedPreSharp, 0, 0)
              srcCtx.drawImage(tempPre, 0, 0)
            }
          }

          if (doEnhance.aiUpscale) {
            // AI放大：使用 waifu2x 模型
            const aiPasses = avgScale >= 4 ? 2 : 1
            let aiCanvas = srcCanvas
            for (let i = 0; i < aiPasses; i++) {
              const aiData = aiCanvas.getContext('2d').getImageData(0, 0, aiCanvas.width, aiCanvas.height)
              const aiResult = await processWithAI(aiData, 2, {
                detailMode: 'preserve',
                onProgress: ({ completed, total }) => onStage?.(`AI 分块处理 ${completed}/${total}`),
              })
              aiCanvas = document.createElement('canvas')
              aiCanvas.width = aiResult.width
              aiCanvas.height = aiResult.height
              aiCanvas.getContext('2d').putImageData(aiResult, 0, 0)
            }
            const dstCanvas = aiCanvas.width === targetW && aiCanvas.height === targetH
              ? aiCanvas
              : document.createElement('canvas')
            if (dstCanvas !== aiCanvas) {
              dstCanvas.width = targetW
              dstCanvas.height = targetH
            }
            const dstCtx = dstCanvas.getContext('2d')
            if (dstCanvas !== aiCanvas) {
              dstCtx.imageSmoothingEnabled = true
              dstCtx.imageSmoothingQuality = 'high'
              dstCtx.drawImage(aiCanvas, 0, 0, targetW, targetH)
            }

            if (doEnhance.smartSharpen && (isMobileLayout || targetW * targetH > 12_000_000)) {
              srcCanvas = await processCanvasInTiles(
                dstCanvas,
                imageData => unsharpMask(imageData, sharpenAmount),
                '分块锐化',
                onStage,
              )
            } else {
              if (doEnhance.smartSharpen) {
                const imageData = dstCtx.getImageData(0, 0, targetW, targetH)
                const enhanced = unsharpMask(imageData, sharpenAmount)
                dstCtx.putImageData(enhanced, 0, 0)
              }
              srcCanvas = dstCanvas
            }
          } else {
            for (let i = 0; i < passes; i++) {
            const progress = (i + 1) / passes
            const stepW = Math.round(sourceW * Math.pow(targetW / sourceW, progress))
            const stepH = Math.round(sourceH * Math.pow(targetH / sourceH, progress))

            let dstCanvas = document.createElement('canvas')
            dstCanvas.width = stepW
            dstCanvas.height = stepH
            const dstCtx = dstCanvas.getContext('2d')
            dstCtx.imageSmoothingEnabled = true
            dstCtx.imageSmoothingQuality = 'high'

            dstCtx.drawImage(srcCanvas, 0, 0, stepW, stepH)

            if (doEnhance.smartSharpen && (isMobileLayout || stepW * stepH > 12_000_000)) {
              dstCanvas = await processCanvasInTiles(
                dstCanvas,
                imageData => unsharpMask(imageData, sharpenAmount),
                '分块锐化',
                onStage,
              )
            } else if (doEnhance.smartSharpen || i > 0) {
              const imageData = dstCtx.getImageData(0, 0, stepW, stepH)
              let enhanced = imageData
              if (doEnhance.smartSharpen) {
                const sharpened = unsharpMask(enhanced, sharpenAmount)
                enhanced = protectFaceSkinFromSharpening(imageData, sharpened, faceSkinMask, doEnhance.faceSkinStrength)
              }
              dstCtx.putImageData(enhanced, 0, 0)
            }
            srcCanvas = dstCanvas
          }
          }

          // Apply anti-aliasing as final step
          if (doEnhance.antiAlias && (isMobileLayout || srcCanvas.width * srcCanvas.height > 12_000_000)) {
            srcCanvas = await processCanvasInTiles(srcCanvas, antiAliasingFilter, '分块抗锯齿', onStage)
          } else if (doEnhance.antiAlias) {
            const finalCtx = srcCanvas.getContext('2d')
            const finalData = finalCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height)
            const aaResult = antiAliasingFilter(finalData)
            finalCtx.putImageData(aaResult, 0, 0)
          }

          const mimeType = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png'
          const quality = fmt === 'png' ? undefined : 0.92
            const blob = await new Promise((resolve) => srcCanvas.toBlob(resolve, mimeType, quality))
            if (!blob) throw new Error('EXPORT_FAILED')
            const dataUrl = URL.createObjectURL(blob)
            const sizeBytes = blob.size

            resolve({ dataUrl, blob, width: srcCanvas.width, height: srcCanvas.height, size: sizeBytes })
        } catch (e) { reject(e) }
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = imageUrl
    })
  }

  // --- Unsharp Mask（反锐化掩模，比简单卷积锐化效果好得多）---
  const unsharpMask = (imageData, amount = 0.8) => {
    const { data, width, height } = imageData
    const luma = new Float32Array(width * height)
    const blurred = new Float32Array(width * height)
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      luma[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      blurred[p] = luma[p]
    }

    // Gaussian blur on luminance only, so sharpening cannot shift hue/saturation.
    for (let y = 1; y < height - 1; y++) {
      const previousRow = (y - 1) * width
      const currentRow = y * width
      const nextRow = (y + 1) * width
      for (let x = 1; x < width - 1; x++) {
        let sum = 0
        sum += luma[previousRow + x - 1] * 2
        sum += luma[previousRow + x] * 4
        sum += luma[previousRow + x + 1] * 2
        sum += luma[currentRow + x - 1] * 4
        sum += luma[currentRow + x] * 8
        sum += luma[currentRow + x + 1] * 4
        sum += luma[nextRow + x - 1] * 2
        sum += luma[nextRow + x] * 4
        sum += luma[nextRow + x + 1] * 2
        blurred[currentRow + x] = sum / 32
      }
    }

    const output = new Uint8ClampedArray(data)
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const originalY = Math.max(1, luma[p])
      const targetY = originalY + amount * (originalY - blurred[p])
      const ratio = Math.max(0.75, Math.min(1.35, targetY / originalY))
      output[i] = Math.max(0, Math.min(255, Math.round(data[i] * ratio)))
      output[i + 1] = Math.max(0, Math.min(255, Math.round(data[i + 1] * ratio)))
      output[i + 2] = Math.max(0, Math.min(255, Math.round(data[i + 2] * ratio)))
      output[i + 3] = data[i + 3]
    }
    return new ImageData(output, width, height)
  }

  // --- 自动色阶 / 对比度拉伸 ---
  const autoLevelsFilter = (imageData, percent = 0.5) => {
    const { data, width, height } = imageData
    const output = new Uint8ClampedArray(data)
    let minVal = 255, maxVal = 0
    const hist = new Array(256).fill(0)
    const total = width * height

    // Build histogram
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        hist[data[i + c]]++
      }
    }

    // Find min/max excluding extreme percent
    let count = 0
    const clipPixels = total * 3 * percent / 100
    for (let i = 0; i < 256; i++) {
      count += hist[i]
      if (count > clipPixels) { minVal = i; break }
    }
    count = 0
    for (let i = 255; i >= 0; i--) {
      count += hist[i]
      if (count > clipPixels) { maxVal = i; break }
    }

    if (maxVal <= minVal) return imageData

    // Stretch
    const range = maxVal - minVal
    for (let i = 0; i < data.length; i++) {
      if (i % 4 === 3) { output[i] = data[i]; continue }
      output[i] = Math.max(0, Math.min(255, Math.round((data[i] - minVal) / range * 255)))
    }
    return new ImageData(output, width, height)
  }

  // --- 自然饱和度（Vibrance）---
  const vibranceFilter = (imageData, amount = 0.4) => {
    const { data, width, height } = imageData
    const output = new Uint8ClampedArray(data)

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const avg = (r + g + b) / 3
      const saturation = max === 0 ? 0 : (max - min) / max

      // Boost more for less saturated pixels
      const boost = (1 - saturation) * amount
      for (let c = 0; c < 3; c++) {
        const diff = data[i + c] - avg
        output[i + c] = Math.max(0, Math.min(255, Math.round(data[i + c] + diff * boost)))
      }
      output[i + 3] = 255
    }
    return new ImageData(output, width, height)
  }

  // --- 抗锯齿过滤（针对楼梯状锯齿边缘做定向平滑）---
  const antiAliasingFilter = (imageData, strength = 0.6) => {
    const { data, width, height } = imageData
    const output = new Uint8ClampedArray(data)

    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const idx = (y * width + x) * 4
        for (let c = 0; c < 3; c++) {
          const gx = Math.abs(data[((y) * width + (x + 1)) * 4 + c] - data[((y) * width + (x - 1)) * 4 + c])
          const gy = Math.abs(data[((y + 1) * width + (x)) * 4 + c] - data[((y - 1) * width + (x)) * 4 + c])
          const grad = Math.max(gx, gy)

          if (grad > 25) {
            // Edge pixel - smooth along edge direction
            const v = data[idx + c]
            if (gx > gy * 1.8) {
              // Strong horizontal edge - smooth vertically
              const t = data[((y - 1) * width + x) * 4 + c]
              const b = data[((y + 1) * width + x) * 4 + c]
              output[idx + c] = Math.round(v + (t + b - 2 * v) * 0.25 * strength)
            } else if (gy > gx * 1.8) {
              // Strong vertical edge - smooth horizontally
              const l = data[(y * width + x - 1) * 4 + c]
              const r = data[(y * width + x + 1) * 4 + c]
              output[idx + c] = Math.round(v + (l + r - 2 * v) * 0.25 * strength)
            } else {
              // Diagonal edge - check for stair-step pattern
              const d1 = data[((y + 1) * width + x - 1) * 4 + c]
              const d2 = data[((y - 1) * width + x + 1) * 4 + c]
              const d3 = data[((y + 1) * width + x + 1) * 4 + c]
              const d4 = data[((y - 1) * width + x - 1) * 4 + c]
              const diag1 = Math.abs(v - d1) + Math.abs(v - d2)
              const diag2 = Math.abs(v - d3) + Math.abs(v - d4)
              if (diag1 < diag2) {
                output[idx + c] = Math.round(v + (d1 + d2 - 2 * v) * 0.2 * strength)
              } else {
                output[idx + c] = Math.round(v + (d3 + d4 - 2 * v) * 0.2 * strength)
              }
            }
          }
        }
        output[idx + 3] = data[idx + 3]
      }
    }
    return new ImageData(output, width, height)
  }

  // --- 抗摩尔纹（多尺度抑制平缓区域的细密周期纹理，保留强边缘）---
  const moireReductionFilter = (imageData, strength = 0.65, faceSkinMask = null, skinStrength = 0.6) => {
    const { data, width, height } = imageData
    const output = new Uint8ClampedArray(data)
    const blurSamples = [
      [0, 0, 4],
      [-1, 0, 2], [1, 0, 2], [0, -1, 2], [0, 1, 2],
      [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
      [-2, 0, 1], [2, 0, 1], [0, -2, 1], [0, 2, 1],
    ]
    const blurWeight = 20
    const clamp01 = value => Math.max(0, Math.min(1, value))
    const lumaAt = (x, y) => {
      const idx = (y * width + x) * 4
      return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
    }

    // 5 像素多尺度核比原先的 4 邻域均值更能捕捉 AI 会放大的细密周期纹理。
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const idx = (y * width + x) * 4
        const centerY = lumaAt(x, y)
        const leftY = lumaAt(x - 1, y)
        const rightY = lumaAt(x + 1, y)
        const topY = lumaAt(x, y - 1)
        const bottomY = lumaAt(x, y + 1)
        const farLeftY = lumaAt(x - 2, y)
        const farRightY = lumaAt(x + 2, y)
        const farTopY = lumaAt(x, y - 2)
        const farBottomY = lumaAt(x, y + 2)
        const localMin = Math.min(centerY, leftY, rightY, topY, bottomY, farLeftY, farRightY, farTopY, farBottomY)
        const localMax = Math.max(centerY, leftY, rightY, topY, bottomY, farLeftY, farRightY, farTopY, farBottomY)
        const localRange = localMax - localMin
        const edgeGradient = Math.abs(leftY - rightY) + Math.abs(topY - bottomY) +
          0.5 * (Math.abs(farLeftY - farRightY) + Math.abs(farTopY - farBottomY))
        const edgeProtection = 1 - clamp01((edgeGradient - 10) / 42)
        const flatAreaProtection = 1 - clamp01((localRange - 24) / 56)

        let meanR = 0
        let meanG = 0
        let meanB = 0
        for (const [offsetX, offsetY, weight] of blurSamples) {
          const sampleIdx = ((y + offsetY) * width + x + offsetX) * 4
          meanR += data[sampleIdx] * weight
          meanG += data[sampleIdx + 1] * weight
          meanB += data[sampleIdx + 2] * weight
        }
        meanR /= blurWeight
        meanG /= blurWeight
        meanB /= blurWeight
        const meanY = 0.299 * meanR + 0.587 * meanG + 0.114 * meanB
        const highFrequency = Math.abs(centerY - meanY)
        const textureWeight = clamp01((highFrequency - 0.7) / 7.5)
        const areaWeight = edgeProtection * flatAreaProtection
        if (areaWeight < 0.04 || highFrequency < 0.35) continue

        let skinWeight = 0
        if (faceSkinMask) {
          const maskX = Math.min(faceSkinMask.width - 1, Math.floor(x * faceSkinMask.width / width))
          const maskY = Math.min(faceSkinMask.height - 1, Math.floor(y * faceSkinMask.height / height))
          skinWeight = faceSkinMask.data[maskY * faceSkinMask.width + maskX] / 255
        }
        const normalizedSkinStrength = Math.max(0, Math.min(1, skinStrength))
        const skinResponse = Math.pow(normalizedSkinStrength, 1.35)
        const skinMultiplier = 1 + skinWeight * (-0.75 + skinResponse * 1.9)
        const localStrength = Math.max(0.08, Math.min(1.25, strength * skinMultiplier))
        const lumaBlend = localStrength * areaWeight * (0.2 + textureWeight * 0.5)
        const colorBlend = localStrength * areaWeight * (0.34 + textureWeight * 0.5)
        const nextY = centerY + (meanY - centerY) * lumaBlend
        const centerCb = data[idx + 2] - centerY
        const centerCr = data[idx] - centerY
        const nextCb = centerCb + ((meanB - meanY) - centerCb) * colorBlend
        const nextCr = centerCr + ((meanR - meanY) - centerCr) * colorBlend
        const nextR = nextY + nextCr
        const nextB = nextY + nextCb
        const nextG = (nextY - 0.299 * nextR - 0.114 * nextB) / 0.587
        output[idx] = Math.max(0, Math.min(255, Math.round(nextR)))
        output[idx + 1] = Math.max(0, Math.min(255, Math.round(nextG)))
        output[idx + 2] = Math.max(0, Math.min(255, Math.round(nextB)))
      }
    }
    return new ImageData(output, width, height)
  }

  // --- 计算目标宽高 ---
  const calcTargetDimensions = (origW, origH, upMode, sc, tDims, keRatio, fm) => {
    let targetW, targetH
    if (upMode === 'scale') {
      targetW = Math.round(origW * sc)
      targetH = Math.round(origH * sc)
      const maxDim = 10000
      if (targetW > maxDim || targetH > maxDim) {
        const r = Math.min(maxDim / targetW, maxDim / targetH)
        targetW = Math.round(targetW * r)
        targetH = Math.round(targetH * r)
      }
    } else if (tDims) {
      if (keRatio) {
        const r = Math.min(tDims.w / origW, tDims.h / origH)
        targetW = Math.round(origW * r)
        targetH = Math.round(origH * r)
      } else {
        targetW = tDims.w
        targetH = tDims.h
      }
    }
    if (fm === 'jpeg') { targetW += targetW & 1; targetH += targetH & 1 }
    return { targetW, targetH }
  }

  const getCropOptions = useCallback((forBatch = false, dims = origDims) => {
    if (!cropEnabled || !dims) return null
    const ratio = getPresetRatio(cropPreset)
    const rect = forBatch ? getDefaultCropRect(dims.w, dims.h, cropPreset) : cropRect
    return { enabled: true, presetId: cropPreset, ratio, rect }
  }, [cropEnabled, cropPreset, cropRect, origDims])

  const getSourceDimsForOutput = useCallback((dims, rect = cropRect) => {
    if (!cropEnabled || !dims) return dims
    return {
      w: Math.max(1, Math.round(dims.w * rect.w)),
      h: Math.max(1, Math.round(dims.h * rect.h)),
    }
  }, [cropEnabled, cropRect])

  // --- 单图处理 ---
    const handleProcess = useCallback(async () => {
      if (!preview || !origDims) return
      if (processEstimate?.blockReason) {
        setError(processEstimate.blockReason)
        return
      }
      setProcessing(true)
      const processingStartedAt = performance.now()
      trackEvent('process_start', {
        mode: 'single',
        ai: aiUpscale,
        aiDetailMode,
        format,
        scale: scaleMode === 'scale' ? String(scale) : 'custom',
        inputWidth: origDims.w,
        inputHeight: origDims.h,
        outputWidth: expectedOutput?.w,
        outputHeight: expectedOutput?.h,
      })
      setProgress(0)
      setProcessStage('准备处理')
      setError(null)
      setResult(null)

    let p = 0
    const tick = () => {
      if (p < 30) p += 5
      else if (p < 70) p += 3
      else if (p < 90) p += 1
      setProgress(Math.min(p, 91))
    }
    const timer = setInterval(tick, 200)

    try {
        const cropOptions = getCropOptions(false, origDims)
        const sourceDims = getSourceDimsForOutput(origDims)
        const { targetW, targetH } = calcTargetDimensions(sourceDims.w, sourceDims.h, scaleMode, scale, targetDims, cropEnabled ? false : keepRatio, format)
        setProcessStage(aiUpscale ? '加载 AI 模型' : '解析图片')
        await ensureAiModel()
        setProgress(20)
        setProcessStage('放大图片')
        const compareRes = await createCompareSourceImage(preview, cropOptions)
        setCompareSource(prev => {
          revokeObjectUrl(prev)
          return compareRes.dataUrl
        })
        setCompareSourceDims({ w: compareRes.width, h: compareRes.height })
        const res = await processImageWithCanvas(preview, targetW, targetH, {
          smartSharpen,
          aiUpscale,
          aiDetailMode: 'preserve',
          reduceArtifacts: false,
          reduceMoire: false,
          faceAwareProtection: false,
          faceSkinStrength: 0,
          deblur: false,
          autoLevels: false,
          vibrance: false,
          clahe: false,
          smartDenoise: false,
          edgeInterpolation: false,
          antiAlias,
        }, format, cropOptions, setProcessStage)
        setProgress(95)
        setProcessStage('导出结果')
        await new Promise(r => setTimeout(r, 100))
        setResult(res.dataUrl)
        setResultBlob(res.blob)
      setResultDims({ w: res.width, h: res.height })
      const sizeKB = res.size < 1024 * 1024
        ? (res.size / 1024).toFixed(1) + ' KB'
        : (res.size / (1024 * 1024)).toFixed(1) + ' MB'
        setResultSize(sizeKB)
        singleExportIdRef.current = createExportId()
        setProgress(100)
        setProcessStage('完成')
        trackEvent('process_success', {
          mode: 'single',
          ai: aiUpscale,
          aiDetailMode,
          format,
          outputWidth: res.width,
          outputHeight: res.height,
          inputWidth: origDims.w,
          inputHeight: origDims.h,
          scale: scaleMode === 'scale' ? String(scale) : 'custom',
          durationMs: Math.round(performance.now() - processingStartedAt),
        })
      } catch (err) {
        setError(getProcessErrorMessage(err))
        setProgress(0)
        setProcessStage('')
        trackEvent('process_error', { mode: 'single', ai: aiUpscale, inputWidth: origDims.w, inputHeight: origDims.h, errorCode: 'unknown', durationMs: Math.round(performance.now() - processingStartedAt) })
    } finally {
      clearInterval(timer)
      setProcessing(false)
    }
    }, [preview, origDims, processEstimate, scaleMode, scale, targetDims, keepRatio, format, cropEnabled, smartSharpen, sharpenAmount, aiUpscale, aiDetailMode, reduceArtifacts, reduceMoire, faceAwareProtection, faceSkinStrength, deblur, autoLevels, vibrance, clahe, smartDenoise, edgeInterpolation, antiAlias, isMobileLayout, ensureAiModel, getProcessErrorMessage, getCropOptions, getSourceDimsForOutput])

  // --- 批量处理 ---
  const handleBatchProcess = useCallback(async () => {
    const pending = batchItems.filter(it => it.status === 'pending' && it.preview && it.origDims)
    if (pending.length === 0) return

    setBatchProcessing(true)
    trackEvent('batch_start', { count: pending.length, batchSize: pending.length, ai: aiUpscale, aiDetailMode, format, scale: scaleMode === 'scale' ? String(scale) : 'custom' })
      setBatchItems(prev => prev.map(it => it.status === 'pending' && it.preview && it.origDims
        ? { ...it, status: 'pending', progress: 0, result: null, resultBlob: null, resultDims: null, resultSize: null, error: null, stage: '' }
        : it
      ))

    batchCancelRef.current = false
    for (const item of pending) {
      if (batchCancelRef.current) break
        setBatchItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'processing', progress: 0, stage: '准备处理' } : it))

      let p = 0
      const processingStartedAt = performance.now()
      const tick = () => {
        if (p < 30) p += 5
        else if (p < 70) p += 3
        else if (p < 90) p += 1
        p = Math.min(p, 91)
        setBatchItems(prev => prev.map(it => it.id === item.id ? { ...it, progress: p } : it))
      }
      const timer = setInterval(tick, 200)

      try {
          const cropOptions = getCropOptions(true, item.origDims)
          const cropRectForItem = cropOptions?.rect || null
          const sourceDims = getSourceDimsForOutput(item.origDims, cropRectForItem || cropRect)
          const { targetW, targetH } = calcTargetDimensions(
            sourceDims.w, sourceDims.h, scaleMode, scale, targetDims, cropEnabled ? false : keepRatio, format
          )
          const outputPixels = targetW * targetH
          const inputPixels = item.origDims.w * item.origDims.h
          const inputEdge = Math.max(item.origDims.w, item.origDims.h)
          if (outputPixels > MAX_OUTPUT_PIXELS) {
            throw new Error(`输出预计 ${formatMegapixels(outputPixels)}，请降低倍数或分辨率。`)
          }
          if (aiUpscale && (inputEdge > MAX_AI_INPUT_EDGE || inputPixels > MAX_AI_INPUT_PIXELS)) {
            throw new Error(`AI 模式建议输入长边不超过 ${MAX_AI_INPUT_EDGE}px。`)
          }
          setBatchItems(prev => prev.map(it => it.id === item.id ? { ...it, stage: aiUpscale ? '加载 AI 模型' : '解析图片' } : it))
          await ensureAiModel()
          setBatchItems(prev => prev.map(it => it.id === item.id ? { ...it, stage: '放大图片' } : it))
          const updateItemStage = (stage) => setBatchItems(prev => prev.map(it => it.id === item.id ? { ...it, stage } : it))
          const res = await processImageWithCanvas(item.preview, targetW, targetH, {
            smartSharpen,
            aiUpscale,
            aiDetailMode: 'preserve',
            reduceArtifacts: false,
            reduceMoire: false,
            faceAwareProtection: false,
            faceSkinStrength: 0,
            deblur: false,
            autoLevels: false,
            vibrance: false,
            clahe: false,
            smartDenoise: false,
            edgeInterpolation: false,
            antiAlias,
          }, format, cropOptions, updateItemStage)
        clearInterval(timer)

        const sizeKB = res.size < 1024 * 1024
          ? (res.size / 1024).toFixed(1) + ' KB'
          : (res.size / (1024 * 1024)).toFixed(1) + ' MB'

        setBatchItems(prev => prev.map(it => it.id === item.id ? {
          ...it,
            status: 'done',
            progress: 100,
            result: res.dataUrl,
            resultBlob: res.blob,
            resultDims: { w: res.width, h: res.height },
            resultSize: sizeKB,
            exportId: createExportId(),
            stage: '完成'
          } : it))
          trackEvent('batch_item_success', {
            ai: aiUpscale,
            aiDetailMode,
            format,
            outputWidth: res.width,
            outputHeight: res.height,
            inputWidth: item.origDims.w,
            inputHeight: item.origDims.h,
            batchSize: pending.length,
            scale: scaleMode === 'scale' ? String(scale) : 'custom',
            durationMs: Math.round(performance.now() - processingStartedAt),
          })
        } catch (err) {
          clearInterval(timer)
          setBatchItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'error', progress: 0, error: getProcessErrorMessage(err), stage: '' } : it))
          trackEvent('batch_item_error', { ai: aiUpscale, inputWidth: item.origDims.w, inputHeight: item.origDims.h, batchSize: pending.length, errorCode: 'unknown', durationMs: Math.round(performance.now() - processingStartedAt) })
        }
    }

    batchCancelRef.current = false
    setBatchProcessing(false)
  }, [batchItems, scaleMode, scale, targetDims, keepRatio, format, cropEnabled, cropRect, smartSharpen, aiUpscale, aiDetailMode, reduceArtifacts, reduceMoire, faceAwareProtection, faceSkinStrength, deblur, autoLevels, vibrance, clahe, smartDenoise, edgeInterpolation, antiAlias, ensureAiModel, getProcessErrorMessage, getCropOptions, getSourceDimsForOutput])

  // --- 单图下载 ---
  const handleDownload = () => {
    if (!result) return
    const a = document.createElement('a')
    const ext = format === "jpeg" ? "jpg" : format === "webp" ? "webp" : "png"
    const name = file ? file.name.replace(/\.[^.]+$/, '') : 'image'
    a.download = `${name}_${resultDims ? resultDims.w + 'x' + resultDims.h : 'result'}.${ext}`
    a.href = result
    a.click()
    const exportId = singleExportIdRef.current || createExportId()
    singleExportIdRef.current = exportId
    trackEvent('download_success', { mode: 'single', format })
    trackEvent('exported_image', { mode: 'single', format, count: 1, eventId: `e_${exportId}-image` })
  }

  const handleSaveToPhotos = async () => {
    if (!result || !resultBlob) return handleDownload()
    const ext = format === 'jpeg' ? 'jpg' : format === 'webp' ? 'webp' : 'png'
    const name = file ? file.name.replace(/\.[^.]+$/, '') : 'image'
    const fileName = `${name}_${resultDims ? `${resultDims.w}x${resultDims.h}` : 'result'}.${ext}`
    const imageFile = new File([resultBlob], fileName, { type: resultBlob.type || `image/${format}` })

    try {
      const shareData = { files: [imageFile], title: '保存 TU Scale 图片' }
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData)
        trackEvent('download_success', { mode: 'mobile_share', format })
        return
      }
    } catch (shareError) {
      if (shareError?.name === 'AbortError') return
    }
    handleDownload()
  }

  // --- 渲染文件名模板 ---
  const renderFileName = (item, index) => {
    const ext = format === "jpeg" ? "jpg" : format === "webp" ? "webp" : "png"
    const name = item.file.name.replace(/\.[^.]+$/, '')
    const scaleStr = item.origDims ? (item.resultDims.w / item.origDims.w).toFixed(1).replace(/\.0$/, '') : '1'
    return fileNameTemplate
      .replace(/\{name\}/g, name)
      .replace(/\{w\}/g, item.resultDims.w)
      .replace(/\{h\}/g, item.resultDims.h)
      .replace(/\{ext\}/g, ext)
      .replace(/\{scale\}/g, scaleStr)
      .replace(/\{index\}/g, index + 1)
  }

  // --- 单图下载（批量用）---
  const downloadSingleResult = (item, index) => {
    if (!item.result) return
    const a = document.createElement('a')
    const ext = format === "jpeg" ? "jpg" : format === "webp" ? "webp" : "png"
    a.download = renderFileName(item, index || 0) + '.' + ext
    a.href = item.result
    a.click()
    const exportId = item.exportId || `batch-${item.id}`
    trackEvent('download_success', { mode: 'batch_single', format })
    trackEvent('exported_image', { mode: 'batch_single', format, count: 1, eventId: `e_${exportId}-image` })
  }

  // --- 批量下载全部为 ZIP ---
  const downloadAllAsZip = useCallback(async () => {
    if (zipDownloadLockRef.current) return
    zipDownloadLockRef.current = true
    setZipDownloading(true)
    try {
    const doneItems = batchItems.filter(it => it.status === 'done' && it.result)
    if (doneItems.length === 0) { alert('没有可下载的图片'); return }

    const zip = new JSZip()
    const ext = format === "jpeg" ? "jpg" : format === "webp" ? "webp" : "png"

        for (let i = 0; i < doneItems.length; i++) {
          const item = doneItems[i]
          const fileName = renderFileName(item, i) + '.' + ext
          if (item.resultBlob) {
            zip.file(fileName, item.resultBlob)
          } else if (item.result.startsWith('data:')) {
            const base64 = item.result.split(',')[1]
            zip.file(fileName, base64, { base64: true })
          } else {
            const response = await fetch(item.result)
            zip.file(fileName, await response.blob())
          }
      }

    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(zipBlob)
    a.download = `tuscale_batch_${doneItems.length}images.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
    const signature = doneItems.map(item => item.exportId || item.id).join('|')
    if (batchExportRef.current.signature !== signature) {
      batchExportRef.current = { signature, id: createExportId() }
    }
    trackEvent('download_success', { mode: 'batch_zip', format })
    trackEvent('exported_image', {
      mode: 'batch_zip',
      format,
      count: doneItems.length,
      eventId: `e_${batchExportRef.current.id}-images`,
    })
    } catch(e) { alert('下载失败: ' + e.message) }
    finally {
      zipDownloadLockRef.current = false
      setZipDownloading(false)
    }
  }, [batchItems, format])

  // --- 计算活跃状态 ---
 const pendingCount = batchItems.filter(it => it.status === 'pending' && it.preview && it.origDims).length
 const doneCount = batchItems.filter(it => it.status === 'done').length
  pendingCountRef.current = pendingCount
  doneCountRef.current = doneCount
  keyRefs.current = { batchMode, preview, processing, result, batchProcessing, handleBatchProcess, handleProcess, downloadAllAsZip, handleDownload }
  const compareDisplaySource = compareSource || preview
  const compareDisplayDims = compareSourceDims || sourceDimsForPreview || origDims
  const compareSourceLabel = cropEnabled ? '裁切后原图' : '原图'

  const handleCopyPageLink = useCallback(async () => {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setShareNotice('页面链接已复制')
    } catch {
      setShareNotice('复制失败，可以手动复制浏览器地址栏链接')
    }
    setTimeout(() => setShareNotice(''), 2200)
  }, [])

 return (
    <div className="min-h-screen bg-gray-50/80">
      <header className="bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 sm:px-6 py-2 sm:py-3 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <img src="/logo.png" alt="TU Scale" className="h-12 sm:h-16 w-auto shrink-0" />
          <div className="flex flex-col min-w-0 mr-auto justify-center">
            <h1 className="text-base sm:text-xl font-bold tracking-tight truncate leading-tight" style={{ color: '#8040f0' }}>TU Scale AI 图片放大</h1>
            <p className="mt-1.5 text-[11px] sm:text-sm font-semibold text-gray-400 leading-none">完全本地处理，图片绝不上传</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 pb-24 space-y-4 sm:space-y-6">

        <div className="flex sm:hidden flex-wrap gap-2">
          {['免费使用', '本地处理', '图片不上传', '单张处理'].map(item => (
            <span key={item} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-500 shadow-sm">{item}</span>
          ))}
        </div>

        <section className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <p className="text-sm font-semibold text-indigo-800">{isMobileLayout ? '手机版默认 2 倍放大，上传一张图片即可开始' : '新用户推荐从 2 倍开始，上传后保持默认设置即可处理'}</p>
          <p className="mt-1 text-xs leading-5 text-indigo-600">适合头像、照片、插画和网页配图；图片只在当前设备处理，不会上传服务器。</p>
        </section>

        {!isMobileLayout && (
          <section className="bg-white border border-gray-200 rounded-xl p-3">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setToolMode(false)}
                className={`py-2.5 rounded-lg text-sm font-semibold border transition-colors ${!batchMode ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                单图处理
              </button>
              <button onClick={() => setToolMode(true)}
                className={`py-2.5 rounded-lg text-sm font-semibold border transition-colors ${batchMode ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                批量处理
              </button>
            </div>
          </section>
        )}

        {/* ==================== 上传区 ==================== */}
        <section
          role={!batchMode && !preview ? 'button' : undefined}
          tabIndex={!batchMode && !preview ? 0 : undefined}
          aria-label={!batchMode && !preview ? '上传一张图片进行放大' : undefined}
          className={`bg-white rounded-xl border border-dashed p-10 text-center transition-all shadow-sm ${
            batchMode ? 'border-indigo-200 hover:border-indigo-300 hover:bg-indigo-50/30' : 'border-indigo-100 hover:border-indigo-300 hover:bg-indigo-50/20 cursor-pointer'
          } ${
            dragOver ? 'border-indigo-400 bg-indigo-50/60 ring-4 ring-indigo-100' : ''
          }`}
          onClick={() => { if (!batchMode) fileRef.current?.click(); }}
          onKeyDown={(event) => {
            if (!batchMode && !preview && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              fileRef.current?.click()
            }
          }}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
        >
          <input ref={fileRef} type="file" accept="image/*,.avif,.heic,.heif" multiple={batchMode && !isMobileLayout} className="hidden"
            onChange={handleFileInputChange} />
          <input ref={folderRef} type="file" className="hidden"
            onChange={handleFolderUpload} />

          {batchMode ? (
            // --- 批量上传区 ---
            batchItems.length === 0 ? (
              <div className="text-gray-400 py-4">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-50 to-indigo-50 flex items-center justify-center border border-purple-100/50">
                  <FolderOpen className="w-8 h-8 text-indigo-400" />
                </div>
                <p className="text-sm font-medium text-gray-600">点击按钮或拖拽上传图片</p>
                <p className="text-xs mt-1 text-gray-400">支持多选 JPG &middot; PNG &middot; WebP &middot; 全部使用统一设置放大</p>
                <p className="text-[10px] text-gray-300 mt-0.5">最多 {MAX_BATCH} 张 &middot; 支持选择文件夹</p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <button onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-medium transition-colors">
                    <Upload className="w-3.5 h-3.5" /> 选择文件
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleFolderSelect(); }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 rounded-lg text-xs font-medium transition-colors">
                    <FolderOpen className="w-3.5 h-3.5" /> 上传文件夹
                  </button>
                </div>
              </div>
            ) : (
              // 批量图片列表
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-600">已选择 {batchItems.length} 张图片</p>
                  {!batchProcessing && (
                    <button onClick={(e) => { e.stopPropagation(); clearAllBatch() }}
                      className="text-xs text-red-500 hover:text-red-700 underline underline-offset-2">清空全部</button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-left">
                  {batchItems.map((item, idx) => (
                    <div key={item.id}
                      draggable={!batchProcessing && item.status === 'pending'}
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', idx); e.currentTarget.classList.add('opacity-40') }}
                      onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx) }}
                      onDragLeave={() => setDragOverIdx(null)}
                      onDragEnd={(e) => { e.currentTarget.classList.remove('opacity-40'); setDragOverIdx(null) }}
                      onDrop={(e) => { e.preventDefault(); const from = parseInt(e.dataTransfer.getData('text/plain')); if (from !== idx) moveBatchItem(from, idx); setDragOverIdx(null) }}
                      className={`relative bg-gray-50 rounded-xl border overflow-hidden group transition-all ${
                        dragOverIdx === idx ? 'border-indigo-400 ring-2 ring-indigo-200' :
                        item.status === 'done' ? 'border-green-200 ring-1 ring-green-100' :
                        item.status === 'error' ? 'border-red-200' :
                        'border-gray-200'
                      }`}>
                      <div className="aspect-square bg-gray-100 relative">
                        {item.preview ? (
                          <img src={item.preview} alt={item.file.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300">
                            <Loader2 className="w-6 h-6 animate-spin" />
                          </div>
                        )}
                        {item.status === 'done' && (
                          <div className="absolute top-1.5 right-1.5 bg-green-500 text-white rounded-full p-0.5">
                            <CheckCircle className="w-3.5 h-3.5" />
                          </div>
                        )}
                        {item.status === 'error' && (
                          <div className="absolute top-1.5 right-1.5 bg-red-500 text-white rounded-full p-0.5">
                            <AlertCircle className="w-3.5 h-3.5" />
                          </div>
                        )}
                        {item.status === 'processing' && (
                          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                            <Loader2 className="w-6 h-6 text-white animate-spin" />
                          </div>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-[10px] text-gray-500 truncate">{item.file.name}</p>
                        {item.origDims && (
                          <p className="text-[9px] text-gray-400">{item.origDims.w}&times;{item.origDims.h}px</p>
                        )}
                        {item.resultSize && (
                          <p className="text-[9px] text-indigo-500">{item.resultDims.w}&times;{item.resultDims.h} &middot; {item.resultSize}</p>
                        )}
                          {item.status === 'processing' && (
                            <div className="mt-1 space-y-1">
                              <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${item.progress}%` }} />
                              </div>
                              <p className="text-[9px] text-indigo-500 truncate">{item.stage || '处理中'}</p>
                            </div>
                          )}
                        {item.status === 'error' && (
                          <p className="text-[9px] text-red-500 truncate">{item.error}</p>
                        )}
                      </div>
                      {!batchProcessing && item.status === 'pending' && (
                        <button onClick={(e) => { e.stopPropagation(); removeBatchItem(item.id) }}
                          className="absolute top-1.5 left-1.5 w-5 h-5 bg-black/40 hover:bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      {item.status === 'done' && (
                        <button onClick={(e) => { e.stopPropagation(); downloadSingleResult(item, idx) }}
                          className="absolute bottom-2 right-2 w-7 h-7 bg-white/90 hover:bg-white shadow-sm border border-gray-200 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-indigo-600 hover:text-indigo-700">
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            // --- 单图上传区 ---
            preview ? (
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-xl p-3 inline-block mx-auto">
                  <img src={preview} alt="原图" className="max-h-48 mx-auto rounded-lg object-contain shadow-sm" />
                </div>
                <div className="text-sm text-gray-500">
                  <p>{origDims.w}&times;{origDims.h}px &middot; {(file.size / 1024).toFixed(1)} KB</p>
                  <p className="text-xs text-gray-400 truncate max-w-md mx-auto">{file.name}</p>
                </div>
                <button onClick={handleRemove} className="text-xs text-red-500 hover:text-red-700 underline underline-offset-2">删除重选</button>
              </div>
            ) : (
              <div className="text-gray-400 py-4">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center border border-indigo-100/50">
                  <Upload className="w-8 h-8 text-indigo-400" />
                </div>
                <p className="text-sm font-medium text-gray-600">点击或拖拽上传图片</p>
                <p className="text-xs mt-1 text-gray-400">常用 JPG &middot; PNG &middot; WebP；其他格式取决于浏览器支持</p>
              </div>
            )
          )}
        </section>

        {/* 批量上传提示 Toast */}
        {batchToast && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-amber-50 border border-amber-200 text-amber-800 px-5 py-2.5 rounded-xl shadow-lg text-sm font-medium animate-fade-in">
            {batchToast}
          </div>
        )}

        {/* ==================== 裁切适配 ==================== */}
        {!isMobileLayout && <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                <Crop className="w-4 h-4 text-indigo-500" />
                裁切适配
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                {batchMode ? '批量模式会按同一比例统一裁切并导出。' : '单图模式可拖动裁切框，决定最终保留区域。'}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={cropEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked
                  setCropEnabled(enabled)
                  if (enabled && origDims) setCropRect(getDefaultCropRect(origDims.w, origDims.h, cropPreset))
                  resetResultState()
                }}
                className="w-4 h-4 rounded border-gray-300 text-indigo-600" />
              开启裁切
            </label>
          </div>

          {cropEnabled && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CROP_PRESETS.map(preset => (
                  <button key={preset.id} onClick={() => applyCropPreset(preset.id)}
                    className={`px-3 py-2 rounded-lg border text-left ${cropPreset === preset.id ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    <span className="block text-xs font-semibold">{preset.label}</span>
                    <span className="block text-[10px] text-gray-400">{preset.w && preset.h ? `${preset.w}x${preset.h}` : '按选区比例'}</span>
                  </button>
                ))}
              </div>

              {!batchMode && preview && (
                <div ref={cropStageRef}
                  className="relative mx-auto max-w-xl rounded-xl overflow-hidden bg-gray-950/90 select-none touch-none"
                  onPointerDown={(event) => event.preventDefault()}>
                  <img src={preview} alt="裁切预览" className="block w-full h-auto opacity-80" draggable={false} />
                  <div className="absolute inset-0 pointer-events-none bg-black/10" />
                  <div
                    className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.42)] cursor-move touch-none"
                    style={{
                      left: `${cropRect.x * 100}%`,
                      top: `${cropRect.y * 100}%`,
                      width: `${cropRect.w * 100}%`,
                      height: `${cropRect.h * 100}%`,
                    }}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setCropDrag({ type: 'move', startX: event.clientX, startY: event.clientY, startRect: cropRect })
                    }}>
                    <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                      {Array.from({ length: 9 }).map((_, index) => (
                        <div key={index} className="border border-white/30" />
                      ))}
                    </div>
                    <button type="button" aria-label="调整裁切区域"
                      className="absolute -right-2 -bottom-2 w-5 h-5 rounded-full bg-white border border-indigo-500 shadow cursor-nwse-resize"
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setCropDrag({ type: 'resize', startX: event.clientX, startY: event.clientY, startRect: cropRect })
                      }} />
                  </div>
                </div>
              )}

              {!batchMode && !preview && (
                <p className="text-xs text-gray-400">上传图片后可以拖拽选择裁切区域。</p>
              )}
              {batchMode && (
                <p className="text-xs leading-6 text-gray-500">批量裁切暂时使用居中构图，适合快速导出统一比例。需要逐张精修时，先用单图处理。</p>
              )}
            </>
          )}
        </section>}

        {/* ==================== 控制区 ==================== */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 space-y-4">
          {isMobileLayout ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-indigo-800">手机精简模式</h2>
                  <p className="mt-1 text-xs leading-5 text-indigo-600">固定 2 倍放大并自动清晰化，减少手机内存占用。</p>
                </div>
                <span className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-indigo-700 shadow-sm">2x</span>
              </div>

              <label className={`flex items-start gap-3 rounded-xl border px-4 py-3 select-none ${
                aiUpscale ? 'border-indigo-300 bg-indigo-50/50' : 'border-gray-200 bg-gray-50/60'
              }`}>
                <input type="checkbox" checked={aiUpscale}
                  onChange={(event) => {
                    const enabled = event.target.checked
                    setAiUpscale(enabled)
                    if (enabled) trackEvent('ai_enabled', { source: 'mobile' })
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600" />
                <span>
                  <strong className="block text-sm font-semibold text-gray-800">AI 放大（保持原图颜色）</strong>
                  <span className="mt-1 block text-xs leading-5 text-gray-500">AI 只增强亮度细节，不调整色相和饱和度；分块处理支持约 400 万像素以内图片。</span>
                </span>
              </label>
              {aiUpscale && (
                <p className={`-mt-2 rounded-lg px-3 py-2 text-xs ${aiModelReady ? 'bg-green-50 text-green-700' : aiModelLoading ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                  {aiModelReady
                    ? 'AI 模型已下载并在本机启用'
                    : aiModelLoading
                      ? '正在下载并启动 AI 模型…'
                      : 'AI 模型尚未加载成功，处理时会自动重试'}
                </p>
              )}

              <div className={`rounded-xl border px-4 py-3 ${smartSharpen ? 'border-indigo-200 bg-white' : 'border-gray-200 bg-gray-50/60'}`}>
                <label className="flex items-center gap-3 select-none">
                  <input type="checkbox" checked={smartSharpen}
                    onChange={(event) => setSmartSharpen(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600" />
                  <span className="text-sm font-semibold text-gray-800">智能锐化</span>
                  <span className="ml-auto text-xs font-semibold text-indigo-600">{sharpenAmount.toFixed(1)}</span>
                </label>
                {smartSharpen && (
                  <div className="mt-3">
                    <input type="range" min="0.3" max="2" step="0.1" value={sharpenAmount}
                      aria-label="智能锐化强度"
                      onChange={(event) => setSharpenAmount(Number(event.target.value))}
                      className="h-2 w-full accent-indigo-600" />
                    <div className="mt-1 flex justify-between text-[10px] text-gray-400"><span>自然</span><span>更清晰</span></div>
                  </div>
                )}
              </div>

              <label className={`flex items-center gap-3 rounded-xl border px-4 py-3 select-none ${antiAlias ? 'border-indigo-200 bg-white' : 'border-gray-200 bg-gray-50/60'}`}>
                <input type="checkbox" checked={antiAlias}
                  onChange={(event) => setAntiAlias(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600" />
                <span>
                  <strong className="block text-sm font-semibold text-gray-800">抗锯齿</strong>
                  <span className="mt-1 block text-xs leading-5 text-gray-500">减轻文字、插画和斜线边缘的锯齿感。</span>
                </span>
              </label>

              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-500">导出格式</span>
                <div className="flex gap-1">
                  {FORMAT_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => setFormat(opt.value)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                        format === opt.value
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 bg-white text-gray-500'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {expectedOutput && (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700">
                  预计导出 <strong>{expectedOutput.w}&times;{expectedOutput.h}px</strong>
                </div>
              )}

              {processEstimate?.blockReason && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                  <strong className="block text-sm">图片太大，建议使用电脑端</strong>
                  <span className="mt-1 block">{processEstimate.blockReason}</span>
                </div>
              )}
            </div>
          ) : (
            <>
          {/* 模式切换 */}
          <div className="flex gap-2">
            {[{ value: 'scale', label: '\u6309\u500d\u6570\u653e\u5927', icon: ZoomIn },
              { value: 'target', label: '\u6309\u76ee\u6807\u5206\u8fa8\u7387', icon: Maximize2 }].map((opt) => (
              <button key={opt.value} onClick={() => setScaleMode(opt.value)}
                className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border flex items-center justify-center gap-2 ${
                  scaleMode === opt.value
                    ? 'bg-indigo-50 border-indigo-500 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}>
                <opt.icon className="w-4 h-4" />{opt.label}
              </button>
            ))}
          </div>

          {/* 按倍数放大 */}
          {scaleMode === 'scale' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{'\u653e\u5927\u500d\u6570'}</span>
                <div className="flex items-center gap-2">
                  <input type="number" min="1" max="20" step="0.5" value={scale}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (!isNaN(v) && v >= 1 && v <= 20) setScale(v)
                    }}
                    className="w-20 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-center font-bold text-indigo-700 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
                  <span className="text-sm font-bold text-indigo-700">x</span>
                </div>
              </div>
              <input type="range" min="1" max="20" step="0.5" value={scale}
                onChange={(e) => setScale(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
              <div className="flex justify-between text-xs text-gray-400 px-0.5 select-none">
                <span>1x</span><span>5x</span><span>10x</span><span>15x</span><span>20x</span>
              </div>

              <p className="text-xs leading-5 text-gray-500">
                {scale === 1 ? '1x 只增强画质，不增加图片尺寸；需要真正放大时建议选择 2x 或更高。' : '推荐从 2x 开始；倍数越高，处理时间和内存占用越大。'}
              </p>

              {!batchMode && expectedOutput && (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700">
                  预计导出 <strong>{expectedOutput.w}&times;{expectedOutput.h}px</strong>
                  {cropEnabled && activeCropRatio && <span className="text-indigo-500"> · 裁切比例 {formatRatio(activeCropRatio)}</span>}
                </div>
              )}

              {!batchMode && origDims && maxScale < 20 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs leading-relaxed">
                  <p className="text-amber-700">当前处理尺寸 {sourceDimsForPreview.w}&times;{sourceDimsForPreview.h}px，输出长边上限 10000px</p>
                  <p className="text-amber-600">有效最大倍数约为 <strong>{maxScale}x</strong>，超过后会按上限等比缩小输出</p>
                </div>
              )}
                {!batchMode && expectedOutput && expectedOutput.capped && (
                  <p className="text-xs text-amber-600">* 已超过上限，实际输出会按 10000px 长边等比缩小，不会额外裁切画面</p>
                )}
                {!batchMode && processEstimate?.warnings.map((warning) => (
                  <p key={warning} className="text-xs text-amber-600">* {warning}</p>
                ))}
              </div>
            )}

          {/* 按目标分辨率 */}
          {scaleMode === 'target' && (
            <>
              <div className="flex gap-2">
                <button onClick={() => setTargetMode('preset')}
                  className={`px-4 py-2 rounded-lg text-xs font-medium border ${targetMode === 'preset' ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>清晰度等级</button>
                <button onClick={() => setTargetMode('custom')}
                  className={`px-4 py-2 rounded-lg text-xs font-medium border ${targetMode === 'custom' ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>{'\u81ea\u5b9a\u4e49'}</button>
              </div>
              {targetMode === 'preset' ? (
                <div className="grid grid-cols-2 gap-2">
                  {QUALITY_PRESETS.map((opt, i) => {
                    const displayDims = origDims ? previewTargetPreset(opt) : null
                    return (
                      <button key={i} onClick={() => setTargetIdx(i)}
                        className={`py-3 px-4 rounded-lg text-sm border text-left ${targetIdx === i ? 'bg-indigo-50 border-indigo-500' : 'border-gray-200'}`}>
                        <div className={`font-bold ${targetIdx === i ? 'text-indigo-700' : 'text-gray-700'}`}>{opt.label}</div>
                        <div className={`text-xs ${targetIdx === i ? 'text-indigo-500' : 'text-gray-400'}`}>
                          {displayDims ? `${displayDims.w}×${displayDims.h} · ` : '上传后按原图比例计算 · '}长边 {opt.edge}px
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-1 block">{'\u5bbd\u5ea6'} (px)</label>
                      <input type="number" min="1" max="10000" value={customW}
                        onChange={(e) => handleCustomWidthChange(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
                    </div>
                    <div className="text-gray-400 pb-2 font-mono">&times;</div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-1 block">{'\u9ad8\u5ea6'} (px)</label>
                      <input type="number" min="1" max="10000" value={customH}
                        onChange={(e) => handleCustomHeightChange(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
                    </div>
                  </div>
                  {activeOutputRatio && (
                    <p className="text-xs text-indigo-600">已按当前比例 {formatRatio(activeOutputRatio)} 联动宽高，修改一个数值会自动同步另一个数值。</p>
                  )}
                </div>
              )}
              {!batchMode && expectedOutput && (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700">
                  预计导出 <strong>{expectedOutput.w}&times;{expectedOutput.h}px</strong>
                  {activeCropRatio && <span className="text-indigo-500"> · 裁切比例 {formatRatio(activeCropRatio)}</span>}
                </div>
              )}
            </>
          )}

          {/* 格式 & 选项 */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">{'\u683c\u5f0f'}</span>
                <div className="flex gap-1">
                  {FORMAT_OPTIONS.map((opt) => (
                    <span key={opt.value} className="relative group">
                      <button type="button"
                        onClick={() => setFormat(opt.value)}
                        aria-label={`${opt.label}：${opt.tip}`}
                        className={`px-3 py-1 rounded-md text-xs font-medium border ${
                          format === opt.value
                            ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}>{opt.label}</button>
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-56 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-[11px] leading-5 text-gray-600 shadow-lg group-hover:block group-focus-within:block">
                        {opt.tip}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                  <input type="checkbox" checked={keepRatio && !cropEnabled} disabled={cropEnabled}
                    onChange={(e) => setKeepRatio(e.target.checked)}
                    className="w-3 h-3 rounded border-gray-300 text-indigo-500" />
                  {cropEnabled ? '按裁切比例输出' : '\u4fdd\u6301\u6bd4\u4f8b'}
                </label>
                <button onClick={handleSmartDetect}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 transition-colors">
                  {'\uD83D\uDD0D'}{'\u667a\u80fd\u68c0\u6d4b'}
                </button>
              </div>
            </div>

            <div className="bg-gray-50/60 border border-gray-100 rounded-xl p-4 space-y-3">
              <div>
                <div className='text-xs font-medium text-gray-500 mb-2'>{'\u9510\u5316'}</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                    <input type="checkbox" checked={smartSharpen}
                      onChange={(e) => setSmartSharpen(e.target.checked)}
                      className="w-3 h-3 rounded border-gray-300 text-indigo-500" />
                    <Sparkles className="w-3 h-3 text-amber-400" />{'\u667a\u80fd\u9510\u5316'}
                  </label>
                  {smartSharpen && (
                    <div className="flex items-center gap-2 col-span-2 sm:col-span-3">
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">{'\u5f3a\u5ea6'}</span>
                      <input type="range" min="0.3" max="3.0" step="0.1" value={sharpenAmount}
                        onChange={(e) => setSharpenAmount(parseFloat(e.target.value))}
                        className="w-20 sm:w-32 h-1.5 accent-indigo-500 cursor-pointer" />
                      <span className="text-[10px] text-gray-500 w-6 text-right">{sharpenAmount.toFixed(1)}</span>
                    </div>
                  )}
                </div>
                {smartSharpen && (
                  <p className="mt-2 text-[11px] leading-5 text-gray-400">
                    人像建议 0.3–0.5，普通照片 0.5–0.8，插画/文字 0.8–1.4。高倍放大建议从低强度开始。
                  </p>
                )}
              </div>

              <div className="hidden">
                <div className="text-xs font-medium text-gray-500 mb-2">放大前净化</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-600 cursor-pointer select-none">
                    <input type="checkbox" checked={reduceArtifacts}
                      onChange={(e) => setReduceArtifacts(e.target.checked)}
                      className="mt-0.5 h-3 w-3 rounded border-gray-300 text-indigo-500" />
                    <span><strong className="font-semibold text-gray-700">减少色块/伪影</strong><span className="mt-0.5 block leading-4 text-gray-400">放大前减轻 JPEG 压缩色块和细小噪声。</span></span>
                  </label>
                  <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-600 cursor-pointer select-none">
                    <input type="checkbox" checked={reduceMoire}
                      onChange={(e) => setReduceMoire(e.target.checked)}
                      className="mt-0.5 h-3 w-3 rounded border-gray-300 text-indigo-500" />
                    <span><strong className="font-semibold text-gray-700">抗摩尔纹</strong><span className="mt-0.5 block leading-4 text-gray-400">放大前抑制衣物、屏幕等区域的细密周期纹理。</span></span>
                  </label>
                  <label className="flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2 text-[11px] text-gray-600 cursor-pointer select-none sm:col-span-2">
                    <input type="checkbox" checked={faceAwareProtection}
                      onChange={(e) => setFaceAwareProtection(e.target.checked)}
                      className="mt-0.5 h-3 w-3 rounded border-gray-300 text-indigo-500" />
                    <span><strong className="font-semibold text-indigo-700">人脸智能保护</strong><span className="mt-0.5 block leading-4 text-gray-400">单独控制是否加载本地人脸模型。开启后保护五官线条，并把净化重点放在皮肤区域；关闭后使用普通全图处理。</span></span>
                  </label>
                </div>
                {faceAwareProtection && (
                  <div className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="face-skin-strength" className="text-[11px] font-semibold text-gray-700">皮肤净化程度</label>
                      <span className="text-[10px] font-medium text-indigo-600">
                        {faceSkinStrength}% · {faceSkinStrength <= 35 ? '保守' : faceSkinStrength <= 70 ? '平衡' : '加强'}
                      </span>
                    </div>
                    <input id="face-skin-strength" type="range" min="0" max="100" step="5" value={faceSkinStrength}
                      aria-label="皮肤净化程度"
                      disabled={!reduceArtifacts && !reduceMoire}
                      onChange={(e) => setFaceSkinStrength(Number(e.target.value))}
                      className="mt-2 h-1.5 w-full accent-indigo-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40" />
                    <div className="mt-1 flex justify-between text-[9px] text-gray-400"><span>更多保留肤质</span><span>更强抑制色块/摩尔纹</span></div>
                    <p className="mt-1.5 text-[10px] leading-4 text-gray-400">
                      {!reduceArtifacts && !reduceMoire
                        ? '请先开启“减少色块/伪影”或“抗摩尔纹”，滑杆才会参与处理。'
                        : '低程度优先保留肤质，高程度扩大处理范围并降低皮肤区域的重复锐化；五官线条仍保持清晰。'}
                    </p>
                  </div>
                )}
              </div>

              <div className="hidden">
                <div className='text-xs font-medium text-gray-500 mb-2'>{'\u8272\u5f69/\u5bf9\u6bd4\u5ea6'}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                    <input type="checkbox" checked={autoLevels}
                      onChange={(e) => setAutoLevels(e.target.checked)}
                      className="w-3 h-3 rounded border-gray-300 text-indigo-500" />
                    {'\u81ea\u52a8\u8272\u9636'}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                    <input type="checkbox" checked={vibrance}
                      onChange={(e) => setVibrance(e.target.checked)}
                      className="w-3 h-3 rounded border-gray-300 text-indigo-500" />
                    {'\u81ea\u7136\u9971\u548c\u5ea6'}
                  </label>

                </div>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <div className='text-xs font-medium text-gray-500 mb-2'>{'\u653e\u5927\u7b97\u6cd5'}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                    <input type="checkbox" checked={aiUpscale}
                      onChange={(e) => {
                        const enabled = e.target.checked
                        setAiUpscale(enabled)
                        if (enabled) trackEvent('ai_enabled')
                      }}
                      className="w-3 h-3 rounded border-gray-300 text-indigo-500" />
                    AI 放大（保持原图颜色）
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                    <input type="checkbox" checked={antiAlias}
                      onChange={(e) => setAntiAlias(e.target.checked)}
                      className="w-3 h-3 rounded border-gray-300 text-indigo-500" />
                    {'\u6297\u952f\u9f7f'}
                  </label>
                </div>
                  {aiUpscale && (
                    <div className="mt-2 space-y-2">
                      <p className="text-[11px] leading-5 text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        {aiModelLoading
                          ? '正在下载并加载浏览器端 AI 模型，首次使用可能需要数秒。'
                          : aiModelReady
                            ? 'AI 模型已在本地浏览器就绪，默认保留原图颜色，只增强细节。'
                            : 'AI 放大会下载模型到浏览器运行，图片内容不上传服务器。'}
                      </p>
                    </div>
                  )}
                  {!batchMode && processEstimate?.blockReason && (
                    <p className="mt-2 text-[11px] leading-5 text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      {processEstimate.blockReason}
                    </p>
                  )}
                </div>
            </div>
          </div>
            </>
          )}
          {/* 提交按钮 */}
          {!batchMode && (
            <>
                {processing && (
                  <div className="space-y-1">
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${progress}%` }} />
                  </div>
                    <div className="flex justify-between text-[10px] text-gray-400 px-0.5">
                      <span>{'\u89e3\u6790'}</span><span>{'\u653e\u5927'}</span><span>{'\u9510\u5316'}</span><span>{'\u8f93\u51fa'}</span>
                    </div>
                    <div className="text-[11px] text-indigo-600 font-medium">{processStage || '准备处理'} · 进度为估算，大图或 AI 模式可能需要较长时间，请不要关闭页面</div>
                  </div>
                )}

                {!processing && processEstimate?.warnings.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs leading-relaxed text-amber-700">
                    {processEstimate.warnings[0]}
                  </div>
                )}

                <button onClick={handleProcess} disabled={!preview || processing || !!processEstimate?.blockReason}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-indigo-300 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors">
                {processing ? <><Loader2 className="w-4 h-4 animate-spin" /> {'\u5904\u7406\u4e2d...'}</> : <><ZoomIn className="w-4 h-4" /> {'\u5f00\u59cb\u653e\u5927'}</>}
              </button>

              {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
            </>
          )}

          {batchMode && (
            <>
              <button onClick={handleBatchProcess}
                disabled={pendingCount === 0 || batchProcessing}
                className="w-full py-3 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 disabled:bg-purple-300 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors">
                {batchProcessing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> {'\u6279\u91cf\u5904\u7406\u4e2d...'}</>
                ) : (
                  <><ZoomIn className="w-4 h-4" /> {'\u6279\u91cf\u653e\u5927'}<strong className="ml-1">({pendingCount}{'\u5f20'})</strong></>
                )}
              </button>
              {(doneCount > 0 || batchItems.some(it => it.status === 'error')) && (
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{'\u5df2\u5b8c\u6210'} {doneCount}/{batchItems.length} {'\u5f20'}</span>

                </div>
              )}
            </>
          )}
        </div>

        {/* ==================== 单图 - 前后对比 ==================== */}
        {!batchMode && result && compareDisplaySource && compareDisplayDims && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {isMobileLayout ? (
              <div className="p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">按住查看原图</h3>
                    <p className="mt-1 text-xs text-gray-500">按住显示原图并拖动画面，松开显示生成图</p>
                  </div>
                  <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${showOriginalOnPress ? 'bg-gray-100 text-gray-700' : 'bg-indigo-50 text-indigo-700'}`}>
                    {showOriginalOnPress ? '原图' : '生成图'}
                  </span>
                </div>
                <div className="mb-3 flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
                  <span className="shrink-0 text-xs text-gray-500">细节放大</span>
                  <input type="range" min="1" max="8" step="0.5" value={compareZoom}
                    aria-label="对比图放大倍数"
                    onChange={(event) => {
                      const zoom = Number(event.target.value)
                      setCompareZoom(zoom)
                      if (zoom === 1) setComparePan({ x: 0, y: 0 })
                    }}
                    className="h-2 min-w-0 flex-1 accent-indigo-600" />
                  <span className="w-9 text-right text-xs font-semibold tabular-nums text-indigo-600">{compareZoom}x</span>
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="按住查看原图，松开查看生成图"
                  onContextMenu={(event) => event.preventDefault()}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.currentTarget.setPointerCapture?.(event.pointerId)
                    compareGestureRef.current = {
                      pointerId: event.pointerId,
                      startX: event.clientX,
                      startY: event.clientY,
                      originX: comparePan.x,
                      originY: comparePan.y,
                    }
                    setShowOriginalOnPress(true)
                  }}
                  onPointerMove={(event) => {
                    const gesture = compareGestureRef.current
                    if (!gesture || gesture.pointerId !== event.pointerId || compareZoom <= 1) return
                    event.preventDefault()
                    const maxX = event.currentTarget.clientWidth * (compareZoom - 1) / 2
                    const maxY = event.currentTarget.clientHeight * (compareZoom - 1) / 2
                    setComparePan({
                      x: clamp(gesture.originX + event.clientX - gesture.startX, -maxX, maxX),
                      y: clamp(gesture.originY + event.clientY - gesture.startY, -maxY, maxY),
                    })
                  }}
                  onPointerUp={(event) => {
                    event.currentTarget.releasePointerCapture?.(event.pointerId)
                    compareGestureRef.current = null
                    setShowOriginalOnPress(false)
                  }}
                  onPointerCancel={() => {
                    compareGestureRef.current = null
                    setShowOriginalOnPress(false)
                  }}
                  onLostPointerCapture={() => {
                    compareGestureRef.current = null
                    setShowOriginalOnPress(false)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === ' ' || event.key === 'Enter') {
                      event.preventDefault()
                      setShowOriginalOnPress(true)
                    }
                  }}
                  onKeyUp={() => setShowOriginalOnPress(false)}
                  className="relative select-none overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-inner"
                  style={{
                    touchAction: 'none',
                    WebkitTouchCallout: 'none',
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                  }}>
                  <img
                    src={showOriginalOnPress ? compareDisplaySource : result}
                    alt={showOriginalOnPress ? compareSourceLabel : '生成图'}
                    draggable="false"
                    onDragStart={(event) => event.preventDefault()}
                    className="pointer-events-none block h-auto max-h-[65vh] w-full select-none object-contain transition-none"
                    style={{
                      transform: `translate3d(${comparePan.x}px, ${comparePan.y}px, 0) scale(${compareZoom})`,
                      transformOrigin: 'center center',
                      WebkitTouchCallout: 'none',
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                    }}
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-3 pt-8 text-center text-xs font-medium text-white">
                    {showOriginalOnPress ? '正在查看原图 · 拖动查看细节' : '按住图片查看原图'}
                  </div>
                </div>
              </div>
            ) : (
              <>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-indigo-500" />
                {'\u524d\u540e\u7ec6\u8282\u5bf9\u6bd4'}
              </h3>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer select-none hover:text-gray-600 transition-colors">
                  <input type="checkbox" checked={syncedScroll}
                    onChange={(e) => setSyncedScroll(e.target.checked)}
                    className="w-3 h-3 rounded border-gray-300 text-indigo-500" />
                  {'\u8054\u52a8\u6eda\u52a8'}
                </label>
                <span className="text-[11px] text-gray-400">{'\u540c\u6b65\u7f29\u653e'}</span>
                <input type="range" min="1" max="8" step="0.5" value={compareZoom}
                  onChange={(e) => setCompareZoom(parseFloat(e.target.value))}
                  className="w-24 h-1.5" />
                <span className="text-xs font-mono text-indigo-600 w-10 text-right tabular-nums">{compareZoom}x</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{compareSourceLabel}</span>
                  <span className="text-[10px] text-gray-400">{compareDisplayDims.w}&times;{compareDisplayDims.h}px</span>
                </div>
                <div ref={leftScrollRef}
                  onScroll={() => { if (syncingRef.current || !syncedScroll) return; syncingRef.current = true; const s = leftScrollRef.current, t = rightScrollRef.current; if (s && t) { const pctX = s.scrollWidth > s.clientWidth ? s.scrollLeft / (s.scrollWidth - s.clientWidth) : 0; const pctY = s.scrollHeight > s.clientHeight ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0; if (t.scrollWidth > t.clientWidth) t.scrollLeft = pctX * (t.scrollWidth - t.clientWidth); if (t.scrollHeight > t.clientHeight) t.scrollTop = pctY * (t.scrollHeight - t.clientHeight); } requestAnimationFrame(() => { syncingRef.current = false; }); }}
                  className="overflow-auto max-h-72 bg-gray-50 rounded-lg border border-gray-100 cursor-pointer hover:border-indigo-200 transition-colors"
                  onClick={() => { setModalMode('compare'); setShowModal(true); }}>
                  <img src={compareDisplaySource} alt={compareSourceLabel} style={{ transform: `scale(${compareZoom})`, transformOrigin: 'top left', minWidth: '100%' }} className="block" />
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">{'\u653e\u5927\u540e'}</span>
                  <span className="text-[10px] text-gray-400">{resultDims.w}&times;{resultDims.h}px</span>
                </div>
                <div ref={rightScrollRef}
                  onScroll={() => { if (syncingRef.current || !syncedScroll) return; syncingRef.current = true; const s = rightScrollRef.current, t = leftScrollRef.current; if (s && t) { const pctX = s.scrollWidth > s.clientWidth ? s.scrollLeft / (s.scrollWidth - s.clientWidth) : 0; const pctY = s.scrollHeight > s.clientHeight ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0; if (t.scrollWidth > t.clientWidth) t.scrollLeft = pctX * (t.scrollWidth - t.clientWidth); if (t.scrollHeight > t.clientHeight) t.scrollTop = pctY * (t.scrollHeight - t.clientHeight); } requestAnimationFrame(() => { syncingRef.current = false; }); }}
                  className="overflow-auto max-h-72 bg-gray-50 rounded-lg border border-gray-100 cursor-pointer hover:border-indigo-200 transition-colors"
                  onClick={() => { setModalMode('compare'); setShowModal(true); }}>
                  <img src={result} alt="\u653e\u5927\u540e" style={{ transform: `scale(${compareZoom})`, transformOrigin: 'top left', minWidth: '100%' }} className="block" />
                </div>
              </div>
            </div>
              </>
            )}
          </div>
        )}

        {/* ==================== 单图 - 结果区 ==================== */}
        {!batchMode && result && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">{'\u5904\u7406\u7ed3\u679c'}</h2>
              <div className="text-xs text-gray-500 text-right">
                <div>{compareDisplayDims?.w || origDims.w}&times;{compareDisplayDims?.h || origDims.h} &rarr; <strong className="text-indigo-600">{resultDims.w}&times;{resultDims.h}</strong></div>
                <div className="text-gray-400">{(resultDims.w / (compareDisplayDims?.w || origDims.w)).toFixed(1)}x &middot; {resultSize}</div>
              </div>
            </div>
            {!isMobileLayout && (
              <div className="rounded-xl overflow-hidden bg-gray-50 border border-gray-100">
                <img src={result} alt="\u653e\u5927\u7ed3\u679c" className="w-full h-auto max-h-96 object-contain mx-auto cursor-pointer"
                  onClick={() => { setModalMode('single'); setShowModal(true); setImgZoom(1); setImgPan({x:0,y:0}); }} />
              </div>
            )}
            <button onClick={isMobileLayout ? handleSaveToPhotos : handleDownload}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
              <Download className="w-4 h-4" /> {isMobileLayout ? '保存到手机相册' : `下载 ${format === 'jpeg' ? 'JPG' : format.toUpperCase()}`}
            </button>
            {isMobileLayout && <p className="-mt-2 text-center text-[11px] text-gray-400">将打开系统菜单，请选择“存储图像”或相册应用</p>}
            <p className="text-center text-xs text-gray-500">
              文件名：{file ? file.name.replace(/\.[^.]+$/, '') : 'image'}_{resultDims.w}x{resultDims.h}.{format === 'jpeg' ? 'jpg' : format}
              {format === 'png' ? ' · 保留透明背景' : ' · 不保留透明背景'}
            </p>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-800">处理完成，可以收藏下次再用</p>
                  <p className="text-xs leading-5 text-gray-500">图片始终在当前设备处理，不会上传服务器。</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button onClick={handleCopyPageLink}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-100">
                  <Copy className="w-3.5 h-3.5" /> 复制页面链接
                </button>
              </div>
            </div>
            {shareNotice && <p className="text-xs text-indigo-600">{shareNotice}</p>}
          </div>
        )}

        {/* ==================== 批量 - 结果汇总 ==================== */}
        {batchMode && doneCount > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                {'\u5904\u7406\u5b8c\u6210'} ({doneCount}/{batchItems.length})
              </h2>
              <button onClick={downloadAllAsZip} disabled={zipDownloading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60 transition-colors text-xs font-medium">
                {zipDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                {zipDownloading ? '正在打包 ZIP' : '全部下载 (ZIP)'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {batchItems.filter(it => it.status === 'done').map((item) => (
                <div key={item.id} className="bg-gray-50 rounded-xl border border-green-200 overflow-hidden group">
                  <div className="aspect-square bg-gray-100 relative">
                    <img src={item.result} alt={item.file.name} className="w-full h-full object-cover" />
                    <button onClick={() => downloadSingleResult(item)}
                      aria-label={`下载 ${item.file.name}`}
                      className="absolute bottom-2 right-2 w-8 h-8 bg-white/90 hover:bg-white shadow-sm border border-gray-200 rounded-lg flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-indigo-600 hover:text-indigo-700">
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-2">
                    <p className="text-[10px] text-gray-500 truncate">{item.file.name}</p>
                    <p className="text-[9px] text-indigo-500">{item.resultDims.w}&times;{item.resultDims.h} &middot; {item.resultSize}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-800">批量处理完成，可以收藏下次再用</p>
                  <p className="text-xs leading-5 text-gray-500">复制链接后可以发给自己，或保存到常用笔记里。</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button onClick={handleCopyPageLink}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-100">
                  <Copy className="w-3.5 h-3.5" /> 复制页面链接
                </button>
              </div>
            </div>
            {shareNotice && <p className="text-xs text-indigo-600">{shareNotice}</p>}
          </div>
        )}

        {/* 说明 */}
        <div className={`${isMobileLayout ? 'hidden' : ''} bg-blue-50/50 border border-blue-100 rounded-xl p-4 text-xs text-blue-800 leading-relaxed`}>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>{'\u591a\u7ea7\u653e\u5927'}</strong>{'\uff1a\u5927\u500d\u6570\u65f6\u81ea\u52a8\u5206\u9636\u6bb5\u653e\u5927\uff0c\u6bcf\u7ea7\u4e2d\u95f4\u505a\u9510\u5316'}</li>
            <li><strong>{'\u589e\u5f3a\u753b\u8d28'}</strong>{'\uff1a\u9ad8\u8d28\u91cf\u91cd\u91c7\u6837 + \u667a\u80fd\u9510\u5316'}</li>
            <li>{'\u6ce8\u610f\uff1a\u653e\u5927\u7b97\u6cd5\u65e0\u6cd5\u51ed\u7a7a\u589e\u52a0\u7ec6\u8282\uff0c\u539f\u56fe\u8d28\u91cf\u8d8a\u597d\uff0c\u653e\u5927\u6548\u679c\u8d8a\u4f73'}</li>
            <li>{'\u957f\u8fb9\u50cf\u7d20\u4e0a\u9650'} <strong>10000px</strong>{'\uff0c\u8d85\u8fc7\u4f1a\u81ea\u52a8\u9650\u5236\u8f93\u51fa\u5c3a\u5bf8'}</li>
            <li>{'\u6279\u91cf\u653e\u5927\u65f6\u6240\u6709\u56fe\u7247\u4f7f\u7528\u540c\u4e00\u53c2\u6570\u8bbe\u7f6e\uff0c\u6309\u987a\u5e8f\u9010\u4e00\u5904\u7406'}</li>
            <li>{'\u6279\u91cf\u6a21\u5f0f\u4e0b\u53ef\u4ee5\u9009\u62e9\u6587\u4ef6\u5939\u4e0a\u4f20\uff0c\u81ea\u52a8\u8fc7\u6ee4\u56fe\u7247\u6587\u4ef6'}</li>
            <li>{'\u9ed8\u8ba4\u5728\u6d4f\u89c8\u5668\u672c\u5730\u5904\u7406\u56fe\u7247\uff0c\u65e0\u9700\u767b\u5f55\uff0c\u4e0d\u4f1a\u628a\u56fe\u7247\u4e0a\u4f20\u5230 TU Scale \u670d\u52a1\u5668'}</li>
          </ul>
        </div>

        <section className={`${isMobileLayout ? 'hidden' : ''} space-y-5 text-gray-700`}>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900">{'\u514d\u8d39\u5728\u7ebf\u56fe\u7247\u653e\u5927\u5de5\u5177'}</h2>
            <p className="text-sm leading-7">
              TU Scale 是一个浏览器端的图片放大工具，可以将 JPG、PNG 和 WebP 图片按倍数放大，也可以按 1080级、2K级、4K级或 8K级清晰度输出，并根据原图或裁切比例自动计算宽高。它适合处理头像、插画、老照片、截图、封面图和需要提升清晰度的网站配图。
            </p>
            <p className="text-sm leading-7">
              {'\u5de5\u5177\u652f\u6301\u667a\u80fd\u9510\u5316\u3001\u81ea\u52a8\u8272\u9636\u3001\u81ea\u7136\u9971\u548c\u5ea6\u3001\u6297\u952f\u9f7f\u548c AI \u56fe\u7247\u653e\u5927\u3002\u5982\u679c\u9700\u8981\u4e00\u6b21\u5904\u7406\u591a\u5f20\u56fe\u7247\uff0c\u4e5f\u53ef\u4ee5\u4f7f\u7528\u6279\u91cf\u56fe\u7247\u653e\u5927\u6a21\u5f0f\uff0c\u6309\u540c\u4e00\u7ec4\u53c2\u6570\u987a\u5e8f\u751f\u6210\u9ad8\u6e05\u56fe\u7247\u3002'}
            </p>
            <p className="text-sm leading-7">
              为了保护隐私，TU Scale 在浏览器本地完成 AI 放大、智能锐化和抗锯齿。你选择的图片不会被上传到 TU Scale 服务器，适合处理需要安心保存的个人照片、头像和普通配图。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="border border-gray-200 rounded-xl p-4 bg-white">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{'\u6d4f\u89c8\u5668\u7aef\u5904\u7406'}</h3>
              <p className="text-xs leading-6 text-gray-500">{'\u56fe\u7247\u653e\u5927\u548c\u753b\u8d28\u589e\u5f3a\u4e3b\u8981\u5728\u672c\u673a\u6d4f\u89c8\u5668\u4e2d\u5b8c\u6210\uff0c\u65e5\u5e38\u4f7f\u7528\u65e0\u9700\u767b\u5f55\u3002'}</p>
            </div>
            <div className="border border-gray-200 rounded-xl p-4 bg-white">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{'\u652f\u6301 4K/8K'}</h3>
              <p className="text-xs leading-6 text-gray-500">{'\u53ef\u6309\u653e\u5927\u500d\u6570\u6216\u6e05\u6670\u5ea6\u7b49\u7ea7\u8f93\u51fa\uff0c8K\u7ea7\u4ee3\u8868\u6700\u957f\u8fb9 7680px\uff0c\u9875\u9762\u957f\u8fb9\u4e0a\u9650\u4e3a 10000px\u3002'}</p>
            </div>
            <div className="border border-gray-200 rounded-xl p-4 bg-white">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{'\u652f\u6301\u6279\u91cf\u56fe\u7247\u653e\u5927'}</h3>
              <p className="text-xs leading-6 text-gray-500">{'\u53ef\u591a\u9009\u56fe\u7247\u6216\u9009\u62e9\u6587\u4ef6\u5939\uff0c\u6700\u591a\u540c\u65f6\u6dfb\u52a0 50 \u5f20\u56fe\u7247\u3002'}</p>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">{'\u5e38\u89c1\u95ee\u9898'}</h2>
            <div className="space-y-3 text-sm leading-7">
              <div>
                <h3 className="font-semibold text-gray-900">{'\u56fe\u7247\u653e\u5927\u540e\u4e00\u5b9a\u4f1a\u53d8\u6e05\u6670\u5417\uff1f'}</h3>
                <p>{'\u56fe\u7247\u653e\u5927\u53ef\u4ee5\u63d0\u5347\u5c3a\u5bf8\u548c\u89c6\u89c9\u9510\u5ea6\uff0c\u4f46\u65e0\u6cd5\u51ed\u7a7a\u521b\u9020\u539f\u56fe\u6ca1\u6709\u7684\u771f\u5b9e\u7ec6\u8282\u3002\u539f\u56fe\u8d28\u91cf\u8d8a\u597d\uff0c\u8f93\u51fa\u6548\u679c\u8d8a\u7a33\u5b9a\u3002'}</p>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{'\u4ec0\u4e48\u65f6\u5019\u9002\u5408\u6253\u5f00 AI \u56fe\u7247\u653e\u5927\uff1f'}</h3>
                <p>{'\u5f53\u56fe\u7247\u662f\u63d2\u753b\u3001\u5934\u50cf\u6216\u8fb9\u7f18\u6bd4\u8f83\u660e\u786e\u7684\u5185\u5bb9\u65f6\uff0cAI \u653e\u5927\u5f80\u5f80\u66f4\u5bb9\u6613\u4ea7\u751f\u5dee\u5f02\u3002\u7167\u7247\u7c7b\u56fe\u7247\u53ef\u4ee5\u5148\u5c1d\u8bd5\u667a\u80fd\u9510\u5316\u3001\u81ea\u52a8\u8272\u9636\u548c\u81ea\u7136\u9971\u548c\u5ea6\u3002'}</p>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{'\u8f93\u51fa PNG\u3001JPEG \u8fd8\u662f WebP \u66f4\u597d\uff1f'}</h3>
                <p>{'\u9700\u8981\u4fdd\u7559\u900f\u660e\u80cc\u666f\u65f6\u5efa\u8bae\u9009 PNG\uff1b\u7167\u7247\u548c\u7535\u5546\u56fe\u53ef\u4ee5\u9009 JPEG\uff1b\u5982\u679c\u7528\u4e8e\u7f51\u9875\u5c55\u793a\uff0cWebP \u901a\u5e38\u80fd\u5728\u753b\u8d28\u548c\u4f53\u79ef\u4e4b\u95f4\u53d6\u5f97\u66f4\u597d\u5e73\u8861\u3002'}</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="text-center py-6 text-xs text-gray-400 border-t border-gray-100 mt-8">TU Scale&middot;{'\u56fe\u7247\u653e\u5927\u5de5\u5177'} &middot; 浏览器本地处理</footer>

      <RewardButton />

      {/* 全屏查看 - 单图模式 */}
      {showModal && modalMode === 'single' && result && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col select-none"
          onMouseUp={() => { if (singleViewer.current) singleViewer.current.drag = false; }}
          onMouseLeave={() => { if (singleViewer.current) singleViewer.current.drag = false; }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="flex items-center justify-between px-5 py-3 bg-black/60 backdrop-blur-sm border-b border-white/10 shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-semibold text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded">{'\u653e\u5927\u7ed3\u679c'}</span>
              <span className="text-[11px] text-white/40">{resultDims.w}&times;{resultDims.h}px</span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={(e) => { e.stopPropagation(); const v = singleViewer.current; v.z = 1; v.x = 0; v.y = 0; if (singleImgRef.current) singleImgRef.current.style.transform = 'scale(1)'; }}
                className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors">{'\u91cd\u7f6e'}</button>
              <button onClick={(e) => { e.stopPropagation(); setShowModal(false); }}
                className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden bg-black/30"
            onWheel={(e) => { e.preventDefault(); const v = singleViewer.current; const oldZ = v.z; const newZ = Math.max(0.5, Math.min(20, v.z + (e.deltaY > 0 ? -0.2 : 0.2))); const ratio = newZ / oldZ; v.z = newZ; const rect = e.currentTarget.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top; v.x = mx - (mx - v.x) * ratio; v.y = my - (my - v.y) * ratio; if (singleImgRef.current) singleImgRef.current.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`; }}
            onMouseDown={(e) => { const v = singleViewer.current; if (v.z <= 1) return; v.drag = true; v.mx = e.clientX; v.my = e.clientY; v.sx = v.x; v.sy = v.y; }}
            onMouseMove={(e) => { const v = singleViewer.current; if (!v.drag) return; v.x = v.sx + (e.clientX - v.mx); v.y = v.sy + (e.clientY - v.my); if (singleImgRef.current) singleImgRef.current.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`; }}>
            <img ref={singleImgRef} src={result} alt="\u653e\u5927\u7ed3\u679c" draggable={false}
              style={{ transform: 'scale(1)', transformOrigin: '0 0', maxWidth: '90vw', maxHeight: '85vh' }} />
          </div>
          <div className="text-center py-2 text-white/25 text-[11px] shrink-0 bg-black/40">{'\u6eda\u8f6e\u7f29\u653e \u00b7 \u62d6\u62fd\u5e73\u79fb \u00b7 \u70b9\u51fb\u7a7a\u767d\u5173\u95ed'}</div>
        </div>
      )}

      {/* 全屏查看 - 对比模式 */}
      {showModal && modalMode === 'compare' && result && compareDisplaySource && compareDisplayDims && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="flex items-center justify-between px-5 py-3 bg-black/60 backdrop-blur-sm border-b border-white/10 shrink-0">
            <h3 className="text-sm text-white/80 font-semibold flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-indigo-400" />{'\u524d\u540e\u7ec6\u8282\u5bf9\u6bd4'}
            </h3>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[10px] text-white/50 cursor-pointer select-none hover:text-white/70 transition-colors">
                <input type="checkbox" checked={syncedScroll}
                  onChange={(e) => setSyncedScroll(e.target.checked)}
                  className="w-2.5 h-2.5 rounded border-white/30 bg-white/10 text-indigo-400" />{'\u8054\u52a8\u6eda\u52a8'}
              </label>
              <span className="text-[11px] text-white/40">{'\u540c\u6b65\u7f29\u653e'}</span>
              <input type="range" min="1" max="8" step="0.5" value={compareZoom}
                onChange={(e) => setCompareZoom(parseFloat(e.target.value))} className="w-20 h-1" />
              <span className="text-xs font-mono text-indigo-400 w-8 text-right tabular-nums">{compareZoom}x</span>
              <button onClick={(e) => { e.stopPropagation(); setShowModal(false); }}
                className="w-7 h-7 ml-1 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex-1 flex flex-col sm:flex-row gap-0 min-h-0">
            <div className="flex-1 flex flex-col min-w-0 border-r-0 sm:border-r border-white/10">
              <div className="px-4 py-2 flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-semibold text-white/60 bg-white/10 px-2 py-0.5 rounded">{compareSourceLabel}</span>
                <span className="text-[10px] text-white/40">{compareDisplayDims.w}&times;{compareDisplayDims.h}px</span>
              </div>
              <div ref={fsLeftScrollRef}
                onScroll={() => { if (fsSyncingRef.current || !syncedScroll) return; fsSyncingRef.current = true; const s = fsLeftScrollRef.current, t = fsRightScrollRef.current; if (s && t) { const pctX = s.scrollWidth > s.clientWidth ? s.scrollLeft / (s.scrollWidth - s.clientWidth) : 0; const pctY = s.scrollHeight > s.clientHeight ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0; if (t.scrollWidth > t.clientWidth) t.scrollLeft = pctX * (t.scrollWidth - t.clientWidth); if (t.scrollHeight > t.clientHeight) t.scrollTop = pctY * (t.scrollHeight - t.clientHeight); } requestAnimationFrame(() => { fsSyncingRef.current = false; }); }}
                className="flex-1 overflow-auto bg-black/20">
                <img src={compareDisplaySource} alt={compareSourceLabel} style={{ transform: `scale(${compareZoom})`, transformOrigin: 'top left' }} className="block" />
              </div>
            </div>
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-4 py-2 flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded">{'\u653e\u5927\u540e'}</span>
                <span className="text-[10px] text-white/40">{resultDims.w}&times;{resultDims.h}px</span>
              </div>
              <div ref={fsRightScrollRef}
                onScroll={() => { if (fsSyncingRef.current || !syncedScroll) return; fsSyncingRef.current = true; const s = fsRightScrollRef.current, t = fsLeftScrollRef.current; if (s && t) { const pctX = s.scrollWidth > s.clientWidth ? s.scrollLeft / (s.scrollWidth - s.clientWidth) : 0; const pctY = s.scrollHeight > s.clientHeight ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0; if (t.scrollWidth > t.clientWidth) t.scrollLeft = pctX * (t.scrollWidth - t.clientWidth); if (t.scrollHeight > t.clientHeight) t.scrollTop = pctY * (t.scrollHeight - t.clientHeight); } requestAnimationFrame(() => { fsSyncingRef.current = false; }); }}
                className="flex-1 overflow-auto bg-black/20">
                <img src={result} alt="\u653e\u5927\u540e" style={{ transform: `scale(${compareZoom})`, transformOrigin: 'top left' }} className="block" />
              </div>
            </div>
          </div>
          <div className="text-center py-2 text-white/25 text-[11px] shrink-0 bg-black/40">{'\u6eda\u52a8\u67e5\u770b\u7ec6\u8282 \u00b7 \u6ed1\u5757\u7f29\u653e \u00b7 \u8054\u52a8\u6eda\u52a8\u53ef\u5f00\u5173 \u00b7 \u70b9\u51fb\u7a7a\u767d\u5173\u95ed'}</div>
        </div>
      )}
    </div>
  )
}

export default App
