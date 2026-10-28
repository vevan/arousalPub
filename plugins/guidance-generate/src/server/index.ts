export type { PluginPromptInjection } from '../../../../shared/plugin-prompt-injection.js'
import type { PluginPromptInjection } from '../../../../shared/plugin-prompt-injection.js'
import {
  POST_USER_INJECTION_ORDER_SLOT_DEFAULTS,
  resolveAssembleInjectionOrderSlot,
} from '../../../../shared/post-user-injection-order.js'

const PLUGIN_ID = 'guidance-generate'

const DEFAULT_SYSTEM_PREFIX =
  "Please generate a reply according to this guidance together with the user's message: "

const DEFAULT_REVISE_SYSTEM_PREFIX =
  'Please revise the assistant reply above according to this guidance while preserving the main meaning: '

const CHAT_DEPTH = 0

export type GuidanceMode = 'send' | 'regenerate' | 'revise'

/** 指导正文注入角色（send/regenerate / revise 指导句） */
export type GuidanceMessageRole = 'system' | 'user' | 'assistant'

export type GuidancePayload = {
  mode: GuidanceMode
  guidanceText: string
  assistantText?: string
}

export type ChatMessage = {
  role: string
  content: string
}

export function parseGuidanceMessageRole(
  raw: unknown,
  fallback: GuidanceMessageRole = 'system',
): GuidanceMessageRole {
  if (raw === 'system' || raw === 'user' || raw === 'assistant') return raw
  return fallback
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
    injectionOrderSlots?: Record<string, number>
  },
  api: {
    applyPromptMacroPipeline: (
      text: string,
      macroContext: unknown,
    ) => string | Promise<string>
    getUserPluginSettings: (
      pluginId: string,
    ) => Promise<Record<string, unknown> | null>
  },
): Promise<PluginPromptInjection[] | null> {
  const parsed = parsePayload(ctx.plugins?.[PLUGIN_ID])
  if (!parsed) return null
  const guidance = await api.applyPromptMacroPipeline(
    parsed.guidanceText,
    ctx.macroContext,
  )
  if (!guidance) return null
  const settings = await api.getUserPluginSettings(PLUGIN_ID)
  const slots = ctx.injectionOrderSlots
  if (parsed.mode === 'revise') {
    const assistantText = parsed.assistantText?.trim()
    if (!assistantText) return null
    const rawPrefix =
      typeof settings?.reviseSystemPrefix === 'string'
        ? settings.reviseSystemPrefix
        : ''
    const prefix = rawPrefix.trim() || DEFAULT_REVISE_SYSTEM_PREFIX
    const reviseGuidanceRole = parseGuidanceMessageRole(
      settings?.reviseGuidanceRole,
      'system',
    )
    return [
      {
        role: 'assistant',
        content: assistantText,
        position: {
          kind: 'chat',
          depth: CHAT_DEPTH,
          injectionOrder: resolveAssembleInjectionOrderSlot(
            slots,
            'reviseAssistant',
            POST_USER_INJECTION_ORDER_SLOT_DEFAULTS.reviseAssistant,
          ),
        },
      },
      {
        role: reviseGuidanceRole,
        content: `${prefix}${guidance}`,
        position: {
          kind: 'chat',
          depth: CHAT_DEPTH,
          injectionOrder: resolveAssembleInjectionOrderSlot(
            slots,
            'reviseSystem',
            POST_USER_INJECTION_ORDER_SLOT_DEFAULTS.reviseSystem,
          ),
        },
      },
    ]
  }
  const rawPrefix =
    typeof settings?.systemPrefix === 'string' ? settings.systemPrefix : ''
  const prefix = rawPrefix.trim() || DEFAULT_SYSTEM_PREFIX
  const guidanceRole = parseGuidanceMessageRole(settings?.guidanceRole, 'system')
  return [
    {
      role: guidanceRole,
      content: `${prefix}${guidance}`,
      position: {
        kind: 'chat',
        depth: CHAT_DEPTH,
        injectionOrder: resolveAssembleInjectionOrderSlot(
          slots,
          'send',
          POST_USER_INJECTION_ORDER_SLOT_DEFAULTS.send,
        ),
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
