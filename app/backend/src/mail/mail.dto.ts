/* eslint-disable max-classes-per-file */
import { IsEmail, IsString, MaxLength } from 'class-validator';

/** 更新 Power Automate webhook URL。空字符串表示清空配置（停用邮件发送）。 */
export class UpdateMailConfigDto {
  @IsString()
  @MaxLength(2048)
  public url!: string;
}

/** 发送测试邮件。 */
export class SendTestMailDto {
  @IsEmail()
  public to!: string;
}
