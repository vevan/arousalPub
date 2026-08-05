<script setup lang="ts">
defineProps<{
  modelValue: boolean
  storedModel: string | null
  currentModel: string
  embeddingDimensions: number | null
  loading: boolean
  errorText: string
  done: number
  total: number
  turns: number
  loreEntries: number
  stageLabel: string
  percent: number
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  dismiss: []
  confirm: []
}>()
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="32rem"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-body-1 font-weight-medium">
        {{ $t('chatConversation.memoryRebuildTitle') }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-3">
          {{ $t('chatConversation.memoryRebuildBody') }}
        </p>
        <div class="text-body-2 text-medium-emphasis">
          <div v-if="storedModel">
            {{ $t('chatConversation.memoryRebuildStoredModel') }}:
            <code>{{ storedModel }}</code>
          </div>
          <div v-else>
            {{ $t('chatConversation.memoryRebuildStoredUnknown') }}
          </div>
          <div class="mt-1">
            {{ $t('chatConversation.memoryRebuildCurrentModel') }}:
            <code>{{ currentModel }}</code>
            <template v-if="embeddingDimensions != null">
              · {{ embeddingDimensions }}d
            </template>
          </div>
        </div>
        <v-alert
          v-if="errorText"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
        >
          {{ errorText }}
        </v-alert>
        <div
          v-if="loading"
          class="mt-3"
        >
          <div class="text-body-2 text-medium-emphasis mb-1">
            {{ stageLabel }} ·
            {{
              $t('chatConversation.memoryRebuildProgress', {
                done,
                total,
              })
            }}
          </div>
          <div
            v-if="total > 0"
            class="text-caption text-medium-emphasis mb-2"
          >
            {{
              $t('chatConversation.memoryRebuildProgressDetail', {
                turns,
                loreEntries,
              })
            }}
          </div>
          <v-progress-linear
            :model-value="total > 0 ? percent : undefined"
            :indeterminate="total < 1"
            height="8"
            rounded
            color="primary"
          />
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="loading"
          @click="emit('dismiss')"
        >
          {{ $t('chatConversation.memoryRebuildLater') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ $t('chatConversation.memoryRebuildConfirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
