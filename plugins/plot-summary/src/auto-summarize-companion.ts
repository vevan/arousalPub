import {
  buildAutoSummarizePointerResetPatch,
  computeAutoSummarizeProgress,
} from './auto-summarize-progress.js'
import { DIALOG_POINTER_RESET, PLUGIN_ID } from './constants.js'
import { k, readLastMemoIndex, readLastSummarizedEnd } from './settings.js'
import type { PluginHost } from './types.js'

function isBlank(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())
}

function parseOptionalInt(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw)
  if (typeof raw === 'string' && raw.trim()) {
    const n = Math.round(Number(raw))
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** null=清空；undefined=非法输入 */
function parseMemoIndexField(raw: unknown): number | null | undefined {
  if (isBlank(raw)) return null
  const n = parseOptionalInt(raw)
  if (n === undefined) return undefined
  return n >= 1 ? n : null
}

function memoOnlyPatch(memo: number | null): Record<string, unknown> {
  return { lastMemoIndex: memo }
}

export function registerAutoSummarizeCompanion(host: PluginHost) {
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, 'convAutoSummarizeResetTitle'),
      bodyKey: k(host, 'convAutoSummarizeResetHint'),
      fields: [
        {
          key: 'lastSummarizedEnd',
          labelKey: k(host, 'convAutoSummarizeResetEndLabel'),
          type: 'integer',
          min: -1,
        },
        {
          key: 'lastMemoIndex',
          labelKey: k(host, 'convAutoSummarizeResetMemoLabel'),
          type: 'integer',
          min: 1,
          max: 9999,
          hintKey: k(host, 'convAutoSummarizeResetMemoHint'),
        },
      ],
      submitKey: k(host, 'convAutoSummarizeResetConfirm'),
      cancelKey: k(host, 'sessionCancel'),
      skipKey: k(host, 'convAutoSummarizeResetNever'),
      canSubmit: (m: Record<string, unknown>) => {
        const memo = parseMemoIndexField(m.lastMemoIndex)
        if (memo === undefined) return false
        if (isBlank(m.lastSummarizedEnd)) return true
        const n = parseOptionalInt(m.lastSummarizedEnd)
        return typeof n === 'number' && n >= -1
      },
      onSkip: async (h: PluginHost) => {
        await h.conversation.patchPluginSettings(
          buildAutoSummarizePointerResetPatch(null, null),
        )
      },
      onSubmit: async (h: PluginHost, model: Record<string, unknown>) => {
        const memo = parseMemoIndexField(model.lastMemoIndex)
        if (memo === undefined) return
        if (isBlank(model.lastSummarizedEnd)) {
          await h.conversation.patchPluginSettings(memoOnlyPatch(memo))
          return
        }
        const n = parseOptionalInt(model.lastSummarizedEnd)
        if (typeof n !== 'number') return
        await h.conversation.patchPluginSettings(
          buildAutoSummarizePointerResetPatch(n, memo),
        )
      },
    },
    DIALOG_POINTER_RESET,
  )

  host.registerSettingsCompanionPanel(PLUGIN_ID, {
    id: 'auto-summarize-progress',
    getView: (ctx) => {
      const p = computeAutoSummarizeProgress(ctx.convModel, ctx.globalModel)
      const lastMemo = readLastMemoIndex(ctx.convModel)
      const rows: {
        icon: string
        text: string
        tone?: 'muted' | 'accent'
      }[] = []

      if (p.lastSummarizedEnd !== null && p.lastSummarizedEnd >= 0) {
        rows.push({
          icon: 'mdi-check-circle-outline',
          text: host.t(k(host, 'convAutoSummarizeProgressDone'), {
            end: p.lastSummarizedEnd,
          }),
        })
      } else {
        rows.push({
          icon: 'mdi-circle-outline',
          text: host.t(k(host, 'convAutoSummarizeProgressNever')),
          tone: 'muted',
        })
      }

      if (typeof lastMemo === 'number' && lastMemo >= 1) {
        rows.push({
          icon: 'mdi-numeric',
          text: host.t(k(host, 'convAutoSummarizeProgressMemo'), {
            n: lastMemo,
          }),
        })
      } else {
        rows.push({
          icon: 'mdi-numeric-off',
          text: host.t(k(host, 'convAutoSummarizeProgressMemoNever')),
          tone: 'muted',
        })
      }

      rows.push({
        icon: 'mdi-format-list-bulleted',
        text: host.t(k(host, 'convAutoSummarizeProgressPending'), {
          from: p.pendingFromTurn,
          to: p.pendingToTurn,
        }),
      })

      if (p.autoSummarizeEnabled) {
        rows.push({
          icon: 'mdi-calendar-clock',
          text: host.t(k(host, 'convAutoSummarizeProgressNext'), {
            turn: p.nextTriggerTurn,
          }),
          tone: 'accent',
        })
      } else {
        rows.push({
          icon: 'mdi-pause-circle-outline',
          text: host.t(k(host, 'convAutoSummarizeProgressOff')),
          tone: 'muted',
        })
      }

      return {
        title: host.t(k(host, 'convAutoSummarizeProgressTitle')),
        rows,
        actionLabel: host.t(k(host, 'convAutoSummarizeResetBtn')),
        onAction: () => {
          const last = readLastSummarizedEnd(ctx.convModel)
          const memo = readLastMemoIndex(ctx.convModel)
          host.openFormDialog(
            PLUGIN_ID,
            {
              lastSummarizedEnd:
                typeof last === 'number' ? String(last) : '',
              lastMemoIndex:
                typeof memo === 'number' ? String(memo) : '',
            },
            DIALOG_POINTER_RESET,
          )
        },
      }
    },
  })
}
