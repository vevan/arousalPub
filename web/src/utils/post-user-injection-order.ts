export {
  POST_USER_INJECTION_ORDER_HOST_DEFAULTS,
  POST_USER_INJECTION_ORDER_HOST_KEYS,
  POST_USER_INJECTION_ORDER_SLOT_DEFAULTS,
  clampInjectionOrder,
  hostPolicyToStoredPatch,
  normalizePostUserInjectionOrderHostPolicy,
  type AssembleInjectionOrderSlots,
  type PostUserInjectionOrderHostKey,
  type PostUserInjectionOrderHostPatch,
  type PostUserInjectionOrderHostPolicy,
} from '@/shared/post-user-injection-order'

import {
  POST_USER_INJECTION_ORDER_HOST_KEYS,
  type PostUserInjectionOrderHostPolicy,
} from '@/shared/post-user-injection-order'

export const INJECTION_ORDER_MIN = 0
export const INJECTION_ORDER_MAX = 9999

export function clonePostUserInjectionOrderHostPolicy(
  policy: PostUserInjectionOrderHostPolicy,
): PostUserInjectionOrderHostPolicy {
  return { ...policy }
}

export function postUserInjectionOrderHostPolicyEqual(
  a: PostUserInjectionOrderHostPolicy,
  b: PostUserInjectionOrderHostPolicy,
): boolean {
  return POST_USER_INJECTION_ORDER_HOST_KEYS.every((key) => a[key] === b[key])
}
