const nodemailer = require('nodemailer');
const { logger } = require('@honeykid/ml');
const config = require('../../config');
const BusinessError = require('../utils/business_error');
const ErrorCodes = require('../utils/error_codes');

let transporter;

function getTransporter() {
  if (!transporter) {
    const { smtp } = config.email;

    if (!smtp.host || !smtp.user || !smtp.password || !config.email.from.address) {
      throw new BusinessError(
        503,
        ErrorCodes.EMAIL_DELIVERY_UNAVAILABLE,
        '验证码暂时无法发送，请稍后再试。',
      );
    }
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.password },
      pool: true,
      maxConnections: 3,
    });
  }

  return transporter;
}

const SceneNames = {
  register: '注册账号',
  bind_email: '绑定邮箱',
  reset_password: '重置密码',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function verificationEmailHtml(sceneName, code) {
  const safeScene = escapeHtml(sceneName);
  const safeCode = escapeHtml(code);
  const supportAddress = escapeHtml(config.email.from.address);
  const expiryMinutes = Math.ceil(config.email.verification.ttl_seconds / 60);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>验证码</title>
</head>
<body style="margin:0;background:#f2f6f5;color:#14272a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f2f6f5;">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe6e3;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:24px 32px;background:#092d2a;color:#ffffff;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="width:36px;height:36px;background:#16df8f;border-radius:6px;text-align:center;vertical-align:middle;color:#062a26;font-size:20px;font-weight:800;">M</td>
                  <td style="padding-left:12px;font-size:18px;font-weight:700;">营销大师</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:34px 32px 30px;">
              <h1 style="margin:0 0 12px;font-size:22px;line-height:1.4;color:#102f2c;">${safeScene}验证</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#59706e;">你正在进行${safeScene}，请在页面中输入以下验证码：</p>
              <div style="padding:18px 20px;background:#edf8f4;border:1px solid #bce8d7;border-radius:6px;text-align:center;color:#073d35;font-family:Menlo,Consolas,monospace;font-size:32px;font-weight:800;letter-spacing:8px;">${safeCode}</div>
              <p style="margin:16px 0 0;font-size:14px;line-height:1.7;color:#59706e;">验证码在 ${expiryMinutes} 分钟内有效，且只能使用一次。</p>
              <div style="height:1px;background:#e5eeec;margin:28px 0 20px;"></div>
              <p style="margin:0;font-size:13px;line-height:1.7;color:#7a8d8b;">如果不是你本人操作，请忽略这封邮件，不要将验证码告诉他人。</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background:#f8faf9;border-top:1px solid #e5eeec;font-size:12px;line-height:1.6;color:#899996;">
              此邮件由系统自动发送。如需帮助，请联系 ${supportAddress}。
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendVerificationCode(email, scene, code) {
  const sceneName = SceneNames[scene] || '邮箱验证';
  const expiryMinutes = Math.ceil(config.email.verification.ttl_seconds / 60);
  const subject = `营销大师 | ${sceneName}验证码`;
  const text = [
    `你正在进行${sceneName}。`,
    `验证码：${code}`,
    `验证码在 ${expiryMinutes} 分钟内有效，且只能使用一次。`,
    '如果不是你本人操作，请忽略这封邮件，不要将验证码告诉他人。',
  ].join('\n\n');

  try {
    await getTransporter().sendMail({
      from: { name: config.email.from.name, address: config.email.from.address },
      to: email,
      replyTo: config.email.from.address,
      subject,
      text,
      html: verificationEmailHtml(sceneName, code),
    });
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    logger.error(`Failed to send verification email: ${error.message}`);
    throw new BusinessError(
      503,
      ErrorCodes.EMAIL_DELIVERY_UNAVAILABLE,
      '验证码暂时无法发送，请稍后再试。',
    );
  }
}

module.exports = { sendVerificationCode };
