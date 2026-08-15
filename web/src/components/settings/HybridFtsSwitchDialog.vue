<script setup lang="ts">
import {
  downloadHybridFtsDict,
  fetchProfileDictStatus,
  importHybridFtsDictZip,
  type ProfileDictStatus,
} from '@/utils/hybrid-fts-api'
import {
  HYBRID_FTS_PROFILES,
  defaultDictVariantForProfile,
  dictVariantsForProfile,
  normalizeHybridFtsDictVariant,
  profileRequiresDict,
  type HybridFtsDictVariant,
  type HybridFtsProfile,
} from '@/utils/hybrid-fts-settings'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    pendingProfile: HybridFtsProfile
    currentProfile: HybridFtsProfile
    currentDictVariant: HybridFtsDictVariant | null
    titleKey?: string
    warningKey?: string
    confirmKey?: string
    /** 为 false 时由父级在异步应用完成后再关（资产「应用并重建」） */
    closeOnConfirm?: boolean
    confirming?: boolean
    /** true 时分词器本身也在弹窗内选择，pendingProfile 仅作初值 */
    profileSelectable?: boolean
  }>(),
  {
    closeOnConfirm: true,
    confirming: false,
    profileSelectable: false,
  },
)

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

/** 弹窗内实际生效的分词器；profileSelectable 时可在弹窗里改 */
const activeProfile = ref<HybridFtsProfile>(props.pendingProfile)
const dictStatus = ref<ProfileDictStatus | null>(null)
const dictStatusLoading = ref(false)
const dictStatusError = ref('')
const selectedVariant = ref<HybridFtsDictVariant>('default')
const downloading = ref(false)
const importing = ref(false)
const downloadError = ref('')
const downloadPercent = ref<number | undefined>(undefined)
const downloadIndeterminate = ref(false)
const importInputRef = ref<HTMLInputElement | null>(null)

const requiresDict = computed(() => profileRequiresDict(activeProfile.value))
const busy = computed(() => downloading.value || importing.value || props.confirming)
const showLocalImport = computed(() => activeProfile.value === 'lindera')

const profileItems = computed(() =>
  HYBRID_FTS_PROFILES.map((value) => ({
    value,
    title: t(`settings.hybridFtsProfile.${value}`),
  })),
)

const variantItems = computed(() => {
  const variants = dictStatus.value?.variants ?? []
  const ids = dictVariantsForProfile(activeProfile.value)
  return ids.map((id) => {
    const row = variants.find((v) => v.id === id)
    return {
      id,
      downloaded: row?.downloaded ?? false,
      storagePath: row?.storagePath ?? '',
      modelHome: row?.modelHome ?? '',
      sourcePath: row?.sourcePath ?? '',
      sizeMbApprox: row?.sizeMbApprox ?? 0,
      artifactKind: row?.artifactKind,
      languageHint: row?.languageHint,
      tags: row?.tags ?? [],
    }
  })
})

const selectedVariantRow = computed(() =>
  variantItems.value.find((v) => v.id === selectedVariant.value),
)

const repoUrl = computed(() => dictStatus.value?.repoUrl ?? '')

const manualHintKey = computed(() =>
  activeProfile.value === 'lindera'
    ? 'settings.hybridFtsSwitch.manualHintLindera'
    : 'settings.hybridFtsSwitch.manualHint',
)

async function loadDictStatus(): Promise<void> {
  if (!requiresDict.value) {
    dictStatus.value = null
    return
  }
  dictStatusLoading.value = true
  dictStatusError.value = ''
  try {
    dictStatus.value = await fetchProfileDictStatus(activeProfile.value)
    const preferred =
      activeProfile.value === props.currentProfile && props.currentDictVariant
        ? props.currentDictVariant
        : defaultDictVariantForProfile(activeProfile.value)
    selectedVariant.value = normalizeHybridFtsDictVariant(
      preferred,
      activeProfile.value,
    )
  } catch (e) {
    dictStatusError.value =
      e instanceof Error ? e.message : t('settings.hybridFtsSwitch.loadStatusFailed')
  } finally {
    dictStatusLoading.value = false
  }
}

watch(
  () => [props.modelValue, props.pendingProfile] as const,
  ([visible, pending]) => {
    if (!visible) return
    activeProfile.value = pending
  },
)

watch(
  () => [props.modelValue, activeProfile.value] as const,
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
  if (busy.value) return
  open.value = false
  emit('cancel')
}

function openImportPicker(): void {
  if (busy.value || !showLocalImport.value) return
  downloadError.value = ''
  importInputRef.value?.click()
}

async function onImportFileChange(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !showLocalImport.value) return
  if (!file.name.toLowerCase().endsWith('.zip')) {
    downloadError.value = t('settings.hybridFtsSwitch.importZipRequired')
    return
  }

  importing.value = true
  downloadIndeterminate.value = false
  downloadPercent.value = 0
  downloadError.value = ''
  try {
    const result = await importHybridFtsDictZip(
      activeProfile.value,
      file,
      (loaded, total) => {
        if (total > 0) {
          downloadIndeterminate.value = false
          downloadPercent.value = Math.min(100, Math.round((loaded / total) * 100))
        } else {
          downloadIndeterminate.value = true
        }
      },
    )
    selectedVariant.value = result.variant
    downloadIndeterminate.value = true
    downloadPercent.value = undefined
    await loadDictStatus()
  } catch (e) {
    downloadError.value =
      e instanceof Error ? e.message : t('settings.hybridFtsSwitch.importFailed')
  } finally {
    importing.value = false
    downloadIndeterminate.value = false
    downloadPercent.value = undefined
  }
}

async function onConfirm(): Promise<void> {
  if (busy.value) return
  downloadError.value = ''

  if (requiresDict.value) {
    const variant = selectedVariant.value
    const row = variantItems.value.find((v) => v.id === variant)
    if (!row?.downloaded) {
      downloading.value = true
      downloadIndeterminate.value = true
      downloadPercent.value = undefined
      try {
        await downloadHybridFtsDict(activeProfile.value, variant, (ev) => {
          if (ev.type === 'start') {
            downloadIndeterminate.value = ev.totalBytes == null
            downloadPercent.value = 0
          }
          if (ev.type === 'progress') {
            if (ev.phase === 'extract') {
              downloadIndeterminate.value = true
              downloadPercent.value = undefined
            } else if (ev.totalBytes != null && ev.totalBytes > 0) {
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
    emit('confirm', { profile: activeProfile.value, dictVariant: variant })
  } else {
    emit('confirm', { profile: activeProfile.value, dictVariant: null })
  }
  if (props.closeOnConfirm) open.value = false
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
        {{ $t(titleKey ?? 'settings.hybridFtsSwitch.title') }}
      </v-card-title>
      <v-card-text>
        <v-alert
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          {{ $t(warningKey ?? 'settings.hybridFtsSwitch.rebuildWarning') }}
        </v-alert>

        <v-select
          v-if="profileSelectable"
          v-model="activeProfile"
          :items="profileItems"
          :label="$t('settings.hybridFtsSwitch.targetProfile')"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-3"
          :disabled="busy"
        />
        <div
          v-else
          class="text-body-2 mb-2"
        >
          {{ $t('settings.hybridFtsSwitch.targetProfile') }}:
          <strong>{{ $t(`settings.hybridFtsProfile.${activeProfile}`) }}</strong>
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
            :disabled="busy"
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
                    v-if="item.languageHint"
                    size="x-small"
                    variant="outlined"
                    class="ml-2"
                  >
                    {{ $t(`settings.hybridFtsLang.${item.languageHint}`) }}
                  </v-chip>
                  <v-chip
                    v-for="tag in item.tags"
                    :key="tag"
                    size="x-small"
                    :color="tag === 'recommended' ? 'primary' : tag === 'large' ? 'warning' : undefined"
                    variant="tonal"
                    class="ml-1"
                  >
                    {{ $t(`settings.hybridFtsTag.${tag}`) }}
                  </v-chip>
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

          <div
            v-if="showLocalImport"
            class="d-flex flex-wrap ga-2 mt-3"
          >
            <v-btn
              variant="tonal"
              size="small"
              :disabled="busy || dictStatusLoading || !!dictStatusError"
              :loading="importing"
              @click="openImportPicker"
            >
              {{ $t('settings.hybridFtsSwitch.importFromLocal') }}
            </v-btn>
            <input
              ref="importInputRef"
              type="file"
              accept=".zip,application/zip"
              class="d-none"
              @change="onImportFileChange"
            >
          </div>
          <p
            v-if="showLocalImport"
            class="text-caption text-medium-emphasis mt-2 mb-0"
          >
            {{ $t('settings.hybridFtsSwitch.importHint') }}
          </p>

          <v-progress-linear
            v-if="downloading || importing"
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
              {{ $t(manualHintKey) }}
            </div>
          </v-sheet>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="busy"
          @click="onCancel"
        >
          {{ $t('settings.hybridFtsSwitch.cancel') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="busy"
          :disabled="dictStatusLoading || (requiresDict && !!dictStatusError)"
          @click="onConfirm"
        >
          {{ $t(confirmKey ?? 'settings.hybridFtsSwitch.confirm') }}
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
