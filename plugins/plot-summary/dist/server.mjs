// plugins/plot-summary/src/shared/utils.ts
function asString(v) {
  return typeof v === "string" ? v.trim() : "";
}

// plugins/plot-summary/src/shared/summarize.ts
var PLOT_SUMMARY_ENTRY_TITLE_RE = /^\[MEMO-(\d+)\]-(.+)-\[(\d+)-(\d+)\]$/;
function parseModelJson(text) {
  let raw = (text ?? "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        throw new Error("parse_failed");
      }
    }
    throw new Error("parse_failed");
  }
}
function coerceDraftText(value) {
  if (typeof value === "string") return value.trim();
  if (value != null && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}
function normalizeSidecarPayload(sidecarName, obj) {
  if (!obj || typeof obj !== "object") throw new Error("parse_failed");
  const o = obj;
  const title = sidecarName.trim() || asString(o.title);
  let content = coerceDraftText(o.content) || coerceDraftText(o.state) || coerceDraftText(o.summary) || asString(o.title);
  if (!title || !content) throw new Error("parse_failed");
  let keywords = [];
  if (Array.isArray(o.keywords)) {
    keywords = o.keywords.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean);
  }
  return { title, content, keywords };
}
function normalizeSummaryPayload(obj) {
  if (!obj || typeof obj !== "object") throw new Error("parse_failed");
  const o = obj;
  const title = asString(o.title);
  const content = typeof o.content === "string" ? o.content : "";
  if (!title || !content.trim()) throw new Error("parse_failed");
  let keywords = [];
  if (Array.isArray(o.keywords)) {
    keywords = o.keywords.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean);
  }
  return { title, content: content.trim(), keywords };
}
function parsePlotSummaryEntryTitle(title) {
  const m = (title ?? "").trim().match(PLOT_SUMMARY_ENTRY_TITLE_RE);
  if (!m) return null;
  const memoIndex = Number(m[1]);
  const start = Number(m[3]);
  const end = Number(m[4]);
  if (!Number.isFinite(memoIndex) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return { memoIndex, coreTitle: m[2].trim(), start, end };
}
function extractSummaryCoreTitle(rawTitle) {
  const t = rawTitle.trim();
  const parsed = parsePlotSummaryEntryTitle(t);
  if (parsed?.coreTitle) return parsed.coreTitle;
  return t || "\u6458\u8981";
}
function resolveMemoIndex(rawTitle, fromTurn, blockTurns) {
  const parsed = parsePlotSummaryEntryTitle(rawTitle.trim());
  if (parsed) return parsed.memoIndex;
  const bt = Math.max(1, Math.round(blockTurns));
  return Math.floor(Math.max(0, fromTurn) / bt) + 1;
}
function formatEntryTitle(rawTitle, startTurn, endTurn, blockTurns = 15) {
  const title = extractSummaryCoreTitle(rawTitle);
  const memoIndex = resolveMemoIndex(rawTitle, startTurn, blockTurns);
  return `[MEMO-${memoIndex}]-${title}-[${startTurn}-${endTurn}]`;
}

// plugins/plot-summary/src/shared/summary-prompt-layout.ts
var PLOT_SUMMARY_COMPLETE_LAYOUT = {
  messages: [
    { role: "system", content: "{{blocks.reference}}" },
    { role: "user", content: "{{blocks.history}}" },
    { role: "system", content: "{{plugin.systemPromptTemplate}}" }
  ]
};

// plugins/plot-summary/src/shared/prepare-context-blocks.ts
function buildPreviousSummariesBlock(entries) {
  if (entries.length === 0) return "";
  const body = entries.map((e) => {
    const title = e.title.trim();
    const content = (e.content ?? "").trim();
    return `## ${title}
${content}`;
  }).join("\n\n");
  return `<previous-summaries readonly>
${body}
</previous-summaries>

`;
}
function buildSidecarsBlock(entries) {
  if (entries.length === 0) return "";
  const body = entries.map((e) => {
    const title = e.title.trim();
    const content = (e.content ?? "").trim();
    return `## ${title}
${content}`;
  }).join("\n\n");
  return `<sidecars readonly>
${body}
</sidecars>

`;
}
function buildHistoryBlock(transcript) {
  const body = (transcript ?? "").trim();
  if (!body) return "";
  return `<history>
${body}
</history>`;
}

// plugins/plot-summary/src/shared/plot-summary-context-blocks.ts
var PS_BLOCK_PREV = "prevSummaries";
var PS_BLOCK_SIDECARS = "sidecars";
var PS_BLOCK_HISTORY_RAW = "historyRaw";
function slicesToTitleContent(entries) {
  return entries.map((e) => ({
    title: e.title,
    content: e.content
  }));
}
function formatPlotSummaryLayoutBlocks(resolved) {
  const prev = resolved.entriesByBlock[PS_BLOCK_PREV] ?? [];
  const sidecars = resolved.entriesByBlock[PS_BLOCK_SIDECARS] ?? [];
  const historyRaw = resolved.blocks[PS_BLOCK_HISTORY_RAW] ?? "";
  const prevBlock = buildPreviousSummariesBlock(slicesToTitleContent(prev));
  const sidecarBlock = buildSidecarsBlock(slicesToTitleContent(sidecars));
  const historyBlock = buildHistoryBlock(historyRaw);
  const reference = `${prevBlock}${sidecarBlock}`.trim();
  const history = historyBlock.trim();
  return {
    reference,
    history
  };
}

// plugins/plot-summary/src/server/complete-context-hooks.ts
function formatPluginContextBlocks(resolved, _ctx) {
  return formatPlotSummaryLayoutBlocks(resolved);
}
function sidecarNameFromSettings(settings) {
  const raw = settings?.sidecarName;
  return typeof raw === "string" ? raw.trim() : "";
}
function parseCompleteDraftContent(ctx, content, _api) {
  const raw = parseModelJson(content);
  if (ctx.kind === "sidecar") {
    const sidecarName = sidecarNameFromSettings(ctx.pluginSettings);
    const sidecar = normalizeSidecarPayload(sidecarName, raw);
    return {
      draft: {
        title: sidecarName || sidecar.title,
        content: sidecar.content,
        keywords: sidecar.keywords
      }
    };
  }
  const summary = normalizeSummaryPayload(raw);
  const fromTurn = typeof ctx.fromTurn === "number" ? ctx.fromTurn : 0;
  const toTurn = typeof ctx.toTurn === "number" ? ctx.toTurn : fromTurn;
  const blockTurns = typeof ctx.blockTurns === "number" && Number.isFinite(ctx.blockTurns) ? Math.max(1, Math.round(ctx.blockTurns)) : 15;
  const entryTitle = formatEntryTitle(summary.title, fromTurn, toTurn, blockTurns);
  return {
    draft: {
      title: entryTitle,
      content: summary.content,
      keywords: summary.keywords
    }
  };
}
export {
  PLOT_SUMMARY_COMPLETE_LAYOUT,
  formatPluginContextBlocks,
  parseCompleteDraftContent
};
