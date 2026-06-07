import {
  PLUGIN_ID,
  DIALOG_ENABLE,
  DIALOG_MANUAL,
  DIALOG_PICK_LOREBOOK,
  DIALOG_SESSION,
} from './constants.js'
import { runSummarizeTasks } from './pipeline.js'
import {
  clearLorebookPickResolver,
  getLorebookPickResolver,
  memorybookEnabledCache,
  setLorebookPickResolver,
  setMemorybookEnabledCache,
  summarizeRunning,
} from './state.js'
import { asInt, asString } from './shared/utils.js'
import {
  firstAutoTriggerTurnOrdinal,
  k,
  loadMergedSettings,
  maxTurnOrdinal,
  parseAutoSidecarIdsRaw,
  sidecarIdsFromTaskSelection,
  tasksFromSelection,
} from './settings.js'
import type { MergedSettings, PluginHost } from './types.js'

export async function refreshMemorybookState(host: PluginHost) {
  try {
    const conv = await host.conversation.getPluginSettings()
    setMemorybookEnabledCache(conv.memorybookEnabled === true)
  } catch {
    setMemorybookEnabledCache(false)
  }
  host.refreshSlotButtons()
}

export async function ensureTargetLorebook(host: PluginHost, settings: MergedSettings) {
  const existing = asString(settings.targetLorebookId)
  if (existing) return existing
  host.ui.toast(host.t(k(host, 'toastTargetLorebookMissingWarn')), { color: 'warning' })
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
        const resolver = getLorebookPickResolver()
        if (resolver) {
          clearLorebookPickResolver()
          resolver.resolve(id)
        }
      },
      onCancel: () => {
        const resolver = getLorebookPickResolver()
        if (!resolver) return
        clearLorebookPickResolver()
        resolver.reject(new Error('pick_cancelled'))
      },
    },
    DIALOG_PICK_LOREBOOK,
  )
}

function promptPickLorebook(host: PluginHost) {
  return new Promise<string>((resolve, reject) => {
    setLorebookPickResolver({ resolve, reject })
    host.openFormDialog(PLUGIN_ID, { targetLorebookId: '' }, DIALOG_PICK_LOREBOOK)
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
        await h.conversation.patchPluginSettings(patch)
        h.ui.toast(h.t(k(h, 'sessionSubmit')), { color: 'success' })
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
      ...(isEnable ? { readOnly: true } : {}),
    },
    {
      key: 'endTurn',
      labelKey: k(host, 'manualEndTurnLabel'),
      type: 'integer',
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
      canSubmit: (m: Record<string, unknown>) => {
        const start = asInt(m.startTurn, -1, 500_000)
        const end = asInt(m.endTurn, -1, 500_000)
        if (start < 0 || end < start) return false
        if (isEnable) return true
        return tasksFromSelection(settings, m.selectedTasks).length > 0
      },
      onSubmit: async (h: PluginHost, model: Record<string, unknown>) => {
        const fromTurn = asInt(model.startTurn, 0, 500_000)
        const toTurn = asInt(model.endTurn, fromTurn, 500_000)
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
          h.ui.toast(h.t(k(h, 'toastNoTasksSelected')), { color: 'warning' })
          return
        }
        if (isEnable) {
          const autoSidecarIds = sidecarIdsFromTaskSelection(model.selectedTasks)
          await h.conversation.patchPluginSettings({
            memorybookEnabled: true,
            nextBlockStart: fromTurn,
            autoSidecarIds,
          })
          await refreshMemorybookState(h)
        }
        await runSummarizeTasks(h, {
          fromTurn,
          toTurn,
          tasks,
          updatePointers: isEnable || tasks.some((t) => t.kind === 'memory'),
          updateMemorybookCache: false,
        })
      },
    },
    dialogId,
  )
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
    }
    if (s.sidecars.length > 0) {
      model.autoSidecarTasks = s.autoSidecarIds.map((id) => `sidecar:${id}`)
    }
    host.openFormDialog(PLUGIN_ID, model, DIALOG_SESSION)
  })
}

export function openManualSummarize(host: PluginHost) {
  loadMergedSettings(host).then((s) => {
    registerSummarizeDialog(host, s, 'manual')
    const maxOrd = Math.max(0, maxTurnOrdinal(host))
    host.openFormDialog(
      PLUGIN_ID,
      { startTurn: 0, endTurn: maxOrd, selectedTasks: ['memory'] },
      DIALOG_MANUAL,
    )
  })
}

function openEnableLongDialog(host: PluginHost, settings: MergedSettings) {
  const T = maxTurnOrdinal(host)
  const N = settings.blockTurns
  const buffer = settings.bufferTurns
  const endTurn = T - buffer
  const startTurn = Math.max(0, endTurn - (N - 1))
  const selectedTasks = [
    'memory',
    ...settings.sidecars.map((sc) => `sidecar:${sc.id}`),
  ]
  registerSummarizeDialog(host, settings, 'enable')
  host.openFormDialog(PLUGIN_ID, { startTurn, endTurn, selectedTasks }, DIALOG_ENABLE)
}

export async function applyShortMemorybookEnable(host: PluginHost, settings: MergedSettings) {
  const X = firstAutoTriggerTurnOrdinal({ ...settings, nextBlockStart: 0 })
  const autoSidecarIds = parseAutoSidecarIdsRaw(null, settings.sidecars)
  await host.conversation.patchPluginSettings({
    memorybookEnabled: true,
    nextBlockStart: 0,
    autoSidecarIds,
  })
  await refreshMemorybookState(host)
  host.ui.toast(host.t(k(host, 'toastMemorybookScheduled'), { turn: X }), {
    color: 'success',
  })
}

async function tryEnableMemorybook(host: PluginHost) {
  const settings = await loadMergedSettings(host)
  const T = maxTurnOrdinal(host)
  const N = settings.blockTurns
  const buffer = settings.bufferTurns
  if (T > N + buffer) {
    openEnableLongDialog(host, settings)
    return
  }
  await applyShortMemorybookEnable(host, settings)
}

export async function toggleMemorybook(host: PluginHost) {
  if (memorybookEnabledCache) {
    await host.conversation.patchPluginSettings({ memorybookEnabled: false })
    await refreshMemorybookState(host)
    host.ui.toast(host.t(k(host, 'toastMemorybookDisabled')), { color: 'info' })
    return
  }
  await tryEnableMemorybook(host)
}

export function isBusy(host: PluginHost) {
  return (
    host.session.conversationWriteLocked ||
    host.session.loading ||
    host.session.regeneratingTurnOrdinal !== null
  )
}

export { summarizeRunning }
