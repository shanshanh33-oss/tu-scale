 import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
 import { track } from '@vercel/analytics'
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
  const [modalMode, setModalMode] = useState('compare') // 'single' | 'compare'
  const [compareZoom, setCompareZoom] = useState(1)
  const [imgZoom, setImgZoom] = useState(1)
  const [imgPan, setImgPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [showDonateTooltip, setShowDonateTooltip] = useState(false);
  const panStart = useRef({ x: 0, y: 0 })
  const panOrigin = useRef({ x: 0, y: 0 })
  const fileRef = useRef(null)
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





  const handleProcess = useCallback(async () => {
    const startTime = Date.now();
    track('upscale_start', {
      mode: upscaleMode,
      scale: upscaleMode === 'scale' ? scale : undefined,
      format,
      enhance: enhance ? 'yes' : 'no'
    });
    if (!preview || !origDims) return;
    setProcessing(true);
    setProgress(0);
    setError(null);
    setResult(null);

    let p = 0;
    const tick = () => {
      if (p < 30) p += 5;
      else if (p < 70) p += 3;
      else if (p < 90) p += 1;
      setProgress(Math.min(p, 91));
    };
    const timer = setInterval(tick, 200);

    try {
      // Calculate target dimensions
      let targetW, targetH;
      if (upscaleMode === 'scale') {
        targetW = Math.round(origDims.w * scale);
        targetH = Math.round(origDims.h * scale);
        const maxDim = 10000;
        if (targetW > maxDim || targetH > maxDim) {
          const r = Math.min(maxDim / targetW, maxDim / targetH);
          targetW = Math.round(targetW * r);
          targetH = Math.round(targetH * r);
        }
      } else if (targetDims) {
        if (keepRatio) {
          const r = Math.min(targetDims.w / origDims.w, targetDims.h / origDims.h);
          targetW = Math.round(origDims.w * r);
          targetH = Math.round(origDims.h * r);
        } else {
          targetW = targetDims.w;
          targetH = targetDims.h;
        }
      }
      if (format === 'jpeg') { targetW += targetW & 1; targetH += targetH & 1; }

      setProgress(20);

      // Process using Canvas
      const result = await processImageWithCanvas(preview, targetW, targetH, enhance);

      setProgress(95);
      await new Promise(r => setTimeout(r, 100));

      setResult(result.dataUrl);
      setResultDims({ w: result.width, h: result.height });
      track('upscale_success', {
        inputW: origDims.w,
        inputH: origDims.h,
        outputW: result.width,
        outputH: result.height,
        duration: Math.round((Date.now() - startTime) / 1000) + 's',
        mode: upscaleMode,
        format
      });
      const sizeKB = result.size < 1024 * 1024
        ? (result.size / 1024).toFixed(1) + ' KB'
        : (result.size / (1024 * 1024)).toFixed(1) + ' MB';
      setResultSize(sizeKB);
      setProgress(100);
    } catch (err) {
      setError(err.message);
      track('upscale_error', { error: err.message, duration: Math.round((Date.now() - startTime) / 1000) + 's' });
      setProgress(0);
    } finally {
      clearInterval(timer);
      setProcessing(false);
    }
  }, [preview, origDims, upscaleMode, scale, targetDims, keepRatio, format, enhance]);

  // Client-side image processing using Canvas
  const processImageWithCanvas = (imageUrl, targetW, targetH, doEnhance) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          // Multi-pass upscaling for large enlargements
          const avgScale = Math.max(targetW / img.width, targetH / img.height);
          const passes = avgScale >= 8 ? 3 : avgScale >= 4 ? 2 : avgScale >= 2.5 ? 2 : 1;

          let srcCanvas = document.createElement('canvas');
          srcCanvas.width = img.width;
          srcCanvas.height = img.height;
          let srcCtx = srcCanvas.getContext('2d');
          srcCtx.drawImage(img, 0, 0);

          for (let i = 0; i < passes; i++) {
            const progress = (i + 1) / passes;
            const stepW = Math.round(img.width * Math.pow(targetW / img.width, progress));
            const stepH = Math.round(img.height * Math.pow(targetH / img.height, progress));

            const dstCanvas = document.createElement('canvas');
            dstCanvas.width = stepW;
            dstCanvas.height = stepH;
            const dstCtx = dstCanvas.getContext('2d');

            // Draw at new size (browser handles interpolation)
            dstCtx.drawImage(srcCanvas, 0, 0, stepW, stepH);

            // Apply sharpening at each step if enhanced
            if (doEnhance || i > 0) {
              const imageData = dstCtx.getImageData(0, 0, stepW, stepH);
              const sharpened = sharpenImageData(imageData, doEnhance ? 0.5 : 0.3);
              dstCtx.putImageData(sharpened, 0, 0);
            }

            srcCanvas = dstCanvas;
          }

          // Export to desired format
          const mimeType = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
          const quality = format === 'png' ? undefined : 0.92;
          const dataUrl = srcCanvas.toDataURL(mimeType, quality);
          const sizeBytes = dataUrl.length * 0.75; // approximate from base64

          resolve({
            dataUrl,
            width: srcCanvas.width,
            height: srcCanvas.height,
            size: sizeBytes
          });
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageUrl;
    });
  };

  // Simple sharpen convolution filter
  const sharpenImageData = (imageData, strength = 0.5) => {
    const { data, width, height } = imageData;
    const output = new Uint8ClampedArray(data);
    const kernel = [
      0, -strength, 0,
      -strength, 1 + 4 * strength, -strength,
      0, -strength, 0
    ];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const pixelIdx = ((y + ky) * width + (x + kx)) * 4 + c;
              const k = kernel[(ky + 1) * 3 + (kx + 1)];
              sum += data[pixelIdx] * k;
            }
          }
          output[idx + c] = Math.max(0, Math.min(255, sum));
        }
      }
    }
    return new ImageData(output, width, height);
  };

  const handleDownload = () => {
    if (!result) return
    const a = document.createElement('a')
    const ext = format === "jpeg" ? "jpg" : format === "webp" ? "webp" : "png"
    const name = file ? file.name.replace(/\.[^.]+$/, '') : 'image'
    a.download = `${name}_${resultDims ? resultDims.w + 'x' + resultDims.h : 'upscaled'}.${ext}`
    a.href = result; a.click()
   }

   return (
     <div className="min-h-screen bg-gray-50/80">
       <header className="bg-white/95 backdrop-blur-sm border-b border-gray-100 px-6 py-3 flex items-center gap-2.5 sticky top-0 z-10 shadow-sm">
           <img src="/logo.png" alt="UpScale" className="w-8 h-8 shrink-0" />
         <div className="flex flex-col min-w-0">
           <div className="flex items-center gap-2">
             <h1 className="text-base font-bold tracking-tight" style={{ color: '#8040f0' }}>UpScale</h1>
             <span className="text-[11px] hidden sm:block truncate leading-none" style={{ color: '#7c3aed' }}>图片放大工具</span>
           </div>
           <span className="text-[10px] text-gray-400 leading-none">高清放大•Lanczos 算法•支持 4K/8K</span>
         </div>
       </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* 上传区 */}
        <section
          className={`bg-white rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-all ${
            dragOver ? 'border-indigo-500 bg-indigo-50/60' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50/50'
          }`}
          onClick={() => fileRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
        >
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => handleFile(e.target.files[0])} />
          {preview ? (
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
              <p className="text-xs mt-1 text-gray-400">支持 JPG · PNG · WebP</p>
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
                  onClick={() => { setModalMode('compare'); setShowModal(true); }}>
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
                  onClick={() => { setModalMode('compare'); setShowModal(true); }}>
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
                onClick={() => { setModalMode('single'); setShowModal(true); setImgZoom(1); setImgPan({x:0,y:0}); }} />
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

      <footer className="text-center py-6 text-xs text-gray-400 border-t border-gray-100 mt-8">UpScale·图片放大工具 &middot; 基于 Sharp 引擎</footer>

      {/* 猫爪打赏按钮 */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end">
        {showDonateTooltip && (
          <div className="mb-2.5 px-4 py-2 bg-white rounded-xl shadow-lg border border-gray-100 text-sm text-gray-700 whitespace-nowrap relative animate-fade-in">
            请作者的猫猫吃罐罐 🐱
            <div className="absolute -bottom-1 right-6 w-3 h-3 bg-white border-r border-b border-gray-100 transform rotate-45" />
          </div>
        )}
        <button
          onClick={() => window.open("https://afdian.com/a/upscale", "_blank")}
          onMouseEnter={() => setShowDonateTooltip(true)}
          onMouseLeave={() => setShowDonateTooltip(false)}
          className="group w-14 h-14 bg-gradient-to-br from-pink-300 to-purple-400 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 active:scale-95 flex items-center justify-center cursor-pointer"
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7 text-white fill-current">
            <circle cx="8" cy="9" r="3.5" />
            <circle cx="16" cy="9" r="3.5" />
            <circle cx="5" cy="14" r="3" />
            <circle cx="19" cy="14" r="3" />
            <path d="M12 14c-2.5 0-4.5 1.5-4.5 3.5s2 3.5 4.5 3.5 4.5-1.5 4.5-3.5-2-3.5-4.5-3.5z" />
          </svg>
        </button>
      </div>

      {/* 全屏查看 - 单图模式 (可缩放拖动 - 使用 ref 防崩溃) */}
      {showModal && modalMode === 'single' && result && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col select-none"
          onMouseUp={() => { if (singleViewer.current) singleViewer.current.drag = false; }}
          onMouseLeave={() => { if (singleViewer.current) singleViewer.current.drag = false; }}
          onClick={(e) => {
            if (e.target === e.currentTarget) { setShowModal(false); }
          }}>
          {/* 顶部导航栏 */}
          <div className="flex items-center justify-between px-5 py-3 bg-black/60 backdrop-blur-sm border-b border-white/10 shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-semibold text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded">放大结果</span>
              <span className="text-[11px] text-white/40">{resultDims.w}&times;{resultDims.h}px</span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={(e) => { e.stopPropagation(); const v = singleViewer.current; v.z = 1; v.x = 0; v.y = 0; if (singleImgRef.current) singleImgRef.current.style.transform = 'scale(1)'; }}
                className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors">
                重置
              </button>
              <button onClick={(e) => { e.stopPropagation(); setShowModal(false); }}
                className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 图片查看区 */}
          <div className="flex-1 flex items-center justify-center overflow-hidden bg-black/30"
            onWheel={(e) => {
              e.preventDefault();
              const v = singleViewer.current;
              const oldZ = v.z;
              const newZ = Math.max(0.5, Math.min(20, v.z + (e.deltaY > 0 ? -0.2 : 0.2)));
              const ratio = newZ / oldZ;
              v.z = newZ;
              const rect = e.currentTarget.getBoundingClientRect();
              const mx = e.clientX - rect.left, my = e.clientY - rect.top;
              v.x = mx - (mx - v.x) * ratio;
              v.y = my - (my - v.y) * ratio;
              if (singleImgRef.current) singleImgRef.current.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`;
            }}
            onMouseDown={(e) => {
              const v = singleViewer.current;
              if (v.z <= 1) return;
              v.drag = true; v.mx = e.clientX; v.my = e.clientY; v.sx = v.x; v.sy = v.y;
            }}
            onMouseMove={(e) => {
              const v = singleViewer.current;
              if (!v.drag) return;
              v.x = v.sx + (e.clientX - v.mx); v.y = v.sy + (e.clientY - v.my);
              if (singleImgRef.current) singleImgRef.current.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`;
            }}>
            <img ref={singleImgRef} src={result} alt="放大结果" draggable={false}
              style={{ transform: 'scale(1)', transformOrigin: '0 0', maxWidth: '90vw', maxHeight: '85vh' }}
              className="" />
          </div>

          <div className="text-center py-2 text-white/25 text-[11px] shrink-0 bg-black/40">
            滚轮缩放 · 拖拽平移 · 点击空白关闭
          </div>
        </div>
      )}

      {/* 全屏查看 - 对比模式 (简化: 和页面模式一致, 可滚动+滑块缩放+联动滚动) */}
      {showModal && modalMode === 'compare' && result && origDims && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          {/* 顶部导航 */}
          <div className="flex items-center justify-between px-5 py-3 bg-black/60 backdrop-blur-sm border-b border-white/10 shrink-0">
            <h3 className="text-sm text-white/80 font-semibold flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-indigo-400" />
              前后细节对比
            </h3>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[10px] text-white/50 cursor-pointer select-none hover:text-white/70 transition-colors">
                <input type="checkbox" checked={syncedScroll}
                  onChange={(e) => setSyncedScroll(e.target.checked)}
                  className="w-2.5 h-2.5 rounded border-white/30 bg-white/10 text-indigo-400" />
                联动滚动
              </label>
              <span className="text-[11px] text-white/40">同步缩放</span>
              <input type="range" min="1" max="8" step="0.5" value={compareZoom}
                onChange={(e) => setCompareZoom(parseFloat(e.target.value))}
                className="w-20 h-1" />
              <span className="text-xs font-mono text-indigo-400 w-8 text-right tabular-nums">{compareZoom}x</span>
              <button onClick={(e) => { e.stopPropagation(); setShowModal(false); }}
                className="w-7 h-7 ml-1 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 双栏图片区 - 可滚动 + 联动滚动 */}
          <div className="flex-1 flex flex-col sm:flex-row gap-0 min-h-0">
            {/* 原图 */}
            <div className="flex-1 flex flex-col min-w-0 border-r-0 sm:border-r border-white/10">
              <div className="px-4 py-2 flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-semibold text-white/60 bg-white/10 px-2 py-0.5 rounded">原图</span>
                <span className="text-[10px] text-white/40">{origDims.w}&times;{origDims.h}px</span>
              </div>
              <div ref={fsLeftScrollRef}
                onScroll={() => {
                  if (fsSyncingRef.current || !syncedScroll) return;
                  fsSyncingRef.current = true;
                  const s = fsLeftScrollRef.current, t = fsRightScrollRef.current;
                  if (s && t) {
                    const pctX = s.scrollWidth > s.clientWidth ? s.scrollLeft / (s.scrollWidth - s.clientWidth) : 0;
                    const pctY = s.scrollHeight > s.clientHeight ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0;
                    if (t.scrollWidth > t.clientWidth) t.scrollLeft = pctX * (t.scrollWidth - t.clientWidth);
                    if (t.scrollHeight > t.clientHeight) t.scrollTop = pctY * (t.scrollHeight - t.clientHeight);
                  }
                  requestAnimationFrame(() => { fsSyncingRef.current = false; });
                }}
                className="flex-1 overflow-auto bg-black/20">
                <img src={preview} alt="原图"
                  style={{ transform: `scale(${compareZoom})`, transformOrigin: 'top left' }}
                  className="block" />
              </div>
            </div>
            {/* 放大后 */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-4 py-2 flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded">放大后</span>
                <span className="text-[10px] text-white/40">{resultDims.w}&times;{resultDims.h}px</span>
              </div>
              <div ref={fsRightScrollRef}
                onScroll={() => {
                  if (fsSyncingRef.current || !syncedScroll) return;
                  fsSyncingRef.current = true;
                  const s = fsRightScrollRef.current, t = fsLeftScrollRef.current;
                  if (s && t) {
                    const pctX = s.scrollWidth > s.clientWidth ? s.scrollLeft / (s.scrollWidth - s.clientWidth) : 0;
                    const pctY = s.scrollHeight > s.clientHeight ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0;
                    if (t.scrollWidth > t.clientWidth) t.scrollLeft = pctX * (t.scrollWidth - t.clientWidth);
                    if (t.scrollHeight > t.clientHeight) t.scrollTop = pctY * (t.scrollHeight - t.clientHeight);
                  }
                  requestAnimationFrame(() => { fsSyncingRef.current = false; });
                }}
                className="flex-1 overflow-auto bg-black/20">
                <img src={result} alt="放大后"
                  style={{ transform: `scale(${compareZoom})`, transformOrigin: 'top left' }}
                  className="block" />
              </div>
            </div>
          </div>

          <div className="text-center py-2 text-white/25 text-[11px] shrink-0 bg-black/40">
            滚动查看细节 · 滑块缩放 · 联动滚动可开关 · 点击空白关闭
          </div>
        </div>
      )}
    </div>
  )
}

export default App
