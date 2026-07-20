import { openManualSummarize } from './dialogs.js'
import { parsePlotSlashArgs } from './parse-plot-slash.js'
import { k, loadMergedSettings } from './settings.js'
import type { PluginHost } from './types.js'

function notifySlashError(host: PluginHost, code: string, params?: Record<string, unknown>) {
  const keyMap: Record<string, string> = {
    unknown_type: 'slashErrUnknownType',
    missing_entry: 'slashErrMissingEntry',
    unquoted_spaces: 'slashErrUnquotedSpaces',
    unclosed_quote: 'slashErrUnclosedQuote',
    invalid_range: 'slashErrInvalidRange',
    trailing_garbage: 'slashErrTrailingGarbage',
    entry_not_found: 'slashErrEntryNotFound',
    entry_ambiguous: 'slashErrEntryAmbiguous',
  }
  const msgKey = keyMap[code] ?? 'slashErrUnknownType'
  host.ui.notify(host.t(k(host, msgKey), params), undefined, { level: 'warning' })
}

/**
 * 处理 `/plot …`：只打开手动摘要 modal 预填参数，不自动跑摘要。
 */
export async function handlePlotSlashCommand(
  host: PluginHost,
  args: string,
): Promise<void> {
  const parsed = parsePlotSlashArgs(args)
  if (!parsed.ok) {
    notifySlashError(host, parsed.code)
    return
  }

  if (parsed.kind === 'bare') {
    await openManualSummarize(host)
    return
  }

  const range =
    typeof parsed.scopeStart === 'number' && typeof parsed.scopeEnd === 'number'
      ? { startTurn: parsed.scopeStart, endTurn: parsed.scopeEnd }
      : undefined

  if (parsed.kind === 'summary') {
    await openManualSummarize(host, {
      ...range,
      selectedTasks: ['memory'],
    })
    return
  }

  // sidecar：按 name 精确匹配（trim 后、大小写敏感）；重名则报错
  const settings = await loadMergedSettings(host)
  const entryName = parsed.entryName
  const matches = settings.sidecars.filter((sc) => sc.name.trim() === entryName)
  if (matches.length === 0) {
    notifySlashError(host, 'entry_not_found', { name: entryName })
    return
  }
  if (matches.length > 1) {
    notifySlashError(host, 'entry_ambiguous', { name: entryName })
    return
  }
  await openManualSummarize(host, {
    ...range,
    selectedTasks: [`sidecar:${matches[0]!.id}`],
  })
}

export function registerPlotSlashCommand(host: PluginHost) {
  host.registerComposerSlashCommand(
    'plot',
    (ctx) => handlePlotSlashCommand(host, ctx.args),
    {
      example: '/plot summary 99-150',
      descriptionKey: k(host, 'slashPlotDescription'),
    },
  )
}
