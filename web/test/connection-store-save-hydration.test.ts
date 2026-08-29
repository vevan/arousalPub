import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, watch } from 'vue'
import { useConnectionStore, type ApiPreset } from '../src/stores/connection.ts'
import { resolveConversationChatDisplay } from '../src/utils/conversation-api-settings.ts'

const originalFetch = globalThis.fetch

function preset(maxTokens: number): ApiPreset {
  return {
    id: 'preset-a',
    alias: 'A',
    baseUrl: 'https://example.test/v1',
    apiKey: '',
    model: 'model-a',
    contextLength: 8192,
    maxTokens,
    stream: true,
    temperature: 1,
    topP: 0.95,
    topK: null,
    dryMultiplier: null,
    dryBase: null,
    dryAllowedLength: null,
    dryPenaltyLastN: null,
    drySequenceBreakers: [],
    frequencyPenalty: null,
    presencePenalty: null,
    customParamsJson: '',
    showReasoningChain: true,
    requestReasoningChain: true,
    linkedPromptPresetId: null,
    apiKeyId: null,
    keyConfigured: true,
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('connection store save versus conversation hydration', () => {
  it('does not restore the old baseline while PUT is in flight', async () => {
    setActivePinia(createPinia())
    const conn = useConnectionStore()
    const initial = {
      version: 1 as const,
      savedAt: '2026-08-29T00:00:00.000Z',
      activePresetId: 'preset-a',
      presets: [preset(16000)],
    }

    let resolvePut!: (response: Response) => void
    const putResponse = new Promise<Response>((resolve) => {
      resolvePut = resolve
    })
    let putBody: unknown
    globalThis.fetch = async (input, init) => {
      if (String(input) === '/api/settings' && init?.method === 'PUT') {
        putBody = JSON.parse(String(init.body))
        return putResponse
      }
      return new Response(JSON.stringify(initial), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    assert.equal(await conn.loadFromServer(), true)
    const apiPresetRaw = { chat: { apiConfigId: 'preset-a' } }
    conn.hydratePanelForConversation({
      useGlobal: false,
      effective: resolveConversationChatDisplay(
        conn.presets,
        conn.activePresetId,
        apiPresetRaw,
      ),
      fallbackPresetId: conn.activePresetId,
    })

    const stop = watch(
      () => conn.presets,
      () => {
        conn.hydratePanelForConversation({
          useGlobal: false,
          effective: resolveConversationChatDisplay(
            conn.presets,
            conn.activePresetId,
            apiPresetRaw,
          ),
          fallbackPresetId: conn.activePresetId,
        })
      },
      { deep: true },
    )

    conn.maxTokens = 15999
    const saving = conn.saveToServer()
    await nextTick()
    await nextTick()

    assert.equal(conn.maxTokens, 15999)
    assert.equal(conn.presets[0]?.maxTokens, 15999)

    resolvePut(
      new Response(JSON.stringify({ savedAt: '2026-08-29T00:01:00.000Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await saving
    stop()

    assert.equal(conn.maxTokens, 15999)
    assert.equal(conn.presets[0]?.maxTokens, 15999)
    assert.equal(conn.isPanelDirty, false)
    assert.equal(
      (putBody as { presets: ApiPreset[] }).presets[0]?.maxTokens,
      15999,
    )
  })
})
