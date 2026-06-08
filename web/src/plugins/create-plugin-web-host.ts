import type { ComposerRef, useChatSession } from '@/composables/useChatSession'
import type {
  OpenPluginFormState,
  PluginConfirmOptions,
  PluginFormDialogDef,
  PluginNotifyOptions,
  PluginProgressOptions,
  PluginSlotButtonDef,
  PluginSlotContext,
  PluginToastOptions,
  PluginFormDialogOpenOpts,
  PluginWebHost,
} from '@/plugins/types'
import {
  showPluginConfirm,
  showPluginToast,
  showPluginProgress,
  clearPluginProgress,
  getPluginProgressAbortSignal,
} from '@/plugins/plugin-ui-state'
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
  fetchPluginUserSettings,
  normalizeLorebookEntryRefs,
  reorderCuratedLorebookEntries,
  patchConversationPluginSettings,
  patchLorebookEntry,
  expandPluginMacros,
  runPluginComplete,
  runPluginCompleteDraft,
  runPluginCompletePreflight,
  runPluginPrepareContext,
} from '@/plugins/plugin-host-api'
import {
  renderRichMessageToHtml,
  renderReasoningMarkdownToHtml,
} from '@/utils/render-rich-message'
import { registerPluginStyles } from '@/plugins/plugin-slot-styles'
import { useConversationPluginSettingsStore } from '@/stores/conversation-plugin-settings'
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
  return {
    ...base,
    pluginKey(key: string) {
      return `plugins.${id}.${key}`
    },
    conversation: {
      ...base.conversation,
      getPluginSettings() {
        const store = useConversationPluginSettingsStore()
        const cid = convId()
        if (store.isLoaded(cid, id)) {
          return Promise.resolve(store.getSnapshot(cid, id))
        }
        return fetchConversationPluginSettings(cid, id)
      },
      getPluginSettingsSnapshot() {
        return useConversationPluginSettingsStore().getSnapshot(convId(), id)
      },
      onPluginSettingsChanged(handler) {
        return useConversationPluginSettingsStore().subscribe(
          convId(),
          id,
          handler,
        )
      },
      patchPluginSettings(partial) {
        return patchConversationPluginSettings(convId(), id, partial)
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
      reorderCurated(lorebookId, req) {
        return reorderCuratedLorebookEntries(
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
      prepareContext(req) {
        return runPluginPrepareContext(
          id,
          convId(),
          req,
          getPluginProgressAbortSignal(),
        )
      },
      completeDraft(req) {
        return runPluginCompleteDraft(
          id,
          convId(),
          req,
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
        return fetchPluginUserSettings(id)
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
      list.push(def)
      slotButtons.set(slot, list)
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
      patchEntry() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      normalizeEntryRefs() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      reorderCurated() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      ensure() {
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
      prepareContext() {
        throw new Error('plugin_host_requires_scoped_host')
      },
      completeDraft() {
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
      toast(message, opts?: PluginToastOptions) {
        showPluginToast(message, opts)
      },
      notify(title, body?, opts?: PluginNotifyOptions) {
        const text = body?.trim() ? `${title}\n${body}` : title
        showPluginToast(text, opts)
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
