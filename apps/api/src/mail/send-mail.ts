import { Logger } from '@nestjs/common';
import { MailDeliveryStatus } from '@kurul/shared-types';
import { demoModeEnabled } from '../demo/demo-mode';
import { DEMO_MODE_REASON, LogMailSender } from './log-mail-sender';
import { recordMailDelivery } from './mail-delivery-scope';
import { readMailConfig, type MailConfig } from './mail-config';
import type { MailMessage, MailSender } from './mail-sender';
import { SmtpMailSender } from './smtp-mail-sender';

const logger = new Logger('Mail');

/**
 * Picks the transport for a configuration: SMTP when there is a host, the log otherwise.
 *
 * `DEMO_MODE` overrides the host, and this is the only place that has to know it. Silencing
 * mail on a demo instance is one line here instead of a check inside every sender: every
 * outbound message in the API already goes through one transport chosen once per process
 * (see `getMailSender` below), so switching the transport switches *all* of it: verification,
 * invitations and notification email alike, including the paths Better Auth calls directly
 * with no injection point of their own.
 *
 * `mailEnabled()` then reports `false`, which is the truth and a state every consumer already
 * renders: the members screen explains that invitations must be delivered by hand, and
 * `POST /workspaces/:id/invitations` answers `emailDelivery: NOT_CONFIGURED`. A demo where
 * anyone can make the server send mail to any address a stranger typed in is a demo of an
 * open relay, so the reason a demo instance sends nothing is worth the small imprecision in
 * the words "not set up".
 */
export function createMailSender(config: MailConfig): MailSender {
  if (demoModeEnabled()) {
    return new LogMailSender(config.from, DEMO_MODE_REASON);
  }

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
 * Whether this process can actually deliver email.
 *
 * Reads the capability off the transport `createMailSender` already chose, rather than asking
 * the environment a second time. `SMTP_HOST` is interpreted in exactly one place
 * (`mail-config.ts`) and turned into a transport in exactly one other (`createMailSender`); a
 * second reader would be a copy of that interpretation, free to drift from it, and the state
 * it would drift into is "the UI says mail works and the log says it does not" — the failure
 * this signal exists to prevent.
 */
export function mailEnabled(): boolean {
  return getMailSender().deliversMail;
}

/**
 * Sends `message` through `sender`, swallowing delivery failures, and reports what happened.
 *
 * Transactional mail is a side effect of a request, never its result: a signup must not fail
 * because the relay refused the connection, and an invitation that is already stored must
 * not be reported as failed because its notification bounced. So the failure is contained
 * here — but it is contained *loudly*, at `error` level with the stack, because a silent
 * swallow turns "nobody can verify their address" into an invisible outage.
 *
 * The returned status is that same loudness made available to callers who can put it in front
 * of a person instead of in a log file. It is still not an exception: nothing about the
 * containment policy changes, and a caller is free to ignore the value — which is what every
 * caller that has nowhere to show it does.
 */
export async function sendWith(
  sender: MailSender,
  message: MailMessage,
): Promise<MailDeliveryStatus> {
  try {
    await sender.send(message);
  } catch (error) {
    logger.error(
      `Failed to send "${message.subject}" to ${message.to} over ${sender.transport}`,
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );

    return MailDeliveryStatus.FAILED;
  }

  // Not `transport === 'log'`: the question is whether anything was delivered, and the
  // transport owns that answer (`MailSender.deliversMail`).
  return sender.deliversMail ? MailDeliveryStatus.SENT : MailDeliveryStatus.NOT_CONFIGURED;
}

/**
 * Sends `message` through the process-wide sender. Never rejects — see `sendWith`.
 *
 * This is also where the outcome is published to any enclosing `captureMailDelivery`, rather
 * than in `sendWith`: `sendMail` is the entry point used by the Better Auth hooks, whose
 * return value the plugin discards, so it is the only send in the codebase whose result
 * cannot reach its caller any other way.
 */
export async function sendMail(message: MailMessage): Promise<MailDeliveryStatus> {
  const delivery = await sendWith(getMailSender(), message);
  recordMailDelivery(delivery);

  return delivery;
}

/** Releases the sender's resources and drops it, so the next send builds a fresh one. */
export async function closeMailSender(): Promise<void> {
  const current = currentSender;
  currentSender = undefined;
  await current?.close();
}
