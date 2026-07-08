import { useUiContextStore } from '../stores/ui-context.js'
import type { NotificationAction } from './notification-storage.js'

const SETTINGS_TABS = new Set([
  'system',
  'display',
  'account',
  'lorebook',
  'vectorRecall',
  'history',
  'budgetTrim',
  'regexRules',
  'plugins',
  'import',
  'debug',
])

async function pushRoute(location: Parameters<
  Awaited<typeof import('../router/index.js')>['router']['push']
>[0]): Promise<void> {
  const { router } = await import('../router/index.js')
  await router.push(location)
}

export async function executeNotificationAction(
  action: NotificationAction | undefined,
): Promise<void> {
  if (!action?.type) return
  const uiContext = useUiContextStore()

  switch (action.type) {
    case 'conversation': {
      const id = action.conversationId?.trim()
      if (!id) return
      await pushRoute({ name: 'chat', params: { conversationId: id } })
      return
    }
    case 'route': {
      const href = action.href?.trim()
      if (!href) return
      await pushRoute(href)
      return
    }
    case 'settings-tab': {
      const tab = action.settingsTab?.trim()
      uiContext.requestOpenSettingsDialog(
        tab && SETTINGS_TABS.has(tab) ? tab : null,
      )
      return
    }
    case 'library-panel': {
      if (action.panel === 'lorebooks') {
        uiContext.requestOpenLorebooksDialog(action.focusId)
      } else if (action.panel === 'prompts') {
        uiContext.requestOpenPromptsDialog(action.focusId)
      } else if (action.panel === 'characters') {
        uiContext.requestOpenCharactersDialog(action.focusId)
      }
      return
    }
    case 'external': {
      const href = action.href?.trim()
      if (!href || typeof window === 'undefined') return
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }
}
