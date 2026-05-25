import { AsyncLocalStorage } from 'node:async_hooks'

/** 未指定用户时的默认数据目录名：`data/default-user/` */
export const DEFAULT_USER_ID = 'default-user'

const userStorage = new AsyncLocalStorage<string>()

const USER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

/** 规范化用户 id，非法或空则回退 default-user */
export function resolveUserId(raw?: string | null): string {
  const s = (raw ?? '').trim()
  if (!s || !USER_ID_RE.test(s)) return DEFAULT_USER_ID
  return s
}

export function getCurrentUserId(): string {
  return userStorage.getStore() ?? DEFAULT_USER_ID
}

/** 在 Fastify onRequest 中调用，使本请求后续异步链路带上用户上下文 */
export function enterRequestUser(raw?: string | null): void {
  userStorage.enterWith(resolveUserId(raw))
}

export function userIdFromRequest(request: {
  headers: Record<string, unknown>
  query?: unknown
}): string | undefined {
  const h = request.headers['x-user-id']
  const header = Array.isArray(h) ? h[0] : h
  if (typeof header === 'string' && header.trim()) return header.trim()
  const q =
    request.query && typeof request.query === 'object'
      ? (request.query as Record<string, unknown>).user
      : undefined
  if (typeof q === 'string' && q.trim()) return q.trim()
  return undefined
}
