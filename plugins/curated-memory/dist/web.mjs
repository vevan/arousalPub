const PLUGIN_ID = 'curated-memory'

const BATCH_MAX = 50

const DIALOG_SESSION = 'session'

const DIALOG_MANUAL = 'manual'

const DIALOG_ENABLE = 'enable'

const DIALOG_REVIEW = 'review'

const DIALOG_REVIEW_SIDECAR = 'review-sidecar'

const DIALOG_PICK_LOREBOOK = 'pick-lorebook'



function resolveDefaultSystemPrompt(host) {

  const key = k(host, 'systemPromptTemplateDefault')

  const text = host.t(key)

  return text && text !== key ? text : ''

}



function resolveDefaultSidecarPrompt(host) {

  const key = k(host, 'sidecarSystemPromptTemplateDefault')

  const text = host.t(key)

  return text && text !== key ? text : ''

}



let summarizeRunning = false

let memorybookEnabledCache = false

/** @type {{ resolve: (v: object) => void, reject: (e: Error) => void } | null} */
let reviewResolver = null

/** @type {{ resolve: (v: string) => void, reject: (e: Error) => void } | null} */
let lorebookPickResolver = null



function k(host, key) {

  return host.pluginKey(key)

}



function isPersistBusy(host) {

  return (

    host.session.conversationWriteLocked ||

    host.session.loading ||

    host.session.regeneratingTurnOrdinal !== null

  )

}



function isBusy(host) {

  return isPersistBusy(host) || summarizeRunning

}



function setPluginHold(host, hold) {

  if (typeof host.conversation.setPluginHold === 'function') {

    host.conversation.setPluginHold(hold)

  }

}



function scheduleWhenConversationIdle(host, fn) {

  const attempt = () => {

    if (summarizeRunning || isPersistBusy(host)) {

      setTimeout(attempt, 40)

      return

    }

    void fn()

  }

  setTimeout(attempt, 0)

}



function firstAutoTriggerTurnOrdinal(settings) {

  const start = settings.nextBlockStart ?? 0

  return blockEndFromStart(start, settings.blockTurns) + settings.bufferTurns

}



function parseAutoSidecarIdsRaw(raw, sidecars) {

  const configured = new Set(sidecars.map((s) => s.id))

  if (Array.isArray(raw)) {

    return raw

      .filter((x) => typeof x === 'string' && configured.has(x.trim()))

      .map((x) => x.trim())

  }

  return sidecars.map((s) => s.id)

}



function sidecarIdsFromTaskSelection(selected) {

  const sel = Array.isArray(selected) ? selected : []

  return sel

    .filter((x) => typeof x === 'string' && x.startsWith('sidecar:'))

    .map((x) => x.slice('sidecar:'.length))

}



function resolveAutoTasks(settings) {

  const tasks = [{ kind: 'memory' }]

  const allowed = new Set(parseAutoSidecarIdsRaw(settings.autoSidecarIds, settings.sidecars))

  for (const sc of settings.sidecars) {

    if (allowed.has(sc.id)) {

      tasks.push({ kind: 'sidecar', sidecar: sc })

    }

  }

  return tasks

}



function buildEnableTaskOptions(host, settings) {

  const options = [

    {

      value: 'memory',

      label: host.t(k(host, 'manualTaskMemory')),

      locked: true,

    },

  ]

  for (const sc of settings.sidecars) {

    options.push({

      value: `sidecar:${sc.id}`,

      label: sc.name,

    })

  }

  return options

}



function resolveEnableTasks(settings, model) {

  const tasks = [{ kind: 'memory' }]

  const sel = Array.isArray(model.selectedTasks) ? model.selectedTasks : []

  for (const sc of settings.sidecars) {

    if (sel.includes(`sidecar:${sc.id}`)) {

      tasks.push({ kind: 'sidecar', sidecar: sc })

    }

  }

  return tasks

}



function asString(v) {

  return typeof v === 'string' ? v.trim() : ''

}



function asInt(v, fallback, max = 500) {

  const n = typeof v === 'number' ? v : Number(v)

  if (!Number.isFinite(n)) return fallback

  return Math.max(0, Math.min(max, Math.round(n)))

}



function asBool(v, fallback) {

  return typeof v === 'boolean' ? v : fallback

}



function maxTurnOrdinal(host) {

  const ordinals = host.session.turns ?? []

  let maxOrd = -1

  for (const t of ordinals) {

    if (typeof t.turnOrdinal === 'number' && t.turnOrdinal > maxOrd) {

      maxOrd = t.turnOrdinal

    }

  }

  return maxOrd

}



function parseSidecars(raw) {

  let arr = raw

  if (typeof raw === 'string') {

    const s = raw.trim()

    if (!s) return []

    try {

      arr = JSON.parse(s)

    } catch {

      return []

    }

  }

  if (!Array.isArray(arr)) return []

  const out = []

  for (const item of arr) {

    if (!item || typeof item !== 'object') continue

    const name = asString(item.name)

    if (!name) continue

    const id =

      asString(item.id) ||

      name

        .toLowerCase()

        .replace(/[^\w\u4e00-\u9fff-]+/g, '-')

        .replace(/^-+|-+$/g, '') ||

      `sidecar-${out.length}`

    const triggerMode = asString(item.triggerMode)

    const priorityRaw =

      typeof item.priority === 'number'

        ? Math.round(item.priority)

        : Number(item.priority)

    out.push({

      id,

      name,

      enabled: item.enabled !== false,

      systemPromptTemplate: asString(item.systemPromptTemplate),

      priority:

        Number.isFinite(priorityRaw) && priorityRaw >= 0

          ? Math.min(200, priorityRaw)

          : 90,

      triggerMode:

        triggerMode === 'keyword' ||

        triggerMode === 'vector' ||

        triggerMode === 'constant'

          ? triggerMode

          : 'constant',

    })

  }

  return out

}



function effectiveSidecars(global, conv) {

  if (conv.sidecarEnabled === false) return []

  if (!asBool(global.sidecarEnabled, false)) return []

  return parseSidecars(global.sidecars).filter((s) => s.enabled)

}



function isLorebookEntryMissingError(e) {

  if (!e || typeof e !== 'object') return false

  const code = typeof e.code === 'string' ? e.code : ''

  const status = typeof e.status === 'number' ? e.status : 0

  return (

    code === 'lorebook_entry_not_found' ||

    code === 'lorebook_not_found' ||

    (code === 'lorebook_entry_patch_failed' && status === 404)

  )

}



/** 清理无效 sidecar 映射：未配置的 sidecar、条目已删除 */

async function normalizeSidecarEntryIds(host, lorebookId, sidecarEntryIds, sidecars) {

  const configured = new Set(sidecars.map((s) => s.id))

  const out = {}

  for (const [key, rawId] of Object.entries(sidecarEntryIds ?? {})) {

    if (!configured.has(key)) continue

    const id = asString(rawId)

    if (id) out[key] = id

  }

  if (sidecars.length === 0) return out



  let lb

  try {

    lb = await host.lorebook.get(lorebookId)

  } catch {

    return out

  }

  const existing = new Set((lb.entries ?? []).map((e) => e.id))

  for (const sc of sidecars) {

    const id = asString(out[sc.id])

    if (id && !existing.has(id)) {

      delete out[sc.id]

    }

  }

  return out

}



async function loadMergedSettings(host) {

  const global = await host.plugins.getUserSettings()

  const conv = await host.conversation.getPluginSettings()

  const blockTurns = asInt(

    conv.blockTurns ?? conv.triggerEveryNTurns ?? global.triggerEveryNTurns,

    4,

    500,

  )

  const bufferTurns = asInt(conv.bufferTurns ?? global.bufferTurns, 5, 500)

  const titleFormat =

    asString(conv.titleFormat) ||

    asString(global.titleFormat) ||

    'range-suffix'

  const targetLorebookId =

    asString(conv.targetLorebookId) ||

    asString(global.defaultTargetLorebookId)

  const apiConfigId = asString(global.apiConfigId)

  const defaultEntryTriggerMode =

    asString(global.defaultEntryTriggerMode) || 'vector'

  const sidecarEntryIds =

    conv.sidecarEntryIds && typeof conv.sidecarEntryIds === 'object'

      ? { ...conv.sidecarEntryIds }

      : {}

  const sidecars = effectiveSidecars(global, conv)

  return {

    global,

    conv,

    apiConfigId,

    targetLorebookId,

    blockTurns,

    bufferTurns,

    titleFormat,

    defaultEntryTriggerMode,

    systemPromptTemplate:

      asString(global.systemPromptTemplate) || resolveDefaultSystemPrompt(host),

    memorybookEnabled: conv.memorybookEnabled === true,

    nextBlockStart:

      typeof conv.nextBlockStart === 'number'

        ? Math.max(0, Math.round(conv.nextBlockStart))

        : 0,

    lastSummarizedEnd:

      typeof conv.lastSummarizedEnd === 'number'

        ? conv.lastSummarizedEnd

        : typeof conv.lastTriggeredTurnOrdinal === 'number'

          ? conv.lastTriggeredTurnOrdinal

          : undefined,

    sidecarEntryIds,

    sidecars,

    autoSidecarIds: parseAutoSidecarIdsRaw(conv.autoSidecarIds, sidecars),

    memorybookDefaultEnabled: asBool(global.memorybookDefaultEnabled, false),

  }

}



function blockEndFromStart(start, blockTurns) {

  return start + blockTurns - 1

}



function shouldAutoTrigger(turnOrdinal, settings) {

  if (!settings.memorybookEnabled) return false

  const start = settings.nextBlockStart ?? 0

  const end = blockEndFromStart(start, settings.blockTurns)

  return turnOrdinal >= end + settings.bufferTurns

}



function currentAutoRange(settings) {

  const start = settings.nextBlockStart ?? 0

  return { fromTurn: start, toTurn: blockEndFromStart(start, settings.blockTurns) }

}



function formatTranscript(turns, userName, assistantName) {

  const lines = []

  for (const t of turns) {

    lines.push(`${userName}: ${t.user}`)

    const idx = Math.min(

      Math.max(0, t.activeReceiveIndex ?? 0),

      Math.max(0, (t.receives?.length ?? 1) - 1),

    )

    const r = t.receives?.[idx]

    if (r?.content?.trim()) {

      lines.push(`${assistantName}: ${r.content.trim()}`)

    }

  }

  return lines.join('\n')

}



function parseModelJson(text) {

  let raw = (text ?? '').trim()

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)

  if (fence) raw = fence[1].trim()

  try {

    return JSON.parse(raw)

  } catch {

    const m = raw.match(/\{[\s\S]*\}/)

    if (m) return JSON.parse(m[0])

    throw new Error('parse_failed')

  }

}



function normalizeSummaryPayload(obj) {

  if (!obj || typeof obj !== 'object') throw new Error('parse_failed')

  const title = asString(obj.title)

  const content = typeof obj.content === 'string' ? obj.content : ''

  if (!title || !content.trim()) throw new Error('parse_failed')

  let keywords = []

  if (Array.isArray(obj.keywords)) {

    keywords = obj.keywords

      .filter((x) => typeof x === 'string')

      .map((x) => x.trim())

      .filter(Boolean)

  }

  return { title, content: content.trim(), keywords }

}



function formatEntryTitle(rawTitle, titleFormat, startTurn, endTurn) {

  const base = rawTitle.trim()

  if (titleFormat !== 'range-suffix') return base

  const suffix = `-${startTurn}-${endTurn}`

  if (/-\d+-\d+$/.test(base)) {

    return base.replace(/-\d+-\d+$/, suffix)

  }

  return `${base}${suffix}`

}



function entryKeys(keywords) {

  if (!Array.isArray(keywords)) return []

  return keywords

      .filter((x) => typeof x === 'string')

      .map((x) => x.trim())

      .filter(Boolean)

}



function keywordsToText(keywords) {

  if (!Array.isArray(keywords)) return ''

  return keywords.filter((x) => typeof x === 'string').join(', ')

}



function parseKeywordsText(text) {

  if (typeof text !== 'string') return []

  return text

      .split(/[,，、;；\n]/)

      .map((x) => x.trim())

      .filter(Boolean)

}



async function readTurnRange(host, from, to) {

  const turns = []

  await host.conversation.runScope(

    { writeLock: false, requireIdle: false },

    async (ctx) => {

      for (let start = from; start <= to; start += BATCH_MAX) {

        const end = Math.min(start + BATCH_MAX - 1, to)

        const batch = await ctx.read({ range: { from: start, to: end } })

        turns.push(...batch)

      }

    },

  )

  return turns.sort((a, b) => a.turnOrdinal - b.turnOrdinal)

}



async function buildPreviousMemoriesBlock(host, lorebookId) {

  try {

    const lb = await host.lorebook.get(lorebookId)

    const titles = (lb.entries ?? [])

      .slice(-8)

      .map((e) => e.title?.trim())

      .filter(Boolean)

    if (titles.length === 0) return ''

    return `<previous-memories readonly>\n${titles.map((t) => `- ${t}`).join('\n')}\n</previous-memories>\n\n`

  } catch {

    return ''

  }

}



async function expandPromptText(host, text, apiConfigId) {

  const raw = asString(text)

  if (!raw.includes('{{')) return raw

  return host.macros.expand(raw, { apiConfigId })

}



async function assertPreflight(host, apiConfigId, system, userContent) {

  const pf = await host.token.preflightComplete({

    apiConfigId,

    messages: [

      { role: 'system', content: system },

      { role: 'user', content: userContent },

    ],

  })

  if (pf.ok) return pf

  if (pf.code === 'context_exceeded') {

    const err = new Error('context_exceeded')

    err.promptTokens = pf.promptTokens

    err.budget = pf.budget

    throw err

  }

  if (pf.code === 'context_length_unconfigured') {

    throw new Error('context_length_unconfigured')

  }

  throw new Error('preflight_failed')

}



async function callComplete(host, apiConfigId, system, userContent) {

  const [expandedSystem, expandedUser] = await Promise.all([

    expandPromptText(host, system, apiConfigId),

    expandPromptText(host, userContent, apiConfigId),

  ])

  await assertPreflight(host, apiConfigId, expandedSystem, expandedUser)

  const result = await host.plugin.complete({

    apiConfigId,

    messages: [

      { role: 'system', content: expandedSystem },

      { role: 'user', content: expandedUser },

    ],

    stream: false,

    responseFormat: 'json_object',

  })

  return parseModelJson(result.content)

}



function preflightToast(host, e) {

  if (e instanceof Error && e.message === 'context_exceeded') {

    host.ui.toast(

      host.t(k(host, 'toastContextExceeded'), {

        used: e.promptTokens,

        budget: e.budget,

      }),

      { color: 'warning' },

    )

    return

  }

  if (e instanceof Error && e.message === 'context_length_unconfigured') {

    host.ui.toast(host.t(k(host, 'toastContextLengthMissing')), { color: 'warning' })

    return

  }

  if (isLorebookEntryMissingError(e)) {

    host.ui.toast(host.t(k(host, 'toastSidecarEntryMissing')), { color: 'warning' })

    return

  }

  if (e instanceof Error && e.message === 'parse_failed') {

    host.ui.toast(host.t(k(host, 'toastParseFailed')), { color: 'error' })

    return

  }

  host.ui.toast(host.t(k(host, 'toastSummarizeFailed')), { color: 'error' })

}



async function writeSidecarEntry(host, settings, sidecarEntryIds, sc, reviewed, sidecarKeys) {

  const body = {

    title: sc.name,

    content: reviewed.content,

    keys: sidecarKeys,

    triggerMode: sc.triggerMode || 'constant',

    priority: typeof sc.priority === 'number' ? sc.priority : 90,

  }

  let entryId = asString(sidecarEntryIds[sc.id])

  if (entryId) {

    try {

      await host.lorebook.patchEntry(settings.targetLorebookId, entryId, body)

      return entryId

    } catch (e) {

      if (!isLorebookEntryMissingError(e)) throw e

      delete sidecarEntryIds[sc.id]

      entryId = ''

    }

  }

  const created = await host.lorebook.createEntry(settings.targetLorebookId, body)

  sidecarEntryIds[sc.id] = created.id

  return created.id

}



function registerReviewDialog(host) {

  host.registerFormDialog(

    PLUGIN_ID,

    {

      titleKey: k(host, 'reviewDialogTitle'),

      bodyKey: k(host, 'reviewDialogBody'),

      fields: [

        {

          key: 'title',

          labelKey: k(host, 'reviewTitleLabel'),

          type: 'text',

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

      cancelKey: k(host, 'reviewCancel'),

      canSubmit: (m) =>

        asString(m.title).length > 0 && asString(m.content).length > 0,

      onSubmit: async (_h, model) => {

        if (!reviewResolver) return

        const resolver = reviewResolver

        reviewResolver = null

        resolver.resolve({

          title: asString(model.title),

          content: asString(model.content),

          keywords: parseKeywordsText(model.keywordsText),

        })

      },

      onCancel: () => {

        if (!reviewResolver) return

        const resolver = reviewResolver

        reviewResolver = null

        resolver.reject(new Error('review_cancelled'))

      },

    },

    DIALOG_REVIEW,

  )

}



function promptReviewEntry(host, draft) {

  return new Promise((resolve, reject) => {

    reviewResolver = { resolve, reject }

    host.openFormDialog(

      PLUGIN_ID,

      {

        title: draft.title,

        content: draft.content,

        keywordsText: keywordsToText(draft.keywords),

      },

      DIALOG_REVIEW,

    )

  })

}



function registerReviewSidecarDialog(host) {

  host.registerFormDialog(

    PLUGIN_ID,

    {

      titleKey: k(host, 'reviewDialogTitle'),

      bodyKey: k(host, 'reviewDialogBodySidecar'),

      fields: [

        {

          key: 'title',

          labelKey: k(host, 'reviewTitleLabel'),

          type: 'text',

          readOnly: true,

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

      cancelKey: k(host, 'reviewCancel'),

      canSubmit: (m) => asString(m.content).length > 0,

      onSubmit: async (_h, model) => {

        if (!reviewResolver) return

        const resolver = reviewResolver

        reviewResolver = null

        resolver.resolve({

          title: asString(model.title),

          content: asString(model.content),

          keywords: parseKeywordsText(model.keywordsText),

        })

      },

      onCancel: () => {

        if (!reviewResolver) return

        const resolver = reviewResolver

        reviewResolver = null

        resolver.reject(new Error('review_cancelled'))

      },

    },

    DIALOG_REVIEW_SIDECAR,

  )

}



function promptReviewSidecarEntry(host, draft) {

  return new Promise((resolve, reject) => {

    reviewResolver = { resolve, reject }

    host.openFormDialog(

      PLUGIN_ID,

      {

        title: draft.title,

        content: draft.content,

        keywordsText: keywordsToText(draft.keywords),

      },

      DIALOG_REVIEW_SIDECAR,

    )

  })

}



function sidecarPromptTemplate(host, sc) {

  const custom = asString(sc.systemPromptTemplate)

  return custom || resolveDefaultSidecarPrompt(host)

}



async function runSummarizeTasks(host, opts) {

  if (summarizeRunning) {

    host.ui.toast(host.t(k(host, 'toastBusy')), { color: 'info' })

    return { ok: false, reason: 'busy' }

  }

  const tasks = opts.tasks ?? []

  if (tasks.length === 0) {

    host.ui.toast(host.t(k(host, 'toastNoTasksSelected')), { color: 'warning' })

    return { ok: false, reason: 'no_tasks' }

  }



  summarizeRunning = true

  setPluginHold(host, true)

  host.ui.progress({

    message: host.t(k(host, 'progressSummarize')),

    done: 0,

    total: tasks.length,

  })



  let completedTasks = 0



  try {

    const settings = await loadMergedSettings(host)

    if (!settings.apiConfigId) {

      host.ui.toast(host.t(k(host, 'toastNoApiConfig')), { color: 'warning' })

      return { ok: false, reason: 'no_api' }

    }

    const targetId = await ensureTargetLorebook(host, settings)

    if (!targetId) {

      return { ok: false, reason: 'no_lorebook' }

    }

    settings.targetLorebookId = targetId



    const fromTurn = opts.fromTurn

    const toTurn = opts.toTurn

    if (fromTurn > toTurn) {

      host.ui.toast(host.t(k(host, 'toastInvalidRange')), { color: 'warning' })

      return { ok: false, reason: 'invalid_range' }

    }



    const meta = await host.conversation.getMeta()

    const turns = await readTurnRange(host, fromTurn, toTurn)

    if (turns.length === 0) {

      host.ui.toast(host.t(k(host, 'toastNoTurnsInRange')), { color: 'warning' })

      return { ok: false, reason: 'no_turns' }

    }



    const transcript = formatTranscript(

      turns,

      meta.userDisplayName,

      meta.assistantDisplayName,

    )

    const prevBlock = await buildPreviousMemoriesBlock(

      host,

      settings.targetLorebookId,

    )

    const userContent = `${prevBlock}<history>\n${transcript}\n</history>`



    let sidecarEntryIds = await normalizeSidecarEntryIds(

      host,

      settings.targetLorebookId,

      settings.sidecarEntryIds,

      settings.sidecars,

    )

    const sidecarIdsChanged =

      JSON.stringify(sidecarEntryIds) !== JSON.stringify(settings.sidecarEntryIds)



    const patch = {}

    let done = 0

    let ranMemory = false



    for (const task of tasks) {

      try {

        if (task.kind === 'memory') {

          const summaryRaw = await callComplete(

            host,

            settings.apiConfigId,

            settings.systemPromptTemplate,

            userContent,

          )

          const summary = normalizeSummaryPayload(summaryRaw)

          const entryTitle = formatEntryTitle(

            summary.title,

            settings.titleFormat,

            fromTurn,

            toTurn,

          )

          host.ui.clearProgress()

          let reviewed

          try {

            reviewed = await promptReviewEntry(host, {

              title: entryTitle,

              content: summary.content,

              keywords: summary.keywords,

            })

          } catch (e) {

            if (e instanceof Error && e.message === 'review_cancelled') {

              host.ui.toast(host.t(k(host, 'toastReviewCancelled')), {

                color: 'info',

              })

              break

            }

            throw e

          }

          host.ui.progress({

            message: host.t(k(host, 'progressSummarize')),

            done,

            total: tasks.length,

          })

          await host.lorebook.createEntry(settings.targetLorebookId, {

            title: reviewed.title,

            content: reviewed.content,

            keys: entryKeys(reviewed.keywords),

            triggerMode: settings.defaultEntryTriggerMode,

            priority: 100,

          })

          ranMemory = true

        } else if (task.kind === 'sidecar') {

          const sc = task.sidecar

          const sidecarRaw = await callComplete(

            host,

            settings.apiConfigId,

            sidecarPromptTemplate(host, sc),

            userContent,

          )

          const sidecar = normalizeSummaryPayload({

            title: sc.name,

            content: sidecarRaw.content ?? sidecarRaw.title,

            keywords: sidecarRaw.keywords,

          })

          host.ui.clearProgress()

          let reviewed

          try {

            reviewed = await promptReviewSidecarEntry(host, {

              title: sc.name,

              content: sidecar.content,

              keywords: sidecar.keywords,

            })

          } catch (e) {

            if (e instanceof Error && e.message === 'review_cancelled') {

              host.ui.toast(host.t(k(host, 'toastReviewCancelled')), {

                color: 'info',

              })

              break

            }

            throw e

          }

          host.ui.progress({

            message: host.t(k(host, 'progressSummarize')),

            done,

            total: tasks.length,

          })

          await writeSidecarEntry(

            host,

            settings,

            sidecarEntryIds,

            sc,

            reviewed,

            entryKeys(reviewed.keywords),

          )

        }

        completedTasks += 1

      } catch (e) {

        console.warn('[curated-memory] task failed', task, e)

        preflightToast(host, e)

        if (completedTasks > 0) {

          host.ui.toast(

            host.t(k(host, 'toastSummarizePartial'), {

              done: completedTasks,

              total: tasks.length,

            }),

            { color: 'warning' },

          )

        }

        break

      }

      done += 1

      host.ui.progress({

        message: host.t(k(host, 'progressSummarize')),

        done,

        total: tasks.length,

      })

    }



    if (completedTasks === 0) {

      return { ok: false, reason: 'error' }

    }



    if (ranMemory && opts.updatePointers !== false) {

      const last = Math.max(

        typeof settings.lastSummarizedEnd === 'number'

          ? settings.lastSummarizedEnd

          : -1,

        toTurn,

      )

      patch.lastSummarizedEnd = last

      patch.nextBlockStart = Math.max(settings.nextBlockStart ?? 0, last + 1)

    }



    if (sidecarIdsChanged) {

      patch.sidecarEntryIds =

        Object.keys(sidecarEntryIds).length > 0 ? sidecarEntryIds : null

    }



    if (Object.keys(patch).length > 0) {

      await host.conversation.patchPluginSettings(patch)

    }



    if (opts.updateMemorybookCache) {

      await refreshMemorybookState(host)

    }



    if (completedTasks === tasks.length) {

      host.ui.toast(host.t(k(host, 'toastSummarizeDone')), { color: 'success' })

    }

    return { ok: completedTasks === tasks.length, partial: completedTasks < tasks.length }

  } catch (e) {

    console.warn('[curated-memory] summarize failed', e)

    preflightToast(host, e)

    return { ok: false, reason: 'error' }

  } finally {

    summarizeRunning = false

    setPluginHold(host, false)

    host.ui.clearProgress()

  }

}



async function ensureTargetLorebook(host, settings) {

  const existing = asString(settings.targetLorebookId)

  if (existing) return existing

  host.ui.toast(host.t(k(host, 'toastTargetLorebookMissingWarn')), { color: 'warning' })

  try {

    return await promptPickLorebook(host)

  } catch {

    return ''

  }

}



function registerPickLorebookDialog(host) {

  host.registerFormDialog(

    PLUGIN_ID,

    {

      titleKey: k(host, 'pickLorebookDialogTitle'),

      bodyKey: k(host, 'pickLorebookDialogBody'),

      fields: [

        {

          key: 'targetLorebookId',

          labelKey: k(host, 'sessionTargetLorebookLabel'),

          type: 'lorebook',

        },

      ],

      submitKey: k(host, 'pickLorebookConfirm'),

      cancelKey: k(host, 'sessionCancel'),

      canSubmit: (m) => asString(m.targetLorebookId).length > 0,

      onSubmit: async (h, model) => {

        const id = asString(model.targetLorebookId)

        if (!id) return

        await h.conversation.patchPluginSettings({ targetLorebookId: id })

        if (lorebookPickResolver) {

          const resolver = lorebookPickResolver

          lorebookPickResolver = null

          resolver.resolve(id)

        }

      },

      onCancel: () => {

        if (!lorebookPickResolver) return

        const resolver = lorebookPickResolver

        lorebookPickResolver = null

        resolver.reject(new Error('pick_cancelled'))

      },

    },

    DIALOG_PICK_LOREBOOK,

  )

}



function promptPickLorebook(host) {

  return new Promise((resolve, reject) => {

    lorebookPickResolver = { resolve, reject }

    host.openFormDialog(PLUGIN_ID, { targetLorebookId: '' }, DIALOG_PICK_LOREBOOK)

  })

}



async function applyShortMemorybookEnable(host, settings) {

  const X = firstAutoTriggerTurnOrdinal({

    ...settings,

    nextBlockStart: 0,

  })

  const autoSidecarIds = parseAutoSidecarIdsRaw(null, settings.sidecars)

  await host.conversation.patchPluginSettings({

    memorybookEnabled: true,

    nextBlockStart: 0,

    autoSidecarIds,

  })

  await refreshMemorybookState(host)

  host.ui.toast(host.t(k(host, 'toastMemorybookScheduled'), { turn: X }), {

    color: 'success',

  })

}



async function tryBootstrapDefaultMemorybook(host, event) {

  if (!event.isFirstTurn) return

  const conv = await host.conversation.getPluginSettings()

  if (conv.memorybookEnabled === true || conv.memorybookEnabled === false) return

  const global = await host.plugins.getUserSettings()

  if (!asBool(global.memorybookDefaultEnabled, false)) return

  const settings = await loadMergedSettings(host)

  await applyShortMemorybookEnable(host, settings)

}



async function handleAutoSummarizeTurn(host, turnOrdinal) {

  const settings = await loadMergedSettings(host)

  if (!settings.memorybookEnabled) return

  if (!settings.apiConfigId) return

  if (!shouldAutoTrigger(turnOrdinal, settings)) return

  const range = currentAutoRange(settings)

  const tasks = resolveAutoTasks(settings)

  await runSummarizeTasks(host, {

    fromTurn: range.fromTurn,

    toTurn: range.toTurn,

    tasks,

    updatePointers: true,

    updateMemorybookCache: false,

  })

}



async function refreshMemorybookState(host) {

  try {

    const conv = await host.conversation.getPluginSettings()

    memorybookEnabledCache = conv.memorybookEnabled === true

  } catch {

    memorybookEnabledCache = false

  }

  host.refreshSlotButtons()

}



function buildManualTaskOptions(host, settings) {

  const options = [

    {

      value: 'memory',

      label: host.t(k(host, 'manualTaskMemory')),

    },

  ]

  for (const sc of settings.sidecars) {

    options.push({

      value: `sidecar:${sc.id}`,

      label: sc.name,

    })

  }

  return options

}



function resolveManualTasks(settings, model) {

  return tasksFromSelection(settings, model.selectedTasks)

}



function tasksFromSelection(settings, selected) {

  const sel = Array.isArray(selected) ? selected : []

  const tasks = []

  if (sel.includes('memory')) {

    tasks.push({ kind: 'memory' })

  }

  for (const sc of settings.sidecars) {

    if (sel.includes(`sidecar:${sc.id}`)) {

      tasks.push({ kind: 'sidecar', sidecar: sc })

    }

  }

  return tasks

}



function buildAutoSidecarTaskOptions(settings) {

  return settings.sidecars.map((sc) => ({

    value: `sidecar:${sc.id}`,

    label: sc.name,

  }))

}



function registerSessionDialog(host, settings) {

  const fields = [

    {

      key: 'targetLorebookId',

      labelKey: k(host, 'sessionTargetLorebookLabel'),

      type: 'lorebook',

      hintKey: k(host, 'sessionTargetLorebookHint'),

    },

    {

      key: 'blockTurns',

      labelKey: k(host, 'sessionBlockTurnsLabel'),

      type: 'integer',

    },

    {

      key: 'bufferTurns',

      labelKey: k(host, 'sessionBufferTurnsLabel'),

      type: 'integer',

    },

    {

      key: 'sidecarEnabled',

      labelKey: k(host, 'sessionSidecarEnabledLabel'),

      type: 'radio',

      options: [

        { value: 'inherit', labelKey: k(host, 'sessionSidecarInherit') },

        { value: 'on', labelKey: k(host, 'sessionSidecarOn') },

        { value: 'off', labelKey: k(host, 'sessionSidecarOff') },

      ],

    },

  ]

  if (settings.sidecars.length > 0) {

    fields.push({

      key: 'autoSidecarTasks',

      labelKey: k(host, 'sessionAutoSidecarsLabel'),

      type: 'checkboxGroup',

      options: buildAutoSidecarTaskOptions(settings),

      hintKey: k(host, 'sessionAutoSidecarsHint'),

    })

  }

  host.registerFormDialog(

    PLUGIN_ID,

    {

      titleKey: k(host, 'sessionDialogTitle'),

      fields,

      submitKey: k(host, 'sessionSubmit'),

      cancelKey: k(host, 'sessionCancel'),

      canSubmit: () => true,

      onSubmit: async (h, model) => {

        const patch = {

          targetLorebookId: asString(model.targetLorebookId),

          blockTurns: asInt(model.blockTurns, 4, 500),

          bufferTurns: asInt(model.bufferTurns, 5, 500),

        }

        if (!patch.targetLorebookId) patch.targetLorebookId = null

        const se = asString(model.sidecarEnabled)

        if (se === 'on') patch.sidecarEnabled = true

        else if (se === 'off') patch.sidecarEnabled = false

        else patch.sidecarEnabled = null

        if (settings.sidecars.length > 0) {

          patch.autoSidecarIds = sidecarIdsFromTaskSelection(model.autoSidecarTasks)

        }

        await h.conversation.patchPluginSettings(patch)

        h.ui.toast(h.t(k(h, 'sessionSubmit')), { color: 'success' })

      },

    },

    DIALOG_SESSION,

  )

}



function registerEnableDialog(host, settings) {

  const fields = [

    {

      key: 'startTurn',

      labelKey: k(host, 'manualStartTurnLabel'),

      type: 'integer',

      readOnly: true,

    },

    {

      key: 'endTurn',

      labelKey: k(host, 'manualEndTurnLabel'),

      type: 'integer',

      readOnly: true,

    },

  ]

  if (settings.sidecars.length > 0) {

    fields.push({

      key: 'selectedTasks',

      labelKey: k(host, 'manualTasksLabel'),

      type: 'checkboxGroup',

      options: buildEnableTaskOptions(host, settings),

      hintKey: k(host, 'enableTasksHint'),

    })

  }

  host.registerFormDialog(

    PLUGIN_ID,

    {

      titleKey: k(host, 'enableDialogTitle'),

      bodyKey: k(host, 'enableDialogBody'),

      fields,

      submitKey: k(host, 'enableSubmit'),

      cancelKey: k(host, 'sessionCancel'),

      canSubmit: (m) => {

        const start = asInt(m.startTurn, -1, 500_000)

        const end = asInt(m.endTurn, -1, 500_000)

        return start >= 0 && end >= start

      },

      onSubmit: async (h, model) => {

        const startTurn = asInt(model.startTurn, 0, 500_000)

        const endTurn = asInt(model.endTurn, startTurn, 500_000)

        const autoSidecarIds = sidecarIdsFromTaskSelection(model.selectedTasks)

        await h.conversation.patchPluginSettings({

          memorybookEnabled: true,

          nextBlockStart: startTurn,

          autoSidecarIds,

        })

        await refreshMemorybookState(h)

        const tasks = resolveEnableTasks(settings, model)

        await runSummarizeTasks(h, {

          fromTurn: startTurn,

          toTurn: endTurn,

          tasks,

          updatePointers: true,

          updateMemorybookCache: false,

        })

      },

    },

    DIALOG_ENABLE,

  )

}



function registerManualDialog(host, settings) {

  const fields = [

    {

      key: 'startTurn',

      labelKey: k(host, 'manualStartTurnLabel'),

      type: 'integer',

    },

    {

      key: 'endTurn',

      labelKey: k(host, 'manualEndTurnLabel'),

      type: 'integer',

    },

    {

      key: 'selectedTasks',

      labelKey: k(host, 'manualTasksLabel'),

      type: 'checkboxGroup',

      options: buildManualTaskOptions(host, settings),

      hintKey: k(host, 'manualTasksHint'),

    },

  ]



  host.registerFormDialog(

    PLUGIN_ID,

    {

      titleKey: k(host, 'manualDialogTitle'),

      bodyKey: k(host, 'manualDialogBody'),

      fields,

      submitKey: k(host, 'manualSubmit'),

      cancelKey: k(host, 'sessionCancel'),

      canSubmit: (m) => {

        const start = asInt(m.startTurn, -1, 500_000)

        const end = asInt(m.endTurn, -1, 500_000)

        const tasks = resolveManualTasks(settings, m)

        return start >= 0 && end >= start && tasks.length > 0

      },

      onSubmit: async (h, model) => {

        const fromTurn = asInt(model.startTurn, 0, 500_000)

        const toTurn = asInt(model.endTurn, fromTurn, 500_000)

        const tasks = resolveManualTasks(settings, model)

        if (tasks.length === 0) {

          h.ui.toast(h.t(k(h, 'toastNoTasksSelected')), { color: 'warning' })

          return

        }

        await runSummarizeTasks(h, {

          fromTurn,

          toTurn,

          tasks,

          updatePointers: tasks.some((t) => t.kind === 'memory'),

        })

      },

    },

    DIALOG_MANUAL,

  )

}



function openSessionSettings(host) {

  loadMergedSettings(host).then((s) => {

    registerSessionDialog(host, s)

    let sidecarEnabled = 'inherit'

    if (s.conv.sidecarEnabled === true) sidecarEnabled = 'on'

    if (s.conv.sidecarEnabled === false) sidecarEnabled = 'off'

    const model = {

      targetLorebookId: s.targetLorebookId,

      blockTurns: s.blockTurns,

      bufferTurns: s.bufferTurns,

      sidecarEnabled,

    }

    if (s.sidecars.length > 0) {

      model.autoSidecarTasks = s.autoSidecarIds.map((id) => `sidecar:${id}`)

    }

    host.openFormDialog(PLUGIN_ID, model, DIALOG_SESSION)

  })

}



function openManualSummarize(host) {

  loadMergedSettings(host).then((s) => {

    registerManualDialog(host, s)

    const maxOrd = Math.max(0, maxTurnOrdinal(host))

    const model = {

      startTurn: 0,

      endTurn: maxOrd,

      selectedTasks: ['memory'],

    }

    host.openFormDialog(PLUGIN_ID, model, DIALOG_MANUAL)

  })

}



function openEnableLongDialog(host, settings) {

  const T = maxTurnOrdinal(host)

  const N = settings.blockTurns

  const buffer = settings.bufferTurns

  const endTurn = T - buffer

  const startTurn = Math.max(0, endTurn - (N - 1))

  const selectedTasks = [

    'memory',

    ...settings.sidecars.map((sc) => `sidecar:${sc.id}`),

  ]

  registerEnableDialog(host, settings)

  host.openFormDialog(

    PLUGIN_ID,

    { startTurn, endTurn, selectedTasks },

    DIALOG_ENABLE,

  )

}



async function tryEnableMemorybook(host) {

  const settings = await loadMergedSettings(host)

  const T = maxTurnOrdinal(host)

  const N = settings.blockTurns

  const buffer = settings.bufferTurns



  if (T > N + buffer) {

    openEnableLongDialog(host, settings)

    return

  }



  await applyShortMemorybookEnable(host, settings)

}



async function toggleMemorybook(host) {

  if (memorybookEnabledCache) {

    await host.conversation.patchPluginSettings({ memorybookEnabled: false })

    await refreshMemorybookState(host)

    host.ui.toast(host.t(k(host, 'toastMemorybookDisabled')), { color: 'info' })

    return

  }

  await tryEnableMemorybook(host)

}



export function register(host) {

  registerReviewDialog(host)

  registerReviewSidecarDialog(host)

  registerPickLorebookDialog(host)

  void refreshMemorybookState(host)



  host.registerSlotButton('composer-toolbar', {

    id: `${PLUGIN_ID}-memorybook`,

    icon: 'mdi-book-open-page-variant',

    tooltipKey: k(host, 'tooltipMemorybook'),

    filled: () => memorybookEnabledCache,

    disabled: () => summarizeRunning,

    onClick: () => {

      void toggleMemorybook(host)

    },

  })



  host.registerSlotButton('composer-toolbar', {

    id: `${PLUGIN_ID}-manual`,

    icon: 'mdi-book-edit-outline',

    tooltipKey: k(host, 'tooltipManualSummarize'),

    disabled: () => isBusy(host) || summarizeRunning,

    onClick: () => openManualSummarize(host),

  })



  host.registerSlotButton('composer-toolbar', {

    id: `${PLUGIN_ID}-session`,

    icon: 'mdi-tune-variant',

    tooltipKey: k(host, 'tooltipSessionSettings'),

    onClick: () => openSessionSettings(host),

  })



  host.lifecycle.onAssistantReplyPersisted((event) => {

    const turnOrdinal = event.turnOrdinal

    if (typeof turnOrdinal !== 'number' || turnOrdinal < 0) return



    scheduleWhenConversationIdle(host, async () => {

      try {

        await tryBootstrapDefaultMemorybook(host, event)

        await handleAutoSummarizeTurn(host, turnOrdinal)

      } catch (e) {

        console.warn('[curated-memory] auto summarize failed', e)

      }

    })

  })

}


