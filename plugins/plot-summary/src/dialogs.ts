import {
  PLUGIN_ID,
  DIALOG_ENABLE,
  DIALOG_MANUAL,
  DIALOG_PICK_LOREBOOK,
  DIALOG_RECOVER_LOREBOOK,
  DIALOG_SESSION,
} from './constants.js'
import { isLorebookNotFoundError } from './errors.js'
import { notifyOutcome } from './notify-outcome.js'
import { runSummarizeTasks } from './pipeline.js'
import {
  clearLorebookPickResolver,
  getLorebookPickResolver,
  setLorebookPickResolver,
  summarizeRunning,
} from './state.js'
import { applyPlotSummaryEntrySort } from './shared/entry-sort.js'
import { isSummarizeTurnSpanTooLarge } from './shared/range-limits.js'
import { asInt, asString } from './shared/utils.js'
import {
  firstAutoTriggerTurnOrdinal,
  hasAutoSummarizeHistory,
  k,
  loadMergedSettings,
  manualSummarizeDefaultRange,
  maxTurnOrdinal,
  tailAnchoredBlockRange,
  normalizedNextBlockStart,
  currentAutoRange,
  normalizeManualTaskSelection,
  parseAutoSidecarIdsRaw,
  sidecarIdsFromTaskSelection,
  tasksFromSelection,
} from './settings.js'
import type { MergedSettings, PluginHost } from './types.js'
import {
  auditDebugEnabled,
  previewManualSummarizePrompt,
  summarizeDialogCanPreview,
} from './prompt-preview.js'

function isAutoSummarizeEnabled(host: PluginHost): boolean {
  return host.conversation.getPluginSettingsSnapshot().autoSummarizeEnabled === true
}

export function refreshAutoSummarizeUi(host: PluginHost) {
  host.refreshSlotButtons()
}

async function isTargetLorebookAvailable(host: PluginHost, lorebookId: string) {
  try {
    await host.lorebook.get(lorebookId)
    return true
  } catch (e) {
    if (isLorebookNotFoundError(e)) return false
    throw e
  }
}

async function applyRecoveredTargetLorebook(host: PluginHost, lorebookId: string) {
  await host.conversation.patchPluginSettings({
    targetLorebookId: lorebookId,
    sidecarEntryIds: null,
  })
}

async function createTargetLorebookFromTemplate(host: PluginHost, settings: MergedSettings) {
  const ensured = await host.lorebook.ensure({
    nameTemplate: settings.autoLorebookNameTemplate,
  })
  const id = asString(ensured?.id)
  if (!id) {
    notifyOutcome(host, 'notifyAutoLorebookFailed', 'error')
    return ''
  }
  notifyOutcome(host, 'notifyAutoLorebookCreated', 'success', { name: ensured.name || id })
  return id
}

export async function ensureTargetLorebook(host: PluginHost, settings: MergedSettings) {
  const existing = asString(settings.targetLorebookId)
  if (existing) {
    if (await isTargetLorebookAvailable(host, existing)) return existing
    host.ui.notify(host.t(k(host, 'notifyTargetLorebookDeleted')), undefined, { level: 'warning' })
    try {
      return await promptRecoverLorebook(host, settings)
    } catch {
      return ''
    }
  }

  if (settings.targetLorebookMode === 'auto') {
    try {
      const id = await createTargetLorebookFromTemplate(host, settings)
      if (!id) return ''
      await host.conversation.patchPluginSettings({ targetLorebookId: id })
      return id
    } catch {
      notifyOutcome(host, 'notifyAutoLorebookFailed', 'error')
      return ''
    }
  }

  host.ui.notify(host.t(k(host, 'notifyTargetLorebookMissingWarn')), undefined, { level: 'warning' })
  try {
    return await promptPickLorebook(host)
  } catch {
    return ''
  }
}

function buildSummarizeTaskOptions(
  host: PluginHost,
  settings: MergedSettings,
  opts?: { memoryLocked?: boolean },
) {
  const options: { value: string; label: string; locked?: boolean }[] = [
    {
      value: 'memory',
      label: host.t(k(host, 'manualTaskMemory')),
      ...(opts?.memoryLocked ? { locked: true } : {}),
    },
  ]
  for (const sc of settings.sidecars) {
    options.push({ value: `sidecar:${sc.id}`, label: sc.name })
  }
  return options
}

function buildAutoSidecarTaskOptions(settings: MergedSettings) {
  return settings.sidecars.map((sc) => ({
    value: `sidecar:${sc.id}`,
    label: sc.name,
  }))
}

function finishLorebookPick(id: string) {
  const resolver = getLorebookPickResolver()
  if (!resolver) return
  clearLorebookPickResolver()
  resolver.resolve(id)
}

function cancelLorebookPick() {
  const resolver = getLorebookPickResolver()
  if (!resolver) return
  clearLorebookPickResolver()
  resolver.reject(new Error('pick_cancelled'))
}

export function registerPickLorebookDialog(host: PluginHost) {
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, 'pickLorebookDialogTitle'),
      bodyKey: k(host, 'pickLorebookDialogBody'),
      fields: [
        {
          key: 'targetLorebookId',
          labelKey: k(host, 'sessionTargetLorebookLabel'),
          type: 'lorebook',
        },
      ],
      submitKey: k(host, 'pickLorebookConfirm'),
      cancelKey: k(host, 'sessionCancel'),
      canSubmit: (m: Record<string, unknown>) => asString(m.targetLorebookId).length > 0,
      onSubmit: async (h: PluginHost, model: Record<string, unknown>) => {
        const id = asString(model.targetLorebookId)
        if (!id) return
        await h.conversation.patchPluginSettings({ targetLorebookId: id })
        finishLorebookPick(id)
      },
      onCancel: () => {
        cancelLorebookPick()
      },
    },
    DIALOG_PICK_LOREBOOK,
  )
}

export function registerRecoverLorebookDialog(host: PluginHost) {
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, 'recoverLorebookDialogTitle'),
      bodyKey: k(host, 'recoverLorebookDialogBody'),
      fields: [
        {
          key: 'mode',
          labelKey: k(host, 'recoverLorebookModeLabel'),
          type: 'radio',
          options: [
            { value: 'pick', labelKey: k(host, 'recoverLorebookModePick') },
            { value: 'create', labelKey: k(host, 'recoverLorebookModeCreate') },
          ],
        },
        {
          key: 'targetLorebookId',
          labelKey: k(host, 'sessionTargetLorebookLabel'),
          type: 'lorebook',
          visibleWhen: { field: 'mode', equals: 'pick' },
        },
      ],
      submitKey: k(host, 'recoverLorebookConfirm'),
      cancelKey: k(host, 'sessionCancel'),
      canSubmit: (m: Record<string, unknown>) => {
        const mode = asString(m.mode)
        if (mode === 'create') return true
        return mode === 'pick' && asString(m.targetLorebookId).length > 0
      },
      onSubmit: async (h: PluginHost, model: Record<string, unknown>) => {
        const mode = asString(model.mode)
        let id = ''
        if (mode === 'create') {
          const settings = await loadMergedSettings(h)
          try {
            id = await createTargetLorebookFromTemplate(h, settings)
          } catch {
            notifyOutcome(h, 'notifyAutoLorebookFailed', 'error')
            return
          }
          if (!id) return
        } else {
          id = asString(model.targetLorebookId)
          if (!id) return
        }
        await applyRecoveredTargetLorebook(h, id)
        finishLorebookPick(id)
      },
      onCancel: () => {
        cancelLorebookPick()
      },
    },
    DIALOG_RECOVER_LOREBOOK,
  )
}

function promptPickLorebook(host: PluginHost) {
  return new Promise<string>((resolve, reject) => {
    host.ui.clearProgress()
    setLorebookPickResolver({ resolve, reject })
    host.openFormDialog(PLUGIN_ID, { targetLorebookId: '' }, DIALOG_PICK_LOREBOOK)
  })
}

export function promptRecoverLorebook(host: PluginHost, settings: MergedSettings) {
  return new Promise<string>((resolve, reject) => {
    host.ui.clearProgress()
    setLorebookPickResolver({ resolve, reject })
    host.openFormDialog(
      PLUGIN_ID,
      {
        mode: settings.targetLorebookMode === 'auto' ? 'create' : 'pick',
        targetLorebookId: '',
      },
      DIALOG_RECOVER_LOREBOOK,
    )
  })
}

function registerSessionDialog(host: PluginHost, settings: MergedSettings) {
  const fields: Record<string, unknown>[] = [
    {
      key: 'targetLorebookId',
      labelKey: k(host, 'sessionTargetLorebookLabel'),
      type: 'lorebook',
      hintKey: k(host, 'sessionTargetLorebookHint'),
    },
    {
      key: 'blockTurns',
      labelKey: k(host, 'sessionBlockTurnsLabel'),
      type: 'integer',
    },
    {
      key: 'bufferTurns',
      labelKey: k(host, 'sessionBufferTurnsLabel'),
      type: 'integer',
    },
    {
      key: 'sidecarEnabled',
      labelKey: k(host, 'sessionSidecarEnabledLabel'),
      type: 'radio',
      options: [
        { value: 'inherit', labelKey: k(host, 'sessionSidecarInherit') },
        { value: 'on', labelKey: k(host, 'sessionSidecarOn') },
        { value: 'off', labelKey: k(host, 'sessionSidecarOff') },
      ],
    },
    {
      key: 'entrySortMode',
      labelKey: k(host, 'entrySortModeLabel'),
      type: 'radio',
      options: [
        { value: 'manual', labelKey: k(host, 'entrySortModeManual') },
        { value: 'auto-turn-suffix', labelKey: k(host, 'entrySortModeAuto-turn-suffix') },
      ],
      hintKey: k(host, 'entrySortModeDesc'),
    },
  ]
  if (settings.sidecars.length > 0) {
    fields.push({
      key: 'autoSidecarTasks',
      labelKey: k(host, 'sessionAutoSidecarsLabel'),
      type: 'checkboxGroup',
      options: buildAutoSidecarTaskOptions(settings),
      hintKey: k(host, 'sessionAutoSidecarsHint'),
    })
  }
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, 'sessionDialogTitle'),
      fields,
      submitKey: k(host, 'sessionSubmit'),
      cancelKey: k(host, 'sessionCancel'),
      canSubmit: () => true,
      onSubmit: async (h: PluginHost, model: Record<string, unknown>) => {
        const patch: Record<string, unknown> = {
          targetLorebookId: asString(model.targetLorebookId),
          blockTurns: asInt(model.blockTurns, 4, 500),
          bufferTurns: asInt(model.bufferTurns, 5, 500),
        }
        if (!patch.targetLorebookId) patch.targetLorebookId = null
        const se = asString(model.sidecarEnabled)
        if (se === 'on') patch.sidecarEnabled = true
        else if (se === 'off') patch.sidecarEnabled = false
        else patch.sidecarEnabled = null
        if (settings.sidecars.length > 0) {
          patch.autoSidecarIds = sidecarIdsFromTaskSelection(model.autoSidecarTasks)
        }
        const sortMode = asString(model.entrySortMode)
        if (sortMode === 'auto-turn-suffix' || sortMode === 'manual') {
          patch.entrySortMode = sortMode
        }
        await h.conversation.patchPluginSettings(patch)
        notifyOutcome(h, 'sessionSubmit', 'success')
      },
    },
    DIALOG_SESSION,
  )
}

function registerSummarizeDialog(
  host: PluginHost,
  settings: MergedSettings,
  mode: 'enable' | 'manual',
) {
  const isEnable = mode === 'enable'
  const dialogId = isEnable ? DIALOG_ENABLE : DIALOG_MANUAL
  const fields: Record<string, unknown>[] = [
    {
      key: 'startTurn',
      labelKey: k(host, 'manualStartTurnLabel'),
      type: 'integer',
      hintKey: k(host, 'manualTurnRangeHint'),
      ...(isEnable ? { readOnly: true } : {}),
    },
    {
      key: 'endTurn',
      labelKey: k(host, 'manualEndTurnLabel'),
      type: 'integer',
      hintKey: k(host, 'manualTurnRangeHint'),
      ...(isEnable ? { readOnly: true } : {}),
    },
  ]
  if (isEnable) {
    if (settings.sidecars.length > 0) {
      fields.push({
        key: 'selectedTasks',
        labelKey: k(host, 'manualTasksLabel'),
        type: 'checkboxGroup',
        options: buildSummarizeTaskOptions(host, settings, { memoryLocked: true }),
        hintKey: k(host, 'enableTasksHint'),
      })
    }
  } else {
    fields.push({
      key: 'selectedTasks',
      labelKey: k(host, 'manualTasksLabel'),
      type: 'checkboxGroup',
      options: buildSummarizeTaskOptions(host, settings, { memoryLocked: false }),
      hintKey: k(host, 'manualTasksHint'),
    })
  }
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, isEnable ? 'enableDialogTitle' : 'manualDialogTitle'),
      bodyKey: k(host, isEnable ? 'enableDialogBody' : 'manualDialogBody'),
      fields,
      submitKey: k(host, isEnable ? 'enableSubmit' : 'manualSubmit'),
      cancelKey: k(host, 'sessionCancel'),
      ...(!isEnable
        ? {
            regenerateKey: k(host, 'manualPreviewPrompt'),
            regenerateVisible: (h: PluginHost) => auditDebugEnabled(h),
            regenerateCanSubmit: (m: Record<string, unknown>) =>
              summarizeDialogCanPreview(m, settings),
            onRegenerate: async (h: PluginHost, model: Record<string, unknown>) => {
              await previewManualSummarizePrompt(h, model)
            },
          }
        : {}),
      canSubmit: (m: Record<string, unknown>) => {
        const start = asInt(m.startTurn, -1, 500_000)
        const end = asInt(m.endTurn, -1, 500_000)
        if (start < 0 || end < start) return false
        if (isSummarizeTurnSpanTooLarge(start, end)) return false
        if (isEnable) return true
        return tasksFromSelection(settings, m.selectedTasks).length > 0
      },
      onSubmit: async (h: PluginHost, model: Record<string, unknown>) => {
        const fromTurn = asInt(model.startTurn, 0, 500_000)
        const toTurn = asInt(model.endTurn, fromTurn, 500_000)
        if (isSummarizeTurnSpanTooLarge(fromTurn, toTurn)) {
          h.ui.notify(h.t(k(h, 'notifyTurnRangeTooLong')), undefined, { level: 'warning' })
          return
        }
        const selectedTasks = isEnable
          ? [
              'memory',
              ...sidecarIdsFromTaskSelection(model.selectedTasks).map(
                (id) => `sidecar:${id}`,
              ),
            ]
          : model.selectedTasks
        const tasks = tasksFromSelection(settings, selectedTasks)
        if (tasks.length === 0) {
          h.ui.notify(h.t(k(h, 'notifyNoTasksSelected')), undefined, { level: 'warning' })
          return
        }
        if (isEnable) {
          const autoSidecarIds = sidecarIdsFromTaskSelection(model.selectedTasks)
          await h.conversation.patchPluginSettings({
            autoSummarizeEnabled: true,
            nextBlockStart: fromTurn,
            autoSidecarIds,
          })
          refreshAutoSummarizeUi(h)
        } else {
          await h.conversation.patchPluginSettings({
            manualSummarizeTasks: normalizeManualTaskSelection(
              model.selectedTasks,
              settings.sidecars,
            ),
          })
        }
        await runSummarizeTasks(h, {
          fromTurn,
          toTurn,
          tasks,
          updatePointers: isEnable || tasks.some((t) => t.kind === 'memory'),
          updateAutoSummarizeCache: false,
        })
      },
    },
    dialogId,
  )
}

export async function reorderTargetLorebookNow(host: PluginHost) {
  const settings = await loadMergedSettings(host)
  const targetId = asString(settings.targetLorebookId)
  if (!targetId) {
    host.ui.notify(host.t(k(host, 'notifyReorderLorebookNoTarget')), undefined, { level: 'warning' })
    return
  }
  try {
    const sidecarEntryIds = await host.lorebook.normalizeEntryRefs({
      lorebookId: targetId,
      entryIds: settings.sidecarEntryIds,
      validKeys: settings.sidecars.map((s) => s.id),
    })
    await applyPlotSummaryEntrySort(
      host,
      targetId,
      sidecarEntryIds,
      settings.sidecars.map((s) => s.id),
    )
    notifyOutcome(host, 'notifyReorderLorebookDone', 'success')
  } catch (e) {
    console.warn('[plot-summary] reorder lorebook failed', e)
    host.ui.notify(host.t(k(host, 'notifyTaskSkipped')), undefined, { level: 'warning' })
  }
}

export function openSessionSettings(host: PluginHost) {
  loadMergedSettings(host).then((s) => {
    registerSessionDialog(host, s)
    let sidecarEnabled = 'inherit'
    if (s.conv.sidecarEnabled === true) sidecarEnabled = 'on'
    if (s.conv.sidecarEnabled === false) sidecarEnabled = 'off'
    const model: Record<string, unknown> = {
      targetLorebookId: s.targetLorebookId,
      blockTurns: s.blockTurns,
      bufferTurns: s.bufferTurns,
      sidecarEnabled,
      entrySortMode: s.entrySortMode,
    }
    if (s.sidecars.length > 0) {
      model.autoSidecarTasks = s.autoSidecarIds.map((id) => `sidecar:${id}`)
    }
    host.openFormDialog(PLUGIN_ID, model, DIALOG_SESSION)
  })
}

export function openManualSummarize(
  host: PluginHost,
  preset?: { startTurn: number; endTurn: number },
) {
  loadMergedSettings(host).then((s) => {
    registerSummarizeDialog(host, s, 'manual')
    const { startTurn, endTurn } = manualSummarizeDefaultRange(
      s,
      preset,
      maxTurnOrdinal(host),
    )
    host.openFormDialog(
      PLUGIN_ID,
      {
        startTurn,
        endTurn,
        selectedTasks: [...s.manualSummarizeTasks],
      },
      DIALOG_MANUAL,
    )
  })
}

function openEnableLongDialog(host: PluginHost, settings: MergedSettings) {
  const { startTurn, endTurn } = tailAnchoredBlockRange(maxTurnOrdinal(host), settings)
  const selectedTasks = [
    'memory',
    ...settings.sidecars.map((sc) => `sidecar:${sc.id}`),
  ]
  registerSummarizeDialog(host, settings, 'enable')
  host.openFormDialog(PLUGIN_ID, { startTurn, endTurn, selectedTasks }, DIALOG_ENABLE)
}

/** 已有摘要进度时重新开启：从 lastSummarizedEnd+1 续跑，不弹「按尾部重算区间」 */
async function resumeAutoSummarizeEnable(host: PluginHost, settings: MergedSettings) {
  const nextBlockStart = normalizedNextBlockStart(
    settings.nextBlockStart,
    settings.lastSummarizedEnd,
  )
  const trigger = firstAutoTriggerTurnOrdinal({ ...settings, nextBlockStart })
  const range = currentAutoRange({ ...settings, nextBlockStart })
  await host.conversation.patchPluginSettings({
    autoSummarizeEnabled: true,
    nextBlockStart,
  })
  refreshAutoSummarizeUi(host)
  host.ui.notify(host.t(k(host, 'notifyAutoSummarizeResumed'), {
      from: range.fromTurn,
      to: range.toTurn,
      turn: trigger,
    }), undefined, { level: 'success' })
}

export async function applyShortAutoSummarizeEnable(host: PluginHost, settings: MergedSettings) {
  const X = firstAutoTriggerTurnOrdinal({ ...settings, nextBlockStart: 0 })
  const autoSidecarIds = parseAutoSidecarIdsRaw(null, settings.sidecars)
  await host.conversation.patchPluginSettings({
    autoSummarizeEnabled: true,
    nextBlockStart: 0,
    autoSidecarIds,
  })
  refreshAutoSummarizeUi(host)
  host.ui.notify(host.t(k(host, 'notifyAutoSummarizeScheduled'), { turn: X }), undefined, {
    level: 'success',
  })
}

async function tryEnableAutoSummarize(host: PluginHost) {
  const settings = await loadMergedSettings(host)
  if (hasAutoSummarizeHistory(settings)) {
    await resumeAutoSummarizeEnable(host, settings)
    return
  }
  const T = maxTurnOrdinal(host)
  const N = settings.blockTurns
  const buffer = settings.bufferTurns
  if (T > N + buffer) {
    openEnableLongDialog(host, settings)
    return
  }
  await applyShortAutoSummarizeEnable(host, settings)
}

export async function toggleAutoSummarize(host: PluginHost) {
  if (isAutoSummarizeEnabled(host)) {
    await host.conversation.patchPluginSettings({ autoSummarizeEnabled: false })
    host.ui.notify(host.t(k(host, 'notifyAutoSummarizeDisabled')), undefined, { level: 'info' })
    return
  }
  await tryEnableAutoSummarize(host)
}

export function isBusy(host: PluginHost) {
  return (
    host.session.conversationWriteLocked ||
    host.session.loading ||
    host.session.regeneratingTurnOrdinal !== null
  )
}

export { summarizeRunning }
