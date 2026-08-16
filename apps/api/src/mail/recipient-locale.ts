import { Logger } from '@nestjs/common';
import { negotiateLocale, resolveLocale, type Locale } from '@kurul/shared-types';

const logger = new Logger('MailLocale');

/**
 * Reads one account's stored `User.locale` by email address.
 *
 * Returns `null` both for "no such account" and for "that account never picked a language" —
 * the two are the same answer to this question, and keeping them apart would only invite a
 * caller to treat a missing account as an error. Implemented in `stored-locale.ts`; taken as a
 * parameter here so the rule below can be tested without a database.
 */
export type StoredLocaleReader = (email: string) => Promise<string | null>;

export interface RecipientLocaleInput {
  /** Address the email is going to. */
  to: string;
  /**
   * Address of the person whose action caused the send, when that is someone else.
   *
   * Undefined for a verification email, where the recipient *is* the actor.
   */
  actorEmail?: string | null;
  /** `Accept-Language` of the request that triggered the send, when there was one. */
  acceptLanguage?: string | null;
}

/**
 * The language an outbound email is written in.
 *
 * ```
 * recipient's User.locale  →  sender's User.locale  →  Accept-Language  →  'en'
 * ```
 *
 * The first link is the whole reason `User.locale` is a database column rather than only a
 * cookie (ADR 0013, ADR 0018): mail is sent from a Better Auth hook, sometimes after the
 * request that triggered it has already been answered, so there is no request whose headers
 * could be consulted for the *recipient*.
 *
 * **The rule for an address with no account yet.** An invitation to a new address has no
 * recipient preference to read — the person does not exist in this instance. Rather than
 * defaulting them to English, the invitation is written in the language of the person who sent
 * it. That is not a guess dressed up as data: the inviter is the only human in the exchange
 * whose language is known, they chose to write to this address, and a Turkish team inviting a
 * colleague is overwhelmingly likely to be inviting someone who reads Turkish. It also leaks
 * nothing — the recipient can already see who invited them and to what.
 *
 * The `Accept-Language` link behind it covers the sender who never picked a language either,
 * and — for a verification email, where actor and recipient are the same brand-new account —
 * it is the *only* link that can fire, because a user cannot have chosen a language before the
 * account that stores the choice existed. English is last, as everywhere else.
 *
 * Never rejects. A failed lookup degrades to the next link and is logged: an email that
 * arrives in the wrong language is a smaller failure than a signup that fails because the
 * locale query did.
 */
export async function resolveRecipientLocale(
  read: StoredLocaleReader,
  input: RecipientLocaleInput,
): Promise<Locale> {
  const recipient = await readQuietly(read, input.to);
  const actor =
    input.actorEmail && input.actorEmail !== input.to
      ? await readQuietly(read, input.actorEmail)
      : null;

  return resolveLocale([recipient, actor, negotiateLocale(input.acceptLanguage)]);
}

/** `Accept-Language` off a Fetch `Request`, tolerating the hook being called without one. */
export function acceptLanguageOf(request: Request | undefined): string | null {
  return request?.headers?.get('accept-language') ?? null;
}

async function readQuietly(read: StoredLocaleReader, email: string): Promise<string | null> {
  try {
    return await read(email);
  } catch (caught) {
    logger.warn(
      `Falling back to the next locale link: could not read the stored locale for a recipient`,
      caught instanceof Error ? caught.stack : undefined,
    );
    return null;
  }
}
