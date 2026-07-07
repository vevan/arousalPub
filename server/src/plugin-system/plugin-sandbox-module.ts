import { getCurrentUserId } from '../user-context.js'
import type { PluginServerModule } from './types.js'
import { getPluginWorkerClient } from './plugin-worker-client.js'

export async function createSandboxPluginModule(
  pluginId: string,
  entryPath: string,
): Promise<PluginServerModule> {
  const client = getPluginWorkerClient(pluginId, entryPath)
  await client.start()
  const hooks = client.getExportedHooks()
  const uid = () => getCurrentUserId()

  const invoke = (hook: string, args: unknown[]) =>
    client.invoke(hook, args, uid())

  const mod: PluginServerModule = {}

  if (hooks.has('afterAssemblePrompts')) {
    mod.afterAssemblePrompts = (ctx, _api) =>
      invoke('afterAssemblePrompts', [ctx]) as ReturnType<
        NonNullable<PluginServerModule['afterAssemblePrompts']>
      >
  }
  if (hooks.has('resolveAfterAssemblePromptsAddition')) {
    mod.resolveAfterAssemblePromptsAddition = (ctx, _api) =>
      invoke('resolveAfterAssemblePromptsAddition', [ctx]) as ReturnType<
        NonNullable<PluginServerModule['resolveAfterAssemblePromptsAddition']>
      >
  }
  if (hooks.has('resolveTurnPluginEntries')) {
    mod.resolveTurnPluginEntries = (plugins, _api) =>
      invoke('resolveTurnPluginEntries', [plugins]) as ReturnType<
        NonNullable<PluginServerModule['resolveTurnPluginEntries']>
      >
  }
  if (hooks.has('resolveTurnPluginEntriesFromAssistant')) {
    mod.resolveTurnPluginEntriesFromAssistant = (ctx, _api) =>
      invoke('resolveTurnPluginEntriesFromAssistant', [ctx]) as ReturnType<
        NonNullable<PluginServerModule['resolveTurnPluginEntriesFromAssistant']>
      >
  }
  if (hooks.has('formatPluginContextBlocks')) {
    mod.formatPluginContextBlocks = (resolved, ctx) =>
      invoke('formatPluginContextBlocks', [resolved, ctx ?? {}]) as ReturnType<
        NonNullable<PluginServerModule['formatPluginContextBlocks']>
      >
  }
  if (hooks.has('parseCompleteDraftContent')) {
    mod.parseCompleteDraftContent = (ctx, content, _api) =>
      invoke('parseCompleteDraftContent', [ctx, content]) as ReturnType<
        NonNullable<PluginServerModule['parseCompleteDraftContent']>
      >
  }
  if (hooks.has('runPluginAction')) {
    mod.runPluginAction = (action, body, _api) =>
      invoke('runPluginAction', [action, body]) as ReturnType<
        NonNullable<PluginServerModule['runPluginAction']>
      >
  }
  if (hooks.has('resolveConversationPersistExtras')) {
    mod.resolveConversationPersistExtras = (ctx, _api) =>
      invoke('resolveConversationPersistExtras', [ctx]) as ReturnType<
        NonNullable<PluginServerModule['resolveConversationPersistExtras']>
      >
  }
  if (hooks.has('onCharacterPrimaryChanged')) {
    mod.onCharacterPrimaryChanged = (ctx, _api) =>
      invoke('onCharacterPrimaryChanged', [ctx]) as ReturnType<
        NonNullable<PluginServerModule['onCharacterPrimaryChanged']>
      >
  }

  return mod
}
