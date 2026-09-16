import JSZip from 'jszip'

const PRESENTATION_PATH = 'ppt/presentation.xml'
const PRESENTATION_RELS_PATH = 'ppt/_rels/presentation.xml.rels'
const CONTENT_TYPES_PATH = '[Content_Types].xml'
const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const SLIDE_RELATIONSHIP_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
const IMAGE_RELATIONSHIP_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const SLIDE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const EMU_PER_INCH = 914400

const MARKERS = {
  image: [/\{\{\s*图片\s*\}\}/i, /\{\{\s*image\s*\}\}/i],
  text: [/\{\{\s*文字\s*\}\}/i, /\{\{\s*text\s*\}\}/i, /\{\{\s*正文\s*\}\}/i],
  title: [/\{\{\s*标题\s*\}\}/i, /\{\{\s*title\s*\}\}/i],
}

const getAttribute = (source, name) => {
  const match = source.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))
  return match?.[1] || ''
}

const decodeXml = (value = '') => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')

const escapeXml = (value = '') => Array.from(String(value), character => {
  const code = character.charCodeAt(0)
  return code < 32 && code !== 9 && code !== 10 && code !== 13 ? '' : character
}).join('')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

const normalizePath = (value) => {
  const parts = []
  String(value).split('/').forEach((part) => {
    if (!part || part === '.') return
    if (part === '..') parts.pop()
    else parts.push(part)
  })
  return parts.join('/')
}

const resolveRelationshipPath = (sourcePath, target) => {
  if (target.startsWith('/')) return normalizePath(target.slice(1))
  return normalizePath(`${sourcePath.split('/').slice(0, -1).join('/')}/${target}`)
}

const getSlideRelsPath = slidePath => slidePath.replace('/slides/', '/slides/_rels/') + '.rels'

const readRequiredText = async (zip, path, message) => {
  const entry = zip.file(path)
  if (!entry) throw new Error(message)
  return entry.async('string')
}

const loadPptxZip = async (file) => {
  const source = typeof file?.arrayBuffer === 'function' ? await file.arrayBuffer() : file
  return JSZip.loadAsync(source)
}

const parseRelationships = (xml) => {
  const relationships = new Map()
  for (const match of xml.matchAll(/<Relationship\b[^>]*(?:\/>|><\/Relationship>)/gi)) {
    const id = getAttribute(match[0], 'Id')
    if (!id) continue
    relationships.set(id, {
      id,
      target: getAttribute(match[0], 'Target'),
      type: getAttribute(match[0], 'Type'),
      raw: match[0],
    })
  }
  return relationships
}

const getPresentationParts = async (zip) => {
  const presentationXml = await readRequiredText(zip, PRESENTATION_PATH, 'PPTX 模板缺少演示文稿结构')
  const presentationRelsXml = await readRequiredText(zip, PRESENTATION_RELS_PATH, 'PPTX 模板缺少页面关系')
  const relationships = parseRelationships(presentationRelsXml)
  const slides = []

  for (const match of presentationXml.matchAll(/<p:sldId\b[^>]*(?:\/>|><\/p:sldId>)/gi)) {
    const relationshipId = getAttribute(match[0], 'r:id')
    const relationship = relationships.get(relationshipId)
    if (!relationship || !relationship.type.endsWith('/slide')) continue
    slides.push({
      id: Number(getAttribute(match[0], 'id')) || 0,
      relationshipId,
      path: resolveRelationshipPath(PRESENTATION_PATH, relationship.target),
      raw: match[0],
    })
  }

  if (!slides.length) throw new Error('PPTX 模板中没有可用页面')
  const sizeMatch = presentationXml.match(/<p:sldSz\b[^>]*\/?>(?:<\/p:sldSz>)?/i)
  return {
    presentationXml,
    presentationRelsXml,
    slides,
    slideSize: {
      width: Number(getAttribute(sizeMatch?.[0] || '', 'cx')) || Math.round(13.333 * EMU_PER_INCH),
      height: Number(getAttribute(sizeMatch?.[0] || '', 'cy')) || Math.round(7.5 * EMU_PER_INCH),
    },
  }
}

const getShapeText = (shapeXml) => Array.from(shapeXml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi))
  .map(match => decodeXml(match[1]))
  .join('')

const getSlideText = (slideXml) => Array.from(slideXml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi))
  .map(match => decodeXml(match[1]))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim()

const markerTypeForText = (text) => Object.entries(MARKERS)
  .find(([, patterns]) => patterns.some(pattern => pattern.test(text)))?.[0] || ''

const getMarkerShapes = (slideXml) => {
  const markers = {}
  for (const match of slideXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/gi)) {
    const text = getShapeText(match[0])
    const type = markerTypeForText(text)
    if (type && !markers[type]) markers[type] = { raw: match[0], text }
  }
  return markers
}

const getTransform = (shapeXml) => {
  const transform = shapeXml?.match(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/i)?.[0]
  if (!transform) return null
  const offset = transform.match(/<a:off\b[^>]*\/?>(?:<\/a:off>)?/i)?.[0] || ''
  const extent = transform.match(/<a:ext\b[^>]*\/?>(?:<\/a:ext>)?/i)?.[0] || ''
  const rect = {
    x: Number(getAttribute(offset, 'x')),
    y: Number(getAttribute(offset, 'y')),
    width: Number(getAttribute(extent, 'cx')),
    height: Number(getAttribute(extent, 'cy')),
  }
  return Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0 ? rect : null
}

const getMaxNumericId = (xml, pattern) => {
  let maximum = 0
  for (const match of xml.matchAll(pattern)) maximum = Math.max(maximum, Number(match[1]) || 0)
  return maximum
}

const makeRect = (slideSize, x, y, width, height) => ({
  x: Math.round(slideSize.width * x),
  y: Math.round(slideSize.height * y),
  width: Math.round(slideSize.width * width),
  height: Math.round(slideSize.height * height),
})

export const getTemplateImagePlacement = (rect, image, fitMode = 'fit') => {
  if (!image?.width || !image?.height || fitMode === 'fill') {
    if (!image?.width || !image?.height || fitMode !== 'fill') return { ...rect, crop: null }
    const sourceRatio = image.width / image.height
    const targetRatio = rect.width / rect.height
    if (sourceRatio > targetRatio) {
      const visible = targetRatio / sourceRatio
      const crop = Math.round(((1 - visible) / 2) * 100000)
      return { ...rect, crop: { left: crop, top: 0, right: crop, bottom: 0 } }
    }
    const visible = sourceRatio / targetRatio
    const crop = Math.round(((1 - visible) / 2) * 100000)
    return { ...rect, crop: { left: 0, top: crop, right: 0, bottom: crop } }
  }

  const scale = Math.min(rect.width / image.width, rect.height / image.height)
  const width = Math.round(image.width * scale)
  const height = Math.round(image.height * scale)
  return {
    x: rect.x + Math.round((rect.width - width) / 2),
    y: rect.y + Math.round((rect.height - height) / 2),
    width,
    height,
    crop: null,
  }
}

const makePictureXml = ({ relationshipId, shapeId, name, rect, image, fitMode }) => {
  const placement = getTemplateImagePlacement(rect, image, fitMode)
  const crop = placement.crop
    ? `<a:srcRect l="${placement.crop.left}" t="${placement.crop.top}" r="${placement.crop.right}" b="${placement.crop.bottom}"/>`
    : ''
  return `<p:pic><p:nvPicPr><p:cNvPr id="${shapeId}" name="${escapeXml(name)}" descr="${escapeXml(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationshipId}"/>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${placement.x}" y="${placement.y}"/><a:ext cx="${placement.width}" cy="${placement.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
}

const firstTag = (xml, tagName) => xml.match(new RegExp(`<${tagName}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/${tagName}>)`, 'i'))?.[0] || ''

const replaceShapeText = (shapeXml, value) => {
  const textBody = shapeXml.match(/<p:txBody\b[^>]*>[\s\S]*?<\/p:txBody>/i)?.[0]
  if (!textBody) return shapeXml
  const bodyProperties = firstTag(textBody, 'a:bodyPr') || '<a:bodyPr wrap="square"/>'
  const listStyle = firstTag(textBody, 'a:lstStyle') || '<a:lstStyle/>'
  const paragraphProperties = firstTag(textBody, 'a:pPr')
  const runProperties = firstTag(textBody, 'a:rPr') || '<a:rPr lang="zh-CN" dirty="0"/>'
  const endProperties = firstTag(textBody, 'a:endParaRPr') || '<a:endParaRPr lang="zh-CN" dirty="0"/>'
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n')
  const paragraphs = (lines.length ? lines : ['']).map(line => `<a:p>${paragraphProperties}${line ? `<a:r>${runProperties}<a:t xml:space="preserve">${escapeXml(line)}</a:t></a:r>` : ''}${endProperties}</a:p>`).join('')
  const nextTextBody = `<p:txBody>${bodyProperties}${listStyle}${paragraphs}</p:txBody>`
  return shapeXml.replace(textBody, nextTextBody)
}

const makeTextShapeXml = ({ shapeId, name, rect, text, fontSize, title = false }) => {
  const family = title ? '+mj-lt' : '+mn-lt'
  const eastAsia = title ? '+mj-ea' : '+mn-ea'
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const paragraphs = lines.map(line => `<a:p><a:pPr algn="l"/><a:r><a:rPr lang="zh-CN" sz="${fontSize}" dirty="0"><a:latin typeface="${family}"/><a:ea typeface="${eastAsia}"/></a:rPr><a:t xml:space="preserve">${escapeXml(line)}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="${fontSize}" dirty="0"/></a:p>`).join('')
  return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${rect.x}" y="${rect.y}"/><a:ext cx="${rect.width}" cy="${rect.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720"><a:normAutofit fontScale="90000" lnSpcReduction="20000"/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`
}

const insertBeforeClosingTag = (xml, closingTag, value) => {
  const index = xml.lastIndexOf(closingTag)
  if (index < 0) throw new Error('PPTX 模板页面结构不完整')
  return `${xml.slice(0, index)}${value}${xml.slice(index)}`
}

const stripDuplicateOnlyRelationships = (relationshipsXml) => relationshipsXml.replace(
  /<Relationship\b[^>]*(?:\/>|><\/Relationship>)/gi,
  relationship => /\/(?:notesSlide|comments|commentAuthors|people)$/i.test(getAttribute(relationship, 'Type')) ? '' : relationship,
)

const stripDuplicateCreationIds = (slideXml) => slideXml
  .replace(/<a:ext\b[^>]*>\s*<a16:creationId\b[^>]*\/>\s*<\/a:ext>/gi, '')
  .replace(/<p:ext\b[^>]*>\s*<p14:creationId\b[^>]*\/>\s*<\/p:ext>/gi, '')
  .replace(/<a:extLst>\s*<\/a:extLst>/gi, '')
  .replace(/<p:extLst>\s*<\/p:extLst>/gi, '')

const addRelationship = (relationshipsXml, relationship) => insertBeforeClosingTag(
  relationshipsXml,
  '</Relationships>',
  `<Relationship Id="${relationship.id}" Type="${relationship.type}" Target="${relationship.target}"/>`,
)

const ensureSlideRelationshipXml = (xml = '') => xml || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELATIONSHIP_NS}"></Relationships>`

const ensureContentTypeDefault = (contentTypesXml, extension, contentType) => {
  const defaultPattern = new RegExp(`<Default\\b[^>]*Extension="${extension}"`, 'i')
  if (defaultPattern.test(contentTypesXml)) return contentTypesXml
  return insertBeforeClosingTag(contentTypesXml, '</Types>', `<Default Extension="${extension}" ContentType="${contentType}"/>`)
}

const addSlideContentType = (contentTypesXml, slidePath) => {
  const partName = `/${slidePath}`
  if (contentTypesXml.includes(`PartName="${partName}"`)) return contentTypesXml
  return insertBeforeClosingTag(contentTypesXml, '</Types>', `<Override PartName="${partName}" ContentType="${SLIDE_CONTENT_TYPE}"/>`)
}

const getImageFormat = (blob) => {
  if (blob?.type === 'image/jpeg') return { extension: 'jpg', contentType: 'image/jpeg' }
  return { extension: 'png', contentType: 'image/png' }
}

const getUniqueMediaName = (zip, baseName, extension) => {
  let suffix = 0
  let candidate = `${baseName}.${extension}`
  while (zip.file(`ppt/media/${candidate}`)) {
    suffix += 1
    candidate = `${baseName}-${suffix}.${extension}`
  }
  return candidate
}

const applyEntryToSlide = ({ slideXml, slideRelsXml, slideSize, entry, mediaName, fitMode, includeText }) => {
  const markers = getMarkerShapes(slideXml)
  const imageRect = getTransform(markers.image?.raw) || makeRect(slideSize, 0.05, 0.18, 0.54, 0.72)
  let nextSlideXml = slideXml
  let nextSlideRelsXml = ensureSlideRelationshipXml(slideRelsXml)
  let shapeId = getMaxNumericId(slideXml, /<p:cNvPr\b[^>]*\bid="(\d+)"/gi) + 1
  const relationshipNumber = getMaxNumericId(nextSlideRelsXml, /\bId="rId(\d+)"/gi) + 1
  const imageRelationshipId = `rId${relationshipNumber}`
  const fallbackShapes = []

  if (markers.image) nextSlideXml = nextSlideXml.replace(markers.image.raw, '')
  if (markers.title) nextSlideXml = nextSlideXml.replace(markers.title.raw, replaceShapeText(markers.title.raw, entry.title || ''))
  else {
    const titleRect = makeRect(slideSize, 0.05, 0.04, 0.9, 0.1)
    fallbackShapes.push(makeTextShapeXml({
      shapeId: shapeId++,
      name: 'TU Scale 标题',
      rect: titleRect,
      text: entry.title || '',
      fontSize: 2400,
      title: true,
    }))
  }

  if (markers.text) {
    nextSlideXml = nextSlideXml.replace(markers.text.raw, includeText ? replaceShapeText(markers.text.raw, entry.text || '') : '')
  } else if (includeText) {
    const textRect = makeRect(slideSize, 0.62, 0.18, 0.33, 0.72)
    const textLength = String(entry.text || '').length
    const fontSize = textLength > 1200 ? 1000 : textLength > 700 ? 1200 : textLength > 350 ? 1400 : 1800
    fallbackShapes.push(makeTextShapeXml({
      shapeId: shapeId++,
      name: 'TU Scale OCR 文字',
      rect: textRect,
      text: entry.text || '',
      fontSize,
    }))
  }

  nextSlideXml = insertBeforeClosingTag(nextSlideXml, '</p:spTree>', makePictureXml({
    relationshipId: imageRelationshipId,
    shapeId,
    name: entry.title || mediaName,
    rect: imageRect,
    image: entry.image,
    fitMode,
  }))
  for (const shapeXml of fallbackShapes) {
    nextSlideXml = insertBeforeClosingTag(nextSlideXml, '</p:spTree>', shapeXml)
  }
  nextSlideRelsXml = addRelationship(nextSlideRelsXml, {
    id: imageRelationshipId,
    type: IMAGE_RELATIONSHIP_TYPE,
    target: `../media/${mediaName}`,
  })
  return { slideXml: nextSlideXml, slideRelsXml: nextSlideRelsXml }
}

export const inspectPptxTemplate = async (templateFile) => {
  if (!templateFile || !/\.pptx$/i.test(templateFile.name || '')) throw new Error('请选择 PPTX 模板文件')
  const zip = await loadPptxZip(templateFile)
  const parts = await getPresentationParts(zip)
  const slides = []
  for (let index = 0; index < parts.slides.length; index += 1) {
    const slide = parts.slides[index]
    const slideXml = await readRequiredText(zip, slide.path, `模板第 ${index + 1} 页无法读取`)
    const markers = getMarkerShapes(slideXml)
    const text = getSlideText(slideXml)
    slides.push({
      number: index + 1,
      title: text.replace(/\{\{\s*(?:图片|image|文字|text|正文|标题|title)\s*\}\}/gi, '').trim().slice(0, 60) || '无普通文字',
      hasImageMarker: Boolean(markers.image),
      hasTextMarker: Boolean(markers.text),
      hasTitleMarker: Boolean(markers.title),
    })
  }
  return { slideCount: slides.length, slides, slideSize: parts.slideSize }
}

export const createTemplatePptx = async (templateFile, entries, {
  templateSlideNumber = 1,
  fitMode = 'fit',
  includeText = true,
  normalizeImage,
  onProgress,
} = {}) => {
  if (!templateFile || !/\.pptx$/i.test(templateFile.name || '')) throw new Error('请先上传 PPTX 模板')
  if (!entries?.length) throw new Error('请先选择要放进模板的图片')
  const zip = await loadPptxZip(templateFile)
  const parts = await getPresentationParts(zip)
  const selectedSlide = parts.slides[templateSlideNumber - 1]
  if (!selectedSlide) throw new Error('选择的模板内容页不存在')
  const originalSlideXml = await readRequiredText(zip, selectedSlide.path, '模板内容页无法读取')
  const originalSlideRelsPath = getSlideRelsPath(selectedSlide.path)
  const originalSlideRelsXml = await zip.file(originalSlideRelsPath)?.async('string') || ''
  let presentationXml = parts.presentationXml
  let presentationRelsXml = parts.presentationRelsXml
  let contentTypesXml = await readRequiredText(zip, CONTENT_TYPES_PATH, 'PPTX 模板缺少内容类型定义')
  let nextSlideNumber = Math.max(0, ...Object.keys(zip.files).map(path => Number(path.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1]) || 0)) + 1
  let nextSlideId = Math.max(255, ...parts.slides.map(slide => slide.id)) + 1
  let nextPresentationRelationshipNumber = getMaxNumericId(presentationRelsXml, /\bId="rId(\d+)"/gi) + 1
  const generatedSlideIds = [selectedSlide.raw]

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const normalizedBlob = normalizeImage ? await normalizeImage(entry.image) : entry.image?.blob
    if (!normalizedBlob) throw new Error(`第 ${index + 1} 张图片无法写入 PPT`)
    const format = getImageFormat(normalizedBlob)
    const mediaName = getUniqueMediaName(
      zip,
      `tuscale-template-${String(templateSlideNumber).padStart(2, '0')}-${String(index + 1).padStart(4, '0')}`,
      format.extension,
    )
    const targetSlidePath = index === 0 ? selectedSlide.path : `ppt/slides/slide${nextSlideNumber++}.xml`
    const targetSlideRelsPath = getSlideRelsPath(targetSlidePath)
    const baseRelsXml = index === 0 ? originalSlideRelsXml : stripDuplicateOnlyRelationships(originalSlideRelsXml)
    const applied = applyEntryToSlide({
      // Office creation IDs are document-wide identity metadata. Keeping the
      // same IDs on every cloned page makes PowerPoint repair the file. They
      // are optional, so clones omit them and PowerPoint can assign fresh IDs.
      slideXml: index === 0 ? originalSlideXml : stripDuplicateCreationIds(originalSlideXml),
      slideRelsXml: baseRelsXml,
      slideSize: parts.slideSize,
      entry,
      mediaName,
      fitMode,
      includeText,
    })

    zip.file(targetSlidePath, applied.slideXml)
    zip.file(targetSlideRelsPath, applied.slideRelsXml)
    zip.file(`ppt/media/${mediaName}`, new Uint8Array(await normalizedBlob.arrayBuffer()))
    contentTypesXml = ensureContentTypeDefault(contentTypesXml, format.extension, format.contentType)

    if (index > 0) {
      const relationshipId = `rId${nextPresentationRelationshipNumber++}`
      presentationRelsXml = addRelationship(presentationRelsXml, {
        id: relationshipId,
        type: SLIDE_RELATIONSHIP_TYPE,
        target: targetSlidePath.replace(/^ppt\//, ''),
      })
      generatedSlideIds.push(`<p:sldId id="${nextSlideId++}" r:id="${relationshipId}"/>`)
      contentTypesXml = addSlideContentType(contentTypesXml, targetSlidePath)
    }
    onProgress?.({ completed: index + 1, total: entries.length })
  }

  presentationXml = presentationXml.replace(selectedSlide.raw, generatedSlideIds.join(''))
  zip.file(PRESENTATION_PATH, presentationXml)
  zip.file(PRESENTATION_RELS_PATH, presentationRelsXml)
  zip.file(CONTENT_TYPES_PATH, contentTypesXml)
  return zip.generateAsync({ type: 'blob', mimeType: PPTX_MIME, compression: 'DEFLATE' })
}
