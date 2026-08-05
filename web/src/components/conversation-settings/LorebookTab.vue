<script setup lang="ts">
import type { LoreRecursionDepth } from '@/composables/conversation-settings/types'
import '@/components/conversation-settings/conversation-settings-fields.css'

const loreUseGlobal = defineModel<boolean>('loreUseGlobal', { required: true })
const loreRecursiveEnabled = defineModel<boolean>('loreRecursiveEnabled', { required: true })
const loreMaxRecursionDepth = defineModel<LoreRecursionDepth>('loreMaxRecursionDepth', {
  required: true,
})

defineProps<{
  loreDepthItems: LoreRecursionDepth[]
  savingLoreSettings: boolean
}>()
</script>

<template>
  <div class="conv-settings-section">
    <div class="conv-settings-field">
                    <v-switch
                      v-model="loreUseGlobal"
                      :label="$t('chat.convSettings.loreUseGlobal')"
                      density="comfortable"
                      hide-details
                      color="primary"
                      :loading="savingLoreSettings"
                      :disabled="savingLoreSettings"
                    />
                    <p
                      v-if="loreUseGlobal"
                      class="conv-settings-field__hint"
                    >
                      {{ $t('chat.convSettings.loreInheritGlobalHint') }}
                    </p>
                  </div>
    
                  <div class="conv-settings-field">
                    <v-switch
                      v-model="loreRecursiveEnabled"
                      :label="$t('chat.convSettings.loreRecursiveEnabled')"
                      density="comfortable"
                      hide-details
                      color="primary"
                      :loading="savingLoreSettings"
                      :disabled="loreUseGlobal || savingLoreSettings"
                    />
                    <p class="conv-settings-field__hint">
                      {{ $t('chat.convSettings.loreRecursiveHint') }}
                    </p>
                  </div>
    
                  <div class="conv-settings-field">
                    <v-select
                      v-model="loreMaxRecursionDepth"
                      :items="[...loreDepthItems]"
                      :label="$t('chat.convSettings.loreMaxRecursionDepth')"
                      density="comfortable"
                      variant="outlined"
                      hide-details="auto"
                      :disabled="loreUseGlobal || !loreRecursiveEnabled || savingLoreSettings"
                      :loading="savingLoreSettings"
                    />
                    <p
                      v-if="loreRecursiveEnabled"
                      class="conv-settings-field__hint"
                    >
                      {{ $t('chat.convSettings.loreMaxRecursionDepthHint') }}
                    </p>
                  </div>
  </div>
</template>
