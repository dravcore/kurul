import { envBool, envPort, envString } from '../common/env';

/** Credentials are omitted entirely for anonymous relays (a dev Mailpit, an internal MTA). */
interface SmtpAuth {
  user: string;
  password: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** `true` = implicit TLS (port 465); `false` = STARTTLS / plaintext (587, 25). */
  secure: boolean;
  auth?: SmtpAuth;
}

export interface MailConfig {
  /** `From` header, e.g. `Kurul <noreply@example.com>`. */
  from: string;
  /** `undefined` when `SMTP_HOST` is unset — mail is then written to the log instead. */
  smtp: SmtpConfig | undefined;
}

const DEFAULT_SMTP_PORT = 587;
/** The one port where SMTP is TLS from the first byte instead of upgrading via STARTTLS. */
const IMPLICIT_TLS_PORT = 465;
const DEFAULT_FROM = 'Kurul <noreply@localhost>';

/**
 * Reads the mail configuration from the environment.
 *
 * `SMTP_HOST` is the single switch: set it and mail is delivered over SMTP, leave it unset
 * and the app still boots (the log transport takes over). That keeps `pnpm dev` working with
 * no mail provider at all, which is the existing developer experience.
 */
export function readMailConfig(): MailConfig {
  const from = envString('MAIL_FROM', DEFAULT_FROM);
  const host = envString('SMTP_HOST', '');
  if (host === '') {
    return { from, smtp: undefined };
  }

  const port = envPort('SMTP_PORT', DEFAULT_SMTP_PORT);
  const user = envString('SMTP_USER', '');

  return {
    from,
    smtp: {
      host,
      port,
      // Implicit TLS is the norm on 465 and STARTTLS everywhere else, so the default follows
      // the port rather than forcing every deployment to reason about `SMTP_SECURE`.
      secure: envBool('SMTP_SECURE', port === IMPLICIT_TLS_PORT),
      // Passing `auth` with an empty user makes nodemailer attempt AUTH against relays that
      // do not offer it, which fails the connection. No user means no `auth` block at all.
      ...(user === '' ? {} : { auth: { user, password: envString('SMTP_PASSWORD', '') } }),
    },
  };
}
