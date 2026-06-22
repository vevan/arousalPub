import { AsyncLocalStorage } from 'node:async_hooks'
import type { UserPreferencesDocument } from './user-preferences-file.js'

/** 单次 HTTP 请求内 user-preferences.json 读盘 memo（DOC/22 M5） */
interface RequestPreferencesMemo {
  /** undefined = 未加载；null = 文件缺失 */
  preferencesDoc?: UserPreferencesDocument | null
}

const memoStorage = new AsyncLocalStorage<RequestPreferencesMemo>()

export function runWithRequestPreferencesMemo<T>(fn: () => T): T {
  return memoStorage.run({}, fn)
}

export async function runWithRequestPreferencesMemoAsync(
  fn: () => Promise<void>,
): Promise<void> {
  await memoStorage.run({}, fn)
}

export function tryGetRequestPreferencesMemo():
  | RequestPreferencesMemo
  | undefined {
  return memoStorage.getStore()
}

export function getMemoizedPreferencesDoc():
  | UserPreferencesDocument
  | null
  | undefined {
  return memoStorage.getStore()?.preferencesDoc
}

export function setMemoizedPreferencesDoc(
  doc: UserPreferencesDocument | null,
): void {
  const store = memoStorage.getStore()
  if (store) store.preferencesDoc = doc
}

export function invalidateRequestPreferencesMemo(): void {
  const store = memoStorage.getStore()
  if (store) delete store.preferencesDoc
}
