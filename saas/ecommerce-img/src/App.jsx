import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { Upload, Download, ZoomIn, Maximize2, Loader2, Sparkles, X, Image as ImageIcon } from 'lucide-react'

const TARGET_PRESETS = [
  { w: 1920, h: 1080, label: 'Full HD', ratio: '16:9' },
  { w: 2560, h: 1440, label: '2K', ratio: '16:9' },
  { w: 3840, h: 2160, label: '4K', ratio: '16:9' },
  { w: 7680, h: 4320, label: '8K', ratio: '16:9' },
]

function App() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [origDims, setOrigDims] = useState(null)

  const [upscaleMode, setUpscaleMode] = useState('scale')
  const [scale, setScale] = useState(2)
  const [targetMode, setTargetMode] = useState('preset')
  const [targetIdx, setTargetIdx] = useState(2)
  const [customW, setCustomW] = useState(2048)
  const [customH, setCustomH] = useState(2048)
  const [format, setFormat] = useState('png')
  const [keepRatio, setKeepRatio] = useState(true)
  const [enhance, setEnhance] = useState(true)

  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [resultDims, setResultDims] = useState(null)
  const [resultSize, setResultSize] = useState(null)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [compareZoom, setCompareZoom] = useState(1)
  const fileRef = useRef(null)
  const leftScrollRef = useRef(null)
  const rightScrollRef = useRef(null)
  const syncingRef = useRef(false)
  const [syncedScroll, setSyncedScroll] = useState(true)

  // 参数变化时自动清空旧结果
  useEffect(() => {
    setResult(null)
    setResultDims(null)
    setResultSize(null)
  }, [upscaleMode, scale, targetMode, targetIdx, customW, customH, format, keepRatio, enhance])

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

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f && f.type.startsWith('image/')) handleFile(f)
  }, [handleFile])

  const handleRemove = useCallback((e) => {
    e.stopPropagation()
    setFile(null); setPreview(null); setOrigDims(null)
    setResult(null); setResultDims(null); setResultSize(null)
  }, [])

  const targetDims = useMemo(() => {
    if (upscaleMode === 'scale') return null
    if (targetMode === 'custom') return { w: parseInt(customW) || 0, h: parseInt(customH) || 0 }
    return TARGET_PRESETS[targetIdx]
  }, [upscaleMode, targetMode, targetIdx, customW, customH])

  const expectedOutput = useMemo(() => {
    if (!origDims) return null
    let w, h
    if (upscaleMode === 'scale') {
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
  }, [origDims, upscaleMode, scale, targetDims, keepRatio, format])

  // 根据原图尺寸计算最大有效倍数
  const maxScale = origDims
    ? Math.min(20, Math.floor(Math.min(10000 / origDims.w, 10000 / origDims.h) * 2) / 2)
    : 20

  const handleProcess = async () => {
    if (!preview) return
    setProcessing(true)
    setProgress(0)
    setError(null)
    setResult(null)

    let p = 0
    const tick = () => {
      if (p < 20) p += 4
      else if (p < 50) p += 2
      else if (p < 80) p += 1
      setProgress(Math.min(p, 90))
    }
    const timer = setInterval(tick, 300)

    try {
      const base64 = preview.split(',')[1]
      const body = {
        image: base64, format,
        mode: upscaleMode, enhance,
        fit: keepRatio ? 'inside' : 'fill',
        scale: upscaleMode === 'scale' ? scale : undefined,
        targetWidth: targetDims?.w, targetHeight: targetDims?.h,
      }
      const res = await fetch('/api/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setProgress(95)
      await new Promise(r => setTimeout(r, 200))

      setResult('data:image/' + data.format + ';base64,' + data.image)
      setResultDims({ w: data.width, h: data.height })
      const rawLen = data.image.length * 0.75
      setResultSize(
        rawLen < 1024 * 1024
          ? (rawLen / 1024).toFixed(1) + ' KB'
          : (rawLen / (1024 * 1024)).toFixed(1) + ' MB'
      )
      setProgress(100)
    } catch (err) {
      setError(err.message)
      setProgress(0)
    } finally {
      clearInterval(timer)
      setProcessing(false)
    }
  }

  const handleDownload = () => {
    if (!result) return
    const a = document.createElement('a')
    const ext = format === 'jpeg' ? 'jpg' : 'png'
    const name = file ? file.name.replace(/\.[^.]+$/, '') : 'image'
    a.download = `${name}_${resultDims ? resultDims.w + 'x' + resultDims.h : 'upscaled'}.${ext}`
    a.href = result; a.click()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center">
          <ZoomIn className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">图片放大工具</h1>
          <p className="text-xs text-gray-500">高清放大 · Lanczos 算法 · 支持 4K/8K</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* 上传区 */}
        <section
          className={`bg-white rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all ${
            dragOver ? 'border-indigo-500 bg-indigo-50/60' : 'border-gray-200 hover:border-indigo-300'
          }`}
          onClick={() => fileRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
        >
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => handleFile(e.target.files[0])} />
          {preview ? (
            <div className="space-y-3">
              <img src={preview} alt="原图" className="max-h-48 mx-auto rounded-lg object-contain shadow-sm" />
              <div className="text-sm text-gray-500">
                <p>{origDims.w}&times;{origDims.h}px &middot; {(file.size / 1024).toFixed(1)} KB</p>
                <p className="text-xs text-gray-400 truncate max-w-md mx-auto">{file.name}</p>
              </div>
              <button onClick={handleRemove} className="text-xs text-red-500 hover:text-red-700 underline">删除重选</button>
            </div>
          ) : (
            <div className="text-gray-400">
              <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-gray-100 flex items-center justify-center">
                <Upload className="w-7 h-7 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-600">点击或拖拽上传图片</p>
              <p className="text-xs mt-1 text-gray-400">支持 JPG / PNG / WebP</p>
            </div>
          )}
        </section>

        {/* 控制区 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          {/* 模式切换 */}
          <div className="flex gap-2">
            {[{ value: 'scale', label: '按倍数放大', icon: ZoomIn },
              { value: 'target', label: '按目标分辨率', icon: Maximize2 }].map((opt) => (
              <button key={opt.value} onClick={() => setUpscaleMode(opt.value)}
                className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border flex items-center justify-center gap-2 ${
                  upscaleMode === opt.value
                    ? 'bg-indigo-50 border-indigo-500 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}>
                <opt.icon className="w-4 h-4" />{opt.label}
              </button>
            ))}
          </div>

          {/* 按倍数放大 - 滑块 + 直接输入 */}
          {upscaleMode === 'scale' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">放大倍数</span>
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
                <span>1x</span>
                <span>5x</span>
                <span>10x</span>
                <span>15x</span>
                <span>20x</span>
              </div>

              {/* 长边上限提示 */}
              {origDims && maxScale < 20 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs leading-relaxed">
                  <p className="text-amber-700">
                    当前图片 {origDims.w}&times;{origDims.h}px，长边上限 10000px
                  </p>
                  <p className="text-amber-600">
                    有效最大倍数为 <strong>{maxScale}x</strong>，超过将自动截断
                  </p>
                </div>
              )}
              {expectedOutput && expectedOutput.capped && (
                <p className="text-xs text-amber-600">* 已超过上限，实际输出会按 10000px 长边裁切</p>
              )}
            </div>
          )}

          {/* 按目标分辨率 */}
          {upscaleMode === 'target' && (
            <>
              <div className="flex gap-2">
                <button onClick={() => setTargetMode('preset')}
                  className={`px-4 py-2 rounded-lg text-xs font-medium border ${targetMode === 'preset' ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>预设分辨率</button>
                <button onClick={() => setTargetMode('custom')}
                  className={`px-4 py-2 rounded-lg text-xs font-medium border ${targetMode === 'custom' ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>自定义</button>
              </div>
              {targetMode === 'preset' ? (
                <div className="grid grid-cols-2 gap-2">
                  {TARGET_PRESETS.map((opt, i) => (
                    <button key={i} onClick={() => setTargetIdx(i)}
                      className={`py-3 px-4 rounded-lg text-sm border text-left ${targetIdx === i ? 'bg-indigo-50 border-indigo-500' : 'border-gray-200'}`}>
                      <div className={`font-bold ${targetIdx === i ? 'text-indigo-700' : 'text-gray-700'}`}>{opt.label}</div>
                      <div className={`text-xs ${targetIdx === i ? 'text-indigo-500' : 'text-gray-400'}`}>
                        {keepRatio ? `${opt.w}\u00d7${opt.h}（最大）` : `${opt.w}\u00d7${opt.h}`} &middot; {opt.ratio}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">宽度 (px)</label>
                    <input type="number" min="1" max="10000" value={customW}
                      onChange={(e) => setCustomW(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
                  </div>
                  <div className="text-gray-400 pb-2 font-mono">&times;</div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">高度 (px)</label>
                    <input type="number" min="1" max="10000" value={customH}
                      onChange={(e) => setCustomH(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
                  </div>
                </div>
              )}
            </>
          )}

          {/* 格式 & 选项 */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">格式</span>
              <div className="flex gap-1">
                {[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WEBP' }].map((opt) => (
                  <button key={opt.value} onClick={() => setFormat(opt.value)}
                    className={`px-3 py-1.5 rounded text-xs font-medium border ${format === opt.value ? 'bg-gray-100 border-gray-400 text-gray-700' : 'border-gray-200 text-gray-500'}`}>{opt.label}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={keepRatio}
                  onChange={(e) => setKeepRatio(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600" />保持比例
              </label>
              <label className="flex items-center gap-1.5 text-sm text-indigo-600 cursor-pointer select-none font-medium">
                <input type="checkbox" checked={enhance}
                  onChange={(e) => setEnhance(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600" />
                <Sparkles className="w-3.5 h-3.5" />增强画质
              </label>
            </div>
          </div>

          {/* 预期输出 */}
          {expectedOutput && (
            <div className={`rounded-lg px-4 py-2.5 text-xs ${
              expectedOutput.capped ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'
            }`}>
              <div className="flex items-center gap-2">
                <span className="text-gray-600">输出：</span>
                <strong className={expectedOutput.capped ? 'text-amber-700' : 'text-indigo-700'}>
                  {expectedOutput.w}&times;{expectedOutput.h}px
                </strong>
                {enhance && <span className="text-indigo-500">&middot; 多级放大 + 智能锐化</span>}
              </div>
              {expectedOutput.capped && (
                <p className="text-amber-600 mt-1">该倍数已超过长边 10000px 上限，实际输出已自动裁切</p>
              )}
              {resultDims && (
                <span className="text-gray-400 ml-2">实际：{resultDims.w}&times;{resultDims.h}px</span>
              )}
            </div>
          )}

          {/* 进度条 */}
          {processing && (
            <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                  正在处理...
                </span>
                <span className="font-mono font-bold text-indigo-600">{progress}%</span>
              </div>
              <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-gray-400 px-0.5">
                <span>解析</span>
                <span>放大</span>
                <span>锐化</span>
                <span>输出</span>
              </div>
            </div>
          )}

          {/* 提交按钮 */}
          <button onClick={handleProcess} disabled={!preview || processing}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-indigo-300 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors">
            {processing ? <><Loader2 className="w-4 h-4 animate-spin" /> 处理中...</> : <><ZoomIn className="w-4 h-4" /> 开始放大</>}
          </button>

          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
        </div>

        {/* 前后细节对比 */}
        {result && origDims && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* 头部 */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-indigo-500" />
                前后细节对比
              </h3>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer select-none hover:text-gray-600 transition-colors">
                  <input type="checkbox" checked={syncedScroll}
                    onChange={(e) => setSyncedScroll(e.target.checked)}
                    className="w-3 h-3 rounded border-gray-300 text-indigo-500" />
                  联动滚动
                </label>
                <span className="text-[11px] text-gray-400">同步缩放</span>
                <input type="range" min="1" max="8" step="0.5" value={compareZoom}
                  onChange={(e) => setCompareZoom(parseFloat(e.target.value))}
                  className="w-24 h-1.5" />
                <span className="text-xs font-mono text-indigo-600 w-10 text-right tabular-nums">{compareZoom}x</span>
              </div>
            </div>

            {/* 双栏对比 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
              {/* 原图 */}
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">原图</span>
                  <span className="text-[10px] text-gray-400">{origDims.w}&times;{origDims.h}px</span>
                </div>
                <div ref={leftScrollRef}
                  onScroll={() => {
                    if (syncingRef.current || !syncedScroll) return;
                    syncingRef.current = true;
                    const s = leftScrollRef.current, t = rightScrollRef.current;
                    if (s && t) {
                      const pctX = s.scrollWidth > s.clientWidth ? s.scrollLeft / (s.scrollWidth - s.clientWidth) : 0;
                      const pctY = s.scrollHeight > s.clientHeight ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0;
                      if (t.scrollWidth > t.clientWidth) t.scrollLeft = pctX * (t.scrollWidth - t.clientWidth);
                      if (t.scrollHeight > t.clientHeight) t.scrollTop = pctY * (t.scrollHeight - t.clientHeight);
                    }
                    requestAnimationFrame(() => { syncingRef.current = false; });
                  }}
                  className="overflow-auto max-h-72 bg-gray-50 rounded-lg border border-gray-100 cursor-pointer hover:border-indigo-200 transition-colors"
                  onClick={() => setShowModal(true)}>
                  <img src={preview} alt="原图"
                    style={{ transform: `scale(${compareZoom})`, transformOrigin: 'top left', minWidth: '100%' }}
                    className="block" />
                </div>
              </div>

              {/* 放大后 */}
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">放大后</span>
                  <span className="text-[10px] text-gray-400">{resultDims.w}&times;{resultDims.h}px</span>
                </div>
                <div ref={rightScrollRef}
                  onScroll={() => {
                    if (syncingRef.current || !syncedScroll) return;
                    syncingRef.current = true;
                    const s = rightScrollRef.current, t = leftScrollRef.current;
                    if (s && t) {
                      const pctX = s.scrollWidth > s.clientWidth ? s.scrollLeft / (s.scrollWidth - s.clientWidth) : 0;
                      const pctY = s.scrollHeight > s.clientHeight ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0;
                      if (t.scrollWidth > t.clientWidth) t.scrollLeft = pctX * (t.scrollWidth - t.clientWidth);
                      if (t.scrollHeight > t.clientHeight) t.scrollTop = pctY * (t.scrollHeight - t.clientHeight);
                    }
                    requestAnimationFrame(() => { syncingRef.current = false; });
                  }}
                  className="overflow-auto max-h-72 bg-gray-50 rounded-lg border border-gray-100 cursor-pointer hover:border-indigo-200 transition-colors"
                  onClick={() => setShowModal(true)}>
                  <img src={result} alt="放大后"
                    style={{ transform: `scale(${compareZoom})`, transformOrigin: 'top left', minWidth: '100%' }}
                    className="block" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 结果区 */}
        {result && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">处理结果</h2>
              <div className="text-xs text-gray-500 text-right">
                <div>{origDims.w}&times;{origDims.h} &rarr; <strong className="text-indigo-600">{resultDims.w}&times;{resultDims.h}</strong></div>
                <div className="text-gray-400">{(resultDims.w / origDims.w).toFixed(1)}x &middot; {resultSize}</div>
              </div>
            </div>

            <div className="rounded-xl overflow-hidden bg-gray-50 border border-gray-100">
              <img src={result} alt="放大结果" className="w-full h-auto max-h-96 object-contain mx-auto cursor-pointer"
                onClick={() => setShowModal(true)} />
            </div>

            <button onClick={handleDownload}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
              <Download className="w-4 h-4" /> 下载
            </button>
          </div>
        )}

        {/* 说明 */}
        <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 text-xs text-blue-800 leading-relaxed">
          <ul className="list-disc list-inside space-y-1">
            <li><strong>多级放大</strong>：大倍数时自动分阶段放大，每级中间做锐化</li>
            <li><strong>增强画质</strong>：Lanczos 重采样 + 自适应锐化</li>
            <li>注意：放大算法无法凭空增加细节，原图质量越好，放大效果越佳</li>
            <li>长边像素上限 <strong>10000px</strong>，超过会自动裁切</li>
          </ul>
        </div>
      </main>

      <footer className="text-center py-6 text-xs text-gray-400 border-t border-gray-100 mt-8">图片放大工具 &middot; 基于 Sharp 引擎</footer>

      {/* 全屏查看 - 前后对比 */}
      {showModal && result && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={() => setShowModal(false)}>
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 p-4 sm:p-8 max-w-[98vw] max-h-[95vh] overflow-auto items-start">
            {/* 原图 */}
            <div className="bg-black/40 rounded-xl p-3 flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold text-white/60 bg-white/10 px-2 py-0.5 rounded">原图</span>
                <span className="text-[10px] text-white/40">{origDims.w}&times;{origDims.h}px</span>
              </div>
              <img src={preview} alt="原图" className="max-w-full max-h-[70vh] object-contain rounded-lg" />
            </div>
            {/* 放大后 */}
            <div className="bg-black/40 rounded-xl p-3 flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded">放大后</span>
                <span className="text-[10px] text-white/40">{resultDims.w}&times;{resultDims.h}px</span>
              </div>
              <img src={result} alt="放大后" className="max-w-full max-h-[70vh] object-contain rounded-lg" />
            </div>
          </div>
          <div className="absolute top-4 right-4">
            <button onClick={() => setShowModal(false)}
              className="w-8 h-8 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-lg flex items-center justify-center text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="absolute bottom-4 text-white/30 text-xs">点击空白区域关闭</div>
        </div>
      )}
    </div>
  )
}

export default App
