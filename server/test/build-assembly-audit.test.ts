import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAssemblyAudit } from '../src/build-assembly-audit.js'
import type { PluginAssembleAdditionCache } from '../src/plugin-host.js'
import type { MemoryPipelineResult } from '../src/memory-pipeline.js'

describe('buildAssemblyAudit', () => {
  it('marks trimmed memory and lore as not included', () => {
    const memoryPipeline = {
      recentHistoryMessages: [],
      recentHistoryTurnOrdinals: [1, 2],
      recentHistoryScanText: '',
      memoryItems: [
        {
          turn: {
            turnId: 'a1',
            turnOrdinal: 3,
            send: { userText: 'x' },
            receives: [],
            activeReceiveIndex: 0,
            plugins: [],
          },
          score: 0.9,
        },
      ],
      memoryText: '',
      memoryTurnIds: ['a1'],
      memoryHits: [{ turnId: 'a1', turnOrdinal: 3, branchPath: '', chunkFileName: 'c.json', score: 0.9 }],
    } satisfies MemoryPipelineResult

    const audit = buildAssemblyAudit({
      estimatedTokens: 100,
      lorebookIds: ['lb1'],
      lorebookNameToId: new Map([['Book', 'lb1']]),
      knowledgeBaseIds: ['kb1'],
      knowledgeEnabled: true,
      initialKnowledgeItems: [
        {
          kbId: 'kb1',
          kbName: 'KB',
          fileId: 'f1',
          fileName: 'doc.txt',
          chunkId: 'c1',
          ordinal: 0,
          text: 'chunk',
          score: 0.5,
        },
      ],
      droppedKnowledgeCount: 1,
      memoryPipeline,
      loreParts: { constantLore: [], matchedLore: [] },
      initialMatchedLore: [
        {
          lorebookId: 'lb1',
          lorebookName: 'Book',
          entry: {
            id: 'e1',
            groupId: 'g1',
            title: 'T',
            content: 'c',
            enabled: true,
            order: 0,
            keys: [],
            constant: false,
            triggerMode: 'keyword',
            priority: 1,
            createdAt: '',
            updatedAt: '',
          },
          mode: 'keyword',
          score: 1,
        },
      ],
      initialMemoryItems: memoryPipeline.memoryItems,
      trimState: {
        constantLore: [],
        matchedLore: [],
        memoryItems: [],
        knowledgeItems: [],
        historyMessages: [],
      },
      droppedLoreCount: 1,
      droppedMemoryCount: 1,
      droppedHistoryCount: 0,
      memoryEnabled: true,
    })

    assert.equal(audit.memory.hits[0]?.included, false)
    assert.equal(audit.lore.matched[0]?.included, false)
    assert.equal(audit.knowledge?.hits[0]?.included, false)
    assert.equal(audit.memory.droppedCount, 1)
    assert.equal(audit.lore.droppedCount, 1)
    assert.equal(audit.knowledge?.droppedCount, 1)
  })

  it('includes plugin token reserve from additionCache', () => {
    const cache: PluginAssembleAdditionCache = new Map([
      [
        'fixture-plugin-a',
        {
          kind: 'injections',
          injections: [
            {
              role: 'system',
              content: 'guide text',
              position: { kind: 'chat', depth: 0, injectionOrder: 10 },
            },
          ],
        },
      ],
    ])

    const audit = buildAssemblyAudit({
      estimatedTokens: 10,
      lorebookIds: [],
      lorebookNameToId: new Map(),
      knowledgeBaseIds: [],
      knowledgeEnabled: true,
      initialKnowledgeItems: [],
      droppedKnowledgeCount: 0,
      memoryPipeline: {
        recentHistoryMessages: [],
        recentHistoryTurnOrdinals: [],
        recentHistoryScanText: '',
        memoryItems: [],
        memoryText: '',
        memoryTurnIds: [],
        memoryHits: [],
      },
      loreParts: { constantLore: [], matchedLore: [] },
      initialMatchedLore: [],
      initialMemoryItems: [],
      trimState: {
        constantLore: [],
        matchedLore: [],
        memoryItems: [],
        knowledgeItems: [],
        historyMessages: [],
      },
      droppedLoreCount: 0,
      droppedMemoryCount: 0,
      droppedHistoryCount: 0,
      memoryEnabled: false,
      pluginAdditionCache: cache,
    })

    assert.ok(audit.plugins)
    assert.equal(audit.plugins!.items.length, 1)
    assert.equal(audit.plugins!.items[0]!.pluginId, 'fixture-plugin-a')
    assert.ok(audit.plugins!.tokenReserve > 0)
  })
})
