<script setup lang="ts">
import {
  computed,
  shallowRef,
  useAuthFlow,
} from '#imports';
import type { MfaRequired } from '@weave/types';

const props = defineProps<{
  redirect: string;
}>();

const emit = defineEmits<{
  authenticated: [];
}>();

const identifier = shallowRef('');
const registrationEmail = shallowRef('');
const challenge = shallowRef<MfaRequired | null>(null);
const step = shallowRef<'identifier' | 'method' | 'mfa' | 'register'>('identifier');
const {
  busy,
  discover,
  error,
  loginWithPasskey,
} = useAuthFlow();

const copy = computed(() => {
  if (step.value === 'register') {
    return {
      title: '创建账号后继续',
      description: '验证邮箱并完善账号信息，即可继续填写。',
    };
  }
  if (step.value === 'mfa') {
    return {
      title: '确认是你本人',
      description: '完成账号的第二重验证后继续填写。',
    };
  }
  if (step.value === 'method') {
    return {
      title: '欢迎回来',
      description: '选择密码或邮箱验证码登录。',
    };
  }
  return {
    title: '在开始前，请先登录',
    description: '输入已有账号，或使用尚未注册的邮箱创建账号。',
  };
});

async function continueWithIdentifier(): Promise<void> {
  try {
    const options = await discover(identifier.value);
    if (options.next === 'register') {
      registrationEmail.value = options.email;
      step.value = 'register';
      return;
    }
    step.value = 'method';
  } catch {
    // useAuthFlow exposes the safe inline message.
  }
}

function requireMfa(nextChallenge: MfaRequired): void {
  challenge.value = nextChallenge;
  step.value = 'mfa';
}

async function passkeyLogin(): Promise<void> {
  try {
    const result = await loginWithPasskey();
    if (result.outcome === 'mfa_required') {
      requireMfa(result);
      return;
    }
    emit('authenticated');
  } catch {
    // useAuthFlow exposes the safe inline message.
  }
}
</script>

<template>
  <div>
    <header class="mb-7">
      <h2 class="text-xl font-bold tracking-tight text-highlighted sm:text-2xl">
        {{ copy.title }}
      </h2>
      <p class="mt-2 text-sm leading-6 text-muted">
        {{ copy.description }}
      </p>
    </header>

    <div class="motion-safe:animate-[form-auth-enter_180ms_ease-out] motion-reduce:animate-none">
      <AuthIdentifierStep
        v-if="step === 'identifier'"
        v-model="identifier"
        :busy="busy"
        :error="error"
        @continue="continueWithIdentifier"
        @passkey="passkeyLogin"
      />

      <AuthLoginMethodStep
        v-else-if="step === 'method'"
        :identifier="identifier"
        :redirect="props.redirect"
        @authenticated="emit('authenticated')"
        @back="step = 'identifier'"
        @mfa-required="requireMfa"
      />

      <AuthMfaStep
        v-else-if="step === 'mfa' && challenge"
        :challenge="challenge"
        @authenticated="emit('authenticated')"
        @back="step = 'method'; challenge = null"
      />

      <AuthRegistrationFlow
        v-else
        variant="full"
        :initial-email="registrationEmail"
        start-immediately
        @authenticated="emit('authenticated')"
        @cancel="step = 'identifier'"
      />
    </div>
  </div>
</template>

<style scoped>
@keyframes form-auth-enter {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
