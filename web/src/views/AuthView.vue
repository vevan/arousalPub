<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  mode: 'setup' | 'login'
}>()

const emit = defineEmits<{
  done: []
}>()

const { t } = useI18n()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const password2 = ref('')
const displayName = ref('')
const rememberDefault = ref(false)
const showRegister = ref(false)
const busy = ref(false)
const errorText = ref('')

const title = computed(() =>
  props.mode === 'setup'
    ? t('auth.setupTitle')
    : showRegister.value
      ? t('auth.registerTitle')
      : t('auth.loginTitle'),
)

const avatarPreviewUrl = computed(() =>
  props.mode === 'setup' ? '/api/users/00000000/avatar' : '',
)

/** 登录用 current-password，避免 Chrome 在登录页弹出「建议密码 / 保存密码」 */
const passwordAutocomplete = computed(() =>
  props.mode === 'setup' || showRegister.value ? 'new-password' : 'current-password',
)

onMounted(() => {
  if (props.mode === 'login') rememberDefault.value = Boolean(auth.defaultUserId)
})

async function submit() {
  errorText.value = ''
  if (props.mode === 'setup' && password.value !== password2.value) {
    errorText.value = t('auth.passwordMismatch')
    return
  }
  busy.value = true
  try {
    if (props.mode === 'setup') {
      await auth.setupAccount({
        username: username.value,
        password: password.value,
        displayName: displayName.value || undefined,
        rememberDefault: rememberDefault.value,
      })
    } else if (showRegister.value) {
      await auth.register({
        username: username.value,
        password: password.value,
        displayName: displayName.value || undefined,
        rememberDefault: rememberDefault.value,
      })
    } else {
      await auth.login({
        username: username.value,
        password: password.value,
        rememberDefault: rememberDefault.value,
      })
    }
    emit('done')
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <v-container class="auth-view fill-height" max-width="440">
    <v-card class="pa-6" variant="outlined" rounded="lg">
      <div class="text-h5 font-weight-medium mb-1">
        {{ title }}
      </div>
      <p class="text-body-2 text-medium-emphasis mb-4">
        {{ mode === 'setup' ? t('auth.setupHint') : t('auth.loginHint') }}
      </p>

      <div v-if="mode === 'setup'" class="d-flex justify-center mb-4">
        <v-avatar size="96" rounded="lg">
          <v-img :src="avatarPreviewUrl" cover />
        </v-avatar>
      </div>

      <v-alert
        v-if="errorText"
        type="error"
        density="compact"
        variant="tonal"
        class="mb-3"
      >
        {{ errorText }}
      </v-alert>

      <v-form autocomplete="on" @submit.prevent="submit">
      <v-text-field
        v-model="username"
        :label="t('auth.username')"
        name="username"
        autocomplete="username"
        density="comfortable"
        variant="outlined"
        class="mb-2"
      />
      <v-text-field
        v-if="mode === 'login' && showRegister"
        v-model="displayName"
        :label="t('auth.displayNameOptional')"
        density="comfortable"
        variant="outlined"
        class="mb-2"
      />
      <v-text-field
        v-model="password"
        :label="t('auth.password')"
        name="password"
        type="password"
        :autocomplete="passwordAutocomplete"
        density="comfortable"
        variant="outlined"
        class="mb-2"
      />
      <v-text-field
        v-if="mode === 'setup'"
        v-model="password2"
        :label="t('auth.passwordConfirm')"
        name="password-confirm"
        type="password"
        autocomplete="new-password"
        density="comfortable"
        variant="outlined"
        class="mb-2"
      />

      <v-checkbox
        v-model="rememberDefault"
        :label="t('auth.rememberDefault')"
        density="compact"
        hide-details
        class="mb-2"
      />

      <v-btn
        color="primary"
        block
        size="large"
        type="submit"
        :loading="busy"
      >
        {{
          mode === 'setup'
            ? t('auth.setupSubmit')
            : showRegister
              ? t('auth.registerSubmit')
              : t('auth.loginSubmit')
        }}
      </v-btn>
      </v-form>

      <v-btn
        v-if="mode === 'login'"
        variant="text"
        block
        class="mt-2"
        @click="showRegister = !showRegister"
      >
        {{
          showRegister ? t('auth.switchToLogin') : t('auth.switchToRegister')
        }}
      </v-btn>
    </v-card>
  </v-container>
</template>

<style scoped>
.auth-view {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
}
</style>
