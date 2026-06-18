const PLUGIN_ID = 'guidance-generate'



export function register(host) {

  const k = (key) => host.pluginKey(key)



  host.registerSlotButton('composer-toolbar', {

    id: `${PLUGIN_ID}-composer`,

    icon: 'mdi-lightbulb-on-outline',

    tooltipKey: k('tooltip'),

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

    tooltipKey: k('tooltip'),

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

    titleKey: k('dialogTitle'),

    fields: [

      { key: 'userText', labelKey: k('userLabel') },

      { key: 'guidanceText', labelKey: k('guidanceLabel') },

    ],

    submitKeys: {

      send: k('send'),

      regenerate: k('regenerate'),

    },

    canSubmit: (model) =>

      String(model.userText ?? '').trim().length > 0 &&

      String(model.guidanceText ?? '').trim().length > 0,

    onSubmit: (hostApi, model) => {

      const userText = String(model.userText ?? '').trim()

      const guidanceText = String(model.guidanceText ?? '').trim()

      const mode = model.mode === 'regenerate' ? 'regenerate' : 'send'

      const plugins = {

        [PLUGIN_ID]: { mode, guidanceText },

      }

      if (mode === 'send') {

        void hostApi.chat.sendWithPlugins(userText, plugins)

      } else {

        const listIndex = model.listIndex

        if (typeof listIndex !== 'number') return

        void hostApi.chat.regenerateWithPlugins(listIndex, userText, plugins)

      }

    },

  })

}

