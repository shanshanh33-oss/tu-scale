import { getContainRect } from './pdfToolUtils.js'

const PDF_MIME = 'application/pdf'
const MAX_RENDER_PIXELS = 14000000

const assertNotAborted = (signal) => {
  if (signal?.aborted) throw new DOMException('PDF 转 PPT 已取消', 'AbortError')
}

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成 PDF 页面图片')), type, quality)
})

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(reader.error || new Error('无法读取 PDF 页面图片'))
  reader.readAsDataURL(blob)
})

export const getPdfDirectSlideSize = (pageWidth, pageHeight) => {
  const width = Number(pageWidth)
  const height = Number(pageHeight)
  if (!(width > 0) || !(height > 0)) throw new Error('PDF 页面尺寸无效')
  const ratio = width / height
  if (ratio >= 1) return { width: 13.333, height: 13.333 / ratio }
  return { width: 11.693 * ratio, height: 11.693 }
}

export const getPdfDirectRenderScale = (width, height, maxDimension = 3200) => {
  if (!(width > 0) || !(height > 0)) throw new Error('PDF 页面尺寸无效')
  return Math.min(4, maxDimension / Math.max(width, height), Math.sqrt(MAX_RENDER_PIXELS / (width * height)))
}

export const createPdfDirectPptx = async (pages, { signal, total, onProgress } = {}) => {
  if (!pages) throw new Error('PDF 没有可转换的页面')
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.author = 'TU Scale'
  pptx.subject = 'PDF 页面转 PPT'
  pptx.title = 'PDF 转 PPT'
  pptx.lang = 'zh-CN'

  let layout = null
  let count = 0
  for await (const page of pages) {
    assertNotAborted(signal)
    if (!layout) {
      layout = getPdfDirectSlideSize(page.pageWidth, page.pageHeight)
      pptx.defineLayout({ name: 'TUSCALE_PDF_DIRECT', width: layout.width, height: layout.height })
      pptx.layout = 'TUSCALE_PDF_DIRECT'
    }
    const data = page.dataUrl || await blobToDataUrl(page.blob)
    const slide = pptx.addSlide()
    slide.background = { color: 'FFFFFF' }
    slide.addImage({
      data,
      ...getContainRect(page.pageWidth, page.pageHeight, {
        x: 0, y: 0, w: layout.width, h: layout.height,
      }),
      altText: `PDF 第 ${count + 1} 页`,
    })
    count += 1
    onProgress?.({ completed: count, total: total || count, stage: `正在生成第 ${count}/${total || count} 页 PPT` })
  }

  if (!count) throw new Error('PDF 没有可转换的页面')
  assertNotAborted(signal)
  return pptx.write({ outputType: 'blob', compression: true })
}

const renderPdfPage = async (page, { signal, format, maxDimension }) => {
  assertNotAborted(signal)
  const sourceViewport = page.getViewport({ scale: 1 })
  const scale = getPdfDirectRenderScale(sourceViewport.width, sourceViewport.height, maxDimension)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('浏览器无法创建 PDF 页面画布')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const renderTask = page.render({ canvasContext: context, canvas, viewport, background: '#ffffff' })
  const cancelRender = () => renderTask.cancel()
  signal?.addEventListener('abort', cancelRender, { once: true })
  try {
    await renderTask.promise
    assertNotAborted(signal)
    const blob = await canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', 0.96)
    return { blob, pageWidth: sourceViewport.width, pageHeight: sourceViewport.height }
  } finally {
    signal?.removeEventListener('abort', cancelRender)
    canvas.width = 1
    canvas.height = 1
    page.cleanup()
  }
}

export const convertPdfDirectlyToPptx = async (file, {
  signal,
  onProgress,
  format = 'jpeg',
  maxDimension = 3200,
} = {}) => {
  if (!file || (file.type !== PDF_MIME && !/\.pdf$/i.test(file.name || ''))) throw new Error('请选择 PDF 文件')
  if (!['jpeg', 'png'].includes(format)) throw new Error('不支持的页面图片格式')
  const { loadCompressionPdfJs } = await import('./pdfCompressionRuntime')
  const pdfjs = await loadCompressionPdfJs()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
  })
  let documentProxy = null
  try {
    documentProxy = await loadingTask.promise
    const pageCount = documentProxy.numPages
    const renderPages = async function* () {
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        assertNotAborted(signal)
        onProgress?.({ completed: pageNumber - 1, total: pageCount, stage: `正在渲染 PDF 第 ${pageNumber}/${pageCount} 页` })
        const page = await documentProxy.getPage(pageNumber)
        yield await renderPdfPage(page, { signal, format, maxDimension })
      }
    }
    const blob = await createPdfDirectPptx(renderPages(), { signal, total: pageCount, onProgress })
    assertNotAborted(signal)
    return { blob, pageCount, fileSize: blob.size }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('PDF 转 PPT 已取消', 'AbortError')
    if (error?.name === 'PasswordException') throw new Error('该 PDF 受密码保护，当前无法转换', { cause: error })
    throw error
  } finally {
    try {
      if (documentProxy) await documentProxy.destroy()
      else await loadingTask.destroy()
    } catch {
      // Cleanup failure must not hide the conversion result or original error.
    }
  }
}
