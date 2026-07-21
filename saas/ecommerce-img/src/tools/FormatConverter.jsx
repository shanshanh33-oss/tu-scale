import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle, Copy, Download, FileDown, FolderOpen, Image as ImageIcon, Loader2, Move, RefreshCw, SlidersHorizontal, Upload, X } from 'lucide-react'
import JSZip from 'jszip'
import { canvasToBlob, downloadBlob, formatBytes, getBaseName, readImage, revokeObjectUrl, trackEvent } from './shared'
import { decodeInputImage, getInputDecodeErrorMessage } from './heic'
import RewardButton from './RewardButton'

const OUTPUTS = [
  { id: 'jpeg', label: 'JPG', mime: 'image/jpeg', ext: 'jpg', quality: true, note: '照片、报名照和证件照常用，体积小，不保留透明背景。' },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', quality: true, note: '适合网页和社媒配图，画质与体积平衡好。' },
  { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png', quality: false, note: '适合截图、图标和透明背景，体积通常更大。' },
  { id: 'avif', label: 'AVIF', mime: 'image/avif', ext: 'avif', quality: true, note: '压缩率高，但部分平台兼容性较弱。' },
]

const SIZE_PRESETS = [
  { id: 'original', label: '保持原尺寸', w: null, h: null, desc: '只压缩体积' },
  { id: 'long-1920', label: '网页大图', edge: 1920, desc: '最长边 1920px' },
  { id: 'long-1280', label: '社媒分享', edge: 1280, desc: '最长边 1280px' },
  { id: 'long-800', label: '小图快传', edge: 800, desc: '最长边 800px' },
  { id: 'one-inch', label: '一寸照', w: 295, h: 413, desc: '常见 1 寸电子照' },
  { id: 'two-inch', label: '二寸照', w: 413, h: 626, desc: '常见 2 寸电子照' },
  { id: 'cn-passport', label: '中国护照/出入境', w: 354, h: 472, desc: '常见 33x48mm 参考像素' },
  { id: 'exam', label: '报名照', w: 295, h: 413, desc: '考试报名常用比例' },
  { id: 'us-visa', label: '美国签证', w: 600, h: 600, desc: '方形 600x600px' },
  { id: 'square', label: '头像方图', w: 800, h: 800, desc: '头像/店铺图' },
  { id: 'custom', label: '自定义尺寸', w: null, h: null, desc: '手动输入宽高' },
]

const TARGET_SIZE_OPTIONS = [
  { label: '不限制', value: 0 },
  { label: '100 KB', value: 100 },
  { label: '200 KB', value: 200 },
  { label: '500 KB', value: 500 },
  { label: '1 MB', value: 1024 },
  { label: '自定义', value: -1 },
]

const COMPRESS_FAQ = [
  ['图片会上传服务器吗？', '不会。压缩、改尺寸、裁切和导出都在浏览器本地完成。'],
  ['目标 KB 一定能压到吗？', 'JPG/WebP/AVIF 会自动尝试降低质量；如果尺寸太大或 PNG 不适合压缩，可能需要调小尺寸或换 JPG/WebP。'],
  ['证件照预设可以直接用于办理吗？', '预设是常见规格参考，不同地区、年份和报名系统要求会变化，提交前仍要以办理页面的说明为准。'],
  ['证件照背景可以自动更换吗？', '当前免费本地工具不提供自动换背景，复杂头发边缘更适合使用专业抠图或付费 API。'],
]

let compressorId = 0
const createExportId = () => crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const getPreset = (id) => SIZE_PRESETS.find(item => item.id === id) || SIZE_PRESETS[0]

const getTargetSize = (preset, customW, customH, sourceW, sourceH) => {
  if (!sourceW || !sourceH) return { w: 0, h: 0 }
  if (preset.id === 'custom') return { w: Math.max(1, customW || sourceW), h: Math.max(1, customH || sourceH) }
  if (preset.w && preset.h) return { w: preset.w, h: preset.h }
  if (preset.edge) {
    const ratio = Math.min(1, preset.edge / Math.max(sourceW, sourceH))
    return { w: Math.max(1, Math.round(sourceW * ratio)), h: Math.max(1, Math.round(sourceH * ratio)) }
  }
  return { w: sourceW, h: sourceH }
}

const getDefaultCropRect = (sourceW, sourceH, targetW, targetH) => {
  if (!sourceW || !sourceH || !targetW || !targetH) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
  const targetRatio = targetW / targetH
  const imageRatio = sourceW / sourceH
  if (imageRatio > targetRatio) {
    const w = clamp((sourceH * targetRatio) / sourceW, 0.08, 1)
    return { x: (1 - w) / 2, y: 0, w, h: 1 }
  }
  const h = clamp(sourceW / targetRatio / sourceH, 0.08, 1)
  return { x: 0, y: (1 - h) / 2, w: 1, h }
}

const normalizeCropRect = (rect, ratio = null) => {
  let next = {
    x: clamp(rect.x, 0, 0.98),
    y: clamp(rect.y, 0, 0.98),
    w: clamp(rect.w, 0.02, 1),
    h: clamp(rect.h, 0.02, 1),
  }
  if (ratio) {
    if (next.w / next.h > ratio) next.w = next.h * ratio
    else next.h = next.w / ratio
  }
  if (next.x + next.w > 1) next.x = 1 - next.w
  if (next.y + next.h > 1) next.y = 1 - next.h
  return next
}

export default function FormatConverter({ navigate }) {
  const fileRef = useRef(null)
  const folderRef = useRef(null)
  const editorRef = useRef(null)
  const dragRef = useRef(null)
  const zipExportRef = useRef({ signature: '', id: '' })
  const zipDownloadLockRef = useRef(false)
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [format, setFormat] = useState('jpeg')
  const [quality, setQuality] = useState(86)
  const [sizePreset, setSizePreset] = useState('long-1280')
  const [customW, setCustomW] = useState(800)
  const [customH, setCustomH] = useState(800)
  const [targetSizeMode, setTargetSizeMode] = useState(200)
  const [customTargetKb, setCustomTargetKb] = useState(300)
  const [cropEnabled, setCropEnabled] = useState(false)
  const [faceGuide, setFaceGuide] = useState(false)
  const [cropPreview, setCropPreview] = useState('')
  const [processing, setProcessing] = useState(false)
  const [zipDownloading, setZipDownloading] = useState(false)
  const [message, setMessage] = useState('')
  const [shareNotice, setShareNotice] = useState('')

  const output = useMemo(() => OUTPUTS.find(item => item.id === format) || OUTPUTS[0], [format])
  const preset = useMemo(() => getPreset(sizePreset), [sizePreset])
  const selected = items.find(item => item.id === selectedId) || items[0]
  const doneItems = items.filter(item => item.status === 'done' && item.blob)
  const targetKb = targetSizeMode === -1 ? customTargetKb : targetSizeMode
  const selectedTarget = selected ? getTargetSize(preset, customW, customH, selected.width, selected.height) : null
  const targetRatio = selectedTarget?.w && selectedTarget?.h ? selectedTarget.w / selectedTarget.h : null
  const cropBoxRatio = selected?.width && selected?.height && targetRatio ? targetRatio / (selected.width / selected.height) : null
  const cropFrameWidth = targetRatio ? Math.round(targetRatio >= 1 ? 520 : 360) : 360
  const faceGuideStyle = {
    width: targetRatio && targetRatio >= 0.95 ? '38%' : '50%',
    aspectRatio: '0.76 / 1',
    top: targetRatio && targetRatio >= 0.95 ? '18%' : '13%',
    left: '50%',
    transform: 'translateX(-50%)',
  }
  const cropZoom = selected?.width && selected?.height && selectedTarget?.w && selectedTarget?.h && selected.crop?.w
    ? Math.round(clamp((getDefaultCropRect(selected.width, selected.height, selectedTarget.w, selectedTarget.h).w / selected.crop.w) * 100, 100, 260))
    : 100

  useEffect(() => {
    if (folderRef.current) folderRef.current.setAttribute('webkitdirectory', '')
  }, [])

  useEffect(() => {
    if (!selectedId || !targetRatio) return
    setItems(prev => prev.map(item => {
      if (item.id !== selectedId) return item
      if (!item.cropTouched) return { ...item, crop: getDefaultCropRect(item.width, item.height, selectedTarget.w, selectedTarget.h) }
      const itemCropRatio = targetRatio / (item.width / item.height)
      return { ...item, crop: normalizeCropRect(item.crop, itemCropRatio) }
    }))
  }, [selectedId, targetRatio, selectedTarget?.w, selectedTarget?.h])

  useEffect(() => {
    if (!selected?.preview || !cropEnabled || !selectedTarget?.w || !selectedTarget?.h) {
      setCropPreview('')
      return
    }

    let cancelled = false
    const renderPreview = async () => {
      try {
        const img = await readImage(selected.preview)
        const previewCanvas = document.createElement('canvas')
        previewCanvas.width = selectedTarget.w
        previewCanvas.height = selectedTarget.h
        const previewCtx = previewCanvas.getContext('2d')
        const sourceX = Math.round(img.width * selected.crop.x)
        const sourceY = Math.round(img.height * selected.crop.y)
        const sourceW = Math.max(1, Math.round(img.width * selected.crop.w))
        const sourceH = Math.max(1, Math.round(img.height * selected.crop.h))
        previewCtx.fillStyle = '#ffffff'
        previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height)
        previewCtx.imageSmoothingEnabled = true
        previewCtx.imageSmoothingQuality = 'high'
        previewCtx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, previewCanvas.width, previewCanvas.height)
        if (!cancelled) setCropPreview(previewCanvas.toDataURL('image/jpeg', 0.86))
      } catch {
        if (!cancelled) setCropPreview('')
      }
    }
    renderPreview()
    return () => { cancelled = true }
  }, [selected?.preview, selected?.crop, selectedTarget?.w, selectedTarget?.h, cropEnabled])

  const addFiles = useCallback(async (fileList) => {
    const imageFiles = Array.from(fileList || []).filter(file => file.type.startsWith('image/') || /\.(jpg|jpeg|jfif|png|webp|gif|bmp|svg|avif|ico|heic|heif|tif|tiff)$/i.test(file.name))
    if (imageFiles.length === 0) return
    trackEvent('image_uploaded', { tool: 'converter', mode: 'compressor', count: imageFiles.length })

    const incoming = imageFiles.map(file => ({
      id: ++compressorId,
      file,
      preview: null,
      width: 0,
      height: 0,
      crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      cropTouched: false,
      status: 'loading',
      error: '',
      blob: null,
      url: null,
      size: 0,
      outputWidth: 0,
      outputHeight: 0,
    }))
    setItems(prev => [...prev, ...incoming])
    setSelectedId(prev => prev || incoming[0]?.id)
    setMessage('')

    for (const item of incoming) {
      try {
        const decoded = await decodeInputImage(item.file)
        const target = getTargetSize(preset, customW, customH, decoded.width, decoded.height)
        setItems(prev => prev.map(current => current.id === item.id
          ? { ...current, preview: decoded.preview, width: decoded.width, height: decoded.height, crop: getDefaultCropRect(decoded.width, decoded.height, target.w, target.h), status: 'ready' }
          : current
        ))
      } catch (decodeError) {
        setItems(prev => prev.map(current => current.id === item.id
          ? { ...current, status: 'error', error: getInputDecodeErrorMessage(decodeError) }
          : current
        ))
      }
    }
  }, [customH, customW, preset])

  const removeItem = (id) => {
    setItems(prev => {
      const target = prev.find(item => item.id === id)
      if (target) revokeObjectUrl(target.url)
      const next = prev.filter(item => item.id !== id)
      if (id === selectedId) setSelectedId(next[0]?.id || null)
      return next
    })
  }

  const clearItems = () => {
    items.forEach(item => revokeObjectUrl(item.url))
    setItems([])
    setSelectedId(null)
    setMessage('')
  }

  const handleFolderSelect = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
        const dirHandle = await window.showDirectoryPicker()
        const allFiles = []
        const collectFiles = async (handle) => {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') allFiles.push(await entry.getFile())
            else if (entry.kind === 'directory') await collectFiles(entry)
          }
        }
        await collectFiles(dirHandle)
        addFiles(allFiles)
      } else {
        folderRef.current?.click()
      }
    } catch (error) {
      if (error?.name !== 'AbortError') folderRef.current?.click()
    }
  }, [addFiles])

  const updateSelectedCrop = (nextCrop) => {
    if (!selected) return
    setItems(prev => prev.map(item => item.id === selected.id
      ? { ...item, crop: normalizeCropRect(nextCrop, cropBoxRatio), cropTouched: true, status: item.status === 'done' ? 'ready' : item.status }
      : item
    ))
  }

  const setSelectedCropZoom = (zoomValue) => {
    if (!selected || !selectedTarget?.w || !selectedTarget?.h) return
    const base = getDefaultCropRect(selected.width, selected.height, selectedTarget.w, selectedTarget.h)
    const zoom = clamp(zoomValue, 100, 260) / 100
    const nextW = base.w / zoom
    const nextH = base.h / zoom
    const centerX = selected.crop.x + selected.crop.w / 2
    const centerY = selected.crop.y + selected.crop.h / 2
    updateSelectedCrop({
      x: centerX - nextW / 2,
      y: centerY - nextH / 2,
      w: nextW,
      h: nextH,
    })
  }

  const beginCropDrag = (event, type) => {
    if (!selected || !editorRef.current) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      type,
      startX: event.clientX,
      startY: event.clientY,
      startCrop: selected.crop,
      bounds: editorRef.current.getBoundingClientRect(),
    }
    window.addEventListener('pointermove', handleCropDrag)
    window.addEventListener('pointerup', endCropDrag, { once: true })
  }

  const handleCropDrag = (event) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = (event.clientX - drag.startX) / drag.bounds.width
    const dy = (event.clientY - drag.startY) / drag.bounds.height
    if (drag.type === 'photo-move') {
      updateSelectedCrop({ ...drag.startCrop, x: drag.startCrop.x - dx * drag.startCrop.w, y: drag.startCrop.y - dy * drag.startCrop.h })
      return
    }
    const corner = drag.type.replace('resize-', '')
    const fromLeft = corner.includes('l')
    const fromTop = corner.includes('t')
    const fixedRight = drag.startCrop.x + drag.startCrop.w
    const fixedBottom = drag.startCrop.y + drag.startCrop.h
    const maxW = fromLeft ? fixedRight : 1 - drag.startCrop.x
    const maxH = fromTop ? fixedBottom : 1 - drag.startCrop.y
    let nextW = fromLeft ? drag.startCrop.w - dx : drag.startCrop.w + dx
    let nextH = fromTop ? drag.startCrop.h - dy : drag.startCrop.h + dy

    if (cropBoxRatio) {
      const proposedW = Math.abs(dx) >= Math.abs(dy) ? nextW : nextH * cropBoxRatio
      nextW = clamp(proposedW, 0.05, Math.min(maxW, maxH * cropBoxRatio))
      nextH = nextW / cropBoxRatio
    } else {
      nextW = clamp(nextW, 0.05, maxW)
      nextH = clamp(nextH, 0.05, maxH)
    }

    updateSelectedCrop({
      x: fromLeft ? fixedRight - nextW : drag.startCrop.x,
      y: fromTop ? fixedBottom - nextH : drag.startCrop.y,
      w: nextW,
      h: nextH,
    })
  }

  const endCropDrag = () => {
    window.removeEventListener('pointermove', handleCropDrag)
    dragRef.current = null
  }

  const processOne = async (item) => {
    const img = await readImage(item.preview)
    const target = getTargetSize(preset, customW, customH, img.width, img.height)
    const source = cropEnabled ? item.crop : { x: 0, y: 0, w: 1, h: 1 }
    const sourceX = Math.round(img.width * source.x)
    const sourceY = Math.round(img.height * source.y)
    const sourceW = Math.max(1, Math.round(img.width * source.w))
    const sourceH = Math.max(1, Math.round(img.height * source.h))
    const canvas = document.createElement('canvas')
    canvas.width = target.w
    canvas.height = target.h
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    if (cropEnabled) {
      ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, canvas.width, canvas.height)
    } else {
      const ratio = Math.min(canvas.width / sourceW, canvas.height / sourceH)
      const drawW = Math.max(1, Math.round(sourceW * ratio))
      const drawH = Math.max(1, Math.round(sourceH * ratio))
      ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, Math.round((canvas.width - drawW) / 2), Math.round((canvas.height - drawH) / 2), drawW, drawH)
    }

    let blob = await canvasToBlob(canvas, output.mime, output.quality ? quality / 100 : undefined)
    if (targetKb > 0 && output.quality) {
      const targetBytes = targetKb * 1024
      let low = 0.42
      let high = Math.min(quality / 100, 0.95)
      let best = blob
      let smallest = blob
      for (let i = 0; i < 7; i += 1) {
        const q = (low + high) / 2
        const candidate = await canvasToBlob(canvas, output.mime, q)
        if (candidate.size < smallest.size) smallest = candidate
        if (candidate.size <= targetBytes) {
          best = candidate
          low = q
        } else {
          high = q
        }
      }
      blob = best.size <= targetBytes ? best : smallest
    }

    return {
      blob,
      url: URL.createObjectURL(blob),
      size: blob.size,
      outputWidth: target.w,
      outputHeight: target.h,
    }
  }

  const processAll = async () => {
    const ready = items.filter(item => item.status === 'ready' || item.status === 'done')
    if (ready.length === 0) {
      setMessage('请先上传可处理的图片')
      return
    }

    setProcessing(true)
    setMessage('')
    const processingStartedAt = performance.now()
    trackEvent('process_start', { tool: 'converter', mode: 'compressor', count: ready.length, batchSize: ready.length, format, preset: sizePreset, targetKb })

    for (const item of ready) {
      setItems(prev => prev.map(current => current.id === item.id ? { ...current, status: 'processing', error: '' } : current))
      try {
        const result = await processOne(item)
        setItems(prev => prev.map(current => {
          if (current.id !== item.id) return current
          revokeObjectUrl(current.url)
          return { ...current, status: 'done', ...result, exportId: createExportId() }
        }))
        trackEvent('process_success', { tool: 'converter', mode: 'compressor', format, inputWidth: item.width, inputHeight: item.height, outputWidth: result.outputWidth, outputHeight: result.outputHeight, batchSize: ready.length, durationMs: Math.round(performance.now() - processingStartedAt) })
      } catch {
        setItems(prev => prev.map(current => current.id === item.id
          ? { ...current, status: 'error', error: '处理失败，请换一种输出格式或调小尺寸' }
          : current
        ))
        trackEvent('process_error', { tool: 'converter', mode: 'compressor', format, inputWidth: item.width, inputHeight: item.height, batchSize: ready.length, errorCode: 'unknown', durationMs: Math.round(performance.now() - processingStartedAt) })
      }
    }

    setProcessing(false)
  }

  const downloadOne = (item) => {
    if (!item.blob) return
    downloadBlob(item.blob, `${getBaseName(item.file.name)}_compressed.${output.ext}`)
    trackEvent('download_success', { tool: 'converter', mode: 'compressor_single', format })
    trackEvent('exported_image', {
      tool: 'converter',
      mode: 'compressor_single',
      format,
      count: 1,
      eventId: `e_${item.exportId || `compressor-${item.id}`}-image`,
    })
  }

  const downloadZip = async () => {
    if (doneItems.length === 0 || zipDownloadLockRef.current) return
    zipDownloadLockRef.current = true
    setZipDownloading(true)
    try {
      const zip = new JSZip()
      doneItems.forEach(item => {
        zip.file(`${getBaseName(item.file.name)}_compressed.${output.ext}`, item.blob)
      })
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(zipBlob, `tuscale_compressed_${doneItems.length}.zip`)
      const signature = doneItems.map(item => item.exportId || item.id).join('|')
      if (zipExportRef.current.signature !== signature) {
        zipExportRef.current = { signature, id: createExportId() }
      }
      trackEvent('download_success', { tool: 'converter', mode: 'compressor_zip', format })
      trackEvent('exported_image', {
        tool: 'converter',
        mode: 'compressor_zip',
        format,
        count: doneItems.length,
        eventId: `e_${zipExportRef.current.id}-images`,
      })
    } catch {
      setMessage('ZIP 打包失败，请重试或先单张下载')
    } finally {
      zipDownloadLockRef.current = false
      setZipDownloading(false)
    }
  }

  const handleCopyPageLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareNotice('页面链接已复制')
    } catch {
      setShareNotice('复制失败，可以手动复制浏览器地址栏链接')
    }
    setTimeout(() => setShareNotice(''), 2200)
  }

  const resetSelectedCrop = () => {
    if (!selected || !selectedTarget) return
    setItems(prev => prev.map(item => item.id === selected.id
      ? { ...item, crop: getDefaultCropRect(item.width, item.height, selectedTarget.w, selectedTarget.h), cropTouched: false }
      : item
    ))
  }

  return (
    <div className="min-h-screen bg-gray-50/80">
      <ToolHeader active="converter" navigate={navigate} />
      <main className="max-w-6xl mx-auto px-4 py-6 pb-20 space-y-5">
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">批量图片压缩与尺寸处理</h1>
              <p className="text-sm text-gray-500 mt-1">压缩体积、改尺寸、裁切范围、证件照参考线，图片在浏览器本地处理。</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={() => fileRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">
                <Upload className="w-4 h-4" /> 上传图片
              </button>
              <button onClick={handleFolderSelect}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-semibold">
                <FolderOpen className="w-4 h-4" /> 上传文件夹
              </button>
            </div>
          </div>

          <input ref={fileRef} type="file" accept="image/*,.heic,.heif,.tif,.tiff,.ico,.svg,.avif,.jfif" multiple className="hidden"
            onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
          <input ref={folderRef} type="file" className="hidden"
            onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
            <div className="space-y-4">
              {selected?.preview && cropEnabled && (
                <div className="border border-gray-200 rounded-xl bg-white p-4 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">裁切预览</h2>
                      <p className="text-xs text-gray-500 mt-1">白框是最终证件照画面；拖动照片调整位置，用滑杆放大或缩小照片。当前选中：{selected.file.name}</p>
                    </div>
                    <button onClick={resetSelectedCrop}
                      className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-600 text-xs font-semibold hover:bg-gray-100">
                      <RefreshCw className="w-3.5 h-3.5" /> 重置裁切
                    </button>
                  </div>
                  <label className="block rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-gray-700">照片缩放</span>
                      <span className="text-xs font-semibold text-indigo-600">{cropZoom}%</span>
                    </div>
                    <input type="range" min="100" max="260" step="1" value={cropZoom}
                      onChange={(event) => setSelectedCropZoom(Number(event.target.value))}
                      className="mt-2 w-full accent-indigo-600" />
                    <p className="mt-1 text-[11px] leading-5 text-gray-500">缩放照片不会改变一寸照比例，只调整人脸和肩膀在最终画面里的占比。</p>
                  </label>
                  <div className="flex justify-center rounded-lg bg-gray-100 p-4">
                    <div ref={editorRef}
                      className="relative max-w-full overflow-hidden rounded-md border-2 border-white bg-gray-200 shadow-lg ring-2 ring-indigo-500 select-none touch-none cursor-move"
                      style={{ width: `min(100%, ${cropFrameWidth}px)`, aspectRatio: `${selectedTarget.w} / ${selectedTarget.h}` }}
                      onPointerDown={(event) => beginCropDrag(event, 'photo-move')}>
                      {cropPreview ? (
                        <img src={cropPreview} alt="" className="absolute inset-0 h-full w-full pointer-events-none" />
                      ) : (
                        <img src={selected.preview} alt=""
                          className="absolute max-w-none pointer-events-none"
                          style={{
                            left: `${(-selected.crop.x / selected.crop.w) * 100}%`,
                            top: `${(-selected.crop.y / selected.crop.h) * 100}%`,
                            width: `${100 / selected.crop.w}%`,
                            height: `${100 / selected.crop.h}%`,
                          }} />
                      )}
                      {faceGuide && (
                        <div className="pointer-events-none absolute inset-0 z-10">
                          <div className="absolute rounded-full border-2 border-dashed border-amber-300/95" style={faceGuideStyle} />
                          <div className="absolute left-[12%] right-[12%] top-[10%] border-t border-dashed border-amber-200/90" />
                          <div className="absolute left-[12%] right-[12%] top-[58%] border-t border-dashed border-amber-200/90" />
                          <div className="absolute left-[18%] right-[18%] top-[78%] border-t border-dashed border-amber-200/70" />
                          <div className="absolute left-1/2 top-[8%] bottom-[8%] border-l border-dashed border-amber-200/60" />
                        </div>
                      )}
                      <div className="pointer-events-none absolute left-2 top-2 z-20 inline-flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[10px] font-semibold text-white">
                        <Move className="w-3 h-3" /> 拖动照片
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="border-2 border-dashed border-gray-200 rounded-xl min-h-48 p-4"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}>
                {items.length === 0 ? (
                  <div className="h-44 flex flex-col items-center justify-center text-center text-gray-400">
                    <ImageIcon className="w-10 h-10 mb-3 text-indigo-300" />
                    <p className="text-sm font-medium text-gray-600">拖拽图片到这里，或上传图片/文件夹</p>
                    <p className="text-xs mt-1">适合报名照、证件照、网页图、电商图和日常图片压缩</p>
                    <p className="mt-1 text-[10px] text-gray-400">支持 JPG、PNG、WebP、HEIC/HEIF；HEIC 在浏览器本地解码</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {items.map(item => (
                      <button key={item.id} onClick={() => setSelectedId(item.id)}
                        className={`relative text-left border rounded-lg bg-gray-50 overflow-hidden group ${selected?.id === item.id ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-200'}`}>
                        <div className="aspect-square bg-white flex items-center justify-center">
                          {item.preview ? (
                            <img src={item.preview} alt={item.file.name} className="max-w-full max-h-full object-contain" />
                          ) : (
                            <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
                          )}
                        </div>
                        <div className="p-2 space-y-1">
                          <p className="text-[10px] text-gray-600 truncate">{item.file.name}</p>
                          <p className="text-[9px] text-gray-400">{item.width ? `${item.width}x${item.height}` : '读取中'} · {formatBytes(item.file.size)}</p>
                          {item.status === 'done' && <p className="text-[9px] text-indigo-600">已处理 · {item.outputWidth}x{item.outputHeight} · {formatBytes(item.size)}</p>}
                          {item.status === 'error' && <p className="text-[9px] text-red-500 truncate">{item.error}</p>}
                        </div>
                        <span onClick={(event) => { event.stopPropagation(); removeItem(item.id) }}
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/45 text-white hidden group-hover:flex items-center justify-center">
                          <X className="w-3.5 h-3.5" />
                        </span>
                        {item.status === 'done' && (
                          <span onClick={(event) => { event.stopPropagation(); downloadOne(item) }}
                            className="absolute bottom-2 right-2 w-7 h-7 rounded-lg bg-white shadow border border-gray-200 text-indigo-600 flex items-center justify-center">
                            <Download className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <aside className="space-y-4">
              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-indigo-500" />
                  <h2 className="text-sm font-semibold text-gray-800">压缩设置</h2>
                </div>

                <label className="block space-y-2">
                  <span className="text-xs font-medium text-gray-500">目标大小</span>
                  <select value={targetSizeMode} onChange={(event) => setTargetSizeMode(Number(event.target.value))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                    {TARGET_SIZE_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                {targetSizeMode === -1 && (
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-gray-500">自定义 KB</span>
                    <input type="number" min="20" value={customTargetKb} onChange={(event) => setCustomTargetKb(Number(event.target.value))}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
                  </label>
                )}

                <label className="block space-y-2">
                  <span className="text-xs font-medium text-gray-500">尺寸预设</span>
                  <select value={sizePreset} onChange={(event) => setSizePreset(event.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                    {SIZE_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label} · {item.desc}</option>)}
                  </select>
                </label>
                {sizePreset === 'custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-gray-500">宽 px</span>
                      <input type="number" min="1" value={customW} onChange={(event) => setCustomW(Number(event.target.value))}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-gray-500">高 px</span>
                      <input type="number" min="1" value={customH} onChange={(event) => setCustomH(Number(event.target.value))}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600">
                    <input type="checkbox" checked={cropEnabled} onChange={(event) => setCropEnabled(event.target.checked)} className="accent-indigo-600" />
                    裁切范围
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600">
                    <input type="checkbox" checked={faceGuide} onChange={(event) => setFaceGuide(event.target.checked)} className="accent-indigo-600" />
                    面部参考线
                  </label>
                </div>
              </div>

              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
                <h2 className="text-sm font-semibold text-gray-800">导出设置</h2>
                <div className="grid grid-cols-2 gap-2">
                  {OUTPUTS.map(item => (
                    <button key={item.id} onClick={() => setFormat(item.id)}
                      className={`px-3 py-2 rounded-lg border text-sm font-semibold ${format === item.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-600'}`}>
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs leading-5 text-gray-500">{output.note}</p>
                {output.quality && (
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-gray-500">{targetKb > 0 ? '画质上限' : '导出质量'} {quality}%</span>
                    <input type="range" min="42" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))}
                      className="w-full accent-indigo-600" />
                    {targetKb > 0 && (
                      <span className="block text-xs leading-5 text-gray-500">有目标大小时，会自动降低画质接近目标体积。</span>
                    )}
                  </label>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2">
                <button onClick={processAll} disabled={processing || items.length === 0}
                  className="inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold">
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} 开始处理
                </button>
                <button onClick={() => doneItems.length === 1 ? downloadOne(doneItems[0]) : downloadZip()} disabled={doneItems.length === 0 || zipDownloading}
                  className="inline-flex items-center justify-center gap-2 py-2.5 rounded-lg border border-indigo-200 bg-indigo-50 disabled:bg-gray-100 disabled:text-gray-400 text-indigo-700 text-sm font-semibold">
                  {zipDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                  {zipDownloading ? '正在打包 ZIP' : doneItems.length <= 1 ? '下载图片' : '下载全部 ZIP'}
                </button>
                <button onClick={clearItems} disabled={items.length === 0 || processing}
                  className="py-2 text-xs text-gray-500 hover:text-red-600 disabled:text-gray-300">清空列表</button>
              </div>
            </aside>
          </div>
        </section>

        {message && <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-amber-700">{message}</div>}

        {doneItems.length > 0 && (
          <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-gray-800">处理完成，可以收藏下次再用</p>
                <p className="text-xs leading-5 text-gray-500">已完成 {doneItems.length} 张，支持单张下载或打包 ZIP。</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={() => navigate('/contact')}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700">
                批量或特殊格式需求
              </button>
              <button onClick={handleCopyPageLink}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-100">
                <Copy className="w-3.5 h-3.5" /> 复制页面链接
              </button>
            </div>
            {shareNotice && <p className="text-xs text-indigo-600 sm:self-center">{shareNotice}</p>}
          </section>
        )}

        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">常用预设</h2>
            <p className="text-xs text-gray-500 mt-1">普通图片可以只压缩体积；需要统一尺寸时再选择预设或自定义。</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {SIZE_PRESETS.filter(item => item.id !== 'custom').map(item => (
              <button key={item.id} onClick={() => setSizePreset(item.id)}
                className={`text-left px-3 py-2 rounded-lg border ${sizePreset === item.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-gray-50'}`}>
                <p className="text-xs font-semibold text-gray-800">{item.label}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{item.desc}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">常见问题</h2>
            <p className="text-xs text-gray-500 mt-1">关于压缩、隐私、目标大小和证件照预设。</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {COMPRESS_FAQ.map(([question, answer]) => (
              <FaqItem key={question} question={question} answer={answer} />
            ))}
          </div>
        </section>
      </main>
      <RewardButton />
    </div>
  )
}

function FaqItem({ question, answer }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-sm font-semibold text-gray-900">{question}</h3>
      <p className="text-xs leading-6 text-gray-500 mt-1">{answer}</p>
    </div>
  )
}

function ToolHeader({ active, navigate }) {
  const items = [
    { id: 'upscale', label: '图片放大', path: '/' },
    { id: 'converter', label: '图片压缩', path: '/format-converter' },
    { id: 'product-image', label: '商品图规范化', path: '/product-image' },
    { id: 'contact', label: '反馈联系', path: '/contact' },
  ]

  return (
    <header className="bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 sm:px-6 py-3 sticky top-0 z-10 shadow-sm">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-3 sm:gap-4">
        <img src="/logo.png" alt="TU Scale" className="h-16 sm:h-18 w-auto shrink-0" />
        <div className="flex flex-col min-w-0 mr-auto justify-center">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight truncate leading-tight" style={{ color: '#8040f0' }}>TU Scale 本地图片工具箱-图片压缩</h1>
          <p className="mt-2 text-xs sm:text-sm font-semibold text-gray-400 leading-none">图片本地处理，不上传服务器</p>
        </div>
        <nav className="order-2 flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {items.map(item => (
            <button key={item.id} onClick={() => navigate(item.path)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${active === item.id ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'text-gray-500 hover:bg-gray-50 border border-transparent'}`}>
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}
