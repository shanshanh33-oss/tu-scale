import test from 'node:test'
import assert from 'node:assert/strict'

import {
  HISTORY_PREFERENCES_KEY,
  buildHistorySourceKey,
  chooseHistoryEntriesToKeep,
  createHistoryThumbnail,
  getHistoryPreferences,
  isHistoryEntryExpired,
  normalizeHistoryPreferences,
  normalizeRetentionDays,
  setHistoryPreferences,
} from '../src/tools/localHistory.js'

const createStorage = () => {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  }
}

test('history is disabled by default and only supports 7 or 30 day retention', () => {
  assert.deepEqual(normalizeHistoryPreferences(null), { enabled: false, retentionDays: 7 })
  assert.equal(normalizeRetentionDays(7), 7)
  assert.equal(normalizeRetentionDays('30'), 30)
  assert.equal(normalizeRetentionDays(365), 7)
})

test('history preferences persist without storing account information', () => {
  const storage = createStorage()
  assert.deepEqual(getHistoryPreferences(storage), { enabled: false, retentionDays: 7 })
  assert.deepEqual(
    setHistoryPreferences({ enabled: true, retentionDays: 30 }, storage),
    { enabled: true, retentionDays: 30 },
  )
  assert.equal(storage.getItem(HISTORY_PREFERENCES_KEY), '{"enabled":true,"retentionDays":30}')
  assert.deepEqual(getHistoryPreferences(storage), { enabled: true, retentionDays: 30 })
})

test('the same local source produces a stable history key', () => {
  const file = { name: 'photo.jpg', size: 1234, lastModified: 5678 }
  assert.equal(buildHistorySourceKey(file), buildHistorySourceKey({ ...file }))
  assert.notEqual(buildHistorySourceKey(file), buildHistorySourceKey({ ...file, size: 1235 }))
})

test('expired history entries are removed at their deadline', () => {
  assert.equal(isHistoryEntryExpired({ expiresAt: 1000 }, 999), false)
  assert.equal(isHistoryEntryExpired({ expiresAt: 1000 }, 1000), true)
  assert.equal(isHistoryEntryExpired({}, 1000), true)
})

test('history retention keeps newest entries within item and byte limits', () => {
  const entries = [
    { id: 'old', createdAt: 1, sourceSize: 40 },
    { id: 'middle', createdAt: 2, sourceSize: 40 },
    { id: 'new', createdAt: 3, sourceSize: 40 },
  ]
  assert.deepEqual(chooseHistoryEntriesToKeep(entries, 2, 1_000), ['new', 'middle'])
  assert.deepEqual(chooseHistoryEntriesToKeep(entries, 5, 80), ['new', 'middle'])
  assert.deepEqual(chooseHistoryEntriesToKeep([{ id: 'too-large', createdAt: 4, sourceSize: 81 }], 5, 80), [])
})

test('history thumbnail falls back to PNG when WebP export is unavailable', async () => {
  const originalDocument = globalThis.document
  const originalImage = globalThis.Image
  const requestedTypes = []

  class MockImage {
    naturalWidth = 640
    naturalHeight = 320

    set src(value) {
      void value
      queueMicrotask(() => this.onload?.())
    }
  }

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: () => {} }),
    toBlob: (callback, type) => {
      requestedTypes.push(type)
      callback(type === 'image/webp' ? null : new Blob(['png'], { type }))
    },
  }

  globalThis.Image = MockImage
  globalThis.document = { createElement: () => canvas }
  try {
    const thumbnail = await createHistoryThumbnail('blob:decoded-preview')
    assert.equal(thumbnail.type, 'image/png')
    assert.deepEqual(requestedTypes, ['image/webp', 'image/png'])
    assert.deepEqual({ width: canvas.width, height: canvas.height }, { width: 320, height: 160 })
  } finally {
    globalThis.document = originalDocument
    globalThis.Image = originalImage
  }
})
