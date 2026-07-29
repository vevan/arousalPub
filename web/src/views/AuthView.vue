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

const hint = computed(() =>
  props.mode === 'setup'
    ? t('auth.setupHint')
    : showRegister.value
      ? t('auth.registerHint')
      : t('auth.loginHint'),
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
  <div class="auth-shell">
    <div class="auth-shell__glow" aria-hidden="true" />
    <div class="auth-shell__grain" aria-hidden="true" />

    <header class="auth-brand">
      <img
        class="auth-brand__logo"
        src="/logo.png"
        width="420"
        height="236"
        :alt="t('auth.brandAlt')"
        decoding="async"
      />
    </header>

    <section class="auth-panel" :aria-labelledby="`auth-title-${mode}`">
      <div v-if="mode === 'setup'" class="auth-panel__avatar">
        <v-avatar size="72" rounded="lg">
          <v-img :src="avatarPreviewUrl" cover />
        </v-avatar>
      </div>

      <h1 :id="`auth-title-${mode}`" class="auth-panel__title">
        {{ title }}
      </h1>
      <p class="auth-panel__hint">
        {{ hint }}
      </p>

      <v-alert
        v-if="errorText"
        type="error"
        density="compact"
        variant="tonal"
        class="auth-panel__alert"
      >
        {{ errorText }}
      </v-alert>

      <v-form class="auth-panel__form" autocomplete="on" @submit.prevent="submit">
        <v-text-field
          v-model="username"
          :label="t('auth.username')"
          name="username"
          autocomplete="username"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          class="auth-panel__field"
        />
        <v-text-field
          v-if="mode === 'login' && showRegister"
          v-model="displayName"
          :label="t('auth.displayNameOptional')"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          class="auth-panel__field"
        />
        <v-text-field
          v-model="password"
          :label="t('auth.password')"
          name="password"
          type="password"
          :autocomplete="passwordAutocomplete"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          class="auth-panel__field"
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
          hide-details="auto"
          class="auth-panel__field"
        />

        <v-checkbox
          v-model="rememberDefault"
          :label="t('auth.rememberDefault')"
          density="compact"
          hide-details
          class="auth-panel__remember"
        />

        <v-btn
          color="primary"
          block
          size="large"
          type="submit"
          class="auth-panel__submit"
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

      <button
        v-if="mode === 'login'"
        type="button"
        class="auth-panel__switch"
        @click="showRegister = !showRegister"
      >
        {{
          showRegister ? t('auth.switchToLogin') : t('auth.switchToRegister')
        }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.auth-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(100%, 26rem);
  padding: 1.5rem 1rem 2rem;
  isolation: isolate;
}

.auth-shell__glow {
  position: absolute;
  inset: -12% -18% auto;
  height: 18rem;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(
      55% 60% at 50% 35%,
      rgba(var(--v-theme-primary), 0.22),
      transparent 70%
    ),
    radial-gradient(
      40% 45% at 30% 55%,
      rgba(var(--v-theme-secondary), 0.14),
      transparent 70%
    ),
    radial-gradient(
      35% 40% at 72% 48%,
      rgba(0, 229, 255, 0.08),
      transparent 72%
    );
  filter: blur(0.5rem);
  animation: auth-glow-breathe 7s ease-in-out infinite;
}

.auth-shell__grain {
  position: absolute;
  inset: -20%;
  z-index: -2;
  pointer-events: none;
  opacity: 0.28;
  background-image:
    radial-gradient(rgba(var(--v-theme-on-surface), 0.045) 0.06rem, transparent 0.07rem);
  background-size: 0.55rem 0.55rem;
  mask-image: radial-gradient(circle at 50% 28%, #000 0%, transparent 72%);
}

.auth-brand {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  margin-bottom: 1.25rem;
  animation: auth-brand-enter 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.auth-brand__logo {
  display: block;
  width: min(100%, 18.5rem);
  height: auto;
  object-fit: contain;
  filter: drop-shadow(0 0 1.25rem rgba(0, 0, 0, 0.55));
}

.auth-panel {
  width: 100%;
  padding: 1.35rem 1.25rem 1.15rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: var(--radius-lg);
  background:
    linear-gradient(
      180deg,
      rgba(var(--v-theme-surface-bright), 0.42),
      rgba(var(--v-theme-surface), 0.78)
    );
  box-shadow:
    0 1rem 2.5rem rgba(0, 0, 0, 0.28),
    inset 0 0.0625rem 0 rgba(var(--v-theme-on-surface), 0.04);
  backdrop-filter: blur(0.75rem);
  animation: auth-panel-enter 0.75s cubic-bezier(0.22, 1, 0.36, 1) 0.08s both;
}

.auth-panel__avatar {
  display: flex;
  justify-content: center;
  margin-bottom: 0.85rem;
}

.auth-panel__title {
  margin: 0 0 0.35rem;
  font-family: var(--font-display);
  font-size: 1.65rem;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.01em;
  color: rgb(var(--v-theme-on-surface));
  text-align: center;
}

.auth-panel__hint {
  margin: 0 0 1.1rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.8125rem;
  line-height: 1.55;
  text-align: center;
}

.auth-panel__alert {
  margin-bottom: 0.85rem;
}

.auth-panel__form {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.auth-panel__field {
  margin: 0;
}

.auth-panel__remember {
  margin: 0.1rem 0 0.15rem;
}

.auth-panel__submit {
  margin-top: 0.35rem;
  letter-spacing: 0.03em;
  font-weight: 600;
}

.auth-panel__switch {
  display: block;
  width: 100%;
  margin-top: 0.85rem;
  padding: 0.45rem 0.25rem;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font: inherit;
  font-size: 0.8125rem;
  text-align: center;
  cursor: pointer;
  transition: color 0.18s ease;
}

.auth-panel__switch:hover,
.auth-panel__switch:focus-visible {
  color: rgb(var(--v-theme-primary));
  outline: none;
}

@keyframes auth-brand-enter {
  from {
    opacity: 0;
    transform: translateY(0.55rem) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes auth-panel-enter {
  from {
    opacity: 0;
    transform: translateY(0.75rem);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes auth-glow-breathe {
  0%,
  100% {
    opacity: 0.85;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.03);
  }
}

/* 宽屏：左品牌 / 右表单 */
@media (min-width: 56rem) {
  .auth-shell {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(20rem, 24rem);
    align-items: center;
    column-gap: clamp(2rem, 5vw, 4.5rem);
    width: min(100%, 68rem);
    min-height: min(36rem, calc(100dvh - 2rem));
    padding: 2rem clamp(1.5rem, 4vw, 3rem);
  }

  .auth-shell__glow {
    inset: 8% auto 8% 0;
    width: 58%;
    height: auto;
    background:
      radial-gradient(
        55% 55% at 42% 48%,
        rgba(var(--v-theme-primary), 0.26),
        transparent 70%
      ),
      radial-gradient(
        42% 48% at 28% 62%,
        rgba(var(--v-theme-secondary), 0.16),
        transparent 72%
      ),
      radial-gradient(
        36% 42% at 58% 38%,
        rgba(0, 229, 255, 0.1),
        transparent 74%
      );
  }

  .auth-shell__grain {
    mask-image: radial-gradient(ellipse 70% 80% at 32% 50%, #000 0%, transparent 78%);
  }

  .auth-brand {
    grid-column: 1;
    grid-row: 1;
    justify-self: center;
    margin-bottom: 0;
    min-height: 16rem;
    padding-inline: 1rem;
    animation-name: auth-brand-enter-wide;
  }

  .auth-brand__logo {
    width: min(100%, 26rem);
  }

  .auth-panel {
    grid-column: 2;
    grid-row: 1;
    justify-self: stretch;
    padding: 1.65rem 1.5rem 1.35rem;
    animation-name: auth-panel-enter-wide;
  }

  .auth-panel__avatar {
    justify-content: flex-start;
  }

  .auth-panel__title,
  .auth-panel__hint,
  .auth-panel__switch {
    text-align: left;
  }
}

@keyframes auth-brand-enter-wide {
  from {
    opacity: 0;
    transform: translateX(-0.75rem) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes auth-panel-enter-wide {
  from {
    opacity: 0;
    transform: translateX(0.85rem);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-shell__glow,
  .auth-brand,
  .auth-panel {
    animation: none;
  }
}
</style>
