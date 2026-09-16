export const PDF_IMAGE_RATIOS = [
  { id: 'original', label: '保持原比例', ratio: null },
  { id: '1-1', label: '1:1 方图', ratio: 1 },
  { id: '4-3', label: '4:3 横图', ratio: 4 / 3 },
  { id: '3-4', label: '3:4 竖图', ratio: 3 / 4 },
  { id: '16-9', label: '16:9 横屏', ratio: 16 / 9 },
  { id: '9-16', label: '9:16 竖屏', ratio: 9 / 16 },
]

export const PPT_LAYOUTS = [
  { id: 'wide', label: '16:9 横版', width: 13.333, height: 7.5 },
  { id: 'standard', label: '4:3 横版', width: 10, height: 7.5 },
  { id: 'square', label: '1:1 方形', width: 10, height: 10 },
  { id: 'a4', label: 'A4 竖版', width: 8.267, height: 11.693 },
]

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const sanitizePdfName = (name = 'PDF') => {
  const stem = name.replace(/\.pdf$/i, '').trim() || 'PDF'
  const withoutControls = Array.from(stem, character => character.charCodeAt(0) < 32 ? '_' : character).join('')
  return withoutControls.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'PDF'
}

export const textItemsToPlainText = (items = []) => {
  const lines = []
  let current = ''
  let lastY = null

  items.forEach((item) => {
    const value = typeof item?.str === 'string' ? item.str.trim() : ''
    if (!value) return
    const y = Number(item?.transform?.[5])
    const startsNewLine = lastY !== null && Number.isFinite(y) && Math.abs(y - lastY) > 2.5

    if (startsNewLine && current.trim()) {
      lines.push(current.trim())
      current = ''
    }

    const currentEndsWithCjk = /[\u3400-\u9fff\uf900-\ufaff]$/.test(current)
    const valueStartsWithCjk = /^[\u3400-\u9fff\uf900-\ufaff]/.test(value)
    const needsSpace = current && !/\s$/.test(current) && !/^[,.;:!?，。；：！？、）】》]/.test(value)
      && !currentEndsWithCjk && !valueStartsWithCjk
    current += `${needsSpace ? ' ' : ''}${value}`

    if (item?.hasEOL && current.trim()) {
      lines.push(current.trim())
      current = ''
    }
    if (Number.isFinite(y)) lastY = y
  })

  if (current.trim()) lines.push(current.trim())
  return lines.join('\n')
}

export const combinePageTexts = (pages = []) => pages
  .map((page) => {
    const label = page.originalFileName
      ? `第 ${page.pageNumber} 张 · ${page.relativePath || page.originalFileName}`
      : `第 ${page.pageNumber} 页`
    const emptyText = page.originalFileName ? '（未检测到文字）' : '（未检测到可复制文字）'
    return `${label}\n${page.text || emptyText}`
  })
  .join('\n\n')

export const getContainRect = (sourceWidth, sourceHeight, box) => {
  if (!sourceWidth || !sourceHeight || !box?.w || !box?.h) return { ...box }
  const scale = Math.min(box.w / sourceWidth, box.h / sourceHeight)
  const w = sourceWidth * scale
  const h = sourceHeight * scale
  return {
    x: box.x + (box.w - w) / 2,
    y: box.y + (box.h - h) / 2,
    w,
    h,
  }
}

export const getPptSlideImageBox = (layout, fitMode = 'fit', margin = 0.28) => {
  if (fitMode === 'fill') return { x: 0, y: 0, w: layout.width, h: layout.height }
  return {
    x: margin,
    y: margin,
    w: layout.width - (margin * 2),
    h: layout.height - (margin * 2),
  }
}

export const getPptImagePlacement = (image, box, fitMode = 'fit') => {
  if (fitMode !== 'fill' || !image?.width || !image?.height) {
    return getContainRect(image?.width, image?.height, box)
  }

  // PptxGenJS 4.x derives editable crop percentages from the top-level w/h
  // values rather than reading the embedded bitmap dimensions. Supplying a
  // normalized source rectangle preserves the real aspect ratio, while sizing
  // defines the final full-bleed box. PowerPoint keeps the whole source image
  // behind the editable crop instead of rasterizing the visible area.
  const normalization = Math.max(image.width, image.height)
  return {
    x: box.x,
    y: box.y,
    w: image.width / normalization,
    h: image.height / normalization,
    sizing: { type: 'cover', w: box.w, h: box.h },
  }
}

export const getCenteredCrop = (sourceWidth, sourceHeight, ratio) => {
  if (!sourceWidth || !sourceHeight || !ratio) {
    return { x: 0, y: 0, w: sourceWidth || 0, h: sourceHeight || 0 }
  }
  const sourceRatio = sourceWidth / sourceHeight
  if (sourceRatio > ratio) {
    const w = sourceHeight * ratio
    return { x: (sourceWidth - w) / 2, y: 0, w, h: sourceHeight }
  }
  const h = sourceWidth / ratio
  return { x: 0, y: (sourceHeight - h) / 2, w: sourceWidth, h }
}

export const getRatioCanvasSize = (sourceWidth, sourceHeight, ratio, mode = 'crop', maxEdge = 10000) => {
  if (!sourceWidth || !sourceHeight) return { w: 1, h: 1 }
  if (!ratio) {
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))
    return { w: Math.max(1, Math.round(sourceWidth * scale)), h: Math.max(1, Math.round(sourceHeight * scale)) }
  }

  let w
  let h
  if (mode === 'pad') {
    if (sourceWidth / sourceHeight > ratio) {
      w = sourceWidth
      h = sourceWidth / ratio
    } else {
      h = sourceHeight
      w = sourceHeight * ratio
    }
  } else {
    const crop = getCenteredCrop(sourceWidth, sourceHeight, ratio)
    w = crop.w
    h = crop.h
  }

  const scale = Math.min(1, maxEdge / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

export const getCollageGrid = (count, slideWidth = 13.333, slideHeight = 7.5) => {
  if (count <= 1) return { columns: 1, rows: 1 }
  let best = null
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns)
    const cellRatio = (slideWidth / columns) / (slideHeight / rows)
    const empty = (columns * rows) - count
    const score = Math.abs(Math.log(cellRatio / 1.2)) + (empty * 0.12)
    if (!best || score < best.score) best = { columns, rows, score }
  }
  return { columns: best.columns, rows: best.rows }
}

export const getCollageBoxes = (count, layout, margin = 0.35, gap = 0.18) => {
  const { width, height } = layout
  const { columns, rows } = getCollageGrid(count, width, height)
  const innerWidth = width - (margin * 2)
  const availableWidth = innerWidth - (gap * (columns - 1))
  const availableHeight = height - (margin * 2) - (gap * (rows - 1))
  const cellWidth = availableWidth / columns
  const cellHeight = availableHeight / rows
  const lastRowCount = count - (columns * (rows - 1))

  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const itemsInRow = row === rows - 1 ? lastRowCount : columns
    const rowWidth = (itemsInRow * cellWidth) + ((itemsInRow - 1) * gap)
    const rowStartX = margin + ((innerWidth - rowWidth) / 2)
    return {
      x: rowStartX + (column * (cellWidth + gap)),
      y: margin + (row * (cellHeight + gap)),
      w: cellWidth,
      h: cellHeight,
    }
  })
}
