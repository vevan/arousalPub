import { AsyncLocalStorage } from 'node:async_hooks'
import { runRequestUserAsync, tryGetCurrentUserId } from './user-context.js'

/**
 * 同一队列实例、同 key 重入时直接 inline，避免 queue.run 嵌套等待自身死锁。
 * token 以「实例 + key」组合（不同队列的 key 字符串可能相同，如都是
 * `${userId}\0${kbId}`，不得互相视为重入）。
 *
 * hold 带 active 位：ALS 上下文会随 `.then` 注册传播到外层任务结束后才运行的
 * 延迟任务（如 coalesce drain 从某队列任务内被调度），若只按 token 判断，
 * 陈旧持有会让后来的任务错误 inline、绕过串行；任务收尾即置 inactive。
 */
interface QueueReentryHold {
  readonly token: object
  active: boolean
}

const queueReentryContext = new AsyncLocalStorage<
  readonly QueueReentryHold[]
>()

/**
 * Per-key serial task queue (prev.catch → then), matching conversation memory chains.
 */
export function createKeyedSerialQueue() {
  const tails = new Map<string, Promise<unknown>>()
  const tokens = new Map<string, object>()

  function tokenOf(key: string): object {
    let t = tokens.get(key)
    if (!t) {
      t = { key }
      tokens.set(key, t)
    }
    return t
  }

  function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const token = tokenOf(key)
    const held = queueReentryContext.getStore()
    if (held?.some((h) => h.token === token && h.active)) {
      return task()
    }
    const prev = tails.get(key) ?? Promise.resolve()
    const next = prev
      .catch(() => undefined)
      .then(() => {
        const outer = queueReentryContext.getStore() ?? []
        const hold: QueueReentryHold = { token, active: true }
        const inner = queueReentryContext.run(
          [...outer.filter((h) => h.active), hold],
          task,
        )
        return inner.finally(() => {
          hold.active = false
        })
      })
    const tracked = next
      .catch(() => undefined)
      .finally(() => {
        if (tails.get(key) === tracked) {
          tails.delete(key)
          tokens.delete(key)
        }
      })
    tails.set(key, tracked)
    return next
  }

  return { run }
}

/**
 * Schedule work per key with coalescing: while a run is in flight, later
 * schedule() calls only keep the latest item; one drain processes it after.
 *
 * 用户隔离：调度时捕获当前用户 id 并入内部 key，drain 在该用户上下文中执行。
 * 否则前序 drain（携带旧请求的 ALS 上下文）可能处理后续其他用户 coalesce
 * 进来的 item，导致读写错误用户的数据目录。无用户上下文（纯单测）时不加前缀。
 */
export function createKeyedCoalesceScheduler<T>(options: {
  keyOf: (item: T) => string
  process: (item: T) => Promise<void>
  onError?: (error: unknown) => void
}) {
  const queue = createKeyedSerialQueue()
  const latest = new Map<string, { item: T; userId: string | undefined }>()

  function currentUserScope(): string | undefined {
    return tryGetCurrentUserId()
  }

  function scopedKey(userId: string | undefined, rawKey: string): string {
    return userId === undefined ? rawKey : `${userId}\0${rawKey}`
  }

  async function processInUserContext(entry: {
    item: T
    userId: string | undefined
  }): Promise<void> {
    if (entry.userId === undefined) {
      await options.process(entry.item)
      return
    }
    await runRequestUserAsync(entry.userId, async () => {
      await options.process(entry.item)
    })
  }

  function schedule(item: T): void {
    const userId = currentUserScope()
    const key = scopedKey(userId, options.keyOf(item))
    latest.set(key, { item, userId })
    void queue
      .run(key, async () => {
        while (latest.has(key)) {
          const snap = latest.get(key)!
          latest.delete(key)
          await processInUserContext(snap)
        }
      })
      .catch((error) => {
        options.onError?.(error)
      })
  }

  function runExclusive<R>(key: string, task: () => Promise<R>): Promise<R> {
    const scoped = scopedKey(currentUserScope(), key)
    return queue.run(scoped, async () => {
      latest.delete(scoped)
      return task()
    })
  }

  /** Drop a coalesced pending item without running it (e.g. superseded by delete). */
  function clearPending(key: string): void {
    latest.delete(scopedKey(currentUserScope(), key))
  }

  /** predicate 收到的是去除用户前缀后的原始 key；仅作用于当前用户的 pending */
  function clearPendingWhere(predicate: (key: string) => boolean): void {
    const userId = currentUserScope()
    const prefix = userId === undefined ? '' : `${userId}\0`
    for (const key of [...latest.keys()]) {
      if (!key.startsWith(prefix)) continue
      const raw = key.slice(prefix.length)
      if (userId === undefined && raw.includes('\0')) continue
      if (predicate(raw)) latest.delete(key)
    }
  }

  return { schedule, runExclusive, clearPending, clearPendingWhere }
}
