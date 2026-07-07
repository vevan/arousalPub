/** Worker 内需注入 api 参数的 hook 名（bootstrap / protocol 共用） */
export const HOOKS_WITH_API = new Set([
  'afterAssemblePrompts',
  'resolveAfterAssemblePromptsAddition',
  'resolveTurnPluginEntries',
  'resolveTurnPluginEntriesFromAssistant',
  'parseCompleteDraftContent',
  'runPluginAction',
  'resolveConversationPersistExtras',
  'onCharacterPrimaryChanged',
])
