/** DOC/38 §3.2 · post-user 区 injectionOrder 档位（宿主 + manifest 可覆盖） */

import { CHAT_INJECTION_ORDER_DEFAULT } from './plugin-prompt-injection.js'

/** 宿主隐式档位默认值（小=近 user · 大=近栈底） */
export const POST_USER_INJECTION_ORDER_HOST_DEFAULTS = {
  /** 描述符省略 / ST 默认 */
  default: CHAT_INJECTION_ORDER_DEFAULT,
  /** 群聊 afterUserInput */
  afterUserInput: 20,
  /** assemble hoist 无元数据的 preset chat depth 0 tail */
  presetChatDepth0: CHAT_INJECTION_ORDER_DEFAULT,
} as const

/** manifest `assembleInjection.slots` 常用键的 bundled 默认（第三方插件自定键名） */
export const POST_USER_INJECTION_ORDER_SLOT_DEFAULTS = {
  send: 0,
  reviseAssistant: 0,
  reviseSystem: 1,
  default: 500,
} as const

export type PostUserInjectionOrderHostKey = keyof typeof POST_USER_INJECTION_ORDER_HOST_DEFAULTS

export const POST_USER_INJECTION_ORDER_HOST_KEYS: readonly PostUserInjectionOrderHostKey[] =
  ['default', 'afterUserInput', 'presetChatDepth0']

export type PostUserInjectionOrderHostPolicy = {
  [K in PostUserInjectionOrderHostKey]: number
}

export type PostUserInjectionOrderHostPatch = Partial<PostUserInjectionOrderHostPolicy>

export type AssembleInjectionOrderSlots = Record<string, number>

const ORDER_MIN = 0
const ORDER_MAX = 9999

export function clampInjectionOrder(raw: number): number {
  if (!Number.isFinite(raw)) return CHAT_INJECTION_ORDER_DEFAULT
  return Math.max(ORDER_MIN, Math.min(ORDER_MAX, Math.floor(raw)))
}

export function normalizeInjectionOrderSlots(
  raw: unknown,
): AssembleInjectionOrderSlots | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: AssembleInjectionOrderSlots = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim()
    if (!k || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(k)) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    out[k] = clampInjectionOrder(value)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function normalizePostUserInjectionOrderHostPolicy(
  patch?: PostUserInjectionOrderHostPatch | null,
): PostUserInjectionOrderHostPolicy {
  const base: PostUserInjectionOrderHostPolicy = {
    ...POST_USER_INJECTION_ORDER_HOST_DEFAULTS,
  }
  if (!patch || typeof patch !== 'object') return base
  for (const key of Object.keys(POST_USER_INJECTION_ORDER_HOST_DEFAULTS) as PostUserInjectionOrderHostKey[]) {
    const v = patch[key]
    if (typeof v === 'number' && Number.isFinite(v)) {
      base[key] = clampInjectionOrder(v)
    }
  }
  return base
}

/** 合并磁盘稀疏 patch 与本次 PATCH 字段，再归一化为完整策略 */
export function mergePostUserInjectionOrderHostPatch(
  prev: PostUserInjectionOrderHostPatch | undefined,
  patch: PostUserInjectionOrderHostPatch,
): PostUserInjectionOrderHostPolicy {
  return normalizePostUserInjectionOrderHostPolicy({
    ...prev,
    ...patch,
  })
}

/** 仅保留与 bundled 默认不同的档位（磁盘稀疏存储） */
export function hostPolicyToStoredPatch(
  policy: PostUserInjectionOrderHostPolicy,
): PostUserInjectionOrderHostPatch | null {
  const patch: PostUserInjectionOrderHostPatch = {}
  for (const key of POST_USER_INJECTION_ORDER_HOST_KEYS) {
    const v = clampInjectionOrder(policy[key])
    if (v !== POST_USER_INJECTION_ORDER_HOST_DEFAULTS[key]) {
      patch[key] = v
    }
  }
  return Object.keys(patch).length > 0 ? patch : null
}

/** 解析 manifest 槽位；`fallback` 为 bundled 常用键默认 */
export function resolveAssembleInjectionOrderSlot(
  slots: AssembleInjectionOrderSlots | undefined,
  key: string,
  fallback: number,
): number {
  const k = key.trim()
  if (k && slots && typeof slots[k] === 'number') {
    return clampInjectionOrder(slots[k]!)
  }
  return clampInjectionOrder(fallback)
}

/** @deprecated 使用 POST_USER_INJECTION_ORDER_HOST_DEFAULTS.afterUserInput */
export const AFTER_USER_INPUT_IMPLICIT_INJECTION_ORDER =
  POST_USER_INJECTION_ORDER_HOST_DEFAULTS.afterUserInput

/** @deprecated 使用 POST_USER_INJECTION_ORDER_HOST_DEFAULTS.presetChatDepth0 */
export const PRESET_CHAT_DEPTH0_IMPLICIT_INJECTION_ORDER =
  POST_USER_INJECTION_ORDER_HOST_DEFAULTS.presetChatDepth0
