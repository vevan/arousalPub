// plugins/guidance-generate/src/web/index.ts
var PLUGIN_ID = "guidance-generate";
var k = (host, key) => host.pluginKey(key);
function notifyGuidanceFailed(host, detail) {
  const title = host.t(k(host, "toastFailed"));
  const body = detail?.trim();
  if (body) {
    host.ui.notify(title, body, { color: "error" });
  } else {
    host.ui.toast(title, { color: "error" });
  }
}
async function runGuidanceSubmit(hostApi, model) {
  const userText = String(model.userText ?? "").trim();
  const guidanceText = String(model.guidanceText ?? "").trim();
  const mode = model.mode === "regenerate" ? "regenerate" : "send";
  const plugins = {
    [PLUGIN_ID]: { mode, guidanceText }
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
        listIndex: ctx.listIndex
      });
    }
  });
  host.registerFormDialog(PLUGIN_ID, {
    titleKey: k(host, "dialogTitle"),
    fields: [
      { key: "userText", labelKey: k(host, "userLabel") },
      { key: "guidanceText", labelKey: k(host, "guidanceLabel") }
    ],
    submitKeys: {
      send: k(host, "send"),
      regenerate: k(host, "regenerate")
    },
    canSubmit: (model) => String(model.userText ?? "").trim().length > 0 && String(model.guidanceText ?? "").trim().length > 0,
    onSubmit: (hostApi, model) => {
      void runGuidanceSubmit(hostApi, model);
    }
  });
}
export {
  register
};
