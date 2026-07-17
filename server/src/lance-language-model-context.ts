import { AsyncLocalStorage } from 'node:async_hooks'

const homeStorage = new AsyncLocalStorage<string>()

/** Lance jieba 读词典时使用的进程 env 名 */
export const LANCE_LANGUAGE_MODEL_HOME_ENV = 'LANCE_LANGUAGE_MODEL_HOME'

let envLock: Promise<void> = Promise.resolve()

/** 当前 async 上下文中生效的词典根目录（测试/诊断） */
export function getLanceLanguageModelHomeFromContext(): string | undefined {
  return homeStorage.getStore()
}

async function acquireEnvLock(): Promise<() => void> {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const prev = envLock
  envLock = gate
  await prev
  return release
}

/**
 * Lance jieba 经 `process.env.LANCE_LANGUAGE_MODEL_HOME` 定位词典。
 * 多用户并发时须串行化 env 写入；`languageModelHome` 为空时直接执行 fn。
 * **可重入**：已在持锁上下文中时不再二次 acquire（避免 ensureHybridFtsIndex 嵌套死锁）。
 */
export async function withLanceLanguageModelHome<T>(
  languageModelHome: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!languageModelHome) {
    return fn()
  }

  const current = homeStorage.getStore()
  if (current != null) {
    if (current === languageModelHome) {
      return fn()
    }
    // 同锁内切换词典根（极少见）：不重入 acquire
    const prev = process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]
    process.env[LANCE_LANGUAGE_MODEL_HOME_ENV] = languageModelHome
    try {
      return await homeStorage.run(languageModelHome, fn)
    } finally {
      if (prev === undefined) {
        delete process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]
      } else {
        process.env[LANCE_LANGUAGE_MODEL_HOME_ENV] = prev
      }
    }
  }

  const release = await acquireEnvLock()
  return homeStorage.run(languageModelHome, async () => {
    const prev = process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]
    process.env[LANCE_LANGUAGE_MODEL_HOME_ENV] = languageModelHome
    try {
      return await fn()
    } finally {
      if (prev === undefined) {
        delete process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]
      } else {
        process.env[LANCE_LANGUAGE_MODEL_HOME_ENV] = prev
      }
      release()
    }
  })
}
