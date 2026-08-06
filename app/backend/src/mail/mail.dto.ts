import { IsString, MaxLength } from 'class-validator';

/** 更新 Power Automate webhook URL。空字符串表示清空配置（停用邮件发送）。 */
export class UpdateMailConfigDto {
  @IsString()
  @MaxLength(2048)
  public url!: string;
}
