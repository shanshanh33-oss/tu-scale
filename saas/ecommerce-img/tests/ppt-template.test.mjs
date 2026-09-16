import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {
  createTemplatePptx,
  getTemplateImagePlacement,
  inspectPptxTemplate,
} from '../src/tools/pptTemplate.js'

const relationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'
const officeRelationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const markerShape = (id, name, marker, x, y, width, height) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"><a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"><a16:creationId xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" id="{00000000-0000-0000-0000-${String(id).padStart(12, '0')}}"/></a:ext></a:extLst></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1800"/><a:t>${marker}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="1800"/></a:p></p:txBody></p:sp>`

const makeTemplate = async () => {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`)
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${officeRelationship}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId2" Type="${officeRelationship}/slide" Target="slides/slide1.xml"/></Relationships>`)
  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${officeRelationship}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${markerShape(2, '图片框', '{{图片}}', 457200, 1371600, 5486400, 4572000)}${markerShape(3, '正文框', '{{文字}}', 6400800, 1371600, 5303520, 4572000)}${markerShape(4, '标题框', '{{标题}}', 457200, 274320, 11277600, 731520)}</p:spTree><p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="1461402097"/></p:ext></p:extLst></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId1" Type="${officeRelationship}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId9" Type="${officeRelationship}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`)
  const blob = await zip.generateAsync({ type: 'blob' })
  Object.defineProperty(blob, 'name', { value: '模板.pptx' })
  return blob
}

test('PPTX 模板检查会列出页面和三个内容标记', async () => {
  const template = await makeTemplate()
  const info = await inspectPptxTemplate(template)
  assert.equal(info.slideCount, 1)
  assert.equal(info.slides[0].hasImageMarker, true)
  assert.equal(info.slides[0].hasTextMarker, true)
  assert.equal(info.slides[0].hasTitleMarker, true)
  assert.deepEqual(info.slideSize, { width: 12192000, height: 6858000 })
})

test('模板导出复制内容页并写入独立图片和可编辑文字', async () => {
  const template = await makeTemplate()
  const imageOne = { width: 1200, height: 800, blob: new Blob(['png-one'], { type: 'image/png' }) }
  const imageTwo = { width: 800, height: 1200, blob: new Blob(['png-two'], { type: 'image/png' }) }
  const output = await createTemplatePptx(template, [
    { image: imageOne, title: '商品正面', text: '第一行\n第二行' },
    { image: imageTwo, title: '商品背面', text: '背面说明' },
  ], {
    normalizeImage: image => image.blob,
    templateSlideNumber: 1,
  })
  const zip = await JSZip.loadAsync(await output.arrayBuffer())
  const presentation = await zip.file('ppt/presentation.xml').async('string')
  const presentationRels = await zip.file('ppt/_rels/presentation.xml.rels').async('string')
  const slideOne = await zip.file('ppt/slides/slide1.xml').async('string')
  const slideTwo = await zip.file('ppt/slides/slide2.xml').async('string')
  const slideOneRels = await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string')
  const slideTwoRels = await zip.file('ppt/slides/_rels/slide2.xml.rels').async('string')
  const contentTypes = await zip.file('[Content_Types].xml').async('string')

  assert.equal((presentation.match(/<p:sldId\b/g) || []).length, 2)
  assert.match(presentationRels, /Target="slides\/slide2\.xml"/)
  assert.match(slideOne, /商品正面/)
  assert.match(slideOne, /第一行/)
  assert.match(slideOne, /第二行/)
  assert.match(slideTwo, /商品背面/)
  assert.match(slideTwo, /背面说明/)
  assert.match(slideOne, /p14:creationId/)
  assert.match(slideOne, /a16:creationId/)
  assert.equal(slideTwo.includes('p14:creationId'), false)
  assert.equal(slideTwo.includes('a16:creationId'), false)
  assert.equal(slideOne.includes('{{图片}}'), false)
  assert.equal(slideOne.includes('{{文字}}'), false)
  assert.equal(slideOne.includes('{{标题}}'), false)
  assert.match(slideOne, /<p:pic>/)
  assert.match(slideTwo, /<p:pic>/)
  assert.match(slideOneRels, /notesSlide/)
  assert.equal(slideTwoRels.includes('notesSlide'), false)
  assert.match(slideTwoRels, /slideLayout/)
  assert.match(slideTwoRels, /tuscale-template-01-0002\.png/)
  assert.ok(zip.file('ppt/media/tuscale-template-01-0001.png'))
  assert.ok(zip.file('ppt/media/tuscale-template-01-0002.png'))
  assert.match(contentTypes, /Extension="png" ContentType="image\/png"/)
  assert.match(contentTypes, /PartName="\/ppt\/slides\/slide2\.xml"/)
})

test('模板图片完整显示和铺满裁切都保持有效范围', () => {
  const rect = { x: 0, y: 0, width: 1000, height: 1000 }
  const fit = getTemplateImagePlacement(rect, { width: 1600, height: 900 }, 'fit')
  assert.deepEqual(fit, { x: 0, y: 219, width: 1000, height: 563, crop: null })

  const fill = getTemplateImagePlacement(rect, { width: 1600, height: 900 }, 'fill')
  assert.deepEqual(fill, {
    x: 0,
    y: 0,
    width: 1000,
    height: 1000,
    crop: { left: 21875, top: 0, right: 21875, bottom: 0 },
  })
})
