import type {
  DatasetChoiceOption,
  FormItemId,
} from '@weave/types';
import type { ParsedFormSchema } from '@weave/utils';
import { getChoiceOptions, resolveLocalizedText } from '@weave/utils';

import type { ResolvedFormItem } from '~/components/form/types';

export function resolveFormRenderItems(
  parsed: ParsedFormSchema,
  locale: string,
  defaultLocale: string,
  choiceOptions: Readonly<Record<FormItemId, readonly DatasetChoiceOption[]>> = {},
  visibleItemIds?: ReadonlySet<FormItemId>,
): ResolvedFormItem[] {
  return parsed.items
    .filter((item) => !visibleItemIds || visibleItemIds.has(item.id))
    .map((item) => ({
      id: item.id,
      property: item.property,
      extension: item.extension,
      required: item.required,
      widget: item.widget,
      title: resolveLocalizedText(
        item.extension.i18n?.title,
        locale,
        defaultLocale,
      ) ?? item.id,
      description: resolveLocalizedText(
        item.extension.i18n?.description,
        locale,
        defaultLocale,
      ),
      placeholder: resolveLocalizedText(
        item.extension.i18n?.placeholder,
        locale,
        defaultLocale,
      ),
      choiceOptions: choiceOptions[item.id]
        ?? getChoiceOptions(item.property, locale, defaultLocale).flatMap((option) => (
          typeof option.value === 'string'
            ? [{ label: option.label, value: option.value }]
            : []
        )),
    }));
}
