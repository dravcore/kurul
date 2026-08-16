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
  /**
   * Whether a successful `send` means the message left this process for a real recipient.
   *
   * A separate bit rather than `transport === 'smtp'` on purpose. `transport` names *which*
   * implementation this is and is explicitly not something to branch on — the day a second
   * delivering transport exists, every `=== 'smtp'` test silently starts answering "no mail
   * here" for a deployment that sends mail perfectly well. This asks the question the product
   * actually has, which is a capability and not an identity, and it is the single source the
   * `mailEnabled` signal and the per-send delivery status both read
   * (`docs/api-conventions.md#instance-configuration`).
   */
  readonly deliversMail: boolean;
  send(message: MailMessage): Promise<void>;
  /** Releases transport resources (pooled SMTP connections). Idempotent. */
  close(): Promise<void>;
}
