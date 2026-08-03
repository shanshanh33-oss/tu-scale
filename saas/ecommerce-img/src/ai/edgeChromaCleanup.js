const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const luma = (red, green, blue) => red * 0.299 + green * 0.587 + blue * 0.114

const createImageData = (data, width, height) => (
  typeof ImageData === 'undefined' ? { data, width, height } : new ImageData(data, width, height)
)

// Correct the abnormal colour component of a narrow AI-generated fringe while
// keeping its luminance. Rows are copied one at a time so large exports do not
// need a second full-size image buffer.
export const repairUpscaleColorFringes = (imageData, strength = 0.55) => {
  const { data, width, height } = imageData
  if (width < 4 || height < 4 || strength <= 0) return imageData

  const rowBytes = width * 4
  let previousRow = data.slice(0, rowBytes)
  const chromaThreshold = 10 - strength * 5

  for (let y = 1; y < height - 1; y += 1) {
    const rowStart = y * rowBytes
    const currentRow = data.slice(rowStart, rowStart + rowBytes)
    const nextRowStart = (y + 1) * rowBytes

    for (let x = 1; x < width - 1; x += 1) {
      const pixel = x * 4
      const red = currentRow[pixel]
      const green = currentRow[pixel + 1]
      const blue = currentRow[pixel + 2]
      const centerY = luma(red, green, blue)
      const neighbours = [
        [currentRow[pixel - 4], currentRow[pixel - 3], currentRow[pixel - 2]],
        [currentRow[pixel + 4], currentRow[pixel + 5], currentRow[pixel + 6]],
        [previousRow[pixel], previousRow[pixel + 1], previousRow[pixel + 2]],
        [data[nextRowStart + pixel], data[nextRowStart + pixel + 1], data[nextRowStart + pixel + 2]],
      ]
      const neighbourLuma = neighbours.map(([r, g, b]) => luma(r, g, b))
      const edgeGradient = Math.abs(neighbourLuma[0] - neighbourLuma[1]) + Math.abs(neighbourLuma[2] - neighbourLuma[3])
      if (edgeGradient < 24) continue

      const sameSurface = neighbours.filter((color, index) => Math.abs(neighbourLuma[index] - centerY) <= 40)
      if (sameSurface.length < 2) continue
      const surfaceCb = median(sameSurface.map(([r, g, b]) => b - luma(r, g, b)))
      const surfaceCr = median(sameSurface.map(([r, g, b]) => r - luma(r, g, b)))
      const centerCb = blue - centerY
      const centerCr = red - centerY
      const chromaDifference = Math.hypot(centerCb - surfaceCb, centerCr - surfaceCr)
      if (chromaDifference < chromaThreshold) continue

      const edgeWeight = clamp((edgeGradient - 24) / 110, 0, 1)
      const fringeWeight = clamp((chromaDifference - chromaThreshold) / 42, 0, 1)
      const blend = Math.min(0.62, strength * edgeWeight * fringeWeight * 0.72)
      if (blend <= 0.01) continue

      const nextCb = centerCb + (surfaceCb - centerCb) * blend
      const nextCr = centerCr + (surfaceCr - centerCr) * blend
      const nextRed = centerY + nextCr
      const nextBlue = centerY + nextCb
      const nextGreen = (centerY - nextRed * 0.299 - nextBlue * 0.114) / 0.587
      data[rowStart + pixel] = Math.round(clamp(nextRed, 0, 255))
      data[rowStart + pixel + 1] = Math.round(clamp(nextGreen, 0, 255))
      data[rowStart + pixel + 2] = Math.round(clamp(nextBlue, 0, 255))
    }
    previousRow = currentRow
  }

  return createImageData(data, width, height)
}
