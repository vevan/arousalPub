<script setup lang="ts">
import { BRANCH_LABEL_MAX_LENGTH } from '@/utils/conversation-branches-api'
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  initialLabel?: string
  hint?: string
  confirmText: string
  busy?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  confirm: [label: string]
}>()

const draft = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (open) draft.value = props.initialLabel ?? ''
  },
)

function close() {
  emit('update:modelValue', false)
}

function submit() {
  emit('confirm', draft.value)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="24rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-body-1 font-weight-medium">
        {{ title }}
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="draft"
          :label="$t('chat.branches.labelField')"
          :hint="hint"
          :maxlength="BRANCH_LABEL_MAX_LENGTH"
          counter
          persistent-hint
          autofocus
          :disabled="busy"
          @keyup.enter="submit"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="busy" @click="close">
          {{ $t('settings.themeCancel') }}
        </v-btn>
        <v-btn color="primary" variant="flat" :disabled="busy" @click="submit">
          {{ confirmText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
