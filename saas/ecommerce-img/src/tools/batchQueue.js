const noop = () => {}

export const runSequentialBatch = async ({
  items,
  shouldCancel = () => false,
  processItem,
  onItemStart = noop,
  onItemSuccess = noop,
  onItemError = noop,
  onItemSettled = noop,
}) => {
  if (!Array.isArray(items)) throw new TypeError('BATCH_ITEMS_REQUIRED')
  if (typeof processItem !== 'function') throw new TypeError('BATCH_PROCESSOR_REQUIRED')

  const summary = { completed: 0, failed: 0, cancelled: false }

  for (const item of items) {
    if (shouldCancel()) {
      summary.cancelled = true
      break
    }

    let context
    try {
      context = await onItemStart(item)
      const result = await processItem(item, context)
      await onItemSuccess(item, result, context)
      summary.completed += 1
    } catch (error) {
      await onItemError(item, error, context)
      summary.failed += 1
    } finally {
      await onItemSettled(item, context)
    }
  }

  return summary
}
