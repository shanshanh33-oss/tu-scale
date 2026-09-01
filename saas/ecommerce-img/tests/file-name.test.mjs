import test from 'node:test'
import assert from 'node:assert/strict'

import { getOutputFileName, reserveUniqueFileName } from '../src/tools/shared.js'

test('output file names keep the original base name when requested', () => {
  assert.equal(
    getOutputFileName('夏日照片.JPG', 'png', { preserveOriginalName: true, suffix: '_4000x3000' }),
    '夏日照片.png',
  )
})

test('output file names keep the existing suffix behavior by default', () => {
  assert.equal(
    getOutputFileName('photo.jpg', 'webp', { suffix: '_compressed' }),
    'photo_compressed.webp',
  )
})

test('duplicate names are numbered without replacing earlier ZIP entries', () => {
  const usedFileNames = new Set()
  assert.equal(reserveUniqueFileName('商品图.jpg', usedFileNames), '商品图.jpg')
  assert.equal(reserveUniqueFileName('商品图.JPG', usedFileNames), '商品图 (2).JPG')
  assert.equal(reserveUniqueFileName('商品图.jpg', usedFileNames), '商品图 (3).jpg')
})
