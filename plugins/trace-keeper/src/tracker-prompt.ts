import type { TraceBundle } from './constants.js'
import {
  DEFAULT_SEPARATE_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
} from './default-prompt.js'
import {
  buildSeparateDialogueMessages,
  type SeparateTurnRow,
} from './separate-dialogue.js'

/** 注入提示词用的 sample 正文：优先已解析对象，否则允许校验关闭时的原文 */
export function formatSampleStateForPrompt(bundle: TraceBundle): string {
  const raw = bundle.sampleStatePromptText?.trim()
  if (raw) return raw
  return JSON.stringify(bundle.sampleState, null, 2)
}

/** Together 注入：格式说明 + sample；历史 state 由正则保留在 assistant 正文内。 */
export function buildTrackerSystemPrompt(bundle: TraceBundle): string {
  const prefix =
    bundle.systemPromptTemplate?.trim() || DEFAULT_SYSTEM_PROMPT_TEMPLATE
  const sampleJson = formatSampleStateForPrompt(bundle)
  return [
    prefix,
    '--- sample structure (reference only) ---',
    sampleJson,
  ].join('\n')
}

/** Separate 补生成：置于对话历史之后的 system（含 JSON 模板）。 */
export function buildSeparateSystemPrompt(bundle: TraceBundle): string {
  const prefix =
    bundle.separateSystemPromptTemplate?.trim() ||
    DEFAULT_SEPARATE_SYSTEM_PROMPT_TEMPLATE
  const sampleJson = formatSampleStateForPrompt(bundle)
  return [
    prefix,
    '--- JSON template (reference only) ---',
    sampleJson,
  ].join('\n')
}

export type SeparateRegenerateMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Separate：先多轮 user/assistant，最后一条 system。 */
export function buildSeparateRegenerateMessages(
  tail: SeparateTurnRow[],
  targetOrdinal: number,
  windowTurnCount: number,
  bundle: TraceBundle,
): SeparateRegenerateMessage[] {
  const dialogue = buildSeparateDialogueMessages(
    tail,
    targetOrdinal,
    windowTurnCount,
  )
  return [...dialogue, { role: 'system', content: buildSeparateSystemPrompt(bundle) }]
}
