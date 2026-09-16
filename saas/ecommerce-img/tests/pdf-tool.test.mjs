import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import {
  PPT_LAYOUTS,
  combinePageTexts,
  getCenteredCrop,
  getCollageBoxes,
  getCollageGrid,
  getContainRect,
  getPptImagePlacement,
  getPptSlideImageBox,
  getRatioCanvasSize,
  sanitizePdfName,
  textItemsToPlainText,
} from '../src/tools/pdfToolUtils.js'

test('PDF 文件名会移除扩展名和不安全字符', () => {
  assert.equal(sanitizePdfName('报价/方案:最终版.pdf'), '报价_方案_最终版')
  assert.equal(sanitizePdfName('.pdf'), 'PDF')
})

test('PDF 文字项按坐标和换行标记整理成分页文字', () => {
  const text = textItemsToPlainText([
    { str: '第一行', transform: [1, 0, 0, 1, 10, 100] },
    { str: '内容', transform: [1, 0, 0, 1, 60, 100], hasEOL: true },
    { str: '第二行', transform: [1, 0, 0, 1, 10, 80] },
  ])
  assert.equal(text, '第一行内容\n第二行')
  assert.equal(combinePageTexts([{ pageNumber: 1, text }, { pageNumber: 2, text: '' }]), '第 1 页\n第一行内容\n第二行\n\n第 2 页\n（未检测到可复制文字）')
})

test('相邻中文文字片段不会插入多余空格', () => {
  const text = textItemsToPlainText([
    { str: '图片', transform: [1, 0, 0, 1, 10, 100] },
    { str: '处理', transform: [1, 0, 0, 1, 40, 100] },
    { str: '工具', transform: [1, 0, 0, 1, 70, 100] },
  ])
  assert.equal(text, '图片处理工具')
})

test('批量图片文字合并时保留图片名称和文件夹路径', () => {
  const text = combinePageTexts([
    { pageNumber: 1, originalFileName: '标签.png', relativePath: '商品图/标签.png', text: '商品名称' },
    { pageNumber: 2, originalFileName: '背面.jpg', text: '' },
  ])
  assert.equal(text, '第 1 张 · 商品图/标签.png\n商品名称\n\n第 2 张 · 背面.jpg\n（未检测到文字）')
})

test('统一比例裁切保留中心区域并满足目标比例', () => {
  const landscape = getCenteredCrop(1600, 900, 1)
  assert.deepEqual(landscape, { x: 350, y: 0, w: 900, h: 900 })
  const portrait = getCenteredCrop(800, 1200, 16 / 9)
  assert.equal(Math.round(portrait.w / portrait.h * 1000), Math.round(16 / 9 * 1000))
  assert.ok(portrait.y > 0)
})

test('统一比例留白不会超过安全输出边长', () => {
  const result = getRatioCanvasSize(6000, 4000, 1, 'pad', 3000)
  assert.deepEqual(result, { w: 3000, h: 3000 })
})

test('完整显示矩形保持图片比例并居中', () => {
  const rect = getContainRect(1600, 900, { x: 0, y: 0, w: 10, h: 10 })
  assert.equal(rect.w, 10)
  assert.equal(rect.h, 5.625)
  assert.equal(rect.x, 0)
  assert.equal(rect.y, 2.1875)
})

test('PPT 铺满模式覆盖整页并使用保留原图的可编辑裁切', () => {
  const layout = PPT_LAYOUTS[0]
  const box = getPptSlideImageBox(layout, 'fill')
  assert.deepEqual(box, { x: 0, y: 0, w: layout.width, h: layout.height })

  const placement = getPptImagePlacement({ width: 223, height: 149 }, box, 'fill')
  assert.equal(placement.x, 0)
  assert.equal(placement.y, 0)
  assert.equal(placement.w / placement.h, 223 / 149)
  assert.deepEqual(placement.sizing, { type: 'cover', w: layout.width, h: layout.height })
})

test('PPT 完整显示模式继续保留安全边距和原始比例', () => {
  const layout = PPT_LAYOUTS[0]
  const box = getPptSlideImageBox(layout, 'fit')
  assert.equal(box.x, 0.28)
  assert.equal(box.y, 0.28)
  const placement = getPptImagePlacement({ width: 1600, height: 900 }, box, 'fit')
  assert.ok(Math.abs((placement.w / placement.h) - (16 / 9)) < 1e-10)
  assert.equal(placement.sizing, undefined)
})

test('PPTX 铺满导出写入真实裁切参数并保留完整原始图片', async () => {
  const layout = PPT_LAYOUTS[0]
  const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8pdrQAAAABJRU5ErkJggg=='
  const sourceBytes = Buffer.from(imageBase64, 'base64')
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'CROP_TEST', width: layout.width, height: layout.height })
  pptx.layout = 'CROP_TEST'
  const slide = pptx.addSlide()
  slide.addImage({
    data: `data:image/png;base64,${imageBase64}`,
    ...getPptImagePlacement(
      { width: 400, height: 300 },
      getPptSlideImageBox(layout, 'fill'),
      'fill',
    ),
  })

  const output = await pptx.write({ outputType: 'nodebuffer', compression: true })
  const zip = await JSZip.loadAsync(output)
  const slideXml = await zip.file('ppt/slides/slide1.xml').async('string')
  const cropMatch = slideXml.match(/<a:srcRect l="(\d+)" r="(\d+)" t="(\d+)" b="(\d+)"\/>/)
  assert.ok(cropMatch)
  assert.equal(Number(cropMatch[1]), 0)
  assert.equal(Number(cropMatch[2]), 0)
  assert.ok(Number(cropMatch[3]) > 0)
  assert.equal(cropMatch[3], cropMatch[4])
  assert.match(slideXml, /<a:off x="0" y="0"\/>/)
  assert.match(slideXml, new RegExp(`<a:ext cx="${Math.round(layout.width * 914400)}" cy="${Math.round(layout.height * 914400)}"/>`))

  const mediaPath = Object.keys(zip.files).find(path => /^ppt\/media\/.*\.png$/i.test(path))
  assert.ok(mediaPath)
  const embeddedBytes = await zip.file(mediaPath).async('nodebuffer')
  assert.deepEqual(embeddedBytes, sourceBytes)
})

test('图片合集为不同数量生成有效且不重叠的格子', () => {
  PPT_LAYOUTS.forEach((layout) => {
    for (let count = 2; count <= 20; count += 1) {
      const grid = getCollageGrid(count, layout.width, layout.height)
      assert.ok(grid.columns * grid.rows >= count)
      const boxes = getCollageBoxes(count, layout)
      assert.equal(boxes.length, count)
      boxes.forEach((box, index) => {
        assert.ok(box.x >= 0 && box.y >= 0)
        assert.ok(box.x + box.w <= layout.width + 0.001)
        assert.ok(box.y + box.h <= layout.height + 0.001)
        boxes.slice(index + 1).forEach((other) => {
          const overlaps = box.x < other.x + other.w && box.x + box.w > other.x
            && box.y < other.y + other.h && box.y + box.h > other.y
          assert.equal(overlaps, false)
        })
      })
    }
  })
})
