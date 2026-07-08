import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import '@/style.css'
import { bootstrapI18n, i18n } from '@/i18n'
import { router } from '@/router'
import { readStoredTheme } from '@/theme/theme-preference'
import { buildVuetifyThemes } from '@/theme/build-vuetify-themes'
import { readOklchOverrides } from '@/theme/overrides-storage'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import { VIconBtn } from 'vuetify/labs/VIconBtn'
import { VSnackbarQueue } from 'vuetify/components'
import App from './App.vue'
import '@/styles/vuetify-overrides.css'
import { installAuthenticatedFetch } from '@/utils/install-authenticated-fetch'

const vuetify = createVuetify({
  components: {
    VIconBtn,
    VSnackbarQueue,
  },
  theme: {
    defaultTheme: readStoredTheme(),
    themes: buildVuetifyThemes(readOklchOverrides()),
  },
})

async function bootstrap(): Promise<void> {
  await bootstrapI18n()

  const app = createApp(App)
  app.use(createPinia())
  installAuthenticatedFetch()
  app.use(router)
  app.use(i18n)
  app.use(vuetify)
  app.mount('#app')
}

void bootstrap()
