<script setup lang="ts">
import type { GroupChatSpeakerAudit } from '@/types/chat-turn'
import {
  groupChatAuditMaxSegments,
  groupChatAuditSegmentLabel,
  isGroupChatDiceBidEligible,
  sortGroupChatDiceBids,
} from '@/utils/group-chat-audit-display'
import { formatCharacterAuditLabel } from '@/utils/group-chat-turn'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  title: string
  audit: GroupChatSpeakerAudit | null | undefined
  characterIds: string[]
  characterNames: string[]
  fallbackMaxSegments?: number | null
}>()

const { t } = useI18n()

const segmentLabel = computed(() => groupChatAuditSegmentLabel(props.audit))
const maxSegments = computed(() => {
  const fromAudit = groupChatAuditMaxSegments(props.audit)
  if (fromAudit !== null) return fromAudit
  const fb = props.fallbackMaxSegments
  return typeof fb === 'number' && Number.isFinite(fb) && fb > 0 ? Math.round(fb) : null
})

const sortedBids = computed(() =>
  props.audit?.dice?.bids?.length
    ? sortGroupChatDiceBids(props.audit.dice.bids)
    : [],
)

const diceOutcome = computed(() => props.audit?.dice?.outcome)

const winnerId = computed(
  () => props.audit?.dice?.winnerCharacterId ?? props.audit?.speakerCharacterId ?? null,
)

function characterLabel(characterId: string): string {
  return formatCharacterAuditLabel(characterId, props.characterIds, props.characterNames)
}

function formatProb(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return `${Math.round(n * 1000) / 10}%`
}

function methodLabel(method: string | undefined): string {
  if (!method) return '—'
  const key = `chat.turnAuditGroupChatMethod.${method}`
  const translated = t(key)
  return translated === key ? method : translated
}

function skipLabel(row: import('@/types/chat-turn').GroupChatDiceBidAuditRow): string {
  if (isGroupChatDiceBidEligible(row)) return '—'
  if (!row.skipReason) return t('chat.turnAuditGroupChatSkipUnknown')
  const key = `chat.turnAuditGroupChatSkip.${row.skipReason}`
  const translated = t(key)
  return translated === key ? row.skipReason : translated
}

function outcomeLabel(outcome: string | undefined): string | null {
  if (!outcome) return null
  const key = `chat.turnAuditGroupChatOutcome.${outcome}`
  const translated = t(key)
  return translated === key ? outcome : translated
}

function isWinnerRow(characterId: string): boolean {
  const w = winnerId.value?.trim()
  return Boolean(w && w === characterId.trim())
}
</script>

<template>
  <section class="group-chat-audit-block">
    <div class="group-chat-audit-block__header">
      <h4 class="text-subtitle-2 mb-0">
        {{ title }}
      </h4>
      <span
        v-if="segmentLabel !== null && maxSegments !== null"
        class="text-caption text-medium-emphasis"
      >
        {{
          $t('chat.turnAuditGroupChatSegmentProgress', {
            current: segmentLabel,
            max: maxSegments,
          })
        }}
      </span>
    </div>

    <p
      v-if="!audit"
      class="text-body-2 text-medium-emphasis mb-0 mt-2"
    >
      {{ $t('chat.turnAuditGroupChatPickEmpty') }}
    </p>
    <template v-else>
      <v-table
        density="compact"
        class="audit-table audit-table--kv mt-2 mb-3"
      >
        <tbody>
          <tr>
            <td class="audit-table__label">{{ $t('chat.turnAuditGroupChatPickMethod') }}</td>
            <td>{{ methodLabel(audit.method) }}</td>
          </tr>
          <tr v-if="audit.speakerCharacterId">
            <td class="audit-table__label">{{ $t('chat.turnAuditGroupChatPickResult') }}</td>
            <td>{{ characterLabel(audit.speakerCharacterId) }}</td>
          </tr>
          <tr v-if="audit.nextSpeakerHint">
            <td class="audit-table__label">{{ $t('chat.turnAuditGroupChatPickHint') }}</td>
            <td class="audit-table__mono">{{ characterLabel(audit.nextSpeakerHint) }}</td>
          </tr>
          <tr v-if="diceOutcome && outcomeLabel(diceOutcome)">
            <td class="audit-table__label">{{ $t('chat.turnAuditGroupChatPickOutcome') }}</td>
            <td>{{ outcomeLabel(diceOutcome) }}</td>
          </tr>
          <tr v-if="audit.decayStopped">
            <td class="audit-table__label">{{ $t('chat.turnAuditGroupChatDecayStopped') }}</td>
            <td>{{ $t('chat.turnAuditYes') }}</td>
          </tr>
          <tr v-if="audit.needsManualContinue">
            <td class="audit-table__label">{{ $t('chat.turnAuditGroupChatNeedsManual') }}</td>
            <td>{{ $t('chat.turnAuditYes') }}</td>
          </tr>
        </tbody>
      </v-table>

      <template v-if="sortedBids.length">
        <h5 class="text-caption text-medium-emphasis mb-2">
          {{ $t('chat.turnAuditGroupChatDiceTitle') }}
        </h5>
        <v-table
          density="compact"
          class="audit-table mb-0"
        >
          <thead>
            <tr>
              <th>{{ $t('chat.turnAuditGroupChatDiceColCharacter') }}</th>
              <th>{{ $t('chat.turnAuditGroupChatDiceColScore') }}</th>
              <th>{{ $t('chat.turnAuditGroupChatDiceColPassed') }}</th>
              <th>{{ $t('chat.turnAuditGroupChatDiceColSkip') }}</th>
              <th>{{ $t('chat.turnAuditGroupChatDiceColDecay') }}</th>
              <th>{{ $t('chat.turnAuditGroupChatDiceColQuota') }}</th>
              <th>{{ $t('chat.turnAuditGroupChatDiceColSpeakCount') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in sortedBids"
              :key="row.characterId"
              :class="{ 'group-chat-audit-block__winner-row': isWinnerRow(row.characterId) }"
            >
              <td>{{ characterLabel(row.characterId) }}</td>
              <td>{{ isGroupChatDiceBidEligible(row) && typeof row.score === 'number' ? row.score.toFixed(4) : '—' }}</td>
              <td>
                {{
                  isGroupChatDiceBidEligible(row)
                    ? row.passed
                      ? $t('chat.turnAuditYes')
                      : $t('chat.turnAuditNo')
                    : '—'
                }}
              </td>
              <td>{{ skipLabel(row) }}</td>
              <td>{{ formatProb(row.probability) }}</td>
              <td>{{ row.quotaRemaining ?? '—' }}</td>
              <td>{{ row.speakCount ?? '—' }}</td>
            </tr>
          </tbody>
        </v-table>
      </template>
      <p
        v-else-if="audit.method !== 'dice'"
        class="text-body-2 text-medium-emphasis mb-0"
      >
        {{ $t('chat.turnAuditGroupChatNoDiceTable') }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.group-chat-audit-block + .group-chat-audit-block {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.08);
}
.group-chat-audit-block__header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1rem;
}
.group-chat-audit-block__winner-row {
  background: rgba(var(--v-theme-primary), 0.08);
}
</style>
