const MODEL_SCALE = 2

export function getExpectedWaifu2xTileOutputSize(tile) {
  return {
    width: tile.coreWidth * MODEL_SCALE + (tile.coreWidth % 2) * MODEL_SCALE,
    height: tile.coreHeight * MODEL_SCALE + (tile.coreHeight % 2) * MODEL_SCALE,
  }
}

export function assertWaifu2xTileOutput(modelOutput, tile) {
  const expected = getExpectedWaifu2xTileOutputSize(tile)
  const dims = Array.from(modelOutput?.dims || [])
  const validShape = dims.length === 4
    && dims[0] === 1
    && dims[1] === 3
    && dims[2] === expected.height
    && dims[3] === expected.width
  const expectedValues = expected.width * expected.height * 3

  if (!validShape || modelOutput?.data?.length !== expectedValues) {
    throw new Error('AI_MODEL_OUTPUT_MISMATCH')
  }

  return expected
}
