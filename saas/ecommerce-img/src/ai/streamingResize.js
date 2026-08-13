export function createStreamingRowResampler(sourceWidth, sourceHeight, targetWidth, targetHeight, opaque, onRows) {
  const x0 = new Int32Array(targetWidth)
  const x1 = new Int32Array(targetWidth)
  const xWeight = new Float32Array(targetWidth)
  for (let x = 0; x < targetWidth; x++) {
    const sourceX = (x + 0.5) * sourceWidth / targetWidth - 0.5
    const floorX = Math.floor(sourceX)
    x0[x] = Math.max(0, Math.min(sourceWidth - 1, floorX))
    x1[x] = Math.max(0, Math.min(sourceWidth - 1, floorX + 1))
    xWeight[x] = Math.max(0, Math.min(1, sourceX - floorX))
  }

  const batchRows = 8
  const rowStride = targetWidth * 4
  let output = new Uint8Array(rowStride * batchRows)
  let outputRows = 0
  let outputStartY = 0
  let destinationY = 0
  let sourceIndex = -1
  let previousRow = null
  let currentRow = null

  const flush = async () => {
    if (!outputRows) return
    await onRows(output.subarray(0, outputRows * rowStride), outputRows, outputStartY)
    output = new Uint8Array(rowStride * batchRows)
    outputRows = 0
  }

  const emitReadyRows = async () => {
    while (destinationY < targetHeight) {
      const sourceY = (destinationY + 0.5) * sourceHeight / targetHeight - 0.5
      const floorY = Math.floor(sourceY)
      const sourceY0 = Math.max(0, Math.min(sourceHeight - 1, floorY))
      const sourceY1 = Math.max(0, Math.min(sourceHeight - 1, floorY + 1))
      if (sourceY1 > sourceIndex) break
      const top = sourceY0 === sourceIndex ? currentRow : previousRow
      const bottom = sourceY1 === sourceIndex ? currentRow : previousRow
      if (!top || !bottom) break
      const yWeight = Math.max(0, Math.min(1, sourceY - floorY))
      const targetOffset = outputRows * rowStride

      for (let x = 0; x < targetWidth; x++) {
        const left = x0[x] * 4
        const right = x1[x] * 4
        const wx = xWeight[x]
        const w00 = (1 - wx) * (1 - yWeight)
        const w10 = wx * (1 - yWeight)
        const w01 = (1 - wx) * yWeight
        const w11 = wx * yWeight
        const destination = targetOffset + x * 4

        if (opaque) {
          for (let channel = 0; channel < 3; channel++) {
            output[destination + channel] = Math.round(
              top[left + channel] * w00
              + top[right + channel] * w10
              + bottom[left + channel] * w01
              + bottom[right + channel] * w11,
            )
          }
          output[destination + 3] = 255
        } else {
          const alpha00 = top[left + 3]
          const alpha10 = top[right + 3]
          const alpha01 = bottom[left + 3]
          const alpha11 = bottom[right + 3]
          const alpha = alpha00 * w00 + alpha10 * w10 + alpha01 * w01 + alpha11 * w11
          for (let channel = 0; channel < 3; channel++) {
            output[destination + channel] = alpha <= 0.001 ? 0 : Math.round((
              top[left + channel] * alpha00 * w00
              + top[right + channel] * alpha10 * w10
              + bottom[left + channel] * alpha01 * w01
              + bottom[right + channel] * alpha11 * w11
            ) / alpha)
          }
          output[destination + 3] = Math.round(alpha)
        }
      }

      if (!outputRows) outputStartY = destinationY
      outputRows++
      destinationY++
      if (outputRows === batchRows) await flush()
    }
  }

  return {
    async pushRows(rgba, rowCount) {
      const sourceStride = sourceWidth * 4
      for (let row = 0; row < rowCount; row++) {
        previousRow = currentRow
        currentRow = rgba.slice(row * sourceStride, (row + 1) * sourceStride)
        sourceIndex++
        await emitReadyRows()
      }
    },
    async finish() {
      await emitReadyRows()
      await flush()
      if (sourceIndex !== sourceHeight - 1 || destinationY !== targetHeight) {
        throw new Error('INCOMPLETE_STREAM_RESIZE')
      }
    },
  }
}
