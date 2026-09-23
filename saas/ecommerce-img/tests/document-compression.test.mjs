import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {
  buildRasterPdf,
  compressPptxFile,
  getCompressedDocumentName,
  getCompressionPreset,
  getDocumentCompressionKind,
  getPptxMediaKind,
} from '../src/tools/documentCompression.js'

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
