import { resolve } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { SpecialDatasetsModule } from './special-datasets/special-datasets.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { DatasetsModule } from './datasets/datasets.module';
import { FormsModule } from './forms/forms.module';
import { FormSubmissionsModule } from './form-submissions/form-submissions.module';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      expandVariables: true,
      isGlobal: true,
      // Commands run from app/backend, while containers keep a conventional /app/.env.
      envFilePath: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
    }),
    PrismaModule,
    RedisModule,
    NotificationsModule,
    AuditModule,
    UsersModule,
    WorkspacesModule,
    AuthModule,
    AuthorizationModule,
    MailModule,
    DatasetsModule,
    SpecialDatasetsModule,
    FormsModule,
    FormSubmissionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
