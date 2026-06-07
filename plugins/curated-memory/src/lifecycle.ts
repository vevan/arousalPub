import {
  currentAutoRange,
  loadMergedSettings,
  resolveAutoTasks,
  shouldAutoTrigger,
} from './settings.js'
import { runSummarizeTasks } from './pipeline.js'
import { applyShortMemorybookEnable } from './dialogs.js'
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

async function tryBootstrapDefaultMemorybook(
  host: PluginHost,
  event: { isFirstTurn?: boolean },
) {
  if (!event.isFirstTurn) return
  const conv = await host.conversation.getPluginSettings()
  if (conv.memorybookEnabled === true || conv.memorybookEnabled === false) return
  const global = await host.plugins.getUserSettings()
  if (!asBool(global.memorybookDefaultEnabled, false)) return
  const settings = await loadMergedSettings(host)
  await applyShortMemorybookEnable(host, settings)
}

async function handleAutoSummarizeTurn(host: PluginHost, turnOrdinal: number) {
  const settings = await loadMergedSettings(host)
  if (!settings.memorybookEnabled) return
  if (!settings.apiConfigId) return
  if (!shouldAutoTrigger(turnOrdinal, settings)) return
  const range = currentAutoRange(settings)
  const tasks = resolveAutoTasks(settings)
  await runSummarizeTasks(host, {
    fromTurn: range.fromTurn,
    toTurn: range.toTurn,
    tasks,
    updatePointers: true,
    updateMemorybookCache: false,
  })
}

export function registerLifecycle(host: PluginHost) {
  host.lifecycle.onAssistantReplyPersisted((event) => {
    const turnOrdinal = event.turnOrdinal
    if (typeof turnOrdinal !== 'number' || turnOrdinal < 0) return
    scheduleWhenConversationIdle(host, async () => {
      try {
        await tryBootstrapDefaultMemorybook(host, event)
        await handleAutoSummarizeTurn(host, turnOrdinal)
      } catch (e) {
        console.warn('[curated-memory] auto summarize failed', e)
      }
    })
  })
}
