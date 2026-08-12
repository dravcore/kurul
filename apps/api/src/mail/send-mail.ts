import { Logger } from '@nestjs/common';
import { LogMailSender } from './log-mail-sender';
import { readMailConfig, type MailConfig } from './mail-config';
import type { MailMessage, MailSender } from './mail-sender';
import { SmtpMailSender } from './smtp-mail-sender';

const logger = new Logger('Mail');

/** Picks the transport for a configuration: SMTP when there is a host, the log otherwise. */
export function createMailSender(config: MailConfig): MailSender {
  return config.smtp === undefined
    ? new LogMailSender(config.from)
    : new SmtpMailSender(config.from, config.smtp);
}

let currentSender: MailSender | undefined;

/**
 * The process-wide sender.
 *
 * A module-level singleton rather than a Nest provider because the main consumer —
 * `auth/auth.ts` — is itself constructed at module load, outside the DI container, and
 * Better Auth calls its `sendVerificationEmail` / `sendInvitationEmail` hooks with no
 * injection point of its own. The same argument the Better Auth Prisma client already makes
 * in `auth.ts`. A singleton is also what we want regardless: one SMTP transporter per
 * process, not one per injector. `MailService` wraps this for Nest consumers and owns
 * closing it at shutdown, so there is still exactly one lifecycle.
 */
export function getMailSender(): MailSender {
  currentSender ??= createMailSender(readMailConfig());
  return currentSender;
}

/**
 * Sends `message` through `sender`, swallowing delivery failures.
 *
 * Transactional mail is a side effect of a request, never its result: a signup must not fail
 * because the relay refused the connection, and an invitation that is already stored must
 * not be reported as failed because its notification bounced. So the failure is contained
 * here — but it is contained *loudly*, at `error` level with the stack, because a silent
 * swallow turns "nobody can verify their address" into an invisible outage.
 */
export async function sendWith(sender: MailSender, message: MailMessage): Promise<void> {
  try {
    await sender.send(message);
  } catch (error) {
    logger.error(
      `Failed to send "${message.subject}" to ${message.to} over ${sender.transport}`,
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
}

/** Sends `message` through the process-wide sender. Never rejects — see `sendWith`. */
export function sendMail(message: MailMessage): Promise<void> {
  return sendWith(getMailSender(), message);
}

/** Releases the sender's resources and drops it, so the next send builds a fresh one. */
export async function closeMailSender(): Promise<void> {
  const current = currentSender;
  currentSender = undefined;
  await current?.close();
}
