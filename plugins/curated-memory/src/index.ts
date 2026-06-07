import { PLUGIN_ID } from './constants.js'
import {
  isBusy,
  openManualSummarize,
  openSessionSettings,
  refreshMemorybookState,
  registerPickLorebookDialog,
  summarizeRunning,
  toggleMemorybook,
} from './dialogs.js'
import { registerLifecycle } from './lifecycle.js'
import { registerReviewDialogs } from './review.js'
import { k } from './settings.js'
import { memorybookEnabledCache } from './state.js'
import type { PluginHost } from './types.js'

export function register(host: PluginHost) {
  registerReviewDialogs(host)
  registerPickLorebookDialog(host)
  void refreshMemorybookState(host)

  host.registerSlotButton('composer-toolbar', {
    id: `${PLUGIN_ID}-menu`,
    icon: 'mdi-book-open-page-variant',
    tooltipKey: k(host, 'tooltipCuratedMemory'),
    filled: () => memorybookEnabledCache,
    menu: [
      {
        id: `${PLUGIN_ID}-memorybook`,
        labelKey: k(host, 'tooltipMemorybook'),
        icon: 'mdi-book-open-page-variant',
        filled: () => memorybookEnabledCache,
        disabled: () => summarizeRunning,
        onClick: () => {
          void toggleMemorybook(host)
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
    ],
  })

  registerLifecycle(host)
}
