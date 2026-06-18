const PLUGIN_ID = 'guidance-generate'

type GuidanceHost = {
  pluginKey: (key: string) => string
  t: (key: string) => string
  composer: { userInput: string }
  session: {
    loading: boolean
    regeneratingTurnOrdinal: number | null
  }
  turn: {
    isLastUserTurn: (turn: { user: string }) => boolean
    isTurnAwaitingAssistant: (turn: { receives?: unknown[] }) => boolean
  }
  ui: {
    toast: (message: string, opts?: { color?: string }) => void
    notify: (title: string, body?: string, opts?: { color?: string }) => void
  }
  chat: {
    sendWithPlugins: (
      userText: string,
      plugins: Record<string, unknown>,
    ) => Promise<string | undefined>
    regenerateWithPlugins: (
      listIndex: number,
      userText: string,
      plugins: Record<string, unknown>,
    ) => Promise<string | undefined>
  }
  registerSlotButton: (
    slot: string,
    def: Record<string, unknown>,
  ) => void
  registerFormDialog: (
    pluginId: string,
    def: Record<string, unknown>,
  ) => void
  openFormDialog: (
    pluginId: string,
    model: Record<string, unknown>,
    dialogId?: string,
  ) => void
}

const k = (host: GuidanceHost, key: string) => host.pluginKey(key)

function notifyGuidanceFailed(host: GuidanceHost, detail?: string): void {
  const title = host.t(k(host, 'toastFailed'))
  const body = detail?.trim()
  if (body) {
    host.ui.notify(title, body, { color: 'error' })
  } else {
    host.ui.toast(title, { color: 'error' })
  }
}

async function runGuidanceSubmit(
  hostApi: GuidanceHost,
  model: Record<string, unknown>,
): Promise<void> {
  const userText = String(model.userText ?? '').trim()
  const guidanceText = String(model.guidanceText ?? '').trim()
  const mode = model.mode === 'regenerate' ? 'regenerate' : 'send'
  const plugins = {
    [PLUGIN_ID]: { mode, guidanceText },
  }

  if (mode === 'send') {
    const err = await hostApi.chat.sendWithPlugins(userText, plugins)
    if (err) notifyGuidanceFailed(hostApi, err)
    return
  }

  const listIndex = model.listIndex
  if (typeof listIndex !== 'number') return
  const err = await hostApi.chat.regenerateWithPlugins(
    listIndex,
    userText,
    plugins,
  )
  if (err) notifyGuidanceFailed(hostApi, err)
}

export function register(host: GuidanceHost): void {
  host.registerSlotButton('composer-toolbar', {
    id: `${PLUGIN_ID}-composer`,
    icon: 'mdi-lightbulb-on-outline',
    tooltipKey: k(host, 'tooltip'),
    filled: false,
    onClick: () => {
      host.openFormDialog(PLUGIN_ID, {
        mode: 'send',
        userText: host.composer.userInput,
        guidanceText: '',
        listIndex: null,
      })
    },
  })

  host.registerSlotButton('user-turn-footer', {
    id: `${PLUGIN_ID}-regen`,
    icon: 'mdi-lightbulb-on-outline',
    tooltipKey: k(host, 'tooltip'),
    filled: true,
    when: (ctx) =>
      !!ctx.turn &&
      host.turn.isLastUserTurn(ctx.turn) &&
      ctx.turn.user.trim().length > 0,
    disabled: (ctx) =>
      host.session.loading ||
      host.session.regeneratingTurnOrdinal !== null ||
      (ctx.turn ? host.turn.isTurnAwaitingAssistant(ctx.turn) : false),
    onClick: (ctx) => {
      if (!ctx.turn || ctx.listIndex == null) return
      host.openFormDialog(PLUGIN_ID, {
        mode: 'regenerate',
        userText: ctx.turn.user,
        guidanceText: '',
        listIndex: ctx.listIndex,
      })
    },
  })

  host.registerFormDialog(PLUGIN_ID, {
    titleKey: k(host, 'dialogTitle'),
    fields: [
      { key: 'userText', labelKey: k(host, 'userLabel') },
      { key: 'guidanceText', labelKey: k(host, 'guidanceLabel') },
    ],
    submitKeys: {
      send: k(host, 'send'),
      regenerate: k(host, 'regenerate'),
    },
    canSubmit: (model) =>
      String(model.userText ?? '').trim().length > 0 &&
      String(model.guidanceText ?? '').trim().length > 0,
    onSubmit: (hostApi, model) => {
      void runGuidanceSubmit(hostApi, model)
    },
  })
}
