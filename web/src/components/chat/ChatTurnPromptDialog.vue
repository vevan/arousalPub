<script setup lang="ts">
import AssembledMessagesPanel from '@/components/prompts/AssembledMessagesPanel.vue'
import type { useChatSession } from '@/composables/useChatSession'
import type {
  AssemblyAudit,
  CallAuditEntry,
  PerformanceAudit,
} from '@/types/chat-turn'
import { computed, ref, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  session: ReturnType<typeof useChatSession>
}>()

const {
  turnPromptDialogOpen,
  turnPromptLoading,
  turnPromptError,
  turnAuditEntry,
  turnPromptIsEmpty,
  turnPromptCopied,
  turnPromptRawCopied,
} = toRefs(props.session)

const { copyTurnPromptDisplay, copyTurnPromptRaw } = props.session
const { t } = useI18n()

const auditTab = ref('messages')

watch(turnPromptDialogOpen, (open) => {
  if (open) auditTab.value = 'messages'
})

const assembly = computed((): AssemblyAudit | null => {
  const a = turnAuditEntry.value?.assembly
  return a && typeof a === 'object' ? a : null
})

const calls = computed((): CallAuditEntry[] => {
  const raw = turnAuditEntry.value?.calls
  return Array.isArray(raw) ? raw : []
})

const messages = computed(() => turnAuditEntry.value?.messages ?? [])

const performance = computed((): PerformanceAudit | null => {
  const p = turnAuditEntry.value?.performance
  return p && typeof p === 'object' ? p : null
})

const hasPerformance = computed(() => {
  const p = performance.value
  if (!p) return false
  return Boolean(
    p.assemblyMs ||
      p.preUpstreamMs !== undefined ||
      p.upstreamMs ||
      p.persistMs ||
      p.stream,
  )
})

function formatScore(score: number | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—'
  return score.toFixed(3)
}

function formatLatency(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  return `${Math.round(ms)} ms`
}

function formatTps(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return `${n} tok/s`
}

function formatTokenSource(
  source: 'upstream' | 'estimated' | undefined,
): string {
  if (source === 'upstream') return t('chat.turnAuditPerfTpsSourceUpstream')
  if (source === 'estimated') return t('chat.turnAuditPerfTpsSourceEstimated')
  return '—'
}
</script>

<template>
  <v-dialog
    v-model="turnPromptDialogOpen"
    max-width="52rem"
    content-class="audit-dialog"
  >
    <v-card class="audit-card">
      <v-card-title class="audit-card__title text-h6">
        {{ $t('chat.turnPromptDialogTitle') }}
      </v-card-title>
      <v-divider />
      <v-card-text class="audit-card__body pa-0">
        <v-progress-linear
          v-if="turnPromptLoading"
          indeterminate
          color="primary"
        />
        <v-alert
          v-if="turnPromptError"
          type="error"
          variant="tonal"
          density="compact"
          class="ma-4 mb-0"
        >
          {{ turnPromptError }}
        </v-alert>
        <p
          v-else-if="!turnPromptLoading && turnPromptIsEmpty"
          class="text-body-2 text-medium-emphasis pa-4 mb-0"
        >
          {{ $t('chat.turnPromptEmpty') }}
        </p>
        <template v-else-if="!turnPromptLoading && turnAuditEntry">
          <div class="audit-card__meta px-4 py-2">
            <span class="audit-card__meta-item">
              <span class="audit-card__meta-label">{{ $t('chat.turnAuditMetaTurnOrdinal') }}</span>
              {{ turnAuditEntry.turnOrdinal }}
            </span>
            <span class="audit-card__meta-item">
              <span class="audit-card__meta-label">{{ $t('chat.turnAuditMetaSavedAt') }}</span>
              {{ turnAuditEntry.savedAt }}
            </span>
            <span class="audit-card__meta-item audit-card__meta-item--mono">
              <span class="audit-card__meta-label">{{ $t('chat.turnAuditMetaTurnId') }}</span>
              {{ turnAuditEntry.turnId }}
            </span>
            <span class="audit-card__meta-item audit-card__meta-item--mono">
              <span class="audit-card__meta-label">{{ $t('chat.turnAuditMetaChunk') }}</span>
              {{ turnAuditEntry.chunkName }}
            </span>
          </div>
          <v-tabs
            v-model="auditTab"
            density="compact"
            color="primary"
            class="audit-card__tabs"
          >
            <v-tab value="messages">
              {{ $t('chat.turnAuditTabMessages') }}
            </v-tab>
            <v-tab value="assembly">
              {{ $t('chat.turnAuditTabAssembly') }}
            </v-tab>
            <v-tab value="calls">
              {{ $t('chat.turnAuditTabCalls') }}
            </v-tab>
            <v-tab value="performance">
              {{ $t('chat.turnAuditTabPerformance') }}
            </v-tab>
          </v-tabs>
          <v-divider />
          <div class="audit-card__scroll">
            <v-tabs-window
              v-model="auditTab"
              class="audit-card__window"
            >
            <v-tabs-window-item value="messages">
              <div class="audit-card__pane">
                <AssembledMessagesPanel :messages="messages" />
              </div>
            </v-tabs-window-item>

            <v-tabs-window-item value="assembly">
              <div class="audit-card__pane">
                <p
                  v-if="!assembly"
                  class="text-body-2 text-medium-emphasis mb-0"
                >
                  {{ $t('chat.turnAuditNoAssembly') }}
                </p>
                <template v-else>
                  <v-table
                    density="compact"
                    class="audit-table audit-table--kv mb-4"
                  >
                    <tbody>
                      <tr>
                        <td class="audit-table__label">{{ $t('chat.turnAuditEstimatedTokens') }}</td>
                        <td>{{ assembly.estimatedTokens }}</td>
                      </tr>
                      <tr v-if="assembly.tokenModel">
                        <td class="audit-table__label">{{ $t('chat.turnAuditTokenModel') }}</td>
                        <td class="audit-table__mono">{{ assembly.tokenModel }}</td>
                      </tr>
                      <tr v-if="assembly.budgetTrim?.maxTokens">
                        <td class="audit-table__label">{{ $t('chat.turnAuditBudgetMax') }}</td>
                        <td>{{ assembly.budgetTrim.maxTokens }}</td>
                      </tr>
                    </tbody>
                  </v-table>

                  <h4 class="text-subtitle-2 mb-2">{{ $t('chat.turnAuditSectionMemory') }}</h4>
                  <v-table
                    density="compact"
                    class="audit-table audit-table--kv mb-2"
                  >
                    <tbody>
                      <tr>
                        <td class="audit-table__label">{{ $t('chat.turnAuditMemoryEnabled') }}</td>
                        <td>{{ assembly.memory.enabled ? $t('chat.turnAuditYes') : $t('chat.turnAuditNo') }}</td>
                      </tr>
                      <tr v-if="assembly.memory.droppedCount > 0">
                        <td class="audit-table__label">{{ $t('chat.turnAuditMemoryDropped') }}</td>
                        <td class="text-error">{{ assembly.memory.droppedCount }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                  <v-table
                    v-if="assembly.memory.hits.length > 0"
                    density="compact"
                    class="audit-table mb-4"
                  >
                    <thead>
                      <tr>
                        <th>{{ $t('chat.turnAuditColTurnOrdinal') }}</th>
                        <th>{{ $t('chat.turnAuditColScore') }}</th>
                        <th>{{ $t('chat.turnAuditColIncluded') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="hit in assembly.memory.hits"
                        :key="hit.turnId"
                        :class="{ 'audit-table__row--muted': !hit.included }"
                      >
                        <td>{{ hit.turnOrdinal }}</td>
                        <td>{{ formatScore(hit.score) }}</td>
                        <td>
                          <v-icon
                            :icon="hit.included ? 'mdi-check-circle' : 'mdi-close-circle-outline'"
                            :color="hit.included ? 'success' : 'disabled'"
                            size="small"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </v-table>

                  <h4 class="text-subtitle-2 mb-2">{{ $t('chat.turnAuditSectionLore') }}</h4>
                  <v-table
                    density="compact"
                    class="audit-table audit-table--kv mb-2"
                  >
                    <tbody>
                      <tr v-if="assembly.lore.lorebookIds.length > 0">
                        <td class="audit-table__label">{{ $t('chat.turnAuditLorebooks') }}</td>
                        <td class="audit-table__mono">{{ assembly.lore.lorebookIds.join(', ') }}</td>
                      </tr>
                      <tr v-if="assembly.lore.droppedCount > 0">
                        <td class="audit-table__label">{{ $t('chat.turnAuditLoreDropped') }}</td>
                        <td class="text-error">{{ assembly.lore.droppedCount }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                  <v-table
                    v-if="assembly.lore.matched.length > 0"
                    density="compact"
                    class="audit-table mb-4"
                  >
                    <thead>
                      <tr>
                        <th>{{ $t('chat.turnAuditColEntryId') }}</th>
                        <th>{{ $t('chat.turnAuditColTitle') }}</th>
                        <th>{{ $t('chat.turnAuditColMode') }}</th>
                        <th>{{ $t('chat.turnAuditColScore') }}</th>
                        <th>{{ $t('chat.turnAuditColIncluded') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="row in assembly.lore.matched"
                        :key="`${row.lorebookId}-${row.entryId}`"
                        :class="{ 'audit-table__row--muted': !row.included }"
                      >
                        <td class="audit-table__mono">{{ row.entryId }}</td>
                        <td>{{ row.title || '—' }}</td>
                        <td>{{ row.mode }}</td>
                        <td>{{ formatScore(row.score) }}</td>
                        <td>
                          <v-icon
                            :icon="row.included ? 'mdi-check-circle' : 'mdi-close-circle-outline'"
                            :color="row.included ? 'success' : 'disabled'"
                            size="small"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </v-table>

                  <h4 class="text-subtitle-2 mb-2">{{ $t('chat.turnAuditSectionHistory') }}</h4>
                  <v-table
                    density="compact"
                    class="audit-table audit-table--kv mb-2"
                  >
                    <tbody>
                      <tr v-if="assembly.history.droppedCount > 0">
                        <td class="audit-table__label">{{ $t('chat.turnAuditHistoryDropped') }}</td>
                        <td class="text-error">{{ assembly.history.droppedCount }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                  <div
                    v-if="assembly.history.turnOrdinals.length > 0"
                    class="audit-card__chips mb-0"
                  >
                    <span class="audit-card__meta-label mr-2">{{ $t('chat.turnAuditHistoryTurns') }}</span>
                    <v-chip
                      v-for="ord in assembly.history.turnOrdinals"
                      :key="ord"
                      size="x-small"
                      variant="outlined"
                      label
                      class="mr-1 mb-1"
                    >
                      {{ ord }}
                    </v-chip>
                  </div>
                </template>
              </div>
            </v-tabs-window-item>

            <v-tabs-window-item value="calls">
              <div class="audit-card__pane">
                <p
                  v-if="calls.length === 0"
                  class="text-body-2 text-medium-emphasis mb-0"
                >
                  {{ $t('chat.turnAuditNoCalls') }}
                </p>
                <v-table
                  v-else
                  density="compact"
                  class="audit-table"
                >
                  <thead>
                    <tr>
                      <th>{{ $t('chat.turnAuditColKind') }}</th>
                      <th>{{ $t('chat.turnAuditColModel') }}</th>
                      <th>{{ $t('chat.turnAuditColApiConfig') }}</th>
                      <th>{{ $t('chat.turnAuditColPurpose') }}</th>
                      <th>{{ $t('chat.turnAuditColLatency') }}</th>
                      <th>{{ $t('chat.turnAuditColPromptTokens') }}</th>
                      <th>{{ $t('chat.turnAuditColCompletionTokens') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(call, idx) in calls"
                      :key="idx"
                    >
                      <td>{{ call.kind }}</td>
                      <td class="audit-table__mono">{{ call.model || '—' }}</td>
                      <td class="audit-table__mono">{{ call.apiConfigId || '—' }}</td>
                      <td>{{ call.purpose || '—' }}</td>
                      <td>{{ formatLatency(call.latencyMs) }}</td>
                      <td>{{ call.usage?.promptTokens ?? '—' }}</td>
                      <td>{{ call.usage?.completionTokens ?? '—' }}</td>
                    </tr>
                  </tbody>
                </v-table>
              </div>
            </v-tabs-window-item>

            <v-tabs-window-item value="performance">
              <div class="audit-card__pane">
                <p
                  v-if="!hasPerformance"
                  class="text-body-2 text-medium-emphasis mb-0"
                >
                  {{ $t('chat.turnAuditNoPerformance') }}
                </p>
                <template v-else-if="performance">
                  <h4 class="text-subtitle-2 mb-2">{{ $t('chat.turnAuditSectionAssemblyPerf') }}</h4>
                  <v-table
                    v-if="performance.assemblyMs"
                    density="compact"
                    class="audit-table audit-table--kv mb-4"
                  >
                    <tbody>
                      <tr>
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfTotal') }}</td>
                        <td>{{ formatLatency(performance.assemblyMs.total) }}</td>
                      </tr>
                      <tr v-if="performance.assemblyMs.memory !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfMemory') }}</td>
                        <td>{{ formatLatency(performance.assemblyMs.memory) }}</td>
                      </tr>
                      <tr v-if="performance.assemblyMs.characters !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfCharacters') }}</td>
                        <td>{{ formatLatency(performance.assemblyMs.characters) }}</td>
                      </tr>
                      <tr v-if="performance.assemblyMs.lore !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfLore') }}</td>
                        <td>{{ formatLatency(performance.assemblyMs.lore) }}</td>
                      </tr>
                      <tr v-if="performance.assemblyMs.assembleAndTrim !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfAssemble') }}</td>
                        <td>{{ formatLatency(performance.assemblyMs.assembleAndTrim) }}</td>
                      </tr>
                      <tr v-if="performance.assemblyMs.regexOutgoing !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfRegexOutgoing') }}</td>
                        <td>{{ formatLatency(performance.assemblyMs.regexOutgoing) }}</td>
                      </tr>
                      <tr v-if="performance.assemblyMs.pluginsAfterAssemble !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfPlugins') }}</td>
                        <td>{{ formatLatency(performance.assemblyMs.pluginsAfterAssemble) }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                  <v-table
                    v-if="performance.preUpstreamMs !== undefined"
                    density="compact"
                    class="audit-table audit-table--kv mb-4"
                  >
                    <tbody>
                      <tr>
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfPreUpstream') }}</td>
                        <td>{{ formatLatency(performance.preUpstreamMs) }}</td>
                      </tr>
                    </tbody>
                  </v-table>

                  <h4 class="text-subtitle-2 mb-2">{{ $t('chat.turnAuditSectionUpstreamPerf') }}</h4>
                  <v-table
                    v-if="performance.upstreamMs"
                    density="compact"
                    class="audit-table audit-table--kv mb-4"
                  >
                    <tbody>
                      <tr v-if="performance.upstreamMs.toResponseHeaders !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfToHeaders') }}</td>
                        <td>{{ formatLatency(performance.upstreamMs.toResponseHeaders) }}</td>
                      </tr>
                      <tr v-if="performance.upstreamMs.toFirstToken !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfToFirstToken') }}</td>
                        <td>{{ formatLatency(performance.upstreamMs.toFirstToken) }}</td>
                      </tr>
                      <tr v-if="performance.upstreamMs.firstTokenToLastToken !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfGeneration') }}</td>
                        <td>{{ formatLatency(performance.upstreamMs.firstTokenToLastToken) }}</td>
                      </tr>
                      <tr v-if="performance.upstreamMs.total !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfUpstreamTotal') }}</td>
                        <td>{{ formatLatency(performance.upstreamMs.total) }}</td>
                      </tr>
                      <tr v-if="performance.upstreamMs.tps !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfTps') }}</td>
                        <td>
                          {{ formatTps(performance.upstreamMs.tps) }}
                          <span class="text-medium-emphasis text-caption ml-1">
                            ({{ formatTokenSource(performance.upstreamMs.tpsTokenSource) }}
                            · {{ performance.upstreamMs.tpsTokenCount ?? '—' }} tok)
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </v-table>

                  <h4 class="text-subtitle-2 mb-2">{{ $t('chat.turnAuditSectionPersistPerf') }}</h4>
                  <v-table
                    v-if="performance.persistMs"
                    density="compact"
                    class="audit-table audit-table--kv mb-4"
                  >
                    <tbody>
                      <tr v-if="performance.persistMs.regex !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfPersistRegex') }}</td>
                        <td>{{ formatLatency(performance.persistMs.regex) }}</td>
                      </tr>
                      <tr v-if="performance.persistMs.diskAndAudit !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfPersistDisk') }}</td>
                        <td>{{ formatLatency(performance.persistMs.diskAndAudit) }}</td>
                      </tr>
                      <tr v-if="performance.persistMs.total !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfPersistTotal') }}</td>
                        <td>{{ formatLatency(performance.persistMs.total) }}</td>
                      </tr>
                    </tbody>
                  </v-table>

                  <h4 class="text-subtitle-2 mb-2">{{ $t('chat.turnAuditSectionStream') }}</h4>
                  <v-table
                    v-if="performance.stream"
                    density="compact"
                    class="audit-table audit-table--kv mb-0"
                  >
                    <tbody>
                      <tr>
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfContentChars') }}</td>
                        <td>{{ performance.stream.contentChars }}</td>
                      </tr>
                      <tr>
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfReasoningChars') }}</td>
                        <td>{{ performance.stream.reasoningChars }}</td>
                      </tr>
                      <tr v-if="performance.stream.contentTokensEst !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfContentTokens') }}</td>
                        <td>{{ performance.stream.contentTokensEst }}</td>
                      </tr>
                      <tr v-if="performance.stream.reasoningTokensEst !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfReasoningTokens') }}</td>
                        <td>{{ performance.stream.reasoningTokensEst }}</td>
                      </tr>
                      <tr v-if="performance.stream.completionTokensUpstream !== undefined">
                        <td class="audit-table__label">{{ $t('chat.turnAuditPerfUpstreamTokens') }}</td>
                        <td>{{ performance.stream.completionTokensUpstream }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                </template>
              </div>
            </v-tabs-window-item>
            </v-tabs-window>
          </div>
        </template>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-3">
        <v-spacer />
        <template
          v-if="turnAuditEntry && !turnPromptLoading && !turnPromptError"
        >
          <v-btn
            variant="text"
            :class="{ 'text-primary': turnPromptCopied }"
            @click="copyTurnPromptDisplay"
          >
            {{
              turnPromptCopied
                ? $t('chat.turnPromptCopied')
                : $t('chat.turnAuditCopyMessages')
            }}
          </v-btn>
          <v-btn
            variant="text"
            :class="{ 'text-primary': turnPromptRawCopied }"
            @click="copyTurnPromptRaw"
          >
            {{
              turnPromptRawCopied
                ? $t('chat.turnPromptCopied')
                : $t('chat.turnPromptCopyRaw')
            }}
          </v-btn>
        </template>
        <v-btn
          variant="text"
          @click="turnPromptDialogOpen = false"
        >
          {{ $t('chat.turnPromptClose') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
