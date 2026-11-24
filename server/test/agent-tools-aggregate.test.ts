import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CORE_KNOWLEDGE_SEARCH_TOOL,
  CORE_LORE_SEARCH_TOOL,
  CORE_MEMORY_SEARCH_TOOL,
  isCoreAgentToolName,
  listCoreAgentToolDefinitions,
} from '../src/agent/host-search-tools.js'
import { normalizeAgentMode } from '../src/agent/agent-mode.js'

describe('core agent tools', () => {
  it('exposes lore_search, memory_search and knowledge_search', () => {
    const defs = listCoreAgentToolDefinitions()
    const names = defs.map((d) => d.function.name).sort()
    assert.deepEqual(names, [
      CORE_KNOWLEDGE_SEARCH_TOOL,
      CORE_LORE_SEARCH_TOOL,
      CORE_MEMORY_SEARCH_TOOL,
    ].sort())
    assert.equal(isCoreAgentToolName('lore_search'), true)
    assert.equal(isCoreAgentToolName('memory_search'), true)
    assert.equal(isCoreAgentToolName('notes_list'), false)
  })
})

describe('agent mode normalize', () => {
  it('accepts on/off', () => {
    assert.equal(normalizeAgentMode('on'), 'on')
    assert.equal(normalizeAgentMode('off'), 'off')
  })
})
