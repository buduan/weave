import type {
  ComponentPublicInstance,
  ComputedRef,
  InjectionKey,
} from 'vue';
import type {
  DatasetChoiceOption,
  FormItemExtension,
  FormItemId,
  FormRelationOption,
  FormWidget,
  JsonSchemaObject,
  JsonValue,
} from '@weave/types';

/** UInput / UTextarea 暴露的最小聚焦接口，供标题 / 描述内联编辑框使用。 */
export interface FormFieldTitleInput {
  focus: () => void;
}

/** 可被自动聚焦的组件实例（UInput 暴露 inputRef，UTextarea 暴露 textareaRef）。 */
export type FocusableInputInstance =
  | ComponentPublicInstance
  | FormFieldTitleInput
  | { inputRef: FormFieldTitleInput }
  | { textareaRef: FormFieldTitleInput };

/** FormRenderer 模式：编辑器选中 vs 填写。 */
export type FormRenderMode = 'edit' | 'fill';

/** Parsed and locale-resolved item consumed by FormField without re-reading the root Schema. */
export interface ResolvedFormItem {
  choiceOptions: readonly DatasetChoiceOption[];
  description?: string;
  extension: FormItemExtension;
  id: FormItemId;
  placeholder?: string;
  property: JsonSchemaObject;
  required: boolean;
  title: string;
  widget: FormWidget;
}

/** FormRenderer → FormField 的共享上下文。 */
export interface FormRenderContext {
  defaultLocale: string;
  errors: Readonly<Record<FormItemId, string>>;
  loadRelationOptions?: (
    itemId: FormItemId,
    answers: Readonly<Record<FormItemId, JsonValue>>,
  ) => Promise<FormRelationOption[]>;
  locale: string;
  mode: FormRenderMode;
  state: Record<FormItemId, JsonValue | undefined>;
}

export const formRenderContextKey: InjectionKey<ComputedRef<FormRenderContext>> = Symbol(
  'form-render-context',
);

export type { FormItemId, JsonValue };
