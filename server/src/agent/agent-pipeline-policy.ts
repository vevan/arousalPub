/**
 * Agent 可配置线性流水线策略（DOC/53 §16.8）。
 * 默认合成器：每工具一步（精细控制）；日后 DAG 编译为同一形状。
 */

import type { AgentToolPhase } from './agent-prose-phase.js'
import { resolveToolMaxCallsPerTurn } from './agent-tool-budget.js'
import {
  CORE_KNOWLEDGE_SEARCH_TOOL,
  CORE_LORE_SEARCH_TOOL,
  CORE_MEMORY_SEARCH_TOOL,
  isCoreAgentToolName,
} from './host-search-tools.js'

/** 阶段种类（宿主 generic；非插件 id） */
export type PipelineStageKind = 'tool' | 'prose' | 'write'

export type PipelineToolChoice = 'auto' | 'required' | 'none'

export type PipelineAdvanceWhen =
  /** offer 内 required 均至少成功一次 */
  | 'required_tools_done'
  /** offer 内工具均已达尝试上限（成功或失败都计数） */
  | 'offer_exhausted'
  | 'prose_committed'
  | 'required_writes_done'

export type ToolOfferRule = {
  toolName: string
  /** 本阶段结束前须至少成功一次（与 offer_exhausted 互斥语义由 advanceWhen 决定） */
  required?: boolean
  maxCalls?: number
}

export type PipelineStage = {
  /** 稳定 id，如 tool:lore_search / prose / write:trace_patch */
  id: string
  kind: PipelineStageKind
  /** 1-based 展示序号 */
  step: number
  title: string
  /** 进入本步时注入给模型的指令（逐步精细控制） */
  instruction: string
  offer: ToolOfferRule[]
  toolChoice: PipelineToolChoice
  advanceWhen: PipelineAdvanceWhen
}

export type AgentPipelinePolicy = {
  schemaVersion: 1
  stages: PipelineStage[]
}

export type PipelineToolMeta = {
  name: string
  phase?: AgentToolPhase
  maxCallsPerTurn: number
}

export type BuildDefaultPipelineInput = {
  tools: PipelineToolMeta[]
  requiredSearchToolNames: string[]
}

/** 核心检索默认顺序（仅排序，非产品特化分支） */
const CORE_SEARCH_ORDER = [
  CORE_LORE_SEARCH_TOOL,
  CORE_MEMORY_SEARCH_TOOL,
  CORE_KNOWLEDGE_SEARCH_TOOL,
]

function uniqNames(names: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const n = raw.trim()
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

function sortCoreSearchFirst(names: string[]): string[] {
  const set = new Set(names)
  const ordered: string[] = []
  for (const c of CORE_SEARCH_ORDER) {
    if (set.has(c)) {
      ordered.push(c)
      set.delete(c)
    }
  }
  for (const n of names) {
    if (set.has(n)) ordered.push(n)
  }
  return ordered
}

function maxCallsOf(
  name: string,
  phase: AgentToolPhase | undefined,
  fromMeta?: number,
): number {
  if (typeof fromMeta === 'number' && Number.isFinite(fromMeta)) return fromMeta
  if (fromMeta === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY
  return resolveToolMaxCallsPerTurn({ name, phase })
}

/**
 * 默认精细流水线：每个检索/读工具独立一步 → prose → 每个 write 一步。
 */
export function buildDefaultAgentPipelinePolicy(
  input: BuildDefaultPipelineInput,
): AgentPipelinePolicy {
  const requiredSearch = sortCoreSearchFirst(
    uniqNames(input.requiredSearchToolNames),
  )
  const requiredSet = new Set(requiredSearch)
  const metaByName = new Map(
    input.tools.map((t) => [t.name.trim(), t] as const),
  )

  const writeNames: string[] = []
  const otherReadNames: string[] = []
  const seen = new Set<string>()

  for (const t of input.tools) {
    const name = t.name.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    if (t.phase === 'write') {
      writeNames.push(name)
      continue
    }
    if (requiredSet.has(name) || isCoreAgentToolName(name)) {
      // 核心/绑定检索走 requiredSearch 列表，避免重复
      if (!requiredSet.has(name) && isCoreAgentToolName(name)) {
        // 未绑定的核心工具不当作必调步
        continue
      }
      continue
    }
    otherReadNames.push(name)
  }

  for (const name of requiredSearch) {
    if (!seen.has(name)) seen.add(name)
  }

  type Draft = Omit<PipelineStage, 'step' | 'instruction'> & {
    instructionTemplate: (step: number, total: number) => string
  }

  const drafts: Draft[] = []

  for (const name of requiredSearch) {
    const meta = metaByName.get(name)
    const maxCalls = maxCallsOf(name, 'read', meta?.maxCallsPerTurn)
    drafts.push({
      id: `tool:${name}`,
      kind: 'tool',
      title: `Required search · ${name}`,
      instructionTemplate: (step, total) =>
        `[Pipeline step ${step}/${total}] Call ONLY the tool "${name}" now. Do not call any other tool. Do not write the user-facing reply yet.`,
      offer: [{ toolName: name, required: true, maxCalls }],
      toolChoice: 'required',
      advanceWhen: 'required_tools_done',
    })
  }

  for (const name of otherReadNames) {
    const meta = metaByName.get(name)
    const maxCalls = maxCallsOf(name, meta?.phase ?? 'read', meta?.maxCallsPerTurn)
    drafts.push({
      id: `tool:${name}`,
      kind: 'tool',
      title: `Read · ${name}`,
      instructionTemplate: (step, total) =>
        `[Pipeline step ${step}/${total}] Call ONLY the tool "${name}" now (once). Do not call other tools. Do not write the user-facing reply yet.`,
      offer: [{ toolName: name, required: false, maxCalls }],
      toolChoice: 'required',
      // 可选读：失败/耗尽一次即可推进
      advanceWhen: 'offer_exhausted',
    })
  }

  drafts.push({
    id: 'prose',
    kind: 'prose',
    title: 'User-facing reply',
    instructionTemplate: (step, total) =>
      `[Pipeline step ${step}/${total}] Write the full user-facing reply as assistant content now. No tools are available in this step.`,
    offer: [],
    toolChoice: 'none',
    advanceWhen: 'prose_committed',
  })

  for (const name of writeNames) {
    const meta = metaByName.get(name)
    const maxCalls = maxCallsOf(name, 'write', meta?.maxCallsPerTurn)
    // 有限次数（如 maxCalls=1）的 write：可能合法失败/跳过（无数据才 init），勿卡死流水线
    const finiteOnce = Number.isFinite(maxCalls) && maxCalls <= 1
    drafts.push({
      id: `write:${name}`,
      kind: 'write',
      title: `Write · ${name}`,
      instructionTemplate: (step, total) =>
        finiteOnce
          ? `[Pipeline step ${step}/${total}] Call ONLY the tool "${name}" now if applicable (skip when its precondition is unmet). Do not call other tools.`
          : `[Pipeline step ${step}/${total}] The user-facing reply is done. Call ONLY the tool "${name}" now to apply write/mutate updates. Prefer one call with all needed ops.`,
      offer: [
        {
          toolName: name,
          required: !finiteOnce,
          maxCalls,
        },
      ],
      toolChoice: 'required',
      advanceWhen: finiteOnce ? 'offer_exhausted' : 'required_writes_done',
    })
  }

  const total = drafts.length
  const stages: PipelineStage[] = drafts.map((d, i) => {
    const step = i + 1
    return {
      id: d.id,
      kind: d.kind,
      step,
      title: d.title,
      instruction: d.instructionTemplate(step, total),
      offer: d.offer,
      toolChoice: d.toolChoice,
      advanceWhen: d.advanceWhen,
    }
  })

  return { schemaVersion: 1, stages }
}

export function effectiveMaxCallsForRule(
  rule: ToolOfferRule,
  defaultsByTool: ReadonlyMap<string, number>,
): number {
  if (typeof rule.maxCalls === 'number' && Number.isFinite(rule.maxCalls)) {
    return rule.maxCalls
  }
  if (rule.maxCalls === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY
  }
  const d = defaultsByTool.get(rule.toolName)
  if (typeof d === 'number') return d
  return 1
}

export function stageRequiredToolNames(stage: PipelineStage): string[] {
  return stage.offer
    .filter((r) => r.required === true)
    .map((r) => r.toolName.trim())
    .filter(Boolean)
}

/** 正文前所有必调工具名（跨多个 tool/write 步；遇 prose 停止） */
export function policyPreProseRequiredToolNames(
  policy: AgentPipelinePolicy,
): string[] {
  const out: string[] = []
  for (const s of policy.stages) {
    if (s.kind === 'prose') break
    out.push(...stageRequiredToolNames(s))
  }
  return out
}

/**
 * 须成功的 write 工具名（offer.required=true）。
 * 供 agent-loop 正文后 nudge；可选 write（如仅无数据才调用的 init）不在此列。
 */
export function policyWriteToolNames(policy: AgentPipelinePolicy): string[] {
  const out: string[] = []
  for (const s of policy.stages) {
    if (s.kind !== 'write') continue
    out.push(...stageRequiredToolNames(s))
  }
  return out
}
