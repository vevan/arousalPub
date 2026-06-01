import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import * as lancedb from '@lancedb/lancedb'
import type { Connection } from '@lancedb/lancedb'

/** 单进程内 Lance 连接上限（按 URI）；超出 LRU 淘汰并 close */
const MAX_CONNECTIONS = 32

interface PoolEntry {
  connection: Connection
  lastUsedAt: number
}

const pool = new Map<string, PoolEntry>()
const pending = new Map<string, Promise<Connection>>()

function poolKey(uri: string): string {
  return path.resolve(uri)
}

function touch(entry: PoolEntry): Connection {
  entry.lastUsedAt = Date.now()
  return entry.connection
}

function evictOldest(exceptKey?: string): void {
  if (pool.size < MAX_CONNECTIONS) return
  let oldestKey: string | null = null
  let oldestAt = Infinity
  for (const [key, entry] of pool) {
    if (key === exceptKey) continue
    if (entry.lastUsedAt < oldestAt) {
      oldestAt = entry.lastUsedAt
      oldestKey = key
    }
  }
  if (!oldestKey) return
  const victim = pool.get(oldestKey)
  pool.delete(oldestKey)
  if (victim?.connection.isOpen()) {
    try {
      victim.connection.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * 按 URI 复用 Lance Connection（官方建议长连接共享）。
 * 目录不存在时会创建。
 */
export async function openLanceDb(uri: string): Promise<Connection> {
  const key = poolKey(uri)
  await mkdir(key, { recursive: true })

  const cached = pool.get(key)
  if (cached?.connection.isOpen()) {
    return touch(cached)
  }
  if (cached) {
    pool.delete(key)
  }

  const inflight = pending.get(key)
  if (inflight) return inflight

  const promise = lancedb.connect(key).then((connection) => {
    pending.delete(key)
    evictOldest(key)
    pool.set(key, { connection, lastUsedAt: Date.now() })
    return connection
  })
  promise.catch(() => {
    pending.delete(key)
  })
  pending.set(key, promise)
  return promise
}

/** 关闭指定 URI 的缓存连接（如整库删除后） */
export function closeLanceDb(uri: string): void {
  const key = poolKey(uri)
  pending.delete(key)
  const entry = pool.get(key)
  pool.delete(key)
  if (entry?.connection.isOpen()) {
    try {
      entry.connection.close()
    } catch {
      /* ignore */
    }
  }
}

/** 进程退出时释放全部 Lance 连接 */
export function closeAllLanceConnections(): void {
  for (const entry of pool.values()) {
    if (entry.connection.isOpen()) {
      try {
        entry.connection.close()
      } catch {
        /* ignore */
      }
    }
  }
  pool.clear()
  pending.clear()
}
