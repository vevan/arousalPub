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
var template_default = '<div class="trace-keeper-panel">\n  <h4 class="tk-title">\u573A\u666F\u8FFD\u8E2A</h4>\n  <dl class="tk-fields">\n    <dt>\u5730\u70B9</dt>\n    <dd>{{data.scene.location}}</dd>\n    <dt>\u65F6\u95F4</dt>\n    <dd>{{data.scene.time}}</dd>\n    <dt>\u5929\u6C14</dt>\n    <dd>{{data.scene.weather}}</dd>\n    <dt>\u6C1B\u56F4</dt>\n    <dd>{{data.mood}}</dd>\n  </dl>\n  {{#if data.notes}}\n  <p class="tk-notes">{{data.notes}}</p>\n  {{/if}}\n  <p class="tk-meta text-caption">epoch {{meta.epoch}}{{#if meta.turnOrdinal}} \xB7 \u7B2C {{meta.turnOrdinal}} \u8F6E{{/if}}</p>\n</div>\n';

// plugins/trace-keeper/bundles/scene-tracker-default/stylesheet.css
var stylesheet_default = ".trace-keeper-panel {\n  font-size: 0.875rem;\n  line-height: 1.45;\n}\n\n.trace-keeper-panel .tk-title {\n  margin: 0 0 8px;\n  font-weight: 600;\n  font-size: 0.95rem;\n}\n\n.trace-keeper-panel .tk-fields {\n  margin: 0 0 8px;\n  display: grid;\n  grid-template-columns: auto 1fr;\n  gap: 4px 10px;\n}\n\n.trace-keeper-panel .tk-fields dt {\n  margin: 0;\n  opacity: 0.72;\n}\n\n.trace-keeper-panel .tk-fields dd {\n  margin: 0;\n  word-break: break-word;\n  overflow-wrap: anywhere;\n}\n\n.trace-keeper-panel .tk-notes {\n  margin: 8px 0 0;\n  padding: 8px;\n  border-radius: 6px;\n  background: rgba(var(--v-theme-on-surface), 0.04);\n  word-break: break-word;\n  overflow-wrap: anywhere;\n  white-space: pre-wrap;\n}\n\n.trace-keeper-panel .tk-meta {\n  margin: 10px 0 0;\n  opacity: 0.55;\n}\n";

// plugins/trace-keeper/src/default-prompt.ts
var DEFAULT_SYSTEM_PROMPT_TEMPLATE = [
  "You are maintaining a structured RP scene state for the Trace Keeper plugin.",
  `After your in-character reply, append a block: <${BLOCK_TAG}>{pure JSON}</${BLOCK_TAG}>.`,
  "The JSON must match the sample structure below. Update fields to reflect the current scene; do not copy sample placeholder values verbatim."
].join("\n");
var DEFAULT_SEPARATE_SYSTEM_PROMPT_TEMPLATE = [
  "Based on the conversation history above, infer the current scene state.",
  "Refer to the JSON template below and reply with a single JSON object only.",
  "Do not include markdown fences, XML tags, or roleplay prose."
].join("\n");

// plugins/trace-keeper/src/bundle-resolve.ts
var DEFAULT_TRACE_BUNDLE = {
  id: DEFAULT_BUNDLE_ID,
  label: "Scene Tracker (default)",
  sampleState: sample_state_default,
  template: template_default,
  stylesheet: stylesheet_default,
  systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  separateSystemPromptTemplate: DEFAULT_SEPARATE_SYSTEM_PROMPT_TEMPLATE
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
function sampleStateJsonValidationEnabled(user) {
  return user.validateSampleStateJson !== false;
}
function parseUserBundleEntry(raw, opts) {
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
  if (typeof raw.separateSystemPromptTemplate === "string" && raw.separateSystemPromptTemplate.trim()) {
    out.separateSystemPromptTemplate = raw.separateSystemPromptTemplate.trim();
  }
  const jsonRaw = typeof raw.sampleStateJson === "string" ? raw.sampleStateJson : "";
  const fromJson = parseSampleStateJson(jsonRaw);
  if (fromJson) {
    out.sampleState = fromJson;
  } else if (isPlainObject(raw.sampleState)) {
    out.sampleState = raw.sampleState;
  } else if (jsonRaw.trim() && opts.allowInvalidSampleJson) {
    out.sampleStatePromptText = jsonRaw;
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
  const allowInvalidSampleJson = !sampleStateJsonValidationEnabled(user);
  const parseOpts = { allowInvalidSampleJson };
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
    const entry = parseUserBundleEntry(item, parseOpts);
    if (!entry) continue;
    out[entry.id] = { ...out[entry.id], ...entry };
  }
  const legacy = user.bundles;
  if (isPlainObject(legacy)) {
    for (const [key, val] of Object.entries(legacy)) {
      if (!isPlainObject(val)) continue;
      const entry = parseUserBundleEntry({ ...val, id: key }, parseOpts);
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
  if (typeof partial.sampleStatePromptText === "string") {
    next.sampleStatePromptText = partial.sampleStatePromptText;
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
  if (typeof partial.separateSystemPromptTemplate === "string" && partial.separateSystemPromptTemplate.trim()) {
    next.separateSystemPromptTemplate = partial.separateSystemPromptTemplate.trim();
  }
  return next;
}
function cloneSampleState(state) {
  return structuredClone(state);
}
function shellBundle(id, embedded) {
  if (id === embedded.id) return { ...embedded, id };
  return {
    id,
    label: id,
    sampleState: cloneSampleState(embedded.sampleState),
    template: '<div class="trace-keeper-panel"><pre>{{json data}}</pre></div>',
    stylesheet: ".trace-keeper-panel { font-size: 0.875rem; }",
    systemPromptTemplate: embedded.systemPromptTemplate,
    separateSystemPromptTemplate: embedded.separateSystemPromptTemplate
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
  if (!base.separateSystemPromptTemplate?.trim()) {
    base.separateSystemPromptTemplate = DEFAULT_SEPARATE_SYSTEM_PROMPT_TEMPLATE;
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
function normalizePatchState(raw) {
  if (typeof raw === "string") {
    return parseTraceKeeperJson(raw);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const text = JSON.stringify(raw);
  if (!text || text.length > MAX_STATE_BYTES) return null;
  return raw;
}
function stripTraceKeeperBlocks(assistantContent) {
  return assistantContent.replace(BLOCK_RE, "").trim();
}
function formatTraceKeeperBlock(state) {
  return `<${BLOCK_TAG}>${JSON.stringify(state)}</${BLOCK_TAG}>`;
}
function upsertTraceKeeperBlockInAssistant(assistantContent, state) {
  const narrative = stripTraceKeeperBlocks(assistantContent).trimEnd();
  const block = formatTraceKeeperBlock(state);
  if (!narrative) return block;
  return `${narrative}

${block}`;
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

// plugins/trace-keeper/src/separate-turn-settings.ts
var SEPARATE_TURN_COUNT_MIN = 1;
var SEPARATE_TURN_COUNT_MAX = 8;
var SEPARATE_TURN_COUNT_DEFAULT = 4;
function normalizeSeparateTurnCount(raw) {
  if (typeof raw === "string" && raw.trim() === "") {
    return SEPARATE_TURN_COUNT_DEFAULT;
  }
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : typeof raw === "string" ? Number.parseInt(raw, 10) : SEPARATE_TURN_COUNT_DEFAULT;
  if (!Number.isFinite(n)) return SEPARATE_TURN_COUNT_DEFAULT;
  return Math.max(
    SEPARATE_TURN_COUNT_MIN,
    Math.min(SEPARATE_TURN_COUNT_MAX, n)
  );
}
function legacyLiveStateTurnCount(raw) {
  if (raw === null || raw === void 0 || raw === "") return null;
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(
    SEPARATE_TURN_COUNT_MIN,
    Math.min(SEPARATE_TURN_COUNT_MAX, n)
  );
}
function resolveSeparateTurnCount(userSettings, convSettings) {
  const conv = convSettings ?? {};
  if (Object.prototype.hasOwnProperty.call(conv, "separateTurnCount")) {
    const raw = conv.separateTurnCount;
    if (raw !== null && raw !== void 0 && raw !== "") {
      return normalizeSeparateTurnCount(raw);
    }
  }
  const user = userSettings ?? {};
  if (Object.prototype.hasOwnProperty.call(user, "separateTurnCount")) {
    return normalizeSeparateTurnCount(user.separateTurnCount);
  }
  const legacy = legacyLiveStateTurnCount(conv.liveStateTurnCount) ?? legacyLiveStateTurnCount(user.liveStateTurnCount);
  if (legacy !== null) return legacy;
  return SEPARATE_TURN_COUNT_DEFAULT;
}

// plugins/trace-keeper/src/tracker-prompt.ts
function formatSampleStateForPrompt(bundle) {
  const raw = bundle.sampleStatePromptText?.trim();
  if (raw) return raw;
  return JSON.stringify(bundle.sampleState, null, 2);
}
function buildTrackerSystemPrompt(bundle) {
  const prefix = bundle.systemPromptTemplate?.trim() || DEFAULT_SYSTEM_PROMPT_TEMPLATE;
  const sampleJson = formatSampleStateForPrompt(bundle);
  return [
    prefix,
    "--- sample structure (reference only) ---",
    sampleJson
  ].join("\n");
}
function buildSeparateSystemPrompt(bundle) {
  const prefix = bundle.separateSystemPromptTemplate?.trim() || DEFAULT_SEPARATE_SYSTEM_PROMPT_TEMPLATE;
  const sampleJson = formatSampleStateForPrompt(bundle);
  return [
    prefix,
    "--- JSON template (reference only) ---",
    sampleJson
  ].join("\n");
}

// plugins/trace-keeper/src/shared/trace-keeper-context-blocks.ts
var TK_BLOCK_DIALOGUE_RAW = "dialogueRaw";
function buildTraceKeeperSeparateBlockSpecs(input) {
  const cap = Math.max(
    SEPARATE_TURN_COUNT_MIN,
    Math.floor(input.windowTurnCount)
  );
  const fromTurn = Math.max(0, input.targetOrdinal - cap + 1);
  return [
    {
      source: "conversation.transcript",
      blockId: TK_BLOCK_DIALOGUE_RAW,
      fromTurn,
      toTurn: input.targetOrdinal,
      tailOrdinal: input.targetOrdinal,
      stripBlockTagsOnToTurn: [BLOCK_TAG]
    }
  ];
}
function buildDialogueBlock(transcript) {
  const body = (transcript ?? "").trim();
  if (!body) return "";
  return `<dialogue>
${body}
</dialogue>`;
}
function formatTraceKeeperLayoutBlocks(resolved) {
  const raw = resolved.blocks[TK_BLOCK_DIALOGUE_RAW] ?? "";
  const dialogue = buildDialogueBlock(raw);
  return dialogue ? { dialogue } : {};
}

// plugins/trace-keeper/src/prepare-context.ts
function prepareTraceKeeperSeparateContextBlocks(input) {
  return buildTraceKeeperSeparateBlockSpecs(input);
}

// plugins/trace-keeper/src/shared/separate-prompt-layout.ts
var TRACE_KEEPER_SEPARATE_LAYOUT = {
  messages: [
    { role: "user", content: "{{blocks.dialogue}}" },
    { role: "system", content: "{{plugin.separateSystemPrompt}}" }
  ]
};

// plugins/trace-keeper/src/server/separate-regenerate.ts
function mergeSeparateDebug(messages, code, extra) {
  return {
    messages,
    code,
    ...extra
  };
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
  const targetOrdinal = typeof input.turnOrdinal === "number" && Number.isFinite(input.turnOrdinal) ? Math.round(input.turnOrdinal) : tail.length > 0 ? tail[tail.length - 1].turnOrdinal : NaN;
  if (!Number.isFinite(targetOrdinal)) {
    return { ok: false, code: "no_turns" };
  }
  const turn = await api.readConversationTurnAtOrdinal(
    conversationId,
    targetOrdinal
  );
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
  const windowTurnCount = resolveSeparateTurnCount(userSettings, convSettings);
  const debugCapture = input.debugCapture === true;
  const blocks = prepareTraceKeeperSeparateContextBlocks({
    targetOrdinal,
    windowTurnCount
  });
  const result = await api.completeWithContext({
    conversationId,
    blocks,
    layout: TRACE_KEEPER_SEPARATE_LAYOUT,
    pluginSettings: {
      separateSystemPrompt: buildSeparateSystemPrompt(bundle)
    },
    anchorToTurn: targetOrdinal,
    responseFormat: "json_object",
    captureDebug: debugCapture,
    fallbackToChat: true
  });
  const messages = result.ok ? result.messages : result.messages ?? result.debug?.messages ?? [];
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      ...debugCapture ? {
        debug: mergeSeparateDebug(messages, result.code, result.debug)
      } : {}
    };
  }
  const content = result.content?.trim() ?? "";
  if (!content) {
    return {
      ok: false,
      code: "parse_failed",
      ...debugCapture ? { debug: mergeSeparateDebug(messages, "parse_failed") } : {}
    };
  }
  const state = parseTraceKeeperJson(content);
  if (!state) {
    return {
      ok: false,
      code: "parse_failed",
      ...debugCapture ? {
        debug: mergeSeparateDebug(messages, "parse_failed", {
          assistantContent: content
        })
      } : {}
    };
  }
  const entry = {
    pluginId: PLUGIN_ID,
    schemaVersion: 1,
    payload: { state, epoch, receiveId: receive.id }
  };
  const assistantContent = upsertTraceKeeperBlockInAssistant(receive.content, state);
  return {
    ok: true,
    state,
    turnOrdinal: targetOrdinal,
    receiveId: receive.id,
    assistantContent,
    entry,
    ...debugCapture ? {
      debug: mergeSeparateDebug(messages, "ok", {
        ...result.debug,
        assistantContent: content
      })
    } : {}
  };
}

// plugins/trace-keeper/src/server/patch-state.ts
function activeReceive2(turn) {
  const receives = turn.receives;
  if (!receives?.length) return null;
  const idx = Math.min(
    Math.max(0, Math.floor(turn.activeReceiveIndex)),
    receives.length - 1
  );
  const rec = receives[idx];
  if (!rec?.id?.trim()) return null;
  return { id: rec.id.trim() };
}
async function patchTraceKeeperState(input, api) {
  const conversationId = input.conversationId.trim();
  if (!conversationId) return { ok: false, code: "invalid_conversation_id" };
  if (typeof input.turnOrdinal !== "number" || !Number.isFinite(input.turnOrdinal) || input.turnOrdinal < 0) {
    return { ok: false, code: "invalid_turn_ordinal" };
  }
  const state = normalizePatchState(input.state);
  if (!state) return { ok: false, code: "invalid_state" };
  const turnOrdinal = Math.round(input.turnOrdinal);
  const [convSettings, turn] = await Promise.all([
    api.getConversationPluginSettings(conversationId, PLUGIN_ID),
    api.readConversationTurnAtOrdinal(conversationId, turnOrdinal)
  ]);
  if (!turn) return { ok: false, code: "turn_not_found" };
  const epoch = trackerEpochFromSettings(convSettings);
  const receive = activeReceive2(turn);
  if (!receive?.id) return { ok: false, code: "receive_not_found" };
  const active = turn.receives.find((r) => r.id === receive.id);
  if (!active) return { ok: false, code: "receive_not_found" };
  const payload = { state, epoch, receiveId: receive.id };
  const assistantContent = upsertTraceKeeperBlockInAssistant(active.content, state);
  const entry = {
    pluginId: PLUGIN_ID,
    schemaVersion: 1,
    payload
  };
  return {
    ok: true,
    state,
    turnOrdinal,
    receiveId: receive.id,
    assistantContent,
    entry
  };
}

// plugins/trace-keeper/src/server/complete-context-hooks.ts
function formatPluginContextBlocks(resolved, _ctx) {
  return formatTraceKeeperLayoutBlocks(resolved);
}

// plugins/trace-keeper/src/server/index.ts
var TRACE_KEEPER_CHAT_DEPTH = 0;
var TRACE_KEEPER_INJECTION_ORDER = 500;
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
  return {
    systemText: buildTrackerSystemPrompt(bundle)
  };
}
async function resolveAfterAssemblePromptsAddition(ctx, api) {
  const injection = await resolveTraceKeeperInjection(ctx, api);
  if (!injection) return null;
  return [
    {
      role: "system",
      content: injection.systemText,
      position: {
        kind: "chat",
        depth: TRACE_KEEPER_CHAT_DEPTH,
        injectionOrder: TRACE_KEEPER_INJECTION_ORDER
      }
    }
  ];
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
  DEFAULT_TRACE_BUNDLE,
  TRACE_KEEPER_SEPARATE_LAYOUT,
  buildTrackerSystemPrompt,
  formatPluginContextBlocks,
  patchTraceKeeperState,
  regenerateSeparateState,
  resolveAfterAssemblePromptsAddition,
  resolveTraceBundle,
  resolveTraceKeeperInjection,
  resolveTurnPluginEntriesFromAssistant
};
