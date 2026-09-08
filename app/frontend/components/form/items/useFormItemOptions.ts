import type { Ref } from 'vue';
import { getRelationFilterDependencies } from '@weave/utils';
import {
  createRelationOptionRequest,
  isLatestRelationRequest,
} from '~/utils/form-relation-options';
import {
  computed,
  inject,
  shallowRef,
  watch,
} from '#imports';
import {
  formRenderContextKey,
  type ResolvedFormItem,
} from '../types';

export function useFormItemOptions(item: (() => ResolvedFormItem | undefined) | undefined): {
  hasRelationOptions: Readonly<Ref<boolean>>;
  loading: Readonly<Ref<boolean>>;
  error: Readonly<Ref<string | null>>;
  options: Readonly<Ref<Array<{ label: string; value: string }>>>;
} {
  const formContext = inject(formRenderContextKey, null);
  const remoteOptions = shallowRef<Array<{ label: string; value: string }>>([]);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);
  let latestRequestId = 0;

  const resolvedItem = computed(() => item?.());
  const relationDependencies = computed(() => getRelationFilterDependencies(
    resolvedItem.value?.extension.ui?.options?.filter,
  ));
  const hasRelationOptions = computed(() => (
    typeof resolvedItem.value?.extension.ui?.options?.labelFieldId === 'string'
    && Boolean(formContext?.value.loadRelationOptions)
  ));
  const request = computed(() => {
    if (!resolvedItem.value || !hasRelationOptions.value) return null;
    return createRelationOptionRequest(
      resolvedItem.value.id,
      relationDependencies.value,
      formContext?.value.state ?? {},
    );
  });

  function discardUnavailableSelection(optionIds: ReadonlySet<string>): void {
    const currentItem = resolvedItem.value;
    const state = formContext?.value.state;
    if (!currentItem || !state) return;
    const current = state[currentItem.id];
    if (Array.isArray(current)) {
      const next = current.filter((value) => typeof value === 'string' && optionIds.has(value));
      if (next.length !== current.length) state[currentItem.id] = next;
      return;
    }
    if (current !== undefined && (typeof current !== 'string' || !optionIds.has(current))) {
      delete state[currentItem.id];
    }
  }

  async function loadOptions(): Promise<void> {
    const currentItem = resolvedItem.value;
    const loader = formContext?.value.loadRelationOptions;
    const currentRequest = request.value;
    latestRequestId += 1;
    const requestId = latestRequestId;
    if (!currentItem || !currentRequest || !loader) {
      remoteOptions.value = [];
      loading.value = false;
      error.value = null;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const options = await loader(currentItem.id, currentRequest.values);
      if (!isLatestRelationRequest(requestId, latestRequestId)) return;
      remoteOptions.value = options.map((option) => ({
        label: option.label,
        value: option.id,
      }));
      discardUnavailableSelection(new Set(options.map((option) => option.id)));
    } catch {
      if (!isLatestRelationRequest(requestId, latestRequestId)) return;
      remoteOptions.value = [];
      error.value = '选项加载失败，请稍后重试';
    } finally {
      if (isLatestRelationRequest(requestId, latestRequestId)) loading.value = false;
    }
  }

  watch(
    [
      () => request.value?.key,
      () => formContext?.value.loadRelationOptions,
    ],
    () => { loadOptions(); },
    { immediate: true },
  );

  return {
    hasRelationOptions,
    loading,
    error,
    options: remoteOptions,
  };
}
