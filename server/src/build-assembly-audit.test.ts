import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAssemblyAudit } from './build-assembly-audit.js'
import type { MemoryPipelineResult } from './memory-pipeline.js'

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
      memoryPipeline,
      loreParts: { constantLoreGroups: [], matchedLore: [] },
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
        constantLoreGroups: [],
        matchedLore: [],
        memoryItems: [],
        historyMessages: [],
      },
      droppedLoreCount: 1,
      droppedMemoryCount: 1,
      droppedHistoryCount: 0,
      memoryEnabled: true,
    })

    assert.equal(audit.memory.hits[0]?.included, false)
    assert.equal(audit.lore.matched[0]?.included, false)
    assert.equal(audit.memory.droppedCount, 1)
    assert.equal(audit.lore.droppedCount, 1)
  })
})
