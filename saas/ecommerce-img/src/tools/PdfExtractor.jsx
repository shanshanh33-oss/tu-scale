import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle,
  Copy,
  Download,
  FileArchive,
  FileImage,
  FileText,
  FolderOpen,
  Grid2X2,
  Images,
  LayoutTemplate,
  Loader2,
  Presentation,
  ScanText,
  Upload,
  X,
} from 'lucide-react'
import JSZip from 'jszip'
import RewardButton from './RewardButton'
import { downloadBlob, formatBytes } from './shared'
import {
  MAX_EXTRACTED_IMAGES,
  convertExtractedImage,
  createImagesPptx,
  parsePdfFile,
} from './pdfProcessing'
import { recognizeImageFiles, recognizePdfPages } from './pdfOcr'
import { getPdfTaskErrorMessage, pdfTaskStore } from './pdfTaskStore'
import { createTemplatePptx, inspectPptxTemplate } from './pptTemplate'
import {
  PDF_IMAGE_RATIOS,
  PPT_LAYOUTS,
  combinePageTexts,
  sanitizePdfName,
} from './pdfToolUtils'

const TOOL_NAV = [
  { id: 'upscale', label: '图片放大', path: '/' },
  { id: 'converter', label: '图片压缩', path: '/format-converter' },
  { id: 'product-image', label: '商品图规范化', path: '/product-image' },
  { id: 'pdf', label: 'PDF 提取', path: '/pdf-extractor' },
  { id: 'contact', label: '反馈联系', path: '/contact' },
]

const RASTER_FORMATS = [
  { id: 'png', label: 'PNG', ext: 'png' },
  { id: 'jpeg', label: 'JPG', ext: 'jpg' },
  { id: 'webp', label: 'WebP', ext: 'webp' },
]

const replaceExtension = (name, extension) => name.replace(/\.[^.]+$/, `.${extension}`)
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'])
const SUPPORTED_IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|bmp|gif)$/i

const isSupportedImage = file => SUPPORTED_IMAGE_TYPES.has(file?.type) || SUPPORTED_IMAGE_EXTENSION.test(file?.name || '')

const sanitizeTextFilePart = (value = '图片') => String(value)
  .replace(/[\\/:*?"<>|]/g, '_')
  .slice(0, 80) || '图片'

export default function PdfExtractor({ navigate }) {
  const fileInputRef = useRef(null)
  const imageInputRef = useRef(null)
  const folderInputRef = useRef(null)
  const templateInputRef = useRef(null)
  const task = useSyncExternalStore(pdfTaskStore.subscribe, pdfTaskStore.getSnapshot, pdfTaskStore.getSnapshot)
  const {
    file,
    sourceType,
    result,
    selectedIds,
    parsing,
    ocrRunning,
    exporting,
    progress,
    ocrProgress,
    error,
    message,
  } = task
  const [activeTab, setActiveTab] = useState(() => {
    const existingResult = pdfTaskStore.getSnapshot().result
    return existingResult && !existingResult.images.length ? 'text' : 'images'
  })
  const [dragOver, setDragOver] = useState(false)
  const [showSmallImages, setShowSmallImages] = useState(false)
  const [showEmptyTextPages, setShowEmptyTextPages] = useState(false)
  const [ratioId, setRatioId] = useState('original')
  const [ratioMode, setRatioMode] = useState('crop')
  const [rasterFormat, setRasterFormat] = useState('png')
  const [pptLayout, setPptLayout] = useState('wide')
  const [pptFitMode, setPptFitMode] = useState('fill')
  const [ocrMode, setOcrMode] = useState('missing')
  const [splitCollages, setSplitCollages] = useState(true)
  const [templateFile, setTemplateFile] = useState(null)
  const [templateInfo, setTemplateInfo] = useState(null)
  const [templateSlideNumber, setTemplateSlideNumber] = useState(1)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [includeTemplateText, setIncludeTemplateText] = useState(true)

  const setSelectedIds = useCallback(nextValue => pdfTaskStore.setSelectedIds(nextValue), [])
  const setExporting = useCallback(value => pdfTaskStore.update({ exporting: value }), [])
  const setError = useCallback(value => pdfTaskStore.update({ error: value }), [])
  const setMessage = useCallback(value => pdfTaskStore.update({ message: value }), [])

  const selectedImages = useMemo(() => {
    if (!result) return []
    const selected = new Set(selectedIds)
    return result.images.filter(image => selected.has(image.id))
  }, [result, selectedIds])

  const visibleImages = useMemo(() => {
    if (!result) return []
    return showSmallImages ? result.images : result.images.filter(image => !image.isSmall)
  }, [result, showSmallImages])

  const textPageCount = useMemo(
    () => result?.pages.filter(page => page.text.trim()).length || 0,
    [result],
  )
  const missingTextPageCount = useMemo(
    () => result?.pages.filter(page => !page.text.trim()).length || 0,
    [result],
  )
  const visibleTextPages = useMemo(() => {
    if (!result) return []
    return showEmptyTextPages ? result.pages : result.pages.filter(page => page.text.trim())
  }, [result, showEmptyTextPages])
  const splitSourceCount = useMemo(
    () => new Set(result?.pages.filter(page => page.wasSplit).map(page => page.sourceFileIndex) || []).size,
    [result],
  )
  const lowResolutionPptImages = useMemo(() => {
    const layout = PPT_LAYOUTS.find(option => option.id === pptLayout) || PPT_LAYOUTS[0]
    const targetWidth = layout.width * 144
    const targetHeight = layout.height * 144
    return selectedImages.filter((image) => {
      if (!image.width || !image.height) return true
      return Math.max(targetWidth / image.width, targetHeight / image.height) > 1.25
    })
  }, [pptLayout, selectedImages])
  const smallestPptImage = useMemo(() => lowResolutionPptImages.reduce((smallest, image) => (
    !smallest || (image.width * image.height) < (smallest.width * smallest.height) ? image : smallest
  ), null), [lowResolutionPptImages])
  const ocrPercent = useMemo(() => {
    if (!ocrProgress.pageCount) return 3
    const finished = Math.min(ocrProgress.pageCount, ocrProgress.completed + (ocrProgress.progress || 0))
    return Math.max(3, (finished / ocrProgress.pageCount) * 100)
  }, [ocrProgress])
  const busy = parsing || ocrRunning || !!exporting

  const resetResult = useCallback(() => {
    pdfTaskStore.reset()
    setShowEmptyTextPages(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (imageInputRef.current) imageInputRef.current.value = ''
    if (folderInputRef.current) folderInputRef.current.value = ''
  }, [])

  const handlePdf = useCallback(async (nextFile) => {
    if (!nextFile) return
    setShowEmptyTextPages(false)
    const parsed = await pdfTaskStore.start(nextFile, parsePdfFile)
    if (parsed) setActiveTab(parsed.images.length ? 'images' : 'text')
  }, [])

  const handleImageFiles = useCallback(async (fileList) => {
    const incoming = Array.from(fileList || [])
    const supported = incoming.filter(isSupportedImage)
    if (!supported.length) {
      setError('请选择 JPG、PNG、WebP、BMP 或 GIF 图片')
      setMessage('')
      return
    }
    setShowEmptyTextPages(false)
    const skipped = incoming.length - supported.length
    const parsed = await pdfTaskStore.startImageOcr(
      supported,
      options => recognizeImageFiles(supported, { ...options, splitCollages }),
    )
    if (parsed) {
      setActiveTab('text')
      if (skipped) setMessage(`${pdfTaskStore.getSnapshot().message}；已跳过 ${skipped} 个不支持的文件`)
    }
  }, [setError, setMessage, splitCollages])

  const handlePdfOcr = async () => {
    if (!result || sourceType !== 'pdf') return
    const targetPages = result.pages
      .filter(page => ocrMode === 'all' || !page.text.trim())
      .map(page => page.pageNumber)
    if (!targetPages.length) {
      setMessage('所有页面都已有文字；如需重新识别，请选择“重新识别全部页面”')
      setError('')
      return
    }
    await pdfTaskStore.startOcr(options => recognizePdfPages(file, targetPages, options))
  }

  const handleTemplateFile = async (nextFile) => {
    if (!nextFile) return
    setTemplateLoading(true)
    setError('')
    try {
      const info = await inspectPptxTemplate(nextFile)
      const recommended = info.slides.find(slide => slide.hasImageMarker && slide.hasTextMarker)
        || info.slides.find(slide => slide.hasImageMarker)
        || info.slides[1]
        || info.slides[0]
      setTemplateFile(nextFile)
      setTemplateInfo(info)
      setTemplateSlideNumber(recommended.number)
      setMessage(`模板已读取：${info.slideCount} 页，已选择第 ${recommended.number} 页作为内容页`)
    } catch (templateError) {
      setTemplateFile(null)
      setTemplateInfo(null)
      setError(getPdfTaskErrorMessage(templateError))
    } finally {
      setTemplateLoading(false)
    }
  }

  const handleTemplatePptx = async () => {
    if (!templateFile || !templateInfo) {
      setError('请先上传 PPTX 模板')
      return
    }
    if (!selectedImages.length) {
      setError('请先勾选要放进模板的图片')
      return
    }
    const textByPage = new Map(result.pages.map(page => [page.pageNumber, page.text || '']))
    const entries = selectedImages.map((image, index) => ({
      image,
      title: image.displayName || (sourceType === 'images' ? `第 ${index + 1} 张图片` : `第 ${image.pageNumber} 页图片 ${image.imageNumber}`),
      text: textByPage.get(image.pageNumber) || '',
    }))
    setExporting('ppt-template')
    setError('')
    setMessage('正在按上传模板生成 PPT')
    try {
      const blob = await createTemplatePptx(templateFile, entries, {
        templateSlideNumber,
        fitMode: pptFitMode,
        includeText: includeTemplateText,
        normalizeImage: (image) => {
          const sourceType = image.blob?.type?.toLowerCase()
          return sourceType === 'image/png' || sourceType === 'image/jpeg'
            ? image.blob
            : convertExtractedImage(image, { format: 'png' })
        },
        onProgress: ({ completed, total }) => setMessage(`正在套用模板 ${completed}/${total}`),
      })
      downloadBlob(blob, `${sanitizePdfName(file?.name)}_套用模板.pptx`)
      setMessage(includeTemplateText
        ? `模板 PPT 已生成：${selectedImages.length} 个内容页，图片和识别文字均可编辑`
        : `模板 PPT 已生成：${selectedImages.length} 个内容页，图片可编辑`)
    } catch (templateError) {
      setError(getPdfTaskErrorMessage(templateError))
    } finally {
      setExporting('')
    }
  }

  const toggleSelected = (id) => {
    setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  const selectVisible = () => {
    const visibleIds = visibleImages.map(image => image.id)
    setSelectedIds(current => Array.from(new Set([...current, ...visibleIds])))
  }

  const clearVisibleSelection = () => {
    const visibleIds = new Set(visibleImages.map(image => image.id))
    setSelectedIds(current => current.filter(id => !visibleIds.has(id)))
  }

  const getRasterOptions = () => ({
    ratio: PDF_IMAGE_RATIOS.find(option => option.id === ratioId)?.ratio || null,
    mode: ratioMode,
    format: rasterFormat,
  })

  const handleSingleImageDownload = async (image) => {
    setExporting(`image:${image.id}`)
    setError('')
    try {
      const blob = await convertExtractedImage(image, getRasterOptions())
      const extension = RASTER_FORMATS.find(option => option.id === rasterFormat)?.ext || 'png'
      downloadBlob(blob, replaceExtension(image.fileName, extension))
    } catch (downloadError) {
      setError(getPdfTaskErrorMessage(downloadError))
    } finally {
      setExporting('')
    }
  }

  const handleImagesZip = async () => {
    if (!selectedImages.length) {
      setError('请先勾选要保存的图片')
      return
    }
    setExporting('zip')
    setError('')
    try {
      const zip = new JSZip()
      const folder = zip.folder('图片')
      const extension = RASTER_FORMATS.find(option => option.id === rasterFormat)?.ext || 'png'
      for (let index = 0; index < selectedImages.length; index += 1) {
        const image = selectedImages[index]
        setMessage(`正在整理图片 ${index + 1}/${selectedImages.length}`)
        const blob = await convertExtractedImage(image, getRasterOptions())
        folder.file(replaceExtension(image.fileName, extension), blob)
      }
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
      const ratioSuffix = ratioId === 'original' ? '原比例' : ratioId
      downloadBlob(zipBlob, `${sanitizePdfName(file?.name)}_提取图片_${ratioSuffix}_${extension}.zip`)
      setMessage(`已保存 ${selectedImages.length} 张 ${ratioSuffix} ${extension.toUpperCase()} 图片`)
    } catch (zipError) {
      setError(getPdfTaskErrorMessage(zipError))
    } finally {
      setExporting('')
    }
  }

  const handleTextDownload = () => {
    if (!result) return
    const text = combinePageTexts(result.pages)
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${sanitizePdfName(file?.name)}_文字.txt`)
    setMessage('已保存合并文字文件')
  }

  const handleTextZip = async () => {
    if (!result) return
    setExporting('text-zip')
    setError('')
    try {
      const zip = new JSZip()
      const folder = zip.folder('文字')
      result.pages.forEach(page => {
        const label = sourceType === 'images'
          ? `第${String(page.pageNumber).padStart(3, '0')}张_${sanitizeTextFilePart(page.originalFileName)}`
          : `第${String(page.pageNumber).padStart(3, '0')}页`
        folder.file(`${label}.txt`, page.text || '（未检测到文字）')
      })
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      downloadBlob(zipBlob, `${sanitizePdfName(file?.name)}_分页文字.zip`)
      setMessage(`已保存 ${result.pages.length} 个分页文字文件`)
    } catch (zipError) {
      setError(getPdfTaskErrorMessage(zipError))
    } finally {
      setExporting('')
    }
  }

  const handleCopyText = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(combinePageTexts(result.pages))
      setMessage('已复制全部文字')
    } catch {
      setError('浏览器未允许复制，请下载 TXT 文件')
    }
  }

  const handlePptx = async (mode) => {
    if (!selectedImages.length) {
      setError('请先勾选要放进 PPT 的图片')
      return
    }
    if (mode === 'collage' && selectedImages.length > 20) {
      setError('单页图片合集最多选择 20 张，请减少勾选数量')
      return
    }
    setExporting(mode === 'collage' ? 'ppt-collage' : 'ppt-pages')
    setError('')
    setMessage(mode === 'collage' ? '正在自动排版图片合集' : '正在生成每图一页的 PPT')
    try {
      const blob = await createImagesPptx(selectedImages, {
        layoutId: pptLayout,
        mode,
        fitMode: pptFitMode,
        onProgress: ({ completed, total }) => {
          setMessage(mode === 'collage'
            ? `正在自动排版图片 ${completed}/${total}`
            : `正在生成 PPT 页面 ${completed}/${total}`)
        },
      })
      const suffix = mode === 'collage' ? '图片合集' : '每图一页'
      downloadBlob(blob, `${sanitizePdfName(file?.name)}_${suffix}.pptx`)
      setMessage(`PPT 已生成，包含 ${selectedImages.length} 个可编辑图片对象`)
    } catch (pptError) {
      setError(getPdfTaskErrorMessage(pptError))
    } finally {
      setExporting('')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50/80 text-gray-950">
      <ToolHeader navigate={navigate} />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 pb-24">
        <section className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <p className="text-sm font-semibold text-indigo-800">PDF 与图片在浏览器本地解析和 OCR，文件不会上传服务器</p>
          <p className="mt-1 text-xs leading-5 text-indigo-600">任务可在切换 TU Scale 页面或浏览器标签后继续；如果浏览器冻结、关闭或刷新此标签页，任务会暂停或结束。</p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">PDF / 批量图片与文字提取</h2>
              <p className="mt-1 text-sm leading-6 text-gray-500">PDF 大小和页数、批量图片数量不设固定上限；实际处理规模取决于浏览器可用内存。PDF 最多直接提取 {MAX_EXTRACTED_IMAGES} 张内嵌栅格图片，扫描页可再用本地中英文 OCR 识别。</p>
            </div>
            {file && !busy && (
              <button type="button" onClick={resetResult}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                <X className="h-4 w-4" /> 更换文件
              </button>
            )}
          </div>

          <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden"
            onChange={event => handlePdf(event.target.files?.[0])} />
          <input ref={imageInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/bmp,image/gif,.jpg,.jpeg,.png,.webp,.bmp,.gif" className="hidden"
            onChange={event => handleImageFiles(event.target.files)} />
          <input ref={folderInputRef} type="file" multiple webkitdirectory="" directory="" className="hidden"
            onChange={event => handleImageFiles(event.target.files)} />

          {!file && (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <button type="button" onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragOver(false)
                  handlePdf(event.dataTransfer.files?.[0])
                }}
                className={`flex min-h-56 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-5 py-10 text-center transition-colors ${dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50/40'}`}>
                <span className="rounded-full bg-white p-3 shadow-sm"><Upload className="h-7 w-7 text-indigo-500" /></span>
                <span className="mt-4 text-sm font-semibold text-gray-800">上传 PDF</span>
                <span className="mt-1 text-xs leading-5 text-gray-400">提取内嵌图片和文字层，再按需 OCR 扫描页</span>
              </button>
              <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-center">
                <span className="rounded-full bg-white p-3 shadow-sm"><Images className="h-7 w-7 text-violet-500" /></span>
                <span className="mt-4 text-sm font-semibold text-gray-800">批量图片 OCR</span>
                <span className="mt-1 text-xs leading-5 text-gray-400">支持 JPG、PNG、WebP、BMP、GIF；拼图可自动拆成单张后分别识别</span>
                <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-violet-100 bg-white px-3 py-2 text-left text-xs leading-5 text-violet-800 shadow-sm">
                  <input type="checkbox" checked={splitCollages} onChange={event => setSplitCollages(event.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-violet-300 text-violet-600" />
                  <span><strong className="font-semibold">自动拆分拼图（推荐）</strong><br />按分隔线拆成单图，再逐张 OCR、保存或制作 PPT</span>
                </label>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => imageInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700">
                    <Images className="h-3.5 w-3.5" /> 多选图片
                  </button>
                  <button type="button" onClick={() => folderInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50">
                    <FolderOpen className="h-3.5 w-3.5" /> 选择文件夹
                  </button>
                </div>
              </div>
            </div>
          )}

          {file && (
            <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-lg bg-white p-2 text-indigo-500 shadow-sm">{sourceType === 'images' ? <Images className="h-5 w-5" /> : <FileText className="h-5 w-5" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-800">{file.name}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{formatBytes(file.size)}</p>
                </div>
                {parsing && (
                  <button type="button" onClick={() => pdfTaskStore.cancel()}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100">
                    取消解析
                  </button>
                )}
                {ocrRunning && (
                  <button type="button" onClick={() => pdfTaskStore.cancelOcr()}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100">
                    取消 OCR
                  </button>
                )}
              </div>
              {parsing && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />{progress.stage || '正在解析'}</span>
                    <span>{progress.pageCount ? `${progress.pageNumber}/${progress.pageCount} 页` : '准备中'} · 已找到 {progress.imageCount} 张图片</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full rounded-full bg-indigo-500 transition-all"
                      style={{ width: `${progress.pageCount ? Math.max(3, (progress.pageNumber / progress.pageCount) * 100) : 3}%` }} />
                  </div>
                </div>
              )}
              {ocrRunning && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />{ocrProgress.stage || '正在 OCR'}</span>
                    <span>{ocrProgress.pageCount ? `${Math.min(ocrProgress.completed + 1, ocrProgress.pageCount)}/${ocrProgress.pageCount}` : '准备中'} · 简体中文 + English</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${ocrPercent}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
          </div>
        )}
        {message && !error && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{message}</span>
          </div>
        )}

        {result && (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCard label={sourceType === 'images' ? (splitSourceCount ? '拆分后单图' : '上传图片') : 'PDF 页数'} value={result.pageCount} />
              <SummaryCard label={sourceType === 'images' ? '可保存图片' : '提取图片'} value={result.images.length} />
              <SummaryCard label={sourceType === 'images' ? '识别到文字' : '含文字页面'} value={textPageCount} />
              <SummaryCard label="已选择图片" value={selectedImages.length} />
            </section>

            {result.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-700">
                {result.warnings.join('；')}
              </div>
            )}

            <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="flex border-b border-gray-200 bg-gray-50 px-3 pt-3">
                <TabButton active={activeTab === 'images'} onClick={() => setActiveTab('images')}>
                  <Images className="h-4 w-4" /> 图片（{result.images.length}）
                </TabButton>
                <TabButton active={activeTab === 'text'} onClick={() => setActiveTab('text')}>
                  <FileText className="h-4 w-4" /> 文字（{textPageCount}/{result.pageCount} {sourceType === 'images' ? '张' : '页'}）
                </TabButton>
              </div>

              {activeTab === 'images' ? (
                <div className="grid gap-5 p-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:p-5">
                  <aside className="space-y-4">
                    <SettingsSection title="图片保存设置">
                      <label className="block text-xs font-medium text-gray-600">
                        输出比例
                        <select value={ratioId} onChange={event => setRatioId(event.target.value)}
                          className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-400">
                          {PDF_IMAGE_RATIOS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </select>
                      </label>
                      {ratioId !== 'original' && (
                        <div className="grid grid-cols-2 gap-2">
                          <ChoiceButton active={ratioMode === 'crop'} onClick={() => setRatioMode('crop')}>居中裁切</ChoiceButton>
                          <ChoiceButton active={ratioMode === 'pad'} onClick={() => setRatioMode('pad')}>白色留白</ChoiceButton>
                        </div>
                      )}
                      <label className="block text-xs font-medium text-gray-600">
                        图片格式
                        <select value={rasterFormat} onChange={event => setRasterFormat(event.target.value)}
                          className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-400">
                          {RASTER_FORMATS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </select>
                      </label>
                      <button type="button" disabled={!selectedImages.length || busy} onClick={handleImagesZip}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300">
                        {exporting === 'zip' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
                        保存所选图片 ZIP
                      </button>
                    </SettingsSection>

                    <SettingsSection title="PPT 保存设置">
                      <label className="block text-xs font-medium text-gray-600">
                        页面比例
                        <select value={pptLayout} onChange={event => setPptLayout(event.target.value)}
                          className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-400">
                          {PPT_LAYOUTS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <ChoiceButton active={pptFitMode === 'fill'} onClick={() => setPptFitMode('fill')}>铺满裁切（推荐）</ChoiceButton>
                        <ChoiceButton active={pptFitMode === 'fit'} onClick={() => setPptFitMode('fit')}>完整显示</ChoiceButton>
                      </div>
                      <p className="text-[11px] leading-5 text-gray-500">铺满裁切会覆盖到页面四边且不拉伸。PPT 仍保留整张原图，可在 PowerPoint 里移动裁切位置或恢复被裁掉的部分。</p>
                      {lowResolutionPptImages.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-700">
                          检测到 {lowResolutionPptImages.length} 张图片分辨率不足，每图一页铺满后仍可能模糊
                          {smallestPptImage ? `（最低 ${smallestPptImage.width} × ${smallestPptImage.height}px）` : ''}。
                          PPT 会保留原始图片且不做有损压缩；要获得真正清晰的全屏效果，建议直接批量上传原始照片生成 PPT。
                        </div>
                      )}
                      <p className="text-[11px] leading-5 text-amber-600">每图一页不限制图片张数；图片越多，生成时间、内存占用和文件体积越大。</p>
                      <button type="button" disabled={!selectedImages.length || busy} onClick={() => handlePptx('pages')}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50">
                        {exporting === 'ppt-pages' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Presentation className="h-4 w-4" />}
                        每张图片一页 PPT
                      </button>
                      <button type="button" disabled={selectedImages.length < 2 || busy} onClick={() => handlePptx('collage')}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300">
                        {exporting === 'ppt-collage' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Grid2X2 className="h-4 w-4" />}
                        所选图片自动排一页
                      </button>

                      <div className="border-t border-gray-200 pt-4">
                        <input ref={templateInputRef} type="file" accept="application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx" className="hidden"
                          onChange={event => handleTemplateFile(event.target.files?.[0])} />
                        <button type="button" disabled={busy || templateLoading} onClick={() => templateInputRef.current?.click()}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50">
                          {templateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutTemplate className="h-4 w-4" />}
                          {templateFile ? '更换 PPTX 模板' : '上传 PPTX 模板'}
                        </button>

                        {templateFile && templateInfo && (
                          <div className="mt-3 space-y-3 rounded-lg border border-violet-100 bg-violet-50/70 p-3">
                            <div>
                              <p className="truncate text-xs font-semibold text-violet-900">{templateFile.name}</p>
                              <p className="mt-1 text-[11px] text-violet-600">共 {templateInfo.slideCount} 页 · 将保留模板原有页面</p>
                            </div>
                            <label className="block text-xs font-medium text-violet-800">
                              选择内容模板页
                              <select value={templateSlideNumber} onChange={event => setTemplateSlideNumber(Number(event.target.value))}
                                className="mt-1.5 w-full rounded-lg border border-violet-200 bg-white px-2.5 py-2 text-xs text-gray-700 outline-none focus:border-violet-400">
                                {templateInfo.slides.map(slide => (
                                  <option key={slide.number} value={slide.number}>
                                    第 {slide.number} 页 · {slide.title}{slide.hasImageMarker || slide.hasTextMarker || slide.hasTitleMarker ? ' · 已检测标记' : ''}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-violet-800">
                              <input type="checkbox" checked={includeTemplateText} onChange={event => setIncludeTemplateText(event.target.checked)}
                                className="mt-0.5 h-3.5 w-3.5 rounded border-violet-300 text-violet-600" />
                              <span>把对应页识别文字写入可编辑文本框</span>
                            </label>
                            <button type="button" disabled={!selectedImages.length || busy} onClick={handleTemplatePptx}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300">
                              {exporting === 'ppt-template' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Presentation className="h-4 w-4" />}
                              按模板生成可编辑 PPT
                            </button>
                          </div>
                        )}

                        <p className="mt-3 text-[11px] leading-5 text-gray-500">推荐在模板内容页放置三个文本框：{'{{图片}}'}、{'{{文字}}'}、{'{{标题}}'}。系统会沿用它们的位置和文字样式；没有标记时使用左图右文自动布局。</p>
                      </div>
                    </SettingsSection>
                  </aside>

                  <div className="min-w-0">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{sourceType === 'images' ? (splitSourceCount ? '拼图拆分后的单图' : '已上传的原图') : 'PDF 中的栅格图片与扫描页'}</h3>
                        <p className="mt-1 text-xs text-gray-500">{sourceType === 'images'
                          ? splitSourceCount
                            ? `${splitSourceCount} 个拼图文件已按分隔线拆开；每个区域都能单独保存、识别和放入 PPT。`
                            : '没有检测到可靠分隔线，图片保持为独立文件，可统一比例后下载或放入 PPT。'
                          : 'OCR 后的扫描页会作为完整页面图片加入；矢量线条不会误算成独立图片。'}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {result.images.some(image => image.isSmall) && (
                          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
                            <input type="checkbox" checked={showSmallImages} onChange={event => setShowSmallImages(event.target.checked)}
                              className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-500" />
                            显示小图标
                          </label>
                        )}
                        <button type="button" onClick={selectVisible} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">全选当前</button>
                        <button type="button" onClick={clearVisibleSelection} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">取消当前</button>
                      </div>
                    </div>

                    {visibleImages.length ? (
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {visibleImages.map(image => {
                          const checked = selectedIds.includes(image.id)
                          const singleLoading = exporting === `image:${image.id}`
                          return (
                            <article key={image.id} className={`overflow-hidden rounded-xl border bg-white transition-colors ${checked ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-gray-200'}`}>
                              <button type="button" onClick={() => toggleSelected(image.id)}
                                aria-pressed={checked} aria-label={`${checked ? '取消选择' : '选择'}${image.fileName}`}
                                className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-[linear-gradient(45deg,#f3f4f6_25%,transparent_25%),linear-gradient(-45deg,#f3f4f6_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f3f4f6_75%),linear-gradient(-45deg,transparent_75%,#f3f4f6_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px] p-3">
                                <img src={image.previewUrl} alt={image.displayName || `PDF 第 ${image.pageNumber} 页图片 ${image.imageNumber}`} className="max-h-full max-w-full object-contain" />
                                <span className={`absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border shadow-sm ${checked ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-gray-300 bg-white text-transparent'}`}>
                                  <Check className="h-4 w-4" />
                                </span>
                              </button>
                              <div className="p-3">
                                <p className="truncate text-xs font-semibold text-gray-800">
                                  {image.displayName || `第 ${image.pageNumber} 页 · 图片 ${image.imageNumber}`}
                                </p>
                                {image.wasSplit && (
                                  <span className="mt-1.5 inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                                    来自拼图 · 单图 {image.splitIndex}/{image.splitCount}
                                  </span>
                                )}
                                {image.wasContentCropped && (
                                  <span className={`mt-1.5 ml-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${image.usingOriginal ? 'bg-gray-100 text-gray-600' : 'bg-emerald-100 text-emerald-700'}`}>
                                    {image.usingOriginal ? '当前使用原图' : '已清理黑边与小装饰'}
                                  </span>
                                )}
                                <p className="mt-1 text-[11px] text-gray-400">{image.width} × {image.height}px · {formatBytes(image.blob.size)}</p>
                                {image.wasContentCropped && (
                                  <button type="button" disabled={busy} onClick={() => pdfTaskStore.toggleImageSource(image.id)}
                                    className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                                    {image.usingOriginal ? '使用智能裁切图' : '使用原图'}
                                  </button>
                                )}
                                <button type="button" disabled={busy} onClick={() => handleSingleImageDownload(image)}
                                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                                  {singleLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} 单张保存
                                </button>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    ) : (
                      <EmptyState icon={FileImage} title="没有可显示的独立图片"
                        text={result.images.length ? '当前只隐藏了尺寸很小的图标，可勾选“显示小图标”查看。' : '该 PDF 可能只包含文字、矢量图形或无法独立提取的页面内容。'} />
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-4 lg:p-5">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{sourceType === 'images' ? '图片 OCR 文字' : 'PDF 文字层与 OCR 文字'}</h3>
                      <p className="mt-1 text-xs text-gray-500">按{sourceType === 'images' ? '单图' : '页'}保留文字；低可信乱码会留空并提示检查，所有结果都可修改后用于模板 PPT。</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {missingTextPageCount > 0 && (
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600">
                          <input type="checkbox" checked={showEmptyTextPages} onChange={event => setShowEmptyTextPages(event.target.checked)}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-500" />
                          显示无文字页（{missingTextPageCount}）
                        </label>
                      )}
                      <button type="button" disabled={ocrRunning} onClick={handleCopyText}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        <Copy className="h-3.5 w-3.5" /> 复制全部
                      </button>
                      <button type="button" disabled={ocrRunning} onClick={handleTextDownload}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                        <Download className="h-3.5 w-3.5" /> 合并 TXT
                      </button>
                      <button type="button" disabled={busy} onClick={handleTextZip}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-indigo-300">
                        {exporting === 'text-zip' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />} 分页 TXT ZIP
                      </button>
                    </div>
                  </div>

                  {sourceType === 'pdf' && (
                    <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50/70 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="rounded-lg bg-white p-2 text-violet-600 shadow-sm"><ScanText className="h-5 w-5" /></span>
                          <div>
                            <h4 className="text-sm font-semibold text-violet-900">本地 OCR：简体中文 + English</h4>
                            <p className="mt-1 text-xs leading-5 text-violet-700">扫描件、照片和转曲文字可逐页识别；识别后的整页图片会同时加入“图片”列表。</p>
                          </div>
                        </div>
                        {ocrRunning ? (
                          <button type="button" onClick={() => pdfTaskStore.cancelOcr()}
                            className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100">
                            取消 OCR
                          </button>
                        ) : (
                          <button type="button" disabled={!!exporting || (ocrMode === 'missing' && missingTextPageCount === 0)} onClick={handlePdfOcr}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300">
                            <ScanText className="h-3.5 w-3.5" />
                            {ocrMode === 'missing' ? `识别无文字页（${missingTextPageCount}）` : `重新识别全部（${result.pageCount}）`}
                          </button>
                        )}
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <ChoiceButton active={ocrMode === 'missing'} onClick={() => setOcrMode('missing')}>仅识别无文字页（推荐）</ChoiceButton>
                        <ChoiceButton active={ocrMode === 'all'} onClick={() => setOcrMode('all')}>重新识别全部页面</ChoiceButton>
                      </div>
                      {ocrRunning && (
                        <div className="mt-4">
                          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-violet-700">
                            <span>{ocrProgress.stage || '正在 OCR'}</span>
                            <span>{ocrProgress.pageCount ? `${Math.min(ocrProgress.completed + 1, ocrProgress.pageCount)}/${ocrProgress.pageCount}` : '准备中'}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-violet-100">
                            <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${ocrPercent}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {textPageCount === 0 && !ocrRunning && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-700">
                      {sourceType === 'images'
                        ? '这些图片暂未识别到文字。低清晰度、手写字、特殊字体或复杂背景可能影响结果。'
                        : '这个 PDF 没有可复制的文字层。可使用上方“识别无文字页”进行本地 OCR。'}
                    </div>
                  )}

                  <div className="space-y-4">
                    {visibleTextPages.map(page => (
                      <article key={page.pageNumber} className="grid gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-[150px_minmax(0,1fr)]">
                        <div>
                          <p className="mb-2 truncate text-xs font-semibold text-gray-700">
                            {sourceType === 'images' ? page.relativePath || page.originalFileName || `第 ${page.pageNumber} 张` : `第 ${page.pageNumber} 页`}
                          </p>
                          <div className="flex min-h-28 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white p-2">
                            {page.previewUrl
                              ? <img src={page.previewUrl} alt={sourceType === 'images' ? page.originalFileName : `PDF 第 ${page.pageNumber} 页预览`} className="max-h-44 w-auto object-contain" />
                              : <FileText className="h-8 w-8 text-gray-300" />}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label htmlFor={`page-text-${page.pageNumber}`} className="text-xs font-medium text-gray-600">识别文字（可修改）</label>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${page.textSource === 'manual' ? 'bg-emerald-100 text-emerald-700' : page.textSource === 'ocr' && Number.isFinite(page.ocrConfidence) && page.ocrConfidence < 45 && !page.text ? 'bg-amber-100 text-amber-700' : page.textSource === 'ocr' ? 'bg-violet-100 text-violet-700' : 'bg-indigo-100 text-indigo-700'}`}>
                              {page.textSource === 'manual'
                                ? '已修改'
                                : page.textSource === 'ocr' && Number.isFinite(page.ocrConfidence) && page.ocrConfidence < 45 && !page.text
                                  ? `低可信 · ${Math.round(page.ocrConfidence)}%`
                                  : page.textSource === 'ocr'
                                  ? `OCR${Number.isFinite(page.ocrConfidence) ? ` · ${Math.round(page.ocrConfidence)}%` : ''}`
                                  : 'PDF 文字层'}
                            </span>
                          </div>
                          <textarea id={`page-text-${page.pageNumber}`} value={page.text || ''}
                            placeholder="未检测到文字，可在这里手动补充"
                            onChange={event => pdfTaskStore.updatePageText(page.pageNumber, event.target.value)}
                            className="mt-2 min-h-40 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-6 text-gray-700 outline-none focus:border-indigo-300" />
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          <InfoCard title="文字识别范围" text="优先读取 PDF 自带文字层，也可用本地中英文 OCR 识别扫描页、照片和批量图片；无文字页默认隐藏，可按需显示并手工补充。" />
          <InfoCard title="图片识别范围" text="提取 PDF 内嵌栅格图片；大面积统一底色会智能保留最大主图并忽略孤立小装饰，且可随时切回原图。" />
          <InfoCard title="PPT 可编辑范围" text="普通导出保留独立图片对象；模板导出还能把 OCR 结果写入真正的文本框。模板中的背景、Logo、母版和其他页面会继续保留。" />
        </section>
      </main>
      <RewardButton />
    </div>
  )
}

function ToolHeader({ navigate }) {
  return (
    <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 sm:gap-4">
        <img src="/logo.png" alt="TU Scale" className="h-16 w-auto shrink-0 sm:h-18" />
        <div className="mr-auto flex min-w-0 flex-col justify-center">
          <h1 className="truncate text-lg font-bold leading-tight tracking-tight sm:text-xl" style={{ color: '#8040f0' }}>TU Scale 本地图片工具箱-PDF / OCR 提取</h1>
          <p className="mt-2 text-xs font-semibold leading-none text-gray-400 sm:text-sm">PDF 与批量图片本地识别，不上传服务器</p>
        </div>
        <nav className="order-2 flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {TOOL_NAV.map(item => (
            <button key={item.id} type="button" onClick={() => navigate(item.path)}
              className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium ${item.id === 'pdf' ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
    </div>
  )
}

function SettingsSection({ title, children }) {
  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      {children}
    </div>
  )
}

function ChoiceButton({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`rounded-lg border px-2 py-2 text-xs font-semibold ${active ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}>
      {children}
    </button>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-t-lg border-x border-t px-4 py-2.5 text-sm font-semibold ${active ? '-mb-px border-gray-200 bg-white text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
      {children}
    </button>
  )
}

function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-center">
      <Icon className="h-8 w-8 text-gray-300" />
      <p className="mt-3 text-sm font-semibold text-gray-700">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-gray-400">{text}</p>
    </div>
  )
}

function InfoCard({ title, text }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-xs leading-6 text-gray-500">{text}</p>
    </div>
  )
}
