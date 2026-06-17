// src/server/index.ts
var PLUGIN_ID = "guidance-generate";
var DEFAULT_SYSTEM_PREFIX = "Please generate a reply according to this guidance together with the user's message: ";
function parsePayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const mode = o.mode === "regenerate" ? "regenerate" : "send";
  const guidanceText = typeof o.guidanceText === "string" ? o.guidanceText.trim() : "";
  if (!guidanceText) return null;
  return { mode, guidanceText };
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
async function afterAssemblePrompts(ctx, api) {
  const parsed = parsePayload(ctx.plugins?.[PLUGIN_ID]);
  if (!parsed) return ctx.messages;
  const guidance = api.applyPromptMacroPipeline(
    parsed.guidanceText,
    ctx.macroContext
  );
  if (!guidance) return ctx.messages;
  const settings = await api.getUserPluginSettings(PLUGIN_ID);
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
      payload: { guidanceText: parsed.guidanceText }
    }
  ];
}
export {
  afterAssemblePrompts,
  insertSystemAfterLastUser,
  parsePayload,
  resolveTurnPluginEntries
};
