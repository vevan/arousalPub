import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createAgentGraphRuntime } from '../src/agent/agent-graph-runtime.js'
import {
  needsAgentGraphRuntime,
  validateAgentGraph,
} from '../src/agent/agent-graph.js'
import type { AgentToolDefinition } from '../src/agent/types.js'

const loreDef: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'lore_search',
    description: 'lore',
    parameters: { type: 'object', properties: {} },
  },
}

const patchDef: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'trace_patch',
    description: 'patch',
    parameters: { type: 'object', properties: {} },
  },
}

const initDef: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'trace_init',
    description: 'init',
    parameters: { type: 'object', properties: {} },
  },
}

describe('agent graph runtime G5', () => {
  it('needsAgentGraphRuntime when reachable node/branch', () => {
    const steps = [
      { kind: 'start' as const },
      {
        kind: 'node' as const,
        id: 'ex',
        type: 'fixture-plugin.exists',
        pluginId: 'fixture-plugin',
      },
      {
        kind: 'branch' as const,
        id: 'br',
        predicate: { type: 'prev_node_ok' as const, ok: true },
      },
      { kind: 'prose' as const },
      { kind: 'end' as const },
    ]
    const edges = [
      { id: 'e1', source: 'start', target: 'node:ex' },
      { id: 'e2', source: 'node:ex', target: 'branch:br' },
      {
        id: 'e3',
        source: 'branch:br',
        target: 'prose',
        sourceHandle: 'then',
      },
      {
        id: 'e4',
        source: 'branch:br',
        target: 'prose',
        sourceHandle: 'else',
      },
      { id: 'e5', source: 'prose', target: 'end' },
    ]
    validateAgentGraph(steps, edges, new Map())
    assert.equal(needsAgentGraphRuntime(steps, edges), true)
  })

  it('settles node then branches then/else by outputs.ok', async () => {
    let nodeOk = true
    const steps = [
      { kind: 'start' as const },
      {
        kind: 'node' as const,
        id: 'ex',
        type: 'fixture-plugin.exists',
        pluginId: 'fixture-plugin',
      },
      {
        kind: 'branch' as const,
        id: 'br',
        predicate: { type: 'prev_node_ok' as const, ok: true },
      },
      {
        kind: 'tool' as const,
        toolName: 'trace_patch',
        required: true,
        maxCalls: 1 as const,
      },
      {
        kind: 'tool' as const,
        toolName: 'trace_init',
        required: true,
        maxCalls: 1 as const,
      },
      { kind: 'prose' as const },
      { kind: 'end' as const },
    ]
    const edges = [
      { id: 'e1', source: 'start', target: 'node:ex' },
      { id: 'e2', source: 'node:ex', target: 'branch:br' },
      {
        id: 'e3',
        source: 'branch:br',
        target: 'tool:trace_patch',
        sourceHandle: 'then',
      },
      {
        id: 'e4',
        source: 'branch:br',
        target: 'tool:trace_init',
        sourceHandle: 'else',
      },
      { id: 'e5', source: 'tool:trace_patch', target: 'prose' },
      { id: 'e6', source: 'tool:trace_init', target: 'prose' },
      { id: 'e7', source: 'prose', target: 'end' },
    ]

    const mk = () =>
      createAgentGraphRuntime({
        steps,
        edges,
        toolDefinitions: [patchDef, initDef],
        toolMeta: [
          {
            name: 'trace_patch',
            phase: 'write',
            maxCallsPerTurn: 1,
          },
          {
            name: 'trace_init',
            phase: 'write',
            maxCallsPerTurn: 1,
          },
        ],
        runNode: async () => ({
          ok: true as const,
          outputs: { ok: nodeOk },
        }),
      })

    nodeOk = true
    const rtThen = mk()
    await rtThen.settlePending()
    assert.deepEqual(
      rtThen.offerToolDefinitions()?.map((d) => d.function.name),
      ['trace_patch'],
    )

    nodeOk = false
    const rtElse = mk()
    await rtElse.settlePending()
    assert.deepEqual(
      rtElse.offerToolDefinitions()?.map((d) => d.function.name),
      ['trace_init'],
    )
  })

  it('after prose settle reports pending write for loop continue', async () => {
    const steps = [
      { kind: 'start' as const },
      { kind: 'prose' as const },
      {
        kind: 'node' as const,
        id: 'ex2',
        type: 'fixture-plugin.exists',
        pluginId: 'fixture-plugin',
      },
      {
        kind: 'branch' as const,
        id: 'br2',
        predicate: { type: 'prev_node_ok' as const, ok: true },
      },
      {
        kind: 'tool' as const,
        toolName: 'trace_patch',
        required: false,
        maxCalls: 'unlimited' as const,
      },
      {
        kind: 'tool' as const,
        toolName: 'trace_init',
        required: false,
        maxCalls: 1 as const,
      },
      { kind: 'end' as const },
    ]
    const edges = [
      { id: 'e1', source: 'start', target: 'prose' },
      { id: 'e2', source: 'prose', target: 'node:ex2' },
      { id: 'e3', source: 'node:ex2', target: 'branch:br2' },
      {
        id: 'e4',
        source: 'branch:br2',
        target: 'tool:trace_patch',
        sourceHandle: 'then',
      },
      {
        id: 'e5',
        source: 'branch:br2',
        target: 'tool:trace_init',
        sourceHandle: 'else',
      },
      { id: 'e6', source: 'tool:trace_patch', target: 'end' },
      { id: 'e7', source: 'tool:trace_init', target: 'end' },
    ]
    const rt = createAgentGraphRuntime({
      steps,
      edges,
      toolDefinitions: [patchDef, initDef],
      toolMeta: [
        {
          name: 'trace_patch',
          phase: 'write',
          maxCallsPerTurn: Number.POSITIVE_INFINITY,
        },
        { name: 'trace_init', phase: 'write', maxCallsPerTurn: 1 },
      ],
      runNode: async () => ({
        ok: true as const,
        outputs: { ok: true },
      }),
    })
    await rt.settlePending()
    assert.equal(rt.currentStage().kind, 'prose')
    assert.deepEqual(rt.missingPostProseRequired(), [])
    rt.onProseCommitted()
    await rt.settlePending()
    assert.deepEqual(rt.missingPostProseRequired(), ['trace_patch'])
    assert.deepEqual(
      rt.offerToolDefinitions()?.map((d) => d.function.name),
      ['trace_patch'],
    )
    rt.onToolSuccess('trace_patch')
    await rt.settlePending()
    assert.deepEqual(rt.missingPostProseRequired(), [])
    assert.equal(rt.currentStage().id, 'end')
  })

  it('advances tool → prose after success', async () => {
    const steps = [
      { kind: 'start' as const },
      {
        kind: 'tool' as const,
        toolName: 'lore_search',
        required: true,
        maxCalls: 1 as const,
      },
      { kind: 'prose' as const },
      { kind: 'end' as const },
    ]
    const edges = [
      { id: 'e1', source: 'start', target: 'tool:lore_search' },
      { id: 'e2', source: 'tool:lore_search', target: 'prose' },
      { id: 'e3', source: 'prose', target: 'end' },
    ]
    const rt = createAgentGraphRuntime({
      steps,
      edges,
      toolDefinitions: [loreDef],
      toolMeta: [
        { name: 'lore_search', phase: 'read', maxCallsPerTurn: 1 },
      ],
      runNode: async () => ({ ok: false, code: 'unused' }),
    })
    await rt.settlePending()
    assert.equal(rt.currentStage().kind, 'tool')
    assert.equal(rt.assertCallAllowed('lore_search').ok, true)
    rt.onToolSuccess('lore_search')
    await rt.settlePending()
    assert.equal(rt.currentStage().kind, 'prose')
    rt.onProseCommitted()
    await rt.settlePending()
    assert.equal(rt.currentStage().id, 'end')
  })
})
