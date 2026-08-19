import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { runRequestUserAsync } from '../src/user-context.js'

const TEST_USER = 'b0000001'

describe('resolveConversationChatCall (no request-body mix)', () => {
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

  it('uses active preset baseUrl+key when conversation has no chat binding', async () => {
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

  it('uses conversation apiConfigId preset, not active', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const conversationId = 'c2222222'
      await createConversationStub(conversationId, 'with binding')
      await updateConversationChatApiSettings(conversationId, {
        apiConfigId: 'preset-other',
        temperature: 0.1,
      })
      const call = await resolveConversationChatCall(conversationId)
      assert.equal(call.presetId, 'preset-other')
      assert.equal(call.baseUrl, 'https://other.example/v1')
      assert.equal(call.apiKey, 'sk-other-key')
      assert.equal(call.params.model, 'other-model')
      assert.equal(call.params.temperature, 0.1)
      assert.equal(call.usedConversationOverride, true)
    })
  })
})
