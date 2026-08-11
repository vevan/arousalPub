<script setup lang="ts">
import BindingsTab from '@/components/conversation-settings/BindingsTab.vue'
import ApiTab from '@/components/conversation-settings/ApiTab.vue'
import LorebookTab from '@/components/conversation-settings/LorebookTab.vue'
import HistoryTab from '@/components/conversation-settings/HistoryTab.vue'
import VectorRecallTab from '@/components/conversation-settings/VectorRecallTab.vue'
import BudgetTrimTab from '@/components/conversation-settings/BudgetTrimTab.vue'
import AuthorsNoteTab from '@/components/conversation-settings/AuthorsNoteTab.vue'
import RegexTab from '@/components/conversation-settings/RegexTab.vue'
import PluginsTab from '@/components/conversation-settings/PluginsTab.vue'
import ConversationRecallTestDialog from '@/components/settings/ConversationRecallTestDialog.vue'
import {
  useConversationContextSettings,
  type ConversationContextSettingsProps,
} from '@/composables/conversation-settings/useConversationContextSettings'
import { watch, ref } from 'vue'

const props = defineProps<ConversationContextSettingsProps>()

const emit = defineEmits<{
  (e: 'patched', index: Record<string, unknown>, conversationId: string): void
  (e: 'memoryRebuilt', embeddingModel: string): void
  (e: 'regexApplied'): void
}>()

const ctx = useConversationContextSettings(props, emit)

const {
  dialogOpen,
  recallTestDialogOpen,
  activeSection,
  errorText,
  isSaving,
  displayConversationTitle,
  sectionItems,
  activeSectionHeader,
  open,
  close,
  bindPluginTabApi,
  bindRegexTabApi,
  presetModel,
  characterModel,
  userCharacterModel,
  lorebookModel,
  knowledgeBaseModel,
  backgroundImageFileId,
  bgmFileId,
  presetItems,
  promptsLoaded,
  charItems,
  charItemsLoading,
  lorebookItems,
  lorebookItemsLoading,
  knowledgeBaseItems,
  knowledgeBaseItemsLoading,
  savingPreset,
  savingChars,
  savingUserCharacter,
  savingBackgroundImage,
  savingBgm,
  savingLorebooks,
  savingKnowledgeBases,
  onBackgroundImageFileId,
  onBgmFileId,
  chatApiUseGlobal,
  embeddingApiUseGlobal,
  apiChatDraftActive,
  apiEmbeddingDraftActive,
  savingApiSettings,
  propsChatBinding,
  propsEmbeddingOverride,
  onChatUseGlobalLocalChange,
  onEmbeddingUseGlobalLocalChange,
  onSaveChatApi,
  onSaveEmbeddingApi,
  loreUseGlobal,
  loreRecursiveEnabled,
  loreMaxRecursionDepth,
  loreDepthItems,
  savingLoreSettings,
  historyUseGlobal,
  historyLimitEnabled,
  historyMaxTurns,
  savingHistorySettings,
  loreKeywordTopK,
  loreVectorEnabled,
  loreVectorTopK,
  knowledgeUseGlobal,
  knowledgeTopK,
  savingKnowledgeSettings,
  memoryUseGlobal,
  memoryEnabled,
  memoryTopK,
  savingMemorySettings,
  effectiveMemoryEnabled,
  memoryRebuildNeedsAttention,
  memoryRebuildLoading,
  memoryRebuildError,
  memoryRebuildDone,
  memoryRebuildTotal,
  memoryRebuildTurns,
  memoryRebuildLoreEntries,
  memoryRebuildStageLabel,
  memoryRebuildPercent,
  onRebuildMemoryClick,
  budgetTrimUseGlobal,
  budgetTrimModel,
  savingBudgetTrimSettings,
  authorsNoteEnabled,
  authorsNoteContent,
  authorsNoteDepth,
  authorsNoteRole,
  canToggleAuthorsNoteEnabled,
  savingAuthorsNote,
  onAuthorsNoteContentBlur,
  defaultAuthorsNoteContent,
  defaultAuthorsNoteDepth,
  defaultAuthorsNoteRole,
  defaultAuthorsNoteEnabledForNewChats,
  savingDefaultAuthorsNote,
  onDefaultAuthorsNoteContentBlur,
  showPluginsTab,
  savingPluginSettings,
  onPluginSettingsError,
} = ctx

defineExpose({ open })

const regexTabRef = ref<InstanceType<typeof RegexTab> | null>(null)
const pluginTabRef = ref<InstanceType<typeof PluginsTab> | null>(null)

watch(
  [regexTabRef, pluginTabRef],
  () => {
    bindRegexTabApi(
      regexTabRef.value
        ? { reload: () => void regexTabRef.value?.reload() }
        : null,
    )
    bindPluginTabApi(
      pluginTabRef.value
        ? {
            reload: () => void pluginTabRef.value?.reload(),
            backToList: () => pluginTabRef.value?.backToList(),
          }
        : null,
    )
  },
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <v-dialog
    v-model="dialogOpen"
    scrollable
    content-class="app-config-dialog-surface"
  >
    <v-card class="conv-settings-dialog">
      <v-card-title class="conv-settings-dialog__title">
        <div class="conv-settings-dialog__title-row">
          <span class="conv-settings-dialog__main-title text-body-1 font-weight-medium">
            {{ $t('chat.convSettings.title') }}
          </span>
          <div
            class="conv-settings-dialog__title-sep"
            aria-hidden="true"
          />
          <div class="conv-settings-dialog__section-head min-w-0">
            <div class="conv-settings-dialog__section-title">
              {{ activeSectionHeader.title }}
            </div>
            <p class="conv-settings-dialog__section-hint mb-0">
              {{ activeSectionHeader.hint }}
            </p>
          </div>
          <v-spacer />
          <v-progress-circular
            v-if="isSaving"
            indeterminate
            size="18"
            width="2"
            class="mr-2 flex-shrink-0"
          />
          <v-btn
            icon="mdi-close"
            variant="text"
            density="comfortable"
            class="flex-shrink-0"
            :aria-label="$t('chat.turnPromptClose')"
            @click="close"
          />
        </div>
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-0 conv-settings-dialog__body">
        <v-alert
          v-if="errorText"
          type="error"
          density="compact"
          variant="tonal"
          class="ma-4 mb-0"
          closable
          @click:close="errorText = ''"
        >
          {{ errorText }}
        </v-alert>

        <div class="conv-settings-layout">
          <nav class="conv-settings-nav">
            <v-list
              density="compact"
              nav
              class="conv-settings-nav__list"
            >
              <v-list-item
                v-for="item in sectionItems"
                :key="item.id"
                :title="item.title"
                :prepend-icon="item.icon"
                :active="activeSection === item.id"
                rounded="lg"
                color="primary"
                @click="activeSection = item.id"
              />
            </v-list>
          </nav>

          <div class="conv-settings-panel">
            <BindingsTab
              v-show="activeSection === 'bindings'"
              v-model:preset-model="presetModel"
              v-model:user-character-model="userCharacterModel"
              v-model:character-model="characterModel"
              v-model:lorebook-model="lorebookModel"
              v-model:knowledge-base-model="knowledgeBaseModel"
              :preset-items="presetItems"
              :char-items="charItems"
              :lorebook-items="lorebookItems"
              :knowledge-base-items="knowledgeBaseItems"
              :prompts-loaded="promptsLoaded"
              :char-items-loading="charItemsLoading"
              :lorebook-items-loading="lorebookItemsLoading"
              :knowledge-base-items-loading="knowledgeBaseItemsLoading"
              :saving-preset="savingPreset"
              :saving-user-character="savingUserCharacter"
              :saving-chars="savingChars"
              :saving-lorebooks="savingLorebooks"
              :saving-knowledge-bases="savingKnowledgeBases"
              :saving-background-image="savingBackgroundImage"
              :saving-bgm="savingBgm"
              :background-image-file-id="backgroundImageFileId"
              :bgm-file-id="bgmFileId"
              :initial-user-name="props.initialUserName"
              @background-image-file-id="onBackgroundImageFileId"
              @bgm-file-id="onBgmFileId"
            />

            <ApiTab
              v-show="activeSection === 'api'"
              :chat-api-use-global="chatApiUseGlobal"
              :embedding-api-use-global="embeddingApiUseGlobal"
              :chat-binding="propsChatBinding()"
              :embedding-override="propsEmbeddingOverride()"
              :global-embedding-model="props.globalEmbeddingModel ?? ''"
              :global-embedding-dimensions="props.globalEmbeddingDimensions ?? null"
              :allow-prop-sync="!apiChatDraftActive && !apiEmbeddingDraftActive && !savingApiSettings"
              :saving-api-settings="savingApiSettings"
              @update:chat-api-use-global="onChatUseGlobalLocalChange"
              @update:embedding-api-use-global="onEmbeddingUseGlobalLocalChange"
              @save-chat="onSaveChatApi"
              @save-embedding="onSaveEmbeddingApi"
            />

            <LorebookTab
              v-show="activeSection === 'lore'"
              v-model:lore-use-global="loreUseGlobal"
              v-model:lore-recursive-enabled="loreRecursiveEnabled"
              v-model:lore-max-recursion-depth="loreMaxRecursionDepth"
              :lore-depth-items="loreDepthItems"
              :saving-lore-settings="savingLoreSettings"
            />

            <HistoryTab
              v-show="activeSection === 'context'"
              v-model:history-use-global="historyUseGlobal"
              v-model:history-limit-enabled="historyLimitEnabled"
              v-model:history-max-turns="historyMaxTurns"
              :saving-history-settings="savingHistorySettings"
            />

            <VectorRecallTab
              v-show="activeSection === 'vectorRecall'"
              v-model:lore-keyword-top-k="loreKeywordTopK"
              v-model:lore-vector-enabled="loreVectorEnabled"
              v-model:lore-vector-top-k="loreVectorTopK"
              v-model:knowledge-use-global="knowledgeUseGlobal"
              v-model:knowledge-top-k="knowledgeTopK"
              v-model:memory-use-global="memoryUseGlobal"
              v-model:memory-enabled="memoryEnabled"
              v-model:memory-top-k="memoryTopK"
              :lore-use-global="loreUseGlobal"
              :saving-lore-settings="savingLoreSettings"
              :saving-knowledge-settings="savingKnowledgeSettings"
              :saving-memory-settings="savingMemorySettings"
              :effective-memory-enabled="effectiveMemoryEnabled"
              :memory-rebuild-needs-attention="memoryRebuildNeedsAttention"
              :memory-rebuild-loading="memoryRebuildLoading"
              :memory-rebuild-error="memoryRebuildError"
              :memory-rebuild-done="memoryRebuildDone"
              :memory-rebuild-total="memoryRebuildTotal"
              :memory-rebuild-turns="memoryRebuildTurns"
              :memory-rebuild-lore-entries="memoryRebuildLoreEntries"
              :memory-rebuild-stage-label="memoryRebuildStageLabel"
              :memory-rebuild-percent="memoryRebuildPercent"
              @rebuild-memory="onRebuildMemoryClick"
              @open-recall-test="recallTestDialogOpen = true"
            />

            <BudgetTrimTab
              v-show="activeSection === 'budgetTrim'"
              v-model:budget-trim-use-global="budgetTrimUseGlobal"
              v-model:budget-trim-model="budgetTrimModel"
              :saving-budget-trim-settings="savingBudgetTrimSettings"
            />

            <AuthorsNoteTab
              v-show="activeSection === 'authorsNote'"
              v-model:authors-note-content="authorsNoteContent"
              v-model:authors-note-enabled="authorsNoteEnabled"
              v-model:authors-note-depth="authorsNoteDepth"
              v-model:authors-note-role="authorsNoteRole"
              v-model:default-authors-note-content="defaultAuthorsNoteContent"
              v-model:default-authors-note-enabled-for-new-chats="defaultAuthorsNoteEnabledForNewChats"
              v-model:default-authors-note-depth="defaultAuthorsNoteDepth"
              v-model:default-authors-note-role="defaultAuthorsNoteRole"
              :saving-authors-note="savingAuthorsNote"
              :saving-default-authors-note="savingDefaultAuthorsNote"
              :can-toggle-authors-note-enabled="canToggleAuthorsNoteEnabled"
              @authors-note-content-blur="onAuthorsNoteContentBlur"
              @default-authors-note-content-blur="onDefaultAuthorsNoteContentBlur"
            />

            <RegexTab
              v-show="activeSection === 'regexApply'"
              ref="regexTabRef"
              :conversation-id="conversationId"
              @applied="emit('regexApplied')"
            />

            <PluginsTab
              v-show="activeSection === 'plugins' && showPluginsTab"
              ref="pluginTabRef"
              :conversation-id="conversationId"
              :plugin-host="pluginHost"
              @saving-change="savingPluginSettings = $event"
              @error="onPluginSettingsError"
            />
          </div>
        </div>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 py-3 conv-settings-dialog__footer">
        <div class="conv-settings-dialog__footer-meta">
          <div
            class="conv-settings-dialog__footer-title text-body-2 font-weight-medium"
            :title="displayConversationTitle"
          >
            {{ displayConversationTitle }}
          </div>
          <div class="text-caption text-medium-emphasis conv-settings-dialog__footer-sub">
            <code class="conv-settings-dialog__footer-id">{{ conversationId }}</code>
            <span class="conv-settings-dialog__footer-sep">·</span>
            {{ $t('chat.convSettings.autoSaveHint') }}
          </div>
        </div>
        <v-spacer />
        <v-btn
          variant="flat"
          color="primary"
          @click="close"
        >
          {{ $t('chat.turnPromptClose') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <ConversationRecallTestDialog
    v-model="recallTestDialogOpen"
    :conversation-id="conversationId"
  />
</template>

<style scoped>
.conv-settings-dialog {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  max-height: 100%;
}

.conv-settings-dialog__title {
  padding-block: 0.75rem;
  flex-shrink: 0;
}

.conv-settings-dialog__title-row {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  width: 100%;
  min-width: 0;
}

.conv-settings-dialog__main-title {
  flex-shrink: 0;
}

.conv-settings-dialog__title-sep {
  flex-shrink: 0;
  align-self: stretch;
  width: 0.0625rem;
  min-height: 2.25rem;
  background: rgba(var(--v-theme-on-surface), 0.14);
}

.conv-settings-dialog__section-head {
  flex: 1 1 auto;
  min-width: 0;
}

.conv-settings-dialog__section-title {
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.35;
}

.conv-settings-dialog__section-hint {
  margin-top: 0.125rem;
  font-size: 0.75rem;
  line-height: 1.4;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.62);
}

.conv-settings-dialog__footer {
  align-items: center;
  gap: 0.75rem;
}

.conv-settings-dialog__footer-meta {
  min-width: 0;
  max-width: min(100%, 28rem);
}

.conv-settings-dialog__footer-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-settings-dialog__footer-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.125rem;
  line-height: 1.4;
}

.conv-settings-dialog__footer-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  padding: 0.0625rem 0.25rem;
  border-radius: 0.25rem;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.conv-settings-dialog__footer-sep {
  opacity: 0.55;
}

.conv-settings-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.conv-settings-layout {
  display: flex;
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
}

.conv-settings-nav {
  flex: 0 0 11.5rem;
  border-inline-end: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  padding: 0.5rem;
}

.conv-settings-nav__list {
  padding: 0;
  background: transparent;
}

.conv-settings-panel {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 1rem 1.125rem 1.25rem;
}

.conv-settings-subsection__title {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(var(--v-theme-on-surface), 0.78);
}

.conv-settings-field + .conv-settings-field {
  margin-top: 0.875rem;
}

.conv-settings-field__hint {
  margin: 0.375rem 0 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.58);
}

.user-macro-tag {
  font-family: ui-monospace, monospace;
  font-size: 0.85em;
  padding: 0 0.15em;
}

@media (max-width: 40rem) {
  .conv-settings-layout {
    flex-direction: column;
    min-height: 0;
  }

  .conv-settings-nav {
    flex: 0 0 auto;
    border-inline-end: none;
    border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
    padding: 0.375rem 0.5rem;
  }

  .conv-settings-nav__list {
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    gap: 0.25rem;
  }

  .conv-settings-nav__list :deep(.v-list-item) {
    flex: 0 0 auto;
    min-width: max-content;
  }

  .conv-settings-panel {
    max-height: none;
  }
}
</style>
