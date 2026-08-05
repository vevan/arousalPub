<script setup lang="ts">
defineProps<{
  modelValue: boolean
  targetLabel: string
  confirming: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  confirm: []
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
        {{ $t('conversationList.deleteDialogTitle') }}
      </v-card-title>
      <v-card-text class="text-body-2">
        {{
          $t('conversationList.deleteDialogBody', {
            title: targetLabel || $t('chat.newConversation'),
          })
        }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('cancel')">
          {{ $t('settings.themeCancel') }}
        </v-btn>
        <v-btn
          color="error"
          variant="flat"
          :loading="confirming"
          @click="emit('confirm')"
        >
          {{ $t('conversationList.delete') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
