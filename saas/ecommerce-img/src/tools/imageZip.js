import JSZip from 'jszip'
import { reserveUniqueFileName } from './shared.js'

export const getImageExtension = format => (
  format === 'jpeg' ? 'jpg' : format === 'webp' ? 'webp' : 'png'
)

export const createImageZipBlob = async (items, {
  format,
  getFileName,
  fetchBlob = async url => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`ZIP_SOURCE_FETCH_FAILED:${response.status}`)
    return response.blob()
  },
} = {}) => {
  if (!Array.isArray(items) || items.length === 0) throw new Error('ZIP_ITEMS_REQUIRED')
  if (typeof getFileName !== 'function') throw new TypeError('ZIP_FILENAME_REQUIRED')

  const zip = new JSZip()
  const extension = getImageExtension(format)
  const usedFileNames = new Set()

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const fileName = reserveUniqueFileName(`${getFileName(item, index)}.${extension}`, usedFileNames)
    if (item.resultBlob) {
      zip.file(fileName, await item.resultBlob.arrayBuffer())
    } else if (typeof item.result === 'string' && item.result.startsWith('data:')) {
      const separator = item.result.indexOf(',')
      if (separator < 0) throw new Error('ZIP_DATA_URL_INVALID')
      zip.file(fileName, item.result.slice(separator + 1), { base64: true })
    } else if (item.result) {
      const blob = await fetchBlob(item.result)
      zip.file(fileName, await blob.arrayBuffer())
    } else {
      throw new Error('ZIP_ITEM_RESULT_MISSING')
    }
  }

  return zip.generateAsync({ type: 'blob' })
}
