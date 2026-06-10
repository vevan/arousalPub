import type {
  PerformanceAudit,
  StreamAuditStats,
  UpstreamTimingMs,
} from './chat-audit-types.js'
import { estimateTokens } from './token-count.js'

export function isSseContentDelta(
  d: { text?: string; reasoning?: string } | null | undefined,
): boolean {
  return Boolean(d && (d.text !== undefined || d.reasoning !== undefined))
}

function roundMs(n: number): number {
  return Math.round(n)
}

function roundTps(n: number): number {
  return Math.round(n * 10) / 10
}

export function resolveTpsTokenCount(
  completionTokensUpstream: number | undefined,
  assistantContent: string,
  assistantReasoning: string | undefined,
  model?: string,
): { count: number; source: 'upstream' | 'estimated' } | undefined {
  if (
    typeof completionTokensUpstream === 'number' &&
    completionTokensUpstream > 0
  ) {
    return { count: Math.round(completionTokensUpstream), source: 'upstream' }
  }
  const corpus = [
    assistantContent.trim(),
    assistantReasoning?.trim() ?? '',
  ]
    .filter((s) => s.length > 0)
    .join('\n\n')
  if (!corpus) return undefined
  const n = estimateTokens(corpus, { model })
  if (n <= 0) return undefined
  return { count: n, source: 'estimated' }
}

export function buildUpstreamTimingMs(params: {
  upstreamStartedAt: number
  responseHeadersAt?: number
  firstTokenAt?: number
  lastTokenAt?: number
  streamEndedAt?: number
  completionTokensUpstream?: number
  assistantContent: string
  assistantReasoning?: string
  model?: string
}): UpstreamTimingMs | undefined {
  const {
    upstreamStartedAt,
    responseHeadersAt,
    firstTokenAt,
    lastTokenAt,
    streamEndedAt,
    completionTokensUpstream,
    assistantContent,
    assistantReasoning,
    model,
  } = params

  const endedAt = streamEndedAt ?? lastTokenAt
  const total =
    typeof endedAt === 'number'
      ? roundMs(endedAt - upstreamStartedAt)
      : undefined

  const out: UpstreamTimingMs = {}
  if (typeof responseHeadersAt === 'number') {
    out.toResponseHeaders = roundMs(responseHeadersAt - upstreamStartedAt)
  }
  if (typeof firstTokenAt === 'number') {
    out.toFirstToken = roundMs(firstTokenAt - upstreamStartedAt)
  }
  if (
    typeof firstTokenAt === 'number' &&
    typeof lastTokenAt === 'number' &&
    lastTokenAt >= firstTokenAt
  ) {
    const generationMs = lastTokenAt - firstTokenAt
    out.firstTokenToLastToken = roundMs(generationMs)
    if (generationMs > 0) {
      const tokenResolved = resolveTpsTokenCount(
        completionTokensUpstream,
        assistantContent,
        assistantReasoning,
        model,
      )
      if (tokenResolved) {
        out.tps = roundTps(tokenResolved.count / (generationMs / 1000))
        out.tpsTokenSource = tokenResolved.source
        out.tpsTokenCount = tokenResolved.count
      }
    }
  }
  if (typeof total === 'number' && total > 0) {
    out.total = total
  }

  if (
    out.toResponseHeaders === undefined &&
    out.toFirstToken === undefined &&
    out.firstTokenToLastToken === undefined &&
    out.total === undefined
  ) {
    return undefined
  }
  return out
}

export function buildStreamAuditStats(params: {
  assistantContent: string
  assistantReasoning?: string
  completionTokensUpstream?: number
  model?: string
  includeTokenEstimates?: boolean
}): StreamAuditStats | undefined {
  const content = params.assistantContent
  const reasoning = params.assistantReasoning?.trim() ?? ''
  if (!content && !reasoning) return undefined

  const out: StreamAuditStats = {
    contentChars: content.length,
    reasoningChars: reasoning.length,
  }
  if (
    typeof params.completionTokensUpstream === 'number' &&
    params.completionTokensUpstream > 0
  ) {
    out.completionTokensUpstream = Math.round(params.completionTokensUpstream)
  }
  if (params.includeTokenEstimates) {
    const model = params.model
    if (content.length > 0) {
      const n = estimateTokens(content, { model })
      if (n > 0) out.contentTokensEst = n
    }
    if (reasoning.length > 0) {
      const n = estimateTokens(reasoning, { model })
      if (n > 0) out.reasoningTokensEst = n
    }
  }
  return out
}

export function buildPerformanceForPersist(
  base: PerformanceAudit | undefined,
  opts: {
    upstreamStartedAt: number
    responseHeadersAt?: number
    firstTokenAt?: number
    lastTokenAt?: number
    streamEndedAt?: number
    completionTokensUpstream?: number
    assistantContent: string
    assistantReasoning?: string
    model?: string
    preUpstreamMs?: number
  },
): PerformanceAudit | undefined {
  if (!base) return undefined
  const upstreamMs = buildUpstreamTimingMs({
    upstreamStartedAt: opts.upstreamStartedAt,
    responseHeadersAt: opts.responseHeadersAt,
    firstTokenAt: opts.firstTokenAt,
    lastTokenAt: opts.lastTokenAt,
    streamEndedAt: opts.streamEndedAt,
    completionTokensUpstream: opts.completionTokensUpstream,
    assistantContent: opts.assistantContent,
    assistantReasoning: opts.assistantReasoning,
    model: opts.model,
  })
  const stream = buildStreamAuditStats({
    assistantContent: opts.assistantContent,
    assistantReasoning: opts.assistantReasoning,
    completionTokensUpstream: opts.completionTokensUpstream,
    model: opts.model,
    includeTokenEstimates: true,
  })
  return mergePerformanceAudit(base, {
    ...(typeof opts.preUpstreamMs === 'number' && opts.preUpstreamMs >= 0
      ? { preUpstreamMs: Math.round(opts.preUpstreamMs) }
      : {}),
    ...(upstreamMs ? { upstreamMs } : {}),
    ...(stream ? { stream } : {}),
  })
}

export function mergePerformanceAudit(
  base: PerformanceAudit | undefined,
  patch: PerformanceAudit | undefined,
): PerformanceAudit | undefined {
  if (!base && !patch) return undefined
  const out: PerformanceAudit = {}
  if (base?.preUpstreamMs !== undefined || patch?.preUpstreamMs !== undefined) {
    out.preUpstreamMs = patch?.preUpstreamMs ?? base?.preUpstreamMs
  }
  if (base?.assemblyMs || patch?.assemblyMs) {
    out.assemblyMs = {
      total: patch?.assemblyMs?.total ?? base?.assemblyMs?.total ?? 0,
      ...(base?.assemblyMs ?? {}),
      ...(patch?.assemblyMs ?? {}),
    }
  }
  if (base?.upstreamMs || patch?.upstreamMs) {
    out.upstreamMs = { ...base?.upstreamMs, ...patch?.upstreamMs }
  }
  if (base?.persistMs || patch?.persistMs) {
    out.persistMs = { ...base?.persistMs, ...patch?.persistMs }
  }
  if (base?.stream || patch?.stream) {
    out.stream = {
      contentChars:
        patch?.stream?.contentChars ?? base?.stream?.contentChars ?? 0,
      reasoningChars:
        patch?.stream?.reasoningChars ?? base?.stream?.reasoningChars ?? 0,
      ...(base?.stream ?? {}),
      ...(patch?.stream ?? {}),
    }
  }
  return out
}
