import { PLUGIN_ID, DIALOG_MANUAL, DIALOG_PROMPT_PREVIEW } from './constants.js'
import {
  k,
  loadMergedSettings,
  sidecarPromptTemplate,
  tasksFromSelection,
} from './settings.js'
import {
  clearPromptPreviewRestore,
  getPromptPreviewRestore,
  setPromptPreviewRestore,
} from './state.js'
import { isSummarizeTurnSpanTooLarge } from './shared/range-limits.js'
import { PLOT_SUMMARY_COMPLETE_LAYOUT } from './shared/summary-prompt-layout.js'
import { preparePlotSummarySummarizeContext } from './prepare-context.js'
import { asInt, asString } from './shared/utils.js'
import type { MergedSettings, PluginHost, SummarizeTask } from './types.js'

function auditDebugEnabled(host: PluginHost): boolean {
  const raw = (
    host.session as { writeChatPromptSnapshot?: boolean | { value: boolean } }
  ).writeChatPromptSnapshot
  if (typeof raw === 'boolean') return raw
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return Boolean(raw.value)
  }
  return false
}

function formatContentValue(value: string, inner: string): string {
  if (!value.includes('\n')) {
    return `${inner}"content": ${JSON.stringify(value)}`
  }
  const bodyIndent = `${inner}  `
  const body = value.split('\n').map((line) => bodyIndent + line).join('\n')
  return `${inner}"content": "\n${body}\n${inner}"`
}

function formatMessage(msg: { role: string; content: string }, indent: string): string {
  const inner = `${indent}  `
  const roleLine = `${inner}"role": ${JSON.stringify(msg.role)}`
  const contentLine = formatContentValue(msg.content, inner)
  return `${indent}{\n${roleLine},\n${contentLine}\n${indent}}`
}

function formatMessagesForDisplay(messages: { role: string; content: string }[]): string {
  if (messages.length === 0) return '[]'
  const items = messages.map((m) => formatMessage(m, '  '))
  return `[\n${items.join(',\n')}\n]`
}

function taskLabel(host: PluginHost, task: SummarizeTask): string {
  if (task.kind === 'memory') return host.t(k(host, 'manualTaskMemory'))
  return task.sidecar.name
}

function resolveSystemPrompt(
  host: PluginHost,
  settings: MergedSettings,
  task: SummarizeTask,
): string {
  if (task.kind === 'sidecar') {
    return sidecarPromptTemplate(host, task.sidecar)
  }
  return settings.systemPromptTemplate
}

function preflightLineFromDryRun(
  host: PluginHost,
  preflight: { ok: boolean; promptTokens: number; budget: number; code?: string } | undefined,
): string {
  if (!preflight) return ''
  if (preflight.ok) {
    return host.t(k(host, 'promptPreviewPreflightOk'), {
      tokens: preflight.promptTokens,
      budget: preflight.budget,
    })
  }
  return host.t(k(host, 'promptPreviewPreflightFail'), {
    tokens: preflight.promptTokens,
    budget: preflight.budget,
    code: preflight.code ?? '',
  })
}

function summarizeDialogCanPreview(model: Record<string, unknown>, settings: MergedSettings): boolean {
  const start = asInt(model.startTurn, -1, 500_000)
  const end = asInt(model.endTurn, -1, 500_000)
  if (start < 0 || end < start) return false
  if (isSummarizeTurnSpanTooLarge(start, end)) return false
  return tasksFromSelection(settings, model.selectedTasks).length > 0
}

async function resolveTargetLorebookIdForPreview(
  host: PluginHost,
  settings: MergedSettings,
): Promise<string> {
  const id = asString(settings.targetLorebookId)
  if (!id) {
    host.ui.toast(host.t(k(host, 'toastTargetLorebookMissingWarn')), { color: 'warning' })
    return ''
  }
  try {
    await host.lorebook.get(id)
    return id
  } catch {
    host.ui.toast(host.t(k(host, 'toastTargetLorebookDeleted')), { color: 'warning' })
    return ''
  }
}

export function registerPromptPreviewDialog(host: PluginHost) {
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, 'promptPreviewTitle'),
      bodyKey: k(host, 'promptPreviewBody'),
      fields: [
        {
          key: 'previewText',
          labelKey: k(host, 'promptPreviewTextLabel'),
          type: 'textarea',
          readOnly: true,
        },
      ],
      submitKey: k(host, 'promptPreviewClose'),
      cancelKey: k(host, 'sessionCancel'),
      canSubmit: () => true,
      onSubmit: async (h: PluginHost) => {
        const restore = getPromptPreviewRestore()
        clearPromptPreviewRestore()
        if (restore) {
          h.openFormDialog(PLUGIN_ID, restore, DIALOG_MANUAL)
        }
      },
      onCancel: async (h: PluginHost) => {
        const restore = getPromptPreviewRestore()
        clearPromptPreviewRestore()
        if (restore) {
          h.openFormDialog(PLUGIN_ID, restore, DIALOG_MANUAL)
        }
      },
    },
    DIALOG_PROMPT_PREVIEW,
  )
}

export async function previewManualSummarizePrompt(
  host: PluginHost,
  model: Record<string, unknown>,
) {
  if (!auditDebugEnabled(host)) return

  const settings = await loadMergedSettings(host)
  if (!summarizeDialogCanPreview(model, settings)) {
    host.ui.toast(host.t(k(host, 'toastInvalidRange')), { color: 'warning' })
    return
  }

  const fromTurn = asInt(model.startTurn, 0, 500_000)
  const toTurn = asInt(model.endTurn, fromTurn, 500_000)
  if (isSummarizeTurnSpanTooLarge(fromTurn, toTurn)) {
    host.ui.toast(host.t(k(host, 'toastTurnRangeTooLong')), { color: 'warning' })
    return
  }
  const tasks = tasksFromSelection(settings, model.selectedTasks)
  if (tasks.length === 0) {
    host.ui.toast(host.t(k(host, 'toastNoTasksSelected')), { color: 'warning' })
    return
  }

  host.ui.progress({
    message: host.t(k(host, 'promptPreviewLoading')),
    done: 0,
    total: 1,
    indeterminate: true,
  })

  try {
    const targetId = await resolveTargetLorebookIdForPreview(host, settings)
    if (!targetId) return

    let sidecarEntryIds: Record<string, string>
    try {
      sidecarEntryIds = await host.lorebook.normalizeEntryRefs({
        lorebookId: targetId,
        entryIds: settings.sidecarEntryIds,
        validKeys: settings.sidecars.map((s) => s.id),
      })
    } catch {
      sidecarEntryIds = {}
    }

    settings.targetLorebookId = targetId
    settings.sidecarEntryIds = sidecarEntryIds

    const prepared = await preparePlotSummarySummarizeContext(
      host,
      settings,
      fromTurn,
      toTurn,
    )
    if (!prepared.userContent?.trim()) {
      host.ui.toast(host.t(k(host, 'toastNoTurnsInRange')), { color: 'warning' })
      return
    }

    const sections: string[] = [
      host.t(k(host, 'promptPreviewRange'), { from: fromTurn, to: toTurn }),
      '',
    ]

    for (const task of tasks) {
      const systemPromptTemplate = resolveSystemPrompt(host, settings, task)
      const result = await host.plugin.completeWithContext({
        ...(settings.apiConfigId ? { apiConfigId: settings.apiConfigId } : {}),
        blocks: [],
        preparedContext: prepared.preparedContext,
        layout: PLOT_SUMMARY_COMPLETE_LAYOUT,
        pluginSettings: { systemPromptTemplate },
        anchorToTurn: toTurn,
        dryRun: true,
      })
      const pfLine = preflightLineFromDryRun(host, result.preflight)
      sections.push(`=== ${taskLabel(host, task)} ===`)
      if (pfLine) sections.push(pfLine)
      sections.push(formatMessagesForDisplay(result.messages))
      sections.push('')
    }

    setPromptPreviewRestore({ ...model })
    host.openFormDialog(
      PLUGIN_ID,
      { previewText: sections.join('\n').trim() },
      DIALOG_PROMPT_PREVIEW,
    )
  } catch (e) {
    console.warn('[plot-summary] prompt preview failed', e)
    host.ui.toast(host.t(k(host, 'promptPreviewFailed')), { color: 'error' })
  } finally {
    host.ui.clearProgress()
  }
}

export { auditDebugEnabled, summarizeDialogCanPreview }
