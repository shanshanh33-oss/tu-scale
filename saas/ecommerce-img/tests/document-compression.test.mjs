import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import sharp from 'sharp'
import { File } from 'node:buffer'
import {
  buildRasterPdf,
  compressPptxFile,
  getCompressedDocumentName,
  getCompressionPreset,
  getDocumentCompressionKind,
  getPptxMediaKind,
} from '../src/tools/documentCompression.js'
import { compressPdfImagesKeepingText } from '../src/tools/pdfImageCompression.js'

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

test('文档压缩只接受 PDF 和 PPTX，并生成安全文件名', () => {
  assert.equal(getDocumentCompressionKind({ name: '手册.PDF', type: '' }), 'pdf')
  assert.equal(getDocumentCompressionKind({ name: '演示文稿', type: PPTX_MIME }), 'pptx')
  assert.equal(getDocumentCompressionKind({ name: '旧格式.ppt', type: 'application/vnd.ms-powerpoint' }), '')
  assert.equal(getCompressedDocumentName('客户:方案?.pptx', 'pptx'), '客户_方案__压缩.pptx')
  assert.equal(getCompressedDocumentName('', 'pdf'), '文档_压缩.pdf')
  assert.equal(getCompressionPreset('unknown').id, 'balanced')
})

test('PDF 图片页写入器生成字节偏移正确的多页 PDF', async () => {
  const blob = buildRasterPdf([
    {
      jpegBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      pixelWidth: 1200,
      pixelHeight: 800,
      pageWidth: 600,
      pageHeight: 400,
    },
    {
      jpegBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      pixelWidth: 800,
      pixelHeight: 1200,
      pageWidth: 400,
      pageHeight: 600,
    },
  ])
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const text = new TextDecoder('latin1').decode(bytes)

  assert.equal(blob.type, 'application/pdf')
  assert.match(text, /^%PDF-1\.4/)
  assert.match(text, /\/Type \/Pages \/Count 2/)
  assert.match(text, /\/MediaBox \[0 0 600\.000 400\.000\]/)
  assert.match(text, /\/MediaBox \[0 0 400\.000 600\.000\]/)

  const xrefOffset = Number(text.match(/startxref\n(\d+)/)?.[1])
  assert.equal(text.slice(xrefOffset, xrefOffset + 4), 'xref')
  const xrefLines = text.slice(xrefOffset).split('\n')
  assert.equal(xrefLines[1], '0 9')
  for (let objectId = 1; objectId <= 8; objectId += 1) {
    const objectOffset = Number(xrefLines[2 + objectId].slice(0, 10))
    const objectHeader = new TextDecoder().decode(bytes.slice(objectOffset, objectOffset + 16))
    assert.ok(objectHeader.startsWith(`${objectId} 0 obj`), `对象 ${objectId} 的 xref 偏移应正确`)
  }
})

const buildTextAndPhotoPdf = async () => {
  const width = 192
  const height = 192
  const pixels = Buffer.alloc(width * height * 3)
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index * 37 + (index >> 6)) % 256
  const jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
  const content = 'BT /F1 22 Tf 30 250 Td (Keep me searchable) Tj ET\nq 180 0 0 180 30 30 cm /Im0 Do Q\n'
  const parts = []
  const offsets = []
  let size = 0
  const add = (part) => {
    const bytes = typeof part === 'string' ? new TextEncoder().encode(part) : part
    parts.push(bytes)
    size += bytes.byteLength
  }
  const object = (id, body) => {
    offsets[id] = size
    add(`${id} 0 obj\n`)
    body.forEach(add)
    add('\nendobj\n')
  }
  add('%PDF-1.4\n')
  object(1, ['<< /Type /Catalog /Pages 2 0 R >>'])
  object(2, ['<< /Type /Pages /Count 1 /Kids [3 0 R] >>'])
  object(3, ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> /XObject << /Im0 5 0 R >> >> /Contents 6 0 R >>'])
  object(4, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'])
  object(5, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream'])
  object(6, [`<< /Length ${content.length} >>\nstream\n${content}endstream`])
  const xref = size
  add('xref\n0 7\n0000000000 65535 f \n')
  for (let id = 1; id <= 6; id += 1) add(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  add(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new File(parts, 'text-photo.pdf', { type: 'application/pdf' })
}

const extractFirstPageText = async (blob) => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true })
  const documentProxy = await loadingTask.promise
  try {
    const page = await documentProxy.getPage(1)
    const content = await page.getTextContent()
    return { pageCount: documentProxy.numPages, text: content.items.map(item => item.str).join('') }
  } finally {
    await documentProxy.destroy()
  }
}

test('PDF 图片压缩保留原文字层与页数，不再把整页转为图片', async () => {
  const source = await buildTextAndPhotoPdf()
  const result = await compressPdfImagesKeepingText(source, {
    jpegQuality: 0.5,
    recompressJpeg: async bytes => new Uint8Array(await sharp(bytes).jpeg({ quality: 50 }).toBuffer()),
  })
  const before = await extractFirstPageText(source)
  const after = await extractFirstPageText(result.blob)

  assert.equal(result.pageCount, 1)
  assert.equal(result.imageCount, 1)
  assert.equal(result.changedImageCount, 1)
  assert.ok(result.blob.size < source.size)
  assert.deepEqual(after, before)
  assert.match(after.text, /Keep me searchable/)
})

test('照片无法缩小时不生成丢失文字的压缩版', async () => {
  const source = await buildTextAndPhotoPdf()
  await assert.rejects(
    compressPdfImagesKeepingText(source, { recompressJpeg: async bytes => bytes }),
    /未生成丢失文字的版本/,
  )
})

test('PPTX 压缩只替换媒体图片并保留演示结构和其他资源', async () => {
  const sourceZip = new JSZip()
  const presentationXml = '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" />'
  const relationshipXml = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships" />'
  const vectorBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>')
  const jpegBytes = new Uint8Array(120).fill(17)
  const pngBytes = new Uint8Array(160).fill(29)
  sourceZip.file('ppt/presentation.xml', presentationXml)
  sourceZip.file('ppt/_rels/presentation.xml.rels', relationshipXml)
  sourceZip.file('ppt/media/photo.jpg', jpegBytes)
  sourceZip.file('ppt/media/chart.png', pngBytes)
  sourceZip.file('ppt/media/logo.svg', vectorBytes)
  const sourceBytes = await sourceZip.generateAsync({ type: 'uint8array' })
  const file = new File([sourceBytes], '客户方案.pptx', { type: PPTX_MIME })
  const progress = []

  const result = await compressPptxFile(file, {
    presetId: 'small',
    onProgress: item => progress.push(item),
    recompressImage: async (bytes, kind, settings) => ({
      bytes: bytes.slice(0, kind === 'jpeg' ? 40 : 50),
      appliedMaxDimension: settings.maxDimension,
    }),
  })

  assert.equal(result.kind, 'pptx')
  assert.equal(result.imageCount, 2)
  assert.equal(result.changedImageCount, 2)
  assert.equal(result.fileName, '客户方案_压缩.pptx')
  assert.equal(progress.at(-1).percent, 100)

  const outputZip = await JSZip.loadAsync(await result.blob.arrayBuffer())
  assert.equal(await outputZip.file('ppt/presentation.xml').async('string'), presentationXml)
  assert.equal(await outputZip.file('ppt/_rels/presentation.xml.rels').async('string'), relationshipXml)
  assert.deepEqual(await outputZip.file('ppt/media/logo.svg').async('uint8array'), vectorBytes)
  assert.equal((await outputZip.file('ppt/media/photo.jpg').async('uint8array')).byteLength, 40)
  assert.equal((await outputZip.file('ppt/media/chart.png').async('uint8array')).byteLength, 50)
})

test('PPTX 媒体识别不会误改外部文件或 SVG', () => {
  assert.equal(getPptxMediaKind('ppt/media/image1.jpeg'), 'jpeg')
  assert.equal(getPptxMediaKind('ppt/media/image2.PNG'), 'png')
  assert.equal(getPptxMediaKind('ppt/media/vector.svg'), '')
  assert.equal(getPptxMediaKind('docProps/thumbnail.jpeg'), '')
})
