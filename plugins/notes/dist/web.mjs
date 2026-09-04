// plugins/notes/src/web/index.ts
var PLUGIN_ID = "notes";
var PANEL_PLACEMENT = "rightRail";
var NOTE_TITLE_FALLBACK_LEN = 10;
var PANEL_STYLES = `
.np{display:flex;flex-direction:column;height:100%;font-size:14px;font-family:inherit;color:inherit}
.np-tabs{display:flex;border-bottom:1px solid var(--v-border-color,#e0e0e0);flex-shrink:0}
.np-tab{flex:1;padding:8px 4px;text-align:center;cursor:pointer;font-size:12px;border:none;background:none;color:inherit;opacity:.7;transition:color .15s,opacity .15s}
.np-tab.active{color:var(--v-theme-primary,#1976d2);border-bottom:2px solid var(--v-theme-primary,#1976d2);font-weight:600;opacity:1}
.np-tab:disabled{opacity:.4;cursor:default}
.np-toolbar{display:flex;align-items:center;justify-content:space-between;padding:8px 10px 4px;flex-shrink:0}
.np-toolbar-title{font-size:12px;font-weight:600;opacity:.7;text-transform:uppercase;letter-spacing:.04em}
.np-btn{border:none;background:none;cursor:pointer;border-radius:4px;padding:4px 8px;font-size:12px;color:var(--v-theme-primary,#1976d2);display:inline-flex;align-items:center;gap:4px;transition:background .15s}
.np-btn:hover{background:rgba(var(--v-theme-primary-rgb,25,118,210),.08)}
.np-btn-icon{width:28px;height:28px;padding:0;justify-content:center;border-radius:50%}
.np-btn-danger{color:#d32f2f}
.np-btn-danger:hover{background:rgba(211,47,47,.08)}
.np-list{flex:1;overflow-y:auto;padding:4px 0}
.np-item{display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid var(--v-border-color,rgba(0,0,0,.06));gap:8px;transition:background .12s,opacity .12s;cursor:grab;user-select:none;-webkit-user-select:none}
.np-item:hover{background:rgba(0,0,0,.04)}
.np-item:focus{outline:2px solid var(--v-theme-primary,#1976d2);outline-offset:-2px}
.np-item:focus:not(:focus-visible){outline:none}
.np-item:focus-visible{outline:2px solid var(--v-theme-primary,#1976d2);outline-offset:-2px}
.np-item.active{background:rgba(var(--v-theme-primary-rgb,25,118,210),.08)}
.np-item.np-item-dragging{opacity:.45;cursor:grabbing}
.np-item.np-item-drag-over{box-shadow:inset 0 2px 0 0 var(--v-theme-primary,#1976d2)}
.np-item-handle{flex-shrink:0;width:14px;text-align:center;font-size:12px;line-height:1;opacity:.35;letter-spacing:-1px;pointer-events:none}
.np-item-title{flex:1;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;cursor:pointer}
.np-item-badge{font-size:10px;color:inherit;opacity:.55;white-space:nowrap;flex-shrink:0;pointer-events:none}
.np-empty{padding:24px 16px;text-align:center;font-size:13px;opacity:.5}
.np-note{flex:1;display:flex;flex-direction:column;overflow:hidden}
.np-note-header{display:flex;align-items:center;padding:6px 10px;border-bottom:1px solid var(--v-border-color,rgba(0,0,0,.06));gap:4px;flex-shrink:0}
.np-note-title-view{flex:1;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.np-note-body{flex:1;overflow-y:auto;padding:12px 14px}
.np-note-body-content{line-height:1.6}
.np-note-body-content p:first-child{margin-top:0}
.np-note-body-content p:last-child{margin-bottom:0}
.np-note-body-content input[type=checkbox]{cursor:pointer;accent-color:var(--v-theme-primary,#1976d2)}
.np-edit{flex:1;display:flex;flex-direction:column;overflow:hidden}
.np-edit-header{display:flex;align-items:center;padding:6px 10px;border-bottom:1px solid var(--v-border-color,rgba(0,0,0,.06));gap:4px;flex-shrink:0}
.np-input-title{flex:1;border:none;outline:none;background:none;font-size:14px;font-weight:600;color:inherit;padding:2px 4px}
.np-input-title::placeholder{opacity:.4}
.np-textarea{flex:1;border:none;outline:none;background:none;resize:none;font-size:13px;line-height:1.6;padding:12px 14px;font-family:inherit;color:inherit;width:100%;box-sizing:border-box}
.np-loading{display:flex;align-items:center;justify-content:center;padding:32px;opacity:.5;font-size:13px}
.np-error{padding:8px 12px;background:rgba(211,47,47,.08);color:#d32f2f;font-size:12px;margin:6px 10px;border-radius:4px}
`;
async function callAction(host, action, body) {
  return host.plugin.runAction(action, body);
}
function makeState(conversationId) {
  return {
    scope: "global",
    conversationId,
    globalNotes: [],
    conversationNotes: [],
    activeNoteId: null,
    editingNoteId: null,
    editTitle: "",
    editBody: "",
    loading: false,
    saving: false,
    error: ""
  };
}
function displayTitle(note, emptyTitle) {
  if (note.title.trim()) return note.title.trim();
  const text = note.body.trim();
  if (!text) return emptyTitle;
  return text.slice(0, NOTE_TITLE_FALLBACK_LEN) + (text.length > NOTE_TITLE_FALLBACK_LEN ? "\u2026" : "");
}
function countCheckboxes(body) {
  const total = (body.match(/^- \[[ xX]\]/gm) ?? []).length;
  const checked = (body.match(/^- \[[xX]\]/gm) ?? []).length;
  return { total, checked };
}
function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function stripDataPluginAttrs(text) {
  return text.replace(
    /\s*data-plugin-[\w-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/gi,
    ""
  );
}
function toggleCheckboxLine(body, lineIndex) {
  const lines = body.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return body;
  const line = lines[lineIndex] ?? "";
  if (/^- \[ \]/.test(line)) {
    lines[lineIndex] = line.replace(/^- \[ \]/, "- [x]");
  } else if (/^- \[[xX]\]/.test(line)) {
    lines[lineIndex] = line.replace(/^- \[[xX]\]/, "- [ ]");
  }
  return lines.join("\n");
}
function renderListView(state, k) {
  const notes = state.scope === "global" ? state.globalNotes : state.conversationNotes;
  const hasConv = !!state.conversationId;
  const emptyTitle = k("emptyTitle");
  const tabs = `
<div class="np-tabs">
  <button class="np-tab${state.scope === "global" ? " active" : ""}" data-plugin-action="scope:global">${k("scopeGlobal")}</button>
  <button class="np-tab${state.scope === "conversation" ? " active" : ""}" ${!hasConv ? "disabled" : ""} data-plugin-action="scope:conversation">${k("scopeConversation")}</button>
</div>`;
  const toolbar = `
<div class="np-toolbar">
  <span class="np-toolbar-title">${k("panelTitle")}</span>
  <button class="np-btn" data-plugin-action="new-note" title="${k("newNote")}">\uFF0B ${k("newNote")}</button>
</div>`;
  let listHtml = "";
  if (state.loading) {
    listHtml = `<div class="np-loading">${k("loading")}</div>`;
  } else if (notes.length === 0) {
    listHtml = `<div class="np-empty">${k("empty")}</div>`;
  } else {
    listHtml = notes.map((note) => {
      const { total, checked } = countCheckboxes(note.body);
      const badge = total > 0 ? `<span class="np-item-badge">${checked}/${total}</span>` : "";
      const active = note.id === state.activeNoteId ? " active" : "";
      const idEsc = escHtml(note.id);
      return `<div class="np-item${active}" draggable="true" tabindex="0" data-note-id="${idEsc}" title="${escHtml(k("dragReorder"))}">
  <span class="np-item-handle" aria-hidden="true">\u283F</span>
  <span class="np-item-title" data-plugin-action="open:${idEsc}">${escHtml(displayTitle(note, emptyTitle))}</span>
  ${badge}
</div>`;
    }).join("");
    listHtml = `<div class="np-list" data-plugin-live-text="note-list">${listHtml}</div>`;
  }
  const errorHtml = state.error ? `<div class="np-error">${escHtml(state.error)}</div>` : "";
  return tabs + toolbar + errorHtml + listHtml;
}
function renderViewNote(note, renderMd, k) {
  const renderedBody = stripDataPluginAttrs(renderMd(note.body));
  const bodyWithCb = injectCheckboxLineAttrs(note.body, renderedBody);
  return `
<div class="np-note">
  <div class="np-note-header">
    <button class="np-btn np-btn-icon" data-plugin-action="back" title="${k("back")}">\u2190</button>
    <span class="np-note-title-view">${escHtml(displayTitle(note, k("emptyTitle")))}</span>
    <button class="np-btn np-btn-icon" data-plugin-action="edit" title="${k("edit")}">\u270F</button>
    <button class="np-btn np-btn-icon np-btn-danger" data-plugin-action="delete:${escHtml(note.id)}" title="${k("delete")}">\u{1F5D1}</button>
  </div>
  <div class="np-note-body">
    <div class="np-note-body-content">${bodyWithCb}</div>
  </div>
</div>`;
}
function renderEditNote(state, k) {
  return `
<div class="np-edit">
  <div class="np-edit-header">
    <button class="np-btn np-btn-icon" data-plugin-action="cancel-edit" title="${k("cancel")}">\u2190</button>
    <input class="np-input-title" data-plugin-field="edit-title" value="${escHtml(state.editTitle)}" placeholder="${k("titlePlaceholder")}" />
    <button class="np-btn" data-plugin-action="save-note" ${state.saving ? "disabled" : ""}>${state.saving ? k("saving") : k("save")}</button>
  </div>
  <textarea class="np-textarea" data-plugin-field="edit-body" placeholder="${k("bodyPlaceholder")}">${escHtml(state.editBody)}</textarea>
</div>`;
}
function injectCheckboxLineAttrs(rawBody, renderedHtml) {
  const lines = rawBody.split("\n");
  const cbLines = [];
  lines.forEach((line, idx) => {
    if (/^- \[[ xX]\]/.test(line)) cbLines.push(idx);
  });
  if (cbLines.length === 0) return renderedHtml;
  let cbIdx = 0;
  return renderedHtml.replace(/<input\s[^>]*type="checkbox"[^>]*\/?>/gi, (match) => {
    const lineIndex = cbLines[cbIdx++];
    if (lineIndex === void 0) return match;
    const withoutDisabled = match.replace(/\s*disabled(?:="[^"]*")?/gi, "");
    return withoutDisabled.replace(/(\s*\/?>)$/, ` data-plugin-action="toggle-cb:${lineIndex}"$1`);
  });
}
function renderPanel(state, renderMd, k) {
  let body = "";
  if (state.editingNoteId !== null) {
    body = renderEditNote(state, k);
  } else if (state.activeNoteId !== null) {
    const notes = state.scope === "global" ? state.globalNotes : state.conversationNotes;
    const note = notes.find((n) => n.id === state.activeNoteId);
    if (note) {
      body = renderViewNote(note, renderMd, k);
    } else {
      body = renderListView(state, k);
    }
  } else {
    body = renderListView(state, k);
  }
  return `<div class="np">${body}</div>`;
}
function register(host) {
  const k = (key) => host.t(host.pluginKey(key));
  host.registerStyles(PANEL_STYLES);
  const state = makeState(host.session.conversationId);
  function refresh() {
    const html = renderPanel(state, (text) => host.render.richMessageToHtml(text), k);
    host.ui.panel.setHtml(PANEL_PLACEMENT, PLUGIN_ID, html);
  }
  function currentNotes() {
    return state.scope === "global" ? state.globalNotes : state.conversationNotes;
  }
  function setCurrentNotes(notes) {
    if (state.scope === "global") state.globalNotes = notes;
    else state.conversationNotes = notes;
  }
  async function loadNotes() {
    state.loading = true;
    state.error = "";
    refresh();
    try {
      const data = await callAction(host, "list-notes", {
        conversationId: state.conversationId || void 0
      });
      state.globalNotes = Array.isArray(data.global) ? data.global : [];
      state.conversationNotes = Array.isArray(data.conversation) ? data.conversation : [];
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    } finally {
      state.loading = false;
      refresh();
    }
  }
  async function saveCurrentNote() {
    if (state.saving) return;
    state.saving = true;
    refresh();
    try {
      const data = await callAction(host, "save-note", {
        scope: state.scope,
        conversationId: state.conversationId || void 0,
        note: {
          id: state.editingNoteId === "new" ? void 0 : state.editingNoteId,
          title: state.editTitle,
          body: state.editBody
        }
      });
      const saved = data.note;
      const notes = currentNotes();
      const idx = notes.findIndex((n) => n.id === saved.id);
      if (idx >= 0) notes[idx] = saved;
      else notes.push(saved);
      setCurrentNotes([...notes]);
      state.activeNoteId = saved.id;
      state.editingNoteId = null;
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    } finally {
      state.saving = false;
      refresh();
    }
  }
  async function deleteNote(noteId) {
    try {
      await callAction(host, "delete-note", {
        scope: state.scope,
        conversationId: state.conversationId || void 0,
        noteId
      });
      setCurrentNotes(currentNotes().filter((n) => n.id !== noteId));
      state.activeNoteId = null;
      state.editingNoteId = null;
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    }
    refresh();
  }
  async function toggleCheckbox(noteId, lineIndex) {
    const notes = currentNotes();
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    const newBody = toggleCheckboxLine(note.body, lineIndex);
    note.body = newBody;
    refresh();
    try {
      await callAction(host, "save-note", {
        scope: state.scope,
        conversationId: state.conversationId || void 0,
        note: { id: noteId, title: note.title, body: newBody }
      });
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
      refresh();
    }
  }
  async function persistNoteOrder(notes) {
    setCurrentNotes(notes);
    refresh();
    try {
      await callAction(host, "reorder-notes", {
        scope: state.scope,
        conversationId: state.conversationId || void 0,
        ids: notes.map((n) => n.id)
      });
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
      await loadNotes();
    }
  }
  async function reorderInsertBefore(fromId, toId) {
    if (fromId === toId) return;
    const notes = [...currentNotes()];
    const fromIdx = notes.findIndex((n) => n.id === fromId);
    if (fromIdx < 0) return;
    const [moved] = notes.splice(fromIdx, 1);
    if (!moved) return;
    const insertAt = notes.findIndex((n) => n.id === toId);
    if (insertAt < 0) {
      notes.splice(fromIdx, 0, moved);
      return;
    }
    notes.splice(insertAt, 0, moved);
    await persistNoteOrder(notes);
  }
  async function reorderByDelta(noteId, delta) {
    const notes = [...currentNotes()];
    const idx = notes.findIndex((n) => n.id === noteId);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= notes.length) return;
    const tmp = notes[idx];
    notes[idx] = notes[target];
    notes[target] = tmp;
    await persistNoteOrder(notes);
  }
  function bindNoteListDrag(listEl) {
    let dragId = null;
    let suppressOpenClick = false;
    let suppressTimer = null;
    const clearDragOver = () => {
      for (const el of listEl.querySelectorAll(".np-item-drag-over")) {
        el.classList.remove("np-item-drag-over");
      }
    };
    const clearDragging = () => {
      for (const el of listEl.querySelectorAll(".np-item-dragging")) {
        el.classList.remove("np-item-dragging");
      }
    };
    const armSuppressOpenClick = () => {
      suppressOpenClick = true;
      if (suppressTimer != null) clearTimeout(suppressTimer);
      suppressTimer = setTimeout(() => {
        suppressOpenClick = false;
        suppressTimer = null;
      }, 400);
    };
    listEl.addEventListener(
      "click",
      (ev) => {
        if (!suppressOpenClick) return;
        suppressOpenClick = false;
        if (suppressTimer != null) {
          clearTimeout(suppressTimer);
          suppressTimer = null;
        }
        ev.preventDefault();
        ev.stopPropagation();
      },
      true
    );
    listEl.addEventListener("dragstart", (ev) => {
      const item = ev.target?.closest?.("[data-note-id]");
      if (!(item instanceof HTMLElement) || !listEl.contains(item)) return;
      const id = item.getAttribute("data-note-id");
      if (!id || !currentNotes().some((n) => n.id === id)) return;
      dragId = id;
      item.classList.add("np-item-dragging");
      try {
        ev.dataTransfer?.setData("application/x-arousal-note-id", id);
      } catch {
      }
      ev.dataTransfer?.setData("text/plain", id);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
    });
    listEl.addEventListener("dragend", () => {
      if (dragId) armSuppressOpenClick();
      clearDragOver();
      clearDragging();
      dragId = null;
    });
    listEl.addEventListener("dragover", (ev) => {
      if (!dragId) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      const over = ev.target?.closest?.("[data-note-id]");
      clearDragOver();
      if (over instanceof HTMLElement && listEl.contains(over) && over.getAttribute("data-note-id") !== dragId) {
        over.classList.add("np-item-drag-over");
      }
    });
    listEl.addEventListener("dragleave", (ev) => {
      const related = ev.relatedTarget;
      if (related instanceof Node && listEl.contains(related)) return;
      clearDragOver();
    });
    listEl.addEventListener("drop", (ev) => {
      if (!dragId) return;
      ev.preventDefault();
      const fromId = dragId;
      const over = ev.target?.closest?.("[data-note-id]");
      const toId = over instanceof HTMLElement && listEl.contains(over) ? over.getAttribute("data-note-id") : null;
      clearDragOver();
      clearDragging();
      armSuppressOpenClick();
      dragId = null;
      if (!toId || !currentNotes().some((n) => n.id === fromId)) return;
      if (!currentNotes().some((n) => n.id === toId)) return;
      void reorderInsertBefore(fromId, toId);
    });
    listEl.addEventListener("keydown", (ev) => {
      if (!ev.altKey || ev.repeat || ev.ctrlKey || ev.metaKey) return;
      if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
      const item = ev.target?.closest?.("[data-note-id]");
      if (!(item instanceof HTMLElement) || !listEl.contains(item)) return;
      const noteId = item.getAttribute("data-note-id");
      if (!noteId) return;
      ev.preventDefault();
      ev.stopPropagation();
      void reorderByDelta(noteId, ev.key === "ArrowUp" ? -1 : 1).then(() => {
        window.setTimeout(() => {
          document.querySelector(
            `[data-plugin-live-text="note-list"] [data-note-id="${CSS.escape(noteId)}"]`
          )?.focus();
        }, 0);
      });
    });
  }
  host.ui.panel.register({
    placement: PANEL_PLACEMENT,
    tabIcon: "mdi-note-text-outline",
    tabLabelKey: host.pluginKey("panelLabel"),
    interactive: true,
    routes: ["chat"]
  });
  host.registerSlotButton("composer-toolbar", {
    id: `${PLUGIN_ID}-open`,
    icon: "mdi-note-edit-outline",
    tooltipKey: host.pluginKey("tooltipOpen"),
    onClick: () => {
      state.conversationId = host.session.conversationId;
      loadNotes().then(() => {
        host.ui.panel.setHidden(PANEL_PLACEMENT, false);
        host.ui.panel.open(PANEL_PLACEMENT, PLUGIN_ID);
      }).catch(() => {
        host.ui.panel.setHidden(PANEL_PLACEMENT, false);
        host.ui.panel.open(PANEL_PLACEMENT, PLUGIN_ID);
      });
    }
  });
  host.ui.panel.onEvent(PANEL_PLACEMENT, PLUGIN_ID, {
    onLiveTextMounted({ textId, element }) {
      if (textId !== "note-list") return;
      bindNoteListDrag(element);
    },
    onAction({ action }) {
      if (action === "scope:global") {
        state.scope = "global";
        state.activeNoteId = null;
        state.editingNoteId = null;
        refresh();
        return;
      }
      if (action === "scope:conversation") {
        if (!state.conversationId) return;
        state.scope = "conversation";
        state.activeNoteId = null;
        state.editingNoteId = null;
        refresh();
        return;
      }
      if (action === "new-note") {
        state.editingNoteId = "new";
        state.activeNoteId = null;
        state.editTitle = "";
        state.editBody = "";
        refresh();
        return;
      }
      if (action.startsWith("open:")) {
        state.activeNoteId = action.slice("open:".length);
        state.editingNoteId = null;
        refresh();
        return;
      }
      if (action === "back") {
        state.activeNoteId = null;
        state.editingNoteId = null;
        refresh();
        return;
      }
      if (action === "edit") {
        const note = currentNotes().find((n) => n.id === state.activeNoteId);
        if (!note) return;
        state.editingNoteId = note.id;
        state.editTitle = note.title;
        state.editBody = note.body;
        refresh();
        return;
      }
      if (action === "cancel-edit") {
        state.editingNoteId = null;
        refresh();
        return;
      }
      if (action === "save-note") {
        void saveCurrentNote();
        return;
      }
      if (action.startsWith("delete:")) {
        void deleteNote(action.slice("delete:".length));
        return;
      }
      if (action.startsWith("toggle-cb:")) {
        const lineIndex = parseInt(action.slice("toggle-cb:".length), 10);
        if (state.activeNoteId && Number.isFinite(lineIndex)) {
          void toggleCheckbox(state.activeNoteId, lineIndex);
        }
      }
    },
    onInput({ field, value }) {
      if (field === "edit-title") {
        state.editTitle = value;
        return;
      }
      if (field === "edit-body") {
        state.editBody = value;
      }
    }
  });
  refresh();
  void loadNotes();
}
export {
  register
};
