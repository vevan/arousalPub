import { AsyncLocalStorage } from 'node:async_hooks'
import { runWithRequestPreferencesMemo, runWithRequestPreferencesMemoAsync } from './request-preferences-memo.js'
import { isValidShortId, RESERVED_USER_ID } from './short-id.js'

export { RESERVED_USER_ID }

const userStorage = new AsyncLocalStorage<string>()

function assertValidRequestUserId(userId: string): string {
  const s = userId.trim()
  if (!isValidShortId(s)) {
    throw new Error('无效的用户 id')
  }
  return s
}

export function getCurrentUserId(): string {
  const id = userStorage.getStore()
  if (!id) {
    const fromEnv = process.env.AROUSAL_TEST_USER_ID?.trim()
    if (fromEnv && isValidShortId(fromEnv)) return fromEnv
    throw new Error('未登录或请求未携带有效用户上下文')
  }
  return id
}

/**
 * 在 Fastify onRequest 内用 `userStorage.run` 包裹 `done()`，使后续路由处理器能读到用户 id。
 * `enterWith`  alone 在 Fastify 5 下不会传递到 route handler。
 */
export function runRequestUser<T>(userId: string, fn: () => T): T {
  return userStorage.run(assertValidRequestUserId(userId), () =>
    runWithRequestPreferencesMemo(fn),
  )
}

/** 异步脚本 / 集成测试：在 run 内 await，避免 ALS 在首个 await 后丢失 */
export async function runRequestUserAsync(
  userId: string,
  fn: () => Promise<void>,
): Promise<void> {
  await userStorage.run(assertValidRequestUserId(userId), async () => {
    await runWithRequestPreferencesMemoAsync(fn)
  })
}

/** @deprecated 优先使用 {@link runRequestUser} */
export function enterRequestUser(userId: string): void {
  userStorage.enterWith(assertValidRequestUserId(userId))
}

/** 可选：读取当前请求用户，未登录时为 undefined */
export function tryGetCurrentUserId(): string | undefined {
  return userStorage.getStore()
}
