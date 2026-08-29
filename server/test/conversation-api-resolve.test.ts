import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { runRequestUserAsync } from '../src/user-context.js'

const TEST_USER = 'b0000001'

describe('resolveConversationChatCall (persisted settings)', () => {
  let prevDataDir: string | undefined
  let prevDek: string | undefined
  let tmp = ''
  let resolveConversationChatCall: typeof import('../src/conversation-api-resolve.js').resolveConversationChatCall
  let writeApiSettingsToFile: typeof import('../src/api-settings-file.js').writeApiSettingsToFile
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

  it('falls back to the persisted active preset without a conversation override', async () => {
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

  it('applies the persisted chat override', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const conversationId = 'c7777777'
      await createConversationStub(conversationId, 'disk only')
      await updateConversationChatApiSettings(conversationId, {
        apiConfigId: 'preset-other',
        temperature: 0.15,
        model: 'disk-model',
      })
      const call = await resolveConversationChatCall(conversationId)
      assert.equal(call.presetId, 'preset-other')
      assert.equal(call.baseUrl, 'https://other.example/v1')
      assert.equal(call.apiKey, 'sk-other-key')
      assert.equal(call.params.model, 'disk-model')
      assert.equal(call.params.temperature, 0.15)
      assert.equal(call.usedConversationOverride, true)
    })
  })

  it('uses the persisted override parameter values', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const conversationId = 'c8888888'
      await createConversationStub(conversationId, 'partial body')
      await updateConversationChatApiSettings(conversationId, {
        apiConfigId: 'preset-other',
        temperature: 0.11,
      })
      const call = await resolveConversationChatCall(conversationId)
      assert.equal(call.presetId, 'preset-other')
      assert.equal(call.params.temperature, 0.11)
      assert.equal(call.params.model, 'other-model')
      assert.equal(call.usedConversationOverride, true)
    })
  })

  it('uses global parameters while retaining an inherited conversation snapshot', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const conversationId = 'c9999999'
      await createConversationStub(conversationId, 'inherited snapshot')
      await updateConversationChatApiSettings(conversationId, {
        inheritGlobal: true,
        apiConfigId: 'preset-other',
        model: 'saved-for-later',
        temperature: 0.11,
      })
      const call = await resolveConversationChatCall(conversationId)
      assert.equal(call.presetId, 'preset-active')
      assert.equal(call.params.model, 'active-model')
      assert.equal(call.params.temperature, 0.7)
      assert.equal(call.usedConversationOverride, false)

      const { readConversationIndex } = await import('../src/chat-storage.js')
      const idx = await readConversationIndex(conversationId)
      const chat = (idx?.apiPreset as { chat?: Record<string, unknown> } | undefined)?.chat
      assert.equal(chat?.inheritGlobal, true)
      assert.equal(chat?.apiConfigId, 'preset-other')
      assert.equal(chat?.model, 'saved-for-later')
    })
  })

  it('restores the bound preset when inheritGlobal is turned off', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const conversationId = 'c9999998'
      await createConversationStub(conversationId, 'restore binding')
      await updateConversationChatApiSettings(conversationId, {
        inheritGlobal: true,
        apiConfigId: 'preset-other',
        model: 'saved-for-later',
        temperature: 0.11,
      })
      await updateConversationChatApiSettings(conversationId, {
        inheritGlobal: false,
        apiConfigId: 'preset-other',
        model: 'saved-for-later',
        temperature: 0.11,
      })
      const call = await resolveConversationChatCall(conversationId)
      assert.equal(call.presetId, 'preset-other')
      assert.equal(call.params.model, 'saved-for-later')
      assert.equal(call.params.temperature, 0.11)
      assert.equal(call.usedConversationOverride, true)
    })
  })

})
