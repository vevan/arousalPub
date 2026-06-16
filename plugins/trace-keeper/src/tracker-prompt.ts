import type { TraceBundle } from './constants.js'
import {
  DEFAULT_SEPARATE_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
} from './default-prompt.js'
import {
  buildSeparateDialogueMessages,
  type SeparateTurnRow,
} from './separate-dialogue.js'

/** Together 注入：格式说明 + sample；历史 state 由正则保留在 assistant 正文内。 */
export function buildTrackerSystemPrompt(bundle: TraceBundle): string {
  const prefix =
    bundle.systemPromptTemplate?.trim() || DEFAULT_SYSTEM_PROMPT_TEMPLATE
  const sampleJson = JSON.stringify(bundle.sampleState, null, 2)
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
  const sampleJson = JSON.stringify(bundle.sampleState, null, 2)
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
