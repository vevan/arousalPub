import { PLUGIN_ID, DIALOG_REVIEW, DIALOG_REVIEW_SIDECAR } from './constants.js'
import { isAbortError, isParseFailedError } from './errors.js'
import type { ContextBlockSpec, PreparedPluginContextBlocks } from '../../../shared/plugin-context-blocks.js'
import { PLOT_SUMMARY_COMPLETE_LAYOUT } from './shared/summary-prompt-layout.js'
import {
  clearReviewSession,
  getReviewRegenerate,
  getReviewResolver,
  getReviewTitleParams,
  setReviewRegenerate,
  setReviewResolver,
  setReviewTitleParams,
  summarizeBatchProgress,
} from './state.js'
import { k, sidecarPromptTemplate } from './settings.js'
import { notifyOutcome } from './notify-outcome.js'
import { keywordsToText, parseKeywordsText, asString } from './shared/utils.js'
import type { MergedSettings, PluginHost, SidecarConfig } from './types.js'

function resolveSystemPrompt(
  host: PluginHost,
  settings: MergedSettings,
  opts: {
    kind: 'memory' | 'sidecar'
    sc?: SidecarConfig
  },
): string {
  if (opts.kind === 'sidecar' && opts.sc) {
    return sidecarPromptTemplate(host, opts.sc)
  }
  return settings.systemPromptTemplate
}

function bumpTaskProgress(host: PluginHost, done: number, total: number) {
  host.ui.progress({
    message: host.t(k(host, 'progressSummarize')),
    done,
    total,
    indeterminate: true,
    abortable: true,
    abortLabel: host.t(k(host, 'progressAbort')),
  })
}

export function showCurrentBatchTaskProgress(host: PluginHost) {
  const p = summarizeBatchProgress
  if (!p) return
  bumpTaskProgress(host, p.taskIndex + 1, p.total)
}

function reviewDialogOpenOpts() {
  const titleParams = getReviewTitleParams()
  return titleParams ? { titleParams } : undefined
}

export async function resolveTargetLorebookName(
  host: PluginHost,
  lorebookId: string,
): Promise<string> {
  const id = asString(lorebookId)
  if (!id) return ''
  try {
    const lb = await host.lorebook.get(id)
    const name = asString(lb.name)
    return name || id
  } catch {
    return id
  }
}

function openReviewFormDialog(
  host: PluginHost,
  draft: { title: string; content: string; keywords: string[] },
  dialogId: string,
) {
  const model = {
    title: draft.title,
    content: draft.content,
    keywordsText: keywordsToText(draft.keywords),
  }
  host.openFormDialog(PLUGIN_ID, model, dialogId, reviewDialogOpenOpts())
}

async function runReviewRegenerate(host: PluginHost, dialogId: string) {
  const regen = getReviewRegenerate()
  const resolver = getReviewResolver()
  if (!regen || !resolver) return
  try {
    const draft = await regen(host)
    openReviewFormDialog(host, draft, dialogId)
  } catch (e) {
    if (isAbortError(e)) {
      clearReviewSession()
      resolver.reject(new Error('review_aborted'))
      return
    }
    console.warn('[plot-summary] review regenerate failed', e)
    if (!isParseFailedError(e)) {
      notifyOutcome(host, 'notifyReviewRegenerateFailed', 'warning')
    }
  }
}

export async function generateReviewDraft(
  host: PluginHost,
  settings: MergedSettings,
  opts: {
    kind: 'memory' | 'sidecar'
    contextBlocks?: ContextBlockSpec[]
    preparedContext: PreparedPluginContextBlocks
    fromTurn?: number
    toTurn?: number
    sc?: SidecarConfig
    lorebookName?: string
    dialogId?: string
  },
) {
  showCurrentBatchTaskProgress(host)
  try {
    const anchorToTurn =
      typeof opts.toTurn === 'number' && Number.isInteger(opts.toTurn)
        ? opts.toTurn
        : undefined
    if (anchorToTurn === undefined) {
      throw new Error('anchor_to_turn_required')
    }
    const systemPromptTemplate = resolveSystemPrompt(host, settings, opts)
    if (!systemPromptTemplate.trim()) {
      throw new Error(
        opts.kind === 'sidecar' ? 'sidecar_prompt_required' : 'system_prompt_required',
      )
    }
    const result = await host.plugin.completeWithContext({
      ...(settings.apiConfigId ? { apiConfigId: settings.apiConfigId } : {}),
      blocks: opts.contextBlocks ?? [],
      preparedContext: opts.preparedContext,
      layout: PLOT_SUMMARY_COMPLETE_LAYOUT,
      pluginSettings: {
        systemPromptTemplate,
        ...(opts.kind === 'sidecar' && opts.sc?.name
          ? { sidecarName: opts.sc.name }
          : {}),
      },
      anchorToTurn,
      responseFormat: 'json_object',
      draft: {
        kind: opts.kind,
        fromTurn: opts.fromTurn,
        toTurn: opts.toTurn,
        blockTurns: settings.blockTurns,
      },
    })
    if (!result.draft) {
      throw new Error('plugin_complete_draft_failed')
    }
    if (opts.lorebookName && opts.dialogId) {
      notifyDraftParseOutcome(host, 'success', opts.lorebookName, opts.dialogId)
    }
    return result.draft
  } catch (e) {
    if (opts.lorebookName && opts.dialogId && isParseFailedError(e)) {
      notifyDraftParseOutcome(host, 'failure', opts.lorebookName, opts.dialogId)
    }
    throw e
  } finally {
    host.ui.clearProgress()
  }
}

type ReviewDialogOpts = {
  dialogId: string
  bodyKey: string
  lockTitle?: boolean
}

function registerReviewDialog(host: PluginHost, opts: ReviewDialogOpts) {
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, 'reviewDialogTitle'),
      bodyKey: k(host, opts.bodyKey),
      fields: [
        {
          key: 'title',
          labelKey: k(host, 'reviewTitleLabel'),
          type: 'text',
          ...(opts.lockTitle ? { readOnly: true } : {}),
        },
        {
          key: 'content',
          labelKey: k(host, 'reviewContentLabel'),
          type: 'textarea',
        },
        {
          key: 'keywordsText',
          labelKey: k(host, 'reviewKeywordsLabel'),
          type: 'textarea',
          hintKey: k(host, 'reviewKeywordsHint'),
        },
      ],
      submitKey: k(host, 'reviewConfirm'),
      skipKey: k(host, 'reviewSkip'),
      cancelKey: k(host, 'reviewAbort'),
      regenerateKey: k(host, 'reviewRegenerate'),
      persistent: true,
      canSubmit: (m: Record<string, unknown>) =>
        opts.lockTitle
          ? asString(m.content).length > 0
          : asString(m.title).length > 0 && asString(m.content).length > 0,
      onSubmit: async (_h: PluginHost, model: Record<string, unknown>) => {
        const resolver = getReviewResolver()
        if (!resolver) return
        clearReviewSession()
        resolver.resolve({
          title: asString(model.title),
          content: asString(model.content),
          keywords: parseKeywordsText(model.keywordsText),
        })
      },
      onSkip: () => {
        const resolver = getReviewResolver()
        if (!resolver) return
        clearReviewSession()
        resolver.reject(new Error('review_skipped'))
      },
      onCancel: () => {
        const resolver = getReviewResolver()
        if (!resolver) return
        clearReviewSession()
        resolver.reject(new Error('review_aborted'))
      },
      onRegenerate: async (h: PluginHost) => {
        await runReviewRegenerate(h, opts.dialogId)
      },
    },
    opts.dialogId,
  )
}

export function registerReviewDialogs(host: PluginHost) {
  registerReviewDialog(host, {
    dialogId: DIALOG_REVIEW,
    bodyKey: 'reviewDialogBody',
  })
  registerReviewDialog(host, {
    dialogId: DIALOG_REVIEW_SIDECAR,
    bodyKey: 'reviewDialogBodySidecar',
    lockTitle: true,
  })
}

function notifyDraftParseOutcome(
  host: PluginHost,
  outcome: 'success' | 'failure',
  lorebookName: string,
  dialogId: string,
): void {
  if (outcome === 'success' && typeof document !== 'undefined' && !document.hidden) {
    return
  }
  const conversationId = host.conversation.getId()?.trim()
  const dedupeSuffix = `${conversationId ?? 'unknown'}:${dialogId}`
  if (outcome === 'success') {
    const action =
      conversationId ?
        ({ type: 'conversation' as const, conversationId })
      : undefined
    host.ui.notify(
      host.t(k(host, 'notifyReviewReady'), { name: lorebookName }),
      host.t(k(host, 'notifyReviewReadyBody')),
      {
        level: 'info',
        dedupeKey: `plot-summary:review-ready:${dedupeSuffix}`,
        action,
        snackbarActions:
          action ?
            [
              {
                label: host.t(k(host, 'notifyReviewReadyOpen')),
                action,
              },
            ]
          : undefined,
      },
    )
    return
  }
  host.ui.notify(
    host.t(k(host, 'notifyParseFailed'), { name: lorebookName }),
    host.t(k(host, 'notifyParseFailedBody')),
    {
      level: 'error',
      dedupeKey: `plot-summary:parse-failed:${dedupeSuffix}`,
    },
  )
}

export function promptReview(
  host: PluginHost,
  draft: { title: string; content: string; keywords: string[] },
  dialogId: string,
  regenerateFn: ((host: PluginHost) => Promise<{
    title: string
    content: string
    keywords: string[]
  }>) | null,
  lorebookName: string,
) {
  return new Promise<{
    title: string
    content: string
    keywords: string[]
  }>((resolve, reject) => {
    setReviewResolver({ resolve, reject })
    setReviewRegenerate(regenerateFn)
    setReviewTitleParams({ name: lorebookName })
    openReviewFormDialog(host, draft, dialogId)
  })
}
