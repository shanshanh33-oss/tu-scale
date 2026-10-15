const encoder = new TextEncoder()
const decoder = new TextDecoder('latin1')

const asText = (bytes, start, end) => decoder.decode(bytes.subarray(start, end))
const asBytes = value => encoder.encode(value)

const unsupported = message => new Error(message || '此 PDF 的内部结构暂不支持保留文字压缩，原文件未被修改')
const assertNotAborted = signal => {
  if (signal?.aborted) throw new DOMException('PDF 压缩已取消', 'AbortError')
}

const findAscii = (bytes, word, start, end) => {
  const needle = asBytes(word)
  for (let index = start; index <= end - needle.length; index += 1) {
    let matched = true
    for (let part = 0; part < needle.length; part += 1) {
      if (bytes[index + part] !== needle[part]) {
        matched = false
        break
      }
    }
    if (matched) return index
  }
  return -1
}

export const readClassicPdfTable = (bytes) => {
  if (!asText(bytes, 0, Math.min(8, bytes.length)).startsWith('%PDF-')) throw unsupported('PDF 文件格式无效')
  const tail = asText(bytes, Math.max(0, bytes.length - 65536), bytes.length)
  const references = [...tail.matchAll(/startxref\s+(\d+)\s+%%EOF/g)]
  const xrefOffset = Number(references.at(-1)?.[1])
  if (!Number.isSafeInteger(xrefOffset) || xrefOffset < 0 || xrefOffset >= bytes.length) throw unsupported()
  const tableText = asText(bytes, xrefOffset, Math.min(bytes.length, xrefOffset + 2000000))
  if (!/^xref(?:\r\n|\r|\n)/.test(tableText)) throw unsupported()
  if (/\/Linearized\b/.test(asText(bytes, 0, Math.min(bytes.length, 2048)))) throw unsupported()

  const lines = tableText.split(/\r\n|\r|\n/)
  const entries = new Map()
  let lineIndex = 1
  while (lineIndex < lines.length && lines[lineIndex].trim() !== 'trailer') {
    const section = /^(\d+)\s+(\d+)$/.exec(lines[lineIndex].trim())
    if (!section) throw unsupported()
    const firstId = Number(section[1])
    const count = Number(section[2])
    if (!Number.isSafeInteger(firstId) || !Number.isSafeInteger(count) || count > 1000000) throw unsupported()
    lineIndex += 1
    for (let index = 0; index < count; index += 1, lineIndex += 1) {
      const entry = /^(\d{10})\s+(\d{5})\s+([nf])\b/.exec(lines[lineIndex] || '')
      if (!entry) throw unsupported()
      if (entry[3] === 'n' && Number(entry[1]) > 0) entries.set(firstId + index, {
        offset: Number(entry[1]),
        generation: Number(entry[2]),
      })
    }
  }
  if (lines[lineIndex]?.trim() !== 'trailer') throw unsupported()
  const trailer = lines.slice(lineIndex + 1).join('\n').split(/startxref\b/)[0]
  if (/\/(?:Prev|XRefStm|Encrypt)\b/.test(trailer)) throw unsupported()
  const size = Number(/\/Size\s+(\d+)/.exec(trailer)?.[1])
  const root = /\/Root\s+(\d+\s+\d+\s+R)\b/.exec(trailer)?.[1]
  const info = /\/Info\s+(\d+\s+\d+\s+R)\b/.exec(trailer)?.[1]
  const id = /\/ID\s*(\[[\s\S]*?\])/.exec(trailer)?.[1]
  if (!Number.isSafeInteger(size) || size < 2 || size > 1000000 || !root || !entries.size) throw unsupported()
  if ([...entries.values()].some(entry => entry.offset < 0 || entry.offset >= xrefOffset)) throw unsupported()
  return { entries, size, root, info, id, xrefOffset }
}

const getObjectPrefix = (bytes, entry, end) => asText(bytes, entry.offset, Math.min(end, entry.offset + 4096))

const readPageCount = (bytes, table) => {
  const catalogId = Number(table.root.split(/\s+/)[0])
  const catalog = table.entries.get(catalogId)
  if (!catalog) return 0
  const pagesId = Number(/\/Pages\s+(\d+)\s+\d+\s+R/.exec(getObjectPrefix(bytes, catalog, table.xrefOffset))?.[1])
  const pages = table.entries.get(pagesId)
  if (!pages) return 0
  return Number(/\/Count\s+(\d+)/.exec(getObjectPrefix(bytes, pages, table.xrefOffset))?.[1]) || 0
}

const getJpegImage = (bytes, object, end) => {
  const stream = findAscii(bytes, 'stream', object.offset, Math.min(end, object.offset + 4096))
  if (stream < 0) return null
  const prefix = asText(bytes, object.offset, stream)
  if (!/\/Subtype\s*\/Image\b/.test(prefix) || !/\/Filter\s*\/DCTDecode\b/.test(prefix)) return null
  if (!/\/BitsPerComponent\s+8\b/.test(prefix) || /\/(?:Decode|DecodeParms|Mask|ImageMask)\b/.test(prefix)) return null
  const color = /\/ColorSpace\s+(\/DeviceRGB\b|\d+\s+\d+\s+R\b)/.exec(prefix)
  const length = Number(/\/Length\s+(\d+)\b/.exec(prefix)?.[1])
  const width = Number(/\/Width\s+(\d+)\b/.exec(prefix)?.[1])
  const height = Number(/\/Height\s+(\d+)\b/.exec(prefix)?.[1])
  if (!color || !Number.isSafeInteger(length) || length < 256 || !width || !height) return null
  let dataStart = stream + 6
  if (bytes[dataStart] === 13) dataStart += bytes[dataStart + 1] === 10 ? 2 : 1
  else if (bytes[dataStart] === 10) dataStart += 1
  else return null
  const dataEnd = dataStart + length
  if (dataEnd >= end || bytes[dataStart] !== 0xff || bytes[dataStart + 1] !== 0xd8) return null
  if (findAscii(bytes, 'endstream', dataEnd, Math.min(end, dataEnd + 16)) < 0) return null
  return { prefix, color: color[0], dataStart, dataEnd, width, height }
}

const recompressJpegInBrowser = async (bytes, quality, expectedSize) => {
  const source = new Blob([bytes], { type: 'image/jpeg' })
  let bitmap = null
  let objectUrl = ''
  let image = null
  try {
    if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(source, { imageOrientation: 'none' })
    else {
      objectUrl = URL.createObjectURL(source)
      image = new Image()
      image.src = objectUrl
      await image.decode()
    }
    const visual = bitmap || image
    if ((visual.width || visual.naturalWidth) !== expectedSize.width
      || (visual.height || visual.naturalHeight) !== expectedSize.height) throw new Error('PDF 图片尺寸不匹配')
    const canvas = document.createElement('canvas')
    canvas.width = visual.width || visual.naturalWidth
    canvas.height = visual.height || visual.naturalHeight
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('浏览器无法创建 PDF 图片压缩画布')
    context.drawImage(visual, 0, 0)
    const output = await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('浏览器无法生成压缩图片')),
      'image/jpeg', quality,
    ))
    canvas.width = 1
    canvas.height = 1
    return new Uint8Array(await output.arrayBuffer())
  } finally {
    bitmap?.close()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

export const compressPdfImagesKeepingText = async (file, {
  jpegQuality = 0.76,
  signal,
  onProgress,
  recompressJpeg = recompressJpegInBrowser,
} = {}) => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const table = readClassicPdfTable(bytes)
  const ordered = [...table.entries].sort((a, b) => a[1].offset - b[1].offset)
  const changed = new Map()
  let imageCount = 0
  for (let index = 0; index < ordered.length; index += 1) {
    assertNotAborted(signal)
    const [objectId, object] = ordered[index]
    const end = ordered[index + 1]?.[1].offset ?? table.xrefOffset
    if (!asText(bytes, object.offset, Math.min(end, object.offset + 32)).startsWith(`${objectId} ${object.generation} obj`)) throw unsupported()
    const image = getJpegImage(bytes, object, end)
    if (!image) continue
    imageCount += 1
    onProgress?.({ completed: imageCount, total: imageCount, percent: Math.min(85, (index / ordered.length) * 85), stage: `正在压缩第 ${imageCount} 张 PDF 图片` })
    let replacement
    try {
      replacement = await recompressJpeg(bytes.subarray(image.dataStart, image.dataEnd), jpegQuality, {
        width: image.width,
        height: image.height,
      })
    } catch {
      assertNotAborted(signal)
      continue // An unsupported image stays byte-for-byte unchanged.
    }
    assertNotAborted(signal)
    if (!(replacement instanceof Uint8Array) || replacement.length >= image.dataEnd - image.dataStart - 256) continue
    if (replacement[0] !== 0xff || replacement[1] !== 0xd8
      || replacement.at(-2) !== 0xff || replacement.at(-1) !== 0xd9) continue
    const header = image.prefix
      .replace(/\/Length\s+\d+\b/, `/Length ${replacement.length}`)
      .replace(image.color, '/ColorSpace /DeviceRGB')
    changed.set(objectId, [asBytes(`${header}stream\n`), replacement, bytes.subarray(image.dataEnd, end)])
  }
  if (!changed.size) throw unsupported('此 PDF 没有可进一步压缩的照片，已保留原文件，未生成丢失文字的版本')

  const parts = []
  const offsets = new Map()
  let length = 0
  const append = (part) => {
    parts.push(part)
    length += part.byteLength
  }
  append(bytes.subarray(0, ordered[0][1].offset))
  ordered.forEach(([objectId, object], index) => {
    offsets.set(objectId, { offset: length, generation: object.generation })
    const end = ordered[index + 1]?.[1].offset ?? table.xrefOffset
    const replacement = changed.get(objectId)
    if (replacement) replacement.forEach(append)
    else append(bytes.subarray(object.offset, end))
  })
  assertNotAborted(signal)
  const xrefOffset = length
  append(asBytes(`xref\n0 ${table.size}\n`))
  append(asBytes('0000000000 65535 f \n'))
  for (let objectId = 1; objectId < table.size; objectId += 1) {
    const entry = offsets.get(objectId)
    append(asBytes(entry
      ? `${String(entry.offset).padStart(10, '0')} ${String(entry.generation).padStart(5, '0')} n \n`
      : '0000000000 65535 f \n'))
  }
  const trailer = [`/Size ${table.size}`, `/Root ${table.root}`]
  if (table.info) trailer.push(`/Info ${table.info}`)
  if (table.id) trailer.push(`/ID ${table.id}`)
  append(asBytes(`trailer\n<< ${trailer.join(' ')} >>\nstartxref\n${xrefOffset}\n%%EOF\n`))
  const blob = new Blob(parts, { type: 'application/pdf' })
  if (blob.size >= file.size) throw unsupported('此 PDF 已较精简，继续压缩会增大体积；未生成丢失文字的版本')
  onProgress?.({ completed: imageCount, total: imageCount, percent: 100, stage: 'PDF 压缩完成，文字层已保留' })
  return { blob, imageCount, changedImageCount: changed.size, pageCount: readPageCount(bytes, table) }
}
