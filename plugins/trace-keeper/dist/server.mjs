// plugins/trace-keeper/src/constants.ts
var PLUGIN_ID = "trace-keeper";
var DEFAULT_BUNDLE_ID = "scene-tracker-default";
var BLOCK_TAG = "ex-trace-keeper";
var MAX_STATE_BYTES = 65536;

// plugins/trace-keeper/bundles/scene-tracker-default/sample-state.json
var sample_state_default = {
  scene: {
    location: "\u672A\u77E5\u5730\u70B9",
    time: "\u672A\u77E5\u65F6\u95F4",
    weather: "\u672A\u77E5"
  },
  mood: "\u5E73\u9759",
  notes: ""
};

// plugins/trace-keeper/bundles/scene-tracker-default/template.hbs
var template_default = '<div class="trace-keeper-panel">\r\n  <h4 class="tk-title">\u573A\u666F\u8FFD\u8E2A</h4>\r\n  <dl class="tk-fields">\r\n    <dt>\u5730\u70B9</dt>\r\n    <dd>{{data.scene.location}}</dd>\r\n    <dt>\u65F6\u95F4</dt>\r\n    <dd>{{data.scene.time}}</dd>\r\n    <dt>\u5929\u6C14</dt>\r\n    <dd>{{data.scene.weather}}</dd>\r\n    <dt>\u6C1B\u56F4</dt>\r\n    <dd>{{data.mood}}</dd>\r\n  </dl>\r\n  {{#if data.notes}}\r\n  <p class="tk-notes">{{data.notes}}</p>\r\n  {{/if}}\r\n  <p class="tk-meta text-caption">epoch {{meta.epoch}}{{#if meta.turnOrdinal}} \xB7 \u7B2C {{meta.turnOrdinal}} \u8F6E{{/if}}</p>\r\n</div>\r\n';

// plugins/trace-keeper/bundles/scene-tracker-default/stylesheet.css
var stylesheet_default = ".trace-keeper-panel {\r\n  font-size: 0.875rem;\r\n  line-height: 1.45;\r\n}\r\n\r\n.trace-keeper-panel .tk-title {\r\n  margin: 0 0 8px;\r\n  font-weight: 600;\r\n  font-size: 0.95rem;\r\n}\r\n\r\n.trace-keeper-panel .tk-fields {\r\n  margin: 0 0 8px;\r\n  display: grid;\r\n  grid-template-columns: auto 1fr;\r\n  gap: 4px 10px;\r\n}\r\n\r\n.trace-keeper-panel .tk-fields dt {\r\n  margin: 0;\r\n  opacity: 0.72;\r\n}\r\n\r\n.trace-keeper-panel .tk-fields dd {\r\n  margin: 0;\r\n}\r\n\r\n.trace-keeper-panel .tk-notes {\r\n  margin: 8px 0 0;\r\n  padding: 8px;\r\n  border-radius: 6px;\r\n  background: rgba(var(--v-theme-on-surface), 0.04);\r\n}\r\n\r\n.trace-keeper-panel .tk-meta {\r\n  margin: 10px 0 0;\r\n  opacity: 0.55;\r\n}\r\n";

// plugins/trace-keeper/src/default-prompt.ts
var DEFAULT_SYSTEM_PROMPT_TEMPLATE = [
  "You are maintaining a structured RP scene state for the Trace Keeper plugin.",
  `After your in-character reply, append a block: <${BLOCK_TAG}>{pure JSON}</${BLOCK_TAG}>.`,
  "The JSON must match the sample structure below. Update fields to reflect the current scene; do not copy sample placeholder values verbatim."
].join("\n");

// plugins/trace-keeper/src/bundle-resolve.ts
var DEFAULT_TRACE_BUNDLE = {
  id: DEFAULT_BUNDLE_ID,
  label: "Scene Tracker (default)",
  sampleState: sample_state_default,
  template: template_default,
  stylesheet: stylesheet_default,
  systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE
};
function isPlainObject(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}
function parseSampleStateJson(raw) {
  if (typeof raw !== "string" || !raw.trim()) return void 0;
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function parseUserBundleEntry(raw) {
  if (!isPlainObject(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;
  const out = { id };
  if (typeof raw.label === "string" && raw.label.trim()) {
    out.label = raw.label.trim();
  }
  if (typeof raw.systemPromptTemplate === "string" && raw.systemPromptTemplate.trim()) {
    out.systemPromptTemplate = raw.systemPromptTemplate.trim();
  }
  const fromJson = parseSampleStateJson(raw.sampleStateJson);
  if (fromJson) {
    out.sampleState = fromJson;
  } else if (isPlainObject(raw.sampleState)) {
    out.sampleState = raw.sampleState;
  }
  if (typeof raw.template === "string" && raw.template.trim()) {
    out.template = raw.template;
  }
  if (typeof raw.stylesheet === "string") {
    out.stylesheet = raw.stylesheet;
  }
  return out;
}
function collectUserBundles(user) {
  const out = {};
  const listRaw = user.bundleList;
  const list = Array.isArray(listRaw) ? listRaw : typeof listRaw === "string" ? (() => {
    try {
      const parsed = JSON.parse(listRaw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })() : [];
  for (const item of list) {
    const entry = parseUserBundleEntry(item);
    if (!entry) continue;
    out[entry.id] = { ...out[entry.id], ...entry };
  }
  const legacy = user.bundles;
  if (isPlainObject(legacy)) {
    for (const [key, val] of Object.entries(legacy)) {
      if (!isPlainObject(val)) continue;
      const entry = parseUserBundleEntry({ ...val, id: key });
      if (!entry) continue;
      out[entry.id] = { ...out[entry.id], ...entry };
    }
  }
  return out;
}
function mergeBundlePartial(base, partial) {
  const next = { ...base };
  if (typeof partial.label === "string" && partial.label.trim()) {
    next.label = partial.label.trim();
  }
  if (isPlainObject(partial.sampleState)) {
    next.sampleState = partial.sampleState;
  }
  if (typeof partial.template === "string" && partial.template.trim()) {
    next.template = partial.template;
  }
  if (typeof partial.stylesheet === "string") {
    next.stylesheet = partial.stylesheet;
  }
  if (typeof partial.systemPromptTemplate === "string" && partial.systemPromptTemplate.trim()) {
    next.systemPromptTemplate = partial.systemPromptTemplate.trim();
  }
  return next;
}
function shellBundle(id, embedded) {
  if (id === embedded.id) return { ...embedded, id };
  return {
    id,
    label: id,
    sampleState: {},
    template: '<div class="trace-keeper-panel"><pre>{{json data}}</pre></div>',
    stylesheet: ".trace-keeper-panel { font-size: 0.875rem; }",
    systemPromptTemplate: embedded.systemPromptTemplate
  };
}
function resolveTraceBundle(opts) {
  const embedded = opts.embeddedBundle ?? DEFAULT_TRACE_BUNDLE;
  const user = opts.userSettings ?? {};
  const conv = opts.convSettings ?? {};
  const userBundles = collectUserBundles(user);
  const convOverride = conv.bundleOverride;
  const convBundle = isPlainObject(conv.bundle) ? conv.bundle : null;
  const bundleId = typeof conv.bundleId === "string" && conv.bundleId.trim() || typeof user.activeBundleId === "string" && user.activeBundleId.trim() || embedded.id;
  let base = shellBundle(bundleId, embedded);
  const fromUser = userBundles[bundleId];
  if (fromUser) {
    base = mergeBundlePartial(base, fromUser);
  }
  if (convBundle) {
    base = mergeBundlePartial(base, convBundle);
  }
  if (isPlainObject(convOverride)) {
    base = mergeBundlePartial(base, convOverride);
  }
  if (!base.systemPromptTemplate?.trim()) {
    base.systemPromptTemplate = DEFAULT_SYSTEM_PROMPT_TEMPLATE;
  }
  return base;
}
function trackerEpochFromSettings(convSettings) {
  const n = convSettings?.trackerEpoch;
  if (typeof n === "number" && Number.isFinite(n)) return Math.max(0, Math.round(n));
  return 0;
}

// plugins/trace-keeper/src/parse-block.ts
var BLOCK_RE = new RegExp(
  `<${BLOCK_TAG}>\\s*([\\s\\S]*?)\\s*<\\/${BLOCK_TAG}>`,
  "gi"
);
function weakValidateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return true;
}
function parseTraceKeeperJson(raw) {
  const text = raw.trim();
  if (!text || text.length > MAX_STATE_BYTES) return null;
  try {
    const parsed = JSON.parse(text);
    return weakValidateState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function stripTraceKeeperBlocks(assistantContent) {
  return assistantContent.replace(BLOCK_RE, "").trim();
}
function extractTraceKeeperState(assistantContent) {
  const content = assistantContent.trim();
  if (!content) return null;
  let last = null;
  for (const match of content.matchAll(BLOCK_RE)) {
    const inner = typeof match[1] === "string" ? match[1] : "";
    const state = parseTraceKeeperJson(inner);
    if (state) last = state;
  }
  return last;
}

// plugins/trace-keeper/src/trace-state-resolve.ts
function payloadReceiveId(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const raw = payload.receiveId;
  return typeof raw === "string" ? raw.trim() : "";
}
function activeReceiveId(ctx) {
  const receives = ctx?.receives;
  if (!receives?.length) return void 0;
  const idx = Math.min(
    Math.max(0, Math.floor(ctx?.activeReceiveIndex ?? 0)),
    receives.length - 1
  );
  const id = receives[idx]?.id;
  return typeof id === "string" && id.trim() ? id.trim() : void 0;
}
function payloadFromEntry(raw, epoch) {
  const payload = raw.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const state = payload.state;
  const payloadEpoch = payload.epoch;
  const entryEpoch = typeof payloadEpoch === "number" && Number.isFinite(payloadEpoch) ? Math.round(payloadEpoch) : 0;
  if (entryEpoch !== epoch) return null;
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const receiveId = payloadReceiveId(payload);
  return {
    state,
    epoch: entryEpoch,
    ...receiveId ? { receiveId } : {}
  };
}
function findTracePayloadInTurnPlugins(plugins, epoch, ctx) {
  const targetReceiveId = activeReceiveId(ctx);
  const list = Array.isArray(plugins) ? plugins : [];
  if (targetReceiveId) {
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      if (raw.pluginId !== PLUGIN_ID) continue;
      const hit = payloadFromEntry(raw, epoch);
      if (hit?.receiveId === targetReceiveId) return hit;
    }
    return null;
  }
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const raw = list[i];
    if (!raw || typeof raw !== "object") continue;
    if (raw.pluginId !== PLUGIN_ID) continue;
    const hit = payloadFromEntry(raw, epoch);
    if (hit) return hit;
  }
  return null;
}
function turnLookup(turn) {
  return {
    activeReceiveIndex: turn.activeReceiveIndex,
    receives: turn.receives
  };
}
function resolveLiveTraceStates(turns, epoch, limit) {
  const cap = Math.max(0, Math.floor(limit));
  if (cap <= 0 || turns.length === 0) return [];
  const out = [];
  for (let i = turns.length - 1; i >= 0 && out.length < cap; i -= 1) {
    const turn = turns[i];
    const hit = findTracePayloadInTurnPlugins(turn.plugins, epoch, turnLookup(turn));
    if (hit) {
      out.push({ state: hit.state, turnOrdinal: turn.turnOrdinal });
    }
  }
  out.reverse();
  return out;
}

// plugins/trace-keeper/src/live-state-settings.ts
var LIVE_STATE_TURN_COUNT_MIN = 0;
var LIVE_STATE_TURN_COUNT_MAX = 8;
var LIVE_STATE_TURN_COUNT_DEFAULT = 1;
function normalizeLiveStateTurnCount(raw) {
  if (typeof raw === "string" && raw.trim() === "") {
    return LIVE_STATE_TURN_COUNT_DEFAULT;
  }
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : typeof raw === "string" ? Number.parseInt(raw, 10) : LIVE_STATE_TURN_COUNT_DEFAULT;
  if (!Number.isFinite(n)) return LIVE_STATE_TURN_COUNT_DEFAULT;
  return Math.max(
    LIVE_STATE_TURN_COUNT_MIN,
    Math.min(LIVE_STATE_TURN_COUNT_MAX, n)
  );
}
function resolveLiveStateTurnCount(userSettings, convSettings) {
  const conv = convSettings ?? {};
  if (Object.prototype.hasOwnProperty.call(conv, "liveStateTurnCount")) {
    const raw = conv.liveStateTurnCount;
    if (raw !== null && raw !== void 0 && raw !== "") {
      return normalizeLiveStateTurnCount(raw);
    }
  }
  return normalizeLiveStateTurnCount(userSettings?.liveStateTurnCount);
}

// plugins/trace-keeper/src/tracker-prompt.ts
function formatLiveStateJson(liveStates, sampleState) {
  if (liveStates.length === 0) {
    return JSON.stringify(sampleState, null, 2);
  }
  if (liveStates.length === 1) {
    return JSON.stringify(liveStates[0].state, null, 2);
  }
  return liveStates.map(
    (entry) => `/* turn ${entry.turnOrdinal} */
${JSON.stringify(entry.state, null, 2)}`
  ).join("\n\n");
}
function buildTrackerSystemPrompt(bundle, liveStates) {
  const prefix = bundle.systemPromptTemplate?.trim() || DEFAULT_SYSTEM_PROMPT_TEMPLATE;
  const sampleJson = JSON.stringify(bundle.sampleState, null, 2);
  const liveJson = formatLiveStateJson(liveStates, bundle.sampleState);
  const liveHeader = liveStates.length > 1 ? "--- current live state history (newest last) ---" : "--- current live state (update from this) ---";
  return [
    prefix,
    "--- sample structure (reference only) ---",
    sampleJson,
    liveHeader,
    liveJson
  ].join("\n");
}

// plugins/trace-keeper/src/server/separate-regenerate.ts
var SEPARATE_PREFIX = [
  "Generate ONLY a single JSON object for the Trace Keeper scene state.",
  "Do not include markdown fences, XML tags, or roleplay prose.",
  "Match the sample structure exactly."
].join("\n");
function buildSeparateSystemPrompt(bundle, liveStates) {
  return [SEPARATE_PREFIX, buildTrackerSystemPrompt(bundle, liveStates)].join("\n\n");
}
function activeReceive(turn) {
  const receives = turn.receives;
  if (!receives.length) return null;
  const idx = Math.min(
    Math.max(0, Math.floor(turn.activeReceiveIndex)),
    receives.length - 1
  );
  return receives[idx] ?? null;
}
async function regenerateSeparateState(input, api) {
  const conversationId = input.conversationId.trim();
  if (!conversationId) return { ok: false, code: "invalid_conversation_id" };
  const [userSettings, convSettings, tail] = await Promise.all([
    api.getUserPluginSettings(PLUGIN_ID),
    api.getConversationPluginSettings(conversationId, PLUGIN_ID),
    api.readConversationTurnsTail(conversationId, 500)
  ]);
  if (!tail.length) return { ok: false, code: "no_turns" };
  const targetOrdinal = typeof input.turnOrdinal === "number" && Number.isFinite(input.turnOrdinal) ? Math.round(input.turnOrdinal) : tail[tail.length - 1].turnOrdinal;
  const turn = tail.find((t) => t.turnOrdinal === targetOrdinal);
  if (!turn) return { ok: false, code: "turn_not_found" };
  const receive = activeReceive(turn);
  if (!receive?.id) return { ok: false, code: "receive_not_found" };
  const assistantText = stripTraceKeeperBlocks(receive.content);
  if (!assistantText) return { ok: false, code: "assistant_content_empty" };
  const bundle = resolveTraceBundle({
    userSettings,
    convSettings,
    embeddedBundle: DEFAULT_TRACE_BUNDLE
  });
  const epoch = trackerEpochFromSettings(convSettings);
  const turnCount = resolveLiveStateTurnCount(userSettings, convSettings);
  const priorTurns = tail.filter((t) => t.turnOrdinal < targetOrdinal);
  const liveStates = resolveLiveTraceStates(
    priorTurns,
    epoch,
    Math.max(0, turnCount - 1)
  );
  const systemText = buildSeparateSystemPrompt(bundle, liveStates);
  const userContent = [
    "Based on the assistant reply below, output updated scene state JSON.",
    "---",
    assistantText
  ].join("\n");
  const result = await api.runPluginComplete({
    conversationId,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: userContent }
    ],
    responseFormat: "json_object"
  });
  if (!result.ok) return { ok: false, code: result.code };
  const state = parseTraceKeeperJson(result.content);
  if (!state) return { ok: false, code: "parse_failed" };
  const entry = {
    pluginId: PLUGIN_ID,
    schemaVersion: 1,
    payload: { state, epoch, receiveId: receive.id }
  };
  return {
    ok: true,
    state,
    turnOrdinal: targetOrdinal,
    receiveId: receive.id,
    entry
  };
}

// plugins/trace-keeper/src/server/index.ts
async function resolveTraceKeeperInjection(ctx, api) {
  if (ctx.pluginId !== PLUGIN_ID) return null;
  const conversationId = ctx.macroContext.conversationId?.trim();
  if (!conversationId) return null;
  const [userSettings, convSettings] = await Promise.all([
    api.getUserPluginSettings(PLUGIN_ID),
    api.getConversationPluginSettings(conversationId, PLUGIN_ID)
  ]);
  const bundle = resolveTraceBundle({
    userSettings,
    convSettings,
    embeddedBundle: DEFAULT_TRACE_BUNDLE
  });
  const epoch = trackerEpochFromSettings(convSettings);
  const turnCount = resolveLiveStateTurnCount(userSettings, convSettings);
  let liveStates = [];
  if (turnCount > 0) {
    const tail = await api.readConversationTurnsTail(conversationId, turnCount);
    liveStates = resolveLiveTraceStates(tail, epoch, turnCount);
  }
  return {
    systemText: buildTrackerSystemPrompt(bundle, liveStates)
  };
}
async function resolveAfterAssemblePromptsAddition(ctx, api) {
  const injection = await resolveTraceKeeperInjection(ctx, api);
  if (!injection) return null;
  return [{ role: "system", content: injection.systemText }];
}
async function afterAssemblePrompts(ctx, api) {
  const addition = await resolveAfterAssemblePromptsAddition(ctx, api);
  if (!addition) return ctx.messages;
  return [...ctx.messages, ...addition];
}
async function resolveTurnPluginEntriesFromAssistant(ctx, api) {
  const state = extractTraceKeeperState(ctx.assistantContent);
  if (!state) return [];
  let epoch = 0;
  const conversationId = ctx.conversationId?.trim();
  if (conversationId) {
    const convSettings = await api.getConversationPluginSettings(
      conversationId,
      PLUGIN_ID
    );
    epoch = trackerEpochFromSettings(convSettings);
  }
  return [
    {
      pluginId: PLUGIN_ID,
      schemaVersion: 1,
      payload: { state, epoch }
    }
  ];
}
export {
  afterAssemblePrompts,
  buildTrackerSystemPrompt,
  regenerateSeparateState,
  resolveAfterAssemblePromptsAddition,
  resolveTraceKeeperInjection,
  resolveTurnPluginEntriesFromAssistant
};
