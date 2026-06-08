import { computeMemorybookProgress } from '@/utils/curated-memory-memorybook-status'
import { translatePluginI18nKey } from '@/utils/plugin-locale-text'

const PLUGIN_ID = 'curated-memory'

function pluginT(
  key: string,
  t: (key: string, params?: Record<string, unknown>) => string,
  te: (key: string) => boolean,
  params?: Record<string, unknown>,
): string {
  return translatePluginI18nKey(`plugins.${PLUGIN_ID}.${key}`, t, te, params)
}

/** 自动摘要开关下的进度说明（curated-memory 对话设置） */
export function memorybookProgressCompanionLines(
  conv: Record<string, unknown> | undefined,
  global: Record<string, unknown> | undefined,
  t: (key: string, params?: Record<string, unknown>) => string,
  te: (key: string) => boolean,
): string[] {
  if (!conv) return []
  const p = computeMemorybookProgress(conv, global ?? {})
  const lines: string[] = []

  if (p.lastSummarizedEnd !== null && p.lastSummarizedEnd >= 0) {
    lines.push(
      pluginT('convMemorybookProgressDone', t, te, { end: p.lastSummarizedEnd }),
    )
  } else {
    lines.push(pluginT('convMemorybookProgressNever', t, te))
  }

  lines.push(
    pluginT('convMemorybookProgressPending', t, te, {
      from: p.pendingFromTurn,
      to: p.pendingToTurn,
    }),
  )

  if (p.memorybookEnabled) {
    lines.push(
      pluginT('convMemorybookProgressNext', t, te, { turn: p.nextTriggerTurn }),
    )
  } else {
    lines.push(pluginT('convMemorybookProgressOff', t, te))
  }

  return lines
}
