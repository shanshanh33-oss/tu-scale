const DB_NAME = 'tuscale-local-history'
const DB_VERSION = 1
const STORE_NAME = 'entries'

export const HISTORY_PREFERENCES_KEY = 'tuscale_history_preferences_v1'
export const HISTORY_RETENTION_OPTIONS = [7, 30]
export const MAX_HISTORY_ITEMS = 30
export const MAX_HISTORY_BYTES = 500 * 1024 * 1024

const requestToPromise = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('HISTORY_REQUEST_FAILED'))
})

const transactionToPromise = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error || new Error('HISTORY_TRANSACTION_FAILED'))
  transaction.onabort = () => reject(transaction.error || new Error('HISTORY_TRANSACTION_ABORTED'))
})

export const normalizeRetentionDays = (value) => (
  HISTORY_RETENTION_OPTIONS.includes(Number(value)) ? Number(value) : HISTORY_RETENTION_OPTIONS[0]
)

export const normalizeHistoryPreferences = (value) => ({
  enabled: value?.enabled === true,
  retentionDays: normalizeRetentionDays(value?.retentionDays),
})

export const getHistoryPreferences = (storage = globalThis.localStorage) => {
  if (!storage) return normalizeHistoryPreferences(null)
  try {
    return normalizeHistoryPreferences(JSON.parse(storage.getItem(HISTORY_PREFERENCES_KEY) || 'null'))
  } catch {
    return normalizeHistoryPreferences(null)
  }
}

export const setHistoryPreferences = (preferences, storage = globalThis.localStorage) => {
  const normalized = normalizeHistoryPreferences(preferences)
  storage?.setItem(HISTORY_PREFERENCES_KEY, JSON.stringify(normalized))
  return normalized
}

export const buildHistorySourceKey = (file) => [
  file?.name || 'image',
  Number(file?.size) || 0,
  Number(file?.lastModified) || 0,
].join('\u0000')

export const isHistoryEntryExpired = (entry, now = Date.now()) => (
  !Number.isFinite(entry?.expiresAt) || entry.expiresAt <= now
)

export const chooseHistoryEntriesToKeep = (
  entries,
  maxItems = MAX_HISTORY_ITEMS,
  maxBytes = MAX_HISTORY_BYTES,
) => {
  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt)
  const keptIds = []
  let bytes = 0
  for (const entry of sorted) {
    const size = Math.max(0, Number(entry.sourceSize) || 0)
    if (keptIds.length >= maxItems) continue
    if (bytes + size > maxBytes) continue
    keptIds.push(entry.id)
    bytes += size
  }
  return keptIds
}

const openHistoryDatabase = () => {
  if (!globalThis.indexedDB) return Promise.reject(new Error('HISTORY_UNSUPPORTED'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      if (!store.indexNames.contains('sourceKey')) store.createIndex('sourceKey', 'sourceKey', { unique: true })
      if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt')
      if (!store.indexNames.contains('expiresAt')) store.createIndex('expiresAt', 'expiresAt')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('HISTORY_DATABASE_OPEN_FAILED'))
    request.onblocked = () => reject(new Error('HISTORY_DATABASE_BLOCKED'))
  })
}

const getAllEntries = async (database) => {
  const transaction = database.transaction(STORE_NAME, 'readonly')
  const completed = transactionToPromise(transaction)
  const entries = await requestToPromise(transaction.objectStore(STORE_NAME).getAll())
  await completed
  return entries
}

const deleteEntries = async (database, ids) => {
  if (!ids.length) return
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  const completed = transactionToPromise(transaction)
  const store = transaction.objectStore(STORE_NAME)
  ids.forEach(id => store.delete(id))
  await completed
}

export const createHistoryThumbnail = async (imageSource, maxEdge = 320) => {
  if (!imageSource || typeof document === 'undefined') return null
  const temporaryUrl = imageSource instanceof Blob ? URL.createObjectURL(imageSource) : ''
  const imageUrl = temporaryUrl || imageSource
  let image
  try {
    image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('HISTORY_THUMBNAIL_LOAD_FAILED'))
      element.src = imageUrl
    })
  } finally {
    if (temporaryUrl) URL.revokeObjectURL(temporaryUrl)
  }
  const ratio = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('HISTORY_THUMBNAIL_CANVAS_FAILED')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const exportThumbnail = (type, quality) => new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob || null), type, quality)
  })
  const webpThumbnail = await exportThumbnail('image/webp', 0.78)
  if (webpThumbnail) return webpThumbnail
  const pngThumbnail = await exportThumbnail('image/png')
  if (pngThumbnail) return pngThumbnail
  throw new Error('HISTORY_THUMBNAIL_EXPORT_FAILED')
}

export const purgeExpiredHistoryEntries = async (now = Date.now()) => {
  const database = await openHistoryDatabase()
  try {
    const entries = await getAllEntries(database)
    await deleteEntries(database, entries.filter(entry => isHistoryEntryExpired(entry, now)).map(entry => entry.id))
  } finally {
    database.close()
  }
}

const trimHistoryEntries = async (database) => {
  const entries = await getAllEntries(database)
  const keepIds = new Set(chooseHistoryEntriesToKeep(entries))
  await deleteEntries(database, entries.filter(entry => !keepIds.has(entry.id)).map(entry => entry.id))
}

export const saveHistoryEntry = async ({
  file,
  thumbnailBlob,
  settings,
  sourceDims,
  outputDims,
  retentionDays,
  mode = 'single',
  now = Date.now(),
}) => {
  if (!(file instanceof Blob)) throw new Error('HISTORY_SOURCE_REQUIRED')
  if (file.size > MAX_HISTORY_BYTES) throw new Error('HISTORY_SOURCE_TOO_LARGE')
  const database = await openHistoryDatabase()
  try {
    const sourceKey = buildHistorySourceKey(file)
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const completed = transactionToPromise(transaction)
    const store = transaction.objectStore(STORE_NAME)
    const entry = {
      id: sourceKey,
      sourceKey,
      fileName: file.name || 'image',
      fileType: file.type || 'application/octet-stream',
      fileLastModified: Number(file.lastModified) || now,
      sourceSize: file.size,
      sourceBlob: file,
      thumbnailBlob: thumbnailBlob || null,
      settings: settings || {},
      sourceDims: sourceDims || null,
      outputDims: outputDims || null,
      mode,
      createdAt: now,
      expiresAt: now + normalizeRetentionDays(retentionDays) * 24 * 60 * 60 * 1000,
    }
    store.put(entry)
    await completed
    await trimHistoryEntries(database)
    return entry.id
  } finally {
    database.close()
  }
}

export const listHistoryEntries = async (now = Date.now()) => {
  const database = await openHistoryDatabase()
  try {
    const entries = await getAllEntries(database)
    const expiredIds = entries.filter(entry => isHistoryEntryExpired(entry, now)).map(entry => entry.id)
    await deleteEntries(database, expiredIds)
    const activeEntries = entries.filter(entry => !expiredIds.includes(entry.id))
    const repairedEntries = []
    for (const entry of activeEntries) {
      if (entry.thumbnailBlob || !entry.sourceBlob) continue
      try {
        entry.thumbnailBlob = await createHistoryThumbnail(entry.sourceBlob)
        if (entry.thumbnailBlob) repairedEntries.push(entry)
      } catch {
        // Some source formats, such as HEIC, require the decoded preview saved at processing time.
      }
    }
    if (repairedEntries.length) {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const completed = transactionToPromise(transaction)
      const store = transaction.objectStore(STORE_NAME)
      repairedEntries.forEach(entry => store.put(entry))
      await completed
    }
    return activeEntries
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(entry => {
        const summary = { ...entry }
        delete summary.sourceBlob
        return summary
      })
  } finally {
    database.close()
  }
}

export const getHistoryEntry = async (id) => {
  const database = await openHistoryDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const completed = transactionToPromise(transaction)
    const entry = await requestToPromise(transaction.objectStore(STORE_NAME).get(id))
    await completed
    if (!entry || isHistoryEntryExpired(entry)) return null
    return entry
  } finally {
    database.close()
  }
}

export const deleteHistoryEntry = async (id) => {
  const database = await openHistoryDatabase()
  try {
    await deleteEntries(database, [id])
  } finally {
    database.close()
  }
}

export const clearHistoryEntries = async () => {
  const database = await openHistoryDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const completed = transactionToPromise(transaction)
    transaction.objectStore(STORE_NAME).clear()
    await completed
  } finally {
    database.close()
  }
}

export const updateHistoryRetention = async (retentionDays, now = Date.now()) => {
  const days = normalizeRetentionDays(retentionDays)
  const database = await openHistoryDatabase()
  try {
    const entries = await getAllEntries(database)
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const completed = transactionToPromise(transaction)
    const store = transaction.objectStore(STORE_NAME)
    entries.forEach(entry => {
      const expiresAt = entry.createdAt + days * 24 * 60 * 60 * 1000
      if (expiresAt > now) store.put({ ...entry, expiresAt })
      else store.delete(entry.id)
    })
    await completed
  } finally {
    database.close()
  }
}

export const createFileFromHistoryEntry = (entry) => {
  if (!entry?.sourceBlob) throw new Error('HISTORY_SOURCE_MISSING')
  return new File([entry.sourceBlob], entry.fileName || 'image', {
    type: entry.fileType || entry.sourceBlob.type || 'application/octet-stream',
    lastModified: Number(entry.fileLastModified) || Date.now(),
  })
}
