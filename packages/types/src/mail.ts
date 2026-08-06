/**
 * Power Automate 邮件通道配置类型。
 *
 * Webhook URL 以纯字符串形式存放在 Redis
 * （key `settings:email:power-automate:webhook-url`），由系统管理员在 `/settings`
 * 页面维护。鉴权 token 不纳入本版本。邮件发送本身不对外暴露 HTTP 路由，仅供
 * 内部通知服务（如验证码）调用。
 */

/** 写入 Power Automate webhook 配置的请求体。`url` 为空表示清空（停用邮件发送）。 */
export interface MailConfigInput {
  url: string;
}

/** 返回给前端的公共配置：永不暴露任何密钥，仅说明是否已配置以及当前 URL。 */
export interface MailPublicConfig {
  configured: boolean;
  url: string;
}
