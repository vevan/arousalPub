import {
  DIALOG_PICK_LOREBOOK,
  DIALOG_RECOVER_LOREBOOK,
  PLUGIN_ID,
} from './constants.js'
import { isLorebookNotFoundError } from './errors.js'
import { notifyOutcome } from './notify-outcome.js'
import { setLorebookPickResolver } from './state.js'
import { tKey } from './settings.js'
import { asString } from './shared/utils.js'
import type { MergedSettings, PluginHost } from './types.js'

/**
 * 目标世界书（target lorebook）确保 / 恢复 / 绑定流程。
 * 从 dialogs 拆出（打断 pipeline ↔ dialogs 双向值环）：两者均经本模块单向依赖。
 */

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

export async function applyRecoveredTargetLorebook(host: PluginHost, lorebookId: string) {
  await host.conversation.patchPluginSettings({
    targetLorebookId: lorebookId,
    sidecarEntryIds: null,
  })
}

export async function createTargetLorebookFromTemplate(host: PluginHost, settings: MergedSettings) {
  const ensured = await host.lorebook.ensure({
    nameTemplate: settings.autoLorebookNameTemplate,
  })
  const id = asString(ensured?.id)
  if (!id) {
    notifyOutcome(host, 'notifyAutoLorebookFailed', 'error')
    return ''
  }
  const name = ensured.name || id
  notifyOutcome(host, 'notifyAutoLorebookCreated', 'success', { name })
  await promptBindCreatedLorebook(host, id, name)
  return id
}

async function promptBindCreatedLorebook(
  host: PluginHost,
  lorebookId: string,
  lorebookName: string,
) {
  const ok = await host.ui.confirm({
    title: host.t(tKey(host, 'bindLorebookConfirmTitle')),
    body: host.t(tKey(host, 'bindLorebookConfirmBody'), { name: lorebookName }),
    confirmLabel: host.t(tKey(host, 'bindLorebookConfirm')),
    cancelLabel: host.t(tKey(host, 'bindLorebookSkip')),
  })
  if (!ok) return
  const current = await host.conversation.getLorebookIds()
  if (current.includes(lorebookId)) return
  await host.conversation.patchLorebookIds([...current, lorebookId])
  notifyOutcome(host, 'notifyLorebookBound', 'success', { name: lorebookName })
}

export async function ensureTargetLorebook(host: PluginHost, settings: MergedSettings) {
  const existing = asString(settings.targetLorebookId)
  if (existing) {
    if (await isTargetLorebookAvailable(host, existing)) return existing
    host.ui.notify(host.t(tKey(host, 'notifyTargetLorebookDeleted')), undefined, { level: 'warning' })
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

  host.ui.notify(host.t(tKey(host, 'notifyTargetLorebookMissingWarn')), undefined, { level: 'warning' })
  try {
    return await promptPickLorebook(host)
  } catch {
    return ''
  }
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
