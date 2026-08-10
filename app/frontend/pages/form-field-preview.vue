<script setup lang="ts">
import { computed, ref } from '#imports';
import type {
  DatasetChoiceOption,
  DatasetFieldDefinition,
  FormWidget,
  JsonObject,
  JsonSchema,
  JsonSchemaObject,
  JsonValue,
} from '@weave/types';
import type { FormRenderMode } from '~/components/form/types';
import { appendFormItem } from '~/utils/form-editor-schema';
import { getFormItemTemplate } from '~/utils/form-templates/registry';

/** 固定 UUID，保证 mock schema 可重复。 */
const ids = {
  name: 'q_11111111-1111-4111-8111-111111111111',
  email: 'q_22222222-2222-4222-8222-222222222222',
  dept: 'q_33333333-3333-4333-8333-333333333333',
  skills: 'q_44444444-4444-4444-8444-444444444444',
  bio: 'q_55555555-5555-4555-8555-555555555555',
  notifyDetail: 'q_66666666-6666-4666-8666-666666666666',
  tags: 'q_77777777-7777-4777-8777-777777777777',
  region: 'q_88888888-8888-4888-8888-888888888888',
} as const;

const mockSchema: JsonSchema = {
  title: 'Form 渲染层',
  description: '由 mock JSON Schema 驱动的 FormRenderer 预览。切换下方模式观察编辑态与填写态。',
  type: 'object',
  additionalProperties: false,
  'x-form': {
    capture: {},
    datasetId: 'mock-dataset',
    version: 1,
  },
  properties: {
    [ids.name]: {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      default: '林晚晴',
      'x-form': {
        datasetFieldId: 'fld_name',
        i18n: {
          title: { 'zh-CN': '姓名' },
          description: { 'zh-CN': '填写成员在本工作区使用的姓名。' },
          placeholder: { 'zh-CN': '输入姓名' },
        },
        ui: { widget: 'input' },
      },
    },
    [ids.email]: {
      type: 'string',
      format: 'email',
      default: 'wanqing.lin@example.com',
      'x-form': {
        datasetFieldId: 'fld_email',
        i18n: {
          title: { 'zh-CN': '邮箱' },
          placeholder: { 'zh-CN': 'name@example.com' },
        },
        ui: { widget: 'input' },
      },
    },
    [ids.dept]: {
      type: 'string',
      default: 'engineering',
      oneOf: [
        { const: 'engineering', 'x-form': { i18n: { title: { 'zh-CN': '产品研发部' } } } },
        { const: 'design', 'x-form': { i18n: { title: { 'zh-CN': '设计与体验部' } } } },
        { const: 'marketing', 'x-form': { i18n: { title: { 'zh-CN': '市场运营部' } } } },
        { const: 'hr', 'x-form': { i18n: { title: { 'zh-CN': '人力资源部' } } } },
      ],
      'x-form': {
        datasetFieldId: 'fld_dept',
        i18n: {
          title: { 'zh-CN': '所属部门' },
          description: { 'zh-CN': '单选：Radio 选项组。' },
        },
        ui: { widget: 'radio' },
      },
    },
    [ids.skills]: {
      type: 'array',
      items: { type: 'string' },
      default: ['vue', 'typescript'],
      oneOf: [
        { const: 'vue', 'x-form': { i18n: { title: { 'zh-CN': 'Vue' } } } },
        { const: 'typescript', 'x-form': { i18n: { title: { 'zh-CN': 'TypeScript' } } } },
        { const: 'nestjs', 'x-form': { i18n: { title: { 'zh-CN': 'NestJS' } } } },
        { const: 'design', 'x-form': { i18n: { title: { 'zh-CN': '设计系统' } } } },
      ],
      'x-form': {
        datasetFieldId: 'fld_skills',
        i18n: {
          title: { 'zh-CN': '技能标签' },
          description: { 'zh-CN': '多选：Checkbox 选项组。' },
        },
        ui: { widget: 'checkbox' },
      },
    },
    [ids.bio]: {
      type: 'string',
      maxLength: 500,
      default: '负责表单与数据集模块的前端研发。',
      'x-form': {
        datasetFieldId: 'fld_bio',
        i18n: {
          title: { 'zh-CN': '个人简介' },
          placeholder: { 'zh-CN': '简单介绍一下自己' },
        },
        ui: { widget: 'textarea' },
      },
    },
    [ids.notifyDetail]: {
      type: 'string',
      oneOf: [
        { const: 'email', 'x-form': { i18n: { title: { 'zh-CN': '邮件' } } } },
        { const: 'sms', 'x-form': { i18n: { title: { 'zh-CN': '短信' } } } },
        { const: 'none', 'x-form': { i18n: { title: { 'zh-CN': '不接收' } } } },
      ],
      'x-form': {
        datasetFieldId: 'fld_notify',
        i18n: {
          title: { 'zh-CN': '通知偏好' },
          description: { 'zh-CN': '仅当部门为「产品研发部」时显示（availableIf）。' },
          placeholder: { 'zh-CN': '选择通知方式' },
        },
        ui: { widget: 'selector' },
        availableIf: {
          fieldId: ids.dept,
          operator: 'equals',
          value: 'engineering',
        },
      },
    },
    [ids.tags]: {
      type: 'array',
      items: { type: 'string' },
      default: ['表单引擎'],
      'x-form': {
        datasetFieldId: 'fld_tags',
        i18n: {
          title: { 'zh-CN': '自定义标签' },
          placeholder: { 'zh-CN': '输入后回车添加' },
        },
        ui: { widget: 'tags-input' },
      },
    },
    [ids.region]: {
      type: 'array',
      items: { type: 'string' },
      'x-form': {
        datasetFieldId: 'fld_region',
        i18n: {
          title: { 'zh-CN': '所属地区' },
          placeholder: { 'zh-CN': '请选择所属地区' },
        },
        ui: { widget: 'cascader' },
      },
    },
  },
  required: [ids.name, ids.email, ids.dept],
};

const choiceOptions: Record<string, DatasetChoiceOption[]> = {
  [ids.region]: [
    {
      value: 'china',
      label: '中国',
      children: [
        {
          value: 'zhejiang',
          label: '浙江',
          children: [{ value: 'hangzhou', label: '杭州' }],
        },
      ],
    },
  ],
};

function previewField(
  widget: FormWidget,
  kind: DatasetFieldDefinition['kind'],
  valueSchema: JsonSchema,
  config: JsonObject = {},
): DatasetFieldDefinition {
  return {
    id: `preview-${widget}`,
    datasetId: 'mock-dataset',
    key: `preview_${widget}`,
    name: `新增${getFormItemTemplate(widget).label}`,
    description: null,
    kind,
    valueSchema,
    config,
    required: false,
    isSystemManaged: false,
    systemKey: null,
    relationTargetDatasetId: null,
    relationCardinality: null,
    position: 0,
    revision: 1,
    archivedAt: null,
  };
}

const previewFields: Record<FormWidget, DatasetFieldDefinition> = {
  input: previewField('input', 'text', { type: 'string' }),
  textarea: previewField('textarea', 'long_text', { type: 'string' }),
  checkbox: previewField('checkbox', 'boolean', { type: 'boolean' }),
  radio: previewField('radio', 'single_select', { type: 'string' }, {
    optionMode: 'flat', options: [{ value: 'one', label: '选项一' }],
  }),
  selector: previewField('selector', 'multi_select', {
    type: 'array', items: { type: 'string' },
  }, { optionMode: 'flat', options: [{ value: 'one', label: '选项一' }] }),
  cascader: previewField('cascader', 'multi_select', {
    type: 'array', items: { type: 'string' },
  }, { optionMode: 'cascader', options: [] }),
  'tags-input': previewField('tags-input', 'multi_select', {
    type: 'array', items: { type: 'string' },
  }),
};

const isEditMode = ref(true);
const mode = computed<FormRenderMode>(() => (isEditMode.value ? 'edit' : 'fill'));
const previewSchema = ref<JsonSchemaObject>(mockSchema as JsonSchemaObject);
const state = ref<Record<string, JsonValue | undefined>>({});
const selectedFieldId = ref<string | null>(null);

const modeLabel = computed(() => (mode.value === 'edit' ? '编辑态' : '填写态'));

const stateJson = computed(() => JSON.stringify(state.value, null, 2));

const lastAction = ref<string>('无');

function onFieldAction(action: string, fieldId: string): void {
  lastAction.value = `${action} → ${fieldId}`;
}

function addPreviewItem(widget: string): void {
  const template = getFormItemTemplate(widget as FormWidget);
  const added = appendFormItem(
    previewSchema.value,
    template,
    previewFields[template.widget],
    'zh-CN',
    selectedFieldId.value,
  );
  previewSchema.value = added.schema;
  selectedFieldId.value = added.fieldId;
  lastAction.value = `add:${widget} → ${added.fieldId}`;
}
</script>

<template>
  <main class="min-h-dvh bg-default text-highlighted">
    <div class="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header class="mb-10">
        <div class="flex flex-wrap items-center gap-3">
          <UBadge
            label="组件预览"
            color="primary"
            variant="subtle"
            size="sm"
          />
          <code class="text-xs font-semibold text-muted">
            FormRenderer.vue
          </code>
        </div>

        <div class="mt-4 flex flex-wrap items-end justify-between gap-4">
          <h1
            class="text-3xl font-bold tracking-[-0.035em] text-highlighted sm:text-4xl"
          >
            Form 渲染层
          </h1>
          <UButton
            label="回到首页"
            icon="i-solar-arrow-left-up-bold-duotone"
            to="/"
            color="neutral"
            variant="outline"
            size="sm"
            class="active:translate-y-px"
          />
        </div>

        <p class="mt-3 max-w-2xl text-base leading-7 text-muted">
          由 mock JSON Schema 驱动：FormRenderer → FormField → componentMap → items。
          支持编辑 / 填写双模式与选中字段回调。
        </p>

        <div
          class="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl
            border border-default bg-elevated p-4"
        >
          <div class="flex items-center gap-3">
            <span
              class="size-2.5 rounded-full transition-colors duration-300"
              :class="mode === 'edit' && selectedFieldId
                ? 'bg-primary'
                : 'bg-neutral-300 dark:bg-neutral-600'"
            />
            <div>
              <p class="text-sm font-semibold text-highlighted">
                {{ modeLabel }}
              </p>
              <p class="mt-0.5 text-xs text-muted">
                选中：{{ selectedFieldId ?? '无' }}
              </p>
              <p class="mt-0.5 text-xs text-muted">
                最近操作：{{ lastAction }}
              </p>
            </div>
          </div>

          <USwitch
            v-model="isEditMode"
            label="编辑模式"
          />
        </div>
      </header>

      <section class="mb-6 rounded-2xl border border-default bg-elevated">
        <PanelFormPalette @add="addPreviewItem" />
      </section>

      <FormRenderer
        v-model="state"
        v-model:selected-field-id="selectedFieldId"
        :schema="previewSchema"
        :choice-options="choiceOptions"
        :mode="mode"
        class="rounded-2xl border border-default bg-elevated p-4 sm:p-6"
        @up="onFieldAction('up', $event)"
        @down="onFieldAction('down', $event)"
        @duplicate="onFieldAction('duplicate', $event)"
        @settings="onFieldAction('settings', $event)"
        @delete="onFieldAction('delete', $event)"
        @update:title="(id, value) => onFieldAction(`title:${value}`, id)"
        @update:description="(id, value) => onFieldAction(`description:${value ?? ''}`, id)"
      />

      <section class="mt-8">
        <h2 class="text-sm font-semibold text-highlighted">
          当前 state
        </h2>
        <pre
          class="mt-3 overflow-x-auto rounded-xl border border-default bg-default
            p-4 text-xs leading-5 text-muted"
        >{{ stateJson }}</pre>
      </section>
    </div>
  </main>
</template>
