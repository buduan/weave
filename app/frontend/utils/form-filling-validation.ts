import type { ErrorObject } from 'ajv';

import type {
  FormItemId,
  JsonSchema,
  JsonValue,
} from '@weave/types';
import {
  createFormAjv,
  evaluateFormAnswers,
  parseFormSchema,
  resolveLocalizedText,
} from '@weave/utils';
import type { ParsedFormSchema } from '@weave/utils';

export interface FormFillingValidationResult {
  answers: Record<FormItemId, JsonValue>;
  fieldErrors: Record<FormItemId, string>;
  formErrors: string[];
  valid: boolean;
}

function itemIdFromError(error: ErrorObject): string | undefined {
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
    return error.params.missingProperty;
  }
  const segment = error.instancePath.split('/').filter(Boolean)[0];
  return segment?.replaceAll('~1', '/').replaceAll('~0', '~');
}

function itemTitle(
  parsed: ParsedFormSchema | null,
  itemId: string,
  locale: string,
  defaultLocale: string,
): string {
  const item = parsed?.items.find((candidate) => candidate.id === itemId);
  return resolveLocalizedText(
    item?.extension.i18n?.title,
    locale,
    defaultLocale,
  ) ?? itemId;
}

/** Validate the currently visible answer snapshot with the published Draft 2020-12 Schema. */
export function validateFormFilling(
  schema: JsonSchema,
  answers: Readonly<Record<FormItemId, JsonValue | undefined>>,
  locale: string,
  defaultLocale: string,
): FormFillingValidationResult {
  let parsed: ParsedFormSchema | null = null;
  let payload: Record<FormItemId, JsonValue> = {};
  let effectiveSchema = schema;
  if (typeof schema !== 'boolean') {
    try {
      parsed = parseFormSchema(schema, { mode: 'legacy' });
      const evaluated = evaluateFormAnswers({
        parsed,
        runtimeSchema: schema,
        inputAnswers: answers,
        rejectExplicitHidden: false,
      });
      payload = evaluated.answers;
      effectiveSchema = evaluated.effectiveSchema;
    } catch (error) {
      return {
        answers: {},
        fieldErrors: {},
        formErrors: [
          `表单配置无效：${error instanceof Error ? error.message : String(error)}`,
        ],
        valid: false,
      };
    }
  }
  const ajv = createFormAjv();
  const validate = ajv.compile(effectiveSchema);
  const valid = validate(payload);
  const fieldErrors: Record<string, string> = {};
  const formErrors: string[] = [];
  (validate.errors ?? []).forEach((error) => {
    if (error.keyword === 'if' && (validate.errors?.length ?? 0) > 1) return;
    const itemId = itemIdFromError(error);
    if (itemId && parsed?.items.some((item) => item.id === itemId)) {
      if (!fieldErrors[itemId]) {
        const title = itemTitle(parsed, itemId, locale, defaultLocale);
        fieldErrors[itemId] = error.keyword === 'required'
          ? `${title}为必填项`
          : `${title}${error.message ? `：${error.message}` : '格式不正确'}`;
      }
      return;
    }
    const message = error.message ? `表单${error.message}` : '表单内容不符合要求';
    if (!formErrors.includes(message)) formErrors.push(message);
  });
  return {
    answers: payload,
    fieldErrors,
    formErrors,
    valid: Boolean(valid),
  };
}
