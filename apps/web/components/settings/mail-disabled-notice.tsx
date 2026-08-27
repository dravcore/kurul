'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SMTP_SETUP_DOCS_URL } from '@/lib/instance-config';

/**
 * Says out loud that this deployment cannot send email, on the screen where that matters.
 *
 * ## Why it exists
 *
 * Requiring a confirmed address before an invitation can be accepted is a deliberate security
 * decision (`docs/decisions/0013-invitation-email-verification.md`, GHSA-fmh4-wcc4-5jm3), and
 * it means a deployment with no SMTP host cannot get anyone into a workspace by email. That
 * constraint was documented and completely invisible: the admin sent an invitation, the API
 * answered `201`, the message went to a log file, and the only thing the product ever showed
 * was an invitation nobody accepted (audit PM-04).
 *
 * ## Why it cannot be dismissed
 *
 * Nothing about the situation changes until an operator edits the environment and restarts the
 * API, so a dismissal would hide a condition that is still true — and hide it hardest from the
 * person who dismissed it once and then invites someone a week later. It disappears on its own
 * the moment `mailEnabled` turns true, which is the only honest way for it to go away.
 *
 * ## Why it is not a topbar strip and not `role="alert"`
 *
 * `docs/design.md` §6 reserves the persistent strip for states that break work in progress
 * ("You're offline. Changes won't save…"); boards, tasks and comments all work fine here. And
 * it is present on first render rather than arriving in response to something the user did, so
 * it is read in document order like the rest of the section — an alert role would interrupt a
 * screen reader to announce a standing condition. Colour never carries it alone (§3): the icon
 * comes with the sentence that says the same thing.
 *
 * ## Why it ends with the copy link
 *
 * §7: every failure ends with a way out, and the way out has to be one the user can take now.
 * "Configure SMTP" is the operator's fix and may be someone else's job entirely; copying the
 * accept link out of the pending row is the one path that works on this deployment as it
 * stands, so that is the move the copy names first.
 */
export function MailDisabledNotice(): React.ReactElement {
  const t = useTranslations('app.settings.members');

  return (
    <div className="flex gap-2.5 rounded-md border border-border bg-muted px-3 py-2.5">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warning" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-body font-strong text-foreground">{t('mailDisabledTitle')}</p>
        <p className="text-small text-muted-foreground">{t('mailDisabledBody')}</p>
        {/* `noreferrer` with `_blank` is the usual pairing, and the new tab is deliberate: the
            reader is mid-task on this screen and the destination is a setup guide they will
            come back from. */}
        <a
          href={SMTP_SETUP_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-small text-signature underline underline-offset-4"
        >
          {t('mailDisabledDocs')}
        </a>
      </div>
    </div>
  );
}
