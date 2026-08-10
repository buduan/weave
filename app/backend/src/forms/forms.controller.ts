import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@weave/types';

import { CurrentActor } from '../authorization/authorization.decorators';
import {
  ChangeFormStatusDto,
  CreateFormDto,
  FormEditLockDto,
  FormEditLockTokenDto,
  ListFormsQueryDto,
  PublishFormDto,
  SaveFormDraftDto,
} from './forms.dto';
import { FormsService } from './forms.service';

@Controller('workspaces/:workspaceId/forms')
@ApiTags('Forms')
@ApiBearerAuth()
export class FormsController {
  public constructor(private readonly forms: FormsService) {}

  @Get('listForms')
  public listForms(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Query() query: ListFormsQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.forms.list(workspaceId, actor, query.status);
  }

  @Get('getForm/:formId')
  public getForm(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('formId') formId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.forms.get(workspaceId, formId, actor);
  }

  @Post('createForm')
  public createForm(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() dto: CreateFormDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.forms.create(workspaceId, dto, actor);
  }

  @Post('saveFormDraft')
  public saveFormDraft(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() dto: SaveFormDraftDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    const { formId, lockToken, ...definition } = dto;
    return this.forms.updateDraft(workspaceId, formId, definition, actor, lockToken);
  }

  @Post('publishForm')
  public publishForm(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() dto: PublishFormDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.forms.publish(
      workspaceId,
      dto.formId,
      dto.expectedRevision,
      actor,
      dto.lockToken,
    );
  }

  @Post('archiveForm')
  public archiveForm(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() dto: ChangeFormStatusDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.forms.archive(workspaceId, dto.formId, dto.expectedRevision, actor);
  }

  @Post('closeForm')
  public closeForm(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() dto: ChangeFormStatusDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.forms.close(workspaceId, dto.formId, dto.expectedRevision, actor);
  }

  @Post('reopenForm')
  public reopenForm(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() dto: ChangeFormStatusDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.forms.reopen(workspaceId, dto.formId, dto.expectedRevision, actor);
  }

  @Post('unarchiveForm')
  public unarchiveForm(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() dto: ChangeFormStatusDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.forms.restore(workspaceId, dto.formId, dto.expectedRevision, actor);
  }

  @Post('acquireFormEditLock')
  public acquireFormEditLock(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() dto: FormEditLockDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.forms.acquireEditLock(workspaceId, dto.formId, actor);
  }

  @Post('heartbeatFormEditLock')
  public heartbeatFormEditLock(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() dto: FormEditLockTokenDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.forms.heartbeatEditLock(workspaceId, dto.formId, dto.token, actor);
  }

  @Post('releaseFormEditLock')
  public releaseFormEditLock(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() dto: FormEditLockTokenDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.forms.releaseEditLock(workspaceId, dto.formId, dto.token, actor);
  }
}
