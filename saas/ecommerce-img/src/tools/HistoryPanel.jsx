import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Clock3, Image as ImageIcon, Loader2, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react'
import {
  HISTORY_RETENTION_OPTIONS,
  MAX_HISTORY_BYTES,
  MAX_HISTORY_ITEMS,
  clearHistoryEntries,
  deleteHistoryEntry,
  listHistoryEntries,
  updateHistoryRetention,
} from './localHistory'

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatDate = (timestamp) => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(timestamp))

const getErrorMessage = (error) => {
  if (error?.message === 'HISTORY_UNSUPPORTED') return '当前浏览器不支持本地历史记录。'
  return '读取本地历史失败，请检查浏览器是否允许网站存储数据。'
}

function HistoryThumbnail({ blob, name }) {
  const url = useMemo(() => blob ? URL.createObjectURL(blob) : '', [blob])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  if (!url) {
    return <div className="flex h-full w-full items-center justify-center bg-gray-100"><ImageIcon className="h-5 w-5 text-gray-300" /></div>
  }
  return <img src={url} alt={name} className="h-full w-full object-cover" />
}

export default function HistoryPanel({
  open,
  preferences,
  refreshToken,
  onClose,
  onPreferencesChange,
  onRestore,
}) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  const loadEntries = useCallback(async () => {
    if (!preferences.enabled) {
      setEntries([])
      return
    }
    setLoading(true)
    setError('')
    try {
      setEntries(await listHistoryEntries())
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [preferences.enabled])

  useEffect(() => {
    if (open) loadEntries()
  }, [open, refreshToken, loadEntries])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const totalBytes = entries.reduce((sum, entry) => sum + (Number(entry.sourceSize) || 0), 0)

  const enableHistory = async (retentionDays) => {
    setLoading(true)
    setError('')
    try {
      await updateHistoryRetention(retentionDays)
      await onPreferencesChange({ enabled: true, retentionDays })
    } catch (enableError) {
      setError(getErrorMessage(enableError))
    } finally {
      setLoading(false)
    }
  }

  const changeRetention = async (retentionDays) => {
    if (retentionDays === preferences.retentionDays) return
    setLoading(true)
    setError('')
    try {
      await updateHistoryRetention(retentionDays)
      await onPreferencesChange({ ...preferences, retentionDays })
      await loadEntries()
    } catch (retentionError) {
      setError(getErrorMessage(retentionError))
    } finally {
      setLoading(false)
    }
  }

  const removeEntry = async (id) => {
    setBusyId(id)
    setError('')
    try {
      await deleteHistoryEntry(id)
      setEntries(previous => previous.filter(entry => entry.id !== id))
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    } finally {
      setBusyId('')
    }
  }

  const clearAll = async () => {
    if (!window.confirm('确定清空当前浏览器中的全部图片历史吗？清空后无法恢复。')) return
    setLoading(true)
    setError('')
    try {
      await clearHistoryEntries()
      setEntries([])
    } catch (clearError) {
      setError(getErrorMessage(clearError))
    } finally {
      setLoading(false)
    }
  }

  const disableAndClear = async () => {
    if (!window.confirm('停用历史记录会同时清空当前浏览器中已保存的原图和参数。确定继续吗？')) return
    setLoading(true)
    setError('')
    try {
      await clearHistoryEntries()
      setEntries([])
      await onPreferencesChange({ enabled: false, retentionDays: preferences.retentionDays })
    } catch (disableError) {
      setError(getErrorMessage(disableError))
    } finally {
      setLoading(false)
    }
  }

  const restoreEntry = async (id) => {
    setBusyId(id)
    setError('')
    try {
      await onRestore(id)
    } catch (restoreError) {
      setError(restoreError?.message === 'HISTORY_SOURCE_MISSING'
        ? '这条历史记录缺少原图，无法重新载入。'
        : '重新载入失败，请删除该记录后重新上传图片。')
    } finally {
      setBusyId('')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside role="dialog" aria-modal="true" aria-labelledby="history-panel-title"
        className="flex h-full w-full max-w-md flex-col bg-gray-50 shadow-2xl">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
          <div>
            <h2 id="history-panel-title" className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <Clock3 className="h-4 w-4 text-indigo-600" /> 本地历史记录
            </h2>
            <p className="mt-1 text-xs text-gray-500">当前记录图片放大的原图和参数，只保存在本浏览器</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭历史记录"
            className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {!preferences.enabled ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                <ShieldCheck className="h-6 w-6 text-indigo-600" />
                <h3 className="mt-3 text-sm font-semibold text-indigo-900">默认不保存图片</h3>
                <p className="mt-1 text-xs leading-5 text-indigo-700">
                  开启后只保存原图、缩略图和处理参数，不保存生成后的超大结果，也不会上传服务器。
                </p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
                如果其他人使用同一个已解锁的浏览器资料，也能打开 TU Scale 查看这些记录。共享电脑建议保持关闭。
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-gray-700">选择自动删除时间</p>
                <div className="grid grid-cols-2 gap-2">
                  {HISTORY_RETENTION_OPTIONS.map(days => (
                    <button key={days} type="button" disabled={loading} onClick={() => enableHistory(days)}
                      className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-60">
                      <span className="flex items-center gap-2 text-sm font-semibold text-gray-800"><CalendarDays className="h-4 w-4 text-indigo-500" />保存 {days} 天</span>
                      <span className="mt-1 block text-[11px] text-gray-500">到期后自动删除</span>
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">自动删除</p>
                    <p className="mt-1 text-[11px] text-gray-500">同一张原图再次处理会更新原记录</p>
                  </div>
                  <div className="inline-grid grid-cols-2 rounded-lg bg-gray-100 p-1">
                    {HISTORY_RETENTION_OPTIONS.map(days => (
                      <button key={days} type="button" disabled={loading} onClick={() => changeRetention(days)}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold ${preferences.retentionDays === days ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                        {days} 天
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
                <span>{entries.length}/{MAX_HISTORY_ITEMS} 条 · {formatBytes(totalBytes)}/{formatBytes(MAX_HISTORY_BYTES)}</span>
                <button type="button" onClick={loadEntries} disabled={loading}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50">
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新
                </button>
              </div>

              {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
              {loading && entries.length === 0 && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> 正在读取本地记录</div>
              )}
              {!loading && entries.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-10 text-center">
                  <ImageIcon className="mx-auto h-7 w-7 text-gray-300" />
                  <p className="mt-3 text-sm font-semibold text-gray-700">还没有历史记录</p>
                  <p className="mt-1 text-xs leading-5 text-gray-500">开启历史后，成功放大的图片会保存在这里；开启前的图片不会自动补录。</p>
                </div>
              )}

              <div className="space-y-3">
                {entries.map(entry => (
                  <article key={entry.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <div className="flex gap-3 p-3">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-gray-100">
                        <HistoryThumbnail blob={entry.thumbnailBlob} name={entry.fileName} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-800" title={entry.fileName}>{entry.fileName}</p>
                        <p className="mt-1 text-[11px] text-gray-500">
                          {entry.sourceDims ? `${entry.sourceDims.w}×${entry.sourceDims.h}px` : '尺寸未知'} · {formatBytes(entry.sourceSize)}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-400">
                          {formatDate(entry.createdAt)} · {entry.settings?.scaleMode === 'scale' ? `${entry.settings.scale || 2}×` : '目标尺寸'}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-400">到期：{formatDate(entry.expiresAt)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto] border-t border-gray-100">
                      <button type="button" disabled={!!busyId} onClick={() => restoreEntry(entry.id)}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                        {busyId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        载入并重新处理
                      </button>
                      <button type="button" disabled={!!busyId} onClick={() => removeEntry(entry.id)} aria-label={`删除 ${entry.fileName}`}
                        className="border-l border-gray-100 px-3 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs leading-5 text-gray-500">
                清除浏览器网站数据、使用无痕模式、切换浏览器或切换设备后，记录可能不可用。正式网站与 localhost 的历史记录互不相通。
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={clearAll} disabled={loading || entries.length === 0}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                  清空全部
                </button>
                <button type="button" onClick={disableAndClear} disabled={loading}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                  停用并清空
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
