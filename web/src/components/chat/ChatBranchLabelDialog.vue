<script setup lang="ts">
import { BRANCH_LABEL_MAX_LENGTH } from '@/utils/conversation-branches-api'
import type { BranchSwipeOption } from '@/utils/conversation-branches-types'
import { computed, ref, watch } from 'vue'

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
  swipeOptions?: BranchSwipeOption[]
  initialSwipeId?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  confirm: [label: string, setActive?: boolean, forkMessageId?: string]
}>()

const draft = ref('')
const stayOnCurrentBranch = ref(false)
const selectedSwipeId = ref('')

const showSwipePicker = computed(
  () => (props.swipeOptions?.length ?? 0) >= 2,
)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      draft.value = props.initialLabel ?? ''
      stayOnCurrentBranch.value = false
      const initial = props.initialSwipeId?.trim()
      const opts = props.swipeOptions ?? []
      if (initial && opts.some((o) => o.id === initial)) {
        selectedSwipeId.value = initial
      } else {
        selectedSwipeId.value = opts[0]?.id ?? ''
      }
    }
  },
)

function close() {
  emit('update:modelValue', false)
}

function submit() {
  const setActive = props.showStayCheckbox ? !stayOnCurrentBranch.value : undefined
  const forkMessageId = showSwipePicker.value
    ? selectedSwipeId.value.trim() || undefined
    : undefined
  emit('confirm', draft.value, setActive, forkMessageId)
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
        <div
          v-if="showSwipePicker"
          class="mb-3"
        >
          <p class="text-body-2 mb-2">
            {{ $t('chat.branches.createBranchSwipeLabel') }}
          </p>
          <v-radio-group
            v-model="selectedSwipeId"
            hide-details
            density="compact"
            :disabled="busy"
          >
            <v-radio
              v-for="opt in swipeOptions"
              :key="opt.id"
              :value="opt.id"
              :disabled="busy"
            >
              <template #label>
                <div class="branch-swipe-option">
                  <span class="text-body-2">
                    {{
                      $t('chat.branches.createBranchSwipeOption', {
                        n: opt.index + 1,
                      })
                    }}
                  </span>
                  <span
                    v-if="opt.preview"
                    class="text-caption text-medium-emphasis branch-swipe-option__preview"
                  >
                    {{ opt.preview }}
                  </span>
                </div>
              </template>
            </v-radio>
          </v-radio-group>
        </div>
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

<style scoped>
.branch-swipe-option {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding-block: 0.15rem;
  min-width: 0;
}
.branch-swipe-option__preview {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-word;
}
</style>
