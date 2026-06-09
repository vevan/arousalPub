import {
  currentAutoRange,
  loadMergedSettings,
  resolveAutoTasks,
  shouldAutoTrigger,
} from './settings.js'
import { runSummarizeTasks } from './pipeline.js'
import { applyShortAutoSummarizeEnable } from './dialogs.js'
import { asBool } from './shared/utils.js'
import { summarizeRunning } from './state.js'
import type { PluginHost } from './types.js'

function isPersistBusy(host: PluginHost) {
  return (
    host.session.conversationWriteLocked ||
    host.session.loading ||
    host.session.regeneratingTurnOrdinal !== null
  )
}

function scheduleWhenConversationIdle(host: PluginHost, fn: () => void | Promise<void>) {
  const attempt = () => {
    if (summarizeRunning || isPersistBusy(host)) {
      setTimeout(attempt, 40)
      return
    }
    void fn()
  }
  setTimeout(attempt, 0)
}

async function tryBootstrapDefaultAutoSummarize(
  host: PluginHost,
  event: { isFirstTurn?: boolean },
) {
  if (!event.isFirstTurn) return
  const conv = await host.conversation.getPluginSettings()
  if (conv.autoSummarizeEnabled === true || conv.autoSummarizeEnabled === false) return
  const global = await host.plugins.getUserSettings()
  if (!asBool(global.autoSummarizeDefaultEnabled, false)) return
  const settings = await loadMergedSettings(host)
  await applyShortAutoSummarizeEnable(host, settings)
}

async function handleAutoSummarizeTurn(host: PluginHost, turnOrdinal: number) {
  const settings = await loadMergedSettings(host)
  if (!settings.autoSummarizeEnabled) return
  if (!shouldAutoTrigger(turnOrdinal, settings)) return
  const range = currentAutoRange(settings)
  const tasks = resolveAutoTasks(settings)
  await runSummarizeTasks(host, {
    fromTurn: range.fromTurn,
    toTurn: range.toTurn,
    tasks,
    updatePointers: true,
    updateAutoSummarizeCache: false,
  })
}

export function registerLifecycle(host: PluginHost) {
  host.lifecycle.onAssistantReplyPersisted((event) => {
    const turnOrdinal = event.turnOrdinal
    if (typeof turnOrdinal !== 'number' || turnOrdinal < 0) return
    scheduleWhenConversationIdle(host, async () => {
      try {
        await tryBootstrapDefaultAutoSummarize(host, event)
        await handleAutoSummarizeTurn(host, turnOrdinal)
      } catch (e) {
        console.warn('[plot-summary] auto summarize failed', e)
      }
    })
  })
}
