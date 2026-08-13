import { Logger } from '@nestjs/common';
import type { MailMessage, MailSender } from './mail-sender';

/**
 * The transport used when `SMTP_HOST` is unset: it writes the message to the log instead of
 * delivering it.
 *
 * This exists so the API boots with no mail provider configured — the developer experience
 * before email existed — and so a local `pnpm dev` can still complete a verification flow by
 * copying the link out of the console.
 *
 * It is **not** silent about what it is. Every instance announces itself once at
 * construction, because a production deployment that lands here delivers nothing: nobody can
 * verify an address, and therefore nobody can accept a workspace invitation.
 */
export class LogMailSender implements MailSender {
  readonly transport = 'log' as const;

  /** The definition of this transport: `send` resolves, and nobody receives anything. */
  readonly deliversMail = false;

  private readonly logger = new Logger(LogMailSender.name);

  constructor(private readonly from: string) {
    this.logger.warn(
      'SMTP is not configured (SMTP_HOST is unset) — emails are written to this log instead ' +
        'of being delivered. Email addresses cannot be verified, so workspace invitations ' +
        'cannot be accepted. Configure SMTP before running this outside development.',
    );
  }

  send(message: MailMessage): Promise<void> {
    this.logger.log(
      `Email not sent (no SMTP): from=${this.from} to=${message.to} subject=${message.subject}\n${message.text}`,
    );
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
