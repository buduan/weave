import type { Component } from 'vue';

import FormItemsCascader from './items/Cascader.vue';
import FormItemsCheckbox from './items/Checkbox.vue';
import FormItemsInput from './items/Input.vue';
import FormItemsRadio from './items/Radio.vue';
import FormItemsSelector from './items/Selector.vue';
import FormItemsTagsInput from './items/TagsInput.vue';
import FormItemsTextarea from './items/Textarea.vue';
import { resolveWidgetName } from './widget-resolution';

export { resolveInputType, resolveWidgetName } from './widget-resolution';

/**
 * widget 名 → 叶子组件。
 * 每个 items/* 文件对应一种表单数据类型。
 */
export const formComponentMap: Record<string, Component> = {
  input: FormItemsInput,
  textarea: FormItemsTextarea,
  checkbox: FormItemsCheckbox,
  radio: FormItemsRadio,
  selector: FormItemsSelector,
  cascader: FormItemsCascader,
  'tags-input': FormItemsTagsInput,
};

/** 按 widget 名查找叶子组件；未知时返回 undefined。 */
export function resolveFormComponent(widget: string | undefined): Component | undefined {
  const name = resolveWidgetName(widget);
  if (!name) return undefined;
  return formComponentMap[name];
}
