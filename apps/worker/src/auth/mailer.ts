import type { MailerProviderKind } from '@nova/shared';

export interface MailerConfig {
  provider: MailerProviderKind;
  senderEmail: string;
  senderName: string;
  secret: string;
}

export interface SendOtpEmailInput {
  toEmail: string;
  displayName: string;
  code: string;
  expiresMinutes: number;
  runtime: 'workers' | 'node';
}

function toBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function wrapBase64Lines(b64: string, lineLen = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += lineLen) {
    lines.push(b64.slice(i, i + lineLen));
  }
  return lines.join('\r\n');
}

function buildOtpHtml(displayName: string, code: string, expiresMinutes: number): string {
  const safeName = displayName.replace(/[<>&"']/g, '');
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#0d0f12;font-family:Segoe UI,Tahoma,Arial,sans-serif;color:#f3f4f6;">
  <div style="max-width:480px;margin:0 auto;background:#161920;border:1px solid #262b36;border-radius:16px;padding:28px;text-align:right;">
    <h2 style="margin:0 0 8px 0;color:#d97757;font-size:20px;">NOVA AI Cloud — رمز التحقق الأمني</h2>
    <p style="margin:0 0 18px 0;color:#9ca3af;font-size:14px;line-height:1.7;">
      مرحباً <strong>${safeName}</strong>، لتأكيد ملكيتك لهذا البريد الإلكتروني وتفعيل حسابك الخاص، أدخل رمز التحقق التالي المكوّن من 6 أرقام:
    </p>
    <div dir="ltr" style="background:#0d0f12;border:1px solid #d97757;border-radius:12px;padding:18px;text-align:center;font-family:Consolas,monospace;font-size:32px;font-weight:bold;letter-spacing:10px;color:#ffffff;margin:16px 0;">
      ${code}
    </div>
    <p style="margin:16px 0 0 0;color:#9ca3af;font-size:12px;line-height:1.6;">
      ⏱️ ينتهي هذا الرمز خلال <strong>${expiresMinutes} دقائق</strong>. لا تشارك هذا الرمز مع أي شخص.<br>
      إذا لم تطلب إنشاء حساب في NOVA AI Cloud، يمكنك تجاهل هذه الرسالة بأمان.
    </p>
  </div>
</body>
</html>`;
}

export function isMailerConfigured(cfg: MailerConfig | null | undefined): cfg is MailerConfig {
  if (!cfg || cfg.provider === 'none') return false;
  if (!cfg.senderEmail?.trim() || !cfg.secret?.trim()) return false;
  return true;
}

export async function sendOtpEmail(cfg: MailerConfig, input: SendOtpEmailInput): Promise<void> {
  const subject = `رمز التحقق لتفعيل حسابك في NOVA AI Cloud: ${input.code}`;
  const html = buildOtpHtml(input.displayName, input.code, input.expiresMinutes);
  const fromName = cfg.senderName?.trim() || 'NOVA AI Cloud';
  const fromEmail = cfg.senderEmail.trim();

  if (cfg.provider === 'brevo') {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': cfg.secret.trim(),
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: input.toEmail, name: input.displayName }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (res.status === 401 && detail.includes('unrecognised IP')) {
        throw new Error(
          'Brevo حظر عنوان الـ IP لحماية الحساب. افتح Brevo > Settings > Security > Authorized IPs واضغط Deactivate blocking أو اضغط على الرابط في الإيميل الوارد.',
        );
      }
      if (res.status === 403 || detail.includes('permission')) {
        throw new Error(
          'مفتاح Brevo API لا يملك صلاحية إرسال البريد. اختر Full Access أو فعّل All في Transactional email عند إنشاء المفتاح.',
        );
      }
      if (detail.includes('sender') || detail.includes('unverified')) {
        throw new Error('البريد المرسل غير موثق في Brevo. يرجى توثيقه من Senders & IPs.');
      }
      throw new Error(`Brevo API error (${res.status}): ${detail.slice(0, 200)}`);
    }
    return;
  }

  if (cfg.provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.secret.trim()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [input.toEmail],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend API error (${res.status}): ${detail.slice(0, 200)}`);
    }
    return;
  }

  if (cfg.provider === 'gmail') {
    // Strip spaces from 16-char Google App Passwords (`abcd efgh ijkl mnop` -> `abcdefghijklmnop`)
    const appPassword = cfg.secret.replace(/\s+/g, '');
    await sendViaImplicitTlsSmtp({
      host: 'smtp.gmail.com',
      port: 465,
      user: fromEmail,
      pass: appPassword,
      fromEmail,
      fromName,
      toEmail: input.toEmail,
      subject,
      html,
      runtime: input.runtime,
    });
    return;
  }

  throw new Error('Mailer provider is not configured');
}

interface SmtpParams {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  subject: string;
  html: string;
  runtime: 'workers' | 'node';
}

interface DuplexLineTransport {
  readResponse(): Promise<{ code: number; text: string }>;
  writeRaw(data: string): Promise<void>;
  close(): Promise<void>;
}

async function openWorkersTlsTransport(host: string, port: number): Promise<DuplexLineTransport> {
  const { connect } = await import('cloudflare:sockets');
  const socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const nextLine = async (): Promise<string> => {
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        return line;
      }
      const { done, value } = await reader.read();
      if (done) throw new Error('SMTP connection closed unexpectedly');
      buffer += decoder.decode(value, { stream: true });
    }
  };

  return {
    async readResponse() {
      const lines: string[] = [];
      while (true) {
        const line = await nextLine();
        lines.push(line);
        // RFC 5321: final line has `<3digits><space>` (or `<3digits>` end of line)
        if (/^\d{3}(\s|$)/.test(line)) {
          return { code: Number(line.slice(0, 3)), text: lines.join('\n') };
        }
      }
    },
    async writeRaw(data: string) {
      await writer.write(encoder.encode(data));
    },
    async close() {
      try {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
      } catch {
        /* ignore */
      }
    },
  };
}

async function openNodeTlsTransport(host: string, port: number): Promise<DuplexLineTransport> {
  const tls = await import('node:tls');
  const sock = await new Promise<import('node:tls').TLSSocket>((resolve, reject) => {
    const s = tls.connect({ host, port, servername: host, rejectUnauthorized: true }, () => resolve(s));
    s.once('error', reject);
  });

  let buffer = '';
  let waiter: ((val: void) => void) | null = null;
  let sockErr: Error | null = null;
  let closed = false;

  sock.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    if (waiter) {
      const w = waiter;
      waiter = null;
      w();
    }
  });
  sock.on('error', (err) => {
    sockErr = err;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w();
    }
  });
  sock.on('close', () => {
    closed = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w();
    }
  });

  const nextLine = async (): Promise<string> => {
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        return line;
      }
      if (sockErr) throw sockErr;
      if (closed) throw new Error('SMTP socket closed unexpectedly');
      await new Promise<void>((r) => {
        waiter = r;
      });
    }
  };

  return {
    async readResponse() {
      const lines: string[] = [];
      while (true) {
        const line = await nextLine();
        lines.push(line);
        if (/^\d{3}(\s|$)/.test(line)) {
          return { code: Number(line.slice(0, 3)), text: lines.join('\n') };
        }
      }
    },
    async writeRaw(data: string) {
      await new Promise<void>((resolve, reject) => {
        sock.write(data, 'utf8', (err) => (err ? reject(err) : resolve()));
      });
    },
    async close() {
      sock.destroy();
    },
  };
}

async function sendViaImplicitTlsSmtp(p: SmtpParams): Promise<void> {
  const runSmtp = async () => {
    const transport =
      p.runtime === 'workers'
        ? await openWorkersTlsTransport(p.host, p.port)
        : await openNodeTlsTransport(p.host, p.port);

    try {
      const expectCode = async (expected: number, step: string) => {
        const r = await transport.readResponse();
        if (r.code !== expected) {
          throw new Error(`SMTP ${step} failed (${r.code}): ${r.text.slice(0, 180)}`);
        }
      };

      await expectCode(220, 'greeting');
      await transport.writeRaw('EHLO nova-ai-cloud.local\r\n');
      await expectCode(250, 'EHLO');

      const authPlain = toBase64Utf8(`\u0000${p.user}\u0000${p.pass}`);
      await transport.writeRaw(`AUTH PLAIN ${authPlain}\r\n`);
      await expectCode(235, 'AUTH (تأكد من صحة كلمة مرور تطبيقات Gmail App Password)');

      await transport.writeRaw(`MAIL FROM:<${p.fromEmail}>\r\n`);
      await expectCode(250, 'MAIL FROM');

      await transport.writeRaw(`RCPT TO:<${p.toEmail}>\r\n`);
      await expectCode(250, 'RCPT TO');

      await transport.writeRaw('DATA\r\n');
      await expectCode(354, 'DATA');

      const encodedSubject = `=?UTF-8?B?${toBase64Utf8(p.subject)}?=`;
      const encodedFromName = `=?UTF-8?B?${toBase64Utf8(p.fromName)}?=`;
      const bodyB64 = wrapBase64Lines(toBase64Utf8(p.html));
      const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@nova-ai-cloud>`;

      const mimeMessage = [
        `From: ${encodedFromName} <${p.fromEmail}>`,
        `To: <${p.toEmail}>`,
        `Subject: ${encodedSubject}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: ${msgId}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        bodyB64,
        '.',
        '',
      ].join('\r\n');

      await transport.writeRaw(mimeMessage);
      await expectCode(250, 'send body');

      await transport.writeRaw('QUIT\r\n').catch(() => undefined);
    } finally {
      await transport.close();
    }
  };

  await Promise.race([
    runSmtp(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('انتهت مهلة الاتصال بخادم البريد (SMTP Timeout).')), 15_000),
    ),
  ]);
}
