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
 *
 * `DEMO_MODE` selects this transport too, on purpose and not as a side effect of leaving SMTP
 * unset, which is why the warning is a constructor argument rather than a constant. The two
 * cases have the same consequence and completely different causes, and an operator reading
 * "SMTP_HOST is unset" on a host where they set it would go looking for the wrong bug.
 */
export const NO_SMTP_REASON =
  'SMTP is not configured (SMTP_HOST is unset) — emails are written to this log instead ' +
  'of being delivered. Email addresses cannot be verified, so workspace invitations ' +
  'cannot be accepted. Configure SMTP before running this outside development.';

export const DEMO_MODE_REASON =
  'DEMO_MODE is on: emails are written to this log instead of being delivered, whatever ' +
  'SMTP_HOST says. A public demo whose data is wiped on a schedule must not be able to send ' +
  'mail to addresses a stranger typed into it.';

export class LogMailSender implements MailSender {
  readonly transport = 'log' as const;

  /** The definition of this transport: `send` resolves, and nobody receives anything. */
  readonly deliversMail = false;

  private readonly logger = new Logger(LogMailSender.name);

  constructor(
    private readonly from: string,
    reason: string = NO_SMTP_REASON,
  ) {
    this.logger.warn(reason);
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
