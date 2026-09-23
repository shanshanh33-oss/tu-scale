import test from 'node:test'
import assert from 'node:assert/strict'
import { createPdfTaskStore } from '../src/tools/pdfTaskStore.js'

const pdfFile = { name: '后台任务.pdf', type: 'application/pdf' }

test('PDF 任务在页面订阅取消后仍会继续并保留结果', async () => {
  let finishParsing
  let parsingSignal
  const createdUrls = []
  const store = createPdfTaskStore({
    createObjectUrl: () => {
      const url = `blob:test-${createdUrls.length + 1}`
      createdUrls.push(url)
      return url
    },
    revokeObjectUrl: () => {},
  })
  const parse = (_file, { signal, onProgress }) => new Promise((resolve) => {
    parsingSignal = signal
    onProgress({ pageNumber: 1, pageCount: 240, imageCount: 1, stage: '读取页面' })
    finishParsing = () => resolve({
      pageCount: 240,
      warnings: [],
      pages: [{ pageNumber: 1, text: '后台完成', previewBlob: new Blob(['preview']) }],
      images: [{ id: 'image-1', isSmall: false, blob: new Blob(['image']) }],
    })
  })

  const unsubscribe = store.subscribe(() => {})
  const pending = store.start(pdfFile, parse)
  unsubscribe()
  assert.equal(store.getSnapshot().parsing, true)
  assert.equal(store.getSnapshot().progress.pageCount, 240)
  assert.equal(parsingSignal.aborted, false)

  finishParsing()
  const result = await pending
  assert.equal(result.pageCount, 240)
  assert.equal(store.getSnapshot().parsing, false)
  assert.equal(store.getSnapshot().result.pageCount, 240)
  assert.deepEqual(store.getSnapshot().selectedIds, ['image-1'])
  assert.equal(store.getSnapshot().result.pages[0].previewUrl, 'blob:test-1')
  assert.equal(store.getSnapshot().result.images[0].previewUrl, 'blob:test-2')
})

test('PDF 后台任务只有主动取消或重置时才会中止', async () => {
  const revokedUrls = []
  const store = createPdfTaskStore({
    createObjectUrl: () => 'blob:unused',
    revokeObjectUrl: url => revokedUrls.push(url),
  })
  const parse = (_file, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
  })

  const pending = store.start(pdfFile, parse)
  store.cancel()
  await pending
  assert.equal(store.getSnapshot().parsing, false)
  assert.equal(store.getSnapshot().error, '')
  assert.equal(store.getSnapshot().message, '已取消 PDF 解析')

  store.reset()
  assert.equal(store.getSnapshot().file, null)
  assert.equal(store.getSnapshot().result, null)
  assert.deepEqual(revokedUrls, [])
})

test('PDF OCR 会合并分页文字并把扫描页加入可选图片', async () => {
  let urlIndex = 0
  const store = createPdfTaskStore({
    createObjectUrl: () => `blob:ocr-${++urlIndex}`,
    revokeObjectUrl: () => {},
  })
  await store.start(pdfFile, async () => ({
    pageCount: 2,
    warnings: [],
    pages: [
      { pageNumber: 1, text: '原文字', previewBlob: new Blob(['page-1']) },
      { pageNumber: 2, text: '', previewBlob: new Blob(['page-2']) },
    ],
    images: [],
  }))

  const result = await store.startOcr(async ({ onProgress }) => {
    onProgress({ pageNumber: 2, pageCount: 1, completed: 0, progress: 0.5, stage: '识别文字' })
    return [{
      pageNumber: 2,
      text: '扫描文字',
      confidence: 91.4,
      pageImageBlob: new Blob(['scan']),
      width: 1200,
      height: 1600,
    }]
  })

  assert.equal(result.pages[0].text, '原文字')
  assert.equal(result.pages[1].text, '扫描文字')
  assert.equal(result.pages[1].textSource, 'ocr')
  assert.equal(result.pages[1].ocrConfidence, 91.4)
  assert.equal(result.images.length, 1)
  assert.equal(result.images[0].isPageImage, true)
  assert.equal(result.images[0].previewUrl, 'blob:ocr-3')
  assert.deepEqual(store.getSnapshot().selectedIds, ['page-2-ocr-page'])
})

test('智能裁切图可以无损切换回原图再恢复裁切图', async () => {
  const revokedUrls = []
  let urlIndex = 0
  const store = createPdfTaskStore({
    createObjectUrl: () => `blob:crop-${++urlIndex}`,
    revokeObjectUrl: url => revokedUrls.push(url),
  })
  const originalBlob = new Blob(['original'])
  const cleanedBlob = new Blob(['cleaned'])
  await store.start(pdfFile, async () => ({
    pageCount: 1,
    warnings: [],
    pages: [{ pageNumber: 1, text: '', previewBlob: new Blob(['page']) }],
    images: [{
      id: 'image-cleaned',
      blob: cleanedBlob,
      width: 800,
      height: 500,
      isSmall: false,
      wasContentCropped: true,
      originalBlob,
      originalWidth: 1200,
      originalHeight: 900,
      cleanedBlob,
      cleanedWidth: 800,
      cleanedHeight: 500,
      usingOriginal: false,
    }],
  }))

  store.toggleImageSource('image-cleaned')
  let image = store.getSnapshot().result.images[0]
  assert.equal(image.blob, originalBlob)
  assert.equal(image.width, 1200)
  assert.equal(image.height, 900)
  assert.equal(image.usingOriginal, true)

  store.toggleImageSource('image-cleaned')
  image = store.getSnapshot().result.images[0]
  assert.equal(image.blob, cleanedBlob)
  assert.equal(image.width, 800)
  assert.equal(image.height, 500)
  assert.equal(image.usingOriginal, false)
  assert.equal(revokedUrls.length, 2)
})

test('批量图片 OCR 在取消页面订阅后继续并保留原图和文字', async () => {
  let finishOcr
  const store = createPdfTaskStore({
    createObjectUrl: blob => `blob:${blob.size}`,
    revokeObjectUrl: () => {},
  })
  const files = [
    { name: '商品一.png', size: 10, type: 'image/png', webkitRelativePath: '商品图/商品一.png' },
    { name: '商品二.jpg', size: 20, type: 'image/jpeg', webkitRelativePath: '商品图/子目录/商品二.jpg' },
  ]
  const runOcr = ({ onProgress }) => new Promise((resolve) => {
    onProgress({ pageNumber: 1, pageCount: 2, completed: 0, progress: 0.2, stage: '识别文字' })
    finishOcr = () => resolve(files.map((file, index) => ({
      pageNumber: index + 1,
      text: `文字${index + 1}`,
      confidence: 90 + index,
      pageImageBlob: new Blob([`image-${index}`]),
      width: 800,
      height: 600,
      originalFileName: file.name,
      relativePath: file.webkitRelativePath,
    })))
  })

  const unsubscribe = store.subscribe(() => {})
  const pending = store.startImageOcr(files, runOcr)
  unsubscribe()
  assert.equal(store.getSnapshot().ocrRunning, true)
  assert.equal(store.getSnapshot().sourceType, 'images')
  assert.equal(store.getSnapshot().file.name, '商品图（2 张图片）')

  finishOcr()
  const result = await pending
  assert.equal(result.pageCount, 2)
  assert.equal(result.pages[1].text, '文字2')
  assert.equal(result.images[0].displayName, '商品图/商品一.png')
  assert.deepEqual(store.getSnapshot().selectedIds, ['uploaded-image-1', 'uploaded-image-2'])
  assert.equal(store.getSnapshot().ocrRunning, false)
})

test('拼图拆分结果会成为独立图片且识别文字可以手动修正', async () => {
  let urlIndex = 0
  const store = createPdfTaskStore({
    createObjectUrl: () => `blob:split-${urlIndex++}`,
    revokeObjectUrl: () => {},
  })
  const file = { name: '拼图.png', size: 30, type: 'image/png' }
  const result = await store.startImageOcr([file], async () => [
    {
      pageNumber: 1,
      text: '错别字',
      pageImageBlob: new Blob(['one']),
      width: 300,
      height: 400,
      originalFileName: '拼图_拆分01.png',
      sourceFileName: '拼图.png',
      sourceFileIndex: 1,
      splitIndex: 1,
      splitCount: 2,
      wasSplit: true,
    },
    {
      pageNumber: 2,
      text: '第二张',
      pageImageBlob: new Blob(['two']),
      width: 300,
      height: 400,
      originalFileName: '拼图_拆分02.png',
      sourceFileName: '拼图.png',
      sourceFileIndex: 1,
      splitIndex: 2,
      splitCount: 2,
      wasSplit: true,
    },
  ])

  assert.equal(result.images.length, 2)
  assert.equal(result.images[1].splitIndex, 2)
  assert.match(store.getSnapshot().message, /1 个文件拆出 2 张单图/)
  store.updatePageText(1, '已经修正')
  assert.equal(store.getSnapshot().result.pages[0].text, '已经修正')
  assert.equal(store.getSnapshot().result.pages[0].textSource, 'manual')
})

test('批量 OCR 可主动取消', async () => {
  const store = createPdfTaskStore()
  const runOcr = ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
  })
  const pending = store.startImageOcr([{ name: 'a.png', size: 1 }], runOcr)
  store.cancelOcr()
  await pending
  assert.equal(store.getSnapshot().ocrRunning, false)
  assert.equal(store.getSnapshot().error, '')
  assert.equal(store.getSnapshot().message, '已取消批量图片 OCR')
})

test('文档压缩在页面取消订阅后继续并保留可下载结果', async () => {
  let finishCompression
  let receivedPreset
  const store = createPdfTaskStore()
  const file = { name: '大文件.pptx', size: 1000, type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
  const runCompression = (_file, { presetId, signal, onProgress }) => new Promise((resolve) => {
    receivedPreset = presetId
    assert.equal(signal.aborted, false)
    onProgress({ completed: 3, total: 10, percent: 30, stage: '压缩图片 3/10' })
    finishCompression = () => resolve({
      blob: new Blob(['compressed']),
      kind: 'pptx',
      imageCount: 10,
      changedImageCount: 8,
      originalSize: 1000,
      compressedSize: 600,
      fileName: '大文件_压缩.pptx',
    })
  })

  const unsubscribe = store.subscribe(() => {})
  const pending = store.startCompression(file, 'pptx', 'small', runCompression)
  unsubscribe()
  assert.equal(store.getSnapshot().compression.processing, true)
  assert.equal(store.getSnapshot().exporting, 'compress-pptx')
  assert.equal(store.getSnapshot().compression.progress.percent, 30)

  finishCompression()
  const result = await pending
  assert.equal(receivedPreset, 'small')
  assert.equal(result.fileName, '大文件_压缩.pptx')
  assert.equal(store.getSnapshot().compression.processing, false)
  assert.equal(store.getSnapshot().compression.result.compressedSize, 600)
  assert.match(store.getSnapshot().compression.message, /减少 40%/)
})

test('清空提取结果不会中止正在后台执行的文档压缩', async () => {
  let finishCompression
  let compressionSignal
  const store = createPdfTaskStore()
  const file = { name: '扫描件.pdf', size: 500, type: 'application/pdf' }
  const pending = store.startCompression(file, 'pdf', 'balanced', (_file, { signal }) => new Promise((resolve) => {
    compressionSignal = signal
    finishCompression = () => resolve({
      blob: new Blob(['pdf']),
      kind: 'pdf',
      originalSize: 500,
      compressedSize: 300,
      fileName: '扫描件_压缩.pdf',
    })
  }))

  store.reset()
  assert.equal(compressionSignal.aborted, false)
  assert.equal(store.getSnapshot().compression.processing, true)
  assert.equal(store.getSnapshot().exporting, 'compress-pdf')

  finishCompression()
  await pending
  assert.equal(store.getSnapshot().compression.result.fileName, '扫描件_压缩.pdf')
})

test('文档压缩可主动取消', async () => {
  const store = createPdfTaskStore()
  const file = { name: '扫描件.pdf', size: 500, type: 'application/pdf' }
  const pending = store.startCompression(file, 'pdf', 'balanced', (_file, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
  }))

  store.cancelCompression()
  await pending
  assert.equal(store.getSnapshot().compression.processing, false)
  assert.equal(store.getSnapshot().compression.error, '')
  assert.equal(store.getSnapshot().compression.message, '已取消文档压缩')
  assert.equal(store.getSnapshot().exporting, '')
})
