import type { ResolvedFeatureAudit } from './feature-binding-types.js'
import {
  getActiveSegmentIndex,
  syncTurnSpeakerFromActiveSegment,
} from './group-chat/segments.js'
import type {
  AssistantSegmentRecord,
  ChunkFile,
  TurnRecord,
} from './chat-turn-types.js'

/** 助手 receive 运行时元数据（模型、耗时、组装 token 估算等） */
export function buildReceiveRuntime(opts: {
  model?: string
  durationMs?: number
  /** 发往模型的 messages 估算（tiktoken） */
  estimatedTokens?: number
  /** 上游 usage.completion_tokens，缺省时由落盘逻辑 tiktoken 估算助手正文 */
  completionTokens?: number
  /** 出站 chat 等功能键解析结果（审计用，不含密钥） */
  resolvedFeature?: ResolvedFeatureAudit
}): Record<string, unknown> | undefined {
  const runtime: Record<string, unknown> = {}
  if (opts.model) runtime.model = opts.model
  if (typeof opts.durationMs === 'number' && opts.durationMs > 0) {
    runtime.durationMs = Math.round(opts.durationMs)
  }
  if (
    typeof opts.estimatedTokens === 'number' &&
    Number.isFinite(opts.estimatedTokens) &&
    opts.estimatedTokens > 0
  ) {
    runtime.estimatedTokens = Math.round(opts.estimatedTokens)
  }
  if (
    typeof opts.completionTokens === 'number' &&
    Number.isFinite(opts.completionTokens) &&
    opts.completionTokens > 0
  ) {
    runtime.completionTokens = Math.round(opts.completionTokens)
  }
  if (opts.resolvedFeature) {
    runtime.resolvedFeature = opts.resolvedFeature
  }
  return Object.keys(runtime).length > 0 ? runtime : undefined
}

/** 收集 chunk 内已有 turnId / receive.id，供短 id 分配去重 */
export function collectChunkEntityIds(chunk: ChunkFile | null): Set<string> {
  const used = new Set<string>()
  if (!chunk?.turns?.length) return used
  for (const t of chunk.turns) {
    const tid = typeof t.turnId === 'string' ? t.turnId.trim() : ''
    if (tid) used.add(tid)
    for (const s of t.segments ?? []) {
      const sid = typeof s.id === 'string' ? s.id.trim() : ''
      if (sid) used.add(sid)
      for (const r of s.receives ?? []) {
        const rid = typeof r.id === 'string' ? r.id.trim() : ''
        if (rid) used.add(rid)
      }
    }
  }
  return used
}

/** 从 send 块读取当前用户正文 */
export function getTurnUserText(turn: Pick<TurnRecord, 'send'>): string {
  return typeof turn.send?.userText === 'string' ? turn.send.userText : ''
}

/** 更新 turn 展示用 user/assistant 正文（同步 active segment） */
export function patchTurnDisplayContent(
  turn: TurnRecord,
  userText: string,
  assistantContent: string,
): TurnRecord {
  const next: TurnRecord = { ...turn, send: { userText } }
  const segIdx = getActiveSegmentIndex(next)
  const seg = next.segments[segIdx]
  if (!seg) return next
  const segReceives = [...seg.receives]
  const activeIdx = Math.min(
    Math.max(0, Math.floor(seg.activeReceiveIndex) || 0),
    Math.max(0, segReceives.length - 1),
  )
  if (segReceives[activeIdx]) {
    segReceives[activeIdx] = {
      ...segReceives[activeIdx],
      content: assistantContent,
    }
  }
  next.segments = next.segments.map((s, i) =>
    i === segIdx ? { ...s, receives: segReceives } : s,
  )
  syncTurnSpeakerFromActiveSegment(next)
  return next
}

function stripSegmentsMetaForDisk(
  segments: AssistantSegmentRecord[],
): AssistantSegmentRecord[] {
  let lastContentIdx = -1
  for (let i = segments.length - 1; i >= 0; i--) {
    if ((segments[i]?.receives?.length ?? 0) > 0) {
      lastContentIdx = i
      break
    }
  }
  if (lastContentIdx < 0) return segments
  const carryKeepIdx = lastContentIdx > 0 ? lastContentIdx - 1 : lastContentIdx
  return segments.map((s, i) => {
    if (!s.meta?.resolvedNextSpeakerAudit || i === carryKeepIdx) return s
    const { resolvedNextSpeakerAudit: _drop, ...restMeta } = s.meta
    const meta = Object.keys(restMeta).length > 0 ? restMeta : undefined
    return meta ? { ...s, meta } : { ...s, meta: undefined }
  })
}

/** 写盘时规范 plugins 与群聊字段 */
export function stripTurnForDisk(t: TurnRecord): TurnRecord {
  const out: TurnRecord = {
    turnId: t.turnId,
    turnOrdinal: t.turnOrdinal,
    send: t.send,
    plugins: Array.isArray(t.plugins) ? t.plugins : [],
    segments: stripSegmentsMetaForDisk(t.segments),
    activeSegmentIndex: t.activeSegmentIndex,
  }
  if (Array.isArray(t.speakerQueue) && t.speakerQueue.length > 0) {
    out.speakerQueue = t.speakerQueue
  }
  const speaker = typeof t.speakerCharacterId === 'string' ? t.speakerCharacterId.trim() : ''
  if (speaker) out.speakerCharacterId = speaker
  if (t.groupChatTurnState) {
    out.groupChatTurnState = {
      quotaRemaining: { ...t.groupChatTurnState.quotaRemaining },
      speakCount: { ...t.groupChatTurnState.speakCount },
    }
  }
  const createdAt =
    typeof t.createdAt === 'string' && t.createdAt.trim()
      ? t.createdAt.trim()
      : undefined
  if (createdAt) out.createdAt = createdAt
  return out
}
