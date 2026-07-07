export type { PluginPromptInjection } from '../../../shared/plugin-prompt-injection.js'
import type { PluginPromptInjection } from '../../../shared/plugin-prompt-injection.js'

const PLUGIN_ID = 'guidance-generate'

const DEFAULT_SYSTEM_PREFIX =
  "Please generate a reply according to this guidance together with the user's message: "

const DEFAULT_REVISE_SYSTEM_PREFIX =
  'Please revise the assistant reply above according to this guidance while preserving the main meaning: '

/** DOC/38 §3.2 · chat depth 0 post-user injectionOrder（暂硬编码 · 见 DOC/04 可配置化 TODO） */
const CHAT_DEPTH = 0
const SEND_GUIDANCE_INJECTION_ORDER = 10
const REVISE_ASSISTANT_INJECTION_ORDER = 11
const REVISE_SYSTEM_INJECTION_ORDER = 12

export type GuidanceMode = 'send' | 'regenerate' | 'revise'

export type GuidancePayload = {
  mode: GuidanceMode
  guidanceText: string
  assistantText?: string
}

export type ChatMessage = {
  role: string
  content: string
}

export function parsePayload(raw: unknown): GuidancePayload | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const modeRaw = o.mode
  const mode: GuidanceMode =
    modeRaw === 'regenerate'
      ? 'regenerate'
      : modeRaw === 'revise'
        ? 'revise'
        : 'send'
  const guidanceText =
    typeof o.guidanceText === 'string' ? o.guidanceText.trim() : ''
  if (!guidanceText) return null
  const assistantText =
    typeof o.assistantText === 'string' ? o.assistantText.trim() : ''
  if (mode === 'revise' && !assistantText) return null
  return {
    mode,
    guidanceText,
    ...(mode === 'revise' ? { assistantText } : {}),
  }
}

/** 将指导 system 插在最后一条 user 之后（无 user 时仍 append 到末尾） */
export function insertSystemAfterLastUser(
  messages: ChatMessage[],
  systemContent: string,
): ChatMessage[] {
  const systemMsg: ChatMessage = { role: 'system', content: systemContent }
  let lastUserIdx = -1
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'user') lastUserIdx = i
  }
  if (lastUserIdx < 0) return [...messages, systemMsg]
  return [
    ...messages.slice(0, lastUserIdx + 1),
    systemMsg,
    ...messages.slice(lastUserIdx + 1),
  ]
}

/** revise：在末尾追加 assistant 草稿，再在其后插入指导 system */
export function appendAssistantThenGuidanceSystem(
  messages: ChatMessage[],
  assistantContent: string,
  systemContent: string,
): ChatMessage[] {
  return [
    ...messages,
    { role: 'assistant', content: assistantContent },
    { role: 'system', content: systemContent },
  ]
}

export async function resolveAfterAssemblePromptsAddition(
  ctx: {
    pluginId: string
    macroContext: unknown
    plugins?: Record<string, unknown> | null
  },
  api: {
    applyPromptMacroPipeline: (
      text: string,
      macroContext: unknown,
    ) => string
    getUserPluginSettings: (
      pluginId: string,
    ) => Promise<Record<string, unknown> | null>
  },
): Promise<PluginPromptInjection[] | null> {
  const parsed = parsePayload(ctx.plugins?.[PLUGIN_ID])
  if (!parsed) return null
  const guidance = api.applyPromptMacroPipeline(
    parsed.guidanceText,
    ctx.macroContext,
  )
  if (!guidance) return null
  const settings = await api.getUserPluginSettings(PLUGIN_ID)
  if (parsed.mode === 'revise') {
    const assistantText = parsed.assistantText?.trim()
    if (!assistantText) return null
    const rawPrefix =
      typeof settings?.reviseSystemPrefix === 'string'
        ? settings.reviseSystemPrefix
        : ''
    const prefix = rawPrefix.trim() || DEFAULT_REVISE_SYSTEM_PREFIX
    return [
      {
        role: 'assistant',
        content: assistantText,
        position: {
          kind: 'chat',
          depth: CHAT_DEPTH,
          injectionOrder: REVISE_ASSISTANT_INJECTION_ORDER,
        },
      },
      {
        role: 'system',
        content: `${prefix}${guidance}`,
        position: {
          kind: 'chat',
          depth: CHAT_DEPTH,
          injectionOrder: REVISE_SYSTEM_INJECTION_ORDER,
        },
      },
    ]
  }
  const rawPrefix =
    typeof settings?.systemPrefix === 'string' ? settings.systemPrefix : ''
  const prefix = rawPrefix.trim() || DEFAULT_SYSTEM_PREFIX
  return [
    {
      role: 'system',
      content: `${prefix}${guidance}`,
      position: {
        kind: 'chat',
        depth: CHAT_DEPTH,
        injectionOrder: SEND_GUIDANCE_INJECTION_ORDER,
      },
    },
  ]
}

export function resolveTurnPluginEntries(
  plugins?: Record<string, unknown> | null,
): {
  pluginId: string
  schemaVersion: number
  payload: { mode: GuidanceMode; guidanceText: string }
}[] {
  const parsed = parsePayload(plugins?.[PLUGIN_ID])
  if (!parsed) return []
  return [
    {
      pluginId: PLUGIN_ID,
      schemaVersion: 1,
      payload: { mode: parsed.mode, guidanceText: parsed.guidanceText },
    },
  ]
}
