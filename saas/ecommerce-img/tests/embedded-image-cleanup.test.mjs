import test from 'node:test'
import assert from 'node:assert/strict'
import { detectEmbeddedContentCrop } from '../src/tools/embeddedImageCleanup.js'

const createRaster = (width, height, color = [2, 4, 3, 255]) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index += 1) data.set(color, index * 4)
  return { data, width, height }
}

const paint = (raster, rect, base, patterned = true) => {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const variation = patterned ? ((x * 19) + (y * 31)) % 90 : 0
      const offset = ((y * raster.width) + x) * 4
      raster.data[offset] = Math.min(255, base[0] + variation)
      raster.data[offset + 1] = Math.min(255, base[1] + (variation * 0.8))
      raster.data[offset + 2] = Math.min(255, base[2] + (variation * 0.55))
      raster.data[offset + 3] = 255
    }
  }
}

test('黑色画布会保留最大照片并忽略孤立的小装饰', () => {
  const raster = createRaster(640, 480)
  paint(raster, { x: 130, y: 115, width: 390, height: 260 }, [28, 62, 98])
  paint(raster, { x: 95, y: 35, width: 18, height: 35 }, [240, 10, 15], false)

  const crop = detectEmbeddedContentCrop(raster, raster.width, raster.height)
  assert.ok(crop)
  assert.ok(crop.x >= 120 && crop.x <= 132)
  assert.ok(crop.y >= 105 && crop.y <= 117)
  assert.ok(crop.width >= 390 && crop.width <= 405)
  assert.ok(crop.height >= 260 && crop.height <= 275)
})

test('贴边装饰与照片相连时仍会按矩形照片边界裁切', () => {
  const raster = createRaster(640, 480)
  paint(raster, { x: 42, y: 60, width: 560, height: 380 }, [28, 62, 98])
  paint(raster, { x: 5, y: 8, width: 30, height: 50 }, [240, 10, 15], false)
  paint(raster, { x: 30, y: 42, width: 33, height: 23 }, [240, 10, 15], false)

  const crop = detectEmbeddedContentCrop(raster, raster.width, raster.height)
  assert.ok(crop)
  assert.equal(crop.isRectangularFrame, true)
  assert.ok(crop.x >= 40 && crop.x <= 44, JSON.stringify(crop))
  assert.ok(crop.y >= 64 && crop.y <= 67, JSON.stringify(crop))
  assert.ok(crop.width >= 558 && crop.width <= 562, JSON.stringify(crop))
  assert.ok(crop.height >= 372 && crop.height <= 376, JSON.stringify(crop))
})

test('普通深色照片不会因为边缘较暗而被误切', () => {
  const raster = createRaster(640, 480, [8, 12, 18, 255])
  paint(raster, { x: 0, y: 70, width: 640, height: 410 }, [20, 48, 72])

  assert.equal(detectEmbeddedContentCrop(raster, raster.width, raster.height), null)
})

test('多个大小接近的内容块不会被误判成单张主图', () => {
  const raster = createRaster(640, 480, [250, 250, 250, 255])
  paint(raster, { x: 45, y: 95, width: 250, height: 280 }, [30, 80, 115])
  paint(raster, { x: 345, y: 95, width: 250, height: 280 }, [115, 50, 35])

  assert.equal(detectEmbeddedContentCrop(raster, raster.width, raster.height), null)
})
