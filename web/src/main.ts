import '@mdi/font/css/materialdesignicons.css'
import { i18n } from '@/i18n'
import { router } from '@/router'
import { readStoredTheme } from '@/theme/theme-preference'
import { buildVuetifyThemes } from '@/theme/build-vuetify-themes'
import { readOklchOverrides } from '@/theme/overrides-storage'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import 'vuetify/styles'
import App from './App.vue'

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: readStoredTheme(),
    themes: buildVuetifyThemes(readOklchOverrides()),
  },
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)
app.use(vuetify)
app.mount('#app')
