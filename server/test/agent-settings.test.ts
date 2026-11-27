import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseAgentSettingsDocument,
  sanitizeAgentPipelineSteps,
  validateAgentPipelineSteps,
} from '../src/agent/agent-settings-file.js'
import { compileAgentPipelinePolicyFromSteps } from '../src/agent/agent-settings-compile.js'
import {
  resolveEffectiveAgentMode,
  buildPolicyFromEffectiveSteps,
} from '../src/agent/agent-effective.js'
import { seedMinimalAgentGraph } from '../src/agent/agent-graph.js'

function withToolOnPath(
  toolName: string,
  opts?: { required?: boolean; maxCalls?: number | 'unlimited' | null },
) {
  const seed = seedMinimalAgentGraph()
  return {
    steps: [
      { kind: 'start' as const },
      {
        kind: 'tool' as const,
        toolName,
        required: opts?.required ?? true,
        maxCalls: opts?.maxCalls ?? 1,
      },
      { kind: 'prose' as const },
      { kind: 'end' as const },
    ],
    edges: [
      { id: 'e1', source: 'start', target: `tool:${toolName}` },
      { id: 'e2', source: `tool:${toolName}`, target: 'prose' },
      { id: 'e3', source: 'prose', target: 'end' },
    ],
    positions: seed.positions,
  }
}

describe('agent-settings parse/validate', () => {
  it('accepts empty steps', () => {
    const doc = parseAgentSettingsDocument({
      schemaVersion: 1,
      agentMode: 'on',
      steps: [],
    })
    assert.equal(doc.agentMode, 'on')
    assert.equal(doc.steps.length, 0)
  })

  it('accepts minimal start→prose→end', () => {
    const seed = seedMinimalAgentGraph()
    validateAgentPipelineSteps(seed.steps, new Map(), seed.edges)
  })

  it('allows orphan tools not on the main path', () => {
    const seed = seedMinimalAgentGraph()
    const phase = new Map([
      ['lore_search', 'read' as const],
      ['trace_patch', 'write' as const],
    ])
    validateAgentPipelineSteps(
      [
        ...seed.steps,
        { kind: 'tool', toolName: 'lore_search', required: true },
        { kind: 'tool', toolName: 'trace_patch', required: true },
      ],
      phase,
      seed.edges,
    )
  })

  it('allows unknown tool as orphan but rejects unknown on main path', () => {
    const seed = seedMinimalAgentGraph()
    const phase = new Map([['lore_search', 'read' as const]])
    validateAgentPipelineSteps(
      [...seed.steps, { kind: 'tool', toolName: 'gone_plugin_tool' }],
      phase,
      seed.edges,
    )
    assert.throws(
      () =>
        validateAgentPipelineSteps(
          [
            { kind: 'start' },
            { kind: 'tool', toolName: 'gone_plugin_tool' },
            { kind: 'prose' },
            { kind: 'end' },
          ],
          phase,
          [
            { id: 'e1', source: 'start', target: 'tool:gone_plugin_tool' },
            { id: 'e2', source: 'tool:gone_plugin_tool', target: 'prose' },
            { id: 'e3', source: 'prose', target: 'end' },
          ],
        ),
      /unknown_tool:gone_plugin_tool/,
    )
  })

  it('rejects multi-out branch on main path', () => {
    assert.throws(
      () =>
        validateAgentPipelineSteps(
          [
            { kind: 'start' },
            {
              kind: 'branch',
              id: 'br1',
              predicate: { type: 'prev_node_ok', ok: true },
            },
            { kind: 'prose' },
            { kind: 'end' },
          ],
          new Map(),
          [
            { id: 'e1', source: 'start', target: 'branch:br1' },
            {
              id: 'e2',
              source: 'branch:br1',
              target: 'prose',
              sourceHandle: 'then',
            },
            {
              id: 'e3',
              source: 'branch:br1',
              target: 'end',
              sourceHandle: 'else',
            },
          ],
        ),
      /branch_execution_not_ready/,
    )
  })

  it('rejects graph without start/end skeleton', () => {
    assert.throws(
      () =>
        validateAgentPipelineSteps(
          [{ kind: 'prose' }],
          new Map(),
          [],
        ),
      /graph_skeleton_required/,
    )
  })

  it('compiles main path tool→prose and skips orphans', () => {
    const seed = seedMinimalAgentGraph()
    const policy = compileAgentPipelinePolicyFromSteps(
      [
        ...seed.steps,
        { kind: 'tool', toolName: 'lore_search', required: true, maxCalls: 1 },
        {
          kind: 'tool',
          toolName: 'trace_patch',
          required: true,
          maxCalls: 'unlimited',
        },
      ],
      [
        { name: 'lore_search', phase: 'read', maxCallsPerTurn: 1 },
        {
          name: 'trace_patch',
          phase: 'write',
          maxCallsPerTurn: Number.POSITIVE_INFINITY,
        },
      ],
      [
        { id: 'e1', source: 'start', target: 'tool:lore_search' },
        { id: 'e2', source: 'tool:lore_search', target: 'prose' },
        { id: 'e3', source: 'prose', target: 'end' },
      ],
    )
    assert.deepEqual(
      policy.stages.map((s) => s.id),
      ['tool:lore_search', 'prose'],
    )
  })

  it('skips branch/node on path only when not forked (linear through them drops non-runnable)', () => {
    const g = withToolOnPath('lore_search')
    // insert node between start and tool via edges: start→node→tool→prose→end
    const steps = [
      { kind: 'start' as const },
      {
        kind: 'node' as const,
        id: 'nd1',
        type: 'fixture-plugin.exists',
        pluginId: 'fixture-plugin',
      },
      { kind: 'tool' as const, toolName: 'lore_search', required: true, maxCalls: 1 },
      { kind: 'prose' as const },
      { kind: 'end' as const },
    ]
    const edges = [
      { id: 'e1', source: 'start', target: 'node:nd1' },
      { id: 'e2', source: 'node:nd1', target: 'tool:lore_search' },
      { id: 'e3', source: 'tool:lore_search', target: 'prose' },
      { id: 'e4', source: 'prose', target: 'end' },
    ]
    const policy = compileAgentPipelinePolicyFromSteps(
      steps,
      [{ name: 'lore_search', phase: 'read', maxCallsPerTurn: 1 }],
      edges,
    )
    assert.deepEqual(
      policy.stages.map((s) => s.id),
      ['tool:lore_search', 'prose'],
    )
    void g
  })

  it('parses start/end and plugin node steps', () => {
    const seed = seedMinimalAgentGraph()
    const doc = parseAgentSettingsDocument({
      schemaVersion: 1,
      agentMode: 'on',
      steps: [
        ...seed.steps,
        {
          kind: 'node',
          id: 'nd1',
          type: 'fixture-plugin.exists',
          pluginId: 'fixture-plugin',
          title: 'Exists?',
        },
      ],
      edges: seed.edges,
    })
    assert.equal(doc.steps.some((s) => s.kind === 'start'), true)
    assert.equal(doc.steps.some((s) => s.kind === 'end'), true)
    assert.equal(doc.steps.some((s) => s.kind === 'node'), true)
  })

  it('allows multiple plugin nodes of the same type as orphans', () => {
    const seed = seedMinimalAgentGraph()
    const doc = parseAgentSettingsDocument(
      {
        schemaVersion: 1,
        agentMode: 'on',
        steps: [
          ...seed.steps,
          {
            kind: 'node',
            id: 'nd_a',
            type: 'fixture-plugin.exists',
            pluginId: 'fixture-plugin',
          },
          {
            kind: 'node',
            id: 'nd_b',
            type: 'fixture-plugin.exists',
            pluginId: 'fixture-plugin',
          },
        ],
        edges: seed.edges,
        positions: {
          ...seed.positions,
          'node:nd_a': { x: 10, y: 20 },
          'node:nd_b': { x: 40, y: 80 },
        },
      },
      { phaseByTool: new Map() },
    )
    assert.equal(doc.steps.filter((s) => s.kind === 'node').length, 2)
  })

  it('compiles write-before-prose on main path', () => {
    const steps = [
      { kind: 'start' as const },
      {
        kind: 'tool' as const,
        toolName: 'trace_init',
        required: false,
        maxCalls: 1 as const,
      },
      { kind: 'prose' as const },
      {
        kind: 'tool' as const,
        toolName: 'trace_patch',
        required: true,
        maxCalls: 'unlimited' as const,
      },
      { kind: 'end' as const },
    ]
    const edges = [
      { id: 'e1', source: 'start', target: 'tool:trace_init' },
      { id: 'e2', source: 'tool:trace_init', target: 'prose' },
      { id: 'e3', source: 'prose', target: 'tool:trace_patch' },
      { id: 'e4', source: 'tool:trace_patch', target: 'end' },
    ]
    const policy = compileAgentPipelinePolicyFromSteps(
      steps,
      [
        { name: 'trace_init', phase: 'write', maxCallsPerTurn: 1 },
        {
          name: 'trace_patch',
          phase: 'write',
          maxCallsPerTurn: Number.POSITIVE_INFINITY,
        },
      ],
      edges,
    )
    assert.equal(policy.stages[0]?.id, 'write:trace_init')
    assert.equal(policy.stages[0]?.advanceWhen, 'offer_exhausted')
    assert.match(policy.stages[0]!.instruction, /if applicable/i)
    assert.equal(policy.stages[1]?.id, 'prose')
    assert.equal(policy.stages[2]?.advanceWhen, 'required_writes_done')
  })
})

describe('effective agent mode', () => {
  it('session override wins', () => {
    const r = resolveEffectiveAgentMode({ agentMode: 'on' }, 'off')
    assert.deepEqual(r, { mode: 'on', source: 'session' })
  })

  it('inherits global when no session field', () => {
    const r = resolveEffectiveAgentMode({}, 'on')
    assert.deepEqual(r, { mode: 'on', source: 'global' })
  })

  it('empty steps compile to minimal seed (prose only)', () => {
    const policy = buildPolicyFromEffectiveSteps(
      [],
      [{ name: 'lore_search', phase: 'read', maxCallsPerTurn: 1 }],
    )
    assert.deepEqual(
      policy.stages.map((s) => s.id),
      ['prose'],
    )
  })

  it('sanitize invalid legacy steps to empty', () => {
    const out = sanitizeAgentPipelineSteps([{ kind: 'prose' }], new Map())
    assert.deepEqual(out, [])
  })

  it('null maxCalls compiles to tool default not infinity', () => {
    const g = withToolOnPath('lore_search', { maxCalls: null })
    const policy = compileAgentPipelinePolicyFromSteps(
      g.steps,
      [{ name: 'lore_search', phase: 'read', maxCallsPerTurn: 1 }],
      g.edges,
    )
    assert.equal(policy.stages[0]?.offer[0]?.maxCalls, 1)
  })
})
