// shared/plugin-prompt-injection.ts
var CHAT_INJECTION_ORDER_DEFAULT = 100;

// shared/post-user-injection-order.ts
var POST_USER_INJECTION_ORDER_SLOT_DEFAULTS = {
  send: 0,
  reviseAssistant: 0,
  reviseSystem: 1,
  default: 500
};
var ORDER_MIN = 0;
var ORDER_MAX = 9999;
function clampInjectionOrder(raw) {
  if (!Number.isFinite(raw)) return CHAT_INJECTION_ORDER_DEFAULT;
  return Math.max(ORDER_MIN, Math.min(ORDER_MAX, Math.floor(raw)));
}
function resolveAssembleInjectionOrderSlot(slots, key, fallback) {
  const k = key.trim();
  if (k && slots && typeof slots[k] === "number") {
    return clampInjectionOrder(slots[k]);
  }
  return clampInjectionOrder(fallback);
}

// plugins/guidance-generate/src/server/index.ts
var PLUGIN_ID = "guidance-generate";
var DEFAULT_SYSTEM_PREFIX = "Please generate a reply according to this guidance together with the user's message: ";
var DEFAULT_REVISE_SYSTEM_PREFIX = "Please revise the assistant reply above according to this guidance while preserving the main meaning: ";
var CHAT_DEPTH = 0;
function parsePayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const modeRaw = o.mode;
  const mode = modeRaw === "regenerate" ? "regenerate" : modeRaw === "revise" ? "revise" : "send";
  const guidanceText = typeof o.guidanceText === "string" ? o.guidanceText.trim() : "";
  if (!guidanceText) return null;
  const assistantText = typeof o.assistantText === "string" ? o.assistantText.trim() : "";
  if (mode === "revise" && !assistantText) return null;
  return {
    mode,
    guidanceText,
    ...mode === "revise" ? { assistantText } : {}
  };
}
function insertSystemAfterLastUser(messages, systemContent) {
  const systemMsg = { role: "system", content: systemContent };
  let lastUserIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") lastUserIdx = i;
  }
  if (lastUserIdx < 0) return [...messages, systemMsg];
  return [
    ...messages.slice(0, lastUserIdx + 1),
    systemMsg,
    ...messages.slice(lastUserIdx + 1)
  ];
}
function appendAssistantThenGuidanceSystem(messages, assistantContent, systemContent) {
  return [
    ...messages,
    { role: "assistant", content: assistantContent },
    { role: "system", content: systemContent }
  ];
}
async function resolveAfterAssemblePromptsAddition(ctx, api) {
  const parsed = parsePayload(ctx.plugins?.[PLUGIN_ID]);
  if (!parsed) return null;
  const guidance = await api.applyPromptMacroPipeline(
    parsed.guidanceText,
    ctx.macroContext
  );
  if (!guidance) return null;
  const settings = await api.getUserPluginSettings(PLUGIN_ID);
  const slots = ctx.injectionOrderSlots;
  if (parsed.mode === "revise") {
    const assistantText = parsed.assistantText?.trim();
    if (!assistantText) return null;
    const rawPrefix2 = typeof settings?.reviseSystemPrefix === "string" ? settings.reviseSystemPrefix : "";
    const prefix2 = rawPrefix2.trim() || DEFAULT_REVISE_SYSTEM_PREFIX;
    return [
      {
        role: "assistant",
        content: assistantText,
        position: {
          kind: "chat",
          depth: CHAT_DEPTH,
          injectionOrder: resolveAssembleInjectionOrderSlot(
            slots,
            "reviseAssistant",
            POST_USER_INJECTION_ORDER_SLOT_DEFAULTS.reviseAssistant
          )
        }
      },
      {
        role: "system",
        content: `${prefix2}${guidance}`,
        position: {
          kind: "chat",
          depth: CHAT_DEPTH,
          injectionOrder: resolveAssembleInjectionOrderSlot(
            slots,
            "reviseSystem",
            POST_USER_INJECTION_ORDER_SLOT_DEFAULTS.reviseSystem
          )
        }
      }
    ];
  }
  const rawPrefix = typeof settings?.systemPrefix === "string" ? settings.systemPrefix : "";
  const prefix = rawPrefix.trim() || DEFAULT_SYSTEM_PREFIX;
  return [
    {
      role: "system",
      content: `${prefix}${guidance}`,
      position: {
        kind: "chat",
        depth: CHAT_DEPTH,
        injectionOrder: resolveAssembleInjectionOrderSlot(
          slots,
          "send",
          POST_USER_INJECTION_ORDER_SLOT_DEFAULTS.send
        )
      }
    }
  ];
}
function resolveTurnPluginEntries(plugins) {
  const parsed = parsePayload(plugins?.[PLUGIN_ID]);
  if (!parsed) return [];
  return [
    {
      pluginId: PLUGIN_ID,
      schemaVersion: 1,
      payload: { mode: parsed.mode, guidanceText: parsed.guidanceText }
    }
  ];
}
export {
  appendAssistantThenGuidanceSystem,
  insertSystemAfterLastUser,
  parsePayload,
  resolveAfterAssemblePromptsAddition,
  resolveTurnPluginEntries
};
