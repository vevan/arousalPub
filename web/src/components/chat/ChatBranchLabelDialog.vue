<script setup lang="ts">
import { BRANCH_LABEL_MAX_LENGTH } from '@/utils/conversation-branches-api'
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  initialLabel?: string
  hint?: string
  subtitle?: string
  confirmText: string
  busy?: boolean
  errorText?: string
  showStayCheckbox?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  confirm: [label: string, setActive?: boolean]
}>()

const draft = ref('')
const stayOnCurrentBranch = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      draft.value = props.initialLabel ?? ''
      stayOnCurrentBranch.value = false
    }
  },
)

function close() {
  emit('update:modelValue', false)
}

function submit() {
  const setActive = props.showStayCheckbox ? !stayOnCurrentBranch.value : undefined
  emit('confirm', draft.value, setActive)
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
        <v-alert
          v-if="errorText"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ errorText }}
        </v-alert>
        <p
          v-if="subtitle"
          class="text-body-2 text-medium-emphasis mb-3"
        >
          {{ subtitle }}
        </p>
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
        <v-checkbox
          v-if="showStayCheckbox"
          v-model="stayOnCurrentBranch"
          :label="$t('chat.branches.createBranchStayOnCurrent')"
          hide-details
          density="compact"
          :disabled="busy"
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
