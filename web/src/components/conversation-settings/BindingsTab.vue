<script setup lang="ts">
import ConversationMediaFileField from '@/components/ConversationMediaFileField.vue'
import type { CharItem, LorebookItem } from '@/composables/conversation-settings/types'
import '@/components/conversation-settings/conversation-settings-fields.css'

/** 提示词宏名；勿写入 i18n（vue-i18n 会将 `{{` 当作占位符） */
const PROMPT_USER_MACRO = '{{user}}'

const presetModel = defineModel<string>('presetModel', { required: true })
const userCharacterModel = defineModel<string | null>('userCharacterModel', { required: true })
const characterModel = defineModel<string[]>('characterModel', { required: true })
const lorebookModel = defineModel<string[]>('lorebookModel', { required: true })
const knowledgeBaseModel = defineModel<string[]>('knowledgeBaseModel', { required: true })

defineProps<{
  presetItems: Array<{ title: string; value: string }>
  charItems: CharItem[]
  lorebookItems: LorebookItem[]
  knowledgeBaseItems: LorebookItem[]
  promptsLoaded: boolean
  charItemsLoading: boolean
  lorebookItemsLoading: boolean
  knowledgeBaseItemsLoading: boolean
  savingPreset: boolean
  savingUserCharacter: boolean
  savingChars: boolean
  savingLorebooks: boolean
  savingKnowledgeBases: boolean
  savingBackgroundImage: boolean
  savingBgm: boolean
  backgroundImageFileId: string | null
  bgmFileId: string | null
  initialUserName?: string | null
}>()

const emit = defineEmits<{
  (e: 'backgroundImageFileId', id: string | null): void
  (e: 'bgmFileId', id: string | null): void
}>()

function onBackgroundImageFileId(id: string | null) {
  emit('backgroundImageFileId', id)
}
function onBgmFileId(id: string | null) {
  emit('bgmFileId', id)
}
</script>

<template>
  <div class="conv-settings-section">
    <div class="conv-settings-field">
                    <v-select
                      v-model="presetModel"
                      :items="presetItems"
                      item-title="title"
                      item-value="value"
                      :label="$t('chat.convSettings.promptPreset')"
                      density="comfortable"
                      variant="outlined"
                      hide-details="auto"
                      :loading="savingPreset || !promptsLoaded"
                      :disabled="!promptsLoaded"
                    />
                  </div>
    
                  <div class="conv-settings-field">
                    <v-select
                      v-model="userCharacterModel"
                      :items="charItems"
                      item-title="name"
                      item-value="id"
                      :label="$t('chat.convSettings.userCharacter')"
                      density="comfortable"
                      variant="outlined"
                      hide-details="auto"
                      clearable
                      :loading="charItemsLoading || savingUserCharacter"
                    />
                    <p class="conv-settings-field__hint">
                      {{ $t('chat.convSettings.userCharacterHint') }}
                    </p>
                    <p
                      v-if="initialUserName"
                      class="conv-settings-field__hint text-medium-emphasis"
                    >
                      {{ $t('chat.convSettings.userNameCurrent', { name: initialUserName }) }}
                      <code class="user-macro-tag">{{ PROMPT_USER_MACRO }}</code>
                    </p>
                  </div>
    
                  <div class="conv-settings-field">
                    <v-select
                      v-model="characterModel"
                      :items="charItems"
                      item-title="name"
                      item-value="id"
                      :label="$t('chat.convSettings.characters')"
                      density="comfortable"
                      variant="outlined"
                      multiple
                      chips
                      closable-chips
                      hide-details="auto"
                      :loading="charItemsLoading || savingChars"
                    />
                    <p class="conv-settings-field__hint">
                      {{ $t('chat.convSettings.charactersHint') }}
                    </p>
                  </div>
    
                  <div class="conv-settings-field">
                    <v-select
                      v-model="lorebookModel"
                      :items="lorebookItems"
                      item-title="name"
                      item-value="id"
                      :label="$t('chat.convSettings.lorebooks')"
                      density="comfortable"
                      variant="outlined"
                      multiple
                      chips
                      closable-chips
                      hide-details="auto"
                      :loading="lorebookItemsLoading || savingLorebooks"
                    />
                    <p class="conv-settings-field__hint">
                      {{ $t('chat.convSettings.lorebooksHint') }}
                    </p>
                  </div>
    
                  <div class="conv-settings-field">
                    <v-select
                      v-model="knowledgeBaseModel"
                      :items="knowledgeBaseItems"
                      item-title="name"
                      item-value="id"
                      :label="$t('chat.convSettings.knowledgeBases')"
                      density="comfortable"
                      variant="outlined"
                      multiple
                      chips
                      closable-chips
                      hide-details="auto"
                      :loading="knowledgeBaseItemsLoading || savingKnowledgeBases"
                    />
                    <p class="conv-settings-field__hint">
                      {{ $t('chat.convSettings.knowledgeBasesHint') }}
                    </p>
                  </div>
    
                  <div class="conv-settings-field">
                    <ConversationMediaFileField
                      kind="image"
                      :file-id="backgroundImageFileId"
                      :label="$t('chat.convSettings.backgroundImage')"
                      :hint="$t('chat.convSettings.backgroundImageHint')"
                      :saving="savingBackgroundImage"
                      @update:file-id="onBackgroundImageFileId"
                    />
                  </div>
    
                  <div class="conv-settings-field">
                    <ConversationMediaFileField
                      kind="audio"
                      :file-id="bgmFileId"
                      :label="$t('chat.convSettings.bgm')"
                      :hint="$t('chat.convSettings.bgmHint')"
                      :saving="savingBgm"
                      @update:file-id="onBgmFileId"
                    />
                  </div>
  </div>
</template>
