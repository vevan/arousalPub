// plugins/guidance-generate/src/web/index.ts
var PLUGIN_ID = "guidance-generate";
var DEFAULT_POLISH_SYSTEM_PREFIX = `# Role: RP Narrative Editor

## Objective
You are an editing engine dedicated to optimizing role-play (RP) text. Your task is to take the [user's current draft] and\u2014drawing upon the [recent conversation history]\u2014polish it into a final version that suits the current RP scene, offers vivid imagery, flows naturally, and aligns with the user's persona.

## Rules & Constraints
1. **Preserve Intent**: Core actions, dialogue, internal thoughts, and decisions must be retained 100%; do not alter the user's intent or make significant, unstated decisions on their behalf.
2. **Contextual Coherence**: Refer to the [recent conversation history] to ensure that actions, tone, forms of address, and environmental interactions flow naturally from the ongoing narrative, avoiding any jarring transitions.
3. **Enhance Detail**:
- Incorporate descriptions of micro-expressions, body language, internal thoughts, or environmental interactions. 
- Supplement emotional dialogue with appropriate descriptions of facial expressions or tone of voice. 
- Avoid dry, expository text; prioritize the "Show, don't tell" approach.
4. **Formatting Standards**:
- Maintain standard RP formatting (e.g., using plain text for actions/descriptions and quotation marks for dialogue, or adhering to the specific platform's conventions). 
- Do not include AI explanations, introductory prefixes (such as "Polished result:"), or superfluous pleasantries.

## Output Format
Output only the **final polished text**; do not include Markdown code block tags, prefixes, or explanations.`;
var DEFAULT_POLISH_HISTORY_TURNS = 8;
var HISTORY_BLOCK_ID = "polishHistory";
var k = (host, key) => host.pluginKey(key);
function notifyGuidanceFailed(host, detail) {
  const title = host.t(k(host, "notifyFailed"));
  const body = detail?.trim();
  host.ui.notify(title, body || void 0, { level: "error" });
}
function notifyPolishFailed(host, detail) {
  const title = host.t(k(host, "notifyPolishFailed"));
  const body = detail?.trim();
  host.ui.notify(title, body || void 0, { level: "error" });
}
function resolveMode(raw) {
  if (raw === "regenerate") return "regenerate";
  if (raw === "revise") return "revise";
  return "send";
}
function readPolishSettings(host) {
  const snap = host.plugins.getUserSettingsSnapshot();
  const rawPrefix = snap?.polishSystemPrefix;
  const systemPrefix = typeof rawPrefix === "string" && rawPrefix.trim() ? rawPrefix.trim() : DEFAULT_POLISH_SYSTEM_PREFIX;
  const rawTurns = snap?.polishHistoryTurns;
  let historyTurns = DEFAULT_POLISH_HISTORY_TURNS;
  if (typeof rawTurns === "number" && Number.isFinite(rawTurns)) {
    historyTurns = Math.floor(rawTurns);
  } else if (typeof rawTurns === "string" && rawTurns.trim()) {
    const n = Number(rawTurns);
    if (Number.isFinite(n)) historyTurns = Math.floor(n);
  }
  historyTurns = Math.min(40, Math.max(0, historyTurns));
  return { systemPrefix, historyTurns };
}
function segmentReceivesAt(turn, segmentIndex) {
  const segments = turn.segments ?? [];
  if (segments.length === 0) return [];
  const raw = typeof segmentIndex === "number" && Number.isFinite(segmentIndex) ? segmentIndex : turn.activeSegmentIndex ?? 0;
  const idx = Math.min(Math.max(0, Math.floor(raw)), segments.length - 1);
  return segments[idx]?.receives ?? [];
}
function activeAssistantText(turn, segmentIndex) {
  const segments = turn.segments ?? [];
  const segIdx = segments.length === 0 ? 0 : Math.min(
    Math.max(0, segmentIndex ?? turn.activeSegmentIndex ?? 0),
    segments.length - 1
  );
  const receives = segmentReceivesAt(turn, segIdx);
  const seg = segments[segIdx];
  const idx = typeof seg?.activeReceiveIndex === "number" && !Number.isNaN(seg.activeReceiveIndex) ? seg.activeReceiveIndex : 0;
  const content = receives[idx]?.content;
  return typeof content === "string" ? content.trim() : "";
}
function resolvePanel(raw) {
  return raw === "polish" ? "polish" : "generate";
}
async function runGuidanceSubmit(hostApi, model) {
  const mode = resolveMode(model.mode);
  const userText = String(model.userText ?? "").trim();
  if (mode === "send" && resolvePanel(model.tab) === "polish") {
    const polishedText = String(model.polishedText ?? "").trim();
    const polishSource = String(model.polishSource ?? "");
    if (!polishedText || String(model.userText ?? "") !== polishSource) {
      return;
    }
    const err2 = await hostApi.chat.send(polishedText);
    if (err2) notifyGuidanceFailed(hostApi, err2);
    return;
  }
  const guidanceText = String(model.guidanceText ?? "").trim();
  const plugins = {
    [PLUGIN_ID]: mode === "revise" ? {
      mode,
      guidanceText,
      assistantText: String(model.assistantText ?? "").trim()
    } : { mode, guidanceText }
  };
  if (mode === "send") {
    const err2 = await hostApi.chat.sendWithPlugins(userText, plugins);
    if (err2) notifyGuidanceFailed(hostApi, err2);
    return;
  }
  const listIndex = model.listIndex;
  if (typeof listIndex !== "number") return;
  const err = await hostApi.chat.regenerateWithPlugins(
    listIndex,
    userText,
    plugins
  );
  if (err) notifyGuidanceFailed(hostApi, err);
}
async function fetchHistoryBlock(hostApi, historyTurns) {
  if (historyTurns <= 0) return { ok: true, text: "" };
  try {
    const prepared = await hostApi.plugin.prepareContextBlocks({
      blocks: [
        {
          source: "conversation.transcript.tail",
          blockId: HISTORY_BLOCK_ID,
          tailCount: historyTurns
        }
      ]
    });
    const text = prepared.blocks?.[HISTORY_BLOCK_ID];
    return { ok: true, text: typeof text === "string" ? text.trim() : "" };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    };
  }
}
async function runGuidancePolish(hostApi, model) {
  if (resolveMode(model.mode) !== "send") return;
  if (resolvePanel(model.tab) !== "polish") return;
  const userText = String(model.userText ?? "").trim();
  if (!userText) return;
  const { systemPrefix, historyTurns } = readPolishSettings(hostApi);
  const hist = await fetchHistoryBlock(hostApi, historyTurns);
  if (!hist.ok) {
    notifyPolishFailed(hostApi, hist.detail);
    return;
  }
  const history = hist.text;
  const messages = [
    {
      role: "system",
      content: history || "(no recent conversation history)"
    },
    { role: "user", content: userText },
    { role: "system", content: systemPrefix }
  ];
  try {
    const result = await hostApi.plugin.complete({ messages });
    const polished = String(result.content ?? "").trim();
    if (!polished) {
      notifyPolishFailed(hostApi);
      return;
    }
    model.polishedText = polished;
    model.polishSource = String(model.userText ?? "");
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    notifyPolishFailed(hostApi, detail);
  }
}
function register(host) {
  host.registerSlotButton("composer-toolbar", {
    id: `${PLUGIN_ID}-composer`,
    icon: "mdi-lightbulb-on-outline",
    tooltipKey: k(host, "tooltip"),
    filled: false,
    onClick: () => {
      host.openFormDialog(PLUGIN_ID, {
        mode: "send",
        tab: "generate",
        userText: host.composer.userInput,
        polishedText: "",
        polishSource: "",
        guidanceText: "",
        assistantText: "",
        listIndex: null
      });
    }
  });
  host.registerSlotButton("user-turn-footer", {
    id: `${PLUGIN_ID}-regen`,
    icon: "mdi-lightbulb-on-outline",
    tooltipKey: k(host, "tooltip"),
    filled: true,
    when: (ctx) => !!ctx.turn && host.turn.isLastUserTurn(ctx.turn) && ctx.turn.user.trim().length > 0,
    disabled: (ctx) => host.session.loading || host.session.regeneratingTurnOrdinal !== null || (ctx.turn ? host.turn.isTurnAwaitingAssistant(ctx.turn) : false),
    onClick: (ctx) => {
      if (!ctx.turn || ctx.listIndex == null) return;
      host.openFormDialog(PLUGIN_ID, {
        mode: "regenerate",
        userText: ctx.turn.user,
        guidanceText: "",
        assistantText: "",
        listIndex: ctx.listIndex
      });
    }
  });
  host.registerSlotButton("assistant-turn-footer", {
    id: `${PLUGIN_ID}-revise`,
    icon: "mdi-lightbulb-on-outline",
    tooltipKey: k(host, "reviseTooltip"),
    filled: true,
    when: (ctx) => !!ctx.turn && activeAssistantText(ctx.turn, ctx.segmentIndex).length > 0,
    disabled: (ctx) => host.session.loading || host.session.regeneratingTurnOrdinal !== null || (ctx.turn ? host.turn.isTurnAwaitingAssistant(ctx.turn) : false),
    onClick: (ctx) => {
      if (!ctx.turn || ctx.listIndex == null) return;
      const assistantText = activeAssistantText(ctx.turn, ctx.segmentIndex);
      if (!assistantText) return;
      host.openFormDialog(PLUGIN_ID, {
        mode: "revise",
        userText: ctx.turn.user,
        assistantText,
        guidanceText: "",
        listIndex: ctx.listIndex
      });
    }
  });
  host.registerFormDialog(PLUGIN_ID, {
    titleKey: k(host, "dialogTitle"),
    titleKeys: {
      send: k(host, "dialogTitle"),
      regenerate: k(host, "dialogTitle"),
      revise: k(host, "reviseDialogTitle")
    },
    tabs: [
      {
        id: "generate",
        labelKey: k(host, "tabGenerate"),
        submitKey: k(host, "send")
      },
      {
        id: "polish",
        labelKey: k(host, "tabPolish"),
        submitKey: k(host, "polishSend")
      }
    ],
    tabsVisible: (m) => resolveMode(m.mode) === "send",
    fields: [
      {
        key: "userText",
        labelKey: k(host, "userLabel"),
        visibleWhen: [
          { field: "mode", equals: "send" },
          { field: "tab", equals: "generate" }
        ]
      },
      {
        key: "guidanceText",
        labelKey: k(host, "guidanceLabel"),
        visibleWhen: [
          { field: "mode", equals: "send" },
          { field: "tab", equals: "generate" }
        ]
      },
      {
        key: "userText",
        labelKey: k(host, "userTextPolishOriginalLabel"),
        hintKey: k(host, "polishOriginalHint"),
        visibleWhen: [
          { field: "mode", equals: "send" },
          { field: "tab", equals: "polish" }
        ]
      },
      {
        key: "polishedText",
        labelKey: k(host, "polishedTextLabel"),
        visibleWhen: [
          { field: "mode", equals: "send" },
          { field: "tab", equals: "polish" }
        ]
      },
      {
        key: "userText",
        labelKey: k(host, "userLabel"),
        visibleWhen: { field: "mode", equals: "regenerate" }
      },
      {
        key: "guidanceText",
        labelKey: k(host, "guidanceLabel"),
        visibleWhen: { field: "mode", equals: "regenerate" }
      },
      {
        key: "assistantText",
        labelKey: k(host, "assistantLabel"),
        readOnly: true,
        visibleWhen: { field: "mode", equals: "revise" }
      },
      {
        key: "guidanceText",
        labelKey: k(host, "guidanceLabel"),
        visibleWhen: { field: "mode", equals: "revise" }
      }
    ],
    submitKeys: {
      send: k(host, "send"),
      regenerate: k(host, "regenerate"),
      revise: k(host, "revise")
    },
    extraActionKey: k(host, "polish"),
    extraActionVisible: (_h, m) => resolveMode(m.mode) === "send" && resolvePanel(m.tab) === "polish",
    extraActionCanSubmit: (m) => {
      if (resolveMode(m.mode) !== "send" || resolvePanel(m.tab) !== "polish") {
        return false;
      }
      return String(m.userText ?? "").trim().length > 0;
    },
    onExtraAction: (hostApi, model) => runGuidancePolish(hostApi, model),
    canSubmit: (model) => {
      const mode = resolveMode(model.mode);
      const userText = String(model.userText ?? "").trim();
      if (mode === "send" && resolvePanel(model.tab) === "polish") {
        const polishedText = String(model.polishedText ?? "").trim();
        return polishedText.length > 0 && String(model.userText ?? "") === String(model.polishSource ?? "");
      }
      const guidanceText = String(model.guidanceText ?? "").trim();
      if (!guidanceText) return false;
      if (mode === "revise") {
        return String(model.assistantText ?? "").trim().length > 0;
      }
      return userText.length > 0;
    },
    onSubmit: (hostApi, model) => {
      void runGuidanceSubmit(hostApi, model);
    }
  });
}
export {
  register
};
