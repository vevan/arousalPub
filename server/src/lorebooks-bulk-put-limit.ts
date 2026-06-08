import { LOREBOOKS_BULK_PUT_MIN_INTERVAL_MS } from './lorebook-file.js'

const lastBulkPutAt = new Map<string, number>()

/** 通过则记录本次时间戳；失败表示距上次 PUT 过近 */
export function tryAcquireLorebooksBulkPutSlot(userId: string): boolean {
  const id = userId.trim()
  if (!id) return false
  const now = Date.now()
  const last = lastBulkPutAt.get(id) ?? 0
  if (now - last < LOREBOOKS_BULK_PUT_MIN_INTERVAL_MS) {
    return false
  }
  lastBulkPutAt.set(id, now)
  return true
}
