// plugins/guidance-generate/src/server/index.ts
var PLUGIN_ID = "guidance-generate";
var DEFAULT_SYSTEM_PREFIX = "Please generate a reply according to this guidance together with the user's message: ";
var DEFAULT_REVISE_SYSTEM_PREFIX = "Please revise the assistant reply above according to this guidance while preserving the main meaning: ";
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
async function afterAssemblePrompts(ctx, api) {
  const parsed = parsePayload(ctx.plugins?.[PLUGIN_ID]);
  if (!parsed) return ctx.messages;
  const guidance = api.applyPromptMacroPipeline(
    parsed.guidanceText,
    ctx.macroContext
  );
  if (!guidance) return ctx.messages;
  const settings = await api.getUserPluginSettings(PLUGIN_ID);
  if (parsed.mode === "revise") {
    const assistantText = parsed.assistantText?.trim();
    if (!assistantText) return ctx.messages;
    const rawPrefix2 = typeof settings?.reviseSystemPrefix === "string" ? settings.reviseSystemPrefix : "";
    const prefix2 = rawPrefix2.trim() || DEFAULT_REVISE_SYSTEM_PREFIX;
    return appendAssistantThenGuidanceSystem(
      ctx.messages,
      assistantText,
      `${prefix2}${guidance}`
    );
  }
  const rawPrefix = typeof settings?.systemPrefix === "string" ? settings.systemPrefix : "";
  const prefix = rawPrefix.trim() || DEFAULT_SYSTEM_PREFIX;
  return insertSystemAfterLastUser(ctx.messages, `${prefix}${guidance}`);
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
  afterAssemblePrompts,
  appendAssistantThenGuidanceSystem,
  insertSystemAfterLastUser,
  parsePayload,
  resolveTurnPluginEntries
};
