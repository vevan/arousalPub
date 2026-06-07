// plugins/curated-memory/src/constants.ts
var PLUGIN_ID = "curated-memory";
var DIALOG_SESSION = "session";
var DIALOG_MANUAL = "manual";
var DIALOG_ENABLE = "enable";
var DIALOG_REVIEW = "review";
var DIALOG_REVIEW_SIDECAR = "review-sidecar";
var DIALOG_PICK_LOREBOOK = "pick-lorebook";

// plugins/curated-memory/src/shared/utils.ts
function asString(v) {
  return typeof v === "string" ? v.trim() : "";
}
function asInt(v, fallback, max = 500) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, Math.round(n)));
}
function asBool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}
function keywordsToText(keywords) {
  if (!Array.isArray(keywords)) return "";
  return keywords.filter((x) => typeof x === "string").join(", ");
}
function parseKeywordsText(text) {
  if (typeof text !== "string") return [];
  return text.split(/[,，、;；\n]/).map((x) => x.trim()).filter(Boolean);
}
function entryKeys(keywords) {
  if (!Array.isArray(keywords)) return [];
  return keywords.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

// plugins/curated-memory/src/settings.ts
function k(host, key) {
  return host.pluginKey(key);
}
function resolveDefaultSystemPrompt(host) {
  const key = k(host, "systemPromptTemplateDefault");
  const text = host.t(key);
  return text && text !== key ? text : "";
}
function resolveDefaultSidecarPrompt(host) {
  const key = k(host, "sidecarSystemPromptTemplateDefault");
  const text = host.t(key);
  return text && text !== key ? text : "";
}
function parseSidecars(raw) {
  let arr = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      arr = JSON.parse(s);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item;
    const name = asString(o.name);
    if (!name) continue;
    const id = asString(o.id) || name.toLowerCase().replace(/[^\w\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "") || `sidecar-${out.length}`;
    const triggerMode = asString(o.triggerMode);
    const priorityRaw = typeof o.priority === "number" ? Math.round(o.priority) : Number(o.priority);
    out.push({
      id,
      name,
      enabled: o.enabled !== false,
      systemPromptTemplate: asString(o.systemPromptTemplate),
      priority: Number.isFinite(priorityRaw) && priorityRaw >= 0 ? Math.min(200, priorityRaw) : 90,
      triggerMode: triggerMode === "keyword" || triggerMode === "vector" || triggerMode === "constant" ? triggerMode : "constant"
    });
  }
  return out;
}
function effectiveSidecars(global, conv) {
  if (conv.sidecarEnabled === false) return [];
  if (!asBool(global.sidecarEnabled, false)) return [];
  return parseSidecars(global.sidecars).filter((s) => s.enabled);
}
function parseAutoSidecarIdsRaw(raw, sidecars) {
  const configured = new Set(sidecars.map((s) => s.id));
  if (Array.isArray(raw)) {
    return raw.filter((x) => typeof x === "string" && configured.has(x.trim())).map((x) => x.trim());
  }
  return sidecars.map((s) => s.id);
}
function sidecarIdsFromTaskSelection(selected) {
  const sel = Array.isArray(selected) ? selected : [];
  return sel.filter((x) => typeof x === "string" && x.startsWith("sidecar:")).map((x) => x.slice("sidecar:".length));
}
async function loadMergedSettings(host) {
  const global = await host.plugins.getUserSettings();
  const conv = await host.conversation.getPluginSettings();
  const blockTurns = asInt(
    conv.blockTurns ?? conv.triggerEveryNTurns ?? global.triggerEveryNTurns,
    4,
    500
  );
  const bufferTurns = asInt(conv.bufferTurns ?? global.bufferTurns, 5, 500);
  const titleFormat = asString(conv.titleFormat) || asString(global.titleFormat) || "range-suffix";
  const targetLorebookId = asString(conv.targetLorebookId) || asString(global.defaultTargetLorebookId);
  const apiConfigId = asString(global.apiConfigId);
  const defaultEntryTriggerMode = asString(global.defaultEntryTriggerMode) || "vector";
  const sidecarEntryIds = conv.sidecarEntryIds && typeof conv.sidecarEntryIds === "object" ? { ...conv.sidecarEntryIds } : {};
  const sidecars = effectiveSidecars(global, conv);
  return {
    global,
    conv,
    apiConfigId,
    targetLorebookId,
    blockTurns,
    bufferTurns,
    titleFormat,
    defaultEntryTriggerMode,
    systemPromptTemplate: asString(global.systemPromptTemplate) || resolveDefaultSystemPrompt(host),
    memorybookEnabled: conv.memorybookEnabled === true,
    nextBlockStart: typeof conv.nextBlockStart === "number" ? Math.max(0, Math.round(conv.nextBlockStart)) : 0,
    lastSummarizedEnd: typeof conv.lastSummarizedEnd === "number" ? conv.lastSummarizedEnd : typeof conv.lastTriggeredTurnOrdinal === "number" ? conv.lastTriggeredTurnOrdinal : void 0,
    sidecarEntryIds,
    sidecars,
    autoSidecarIds: parseAutoSidecarIdsRaw(conv.autoSidecarIds, sidecars),
    memorybookDefaultEnabled: asBool(global.memorybookDefaultEnabled, false)
  };
}
function sidecarPromptTemplate(host, sc) {
  const custom = asString(sc.systemPromptTemplate);
  return custom || resolveDefaultSidecarPrompt(host);
}
function blockEndFromStart(start, blockTurns) {
  return start + blockTurns - 1;
}
function shouldAutoTrigger(turnOrdinal, settings) {
  if (!settings.memorybookEnabled) return false;
  const start = settings.nextBlockStart ?? 0;
  const end = blockEndFromStart(start, settings.blockTurns);
  return turnOrdinal >= end + settings.bufferTurns;
}
function currentAutoRange(settings) {
  const start = settings.nextBlockStart ?? 0;
  return { fromTurn: start, toTurn: blockEndFromStart(start, settings.blockTurns) };
}
function resolveAutoTasks(settings) {
  const tasks = [{ kind: "memory" }];
  const allowed = new Set(parseAutoSidecarIdsRaw(settings.autoSidecarIds, settings.sidecars));
  for (const sc of settings.sidecars) {
    if (allowed.has(sc.id)) {
      tasks.push({ kind: "sidecar", sidecar: sc });
    }
  }
  return tasks;
}
function tasksFromSelection(settings, selected) {
  const sel = Array.isArray(selected) ? selected : [];
  const tasks = [];
  if (sel.includes("memory")) tasks.push({ kind: "memory" });
  for (const sc of settings.sidecars) {
    if (sel.includes(`sidecar:${sc.id}`)) {
      tasks.push({ kind: "sidecar", sidecar: sc });
    }
  }
  return tasks;
}
function maxTurnOrdinal(host) {
  const ordinals = host.session.turns ?? [];
  let maxOrd = -1;
  for (const t of ordinals) {
    if (typeof t.turnOrdinal === "number" && t.turnOrdinal > maxOrd) {
      maxOrd = t.turnOrdinal;
    }
  }
  return maxOrd;
}
function firstAutoTriggerTurnOrdinal(settings) {
  const start = settings.nextBlockStart ?? 0;
  return blockEndFromStart(start, settings.blockTurns) + settings.bufferTurns;
}

// plugins/curated-memory/src/errors.ts
var PIPELINE_FATAL_ERRORS = /* @__PURE__ */ new Set([
  "context_exceeded",
  "context_length_unconfigured"
]);
function isPipelineFatalError(e) {
  return e instanceof Error && PIPELINE_FATAL_ERRORS.has(e.message);
}
function isAbortError(e) {
  return typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError" || e instanceof Error && e.name === "AbortError";
}
function isLorebookEntryMissingError(e) {
  if (!e || typeof e !== "object") return false;
  const o = e;
  const code = typeof o.code === "string" ? o.code : "";
  const status = typeof o.status === "number" ? o.status : 0;
  return code === "lorebook_entry_not_found" || code === "lorebook_not_found" || code === "lorebook_entry_patch_failed" && status === 404;
}
function preflightToast(host, e) {
  if (e instanceof Error && e.message === "context_exceeded") {
    const err = e;
    host.ui.toast(
      host.t(k(host, "toastContextExceeded"), {
        used: err.promptTokens,
        budget: err.budget
      }),
      { color: "warning" }
    );
    return;
  }
  if (e instanceof Error && e.message === "context_length_unconfigured") {
    host.ui.toast(host.t(k(host, "toastContextLengthMissing")), { color: "warning" });
    return;
  }
  if (isLorebookEntryMissingError(e)) {
    host.ui.toast(host.t(k(host, "toastSidecarEntryMissing")), { color: "warning" });
    return;
  }
  if (e instanceof Error && e.message === "parse_failed") {
    host.ui.toast(host.t(k(host, "toastParseFailed")), { color: "error" });
    return;
  }
  host.ui.toast(host.t(k(host, "toastSummarizeFailed")), { color: "error" });
}

// plugins/curated-memory/src/state.ts
var summarizeRunning = false;
var memorybookEnabledCache = false;
var _reviewResolver = null;
var _reviewRegenerate = null;
var _lorebookPickResolver = null;
var summarizeBatchProgress = null;
function setSummarizeRunning(v) {
  summarizeRunning = v;
}
function setMemorybookEnabledCache(v) {
  memorybookEnabledCache = v;
}
function setSummarizeBatchProgress(v) {
  summarizeBatchProgress = v;
}
function getReviewResolver() {
  return _reviewResolver;
}
function setReviewResolver(v) {
  _reviewResolver = v;
}
function getReviewRegenerate() {
  return _reviewRegenerate;
}
function setReviewRegenerate(v) {
  _reviewRegenerate = v;
}
function clearReviewSession() {
  _reviewResolver = null;
  _reviewRegenerate = null;
}
function getLorebookPickResolver() {
  return _lorebookPickResolver;
}
function setLorebookPickResolver(v) {
  _lorebookPickResolver = v;
}
function clearLorebookPickResolver() {
  _lorebookPickResolver = null;
}

// plugins/curated-memory/src/review.ts
function bumpTaskProgress(host, done, total) {
  host.ui.progress({
    message: host.t(k(host, "progressSummarize")),
    done,
    total,
    indeterminate: true,
    abortable: true,
    abortLabel: host.t(k(host, "progressAbort"))
  });
}
function showCurrentBatchTaskProgress(host) {
  const p = summarizeBatchProgress;
  if (!p) return;
  bumpTaskProgress(host, p.taskIndex + 1, p.total);
}
async function runReviewRegenerate(host, dialogId) {
  const regen = getReviewRegenerate();
  const resolver = getReviewResolver();
  if (!regen || !resolver) return;
  try {
    const draft = await regen(host);
    host.ui.openFormDialog(
      PLUGIN_ID,
      {
        title: draft.title,
        content: draft.content,
        keywordsText: keywordsToText(draft.keywords)
      },
      dialogId
    );
  } catch (e) {
    if (isAbortError(e)) {
      clearReviewSession();
      resolver.reject(new Error("review_aborted"));
      return;
    }
    console.warn("[curated-memory] review regenerate failed", e);
    host.ui.toast(host.t(k(host, "toastReviewRegenerateFailed")), { color: "warning" });
  }
}
async function generateReviewDraft(host, settings, opts) {
  showCurrentBatchTaskProgress(host);
  try {
    const req = {
      apiConfigId: settings.apiConfigId,
      kind: opts.kind,
      userContent: opts.userContent,
      systemPromptTemplate: opts.kind === "sidecar" && opts.sc ? sidecarPromptTemplate(host, opts.sc) : settings.systemPromptTemplate,
      titleFormat: settings.titleFormat,
      fromTurn: opts.fromTurn,
      toTurn: opts.toTurn,
      sidecarName: opts.sc?.name
    };
    const { draft } = await host.plugin.completeDraft(req);
    return draft;
  } finally {
    host.ui.clearProgress();
  }
}
function registerReviewDialog(host, opts) {
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, "reviewDialogTitle"),
      bodyKey: k(host, opts.bodyKey),
      fields: [
        {
          key: "title",
          labelKey: k(host, "reviewTitleLabel"),
          type: "text",
          ...opts.lockTitle ? { readOnly: true } : {}
        },
        {
          key: "content",
          labelKey: k(host, "reviewContentLabel"),
          type: "textarea"
        },
        {
          key: "keywordsText",
          labelKey: k(host, "reviewKeywordsLabel"),
          type: "textarea",
          hintKey: k(host, "reviewKeywordsHint")
        }
      ],
      submitKey: k(host, "reviewConfirm"),
      skipKey: k(host, "reviewSkip"),
      cancelKey: k(host, "reviewAbort"),
      regenerateKey: k(host, "reviewRegenerate"),
      persistent: true,
      canSubmit: (m) => opts.lockTitle ? asString(m.content).length > 0 : asString(m.title).length > 0 && asString(m.content).length > 0,
      onSubmit: async (_h, model) => {
        const resolver = getReviewResolver();
        if (!resolver) return;
        clearReviewSession();
        resolver.resolve({
          title: asString(model.title),
          content: asString(model.content),
          keywords: parseKeywordsText(model.keywordsText)
        });
      },
      onSkip: () => {
        const resolver = getReviewResolver();
        if (!resolver) return;
        clearReviewSession();
        resolver.reject(new Error("review_skipped"));
      },
      onCancel: () => {
        const resolver = getReviewResolver();
        if (!resolver) return;
        clearReviewSession();
        resolver.reject(new Error("review_aborted"));
      },
      onRegenerate: async (h) => {
        await runReviewRegenerate(h, opts.dialogId);
      }
    },
    opts.dialogId
  );
}
function registerReviewDialogs(host) {
  registerReviewDialog(host, {
    dialogId: DIALOG_REVIEW,
    bodyKey: "reviewDialogBody"
  });
  registerReviewDialog(host, {
    dialogId: DIALOG_REVIEW_SIDECAR,
    bodyKey: "reviewDialogBodySidecar",
    lockTitle: true
  });
}
function promptReview(host, draft, dialogId, regenerateFn) {
  return new Promise((resolve, reject) => {
    setReviewResolver({ resolve, reject });
    setReviewRegenerate(regenerateFn);
    host.openFormDialog(
      PLUGIN_ID,
      {
        title: draft.title,
        content: draft.content,
        keywordsText: keywordsToText(draft.keywords)
      },
      dialogId
    );
  });
}

// plugins/curated-memory/src/sidecar.ts
async function writeSidecarEntry(host, settings, sidecarEntryIds, sc, reviewed, sidecarKeys) {
  const body = {
    title: sc.name,
    content: reviewed.content,
    keys: sidecarKeys,
    triggerMode: sc.triggerMode || "constant",
    priority: typeof sc.priority === "number" ? sc.priority : 90
  };
  let entryId = asString(sidecarEntryIds[sc.id]);
  if (entryId) {
    try {
      await host.lorebook.patchEntry(settings.targetLorebookId, entryId, body);
      return entryId;
    } catch (e) {
      if (!isLorebookEntryMissingError(e)) throw e;
      delete sidecarEntryIds[sc.id];
      entryId = "";
    }
  }
  const created = await host.lorebook.createEntry(settings.targetLorebookId, body);
  sidecarEntryIds[sc.id] = created.id;
  return created.id;
}

// plugins/curated-memory/src/pipeline.ts
function setPluginHold(host, hold) {
  if (typeof host.conversation.setPluginHold === "function") {
    host.conversation.setPluginHold(hold);
  }
}
function bumpTaskProgress2(host, done, total) {
  host.ui.progress({
    message: host.t(k(host, "progressSummarize")),
    done,
    total,
    indeterminate: true,
    abortable: true,
    abortLabel: host.t(k(host, "progressAbort"))
  });
}
async function runSummarizeTasks(host, opts) {
  if (summarizeRunning) {
    host.ui.toast(host.t(k(host, "toastBusy")), { color: "info" });
    return { ok: false, reason: "busy" };
  }
  const tasks = opts.tasks ?? [];
  if (tasks.length === 0) {
    host.ui.toast(host.t(k(host, "toastNoTasksSelected")), { color: "warning" });
    return { ok: false, reason: "no_tasks" };
  }
  setSummarizeRunning(true);
  host.refreshSlotButtons();
  setPluginHold(host, true);
  host.ui.progress({
    message: host.t(k(host, "progressSummarize")),
    done: 0,
    total: tasks.length,
    indeterminate: true,
    abortable: true,
    abortLabel: host.t(k(host, "progressAbort"))
  });
  let completedTasks = 0;
  try {
    const settings = await loadMergedSettings(host);
    if (!settings.apiConfigId) {
      host.ui.toast(host.t(k(host, "toastNoApiConfig")), { color: "warning" });
      return { ok: false, reason: "no_api" };
    }
    const targetId = await ensureTargetLorebook(host, settings);
    if (!targetId) {
      return { ok: false, reason: "no_lorebook" };
    }
    settings.targetLorebookId = targetId;
    const fromTurn = opts.fromTurn;
    const toTurn = opts.toTurn;
    if (fromTurn > toTurn) {
      host.ui.toast(host.t(k(host, "toastInvalidRange")), { color: "warning" });
      return { ok: false, reason: "invalid_range" };
    }
    const prepared = await host.plugin.prepareContext({
      fromTurn,
      toTurn,
      targetLorebookId: settings.targetLorebookId
    });
    if (!prepared.userContent?.trim()) {
      host.ui.toast(host.t(k(host, "toastNoTurnsInRange")), { color: "warning" });
      return { ok: false, reason: "no_turns" };
    }
    const userContent = prepared.userContent;
    const sidecarEntryIds = await host.lorebook.normalizeEntryRefs({
      lorebookId: settings.targetLorebookId,
      entryIds: settings.sidecarEntryIds,
      validKeys: settings.sidecars.map((s) => s.id)
    });
    const patch = {};
    let done = 0;
    let ranMemory = false;
    let skippedTasks = 0;
    let aborted = false;
    setSummarizeBatchProgress({ taskIndex: 0, total: tasks.length });
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
      const task = tasks[taskIndex];
      setSummarizeBatchProgress({ taskIndex, total: tasks.length });
      showCurrentBatchTaskProgress(host);
      try {
        if (task.kind === "memory") {
          const memoryDraft = await generateReviewDraft(host, settings, {
            kind: "memory",
            userContent,
            fromTurn,
            toTurn
          });
          const reviewed = await promptReview(
            host,
            memoryDraft,
            DIALOG_REVIEW,
            (h) => generateReviewDraft(h, settings, {
              kind: "memory",
              userContent,
              fromTurn,
              toTurn
            })
          );
          bumpTaskProgress2(host, done, tasks.length);
          await host.lorebook.createEntry(settings.targetLorebookId, {
            title: reviewed.title,
            content: reviewed.content,
            keys: entryKeys(reviewed.keywords),
            triggerMode: settings.defaultEntryTriggerMode,
            priority: 100
          });
          ranMemory = true;
        } else if (task.kind === "sidecar") {
          const sc = task.sidecar;
          const sidecarDraft = await generateReviewDraft(host, settings, {
            kind: "sidecar",
            userContent,
            sc
          });
          const reviewed = await promptReview(
            host,
            sidecarDraft,
            DIALOG_REVIEW_SIDECAR,
            (h) => generateReviewDraft(h, settings, {
              kind: "sidecar",
              userContent,
              sc
            })
          );
          bumpTaskProgress2(host, done, tasks.length);
          await writeSidecarEntry(
            host,
            settings,
            sidecarEntryIds,
            sc,
            reviewed,
            entryKeys(reviewed.keywords)
          );
        }
        completedTasks += 1;
      } catch (e) {
        if (isAbortError(e)) {
          aborted = true;
          host.ui.toast(host.t(k(host, "toastProgressAborted")), { color: "info" });
          break;
        }
        if (e instanceof Error && e.message === "review_skipped") {
          skippedTasks += 1;
          host.ui.toast(host.t(k(host, "toastReviewSkipped")), { color: "info" });
          done += 1;
          bumpTaskProgress2(host, done, tasks.length);
          continue;
        }
        if (e instanceof Error && e.message === "review_aborted") {
          aborted = true;
          host.ui.toast(host.t(k(host, "toastReviewAborted")), { color: "info" });
          break;
        }
        console.warn("[curated-memory] task failed", task, e);
        if (isPipelineFatalError(e)) {
          preflightToast(host, e);
          aborted = true;
          break;
        }
        preflightToast(host, e);
        skippedTasks += 1;
        host.ui.toast(host.t(k(host, "toastTaskSkipped")), { color: "warning" });
        done += 1;
        bumpTaskProgress2(host, done, tasks.length);
        continue;
      }
      done += 1;
      bumpTaskProgress2(host, done, tasks.length);
    }
    if (completedTasks === 0) {
      if (skippedTasks > 0) {
        host.ui.toast(
          host.t(k(host, "toastSummarizeSummary"), {
            done: 0,
            skipped: skippedTasks,
            total: tasks.length
          }),
          { color: aborted ? "warning" : "info" }
        );
      }
      return {
        ok: false,
        reason: skippedTasks >= tasks.length ? "all_skipped" : "error",
        skipped: skippedTasks,
        aborted
      };
    }
    if (ranMemory && opts.updatePointers !== false) {
      const last = Math.max(
        typeof settings.lastSummarizedEnd === "number" ? settings.lastSummarizedEnd : -1,
        toTurn
      );
      patch.lastSummarizedEnd = last;
      patch.nextBlockStart = Math.max(settings.nextBlockStart ?? 0, last + 1);
    }
    if (JSON.stringify(sidecarEntryIds) !== JSON.stringify(settings.sidecarEntryIds)) {
      patch.sidecarEntryIds = Object.keys(sidecarEntryIds).length > 0 ? sidecarEntryIds : null;
    }
    if (Object.keys(patch).length > 0) {
      await host.conversation.patchPluginSettings(patch);
    }
    if (opts.updateMemorybookCache) {
      await refreshMemorybookState(host);
    }
    if (completedTasks === tasks.length && skippedTasks === 0) {
      host.ui.toast(host.t(k(host, "toastSummarizeDone")), { color: "success" });
    } else if (completedTasks > 0 || skippedTasks > 0) {
      host.ui.toast(
        host.t(k(host, "toastSummarizeSummary"), {
          done: completedTasks,
          skipped: skippedTasks,
          total: tasks.length
        }),
        { color: aborted ? "warning" : "info" }
      );
    }
    return {
      ok: completedTasks === tasks.length && skippedTasks === 0,
      partial: completedTasks > 0 && completedTasks < tasks.length,
      skipped: skippedTasks,
      aborted
    };
  } catch (e) {
    if (isAbortError(e)) {
      return { ok: false, reason: "aborted", aborted: true };
    }
    console.warn("[curated-memory] summarize failed", e);
    preflightToast(host, e);
    return { ok: false, reason: "error" };
  } finally {
    setSummarizeBatchProgress(null);
    setSummarizeRunning(false);
    host.refreshSlotButtons();
    setPluginHold(host, false);
    host.ui.clearProgress();
  }
}

// plugins/curated-memory/src/dialogs.ts
async function refreshMemorybookState(host) {
  try {
    const conv = await host.conversation.getPluginSettings();
    setMemorybookEnabledCache(conv.memorybookEnabled === true);
  } catch {
    setMemorybookEnabledCache(false);
  }
  host.refreshSlotButtons();
}
async function ensureTargetLorebook(host, settings) {
  const existing = asString(settings.targetLorebookId);
  if (existing) return existing;
  host.ui.toast(host.t(k(host, "toastTargetLorebookMissingWarn")), { color: "warning" });
  try {
    return await promptPickLorebook(host);
  } catch {
    return "";
  }
}
function buildSummarizeTaskOptions(host, settings, opts) {
  const options = [
    {
      value: "memory",
      label: host.t(k(host, "manualTaskMemory")),
      ...opts?.memoryLocked ? { locked: true } : {}
    }
  ];
  for (const sc of settings.sidecars) {
    options.push({ value: `sidecar:${sc.id}`, label: sc.name });
  }
  return options;
}
function buildAutoSidecarTaskOptions(settings) {
  return settings.sidecars.map((sc) => ({
    value: `sidecar:${sc.id}`,
    label: sc.name
  }));
}
function registerPickLorebookDialog(host) {
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, "pickLorebookDialogTitle"),
      bodyKey: k(host, "pickLorebookDialogBody"),
      fields: [
        {
          key: "targetLorebookId",
          labelKey: k(host, "sessionTargetLorebookLabel"),
          type: "lorebook"
        }
      ],
      submitKey: k(host, "pickLorebookConfirm"),
      cancelKey: k(host, "sessionCancel"),
      canSubmit: (m) => asString(m.targetLorebookId).length > 0,
      onSubmit: async (h, model) => {
        const id = asString(model.targetLorebookId);
        if (!id) return;
        await h.conversation.patchPluginSettings({ targetLorebookId: id });
        const resolver = getLorebookPickResolver();
        if (resolver) {
          clearLorebookPickResolver();
          resolver.resolve(id);
        }
      },
      onCancel: () => {
        const resolver = getLorebookPickResolver();
        if (!resolver) return;
        clearLorebookPickResolver();
        resolver.reject(new Error("pick_cancelled"));
      }
    },
    DIALOG_PICK_LOREBOOK
  );
}
function promptPickLorebook(host) {
  return new Promise((resolve, reject) => {
    setLorebookPickResolver({ resolve, reject });
    host.openFormDialog(PLUGIN_ID, { targetLorebookId: "" }, DIALOG_PICK_LOREBOOK);
  });
}
function registerSessionDialog(host, settings) {
  const fields = [
    {
      key: "targetLorebookId",
      labelKey: k(host, "sessionTargetLorebookLabel"),
      type: "lorebook",
      hintKey: k(host, "sessionTargetLorebookHint")
    },
    {
      key: "blockTurns",
      labelKey: k(host, "sessionBlockTurnsLabel"),
      type: "integer"
    },
    {
      key: "bufferTurns",
      labelKey: k(host, "sessionBufferTurnsLabel"),
      type: "integer"
    },
    {
      key: "sidecarEnabled",
      labelKey: k(host, "sessionSidecarEnabledLabel"),
      type: "radio",
      options: [
        { value: "inherit", labelKey: k(host, "sessionSidecarInherit") },
        { value: "on", labelKey: k(host, "sessionSidecarOn") },
        { value: "off", labelKey: k(host, "sessionSidecarOff") }
      ]
    }
  ];
  if (settings.sidecars.length > 0) {
    fields.push({
      key: "autoSidecarTasks",
      labelKey: k(host, "sessionAutoSidecarsLabel"),
      type: "checkboxGroup",
      options: buildAutoSidecarTaskOptions(settings),
      hintKey: k(host, "sessionAutoSidecarsHint")
    });
  }
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, "sessionDialogTitle"),
      fields,
      submitKey: k(host, "sessionSubmit"),
      cancelKey: k(host, "sessionCancel"),
      canSubmit: () => true,
      onSubmit: async (h, model) => {
        const patch = {
          targetLorebookId: asString(model.targetLorebookId),
          blockTurns: asInt(model.blockTurns, 4, 500),
          bufferTurns: asInt(model.bufferTurns, 5, 500)
        };
        if (!patch.targetLorebookId) patch.targetLorebookId = null;
        const se = asString(model.sidecarEnabled);
        if (se === "on") patch.sidecarEnabled = true;
        else if (se === "off") patch.sidecarEnabled = false;
        else patch.sidecarEnabled = null;
        if (settings.sidecars.length > 0) {
          patch.autoSidecarIds = sidecarIdsFromTaskSelection(model.autoSidecarTasks);
        }
        await h.conversation.patchPluginSettings(patch);
        h.ui.toast(h.t(k(h, "sessionSubmit")), { color: "success" });
      }
    },
    DIALOG_SESSION
  );
}
function registerSummarizeDialog(host, settings, mode) {
  const isEnable = mode === "enable";
  const dialogId = isEnable ? DIALOG_ENABLE : DIALOG_MANUAL;
  const fields = [
    {
      key: "startTurn",
      labelKey: k(host, "manualStartTurnLabel"),
      type: "integer",
      ...isEnable ? { readOnly: true } : {}
    },
    {
      key: "endTurn",
      labelKey: k(host, "manualEndTurnLabel"),
      type: "integer",
      ...isEnable ? { readOnly: true } : {}
    }
  ];
  if (isEnable) {
    if (settings.sidecars.length > 0) {
      fields.push({
        key: "selectedTasks",
        labelKey: k(host, "manualTasksLabel"),
        type: "checkboxGroup",
        options: buildSummarizeTaskOptions(host, settings, { memoryLocked: true }),
        hintKey: k(host, "enableTasksHint")
      });
    }
  } else {
    fields.push({
      key: "selectedTasks",
      labelKey: k(host, "manualTasksLabel"),
      type: "checkboxGroup",
      options: buildSummarizeTaskOptions(host, settings, { memoryLocked: false }),
      hintKey: k(host, "manualTasksHint")
    });
  }
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, isEnable ? "enableDialogTitle" : "manualDialogTitle"),
      bodyKey: k(host, isEnable ? "enableDialogBody" : "manualDialogBody"),
      fields,
      submitKey: k(host, isEnable ? "enableSubmit" : "manualSubmit"),
      cancelKey: k(host, "sessionCancel"),
      canSubmit: (m) => {
        const start = asInt(m.startTurn, -1, 5e5);
        const end = asInt(m.endTurn, -1, 5e5);
        if (start < 0 || end < start) return false;
        if (isEnable) return true;
        return tasksFromSelection(settings, m.selectedTasks).length > 0;
      },
      onSubmit: async (h, model) => {
        const fromTurn = asInt(model.startTurn, 0, 5e5);
        const toTurn = asInt(model.endTurn, fromTurn, 5e5);
        const selectedTasks = isEnable ? [
          "memory",
          ...sidecarIdsFromTaskSelection(model.selectedTasks).map(
            (id) => `sidecar:${id}`
          )
        ] : model.selectedTasks;
        const tasks = tasksFromSelection(settings, selectedTasks);
        if (tasks.length === 0) {
          h.ui.toast(h.t(k(h, "toastNoTasksSelected")), { color: "warning" });
          return;
        }
        if (isEnable) {
          const autoSidecarIds = sidecarIdsFromTaskSelection(model.selectedTasks);
          await h.conversation.patchPluginSettings({
            memorybookEnabled: true,
            nextBlockStart: fromTurn,
            autoSidecarIds
          });
          await refreshMemorybookState(h);
        }
        await runSummarizeTasks(h, {
          fromTurn,
          toTurn,
          tasks,
          updatePointers: isEnable || tasks.some((t) => t.kind === "memory"),
          updateMemorybookCache: false
        });
      }
    },
    dialogId
  );
}
function openSessionSettings(host) {
  loadMergedSettings(host).then((s) => {
    registerSessionDialog(host, s);
    let sidecarEnabled = "inherit";
    if (s.conv.sidecarEnabled === true) sidecarEnabled = "on";
    if (s.conv.sidecarEnabled === false) sidecarEnabled = "off";
    const model = {
      targetLorebookId: s.targetLorebookId,
      blockTurns: s.blockTurns,
      bufferTurns: s.bufferTurns,
      sidecarEnabled
    };
    if (s.sidecars.length > 0) {
      model.autoSidecarTasks = s.autoSidecarIds.map((id) => `sidecar:${id}`);
    }
    host.openFormDialog(PLUGIN_ID, model, DIALOG_SESSION);
  });
}
function openManualSummarize(host) {
  loadMergedSettings(host).then((s) => {
    registerSummarizeDialog(host, s, "manual");
    const maxOrd = Math.max(0, maxTurnOrdinal(host));
    host.openFormDialog(
      PLUGIN_ID,
      { startTurn: 0, endTurn: maxOrd, selectedTasks: ["memory"] },
      DIALOG_MANUAL
    );
  });
}
function openEnableLongDialog(host, settings) {
  const T = maxTurnOrdinal(host);
  const N = settings.blockTurns;
  const buffer = settings.bufferTurns;
  const endTurn = T - buffer;
  const startTurn = Math.max(0, endTurn - (N - 1));
  const selectedTasks = [
    "memory",
    ...settings.sidecars.map((sc) => `sidecar:${sc.id}`)
  ];
  registerSummarizeDialog(host, settings, "enable");
  host.openFormDialog(PLUGIN_ID, { startTurn, endTurn, selectedTasks }, DIALOG_ENABLE);
}
async function applyShortMemorybookEnable(host, settings) {
  const X = firstAutoTriggerTurnOrdinal({ ...settings, nextBlockStart: 0 });
  const autoSidecarIds = parseAutoSidecarIdsRaw(null, settings.sidecars);
  await host.conversation.patchPluginSettings({
    memorybookEnabled: true,
    nextBlockStart: 0,
    autoSidecarIds
  });
  await refreshMemorybookState(host);
  host.ui.toast(host.t(k(host, "toastMemorybookScheduled"), { turn: X }), {
    color: "success"
  });
}
async function tryEnableMemorybook(host) {
  const settings = await loadMergedSettings(host);
  const T = maxTurnOrdinal(host);
  const N = settings.blockTurns;
  const buffer = settings.bufferTurns;
  if (T > N + buffer) {
    openEnableLongDialog(host, settings);
    return;
  }
  await applyShortMemorybookEnable(host, settings);
}
async function toggleMemorybook(host) {
  if (memorybookEnabledCache) {
    await host.conversation.patchPluginSettings({ memorybookEnabled: false });
    await refreshMemorybookState(host);
    host.ui.toast(host.t(k(host, "toastMemorybookDisabled")), { color: "info" });
    return;
  }
  await tryEnableMemorybook(host);
}
function isBusy(host) {
  return host.session.conversationWriteLocked || host.session.loading || host.session.regeneratingTurnOrdinal !== null;
}

// plugins/curated-memory/src/lifecycle.ts
function isPersistBusy(host) {
  return host.session.conversationWriteLocked || host.session.loading || host.session.regeneratingTurnOrdinal !== null;
}
function scheduleWhenConversationIdle(host, fn) {
  const attempt = () => {
    if (summarizeRunning || isPersistBusy(host)) {
      setTimeout(attempt, 40);
      return;
    }
    void fn();
  };
  setTimeout(attempt, 0);
}
async function tryBootstrapDefaultMemorybook(host, event) {
  if (!event.isFirstTurn) return;
  const conv = await host.conversation.getPluginSettings();
  if (conv.memorybookEnabled === true || conv.memorybookEnabled === false) return;
  const global = await host.plugins.getUserSettings();
  if (!asBool(global.memorybookDefaultEnabled, false)) return;
  const settings = await loadMergedSettings(host);
  await applyShortMemorybookEnable(host, settings);
}
async function handleAutoSummarizeTurn(host, turnOrdinal) {
  const settings = await loadMergedSettings(host);
  if (!settings.memorybookEnabled) return;
  if (!settings.apiConfigId) return;
  if (!shouldAutoTrigger(turnOrdinal, settings)) return;
  const range = currentAutoRange(settings);
  const tasks = resolveAutoTasks(settings);
  await runSummarizeTasks(host, {
    fromTurn: range.fromTurn,
    toTurn: range.toTurn,
    tasks,
    updatePointers: true,
    updateMemorybookCache: false
  });
}
function registerLifecycle(host) {
  host.lifecycle.onAssistantReplyPersisted((event) => {
    const turnOrdinal = event.turnOrdinal;
    if (typeof turnOrdinal !== "number" || turnOrdinal < 0) return;
    scheduleWhenConversationIdle(host, async () => {
      try {
        await tryBootstrapDefaultMemorybook(host, event);
        await handleAutoSummarizeTurn(host, turnOrdinal);
      } catch (e) {
        console.warn("[curated-memory] auto summarize failed", e);
      }
    });
  });
}

// plugins/curated-memory/src/index.ts
function register(host) {
  registerReviewDialogs(host);
  registerPickLorebookDialog(host);
  void refreshMemorybookState(host);
  host.registerSlotButton("composer-toolbar", {
    id: `${PLUGIN_ID}-menu`,
    icon: "mdi-book-open-page-variant",
    tooltipKey: k(host, "tooltipCuratedMemory"),
    filled: () => memorybookEnabledCache,
    menu: [
      {
        id: `${PLUGIN_ID}-memorybook`,
        labelKey: k(host, "tooltipMemorybook"),
        icon: "mdi-book-open-page-variant",
        filled: () => memorybookEnabledCache,
        disabled: () => summarizeRunning,
        onClick: () => {
          void toggleMemorybook(host);
        }
      },
      {
        id: `${PLUGIN_ID}-manual`,
        labelKey: k(host, "tooltipManualSummarize"),
        icon: "mdi-book-edit-outline",
        disabled: () => isBusy(host) || summarizeRunning,
        onClick: () => openManualSummarize(host)
      },
      {
        id: `${PLUGIN_ID}-session`,
        labelKey: k(host, "tooltipSessionSettings"),
        icon: "mdi-tune-variant",
        onClick: () => openSessionSettings(host)
      }
    ]
  });
  registerLifecycle(host);
}
export {
  register
};
