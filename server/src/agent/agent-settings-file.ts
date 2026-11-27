/**
 * data/{userId}/agent-settings.json 读写（缺文件 → 内存默认，不静默补种）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { getUserDataDir } from '../config.js'
import { getCurrentUserId } from '../user-context.js'
import { normalizeAgentMode } from './agent-mode.js'
import type { PipelineAdvanceWhen, PipelineToolChoice } from './agent-pipeline-policy.js'
import { AgentSettingsValidationError } from './agent-settings-error.js'
import {
  AGENT_SETTINGS_SCHEMA_VERSION,
  emptyAgentSettingsDocument,
  type AgentBranchPredicate,
  type AgentFlowEdgeConfig,
  type AgentPipelineStepConfig,
  type AgentSettingsDocument,
} from './agent-settings-types.js'
import { validateAgentGraph } from './agent-graph.js'

export { AgentSettingsValidationError } from './agent-settings-error.js'

export function getAgentSettingsPath(userId?: string): string {
  const uid = userId ?? (() => {
    try {
      return getCurrentUserId()
    } catch {
      return ''
    }
  })()
  if (!uid) {
    throw new AgentSettingsValidationError('user_context_required')
  }
  return path.join(getUserDataDir(uid), 'agent-settings.json')
}

const ADVANCE_WHEN: ReadonlySet<string> = new Set([
  'required_tools_done',
  'offer_exhausted',
  'prose_committed',
  'required_writes_done',
])

const TOOL_CHOICE: ReadonlySet<string> = new Set(['auto', 'required', 'none'])

function parseMaxCalls(
  raw: unknown,
): number | 'unlimited' | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === 'unlimited') return raw === null ? null : 'unlimited'
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.round(raw)
    if (n < 1) {
      throw new AgentSettingsValidationError('max_calls_invalid')
    }
    return Math.min(32, n)
  }
  throw new AgentSettingsValidationError('max_calls_invalid')
}

function parseToolStep(raw: unknown, index: number): AgentPipelineStepConfig {
  if (!raw || typeof raw !== 'object') {
    throw new AgentSettingsValidationError(`step_${index}_invalid`)
  }
  const o = raw as Record<string, unknown>
  if (o.kind !== 'tool') {
    throw new AgentSettingsValidationError(`step_${index}_kind_invalid`)
  }
  const toolName = typeof o.toolName === 'string' ? o.toolName.trim() : ''
  if (!toolName) {
    throw new AgentSettingsValidationError(`step_${index}_tool_name_required`)
  }
  const step: AgentPipelineStepConfig = {
    kind: 'tool',
    toolName,
  }
  if (typeof o.required === 'boolean') step.required = o.required
  const maxCalls = parseMaxCalls(o.maxCalls)
  if (maxCalls !== undefined) step.maxCalls = maxCalls
  if (typeof o.instruction === 'string') {
    step.instruction = o.instruction.slice(0, 4000)
  }
  if (typeof o.title === 'string') {
    step.title = o.title.trim().slice(0, 120)
  }
  if (o.toolChoice !== undefined) {
    if (
      typeof o.toolChoice !== 'string' ||
      !TOOL_CHOICE.has(o.toolChoice)
    ) {
      throw new AgentSettingsValidationError(`step_${index}_tool_choice_invalid`)
    }
    step.toolChoice = o.toolChoice as PipelineToolChoice
  }
  if (o.advanceWhen !== undefined) {
    if (
      typeof o.advanceWhen !== 'string' ||
      !ADVANCE_WHEN.has(o.advanceWhen)
    ) {
      throw new AgentSettingsValidationError(`step_${index}_advance_when_invalid`)
    }
    step.advanceWhen = o.advanceWhen as PipelineAdvanceWhen
  }
  return step
}

function parseProseStep(raw: unknown, index: number): AgentPipelineStepConfig {
  if (!raw || typeof raw !== 'object') {
    throw new AgentSettingsValidationError(`step_${index}_invalid`)
  }
  const o = raw as Record<string, unknown>
  if (o.kind !== 'prose') {
    throw new AgentSettingsValidationError(`step_${index}_kind_invalid`)
  }
  const step: AgentPipelineStepConfig = { kind: 'prose' }
  if (typeof o.instruction === 'string') {
    step.instruction = o.instruction.slice(0, 4000)
  }
  return step
}

function parseStartStep(raw: unknown, index: number): AgentPipelineStepConfig {
  if (!raw || typeof raw !== 'object') {
    throw new AgentSettingsValidationError(`step_${index}_invalid`)
  }
  if ((raw as { kind?: unknown }).kind !== 'start') {
    throw new AgentSettingsValidationError(`step_${index}_kind_invalid`)
  }
  return { kind: 'start' }
}

function parseEndStep(raw: unknown, index: number): AgentPipelineStepConfig {
  if (!raw || typeof raw !== 'object') {
    throw new AgentSettingsValidationError(`step_${index}_invalid`)
  }
  if ((raw as { kind?: unknown }).kind !== 'end') {
    throw new AgentSettingsValidationError(`step_${index}_kind_invalid`)
  }
  return { kind: 'end' }
}

function parseBranchPredicate(
  raw: unknown,
  index: number,
): AgentBranchPredicate | undefined {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object') {
    throw new AgentSettingsValidationError(`step_${index}_predicate_invalid`)
  }
  const o = raw as Record<string, unknown>
  if (o.type === 'prev_tool_ok') {
    if (typeof o.ok !== 'boolean') {
      throw new AgentSettingsValidationError(`step_${index}_predicate_invalid`)
    }
    return { type: 'prev_tool_ok', ok: o.ok }
  }
  if (o.type === 'prev_node_ok') {
    if (typeof o.ok !== 'boolean') {
      throw new AgentSettingsValidationError(`step_${index}_predicate_invalid`)
    }
    return { type: 'prev_node_ok', ok: o.ok }
  }
  if (o.type === 'prev_tool_code') {
    if (typeof o.equals !== 'string') {
      throw new AgentSettingsValidationError(`step_${index}_predicate_invalid`)
    }
    return {
      type: 'prev_tool_code',
      equals: o.equals.trim().slice(0, 120),
    }
  }
  throw new AgentSettingsValidationError(`step_${index}_predicate_invalid`)
}

function parseBranchStep(raw: unknown, index: number): AgentPipelineStepConfig {
  if (!raw || typeof raw !== 'object') {
    throw new AgentSettingsValidationError(`step_${index}_invalid`)
  }
  const o = raw as Record<string, unknown>
  if (o.kind !== 'branch') {
    throw new AgentSettingsValidationError(`step_${index}_kind_invalid`)
  }
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (!id) {
    throw new AgentSettingsValidationError(`step_${index}_branch_id_required`)
  }
  const step: AgentPipelineStepConfig = { kind: 'branch', id }
  if (typeof o.title === 'string') {
    step.title = o.title.trim().slice(0, 120)
  }
  const predicate = parseBranchPredicate(o.predicate, index)
  if (predicate) step.predicate = predicate
  return step
}

const NODE_TYPE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

function parsePluginNodeStep(
  raw: unknown,
  index: number,
): AgentPipelineStepConfig {
  if (!raw || typeof raw !== 'object') {
    throw new AgentSettingsValidationError(`step_${index}_invalid`)
  }
  const o = raw as Record<string, unknown>
  if (o.kind !== 'node') {
    throw new AgentSettingsValidationError(`step_${index}_kind_invalid`)
  }
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const type = typeof o.type === 'string' ? o.type.trim() : ''
  const pluginId = typeof o.pluginId === 'string' ? o.pluginId.trim() : ''
  if (!id) {
    throw new AgentSettingsValidationError(`step_${index}_node_id_required`)
  }
  if (!type || !NODE_TYPE_RE.test(type)) {
    throw new AgentSettingsValidationError(`step_${index}_node_type_invalid`)
  }
  if (!pluginId || !PLUGIN_ID_RE.test(pluginId)) {
    throw new AgentSettingsValidationError(`step_${index}_plugin_id_invalid`)
  }
  const step: AgentPipelineStepConfig = { kind: 'node', id, type, pluginId }
  if (typeof o.title === 'string') {
    step.title = o.title.trim().slice(0, 120)
  }
  return step
}

function parseEdges(raw: unknown): AgentFlowEdgeConfig[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    throw new AgentSettingsValidationError('edges_invalid')
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new AgentSettingsValidationError(`edge_${i}_invalid`)
    }
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const source = typeof o.source === 'string' ? o.source.trim() : ''
    const target = typeof o.target === 'string' ? o.target.trim() : ''
    if (!id || !source || !target) {
      throw new AgentSettingsValidationError(`edge_${i}_invalid`)
    }
    const edge: AgentFlowEdgeConfig = { id, source, target }
    if (o.sourceHandle === null) edge.sourceHandle = null
    else if (typeof o.sourceHandle === 'string') {
      edge.sourceHandle = o.sourceHandle.slice(0, 64)
    }
    if (o.targetHandle === null) edge.targetHandle = null
    else if (typeof o.targetHandle === 'string') {
      edge.targetHandle = o.targetHandle.slice(0, 64)
    }
    return edge
  })
}

function parsePositions(
  raw: unknown,
): import('./agent-settings-types.js').AgentFlowPositions | undefined {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AgentSettingsValidationError('positions_invalid')
  }
  const out: import('./agent-settings-types.js').AgentFlowPositions = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const id = key.trim().slice(0, 128)
    if (!id || !val || typeof val !== 'object' || Array.isArray(val)) continue
    const x = (val as { x?: unknown }).x
    const y = (val as { y?: unknown }).y
    if (typeof x !== 'number' || !Number.isFinite(x)) continue
    if (typeof y !== 'number' || !Number.isFinite(y)) continue
    out[id] = { x, y }
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * 校验图：start/prose/end 骨架 + Start↝Prose↝End 主路径；允许无边孤儿。
 */
export function validateAgentPipelineSteps(
  steps: AgentPipelineStepConfig[],
  phaseByTool: ReadonlyMap<string, 'read' | 'write'>,
  edges?: AgentFlowEdgeConfig[],
): void {
  validateAgentGraph(steps, edges, phaseByTool)
}

/** 非法图（含旧线性无 start/end）→ 空，出站/预览改用最小种子 */
export function sanitizeAgentPipelineSteps(
  steps: AgentPipelineStepConfig[],
  phaseByTool: ReadonlyMap<string, 'read' | 'write'>,
  edges?: AgentFlowEdgeConfig[],
): AgentPipelineStepConfig[] {
  if (steps.length === 0) return []
  try {
    validateAgentGraph(steps, edges, phaseByTool)
    return steps
  } catch {
    return []
  }
}

export function parseAgentSettingsDocument(
  raw: unknown,
  opts?: { phaseByTool?: ReadonlyMap<string, 'read' | 'write'> },
): AgentSettingsDocument {
  if (!raw || typeof raw !== 'object') {
    throw new AgentSettingsValidationError('document_invalid')
  }
  const o = raw as Record<string, unknown>
  if (o.schemaVersion !== AGENT_SETTINGS_SCHEMA_VERSION) {
    throw new AgentSettingsValidationError('schema_version_invalid')
  }
  const agentMode = normalizeAgentMode(o.agentMode)
  if (!Array.isArray(o.steps)) {
    throw new AgentSettingsValidationError('steps_invalid')
  }
  const steps: AgentPipelineStepConfig[] = o.steps.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new AgentSettingsValidationError(`step_${i}_invalid`)
    }
    const kind = (item as { kind?: unknown }).kind
    if (kind === 'start') return parseStartStep(item, i)
    if (kind === 'end') return parseEndStep(item, i)
    if (kind === 'prose') return parseProseStep(item, i)
    if (kind === 'tool') return parseToolStep(item, i)
    if (kind === 'branch') return parseBranchStep(item, i)
    if (kind === 'node') return parsePluginNodeStep(item, i)
    throw new AgentSettingsValidationError(`step_${i}_kind_invalid`)
  })
  const edges = parseEdges(o.edges)
  if (steps.length > 0) {
    if (opts?.phaseByTool) {
      validateAgentGraph(steps, edges, opts.phaseByTool)
    } else {
      validateAgentGraph(steps, edges, new Map())
    }
  }
  const positions = parsePositions(o.positions)
  const doc: AgentSettingsDocument = {
    schemaVersion: AGENT_SETTINGS_SCHEMA_VERSION,
    agentMode,
    steps,
  }
  if (edges) doc.edges = edges
  if (positions) doc.positions = positions
  if (typeof o.updatedAt === 'string') doc.updatedAt = o.updatedAt
  return doc
}

export async function readAgentSettingsDocument(
  userId?: string,
): Promise<AgentSettingsDocument> {
  try {
    const p = getAgentSettingsPath(userId)
    if (!existsSync(p)) return emptyAgentSettingsDocument()
    const text = await readFile(p, 'utf8')
    const raw = JSON.parse(text) as unknown
    try {
      return parseAgentSettingsDocument(raw)
    } catch (e) {
      // 坏 steps（仅 prose / 缺 prose 等）：保留 mode，steps 回落默认
      if (e instanceof AgentSettingsValidationError && raw && typeof raw === 'object') {
        const o = raw as Record<string, unknown>
        return {
          schemaVersion: AGENT_SETTINGS_SCHEMA_VERSION,
          agentMode: normalizeAgentMode(o.agentMode),
          steps: [],
          ...(typeof o.updatedAt === 'string' ? { updatedAt: o.updatedAt } : {}),
        }
      }
      throw e
    }
  } catch (e) {
    if (
      e instanceof AgentSettingsValidationError &&
      e.message === 'user_context_required'
    ) {
      // 单测 / 无用户上下文：视为空文档（默认流水线）
      return emptyAgentSettingsDocument()
    }
    if (e instanceof AgentSettingsValidationError) throw e
    throw new AgentSettingsValidationError('agent_settings_read_failed')
  }
}

export async function writeAgentSettingsDocument(
  doc: AgentSettingsDocument,
  userId?: string,
  opts?: { phaseByTool?: ReadonlyMap<string, 'read' | 'write'> },
): Promise<AgentSettingsDocument> {
  const parsed = parseAgentSettingsDocument(doc, opts)
  const next: AgentSettingsDocument = {
    ...parsed,
    updatedAt: new Date().toISOString(),
  }
  const uid = userId ?? getCurrentUserId()
  const dir = getUserDataDir(uid)
  await mkdir(dir, { recursive: true })
  const target = getAgentSettingsPath(uid)
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  const { rename } = await import('node:fs/promises')
  await rename(tmp, target)
  return next
}

/** 新建用户一次性 seed（空文档 + off） */
export async function seedDefaultAgentSettingsForUser(
  userId: string,
): Promise<void> {
  const p = getAgentSettingsPath(userId)
  if (existsSync(p)) return
  await writeAgentSettingsDocument(emptyAgentSettingsDocument(), userId)
}
