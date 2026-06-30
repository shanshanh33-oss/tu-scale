import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle, Copy, Download, FileDown, FolderOpen, Image as ImageIcon, Loader2, RefreshCw, Upload, X } from 'lucide-react'
import JSZip from 'jszip'
import { canvasToBlob, downloadBlob, formatBytes, getBaseName, readFileAsDataUrl, readImage, revokeObjectUrl, trackEvent } from './shared'
import RewardButton from './RewardButton'

const OUTPUTS = [
  { id: 'jpeg', label: 'JPG', mime: 'image/jpeg', ext: 'jpg', quality: true, note: '适合照片和普通配图，体积小，不支持透明背景。' },
  { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png', quality: false, note: '适合透明背景、图标、截图，体积通常更大。' },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', quality: true, note: '适合网页使用，画质和体积平衡好。' },
  { id: 'avif', label: 'AVIF', mime: 'image/avif', ext: 'avif', quality: true, note: '压缩率高，但部分浏览器或平台兼容性较弱。' },
]

const INPUT_FORMATS = [
  'JPG / JPEG / JFIF',
  'PNG',
  'WebP',
  'GIF（导出首帧）',
  'BMP',
  'SVG',
  'AVIF',
  'ICO',
  'HEIC / HEIF（取决于浏览器支持）',
  'TIFF / TIF（取决于浏览器支持）',
]

const OUTPUT_FORMATS = ['JPG', 'PNG', 'WebP', 'AVIF']

const FORMAT_FAQ = [
  ['格式转换免费吗？', '目前可以免费使用，无需登录，支持多选图片和文件夹批量转换。'],
  ['转换图片会上传吗？', '不会。图片读取、转换和导出都在浏览器本地完成，TU Scale 不收集图片内容。'],
  ['JPG、PNG、WebP 怎么选？', '照片和普通配图常用 JPG；透明背景和截图适合 PNG；网页展示推荐 WebP，体积通常更小。'],
  ['为什么有些 HEIC/TIFF 不能读取？', '这些格式依赖浏览器自身解码能力，不同浏览器支持不完全一致，可以换 Chrome 或先转成 JPG/PNG。'],
]

let converterId = 0

export default function FormatConverter({ navigate }) {
  const fileRef = useRef(null)
  const folderRef = useRef(null)
  const [items, setItems] = useState([])
  const [format, setFormat] = useState('webp')
  const [quality, setQuality] = useState(88)
  const [transparentBg, setTransparentBg] = useState('#ffffff')
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('')
  const [shareNotice, setShareNotice] = useState('')

  const output = useMemo(() => OUTPUTS.find(item => item.id === format) || OUTPUTS[0], [format])
  const doneItems = items.filter(item => item.status === 'done' && item.blob)

  useEffect(() => {
    if (folderRef.current) folderRef.current.setAttribute('webkitdirectory', '')
  }, [])

  const addFiles = useCallback(async (fileList) => {
    const imageFiles = Array.from(fileList || []).filter(file => file.type.startsWith('image/') || /\.(jpg|jpeg|jfif|png|webp|gif|bmp|svg|avif|ico|heic|heif|tif|tiff)$/i.test(file.name))
    if (imageFiles.length === 0) return
    trackEvent('image_uploaded', { tool: 'converter', mode: 'converter', count: imageFiles.length })

    const incoming = imageFiles.map(file => ({
      id: ++converterId,
      file,
      preview: null,
      width: 0,
      height: 0,
      status: 'loading',
      error: '',
      blob: null,
      url: null,
      size: 0,
    }))
    setItems(prev => [...prev, ...incoming])
    setMessage('')

    for (const item of incoming) {
      try {
        const dataUrl = await readFileAsDataUrl(item.file)
        const img = await readImage(dataUrl)
        setItems(prev => prev.map(current => current.id === item.id
          ? { ...current, preview: dataUrl, width: img.width, height: img.height, status: 'ready' }
          : current
        ))
      } catch {
        setItems(prev => prev.map(current => current.id === item.id
          ? { ...current, status: 'error', error: '当前浏览器无法解码这种图片格式' }
          : current
        ))
      }
    }
  }, [])

  const removeItem = (id) => {
    setItems(prev => {
      const target = prev.find(item => item.id === id)
      if (target) revokeObjectUrl(target.url)
      return prev.filter(item => item.id !== id)
    })
  }

  const clearItems = () => {
    items.forEach(item => revokeObjectUrl(item.url))
    setItems([])
    setMessage('')
  }

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
        addFiles(allFiles)
      } else {
        folderRef.current?.click()
      }
    } catch (error) {
      if (error?.name !== 'AbortError') folderRef.current?.click()
    }
  }, [addFiles])

  const convertOne = async (item) => {
    const img = await readImage(item.preview)
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')

    if (output.id === 'jpeg') {
      ctx.fillStyle = transparentBg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0)
    const blob = await canvasToBlob(canvas, output.mime, output.quality ? quality / 100 : undefined)
    return {
      blob,
      url: URL.createObjectURL(blob),
      size: blob.size,
    }
  }

  const convertAll = async () => {
    const ready = items.filter(item => item.status === 'ready' || item.status === 'done')
    if (ready.length === 0) {
      setMessage('请先上传可转换的图片')
      return
    }

    setProcessing(true)
    setMessage('')
    trackEvent('process_start', { tool: 'converter', mode: 'converter', count: ready.length, format })

    for (const item of ready) {
      setItems(prev => prev.map(current => current.id === item.id ? { ...current, status: 'processing', error: '' } : current))
      try {
        const result = await convertOne(item)
        setItems(prev => prev.map(current => {
          if (current.id !== item.id) return current
          revokeObjectUrl(current.url)
          return { ...current, status: 'done', blob: result.blob, url: result.url, size: result.size }
        }))
        trackEvent('process_success', { tool: 'converter', mode: 'converter', format })
      } catch {
        setItems(prev => prev.map(current => current.id === item.id
          ? { ...current, status: 'error', error: '转换失败，请换一种输出格式' }
          : current
        ))
        trackEvent('process_error', { tool: 'converter', mode: 'converter', format })
      }
    }

    setProcessing(false)
  }

  const downloadOne = (item) => {
    if (!item.blob) return
    trackEvent('download', { tool: 'converter', mode: 'converter_single', format })
    downloadBlob(item.blob, `${getBaseName(item.file.name)}.${output.ext}`)
  }

  const downloadZip = async () => {
    if (doneItems.length === 0) return
    trackEvent('download_zip', { tool: 'converter', count: doneItems.length, format })
    const zip = new JSZip()
    doneItems.forEach(item => {
      zip.file(`${getBaseName(item.file.name)}.${output.ext}`, item.blob)
    })
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    downloadBlob(zipBlob, `tuscale_converted_${doneItems.length}.zip`)
  }

  const handleCopyPageLink = async () => {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setShareNotice('页面链接已复制')
    } catch {
      setShareNotice('复制失败，可以手动复制浏览器地址栏链接')
    }
    setTimeout(() => setShareNotice(''), 2200)
  }

  return (
    <div className="min-h-screen bg-gray-50/80">
      <ToolHeader active="converter" navigate={navigate} />
      <main className="max-w-6xl mx-auto px-4 py-6 pb-20 space-y-5">
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">本地图片格式转换</h1>
              <p className="text-sm text-gray-500 mt-1">批量转换 JPG、PNG、WebP、AVIF 等格式，图片在浏览器本地处理。</p>
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

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
            <div className="border-2 border-dashed border-gray-200 rounded-xl min-h-60 p-4"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}>
              {items.length === 0 ? (
                <div className="h-52 flex flex-col items-center justify-center text-center text-gray-400">
                  <ImageIcon className="w-10 h-10 mb-3 text-indigo-300" />
                  <p className="text-sm font-medium text-gray-600">拖拽图片到这里，或上传图片/文件夹</p>
                  <p className="text-xs mt-1">支持多选和文件夹，转换过程不上传服务器</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {items.map(item => (
                    <div key={item.id} className="relative border border-gray-200 rounded-lg bg-gray-50 overflow-hidden group">
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
                        {item.status === 'done' && <p className="text-[9px] text-indigo-600">已转换 · {formatBytes(item.size)}</p>}
                        {item.status === 'error' && <p className="text-[9px] text-red-500 truncate">{item.error}</p>}
                      </div>
                      <button onClick={() => removeItem(item.id)}
                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/45 text-white hidden group-hover:flex items-center justify-center">
                        <X className="w-3.5 h-3.5" />
                      </button>
                      {item.status === 'done' && (
                        <button onClick={() => downloadOne(item)}
                          className="absolute bottom-2 right-2 w-7 h-7 rounded-lg bg-white shadow border border-gray-200 text-indigo-600 flex items-center justify-center">
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
                <h2 className="text-sm font-semibold text-gray-800">输出格式</h2>
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
                    <span className="text-xs font-medium text-gray-500">质量 {quality}%</span>
                    <input type="range" min="40" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))}
                      className="w-full accent-indigo-600" />
                  </label>
                )}
                {output.id === 'jpeg' && (
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-gray-500">透明背景填充色</span>
                    <input type="color" value={transparentBg} onChange={(event) => setTransparentBg(event.target.value)}
                      className="w-full h-10 rounded-lg border border-gray-200 bg-white" />
                  </label>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2">
                <button onClick={convertAll} disabled={processing || items.length === 0}
                  className="inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold">
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} 开始转换
                </button>
                <button onClick={downloadZip} disabled={doneItems.length === 0}
                  className="inline-flex items-center justify-center gap-2 py-2.5 rounded-lg border border-indigo-200 bg-indigo-50 disabled:bg-gray-100 disabled:text-gray-400 text-indigo-700 text-sm font-semibold">
                  <FileDown className="w-4 h-4" /> 下载 ZIP
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
                <p className="text-sm font-semibold text-gray-800">转换完成，可以收藏下次再用</p>
                <p className="text-xs leading-5 text-gray-500">复制链接后可以发给自己，或保存到常用笔记里。</p>
              </div>
            </div>
            <button onClick={handleCopyPageLink}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-100">
              <Copy className="w-3.5 h-3.5" /> 复制页面链接
            </button>
            {shareNotice && <p className="text-xs text-indigo-600 sm:self-center">{shareNotice}</p>}
          </section>
        )}

        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">格式支持说明</h2>
            <p className="text-xs text-gray-500 mt-1">当前输出格式为 4 种；读取格式由浏览器解码能力决定。</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-semibold text-gray-700 mb-2">可导出格式</h3>
              <div className="grid grid-cols-2 gap-2">
                {OUTPUT_FORMATS.map(item => (
                  <div key={item} className="px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-100 text-xs font-semibold text-indigo-700">{item}</div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-gray-700 mb-2">可尝试读取格式</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {INPUT_FORMATS.map(item => (
                  <div key={item} className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 text-xs text-gray-600">{item}</div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">常见问题</h2>
            <p className="text-xs text-gray-500 mt-1">关于免费使用、隐私和格式选择。</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FORMAT_FAQ.map(([question, answer]) => (
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
    { id: 'converter', label: '格式转换', path: '/format-converter' },
    { id: 'contact', label: '反馈联系', path: '/contact' },
  ]

  return (
    <header className="bg-white/95 backdrop-blur-sm border-b border-gray-100 px-6 py-3 sticky top-0 z-10 shadow-sm">
      <div className="max-w-6xl mx-auto flex items-center gap-4">
        <img src="/logo.png" alt="TU Scale" className="h-16 sm:h-18 w-auto shrink-0" />
        <div className="flex flex-col min-w-0 mr-auto">
          <div className="flex flex-col gap-2 min-w-0">
            <div className="text-lg sm:text-xl font-bold tracking-tight truncate" style={{ color: '#8040f0' }}>TU Scale 本地图片工具箱-图片格式转换</div>
            <div className="text-[10px] text-gray-400 leading-none">图片本地处理，不上传服务器</div>
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto">
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
