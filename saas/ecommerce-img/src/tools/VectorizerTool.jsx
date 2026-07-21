import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ImageTracer from 'imagetracerjs'
import {
  AlertTriangle,
  Download,
  FileCode2,
  Image as ImageIcon,
  Loader2,
  Palette,
  PenTool,
  RotateCcw,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import RewardButton from './RewardButton'
import { downloadBlob, formatBytes, readImage, revokeObjectUrl } from './shared'

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_TRACE_EDGE = 1600
const MAX_TRACE_PIXELS = 1_600_000
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp', 'image/x-ms-bmp'])
const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|webp|bmp)$/i

const TOOL_NAV = [
  { id: 'upscale', label: '图片放大', path: '/' },
  { id: 'converter', label: '图片压缩', path: '/format-converter' },
  { id: 'product-image', label: '商品图规范化', path: '/product-image' },
  { id: 'contact', label: '反馈联系', path: '/contact' },
]

const MODE_OPTIONS = [
  {
    id: 'line',
    title: '黑白线稿',
    description: '适合签名、印章、黑白 Logo、线稿和扫描图。',
    icon: PenTool,
  },
  {
    id: 'color',
    title: '彩色简化',
    description: '适合图标、贴纸、扁平插画和少色 Logo。',
    icon: Palette,
  },
]

const fileBaseName = (name) => name.replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '') || 'tuscale-vector'

const getTraceScale = (width, height) => Math.min(
  1,
  MAX_TRACE_EDGE / Math.max(width, height),
  Math.sqrt(MAX_TRACE_PIXELS / (width * height)),
)

const getTraceOptions = ({ mode, colors, detail, smoothing, preserveTransparency }) => {
  const detailRatio = detail / 100
  const blurRadius = Math.round(smoothing / 20)
  const common = {
    ltres: Number((2.6 - detailRatio * 2.2).toFixed(2)),
    qtres: Number((2.6 - detailRatio * 2.2).toFixed(2)),
    pathomit: Math.max(1, Math.round(22 - detailRatio * 21)),
    rightangleenhance: true,
    colorsampling: mode === 'line' ? 0 : 2,
    numberofcolors: mode === 'line' ? (preserveTransparency ? 3 : 2) : colors,
    mincolorratio: mode === 'line' ? 0 : 0.01,
    colorquantcycles: mode === 'line' ? 1 : 3,
    layering: 0,
    strokewidth: 0,
    linefilter: smoothing >= 65,
    scale: 1,
    roundcoords: 2,
    viewbox: true,
    desc: false,
    blurradius: blurRadius,
    blurdelta: Math.round(24 + smoothing * 1.4),
  }

  if (mode === 'line') {
    common.pal = [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
    ]
    if (preserveTransparency) common.pal.push({ r: 0, g: 0, b: 0, a: 0 })
  }
  return common
}

const applyLineThreshold = (imageData, threshold, preserveTransparency) => {
  const pixels = imageData.data
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]
    if (preserveTransparency && alpha < 24) {
      pixels[index] = 0
      pixels[index + 1] = 0
      pixels[index + 2] = 0
      pixels[index + 3] = 0
      continue
    }
    const luminance = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722
    const value = luminance < threshold ? 0 : 255
    pixels[index] = value
    pixels[index + 1] = value
    pixels[index + 2] = value
    pixels[index + 3] = 255
  }
  return imageData
}

const sanitizeGeneratedSvg = (svg) => {
  const documentNode = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (documentNode.querySelector('parsererror') || documentNode.documentElement.nodeName.toLowerCase() !== 'svg') {
    throw new Error('SVG_PARSE_FAILED')
  }

  documentNode.querySelectorAll('script, foreignObject, iframe, object, embed').forEach(node => node.remove())
  documentNode.querySelectorAll('*').forEach(node => {
    Array.from(node.attributes).forEach(attribute => {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.toLowerCase()
      if (name.startsWith('on') || name === 'href' || name === 'xlink:href' || value.includes('javascript:')) {
        node.removeAttribute(attribute.name)
      }
    })
  })
  const root = documentNode.documentElement
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(root)
}

const countSvgPaths = (svg) => (svg.match(/<path\b/g) || []).length

export default function VectorizerTool({ navigate }) {
  const fileInputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceDims, setSourceDims] = useState(null)
  const [mode, setMode] = useState('line')
  const [colors, setColors] = useState(8)
  const [threshold, setThreshold] = useState(150)
  const [detail, setDetail] = useState(55)
  const [smoothing, setSmoothing] = useState(35)
  const [preserveTransparency, setPreserveTransparency] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [svgResult, setSvgResult] = useState(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => () => revokeObjectUrl(sourceUrl), [sourceUrl])
  useEffect(() => () => revokeObjectUrl(svgResult?.url), [svgResult])

  const resetResult = useCallback(() => {
    setSvgResult(current => {
      revokeObjectUrl(current?.url)
      return null
    })
  }, [])

  useEffect(() => {
    resetResult()
  }, [colors, detail, mode, preserveTransparency, resetResult, smoothing, threshold])

  const resetAll = useCallback(() => {
    revokeObjectUrl(sourceUrl)
    revokeObjectUrl(svgResult?.url)
    setFile(null)
    setSourceUrl('')
    setSourceDims(null)
    setSvgResult(null)
    setError('')
    setNotice('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [sourceUrl, svgResult])

  const acceptFile = useCallback(async (nextFile) => {
    setError('')
    setNotice('')
    if (!nextFile) return
    if (!ACCEPTED_TYPES.has(nextFile.type) && !ACCEPTED_EXTENSIONS.test(nextFile.name)) {
      setError('首版支持 JPG、PNG、WebP 和 BMP 图片。')
      return
    }
    if (nextFile.size > MAX_FILE_BYTES) {
      setError('图片超过 25MB，请先压缩后再转换。')
      return
    }

    const nextUrl = URL.createObjectURL(nextFile)
    try {
      const image = await readImage(nextUrl)
      revokeObjectUrl(sourceUrl)
      resetResult()
      setFile(nextFile)
      setSourceUrl(nextUrl)
      setSourceDims({ width: image.naturalWidth, height: image.naturalHeight })
      const traceScale = getTraceScale(image.naturalWidth, image.naturalHeight)
      if (traceScale < 1) {
        setNotice(`原图较大，矢量化时会缩至约 ${Math.round(image.naturalWidth * traceScale)}×${Math.round(image.naturalHeight * traceScale)}，避免浏览器卡顿。`)
      }
    } catch {
      revokeObjectUrl(nextUrl)
      setError('无法读取这张图片，请换用 JPG、PNG、WebP 或 BMP。')
    }
  }, [resetResult, sourceUrl])

  const handleInput = useCallback((event) => {
    acceptFile(event.target.files?.[0])
    event.target.value = ''
  }, [acceptFile])

  const handleDrop = useCallback((event) => {
    event.preventDefault()
    setDragging(false)
    acceptFile(event.dataTransfer.files?.[0])
  }, [acceptFile])

  const handleVectorize = useCallback(async () => {
    if (!file || !sourceUrl || processing) return
    setProcessing(true)
    setError('')
    setNotice('')
    resetResult()

    try {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const image = await readImage(sourceUrl)
      const traceScale = getTraceScale(image.naturalWidth, image.naturalHeight)
      const scaleNotice = traceScale < 1
        ? `原图较大，已按约 ${Math.round(image.naturalWidth * traceScale)}×${Math.round(image.naturalHeight * traceScale)} 生成 SVG，避免浏览器卡顿。`
        : ''
      const width = Math.max(1, Math.round(image.naturalWidth * traceScale))
      const height = Math.max(1, Math.round(image.naturalHeight * traceScale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('CANVAS_UNAVAILABLE')
      if (!preserveTransparency) {
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, width, height)
      }
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, width, height)

      let imageData = context.getImageData(0, 0, width, height)
      if (mode === 'line') imageData = applyLineThreshold(imageData, threshold, preserveTransparency)
      const options = getTraceOptions({ mode, colors, detail, smoothing, preserveTransparency })
      const rawSvg = ImageTracer.imagedataToSVG(imageData, options)
      const safeSvg = sanitizeGeneratedSvg(rawSvg)
      const blob = new Blob([safeSvg], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const pathCount = countSvgPaths(safeSvg)
      setSvgResult({
        blob,
        url,
        width,
        height,
        pathCount,
        fileName: `${fileBaseName(file.name)}-${mode === 'line' ? 'line' : 'color'}.svg`,
      })
      if (pathCount > 5000 || blob.size > 2 * 1024 * 1024) {
        setNotice('结果路径较多或文件较大。可降低细节、减少颜色或提高平滑度后重新生成。')
      } else {
        setNotice(scaleNotice)
      }
    } catch (cause) {
      console.error('Vectorization failed:', cause)
      setError('转换失败。请尝试降低图片尺寸、减少颜色或提高平滑度。')
    } finally {
      setProcessing(false)
    }
  }, [colors, detail, file, mode, preserveTransparency, processing, resetResult, smoothing, sourceUrl, threshold])

  const resultSummary = useMemo(() => {
    if (!svgResult) return ''
    return `${svgResult.width}×${svgResult.height} · ${svgResult.pathCount.toLocaleString()} 条路径 · ${formatBytes(svgResult.blob.size)}`
  }, [svgResult])

  return (
    <div className="min-h-screen bg-gray-50/80">
      <ToolHeader navigate={navigate} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 pb-24">
        <section className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <p className="text-sm font-semibold text-indigo-800">适合 Logo、图标、签名、线稿和扁平插画</p>
          <p className="mt-1 text-xs leading-5 text-indigo-600">图片只在当前浏览器处理，不上传服务器。人像和照片通常不适合转矢量图。</p>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
          <div className="space-y-5">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold text-gray-900">图片转 SVG <span className="text-sm font-medium text-indigo-500">测试版</span></h1>
                  <p className="mt-1 text-xs leading-5 text-gray-500">选择图片后调整参数，再生成可缩放的 SVG 文件。</p>
                </div>
                {file && (
                  <button type="button" onClick={resetAll}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                    <RotateCcw className="h-3.5 w-3.5" /> 重新选择
                  </button>
                )}
              </div>

              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/bmp" className="hidden" onChange={handleInput} />
              {!file ? (
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)}
                  onDragOver={event => event.preventDefault()} onDrop={handleDrop}
                  className={`flex min-h-64 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 text-center transition-colors ${dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 bg-gray-50/60 hover:border-indigo-300 hover:bg-indigo-50/40'}`}>
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                    <Upload className="h-6 w-6" />
                  </span>
                  <span className="mt-4 text-sm font-semibold text-gray-900">点击或拖入一张图片</span>
                  <span className="mt-2 text-xs leading-5 text-gray-500">JPG、PNG、WebP、BMP · 最大 25MB</span>
                </button>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-[linear-gradient(45deg,#f3f4f6_25%,transparent_25%),linear-gradient(-45deg,#f3f4f6_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f3f4f6_75%),linear-gradient(-45deg,transparent_75%,#f3f4f6_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]">
                  <div className="flex min-h-64 items-center justify-center p-4">
                    <img src={sourceUrl} alt="待转换原图" className="max-h-[420px] max-w-full object-contain" />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-white px-4 py-3 text-xs text-gray-500">
                    <span className="max-w-full truncate font-medium text-gray-700">{file.name}</span>
                    <span>{sourceDims?.width}×{sourceDims?.height} · {formatBytes(file.size)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900">转换设置</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {MODE_OPTIONS.map(option => {
                  const Icon = option.icon
                  return (
                    <button key={option.id} type="button" onClick={() => { setMode(option.id); resetResult() }}
                      className={`rounded-xl border p-4 text-left transition-colors ${mode === option.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-200 hover:bg-gray-50'}`}>
                      <span className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Icon className="h-4 w-4 text-indigo-500" /> {option.title}</span>
                      <span className="mt-2 block text-xs leading-5 text-gray-500">{option.description}</span>
                    </button>
                  )
                })}
              </div>

              <div className="mt-5 space-y-5 border-t border-gray-100 pt-5">
                {mode === 'color' ? (
                  <RangeControl label="颜色数量" value={colors} min={4} max={32} step={1} valueText={`${colors} 色`} onChange={setColors}
                    help="颜色越多越接近原图，但路径和文件体积也会增加。" />
                ) : (
                  <RangeControl label="黑白阈值" value={threshold} min={40} max={220} step={1} valueText={String(threshold)} onChange={setThreshold}
                    help="数值越高，更多区域会变成黑色；适合调整浅色线条。" />
                )}
                <RangeControl label="细节程度" value={detail} min={10} max={100} step={5} valueText={`${detail}%`} onChange={setDetail}
                  help="细节越高路径越多。Logo 建议 40–65%，复杂插画建议从 55% 开始。" />
                <RangeControl label="平滑程度" value={smoothing} min={0} max={100} step={5} valueText={`${smoothing}%`} onChange={setSmoothing}
                  help="提高平滑度可减少锯齿和零碎路径，但可能损失小字和尖角。" />
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-4">
                  <input type="checkbox" checked={preserveTransparency} onChange={event => { setPreserveTransparency(event.target.checked); resetResult() }} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                  <span>
                    <span className="block text-sm font-semibold text-gray-800">保留透明背景</span>
                    <span className="mt-1 block text-xs leading-5 text-gray-500">透明 PNG 建议开启；关闭后会先铺白色背景。</span>
                  </span>
                </label>
              </div>

              <button type="button" onClick={handleVectorize} disabled={!file || processing}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300">
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode2 className="h-4 w-4" />}
                {processing ? '正在生成 SVG…' : '生成 SVG'}
              </button>

              {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{error}</p>}
              {notice && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">{notice}</p>}
            </div>
          </div>

          <div className="space-y-5 lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">SVG 结果预览</h2>
                  <p className="mt-1 text-xs text-gray-500">请放大检查边缘、文字和小图形。</p>
                </div>
                {svgResult && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">已生成</span>}
              </div>

              <div className="mt-4 flex min-h-[360px] items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white p-4">
                {processing ? (
                  <div className="text-center text-gray-500">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-500" />
                    <p className="mt-3 text-sm font-semibold">正在分析颜色和轮廓</p>
                    <p className="mt-1 text-xs">复杂图片可能需要几秒钟</p>
                  </div>
                ) : svgResult ? (
                  <img src={svgResult.url} alt="生成的 SVG 预览" className="max-h-[520px] max-w-full object-contain" />
                ) : (
                  <div className="max-w-xs text-center text-gray-400">
                    <ImageIcon className="mx-auto h-10 w-10" />
                    <p className="mt-3 text-sm font-semibold text-gray-500">生成后在这里预览</p>
                    <p className="mt-1 text-xs leading-5">建议先用黑白 Logo、图标或扁平插画测试。</p>
                  </div>
                )}
              </div>

              {svgResult && (
                <div className="mt-4 animate-fade-in">
                  <p className="text-xs leading-5 text-gray-500">{resultSummary}</p>
                  <button type="button" onClick={() => downloadBlob(svgResult.blob, svgResult.fileName)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700">
                    <Download className="h-4 w-4" /> 下载 SVG
                  </button>
                </div>
              )}
            </div>

            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900">首版使用说明</h2>
              <div className="mt-3 space-y-3 text-xs leading-5 text-gray-500">
                <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> 图片和生成结果均保留在本地浏览器，不调用付费 API。</p>
                <p className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> 照片、人像、渐变和复杂纹理会产生大量路径，通常不适合矢量化。</p>
                <p className="flex gap-2"><FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" /> SVG 可继续在 Figma、Illustrator 或 Inkscape 中编辑。</p>
              </div>
            </section>
          </div>
        </section>
      </main>
      <RewardButton />
    </div>
  )
}

function RangeControl({ label, value, min, max, step, valueText, onChange, help }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-3 text-sm font-semibold text-gray-800">
        <span>{label}</span>
        <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">{valueText}</span>
      </span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))}
        className="mt-3 w-full accent-indigo-600" aria-label={label} />
      <span className="mt-1 block text-xs leading-5 text-gray-500">{help}</span>
    </label>
  )
}

function ToolHeader({ navigate }) {
  return (
    <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 sm:gap-4">
        <img src="/logo.png" alt="TU Scale" className="h-16 w-auto shrink-0 sm:h-18" />
        <div className="mr-auto flex min-w-0 flex-col justify-center">
          <h1 className="truncate text-lg font-bold leading-tight tracking-tight sm:text-xl" style={{ color: '#8040f0' }}>TU Scale 本地图片工具箱-图片转 SVG</h1>
          <p className="mt-2 text-xs font-semibold leading-none text-gray-400 sm:text-sm">本地矢量化，不上传服务器</p>
        </div>
        <nav className="order-2 flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {TOOL_NAV.map(item => (
            <button key={item.id} type="button" onClick={() => navigate(item.path)}
              className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium ${item.id === 'vectorizer' ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}
