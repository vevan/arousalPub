import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildConversationChatHydrationWatchKey,
  chatDisplayToConnectionSnapshot,
  isConnectionFormDirty,
  resolveHydrationPresetId,
} from '../../src/utils/conversation-chat-panel-hydration.ts'
import type { ResolvedConversationChatDisplay } from '../../src/utils/conversation-api-settings.ts'

const PRESETS = ['preset-a', 'preset-b', 'preset-c']

describe('resolveHydrationPresetId', () => {
  it('prefers explicit id when present', () => {
    assert.equal(resolveHydrationPresetId(PRESETS, 'preset-b', 'preset-a'), 'preset-b')
  })

  it('falls back to active preset then first preset', () => {
    assert.equal(resolveHydrationPresetId(PRESETS, 'missing', 'preset-c'), 'preset-c')
    assert.equal(resolveHydrationPresetId(PRESETS, 'missing', 'missing'), 'preset-a')
  })

  it('returns null for empty preset list', () => {
    assert.equal(resolveHydrationPresetId([], 'preset-a', 'preset-b'), null)
  })
})

describe('isConnectionFormDirty', () => {
  it('treats conversation hydration fingerprint as clean', () => {
    assert.equal(
      isConnectionFormDirty({
        formFingerprint: 'session-fp',
        serverBaselineFingerprint: 'global-fp',
        conversationPanelFingerprint: 'session-fp',
      }),
      false,
    )
  })

  it('marks dirty when form diverges from conversation hydration', () => {
    assert.equal(
      isConnectionFormDirty({
        formFingerprint: 'edited-fp',
        serverBaselineFingerprint: 'global-fp',
        conversationPanelFingerprint: 'session-fp',
      }),
      true,
    )
  })

  it('falls back to server baseline when no conversation fingerprint', () => {
    assert.equal(
      isConnectionFormDirty({
        formFingerprint: 'global-fp',
        serverBaselineFingerprint: 'global-fp',
        conversationPanelFingerprint: null,
      }),
      false,
    )
    assert.equal(
      isConnectionFormDirty({
        formFingerprint: 'changed-fp',
        serverBaselineFingerprint: 'global-fp',
        conversationPanelFingerprint: null,
      }),
      true,
    )
  })
})

describe('chatDisplayToConnectionSnapshot', () => {
  it('maps resolved chat display fields for panel snapshot', () => {
    const display: ResolvedConversationChatDisplay = {
      apiPresetId: 'preset-b',
      alias: 'Backup',
      model: 'gpt-test',
      contextLength: 8192,
      maxTokens: 512,
      stream: true,
      temperature: 0.2,
      topP: 0.9,
      topK: 40,
      dryMultiplier: 1,
      dryBase: 2,
      dryAllowedLength: 3,
      dryPenaltyLastN: 4,
      drySequenceBreakers: ['\\n'],
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
      customParamsJson: '{"k":1}',
      showReasoningChain: true,
      requestReasoningChain: false,
    }
    assert.deepEqual(chatDisplayToConnectionSnapshot(display), {
      model: 'gpt-test',
      contextLength: 8192,
      maxTokens: 512,
      stream: true,
      temperature: 0.2,
      topP: 0.9,
      topK: 40,
      dryMultiplier: 1,
      dryBase: 2,
      dryAllowedLength: 3,
      dryPenaltyLastN: 4,
      drySequenceBreakers: ['\\n'],
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
      customParamsJson: '{"k":1}',
      showReasoningChain: true,
      requestReasoningChain: false,
    })
  })
})

describe('buildConversationChatHydrationWatchKey', () => {
  it('is stable regardless of object key order', () => {
    const left = buildConversationChatHydrationWatchKey({
      conversationId: 'c1',
      loading: false,
      presetsReady: true,
      useGlobal: false,
      apiPresetRaw: { chat: { model: 'm', temperature: 0.5 } },
      effective: { apiPresetId: 'preset-b', model: 'm' },
      activePresetId: 'preset-a',
    })
    const right = buildConversationChatHydrationWatchKey({
      conversationId: 'c1',
      loading: false,
      presetsReady: true,
      useGlobal: false,
      apiPresetRaw: { chat: { temperature: 0.5, model: 'm' } },
      effective: { model: 'm', apiPresetId: 'preset-b' },
      activePresetId: 'preset-a',
    })
    assert.equal(left, right)
  })

  it('changes when effective values change', () => {
    const base = buildConversationChatHydrationWatchKey({
      conversationId: 'c1',
      loading: false,
      presetsReady: true,
      useGlobal: false,
      apiPresetRaw: { chat: { model: 'm1' } },
      effective: { apiPresetId: 'preset-b', model: 'm1' },
      activePresetId: 'preset-a',
    })
    const changed = buildConversationChatHydrationWatchKey({
      conversationId: 'c1',
      loading: false,
      presetsReady: true,
      useGlobal: false,
      apiPresetRaw: { chat: { model: 'm2' } },
      effective: { apiPresetId: 'preset-b', model: 'm2' },
      activePresetId: 'preset-a',
    })
    assert.notEqual(base, changed)
  })
})
