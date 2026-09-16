import test from 'node:test'
import assert from 'node:assert/strict'
import { detectCollageRegions } from '../src/tools/collageSplitter.js'

const createRaster = (width, height, color = [245, 245, 245, 255]) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index += 1) data.set(color, index * 4)
  return { data, width, height }
}

const paint = (raster, rect, base, patterned = true) => {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const variation = patterned ? ((x * 17) + (y * 29)) % 47 : 0
      const index = ((y * raster.width) + x) * 4
      raster.data[index] = Math.min(255, base[0] + variation)
      raster.data[index + 1] = Math.min(255, base[1] + (variation * 0.7))
      raster.data[index + 2] = Math.min(255, base[2] + (variation * 0.4))
      raster.data[index + 3] = 255
    }
  }
}

test('规则四宫格拼图会按从左到右、从上到下拆成四张', () => {
  const raster = createRaster(420, 320)
  paint(raster, { x: 0, y: 0, width: 205, height: 155 }, [30, 70, 110])
  paint(raster, { x: 215, y: 0, width: 205, height: 155 }, [100, 35, 55])
  paint(raster, { x: 0, y: 165, width: 205, height: 155 }, [40, 115, 60])
  paint(raster, { x: 215, y: 165, width: 205, height: 155 }, [115, 85, 25])

  const regions = detectCollageRegions(raster, raster.width, raster.height)
  assert.equal(regions.length, 4)
  assert.deepEqual(regions.map(region => [region.x, region.y]), [
    [0, 0],
    [215, 0],
    [0, 165],
    [215, 165],
  ])
})

test('左侧大图加右侧嵌套网格可以递归拆分', () => {
  const raster = createRaster(600, 400, [0, 0, 0, 255])
  paint(raster, { x: 4, y: 4, width: 236, height: 392 }, [30, 55, 90])
  paint(raster, { x: 248, y: 4, width: 172, height: 194 }, [95, 30, 45])
  paint(raster, { x: 428, y: 4, width: 168, height: 194 }, [25, 95, 70])
  paint(raster, { x: 248, y: 206, width: 348, height: 190 }, [90, 75, 20])

  const regions = detectCollageRegions(raster, raster.width, raster.height)
  assert.equal(regions.length, 4)
  assert.ok(regions[0].width > 220 && regions[0].height > 370)
  assert.ok(regions[1].x >= 245 && regions[1].y < 10)
  assert.ok(regions[2].x >= 425 && regions[2].y < 10)
  assert.ok(regions[3].x >= 245 && regions[3].y >= 200)
})

test('普通照片和白色背景主体不会因为大面积纯色被误切', () => {
  const raster = createRaster(420, 320, [250, 250, 250, 255])
  paint(raster, { x: 85, y: 20, width: 250, height: 290 }, [35, 70, 105])
  const regions = detectCollageRegions(raster, raster.width, raster.height)
  assert.deepEqual(regions, [{ x: 0, y: 0, width: 420, height: 320 }])
})
