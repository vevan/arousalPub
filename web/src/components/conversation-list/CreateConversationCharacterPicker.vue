<script setup lang="ts">
import type { CharacterPickerItem } from '@/composables/conversation-list/types'

defineProps<{
  modelValue: boolean
  pickerKind: 'user' | 'character' | null
  userPickerOnlyMarked: boolean
  characterPickerExcludeUser: boolean
  charItemsLoading: boolean
  displayedCharItems: CharacterPickerItem[]
  characterImage: (id: string) => string
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  'update:userPickerOnlyMarked': [value: boolean]
  'update:characterPickerExcludeUser': [value: boolean]
  select: [item: CharacterPickerItem]
}>()
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="34rem"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1">
        {{ $t('conversationList.pickCharacterDialogTitle') }}
      </v-card-title>
      <v-card-text>
        <v-switch
          v-if="pickerKind === 'user'"
          :model-value="userPickerOnlyMarked"
          :label="$t('conversationList.userPickerOnlyMarked')"
          :hint="$t('conversationList.userPickerOnlyMarkedHint')"
          persistent-hint
          density="compact"
          hide-details="auto"
          color="primary"
          class="mb-3"
          @update:model-value="
            emit('update:userPickerOnlyMarked', Boolean($event))
          "
        />
        <v-switch
          v-if="pickerKind === 'character'"
          :model-value="characterPickerExcludeUser"
          :label="$t('conversationList.characterPickerExcludeUser')"
          :hint="$t('conversationList.characterPickerExcludeUserHint')"
          persistent-hint
          density="compact"
          hide-details="auto"
          color="primary"
          class="mb-3"
          @update:model-value="
            emit('update:characterPickerExcludeUser', Boolean($event))
          "
        />
        <div
          v-if="charItemsLoading"
          class="text-body-2 text-medium-emphasis pa-3"
        >
          {{ $t('conversationList.loadingCharacters') }}
        </div>
        <div
          v-else-if="displayedCharItems.length === 0"
          class="text-body-2 text-medium-emphasis pa-3"
        >
          {{ $t('conversationList.pickerEmpty') }}
        </div>
        <v-list
          v-else
          class="create-picker-list"
          density="comfortable"
        >
          <v-list-item
            v-for="item in displayedCharItems"
            :key="item.id"
            :title="item.name"
            :subtitle="item.summary"
            @click="emit('select', item)"
          >
            <template #prepend>
              <v-avatar size="40">
                <v-img :src="characterImage(item.id)" />
              </v-avatar>
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">
          {{ $t('settings.themeCancel') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.create-picker-list {
  background: transparent;
}
</style>
