import { useCallback, useEffect, useRef, useState } from 'react'
import { Brush, Eraser, Hand, RotateCcw, Trash2, ZoomIn, ZoomOut } from 'lucide-react'

const MAX_MASK_EDGE = 1200

const getMaskDimensions = (width, height) => {
  const scale = Math.min(1, MAX_MASK_EDGE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

const drawStroke = (ctx, stroke) => {
  if (!stroke?.points?.length) return
  const minEdge = Math.min(ctx.canvas.width, ctx.canvas.height)
  ctx.save()
  ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over'
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.62)'
  ctx.fillStyle = 'rgba(239, 68, 68, 0.62)'
  ctx.lineWidth = Math.max(4, minEdge * stroke.size / 100)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const first = stroke.points[0]
  const firstX = first.x * ctx.canvas.width
  const firstY = first.y * ctx.canvas.height
  if (stroke.points.length === 1) {
    ctx.beginPath()
    ctx.arc(firstX, firstY, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(firstX, firstY)
    for (let index = 1; index < stroke.points.length; index++) {
      const point = stroke.points[index]
      ctx.lineTo(point.x * ctx.canvas.width, point.y * ctx.canvas.height)
    }
    ctx.stroke()
  }
  ctx.restore()
}

export default function MoireMaskEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  maskCanvasRef,
  onMaskChange,
}) {
  const canvasRef = useRef(null)
  const stageRef = useRef(null)
  const strokesRef = useRef([])
  const activeStrokeRef = useRef(null)
  const drawingRef = useRef(false)
  const [mode, setMode] = useState('paint')
  const [brushSize, setBrushSize] = useState(7)
  const [strokeCount, setStrokeCount] = useState(0)
  const [cursor, setCursor] = useState(null)
  const [zoom, setZoom] = useState(1)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    strokesRef.current.forEach(stroke => drawStroke(ctx, stroke))
  }, [])

  const canvasHasMask = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return false
    const alpha = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    for (let index = 3; index < alpha.length; index += 4) {
      if (alpha[index] > 2) return true
    }
    return false
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imageWidth || !imageHeight) return
    const dims = getMaskDimensions(imageWidth, imageHeight)
    canvas.width = dims.width
    canvas.height = dims.height
    strokesRef.current = []
    activeStrokeRef.current = null
    drawingRef.current = false
    maskCanvasRef.current = canvas
    redraw()
    setStrokeCount(0)
    setZoom(1)
    onMaskChange(false)
    return () => {
      if (maskCanvasRef.current === canvas) maskCanvasRef.current = null
    }
  }, [imageUrl, imageWidth, imageHeight, maskCanvasRef, onMaskChange, redraw])

  const pointFromEvent = useCallback((event) => {
    const stage = stageRef.current
    if (!stage) return null
    const rect = stage.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      displayX: event.clientX - rect.left,
      displayY: event.clientY - rect.top,
      displayRadius: Math.min(rect.width, rect.height) * brushSize / 200,
    }
  }, [brushSize])

  const updateCursor = useCallback((event) => {
    const point = pointFromEvent(event)
    if (!point) return
    setCursor({
      x: point.displayX,
      y: point.displayY,
      radius: point.displayRadius,
    })
  }, [pointFromEvent])

  const drawActiveSegment = useCallback(() => {
    const canvas = canvasRef.current
    const stroke = activeStrokeRef.current
    if (!canvas || !stroke) return
    redraw()
    drawStroke(canvas.getContext('2d'), stroke)
  }, [redraw])

  const startDrawing = useCallback((event) => {
    if (mode === 'pan') return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const point = pointFromEvent(event)
    if (!point) return
    drawingRef.current = true
    activeStrokeRef.current = {
      mode,
      size: brushSize,
      points: [{ x: point.x, y: point.y }],
    }
    updateCursor(event)
    drawActiveSegment()
  }, [brushSize, drawActiveSegment, mode, pointFromEvent, updateCursor])

  const moveDrawing = useCallback((event) => {
    if (mode === 'pan') {
      setCursor(null)
      return
    }
    updateCursor(event)
    if (!drawingRef.current || !activeStrokeRef.current) return
    const point = pointFromEvent(event)
    if (!point) return
    const points = activeStrokeRef.current.points
    const previous = points[points.length - 1]
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.002) return
    points.push({ x: point.x, y: point.y })
    drawActiveSegment()
  }, [drawActiveSegment, mode, pointFromEvent, updateCursor])

  const stopDrawing = useCallback((event) => {
    if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!drawingRef.current || !activeStrokeRef.current) return
    drawingRef.current = false
    strokesRef.current.push(activeStrokeRef.current)
    activeStrokeRef.current = null
    redraw()
    setStrokeCount(strokesRef.current.length)
    onMaskChange(canvasHasMask())
  }, [canvasHasMask, onMaskChange, redraw])

  const undo = useCallback(() => {
    if (!strokesRef.current.length) return
    strokesRef.current.pop()
    redraw()
    setStrokeCount(strokesRef.current.length)
    onMaskChange(canvasHasMask())
  }, [canvasHasMask, onMaskChange, redraw])

  const clear = useCallback(() => {
    strokesRef.current = []
    activeStrokeRef.current = null
    redraw()
    setStrokeCount(0)
    onMaskChange(false)
  }, [onMaskChange, redraw])

  return (
    <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setMode('paint')}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${mode === 'paint' ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-600'}`}>
          <Brush className="h-3.5 w-3.5" /> 涂抹处理区域
        </button>
        <button type="button" onClick={() => setMode('erase')}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${mode === 'erase' ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-600'}`}>
          <Eraser className="h-3.5 w-3.5" /> 橡皮擦
        </button>
        <button type="button" onClick={() => {
          setMode('pan')
          setCursor(null)
        }}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${mode === 'pan' ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-600'}`}>
          <Hand className="h-3.5 w-3.5" /> 移动图片
        </button>
        <button type="button" onClick={undo} disabled={!strokeCount}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 disabled:cursor-not-allowed disabled:opacity-40">
          <RotateCcw className="h-3.5 w-3.5" /> 撤销
        </button>
        <button type="button" onClick={clear} disabled={!strokeCount}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 disabled:cursor-not-allowed disabled:opacity-40">
          <Trash2 className="h-3.5 w-3.5" /> 清空
        </button>
        <span className="sr-only" aria-live="polite">已记录 {strokeCount} 次涂抹</span>
      </div>

      <label className="mb-3 flex items-center gap-3 text-xs text-gray-600">
        <span className="whitespace-nowrap">画笔大小</span>
        <input type="range" min="2" max="18" step="1" value={brushSize}
          onChange={event => setBrushSize(Number(event.target.value))}
          className="h-1.5 flex-1 cursor-pointer accent-red-500" />
        <span className="w-8 text-right font-medium text-gray-500">{brushSize}%</span>
      </label>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-gray-600">图片缩放</span>
        <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-1">
          <button type="button" onClick={() => setZoom(value => Math.max(1, value - 0.5))}
            disabled={zoom <= 1} aria-label="缩小涂抹图片"
            className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-35">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setZoom(1)}
            aria-label="恢复涂抹图片到百分之百"
            className="min-w-14 rounded-md px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => setZoom(value => Math.min(3, value + 0.5))}
            disabled={zoom >= 3} aria-label="放大涂抹图片"
            className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-35">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="max-h-[620px] overflow-auto rounded-xl bg-gray-900">
        <div ref={stageRef}
          className={`relative mx-auto overflow-hidden border border-gray-200 bg-gray-900 select-none ${mode === 'pan' ? 'cursor-grab touch-pan-x touch-pan-y' : 'touch-none'}`}
          style={{
            width: imageWidth && imageHeight
              ? `min(${Math.round(zoom * 100)}%, ${Math.round(Math.min(768, 620 * imageWidth / imageHeight) * zoom)}px)`
              : `${Math.round(zoom * 100)}%`,
          }}
          onPointerDown={startDrawing}
          onPointerMove={moveDrawing}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
          onPointerLeave={() => {
            if (!drawingRef.current) setCursor(null)
          }}>
          <img src={imageUrl} alt="局部彩色摩尔纹涂抹预览"
            className="block h-auto w-full" draggable={false} />
          <canvas ref={canvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full" />
          {cursor && (
            <span className={`pointer-events-none absolute rounded-full border-2 ${mode === 'paint' ? 'border-red-500 bg-red-500/10' : 'border-indigo-500 bg-indigo-500/10'}`}
              style={{
                left: cursor.x - cursor.radius,
                top: cursor.y - cursor.radius,
                width: cursor.radius * 2,
                height: cursor.radius * 2,
              }} />
          )}
        </div>
      </div>
      {zoom > 1 && (
        <p className="mt-1.5 text-[10px] text-indigo-600">图片已放大，可使用滚动条或触控板移动到需要涂抹的位置。</p>
      )}
      <p className="mt-2 text-[11px] leading-5 text-gray-500">
        红色区域会重点修复彩色杂色和宽幅粉青色波纹，并保留原始亮度、针织纹理与真实褶皱。尽量不要覆盖需要保留原色的印花边缘。
      </p>
    </div>
  )
}
