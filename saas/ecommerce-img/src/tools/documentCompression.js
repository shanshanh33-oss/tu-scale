import JSZip from 'jszip'

export const DOCUMENT_COMPRESSION_PRESETS = [
  {
    id: 'quality',
    label: '清晰优先',
    description: '适合展示和打印，压缩幅度较小',
    pdf: { maxDimension: 2400, jpegQuality: 0.88 },
    pptx: { maxDimension: 2560, jpegQuality: 0.88 },
  },
  {
    id: 'balanced',
    label: '均衡（推荐）',
    description: '兼顾清晰度和文件体积',
    pdf: { maxDimension: 1800, jpegQuality: 0.76 },
    pptx: { maxDimension: 1920, jpegQuality: 0.78 },
  },
  {
    id: 'small',
    label: '体积优先',
    description: '适合在线发送，图片细节会减少',
    pdf: { maxDimension: 1280, jpegQuality: 0.62 },
    pptx: { maxDimension: 1400, jpegQuality: 0.66 },
  },
]

const PDF_MIME = 'application/pdf'
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const JPEG_TYPES = new Set(['jpg', 'jpeg', 'jfif'])
const PNG_TYPES = new Set(['png'])

const loadPdfJs = async () => {
  const { loadCompressionPdfJs } = await import('./pdfCompressionRuntime')
  return loadCompressionPdfJs()
}

const assertNotAborted = (signal, message = '文档压缩已取消') => {
  if (signal?.aborted) throw new DOMException(message, 'AbortError')
}

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob)
    else reject(new Error('浏览器无法生成压缩图片'))
  }, type, quality)
})

const toAscii = value => new TextEncoder().encode(value)

export const getCompressionPreset = (presetId) => (
  DOCUMENT_COMPRESSION_PRESETS.find(item => item.id === presetId)
  || DOCUMENT_COMPRESSION_PRESETS[1]
)

export const getDocumentCompressionKind = (file) => {
  const name = String(file?.name || '')
  const type = String(file?.type || '').toLowerCase()
  if (type === PDF_MIME || /\.pdf$/i.test(name)) return 'pdf'
  if (type === PPTX_MIME || /\.pptx$/i.test(name)) return 'pptx'
  return ''
}

export const getCompressedDocumentName = (fileName, kind) => {
  const fallback = kind === 'pptx' ? '演示文稿' : '文档'
  const base = String(fileName || fallback)
    .replace(/\.(?:pdf|pptx)$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 100) || fallback
  return `${base}_压缩.${kind === 'pptx' ? 'pptx' : 'pdf'}`
}

export const buildRasterPdf = (pages) => {
  if (!Array.isArray(pages) || !pages.length) throw new Error('没有可写入 PDF 的页面')

  const parts = []
  const offsets = []
  let byteLength = 0
  const append = (value) => {
    const bytes = typeof value === 'string' ? toAscii(value) : value
    parts.push(bytes)
    byteLength += bytes.byteLength
  }
  const addObject = (objectId, bodyParts) => {
    offsets[objectId] = byteLength
    append(`${objectId} 0 obj\n`)
    bodyParts.forEach(append)
    append('\nendobj\n')
  }

  const objectCount = 2 + (pages.length * 3)
  append('%PDF-1.4\n%TU Scale\n')
  addObject(1, ['<< /Type /Catalog /Pages 2 0 R >>'])

  const pageObjectIds = pages.map((_, index) => 3 + (index * 3))
  addObject(2, [`<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] >>`])

  pages.forEach((page, index) => {
    const pageObjectId = pageObjectIds[index]
    const imageObjectId = pageObjectId + 1
    const contentObjectId = pageObjectId + 2
    const pageWidth = Math.max(1, Number(page.pageWidth) || 1)
    const pageHeight = Math.max(1, Number(page.pageHeight) || 1)
    const imageBytes = page.jpegBytes instanceof Uint8Array ? page.jpegBytes : new Uint8Array(page.jpegBytes)
    const contentBytes = toAscii(`q\n${pageWidth.toFixed(3)} 0 0 ${pageHeight.toFixed(3)} 0 0 cm\n/Im0 Do\nQ\n`)

    addObject(pageObjectId, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(3)} ${pageHeight.toFixed(3)}] `,
      `/Resources << /XObject << /Im0 ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    ])
    addObject(imageObjectId, [
      `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} `,
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate true /Filter /DCTDecode /Length ${imageBytes.byteLength} >>\nstream\n`,
      imageBytes,
      '\nendstream',
    ])
    addObject(contentObjectId, [
      `<< /Length ${contentBytes.byteLength} >>\nstream\n`,
      contentBytes,
      'endstream',
    ])
  })

  const xrefOffset = byteLength
  append(`xref\n0 ${objectCount + 1}\n`)
  append('0000000000 65535 f \n')
  for (let objectId = 1; objectId <= objectCount; objectId += 1) {
    append(`${String(offsets[objectId]).padStart(10, '0')} 00000 n \n`)
  }
  append(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  return new Blob(parts, { type: PDF_MIME })
}

export const compressPdfFile = async (file, {
  presetId = 'balanced',
  signal,
  onProgress,
} = {}) => {
  if (getDocumentCompressionKind(file) !== 'pdf') throw new Error('请选择 PDF 文件')
  const preset = getCompressionPreset(presetId)
  const pdfjs = await loadPdfJs()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
  })
  let documentProxy = null

  try {
    documentProxy = await loadingTask.promise
    const pages = []
    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
      assertNotAborted(signal)
      onProgress?.({
        completed: pageNumber - 1,
        total: documentProxy.numPages,
        percent: ((pageNumber - 1) / documentProxy.numPages) * 92,
        stage: `压缩第 ${pageNumber} 页`,
      })
      const page = await documentProxy.getPage(pageNumber)
      const sourceViewport = page.getViewport({ scale: 1 })
      const longestSide = Math.max(1, sourceViewport.width, sourceViewport.height)
      const scale = Math.max(0.1, Math.min(3, preset.pdf.maxDimension / longestSide))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('浏览器无法创建 PDF 压缩画布')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'

      const renderTask = page.render({ canvasContext: context, canvas, viewport, background: '#ffffff' })
      const cancelRender = () => renderTask.cancel()
      signal?.addEventListener('abort', cancelRender, { once: true })
      try {
        await renderTask.promise
        assertNotAborted(signal)
        const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', preset.pdf.jpegQuality)
        pages.push({
          jpegBytes: new Uint8Array(await jpegBlob.arrayBuffer()),
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
          pageWidth: sourceViewport.width,
          pageHeight: sourceViewport.height,
        })
      } finally {
        signal?.removeEventListener('abort', cancelRender)
        canvas.width = 1
        canvas.height = 1
        page.cleanup()
      }

      onProgress?.({
        completed: pageNumber,
        total: documentProxy.numPages,
        percent: (pageNumber / documentProxy.numPages) * 92,
        stage: `已完成 ${pageNumber}/${documentProxy.numPages} 页`,
      })
    }

    assertNotAborted(signal)
    onProgress?.({ completed: pages.length, total: pages.length, percent: 96, stage: '正在生成压缩 PDF' })
    const blob = buildRasterPdf(pages)
    onProgress?.({ completed: pages.length, total: pages.length, percent: 100, stage: 'PDF 压缩完成' })
    return {
      blob,
      kind: 'pdf',
      pageCount: pages.length,
      imageCount: pages.length,
      changedImageCount: pages.length,
      originalSize: file.size || 0,
      compressedSize: blob.size,
      fileName: getCompressedDocumentName(file.name, 'pdf'),
    }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('PDF 压缩已取消', 'AbortError')
    if (error?.name === 'PasswordException') throw new Error('该 PDF 受密码保护，当前无法压缩', { cause: error })
    throw error
  } finally {
    try {
      if (documentProxy) await documentProxy.destroy()
      else await loadingTask.destroy()
    } catch {
      // Cleanup failure must not hide the compression result or original error.
    }
  }
}

export const getPptxMediaKind = (path) => {
  if (!/^ppt\/media\//i.test(path || '')) return ''
  const extension = String(path).split('.').pop()?.toLowerCase() || ''
  if (JPEG_TYPES.has(extension)) return 'jpeg'
  if (PNG_TYPES.has(extension)) return 'png'
  return ''
}

const loadBrowserImage = async (blob) => {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        dispose: () => {},
      })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('PPT 图片无法解码'))
    }
    image.src = url
  })
}

const recompressPresentationImage = async (bytes, kind, settings, signal) => {
  assertNotAborted(signal)
  const mimeType = kind === 'jpeg' ? 'image/jpeg' : 'image/png'
  const sourceBlob = new Blob([bytes], { type: mimeType })
  const decoded = await loadBrowserImage(sourceBlob)
  const scale = Math.min(1, settings.maxDimension / Math.max(1, decoded.width, decoded.height))
  const width = Math.max(1, Math.round(decoded.width * scale))
  const height = Math.max(1, Math.round(decoded.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: kind === 'png' })
  if (!context) throw new Error('浏览器无法创建 PPT 图片压缩画布')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  if (kind === 'jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }

  try {
    context.drawImage(decoded.source, 0, 0, width, height)
    assertNotAborted(signal)
    const outputBlob = await canvasToBlob(canvas, mimeType, kind === 'jpeg' ? settings.jpegQuality : undefined)
    return {
      bytes: new Uint8Array(await outputBlob.arrayBuffer()),
      width,
      height,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
    }
  } finally {
    decoded.dispose()
    canvas.width = 1
    canvas.height = 1
  }
}

export const compressPptxFile = async (file, {
  presetId = 'balanced',
  signal,
  onProgress,
  recompressImage = recompressPresentationImage,
} = {}) => {
  if (getDocumentCompressionKind(file) !== 'pptx') throw new Error('请选择 PPTX 文件')
  const preset = getCompressionPreset(presetId)
  assertNotAborted(signal)
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  if (!zip.file('ppt/presentation.xml')) throw new Error('PPTX 文件损坏或格式不受支持')

  const mediaEntries = Object.values(zip.files).filter(entry => !entry.dir && getPptxMediaKind(entry.name))
  let changedImageCount = 0
  let originalMediaSize = 0
  let compressedMediaSize = 0

  for (let index = 0; index < mediaEntries.length; index += 1) {
    assertNotAborted(signal)
    const entry = mediaEntries[index]
    const kind = getPptxMediaKind(entry.name)
    onProgress?.({
      completed: index,
      total: mediaEntries.length,
      percent: mediaEntries.length ? (index / mediaEntries.length) * 82 : 82,
      stage: `压缩图片 ${index + 1}/${mediaEntries.length}`,
    })
    const originalBytes = await entry.async('uint8array')
    originalMediaSize += originalBytes.byteLength
    let outputBytes = originalBytes

    try {
      const compressed = await recompressImage(originalBytes, kind, preset.pptx, signal)
      if (compressed?.bytes?.byteLength < originalBytes.byteLength * 0.98) {
        outputBytes = compressed.bytes
        changedImageCount += 1
        zip.file(entry.name, outputBytes, {
          binary: true,
          date: entry.date,
          createFolders: false,
          compression: 'DEFLATE',
        })
      }
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error
      // Unsupported or damaged media stays byte-for-byte unchanged.
    }
    compressedMediaSize += outputBytes.byteLength
    onProgress?.({
      completed: index + 1,
      total: mediaEntries.length,
      percent: mediaEntries.length ? ((index + 1) / mediaEntries.length) * 82 : 82,
      stage: `已处理 ${index + 1}/${mediaEntries.length} 张图片`,
    })
  }

  assertNotAborted(signal)
  onProgress?.({ completed: mediaEntries.length, total: mediaEntries.length, percent: 86, stage: '正在重新打包 PPTX' })
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: PPTX_MIME,
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  }, (metadata) => {
    assertNotAborted(signal)
    onProgress?.({
      completed: mediaEntries.length,
      total: mediaEntries.length,
      percent: 86 + (metadata.percent * 0.14),
      stage: '正在重新打包 PPTX',
    })
  })

  onProgress?.({ completed: mediaEntries.length, total: mediaEntries.length, percent: 100, stage: 'PPTX 压缩完成' })
  return {
    blob,
    kind: 'pptx',
    pageCount: 0,
    imageCount: mediaEntries.length,
    changedImageCount,
    originalMediaSize,
    compressedMediaSize,
    originalSize: file.size || 0,
    compressedSize: blob.size,
    fileName: getCompressedDocumentName(file.name, 'pptx'),
  }
}
