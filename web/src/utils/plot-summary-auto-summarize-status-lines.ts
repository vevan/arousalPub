import { computeAutoSummarizeProgress } from '@/utils/plot-summary-auto-summarize-status'
import { translatePluginI18nKey } from '@/utils/plugin-locale-text'

const PLUGIN_ID = 'plot-summary'

function pluginT(
  key: string,
  t: (key: string, params?: Record<string, unknown>) => string,
  te: (key: string) => boolean,
  params?: Record<string, unknown>,
): string {
  return translatePluginI18nKey(`plugins.${PLUGIN_ID}.${key}`, t, te, params)
}

/** 自动摘要开关下的进度说明（plot-summary 对话设置） */
export function autoSummarizeProgressCompanionLines(
  conv: Record<string, unknown> | undefined,
  global: Record<string, unknown> | undefined,
  t: (key: string, params?: Record<string, unknown>) => string,
  te: (key: string) => boolean,
): string[] {
  if (!conv) return []
  const p = computeAutoSummarizeProgress(conv, global ?? {})
  const lines: string[] = []

  if (p.lastSummarizedEnd !== null && p.lastSummarizedEnd >= 0) {
    lines.push(
      pluginT('convAutoSummarizeProgressDone', t, te, { end: p.lastSummarizedEnd }),
    )
  } else {
    lines.push(pluginT('convAutoSummarizeProgressNever', t, te))
  }

  lines.push(
    pluginT('convAutoSummarizeProgressPending', t, te, {
      from: p.pendingFromTurn,
      to: p.pendingToTurn,
    }),
  )

  if (p.autoSummarizeEnabled) {
    lines.push(
      pluginT('convAutoSummarizeProgressNext', t, te, { turn: p.nextTriggerTurn }),
    )
  } else {
    lines.push(pluginT('convAutoSummarizeProgressOff', t, te))
  }

  return lines
}
