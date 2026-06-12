import { PLUGIN_ID, DIALOG_MANUAL, DIALOG_PROMPT_PREVIEW } from './constants.js'
import {
  k,
  loadMergedSettings,
  outgoingTailOrdinal,
  sidecarPromptTemplate,
  tasksFromSelection,
} from './settings.js'
import {
  clearPromptPreviewRestore,
  getPromptPreviewRestore,
  setPromptPreviewRestore,
} from './state.js'
import { isSummarizeTurnSpanTooLarge } from './shared/range-limits.js'
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

function joinSystemMessage(reference: string, instruction: string): string {
  const ref = reference.trim()
  const inst = instruction.trim()
  if (!ref) return inst
  if (!inst) return ref
  return `${ref}\n\n${inst}`
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

async function expandText(
  host: PluginHost,
  text: string,
  apiConfigId: string,
  toTurn?: number,
): Promise<string> {
  const raw = asString(text)
  if (!raw.includes('{{')) return raw
  if (!host.macros?.expand) return raw
  const opts: { apiConfigId?: string; toTurn?: number; persistVars?: boolean } = {
    persistVars: false,
  }
  if (apiConfigId) opts.apiConfigId = apiConfigId
  if (typeof toTurn === 'number' && Number.isInteger(toTurn)) opts.toTurn = toTurn
  return host.macros.expand(raw, opts)
}

async function buildTaskMessages(
  host: PluginHost,
  settings: MergedSettings,
  task: SummarizeTask,
  prepared: { systemReferenceContext: string; userContent: string },
  toTurn: number,
): Promise<{ role: 'system' | 'user'; content: string }[]> {
  const apiConfigId = settings.apiConfigId
  const systemTemplate = resolveSystemPrompt(host, settings, task)
  const [expandedRef, expandedInstruction, expandedUser] = await Promise.all([
    prepared.systemReferenceContext.trim()
      ? expandText(host, prepared.systemReferenceContext, apiConfigId, toTurn)
      : Promise.resolve(''),
    expandText(host, systemTemplate, apiConfigId, toTurn),
    expandText(host, prepared.userContent, apiConfigId, toTurn),
  ])
  const system = joinSystemMessage(expandedRef, expandedInstruction)
  const messages: { role: 'system' | 'user'; content: string }[] = []
  if (system.trim()) messages.push({ role: 'system', content: system })
  if (expandedUser.trim()) messages.push({ role: 'user', content: expandedUser })
  return messages
}

async function preflightLine(
  host: PluginHost,
  settings: MergedSettings,
  messages: { role: 'system' | 'user'; content: string }[],
): Promise<string> {
  const pf = host.token?.preflightComplete
  if (!pf || messages.length === 0) return ''
  try {
    const result = await pf({
      apiConfigId: settings.apiConfigId || undefined,
      messages,
    })
    if (result.ok) {
      return host.t(k(host, 'promptPreviewPreflightOk'), {
        tokens: result.promptTokens,
        budget: result.budget,
      })
    }
    return host.t(k(host, 'promptPreviewPreflightFail'), {
      tokens: result.promptTokens,
      budget: result.budget,
      code: result.code ?? '',
    })
  } catch {
    return ''
  }
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

    const prepared = await host.plugin.prepareContext({
      fromTurn,
      toTurn,
      targetLorebookId: targetId,
      previousSummariesLimit: settings.previousSummariesLimit,
      sidecarEntryIds,
      sidecarIds: settings.sidecars.map((s) => s.id),
      regexRuleIds: settings.regexRuleIds,
      tailOrdinal: outgoingTailOrdinal(host),
      regexApplyAllTurns: settings.regexApplyAllTurns,
    })

    const sections: string[] = [
      host.t(k(host, 'promptPreviewRange'), { from: fromTurn, to: toTurn }),
      '',
    ]

    for (const task of tasks) {
      const messages = await buildTaskMessages(host, settings, task, prepared, toTurn)
      const pf = await preflightLine(host, settings, messages)
      sections.push(`=== ${taskLabel(host, task)} ===`)
      if (pf) sections.push(pf)
      sections.push(formatMessagesForDisplay(messages))
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
