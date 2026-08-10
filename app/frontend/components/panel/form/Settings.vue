<script setup lang="ts">
/* eslint-disable vue/valid-v-for -- settings rows use tuple keys or positional draft conditions */
import type {
  AvailableIfExpression,
  CreateDatasetPanelFieldRequest,
  DatasetChoiceOption,
  DatasetFieldKind,
  DatasetPanelDetail,
  FormCaptureSettings,
  FormItemUiOptions,
  FormSubmissionAccess,
  FormWriteMode,
  JsonSchemaObject,
  JsonValue,
  RelationFilterCondition,
  RelationFilterExpression,
  RelationFilterOperator,
} from '@weave/types';
import { relationFilterOperators } from '@weave/types';
import { computed, ref, shallowRef } from '#imports';
import {
  createDatasetFieldConfig,
  getFormProperty,
  isFormItemRequired,
  resolveFormItemTemplate,
  type FormConstraintKey,
} from '~/utils/form-editor-schema';
import {
  canonicalizeFormLocale,
  formatFormLocale,
  orderFormLocales,
} from '~/utils/form-locales';

const props = withDefaults(defineProps<{
  activeLocale: string;
  capture: FormCaptureSettings;
  choiceDirty?: boolean;
  choiceError?: string | null;
  choiceOptions?: readonly DatasetChoiceOption[];
  choiceSaving?: boolean;
  closesAt?: string;
  closingMessage: string;
  dataset?: DatasetPanelDetail | null;
  defaultLocale: string;
  description: string;
  disabled?: boolean;
  formTitle: string;
  locales: string[];
  opensAt?: string;
  relationDataset?: DatasetPanelDetail | null;
  schema: JsonSchemaObject;
  selectedFieldId?: string | null;
  submissionAccess: FormSubmissionAccess;
  writeMode: FormWriteMode;
}>(), {
  choiceDirty: false,
  choiceError: null,
  choiceOptions: () => [],
  choiceSaving: false,
  closesAt: undefined,
  dataset: null,
  disabled: false,
  opensAt: undefined,
  relationDataset: null,
  selectedFieldId: null,
});

const emit = defineEmits<{
  'update:activeLocale': [locale: string];
  'update:availableIf': [value: AvailableIfExpression | undefined];
  'update:capture': [key: keyof FormCaptureSettings, enabled: boolean];
  'update:choiceOptions': [options: DatasetChoiceOption[]];
  'update:closingMessage': [value: string];
  'update:constraint': [key: FormConstraintKey, value: JsonValue | undefined];
  'update:datasetFieldId': [value: string];
  'update:default': [value: JsonValue | undefined];
  'update:defaultLocale': [locale: string];
  'update:description': [value: string];
  'update:fieldDescription': [value: string];
  'update:fieldPlaceholder': [value: string];
  'update:fieldTitle': [value: string];
  'update:formTitle': [value: string];
  'update:opensAt': [value?: string];
  'update:closesAt': [value?: string];
  'update:relationOptions': [value: FormItemUiOptions | undefined];
  'update:required': [value: boolean];
  'update:submissionAccess': [value: FormSubmissionAccess];
  'update:writeMode': [value: FormWriteMode];
  addLocale: [locale: string];
  createField: [request: CreateDatasetPanelFieldRequest];
  saveChoices: [];
} >();

const localeDraft = shallowRef('');
const localeError = shallowRef<string | null>(null);
const defaultError = shallowRef<string | null>(null);
const relationValueErrors = ref<Record<number, string>>({});
const createFieldOpen = shallowRef(false);
const createFieldError = shallowRef<string | null>(null);
const createFieldModel = ref<{ key: string; kind: DatasetFieldKind; name: string }>({
  key: '', kind: 'text', name: '',
});

const localeItems = computed(() => orderFormLocales(props.defaultLocale, props.locales)
  .map((locale) => ({ label: formatFormLocale(locale), value: locale })));
const selectedProperty = computed(() => (props.selectedFieldId
  ? getFormProperty(props.schema, props.selectedFieldId)
  : null));
const selectedExtension = computed(() => (
  selectedProperty.value?.['x-form'] as Record<string, unknown> | undefined
));
const selectedI18n = computed(() => (
  selectedExtension.value?.i18n as Record<string, Record<string, string>> | undefined
));
const selectedTemplate = computed(() => (props.selectedFieldId
  ? resolveFormItemTemplate(props.schema, props.selectedFieldId)
  : null));
const fieldTitle = computed(() => selectedI18n.value?.title?.[props.activeLocale] ?? '');
const fieldDescription = computed(() => selectedI18n.value?.description?.[props.activeLocale] ?? '');
const fieldPlaceholder = computed(() => selectedI18n.value?.placeholder?.[props.activeLocale] ?? '');
const datasetFieldId = computed(() => (
  typeof selectedExtension.value?.datasetFieldId === 'string'
    ? selectedExtension.value.datasetFieldId
    : ''
));
const selectedDatasetField = computed(() => props.dataset?.fields
  .find((field) => field.id === datasetFieldId.value) ?? null);
const datasetFieldItems = computed(() => (props.dataset?.fields ?? [])
  .filter((field) => !field.archivedAt && Boolean(selectedTemplate.value?.accepts(field)))
  .map((field) => ({ label: `${field.name} · ${field.key}`, value: field.id })));
const required = computed(() => Boolean(
  props.selectedFieldId && isFormItemRequired(props.schema, props.selectedFieldId),
));
const itemFieldItems = computed(() => Object.keys(
  props.schema.properties as Record<string, unknown> | undefined ?? {},
).filter((id) => id !== props.selectedFieldId).map((id) => {
  const property = getFormProperty(props.schema, id);
  const extension = property?.['x-form'] as Record<string, unknown> | undefined;
  const i18n = extension?.i18n as Record<string, Record<string, string>> | undefined;
  return { label: i18n?.title?.[props.activeLocale] ?? id, value: id };
}));
const availableIf = computed(() => (
  selectedExtension.value?.availableIf as AvailableIfExpression | undefined
));
const relationOptions = computed(() => {
  const ui = selectedExtension.value?.ui as Record<string, unknown> | undefined;
  return ui?.options as FormItemUiOptions | undefined;
});
const relationFilter = computed(() => relationOptions.value?.filter);
const relationGroup = computed<'all' | 'any'>(() => (relationFilter.value?.any ? 'any' : 'all'));
const relationConditions = computed(() => relationFilter.value?.[relationGroup.value] ?? []);
const relationFieldItems = computed(() => (props.relationDataset?.fields ?? [])
  .filter((field) => !field.archivedAt && !field.isSystemManaged && field.kind !== 'relation')
  .map((field) => ({ label: `${field.name} · ${field.key}`, value: field.id })));
const relationFilterOperatorItems = relationFilterOperators
  .map((value) => ({ label: value, value }));
const writeModeItems = [
  { label: '新增数据行', value: 'create_row' },
  { label: '更新当前用户数据行', value: 'update_subject_row' },
];
const accessItems = [
  { label: '允许匿名提交', value: 'anonymous_allowed' },
  { label: '必须登录', value: 'authentication_required' },
];
const fieldKindItems: Array<{ label: string; value: DatasetFieldKind }> = [
  { label: '单行文本', value: 'text' },
  { label: '多行文本', value: 'long_text' },
  { label: '数字', value: 'number' },
  { label: '布尔值', value: 'boolean' },
  { label: '单选', value: 'single_select' },
  { label: '多选', value: 'multi_select' },
];
const createFieldKindItems = computed(() => fieldKindItems.filter((item) => (
  selectedTemplate.value?.compatibleDatasetKinds.includes(item.value)
)));
const captureItems = [
  ['browser', '浏览器'],
  ['operatingSystem', '操作系统'],
  ['userAgent', 'User-Agent'],
] as const;
const relationGroupItems = [
  { label: '全部满足', value: 'all' },
  { label: '任一满足', value: 'any' },
];
const relationValueSourceItems = [
  { label: '固定值', value: 'literal' },
  { label: '来自表单项', value: 'item' },
];
const subjectWriteModeInvalid = computed(() => (
  props.writeMode === 'update_subject_row'
    && (
      props.dataset?.subjectMode !== 'single_per_user'
      || props.submissionAccess !== 'authentication_required'
    )
));

function addLocale(): void {
  const locale = canonicalizeFormLocale(localeDraft.value);
  if (!locale) {
    localeError.value = '请输入有效的 BCP 47 语言标识，例如 en-US。';
    return;
  }
  if (props.locales.includes(locale)) {
    localeError.value = '该语言已存在。';
    return;
  }
  emit('addLocale', locale);
  localeDraft.value = '';
  localeError.value = null;
}

function emitNumberConstraint(key: FormConstraintKey, raw: string | number): void {
  emit('update:constraint', key, raw === '' ? undefined : Number(raw));
}

function numericConstraint(key: FormConstraintKey): number | undefined {
  const value = selectedProperty.value?.[key];
  return typeof value === 'number' ? value : undefined;
}

function stringConstraint(key: 'format' | 'pattern'): string | undefined {
  const value = selectedProperty.value?.[key];
  return typeof value === 'string' ? value : undefined;
}

function emitStringConstraint(key: 'format' | 'pattern', raw: unknown): void {
  emit('update:constraint', key, raw ? String(raw) : undefined);
}

function defaultSource(): string {
  return selectedProperty.value && Object.hasOwn(selectedProperty.value, 'default')
    ? JSON.stringify(selectedProperty.value.default)
    : '';
}

function updateDefault(raw: string): void {
  if (!raw.trim()) {
    defaultError.value = null;
    emit('update:default', undefined);
    return;
  }
  try {
    emit('update:default', JSON.parse(raw) as JsonValue);
    defaultError.value = null;
  } catch {
    defaultError.value = '默认值必须是有效 JSON；字符串需要双引号。';
  }
}

function emitRelationOptions(next: Partial<FormItemUiOptions>): void {
  const value = { ...(relationOptions.value ?? {}), ...next };
  if (!value.labelFieldId && !value.filter) emit('update:relationOptions', undefined);
  else emit('update:relationOptions', value);
}

function updateRelationGroup(group: 'all' | 'any'): void {
  const conditions = relationConditions.value;
  emitRelationOptions({ filter: conditions.length > 0 ? { [group]: conditions } : undefined });
}

function updateRelationCondition(index: number, patch: Partial<RelationFilterCondition>): void {
  const conditions = relationConditions.value.map((condition, candidate) => {
    if (candidate !== index) return condition;
    const next = { ...condition, ...patch } as Record<string, unknown>;
    if (patch.valueFrom !== undefined) delete next.value;
    if (patch.value !== undefined) delete next.valueFrom;
    if (next.operator === 'is_empty' || next.operator === 'is_not_empty') {
      delete next.value;
      delete next.valueFrom;
    }
    Object.keys(next).forEach((key) => {
      if (next[key] === undefined) delete next[key];
    });
    return next as unknown as RelationFilterCondition;
  });
  emitRelationOptions({ filter: { [relationGroup.value]: conditions } });
}

function updateRelationOperator(index: number, value: unknown): void {
  updateRelationCondition(index, { operator: value as RelationFilterOperator });
}

function updateRelationValueFrom(index: number, value: unknown): void {
  updateRelationCondition(index, { valueFrom: String(value), value: undefined });
}

function addRelationCondition(): void {
  const fieldId = relationFieldItems.value[0]?.value;
  if (!fieldId) return;
  const conditions: RelationFilterCondition[] = [
    ...relationConditions.value,
    { fieldId, operator: 'equals', value: '' },
  ];
  emitRelationOptions({ filter: { [relationGroup.value]: conditions } });
}

function removeRelationCondition(index: number): void {
  const conditions = relationConditions.value.filter((_, candidate) => candidate !== index);
  emitRelationOptions({
    filter: conditions.length > 0 ? { [relationGroup.value]: conditions } : undefined,
  });
}

function relationValueSource(condition: RelationFilterCondition): 'literal' | 'item' {
  return condition.valueFrom ? 'item' : 'literal';
}

function updateRelationValueSource(index: number, source: string): void {
  if (source === 'item') {
    updateRelationCondition(index, { value: undefined, valueFrom: itemFieldItems.value[0]?.value });
  } else {
    updateRelationCondition(index, { value: '', valueFrom: undefined });
  }
}

function updateRelationLiteral(index: number, raw: string): void {
  try {
    relationValueErrors.value[index] = '';
    updateRelationCondition(index, { value: JSON.parse(raw) as JsonValue, valueFrom: undefined });
  } catch {
    relationValueErrors.value[index] = '请输入有效 JSON。';
  }
}

function openCreateField(): void {
  createFieldModel.value = {
    key: '',
    kind: createFieldKindItems.value[0]?.value ?? 'text',
    name: '',
  };
  createFieldError.value = null;
  createFieldOpen.value = true;
}

function submitCreateField(): void {
  if (!props.dataset || !createFieldModel.value.key.trim() || !createFieldModel.value.name.trim()) {
    createFieldError.value = '请填写字段名称与 key。';
    return;
  }
  const { key, kind, name } = createFieldModel.value;
  let valueSchema: JsonSchemaObject = { type: 'string' };
  if (kind === 'number') valueSchema = { type: 'number' };
  if (kind === 'boolean') valueSchema = { type: 'boolean' };
  if (kind === 'multi_select') valueSchema = { type: 'array', items: { type: 'string' } };
  const config = createDatasetFieldConfig(selectedTemplate.value?.widget ?? 'input', kind);
  emit('createField', {
    datasetId: props.dataset.id,
    key: key.trim(),
    name: name.trim(),
    kind,
    valueSchema,
    config,
    required: false,
  });
  createFieldOpen.value = false;
}
</script>

<template>
  <div class="h-full space-y-6 p-4">
    <section class="space-y-3">
      <div>
        <h2 class="text-sm font-semibold text-highlighted">
          表单语言
        </h2>
        <p class="mt-1 text-xs leading-5 text-muted">
          默认语言固定排在第一位，其他语言可独立编辑。
        </p>
      </div>
      <UFormField label="当前编辑语言">
        <USelect
          :model-value="activeLocale"
          :items="localeItems"
          value-key="value"
          class="w-full"
          :disabled="disabled"
          @update:model-value="emit('update:activeLocale', String($event))"
        />
      </UFormField>
      <div class="flex gap-2">
        <UInput
          v-model="localeDraft"
          class="min-w-0 flex-1"
          placeholder="en-US"
          :disabled="disabled"
          @keydown.enter.prevent="addLocale"
        />
        <UButton
          label="新增"
          icon="i-solar-add-circle-linear"
          color="neutral"
          variant="outline"
          :disabled="disabled"
          @click="addLocale"
        />
      </div>
      <p
        v-if="localeError"
        class="text-xs text-error"
      >
        {{ localeError }}
      </p>
    </section>

    <section class="space-y-3 border-t border-default pt-5">
      <h2 class="text-sm font-semibold text-highlighted">
        表单设置
      </h2>
      <UFormField label="默认语言">
        <USelect
          :model-value="defaultLocale"
          :items="localeItems"
          value-key="value"
          class="w-full"
          :disabled="disabled"
          @update:model-value="emit('update:defaultLocale', String($event))"
        />
      </UFormField>
      <UFormField :label="`表单名称 · ${activeLocale}`">
        <UInput
          :model-value="formTitle"
          class="w-full"
          :disabled="disabled"
          @update:model-value="emit('update:formTitle', String($event))"
        />
      </UFormField>
      <UFormField :label="`表单说明 · ${activeLocale}`">
        <UTextarea
          :model-value="description"
          class="w-full"
          :disabled="disabled"
          @update:model-value="emit('update:description', String($event))"
        />
      </UFormField>
      <UFormField :label="`完成/关闭文案 · ${activeLocale}`">
        <UTextarea
          :model-value="closingMessage"
          class="w-full"
          :disabled="disabled"
          @update:model-value="emit('update:closingMessage', String($event))"
        />
      </UFormField>
      <UFormField label="开放时间">
        <UInput
          type="datetime-local"
          :model-value="opensAt?.slice(0, 16) ?? ''"
          class="w-full"
          :disabled="disabled"
          @update:model-value="emit('update:opensAt', $event ? String($event) : undefined)"
        />
      </UFormField>
      <UFormField label="关闭时间">
        <UInput
          type="datetime-local"
          :model-value="closesAt?.slice(0, 16) ?? ''"
          class="w-full"
          :disabled="disabled"
          @update:model-value="emit('update:closesAt', $event ? String($event) : undefined)"
        />
      </UFormField>
      <UFormField label="提交权限">
        <USelect
          :model-value="submissionAccess"
          :items="accessItems"
          value-key="value"
          class="w-full"
          :disabled="disabled"
          @update:model-value="emit('update:submissionAccess', $event as FormSubmissionAccess)"
        />
      </UFormField>
      <UFormField label="写入方式">
        <USelect
          :model-value="writeMode"
          :items="writeModeItems"
          value-key="value"
          class="w-full"
          :disabled="disabled"
          @update:model-value="emit('update:writeMode', $event as FormWriteMode)"
        />
      </UFormField>
      <UAlert
        v-if="subjectWriteModeInvalid"
        title="写入方式不兼容"
        description="更新当前用户数据行要求 Dataset 为 single_per_user，且表单必须登录。"
        color="warning"
        variant="subtle"
      />
      <div class="space-y-2 rounded-xl border border-default p-3">
        <h3 class="text-xs font-medium text-highlighted">
          设备信息采集
        </h3>
        <div
          v-for="entry in captureItems"
          :key="entry[0]"
          class="flex items-center justify-between gap-3"
        >
          <span class="text-xs text-muted">{{ entry[1] }}</span>
          <USwitch
            :model-value="Boolean(capture[entry[0]])"
            :disabled="disabled"
            @update:model-value="emit('update:capture', entry[0], Boolean($event))"
          />
        </div>
      </div>
    </section>

    <section class="space-y-3 border-t border-default pt-5">
      <div>
        <h2 class="text-sm font-semibold text-highlighted">
          表单项设置
        </h2>
        <p
          v-if="!selectedProperty"
          class="mt-1 text-xs leading-5 text-muted"
        >
          在画布中选择一个表单项后可编辑设置。
        </p>
      </div>

      <template v-if="selectedProperty && selectedTemplate">
        <UFormField :label="`标题 · ${activeLocale}`">
          <UInput
            :model-value="fieldTitle"
            class="w-full"
            :disabled="disabled"
            @update:model-value="emit('update:fieldTitle', String($event))"
          />
        </UFormField>
        <UFormField :label="`描述 · ${activeLocale}`">
          <UTextarea
            :model-value="fieldDescription"
            class="w-full"
            :disabled="disabled"
            @update:model-value="emit('update:fieldDescription', String($event))"
          />
        </UFormField>
        <UFormField
          v-if="selectedTemplate.settings.placeholder"
          :label="`占位文案 · ${activeLocale}`"
        >
          <UInput
            :model-value="fieldPlaceholder"
            class="w-full"
            :disabled="disabled"
            @update:model-value="emit('update:fieldPlaceholder', String($event))"
          />
        </UFormField>
        <UFormField label="数据集字段">
          <USelect
            :model-value="selectedDatasetField?.id"
            :items="datasetFieldItems"
            value-key="value"
            class="w-full"
            placeholder="选择兼容字段"
            :disabled="disabled"
            @update:model-value="emit('update:datasetFieldId', String($event))"
          />
        </UFormField>
        <UButton
          label="创建数据集字段"
          icon="i-solar-add-square-bold-duotone"
          color="neutral"
          variant="outline"
          block
          :disabled="disabled || !dataset"
          @click="openCreateField"
        />
        <div class="flex items-center justify-between rounded-lg border border-default px-3 py-2">
          <span class="text-sm text-highlighted">必填</span>
          <USwitch
            :model-value="required"
            :disabled="disabled"
            @update:model-value="emit('update:required', Boolean($event))"
          />
        </div>

        <div
          v-if="selectedTemplate.settings.default"
          class="space-y-1"
        >
          <UFormField label="默认值（JSON）">
            <UInput
              :model-value="defaultSource()"
              class="w-full font-mono text-xs"
              placeholder="留空表示无默认值"
              :disabled="disabled"
              @change="updateDefault(($event.target as HTMLInputElement).value)"
            />
          </UFormField>
          <p
            v-if="defaultError"
            class="text-xs text-error"
          >
            {{ defaultError }}
          </p>
        </div>

        <div
          v-if="selectedTemplate.settings.string && selectedProperty.type === 'string'"
          class="grid grid-cols-2 gap-2"
        >
          <UFormField label="最短长度">
            <UInput
              type="number"
              :model-value="numericConstraint('minLength')"
              min="0"
              :disabled="disabled"
              @update:model-value="emitNumberConstraint('minLength', $event)"
            />
          </UFormField>
          <UFormField label="最长长度">
            <UInput
              type="number"
              :model-value="numericConstraint('maxLength')"
              min="0"
              :disabled="disabled"
              @update:model-value="emitNumberConstraint('maxLength', $event)"
            />
          </UFormField>
          <UFormField
            label="正则表达式"
            class="col-span-2"
          >
            <UInput
              :model-value="stringConstraint('pattern')"
              class="w-full font-mono text-xs"
              placeholder="^[A-Z]+$"
              :disabled="disabled"
              @update:model-value="emitStringConstraint('pattern', $event)"
            />
          </UFormField>
          <UFormField
            label="format"
            class="col-span-2"
          >
            <USelect
              :model-value="stringConstraint('format')"
              :items="['email', 'uri', 'date', 'time', 'date-time']"
              class="w-full"
              clearable
              :disabled="disabled"
              @update:model-value="emitStringConstraint('format', $event)"
            />
          </UFormField>
        </div>

        <div
          v-if="selectedTemplate.settings.numeric && selectedProperty.type === 'number'"
          class="grid grid-cols-2 gap-2"
        >
          <UFormField label="最小值">
            <UInput
              type="number"
              :model-value="numericConstraint('minimum')"
              :disabled="disabled"
              @update:model-value="emitNumberConstraint('minimum', $event)"
            />
          </UFormField>
          <UFormField label="最大值">
            <UInput
              type="number"
              :model-value="numericConstraint('maximum')"
              :disabled="disabled"
              @update:model-value="emitNumberConstraint('maximum', $event)"
            />
          </UFormField>
          <UFormField
            label="步长"
            class="col-span-2"
          >
            <UInput
              type="number"
              :model-value="numericConstraint('multipleOf')"
              min="0"
              :disabled="disabled"
              @update:model-value="emitNumberConstraint('multipleOf', $event)"
            />
          </UFormField>
        </div>

        <div
          v-if="selectedTemplate.settings.array && selectedProperty.type === 'array'"
          class="grid grid-cols-2 gap-2"
        >
          <UFormField label="最少项">
            <UInput
              type="number"
              :model-value="numericConstraint('minItems')"
              min="0"
              :disabled="disabled"
              @update:model-value="emitNumberConstraint('minItems', $event)"
            />
          </UFormField>
          <UFormField label="最多项">
            <UInput
              type="number"
              :model-value="numericConstraint('maxItems')"
              min="0"
              :disabled="disabled"
              @update:model-value="emitNumberConstraint('maxItems', $event)"
            />
          </UFormField>
          <div
            class="
              col-span-2 flex items-center justify-between rounded-lg
              border border-default px-3 py-2
            "
          >
            <span class="text-xs text-muted">值不可重复</span><USwitch
              :model-value="Boolean(selectedProperty.uniqueItems)"
              :disabled="disabled"
              @update:model-value="
                emit('update:constraint', 'uniqueItems', $event ? true : undefined)
              "
            />
          </div>
        </div>

        <PanelFormChoiceOptionsEditor
          v-if="
            selectedTemplate.settings.choices
              && selectedDatasetField
              && selectedDatasetField.kind !== 'relation'
          "
          :options="choiceOptions"
          :locale="activeLocale"
          :schema="schema"
          :cascader="selectedTemplate.widget === 'cascader'"
          :dirty="choiceDirty"
          :saving="choiceSaving"
          :disabled="disabled"
          @update="emit('update:choiceOptions', $event)"
          @save="emit('saveChoices')"
        />
        <UAlert
          v-if="choiceError"
          :description="choiceError"
          color="error"
          variant="subtle"
        />

        <div
          v-if="selectedDatasetField?.kind === 'relation'"
          class="space-y-3 rounded-xl border border-default p-3"
        >
          <div>
            <h3 class="text-xs font-medium text-highlighted">
              关联提交约束
            </h3><p class="mt-1 text-xs text-muted">
              目标：{{ relationDataset?.name ?? selectedDatasetField.relationTargetDatasetId }}；
              基数：{{ selectedDatasetField.relationCardinality }}
            </p>
          </div>
          <UFormField label="展示字段">
            <USelect
              :model-value="relationOptions?.labelFieldId"
              :items="relationFieldItems"
              value-key="value"
              class="w-full"
              :disabled="disabled"
              @update:model-value="emitRelationOptions({ labelFieldId: String($event) })"
            />
          </UFormField>
          <UFormField label="筛选组合">
            <USelect
              :model-value="relationGroup"
              :items="relationGroupItems"
              value-key="value"
              class="w-full"
              :disabled="disabled"
              @update:model-value="updateRelationGroup($event as 'all' | 'any')"
            />
          </UFormField>
          <div
            v-for="(condition, index) in relationConditions"
            :key="index"
            class="space-y-2 rounded-lg bg-elevated/60 p-2"
          >
            <div class="flex gap-2">
              <USelect
                :model-value="condition.fieldId"
                :items="relationFieldItems"
                value-key="value"
                class="min-w-0 flex-1"
                :disabled="disabled"
                @update:model-value="updateRelationCondition(index, { fieldId: String($event) })"
              /><UButton
                icon="i-solar-trash-bin-trash-linear"
                color="error"
                variant="ghost"
                square
                :disabled="disabled"
                @click="removeRelationCondition(index)"
              />
            </div>
            <USelect
              :model-value="condition.operator"
              :items="relationFilterOperatorItems"
              value-key="value"
              class="w-full"
              :disabled="disabled"
              @update:model-value="updateRelationOperator(index, $event)"
            />
            <template
              v-if="condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty'"
            >
              <USelect
                :model-value="relationValueSource(condition)"
                :items="relationValueSourceItems"
                value-key="value"
                class="w-full"
                :disabled="disabled"
                @update:model-value="updateRelationValueSource(index, String($event))"
              />
              <USelect
                v-if="condition.valueFrom"
                :model-value="condition.valueFrom"
                :items="itemFieldItems"
                value-key="value"
                class="w-full"
                :disabled="disabled"
                @update:model-value="updateRelationValueFrom(index, $event)"
              />
              <UInput
                v-else
                :model-value="JSON.stringify(condition.value)"
                class="w-full font-mono text-xs"
                :disabled="disabled"
                @change="updateRelationLiteral(index, ($event.target as HTMLInputElement).value)"
              />
              <p
                v-if="relationValueErrors[index]"
                class="text-xs text-error"
              >
                {{ relationValueErrors[index] }}
              </p>
            </template>
          </div>
          <UButton
            label="添加筛选条件"
            icon="i-solar-add-circle-linear"
            color="neutral"
            variant="outline"
            block
            :disabled="disabled || relationFieldItems.length === 0"
            @click="addRelationCondition"
          />
        </div>

        <div
          v-if="selectedTemplate.settings.availableIf"
          class="space-y-2 rounded-xl border border-default p-3"
        >
          <div>
            <h3 class="text-xs font-medium text-highlighted">
              条件显示
            </h3><p class="mt-1 text-xs text-muted">
              隐藏时清空值，并自动免除 required 与 default。
            </p>
          </div>
          <PanelFormConditionEditor
            :expression="availableIf"
            :field-items="itemFieldItems"
            :disabled="disabled"
            @update="emit('update:availableIf', $event)"
            @remove="emit('update:availableIf', undefined)"
          />
        </div>
      </template>
    </section>

    <UModal
      v-model:open="createFieldOpen"
      title="创建数据集字段"
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="submitCreateField"
        >
          <UFormField
            label="字段名称"
            required
          >
            <UInput
              v-model="createFieldModel.name"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="字段 key"
            required
          >
            <UInput
              v-model="createFieldModel.key"
              class="w-full"
              placeholder="employee_name"
            />
          </UFormField>
          <UFormField label="字段类型">
            <USelect
              v-model="createFieldModel.kind"
              :items="createFieldKindItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UAlert
            v-if="createFieldError"
            :description="createFieldError"
            color="error"
            variant="subtle"
          />
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              color="neutral"
              variant="ghost"
              @click="createFieldOpen = false"
            /><UButton
              label="创建并绑定"
              type="submit"
            />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
