import { Prisma } from '@prisma/client';

export type ParentLockMode = 'share' | 'update';

export interface LockedDatasetRow {
  datasetId: string;
  deletedAt: Date | null;
  id: string;
  values: Prisma.JsonValue;
  workspaceId: number;
}

export interface DatasetRowLockRequest {
  id: string;
  mode: ParentLockMode;
}

/** Lock a Dataset parent before reading or writing its mutable child definition/rows. */
export async function lockDatasetParent(
  tx: Prisma.TransactionClient,
  datasetId: string,
  mode: ParentLockMode,
): Promise<void> {
  if (mode === 'update') {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Dataset" WHERE "id" = ${datasetId} FOR UPDATE
    `);
    return;
  }
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Dataset" WHERE "id" = ${datasetId} FOR SHARE
  `);
}

/** Lock a Form parent only after its bound Dataset parent has been locked. */
export async function lockFormParent(
  tx: Prisma.TransactionClient,
  formId: string,
  mode: ParentLockMode,
): Promise<void> {
  if (mode === 'update') {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Form" WHERE "id" = ${formId} FOR UPDATE
    `);
    return;
  }
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Form" WHERE "id" = ${formId} FOR SHARE
  `);
}

/** Lock Dataset rows in stable ID order and return facts read after the lock. */
export async function lockDatasetRows(
  tx: Prisma.TransactionClient,
  rowIds: readonly string[],
  mode: ParentLockMode,
): Promise<LockedDatasetRow[]> {
  const ids = [...new Set(rowIds)].sort();
  if (ids.length === 0) return [];
  if (mode === 'update') {
    return tx.$queryRaw<LockedDatasetRow[]>(Prisma.sql`
      SELECT "id", "workspaceId", "datasetId", "deletedAt", "values"
      FROM "DatasetRow"
      WHERE "id" IN (${Prisma.join(ids)})
      ORDER BY "id"
      FOR UPDATE
    `);
  }
  return tx.$queryRaw<LockedDatasetRow[]>(Prisma.sql`
    SELECT "id", "workspaceId", "datasetId", "deletedAt", "values"
    FROM "DatasetRow"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR SHARE
  `);
}

/** Lock mixed share/update rows one-by-one in stable ID order to preserve global row ordering. */
export async function lockDatasetRowsByMode(
  tx: Prisma.TransactionClient,
  requests: readonly DatasetRowLockRequest[],
): Promise<LockedDatasetRow[]> {
  const strongestById = new Map<string, ParentLockMode>();
  requests.forEach(({ id, mode }) => {
    if (mode === 'update' || !strongestById.has(id)) strongestById.set(id, mode);
  });
  const locks = [...strongestById.entries()].sort(([left], [right]) => left.localeCompare(right));
  const rows: LockedDatasetRow[] = [];
  for (const [rowId, mode] of locks) {
    const locked = mode === 'update'
      ? await tx.$queryRaw<LockedDatasetRow[]>(Prisma.sql`
        SELECT "id", "workspaceId", "datasetId", "deletedAt", "values"
        FROM "DatasetRow" WHERE "id" = ${rowId} FOR UPDATE
      `)
      : await tx.$queryRaw<LockedDatasetRow[]>(Prisma.sql`
        SELECT "id", "workspaceId", "datasetId", "deletedAt", "values"
        FROM "DatasetRow" WHERE "id" = ${rowId} FOR SHARE
      `);
    rows.push(...locked);
  }
  return rows;
}
