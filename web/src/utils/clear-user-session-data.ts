import { getActivePinia } from 'pinia'
import { useApiKeysStore } from '@/stores/apiKeys'
import { useConnectionStore } from '@/stores/connection'
import { useConversationPluginSettingsStore } from '@/stores/conversation-plugin-settings'
import { useLorebooksStore } from '@/stores/lorebooks'
import { usePluginUserSettingsStore } from '@/stores/plugin-user-settings'
import { usePreferencesStore } from '@/stores/preferences'
import { usePromptsStore } from '@/stores/prompts'
import { useRegexRulesDisplayStore } from '@/stores/regex-rules-display'
import { useRegexRulesStore } from '@/stores/regex-rules'
import { useUiContextStore } from '@/stores/ui-context'
import { invalidateRegexHostRulesCache } from '@/plugins/plugin-host-regex'
import { clearPluginUserSettingsInflight } from '@/utils/plugin-user-settings-loader'
import {
  clearUserSessionLocalStorage,
  clearUserSessionStorage,
} from '@/utils/user-session-storage'

/** 登出 / 会话失效：清空 Pinia 用户缓存与浏览器会话 localStorage */
export function clearUserBrowserSessionData(): void {
  clearUserSessionLocalStorage()
  clearUserSessionStorage()
  clearPluginUserSettingsInflight()
  invalidateRegexHostRulesCache()

  if (!getActivePinia()) return

  usePluginUserSettingsStore().clearAll()
  useConversationPluginSettingsStore().clearAll()
  usePreferencesStore().clearSessionData()
  useApiKeysStore().clearSessionData()
  useConnectionStore().clearSessionData()
  usePromptsStore().clearSessionData()
  useLorebooksStore().clearSessionData()
  useRegexRulesStore().clearSessionData()
  useRegexRulesDisplayStore().invalidate()
  useUiContextStore().clearSessionData()
}
