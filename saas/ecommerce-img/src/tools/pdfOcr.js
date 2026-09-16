import { OEM, PSM, createWorker } from 'tesseract.js'
import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url'
import { prepareImageForOcr, splitCollageImage } from './collageSplitter'
import { visitPdfPagesForOcr } from './pdfProcessing'

const OCR_CORE_PATH = '/ocr/tesseract-core'
const OCR_LANGUAGE_PATH = '/ocr/tessdata'
const OCR_LANGUAGES = ['chi_sim', 'eng']

const abortError = () => new DOMException('OCR 已取消', 'AbortError')

const assertNotAborted = (signal) => {
  if (signal?.aborted) throw abortError()
}

const raceWithAbort = (promise, signal) => {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const handleAbort = () => reject(abortError())
    signal.addEventListener('abort', handleAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', handleAbort))
  })
}

const getOcrStage = (status) => {
  const stages = {
    'loading tesseract core': '加载 OCR 引擎',
    'loaded tesseract core': 'OCR 引擎已加载',
    'initializing tesseract': '初始化 OCR 引擎',
    'initialized tesseract': 'OCR 引擎已初始化',
    'loading language traineddata': '加载中英文识别模型',
    'loaded language traineddata': '中英文模型已加载',
    'initializing api': '准备文字识别',
    'initialized api': '文字识别已就绪',
    'recognizing text': '识别文字',
  }
  return stages[status] || '准备本地 OCR'
}

const createLocalOcrWorker = async (signal, logger) => {
  assertNotAborted(signal)
  const workerPromise = createWorker(OCR_LANGUAGES, OEM.LSTM_ONLY, {
    workerPath: ocrWorkerUrl,
    workerBlobURL: false,
    corePath: OCR_CORE_PATH,
    langPath: OCR_LANGUAGE_PATH,
    gzip: true,
    logger,
  })
  try {
    return await raceWithAbort(workerPromise, signal)
  } catch (error) {
    if (signal?.aborted) workerPromise.then(worker => worker.terminate()).catch(() => {})
    throw error
  }
}

const cleanRecognizedText = (value) => String(value || '')
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
  .filter(line => !line || /[\p{L}\p{N}\u3400-\u9fff\uf900-\ufaff]/u.test(line))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/([\u3400-\u9fff\uf900-\ufaff])[ \t\u00a0]+(?=[\u3400-\u9fff\uf900-\ufaff])/g, '$1')
  .trim()

const getOrderedLineText = (data) => {
  const lines = (data?.blocks || []).flatMap(block => (block.paragraphs || [])
    .flatMap(paragraph => paragraph.lines || []))
    .map(line => ({
      text: cleanRecognizedText(line.text),
      confidence: Number(line.confidence),
      bbox: line.bbox,
    }))
    .filter(line => line.text && (!Number.isFinite(line.confidence) || line.confidence >= 35) && line.bbox)
    .sort((left, right) => {
      const leftCenter = (left.bbox.y0 + left.bbox.y1) / 2
      const rightCenter = (right.bbox.y0 + right.bbox.y1) / 2
      const height = Math.max(1, left.bbox.y1 - left.bbox.y0, right.bbox.y1 - right.bbox.y0)
      return Math.abs(leftCenter - rightCenter) <= height * 0.45
        ? left.bbox.x0 - right.bbox.x0
        : leftCenter - rightCenter
    })
  return cleanRecognizedText(lines.map(line => line.text).join('\n'))
}

const recognizeWithWorker = async (worker, image, signal, { orderDetectedLines = false } = {}) => {
  assertNotAborted(signal)
  const recognition = worker.recognize(image, { rotateAuto: true }, { text: true, blocks: orderDetectedLines })
  const result = await raceWithAbort(recognition, signal)
  assertNotAborted(signal)
  const confidence = Number.isFinite(result?.data?.confidence) ? result.data.confidence : null
  const orderedText = orderDetectedLines ? getOrderedLineText(result?.data) : ''
  const text = orderDetectedLines && confidence !== null && confidence < 45
    ? ''
    : orderedText || cleanRecognizedText(result?.data?.text)
  return {
    text,
    confidence,
  }
}

const runOcrBatch = async (items, recognizeItem, { signal, onProgress, workerParameters } = {}) => {
  if (!items.length) return []
  let current = { pageNumber: 0, pageCount: items.length, completed: 0 }
  let worker = null
  const handleAbort = () => worker?.terminate()
  signal?.addEventListener('abort', handleAbort, { once: true })

  try {
    worker = await createLocalOcrWorker(signal, ({ status, progress = 0 }) => {
      onProgress?.({ ...current, progress, stage: getOcrStage(status) })
    })
    assertNotAborted(signal)
    if (workerParameters) {
      onProgress?.({ ...current, progress: 0, stage: '优化识别顺序' })
      await raceWithAbort(worker.setParameters(workerParameters), signal)
    }
    const results = []
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      current = {
        pageNumber: item.pageNumber || index + 1,
        pageCount: items.length,
        completed: index,
      }
      onProgress?.({ ...current, progress: 0, stage: '准备识别' })
      results.push(await recognizeItem(worker, item, current))
      onProgress?.({ ...current, completed: index + 1, progress: 0, stage: '完成识别' })
    }
    return results
  } finally {
    signal?.removeEventListener('abort', handleAbort)
    await worker?.terminate().catch(() => {})
  }
}

export const recognizePdfPages = async (file, pageNumbers, { signal, onProgress } = {}) => {
  const targets = Array.from(new Set(pageNumbers || []))
    .map(Number)
    .filter(pageNumber => Number.isInteger(pageNumber) && pageNumber >= 1)
    .sort((left, right) => left - right)
  if (!targets.length) return []

  let current = { pageNumber: targets[0], pageCount: targets.length, completed: 0 }
  let worker = null
  const handleAbort = () => worker?.terminate()
  signal?.addEventListener('abort', handleAbort, { once: true })

  try {
    worker = await createLocalOcrWorker(signal, ({ status, progress = 0 }) => {
      onProgress?.({ ...current, progress, stage: getOcrStage(status) })
    })
    const results = []
    await visitPdfPagesForOcr(file, targets, {
      signal,
      onProgress,
      onPage: async (page) => {
        current = {
          pageNumber: page.pageNumber,
          pageCount: targets.length,
          completed: page.index,
        }
        onProgress?.({ ...current, progress: 0, stage: '识别页面文字' })
        const recognized = await recognizeWithWorker(worker, page.blob, signal)
        results.push({
          pageNumber: page.pageNumber,
          text: recognized.text,
          confidence: recognized.confidence,
          pageImageBlob: page.blob,
          width: page.width,
          height: page.height,
        })
      },
    })
    return results
  } finally {
    signal?.removeEventListener('abort', handleAbort)
    await worker?.terminate().catch(() => {})
  }
}

export const recognizeImageFiles = async (files, { signal, onProgress, splitCollages = true } = {}) => {
  const sourceFiles = Array.from(files || [])
  const items = []
  for (let fileIndex = 0; fileIndex < sourceFiles.length; fileIndex += 1) {
    assertNotAborted(signal)
    const file = sourceFiles[fileIndex]
    onProgress?.({
      pageNumber: fileIndex + 1,
      pageCount: sourceFiles.length,
      completed: fileIndex,
      progress: 0,
      stage: splitCollages ? '检查并拆分拼图' : '读取图片',
    })
    const parts = await splitCollageImage(file, { signal, enabled: splitCollages })
    parts.forEach(part => items.push({
      ...part,
      sourceFileIndex: fileIndex + 1,
      pageNumber: items.length + 1,
    }))
  }

  return runOcrBatch(items, async (worker, item) => {
    const ocrInput = await prepareImageForOcr(item.blob, item.width, item.height, { signal })
    const recognized = await recognizeWithWorker(worker, ocrInput, signal, { orderDetectedLines: true })
    return {
      pageNumber: item.pageNumber,
      text: recognized.text,
      confidence: recognized.confidence,
      pageImageBlob: item.blob,
      width: item.width,
      height: item.height,
      originalFileName: item.originalFileName,
      relativePath: item.relativePath,
      sourceFileName: item.sourceFileName,
      sourceFileIndex: item.sourceFileIndex,
      splitIndex: item.splitIndex,
      splitCount: item.splitCount,
      wasSplit: item.wasSplit,
    }
  }, {
    signal,
    onProgress,
    workerParameters: {
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
    },
  })
}
