import { PDFDocument } from 'pdf-lib'

const containsAscii = (bytes, text) => {
  const needle = new TextEncoder().encode(text)
  for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    if (bytes[index] !== needle[0]) continue
    let match = true
    for (let part = 1; part < needle.length; part += 1) {
      if (bytes[index + part] !== needle[part]) { match = false; break }
    }
    if (match) return true
  }
  return false
}

export const compressPdfStructureKeepingText = async (file, { signal, onProgress, verifyDocument } = {}) => {
  if (signal?.aborted) throw new DOMException('PDF 压缩已取消', 'AbortError')
  const original = new Uint8Array(await file.arrayBuffer())
  // Rewriting a signed PDF would invalidate its signature even if every page still looks the same.
  if (containsAscii(original, '/ByteRange')) throw new Error('此 PDF 可能包含数字签名，无法安全重写；原文件未被修改')
  onProgress?.({ completed: 0, total: 0, percent: 88, stage: '正在优化 PDF 内部结构' })
  const document = await PDFDocument.load(original, { updateMetadata: false })
  const pageSizes = document.getPages().map(page => page.getSize())
  const optimized = await document.save({ useObjectStreams: true })
  if (signal?.aborted) throw new DOMException('PDF 压缩已取消', 'AbortError')
  if (optimized.length >= original.length) {
    const error = new Error('此 PDF 的内部结构已较精简，无法进一步无损压缩')
    error.code = 'PDF_STRUCTURE_NO_GAIN'
    throw error
  }
  const reopened = await PDFDocument.load(optimized, { updateMetadata: false })
  if (reopened.getPageCount() !== pageSizes.length || reopened.getPages().some((page, index) => {
    const size = page.getSize()
    return size.width !== pageSizes[index].width || size.height !== pageSizes[index].height
  })) throw new Error('PDF 结构校验失败，原文件未被修改')
  const blob = new Blob([optimized], { type: 'application/pdf' })
  if (verifyDocument && !await verifyDocument(file, blob, signal)) {
    throw new Error('PDF 文字校验失败，原文件未被修改')
  }
  onProgress?.({ completed: pageSizes.length, total: pageSizes.length, percent: 100, stage: 'PDF 结构优化完成，文字层已保留' })
  return { blob, imageCount: 0, changedImageCount: 0, pageCount: pageSizes.length }
}
