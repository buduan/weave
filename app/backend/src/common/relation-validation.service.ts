import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  lockDatasetRowsByMode,
  type DatasetRowLockRequest,
  type LockedDatasetRow,
} from './aggregate-locks';

export interface RelationValidationOptions {
  updateRowIds?: readonly string[];
}

/**
 * 关联目标验证服务。
 *
 * 验证 relations Map 中引用的所有目标行都存在于指定 workspace 中，
 * 且属于正确的关联 Dataset。
 */
@Injectable()
export class RelationValidationService {
  /**
   * 批量验证关联目标行存在且属于正确的 Dataset。
   *
   * @param workspaceId  工作区 ID
   * @param fields       字段定义列表（含 relationTargetDatasetId）
   * @param relations    字段 ID → 目标行 ID 列表的映射
   * @throws BadRequestException 当任何目标行不存在或不属于预期 Dataset 时
   */
  public async validate(
    tx: Prisma.TransactionClient,
    workspaceId: number,
    fields: Array<{ id: string; relationTargetDatasetId: string | null }>,
    relations: Map<string, string[]>,
    options: RelationValidationOptions = {},
  ): Promise<LockedDatasetRow[]> {
    const ids = [...new Set([...relations.values()].flat())].sort();
    const lockRequests: DatasetRowLockRequest[] = [
      ...ids.map((id) => ({ id, mode: 'share' as const })),
      ...(options.updateRowIds ?? []).map((id) => ({ id, mode: 'update' as const })),
    ];
    const lockedRows = await lockDatasetRowsByMode(tx, lockRequests);
    const rows = lockedRows.filter((row) => ids.includes(row.id));
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const fieldsById = new Map(fields.map((f) => [f.id, f]));
    relations.forEach((targetIds, fieldId) => {
      const expected = fieldsById.get(fieldId)?.relationTargetDatasetId;
      const invalid = targetIds.find((id) => {
        const row = rowsById.get(id);
        return !row
          || row.deletedAt !== null
          || row.workspaceId !== workspaceId
          || row.datasetId !== expected;
      });
      if (invalid) throw new BadRequestException(`Invalid relation target: ${invalid}`);
    });
    return rows;
  }
}
