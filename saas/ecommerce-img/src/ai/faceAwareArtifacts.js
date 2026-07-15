const bilateralFilter = (imageData, sigmaS = 1.2, sigmaR = 30, radius = 1) => {
  const { data, width, height } = imageData
  const output = new Uint8ClampedArray(data)
  const half = radius
  const spatialW = []
  for (let dy = -half; dy <= half; dy++)
    for (let dx = -half; dx <= half; dx++)
      spatialW.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS)))

  for (let y = half; y < height - half; y++) {
    for (let x = half; x < width - half; x++) {
      const ci = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        const centerVal = data[ci + c]
        let tw = 0, total = 0, wi = 0
        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            const pv = data[((y + dy) * width + (x + dx)) * 4 + c]
            const iw = Math.exp(-(pv - centerVal) * (pv - centerVal) / (2 * sigmaR * sigmaR))
            const weight = spatialW[wi] * iw
            total += pv * weight
            tw += weight
            wi++
          }
        }
        output[ci + c] = Math.max(0, Math.min(255, Math.round(total / tw)))
      }
    }
  }
  return new ImageData(output, width, height)
}

// 只在皮肤掩膜内修正疑似色块，五官由掩膜排除，毛孔亮度高频由纹理权重保护。
export const faceAwareArtifactFilter = (imageData, faceSkinMask, skinStrength = 0.6) => {
  if (!faceSkinMask) return bilateralFilter(imageData)

  const { data, width, height } = imageData
  const output = new Uint8ClampedArray(data)
  const clamp01 = value => Math.max(0, Math.min(1, value))
  const normalizedStrength = clamp01(skinStrength)
  const response = Math.pow(normalizedStrength, 1.35)
  const filtered = bilateralFilter(
    imageData,
    0.9 + response,
    18 + response * 26,
    response >= 0.7 ? 2 : 1,
  ).data
  const effectScale = 0.08 + response * 1.25
  const lumaAt = (x, y) => {
    const idx = (y * width + x) * 4
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
  }

  for (let y = 2; y < height - 2; y++) {
    const maskY = Math.min(faceSkinMask.height - 1, Math.floor(y * faceSkinMask.height / height))
    for (let x = 2; x < width - 2; x++) {
      const maskX = Math.min(faceSkinMask.width - 1, Math.floor(x * faceSkinMask.width / width))
      const skinWeight = faceSkinMask.data[maskY * faceSkinMask.width + maskX] / 255
      if (skinWeight <= 0.01) continue

      const idx = (y * width + x) * 4
      const centerY = lumaAt(x, y)
      const leftY = lumaAt(x - 1, y)
      const rightY = lumaAt(x + 1, y)
      const topY = lumaAt(x, y - 1)
      const bottomY = lumaAt(x, y + 1)
      const neighborY = (leftY + rightY + topY + bottomY) / 4
      const localRange = Math.max(centerY, leftY, rightY, topY, bottomY) - Math.min(centerY, leftY, rightY, topY, bottomY)
      const highFrequency = Math.abs(centerY - neighborY)

      const meanR = (data[idx - 4] + data[idx + 4] + data[idx - width * 4] + data[idx + width * 4]) / 4
      const meanG = (data[idx - 3] + data[idx + 5] + data[idx - width * 4 + 1] + data[idx + width * 4 + 1]) / 4
      const meanB = (data[idx - 2] + data[idx + 6] + data[idx - width * 4 + 2] + data[idx + width * 4 + 2]) / 4
      const meanY = 0.299 * meanR + 0.587 * meanG + 0.114 * meanB
      const centerCb = data[idx + 2] - centerY
      const centerCr = data[idx] - centerY
      const meanCb = meanB - meanY
      const meanCr = meanR - meanY
      const chromaDifference = Math.hypot(centerCb - meanCb, centerCr - meanCr)

      let boundaryDifference = 0
      if (x % 8 <= 1 || x % 8 >= 7) boundaryDifference = Math.max(boundaryDifference, Math.abs(lumaAt(x - 2, y) - lumaAt(x + 2, y)))
      if (y % 8 <= 1 || y % 8 >= 7) boundaryDifference = Math.max(boundaryDifference, Math.abs(lumaAt(x, y - 2) - lumaAt(x, y + 2)))

      const chromaThreshold = 5 - response * 3.5
      const blockThreshold = 12 - response * 6
      const chromaArtifact = clamp01((chromaDifference - chromaThreshold) / (11 - response * 2))
      const blockArtifact = clamp01((boundaryDifference - blockThreshold) / 18) * (0.35 + response * 0.3)
      const artifactScore = Math.max(chromaArtifact, blockArtifact)
      if (artifactScore <= 0.01) continue

      const poreDetail = clamp01((localRange - 4) / 14) * clamp01((highFrequency - 1) / 8)
      const textureProtection = 1 - poreDetail * (0.98 - response * 0.2)
      const blend = Math.min(0.85, artifactScore * effectScale) * textureProtection * skinWeight
      if (blend <= 0.01) continue

      const filteredY = 0.299 * filtered[idx] + 0.587 * filtered[idx + 1] + 0.114 * filtered[idx + 2]
      const filteredCb = filtered[idx + 2] - filteredY
      const filteredCr = filtered[idx] - filteredY
      const nextY = centerY + (filteredY - centerY) * blend * (0.08 + response * 0.15)
      const nextCb = centerCb + (filteredCb - centerCb) * blend
      const nextCr = centerCr + (filteredCr - centerCr) * blend
      const nextR = nextY + nextCr
      const nextB = nextY + nextCb
      const nextG = (nextY - 0.299 * nextR - 0.114 * nextB) / 0.587
      output[idx] = Math.max(0, Math.min(255, Math.round(nextR)))
      output[idx + 1] = Math.max(0, Math.min(255, Math.round(nextG)))
      output[idx + 2] = Math.max(0, Math.min(255, Math.round(nextB)))
    }
  }
  return new ImageData(output, width, height)
}
