import { PLUGIN_ID } from './constants.js'
import {
  isBusy,
  openManualSummarize,
  openSessionSettings,
  reorderTargetLorebookNow,
  refreshAutoSummarizeUi,
  registerPickLorebookDialog,
  registerRecoverLorebookDialog,
  summarizeRunning,
  toggleAutoSummarize,
} from './dialogs.js'
import { registerLifecycle } from './lifecycle.js'
import { registerPromptPreviewDialog } from './prompt-preview.js'
import { registerRangePicker } from './range-picker.js'
import { registerReviewDialogs } from './review.js'
import { k } from './settings.js'
import type { PluginHost } from './types.js'

function isAutoSummarizeEnabled(host: PluginHost): boolean {
  return host.conversation.getPluginSettingsSnapshot().autoSummarizeEnabled === true
}

export function register(host: PluginHost) {
  registerReviewDialogs(host)
  registerPromptPreviewDialog(host)
  registerPickLorebookDialog(host)
  registerRecoverLorebookDialog(host)

  host.conversation.onPluginSettingsChanged(() => {
    refreshAutoSummarizeUi(host)
  })
  void host.conversation.getPluginSettings()

  host.registerSlotButton('composer-toolbar', {
    id: `${PLUGIN_ID}-menu`,
    icon: 'mdi-book-open-page-variant',
    tooltipKey: k(host, 'tooltipPlugin'),
    filled: () => isAutoSummarizeEnabled(host),
    menu: [
      {
        id: `${PLUGIN_ID}-auto-summarize`,
        labelKey: k(host, 'tooltipAutoSummarize'),
        icon: 'mdi-book-open-page-variant',
        filled: () => isAutoSummarizeEnabled(host),
        disabled: () => summarizeRunning,
        onClick: () => {
          void toggleAutoSummarize(host)
        },
      },
      {
        id: `${PLUGIN_ID}-manual`,
        labelKey: k(host, 'tooltipManualSummarize'),
        icon: 'mdi-book-edit-outline',
        disabled: () => isBusy(host) || summarizeRunning,
        onClick: () => openManualSummarize(host),
      },
      {
        id: `${PLUGIN_ID}-session`,
        labelKey: k(host, 'tooltipSessionSettings'),
        icon: 'mdi-tune-variant',
        onClick: () => openSessionSettings(host),
      },
      {
        id: `${PLUGIN_ID}-reorder`,
        labelKey: k(host, 'tooltipReorderLorebook'),
        icon: 'mdi-sort',
        disabled: () => isBusy(host) || summarizeRunning,
        onClick: () => {
          void reorderTargetLorebookNow(host)
        },
      },
    ],
  })

  registerRangePicker(host)
  registerLifecycle(host)
}
