import type { ComposerRef, useChatSession } from '@/composables/useChatSession'
import type {
  OpenPluginFormState,
  PluginConfirmOptions,
  PluginFormDialogDef,
  PluginNotifyOptions,
  PluginProgressOptions,
  PluginSlotButtonDef,
  PluginSlotContext,
  PluginFormDialogOpenOpts,
  PluginWebHost,
} from '@/plugins/types'
import {
  showPluginConfirm,
  showPluginProgress,
  clearPluginProgress,
  getPluginProgressAbortSignal,
} from '@/plugins/plugin-ui-state'
import { sendPluginNotify } from '@/plugins/plugin-notify'
import { registerComposerSlashCommand as registerComposerSlashCommandInRegistry } from '@/utils/composer-slash-registry'
import { useAuthStore } from '@/stores/auth'
import {
  fetchConversationMeta,
} from '@/plugins/conversation-meta'
import {
  createLorebookEntriesBatch,
  createLorebookEntry,
  ensureLorebook,
  fetchApiPresets,
  fetchConversationPluginSettings,
  fetchLorebookById,
  fetchLorebookList,
  normalizeLorebookEntryRefs,
  applyLorebookOrder,
  fetchConversationLorebookIds,
  patchConversationLorebookIds,
  patchConversationPluginSettings,
  patchLorebookEntry,
  expandPluginMacros,
  runPluginComplete,
  runPluginCompletePreflight,
  runPluginPrepareContextBlocks,
  runAssemblePluginPrompt,
  runCompleteWithContext,
  runPluginAction,
} from '@/plugins/plugin-host-api'
import {
  applyRegexMessagesForHost,
  applyRegexTextForHost,
  listRegexRulesForHost,
} from '@/plugins/plugin-host-regex'
import {
  renderRichMessageToHtml,
  renderReasoningMarkdownToHtml,
} from '@/utils/render-rich-message'
import { registerPluginStyles } from '@/plugins/plugin-slot-styles'
import {
  onPluginPanelEvent,
  openPluginPanel,
  registerPluginPanel,
  setPluginPanelHtml,
  setPluginPanelHidden,
} from '@/plugins/plugin-panel-registry'
import {
  assertPluginConversationRead,
  PLUGIN_CONVERSATION_BINDINGS_WRITE,
  wrapConversationHostForPlugin,
} from '@/plugins/conversation-host-gate'
import { useConversationPluginSettingsStore } from '@/stores/conversation-plugin-settings'
import { usePluginUserSettingsStore } from '@/stores/plugin-user-settings'
import { loadPluginUserSettings } from '@/utils/plugin-user-settings-loader'
import { assertPluginPermission } from '@/plugins/plugin-permission-gate'
import { usePluginPermissionsStore } from '@/stores/plugin-permissions'
import { translatePluginI18nKey } from '@/utils/plugin-locale-text'
import { useI18n } from 'vue-i18n'
import { ref, type Ref } from 'vue'

type ChatSession = ReturnType<typeof useChatSession>

export function formDialogKey(pluginId: string, dialogId?: string): string {
  const pid = pluginId.trim()
  const did = dialogId?.trim()
  return did ? `${pid}::${did}` : pid
}

function openPluginFormState(
  pluginId: string,
  model: Record<string, unknown>,
  dialogId?: string,
  opts?: PluginFormDialogOpenOpts,
): OpenPluginFormState {
  const state: OpenPluginFormState = {
    pluginId,
    dialogId,
    model: { ...model },
  }
  if (opts?.titleParams && Object.keys(opts.titleParams).length > 0) {
    state.titleParams = { ...opts.titleParams }
  }
  return state
}

export function createScopedPluginHost(
  base: PluginWebHost,
  pluginId: string,
): PluginWebHost {
  const id = pluginId.trim()
  const convId = () => base.conversation.getId()
  const gatedConversation = wrapConversationHostForPlugin(base.conversation, id)
  return {
    ...base,
    pluginKey(key: string) {
      return `plugins.${id}.${key}`
    },
    conversation: {
      ...gatedConversation,
      getPluginSettings() {
        assertPluginConversationRead(id)
        const store = useConversationPluginSettingsStore()
        const cid = convId()
        if (store.isLoaded(cid, id)) {
          return Promise.resolve(store.getSnapshot(cid, id))
        }
        return fetchConversationPluginSettings(cid, id)
      },
      getPluginSettingsSnapshot() {
        assertPluginConversationRead(id)
        return useConversationPluginSettingsStore().getSnapshot(convId(), id)
      },
      onPluginSettingsChanged(handler) {
        assertPluginConversationRead(id)
        return useConversationPluginSettingsStore().subscribe(
          convId(),
          id,
          handler,
        )
      },
      patchPluginSettings(partial) {
        assertPluginConversationRead(id)
        return patchConversationPluginSettings(convId(), id, partial)
      },
      getLorebookIds() {
        assertPluginConversationRead(id)
        return fetchConversationLorebookIds(convId())
      },
      patchLorebookIds(lorebookIds) {
        assertPluginPermission(
          id,
          usePluginPermissionsStore().getPermissions(id),
          PLUGIN_CONVERSATION_BINDINGS_WRITE,
        )
        return patchConversationLorebookIds(convId(), lorebookIds)
      },
    },
    lorebook: {
      list() {
        return fetchLorebookList(id)
      },
      get(lorebookId) {
        return fetchLorebookById(id, lorebookId)
      },
      createEntry(lorebookId, body) {
        return createLorebookEntry(id, lorebookId, body)
      },
      createEntriesBatch(lorebookId, entries) {
        return createLorebookEntriesBatch(id, lorebookId, entries)
      },
      patchEntry(lorebookId, entryId, body) {
        return patchLorebookEntry(id, lorebookId, entryId, body)
      },
      normalizeEntryRefs(req) {
        return normalizeLorebookEntryRefs(id, req, getPluginProgressAbortSignal())
      },
      applyOrder(lorebookId, req) {
        return applyLorebookOrder(
          id,
          lorebookId,
          req,
          getPluginProgressAbortSignal(),
        )
      },
      ensure(req) {
        return ensureLorebook(id, convId(), req?.nameTemplate)
      },
    },
    regex: {
      listRules(opts) {
        return listRegexRulesForHost(opts)
      },
      applyText(text, ruleIds, ctx) {
        return applyRegexTextForHost(text, ruleIds, ctx)
      },
      applyMessages(messages, ruleIds, ctx) {
        return applyRegexMessagesForHost(messages, ruleIds, ctx)
      },
    },
    api: {
      listPresets: fetchApiPresets,
    },
    plugin: {
      complete(req) {
        return runPluginComplete(
          id,
          convId(),
          req,
          getPluginProgressAbortSignal(),
        )
      },
      prepareContextBlocks(req) {
        return runPluginPrepareContextBlocks(
          id,
          convId(),
          req,
          getPluginProgressAbortSignal(),
        )
      },
      assemblePluginPrompt(req) {
        return runAssemblePluginPrompt(
          id,
          convId(),
          req,
          getPluginProgressAbortSignal(),
        )
      },
      completeWithContext(req) {
        return runCompleteWithContext(
          id,
          convId(),
          req,
          getPluginProgressAbortSignal(),
        )
      },
      runAction(action, body) {
        return runPluginAction(
          id,
          action,
          body,
          getPluginProgressAbortSignal(),
        )
      },
    },
    token: {
      preflightComplete(req) {
        return runPluginCompletePreflight(
          id,
          convId(),
          req,
          getPluginProgressAbortSignal(),
        )
      },
    },
    plugins: {
      getUserSettings() {
        return loadPluginUserSettings(id)
      },
      getUserSettingsSnapshot() {
        return usePluginUserSettingsStore().getSnapshot(id)
      },
      onUserSettingsChanged(handler) {
        return usePluginUserSettingsStore().subscribe(id, handler)
      },
    },
    macros: {
      expand(text, opts) {
        return expandPluginMacros(
          id,
          convId(),
          text,
          opts,
          getPluginProgressAbortSignal(),
        )
      },
    },
    registerStyles(css: string) {
      registerPluginStyles(id, css)
    },
    registerSlotButton(slot, def) {
      base.registerSlotButton(slot, { ...def, pluginId: id })
    },
    registerComposerSlashCommand(name, handler, spec) {
      registerComposerSlashCommandInRegistry(name, handler, {
        id: spec?.id,
        example: spec?.example ?? `/${name.trim()}`,
        descriptionKey:
          spec?.descriptionKey ?? 'chat.slash.commands.plugin.description',
        pluginId: id,
      })
    },
    ui: {
      ...base.ui,
      notify(title, body?, opts?: PluginNotifyOptions) {
        const auth = useAuthStore()
        sendPluginNotify(title, body, opts, {
          userId: auth.user?.id,
          pluginId: id,
        })
      },
      panel: {
        register(opts) {
          registerPluginPanel({ ...opts, pluginId: id })
        },
        setHtml(placement, _pluginId, html, opts) {
          setPluginPanelHtml(placement, id, html, opts)
        },
        open(placement, pluginId) {
          openPluginPanel(placement, pluginId ?? id)
        },
        setHidden(placement, hidden) {
          setPluginPanelHidden(placement, hidden)
        },
        onEvent(placement, _pluginId, handlers) {
          onPluginPanelEvent(placement, id, handlers)
        },
      },
    },
  }
}

export function createPluginWebHost(session: ChatSession): {
  host: PluginWebHost
  slotButtons: Map<string, PluginSlotButtonDef[]>
  formDialogs: Map<string, PluginFormDialogDef>
  openForm: Ref<OpenPluginFormState | null>
  formSubmitting: Ref<boolean>
  slotButtonRevision: Ref<number>
} {
  const { t, te } = useI18n()
  const pluginT = (key: string, params?: Record<string, unknown>) =>
    translatePluginI18nKey(key, t, te, params)
  const slotButtons = new Map<string, PluginSlotButtonDef[]>()
  const formDialogs = new Map<string, PluginFormDialogDef>()
  const openForm = ref<OpenPluginFormState | null>(null)
  const formSubmitting = ref(false)
  const slotButtonRevision = ref(0)

  const composer: ComposerRef = {
    get userInput() {
      return session.userInput
    },
  }

  const host: PluginWebHost = {
    registerSlotButton(slot, def) {
      const list = slotButtons.get(slot) ?? []
      const pluginId = def.pluginId ?? ''
      const pluginSlotIndex = list.filter(
        (b) => (b.pluginId ?? '') === pluginId,
      ).length
      list.push({
        ...def,
        order: def.order ?? pluginSlotIndex,
      })
      slotButtons.set(slot, list)
    },
    registerComposerSlashCommand(name, handler, spec) {
      registerComposerSlashCommandInRegistry(name, handler, {
        id: spec?.id,
        example: spec?.example ?? `/${name.trim()}`,
        descriptionKey:
          spec?.descriptionKey ?? 'chat.slash.commands.plugin.description',
      })
    },

    registerFormDialog(pluginId, def, dialogId) {
      formDialogs.set(formDialogKey(pluginId, dialogId), def)
    },
    openFormDialog(pluginId, model, dialogId, opts) {
      formSubmitting.value = false
      openForm.value = openPluginFormState(pluginId, model, dialogId, opts)
    },
    composer,
    session,
    t: pluginT,
    pluginKey(key: string) {
      return key
    },
    turn: {
      isLastUserTurn: session.isLastUserTurn,
      isTurnAwaitingAssistant: session.isTurnAwaitingAssistant,
    },
    chat: {
      sendWithPlugins: (userText, plugins) =>
        session.sendWithPlugins(userText, plugins),
      regenerateWithPlugins: (listIndex, userText, plugins) =>
        session.regenerateWithPlugins(listIndex, userText, plugins),
    },
    lifecycle: {
      onAssistantReplyComplete: (handler) =>
        session.onAssistantReplyComplete(handler),
      onAssistantReplyPersisted: (handler) =>
        session.onAssistantReplyPersisted(handler),
      onTurnDataChanged: (handler) => session.onTurnDataChanged(handler),
      onGeneratingChanged: (handler) => session.onGeneratingChanged(handler),
    },
    refreshSlotButtons() {
      slotButtonRevision.value += 1
    },
    registerStyles() {
      /* 仅 scoped host；插件应通过 createScopedPluginHost 注入 */
    },
    conversation: {
      getId() {
        return session.conversationId
      },
      getMeta() {
        return fetchConversationMeta(session.conversationId, {
          userDisplayName: session.userDisplayName,
          assistantDisplayName: session.assistantRoleName,
        })
      },
      runScope(opts, fn) {
        return session.runConversationScope(opts, fn)
      },
      runBatch(fn) {
        return session.runConversationBatch(fn)
      },
      refresh() {
        return session.refreshConversation()
      },
      getPluginSettings() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      getPluginSettingsSnapshot() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      onPluginSettingsChanged() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      patchPluginSettings() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      getLorebookIds() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      patchLorebookIds() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      setPluginHold(hold: boolean) {
        session.setPluginHold(hold)
      },
    },
    lorebook: {
      list() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      get() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      createEntry() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      createEntriesBatch() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      patchEntry() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      normalizeEntryRefs() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      applyOrder() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      ensure() {
        throw new Error('plugin_host_requires_scoped_host')
      },
    },
    regex: {
      listRules() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      applyText() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      applyMessages() {
        throw new Error('plugin_host_requires_scoped_host')
      },
    },
    api: {
      listPresets() {
        throw new Error('plugin_host_requires_scoped_host')
      },
    },
    plugin: {
      complete() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      prepareContextBlocks() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      assemblePluginPrompt() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      completeWithContext() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      runAction() {
        throw new Error('plugin_host_requires_scoped_host')
      },
    },
    token: {
      preflightComplete() {
        throw new Error('plugin_host_requires_scoped_host')
      },
    },
    plugins: {
      getUserSettings() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      getUserSettingsSnapshot() {
        throw new Error('plugin_host_requires_scoped_host')
      },
    },
    macros: {
      expand() {
        throw new Error('plugin_host_requires_scoped_host')
      },
    },
    render: {
      richMessageToHtml: renderRichMessageToHtml,
      reasoningToHtml: renderReasoningMarkdownToHtml,
    },
    ui: {
      notify(title, body?, opts?: PluginNotifyOptions) {
        const auth = useAuthStore()
        sendPluginNotify(title, body, opts, { userId: auth.user?.id })
      },
      confirm(opts: PluginConfirmOptions) {
        return showPluginConfirm(opts)
      },
      openFormDialog(pluginId, model, dialogId, opts) {
        formSubmitting.value = false
        openForm.value = openPluginFormState(pluginId, model, dialogId, opts)
      },
      progress(opts: PluginProgressOptions) {
        showPluginProgress({
          message: opts.message ?? '',
          phase: opts.phase,
          done: opts.done,
          total: opts.total,
          indeterminate: opts.indeterminate,
          abortable: opts.abortable,
          abortLabel: opts.abortLabel,
        })
      },
      clearProgress() {
        clearPluginProgress()
      },
      panel: {
        register(opts) {
          registerPluginPanel(opts)
        },
        setHtml(placement, pluginId, html, opts) {
          setPluginPanelHtml(placement, pluginId, html, opts)
        },
        open(placement, pluginId) {
          openPluginPanel(placement, pluginId)
        },
        setHidden(placement, hidden) {
          setPluginPanelHidden(placement, hidden)
        },
        onEvent(placement, pluginId, handlers) {
          onPluginPanelEvent(placement, pluginId, handlers)
        },
      },
    },
  }

  return { host, slotButtons, formDialogs, openForm, formSubmitting, slotButtonRevision }
}

function compareSlotButtons(
  a: PluginSlotButtonDef,
  b: PluginSlotButtonDef,
  pluginOrder: Map<string, number>,
): number {
  const oa = pluginOrder.get(a.pluginId ?? '') ?? 999_999
  const ob = pluginOrder.get(b.pluginId ?? '') ?? 999_999
  if (oa !== ob) return oa - ob
  const sa = a.order ?? 0
  const sb = b.order ?? 0
  if (sa !== sb) return sa - sb
  return a.id.localeCompare(b.id)
}

export function getSlotButtonsFor(
  slotButtons: Map<string, PluginSlotButtonDef[]>,
  slot: string,
  ctx: PluginSlotContext,
  pluginOrder?: Map<string, number>,
): PluginSlotButtonDef[] {
  const list = (slotButtons.get(slot) ?? [])
    .filter((b) => !b.when || b.when(ctx))
    .map((b) => {
      if (!b.menu?.length) return b
      const menu = b.menu.filter((item) => !item.when || item.when(ctx))
      return { ...b, menu }
    })
    .filter((b) => {
      if (b.menu?.length) return b.menu.length > 0
      return typeof b.onClick === 'function'
    })
  if (!pluginOrder || pluginOrder.size === 0) return list
  return list.slice().sort((a, b) => compareSlotButtons(a, b, pluginOrder))
}

export async function submitOpenPluginForm(params: {
  openForm: { value: OpenPluginFormState | null }
  formDialogs: Map<string, PluginFormDialogDef>
  host: PluginWebHost
  formSubmitting: { value: boolean }
}): Promise<void> {
  const state = params.openForm.value
  if (!state) return
  const def = params.formDialogs.get(formDialogKey(state.pluginId, state.dialogId))
  if (!def || !def.canSubmit(state.model)) return
  params.formSubmitting.value = true
  try {
    const scopedHost = createScopedPluginHost(params.host, state.pluginId)
    await def.onSubmit(scopedHost, state.model)
    params.openForm.value = null
  } finally {
    params.formSubmitting.value = false
  }
}

export function cancelOpenPluginForm(params: {
  openForm: { value: OpenPluginFormState | null }
  formDialogs: Map<string, PluginFormDialogDef>
  host: PluginWebHost
}): void {
  const state = params.openForm.value
  if (state) {
    const def = params.formDialogs.get(
      formDialogKey(state.pluginId, state.dialogId),
    )
    if (def?.onCancel) {
      const scopedHost = createScopedPluginHost(params.host, state.pluginId)
      void def.onCancel(scopedHost, state.model)
    }
  }
  params.openForm.value = null
}

export function skipOpenPluginForm(params: {
  openForm: { value: OpenPluginFormState | null }
  formDialogs: Map<string, PluginFormDialogDef>
  host: PluginWebHost
}): void {
  const state = params.openForm.value
  if (state) {
    const def = params.formDialogs.get(
      formDialogKey(state.pluginId, state.dialogId),
    )
    if (def?.onSkip) {
      const scopedHost = createScopedPluginHost(params.host, state.pluginId)
      void def.onSkip(scopedHost, state.model)
    }
  }
  params.openForm.value = null
}

export async function regenerateOpenPluginForm(params: {
  openForm: { value: OpenPluginFormState | null }
  formDialogs: Map<string, PluginFormDialogDef>
  host: PluginWebHost
  formSubmitting: { value: boolean }
}): Promise<void> {
  const state = params.openForm.value
  if (!state) return
  const def = params.formDialogs.get(formDialogKey(state.pluginId, state.dialogId))
  if (!def?.onRegenerate) return
  params.formSubmitting.value = true
  try {
    const scopedHost = createScopedPluginHost(params.host, state.pluginId)
    await def.onRegenerate(scopedHost, state.model)
  } finally {
    params.formSubmitting.value = false
  }
}
