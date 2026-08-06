import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuthenticationGuard } from './authentication.guard';
import { AuthorizationController } from './authorization.controller';
import { AuthorizationService } from './authorization.service';
import { PermissionsGuard } from './permissions.guard';

@Module({
  imports: [AuditModule, AuthModule, WorkspacesModule],
  controllers: [AuthorizationController],
  providers: [
    AuthorizationService,
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
