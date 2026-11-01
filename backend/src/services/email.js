import nodemailer from 'nodemailer';

/**
 * Validates whether a string is a properly formatted email address.
 * Conforms to practical RFC 5322 specifications.
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  
  // RFC 5322 compatible regex
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return emailRegex.test(trimmed);
}

/**
 * Returns SMTP configuration from environment variables or overrides.
 */
export function getSmtpConfig(overrides = {}) {
  const host = overrides.host || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(overrides.port || process.env.SMTP_PORT || 465);
  const secureEnv = overrides.secure !== undefined ? overrides.secure : process.env.SMTP_SECURE;
  const secure = secureEnv === true || secureEnv === 'true' || port === 465;
  const user = overrides.user !== undefined ? overrides.user : (process.env.SMTP_USER || '');
  const pass = overrides.pass !== undefined ? overrides.pass : (process.env.SMTP_PASS || '');
  const from = overrides.from || process.env.SMTP_FROM || (user ? `OpenRelay <${user}>` : 'OpenRelay <notifications@openrelay.dev>');

  return { host, port, secure, user, pass, from };
}

let activeTransporter = null;

export function setDefaultTransporter(transporter) {
  activeTransporter = transporter;
}

export function getDefaultTransporter() {
  return activeTransporter;
}

/**
 * Creates and returns a Nodemailer transporter.
 */
export function createTransporter(configOverrides = null) {
  const config = getSmtpConfig(configOverrides || {});

  const transportOptions = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  };

  if (config.user && config.pass) {
    transportOptions.auth = {
      user: config.user,
      pass: config.pass,
    };
  }

  return nodemailer.createTransport(transportOptions);
}

/**
 * Escapes HTML characters to prevent XSS / formatting corruption in email.
 */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a clean, modern, and responsive HTML email template
 * containing the notification title and message, plus plaintext version.
 */
export function renderNotificationEmail({ title, message, type = 'general', recipient, id, createdAt }) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeType = escapeHtml(type.toUpperCase());
  const safeId = escapeHtml(id || 'N/A');
  const safeRecipient = escapeHtml(recipient || '');
  const formattedDate = createdAt ? new Date(createdAt).toUTCString() : new Date().toUTCString();

  const text = `[OpenRelay] Notification
--------------------------------------------------
Title: ${title}
Type: ${type.toUpperCase()}
Date: ${formattedDate}

${message}

--------------------------------------------------
Recipient: ${recipient}
Notification ID: ${id || 'N/A'}
Powered by OpenRelay - Self-hosted Notification Infrastructure
`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${safeTitle}</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    @media screen and (max-width: 600px) {
      .email-container { width: 100% !important; margin: auto !important; }
      .content-padding { padding: 24px 20px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #f3f4f6; -webkit-font-smoothing: antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="email-container" style="max-width: 580px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- Brand Header -->
          <tr>
            <td style="background-color: #0b1018; padding: 20px 28px; border-bottom: 2px solid #3b82f6;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width: 32px; height: 32px; background-color: #3b82f6; border-radius: 8px; text-align: center; vertical-align: middle; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 800; font-size: 18px; color: #ffffff;">
                          O
                        </td>
                        <td style="padding-left: 12px; vertical-align: middle;">
                          <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 17px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">OpenRelay</span>
                          <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; color: #94a3b8; display: block;">Notification Service</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <span style="display: inline-block; padding: 3px 10px; border-radius: 999px; background-color: rgba(59, 130, 246, 0.2); color: #93c5fd; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;">${safeType}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td class="content-padding" style="padding: 32px 28px; background-color: #ffffff;">
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; line-height: 1.3; color: #0f172a; letter-spacing: -0.02em;">
                ${safeTitle}
              </h1>

              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #3b82f6; border-radius: 8px; padding: 18px 20px; margin: 20px 0 24px 0;">
                <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #334155; white-space: pre-wrap; word-break: break-word;">${safeMessage}</p>
              </div>

              <!-- Metadata Details Table -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top: 1px solid #f1f5f9; padding-top: 18px; margin-top: 24px; font-size: 12px; color: #64748b;">
                <tr>
                  <td style="padding: 4px 0; width: 90px; font-weight: 600; color: #475569;">Recipient:</td>
                  <td style="padding: 4px 0; color: #0f172a; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${safeRecipient}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; font-weight: 600; color: #475569;">Delivered via:</td>
                  <td style="padding: 4px 0; color: #0f172a;">SMTP Relay</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; font-weight: 600; color: #475569;">Timestamp:</td>
                  <td style="padding: 4px 0; color: #64748b;">${formattedDate}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; font-weight: 600; color: #475569;">Reference:</td>
                  <td style="padding: 4px 0; color: #94a3b8; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px;">${safeId}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 18px 28px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #94a3b8;">
                This notification was dispatched by <strong>OpenRelay</strong> on behalf of your application.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { html, text };
}

/**
 * Sends a notification email via SMTP using Nodemailer.
 * Throws on failure with descriptive error messages.
 * 
 * @param {Object} notification - Notification payload { id, recipient, title, message, type, createdAt }
 * @param {Object} [transporterInstance] - Optional transporter instance (used in tests/custom configs)
 * @returns {Promise<{ messageId: string, response: string, accepted: string[] }>}
 */
export async function sendNotificationEmail(notification, transporterInstance = null) {
  const { recipient, title, message, type, id, createdAt } = notification;

  if (!isValidEmail(recipient)) {
    throw new Error(`Invalid recipient email address: "${recipient}"`);
  }

  const transporter = transporterInstance || activeTransporter || createTransporter();
  const config = getSmtpConfig();

  // If using default transporter, ensure credentials are set
  if (!transporterInstance && !activeTransporter && (!config.user || !config.pass)) {
    throw new Error('SMTP credentials are not configured. Set SMTP_USER and SMTP_PASS in your environment.');
  }

  const { html, text } = renderNotificationEmail({
    title,
    message,
    type: type || 'general',
    recipient,
    id,
    createdAt: createdAt || new Date().toISOString()
  });

  const mailOptions = {
    from: config.from,
    to: recipient.trim(),
    subject: title.trim(),
    text,
    html,
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

/**
 * Generates an HTML and plaintext email template for password reset.
 */
export function renderPasswordResetEmail({ resetUrl, recipient, name }) {
  const safeRecipient = escapeHtml(recipient || '');
  const safeName = escapeHtml(name || recipient?.split('@')[0] || 'Developer');
  const safeUrl = escapeHtml(resetUrl || '');

  const text = `[OpenRelay] Password Reset Request
--------------------------------------------------
Hello ${safeName},

We received a request to reset the password for your OpenRelay account (${recipient}).

To reset your password, visit the following link:
${resetUrl}

This link is single-use and will expire in 1 hour.
If you did not make this request, you can safely ignore this email. Your account password will remain unchanged.

--------------------------------------------------
Recipient: ${recipient}
Powered by OpenRelay - Self-hosted Notification Infrastructure
`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Reset your OpenRelay password</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    @media screen and (max-width: 600px) {
      .email-container { width: 100% !important; margin: auto !important; }
      .content-padding { padding: 24px 20px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #f3f4f6; -webkit-font-smoothing: antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="email-container" style="max-width: 580px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- Brand Header -->
          <tr>
            <td style="background-color: #0b1018; padding: 20px 28px; border-bottom: 2px solid #3b82f6;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width: 32px; height: 32px; background-color: #3b82f6; border-radius: 8px; text-align: center; vertical-align: middle; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 800; font-size: 18px; color: #ffffff;">
                          O
                        </td>
                        <td style="padding-left: 12px; vertical-align: middle;">
                          <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 17px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">OpenRelay</span>
                          <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; color: #94a3b8; display: block;">Account Security</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <span style="display: inline-block; padding: 3px 10px; border-radius: 999px; background-color: rgba(59, 130, 246, 0.2); color: #93c5fd; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;">SECURITY</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td class="content-padding" style="padding: 32px 28px; background-color: #ffffff;">
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; line-height: 1.3; color: #0f172a; letter-spacing: -0.02em;">
                Reset your password
              </h1>

              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #334155;">
                Hello <strong>${safeName}</strong>,
              </p>

              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #334155;">
                We received a request to reset your OpenRelay account password. Click the button below to choose a new password:
              </p>

              <!-- Action Button -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td align="center" style="border-radius: 8px; background-color: #2563eb;">
                    <a href="${safeUrl}" target="_blank" style="font-size: 15px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; display: inline-block;">
                      Reset Password &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 14px 16px; margin: 24px 0;">
                <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #64748b;">
                  <strong>Important:</strong> This password reset link is time-limited and will expire in <strong>1 hour</strong>. It can only be used once. If you did not request this change, you can safely ignore this email.
                </p>
              </div>

              <!-- Fallback Plain Link -->
              <p style="margin: 24px 0 0 0; font-size: 12px; line-height: 1.5; color: #94a3b8; word-break: break-all;">
                If the button above does not work, copy and paste this URL into your browser:<br>
                <a href="${safeUrl}" style="color: #2563eb; text-decoration: underline;">${safeUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 18px 28px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #94a3b8;">
                This security email was dispatched by <strong>OpenRelay</strong>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { html, text };
}

/**
 * Sends a password reset email via SMTP using Nodemailer.
 * 
 * @param {Object} params - { recipient, resetUrl, name }
 * @param {Object} [transporterInstance] - Optional transporter override
 * @returns {Promise<Object>}
 */
export async function sendPasswordResetEmail({ recipient, resetUrl, name }, transporterInstance = null) {
  if (!isValidEmail(recipient)) {
    throw new Error(`Invalid recipient email address: "${recipient}"`);
  }
  if (!resetUrl) {
    throw new Error('Reset URL is required to send password reset email.');
  }

  const transporter = transporterInstance || activeTransporter || createTransporter();
  const config = getSmtpConfig();

  if (!transporterInstance && !activeTransporter && (!config.user || !config.pass)) {
    throw new Error('SMTP credentials are not configured. Set SMTP_USER and SMTP_PASS in your environment.');
  }

  const { html, text } = renderPasswordResetEmail({ resetUrl, recipient, name });

  const mailOptions = {
    from: config.from,
    to: recipient.trim(),
    subject: 'Reset your OpenRelay password',
    text,
    html,
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}
