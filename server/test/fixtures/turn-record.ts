import type { TurnReceive, TurnRecord } from '../../src/chat-storage.js'

/** 测试用 turn：自动从 receives 物化单 segment（与落盘格式一致） */
export function testTurn(params: {
  turnId?: string
  turnOrdinal: number
  userText?: string
  receives?: TurnReceive[]
  activeReceiveIndex?: number
  speakerCharacterId?: string
  segments?: TurnRecord['segments']
  activeSegmentIndex?: number
  createdAt?: string
  plugins?: unknown[]
}): TurnRecord {
  const receives = params.receives ?? []
  const activeReceiveIndex = params.activeReceiveIndex ?? 0
  const speaker = params.speakerCharacterId?.trim() ?? ''
  const segments =
    params.segments ??
    (receives.length > 0
      ? [
          {
            id: `seg-${params.turnOrdinal}`,
            speakerCharacterId: speaker,
            receives,
            activeReceiveIndex,
          },
        ]
      : [])
  return {
    turnId: params.turnId ?? `t-${params.turnOrdinal}`,
    turnOrdinal: params.turnOrdinal,
    ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    send: { userText: params.userText ?? '' },
    receives,
    activeReceiveIndex,
    segments,
    activeSegmentIndex: params.activeSegmentIndex ?? 0,
    plugins: params.plugins ?? [],
    ...(speaker ? { speakerCharacterId: speaker } : {}),
  }
}
