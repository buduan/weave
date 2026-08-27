<script setup lang="ts">
import type {
  CreateDatasetFieldRequest,
  DatasetFieldDefinition,
  DatasetFieldKind,
  JsonObject,
  RelationCardinality,
  UpdateDatasetFieldRequest,
} from '@weave/types';
import { kindsForDataType, valueSchemaForField } from '@weave/utils';
import { computed, reactive, watch } from '#imports';

type CreateInput = Omit<CreateDatasetFieldRequest, 'expectedDatasetRevision'>;
type UpdateInput = Omit<UpdateDatasetFieldRequest, 'expectedDatasetRevision' | 'expectedFieldRevision'>;

const props = withDefaults(defineProps<{
  open: boolean;
  field?: DatasetFieldDefinition | null;
  position?: number;
  pending?: boolean;
  error?: string | null;
}>(), {
  field: null,
  position: undefined,
  pending: false,
  error: null,
});

const emit = defineEmits<{
  'update:open': [open: boolean];
  create: [input: CreateInput];
  update: [input: UpdateInput];
}>();

const allFieldKinds: Array<{ label: string; value: DatasetFieldKind }> = [
  { label: '单行文本', value: 'text' },
  { label: '长文本', value: 'long_text' },
  { label: '数字', value: 'number' },
  { label: '百分数', value: 'percent' },
  { label: '货币', value: 'currency' },
  { label: '复选框', value: 'checkbox' },
  { label: '日期', value: 'date' },
  { label: '时间', value: 'time' },
  { label: '日期时间', value: 'datetime' },
  { label: '邮箱', value: 'email' },
  { label: '网址', value: 'url' },
  { label: '单选', value: 'single_select' },
  { label: '多选', value: 'multi_select' },
  { label: '级联', value: 'cascader' },
  { label: '标签', value: 'tags' },
  { label: 'JSON', value: 'json' },
  { label: '关联', value: 'relation' },
];

const form = reactive({
  key: '',
  name: '',
  description: '',
  kind: 'text' as DatasetFieldKind,
  required: false,
  optionsText: '',
  relationTargetDatasetId: '',
  relationCardinality: 'one' as RelationCardinality,
});
const validationError = reactive({ key: '', name: '', relation: '' });
const editing = computed(() => props.field !== null);
const protectedField = computed(() => props.field?.isSystemManaged === true);
const isSelect = computed(() => (
  form.kind === 'single_select' || form.kind === 'multi_select' || form.kind === 'cascader'
));
const fieldKinds = computed(() => {
  if (!props.field) return allFieldKinds;
  const allowed = new Set(kindsForDataType(props.field.dataType));
  return allFieldKinds.filter((item) => allowed.has(item.value));
});

watch(() => [props.open, props.field] as const, ([open, field]) => {
  if (!open) return;
  form.key = field?.key ?? '';
  form.name = field?.name ?? '';
  form.description = field?.description ?? '';
  form.kind = field?.kind ?? 'text';
  form.required = field?.required ?? false;
  const options = field?.config.options;
  form.optionsText = Array.isArray(options)
    ? options.flatMap((option) => {
      if (typeof option === 'string') return [option];
      if (typeof option === 'object' && option !== null && !Array.isArray(option)
          && typeof option.value === 'string') return [option.value];
      return [];
    }).join('\n')
    : '';
  form.relationTargetDatasetId = field?.relationTargetDatasetId ?? '';
  form.relationCardinality = field?.relationCardinality ?? 'one';
  validationError.key = '';
  validationError.name = '';
  validationError.relation = '';
});

function config(): JsonObject {
  if (form.kind === 'tags') return {};
  if (!isSelect.value) return {};
  return {
    ...(form.kind === 'cascader' ? { optionMode: 'cascader' } : {}),
    options: form.optionsText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({ label: item, value: item })),
  };
}

function submit(): void {
  validationError.key = /^[a-z][a-z0-9_]*$/.test(form.key)
    ? ''
    : '使用小写字母、数字和下划线，并以字母开头';
  validationError.name = form.name.trim() ? '' : '请输入字段名称';
  validationError.relation = form.kind === 'relation' && !form.relationTargetDatasetId.trim()
    ? '请输入目标数据表 ID'
    : '';
  if (validationError.key || validationError.name || validationError.relation) return;

  if (props.field) {
    emit('update', {
      name: form.name.trim(),
      description: form.description.trim() || null,
      ...(!protectedField.value ? {
        kind: form.kind,
        valueSchema: valueSchemaForField(form.kind),
        config: config(),
        required: form.required,
      } : {}),
      ...(props.position === undefined ? {} : { position: props.position }),
    });
    return;
  }
  emit('create', {
    key: form.key,
    name: form.name.trim(),
    description: form.description.trim() || null,
    kind: form.kind,
    valueSchema: valueSchemaForField(form.kind),
    config: config(),
    required: form.required,
    ...(form.kind === 'relation' ? {
      relationTargetDatasetId: form.relationTargetDatasetId.trim(),
      relationCardinality: form.relationCardinality,
    } : {}),
    ...(props.position === undefined ? {} : { position: props.position }),
  });
}
</script>

<template>
  <UModal
    :open="open"
    :title="editing ? '编辑字段' : '新增字段'"
    :description="protectedField
      ? '系统字段仅可修改名称与描述。'
      : (editing ? '存储类型不可更改；同类型外显可转换。' : '存储类型创建后不可更改。')"
    :dismissible="!pending"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <form
        id="dataset-field-form"
        class="space-y-4"
        @submit.prevent="submit"
      >
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="字段名称"
            required
            :error="validationError.name"
          >
            <UInput
              v-model="form.name"
              class="w-full"
              autofocus
            />
          </UFormField>
          <UFormField
            label="字段标识"
            required
            :error="validationError.key"
          >
            <UInput
              v-model="form.key"
              class="w-full font-mono"
              :disabled="editing"
            />
          </UFormField>
        </div>
        <UFormField label="字段类型">
          <USelect
            v-model="form.kind"
            :items="fieldKinds"
            value-key="value"
            class="w-full"
            :disabled="protectedField"
          />
        </UFormField>
        <UFormField
          v-if="isSelect"
          label="选项"
          hint="每行一个选项"
        >
          <UTextarea
            v-model="form.optionsText"
            class="w-full font-mono"
            :rows="4"
            :disabled="protectedField"
          />
        </UFormField>
        <template v-if="form.kind === 'relation'">
          <UFormField
            label="目标数据表 ID"
            required
            :error="validationError.relation"
          >
            <UInput
              v-model="form.relationTargetDatasetId"
              class="w-full font-mono"
              :disabled="editing"
            />
          </UFormField>
          <UFormField label="关联基数">
            <USelect
              v-model="form.relationCardinality"
              :items="[{ label: '单条', value: 'one' }, { label: '多条', value: 'many' }]"
              value-key="value"
              class="w-full"
              :disabled="editing"
            />
          </UFormField>
        </template>
        <UFormField label="描述">
          <UTextarea
            v-model="form.description"
            class="w-full"
            :rows="2"
          />
        </UFormField>
        <UCheckbox
          v-model="form.required"
          label="必填字段"
          :disabled="protectedField"
        />
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          title="字段保存失败"
          :description="error"
        />
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          :disabled="pending"
          @click="emit('update:open', false)"
        />
        <UButton
          form="dataset-field-form"
          type="submit"
          :label="editing ? '保存字段' : '新增字段'"
          :loading="pending"
        />
      </div>
    </template>
  </UModal>
</template>
