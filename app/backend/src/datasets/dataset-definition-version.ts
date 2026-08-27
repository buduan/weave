import { Prisma } from '@prisma/client';

/**
 * 在已有事务中创建不可变 DatasetVersion 快照。
 * 调用方负责开启事务并提供操作者身份。
 */
export async function createDatasetDefinitionVersion(
  tx: Prisma.TransactionClient,
  datasetId: string,
  actorUserId: string,
  reason: string,
): Promise<void> {
  const dataset = await tx.dataset.findUniqueOrThrow({
    where: { id: datasetId },
    include: { fields: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
  });
  const metadataSnapshot: Prisma.InputJsonObject = {
    name: dataset.name,
    slug: dataset.slug,
    description: dataset.description,
    type: dataset.type,
    status: dataset.status,
    subjectMode: dataset.subjectMode,
    revision: dataset.revision,
  };
  const fieldsSnapshot = dataset.fields.map((field) => ({
    id: field.id,
    key: field.key,
    name: field.name,
    description: field.description,
    dataType: field.dataType,
    kind: field.kind,
    valueSchema: field.valueSchema,
    config: field.config,
    required: field.required,
    isSystemManaged: field.isSystemManaged,
    systemKey: field.systemKey,
    relationTargetDatasetId: field.relationTargetDatasetId,
    relationCardinality: field.relationCardinality,
    position: field.position,
    revision: field.revision,
    archivedAt: field.archivedAt?.toISOString() ?? null,
  })) as Prisma.InputJsonArray;
  await tx.datasetVersion.create({
    data: {
      datasetId,
      version: dataset.revision,
      metadataSnapshot,
      fieldsSnapshot,
      reason,
      createdByUserId: actorUserId,
    },
  });
}
