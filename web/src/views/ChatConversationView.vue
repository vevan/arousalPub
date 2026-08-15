<script setup lang="ts">
import ConversationContextSettings from '@/components/ConversationContextSettings.vue'
import ChatBranchPanel from '@/components/chat/ChatBranchPanel.vue'
import ChatBranchLabelDialog from '@/components/chat/ChatBranchLabelDialog.vue'
import ChatGroupChatDialog from '@/components/chat/ChatGroupChatDialog.vue'
import ChatComposerGroupRoster from '@/components/chat/ChatComposerGroupRoster.vue'
import ChatHeaderBar from '@/components/chat/ChatHeaderBar.vue'
import ChatMemoryRebuildDialog from '@/components/chat/ChatMemoryRebuildDialog.vue'
import HomeChat from '@/components/HomeChat.vue'
import {
  CHAT_CONVERSATION_ACTIONS_KEY,
} from '@/composables/chat-conversation-actions'
import type { ConvContextBindings } from '@/composables/chat-session/conv-bindings-types'
import { syncAuditDebugIfNeeded } from '@/composables/chat-session/use-conversation-audit-debug'
import { useConvBindings } from '@/composables/chat-session/use-conv-bindings'
import { useConversationMedia } from '@/composables/chat-session/use-conversation-media'
import { useMemoryRebuildOffer } from '@/composables/chat-session/use-memory-rebuild-offer'
import {
  MEMORY_REBUILD_INJECT_KEY,
  useMemoryRebuild,
} from '@/composables/useMemoryRebuild'
import { CONVERSATION_BRANCH_KEY } from '@/composables/conversation-branch-context'
import { useConversationBranches } from '@/composables/useConversationBranches'
import { bootstrapAppData } from '@/bootstrap/app-data'
import { coreNotify } from '@/utils/core-notify'
import { fetchDefaultLorebookIds, fetchLorebookPickerItems } from '@/utils/default-lorebook'
import { useConnectionStore } from '@/stores/connection'
import { usePreferencesStore } from '@/stores/preferences'
import { usePromptsStore } from '@/stores/prompts'
import { useUiContextStore } from '@/stores/ui-context'
import { authorsNoteComposerActive } from '@/utils/authors-note-settings'
import {
  groupChatWithEnsuredMemberColors,
  memberColorsIncomplete,
  type GroupChatSettings,
} from '@/utils/group-chat-settings'
import { onConversationIndexPatched } from '@/utils/conversation-index-sync'
import { useAuthStore } from '@/stores/auth'
import { storeToRefs } from 'pinia'
import { computed, onScopeDispose, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const props = defineProps<{
  conversationId: string
}>()

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const conn = useConnectionStore()
const prefStore = usePreferencesStore()
const promptsStore = usePromptsStore()
const uiContext = useUiContextStore()
const { activePresetId: globalPromptPresetId, indexEntries: promptIndexEntries } =
  storeToRefs(promptsStore)
const {
  lorebookRecursiveEnabled,
  lorebookMaxRecursionDepth,
  lorebookKeywordTopK,
  lorebookVectorEnabled,
  lorebookVectorTopK,
  historyLimitEnabled,
  historyMaxTurns,
  memoryEnabled,
  memoryTopK,
  knowledgeTopK,
  budgetTrimSettings,
  embeddingModel,
  embeddingDimensions,
} = storeToRefs(prefStore)

const loading = ref(true)
const errorText = ref('')
const title = ref('')
const titleSaving = ref(false)
const lorebookNameById = ref<Record<string, string>>({})
const convContextSettingsRef = ref<InstanceType<
  typeof ConversationContextSettings
> | null>(null)
const homeChatRef = ref<InstanceType<typeof HomeChat> | null>(null)
/** Settings dialog teleports; pass HomeChat.pluginHost down for companion ensurePluginById */
const chatPluginHost = computed(() => homeChatRef.value?.pluginHost ?? null)
const hasConversationTurns = ref(false)

const { convBindings, bindingsFromIndex } = useConvBindings()

const bgmAudioRef = ref<HTMLAudioElement | null>(null)
const {
  backgroundImageUrl,
  bgmUrl,
  bgmMuted,
  chatPaneStyle,
  stopBgmAudio,
  clearConversationMediaBindings,
  toggleBgmMuted,
} = useConversationMedia({
  getUserId: () => auth.user?.id,
  getBackgroundImageFileId: () => convBindings.value.backgroundImageFileId,
  getBgmFileId: () => convBindings.value.bgmFileId,
  bgmAudioRef,
  clearMediaFileIds: () => {
    convBindings.value = {
      ...convBindings.value,
      backgroundImageFileId: null,
      bgmFileId: null,
    }
  },
})

const memoryRebuild = useMemoryRebuild(() => props.conversationId)
provide(MEMORY_REBUILD_INJECT_KEY, memoryRebuild)

const {
  globalHybridFtsSpec,
  conversationMemoryEmbeddingModel,
  conversationMemoryEmbeddingDimensions,
  conversationMemoryEmbeddingProfile,
  conversationMemoryHybridFtsSpec,
  memoryRebuildDialogOpen,
  memoryRebuildLoading,
  memoryRebuildError,
  memoryRebuildDone,
  memoryRebuildTotal,
  memoryRebuildTurns,
  memoryRebuildLoreEntries,
  memoryRebuildStageLabel,
  memoryRebuildPercent,
  maybePromptMemoryRebuild,
  openMemoryRebuildDialog,
  dismissMemoryRebuild,
  confirmMemoryRebuild,
  onMemoryRebuiltFromSettings,
  applyConversationMemoryIndexMeta,
  resetMemoryRebuildOffer,
} = useMemoryRebuildOffer({
  getConversationId: () => props.conversationId,
  convBindings,
  hasConversationTurns,
  loading,
  memoryRebuild,
})

provide(CHAT_CONVERSATION_ACTIONS_KEY, {
  openMemoryRebuild: openMemoryRebuildDialog,
})

const {
  activeBranchPath,
  branchPanelOpen,
  branchBusy,
  branchTreeLoading,
  branchTreeNodes,
  branchLoadError,
  branchSuccessMessage,
  branchActionError,
  branchHighlightForkTurnId,
  branchRegistryBroken,
  forkTurnIdsWithSiblings,
  activeBranchDisplayLabel,
  syncActiveFromIndex,
  refreshBranchTree,
  repairBranchRegistry,
  switchActiveBranch,
  createBranchDialogOpen,
  pendingCreateTurn,
  createBranchSwipeOptions,
  createBranchInitialSwipeId,
  requestCreateBranchFromTurn,
  confirmCreateBranch,
  cancelCreateBranch,
  renameBranch,
  deleteBranch,
  openBranchPanel,
  clearBranchHighlight,
  isForkTurn,
  isForkAnchorOnActivePath,
} = useConversationBranches({
  getConversationId: () => props.conversationId,
  onActivePathChanged: async () => {
    await homeChatRef.value?.reloadTurns()
  },
})

provide(CONVERSATION_BRANCH_KEY, {
  activeBranchPath,
  forkTurnIdsWithSiblings,
  branchPanelOpen,
  branchBusy,
  openBranchPanel,
  requestCreateBranchFromTurn,
  isForkTurn,
  isForkAnchorOnActivePath,
})

const createBranchSubtitle = computed(() => {
  const n = pendingCreateTurn.value?.turnOrdinal
  if (n == null || n < 1) return undefined
  return t('chat.branches.createBranchForkFrom', { n })
})

watch(branchSuccessMessage, (msg) => {
  const text = msg.trim()
  if (!text) return
  coreNotify(text, undefined, { level: 'success', timeout: 3000 })
  branchSuccessMessage.value = ''
})

watch(branchActionError, (msg) => {
  const text = msg.trim()
  if (!text) return
  coreNotify(text, undefined, { level: 'error', timeout: 4000 })
  branchActionError.value = ''
})

watch(branchPanelOpen, (open) => {
  if (!open) clearBranchHighlight()
})

function onRegexAppliedFromSettings(): void {
  void homeChatRef.value?.reloadTurns()
}

const headerChatLabel = computed(() => {
  if (!conn.isApiKeyConfigured) return ''
  if (convBindings.value.chatApi.useGlobal) return ''
  const chat = convBindings.value.chatApi.effective
  if (chat?.alias.trim()) {
    const model = chat.model.trim()
    return model ? `${chat.alias.trim()} · ${model}` : chat.alias.trim()
  }
  return ''
})

const boundLorebooks = computed(() =>
  convBindings.value.lorebookIds.map((id) => ({
    id,
    label: lorebookNameById.value[id] ?? id,
  })),
)

/** 会话显式绑定优先，否则与组装管线一致使用全局激活预设 */
const effectivePromptPresetId = computed(() => {
  const explicit = convBindings.value.promptPresetId
  if (explicit) return explicit
  const global = globalPromptPresetId.value?.trim()
  return global || null
})

const boundPromptLabel = computed(() => {
  const id = effectivePromptPresetId.value
  if (!id) return ''
  const hit = promptIndexEntries.value.find((p) => p.id === id)
  return hit?.name?.trim() || id
})

function openBoundLorebook(lorebookId: string): void {
  uiContext.requestOpenLorebooksDialog(lorebookId)
}

function openBoundPrompt(): void {
  const id = effectivePromptPresetId.value
  if (!id) return
  uiContext.requestOpenPromptsDialog(id)
}

const groupChatDialogOpen = ref(false)

const canOpenGroupChatSettings = computed(
  () => convBindings.value.characterIds.length >= 2,
)

function onGroupChatSettingsSaved(payload: {
  groupChat: GroupChatSettings
  characterIds: string[]
}): void {
  const nameById = new Map(
    convBindings.value.characterIds.map((id, i) => [
      id,
      convBindings.value.characterNames[i]?.trim() || id,
    ]),
  )
  convBindings.value = {
    ...convBindings.value,
    groupChat: payload.groupChat,
    groupChatEnabled: payload.groupChat.enabled === true,
    characterIds: payload.characterIds,
    characterNames: payload.characterIds.map((id) => nameById.get(id) ?? id),
  }
}

function onGroupChatRosterSaved(groupChat: GroupChatSettings): void {
  convBindings.value = {
    ...convBindings.value,
    groupChat,
    groupChatEnabled: groupChat.enabled === true,
  }
}

const showGroupRoster = computed(
  () =>
    convBindings.value.groupChatEnabled &&
    convBindings.value.characterIds.length > 0,
)

const rosterUserInput = computed({
  get: () => {
    const s = homeChatRef.value?.session as { userInput?: string } | undefined
    return typeof s?.userInput === 'string' ? s.userInput : ''
  },
  set: (value: string) => {
    const s = homeChatRef.value?.session as { userInput?: string } | undefined
    if (s) s.userInput = value
  },
})

/** 已开启群聊但成员缺色时写回一次，保证气泡/边框能着色 */
async function persistMissingMemberColorsIfNeeded(
  conversationId: string,
  bindings: ConvContextBindings,
): Promise<void> {
  if (!bindings.groupChatEnabled) return
  if (!memberColorsIncomplete(bindings.characterIds, bindings.groupChat.members)) {
    return
  }
  const groupChat = groupChatWithEnsuredMemberColors(
    bindings.groupChat,
    bindings.characterIds,
  )
  try {
    const res = await fetch(`/api/chat/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupChat }),
    })
    if (!res.ok) return
    if (props.conversationId !== conversationId) return
    const j = (await res.json()) as { index?: Record<string, unknown> }
    if (j.index) {
      convBindings.value = bindingsFromIndex(j.index)
    } else {
      convBindings.value = {
        ...convBindings.value,
        groupChat,
        groupChatEnabled: true,
      }
    }
  } catch {
    /* 补色失败不阻断对话加载 */
  }
}

watch(
  () => convBindings.value.lorebookIds,
  (ids) => {
    uiContext.setConversationLorebookIds(ids)
  },
  { immediate: true },
)

watch(
  effectivePromptPresetId,
  (id) => {
    uiContext.setConversationPromptPresetId(id)
  },
  { immediate: true },
)

const authorsNoteActive = computed(() =>
  authorsNoteComposerActive(convBindings.value.authorsNote),
)

function openAuthorsNoteSettings(): void {
  convContextSettingsRef.value?.open('authorsNote')
}

async function loadLorebookNameMap(): Promise<void> {
  const items = await fetchLorebookPickerItems()
  const map: Record<string, string> = {}
  for (const item of items) {
    map[item.id] = item.name
  }
  lorebookNameById.value = map
}

function onConvContextPatched(
  index: Record<string, unknown>,
  expectedConversationId?: string,
) {
  if (
    expectedConversationId &&
    expectedConversationId !== props.conversationId
  ) {
    return
  }
  applyConversationMemoryIndexMeta(index)
  convBindings.value = bindingsFromIndex(index)
  maybePromptMemoryRebuild()
}

const stopIndexPatched = onConversationIndexPatched((cid, index) => {
  if (cid !== props.conversationId) return
  onConvContextPatched(index)
})

onScopeDispose(() => {
  stopIndexPatched()
  stopBgmAudio()
})

async function ensureConversation(id: string) {
  loading.value = true
  errorText.value = ''
  try {
    // 与读会话并行；首屏不因偏好/连接初始化阻塞
    const boot = bootstrapAppData()

    let res = await fetch(`/api/chat/conversations/${id}`)
    if (res.status === 404) {
      const created = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: id,
          title: t('chat.newConversation'),
        }),
      })
      if (!created.ok) {
        if (props.conversationId === id) {
          errorText.value = t('chatConversation.loadFailed')
          loading.value = false
        }
        return
      }
      if (props.conversationId !== id) return
      const defaultLorebookIds = await fetchDefaultLorebookIds()
      if (props.conversationId !== id) return
      if (defaultLorebookIds.length > 0) {
        await fetch(`/api/chat/conversations/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lorebookIds: defaultLorebookIds }),
        })
      }
      if (props.conversationId !== id) return
      res = await fetch(`/api/chat/conversations/${id}`)
    }
    if (!res.ok) {
      if (props.conversationId === id) {
        errorText.value = t('chatConversation.loadFailed')
        loading.value = false
      }
      return
    }
    const idx = (await res.json()) as Record<string, unknown>
    // 快速切换会话时丢弃过期响应，避免旧背景/BGM/绑定写回
    if (props.conversationId !== id) return
    title.value = typeof idx.title === 'string' ? idx.title : t('chat.newConversation')
    hasConversationTurns.value =
      typeof idx.headChunkFile === 'string' && idx.headChunkFile.length > 0
    applyConversationMemoryIndexMeta(idx)
    convBindings.value = bindingsFromIndex(idx)
    syncActiveFromIndex(idx)

    // 先对齐 auditDebug，避免首条消息在开关写入前落盘而跳过审计
    try {
      await syncAuditDebugIfNeeded(id, idx)
    } catch {
      /* 审计开关失败不阻断打开对话 */
    }
    if (props.conversationId !== id) return

    // 关键路径结束：挂载 HomeChat → loadMessages；其余靠后
    loading.value = false

    void (async () => {
      try {
        await persistMissingMemberColorsIfNeeded(id, convBindings.value)
        await boot
        if (props.conversationId !== id) return
        if (!promptsStore.loaded) {
          await promptsStore.loadIndexFromServer()
        }
        await loadLorebookNameMap()
        if (props.conversationId !== id) return
        void refreshBranchTree()
        maybePromptMemoryRebuild()
      } catch {
        /* 次要初始化失败不阻断已展示的对话 */
      }
    })()
  } catch {
    if (props.conversationId === id) {
      errorText.value = t('chatConversation.loadFailed')
      loading.value = false
    }
  }
}

async function saveTitle() {
  const id = props.conversationId
  const next = title.value.trim()
  if (!next) {
    title.value = t('chat.newConversation')
    return
  }
  titleSaving.value = true
  try {
    const res = await fetch(`/api/chat/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next }),
    })
    if (res.ok) {
      const j = (await res.json()) as { index?: { title?: string } }
      if (j.index?.title) title.value = j.index.title
    }
  } finally {
    titleSaving.value = false
  }
}

watch(
  () => props.conversationId,
  (id) => {
    resetMemoryRebuildOffer()
    branchPanelOpen.value = false
    branchLoadError.value = ''
    clearConversationMediaBindings()
    void ensureConversation(id)
  },
  { immediate: true },
)

/** 仅全局 Debug 偏好变更时同步；进页同步见 ensureConversation 延后任务 */
watch(
  () =>
    [prefStore.writeChatPromptSnapshot, prefStore.promptDebugMaxStored] as const,
  async () => {
    const id = props.conversationId
    if (!id || loading.value) return
    try {
      const res = await fetch(`/api/chat/conversations/${id}`)
      if (!res.ok) return
      const idx = (await res.json()) as Record<string, unknown>
      await syncAuditDebugIfNeeded(id, idx)
    } catch {
      /* 偏好同步失败不阻断聊天 */
    }
  },
)
</script>

<template>
  <div
    class="chat_pane app-page-shell"
    :class="{
      'chat_pane--state': loading || !!errorText,
      'chat_pane--has-bg': !!backgroundImageUrl,
    }"
    :style="chatPaneStyle"
  >
    <audio
      ref="bgmAudioRef"
      class="chat-bgm-audio"
      preload="metadata"
    />
    <div
      v-if="loading"
      class="chat-body chat-body--state pa-4 text-body-2 text-medium-emphasis"
    >
      {{ $t('chatConversation.loading') }}
    </div>
    <div
      v-else-if="errorText"
      class="chat-body chat-body--state pa-4"
    >
      <v-alert type="error" variant="tonal" density="compact">
        {{ errorText }}
      </v-alert>
      <v-btn class="mt-4" variant="text" @click="router.push({ name: 'home' })">
        {{ $t('chatConversation.backHome') }}
      </v-btn>
    </div>
    <template v-else>
      <ChatHeaderBar
        :title="title"
        :title-saving="titleSaving"
        :show-group-roster="showGroupRoster"
        :branch-busy="branchBusy"
        :active-branch-display-label="activeBranchDisplayLabel"
        :api-key-configured="conn.isApiKeyConfigured"
        :header-chat-label="headerChatLabel"
        :bound-prompt-label="boundPromptLabel"
        :bound-lorebooks="boundLorebooks"
        :can-open-group-chat-settings="canOpenGroupChatSettings"
        :group-chat-enabled="convBindings.groupChatEnabled"
        :has-bgm="!!bgmUrl"
        :bgm-muted="bgmMuted"
        @update:title="title = $event"
        @save-title="saveTitle"
        @back="router.push({ name: 'home' })"
        @open-branch-panel="openBranchPanel()"
        @open-bound-prompt="openBoundPrompt"
        @open-bound-lorebook="openBoundLorebook"
        @open-group-chat="groupChatDialogOpen = true"
        @toggle-bgm="toggleBgmMuted"
        @open-settings="convContextSettingsRef?.open()"
      />
      <ChatComposerGroupRoster
        v-if="showGroupRoster"
        :conversation-id="conversationId"
        :character-ids="convBindings.characterIds"
        :character-display-names="convBindings.characterNames"
        :group-chat="convBindings.groupChat"
        :user-input="rosterUserInput"
        @update:user-input="rosterUserInput = $event"
        @group-chat-saved="onGroupChatRosterSaved"
      />
      <HomeChat
        ref="homeChatRef"
        :conversation-id="conversationId"
        :conversation-prompt-preset-id="convBindings.promptPresetId"
        :conversation-character-ids="convBindings.characterIds"
        :conversation-character-display-names="convBindings.characterNames"
        :group-chat-enabled="convBindings.groupChatEnabled"
        :group-chat-settings="convBindings.groupChat"
        :conversation-lorebook-ids="convBindings.lorebookIds"
        :conversation-user-name="convBindings.userName"
        :conversation-user-character-id="convBindings.userCharacterId"
        :authors-note-active="authorsNoteActive"
        @open-authors-note="openAuthorsNoteSettings"
      />
      <ChatBranchPanel
        v-model="branchPanelOpen"
        :nodes="branchTreeNodes"
        :active-branch-path="activeBranchPath"
        :busy="branchBusy"
        :tree-loading="branchTreeLoading"
        :error-text="branchLoadError"
        :highlight-fork-turn-id="branchHighlightForkTurnId"
        :registry-broken="branchRegistryBroken"
        :rename-handler="renameBranch"
        @select="switchActiveBranch"
        @delete="deleteBranch"
        @repair="repairBranchRegistry"
      />
      <ChatBranchLabelDialog
        v-model="createBranchDialogOpen"
        :title="$t('chat.branches.createBranchTitle')"
        :subtitle="createBranchSubtitle"
        :hint="$t('chat.branches.createBranchHint')"
        :confirm-text="$t('chat.branches.createBranchConfirm')"
        :busy="branchBusy"
        :error-text="branchLoadError"
        :swipe-options="createBranchSwipeOptions"
        :initial-swipe-id="createBranchInitialSwipeId"
        show-stay-checkbox
        @update:model-value="(open) => { if (!open) cancelCreateBranch() }"
        @confirm="confirmCreateBranch"
      />
      <ChatMemoryRebuildDialog
        v-model="memoryRebuildDialogOpen"
        :stored-model="conversationMemoryEmbeddingModel"
        :current-model="embeddingModel"
        :stored-fts-spec="conversationMemoryHybridFtsSpec"
        :current-fts-spec="globalHybridFtsSpec"
        :embedding-dimensions="embeddingDimensions"
        :loading="memoryRebuildLoading"
        :error-text="memoryRebuildError"
        :done="memoryRebuildDone"
        :total="memoryRebuildTotal"
        :turns="memoryRebuildTurns"
        :lore-entries="memoryRebuildLoreEntries"
        :stage-label="memoryRebuildStageLabel"
        :percent="memoryRebuildPercent"
        @dismiss="dismissMemoryRebuild"
        @confirm="confirmMemoryRebuild"
      />
      <ChatGroupChatDialog
        v-model="groupChatDialogOpen"
        :conversation-id="conversationId"
        :character-ids="convBindings.characterIds"
        :character-names="convBindings.characterNames"
        :group-chat="convBindings.groupChat"
        @saved="onGroupChatSettingsSaved"
      />
      <ConversationContextSettings
        ref="convContextSettingsRef"
        :conversation-id="conversationId"
        :plugin-host="chatPluginHost"
        :conversation-title="title"
        :initial-prompt-preset-id="convBindings.promptPresetId"
        :initial-character-ids="convBindings.characterIds"
        :initial-group-chat="convBindings.groupChat"
        :initial-lorebook-ids="convBindings.lorebookIds"
        :initial-knowledge-base-ids="convBindings.knowledgeBaseIds"
        :initial-knowledge-settings-use-global="convBindings.knowledge.useGlobal"
        :global-knowledge-top-k="knowledgeTopK"
        :initial-knowledge-top-k="convBindings.knowledge.effective.topK"
        :initial-lorebook-settings-use-global="convBindings.lorebook.useGlobal"
        :global-lore-recursive-enabled="lorebookRecursiveEnabled"
        :global-lore-max-recursion-depth="lorebookMaxRecursionDepth"
        :global-lore-keyword-top-k="lorebookKeywordTopK"
        :global-lore-vector-enabled="lorebookVectorEnabled"
        :global-lore-vector-top-k="lorebookVectorTopK"
        :initial-lorebook-recursive-enabled="convBindings.lorebook.effective.recursiveEnabled"
        :initial-lorebook-max-recursion-depth="convBindings.lorebook.effective.maxRecursionDepth"
        :initial-lorebook-keyword-top-k="convBindings.lorebook.effective.keywordTopK"
        :initial-lorebook-vector-enabled="convBindings.lorebook.effective.vectorEnabled"
        :initial-lorebook-vector-top-k="convBindings.lorebook.effective.vectorTopK"
        :initial-history-settings-use-global="convBindings.history.useGlobal"
        :global-history-limit-enabled="historyLimitEnabled"
        :global-history-max-turns="historyMaxTurns"
        :initial-history-limit-enabled="convBindings.history.effective.limitEnabled"
        :initial-history-max-turns="convBindings.history.effective.maxTurns"
        :initial-memory-settings-use-global="convBindings.memory.useGlobal"
        :global-memory-enabled="memoryEnabled"
        :global-memory-top-k="memoryTopK"
        :initial-memory-enabled="convBindings.memory.effective.memoryEnabled"
        :initial-memory-top-k="convBindings.memory.effective.memoryTopK"
        :initial-budget-trim-settings-use-global="convBindings.budgetTrim.useGlobal"
        :global-budget-trim-settings="budgetTrimSettings"
        :initial-budget-trim-settings="convBindings.budgetTrim.effective"
        :global-embedding-model="embeddingModel"
        :global-embedding-dimensions="embeddingDimensions"
        :effective-embedding-model="convBindings.embeddingApi.effective.embeddingModel"
        :effective-embedding-profile="convBindings.embeddingApi.effective.embeddingProfile"
        :conversation-memory-embedding-model="conversationMemoryEmbeddingModel"
        :conversation-memory-embedding-dimensions="conversationMemoryEmbeddingDimensions"
        :conversation-memory-embedding-profile="conversationMemoryEmbeddingProfile"
        :has-conversation-turns="hasConversationTurns"
        :conversation-memory-hybrid-fts-spec="conversationMemoryHybridFtsSpec"
        :global-hybrid-fts-spec="globalHybridFtsSpec"
        :initial-user-name="convBindings.userName"
        :initial-user-character-id="convBindings.userCharacterId"
        :initial-background-image-file-id="convBindings.backgroundImageFileId"
        :initial-bgm-file-id="convBindings.bgmFileId"
        :initial-authors-note="convBindings.authorsNote"
        :initial-api-preset="convBindings.chatApi.apiPresetRaw"
        :initial-chat-api-use-global="convBindings.chatApi.useGlobal"
        :initial-embedding-api-use-global="convBindings.embeddingApi.useGlobal"
        :initial-embedding-api-settings="convBindings.embeddingApi.override"
        @patched="(index, cid) => onConvContextPatched(index, cid)"
        @memory-rebuilt="onMemoryRebuiltFromSettings"
        @regex-applied="onRegexAppliedFromSettings"
      />
    </template>
  </div>
</template>

<style scoped>
.chat_pane {
  display: grid;
  grid-template-rows: auto 1fr;
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
}

.chat_pane--has-bg {
  background-repeat: no-repeat;
}

.chat-bgm-audio {
  display: none;
}

.chat_pane--state {
  grid-template-rows: 1fr;
}

.chat-body--state {
  min-height: 0;
  overflow: auto;
}
</style>
