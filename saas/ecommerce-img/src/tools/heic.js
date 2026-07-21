const HEIC_NAME_PATTERN = /\.(heic|heif)$/i
const HEIC_MIME_PATTERN = /^image\/hei(?:c|f)(?:-sequence)?$/i
const MAX_HEIC_BYTES = 50 * 1024 * 1024

export const isHeicFile = (file) => Boolean(
  file && (HEIC_NAME_PATTERN.test(file.name || '') || HEIC_MIME_PATTERN.test(file.type || ''))
)

const readBlobAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(new Error('FILE_READ_FAILED'))
  reader.readAsDataURL(blob)
})

const readImageDimensions = (src) => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height })
  image.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'))
  image.src = src
})

const convertHeicToJpeg = async (file) => {
  if (file.size > MAX_HEIC_BYTES) throw new Error('HEIC_TOO_LARGE')

  try {
    const { default: heic2any } = await import('heic2any')
    const converted = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.96,
      multiple: false,
    })
    const firstFrame = Array.isArray(converted) ? converted[0] : converted
    if (!(firstFrame instanceof Blob)) throw new Error('HEIC_DECODE_FAILED')
    return firstFrame
  } catch (error) {
    if (error?.message === 'HEIC_TOO_LARGE') throw error
    throw new Error('HEIC_DECODE_FAILED', { cause: error })
  }
}

export const decodeInputImage = async (file) => {
  const convertedFromHeic = isHeicFile(file)
  const readableBlob = convertedFromHeic ? await convertHeicToJpeg(file) : file
  const preview = await readBlobAsDataUrl(readableBlob)

  try {
    const { width, height } = await readImageDimensions(preview)
    return { preview, width, height, convertedFromHeic }
  } catch (error) {
    if (convertedFromHeic) throw new Error('HEIC_DECODE_FAILED', { cause: error })
    throw error
  }
}

export const getInputDecodeErrorMessage = (error) => {
  if (error?.message === 'HEIC_TOO_LARGE') return 'HEIC 文件超过 50MB，请先在相册中缩小尺寸或转成 JPG 后重试。'
  if (error?.message === 'HEIC_DECODE_FAILED') return '无法读取这张 HEIC/HEIF 图片。文件可能损坏、包含不支持的多帧内容，或不是标准 HEIC 照片。'
  if (error?.message === 'FILE_READ_FAILED') return '读取图片文件失败，请重新选择。'
  return '无法读取这张图片，请换用 JPG、PNG、WebP 或标准 HEIC 照片。'
}
