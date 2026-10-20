import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import sharp from 'sharp'
import {
  createPdfDirectPptx,
  getPdfDirectRenderScale,
  getPdfDirectSlideSize,
} from '../src/tools/pdfDirectPptx.js'

test('直接转换保留首个 PDF 页面比例，并限制渲染像素', () => {
  const wide = getPdfDirectSlideSize(960, 540)
  assert.ok(Math.abs(wide.width / wide.height - (16 / 9)) < 0.001)
  const portrait = getPdfDirectSlideSize(595, 842)
  assert.ok(Math.abs(portrait.width / portrait.height - (595 / 842)) < 0.001)
  const scale = getPdfDirectRenderScale(10000, 9000)
  assert.ok(10000 * 9000 * scale * scale <= 14000001)
})

test('每页 PDF 生成独立的可裁切图片对象和有效 PPTX 结构', async () => {
  const red = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#cc2222' } }).png().toBuffer()
  const blue = await sharp({ create: { width: 80, height: 120, channels: 3, background: '#2222cc' } }).png().toBuffer()
  const pages = [
    { pageWidth: 960, pageHeight: 540, dataUrl: `data:image/png;base64,${red.toString('base64')}` },
    { pageWidth: 540, pageHeight: 960, dataUrl: `data:image/png;base64,${blue.toString('base64')}` },
  ]
  const progress = []
  const blob = await createPdfDirectPptx(pages, { total: 2, onProgress: value => progress.push(value.completed) })
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const presentation = await zip.file('ppt/presentation.xml').async('string')
  const firstSlide = await zip.file('ppt/slides/slide1.xml').async('string')
  const secondSlide = await zip.file('ppt/slides/slide2.xml').async('string')
  const media = Object.keys(zip.files).filter(name => /^ppt\/media\/[^/]+\.(?:png|jpe?g)$/i.test(name))

  assert.deepEqual(progress, [1, 2])
  assert.equal((presentation.match(/<p:sldId\b/g) || []).length, 2)
  assert.match(firstSlide, /<p:pic\b/)
  assert.match(secondSlide, /<p:pic\b/)
  assert.equal(media.length, 2)
})
