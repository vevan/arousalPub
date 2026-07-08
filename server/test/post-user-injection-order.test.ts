import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  __resetAssembleInjectionOrderPoliciesForTest,
  __setAssembleInjectionOrderPolicyForTest,
  getAssembleInjectionOrderPolicy,
} from '../src/plugin-system/assemble-injection-order-policies.js'
import {
  mergePostUserInjectionOrderHostPatch,
  hostPolicyToStoredPatch,
  normalizePostUserInjectionOrderHostPolicy,
  POST_USER_INJECTION_ORDER_HOST_DEFAULTS,
  POST_USER_INJECTION_ORDER_SLOT_DEFAULTS,
  resolveAssembleInjectionOrderSlot,
} from '../src/shared/post-user-injection-order.js'

describe('post-user-injection-order', () => {
  it('normalizes host policy with clamp', () => {
    const policy = normalizePostUserInjectionOrderHostPolicy({
      afterUserInput: 25.7,
      default: -5,
    })
    assert.equal(policy.afterUserInput, 25)
    assert.equal(policy.default, 0)
  })

  it('resolves manifest slot with fallback', () => {
    assert.equal(
      resolveAssembleInjectionOrderSlot({ send: 15 }, 'send', 10),
      15,
    )
    assert.equal(resolveAssembleInjectionOrderSlot({}, 'send', 10), 10)
  })

  it('uses bundled slot defaults when manifest slots missing', () => {
    assert.equal(POST_USER_INJECTION_ORDER_SLOT_DEFAULTS.send, 0)
    assert.equal(POST_USER_INJECTION_ORDER_SLOT_DEFAULTS.reviseAssistant, 0)
    assert.equal(POST_USER_INJECTION_ORDER_SLOT_DEFAULTS.reviseSystem, 1)
    assert.equal(POST_USER_INJECTION_ORDER_SLOT_DEFAULTS.default, 500)
  })

  it('merges partial host patch without dropping other keys', () => {
    const merged = mergePostUserInjectionOrderHostPatch(
      { afterUserInput: 25, presetChatDepth0: 110 },
      { afterUserInput: 30 },
    )
    assert.equal(merged.afterUserInput, 30)
    assert.equal(merged.presetChatDepth0, 110)
    assert.equal(merged.default, POST_USER_INJECTION_ORDER_HOST_DEFAULTS.default)
    const stored = hostPolicyToStoredPatch(merged)
    assert.ok(stored)
    assert.equal(stored!.afterUserInput, 30)
    assert.equal(stored!.presetChatDepth0, 110)
    assert.equal(stored!.default, undefined)
  })

  it('full host patch resets keys omitted from sparse stored form', () => {
    const merged = mergePostUserInjectionOrderHostPatch(
      { afterUserInput: 25, presetChatDepth0: 110 },
      {
        default: POST_USER_INJECTION_ORDER_HOST_DEFAULTS.default,
        afterUserInput: POST_USER_INJECTION_ORDER_HOST_DEFAULTS.afterUserInput,
        presetChatDepth0: 110,
      },
    )
    assert.equal(merged.afterUserInput, POST_USER_INJECTION_ORDER_HOST_DEFAULTS.afterUserInput)
    assert.equal(merged.presetChatDepth0, 110)
  })
})

describe('assemble-injection-order-policies', () => {
  it('returns manifest slots per plugin id', () => {
    __resetAssembleInjectionOrderPoliciesForTest()
    __setAssembleInjectionOrderPolicyForTest('fixture-plugin-a', {
      slots: { send: 42 },
      slotSettingsKeys: { send: 'injectionOrderSend' },
    })
    assert.deepEqual(getAssembleInjectionOrderPolicy('fixture-plugin-a'), {
      slots: { send: 42 },
      slotSettingsKeys: { send: 'injectionOrderSend' },
    })
    assert.deepEqual(getAssembleInjectionOrderPolicy('unknown'), {
      slots: {},
      slotSettingsKeys: {},
    })
  })
})
