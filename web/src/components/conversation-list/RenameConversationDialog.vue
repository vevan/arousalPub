<script setup lang="ts">
defineProps<{
  modelValue: boolean
  draft: string
  saving: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  'update:draft': [value: string]
  submit: []
  cancel: []
}>()
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1">
        {{ $t('conversationList.renameDialogTitle') }}
      </v-card-title>
      <v-card-text>
        <v-text-field
          :model-value="draft"
          :label="$t('chatConversation.titleLabel')"
          variant="outlined"
          density="comfortable"
          hide-details="auto"
          autofocus
          @update:model-value="emit('update:draft', String($event ?? ''))"
          @keydown.enter.prevent="emit('submit')"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('cancel')">
          {{ $t('settings.themeCancel') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="saving"
          :disabled="!draft.trim()"
          @click="emit('submit')"
        >
          {{ $t('settings.themeConfirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
