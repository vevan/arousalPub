import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { runRequestUserAsync } from '../src/user-context.js'

const TEST_USER = 'b0000001'

describe('resolveConversationChatCall (panel snapshot)', () => {
  let prevDataDir: string | undefined
  let prevDek: string | undefined
  let tmp = ''
  let resolveConversationChatCall: typeof import('../src/conversation-api-resolve.js').resolveConversationChatCall
  let writeApiSettingsToFile: typeof import('../src/api-settings-file.js').writeApiSettingsToFile
  let writeApiKeysDocument: typeof import('../src/api-keys-file.js').writeApiKeysDocument
  let createConversationStub: typeof import('../src/chat-storage.js').createConversationStub
  let updateConversationChatApiSettings: typeof import('../src/chat-storage.js').updateConversationChatApiSettings

  before(async () => {
    prevDataDir = process.env.DATA_DIR
    prevDek = process.env.DATA_ENCRYPTION_KEY
    tmp = path.join(process.cwd(), '.tmp', 'conversation-chat-call-resolve')
    await rm(tmp, { recursive: true, force: true })
    process.env.DATA_DIR = tmp
    process.env.DATA_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    await mkdir(path.join(tmp, TEST_USER, 'chats'), { recursive: true })

    ;({ writeApiSettingsToFile } = await import('../src/api-settings-file.js'))
    ;({ writeApiKeysDocument } = await import('../src/api-keys-file.js'))
    ;({
      createConversationStub,
      updateConversationChatApiSettings,
    } = await import('../src/chat-storage.js'))
    ;({ resolveConversationChatCall } = await import(
      '../src/conversation-api-resolve.js'
    ))

    await runRequestUserAsync(TEST_USER, async () => {
      await writeApiSettingsToFile({
        version: 1,
        savedAt: new Date().toISOString(),
        activePresetId: 'preset-active',
        presets: [
          {
            id: 'preset-active',
            alias: 'Active',
            baseUrl: 'https://active.example/v1',
            apiKey: 'sk-active-key',
            model: 'active-model',
            contextLength: 8000,
            maxTokens: 1000,
            stream: true,
            temperature: 0.7,
            topP: null,
            topK: null,
            dryMultiplier: null,
            dryBase: null,
            dryAllowedLength: null,
            dryPenaltyLastN: null,
            drySequenceBreakers: [],
            frequencyPenalty: null,
            presencePenalty: null,
            customParamsJson: '',
            showReasoningChain: false,
            requestReasoningChain: false,
            apiKeyId: null,
          },
          {
            id: 'preset-other',
            alias: 'Other',
            baseUrl: 'https://other.example/v1',
            apiKey: 'sk-other-key',
            model: 'other-model',
            contextLength: 4000,
            maxTokens: 500,
            stream: false,
            temperature: 0.2,
            topP: null,
            topK: null,
            dryMultiplier: null,
            dryBase: null,
            dryAllowedLength: null,
            dryPenaltyLastN: null,
            drySequenceBreakers: [],
            frequencyPenalty: null,
            presencePenalty: null,
            customParamsJson: '',
            showReasoningChain: false,
            requestReasoningChain: false,
            apiKeyId: null,
          },
        ],
      })
    })
  })

  after(async () => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevDek === undefined) delete process.env.DATA_ENCRYPTION_KEY
    else process.env.DATA_ENCRYPTION_KEY = prevDek
    await rm(tmp, { recursive: true, force: true })
  })

  it('falls back to active preset when body has no apiPresetId', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const conversationId = 'c1111111'
      await createConversationStub(conversationId, 'no binding')
      const call = await resolveConversationChatCall(conversationId)
      assert.equal(call.presetId, 'preset-active')
      assert.equal(call.baseUrl, 'https://active.example/v1')
      assert.equal(call.apiKey, 'sk-active-key')
      assert.equal(call.params.model, 'active-model')
      assert.equal(call.usedConversationOverride, false)
    })
  })

  it('uses body apiPresetId and baseUrl together (homologous panel snapshot)', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const conversationId = 'c3333333'
      await createConversationStub(conversationId, 'panel other')
      const call = await resolveConversationChatCall(conversationId, {
        apiPresetId: 'preset-other',
        baseUrl: 'https://panel.example/v1',
        model: 'panel-model',
      })
      assert.equal(call.presetId, 'preset-other')
      assert.equal(call.baseUrl, 'https://panel.example/v1')
      assert.equal(call.apiKey, 'sk-other-key')
      assert.equal(call.params.model, 'panel-model')
    })
  })

  it('ignores conversation disk apiConfigId and sampling when body selects another preset', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const conversationId = 'c2222222'
      await createConversationStub(conversationId, 'with binding')
      await updateConversationChatApiSettings(conversationId, {
        apiConfigId: 'preset-other',
        temperature: 0.1,
      })
      const call = await resolveConversationChatCall(conversationId, {
        apiPresetId: 'preset-active',
        model: 'active-model',
        temperature: 0.7,
      })
      assert.equal(call.presetId, 'preset-active')
      assert.equal(call.baseUrl, 'https://active.example/v1')
      assert.equal(call.apiKey, 'sk-active-key')
      assert.equal(call.params.model, 'active-model')
      assert.equal(call.params.temperature, 0.7)
      assert.equal(call.usedConversationOverride, false)
    })
  })

  it('prefers draft apiKey over preset disk key', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const conversationId = 'c4444444'
      await createConversationStub(conversationId, 'draft key')
      const call = await resolveConversationChatCall(conversationId, {
        apiPresetId: 'preset-active',
        apiKey: 'sk-draft-key',
      })
      assert.equal(call.apiKey, 'sk-draft-key')
      assert.equal(call.presetId, 'preset-active')
    })
  })

  it('allows panel snapshot chat when apiPresetId is not on disk', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const conversationId = 'c5555555'
      await createConversationStub(conversationId, 'unsaved preset')
      const call = await resolveConversationChatCall(conversationId, {
        apiPresetId: 'preset-not-saved',
        baseUrl: 'https://draft.example/v1',
        apiKey: 'sk-unsaved-draft',
        model: 'draft-model',
        temperature: 0.3,
        alias: 'Draft',
      })
      assert.equal(call.presetId, 'preset-not-saved')
      assert.equal(call.baseUrl, 'https://draft.example/v1')
      assert.equal(call.apiKey, 'sk-unsaved-draft')
      assert.equal(call.params.model, 'draft-model')
      assert.equal(call.params.temperature, 0.3)
      assert.equal(call.params.alias, 'Draft')
    })
  })

  it('explicit null apiKeyId does not use disk keychain', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const conversationId = 'c6666666'
      await createConversationStub(conversationId, 'clear keychain')
      await writeApiSettingsToFile({
        version: 1,
        savedAt: new Date().toISOString(),
        activePresetId: 'preset-active',
        presets: [
          {
            id: 'preset-active',
            alias: 'Active',
            baseUrl: 'https://active.example/v1',
            apiKey: 'sk-inline-only',
            model: 'active-model',
            contextLength: 8000,
            maxTokens: 1000,
            stream: true,
            temperature: 0.7,
            topP: null,
            topK: null,
            dryMultiplier: null,
            dryBase: null,
            dryAllowedLength: null,
            dryPenaltyLastN: null,
            drySequenceBreakers: [],
            frequencyPenalty: null,
            presencePenalty: null,
            customParamsJson: '',
            showReasoningChain: false,
            requestReasoningChain: false,
            apiKeyId: 'key-should-not-use',
          },
          {
            id: 'preset-other',
            alias: 'Other',
            baseUrl: 'https://other.example/v1',
            apiKey: 'sk-other-key',
            model: 'other-model',
            contextLength: 4000,
            maxTokens: 500,
            stream: false,
            temperature: 0.2,
            topP: null,
            topK: null,
            dryMultiplier: null,
            dryBase: null,
            dryAllowedLength: null,
            dryPenaltyLastN: null,
            drySequenceBreakers: [],
            frequencyPenalty: null,
            presencePenalty: null,
            customParamsJson: '',
            showReasoningChain: false,
            requestReasoningChain: false,
            apiKeyId: null,
          },
        ],
      })
      await writeApiKeysDocument({
        version: 1,
        savedAt: new Date().toISOString(),
        keys: [
          {
            id: 'key-should-not-use',
            alias: 'chain',
            key: 'sk-from-keychain',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      })
      const omitted = await resolveConversationChatCall(conversationId, {
        apiPresetId: 'preset-active',
      })
      assert.equal(omitted.apiKey, 'sk-from-keychain')
      const cleared = await resolveConversationChatCall(conversationId, {
        apiPresetId: 'preset-active',
        apiKeyId: null,
      })
      assert.equal(cleared.apiKey, 'sk-inline-only')
    })
  })
})
