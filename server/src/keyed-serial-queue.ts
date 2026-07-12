/**
 * Per-key serial task queue (prev.catch → then), matching conversation memory chains.
 */
export function createKeyedSerialQueue() {
  const tails = new Map<string, Promise<unknown>>()

  function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(task)
    const tracked = next
      .catch(() => undefined)
      .finally(() => {
        if (tails.get(key) === tracked) {
          tails.delete(key)
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
 */
export function createKeyedCoalesceScheduler<T>(options: {
  keyOf: (item: T) => string
  process: (item: T) => Promise<void>
  onError?: (error: unknown) => void
}) {
  const queue = createKeyedSerialQueue()
  const latest = new Map<string, T>()

  function schedule(item: T): void {
    const key = options.keyOf(item)
    latest.set(key, item)
    void queue
      .run(key, async () => {
        while (latest.has(key)) {
          const snap = latest.get(key)!
          latest.delete(key)
          await options.process(snap)
        }
      })
      .catch((error) => {
        options.onError?.(error)
      })
  }

  function runExclusive<R>(key: string, task: () => Promise<R>): Promise<R> {
    return queue.run(key, async () => {
      latest.delete(key)
      return task()
    })
  }

  /** Drop a coalesced pending item without running it (e.g. superseded by delete). */
  function clearPending(key: string): void {
    latest.delete(key)
  }

  function clearPendingWhere(predicate: (key: string) => boolean): void {
    for (const key of [...latest.keys()]) {
      if (predicate(key)) latest.delete(key)
    }
  }

  return { schedule, runExclusive, clearPending, clearPendingWhere }
}
