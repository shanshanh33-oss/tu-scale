const INITIAL_PROGRESS = { pageNumber: 0, pageCount: 0, imageCount: 0, stage: '' }
const INITIAL_OCR_PROGRESS = { pageNumber: 0, pageCount: 0, completed: 0, progress: 0, stage: '' }
const INITIAL_COMPRESSION_PROGRESS = { completed: 0, total: 0, percent: 0, stage: '' }

const createInitialCompression = () => ({
  file: null,
  kind: '',
  presetId: 'balanced',
  processing: false,
  progress: INITIAL_COMPRESSION_PROGRESS,
  result: null,
  error: '',
  message: '',
})

const createInitialSnapshot = () => ({
  file: null,
  sourceFiles: [],
  sourceType: '',
  result: null,
  selectedIds: [],
  parsing: false,
  ocrRunning: false,
  exporting: '',
  progress: INITIAL_PROGRESS,
  ocrProgress: INITIAL_OCR_PROGRESS,
  compression: createInitialCompression(),
  error: '',
  message: '',
})

export const getPdfTaskErrorMessage = (error) => {
  if (error?.name === 'AbortError') return '已取消 PDF 解析'
  if (/Invalid PDF|PDF structure|格式/i.test(error?.message || '')) return 'PDF 文件损坏或格式不受支持'
  return error?.message || 'PDF 处理失败，请换一个文件重试'
}

export const createPdfTaskStore = ({
  createObjectUrl = blob => URL.createObjectURL(blob),
  revokeObjectUrl = url => URL.revokeObjectURL(url),
} = {}) => {
  let snapshot = createInitialSnapshot()
  let activeController = null
  let activeOcrController = null
  let activeCompressionController = null
  let activeRunId = 0
  let activeOcrRunId = 0
  let activeCompressionRunId = 0
  const listeners = new Set()
  const objectUrls = new Set()

  const getSnapshot = () => snapshot

  const subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const update = (patch) => {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach(listener => listener())
  }

  const clearObjectUrls = () => {
    objectUrls.forEach((url) => {
      try {
        revokeObjectUrl(url)
      } catch {
        // A revoked preview must not prevent the next PDF task from starting.
      }
    })
    objectUrls.clear()
  }

  const addObjectUrl = (blob) => {
    if (!blob) return ''
    const url = createObjectUrl(blob)
    objectUrls.add(url)
    return url
  }

  const removeObjectUrl = (url) => {
    if (!url || !objectUrls.has(url)) return
    objectUrls.delete(url)
    try {
      revokeObjectUrl(url)
    } catch {
      // An already revoked OCR preview can be replaced safely.
    }
  }

  const setSelectedIds = (nextValue) => {
    const nextIds = typeof nextValue === 'function' ? nextValue(snapshot.selectedIds) : nextValue
    update({ selectedIds: Array.isArray(nextIds) ? nextIds : [] })
  }

  const updatePageText = (pageNumber, text) => {
    if (!snapshot.result) return
    const pages = snapshot.result.pages.map(page => page.pageNumber === pageNumber
      ? { ...page, text: String(text || ''), textSource: 'manual' }
      : page)
    update({ result: { ...snapshot.result, pages } })
  }

  const toggleImageSource = (imageId) => {
    if (!snapshot.result) return
    const images = snapshot.result.images.map((image) => {
      if (image.id !== imageId || !image.wasContentCropped || !image.originalBlob || !image.cleanedBlob) return image
      const usingOriginal = !image.usingOriginal
      const blob = usingOriginal ? image.originalBlob : image.cleanedBlob
      const width = usingOriginal ? image.originalWidth : image.cleanedWidth
      const height = usingOriginal ? image.originalHeight : image.cleanedHeight
      removeObjectUrl(image.previewUrl)
      return {
        ...image,
        blob,
        width,
        height,
        usingOriginal,
        previewUrl: addObjectUrl(blob),
      }
    })
    update({ result: { ...snapshot.result, images } })
  }

  const reset = () => {
    activeRunId += 1
    activeOcrRunId += 1
    activeController?.abort()
    activeOcrController?.abort()
    activeController = null
    activeOcrController = null
    clearObjectUrls()
    const compression = snapshot.compression
    snapshot = {
      ...createInitialSnapshot(),
      compression,
      exporting: compression.processing ? `compress-${compression.kind}` : '',
    }
    listeners.forEach(listener => listener())
  }

  const cancel = () => activeController?.abort()
  const cancelOcr = () => activeOcrController?.abort()
  const cancelCompression = () => activeCompressionController?.abort()

  const clearCompression = () => {
    activeCompressionRunId += 1
    activeCompressionController?.abort()
    activeCompressionController = null
    update({
      exporting: String(snapshot.exporting).startsWith('compress-') ? '' : snapshot.exporting,
      compression: createInitialCompression(),
    })
  }

  const startCompression = async (file, kind, presetId, runCompression) => {
    if (!file || !['pdf', 'pptx'].includes(kind)) {
      update({
        compression: { ...createInitialCompression(), error: '请选择 PDF 或 PPTX 文件' },
      })
      return null
    }
    if (snapshot.parsing || snapshot.ocrRunning || snapshot.exporting) {
      update({
        compression: { ...snapshot.compression, error: '请等待当前任务完成后再压缩文档', message: '' },
      })
      return null
    }
    if (typeof runCompression !== 'function') {
      update({
        compression: { ...snapshot.compression, error: '文档压缩器未正确加载', message: '' },
      })
      return null
    }

    activeCompressionRunId += 1
    const runId = activeCompressionRunId
    activeCompressionController?.abort()
    const controller = new AbortController()
    activeCompressionController = controller
    update({
      exporting: `compress-${kind}`,
      compression: {
        file,
        kind,
        presetId,
        processing: true,
        progress: { ...INITIAL_COMPRESSION_PROGRESS, stage: kind === 'pdf' ? '正在打开 PDF' : '正在打开 PPTX' },
        result: null,
        error: '',
        message: '文档正在浏览器本地压缩，可切换到 TU Scale 其他页面',
      },
    })

    try {
      const result = await runCompression(file, {
        presetId,
        signal: controller.signal,
        onProgress: progress => {
          if (activeCompressionRunId === runId) {
            update({ compression: { ...snapshot.compression, progress } })
          }
        },
      })
      if (activeCompressionRunId !== runId) return null
      const savedBytes = (result.originalSize || 0) - (result.compressedSize || 0)
      update({
        exporting: '',
        compression: {
          ...snapshot.compression,
          processing: false,
          progress: { ...snapshot.compression.progress, percent: 100, stage: '压缩完成' },
          result,
          error: '',
          message: savedBytes > 0
            ? `压缩完成，减少 ${Math.round((savedBytes / result.originalSize) * 100)}%`
            : '压缩完成；该文件已经较精简，输出体积没有继续减小',
        },
      })
      return result
    } catch (error) {
      if (activeCompressionRunId !== runId) return null
      const cancelled = error?.name === 'AbortError'
      update({
        exporting: '',
        compression: {
          ...snapshot.compression,
          processing: false,
          error: cancelled ? '' : (error?.message || '文档压缩失败，请换一个文件重试'),
          message: cancelled ? '已取消文档压缩' : '',
        },
      })
      return null
    } finally {
      if (activeCompressionRunId === runId) activeCompressionController = null
    }
  }

  const start = async (file, parsePdfFile) => {
    if (!file || (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))) {
      update({ error: '请选择 PDF 文件', message: '' })
      return null
    }
    if (typeof parsePdfFile !== 'function') {
      update({ error: 'PDF 解析器未正确加载', message: '' })
      return null
    }
    if (snapshot.compression.processing) {
      update({ error: '请等待文档压缩完成后再解析 PDF', message: '' })
      return null
    }

    activeRunId += 1
    activeOcrRunId += 1
    const runId = activeRunId
    activeController?.abort()
    activeOcrController?.abort()
    clearObjectUrls()
    const controller = new AbortController()
    activeController = controller
    update({
      file,
      sourceFiles: [],
      sourceType: 'pdf',
      result: null,
      selectedIds: [],
      parsing: true,
      ocrRunning: false,
      exporting: '',
      progress: { ...INITIAL_PROGRESS, stage: '打开 PDF' },
      ocrProgress: INITIAL_OCR_PROGRESS,
      error: '',
      message: 'PDF 正在本地后台解析，可切换到 TU Scale 其他页面',
    })

    try {
      const parsed = await parsePdfFile(file, {
        signal: controller.signal,
        onProgress: progress => {
          if (activeRunId === runId) update({ progress })
        },
      })
      if (activeRunId !== runId) return null

      const pages = parsed.pages.map(page => ({
        ...page,
        previewUrl: addObjectUrl(page.previewBlob),
      }))
      const images = parsed.images.map(image => ({
        ...image,
        previewUrl: addObjectUrl(image.blob),
      }))
      const preferredSelection = images.filter(image => !image.isSmall).map(image => image.id)
      const croppedCount = images.filter(image => image.wasContentCropped).length
      const result = { ...parsed, sourceType: 'pdf', pages, images }

      update({
        result,
        selectedIds: preferredSelection.length ? preferredSelection : images.map(image => image.id),
        parsing: false,
        progress: {
          pageNumber: parsed.pageCount,
          pageCount: parsed.pageCount,
          imageCount: images.length,
          stage: '解析完成',
        },
        error: '',
        message: `解析完成：${parsed.pageCount} 页，提取 ${images.length} 张栅格图片，${pages.filter(page => page.text.trim()).length} 页含文字${croppedCount ? `，智能清理 ${croppedCount} 张图片的页面底色和小装饰` : ''}`,
      })
      return result
    } catch (error) {
      if (activeRunId !== runId) return null
      update({
        parsing: false,
        error: error?.name === 'AbortError' ? '' : getPdfTaskErrorMessage(error),
        message: error?.name === 'AbortError' ? '已取消 PDF 解析' : '',
      })
      return null
    } finally {
      if (activeRunId === runId) activeController = null
    }
  }

  const startOcr = async (runOcr) => {
    if (!snapshot.file || snapshot.sourceType !== 'pdf' || !snapshot.result) {
      update({ error: '请先完成 PDF 解析', message: '' })
      return null
    }
    if (snapshot.parsing || snapshot.exporting) {
      update({ error: '请等待当前任务完成后再启动 OCR', message: '' })
      return null
    }
    if (typeof runOcr !== 'function') {
      update({ error: 'OCR 识别器未正确加载', message: '' })
      return null
    }

    activeOcrRunId += 1
    const runId = activeOcrRunId
    activeOcrController?.abort()
    const controller = new AbortController()
    activeOcrController = controller
    update({
      ocrRunning: true,
      ocrProgress: { ...INITIAL_OCR_PROGRESS, stage: '加载本地 OCR' },
      error: '',
      message: 'OCR 正在本地后台识别，可切换到 TU Scale 其他页面',
    })

    try {
      const ocrPages = await runOcr({
        signal: controller.signal,
        onProgress: ocrProgress => {
          if (activeOcrRunId === runId) update({ ocrProgress })
        },
      })
      if (activeOcrRunId !== runId) return null

      const ocrByPage = new Map(ocrPages.map(page => [page.pageNumber, page]))
      const pages = snapshot.result.pages.map((page) => {
        const recognized = ocrByPage.get(page.pageNumber)
        if (!recognized) return page
        return {
          ...page,
          text: recognized.text || '',
          textSource: 'ocr',
          ocrConfidence: recognized.confidence,
        }
      })
      const images = [...snapshot.result.images]
      const selected = new Set(snapshot.selectedIds)

      ocrPages.forEach((recognized) => {
        if (!recognized.pageImageBlob) return
        const id = `page-${recognized.pageNumber}-ocr-page`
        const existingIndex = images.findIndex(image => image.id === id)
        const existing = existingIndex >= 0 ? images[existingIndex] : null
        if (existing?.previewUrl) removeObjectUrl(existing.previewUrl)
        const imageNumber = existing?.imageNumber
          || images.filter(image => image.pageNumber === recognized.pageNumber && !image.isPageImage).length + 1
        const pageImage = {
          id,
          pageNumber: recognized.pageNumber,
          imageNumber,
          fileName: `第${String(recognized.pageNumber).padStart(3, '0')}页_扫描页.png`,
          displayName: `第 ${recognized.pageNumber} 页扫描图`,
          blob: recognized.pageImageBlob,
          width: recognized.width,
          height: recognized.height,
          isSmall: false,
          isPageImage: true,
          sourceKey: `ocr-page:${recognized.pageNumber}`,
          previewUrl: addObjectUrl(recognized.pageImageBlob),
        }
        if (existingIndex >= 0) images[existingIndex] = pageImage
        else images.push(pageImage)
        selected.add(id)
      })

      const result = { ...snapshot.result, pages, images }
      const recognizedCount = ocrPages.filter(page => page.text?.trim()).length
      update({
        result,
        selectedIds: [...selected],
        ocrRunning: false,
        ocrProgress: {
          pageNumber: ocrPages.at(-1)?.pageNumber || 0,
          pageCount: ocrPages.length,
          completed: ocrPages.length,
          progress: 0,
          stage: 'OCR 完成',
        },
        error: '',
        message: `OCR 完成：处理 ${ocrPages.length} 页，${recognizedCount} 页识别到文字，扫描页图片已加入图片列表`,
      })
      return result
    } catch (error) {
      if (activeOcrRunId !== runId) return null
      update({
        ocrRunning: false,
        error: error?.name === 'AbortError' ? '' : getPdfTaskErrorMessage(error),
        message: error?.name === 'AbortError' ? '已取消 OCR 识别' : '',
      })
      return null
    } finally {
      if (activeOcrRunId === runId) activeOcrController = null
    }
  }

  const startImageOcr = async (files, runOcr) => {
    const sourceFiles = Array.from(files || [])
    if (!sourceFiles.length) {
      update({ error: '请选择要识别的图片', message: '' })
      return null
    }
    if (typeof runOcr !== 'function') {
      update({ error: 'OCR 识别器未正确加载', message: '' })
      return null
    }
    if (snapshot.compression.processing) {
      update({ error: '请等待文档压缩完成后再识别图片', message: '' })
      return null
    }

    activeRunId += 1
    activeOcrRunId += 1
    const runId = activeOcrRunId
    activeController?.abort()
    activeOcrController?.abort()
    clearObjectUrls()
    const controller = new AbortController()
    activeController = null
    activeOcrController = controller
    const folderName = sourceFiles[0]?.webkitRelativePath?.split('/')[0]
    const displayName = folderName
      ? `${folderName}（${sourceFiles.length} 张图片）`
      : sourceFiles.length === 1 ? sourceFiles[0].name : `批量图片（${sourceFiles.length} 张）`
    const taskFile = {
      name: displayName,
      size: sourceFiles.reduce((total, item) => total + (item.size || 0), 0),
      type: 'image/*',
    }
    update({
      file: taskFile,
      sourceFiles,
      sourceType: 'images',
      result: null,
      selectedIds: [],
      parsing: false,
      ocrRunning: true,
      exporting: '',
      progress: INITIAL_PROGRESS,
      ocrProgress: { ...INITIAL_OCR_PROGRESS, pageCount: sourceFiles.length, stage: '加载本地 OCR' },
      error: '',
      message: '批量图片正在本地后台识别，可切换到 TU Scale 其他页面',
    })

    try {
      const ocrPages = await runOcr({
        signal: controller.signal,
        onProgress: ocrProgress => {
          if (activeOcrRunId === runId) update({ ocrProgress })
        },
      })
      if (activeOcrRunId !== runId) return null

      const pages = ocrPages.map(page => ({
        pageNumber: page.pageNumber,
        text: page.text || '',
        textSource: 'ocr',
        ocrConfidence: page.confidence,
        previewBlob: page.pageImageBlob,
        previewUrl: addObjectUrl(page.pageImageBlob),
        width: page.width,
        height: page.height,
        originalFileName: page.originalFileName,
        relativePath: page.relativePath,
        sourceFileName: page.sourceFileName,
        sourceFileIndex: page.sourceFileIndex,
        splitIndex: page.splitIndex,
        splitCount: page.splitCount,
        wasSplit: page.wasSplit,
      }))
      const images = ocrPages.map((page) => {
        const safeName = String(page.originalFileName || `图片${page.pageNumber}.png`).replace(/[\\/]/g, '_')
        return {
          id: `uploaded-image-${page.pageNumber}`,
          pageNumber: page.pageNumber,
          imageNumber: 1,
          fileName: `第${String(page.pageNumber).padStart(3, '0')}张_${safeName}`,
          displayName: page.relativePath || page.originalFileName || `第 ${page.pageNumber} 张图片`,
          blob: page.pageImageBlob,
          width: page.width,
          height: page.height,
          isSmall: false,
          isUploadedImage: true,
          sourceFileName: page.sourceFileName,
          sourceFileIndex: page.sourceFileIndex,
          splitIndex: page.splitIndex,
          splitCount: page.splitCount,
          wasSplit: page.wasSplit,
          sourceKey: `uploaded-image:${page.pageNumber}`,
          previewUrl: addObjectUrl(page.pageImageBlob),
        }
      })
      const recognizedCount = pages.filter(page => page.text.trim()).length
      const splitSourceCount = new Set(pages.filter(page => page.wasSplit).map(page => page.sourceFileIndex)).size
      const result = {
        sourceType: 'images',
        pages,
        images,
        warnings: [],
        pageCount: pages.length,
      }
      update({
        result,
        selectedIds: images.map(image => image.id),
        ocrRunning: false,
        ocrProgress: {
          pageNumber: pages.length,
          pageCount: pages.length,
          completed: pages.length,
          progress: 0,
          stage: 'OCR 完成',
        },
        error: '',
        message: splitSourceCount
          ? `拼图拆分和识别完成：${sourceFiles.length} 个文件拆出 ${pages.length} 张单图，${recognizedCount} 张识别到文字`
          : `批量识别完成：${pages.length} 张图片，${recognizedCount} 张识别到文字`,
      })
      return result
    } catch (error) {
      if (activeOcrRunId !== runId) return null
      update({
        ocrRunning: false,
        error: error?.name === 'AbortError' ? '' : getPdfTaskErrorMessage(error),
        message: error?.name === 'AbortError' ? '已取消批量图片 OCR' : '',
      })
      return null
    } finally {
      if (activeOcrRunId === runId) activeOcrController = null
    }
  }

  return {
    cancel,
    cancelCompression,
    cancelOcr,
    clearCompression,
    getSnapshot,
    reset,
    setSelectedIds,
    start,
    startCompression,
    startImageOcr,
    startOcr,
    subscribe,
    toggleImageSource,
    update,
    updatePageText,
  }
}

export const pdfTaskStore = createPdfTaskStore()
