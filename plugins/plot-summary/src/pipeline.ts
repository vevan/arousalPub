import { DIALOG_REVIEW, DIALOG_REVIEW_SIDECAR } from './constants.js'
import { isAbortError, isParseFailedError, isPipelineFatalError, preflightNotify } from './errors.js'
import {
  generateReviewDraft,
  promptReview,
  resolveTargetLorebookName,
  showCurrentBatchTaskProgress,
} from './review.js'
import { applyPlotSummaryEntrySort } from './shared/entry-sort.js'
import { flushPendingLorebookCreates, type PendingLorebookCreate } from './batch-write.js'
import { entryKeys, writeSidecarEntry } from './sidecar.js'
import { k, loadMergedSettings } from './settings.js'
import { notifyOutcome } from './notify-outcome.js'
import {
  setSummarizeBatchProgress,
  setSummarizeRunning,
  summarizeRunning,
} from './state.js'
import { isSummarizeTurnSpanTooLarge } from './shared/range-limits.js'
import { asString } from './shared/utils.js'
import type { PluginHost, SummarizeTask } from './types.js'
import {
  ensureTargetLorebook,
  promptRecoverLorebook,
  refreshAutoSummarizeUi,
} from './dialogs.js'
import { isLorebookNotFoundError } from './errors.js'
import { preparePlotSummarySummarizeContext } from './prepare-context.js'

function setPluginHold(host: PluginHost, hold: boolean) {
  if (typeof host.conversation.setPluginHold === 'function') {
    host.conversation.setPluginHold(hold)
  }
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

export async function runSummarizeTasks(
  host: PluginHost,
  opts: {
    fromTurn: number
    toTurn: number
    tasks?: SummarizeTask[]
    updatePointers?: boolean
    updateAutoSummarizeCache?: boolean
  },
) {
  if (summarizeRunning) {
    host.ui.notify(host.t(k(host, 'notifyBusy')), undefined, { level: 'info' })
    return { ok: false, reason: 'busy' }
  }
  const tasks = opts.tasks ?? []
  if (tasks.length === 0) {
    host.ui.notify(host.t(k(host, 'notifyNoTasksSelected')), undefined, { level: 'warning' })
    return { ok: false, reason: 'no_tasks' }
  }

  setSummarizeRunning(true)
  host.refreshSlotButtons()
  setPluginHold(host, true)

  let completedTasks = 0

  try {
    const settings = await loadMergedSettings(host)
    const targetId = await ensureTargetLorebook(host, settings)
    if (!targetId) {
      return { ok: false, reason: 'no_lorebook' }
    }
    settings.targetLorebookId = targetId
    let lorebookName = await resolveTargetLorebookName(host, targetId)

    const fromTurn = opts.fromTurn
    const toTurn = opts.toTurn
    if (fromTurn > toTurn) {
      host.ui.notify(host.t(k(host, 'notifyInvalidRange')), undefined, { level: 'warning' })
      return { ok: false, reason: 'invalid_range' }
    }
    if (isSummarizeTurnSpanTooLarge(fromTurn, toTurn)) {
      host.ui.notify(host.t(k(host, 'notifyTurnRangeTooLong')), undefined, { level: 'warning' })
      return { ok: false, reason: 'turn_range_too_long' }
    }

    const sidecarConfigIds = settings.sidecars.map((s) => s.id)
    const persistedSidecarEntryIds = settings.sidecarEntryIds
    let sidecarEntryIds: Record<string, string>
    try {
      sidecarEntryIds = await host.lorebook.normalizeEntryRefs({
        lorebookId: settings.targetLorebookId,
        entryIds: settings.sidecarEntryIds,
        validKeys: settings.sidecars.map((s) => s.id),
      })
    } catch (e) {
      if (!isLorebookNotFoundError(e)) throw e
      const recovered = await promptRecoverLorebook(host, settings)
      if (!recovered) {
        return { ok: false, reason: 'no_lorebook' }
      }
      settings.targetLorebookId = recovered
      lorebookName = await resolveTargetLorebookName(host, recovered)
      sidecarEntryIds = await host.lorebook.normalizeEntryRefs({
        lorebookId: settings.targetLorebookId,
        entryIds: {},
        validKeys: settings.sidecars.map((s) => s.id),
      })
    }
    settings.sidecarEntryIds = sidecarEntryIds

    const prepared = await preparePlotSummarySummarizeContext(
      host,
      settings,
      fromTurn,
      toTurn,
    )
    if (!prepared.userContent?.trim()) {
      host.ui.notify(host.t(k(host, 'notifyNoTurnsInRange')), undefined, { level: 'warning' })
      return { ok: false, reason: 'no_turns' }
    }
    const preparedContext = prepared.preparedContext

    const patch: Record<string, unknown> = {}
    let done = 0
    let ranMemory = false
    let wroteToLorebook = false
    let skippedTasks = 0
    let aborted = false
    const pendingCreates: PendingLorebookCreate[] = []

    host.ui.progress({
      message: host.t(k(host, 'progressSummarize')),
      done: 0,
      total: tasks.length,
      indeterminate: true,
      abortable: true,
      abortLabel: host.t(k(host, 'progressAbort')),
    })
    setSummarizeBatchProgress({ taskIndex: 0, total: tasks.length })

    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
      const task = tasks[taskIndex]
      setSummarizeBatchProgress({ taskIndex, total: tasks.length })
      showCurrentBatchTaskProgress(host)

      try {
        if (task.kind === 'memory') {
          const memoryDraft = await generateReviewDraft(host, settings, {
            kind: 'memory',
            preparedContext,
            fromTurn,
            toTurn,
            lorebookName,
            dialogId: DIALOG_REVIEW,
          })
          const reviewed = await promptReview(
            host,
            memoryDraft,
            DIALOG_REVIEW,
            (h) =>
              generateReviewDraft(h, settings, {
                kind: 'memory',
                preparedContext,
                fromTurn,
                toTurn,
                lorebookName,
                dialogId: DIALOG_REVIEW,
              }),
            lorebookName,
          )
          bumpTaskProgress(host, done, tasks.length)
          pendingCreates.push({
            body: {
              title: reviewed.title,
              content: reviewed.content,
              keys: entryKeys(reviewed.keywords),
              triggerMode: settings.defaultEntryTriggerMode,
              priority: 100,
            },
          })
          ranMemory = true
          wroteToLorebook = true
        } else if (task.kind === 'sidecar') {
          const sc = task.sidecar
          const sidecarDraft = await generateReviewDraft(host, settings, {
            kind: 'sidecar',
            preparedContext,
            fromTurn,
            toTurn,
            sc,
            lorebookName,
            dialogId: DIALOG_REVIEW_SIDECAR,
          })
          const reviewed = await promptReview(
            host,
            sidecarDraft,
            DIALOG_REVIEW_SIDECAR,
            (h) =>
              generateReviewDraft(h, settings, {
                kind: 'sidecar',
                preparedContext,
                fromTurn,
                toTurn,
                sc,
                lorebookName,
                dialogId: DIALOG_REVIEW_SIDECAR,
              }),
            lorebookName,
          )
          bumpTaskProgress(host, done, tasks.length)
          await writeSidecarEntry(
            host,
            settings,
            sidecarEntryIds,
            sc,
            reviewed,
            entryKeys(reviewed.keywords),
            pendingCreates,
          )
          wroteToLorebook = true
        }
        completedTasks += 1
      } catch (e) {
        if (isAbortError(e)) {
          aborted = true
          host.ui.notify(host.t(k(host, 'notifyProgressAborted')), undefined, { level: 'info' })
          break
        }
        if (e instanceof Error && e.message === 'review_skipped') {
          skippedTasks += 1
          host.ui.notify(host.t(k(host, 'notifyReviewSkipped')), undefined, { level: 'info' })
          done += 1
          bumpTaskProgress(host, done, tasks.length)
          continue
        }
        if (e instanceof Error && e.message === 'review_aborted') {
          aborted = true
          host.ui.notify(host.t(k(host, 'notifyReviewAborted')), undefined, { level: 'info' })
          break
        }
        console.warn('[plot-summary] task failed', task, e)
        if (isPipelineFatalError(e)) {
          preflightNotify(host, e)
          aborted = true
          break
        }
        const parseFailed = isParseFailedError(e)
        if (!parseFailed) {
          preflightNotify(host, e)
        }
        skippedTasks += 1
        if (!parseFailed) {
          host.ui.notify(host.t(k(host, 'notifyTaskSkipped')), undefined, { level: 'warning' })
        }
        done += 1
        bumpTaskProgress(host, done, tasks.length)
        continue
      }
      done += 1
      bumpTaskProgress(host, done, tasks.length)
    }

    if (pendingCreates.length > 0) {
      await flushPendingLorebookCreates(
        host,
        settings.targetLorebookId,
        pendingCreates,
        sidecarEntryIds,
      )
    }

    if (completedTasks === 0) {
      if (skippedTasks > 0) {
        notifyOutcome(host, 'notifySummarizeSummary', aborted ? 'warning' : 'info', {
            done: 0,
            skipped: skippedTasks,
            total: tasks.length,
          })
      }
      return {
        ok: false,
        reason: skippedTasks >= tasks.length ? 'all_skipped' : 'error',
        skipped: skippedTasks,
        aborted,
      }
    }

    if (
      settings.entrySortMode === 'auto-turn-suffix' &&
      wroteToLorebook
    ) {
      await applyPlotSummaryEntrySort(
        host,
        settings.targetLorebookId,
        sidecarEntryIds,
        sidecarConfigIds,
      )
    }

    if (ranMemory && opts.updatePointers !== false) {
      const last = Math.max(
        typeof settings.lastSummarizedEnd === 'number' ? settings.lastSummarizedEnd : -1,
        toTurn,
      )
      patch.lastSummarizedEnd = last
      patch.nextBlockStart = Math.max(settings.nextBlockStart ?? 0, last + 1)
    }

    if (JSON.stringify(sidecarEntryIds) !== JSON.stringify(persistedSidecarEntryIds)) {
      patch.sidecarEntryIds =
        Object.keys(sidecarEntryIds).length > 0 ? sidecarEntryIds : null
    }

    if (Object.keys(patch).length > 0) {
      await host.conversation.patchPluginSettings(patch)
    }

    if (opts.updateAutoSummarizeCache) {
      refreshAutoSummarizeUi(host)
    }

    if (completedTasks === tasks.length && skippedTasks === 0) {
      notifyOutcome(host, 'notifySummarizeDone', 'success')
    } else if (completedTasks > 0 || skippedTasks > 0) {
      notifyOutcome(host, 'notifySummarizeSummary', aborted ? 'warning' : 'info', {
          done: completedTasks,
          skipped: skippedTasks,
          total: tasks.length,
        })
    }
    return {
      ok: completedTasks === tasks.length && skippedTasks === 0,
      partial: completedTasks > 0 && completedTasks < tasks.length,
      skipped: skippedTasks,
      aborted,
    }
  } catch (e) {
    if (isAbortError(e)) {
      return { ok: false, reason: 'aborted', aborted: true }
    }
    console.warn('[plot-summary] summarize failed', e)
    preflightNotify(host, e)
    return { ok: false, reason: 'error' }
  } finally {
    setSummarizeBatchProgress(null)
    setSummarizeRunning(false)
    host.refreshSlotButtons()
    setPluginHold(host, false)
    host.ui.clearProgress()
  }
}
