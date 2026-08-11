'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MailCheck } from 'lucide-react';
import { VERIFY_EMAIL_RESEND_PATH } from '@/components/auth/verify-email-view';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth';
import { cn } from '@/lib/utils';

/**
 * The way into email confirmation for someone who never got — or lost — the first link.
 *
 * Until this existed, asking for another confirmation link required already holding a pending
 * invitation, which is exactly backwards: the invitation is the thing an unconfirmed address
 * cannot accept (`docs/decisions/0013-invitation-email-verification.md`).
 *
 * Deliberately *not* a persistent topbar strip. `docs/design.md` §6 reserves that surface for
 * states that break the work in progress ("You're offline. Changes won't save…"); an
 * unconfirmed address breaks nothing on a board. So this reads as an available action rather
 * than a warning: it lives with the other account-level controls at the foot of the sidebar,
 * wears the same quiet ghost treatment as sign out, carries no status color, and disappears
 * the moment the address is confirmed.
 */
export function EmailVerificationLink({
  collapsed,
}: Readonly<{ collapsed: boolean }>): React.ReactElement | null {
  const t = useTranslations('app.shell');
  const { data: session } = authClient.useSession();

  // Shown only for a session that positively says the address is unconfirmed. A pending or
  // absent session is not evidence of anything, and a control that fades in under the pointer
  // is worse than one that arrives a beat late.
  if (session?.user.emailVerified !== false) {
    return null;
  }

  const label = t('verifyEmail');

  return (
    <Button
      asChild
      variant="ghost"
      className={cn(
        'mb-1 w-full justify-start gap-2 text-foreground-secondary',
        collapsed && 'justify-center px-0',
      )}
    >
      {/* Collapsed, the icon is the whole control, so the name has to come from `aria-label`;
          expanded, the visible text already names it and a second name would only be noise. */}
      <Link
        href={VERIFY_EMAIL_RESEND_PATH}
        title={label}
        aria-label={collapsed ? label : undefined}
      >
        <MailCheck className="size-4" />
        {!collapsed ? label : null}
      </Link>
    </Button>
  );
}
