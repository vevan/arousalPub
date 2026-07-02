<script setup lang="ts">
import ChatTurnAssistant from '@/components/chat/ChatTurnAssistant.vue'
import ChatTurnUser from '@/components/chat/ChatTurnUser.vue'
import PluginSlotMount from '@/plugins/PluginSlotMount.vue'
import type { useChatSession } from '@/composables/useChatSession'
import type { AssistantSegmentItem, ChatTurnItem } from '@/types/chat-turn'
import { getTurnSegmentsForUi } from '@/utils/group-chat-turn'
import { computed } from 'vue'

const props = defineProps<{
  turn: ChatTurnItem
  listIndex: number
  session: ReturnType<typeof useChatSession>
}>()

const { turnLabelN, isOpeningTurn } = props.session

const segments = computed(() =>
  getTurnSegmentsForUi(props.turn),
)

function segmentTurnView(segment: AssistantSegmentItem): ChatTurnItem {
  return {
    ...props.turn,
    receives: segment.receives,
    activeReceiveIndex: segment.activeReceiveIndex,
    speakerCharacterId: segment.speakerCharacterId,
  }
}
</script>

<template>
  <div class="turn-block">
    <div class="turn-divider" role="separator">
      <span class="turn-divider__line" />
      <span class="turn-divider__ornament">❦</span>
      <span class="turn-divider__label">
        {{ $t('chat.turnLabel', { n: turnLabelN(turn, listIndex) }) }}
      </span>
      <span class="turn-divider__ornament">❦</span>
      <span class="turn-divider__line" />
    </div>

    <div class="turn-block-head" data-plugin-slot="turn-block-head">
      <div class="plugin-slots turn-block-head__slots">
        <PluginSlotMount
          slot-name="turn-block-head"
          :turn="turn"
          :list-index="listIndex"
        />
      </div>
    </div>

    <ChatTurnUser
      v-if="!isOpeningTurn(turn)"
      :turn="turn"
      :list-index="listIndex"
      :session="session"
    />
    <ChatTurnAssistant
      v-for="(segment, segmentIndex) in segments"
      :key="segment.id || segmentIndex"
      :turn="segmentTurnView(segment)"
      :list-index="listIndex"
      :segment-index="segmentIndex"
      :session="session"
    />
  </div>
</template>
