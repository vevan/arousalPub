import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
// 与 injection.test 一样走 dist（src 会 import .hbs，tsx 无法直接加载）
import {
  runTraceInitTool,
  runTracePatchTool,
  runTraceReadTool,
  resolveTurnPluginEntriesFromAssistant,
  LIVE_STATE_FILE,
} from '../dist/server.mjs'

function createMemoryApi(opts?: {
  agentMode?: 'on' | 'off'
  turns?: {
    turnOrdinal: number
    plugins: unknown[]
    segments: {
      receives: { id: string; content: string }[]
      activeReceiveIndex: number
    }[]
    activeSegmentIndex: number
  }[]
}) {
  const files = new Map<string, string>()
  return {
    agentMode: opts?.agentMode ?? 'on',
    files,
    api: {
      pluginData: {
        async read(
          _scope: 'global' | 'conversation',
          relPath: string,
          _cid?: string,
        ) {
          return files.get(relPath) ?? null
        },
        async write(
          _scope: 'global' | 'conversation',
          relPath: string,
          content: string,
          _cid?: string,
        ) {
          files.set(relPath, content)
        },
        async delete(
          _scope: 'global' | 'conversation',
          relPath: string,
          _cid?: string,
        ) {
          files.delete(relPath)
        },
      },
      async getUserPluginSettings() {
        return {}
      },
      async getConversationPluginSettings() {
        return { trackerEpoch: 0 }
      },
      async getConversationAgentMode() {
        return opts?.agentMode ?? 'on'
      },
      async readConversationTurnsTail() {
        return opts?.turns ?? []
      },
    },
  }
}

describe('trace tools', () => {
  it('rejects when agent mode off', async () => {
    const { api } = createMemoryApi({ agentMode: 'off' })
    const r = await runTraceInitTool(api, 'abcd1234', '{}')
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'tool_mode_required')
  })

  it('init then patch replace/add/remove', async () => {
    const { api, files } = createMemoryApi()
    const init = await runTraceInitTool(api, 'abcd1234', '{}')
    assert.equal(init.ok, true)
    assert.ok(files.has(LIVE_STATE_FILE))

    const again = await runTraceInitTool(api, 'abcd1234', '{}')
    assert.equal(again.ok, false)
    if (!again.ok) assert.equal(again.code, 'already_initialized')

    const patch = await runTracePatchTool(
      api,
      'abcd1234',
      JSON.stringify({
        ops: [
          { op: 'replace', path: '/mood', value: '紧张' },
          { op: 'add', path: '/flags', value: { a: 1 } },
          { op: 'remove', path: '/notes' },
        ],
      }),
    )
    assert.equal(patch.ok, true)
    if (!patch.ok) return
    const body = JSON.parse(patch.content) as {
      state: Record<string, unknown>
    }
    assert.equal(body.state.mood, '紧张')
    assert.deepEqual(body.state.flags, { a: 1 })
    assert.equal('notes' in body.state, false)
    assert.equal(
      (body.state.scene as { location?: string })?.location,
      '未知地点',
    )
  })

})

describe('agentRunId live staging isolation', () => {
  it('reseats live from prior turn when agentRunId changes', async () => {
    const { api, files } = createMemoryApi({
      turns: [
        {
          turnOrdinal: 10,
          activeSegmentIndex: 0,
          segments: [
            {
              activeReceiveIndex: 0,
              receives: [{ id: 'r10', content: 'x' }],
            },
          ],
          plugins: [
            {
              pluginId: 'trace-keeper',
              schemaVersion: 1,
              payload: {
                epoch: 0,
                receiveId: 'r10',
                state: { mood: '基线', notes: 'from-turn-10' },
              },
            },
          ],
        },
      ],
    })
    // 上一滑动留下的 live
    files.set(
      LIVE_STATE_FILE,
      JSON.stringify({
        epoch: 0,
        agentRunId: 'run-old',
        updatedAt: new Date().toISOString(),
        state: { mood: '旧滑动', notes: 'stale' },
      }),
    )
    const patch = await runTracePatchTool(
      api,
      'abcd1234',
      JSON.stringify({
        ops: [{ op: 'replace', path: '/mood', value: '新滑动' }],
      }),
      {
        agentRunId: 'run-new',
        baselineTurnOrdinalExclusive: 11,
      },
    )
    assert.equal(patch.ok, true)
    if (!patch.ok) return
    const body = JSON.parse(patch.content) as {
      baselineSource: string
      state: { mood: string; notes: string }
    }
    // 基线应来自 turn 10，而非旧滑动 live
    assert.equal(body.baselineSource, 'live')
    assert.equal(body.state.mood, '新滑动')
    assert.equal(body.state.notes, 'from-turn-10')
    const live = JSON.parse(files.get(LIVE_STATE_FILE)!) as {
      agentRunId: string
      state: { notes: string }
    }
    assert.equal(live.agentRunId, 'run-new')
    assert.equal(live.state.notes, 'from-turn-10')
  })
})

describe('resolveTurnPluginEntriesFromAssistant tool mode', () => {
  it('skips live persist when agentCalledToolNames has no write tools', async () => {
    const { api } = createMemoryApi()
    const init = await runTraceInitTool(api, 'abcd1234', '{}')
    assert.equal(init.ok, true)
    const entries = await resolveTurnPluginEntriesFromAssistant(
      {
        assistantContent: 'hello',
        conversationId: 'abcd1234',
        agentCalledToolNames: ['lore_search', 'trace_read'],
      },
      api,
    )
    assert.deepEqual(entries, [])
  })

  it('persists live when agentCalledToolNames includes trace_patch', async () => {
    const { api } = createMemoryApi()
    const init = await runTraceInitTool(api, 'abcd1234', '{}')
    assert.equal(init.ok, true)
    await runTracePatchTool(
      api,
      'abcd1234',
      JSON.stringify({
        ops: [{ op: 'replace', path: '/mood', value: '警觉' }],
      }),
    )
    const entries = await resolveTurnPluginEntriesFromAssistant(
      {
        assistantContent: 'hello',
        conversationId: 'abcd1234',
        agentCalledToolNames: ['trace_patch'],
      },
      api,
    )
    assert.equal(entries.length, 1)
    assert.equal(
      (entries[0]?.payload as { state?: { mood?: string } })?.state?.mood,
      '警觉',
    )
  })

  it('skips on receiveContentSync so swipe PATCH cannot blast live onto every receive', async () => {
    const { api } = createMemoryApi()
    const init = await runTraceInitTool(api, 'abcd1234', '{}')
    assert.equal(init.ok, true)
    await runTracePatchTool(
      api,
      'abcd1234',
      JSON.stringify({
        ops: [{ op: 'replace', path: '/mood', value: '仅live' }],
      }),
    )
    const skipped = await resolveTurnPluginEntriesFromAssistant(
      {
        assistantContent: 'hello',
        conversationId: 'abcd1234',
        receiveContentSync: true,
      },
      api,
    )
    assert.equal(skipped, null)
  })
})

describe('trace_patch from turn baseline', () => {
  it('uses latest turn snapshot when live empty', async () => {
    const { api, files } = createMemoryApi({
      turns: [
        {
          turnOrdinal: 2,
          activeSegmentIndex: 0,
          segments: [
            {
              activeReceiveIndex: 0,
              receives: [{ id: 'r2', content: 'x' }],
            },
          ],
          plugins: [
            {
              pluginId: 'trace-keeper',
              schemaVersion: 1,
              payload: {
                epoch: 0,
                receiveId: 'r2',
                state: { mood: '平静', notes: '' },
              },
            },
          ],
        },
      ],
    })
    const patch = await runTracePatchTool(
      api,
      'abcd1234',
      JSON.stringify({
        ops: [{ op: 'replace', path: '/mood', value: '怒' }],
      }),
    )
    assert.equal(patch.ok, true)
    if (!patch.ok) return
    const body = JSON.parse(patch.content) as {
      baselineSource: string
      state: { mood: string }
    }
    assert.equal(body.baselineSource, 'turn')
    assert.equal(body.state.mood, '怒')
    assert.ok(files.has(LIVE_STATE_FILE))

    const read = await runTraceReadTool(api, 'abcd1234', '{"turns":4}')
    assert.equal(read.ok, true)
    if (!read.ok) return
    const readBody = JSON.parse(read.content) as {
      snapshots: unknown[]
      live: { state: { mood: string } } | null
    }
    assert.equal(readBody.snapshots.length, 1)
    assert.equal(readBody.live?.state.mood, '怒')
  })
})
