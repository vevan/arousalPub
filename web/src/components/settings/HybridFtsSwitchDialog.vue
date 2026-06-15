<script setup lang="ts">
import {
  downloadHybridFtsDict,
  fetchProfileDictStatus,
  type ProfileDictStatus,
} from '@/utils/hybrid-fts-api'
import {
  HYBRID_FTS_DICT_VARIANTS,
  normalizeHybridFtsDictVariant,
  profileRequiresDict,
  type HybridFtsDictVariant,
  type HybridFtsProfile,
} from '@/utils/hybrid-fts-settings'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue: boolean
  pendingProfile: HybridFtsProfile
  currentProfile: HybridFtsProfile
  currentDictVariant: HybridFtsDictVariant | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm', payload: { profile: HybridFtsProfile; dictVariant: HybridFtsDictVariant | null }): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const dictStatus = ref<ProfileDictStatus | null>(null)
const dictStatusLoading = ref(false)
const dictStatusError = ref('')
const selectedVariant = ref<HybridFtsDictVariant>('default')
const downloading = ref(false)
const downloadError = ref('')
const downloadPercent = ref<number | undefined>(undefined)
const downloadIndeterminate = ref(false)

const requiresDict = computed(() => profileRequiresDict(props.pendingProfile))

const variantItems = computed(() => {
  const variants = dictStatus.value?.variants ?? []
  return HYBRID_FTS_DICT_VARIANTS.map((id) => {
    const row = variants.find((v) => v.id === id)
    return {
      id,
      downloaded: row?.downloaded ?? false,
      storagePath: row?.storagePath ?? '',
      modelHome: row?.modelHome ?? '',
      sourcePath: row?.sourcePath ?? '',
      sizeMbApprox: row?.sizeMbApprox ?? 0,
    }
  })
})

const selectedVariantRow = computed(() =>
  variantItems.value.find((v) => v.id === selectedVariant.value),
)

const repoUrl = computed(() => dictStatus.value?.repoUrl ?? '')

async function loadDictStatus(): Promise<void> {
  if (!requiresDict.value) {
    dictStatus.value = null
    return
  }
  dictStatusLoading.value = true
  dictStatusError.value = ''
  try {
    dictStatus.value = await fetchProfileDictStatus(props.pendingProfile)
    const preferred =
      props.pendingProfile === props.currentProfile && props.currentDictVariant
        ? props.currentDictVariant
        : 'default'
    selectedVariant.value = normalizeHybridFtsDictVariant(preferred)
  } catch (e) {
    dictStatusError.value =
      e instanceof Error ? e.message : t('settings.hybridFtsSwitch.loadStatusFailed')
  } finally {
    dictStatusLoading.value = false
  }
}

watch(
  () => [props.modelValue, props.pendingProfile] as const,
  ([visible]) => {
    if (!visible) return
    downloadError.value = ''
    downloadPercent.value = undefined
    downloadIndeterminate.value = false
    void loadDictStatus()
  },
  { immediate: true },
)

function onCancel(): void {
  if (downloading.value) return
  open.value = false
  emit('cancel')
}

async function onConfirm(): Promise<void> {
  if (downloading.value) return
  downloadError.value = ''

  if (requiresDict.value) {
    const variant = selectedVariant.value
    const row = variantItems.value.find((v) => v.id === variant)
    if (!row?.downloaded) {
      downloading.value = true
      downloadIndeterminate.value = true
      downloadPercent.value = undefined
      try {
        await downloadHybridFtsDict(props.pendingProfile, variant, (ev) => {
          if (ev.type === 'start') {
            downloadIndeterminate.value = ev.totalBytes == null
            downloadPercent.value = 0
          }
          if (ev.type === 'progress') {
            if (ev.totalBytes != null && ev.totalBytes > 0) {
              downloadIndeterminate.value = false
              downloadPercent.value = Math.min(
                100,
                Math.round((ev.receivedBytes / ev.totalBytes) * 100),
              )
            } else {
              downloadIndeterminate.value = true
            }
          }
        })
        await loadDictStatus()
      } catch (e) {
        downloadError.value =
          e instanceof Error ? e.message : t('settings.hybridFtsSwitch.downloadFailed')
        downloading.value = false
        return
      }
      downloading.value = false
    }
    emit('confirm', { profile: props.pendingProfile, dictVariant: variant })
  } else {
    emit('confirm', { profile: props.pendingProfile, dictVariant: null })
  }
  open.value = false
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="560"
    persistent
  >
    <v-card>
      <v-card-title class="text-h6">
        {{ $t('settings.hybridFtsSwitch.title') }}
      </v-card-title>
      <v-card-text>
        <v-alert
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          {{ $t('settings.hybridFtsSwitch.rebuildWarning') }}
        </v-alert>

        <div class="text-body-2 mb-2">
          {{ $t('settings.hybridFtsSwitch.targetProfile') }}:
          <strong>{{ $t(`settings.hybridFtsProfile.${pendingProfile}`) }}</strong>
        </div>

        <template v-if="requiresDict">
          <div class="text-body-2 text-medium-emphasis mb-3">
            {{ $t('settings.hybridFtsSwitch.dictSectionHint') }}
          </div>
          <v-progress-linear
            v-if="dictStatusLoading"
            indeterminate
            class="mb-3"
          />
          <v-alert
            v-else-if="dictStatusError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            {{ dictStatusError }}
          </v-alert>
          <v-radio-group
            v-else
            v-model="selectedVariant"
            hide-details
            :disabled="downloading"
          >
            <v-radio
              v-for="item in variantItems"
              :key="item.id"
              :value="item.id"
            >
              <template #label>
                <span>
                  {{ $t(`settings.hybridFtsDictVariant.${item.id}`) }}
                  <span class="text-medium-emphasis">
                    (~{{ item.sizeMbApprox }} MB)
                  </span>
                  <v-chip
                    v-if="item.downloaded"
                    size="x-small"
                    color="success"
                    variant="tonal"
                    class="ml-2"
                  >
                    {{ $t('settings.hybridFtsSwitch.downloaded') }}
                  </v-chip>
                </span>
              </template>
            </v-radio>
          </v-radio-group>

          <v-progress-linear
            v-if="downloading"
            :model-value="downloadPercent"
            :indeterminate="downloadIndeterminate"
            class="mt-3 mb-2"
          />
          <v-alert
            v-if="downloadError"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-2"
          >
            {{ downloadError }}
          </v-alert>

          <v-sheet
            color="surface-variant"
            rounded="lg"
            class="pa-3 mt-4 text-caption"
          >
            <div v-if="repoUrl" class="mb-1">
              {{ $t('settings.hybridFtsSwitch.repoUrl') }}:
              <a
                :href="repoUrl"
                target="_blank"
                rel="noopener noreferrer"
              >{{ repoUrl }}</a>
            </div>
            <div
              v-if="selectedVariantRow?.sourcePath"
              class="mb-1"
            >
              {{ $t('settings.hybridFtsSwitch.sourceFile') }}:
              <code>{{ selectedVariantRow.sourcePath }}</code>
            </div>
            <div
              v-if="selectedVariantRow?.modelHome"
              class="mb-1 hybrid-fts-path"
            >
              {{ $t('settings.hybridFtsSwitch.modelHome') }}:
              <code>{{ selectedVariantRow.modelHome }}</code>
            </div>
            <div
              v-if="selectedVariantRow?.storagePath"
              class="mb-1 hybrid-fts-path"
            >
              {{ $t('settings.hybridFtsSwitch.storagePath') }}:
              <code>{{ selectedVariantRow.storagePath }}</code>
            </div>
            <div class="text-medium-emphasis mt-2">
              {{ $t('settings.hybridFtsSwitch.manualHint') }}
            </div>
          </v-sheet>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="downloading"
          @click="onCancel"
        >
          {{ $t('settings.hybridFtsSwitch.cancel') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="downloading"
          :disabled="dictStatusLoading || (requiresDict && !!dictStatusError)"
          @click="onConfirm"
        >
          {{ $t('settings.hybridFtsSwitch.confirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.hybrid-fts-path code {
  word-break: break-all;
  white-space: pre-wrap;
}
</style>
