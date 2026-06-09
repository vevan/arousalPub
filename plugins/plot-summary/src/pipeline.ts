import { DIALOG_REVIEW, DIALOG_REVIEW_SIDECAR } from './constants.js'
import { isAbortError, isPipelineFatalError, preflightToast } from './errors.js'
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
import {
  setSummarizeBatchProgress,
  setSummarizeRunning,
  summarizeRunning,
} from './state.js'
import { asString } from './shared/utils.js'
import type { PluginHost, SummarizeTask } from './types.js'
import {
  ensureTargetLorebook,
  promptRecoverLorebook,
  refreshAutoSummarizeUi,
} from './dialogs.js'
import { isLorebookNotFoundError } from './errors.js'

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
    host.ui.toast(host.t(k(host, 'toastBusy')), { color: 'info' })
    return { ok: false, reason: 'busy' }
  }
  const tasks = opts.tasks ?? []
  if (tasks.length === 0) {
    host.ui.toast(host.t(k(host, 'toastNoTasksSelected')), { color: 'warning' })
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
      host.ui.toast(host.t(k(host, 'toastInvalidRange')), { color: 'warning' })
      return { ok: false, reason: 'invalid_range' }
    }

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

    const sidecarConfigIds = settings.sidecars.map((s) => s.id)
    const prepared = await host.plugin.prepareContext({
      fromTurn,
      toTurn,
      targetLorebookId: settings.targetLorebookId,
      previousSummariesLimit: settings.previousSummariesLimit,
      sidecarEntryIds,
      sidecarIds: sidecarConfigIds,
    })
    if (!prepared.userContent?.trim()) {
      host.ui.toast(host.t(k(host, 'toastNoTurnsInRange')), { color: 'warning' })
      return { ok: false, reason: 'no_turns' }
    }
    const systemReferenceContext = prepared.systemReferenceContext ?? ''
    const userContent = prepared.userContent

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
            systemReferenceContext,
            userContent,
            fromTurn,
            toTurn,
          })
          const reviewed = await promptReview(
            host,
            memoryDraft,
            DIALOG_REVIEW,
            (h) =>
              generateReviewDraft(h, settings, {
                kind: 'memory',
                systemReferenceContext,
                userContent,
                fromTurn,
                toTurn,
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
            systemReferenceContext,
            userContent,
            sc,
          })
          const reviewed = await promptReview(
            host,
            sidecarDraft,
            DIALOG_REVIEW_SIDECAR,
            (h) =>
              generateReviewDraft(h, settings, {
                kind: 'sidecar',
                systemReferenceContext,
                userContent,
                sc,
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
          host.ui.toast(host.t(k(host, 'toastProgressAborted')), { color: 'info' })
          break
        }
        if (e instanceof Error && e.message === 'review_skipped') {
          skippedTasks += 1
          host.ui.toast(host.t(k(host, 'toastReviewSkipped')), { color: 'info' })
          done += 1
          bumpTaskProgress(host, done, tasks.length)
          continue
        }
        if (e instanceof Error && e.message === 'review_aborted') {
          aborted = true
          host.ui.toast(host.t(k(host, 'toastReviewAborted')), { color: 'info' })
          break
        }
        console.warn('[plot-summary] task failed', task, e)
        if (isPipelineFatalError(e)) {
          preflightToast(host, e)
          aborted = true
          break
        }
        preflightToast(host, e)
        skippedTasks += 1
        host.ui.toast(host.t(k(host, 'toastTaskSkipped')), { color: 'warning' })
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
        host.ui.toast(
          host.t(k(host, 'toastSummarizeSummary'), {
            done: 0,
            skipped: skippedTasks,
            total: tasks.length,
          }),
          { color: aborted ? 'warning' : 'info' },
        )
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

    if (JSON.stringify(sidecarEntryIds) !== JSON.stringify(settings.sidecarEntryIds)) {
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
      host.ui.toast(host.t(k(host, 'toastSummarizeDone')), { color: 'success' })
    } else if (completedTasks > 0 || skippedTasks > 0) {
      host.ui.toast(
        host.t(k(host, 'toastSummarizeSummary'), {
          done: completedTasks,
          skipped: skippedTasks,
          total: tasks.length,
        }),
        { color: aborted ? 'warning' : 'info' },
      )
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
    preflightToast(host, e)
    return { ok: false, reason: 'error' }
  } finally {
    setSummarizeBatchProgress(null)
    setSummarizeRunning(false)
    host.refreshSlotButtons()
    setPluginHold(host, false)
    host.ui.clearProgress()
  }
}
