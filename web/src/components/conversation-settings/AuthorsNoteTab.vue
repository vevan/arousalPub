<script setup lang="ts">
import {
  AUTHORS_NOTE_MAX_DEPTH,
  type AuthorsNoteRole,
} from '@/utils/authors-note-settings'
import '@/components/conversation-settings/conversation-settings-fields.css'

const authorsNoteContent = defineModel<string>('authorsNoteContent', { required: true })
const authorsNoteEnabled = defineModel<boolean>('authorsNoteEnabled', { required: true })
const authorsNoteDepth = defineModel<number>('authorsNoteDepth', { required: true })
const authorsNoteRole = defineModel<AuthorsNoteRole>('authorsNoteRole', { required: true })
const defaultAuthorsNoteContent = defineModel<string>('defaultAuthorsNoteContent', {
  required: true,
})
const defaultAuthorsNoteEnabledForNewChats = defineModel<boolean>(
  'defaultAuthorsNoteEnabledForNewChats',
  { required: true },
)
const defaultAuthorsNoteDepth = defineModel<number>('defaultAuthorsNoteDepth', { required: true })
const defaultAuthorsNoteRole = defineModel<AuthorsNoteRole>('defaultAuthorsNoteRole', {
  required: true,
})

defineProps<{
  savingAuthorsNote: boolean
  savingDefaultAuthorsNote: boolean
  canToggleAuthorsNoteEnabled: boolean
}>()

const emit = defineEmits<{
  (e: 'authorsNoteContentBlur'): void
  (e: 'defaultAuthorsNoteContentBlur'): void
}>()

function onAuthorsNoteContentBlur() {
  emit('authorsNoteContentBlur')
}
function onDefaultAuthorsNoteContentBlur() {
  emit('defaultAuthorsNoteContentBlur')
}
</script>

<template>
  <div class="conv-settings-section">
    <p class="text-subtitle-2 font-weight-medium mb-2">
                    {{ $t('chat.convSettings.authorsNoteSessionHeading') }}
                  </p>
                  <div class="conv-settings-field">
                    <v-textarea
                      v-model="authorsNoteContent"
                      :label="$t('chat.convSettings.authorsNoteContent')"
                      rows="6"
                      auto-grow
                      variant="outlined"
                      density="comfortable"
                      hide-details="auto"
                      :loading="savingAuthorsNote"
                      @blur="onAuthorsNoteContentBlur"
                    />
                    <p class="conv-settings-field__hint">
                      {{ $t('chat.convSettings.authorsNoteContentHint') }}
                    </p>
                  </div>
    
                  <div class="conv-settings-field">
                    <v-switch
                      v-model="authorsNoteEnabled"
                      :label="$t('chat.convSettings.authorsNoteEnabled')"
                      density="comfortable"
                      hide-details
                      color="primary"
                      :loading="savingAuthorsNote"
                      :disabled="!canToggleAuthorsNoteEnabled || savingAuthorsNote"
                    />
                    <p class="conv-settings-field__hint">
                      {{ $t('chat.convSettings.authorsNoteEnabledHint') }}
                    </p>
                  </div>
    
                  <div class="conv-settings-field">
                    <v-text-field
                      v-model.number="authorsNoteDepth"
                      type="number"
                      min="0"
                      :max="AUTHORS_NOTE_MAX_DEPTH"
                      step="1"
                      :label="$t('chat.convSettings.authorsNoteDepth')"
                      density="comfortable"
                      variant="outlined"
                      hide-details="auto"
                      :loading="savingAuthorsNote"
                      :disabled="savingAuthorsNote"
                    />
                    <p class="conv-settings-field__hint">
                      {{ $t('chat.convSettings.authorsNoteDepthHint') }}
                    </p>
                  </div>
    
                  <div class="conv-settings-field">
                    <v-select
                      v-model="authorsNoteRole"
                      :items="[
                        { title: $t('chat.convSettings.authorsNoteRoleSystem'), value: 'system' },
                        { title: $t('chat.convSettings.authorsNoteRoleUser'), value: 'user' },
                      ]"
                      item-title="title"
                      item-value="value"
                      :label="$t('chat.convSettings.authorsNoteRole')"
                      density="comfortable"
                      variant="outlined"
                      hide-details="auto"
                      :loading="savingAuthorsNote"
                      :disabled="savingAuthorsNote"
                    />
                  </div>
    
                  <v-divider class="my-4" />
    
                  <p class="text-subtitle-2 font-weight-medium mb-1">
                    {{ $t('chat.convSettings.defaultAuthorsNoteHeading') }}
                  </p>
                  <p class="text-caption text-medium-emphasis mb-3">
                    {{ $t('chat.convSettings.defaultAuthorsNoteIntro') }}
                  </p>
    
                  <div class="conv-settings-field">
                    <v-textarea
                      v-model="defaultAuthorsNoteContent"
                      :label="$t('chat.convSettings.defaultAuthorsNoteContent')"
                      rows="5"
                      auto-grow
                      variant="outlined"
                      density="comfortable"
                      hide-details="auto"
                      :loading="savingDefaultAuthorsNote"
                      @blur="onDefaultAuthorsNoteContentBlur"
                    />
                    <p class="conv-settings-field__hint">
                      {{ $t('chat.convSettings.defaultAuthorsNoteContentHint') }}
                    </p>
                  </div>
    
                  <div class="conv-settings-field">
                    <v-switch
                      v-model="defaultAuthorsNoteEnabledForNewChats"
                      :label="$t('chat.convSettings.defaultAuthorsNoteEnabledForNewChats')"
                      density="comfortable"
                      hide-details
                      color="primary"
                      :loading="savingDefaultAuthorsNote"
                      :disabled="savingDefaultAuthorsNote"
                    />
                    <p class="conv-settings-field__hint">
                      {{ $t('chat.convSettings.defaultAuthorsNoteEnabledForNewChatsHint') }}
                    </p>
                  </div>
    
                  <div class="conv-settings-field">
                    <v-text-field
                      v-model.number="defaultAuthorsNoteDepth"
                      type="number"
                      min="0"
                      :max="AUTHORS_NOTE_MAX_DEPTH"
                      step="1"
                      :label="$t('chat.convSettings.authorsNoteDepth')"
                      density="comfortable"
                      variant="outlined"
                      hide-details="auto"
                      :loading="savingDefaultAuthorsNote"
                      :disabled="savingDefaultAuthorsNote"
                    />
                    <p class="conv-settings-field__hint">
                      {{ $t('chat.convSettings.defaultAuthorsNoteDepthHint') }}
                    </p>
                  </div>
    
                  <div class="conv-settings-field">
                    <v-select
                      v-model="defaultAuthorsNoteRole"
                      :items="[
                        { title: $t('chat.convSettings.authorsNoteRoleSystem'), value: 'system' },
                        { title: $t('chat.convSettings.authorsNoteRoleUser'), value: 'user' },
                      ]"
                      item-title="title"
                      item-value="value"
                      :label="$t('chat.convSettings.authorsNoteRole')"
                      density="comfortable"
                      variant="outlined"
                      hide-details="auto"
                      :loading="savingDefaultAuthorsNote"
                      :disabled="savingDefaultAuthorsNote"
                    />
                  </div>
  </div>
</template>
