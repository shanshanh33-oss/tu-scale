import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  PPT_LAYOUTS,
  getCenteredCrop,
  getCollageBoxes,
  getContainRect,
  getPptImagePlacement,
  getPptSlideImageBox,
  getRatioCanvasSize,
  textItemsToPlainText,
} from './pdfToolUtils'
import { cleanupExtractedImageCanvas } from './embeddedImageCleanup'

export const MAX_EXTRACTED_IMAGES = 500

let pdfJsPromise = null

const loadPdfJs = async () => {
  if (!pdfJsPromise) {
    pdfJsPromise = import('pdfjs-dist/build/pdf.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
      return pdfjs
    })
  }
  return pdfJsPromise
}

const assertNotAborted = (signal) => {
  if (signal?.aborted) throw new DOMException('PDF 解析已取消', 'AbortError')
}

const canvasToBlob = (canvas, type = 'image/png', quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob)
    else reject(new Error('浏览器无法生成图片文件'))
  }, type, quality)
})

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(reader.error || new Error('图片编码失败'))
  reader.readAsDataURL(blob)
})

const loadImageFromBlob = (blob) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.onload = () => {
    URL.revokeObjectURL(url)
    resolve(image)
  }
  image.onerror = () => {
    URL.revokeObjectURL(url)
    reject(new Error('提取图片无法解码'))
  }
  image.src = url
})

const waitForPdfObject = (objects, objectId) => {
  if (objects.has(objectId)) return Promise.resolve(objects.get(objectId))
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`等待 PDF 图片对象超时：${objectId}`)), 5000)
    objects.get(objectId, (value) => {
      window.clearTimeout(timer)
      resolve(value)
    })
  })
}

const getDrawableSource = (imageData) => {
  if (!imageData) return null
  if (imageData.bitmap) return imageData.bitmap
  if (typeof ImageBitmap !== 'undefined' && imageData instanceof ImageBitmap) return imageData
  if (typeof HTMLImageElement !== 'undefined' && imageData instanceof HTMLImageElement) return imageData
  if (typeof HTMLCanvasElement !== 'undefined' && imageData instanceof HTMLCanvasElement) return imageData
  if (typeof OffscreenCanvas !== 'undefined' && imageData instanceof OffscreenCanvas) return imageData
  return null
}

const paintPdfImageData = (context, imageData, width, height, imageKind) => {
  if (typeof ImageData !== 'undefined' && imageData instanceof ImageData) {
    context.putImageData(imageData, 0, 0)
    return
  }

  const source = imageData?.data
  if (!source) throw new Error('PDF 图片像素数据不可用')
  const output = context.createImageData(width, height)
  const target = output.data

  if (imageData.kind === imageKind.RGBA_32BPP || source.length === width * height * 4) {
    target.set(source.subarray(0, target.length))
  } else if (imageData.kind === imageKind.RGB_24BPP || source.length === width * height * 3) {
    let sourceOffset = 0
    for (let targetOffset = 0; targetOffset < target.length; targetOffset += 4) {
      target[targetOffset] = source[sourceOffset++]
      target[targetOffset + 1] = source[sourceOffset++]
      target[targetOffset + 2] = source[sourceOffset++]
      target[targetOffset + 3] = 255
    }
  } else if (imageData.kind === imageKind.GRAYSCALE_1BPP) {
    const rowBytes = Math.ceil(width / 8)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = source[(y * rowBytes) + (x >> 3)] & (128 >> (x & 7))
        const color = bit ? 255 : 0
        const targetOffset = ((y * width) + x) * 4
        target[targetOffset] = color
        target[targetOffset + 1] = color
        target[targetOffset + 2] = color
        target[targetOffset + 3] = 255
      }
    }
  } else {
    throw new Error('暂不支持该 PDF 图片像素格式')
  }
  context.putImageData(output, 0, 0)
}

const pdfImageToBlob = async (imageData, imageKind) => {
  const drawable = getDrawableSource(imageData)
  const width = Math.max(1, Math.round(imageData?.width || drawable?.width || 0))
  const height = Math.max(1, Math.round(imageData?.height || drawable?.height || 0))
  if (!width || !height) throw new Error('PDF 图片尺寸不可用')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('浏览器无法创建图片画布')

  if (drawable) context.drawImage(drawable, 0, 0, width, height)
  else paintPdfImageData(context, imageData, width, height, imageKind)

  const cleaned = cleanupExtractedImageCanvas(canvas)
  const originalBlob = cleaned.wasContentCropped ? await canvasToBlob(canvas) : null
  const blob = await canvasToBlob(cleaned.canvas)
  if (cleaned.canvas !== canvas) {
    cleaned.canvas.width = 1
    cleaned.canvas.height = 1
  }
  canvas.width = 1
  canvas.height = 1

  return {
    blob,
    width: cleaned.width,
    height: cleaned.height,
    wasContentCropped: cleaned.wasContentCropped,
    originalBlob,
    originalWidth: cleaned.originalWidth,
    originalHeight: cleaned.originalHeight,
    cleanedBlob: cleaned.wasContentCropped ? blob : null,
    cleanedWidth: cleaned.wasContentCropped ? cleaned.width : null,
    cleanedHeight: cleaned.wasContentCropped ? cleaned.height : null,
    contentCrop: cleaned.contentCrop,
  }
}

const renderPagePreview = async (page, signal) => {
  assertNotAborted(signal)
  const sourceViewport = page.getViewport({ scale: 1 })
  const scale = Math.min(1.25, 480 / Math.max(1, sourceViewport.width))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('浏览器无法渲染 PDF 页面')
  await page.render({ canvasContext: context, canvas, viewport, background: '#ffffff' }).promise
  assertNotAborted(signal)
  return {
    blob: await canvasToBlob(canvas, 'image/jpeg', 0.78),
    width: Math.round(sourceViewport.width),
    height: Math.round(sourceViewport.height),
  }
}

const renderPageForOcr = async (page, signal) => {
  assertNotAborted(signal)
  const sourceViewport = page.getViewport({ scale: 1 })
  const scale = Math.max(0.5, Math.min(3, 2200 / Math.max(1, sourceViewport.width, sourceViewport.height)))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  if (!context) throw new Error('浏览器无法渲染 OCR 页面')

  const renderTask = page.render({ canvasContext: context, canvas, viewport, background: '#ffffff' })
  const cancelRender = () => renderTask.cancel()
  signal?.addEventListener('abort', cancelRender, { once: true })
  try {
    await renderTask.promise
    assertNotAborted(signal)
    return {
      blob: await canvasToBlob(canvas, 'image/png'),
      width: canvas.width,
      height: canvas.height,
    }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('OCR 已取消', 'AbortError')
    throw error
  } finally {
    signal?.removeEventListener('abort', cancelRender)
    canvas.width = 1
    canvas.height = 1
  }
}

const extractPageImages = async (page, pageNumber, pdfjs, remaining, signal) => {
  if (remaining <= 0) return []
  const operatorList = await page.getOperatorList()
  const images = []
  const seenObjects = new Set()
  let pageImageNumber = 0

  for (let index = 0; index < operatorList.fnArray.length && images.length < remaining; index += 1) {
    assertNotAborted(signal)
    const operation = operatorList.fnArray[index]
    const args = operatorList.argsArray[index] || []
    let imageData
    let sourceKey

    if (operation === pdfjs.OPS.paintImageXObject || operation === pdfjs.OPS.paintImageXObjectRepeat) {
      sourceKey = `object:${args[0]}`
      if (seenObjects.has(sourceKey)) continue
      seenObjects.add(sourceKey)
      try {
        imageData = await waitForPdfObject(page.objs, args[0])
      } catch {
        continue
      }
    } else if (operation === pdfjs.OPS.paintInlineImageXObject || operation === pdfjs.OPS.paintInlineImageXObjectGroup) {
      imageData = args[0]
      sourceKey = `inline:${index}`
    } else {
      continue
    }

    try {
      const converted = await pdfImageToBlob(imageData, pdfjs.ImageKind)
      pageImageNumber += 1
      images.push({
        id: `page-${pageNumber}-image-${pageImageNumber}`,
        pageNumber,
        imageNumber: pageImageNumber,
        fileName: `第${String(pageNumber).padStart(3, '0')}页_图片${String(pageImageNumber).padStart(2, '0')}.png`,
        blob: converted.blob,
        width: converted.width,
        height: converted.height,
        wasContentCropped: converted.wasContentCropped,
        originalBlob: converted.originalBlob,
        originalWidth: converted.originalWidth,
        originalHeight: converted.originalHeight,
        cleanedBlob: converted.cleanedBlob,
        cleanedWidth: converted.cleanedWidth,
        cleanedHeight: converted.cleanedHeight,
        contentCrop: converted.contentCrop,
        usingOriginal: false,
        isSmall: converted.width < 48 || converted.height < 48 || (converted.width * converted.height) < 4096,
        sourceKey,
      })
    } catch {
      // Some PDF image masks and unsupported color spaces are not standalone images.
    }
  }

  return images
}

export const parsePdfFile = async (file, { signal, onProgress } = {}) => {
  if (!file || (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))) {
    throw new Error('请选择 PDF 文件')
  }
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
    const images = []
    const warnings = []
    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
      assertNotAborted(signal)
      onProgress?.({ pageNumber, pageCount: documentProxy.numPages, imageCount: images.length, stage: '读取页面' })
      const page = await documentProxy.getPage(pageNumber)
      let text = ''
      let preview = null

      try {
        const textContent = await page.getTextContent({ includeMarkedContent: false })
        text = textItemsToPlainText(textContent.items)
      } catch {
        warnings.push(`第 ${pageNumber} 页文字层读取失败`)
      }

      try {
        preview = await renderPagePreview(page, signal)
      } catch {
        warnings.push(`第 ${pageNumber} 页预览生成失败`)
      }

      if (images.length < MAX_EXTRACTED_IMAGES) {
        onProgress?.({ pageNumber, pageCount: documentProxy.numPages, imageCount: images.length, stage: '提取图片' })
        try {
          const pageImages = await extractPageImages(
            page,
            pageNumber,
            pdfjs,
            MAX_EXTRACTED_IMAGES - images.length,
            signal,
          )
          images.push(...pageImages)
        } catch {
          warnings.push(`第 ${pageNumber} 页图片提取未完成`)
        }
      }

      pages.push({
        pageNumber,
        text,
        previewBlob: preview?.blob || null,
        width: preview?.width || 0,
        height: preview?.height || 0,
      })
      page.cleanup()
      onProgress?.({ pageNumber, pageCount: documentProxy.numPages, imageCount: images.length, stage: '完成页面' })
    }

    if (images.length >= MAX_EXTRACTED_IMAGES) warnings.push('PDF 图片较多，已保留前 500 张')
    return { pages, images, warnings, pageCount: documentProxy.numPages }
  } catch (error) {
    if (error?.name === 'PasswordException') throw new Error('该 PDF 受密码保护，当前版本暂不支持打开', { cause: error })
    throw error
  } finally {
    try {
      if (documentProxy) await documentProxy.destroy()
      else await loadingTask.destroy()
    } catch {
      // Cleanup failure must not hide a successful result or the original parse error.
    }
  }
}

export const visitPdfPagesForOcr = async (file, pageNumbers, { signal, onPage, onProgress } = {}) => {
  if (!file || (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))) {
    throw new Error('请选择 PDF 文件')
  }
  if (typeof onPage !== 'function') throw new Error('OCR 页面处理器未正确加载')

  const pdfjs = await loadPdfJs()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
  })
  let documentProxy = null

  try {
    documentProxy = await loadingTask.promise
    const targets = Array.from(new Set(pageNumbers || []))
      .map(Number)
      .filter(pageNumber => Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= documentProxy.numPages)
      .sort((left, right) => left - right)

    for (let index = 0; index < targets.length; index += 1) {
      assertNotAborted(signal)
      const pageNumber = targets[index]
      onProgress?.({
        pageNumber,
        pageCount: targets.length,
        completed: index,
        progress: 0,
        stage: '渲染 OCR 页面',
      })
      const page = await documentProxy.getPage(pageNumber)
      try {
        const rendered = await renderPageForOcr(page, signal)
        await onPage({ ...rendered, pageNumber, index, pageCount: targets.length })
      } finally {
        page.cleanup()
      }
      onProgress?.({
        pageNumber,
        pageCount: targets.length,
        completed: index + 1,
        progress: 0,
        stage: '完成 OCR 页面',
      })
    }
  } catch (error) {
    if (error?.name === 'PasswordException') throw new Error('该 PDF 受密码保护，当前版本暂不支持打开', { cause: error })
    throw error
  } finally {
    try {
      if (documentProxy) await documentProxy.destroy()
      else await loadingTask.destroy()
    } catch {
      // Cleanup failure must not hide OCR results or the original error.
    }
  }
}

export const convertExtractedImage = async (image, { ratio = null, mode = 'crop', format = 'png' } = {}) => {
  if (!ratio && format === 'png' && image.blob?.type === 'image/png') return image.blob
  const source = await loadImageFromBlob(image.blob)
  const target = getRatioCanvasSize(source.naturalWidth, source.naturalHeight, ratio, mode)
  const canvas = document.createElement('canvas')
  canvas.width = target.w
  canvas.height = target.h
  const context = canvas.getContext('2d', { alpha: format === 'png' })
  if (!context) throw new Error('浏览器无法创建导出画布')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  if (format !== 'png' || mode === 'pad') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, target.w, target.h)
  }

  if (ratio && mode === 'crop') {
    const crop = getCenteredCrop(source.naturalWidth, source.naturalHeight, ratio)
    context.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, target.w, target.h)
  } else if (ratio && mode === 'pad') {
    const targetRect = getContainRect(source.naturalWidth, source.naturalHeight, { x: 0, y: 0, w: target.w, h: target.h })
    context.drawImage(source, targetRect.x, targetRect.y, targetRect.w, targetRect.h)
  } else {
    context.drawImage(source, 0, 0, target.w, target.h)
  }

  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
  return canvasToBlob(canvas, mime, format === 'png' ? undefined : 0.92)
}

const addEditableImage = (slide, data, image, box, fitMode) => {
  const placement = getPptImagePlacement(image, box, fitMode)
  slide.addImage({
    data,
    ...placement,
    altText: `PDF 第 ${image.pageNumber} 页图片 ${image.imageNumber}`,
  })
}

const getPptImageData = async (image) => {
  const sourceType = image.blob?.type?.toLowerCase()
  const blob = sourceType === 'image/png' || sourceType === 'image/jpeg'
    ? image.blob
    : await convertExtractedImage(image, { format: 'png' })
  return blobToDataUrl(blob)
}

export const createImagesPptx = async (images, {
  layoutId = 'wide',
  mode = 'pages',
  fitMode = 'fit',
  onProgress,
} = {}) => {
  if (!images.length) throw new Error('请先选择要导出的图片')
  const layout = PPT_LAYOUTS.find(item => item.id === layoutId) || PPT_LAYOUTS[0]
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'TUSCALE_PDF_IMAGES', width: layout.width, height: layout.height })
  pptx.layout = 'TUSCALE_PDF_IMAGES'
  pptx.author = 'TU Scale'
  pptx.subject = 'PDF 图片提取'
  pptx.title = 'PDF 图片'
  pptx.lang = 'zh-CN'
  if (mode === 'collage') {
    const slide = pptx.addSlide()
    slide.background = { color: 'FFFFFF' }
    const boxes = getCollageBoxes(images.length, layout)
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index]
      const data = await getPptImageData(image)
      addEditableImage(slide, data, image, boxes[index], fitMode)
      onProgress?.({ completed: index + 1, total: images.length })
    }
  } else {
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index]
      const data = await getPptImageData(image)
      const slide = pptx.addSlide()
      slide.background = { color: 'FFFFFF' }
      addEditableImage(slide, data, image, getPptSlideImageBox(layout, fitMode), fitMode)
      onProgress?.({ completed: index + 1, total: images.length })
    }
  }

  return pptx.write({ outputType: 'blob', compression: true })
}
