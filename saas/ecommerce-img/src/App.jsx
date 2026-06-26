import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { Upload, Download, ZoomIn, Maximize2, Loader2, Sparkles, X, Image as ImageIcon, FolderOpen, CheckCircle, AlertCircle, FileDown } from 'lucide-react'
import JSZip from 'jszip'
import { loadModel, processWithAI, isModelLoaded } from './ai/waifu2x'

const TARGET_PRESETS = [
  { w: 1920, h: 1080, label: 'Full HD', ratio: '16:9' },
  { w: 2560, h: 1440, label: '2K', ratio: '16:9' },
  { w: 3840, h: 2160, label: '4K', ratio: '16:9' },
  { w: 7680, h: 4320, label: '8K', ratio: '16:9' },
]

 let batchIdCounter = 0
 const MAX_BATCH = 50
 const STORAGE_KEY = 'tuscale_settings'
const IMAGE_EXTS = ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.tiff','.tif','.svg','.ico','.avif','.heic','.heif']
const WARN_OUTPUT_PIXELS = 45_000_000
const MAX_OUTPUT_PIXELS = 80_000_000
const MAX_AI_INPUT_EDGE = 2048
const MAX_AI_INPUT_PIXELS = 4_200_000

const revokeObjectUrl = (url) => {
  if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url)
}

const formatMegapixels = (pixels) => `${(pixels / 1_000_000).toFixed(pixels >= 10_000_000 ? 0 : 1)}MP`

const revokeBatchResultUrls = (items) => {
  items.forEach(item => revokeObjectUrl(item.result))
}

 function App() {
  // --- 单图模式状态 ---
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [origDims, setOrigDims] = useState(null)

  // --- 公共控制参数 ---
  const [scaleMode, setScaleMode] = useState('scale')
  const [scale, setScale] = useState(1)
  const [targetMode, setTargetMode] = useState('preset')
  const [targetIdx, setTargetIdx] = useState(2)
  const [customW, setCustomW] = useState(2048)
  const [customH, setCustomH] = useState(2048)
  const [format, setFormat] = useState('png')
  const [keepRatio, setKeepRatio] = useState(true)
  const [smartSharpen, setSmartSharpen] = useState(true)
  const [sharpenAmount, setSharpenAmount] = useState(1.2)
  const [aiUpscale, setAiUpscale] = useState(false)
  const [reduceArtifacts, setReduceArtifacts] = useState(false)
  const [deblur, setDeblur] = useState(false)
  const [autoLevels, setAutoLevels] = useState(false)
  const [vibrance, setVibrance] = useState(false)
  const [clahe, setClahe] = useState(false)
  const [smartDenoise, setSmartDenoise] = useState(false)
  const [edgeInterpolation, setEdgeInterpolation] = useState(false)
  const [antiAlias, setAntiAlias] = useState(false)
  const [aiModelLoading, setAiModelLoading] = useState(false)
  const [aiModelReady, setAiModelReady] = useState(false)

  // --- 单图处理状态 ---
  const [processing, setProcessing] = useState(false)
    const [progress, setProgress] = useState(0)
    const [processStage, setProcessStage] = useState('')
    const [result, setResult] = useState(null)
    const [resultDims, setResultDims] = useState(null)
  const [resultSize, setResultSize] = useState(null)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState('compare')
  const [compareZoom, setCompareZoom] = useState(1)
  const [imgZoom, setImgZoom] = useState(1)
  const [imgPan, setImgPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [showDonateTooltip, setShowDonateTooltip] = useState(false)
  const [showRewardModal, setShowRewardModal] = useState(false)

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
  const [batchToast, setBatchToast] = useState('')
  const [fileNameTemplate, setFileNameTemplate] = useState('{name}_{w}x{h}')
  const [dragOverIdx, setDragOverIdx] = useState(null)

  const panStart = useRef({ x: 0, y: 0 })
  const panOrigin = useRef({ x: 0, y: 0 })
  const fileRef = useRef(null)
  const folderRef = useRef(null)

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

 const leftScrollRef = useRef(null)
  const rightScrollRef = useRef(null)
  const syncingRef = useRef(false)
  const [syncedScroll, setSyncedScroll] = useState(true)
  const leftImgRef = useRef(null)
  const rightImgRef = useRef(null)
  const leftViewer = useRef({ z:1, x:0, y:0, drag:false, mx:0, my:0, sx:0, sy:0 })
  const rightViewer = useRef({ z:1, x:0, y:0, drag:false, mx:0, my:0, sx:0, sy:0 })
  const compareZoomRef = useRef(1)
  const singleViewer = useRef({ z:1, x:0, y:0, drag:false, mx:0, my:0, sx:0, sy:0 })
  const singleImgRef = useRef(null)
  const fsLeftScrollRef = useRef(null)
  const fsRightScrollRef = useRef(null)
  const fsSyncingRef = useRef(false)

  useEffect(() => {
    return () => revokeObjectUrl(result)
  }, [result])

  useEffect(() => {
    batchItemsRef.current = batchItems
  }, [batchItems])

  useEffect(() => {
    return () => revokeBatchResultUrls(batchItemsRef.current)
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
      if (mod && e.key === 'd') {
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
    } catch (_) {}
  }, [])

  // --- 保存设置到 localStorage ---
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      scale, format, smartSharpen, sharpenAmount, aiUpscale, reduceArtifacts, deblur, autoLevels, vibrance, clahe, smartDenoise, edgeInterpolation, antiAlias, scaleMode, targetMode, targetIdx,
      keepRatio, customW, customH, fileNameTemplate
    }))
  }, [scale, format, smartSharpen, sharpenAmount, aiUpscale, reduceArtifacts, deblur, autoLevels, vibrance, clahe, smartDenoise, edgeInterpolation, antiAlias, scaleMode, targetMode, targetIdx, keepRatio, customW, customH, fileNameTemplate])

  // --- 单图模式 effect ---
    useEffect(() => {
      setResult(null)
      setResultDims(null)
      setResultSize(null)
      setProcessStage('')
    }, [scaleMode, scale, targetMode, targetIdx, customW, customH, format, keepRatio, smartSharpen, sharpenAmount, aiUpscale, reduceArtifacts, deblur, autoLevels, vibrance, clahe, smartDenoise, edgeInterpolation, antiAlias])

  // --- 单图文件处理 ---
  const handleFile = useCallback((f) => {
    if (!f) return
      setFile(f)
      setResult(null)
      setResultDims(null)
      setResultSize(null)
    setError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        setOrigDims({ w: img.width, h: img.height })
        setCustomW(img.width)
        setCustomH(img.height)
        setPreview(e.target.result)
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(f)
  }, [])

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
      setResult(null); setResultDims(null); setResultSize(null); setProcessStage('')
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
  const targetDims = useMemo(() => {
    if (scaleMode === 'scale') return null
    if (targetMode === 'custom') return { w: parseInt(customW) || 0, h: parseInt(customH) || 0 }
    return TARGET_PRESETS[targetIdx]
  }, [scaleMode, targetMode, targetIdx, customW, customH])

  const expectedOutput = useMemo(() => {
    if (!origDims) return null
    let w, h
    if (scaleMode === 'scale') {
      w = Math.round(origDims.w * scale)
      h = Math.round(origDims.h * scale)
    } else if (targetDims) {
      if (keepRatio) {
        const r = Math.min(targetDims.w / origDims.w, targetDims.h / origDims.h)
        w = Math.round(origDims.w * r)
        h = Math.round(origDims.h * r)
      } else {
        w = targetDims.w; h = targetDims.h
      }
    } else return null
    if (w > 10000 || h > 10000) {
      const r = Math.min(10000 / w, 10000 / h)
      w = Math.round(w * r); h = Math.round(h * r)
    }
    if (format === 'jpeg') { w += w & 1; h += h & 1 }
    const capped = !!(origDims && (Math.round(origDims.w * scale) > 10000 || Math.round(origDims.h * scale) > 10000))
    const effectiveScale = origDims ? Math.max(w / origDims.w, h / origDims.h) : scale
    return { w, h, capped, effectiveScale }
  }, [origDims, scaleMode, scale, targetDims, keepRatio, format])

    const maxScale = origDims
      ? Math.min(20, Math.floor(Math.min(10000 / origDims.w, 10000 / origDims.h) * 2) / 2)
      : 20

    const processEstimate = useMemo(() => {
      if (!origDims || !expectedOutput) return null
      const outputPixels = expectedOutput.w * expectedOutput.h
      const inputPixels = origDims.w * origDims.h
      const inputEdge = Math.max(origDims.w, origDims.h)
      const warnings = []
      let blockReason = ''

      if (outputPixels > MAX_OUTPUT_PIXELS) {
        blockReason = `输出预计 ${formatMegapixels(outputPixels)}，浏览器端处理风险太高。请降低倍数或分辨率。`
      } else if (outputPixels > WARN_OUTPUT_PIXELS) {
        warnings.push(`输出预计 ${formatMegapixels(outputPixels)}，处理会更慢，也会占用更多内存。`)
      }

      if (aiUpscale && (inputEdge > MAX_AI_INPUT_EDGE || inputPixels > MAX_AI_INPUT_PIXELS)) {
        blockReason = `AI 模式建议输入长边不超过 ${MAX_AI_INPUT_EDGE}px。请降低尺寸或关闭 AI 放大。`
      }

      return { outputPixels, inputPixels, inputEdge, warnings, blockReason }
    }, [origDims, expectedOutput, aiUpscale])

  // --- Canvas 放大处理（单图和批量共用）---
  const processImageWithCanvas = (imageUrl, targetW, targetH, doEnhance, fmt) => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = async () => {
        try {
          const avgScale = Math.max(targetW / img.width, targetH / img.height)
          const passes = avgScale >= 8 ? 3 : avgScale >= 4 ? 2 : avgScale >= 2.5 ? 2 : 1

          let srcCanvas = document.createElement('canvas')
          srcCanvas.width = img.width
          srcCanvas.height = img.height
          let srcCtx = srcCanvas.getContext('2d')
          srcCtx.drawImage(img, 0, 0)

          // Apply pre-process enhancements to original image
          if (doEnhance.autoLevels || doEnhance.vibrance) {
            const origData = srcCtx.getImageData(0, 0, img.width, img.height)
            let processed = origData
            if (doEnhance.autoLevels) processed = autoLevelsFilter(processed)
            if (doEnhance.vibrance) processed = vibranceFilter(processed)
            // Create a temporary canvas to put processed data
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = img.width
            tempCanvas.height = img.height
            tempCanvas.getContext('2d').putImageData(processed, 0, 0)
            srcCtx.drawImage(tempCanvas, 0, 0)
          }

          // Pre-sharpen original image before upscaling
          if (doEnhance.smartSharpen && passes > 0) {
            const preData = srcCtx.getImageData(0, 0, img.width, img.height)
            const preSharp = unsharpMask(preData, sharpenAmount * 0.8)
            const tempPre = document.createElement('canvas')
            tempPre.width = img.width
            tempPre.height = img.height
            tempPre.getContext('2d').putImageData(preSharp, 0, 0)
            srcCtx.drawImage(tempPre, 0, 0)
          }

          if (doEnhance.aiUpscale) {
            // AI放大：使用 waifu2x 模型
            const aiPasses = avgScale >= 4 ? 2 : 1
            let aiCanvas = srcCanvas
            for (let i = 0; i < aiPasses; i++) {
              const aiData = aiCanvas.getContext('2d').getImageData(0, 0, aiCanvas.width, aiCanvas.height)
              const aiResult = await processWithAI(aiData)
              aiCanvas = document.createElement('canvas')
              aiCanvas.width = aiResult.width
              aiCanvas.height = aiResult.height
              aiCanvas.getContext('2d').putImageData(aiResult, 0, 0)
            }
            const dstCanvas = document.createElement('canvas')
            dstCanvas.width = targetW
            dstCanvas.height = targetH
            const dstCtx = dstCanvas.getContext('2d')
            dstCtx.imageSmoothingEnabled = true
            dstCtx.imageSmoothingQuality = 'high'
            dstCtx.drawImage(aiCanvas, 0, 0, targetW, targetH)

            if (doEnhance.smartSharpen) {
              const imageData = dstCtx.getImageData(0, 0, targetW, targetH)
              const enhanced = unsharpMask(imageData, sharpenAmount)
              dstCtx.putImageData(enhanced, 0, 0)
            }
            srcCanvas = dstCanvas
          } else {
            for (let i = 0; i < passes; i++) {
            const progress = (i + 1) / passes
            const stepW = Math.round(img.width * Math.pow(targetW / img.width, progress))
            const stepH = Math.round(img.height * Math.pow(targetH / img.height, progress))

            const dstCanvas = document.createElement('canvas')
            dstCanvas.width = stepW
            dstCanvas.height = stepH
            const dstCtx = dstCanvas.getContext('2d')
            dstCtx.imageSmoothingEnabled = true
            dstCtx.imageSmoothingQuality = 'high'

            dstCtx.drawImage(srcCanvas, 0, 0, stepW, stepH)

            if (doEnhance.smartSharpen || doEnhance.reduceArtifacts || i > 0) {
              const imageData = dstCtx.getImageData(0, 0, stepW, stepH)
              let enhanced = imageData
              if (doEnhance.smartSharpen) enhanced = unsharpMask(enhanced, sharpenAmount)
              if (doEnhance.reduceArtifacts) enhanced = bilateralFilter(enhanced)
              dstCtx.putImageData(enhanced, 0, 0)
            }
            srcCanvas = dstCanvas
          }
          }

          // Apply anti-aliasing as final step
          if (doEnhance.antiAlias) {
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
  const unsharpMask = (imageData, amount = 0.8, radius = 1) => {
    const { data, width, height } = imageData
    const blurred = new Float32Array(data.length)
    const gaussKernel = [2, 4, 2, 4, 8, 4, 2, 4, 2]
    let kernelSum = 0
    for (const v of gaussKernel) kernelSum += v

    // Gaussian blur
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0
          for (let ky = -1; ky <= 1; ky++)
            for (let kx = -1; kx <= 1; kx++) {
              const idx = ((y + ky) * width + (x + kx)) * 4 + c
              sum += data[idx] * gaussKernel[(ky + 1) * 3 + (kx + 1)]
            }
          blurred[(y * width + x) * 4 + c] = sum / kernelSum
        }
      }
    }

    // Unsharp mask: output = original + amount * (original - blurred)
    const output = new Uint8ClampedArray(data)
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const original = data[i + c]
        const blur = blurred[i + c]
        const mask = original - blur
        output[i + c] = Math.max(0, Math.min(255, original + amount * mask))
      }
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

  // --- CLAHE 自适应直方图均衡 ---
  const claheFilter = (imageData, clipLimit = 3, tileSize = 8) => {
    const { data, width, height } = imageData
    const output = new Uint8ClampedArray(data)

    for (let c = 0; c < 3; c++) {
      const tilesX = Math.ceil(width / tileSize)
      const tilesY = Math.ceil(height / tileSize)
      const cdfs = []

      // Compute CDF for each tile
      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          const hist = new Array(256).fill(0)
          const startY = ty * tileSize, endY = Math.min(startY + tileSize, height)
          const startX = tx * tileSize, endX = Math.min(startX + tileSize, width)
          let total = 0
          for (let y = startY; y < endY; y++)
            for (let x = startX; x < endX; x++) {
              hist[data[(y * width + x) * 4 + c]]++
              total++
            }

          // Clip histogram
          let clipped = 0
          const clipVal = (endX - startX) * (endY - startY) / 256 * clipLimit
          for (let i = 0; i < 256; i++) {
            if (hist[i] > clipVal) { clipped += hist[i] - clipVal; hist[i] = clipVal }
          }
          for (let i = 0; i < 256; i++) hist[i] += clipped / 256

          // Compute CDF
          const cdf = []
          let sum = 0
          for (let i = 0; i < 256; i++) { sum += hist[i]; cdf.push(sum * 255 / total) }
          cdfs.push(cdf)
        }
      }

      // Apply with bilinear interpolation between tiles
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const val = data[(y * width + x) * 4 + c]
          const tx = x / tileSize, ty = y / tileSize
          const tx0 = Math.min(Math.floor(tx), tilesX - 2)
          const ty0 = Math.min(Math.floor(ty), tilesY - 2)
          const tx1 = tx0 + 1, ty1 = ty0 + 1
          const fx = tx - tx0, fy = ty - ty0

          const v00 = cdfs[ty0 * tilesX + tx0][val]
          const v10 = cdfs[ty0 * tilesX + tx1][val]
          const v01 = cdfs[ty1 * tilesX + tx0][val]
          const v11 = cdfs[ty1 * tilesX + tx1][val]

          const v0 = v00 + (v10 - v00) * fx
          const v1 = v01 + (v11 - v01) * fx
          output[(y * width + x) * 4 + c] = Math.round(v0 + (v1 - v0) * fy)
        }
      }
    }
    return new ImageData(output, width, height)
  }

  // --- 智能去噪（方差感知降噪）---
  const smartDenoiseFilter = (imageData, strength = 3) => {
    const { data, width, height } = imageData
    const output = new Uint8ClampedArray(data)

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4
        for (let c = 0; c < 3; c++) {
          const vals = []
          for (let ky = -1; ky <= 1; ky++)
            for (let kx = -1; kx <= 1; kx++)
              vals.push(data[((y + ky) * width + (x + kx)) * 4 + c])
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length
          const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length

          // Low variance = smooth area = apply blur
          // High variance = edge = keep original
          const noiseFactor = Math.max(0, Math.min(1, 1 - variance / (200 * strength)))
          const center = data[idx + c]
          output[idx + c] = Math.round(center + (mean - center) * noiseFactor)
        }
        output[idx + 3] = 255
      }
    }
    return new ImageData(output, width, height)
  }

  // --- 边缘导向插值（更好的放大算法）---
  const edgeInterpolationFilter = (srcData, srcW, srcH, dstW, dstH) => {
    const output = new Uint8ClampedArray(dstW * dstH * 4)
    const sx = srcW / dstW, sy = srcH / dstH

    // Precompute source gradient map for edge detection
    const gradMap = new Float32Array(srcW * srcH)
    for (let y = 1; y < srcH - 1; y++)
      for (let x = 1; x < srcW - 1; x++) {
        const idx = y * srcW + x
        const gx = Math.abs(srcData[((y) * srcW + (x + 1)) * 4] - srcData[((y) * srcW + (x - 1)) * 4])
        const gy = Math.abs(srcData[((y + 1) * srcW + (x)) * 4] - srcData[((y - 1) * srcW + (x)) * 4])
        gradMap[idx] = Math.sqrt(gx * gx + gy * gy)
      }

    // Lanczos-like interpolation for larger upscales
    const lanczosWeight = (t, a = 3) => {
      if (t === 0) return 1
      if (Math.abs(t) >= a || Math.abs(t) < 1e-10) return 0
      const pt = Math.PI * t
      return a * Math.sin(pt) * Math.sin(pt / a) / (pt * pt)
    }

    for (let ty = 0; ty < dstH; ty++) {
      for (let tx = 0; tx < dstW; tx++) {
        const fx = (tx + 0.5) * sx - 0.5
        const fy = (ty + 0.5) * sy - 0.5
        const ix = Math.floor(fx), iy = Math.floor(fy)
        const oidx = (ty * dstW + tx) * 4

        // Use Lanczos for better quality
        const a = 2
        for (let c = 0; c < 3; c++) {
          let sum = 0, wsum = 0
          for (let dy = -a + 1; dy <= a; dy++) {
            for (let dx = -a + 1; dx <= a; dx++) {
              const sx2 = ix + dx, sy2 = iy + dy
              if (sx2 < 0 || sx2 >= srcW || sy2 < 0 || sy2 >= srcH) continue
              const w = lanczosWeight(fx - sx2) * lanczosWeight(fy - sy2)
              sum += srcData[(sy2 * srcW + sx2) * 4 + c] * w
              wsum += w
            }
          }
          if (wsum > 0) {
            output[oidx + c] = Math.max(0, Math.min(255, Math.round(sum / wsum)))
          } else {
            // Fallback: nearest neighbor for edge pixels
            const nx = Math.max(0, Math.min(srcW - 1, Math.round(fx)))
            const ny = Math.max(0, Math.min(srcH - 1, Math.round(fy)))
            output[oidx + c] = srcData[(ny * srcW + nx) * 4 + c]
          }
        }
        output[oidx + 3] = 255
      }
    }
    return new ImageData(output, dstW, dstH)
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
        output[idx + 3] = 255
      }
    }
    return new ImageData(output, width, height)
  }

  // --- 双边滤波降噪（去 JPEG 伪影，保留边缘）---
  const bilateralFilter = (imageData, sigmaS = 1.5, sigmaR = 35) => {
    const { data, width, height } = imageData
    const output = new Uint8ClampedArray(data)
    const half = 2 // 5x5 邻域
    const spatialW = []
    for (let dy = -half; dy <= half; dy++)
      for (let dx = -half; dx <= half; dx++)
        spatialW.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS)))

    for (let y = half; y < height - half; y++) {
      for (let x = half; x < width - half; x++) {
        const ci = (y * width + x) * 4
        for (let c = 0; c < 3; c++) {
          const centerVal = data[ci + c]
          let tw = 0, total = 0, wi = 0
          for (let dy = -half; dy <= half; dy++) {
            for (let dx = -half; dx <= half; dx++) {
              const pv = data[((y + dy) * width + (x + dx)) * 4 + c]
              const iw = Math.exp(-(pv - centerVal) * (pv - centerVal) / (2 * sigmaR * sigmaR))
              const w = spatialW[wi] * iw
              total += pv * w; tw += w; wi++
            }
          }
          output[ci + c] = Math.max(0, Math.min(255, Math.round(total / tw)))
        }
      }
    }
    return new ImageData(output, width, height)
  }

  // --- 自适应锐化（边缘加强，平滑区不动）---
  const adaptiveSharpen = (imageData, strength = 0.6) => {
    const { data, width, height } = imageData
    const output = new Uint8ClampedArray(data)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4
        for (let c = 0; c < 3; c++) {
          // 计算 3x3 局部方差
          const vals = []
          for (let ky = -1; ky <= 1; ky++)
            for (let kx = -1; kx <= 1; kx++)
              vals.push(data[((y + ky) * width + (x + kx)) * 4 + c])
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length
          const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length
          const edgeFactor = Math.min(1, variance / 2000)
          const center = data[idx + c]
          const sum = vals.reduce((a, b) => a + b, 0) - center
          const blur = sum / (vals.length - 1)
          output[idx + c] = Math.max(0, Math.min(255, center + edgeFactor * strength * (center - blur)))
        }
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

  // --- 单图处理 ---
    const handleProcess = useCallback(async () => {
      if (!preview || !origDims) return
      if (processEstimate?.blockReason) {
        setError(processEstimate.blockReason)
        return
      }
      setProcessing(true)
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
        const { targetW, targetH } = calcTargetDimensions(origDims.w, origDims.h, scaleMode, scale, targetDims, keepRatio, format)
        setProcessStage(aiUpscale ? '加载 AI 模型' : '解析图片')
        await ensureAiModel()
        setProgress(20)
        setProcessStage('放大图片')
        const res = await processImageWithCanvas(preview, targetW, targetH, { smartSharpen, aiUpscale, reduceArtifacts, deblur, autoLevels, vibrance, clahe, smartDenoise, edgeInterpolation, antiAlias }, format)
        setProgress(95)
        setProcessStage('导出结果')
        await new Promise(r => setTimeout(r, 100))
        setResult(res.dataUrl)
      setResultDims({ w: res.width, h: res.height })
      const sizeKB = res.size < 1024 * 1024
        ? (res.size / 1024).toFixed(1) + ' KB'
        : (res.size / (1024 * 1024)).toFixed(1) + ' MB'
      setResultSize(sizeKB)
        setProgress(100)
        setProcessStage('完成')
      } catch (err) {
        setError(getProcessErrorMessage(err))
        setProgress(0)
        setProcessStage('')
    } finally {
      clearInterval(timer)
      setProcessing(false)
    }
    }, [preview, origDims, processEstimate, scaleMode, scale, targetDims, keepRatio, format, smartSharpen, sharpenAmount, aiUpscale, reduceArtifacts, deblur, autoLevels, vibrance, clahe, smartDenoise, edgeInterpolation, antiAlias, ensureAiModel, getProcessErrorMessage])

  // --- 批量处理 ---
  const handleBatchProcess = useCallback(async () => {
    const pending = batchItems.filter(it => it.status === 'pending' && it.preview && it.origDims)
    if (pending.length === 0) return

    setBatchProcessing(true)
      setBatchItems(prev => prev.map(it => it.status === 'pending' && it.preview && it.origDims
        ? { ...it, status: 'pending', progress: 0, result: null, resultBlob: null, resultDims: null, resultSize: null, error: null, stage: '' }
        : it
      ))

    batchCancelRef.current = false
    for (const item of pending) {
      if (batchCancelRef.current) break
        setBatchItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'processing', progress: 0, stage: '准备处理' } : it))

      let p = 0
      const tick = () => {
        if (p < 30) p += 5
        else if (p < 70) p += 3
        else if (p < 90) p += 1
        p = Math.min(p, 91)
        setBatchItems(prev => prev.map(it => it.id === item.id ? { ...it, progress: p } : it))
      }
      const timer = setInterval(tick, 200)

      try {
          const { targetW, targetH } = calcTargetDimensions(
            item.origDims.w, item.origDims.h, scaleMode, scale, targetDims, keepRatio, format
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
          const res = await processImageWithCanvas(item.preview, targetW, targetH, { smartSharpen, aiUpscale, reduceArtifacts, deblur, autoLevels, vibrance, clahe, smartDenoise, edgeInterpolation, antiAlias }, format)
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
            stage: '完成'
          } : it))
        } catch (err) {
          clearInterval(timer)
          setBatchItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'error', progress: 0, error: getProcessErrorMessage(err), stage: '' } : it))
        }
    }

    batchCancelRef.current = false
    setBatchProcessing(false)
  }, [batchItems, scaleMode, scale, targetDims, keepRatio, format, smartSharpen, aiUpscale, reduceArtifacts, deblur, autoLevels, vibrance, clahe, smartDenoise, edgeInterpolation, antiAlias, ensureAiModel, getProcessErrorMessage])

  // --- 单图下载 ---
  const handleDownload = () => {
    if (!result) return
    const a = document.createElement('a')
    const ext = format === "jpeg" ? "jpg" : format === "webp" ? "webp" : "png"
    const name = file ? file.name.replace(/\.[^.]+$/, '') : 'image'
    a.download = `${name}_${resultDims ? resultDims.w + 'x' + resultDims.h : 'result'}.${ext}`
    a.href = result; a.click()
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
  }

  // --- 批量下载全部为 ZIP ---
  const downloadAllAsZip = useCallback(async () => {
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
    } catch(e) { alert('下载失败: ' + e.message) }
  }, [batchItems, format])

  // --- 计算活跃状态 ---
 const pendingCount = batchItems.filter(it => it.status === 'pending' && it.preview && it.origDims).length
 const doneCount = batchItems.filter(it => it.status === 'done').length
  pendingCountRef.current = pendingCount
  doneCountRef.current = doneCount
  keyRefs.current = { batchMode, preview, processing, result, batchProcessing, handleBatchProcess, handleProcess, downloadAllAsZip, handleDownload }

 return (
    <div className="min-h-screen bg-gray-50/80">
      <header className="bg-white/95 backdrop-blur-sm border-b border-gray-100 px-6 py-3 flex items-center gap-2.5 sticky top-0 z-10 shadow-sm">
        <img src="/logo.png" alt="TU Scale" className="h-12 w-auto shrink-0" />
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold tracking-tight" style={{ color: '#8040f0' }}>TU Scale</h1>
            <span className="text-[11px] hidden sm:block truncate leading-none" style={{ color: '#7c3aed' }}>图片放大工具</span>
          </div>
          <span className="text-[10px] text-gray-400 leading-none">高清放大&middot;智能锐化&middot;支持 4K/8K</span>
        </div>
        {/* 批量/单图切换 */}
        <button
            onClick={() => { setBatchMode(!batchMode); clearAllBatch(); setFile(null); setPreview(null); setOrigDims(null); setResult(null); setResultDims(null); setResultSize(null); setProcessStage(''); setError(null) }}
          className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors shrink-0 ${
            batchMode
              ? 'bg-indigo-50 border-indigo-500 text-indigo-700'
              : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
          }`}
        >
          {batchMode ? '\u{1F4E6} 批量模式' : '\u{1F5BC} 单图模式'}
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 pb-24 space-y-6">

        {/* ==================== 上传区 ==================== */}
        <section
          className={`bg-white rounded-xl border-2 border-dashed p-10 text-center transition-all ${
            batchMode ? 'border-purple-200 hover:border-purple-300 hover:bg-purple-50/50' : 'cursor-pointer'
          } ${
            dragOver ? 'border-indigo-500 bg-indigo-50/60' : ''
          }`}
          onClick={() => { if (!batchMode) fileRef.current?.click(); }}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
        >
          <input ref={fileRef} type="file" accept="image/*,.avif,.heic,.heif" multiple={batchMode} className="hidden"
            onChange={handleFileInputChange} />
          <input ref={folderRef} type="file" className="hidden"
            onChange={handleFolderUpload} />

          {batchMode ? (
            // --- 批量上传区 ---
            batchItems.length === 0 ? (
              <div className="text-gray-400 py-4">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-50 to-indigo-50 flex items-center justify-center border border-purple-100/50">
                  <FolderOpen className="w-8 h-8 text-purple-400" />
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
                <p className="text-xs mt-1 text-gray-400">支持 JPG &middot; PNG &middot; WebP</p>
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

        {/* ==================== 控制区 ==================== */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
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

              {!batchMode && origDims && maxScale < 20 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs leading-relaxed">
                  <p className="text-amber-700">{'\u5f53\u524d\u56fe\u7247'} {origDims.w}&times;{origDims.h}px{'\uff0c\u957f\u8fb9\u4e0a\u9650'} 10000px</p>
                  <p className="text-amber-600">{'\u6709\u6548\u6700\u5927\u500d\u6570\u4e3a'} <strong>{maxScale}x</strong>{'\uff0c\u8d85\u8fc7\u5c06\u81ea\u52a8\u622a\u65ad'}</p>
                </div>
              )}
                {!batchMode && expectedOutput && expectedOutput.capped && (
                  <p className="text-xs text-amber-600">* {'\u5df2\u8d85\u8fc7\u4e0a\u9650\uff0c\u5b9e\u9645\u8f93\u51fa\u4f1a\u6309'} 10000px {'\u957f\u8fb9\u88c1\u5207'}</p>
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
                  className={`px-4 py-2 rounded-lg text-xs font-medium border ${targetMode === 'preset' ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>{'\u9884\u8bbe\u5206\u8fa8\u7387'}</button>
                <button onClick={() => setTargetMode('custom')}
                  className={`px-4 py-2 rounded-lg text-xs font-medium border ${targetMode === 'custom' ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>{'\u81ea\u5b9a\u4e49'}</button>
              </div>
              {targetMode === 'preset' ? (
                <div className="grid grid-cols-2 gap-2">
                  {TARGET_PRESETS.map((opt, i) => (
                    <button key={i} onClick={() => setTargetIdx(i)}
                      className={`py-3 px-4 rounded-lg text-sm border text-left ${targetIdx === i ? 'bg-indigo-50 border-indigo-500' : 'border-gray-200'}`}>
                      <div className={`font-bold ${targetIdx === i ? 'text-indigo-700' : 'text-gray-700'}`}>{opt.label}</div>
                      <div className={`text-xs ${targetIdx === i ? 'text-indigo-500' : 'text-gray-400'}`}>
                        {keepRatio ? `${opt.w}\u00d7${opt.h}\uff08\u6700\u5927\uff09` : `${opt.w}\u00d7${opt.h}`} &middot; {opt.ratio}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">{'\u5bbd\u5ea6'} (px)</label>
                    <input type="number" min="1" max="10000" value={customW}
                      onChange={(e) => setCustomW(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
                  </div>
                  <div className="text-gray-400 pb-2 font-mono">&times;</div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">{'\u9ad8\u5ea6'} (px)</label>
                    <input type="number" min="1" max="10000" value={customH}
                      onChange={(e) => setCustomH(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
                  </div>
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
                  {[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WEBP' }].map((opt) => (
                    <button key={opt.value}
                      onClick={() => setFormat(opt.value)}
                      className={`px-3 py-1 rounded-md text-xs font-medium border ${
                        format === opt.value
                          ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}>{opt.label}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                  <input type="checkbox" checked={keepRatio}
                    onChange={(e) => setKeepRatio(e.target.checked)}
                    className="w-3 h-3 rounded border-gray-300 text-indigo-500" />
                {'\u4fdd\u6301\u6bd4\u4f8b'}
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
              </div>

              <div className="border-t border-gray-100 pt-3">
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
                      onChange={(e) => setAiUpscale(e.target.checked)}
                      className="w-3 h-3 rounded border-gray-300 text-indigo-500" />
                    AI{'\u653e\u5927'}
                    <span className="text-[9px] text-gray-300 ml-0.5">(beta)</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                    <input type="checkbox" checked={antiAlias}
                      onChange={(e) => setAntiAlias(e.target.checked)}
                      className="w-3 h-3 rounded border-gray-300 text-indigo-500" />
                    {'\u6297\u952f\u9f7f'}
                  </label>
                </div>
                  {aiUpscale && (
                    <p className="mt-2 text-[11px] leading-5 text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      {aiModelLoading
                        ? '正在加载 AI 模型，首次使用可能需要数秒。'
                        : aiModelReady
                          ? 'AI 模型已就绪，处理大图时会占用更多浏览器内存。'
                          : '首次使用会下载 AI 模型，处理过程完全在浏览器端完成。'}
                    </p>
                  )}
                  {!batchMode && processEstimate?.blockReason && (
                    <p className="mt-2 text-[11px] leading-5 text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      {processEstimate.blockReason}
                    </p>
                  )}
                </div>
            </div>
          </div>
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
                    <div className="text-[11px] text-indigo-600 font-medium">{processStage || '准备处理'}</div>
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
        {!batchMode && result && origDims && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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
                  <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{'\u539f\u56fe'}</span>
                  <span className="text-[10px] text-gray-400">{origDims.w}&times;{origDims.h}px</span>
                </div>
                <div ref={leftScrollRef}
                  onScroll={() => { if (syncingRef.current || !syncedScroll) return; syncingRef.current = true; const s = leftScrollRef.current, t = rightScrollRef.current; if (s && t) { const pctX = s.scrollWidth > s.clientWidth ? s.scrollLeft / (s.scrollWidth - s.clientWidth) : 0; const pctY = s.scrollHeight > s.clientHeight ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0; if (t.scrollWidth > t.clientWidth) t.scrollLeft = pctX * (t.scrollWidth - t.clientWidth); if (t.scrollHeight > t.clientHeight) t.scrollTop = pctY * (t.scrollHeight - t.clientHeight); } requestAnimationFrame(() => { syncingRef.current = false; }); }}
                  className="overflow-auto max-h-72 bg-gray-50 rounded-lg border border-gray-100 cursor-pointer hover:border-indigo-200 transition-colors"
                  onClick={() => { setModalMode('compare'); setShowModal(true); }}>
                  <img src={preview} alt="\u539f\u56fe" style={{ transform: `scale(${compareZoom})`, transformOrigin: 'top left', minWidth: '100%' }} className="block" />
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
          </div>
        )}

        {/* ==================== 单图 - 结果区 ==================== */}
        {!batchMode && result && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">{'\u5904\u7406\u7ed3\u679c'}</h2>
              <div className="text-xs text-gray-500 text-right">
                <div>{origDims.w}&times;{origDims.h} &rarr; <strong className="text-indigo-600">{resultDims.w}&times;{resultDims.h}</strong></div>
                <div className="text-gray-400">{(resultDims.w / origDims.w).toFixed(1)}x &middot; {resultSize}</div>
              </div>
            </div>
            <div className="rounded-xl overflow-hidden bg-gray-50 border border-gray-100">
              <img src={result} alt="\u653e\u5927\u7ed3\u679c" className="w-full h-auto max-h-96 object-contain mx-auto cursor-pointer"
                onClick={() => { setModalMode('single'); setShowModal(true); setImgZoom(1); setImgPan({x:0,y:0}); }} />
            </div>
            <button onClick={handleDownload}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
              <Download className="w-4 h-4" /> {'\u4e0b\u8f7d'}
            </button>
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
              <button onClick={downloadAllAsZip}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors text-xs font-medium">
                <FileDown className="w-3.5 h-3.5" /> {'\u5168\u90e8\u4e0b\u8f7d'} (ZIP)
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {batchItems.filter(it => it.status === 'done').map((item) => (
                <div key={item.id} className="bg-gray-50 rounded-xl border border-green-200 overflow-hidden group">
                  <div className="aspect-square bg-gray-100 relative">
                    <img src={item.result} alt={item.file.name} className="w-full h-full object-cover" />
                    <button onClick={() => downloadSingleResult(item)}
                      className="absolute bottom-2 right-2 w-8 h-8 bg-white/90 hover:bg-white shadow-sm border border-gray-200 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-indigo-600 hover:text-indigo-700">
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
          </div>
        )}

        {/* 说明 */}
        <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 text-xs text-blue-800 leading-relaxed">
          <ul className="list-disc list-inside space-y-1">
            <li><strong>{'\u591a\u7ea7\u653e\u5927'}</strong>{'\uff1a\u5927\u500d\u6570\u65f6\u81ea\u52a8\u5206\u9636\u6bb5\u653e\u5927\uff0c\u6bcf\u7ea7\u4e2d\u95f4\u505a\u9510\u5316'}</li>
            <li><strong>{'\u589e\u5f3a\u753b\u8d28'}</strong>{'\uff1a\u9ad8\u8d28\u91cf\u91cd\u91c7\u6837 + \u667a\u80fd\u9510\u5316'}</li>
            <li>{'\u6ce8\u610f\uff1a\u653e\u5927\u7b97\u6cd5\u65e0\u6cd5\u51ed\u7a7a\u589e\u52a0\u7ec6\u8282\uff0c\u539f\u56fe\u8d28\u91cf\u8d8a\u597d\uff0c\u653e\u5927\u6548\u679c\u8d8a\u4f73'}</li>
            <li>{'\u957f\u8fb9\u50cf\u7d20\u4e0a\u9650'} <strong>10000px</strong>{'\uff0c\u8d85\u8fc7\u4f1a\u81ea\u52a8\u88c1\u5207'}</li>
            <li>{'\u6279\u91cf\u653e\u5927\u65f6\u6240\u6709\u56fe\u7247\u4f7f\u7528\u540c\u4e00\u53c2\u6570\u8bbe\u7f6e\uff0c\u6309\u987a\u5e8f\u9010\u4e00\u5904\u7406'}</li>
            <li>{'\u6279\u91cf\u6a21\u5f0f\u4e0b\u53ef\u4ee5\u9009\u62e9\u6587\u4ef6\u5939\u4e0a\u4f20\uff0c\u81ea\u52a8\u8fc7\u6ee4\u56fe\u7247\u6587\u4ef6'}</li>
            <li>{'\u9ed8\u8ba4\u5728\u6d4f\u89c8\u5668\u672c\u5730\u5904\u7406\u56fe\u7247\uff0c\u65e0\u9700\u767b\u5f55\uff0c\u4e0d\u4f1a\u628a\u56fe\u7247\u4e0a\u4f20\u5230 TU Scale \u670d\u52a1\u5668'}</li>
          </ul>
        </div>

        <section className="space-y-5 text-gray-700">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900">{'\u514d\u8d39\u5728\u7ebf\u56fe\u7247\u653e\u5927\u5de5\u5177'}</h2>
            <p className="text-sm leading-7">
              TU Scale {'\u662f\u4e00\u4e2a\u6d4f\u89c8\u5668\u7aef\u7684\u56fe\u7247\u653e\u5927\u5de5\u5177\uff0c\u53ef\u4ee5\u5c06 JPG\u3001PNG \u548c WebP \u56fe\u7247\u6309\u500d\u6570\u653e\u5927\uff0c\u4e5f\u53ef\u4ee5\u8f93\u51fa Full HD\u30012K\u30014K \u6216 8K \u7b49\u76ee\u6807\u5206\u8fa8\u7387\u3002\u5b83\u9002\u5408\u5904\u7406\u7535\u5546\u4e3b\u56fe\u3001\u4ea7\u54c1\u56fe\u3001\u5934\u50cf\u3001\u63d2\u753b\u3001\u8001\u7167\u7247\u548c\u9700\u8981\u63d0\u5347\u6e05\u6670\u5ea6\u7684\u7f51\u7ad9\u914d\u56fe\u3002'}
            </p>
            <p className="text-sm leading-7">
              {'\u5de5\u5177\u652f\u6301\u667a\u80fd\u9510\u5316\u3001\u81ea\u52a8\u8272\u9636\u3001\u81ea\u7136\u9971\u548c\u5ea6\u3001\u6297\u952f\u9f7f\u548c AI \u56fe\u7247\u653e\u5927\u3002\u5982\u679c\u9700\u8981\u4e00\u6b21\u5904\u7406\u591a\u5f20\u56fe\u7247\uff0c\u4e5f\u53ef\u4ee5\u4f7f\u7528\u6279\u91cf\u56fe\u7247\u653e\u5927\u6a21\u5f0f\uff0c\u6309\u540c\u4e00\u7ec4\u53c2\u6570\u987a\u5e8f\u751f\u6210\u9ad8\u6e05\u56fe\u7247\u3002'}
            </p>
            <p className="text-sm leading-7">
              {'\u4e3a\u4e86\u4fdd\u62a4\u9690\u79c1\uff0cTU Scale \u9ed8\u8ba4\u5728\u6d4f\u89c8\u5668\u672c\u5730\u5b8c\u6210\u56fe\u7247\u653e\u5927\u3001\u9510\u5316\u548c\u683c\u5f0f\u8f6c\u6362\u3002\u4f60\u9009\u62e9\u7684\u56fe\u7247\u4e0d\u4f1a\u88ab\u4e0a\u4f20\u5230 TU Scale \u670d\u52a1\u5668\uff0c\u9002\u5408\u5904\u7406\u9700\u8981\u66f4\u5b89\u5fc3\u4fdd\u5b58\u7684\u4e2a\u4eba\u7167\u7247\u548c\u5546\u54c1\u56fe\u7247\u3002'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="border border-gray-200 rounded-xl p-4 bg-white">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{'\u6d4f\u89c8\u5668\u7aef\u5904\u7406'}</h3>
              <p className="text-xs leading-6 text-gray-500">{'\u56fe\u7247\u653e\u5927\u548c\u753b\u8d28\u589e\u5f3a\u4e3b\u8981\u5728\u672c\u673a\u6d4f\u89c8\u5668\u4e2d\u5b8c\u6210\uff0c\u65e5\u5e38\u4f7f\u7528\u65e0\u9700\u767b\u5f55\u3002'}</p>
            </div>
            <div className="border border-gray-200 rounded-xl p-4 bg-white">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{'\u652f\u6301 4K/8K'}</h3>
              <p className="text-xs leading-6 text-gray-500">{'\u53ef\u6309\u653e\u5927\u500d\u6570\u6216\u76ee\u6807\u5206\u8fa8\u7387\u8f93\u51fa\uff0c\u957f\u8fb9\u50cf\u7d20\u4e0a\u9650\u4e3a 10000px\u3002'}</p>
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

      <footer className="text-center py-6 text-xs text-gray-400 border-t border-gray-100 mt-8">TU Scale&middot;{'\u56fe\u7247\u653e\u5927\u5de5\u5177'} &middot; {'\u57fa\u4e8e'} Sharp {'\u5f15\u64ce'}</footer>

      {/* 猫爪打赏按钮 */}
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 flex flex-col items-end">
        {showDonateTooltip && (
          <div className="mb-2.5 px-4 py-2 bg-white rounded-xl shadow-lg border border-gray-100 text-sm text-gray-700 whitespace-nowrap relative animate-fade-in">
            {'\u8bf7\u4f5c\u8005\u7684\u732b\u732b\u5403\u7f50\u7f50'} 🐱
            <div className="absolute -bottom-1 right-6 w-3 h-3 bg-white border-r border-b border-gray-100 transform rotate-45" />
          </div>
        )}
        <img src="/paw-icon.png" alt="打赏"
          onClick={() => setShowRewardModal(true)}
          onMouseEnter={() => setShowDonateTooltip(true)}
          onMouseLeave={() => setShowDonateTooltip(false)}
          className="w-11 h-11 sm:w-[52px] sm:h-[52px] cursor-pointer shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 active:scale-95" />
      </div>

      {/* 微信赞赏码弹窗 */}
      {showRewardModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
          onClick={() => setShowRewardModal(false)}>
          <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-[300px] w-full mx-4 relative animate-fade-in"
            onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowRewardModal(false)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full shadow-md border border-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors">
              <X className="w-4 h-4" />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-700 mb-3">{'\u626b\u4e00\u626b\uff0c\u8bf7\u732b\u732b\u5403\u7f50\u7f50'} 🐱</p>
              <img src="/wechat-reward.png" alt="\u5fae\u4fe1\u8d5e\u8d4f\u7801" className="w-48 h-48 mx-auto rounded-lg" />
              <p className="text-xs text-gray-400 mt-3">{'\u611f\u8c22\u60a8\u7684\u652f\u6301'} ❤️</p>
            </div>
          </div>
        </div>
      )}

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
      {showModal && modalMode === 'compare' && result && origDims && (
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
                <span className="text-[10px] font-semibold text-white/60 bg-white/10 px-2 py-0.5 rounded">{'\u539f\u56fe'}</span>
                <span className="text-[10px] text-white/40">{origDims.w}&times;{origDims.h}px</span>
              </div>
              <div ref={fsLeftScrollRef}
                onScroll={() => { if (fsSyncingRef.current || !syncedScroll) return; fsSyncingRef.current = true; const s = fsLeftScrollRef.current, t = fsRightScrollRef.current; if (s && t) { const pctX = s.scrollWidth > s.clientWidth ? s.scrollLeft / (s.scrollWidth - s.clientWidth) : 0; const pctY = s.scrollHeight > s.clientHeight ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0; if (t.scrollWidth > t.clientWidth) t.scrollLeft = pctX * (t.scrollWidth - t.clientWidth); if (t.scrollHeight > t.clientHeight) t.scrollTop = pctY * (t.scrollHeight - t.clientHeight); } requestAnimationFrame(() => { fsSyncingRef.current = false; }); }}
                className="flex-1 overflow-auto bg-black/20">
                <img src={preview} alt="\u539f\u56fe" style={{ transform: `scale(${compareZoom})`, transformOrigin: 'top left' }} className="block" />
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
