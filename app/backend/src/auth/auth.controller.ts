import {
  Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Ip, Param, Post, Put,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { ApiResponseNoStatusOptions } from '@nestjs/swagger';

import { apiStatuses, type AuthenticatedActor } from '@weave/types';

import { CurrentActor, Public } from '../authorization/authorization.decorators';
import {
  CodeLoginDto,
  EmailDto,
  IdentifierDto,
  PasswordChangeDto,
  PasswordLoginDto,
  PasswordResetDto,
  MfaCodeRequestDto,
  MfaCompleteDto,
  MfaSettingDto,
  MfaPasskeyCompleteDto,
  MfaPasskeyOptionsDto,
  PasskeyAuthenticationVerifyDto,
  PasskeyRegistrationVerifyDto,
  PhoneCodeConfirmDto,
  PhoneCodeRequestDto,
  ReauthenticateDto,
  RegistrationCodeDto,
  RegistrationCompleteDto,
  RegistrationFlowDto,
  RegistrationStartDto,
  TotpCodeDto,
} from './auth.dto';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { MfaService } from './mfa.service';
import { PasskeyService } from './passkey.service';
import { ReauthenticationService } from './reauthentication.service';

function bearer(header?: string): string {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : '';
}

type ResponseSchema = Extract<ApiResponseNoStatusOptions, { schema: unknown }>['schema'];

const authTokensSchema: ResponseSchema = {
  type: 'object',
  required: ['accessToken', 'refreshToken', 'accessTokenExpiresIn'],
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    accessTokenExpiresIn: { type: 'integer', minimum: 1 },
  },
};

const authenticationResultSchema: ResponseSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['outcome', 'tokens'],
      properties: {
        outcome: { type: 'string', enum: ['authenticated'] },
        tokens: authTokensSchema,
      },
    },
    {
      type: 'object',
      required: ['outcome', 'challengeId', 'factors', 'expiresIn'],
      properties: {
        outcome: { type: 'string', enum: ['mfa_required'] },
        challengeId: { type: 'string', format: 'uuid' },
        factors: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', enum: ['email', 'sms', 'totp', 'passkey'] },
        },
        expiresIn: { type: 'integer', minimum: 1 },
      },
    },
  ],
  discriminator: { propertyName: 'outcome' },
};

@Controller('auth')
@ApiTags('Authentication')
export class AuthController {
  public constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly passkeys: PasskeyService,
    private readonly reauthentication: ReauthenticationService,
  ) {}

  @Post('login/options')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Discover whether an identifier enters login or registration' })
  @ApiOkResponse({
    schema: {
      oneOf: [
        {
          type: 'object',
          required: ['next'],
          properties: { next: { type: 'string', enum: ['login'] } },
        },
        {
          type: 'object',
          required: ['next', 'email'],
          properties: {
            next: { type: 'string', enum: ['register'] },
            email: { type: 'string', format: 'email' },
          },
        },
      ],
      discriminator: { propertyName: 'next' },
    },
  })
  @ApiBadRequestResponse({
    description: 'The username or phone does not belong to an account.',
    schema: {
      type: 'object',
      required: ['status', 'data', 'message', 'timestamp'],
      properties: {
        status: { type: 'string', enum: [apiStatuses.accountNotFound] },
        data: { type: 'null' },
        message: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  public loginOptions(@Body() dto: IdentifierDto, @Ip() ip: string) {
    return this.auth.loginOptions(dto.identifier, ip);
  }

  @Post('register/start')
  @Public()
  @ApiOperation({ summary: 'Start a short-lived email registration flow' })
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['registrationId', 'expiresIn'],
      properties: {
        registrationId: { type: 'string', format: 'uuid' },
        expiresIn: { type: 'integer', minimum: 1 },
      },
    },
  })
  public startRegistration(@Body() dto: RegistrationStartDto, @Ip() ip: string) {
    return this.auth.startRegistration(dto.email, ip);
  }

  @Post('register/code/request')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request or resend the registration email code' })
  @ApiAcceptedResponse({ description: 'The request was accepted.' })
  public async requestRegistrationCode(@Body() dto: RegistrationFlowDto, @Ip() ip: string) {
    await this.auth.requestRegistrationCode(dto.registrationId, ip);
    return { accepted: true };
  }

  @Post('register/code/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the registration email code' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['verified'],
      properties: { verified: { type: 'boolean', enum: [true] } },
    },
  })
  public verifyRegistrationCode(@Body() dto: RegistrationCodeDto) {
    return this.auth.verifyRegistrationCode(dto.registrationId, dto.code);
  }

  @Post('register/complete')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create the verified user and return Tokens' })
  @ApiOkResponse({ schema: authenticationResultSchema })
  public completeRegistration(@Body() dto: RegistrationCompleteDto) {
    return this.auth.completeRegistration(dto);
  }

  @Post('login/password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with password, returning Tokens or an MFA challenge' })
  @ApiOkResponse({ schema: authenticationResultSchema })
  public loginWithPassword(@Body() dto: PasswordLoginDto, @Ip() ip: string) {
    return this.auth.loginWithPassword(dto, ip);
  }

  @Post('login/code/request')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request a non-enumerating email login code by identifier' })
  @ApiAcceptedResponse({ description: 'The request was accepted.' })
  public async requestEmailLogin(@Body() dto: IdentifierDto, @Ip() ip: string) {
    await this.auth.requestEmailLogin(dto.identifier, ip);
    return { accepted: true };
  }

  @Post('login/code/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with an email code and return Tokens' })
  @ApiOkResponse({ schema: authenticationResultSchema })
  public loginWithEmail(@Body() dto: CodeLoginDto, @Ip() ip: string) {
    return this.auth.loginWithEmailCode(dto.identifier, dto.code, ip, dto.deviceName);
  }

  @Post('token/refresh')
  @Public()
  public refresh(@Headers('authorization') authorization?: string) {
    return this.sessions.refresh(bearer(authorization));
  }

  @Post('logout')
  @ApiBearerAuth()
  public async logout(@CurrentActor() actor: AuthenticatedActor) {
    await this.sessions.logout(actor.sessionId, actor.userId);
    return { accepted: true };
  }

  @Post('logout-all')
  @ApiBearerAuth()
  public async logoutAll(@CurrentActor() actor: AuthenticatedActor) {
    await this.sessions.logoutAll(actor.userId);
    return { accepted: true };
  }

  @Get('sessions')
  @ApiBearerAuth()
  public sessionsForUser(@CurrentActor() actor: AuthenticatedActor) {
    return this.sessions.list(actor.userId);
  }

  @Post('password/change')
  @ApiBearerAuth()
  public async changePassword(
  @CurrentActor() actor: AuthenticatedActor,
    @Body() dto: PasswordChangeDto,
  ) {
    await this.auth.changePassword(actor.userId, dto.currentPassword, dto.newPassword);
    return { accepted: true };
  }

  @Post('password/reset/request')
  @Public()
  public async requestPasswordReset(@Body() dto: EmailDto, @Ip() ip: string) {
    await this.otp.requestEmail(dto.email, 'password_reset', ip);
    return { accepted: true };
  }

  @Post('password/reset')
  @Public()
  public async resetPassword(@Body() dto: PasswordResetDto) {
    await this.auth.resetPassword(dto.email, dto.code, dto.newPassword);
    return { accepted: true };
  }

  @Post('reauthentication/email/request')
  @ApiBearerAuth()
  public async requestReauthenticationCode(
  @CurrentActor() actor: AuthenticatedActor,
    @Ip() ip: string,
  ) {
    await this.reauthentication.requestEmailCode(actor.userId, ip);
    return { accepted: true };
  }

  @Post('mfa/code/request')
  @Public()
  public async requestMfaCode(@Body() dto: MfaCodeRequestDto) {
    await this.mfa.requestCode(dto.challengeId, dto.factor);
    return { accepted: true };
  }

  @Post('mfa/complete')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete message or TOTP MFA and return Tokens' })
  @ApiOkResponse({ schema: authenticationResultSchema })
  public completeMfa(@Body() dto: MfaCompleteDto) {
    return this.mfa.complete(dto.challengeId, dto.factor, dto.code);
  }

  @Post('mfa/passkey/options')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create Passkey assertion options bound to an MFA challenge' })
  @ApiOkResponse({ description: 'Passkey assertion options and a one-time assertion ID.' })
  public mfaPasskeyOptions(@Body() dto: MfaPasskeyOptionsDto) {
    return this.passkeys.mfaAuthenticationOptions(dto.challengeId);
  }

  @Post('mfa/passkey/complete')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete Passkey MFA and return Tokens' })
  @ApiOkResponse({ schema: authenticationResultSchema })
  public completeMfaPasskey(@Body() dto: MfaPasskeyCompleteDto) {
    return this.passkeys.verifyMfaAuthentication(
      dto.challengeId,
      dto.assertionId,
      dto.response,
    );
  }

  @Get('mfa/settings')
  @ApiBearerAuth()
  public mfaSettings(@CurrentActor() actor: AuthenticatedActor) {
    return this.mfa.settingsFor(actor.userId);
  }

  @Put('mfa/email')
  @ApiBearerAuth()
  public async setEmailMfa(@CurrentActor() actor: AuthenticatedActor, @Body() dto: MfaSettingDto) {
    await this.mfa.setMessageFactor(actor.userId, 'email', dto.enabled, dto);
    return { accepted: true };
  }

  @Put('mfa/sms')
  @ApiBearerAuth()
  public async setSmsMfa(@CurrentActor() actor: AuthenticatedActor, @Body() dto: MfaSettingDto) {
    await this.mfa.setMessageFactor(actor.userId, 'sms', dto.enabled, dto);
    return { accepted: true };
  }

  @Post('mfa/totp/enroll')
  @ApiBearerAuth()
  public beginTotp(@CurrentActor() actor: AuthenticatedActor, @Body() dto: ReauthenticateDto) {
    return this.mfa.beginTotpEnrollment(actor.userId, dto);
  }

  @Post('mfa/totp/confirm')
  @ApiBearerAuth()
  public async confirmTotp(@CurrentActor() actor: AuthenticatedActor, @Body() dto: TotpCodeDto) {
    await this.mfa.confirmTotpEnrollment(actor.userId, dto.code);
    return { accepted: true };
  }

  @Delete('mfa/totp')
  @ApiBearerAuth()
  public async disableTotp(
  @CurrentActor() actor: AuthenticatedActor,
    @Body() dto: ReauthenticateDto,
  ) {
    await this.mfa.disableTotp(actor.userId, dto);
    return { accepted: true };
  }

  @Post('passkeys/registration/options')
  @ApiBearerAuth()
  public passkeyRegistrationOptions(@CurrentActor() actor: AuthenticatedActor) {
    return this.passkeys.registrationOptions(actor.userId);
  }

  @Post('passkeys/registration/verify')
  @ApiBearerAuth()
  public verifyPasskeyRegistration(
  @CurrentActor() actor: AuthenticatedActor,
    @Body() dto: PasskeyRegistrationVerifyDto,
  ) {
    return this.passkeys.verifyRegistration(actor.userId, dto.challengeId, dto.response);
  }

  @Post('login/passkey/options')
  @Public()
  @ApiOperation({ summary: 'Create discoverable Passkey login assertion options' })
  @ApiCreatedResponse({ description: 'Passkey assertion options and a one-time challenge ID.' })
  public passkeyAuthenticationOptions() {
    return this.passkeys.authenticationOptions();
  }

  @Post('login/passkey/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a direct Passkey login and return Tokens' })
  @ApiOkResponse({ schema: authenticationResultSchema })
  public verifyPasskeyAuthentication(
  @Body() dto: PasskeyAuthenticationVerifyDto,
    @Ip() ip: string,
  ) {
    return this.passkeys.verifyAuthentication(dto.challengeId, dto.response, ip, dto.deviceName);
  }

  @Get('passkeys')
  @ApiBearerAuth()
  public listPasskeys(@CurrentActor() actor: AuthenticatedActor) {
    return this.passkeys.list(actor.userId);
  }

  @Delete('passkeys/:id')
  @ApiBearerAuth()
  public async removePasskey(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string) {
    await this.passkeys.remove(actor.userId, id);
    return { accepted: true };
  }

  @Post('phone/request')
  @ApiBearerAuth()
  public async requestPhone(
  @CurrentActor() actor: AuthenticatedActor,
    @Body() dto: PhoneCodeRequestDto,
    @Ip() ip: string,
  ) {
    await this.auth.requestPhoneBinding(actor.userId, dto.phone, ip);
    return { accepted: true };
  }

  @Post('phone/confirm')
  @ApiBearerAuth()
  public async confirmPhone(
  @CurrentActor() actor: AuthenticatedActor,
    @Body() dto: PhoneCodeConfirmDto,
  ) {
    await this.auth.confirmPhoneBinding(actor.userId, dto.phone, dto.code);
    return { accepted: true };
  }
}
