import type { SmtpConfig } from './mail-config';
import type { MailMessage, MailSender } from './mail-sender';

/**
 * Every transactional email this app sends is awaited inside a request (Better Auth awaits
 * `sendVerificationEmail` during sign-up), so an unreachable relay must fail fast rather
 * than hold the connection for nodemailer's multi-minute defaults.
 */
const SMTP_TIMEOUT_MS = 10_000;

/**
 * The slice of nodemailer's `Transporter` this module uses.
 *
 * Declared structurally rather than imported: the runtime is `nodemailer@9` (9.0.1 patched
 * GHSA-p6gq-j5cr-w38f, so 8.x is not an option), but DefinitelyTyped still publishes
 * `@types/nodemailer@8`. The version skew is deliberate — this surface is three members wide
 * and unchanged across the major, so the stale types only have to resolve the module. Drop
 * the pinned `@types` once DT ships 9.x.
 */
interface SmtpTransporter {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
  close(): void;
}

/**
 * Delivers mail over SMTP via nodemailer.
 *
 * SMTP rather than a provider SDK on purpose: Kurultay is AGPL and meant to be self-hosted,
 * and every plausible target — Resend, SES, Postmark, Mailgun, a company's own Postfix —
 * exposes an SMTP endpoint. One transport covers all of them with environment variables and
 * no vendor dependency.
 */
export class SmtpMailSender implements MailSender {
  readonly transport = 'smtp' as const;

  /**
   * A relay is configured, so a resolved `send` means the message was handed off. Whether the
   * recipient's server then accepted it is not something SMTP tells the sender, and this bit
   * does not pretend otherwise — see `MailDeliveryStatus.SENT`.
   */
  readonly deliversMail = true;

  private transporter: SmtpTransporter | undefined;

  constructor(
    private readonly from: string,
    private readonly config: SmtpConfig,
  ) {}

  /**
   * Creates the transporter on first use.
   *
   * `nodemailer` is imported dynamically so a deployment that never configures SMTP never
   * loads it, and so unit tests of the surrounding module do not drag the dependency in.
   */
  private async getTransporter(): Promise<SmtpTransporter> {
    if (this.transporter !== undefined) {
      return this.transporter;
    }

    const { createTransport } = await import('nodemailer');
    const transporter: SmtpTransporter = createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      ...(this.config.auth === undefined
        ? {}
        : { auth: { user: this.config.auth.user, pass: this.config.auth.password } }),
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });

    this.transporter = transporter;
    return transporter;
  }

  async send(message: MailMessage): Promise<void> {
    const transporter = await this.getTransporter();
    await transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  close(): Promise<void> {
    this.transporter?.close();
    this.transporter = undefined;
    return Promise.resolve();
  }
}
