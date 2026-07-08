// plugins/guidance-generate/src/web/index.ts
var PLUGIN_ID = "guidance-generate";
var k = (host, key) => host.pluginKey(key);
function notifyGuidanceFailed(host, detail) {
  const title = host.t(k(host, "toastFailed"));
  const body = detail?.trim();
  host.ui.notify(title, body || void 0, { level: "error" });
}
function resolveMode(raw) {
  if (raw === "regenerate") return "regenerate";
  if (raw === "revise") return "revise";
  return "send";
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
async function runGuidanceSubmit(hostApi, model) {
  const guidanceText = String(model.guidanceText ?? "").trim();
  const mode = resolveMode(model.mode);
  const plugins = {
    [PLUGIN_ID]: mode === "revise" ? {
      mode,
      guidanceText,
      assistantText: String(model.assistantText ?? "").trim()
    } : { mode, guidanceText }
  };
  if (mode === "send") {
    const userText2 = String(model.userText ?? "").trim();
    const err2 = await hostApi.chat.sendWithPlugins(userText2, plugins);
    if (err2) notifyGuidanceFailed(hostApi, err2);
    return;
  }
  const listIndex = model.listIndex;
  if (typeof listIndex !== "number") return;
  const userText = String(model.userText ?? "").trim();
  const err = await hostApi.chat.regenerateWithPlugins(
    listIndex,
    userText,
    plugins
  );
  if (err) notifyGuidanceFailed(hostApi, err);
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
        userText: host.composer.userInput,
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
    fields: [
      {
        key: "userText",
        labelKey: k(host, "userLabel"),
        visibleWhen: { field: "mode", equals: "send" }
      },
      {
        key: "userText",
        labelKey: k(host, "userLabel"),
        visibleWhen: { field: "mode", equals: "regenerate" }
      },
      {
        key: "assistantText",
        labelKey: k(host, "assistantLabel"),
        readOnly: true,
        visibleWhen: { field: "mode", equals: "revise" }
      },
      { key: "guidanceText", labelKey: k(host, "guidanceLabel") }
    ],
    submitKeys: {
      send: k(host, "send"),
      regenerate: k(host, "regenerate"),
      revise: k(host, "revise")
    },
    canSubmit: (model) => {
      const guidanceText = String(model.guidanceText ?? "").trim();
      if (!guidanceText) return false;
      const mode = resolveMode(model.mode);
      if (mode === "revise") {
        return String(model.assistantText ?? "").trim().length > 0;
      }
      return String(model.userText ?? "").trim().length > 0;
    },
    onSubmit: (hostApi, model) => {
      void runGuidanceSubmit(hostApi, model);
    }
  });
}
export {
  register
};
