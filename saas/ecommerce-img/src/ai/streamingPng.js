import pakoDeflate from 'pako/lib/deflate.js'

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const TEXT_ENCODER = new TextEncoder()
const PNG_BYTES_PER_PIXEL = 4
const ROW_BATCH_SIZE = 8

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function writeUint32(target, offset, value) {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value >>> 0)
}

function crc32(typeBytes, data) {
  let crc = 0xffffffff
  for (const value of typeBytes) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8)
  for (const value of data) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function createChunk(type, data = new Uint8Array(0)) {
  const typeBytes = TEXT_ENCODER.encode(type)
  const chunk = new Uint8Array(12 + data.byteLength)
  writeUint32(chunk, 0, data.byteLength)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  writeUint32(chunk, 8 + data.byteLength, crc32(typeBytes, data))
  return chunk
}

function createHeader(width, height) {
  const header = new Uint8Array(13)
  writeUint32(header, 0, width)
  writeUint32(header, 4, height)
  header[8] = 8
  header[9] = 6
  return createChunk('IHDR', header)
}

export function supportsStreamingPng() {
  return typeof CompressionStream === 'function' || typeof pakoDeflate?.Deflate === 'function'
}

export class StreamingPngEncoder {
  constructor(width, height, options = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error('INVALID_PNG_DIMENSIONS')
    }
    if (!supportsStreamingPng()) throw new Error('STREAMING_PNG_UNSUPPORTED')

    this.width = width
    this.height = height
    this.rowStride = width * PNG_BYTES_PER_PIXEL
    this.writtenRows = 0
    this.chunks = [PNG_SIGNATURE, createHeader(width, height)]

    this.usesNativeCompression = typeof CompressionStream === 'function' && !options.forceJavaScript
    if (this.usesNativeCompression) {
      const compression = new CompressionStream('deflate')
      this.writer = compression.writable.getWriter()
      this.reading = this.collectCompressedChunks(compression.readable.getReader())
    } else {
      this.deflater = new pakoDeflate.Deflate({ level: 6, chunkSize: 64 * 1024 })
      this.deflater.onData = chunk => this.chunks.push(createChunk('IDAT', chunk))
    }
  }

  async collectCompressedChunks(reader) {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value?.byteLength) this.chunks.push(createChunk('IDAT', value))
    }
  }

  async writeRows(rgba, rowCount) {
    if (!Number.isInteger(rowCount) || rowCount <= 0) return
    if (rgba.byteLength < rowCount * this.rowStride) throw new Error('INVALID_PNG_ROW_DATA')
    if (this.writtenRows + rowCount > this.height) throw new Error('TOO_MANY_PNG_ROWS')

    for (let rowStart = 0; rowStart < rowCount; rowStart += ROW_BATCH_SIZE) {
      const batchRows = Math.min(ROW_BATCH_SIZE, rowCount - rowStart)
      const filteredStride = this.rowStride + 1
      const filtered = new Uint8Array(filteredStride * batchRows)

      for (let localRow = 0; localRow < batchRows; localRow++) {
        const sourceOffset = (rowStart + localRow) * this.rowStride
        const targetOffset = localRow * filteredStride
        filtered[targetOffset] = 1
        for (let byte = 0; byte < this.rowStride; byte++) {
          const current = rgba[sourceOffset + byte]
          const left = byte >= PNG_BYTES_PER_PIXEL ? rgba[sourceOffset + byte - PNG_BYTES_PER_PIXEL] : 0
          filtered[targetOffset + 1 + byte] = (current - left) & 0xff
        }
      }

      if (this.usesNativeCompression) await this.writer.write(filtered)
      else {
        this.deflater.push(filtered, false)
        if (this.deflater.err) throw new Error(this.deflater.msg || 'PNG_COMPRESSION_FAILED')
      }
    }

    this.writtenRows += rowCount
  }

  async finish() {
    if (this.writtenRows !== this.height) {
      if (this.usesNativeCompression) {
        await this.writer.abort(new Error('INCOMPLETE_PNG_ROWS')).catch(() => {})
      }
      throw new Error('INCOMPLETE_PNG_ROWS')
    }
    if (this.usesNativeCompression) {
      await this.writer.close()
      await this.reading
    } else {
      this.deflater.push(new Uint8Array(0), true)
      if (this.deflater.err) throw new Error(this.deflater.msg || 'PNG_COMPRESSION_FAILED')
    }
    this.chunks.push(createChunk('IEND'))
    return new Blob(this.chunks, { type: 'image/png' })
  }
}

export async function encodeRgbaToPng(width, height, rgba, rowsPerWrite = 16) {
  const encoder = new StreamingPngEncoder(width, height)
  const rowStride = width * PNG_BYTES_PER_PIXEL
  for (let row = 0; row < height; row += rowsPerWrite) {
    const rowCount = Math.min(rowsPerWrite, height - row)
    await encoder.writeRows(rgba.subarray(row * rowStride, (row + rowCount) * rowStride), rowCount)
  }
  return encoder.finish()
}
