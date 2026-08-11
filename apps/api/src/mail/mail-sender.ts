/**
 * The outbound-email port.
 *
 * Everything that sends mail depends on this interface, never on a concrete transport, so
 * swapping SMTP for something else is a new class in this folder and nothing else. The
 * project is AGPL and self-hostable, which rules out building the domain logic on top of a
 * single vendor's HTTP API — SMTP is the contract every provider (and every private relay)
 * already speaks.
 */
export interface MailMessage {
  /** A single recipient address. Transactional mail here is always one-to-one. */
  to: string;
  subject: string;
  /** Plain-text body. Always populated — it is the fallback for text-only clients. */
  text: string;
  /** HTML body. */
  html: string;
}

/**
 * A transport that can deliver a `MailMessage`.
 *
 * `send` **throws** on failure. Deciding that a failed transactional email must not fail the
 * user's request is a policy, not a transport concern, and it lives in exactly one place
 * (`sendWith` in `send-mail.ts`) so no call site can forget it or apply a different rule.
 */
export interface MailSender {
  /** Which transport this is; surfaced for diagnostics and tests, never branched on in logic. */
  readonly transport: 'smtp' | 'log';
  send(message: MailMessage): Promise<void>;
  /** Releases transport resources (pooled SMTP connections). Idempotent. */
  close(): Promise<void>;
}
