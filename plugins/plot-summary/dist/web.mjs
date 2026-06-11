// src/constants.ts
var PLUGIN_ID = "plot-summary";
var DIALOG_SESSION = "session";
var DIALOG_MANUAL = "manual";
var DIALOG_ENABLE = "enable";
var DIALOG_REVIEW = "review";
var DIALOG_REVIEW_SIDECAR = "review-sidecar";
var DIALOG_PICK_LOREBOOK = "pick-lorebook";
var DIALOG_RECOVER_LOREBOOK = "recover-lorebook";
var DIALOG_PROMPT_PREVIEW = "prompt-preview";

// src/shared/utils.ts
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

// src/settings.ts
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
function parseManualTaskSelectionRaw(raw, sidecars) {
  if (!Array.isArray(raw)) return ["memory"];
  const configured = new Set(sidecars.map((s) => s.id));
  const out = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    if (x === "memory") {
      if (!out.includes("memory")) out.push("memory");
      continue;
    }
    if (!x.startsWith("sidecar:")) continue;
    const id = x.slice("sidecar:".length).trim();
    if (!configured.has(id)) continue;
    const token = `sidecar:${id}`;
    if (!out.includes(token)) out.push(token);
  }
  return out.length > 0 ? out : ["memory"];
}
function normalizeManualTaskSelection(selected, sidecars) {
  return parseManualTaskSelectionRaw(selected, sidecars);
}
function parseRegexRuleIds(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
}
function readLastSummarizedEnd(conv) {
  if (typeof conv.lastSummarizedEnd === "number" && Number.isFinite(conv.lastSummarizedEnd)) {
    return Math.round(conv.lastSummarizedEnd);
  }
  if (typeof conv.lastTriggeredTurnOrdinal === "number" && Number.isFinite(conv.lastTriggeredTurnOrdinal)) {
    return Math.round(conv.lastTriggeredTurnOrdinal);
  }
  return void 0;
}
function normalizedNextBlockStart(nextBlockStart, lastSummarizedEnd) {
  const start = Math.max(0, Math.round(nextBlockStart));
  if (typeof lastSummarizedEnd === "number" && lastSummarizedEnd >= 0) {
    return Math.max(start, lastSummarizedEnd + 1);
  }
  return start;
}
function hasAutoSummarizeHistory(settings) {
  return typeof settings.lastSummarizedEnd === "number" && settings.lastSummarizedEnd >= 0;
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
  const previousSummariesLimit = asInt(global.previousSummariesLimit, 8, 50);
  const entrySortModeRaw = asString(conv.entrySortMode);
  const entrySortMode = entrySortModeRaw === "manual" ? "manual" : "auto-turn-suffix";
  const targetLorebookId = asString(conv.targetLorebookId);
  const convMode = asString(conv.targetLorebookMode);
  const globalMode = asString(global.targetLorebookMode);
  const targetLorebookMode = convMode === "auto" || convMode === "manual" ? convMode : globalMode === "auto" || globalMode === "manual" ? globalMode : "manual";
  const autoLorebookNameTemplate = asString(conv.autoLorebookNameTemplate) || asString(global.autoLorebookNameTemplate) || "{{conversationTitle}}-summary";
  const apiConfigId = asString(global.apiConfigId);
  const defaultEntryTriggerMode = asString(global.defaultEntryTriggerMode) || "vector";
  const sidecarEntryIds = conv.sidecarEntryIds && typeof conv.sidecarEntryIds === "object" ? { ...conv.sidecarEntryIds } : {};
  const sidecars = effectiveSidecars(global, conv);
  const lastSummarizedEnd = readLastSummarizedEnd(conv);
  const rawNextBlockStart = typeof conv.nextBlockStart === "number" ? Math.max(0, Math.round(conv.nextBlockStart)) : 0;
  return {
    global,
    conv,
    apiConfigId,
    targetLorebookId,
    blockTurns,
    bufferTurns,
    previousSummariesLimit,
    entrySortMode,
    defaultEntryTriggerMode,
    systemPromptTemplate: asString(global.systemPromptTemplate) || resolveDefaultSystemPrompt(host),
    autoSummarizeEnabled: conv.autoSummarizeEnabled === true,
    nextBlockStart: normalizedNextBlockStart(rawNextBlockStart, lastSummarizedEnd),
    lastSummarizedEnd,
    sidecarEntryIds,
    sidecars,
    autoSidecarIds: parseAutoSidecarIdsRaw(conv.autoSidecarIds, sidecars),
    manualSummarizeTasks: parseManualTaskSelectionRaw(
      conv.manualSummarizeTasks,
      sidecars
    ),
    autoSummarizeDefaultEnabled: asBool(global.autoSummarizeDefaultEnabled, false),
    targetLorebookMode,
    autoLorebookNameTemplate,
    regexRuleIds: parseRegexRuleIds(global.regexRuleIds),
    regexApplyAllTurns: asBool(global.regexApplyAllTurns, false)
  };
}
function sidecarPromptTemplate(host, sc) {
  const custom = asString(sc.systemPromptTemplate);
  return custom || resolveDefaultSidecarPrompt(host);
}
function blockEndFromStart(start, blockTurns) {
  return start + blockTurns - 1;
}
function shouldAutoTrigger(turnOrdinal2, settings) {
  if (!settings.autoSummarizeEnabled) return false;
  const start = settings.nextBlockStart ?? 0;
  const end = blockEndFromStart(start, settings.blockTurns);
  return turnOrdinal2 >= end + settings.bufferTurns;
}
function currentAutoRange(settings) {
  const start = settings.nextBlockStart ?? 0;
  return { fromTurn: start, toTurn: blockEndFromStart(start, settings.blockTurns) };
}
function manualSummarizeDefaultRange(settings, preset, currentMaxTurn) {
  if (preset) {
    return { startTurn: preset.startTurn, endTurn: preset.endTurn };
  }
  if (typeof currentMaxTurn !== "number" || !Number.isFinite(currentMaxTurn) || currentMaxTurn < 0) {
    const range = currentAutoRange(settings);
    return { startTurn: range.fromTurn, endTurn: range.toTurn };
  }
  const T = Math.round(currentMaxTurn);
  const buffer = settings.bufferTurns;
  const blockTurns = settings.blockTurns;
  const endTurn = Math.max(0, T - buffer);
  const startTurn = Math.max(0, T - buffer - blockTurns);
  return { startTurn: Math.min(startTurn, endTurn), endTurn };
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
function outgoingTailOrdinal(host) {
  const maxOrd = maxTurnOrdinal(host);
  return maxOrd < 0 ? 0 : maxOrd + 1;
}
function firstAutoTriggerTurnOrdinal(settings) {
  const start = settings.nextBlockStart ?? 0;
  return blockEndFromStart(start, settings.blockTurns) + settings.bufferTurns;
}

// src/errors.ts
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
function lorebookErrorCode(e) {
  if (!e || typeof e !== "object") return "";
  const o = e;
  if (typeof o.code === "string" && o.code) return o.code;
  if (e instanceof Error && e.message) return e.message;
  return "";
}
function isLorebookNotFoundError(e) {
  return lorebookErrorCode(e) === "lorebook_not_found";
}
function isLorebookEntryMissingError(e) {
  if (!e || typeof e !== "object") return false;
  const o = e;
  const code = lorebookErrorCode(e) || (typeof o.code === "string" ? o.code : "");
  const status = typeof o.status === "number" ? o.status : 0;
  return code === "lorebook_entry_not_found" || code === "lorebook_entry_patch_failed" && status === 404;
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
  if (isLorebookNotFoundError(e)) {
    host.ui.toast(host.t(k(host, "toastTargetLorebookDeleted")), { color: "warning" });
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

// src/state.ts
var summarizeRunning = false;
var _reviewResolver = null;
var _reviewRegenerate = null;
var _reviewTitleParams = null;
var _lorebookPickResolver = null;
var summarizeBatchProgress = null;
var rangeStartTurn = null;
function getRangeStartTurn() {
  return rangeStartTurn;
}
function setRangeStartTurn(v) {
  rangeStartTurn = v;
}
function setSummarizeRunning(v) {
  summarizeRunning = v;
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
function getReviewTitleParams() {
  return _reviewTitleParams;
}
function setReviewTitleParams(v) {
  _reviewTitleParams = v;
}
function clearReviewSession() {
  _reviewResolver = null;
  _reviewRegenerate = null;
  _reviewTitleParams = null;
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
var _promptPreviewRestore = null;
function setPromptPreviewRestore(model) {
  _promptPreviewRestore = { ...model };
}
function getPromptPreviewRestore() {
  return _promptPreviewRestore;
}
function clearPromptPreviewRestore() {
  _promptPreviewRestore = null;
}

// src/review.ts
function resolveSystemPrompt(host, settings, opts) {
  if (opts.kind === "sidecar" && opts.sc) {
    return sidecarPromptTemplate(host, opts.sc);
  }
  return settings.systemPromptTemplate;
}
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
function reviewDialogOpenOpts() {
  const titleParams = getReviewTitleParams();
  return titleParams ? { titleParams } : void 0;
}
async function resolveTargetLorebookName(host, lorebookId) {
  const id = asString(lorebookId);
  if (!id) return "";
  try {
    const lb = await host.lorebook.get(id);
    const name = asString(lb.name);
    return name || id;
  } catch {
    return id;
  }
}
function openReviewFormDialog(host, draft, dialogId) {
  const model = {
    title: draft.title,
    content: draft.content,
    keywordsText: keywordsToText(draft.keywords)
  };
  host.openFormDialog(PLUGIN_ID, model, dialogId, reviewDialogOpenOpts());
}
async function runReviewRegenerate(host, dialogId) {
  const regen = getReviewRegenerate();
  const resolver = getReviewResolver();
  if (!regen || !resolver) return;
  try {
    const draft = await regen(host);
    openReviewFormDialog(host, draft, dialogId);
  } catch (e) {
    if (isAbortError(e)) {
      clearReviewSession();
      resolver.reject(new Error("review_aborted"));
      return;
    }
    console.warn("[plot-summary] review regenerate failed", e);
    host.ui.toast(host.t(k(host, "toastReviewRegenerateFailed")), { color: "warning" });
  }
}
async function generateReviewDraft(host, settings, opts) {
  showCurrentBatchTaskProgress(host);
  try {
    const req = {
      ...settings.apiConfigId ? { apiConfigId: settings.apiConfigId } : {},
      kind: opts.kind,
      systemReferenceContext: opts.systemReferenceContext ?? "",
      userContent: opts.userContent,
      systemPromptTemplate: resolveSystemPrompt(host, settings, opts),
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
function promptReview(host, draft, dialogId, regenerateFn, lorebookName) {
  return new Promise((resolve, reject) => {
    setReviewResolver({ resolve, reject });
    setReviewRegenerate(regenerateFn);
    setReviewTitleParams({ name: lorebookName });
    openReviewFormDialog(host, draft, dialogId);
  });
}

// src/shared/lorebook-sort.ts
var TURN_RANGE_SUFFIX_RE = /-(\d+)-(\d+)$/;
function parseTurnRangeSuffix(title) {
  const t = (title ?? "").trim();
  const m = t.match(TURN_RANGE_SUFFIX_RE);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}
function classifyPlotSummaryEntry(entry, sidecarEntryIdSet) {
  if (sidecarEntryIdSet.has(entry.id)) return "sidecar";
  if (parseTurnRangeSuffix(entry.title)) return "summary";
  return "other";
}
function kindRank(kind) {
  if (kind === "other") return 0;
  if (kind === "sidecar") return 1;
  return 2;
}
function sidecarConfigIndex(entryId, sidecarEntryIds, sidecarConfigIds) {
  for (let i = 0; i < sidecarConfigIds.length; i++) {
    const cfgId = sidecarConfigIds[i];
    if (sidecarEntryIds[cfgId] === entryId) return i;
  }
  return 9999;
}
function sortPlotSummaryEntriesInGroup(entries, sidecarEntryIds, sidecarConfigIds) {
  const sidecarSet = new Set(Object.values(sidecarEntryIds));
  return entries.slice().sort((a, b) => {
    const ka = classifyPlotSummaryEntry(a, sidecarSet);
    const kb = classifyPlotSummaryEntry(b, sidecarSet);
    const dr = kindRank(ka) - kindRank(kb);
    if (dr !== 0) return dr;
    if (ka === "other") {
      const ca = a.createdAt ?? "";
      const cb = b.createdAt ?? "";
      if (ca !== cb) return ca < cb ? -1 : 1;
      return a.id.localeCompare(b.id);
    }
    if (ka === "sidecar") {
      return sidecarConfigIndex(a.id, sidecarEntryIds, sidecarConfigIds) - sidecarConfigIndex(b.id, sidecarEntryIds, sidecarConfigIds);
    }
    const ra = parseTurnRangeSuffix(a.title);
    const rb = parseTurnRangeSuffix(b.title);
    if (!ra && !rb) return a.id.localeCompare(b.id);
    if (!ra) return 1;
    if (!rb) return -1;
    if (ra.start !== rb.start) return ra.start - rb.start;
    if (ra.end !== rb.end) return ra.end - rb.end;
    return a.id.localeCompare(b.id);
  });
}
function computePlotSummaryApplyOrderLayout(lb, sidecarEntryIds, sidecarConfigIds) {
  const groups = lb.groups.slice().sort((a, b) => a.order - b.order);
  const entriesByGroup = {};
  for (const g of groups) {
    const inGroup = lb.entries.filter((e) => e.groupId === g.id);
    entriesByGroup[g.id] = sortPlotSummaryEntriesInGroup(
      inGroup,
      sidecarEntryIds,
      sidecarConfigIds
    ).map((e) => e.id);
  }
  return { entriesByGroup };
}

// src/shared/entry-sort.ts
async function applyPlotSummaryEntrySort(host, lorebookId, sidecarEntryIds, sidecarConfigIds) {
  const id = lorebookId.trim();
  if (!id) return false;
  const lb = await host.lorebook.get(id);
  const groups = Array.isArray(lb.groups) ? lb.groups : [];
  const entries = Array.isArray(lb.entries) ? lb.entries : [];
  const { entriesByGroup } = computePlotSummaryApplyOrderLayout(
    {
      groups: groups.map((g) => ({
        id: String(g.id),
        order: typeof g.order === "number" ? g.order : 0
      })),
      entries: entries.map((e) => ({
        id: String(e.id),
        groupId: typeof e.groupId === "string" ? e.groupId : "",
        title: typeof e.title === "string" ? e.title : "",
        createdAt: typeof e.createdAt === "string" ? e.createdAt : void 0
      }))
    },
    sidecarEntryIds,
    sidecarConfigIds
  );
  await host.lorebook.applyOrder(id, {
    scope: "full",
    entriesByGroup
  });
  return true;
}

// src/batch-write.ts
async function flushPendingLorebookCreates(host, lorebookId, pending, sidecarEntryIds) {
  if (!pending.length) return;
  if (typeof host.lorebook.createEntriesBatch !== "function") {
    for (const item of pending) {
      const created2 = await host.lorebook.createEntry(lorebookId, item.body);
      if (item.sidecarId) sidecarEntryIds[item.sidecarId] = created2.id;
    }
    pending.length = 0;
    return;
  }
  const created = await host.lorebook.createEntriesBatch(
    lorebookId,
    pending.map((p) => p.body)
  );
  for (let i = 0; i < created.length; i++) {
    const sidecarId = pending[i]?.sidecarId;
    if (sidecarId && created[i]?.id) {
      sidecarEntryIds[sidecarId] = created[i].id;
    }
  }
  pending.length = 0;
}

// src/sidecar.ts
async function writeSidecarEntry(host, settings, sidecarEntryIds, sc, reviewed, sidecarKeys, pendingCreates) {
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
  if (pendingCreates) {
    pendingCreates.push({ body, sidecarId: sc.id });
    return "";
  }
  const created = await host.lorebook.createEntry(settings.targetLorebookId, body);
  sidecarEntryIds[sc.id] = created.id;
  return created.id;
}

// src/pipeline.ts
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
  let completedTasks = 0;
  try {
    const settings = await loadMergedSettings(host);
    const targetId = await ensureTargetLorebook(host, settings);
    if (!targetId) {
      return { ok: false, reason: "no_lorebook" };
    }
    settings.targetLorebookId = targetId;
    let lorebookName = await resolveTargetLorebookName(host, targetId);
    const fromTurn = opts.fromTurn;
    const toTurn = opts.toTurn;
    if (fromTurn > toTurn) {
      host.ui.toast(host.t(k(host, "toastInvalidRange")), { color: "warning" });
      return { ok: false, reason: "invalid_range" };
    }
    let sidecarEntryIds;
    try {
      sidecarEntryIds = await host.lorebook.normalizeEntryRefs({
        lorebookId: settings.targetLorebookId,
        entryIds: settings.sidecarEntryIds,
        validKeys: settings.sidecars.map((s) => s.id)
      });
    } catch (e) {
      if (!isLorebookNotFoundError(e)) throw e;
      const recovered = await promptRecoverLorebook(host, settings);
      if (!recovered) {
        return { ok: false, reason: "no_lorebook" };
      }
      settings.targetLorebookId = recovered;
      lorebookName = await resolveTargetLorebookName(host, recovered);
      sidecarEntryIds = await host.lorebook.normalizeEntryRefs({
        lorebookId: settings.targetLorebookId,
        entryIds: {},
        validKeys: settings.sidecars.map((s) => s.id)
      });
    }
    const sidecarConfigIds = settings.sidecars.map((s) => s.id);
    const prepared = await host.plugin.prepareContext({
      fromTurn,
      toTurn,
      targetLorebookId: settings.targetLorebookId,
      previousSummariesLimit: settings.previousSummariesLimit,
      sidecarEntryIds,
      sidecarIds: sidecarConfigIds,
      regexRuleIds: settings.regexRuleIds,
      tailOrdinal: outgoingTailOrdinal(host),
      regexApplyAllTurns: settings.regexApplyAllTurns
    });
    if (!prepared.userContent?.trim()) {
      host.ui.toast(host.t(k(host, "toastNoTurnsInRange")), { color: "warning" });
      return { ok: false, reason: "no_turns" };
    }
    const systemReferenceContext = prepared.systemReferenceContext ?? "";
    const userContent = prepared.userContent;
    const patch = {};
    let done = 0;
    let ranMemory = false;
    let wroteToLorebook = false;
    let skippedTasks = 0;
    let aborted = false;
    const pendingCreates = [];
    host.ui.progress({
      message: host.t(k(host, "progressSummarize")),
      done: 0,
      total: tasks.length,
      indeterminate: true,
      abortable: true,
      abortLabel: host.t(k(host, "progressAbort"))
    });
    setSummarizeBatchProgress({ taskIndex: 0, total: tasks.length });
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
      const task = tasks[taskIndex];
      setSummarizeBatchProgress({ taskIndex, total: tasks.length });
      showCurrentBatchTaskProgress(host);
      try {
        if (task.kind === "memory") {
          const memoryDraft = await generateReviewDraft(host, settings, {
            kind: "memory",
            systemReferenceContext,
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
              systemReferenceContext,
              userContent,
              fromTurn,
              toTurn
            }),
            lorebookName
          );
          bumpTaskProgress2(host, done, tasks.length);
          pendingCreates.push({
            body: {
              title: reviewed.title,
              content: reviewed.content,
              keys: entryKeys(reviewed.keywords),
              triggerMode: settings.defaultEntryTriggerMode,
              priority: 100
            }
          });
          ranMemory = true;
          wroteToLorebook = true;
        } else if (task.kind === "sidecar") {
          const sc = task.sidecar;
          const sidecarDraft = await generateReviewDraft(host, settings, {
            kind: "sidecar",
            systemReferenceContext,
            userContent,
            sc
          });
          const reviewed = await promptReview(
            host,
            sidecarDraft,
            DIALOG_REVIEW_SIDECAR,
            (h) => generateReviewDraft(h, settings, {
              kind: "sidecar",
              systemReferenceContext,
              userContent,
              sc
            }),
            lorebookName
          );
          bumpTaskProgress2(host, done, tasks.length);
          await writeSidecarEntry(
            host,
            settings,
            sidecarEntryIds,
            sc,
            reviewed,
            entryKeys(reviewed.keywords),
            pendingCreates
          );
          wroteToLorebook = true;
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
        console.warn("[plot-summary] task failed", task, e);
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
    if (pendingCreates.length > 0) {
      await flushPendingLorebookCreates(
        host,
        settings.targetLorebookId,
        pendingCreates,
        sidecarEntryIds
      );
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
    if (settings.entrySortMode === "auto-turn-suffix" && wroteToLorebook) {
      await applyPlotSummaryEntrySort(
        host,
        settings.targetLorebookId,
        sidecarEntryIds,
        sidecarConfigIds
      );
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
    if (opts.updateAutoSummarizeCache) {
      refreshAutoSummarizeUi(host);
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
    console.warn("[plot-summary] summarize failed", e);
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

// src/prompt-preview.ts
function auditDebugEnabled(host) {
  const raw = host.session.writeChatPromptSnapshot;
  if (typeof raw === "boolean") return raw;
  if (raw && typeof raw === "object" && "value" in raw) {
    return Boolean(raw.value);
  }
  return false;
}
function joinSystemMessage(reference, instruction) {
  const ref = reference.trim();
  const inst = instruction.trim();
  if (!ref) return inst;
  if (!inst) return ref;
  return `${ref}

${inst}`;
}
function formatContentValue(value, inner) {
  if (!value.includes("\n")) {
    return `${inner}"content": ${JSON.stringify(value)}`;
  }
  const bodyIndent = `${inner}  `;
  const body = value.split("\n").map((line) => bodyIndent + line).join("\n");
  return `${inner}"content": "
${body}
${inner}"`;
}
function formatMessage(msg, indent) {
  const inner = `${indent}  `;
  const roleLine = `${inner}"role": ${JSON.stringify(msg.role)}`;
  const contentLine = formatContentValue(msg.content, inner);
  return `${indent}{
${roleLine},
${contentLine}
${indent}}`;
}
function formatMessagesForDisplay(messages) {
  if (messages.length === 0) return "[]";
  const items = messages.map((m) => formatMessage(m, "  "));
  return `[
${items.join(",\n")}
]`;
}
function taskLabel(host, task) {
  if (task.kind === "memory") return host.t(k(host, "manualTaskMemory"));
  return task.sidecar.name;
}
function resolveSystemPrompt2(host, settings, task) {
  if (task.kind === "sidecar") {
    return sidecarPromptTemplate(host, task.sidecar);
  }
  return settings.systemPromptTemplate;
}
async function expandText(host, text, apiConfigId) {
  const raw = asString(text);
  if (!raw.includes("{{")) return raw;
  if (!host.macros?.expand) return raw;
  return host.macros.expand(raw, apiConfigId ? { apiConfigId } : void 0);
}
async function buildTaskMessages(host, settings, task, prepared) {
  const apiConfigId = settings.apiConfigId;
  const systemTemplate = resolveSystemPrompt2(host, settings, task);
  const [expandedRef, expandedInstruction, expandedUser] = await Promise.all([
    prepared.systemReferenceContext.trim() ? expandText(host, prepared.systemReferenceContext, apiConfigId) : Promise.resolve(""),
    expandText(host, systemTemplate, apiConfigId),
    expandText(host, prepared.userContent, apiConfigId)
  ]);
  const system = joinSystemMessage(expandedRef, expandedInstruction);
  const messages = [];
  if (system.trim()) messages.push({ role: "system", content: system });
  if (expandedUser.trim()) messages.push({ role: "user", content: expandedUser });
  return messages;
}
async function preflightLine(host, settings, messages) {
  const pf = host.token?.preflightComplete;
  if (!pf || messages.length === 0) return "";
  try {
    const result = await pf({
      apiConfigId: settings.apiConfigId || void 0,
      messages
    });
    if (result.ok) {
      return host.t(k(host, "promptPreviewPreflightOk"), {
        tokens: result.promptTokens,
        budget: result.budget
      });
    }
    return host.t(k(host, "promptPreviewPreflightFail"), {
      tokens: result.promptTokens,
      budget: result.budget,
      code: result.code ?? ""
    });
  } catch {
    return "";
  }
}
function summarizeDialogCanPreview(model, settings) {
  const start = asInt(model.startTurn, -1, 5e5);
  const end = asInt(model.endTurn, -1, 5e5);
  if (start < 0 || end < start) return false;
  return tasksFromSelection(settings, model.selectedTasks).length > 0;
}
async function resolveTargetLorebookIdForPreview(host, settings) {
  const id = asString(settings.targetLorebookId);
  if (!id) {
    host.ui.toast(host.t(k(host, "toastTargetLorebookMissingWarn")), { color: "warning" });
    return "";
  }
  try {
    await host.lorebook.get(id);
    return id;
  } catch {
    host.ui.toast(host.t(k(host, "toastTargetLorebookDeleted")), { color: "warning" });
    return "";
  }
}
function registerPromptPreviewDialog(host) {
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, "promptPreviewTitle"),
      bodyKey: k(host, "promptPreviewBody"),
      fields: [
        {
          key: "previewText",
          labelKey: k(host, "promptPreviewTextLabel"),
          type: "textarea",
          readOnly: true
        }
      ],
      submitKey: k(host, "promptPreviewClose"),
      cancelKey: k(host, "sessionCancel"),
      canSubmit: () => true,
      onSubmit: async (h) => {
        const restore = getPromptPreviewRestore();
        clearPromptPreviewRestore();
        if (restore) {
          h.openFormDialog(PLUGIN_ID, restore, DIALOG_MANUAL);
        }
      },
      onCancel: async (h) => {
        const restore = getPromptPreviewRestore();
        clearPromptPreviewRestore();
        if (restore) {
          h.openFormDialog(PLUGIN_ID, restore, DIALOG_MANUAL);
        }
      }
    },
    DIALOG_PROMPT_PREVIEW
  );
}
async function previewManualSummarizePrompt(host, model) {
  if (!auditDebugEnabled(host)) return;
  const settings = await loadMergedSettings(host);
  if (!summarizeDialogCanPreview(model, settings)) {
    host.ui.toast(host.t(k(host, "toastInvalidRange")), { color: "warning" });
    return;
  }
  const fromTurn = asInt(model.startTurn, 0, 5e5);
  const toTurn = asInt(model.endTurn, fromTurn, 5e5);
  const tasks = tasksFromSelection(settings, model.selectedTasks);
  if (tasks.length === 0) {
    host.ui.toast(host.t(k(host, "toastNoTasksSelected")), { color: "warning" });
    return;
  }
  host.ui.progress({
    message: host.t(k(host, "promptPreviewLoading")),
    done: 0,
    total: 1,
    indeterminate: true
  });
  try {
    const targetId = await resolveTargetLorebookIdForPreview(host, settings);
    if (!targetId) return;
    let sidecarEntryIds;
    try {
      sidecarEntryIds = await host.lorebook.normalizeEntryRefs({
        lorebookId: targetId,
        entryIds: settings.sidecarEntryIds,
        validKeys: settings.sidecars.map((s) => s.id)
      });
    } catch {
      sidecarEntryIds = {};
    }
    const prepared = await host.plugin.prepareContext({
      fromTurn,
      toTurn,
      targetLorebookId: targetId,
      previousSummariesLimit: settings.previousSummariesLimit,
      sidecarEntryIds,
      sidecarIds: settings.sidecars.map((s) => s.id),
      regexRuleIds: settings.regexRuleIds,
      tailOrdinal: outgoingTailOrdinal(host),
      regexApplyAllTurns: settings.regexApplyAllTurns
    });
    const sections = [
      host.t(k(host, "promptPreviewRange"), { from: fromTurn, to: toTurn }),
      ""
    ];
    for (const task of tasks) {
      const messages = await buildTaskMessages(host, settings, task, prepared);
      const pf = await preflightLine(host, settings, messages);
      sections.push(`=== ${taskLabel(host, task)} ===`);
      if (pf) sections.push(pf);
      sections.push(formatMessagesForDisplay(messages));
      sections.push("");
    }
    setPromptPreviewRestore({ ...model });
    host.openFormDialog(
      PLUGIN_ID,
      { previewText: sections.join("\n").trim() },
      DIALOG_PROMPT_PREVIEW
    );
  } catch (e) {
    console.warn("[plot-summary] prompt preview failed", e);
    host.ui.toast(host.t(k(host, "promptPreviewFailed")), { color: "error" });
  } finally {
    host.ui.clearProgress();
  }
}

// src/dialogs.ts
function isAutoSummarizeEnabled(host) {
  return host.conversation.getPluginSettingsSnapshot().autoSummarizeEnabled === true;
}
function refreshAutoSummarizeUi(host) {
  host.refreshSlotButtons();
}
async function isTargetLorebookAvailable(host, lorebookId) {
  try {
    await host.lorebook.get(lorebookId);
    return true;
  } catch (e) {
    if (isLorebookNotFoundError(e)) return false;
    throw e;
  }
}
async function applyRecoveredTargetLorebook(host, lorebookId) {
  await host.conversation.patchPluginSettings({
    targetLorebookId: lorebookId,
    sidecarEntryIds: null
  });
}
async function createTargetLorebookFromTemplate(host, settings) {
  const ensured = await host.lorebook.ensure({
    nameTemplate: settings.autoLorebookNameTemplate
  });
  const id = asString(ensured?.id);
  if (!id) {
    host.ui.toast(host.t(k(host, "toastAutoLorebookFailed")), { color: "error" });
    return "";
  }
  host.ui.toast(
    host.t(k(host, "toastAutoLorebookCreated"), { name: ensured.name || id }),
    { color: "success" }
  );
  return id;
}
async function ensureTargetLorebook(host, settings) {
  const existing = asString(settings.targetLorebookId);
  if (existing) {
    if (await isTargetLorebookAvailable(host, existing)) return existing;
    host.ui.toast(host.t(k(host, "toastTargetLorebookDeleted")), { color: "warning" });
    try {
      return await promptRecoverLorebook(host, settings);
    } catch {
      return "";
    }
  }
  if (settings.targetLorebookMode === "auto") {
    try {
      const id = await createTargetLorebookFromTemplate(host, settings);
      if (!id) return "";
      await host.conversation.patchPluginSettings({ targetLorebookId: id });
      return id;
    } catch {
      host.ui.toast(host.t(k(host, "toastAutoLorebookFailed")), { color: "error" });
      return "";
    }
  }
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
function finishLorebookPick(id) {
  const resolver = getLorebookPickResolver();
  if (!resolver) return;
  clearLorebookPickResolver();
  resolver.resolve(id);
}
function cancelLorebookPick() {
  const resolver = getLorebookPickResolver();
  if (!resolver) return;
  clearLorebookPickResolver();
  resolver.reject(new Error("pick_cancelled"));
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
        finishLorebookPick(id);
      },
      onCancel: () => {
        cancelLorebookPick();
      }
    },
    DIALOG_PICK_LOREBOOK
  );
}
function registerRecoverLorebookDialog(host) {
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, "recoverLorebookDialogTitle"),
      bodyKey: k(host, "recoverLorebookDialogBody"),
      fields: [
        {
          key: "mode",
          labelKey: k(host, "recoverLorebookModeLabel"),
          type: "radio",
          options: [
            { value: "pick", labelKey: k(host, "recoverLorebookModePick") },
            { value: "create", labelKey: k(host, "recoverLorebookModeCreate") }
          ]
        },
        {
          key: "targetLorebookId",
          labelKey: k(host, "sessionTargetLorebookLabel"),
          type: "lorebook",
          visibleWhen: { field: "mode", equals: "pick" }
        }
      ],
      submitKey: k(host, "recoverLorebookConfirm"),
      cancelKey: k(host, "sessionCancel"),
      canSubmit: (m) => {
        const mode = asString(m.mode);
        if (mode === "create") return true;
        return mode === "pick" && asString(m.targetLorebookId).length > 0;
      },
      onSubmit: async (h, model) => {
        const mode = asString(model.mode);
        let id = "";
        if (mode === "create") {
          const settings = await loadMergedSettings(h);
          try {
            id = await createTargetLorebookFromTemplate(h, settings);
          } catch {
            h.ui.toast(h.t(k(h, "toastAutoLorebookFailed")), { color: "error" });
            return;
          }
          if (!id) return;
        } else {
          id = asString(model.targetLorebookId);
          if (!id) return;
        }
        await applyRecoveredTargetLorebook(h, id);
        finishLorebookPick(id);
      },
      onCancel: () => {
        cancelLorebookPick();
      }
    },
    DIALOG_RECOVER_LOREBOOK
  );
}
function promptPickLorebook(host) {
  return new Promise((resolve, reject) => {
    host.ui.clearProgress();
    setLorebookPickResolver({ resolve, reject });
    host.openFormDialog(PLUGIN_ID, { targetLorebookId: "" }, DIALOG_PICK_LOREBOOK);
  });
}
function promptRecoverLorebook(host, settings) {
  return new Promise((resolve, reject) => {
    host.ui.clearProgress();
    setLorebookPickResolver({ resolve, reject });
    host.openFormDialog(
      PLUGIN_ID,
      {
        mode: settings.targetLorebookMode === "auto" ? "create" : "pick",
        targetLorebookId: ""
      },
      DIALOG_RECOVER_LOREBOOK
    );
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
    },
    {
      key: "entrySortMode",
      labelKey: k(host, "entrySortModeLabel"),
      type: "radio",
      options: [
        { value: "manual", labelKey: k(host, "entrySortModeManual") },
        { value: "auto-turn-suffix", labelKey: k(host, "entrySortModeAuto-turn-suffix") }
      ],
      hintKey: k(host, "entrySortModeDesc")
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
        const sortMode = asString(model.entrySortMode);
        if (sortMode === "auto-turn-suffix" || sortMode === "manual") {
          patch.entrySortMode = sortMode;
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
      ...!isEnable ? {
        regenerateKey: k(host, "manualPreviewPrompt"),
        regenerateVisible: (h) => auditDebugEnabled(h),
        regenerateCanSubmit: (m) => summarizeDialogCanPreview(m, settings),
        onRegenerate: async (h, model) => {
          await previewManualSummarizePrompt(h, model);
        }
      } : {},
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
            autoSummarizeEnabled: true,
            nextBlockStart: fromTurn,
            autoSidecarIds
          });
          refreshAutoSummarizeUi(h);
        } else {
          await h.conversation.patchPluginSettings({
            manualSummarizeTasks: normalizeManualTaskSelection(
              model.selectedTasks,
              settings.sidecars
            )
          });
        }
        await runSummarizeTasks(h, {
          fromTurn,
          toTurn,
          tasks,
          updatePointers: isEnable || tasks.some((t) => t.kind === "memory"),
          updateAutoSummarizeCache: false
        });
      }
    },
    dialogId
  );
}
async function reorderTargetLorebookNow(host) {
  const settings = await loadMergedSettings(host);
  const targetId = asString(settings.targetLorebookId);
  if (!targetId) {
    host.ui.toast(host.t(k(host, "toastReorderLorebookNoTarget")), { color: "warning" });
    return;
  }
  try {
    const sidecarEntryIds = await host.lorebook.normalizeEntryRefs({
      lorebookId: targetId,
      entryIds: settings.sidecarEntryIds,
      validKeys: settings.sidecars.map((s) => s.id)
    });
    await applyPlotSummaryEntrySort(
      host,
      targetId,
      sidecarEntryIds,
      settings.sidecars.map((s) => s.id)
    );
    host.ui.toast(host.t(k(host, "toastReorderLorebookDone")), { color: "success" });
  } catch (e) {
    console.warn("[plot-summary] reorder lorebook failed", e);
    host.ui.toast(host.t(k(host, "toastTaskSkipped")), { color: "warning" });
  }
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
      sidecarEnabled,
      entrySortMode: s.entrySortMode
    };
    if (s.sidecars.length > 0) {
      model.autoSidecarTasks = s.autoSidecarIds.map((id) => `sidecar:${id}`);
    }
    host.openFormDialog(PLUGIN_ID, model, DIALOG_SESSION);
  });
}
function openManualSummarize(host, preset) {
  loadMergedSettings(host).then((s) => {
    registerSummarizeDialog(host, s, "manual");
    const { startTurn, endTurn } = manualSummarizeDefaultRange(
      s,
      preset,
      maxTurnOrdinal(host)
    );
    host.openFormDialog(
      PLUGIN_ID,
      {
        startTurn,
        endTurn,
        selectedTasks: [...s.manualSummarizeTasks]
      },
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
async function resumeAutoSummarizeEnable(host, settings) {
  const nextBlockStart = normalizedNextBlockStart(
    settings.nextBlockStart,
    settings.lastSummarizedEnd
  );
  const trigger = firstAutoTriggerTurnOrdinal({ ...settings, nextBlockStart });
  const range = currentAutoRange({ ...settings, nextBlockStart });
  await host.conversation.patchPluginSettings({
    autoSummarizeEnabled: true,
    nextBlockStart
  });
  refreshAutoSummarizeUi(host);
  host.ui.toast(
    host.t(k(host, "toastAutoSummarizeResumed"), {
      from: range.fromTurn,
      to: range.toTurn,
      turn: trigger
    }),
    { color: "success" }
  );
}
async function applyShortAutoSummarizeEnable(host, settings) {
  const X = firstAutoTriggerTurnOrdinal({ ...settings, nextBlockStart: 0 });
  const autoSidecarIds = parseAutoSidecarIdsRaw(null, settings.sidecars);
  await host.conversation.patchPluginSettings({
    autoSummarizeEnabled: true,
    nextBlockStart: 0,
    autoSidecarIds
  });
  refreshAutoSummarizeUi(host);
  host.ui.toast(host.t(k(host, "toastAutoSummarizeScheduled"), { turn: X }), {
    color: "success"
  });
}
async function tryEnableAutoSummarize(host) {
  const settings = await loadMergedSettings(host);
  if (hasAutoSummarizeHistory(settings)) {
    await resumeAutoSummarizeEnable(host, settings);
    return;
  }
  const T = maxTurnOrdinal(host);
  const N = settings.blockTurns;
  const buffer = settings.bufferTurns;
  if (T > N + buffer) {
    openEnableLongDialog(host, settings);
    return;
  }
  await applyShortAutoSummarizeEnable(host, settings);
}
async function toggleAutoSummarize(host) {
  if (isAutoSummarizeEnabled(host)) {
    await host.conversation.patchPluginSettings({ autoSummarizeEnabled: false });
    host.ui.toast(host.t(k(host, "toastAutoSummarizeDisabled")), { color: "info" });
    return;
  }
  await tryEnableAutoSummarize(host);
}
function isBusy(host) {
  return host.session.conversationWriteLocked || host.session.loading || host.session.regeneratingTurnOrdinal !== null;
}

// src/lifecycle.ts
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
async function tryBootstrapDefaultAutoSummarize(host, event) {
  if (!event.isFirstTurn) return;
  const conv = await host.conversation.getPluginSettings();
  if (conv.autoSummarizeEnabled === true || conv.autoSummarizeEnabled === false) return;
  const global = await host.plugins.getUserSettings();
  if (!asBool(global.autoSummarizeDefaultEnabled, false)) return;
  const settings = await loadMergedSettings(host);
  await applyShortAutoSummarizeEnable(host, settings);
}
async function handleAutoSummarizeTurn(host, turnOrdinal2) {
  const settings = await loadMergedSettings(host);
  if (!settings.autoSummarizeEnabled) return;
  if (!shouldAutoTrigger(turnOrdinal2, settings)) return;
  const range = currentAutoRange(settings);
  const tasks = resolveAutoTasks(settings);
  await runSummarizeTasks(host, {
    fromTurn: range.fromTurn,
    toTurn: range.toTurn,
    tasks,
    updatePointers: true,
    updateAutoSummarizeCache: false
  });
}
function registerLifecycle(host) {
  host.lifecycle.onAssistantReplyPersisted((event) => {
    const turnOrdinal2 = event.turnOrdinal;
    if (typeof turnOrdinal2 !== "number" || turnOrdinal2 < 0) return;
    scheduleWhenConversationIdle(host, async () => {
      try {
        await tryBootstrapDefaultAutoSummarize(host, event);
        await handleAutoSummarizeTurn(host, turnOrdinal2);
      } catch (e) {
        console.warn("[plot-summary] auto summarize failed", e);
      }
    });
  });
}

// src/range-picker.ts
var RANGE_STYLES = `
.plugin-slot.cm-range-start--active {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}
.plugin-slot.cm-range-end--ready:not(:disabled) {
  color: rgb(var(--v-theme-primary));
}
`;
function turnOrdinal(ctx) {
  const n = ctx.turn?.turnOrdinal;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}
function controlsDisabled(host) {
  return summarizeRunning || isBusy(host);
}
function onRangeStartClick(host, ctx) {
  const ord = turnOrdinal(ctx);
  if (ord === null || controlsDisabled(host)) return;
  setRangeStartTurn(ord);
  host.refreshSlotButtons();
}
function onRangeEndClick(host, ctx) {
  const ord = turnOrdinal(ctx);
  const start = getRangeStartTurn();
  if (controlsDisabled(host)) return;
  if (start === null) {
    host.ui.toast(host.t(k(host, "toastRangeStartRequired")), { color: "warning" });
    return;
  }
  if (ord === null || ord < start) {
    host.ui.toast(host.t(k(host, "toastInvalidRange")), { color: "warning" });
    return;
  }
  openManualSummarize(host, { startTurn: start, endTurn: ord });
}
function registerRangePicker(host) {
  host.registerStyles(RANGE_STYLES);
  host.registerSlotButton("turn-block-head", {
    id: `${PLUGIN_ID}-range-start`,
    icon: (ctx) => {
      const ord = turnOrdinal(ctx);
      const start = getRangeStartTurn();
      return ord !== null && start === ord ? "mdi-arrow-right-drop-circle" : "mdi-arrow-right-drop-circle-outline";
    },
    class: (ctx) => {
      const ord = turnOrdinal(ctx);
      const start = getRangeStartTurn();
      return ord !== null && start === ord ? "cm-range-start--active" : "";
    },
    tooltipKey: k(host, "tooltipRangeStart"),
    when: (ctx) => turnOrdinal(ctx) !== null,
    disabled: () => controlsDisabled(host),
    onClick: (ctx) => onRangeStartClick(host, ctx)
  });
  host.registerSlotButton("turn-block-head", {
    id: `${PLUGIN_ID}-range-end`,
    icon: "mdi-arrow-left-drop-circle-outline",
    class: (ctx) => {
      const ord = turnOrdinal(ctx);
      const start = getRangeStartTurn();
      if (start === null || ord === null) return "";
      return ord >= start ? "cm-range-end--ready" : "";
    },
    tooltipKey: k(host, "tooltipRangeEnd"),
    when: (ctx) => turnOrdinal(ctx) !== null,
    disabled: (ctx) => {
      if (controlsDisabled(host)) return true;
      const ord = turnOrdinal(ctx);
      const start = getRangeStartTurn();
      if (start === null || ord === null) return true;
      return ord < start;
    },
    onClick: (ctx) => onRangeEndClick(host, ctx)
  });
}

// src/index.ts
function isAutoSummarizeEnabled2(host) {
  return host.conversation.getPluginSettingsSnapshot().autoSummarizeEnabled === true;
}
function register(host) {
  registerReviewDialogs(host);
  registerPromptPreviewDialog(host);
  registerPickLorebookDialog(host);
  registerRecoverLorebookDialog(host);
  host.conversation.onPluginSettingsChanged(() => {
    refreshAutoSummarizeUi(host);
  });
  void host.conversation.getPluginSettings();
  host.registerSlotButton("composer-toolbar", {
    id: `${PLUGIN_ID}-menu`,
    icon: "mdi-book-open-page-variant",
    tooltipKey: k(host, "tooltipPlugin"),
    filled: () => isAutoSummarizeEnabled2(host),
    menu: [
      {
        id: `${PLUGIN_ID}-auto-summarize`,
        labelKey: k(host, "tooltipAutoSummarize"),
        icon: "mdi-book-open-page-variant",
        filled: () => isAutoSummarizeEnabled2(host),
        disabled: () => summarizeRunning,
        onClick: () => {
          void toggleAutoSummarize(host);
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
      },
      {
        id: `${PLUGIN_ID}-reorder`,
        labelKey: k(host, "tooltipReorderLorebook"),
        icon: "mdi-sort",
        disabled: () => isBusy(host) || summarizeRunning,
        onClick: () => {
          void reorderTargetLorebookNow(host);
        }
      }
    ]
  });
  registerRangePicker(host);
  registerLifecycle(host);
}
export {
  register
};
