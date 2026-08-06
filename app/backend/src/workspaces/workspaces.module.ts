import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [AuditModule, DatasetsModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
