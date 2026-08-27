import {
  DatasetCollaboratorRole,
  DatasetFieldDataType,
  DatasetFieldKind,
  DatasetSubjectMode,
  DatasetType,
  FormSubmissionAccess,
  FormVersionState,
  FormWriteMode,
  Prisma,
} from '@prisma/client';

import type { JsonValue } from '@weave/types';
import { checksumJson, createFormItemId } from '@weave/utils';

import { createDatasetDefinitionVersion } from '../datasets/dataset-definition-version';

export interface WorkspaceMemberSampleDataInput {
  userId: string;
  workspaceId: number;
  workspaceMemberId: string;
}

export interface WorkspaceMemberSampleDataResult {
  created: boolean;
  datasetId: string;
  formId: string;
}

function buildSampleFormSchema(datasetId: string, fieldId: string): JsonValue {
  const formItemId = createFormItemId();
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      [formItemId]: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        'x-form': {
          datasetFieldId: fieldId,
          i18n: {
            title: { 'zh-CN': '姓名' },
            placeholder: { 'zh-CN': '请输入姓名' },
          },
          ui: { widget: 'text' },
        },
      },
    },
    required: [formItemId],
    'x-form': {
      version: 1,
      datasetId,
      capture: {},
    },
  };
}

/**
 * 为首次激活的 Workspace 成员创建一组独立的示例 Dataset/Form。
 * 该方法只使用调用方提供的事务 client，不启动根事务或改变成员状态。
 */
export async function ensureWorkspaceMemberSampleData(
  tx: Prisma.TransactionClient,
  input: WorkspaceMemberSampleDataInput,
): Promise<WorkspaceMemberSampleDataResult> {
  const datasetSlug = `example-dataset-${input.workspaceMemberId}`;
  const formSlug = `example-form-${input.workspaceMemberId}`;
  const [existingDataset, existingForm] = await Promise.all([
    tx.dataset.findUnique({
      where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: datasetSlug } },
      select: { id: true },
    }),
    tx.form.findUnique({
      where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: formSlug } },
      select: { id: true, datasetId: true },
    }),
  ]);

  if (existingDataset && existingForm) {
    if (existingForm.datasetId !== existingDataset.id) {
      throw new Error('Workspace member sample Dataset/Form pair is inconsistent');
    }
    return { created: false, datasetId: existingDataset.id, formId: existingForm.id };
  }
  if (existingDataset || existingForm) {
    throw new Error('Workspace member sample Dataset/Form pair is incomplete');
  }

  const dataset = await tx.dataset.create({
    data: {
      workspaceId: input.workspaceId,
      name: '示例数据集',
      slug: datasetSlug,
      description: '用于体验数据集和表单功能的示例数据。',
      type: DatasetType.standard,
      subjectMode: DatasetSubjectMode.none,
      createdByUserId: input.userId,
      collaborators: {
        create: {
          workspaceMemberId: input.workspaceMemberId,
          role: DatasetCollaboratorRole.owner,
          assignedByUserId: input.userId,
        },
      },
      fields: {
        create: {
          key: 'name',
          name: '姓名',
          dataType: DatasetFieldDataType.string,
          kind: DatasetFieldKind.text,
          valueSchema: { type: 'string', minLength: 1, maxLength: 128 },
          config: {},
          required: true,
          position: 0,
        },
      },
    },
    include: { fields: true },
  });
  const nameField = dataset.fields[0];
  if (!nameField) throw new Error('Workspace member sample name field was not created');
  await createDatasetDefinitionVersion(tx, dataset.id, input.userId, 'dataset.create');

  const schema = buildSampleFormSchema(dataset.id, nameField.id);
  const form = await tx.form.create({
    data: {
      workspaceId: input.workspaceId,
      datasetId: dataset.id,
      slug: formSlug,
      createdByUserId: input.userId,
    },
  });
  const version = await tx.formVersion.create({
    data: {
      formId: form.id,
      version: 1,
      state: FormVersionState.published,
      defaultLocale: 'zh-CN',
      nameI18n: { 'zh-CN': '示例表单' },
      descriptionI18n: { 'zh-CN': '提交后会新增一条示例数据集记录。' },
      submissionAccess: FormSubmissionAccess.anonymous_allowed,
      writeMode: FormWriteMode.create_row,
      schema: schema as Prisma.InputJsonObject,
      schemaChecksum: await checksumJson(schema),
      publishedByUserId: input.userId,
      publishedAt: new Date(),
      createdByUserId: input.userId,
    },
  });
  await tx.form.update({ where: { id: form.id }, data: { activeVersionId: version.id } });

  return { created: true, datasetId: dataset.id, formId: form.id };
}
