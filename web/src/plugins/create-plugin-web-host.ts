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
  PluginWebHost,
} from '@/plugins/types'
import {
  showPluginConfirm,
  showPluginToast,
  showPluginProgress,
  clearPluginProgress,
} from '@/plugins/plugin-ui-state'
import {
  fetchConversationMeta,
} from '@/plugins/conversation-meta'
import {
  renderRichMessageToHtml,
  renderReasoningMarkdownToHtml,
} from '@/utils/render-rich-message'
import { useI18n } from 'vue-i18n'
import { ref, type Ref } from 'vue'

type ChatSession = ReturnType<typeof useChatSession>

export function createScopedPluginHost(
  base: PluginWebHost,
  pluginId: string,
): PluginWebHost {
  const id = pluginId.trim()
  return {
    ...base,
    pluginKey(key: string) {
      return `plugins.${id}.${key}`
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
  const { t } = useI18n()
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
    registerFormDialog(pluginId, def) {
      formDialogs.set(pluginId, def)
    },
    openFormDialog(pluginId, model) {
      openForm.value = {
        pluginId,
        model: { ...model },
      }
    },
    composer,
    session,
    t,
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
      openFormDialog(pluginId, model) {
        openForm.value = {
          pluginId,
          model: { ...model },
        }
      },
      progress(opts: PluginProgressOptions) {
        showPluginProgress({
          message: opts.message ?? '',
          phase: opts.phase,
          done: opts.done,
          total: opts.total,
        })
      },
      clearProgress() {
        clearPluginProgress()
      },
    },
  }

  return { host, slotButtons, formDialogs, openForm, formSubmitting, slotButtonRevision }
}

export function getSlotButtonsFor(
  slotButtons: Map<string, PluginSlotButtonDef[]>,
  slot: string,
  ctx: PluginSlotContext,
): PluginSlotButtonDef[] {
  return (slotButtons.get(slot) ?? []).filter((b) => !b.when || b.when(ctx))
}

export async function submitOpenPluginForm(params: {
  openForm: { value: OpenPluginFormState | null }
  formDialogs: Map<string, PluginFormDialogDef>
  host: PluginWebHost
  formSubmitting: { value: boolean }
}): Promise<void> {
  const state = params.openForm.value
  if (!state) return
  const def = params.formDialogs.get(state.pluginId)
  if (!def || !def.canSubmit(state.model)) return
  params.formSubmitting.value = true
  try {
    await def.onSubmit(params.host, state.model)
    params.openForm.value = null
  } finally {
    params.formSubmitting.value = false
  }
}

export function cancelOpenPluginForm(openForm: {
  value: OpenPluginFormState | null
}): void {
  openForm.value = null
}
