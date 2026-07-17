import fs from 'node:fs'
import * as ort from 'onnxruntime-web'
import sharp from 'sharp'

const root = new URL('../', import.meta.url)
const inputPath = process.argv[2] || '/tmp/tuscale-waifu-input.png'
const referencePath = process.argv[3] || '/tmp/tuscale-waifu-ncnn.png'
const modelPath = process.argv[4] || new URL('public/models/waifu2x.onnx', root)
const padding = 7

const input = await sharp(inputPath).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const { width, height, channels } = input.info
const paddedWidth = width + padding * 2 + (width % 2)
const paddedHeight = height + padding * 2 + (height % 2)
const tensorData = new Float32Array(3 * paddedWidth * paddedHeight)

for (let y = 0; y < paddedHeight; y++) {
  const sourceY = Math.max(0, Math.min(height - 1, y - padding))
  for (let x = 0; x < paddedWidth; x++) {
    const sourceX = Math.max(0, Math.min(width - 1, x - padding))
    const source = (sourceY * width + sourceX) * channels
    const target = y * paddedWidth + x
    for (let channel = 0; channel < 3; channel++) {
      tensorData[channel * paddedWidth * paddedHeight + target] = input.data[source + channel] / 255
    }
  }
}

ort.env.wasm.numThreads = 1
const session = await ort.InferenceSession.create(fs.readFileSync(modelPath), { executionProviders: ['wasm'] })
const result = await session.run({
  [session.inputNames[0]]: new ort.Tensor('float32', tensorData, [1, 3, paddedHeight, paddedWidth]),
})
const output = result[session.outputNames[0]]
const reference = await sharp(referencePath).removeAlpha().raw().toBuffer({ resolveWithObject: true })

if (output.dims[3] !== reference.info.width || output.dims[2] !== reference.info.height) {
  throw new Error(`Size mismatch: ONNX ${output.dims[3]}x${output.dims[2]}, ncnn ${reference.info.width}x${reference.info.height}`)
}

const pixels = reference.info.width * reference.info.height
let absoluteError = 0
let squaredError = 0
let maxError = 0
for (let pixel = 0; pixel < pixels; pixel++) {
  for (let channel = 0; channel < 3; channel++) {
    const actual = Math.max(0, Math.min(255, Math.round(output.data[channel * pixels + pixel] * 255)))
    const expected = reference.data[pixel * reference.info.channels + channel]
    const error = Math.abs(actual - expected)
    absoluteError += error
    squaredError += error * error
    maxError = Math.max(maxError, error)
  }
}

const samples = pixels * 3
const mae = absoluteError / samples
const mse = squaredError / samples
const psnr = mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse)
console.log({ mae, maxError, psnr })
