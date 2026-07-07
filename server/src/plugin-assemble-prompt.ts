import { isValidConversationId } from './conversation-id.js'
import { runPluginCompletePreflight } from './plugin-complete-preflight.js'
import { runPluginMacroExpand } from './plugin-macro-expand.js'
import type {
  AssemblePluginPromptRequest,
  AssemblePluginPromptResult,
  PromptLayout,
  PromptLayoutMessage,
} from './shared/plugin-context-blocks.js'

const BLOCK_PLACEHOLDER = /\{\{blocks\.([a-zA-Z0-9_-]+)\}\}/g
const PLUGIN_PLACEHOLDER = /\{\{plugin\.([a-zA-Z0-9_-]+)\}\}/g

function pluginSettingString(
  settings: Record<string, unknown> | undefined,
  key: string,
): string {
  if (!settings) return ''
  const v = settings[key]
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

export function fillPromptLayoutPlaceholders(
  layout: PromptLayout,
  blocks: Record<string, string>,
  pluginSettings?: Record<string, unknown>,
): PromptLayoutMessage[] {
  return layout.messages.map((m) => {
    let content = m.content
    content = content.replace(BLOCK_PLACEHOLDER, (_full, blockId: string) => {
      return blocks[blockId] ?? ''
    })
    content = content.replace(PLUGIN_PLACEHOLDER, (_full, key: string) => {
      return pluginSettingString(pluginSettings, key)
    })
    return { role: m.role, content }
  })
}

export function parsePromptLayout(raw: unknown): PromptLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const messagesRaw = (raw as Record<string, unknown>).messages
  if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) return null
  const messages: PromptLayoutMessage[] = []
  for (const item of messagesRaw) {
    if (!item || typeof item !== 'object') return null
    const o = item as Record<string, unknown>
    const role = o.role
    const content = o.content
    if (
      role !== 'system' &&
      role !== 'user' &&
      role !== 'assistant'
    ) {
      return null
    }
    if (typeof content !== 'string') return null
    messages.push({ role, content })
  }
  return { messages }
}

export async function runAssemblePluginPrompt(
  req: AssemblePluginPromptRequest,
): Promise<AssemblePluginPromptResult> {
  const conversationId =
    typeof req.conversationId === 'string' ? req.conversationId.trim() : ''
  if (!conversationId || !isValidConversationId(conversationId)) {
    return { ok: false, code: 'invalid_conversation_id' }
  }

  const layout = parsePromptLayout(req.layout)
  if (!layout) {
    return { ok: false, code: 'invalid_layout' }
  }

  const anchorToTurn = req.anchorToTurn
  if (
    typeof anchorToTurn !== 'number' ||
    !Number.isInteger(anchorToTurn) ||
    anchorToTurn < 0
  ) {
    return { ok: false, code: 'anchor_to_turn_required' }
  }

  const blocks =
    req.blocks && typeof req.blocks === 'object' && !Array.isArray(req.blocks)
      ? (req.blocks as Record<string, string>)
      : {}

  const filled = fillPromptLayoutPlaceholders(
    layout,
    blocks,
    req.pluginSettings,
  )

  const messages: PromptLayoutMessage[] = []
  for (const m of filled) {
    if (!m.content.trim()) continue
    const expanded = await runPluginMacroExpand({
      text: m.content,
      conversationId,
      toTurn: anchorToTurn,
      apiConfigId: req.apiConfigId,
      persistVars: req.dryRun !== true,
    })
    if (!expanded.ok) {
      return { ok: false, code: 'macro_expand_failed' }
    }
    const expandedText = expanded.text.trim()
    if (!expandedText) continue
    messages.push({ role: m.role, content: expandedText })
  }

  if (messages.length === 0) {
    return { ok: false, code: 'messages_empty' }
  }

  const apiConfigId =
    typeof req.apiConfigId === 'string' ? req.apiConfigId.trim() : ''
  if (apiConfigId) {
    const preflight = await runPluginCompletePreflight({
      apiConfigId,
      messages,
    })
    if (!preflight.ok) {
      return {
        ok: false,
        code:
          preflight.code === 'context_exceeded'
            ? 'context_exceeded'
            : (preflight.code ?? 'preflight_failed'),
        promptTokens: preflight.promptTokens,
        budget: preflight.budget,
      }
    }
    return {
      ok: true,
      messages,
      preflight: {
        ok: true,
        promptTokens: preflight.promptTokens,
        budget: preflight.budget,
      },
    }
  }

  return { ok: true, messages }
}

export function parseAssemblePluginPromptBody(body: unknown): AssemblePluginPromptRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const o = body as Record<string, unknown>
  const conversationId =
    typeof o.conversationId === 'string' ? o.conversationId.trim() : ''
  const layout = parsePromptLayout(o.layout)
  if (!conversationId || !layout) return null
  if (
    typeof o.anchorToTurn !== 'number' ||
    !Number.isInteger(o.anchorToTurn) ||
    o.anchorToTurn < 0
  ) {
    return null
  }
  const blocks =
    o.blocks && typeof o.blocks === 'object' && !Array.isArray(o.blocks)
      ? (o.blocks as Record<string, string>)
      : {}
  return {
    conversationId,
    blocks,
    layout,
    pluginSettings:
      o.pluginSettings && typeof o.pluginSettings === 'object' && !Array.isArray(o.pluginSettings)
        ? (o.pluginSettings as Record<string, unknown>)
        : undefined,
    anchorToTurn: o.anchorToTurn,
    apiConfigId: typeof o.apiConfigId === 'string' ? o.apiConfigId : undefined,
    dryRun: o.dryRun === true,
  }
}
