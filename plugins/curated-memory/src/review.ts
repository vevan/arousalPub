import { PLUGIN_ID, DIALOG_REVIEW, DIALOG_REVIEW_SIDECAR } from './constants.js'
import { isAbortError } from './errors.js'
import {
  clearReviewSession,
  getReviewRegenerate,
  getReviewResolver,
  setReviewRegenerate,
  setReviewResolver,
  summarizeBatchProgress,
} from './state.js'
import { k, sidecarPromptTemplate } from './settings.js'
import { keywordsToText, parseKeywordsText, asString } from './shared/utils.js'
import type { MergedSettings, PluginHost, SidecarConfig } from './types.js'

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

async function runReviewRegenerate(host: PluginHost, dialogId: string) {
  const regen = getReviewRegenerate()
  const resolver = getReviewResolver()
  if (!regen || !resolver) return
  try {
    const draft = await regen(host)
    host.ui.openFormDialog(
      PLUGIN_ID,
      {
        title: draft.title,
        content: draft.content,
        keywordsText: keywordsToText(draft.keywords),
      },
      dialogId,
    )
  } catch (e) {
    if (isAbortError(e)) {
      clearReviewSession()
      resolver.reject(new Error('review_aborted'))
      return
    }
    console.warn('[curated-memory] review regenerate failed', e)
    host.ui.toast(host.t(k(host, 'toastReviewRegenerateFailed')), { color: 'warning' })
  }
}

export async function generateReviewDraft(
  host: PluginHost,
  settings: MergedSettings,
  opts: {
    kind: 'memory' | 'sidecar'
    userContent: string
    fromTurn?: number
    toTurn?: number
    sc?: SidecarConfig
  },
) {
  showCurrentBatchTaskProgress(host)
  try {
    const req = {
      apiConfigId: settings.apiConfigId,
      kind: opts.kind,
      userContent: opts.userContent,
      systemPromptTemplate:
        opts.kind === 'sidecar' && opts.sc
          ? sidecarPromptTemplate(host, opts.sc)
          : settings.systemPromptTemplate,
      titleFormat: settings.titleFormat as 'plain' | 'range-suffix',
      fromTurn: opts.fromTurn,
      toTurn: opts.toTurn,
      sidecarName: opts.sc?.name,
    }
    const { draft } = await host.plugin.completeDraft(req)
    return draft
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

export function promptReview(
  host: PluginHost,
  draft: { title: string; content: string; keywords: string[] },
  dialogId: string,
  regenerateFn: ((host: PluginHost) => Promise<{
    title: string
    content: string
    keywords: string[]
  }>) | null,
) {
  return new Promise<{
    title: string
    content: string
    keywords: string[]
  }>((resolve, reject) => {
    setReviewResolver({ resolve, reject })
    setReviewRegenerate(regenerateFn)
    host.openFormDialog(
      PLUGIN_ID,
      {
        title: draft.title,
        content: draft.content,
        keywordsText: keywordsToText(draft.keywords),
      },
      dialogId,
    )
  })
}
