import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { CommonModule } from '../common/common.module';
import { DatasetRowsService } from './dataset-rows.service';
import { DatasetSchemaService } from './dataset-schema.service';
import { DatasetsController } from './datasets.controller';
import { DatasetsService } from './datasets.service';
import { MembersSyncService } from './members-sync.service';

/**
 * Dataset 核心领域与 Form 编辑器所需的 HTTP 模块。
 * 所有 Service 均导出，供 Forms 和 SpecialDatasets 模块直接注入调用，
 * 避免产生循环依赖。
 */
@Module({
  imports: [AuditModule, CommonModule],
  controllers: [DatasetsController],
  providers: [DatasetsService, DatasetRowsService, DatasetSchemaService, MembersSyncService],
  exports: [DatasetsService, DatasetRowsService, DatasetSchemaService, MembersSyncService],
})
export class DatasetsModule {}
