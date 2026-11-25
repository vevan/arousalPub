import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDefaultAgentPipelinePolicy,
  effectiveMaxCallsForRule,
  policyPreProseRequiredToolNames,
  policyWriteToolNames,
  stageRequiredToolNames,
} from '../src/agent/agent-pipeline-policy.js'
import { createAgentPipelineRuntime } from '../src/agent/agent-pipeline-runtime.js'
import type { AgentToolDefinition } from '../src/agent/types.js'

function def(name: string): AgentToolDefinition {
  return {
    type: 'function',
    function: { name, description: name, parameters: { type: 'object' } },
  }
}

describe('buildDefaultAgentPipelinePolicy', () => {
  it('builds one stage per tool then prose then write', () => {
    const policy = buildDefaultAgentPipelinePolicy({
      tools: [
        { name: 'lore_search', phase: 'read', maxCallsPerTurn: 1 },
        { name: 'memory_search', phase: 'read', maxCallsPerTurn: 1 },
        { name: 'trace_read', phase: 'read', maxCallsPerTurn: 1 },
        {
          name: 'trace_patch',
          phase: 'write',
          maxCallsPerTurn: Number.POSITIVE_INFINITY,
        },
      ],
      requiredSearchToolNames: ['lore_search', 'memory_search'],
    })
    assert.equal(policy.schemaVersion, 1)
    assert.equal(policy.stages.length, 5)
    assert.equal(policy.stages[0]?.id, 'tool:lore_search')
    assert.equal(policy.stages[0]?.step, 1)
    assert.equal(policy.stages[0]?.advanceWhen, 'required_tools_done')
    assert.equal(policy.stages[0]?.toolChoice, 'required')
    assert.match(policy.stages[0]!.instruction, /step 1\/5/i)
    assert.deepEqual(stageRequiredToolNames(policy.stages[0]!), ['lore_search'])
    assert.equal(policy.stages[1]?.id, 'tool:memory_search')
    assert.equal(policy.stages[2]?.id, 'tool:trace_read')
    assert.equal(policy.stages[2]?.advanceWhen, 'offer_exhausted')
    assert.equal(policy.stages[3]?.id, 'prose')
    assert.equal(policy.stages[3]?.toolChoice, 'none')
    assert.equal(policy.stages[4]?.id, 'write:trace_patch')
    assert.equal(policy.stages[4]?.advanceWhen, 'required_writes_done')
    assert.deepEqual(policyPreProseRequiredToolNames(policy), [
      'lore_search',
      'memory_search',
    ])
    assert.deepEqual(policyWriteToolNames(policy), ['trace_patch'])
  })

  it('without required search still has read step then prose', () => {
    const policy = buildDefaultAgentPipelinePolicy({
      tools: [{ name: 'trace_read', phase: 'read', maxCallsPerTurn: 1 }],
      requiredSearchToolNames: [],
    })
    assert.equal(policy.stages[0]?.id, 'tool:trace_read')
    assert.equal(policy.stages[0]?.advanceWhen, 'offer_exhausted')
    assert.equal(policy.stages[1]?.id, 'prose')
  })
})

describe('createAgentPipelineRuntime', () => {
  const tools = [
    def('lore_search'),
    def('memory_search'),
    def('trace_read'),
    def('trace_patch'),
  ]
  const policy = buildDefaultAgentPipelinePolicy({
    tools: [
      { name: 'lore_search', phase: 'read', maxCallsPerTurn: 1 },
      { name: 'memory_search', phase: 'read', maxCallsPerTurn: 1 },
      { name: 'trace_read', phase: 'read', maxCallsPerTurn: 1 },
      {
        name: 'trace_patch',
        phase: 'write',
        maxCallsPerTurn: Number.POSITIVE_INFINITY,
      },
    ],
    requiredSearchToolNames: ['lore_search', 'memory_search'],
  })

  it('step 1 only offers lore_search; rejects others', () => {
    const rt = createAgentPipelineRuntime({
      policy,
      toolDefinitions: tools,
    })
    assert.equal(rt.currentStage().id, 'tool:lore_search')
    assert.equal(rt.toolChoice(), 'required')
    const offered = rt.offerToolDefinitions()?.map((t) => t.function.name) ?? []
    assert.deepEqual(offered, ['lore_search'])
    assert.equal(rt.assertCallAllowed('memory_search').ok, false)
    assert.equal(rt.assertCallAllowed('trace_read').ok, false)
    assert.equal(rt.assertCallAllowed('trace_patch').ok, false)
    const instr = rt.consumeStageEnterInstruction()
    assert.match(String(instr), /lore_search/)
    assert.equal(rt.consumeStageEnterInstruction(), null)
  })

  it('advances one tool per success through required searches', () => {
    const rt = createAgentPipelineRuntime({
      policy,
      toolDefinitions: tools,
    })
    rt.onToolSuccess('lore_search')
    // 同一步内不推进；下一次 offer 才推进
    assert.equal(rt.currentStage().id, 'tool:lore_search')
    const offered = rt.offerToolDefinitions()?.map((t) => t.function.name) ?? []
    assert.deepEqual(offered, ['memory_search'])
    assert.equal(rt.currentStage().id, 'tool:memory_search')
    assert.match(String(rt.consumeStageEnterInstruction()), /memory_search/)
  })

  it('required failure does not advance and still offers the tool', () => {
    const rt = createAgentPipelineRuntime({
      policy,
      toolDefinitions: tools,
    })
    rt.onToolFailure('lore_search')
    rt.advanceIfReady()
    assert.equal(rt.currentStage().id, 'tool:lore_search')
    assert.equal(rt.toolChoice(), 'required')
    assert.equal(rt.assertCallAllowed('lore_search').ok, true)
    assert.deepEqual(rt.missingPreProseRequired(), [
      'lore_search',
      'memory_search',
    ])
  })

  it('same-step multi success does not unlock next-stage tools mid-batch', () => {
    const rt = createAgentPipelineRuntime({
      policy,
      toolDefinitions: tools,
    })
    assert.equal(rt.assertCallAllowed('lore_search').ok, true)
    rt.onToolSuccess('lore_search')
    // 尚未 offer/advance：仍在 lore 步，memory 仍拒
    assert.equal(rt.assertCallAllowed('memory_search').ok, false)
    assert.equal(rt.assertCallAllowed('trace_patch').ok, false)
    rt.advanceIfReady()
    assert.equal(rt.assertCallAllowed('memory_search').ok, true)
  })

  it('optional read uses offer_exhausted; failure advances on next offer', () => {
    const rt = createAgentPipelineRuntime({
      policy,
      toolDefinitions: tools,
    })
    rt.onToolSuccess('lore_search')
    rt.onToolSuccess('memory_search')
    rt.offerToolDefinitions()
    assert.equal(rt.currentStage().id, 'tool:trace_read')
    assert.equal(rt.toolChoice(), 'required')
    assert.equal(rt.assertCallAllowed('trace_read').ok, true)
    rt.onToolFailure('trace_read')
    assert.equal(rt.currentStage().id, 'tool:trace_read')
    const again = rt.assertCallAllowed('trace_read')
    assert.equal(again.ok, false)
    if (!again.ok) assert.equal(again.code, 'tool_call_limit')
    assert.equal(rt.offerToolDefinitions(), undefined)
    assert.equal(rt.currentStage().id, 'prose')
    assert.equal(rt.toolChoice(), 'none')
  })

  it('prose commit cannot skip pending tool steps', () => {
    const rt = createAgentPipelineRuntime({
      policy,
      toolDefinitions: tools,
    })
    rt.onToolSuccess('lore_search')
    rt.onToolSuccess('memory_search')
    rt.onProseCommitted()
    assert.equal(rt.currentStage().id, 'tool:trace_read')
    const offered = rt.offerToolDefinitions()?.map((t) => t.function.name) ?? []
    assert.deepEqual(offered, ['trace_read'])
  })

  it('after all reads and prose commit offers write step', () => {
    const rt = createAgentPipelineRuntime({
      policy,
      toolDefinitions: tools,
    })
    rt.onToolSuccess('lore_search')
    rt.onToolSuccess('memory_search')
    rt.onToolSuccess('trace_read')
    rt.offerToolDefinitions()
    assert.equal(rt.currentStage().id, 'prose')
    assert.equal(rt.toolChoice(), 'none')
    rt.onProseCommitted()
    assert.equal(rt.currentStage().id, 'write:trace_patch')
    const offered = rt.offerToolDefinitions()?.map((t) => t.function.name) ?? []
    assert.deepEqual(offered, ['trace_patch'])
    assert.equal(rt.toolChoice(), 'required')
    assert.match(String(rt.consumeStageEnterInstruction()), /trace_patch/)
  })

  it('infinite write maxCalls stays offerable after one success until advanced', () => {
    const rt = createAgentPipelineRuntime({
      policy,
      toolDefinitions: tools,
    })
    rt.onToolSuccess('lore_search')
    rt.onToolSuccess('memory_search')
    rt.onToolSuccess('trace_read')
    rt.offerToolDefinitions()
    rt.onProseCommitted()
    assert.equal(rt.currentStage().id, 'write:trace_patch')
    assert.equal(rt.assertCallAllowed('trace_patch').ok, true)
    rt.onToolSuccess('trace_patch')
    // 同阶段未 advance 前仍可再调（∞）
    assert.equal(rt.assertCallAllowed('trace_patch').ok, true)
    rt.advanceIfReady()
    // 末段 required_writes_done 已满足但仍停在最后一阶
    assert.equal(rt.currentStage().id, 'write:trace_patch')
  })

  it('effectiveMaxCallsForRule prefers stage maxCalls', () => {
    assert.equal(
      effectiveMaxCallsForRule(
        { toolName: 'x', maxCalls: 3 },
        new Map([['x', 1]]),
      ),
      3,
    )
  })
})
