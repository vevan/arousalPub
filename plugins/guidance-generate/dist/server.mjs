const PLUGIN_ID = 'guidance-generate'

const DEFAULT_SYSTEM_PREFIX =
  "Please generate a reply according to this guidance together with the user's message: "

export function parsePayload(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = raw
  const mode = o.mode === 'regenerate' ? 'regenerate' : 'send'
  const guidanceText =
    typeof o.guidanceText === 'string' ? o.guidanceText.trim() : ''
  if (!guidanceText) return null
  return { mode, guidanceText }
}

export async function afterAssemblePrompts(ctx, api) {
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
  return [
    ...ctx.messages,
    {
      role: 'system',
      content: `${prefix}${guidance}`,
    },
  ]
}

export function resolveTurnPluginEntries(plugins) {
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
