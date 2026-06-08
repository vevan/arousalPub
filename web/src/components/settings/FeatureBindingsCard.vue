<script setup lang="ts">

import { useConnectionStore } from '@/stores/connection'

import type { FeatureType } from '@/types/feature-bindings'

import { storeToRefs } from 'pinia'

import { computed, ref } from 'vue'

import { useI18n } from 'vue-i18n'



const { t } = useI18n()

const conn = useConnectionStore()

const { presets, featureBindings, chatGlobalApiConfigId } = storeToRefs(conn)



const saving = ref(false)

const snackbar = ref(false)

const snackbarText = ref('')

const snackbarColor = ref<'success' | 'error'>('success')

const advancedOpen = ref<number | undefined>(undefined)



const presetItems = computed(() =>

  presets.value.map((p) => ({ title: p.alias, value: p.id })),

)



function bindingApiConfigId(

  featureType: FeatureType,

  featureRefId: string,

): string | null {

  const hit = featureBindings.value.find(

    (b) => b.featureType === featureType && b.featureRefId === featureRefId,

  )

  return hit?.apiConfigId ?? null

}



async function persistBinding(

  featureType: FeatureType,

  featureRefId: string,

  apiConfigId: string | null,

) {

  if (!apiConfigId) {

    const existing = featureBindings.value.find(

      (b) => b.featureType === featureType && b.featureRefId === featureRefId,

    )

    if (!existing) return

    saving.value = true

    try {

      await conn.deleteFeatureBinding(existing.id)

      snackbarColor.value = 'success'

      snackbarText.value = t('featureBindings.saved')

      snackbar.value = true

    } catch (e) {

      snackbarColor.value = 'error'

      snackbarText.value =

        e instanceof Error ? e.message : t('featureBindings.saveFailed')

      snackbar.value = true

    } finally {

      saving.value = false

    }

    return

  }



  saving.value = true

  try {

    await conn.upsertFeatureBindings([

      { featureType, featureRefId, apiConfigId },

    ])

    if (featureType === 'chat' && featureRefId === 'global') {

      conn.switchPreset(apiConfigId)

    }

    snackbarColor.value = 'success'

    snackbarText.value = t('featureBindings.saved')

    snackbar.value = true

  } catch (e) {

    snackbarColor.value = 'error'

    snackbarText.value =

      e instanceof Error ? e.message : t('featureBindings.saveFailed')

    snackbar.value = true

  } finally {

    saving.value = false

  }

}



async function onChatGlobalChange(v: string | null) {

  if (!v || v === chatGlobalApiConfigId.value) return

  await persistBinding('chat', 'global', v)

}



async function onAdvancedChange(

  featureType: FeatureType,

  v: string | null,

) {

  await persistBinding(featureType, 'global', v)

}

</script>



<template>

  <v-card

    variant="outlined"

    class="mb-4"

  >

    <v-card-title class="text-subtitle-1">

      {{ $t('featureBindings.title') }}

    </v-card-title>

    <v-card-text>

      <p class="text-body-2 text-medium-emphasis mb-3">

        {{ $t('featureBindings.hint') }}

      </p>



      <v-select

        :model-value="chatGlobalApiConfigId ?? undefined"

        :items="presetItems"

        item-title="title"

        item-value="value"

        :label="$t('featureBindings.chatGlobal')"

        :loading="saving"

        density="compact"

        hide-details

        variant="outlined"

        class="mb-3"

        @update:model-value="onChatGlobalChange"

      />



      <v-expansion-panels

        v-model="advancedOpen"

        variant="accordion"

      >

        <v-expansion-panel :value="0">

          <v-expansion-panel-title>

            {{ $t('featureBindings.advancedTitle') }}

          </v-expansion-panel-title>

          <v-expansion-panel-text>

            <v-select

              :model-value="bindingApiConfigId('rag_generate', 'global') ?? undefined"

              :items="presetItems"

              item-title="title"

              item-value="value"

              :label="$t('featureBindings.ragGenerate')"

              :hint="$t('featureBindings.ragHint')"

              persistent-hint

              clearable

              :loading="saving"

              density="compact"

              variant="outlined"

              class="mb-3"

              @update:model-value="onAdvancedChange('rag_generate', $event)"

            />

            <v-select

              :model-value="bindingApiConfigId('rerank', 'global') ?? undefined"

              :items="presetItems"

              item-title="title"

              item-value="value"

              :label="$t('featureBindings.rerank')"

              clearable

              :loading="saving"

              density="compact"

              variant="outlined"

              class="mb-1"

              @update:model-value="onAdvancedChange('rerank', $event)"

            />

          </v-expansion-panel-text>

        </v-expansion-panel>

      </v-expansion-panels>

    </v-card-text>

  </v-card>



  <v-snackbar

    v-model="snackbar"

    :color="snackbarColor"

    :timeout="3000"

  >

    {{ snackbarText }}

  </v-snackbar>

</template>


