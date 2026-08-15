<script setup lang="ts">
import '@/components/conversation-settings/conversation-settings-fields.css'
import HybridFtsSwitchDialog from '@/components/settings/HybridFtsSwitchDialog.vue'
import {
  HYBRID_FTS_PROFILES,
  profileRequiresDict,
  type HybridFtsDictVariant,
  type HybridFtsProfile,
} from '@/utils/hybrid-fts-settings'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const loreKeywordTopK = defineModel<number>('loreKeywordTopK', { required: true })
const loreVectorEnabled = defineModel<boolean>('loreVectorEnabled', { required: true })
const loreVectorTopK = defineModel<number>('loreVectorTopK', { required: true })
const knowledgeUseGlobal = defineModel<boolean>('knowledgeUseGlobal', { required: true })
const knowledgeTopK = defineModel<number>('knowledgeTopK', { required: true })
const memoryUseGlobal = defineModel<boolean>('memoryUseGlobal', { required: true })
const memoryEnabled = defineModel<boolean>('memoryEnabled', { required: true })
const memoryTopK = defineModel<number>('memoryTopK', { required: true })
const memoryHybridFtsUseGlobal = defineModel<boolean>('memoryHybridFtsUseGlobal', {
  required: true,
})
const memoryHybridFtsSwitchOpen = defineModel<boolean>('memoryHybridFtsSwitchOpen', {
  required: true,
})

defineProps<{
  loreUseGlobal: boolean
  savingLoreSettings: boolean
  savingKnowledgeSettings: boolean
  savingMemorySettings: boolean
  effectiveMemoryEnabled: boolean
  memoryRebuildNeedsAttention: boolean
  memoryRebuildLoading: boolean
  memoryRebuildError: string
  memoryRebuildDone: number
  memoryRebuildTotal: number
  memoryRebuildTurns: number
  memoryRebuildLoreEntries: number
  memoryRebuildStageLabel: string
  memoryRebuildPercent: number
  memoryHybridFtsProfile: HybridFtsProfile
  memoryHybridFtsDictVariant: HybridFtsDictVariant | null
  pendingMemoryHybridFtsProfile: HybridFtsProfile
  savingMemoryHybridFts: boolean
}>()

const emit = defineEmits<{
  (e: 'rebuildMemory'): void
  (e: 'openRecallTest'): void
  (e: 'memoryHybridFtsProfilePick', profile: HybridFtsProfile): void
  (e: 'openMemoryHybridFtsManage'): void
  (e: 'memoryHybridFtsConfirm', payload: {
    profile: HybridFtsProfile
    dictVariant: HybridFtsDictVariant | null
  }): void
  (e: 'memoryHybridFtsCancel'): void
}>()

const { t } = useI18n()
const hybridFtsProfileItems = computed(() =>
  HYBRID_FTS_PROFILES.map((value) => ({
    value,
    title: t(`settings.hybridFtsProfile.${value}`),
  })),
)

function onRebuildMemoryClick() {
  emit('rebuildMemory')
}
</script>

<template>
  <div class="conv-settings-section">
    <div class="conv-settings-subsection">
                    <h4 class="conv-settings-subsection__title">
                      {{ $t('chat.convSettings.sectionLoreVector') }}
                    </h4>
                    <p
                      v-if="loreUseGlobal"
                      class="conv-settings-field__hint mb-3"
                    >
                      {{ $t('chat.convSettings.loreVectorInheritGlobalHint') }}
                    </p>
                    <div class="conv-settings-field">
                      <v-text-field
                        v-model.number="loreKeywordTopK"
                        type="number"
                        min="1"
                        max="64"
                        step="1"
                        :label="$t('chat.convSettings.loreKeywordTopK')"
                        density="comfortable"
                        variant="outlined"
                        hide-details="auto"
                        :disabled="loreUseGlobal || savingLoreSettings"
                        :loading="savingLoreSettings"
                      />
                      <p class="conv-settings-field__hint">
                        {{ $t('chat.convSettings.loreKeywordTopKHint') }}
                      </p>
                    </div>
                    <div class="conv-settings-field">
                      <v-switch
                        v-model="loreVectorEnabled"
                        :label="$t('chat.convSettings.loreVectorEnabled')"
                        density="comfortable"
                        hide-details
                        color="primary"
                        :loading="savingLoreSettings"
                        :disabled="loreUseGlobal || savingLoreSettings"
                      />
                    </div>
                    <div class="conv-settings-field">
                      <v-text-field
                        v-model.number="loreVectorTopK"
                        type="number"
                        min="1"
                        max="20"
                        step="1"
                        :label="$t('chat.convSettings.loreVectorTopK')"
                        density="comfortable"
                        variant="outlined"
                        hide-details="auto"
                        :disabled="loreUseGlobal || !loreVectorEnabled || savingLoreSettings"
                        :loading="savingLoreSettings"
                      />
                      <p
                        v-if="loreVectorEnabled"
                        class="conv-settings-field__hint"
                      >
                        {{ $t('chat.convSettings.loreVectorTopKHint') }}
                      </p>
                    </div>
                  </div>
    
                  <v-divider class="my-4" />
    
                  <div class="conv-settings-subsection">
                    <h4 class="conv-settings-subsection__title">
                      {{ $t('chat.convSettings.sectionKnowledge') }}
                    </h4>
                    <div class="conv-settings-field">
                      <v-switch
                        v-model="knowledgeUseGlobal"
                        :label="$t('chat.convSettings.knowledgeUseGlobal')"
                        density="comfortable"
                        hide-details
                        color="primary"
                        :loading="savingKnowledgeSettings"
                        :disabled="savingKnowledgeSettings"
                      />
                      <p
                        v-if="knowledgeUseGlobal"
                        class="conv-settings-field__hint"
                      >
                        {{ $t('chat.convSettings.knowledgeInheritGlobalHint') }}
                      </p>
                    </div>
                    <div class="conv-settings-field">
                      <v-text-field
                        v-model.number="knowledgeTopK"
                        type="number"
                        min="1"
                        max="32"
                        step="1"
                        :label="$t('chat.convSettings.knowledgeTopK')"
                        density="comfortable"
                        variant="outlined"
                        hide-details="auto"
                        :loading="savingKnowledgeSettings"
                        :disabled="knowledgeUseGlobal || savingKnowledgeSettings"
                      />
                      <p class="conv-settings-field__hint">
                        {{ $t('chat.convSettings.knowledgeTopKHint') }}
                      </p>
                    </div>
                  </div>
    
                  <v-divider class="my-4" />
    
                  <div class="conv-settings-subsection">
                    <h4 class="conv-settings-subsection__title">
                      {{ $t('chat.convSettings.sectionMemory') }}
                    </h4>
                    <div class="conv-settings-field">
                      <v-switch
                        v-model="memoryUseGlobal"
                        :label="$t('chat.convSettings.memoryUseGlobal')"
                        density="comfortable"
                        hide-details
                        color="primary"
                        :loading="savingMemorySettings"
                        :disabled="savingMemorySettings"
                      />
                      <p
                        v-if="memoryUseGlobal"
                        class="conv-settings-field__hint"
                      >
                        {{ $t('chat.convSettings.memoryInheritGlobalHint') }}
                      </p>
                    </div>
                    <div class="conv-settings-field">
                      <v-switch
                        v-model="memoryEnabled"
                        :label="$t('chat.convSettings.memoryEnabled')"
                        density="comfortable"
                        hide-details
                        color="primary"
                        :loading="savingMemorySettings"
                        :disabled="memoryUseGlobal || savingMemorySettings"
                      />
                      <p class="conv-settings-field__hint">
                        {{ $t('chat.convSettings.memoryEnabledHint') }}
                      </p>
                    </div>
                    <div class="conv-settings-field">
                      <v-text-field
                        v-model.number="memoryTopK"
                        type="number"
                        min="1"
                        max="20"
                        step="1"
                        :label="$t('chat.convSettings.memoryTopK')"
                        density="comfortable"
                        variant="outlined"
                        hide-details="auto"
                        :disabled="memoryUseGlobal || !memoryEnabled || savingMemorySettings"
                        :loading="savingMemorySettings"
                      />
                      <p
                        v-if="memoryEnabled"
                        class="conv-settings-field__hint"
                      >
                        {{ $t('chat.convSettings.memoryTopKHint') }}
                      </p>
                    </div>
                    <div class="conv-settings-field">
                      <v-switch
                        v-model="memoryHybridFtsUseGlobal"
                        :label="$t('chat.convSettings.memoryHybridFtsUseGlobal')"
                        density="comfortable"
                        hide-details
                        color="primary"
                        :loading="savingMemoryHybridFts"
                        :disabled="savingMemoryHybridFts"
                      />
                      <p class="conv-settings-field__hint">
                        {{ $t('chat.convSettings.memoryHybridFtsHint') }}
                      </p>
                    </div>
                    <div class="conv-settings-field">
                      <v-select
                        :model-value="memoryHybridFtsProfile"
                        :items="hybridFtsProfileItems"
                        item-title="title"
                        item-value="value"
                        :label="$t('settings.hybridFtsProfileLabel')"
                        density="comfortable"
                        variant="outlined"
                        hide-details="auto"
                        :disabled="memoryHybridFtsUseGlobal || savingMemoryHybridFts"
                        :loading="savingMemoryHybridFts"
                        @update:model-value="emit('memoryHybridFtsProfilePick', $event)"
                      />
                      <p
                        v-if="memoryHybridFtsUseGlobal"
                        class="conv-settings-field__hint"
                      >
                        {{ $t('chat.convSettings.memoryHybridFtsInheritHint') }}
                      </p>
                    </div>
                    <div
                      v-if="profileRequiresDict(memoryHybridFtsProfile)"
                      class="conv-settings-field"
                    >
                      <div
                        v-if="memoryHybridFtsDictVariant"
                        class="text-body-2"
                      >
                        {{ $t('settings.hybridFtsCurrentDict') }}:
                        <strong>
                          {{ $t(`settings.hybridFtsDictVariant.${memoryHybridFtsDictVariant}`) }}
                        </strong>
                      </div>
                      <v-btn
                        v-if="!memoryHybridFtsUseGlobal"
                        variant="outlined"
                        color="primary"
                        size="small"
                        class="mt-2"
                        prepend-icon="mdi-book-open-variant-outline"
                        :disabled="savingMemoryHybridFts"
                        @click="emit('openMemoryHybridFtsManage')"
                      >
                        {{ $t('settings.hybridFtsManageDict') }}
                      </v-btn>
                    </div>
                    <div
                      v-if="effectiveMemoryEnabled"
                      class="conv-settings-field"
                    >
                      <v-btn
                        variant="outlined"
                        color="primary"
                        prepend-icon="mdi-database-refresh-outline"
                        :loading="memoryRebuildLoading"
                        :disabled="memoryRebuildLoading"
                        @click="onRebuildMemoryClick"
                      >
                        {{ $t('chat.convSettings.memoryRebuildButton') }}
                      </v-btn>
                      <p
                        class="conv-settings-field__hint"
                        :class="{ 'text-warning': memoryRebuildNeedsAttention }"
                      >
                        {{
                          memoryRebuildNeedsAttention
                            ? $t('chat.convSettings.memoryRebuildMismatchHint')
                            : $t('chat.convSettings.memoryRebuildHint')
                        }}
                      </p>
                      <div
                        v-if="memoryRebuildLoading"
                        class="mt-2"
                      >
                        <p class="text-caption text-medium-emphasis mb-1">
                          {{ memoryRebuildStageLabel }} ·
                          {{
                            $t('chatConversation.memoryRebuildProgress', {
                              done: memoryRebuildDone,
                              total: memoryRebuildTotal,
                            })
                          }}
                        </p>
                        <p
                          v-if="memoryRebuildTotal > 0"
                          class="text-caption text-medium-emphasis mb-1"
                        >
                          {{
                            $t('chatConversation.memoryRebuildProgressDetail', {
                              turns: memoryRebuildTurns,
                              loreEntries: memoryRebuildLoreEntries,
                            })
                          }}
                        </p>
                        <v-progress-linear
                          :model-value="memoryRebuildTotal > 0 ? memoryRebuildPercent : undefined"
                          :indeterminate="memoryRebuildTotal < 1"
                          height="6"
                          rounded
                          color="primary"
                        />
                      </div>
                      <v-alert
                        v-if="memoryRebuildError"
                        type="error"
                        variant="tonal"
                        density="compact"
                        class="mt-2"
                      >
                        {{ memoryRebuildError }}
                      </v-alert>
                    </div>
                  </div>
    
                  <v-divider class="my-4" />
    
                  <div class="conv-settings-subsection">
                    <h4 class="conv-settings-subsection__title">
                      {{ $t('chat.convSettings.sectionRecallTest') }}
                    </h4>
                    <p class="conv-settings-field__hint mb-3">
                      {{ $t('chat.convSettings.recallTestButtonHint') }}
                    </p>
                    <v-btn
                      variant="outlined"
                      color="primary"
                      prepend-icon="mdi-magnify-scan"
                      @click="emit('openRecallTest')"
                    >
                      {{ $t('chat.convSettings.recallTestButton') }}
                    </v-btn>
                  </div>
  </div>
  <HybridFtsSwitchDialog
    v-model="memoryHybridFtsSwitchOpen"
    :pending-profile="pendingMemoryHybridFtsProfile"
    :current-profile="memoryHybridFtsProfile"
    :current-dict-variant="memoryHybridFtsDictVariant"
    title-key="chat.convSettings.memoryHybridFtsDialogTitle"
    warning-key="chat.convSettings.memoryHybridFtsDialogWarning"
    @confirm="emit('memoryHybridFtsConfirm', $event)"
    @cancel="emit('memoryHybridFtsCancel')"
  />
</template>
