// plugins/plot-summary/src/shared/utils.ts
function asString(v) {
  return typeof v === "string" ? v.trim() : "";
}

// plugins/plot-summary/src/shared/summarize.ts
function parseModelJson(text) {
  let raw = (text ?? "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("parse_failed");
  }
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
function formatEntryTitle(rawTitle, startTurn, endTurn) {
  const base = rawTitle.trim();
  const suffix = `-${startTurn}-${endTurn}`;
  if (/-\d+-\d+$/.test(base)) {
    return base.replace(/-\d+-\d+$/, suffix);
  }
  return `${base}${suffix}`;
}

// plugins/plot-summary/src/shared/build-summary-messages.ts
function buildSummaryCompleteMessages(systemReferenceContext, userContent, systemPromptTemplate) {
  const reference = systemReferenceContext.trim();
  const history = userContent.trim();
  const instruction = systemPromptTemplate.trim();
  const messages = [];
  if (reference) messages.push({ role: "system", content: reference });
  if (history) messages.push({ role: "user", content: history });
  if (instruction) messages.push({ role: "system", content: instruction });
  return messages;
}

// plugins/plot-summary/src/server/complete-draft.ts
var UPSTREAM_RETRY_MAX = 3;
var PIPELINE_FATAL = /* @__PURE__ */ new Set(["context_exceeded", "context_length_unconfigured"]);
var UPSTREAM_RETRY = /* @__PURE__ */ new Set(["plugin_complete_failed", "preflight_failed"]);
async function expandText(api, text, conversationId, apiConfigId, toTurn) {
  const raw = asString(text);
  if (!raw.includes("{{")) return raw;
  return api.runPluginMacroExpand({
    text: raw,
    conversationId,
    apiConfigId,
    ...typeof toTurn === "number" ? { toTurn } : {}
  });
}
async function assertPreflight(api, conversationId, apiConfigId, messages) {
  if (messages.length === 0) {
    throw new Error("preflight_failed");
  }
  const pf = await api.runPluginCompletePreflight({
    apiConfigId,
    conversationId,
    messages
  });
  if (pf.ok) return;
  if (pf.code === "context_exceeded") {
    const err = new Error("context_exceeded");
    err.promptTokens = pf.promptTokens;
    err.budget = pf.budget;
    throw err;
  }
  if (pf.code === "context_length_unconfigured") {
    throw new Error("context_length_unconfigured");
  }
  throw new Error("preflight_failed");
}
async function callCompleteOnce(api, conversationId, apiConfigId, systemReferenceContext, systemPromptTemplate, userContent, toTurn) {
  const anchorToTurn = typeof toTurn === "number" && Number.isInteger(toTurn) ? toTurn : void 0;
  const [expandedRef, expandedInstruction, expandedUser] = await Promise.all([
    systemReferenceContext.trim() ? expandText(
      api,
      systemReferenceContext,
      conversationId,
      apiConfigId ?? "",
      anchorToTurn
    ) : Promise.resolve(""),
    expandText(
      api,
      systemPromptTemplate,
      conversationId,
      apiConfigId ?? "",
      anchorToTurn
    ),
    expandText(api, userContent, conversationId, apiConfigId ?? "", anchorToTurn)
  ]);
  const messages = buildSummaryCompleteMessages(
    expandedRef,
    expandedUser,
    expandedInstruction
  );
  await assertPreflight(api, conversationId, apiConfigId, messages);
  const result = await api.runPluginComplete({
    apiConfigId,
    conversationId,
    messages,
    responseFormat: "json_object"
  });
  if (!result.ok) {
    throw new Error(result.code || "plugin_complete_failed");
  }
  return result;
}
async function callCompleteWithRetry(api, conversationId, apiConfigId, systemReferenceContext, systemPromptTemplate, userContent, toTurn) {
  let lastErr = null;
  for (let attempt = 1; attempt <= UPSTREAM_RETRY_MAX; attempt++) {
    try {
      return await callCompleteOnce(
        api,
        conversationId,
        apiConfigId,
        systemReferenceContext,
        systemPromptTemplate,
        userContent,
        toTurn
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (PIPELINE_FATAL.has(msg)) throw e;
      if (UPSTREAM_RETRY.has(msg) && attempt < UPSTREAM_RETRY_MAX) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error("plugin_complete_failed");
}
async function completeDraft(ctx, api) {
  const result = await callCompleteWithRetry(
    api,
    ctx.conversationId,
    ctx.apiConfigId,
    ctx.systemReferenceContext ?? "",
    ctx.systemPromptTemplate,
    ctx.userContent,
    ctx.toTurn
  );
  const raw = parseModelJson(result.content);
  if (ctx.kind === "sidecar") {
    const parsed = raw;
    const sidecar = normalizeSummaryPayload({
      title: ctx.sidecarName || asString(parsed.title),
      content: parsed.content ?? parsed.title,
      keywords: parsed.keywords
    });
    return {
      draft: {
        title: ctx.sidecarName || sidecar.title,
        content: sidecar.content,
        keywords: sidecar.keywords
      },
      usage: result.usage,
      latencyMs: result.latencyMs
    };
  }
  const summary = normalizeSummaryPayload(raw);
  const fromTurn = typeof ctx.fromTurn === "number" ? ctx.fromTurn : 0;
  const toTurn = typeof ctx.toTurn === "number" ? ctx.toTurn : fromTurn;
  const entryTitle = formatEntryTitle(summary.title, fromTurn, toTurn);
  return {
    draft: {
      title: entryTitle,
      content: summary.content,
      keywords: summary.keywords
    },
    usage: result.usage,
    latencyMs: result.latencyMs
  };
}
export {
  completeDraft
};
