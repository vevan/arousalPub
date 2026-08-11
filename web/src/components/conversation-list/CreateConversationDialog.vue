<script setup lang="ts">
import type { CharacterPickerItem, LorebookPickerItem } from '@/composables/conversation-list/types'

defineProps<{
  modelValue: boolean
  createErrorText: string
  createTitleDraft: string
  selectedUserCard: CharacterPickerItem | null
  selectedCharacterCards: (CharacterPickerItem | null)[]
  lorebookItems: LorebookPickerItem[]
  lorebookItemsLoading: boolean
  selectedLorebookIds: string[]
  creating: boolean
  canStartCreate: boolean
  characterImage: (id: string) => string
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  'update:createTitleDraft': [value: string]
  'update:selectedLorebookIds': [value: string[]]
  close: []
  openUserPicker: []
  openCharacterPicker: [index: number]
  addCharacterSlot: []
  removeCharacterSlot: [index: number]
  submit: []
}>()

function onDialogModel(open: boolean) {
  emit('update:modelValue', open)
  if (!open) emit('close')
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="58rem"
    scrollable
    @update:model-value="onDialogModel"
  >
    <v-card class="create-chat-card">
      <v-card-title class="text-subtitle-1">
        {{ $t('conversationList.createDialogTitle') }}
      </v-card-title>
      <v-card-text>
        <v-alert
          v-if="createErrorText"
          type="error"
          density="compact"
          variant="tonal"
          class="mb-3"
        >
          {{ createErrorText }}
        </v-alert>

        <p class="create-chat-card__hint">
          {{ $t('conversationList.createDialogHint') }}
        </p>

        <v-text-field
          :model-value="createTitleDraft"
          :label="$t('chatConversation.titleLabel')"
          :placeholder="$t('conversationList.createTitlePlaceholder')"
          variant="outlined"
          density="comfortable"
          hide-details="auto"
          class="mb-4"
          autofocus
          @update:model-value="emit('update:createTitleDraft', String($event ?? ''))"
          @keydown.enter.prevent="canStartCreate && emit('submit')"
        />

        <div class="create-slots">
          <section class="create-slot-section">
            <h3 class="create-slot-section__title">
              {{ $t('conversationList.userSlotTitle') }}
            </h3>
            <button
              type="button"
              class="create-slot-card"
              :class="{ 'is-filled': selectedUserCard }"
              @click="emit('openUserPicker')"
            >
              <template v-if="selectedUserCard">
                <img
                  class="create-slot-card__avatar"
                  :src="characterImage(selectedUserCard.id)"
                  alt=""
                />
                <span class="create-slot-card__name">{{ selectedUserCard.name }}</span>
                <span class="create-slot-card__meta">{{
                  $t('conversationList.userSlotMeta')
                }}</span>
              </template>
              <template v-else>
                <span class="create-slot-card__plus">+</span>
                <span>{{ $t('conversationList.pickUserCard') }}</span>
              </template>
            </button>
          </section>

          <section class="create-slot-section">
            <div class="create-slot-section__head">
              <h3 class="create-slot-section__title">
                {{ $t('conversationList.characterSlotsTitle') }}
              </h3>
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-plus"
                @click="emit('addCharacterSlot')"
              >
                {{ $t('conversationList.addCharacterSlot') }}
              </v-btn>
            </div>
            <div class="create-character-slots">
              <button
                v-for="(card, i) in selectedCharacterCards"
                :key="i"
                type="button"
                class="create-slot-card"
                :class="{ 'is-filled': card }"
                @click="emit('openCharacterPicker', i)"
              >
                <template v-if="card">
                  <img
                    class="create-slot-card__avatar"
                    :src="characterImage(card.id)"
                    alt=""
                  />
                  <span class="create-slot-card__name">{{ card.name }}</span>
                  <span class="create-slot-card__meta">
                    {{
                      i === 0
                        ? $t('conversationList.primaryCharacterMeta')
                        : $t('conversationList.extraCharacterMeta', { n: i + 1 })
                    }}
                  </span>
                </template>
                <template v-else>
                  <span class="create-slot-card__plus">+</span>
                  <span>
                    {{
                      i === 0
                        ? $t('conversationList.pickPrimaryCharacter')
                        : $t('conversationList.pickExtraCharacter', { n: i + 1 })
                    }}
                  </span>
                </template>
                <v-btn
                  v-if="selectedCharacterCards.length > 1"
                  class="create-slot-card__remove"
                  icon="mdi-close"
                  variant="text"
                  size="x-small"
                  @click.stop="emit('removeCharacterSlot', i)"
                />
              </button>
            </div>
          </section>

          <section class="create-slot-section">
            <h3 class="create-slot-section__title">
              {{ $t('conversationList.lorebookSlotTitle') }}
            </h3>
            <v-select
              :model-value="selectedLorebookIds"
              :items="lorebookItems"
              item-title="name"
              item-value="id"
              :label="$t('conversationList.lorebookSelectLabel')"
              :hint="$t('conversationList.lorebookSelectHint')"
              persistent-hint
              multiple
              chips
              closable-chips
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              :loading="lorebookItemsLoading"
              @update:model-value="
                emit('update:selectedLorebookIds', ($event as string[]) ?? [])
              "
            />
          </section>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('close')">
          {{ $t('settings.themeCancel') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="creating"
          :disabled="!canStartCreate"
          @click="emit('submit')"
        >
          {{ $t('conversationList.startChat') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.create-chat-card__hint {
  margin: 0 0 1rem;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.8125rem;
  line-height: 1.5;
}
.create-slots {
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
}
.create-slot-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.create-slot-section__title {
  margin: 0 0 0.5rem;
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
}
.create-slot-section__head .create-slot-section__title {
  margin-bottom: 0;
}
.create-character-slots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
  gap: 0.75rem;
}
.create-slot-card {
  position: relative;
  min-height: 8rem;
  padding: 0.875rem;
  border: 0.0625rem dashed rgba(var(--v-theme-on-surface), 0.18);
  border-radius: var(--radius);
  background: rgba(var(--v-theme-surface-light), 0.6);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  text-align: center;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.create-slot-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.05);
}
.create-slot-card.is-filled {
  border-style: solid;
  border-color: rgba(var(--v-theme-on-surface), 0.1);
  background: rgb(var(--v-theme-surface-light));
  color: rgb(var(--v-theme-on-surface));
}
.create-slot-card__plus {
  color: rgb(var(--v-theme-primary));
  font-family: var(--font-display);
  font-size: 2rem;
  line-height: 1;
}
.create-slot-card__avatar {
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 50%;
  object-fit: cover;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.1);
}
.create-slot-card__name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.create-slot-card__meta {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}
.create-slot-card__remove {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
}
</style>
