const PLUGIN_ID = 'guidance-generate'

const DEFAULT_SYSTEM_PREFIX =
  "Please generate a reply according to this guidance together with the user's message: "

export type GuidancePayload = {
  mode: 'send' | 'regenerate'
  guidanceText: string
}

export type ChatMessage = {
  role: string
  content: string
}

export function parsePayload(raw: unknown): GuidancePayload | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const mode = o.mode === 'regenerate' ? 'regenerate' : 'send'
  const guidanceText =
    typeof o.guidanceText === 'string' ? o.guidanceText.trim() : ''
  if (!guidanceText) return null
  return { mode, guidanceText }
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

export async function afterAssemblePrompts(
  ctx: {
    messages: ChatMessage[]
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
): Promise<ChatMessage[]> {
  const parsed = parsePayload(ctx.plugins?.[PLUGIN_ID])
  if (!parsed) return ctx.messages
  const guidance = api.applyPromptMacroPipeline(
    parsed.guidanceText,
    ctx.macroContext,
  )
  if (!guidance) return ctx.messages
  const settings = await api.getUserPluginSettings(PLUGIN_ID)
  const rawPrefix =
    typeof settings?.systemPrefix === 'string' ? settings.systemPrefix : ''
  const prefix = rawPrefix.trim() || DEFAULT_SYSTEM_PREFIX
  return insertSystemAfterLastUser(ctx.messages, `${prefix}${guidance}`)
}

export function resolveTurnPluginEntries(
  plugins?: Record<string, unknown> | null,
): { pluginId: string; schemaVersion: number; payload: { guidanceText: string } }[] {
  const parsed = parsePayload(plugins?.[PLUGIN_ID])
  if (!parsed) return []
  return [
    {
      pluginId: PLUGIN_ID,
      schemaVersion: 1,
      payload: { guidanceText: parsed.guidanceText },
    },
  ]
}
