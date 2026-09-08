import type {
  ComputedRef,
  Ref,
} from 'vue';
import type { JsonValue } from '@weave/types';
import {
  computed,
  inject,
} from '#imports';
import {
  formRenderContextKey,
  type ResolvedFormItem,
} from '../types';

export interface FormItemProps {
  item?: ResolvedFormItem;
  name?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  error?: boolean | string;
}

interface FormItemBaseProps {
  name?: string;
  label?: string;
  required: boolean;
  error?: boolean | string;
  labelHidden: boolean;
}

interface FormItemBinding<T> {
  baseProps: ComputedRef<FormItemBaseProps>;
  disabled: ComputedRef<boolean>;
  modelValue: Ref<T | undefined>;
  placeholder: ComputedRef<string | undefined>;
}

/** 将渲染器上下文适配到可单独使用的表单项组件。 */
export function useFormItemBinding<T>(
  props: FormItemProps,
  model: Ref<T | undefined>,
): FormItemBinding<T> {
  const directModel = model;
  const formContext = inject(formRenderContextKey, null);
  const state = computed(() => formContext?.value.state);

  const baseProps = computed(() => ({
    name: props.name ?? props.item?.id,
    label: props.label ?? props.item?.title,
    required: props.required ?? props.item?.required ?? false,
    error: props.error ?? (props.item ? formContext?.value.errors[props.item.id] : undefined),
    labelHidden: Boolean(props.item),
  }));
  const disabled = computed(() => props.disabled ?? false);
  const placeholder = computed(() => props.placeholder ?? props.item?.placeholder);
  const modelValue = computed<T | undefined>({
    get: () => {
      if (props.item && state.value) return state.value[props.item.id] as T | undefined;
      return model.value;
    },
    set: (value) => {
      if (props.item && state.value) {
        state.value[props.item.id] = value as JsonValue | undefined;
        return;
      }
      directModel.value = value;
    },
  });

  return {
    baseProps,
    disabled,
    modelValue,
    placeholder,
  };
}
