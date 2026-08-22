'use client';

import { useCallback, useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DemoConfigDto } from '@kurul/shared-types';
import { fetchInstanceConfig } from '@/lib/instance-config';

/**
 * The standing notice that this deployment throws everything away on a timer.
 *
 * ## Why a strip above the whole shell
 *
 * `docs/design.md` §6 reserves the persistent topbar strip for a condition that changes what
 * work in progress means, and the offline row is its example: "changes won't save". A demo
 * reset is the same promise broken on a schedule instead of a connection, and it is true on
 * every screen, so it belongs above the sidebar and the page rather than inside one of them.
 * `MailDisabledNotice` deliberately did *not* take this slot, and its reasoning holds in
 * reverse here: that condition breaks one screen's task, this one breaks all of them.
 *
 * ## Why it can be dismissed, and why the dismissal expires
 *
 * A strip a visitor cannot close would sit across the top of every screenshot anyone takes of
 * the demo, which is most of what a demo is for. But it must not be dismissible *forever*
 * either: it is the only warning a person gets before an hour of their typing disappears.
 * `sessionStorage`, not `localStorage`, splits the difference exactly - the notice goes away
 * for as long as this tab is open and comes back on the next visit, which is also the next
 * time the data they left behind will already be gone.
 *
 * Storage access is wrapped: a browser with site data blocked throws on read, and a banner
 * that takes the app down with it would be worse than one that cannot be dismissed.
 *
 * ## Why it fetches on its own
 *
 * `fetchInstanceConfig` is documented as per-screen rather than hoisted into a provider, and
 * this is a second screen, not a reason to build one: the document is small, the value changes
 * only when the server restarts, and a failed fetch renders nothing at all. An instance that is
 * not a demo pays one request per shell mount and shows nothing.
 *
 * `demo.enabled` is the API's answer and the client never second-guesses it. The actions a
 * demo refuses are refused by the API (`DemoRestrictedGuard`); nothing here hides a button.
 */
const DISMISSED_KEY = 'kurul.demo-banner-dismissed';

/** An hour reads as "every hour", any other cadence as a number of minutes. */
const HOURLY_MINUTES = 60;

/**
 * `window` itself is undefined during a server render, and the `ReferenceError` that produces
 * lands in the same `catch` as a browser with site data blocked. Both answers are "not
 * dismissed", which is the safe direction: the worst case is a notice somebody sees twice.
 */
function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function DemoBanner(): React.ReactElement | null {
  const t = useTranslations('app.demo');
  const [demo, setDemo] = useState<DemoConfigDto | null>(null);
  // A lazy initialiser rather than an effect: reading it in an effect means a second render for
  // a value that never changes on its own, and there is nothing to hydrate around because the
  // banner renders `null` until the config request lands either way.
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    const controller = new AbortController();

    void fetchInstanceConfig({ signal: controller.signal })
      .then((config) => setDemo(config.demo))
      // Swallowed on purpose, including the 401 a just-reset session produces: the shell has
      // its own handling for a session that ended, and a toast about a banner that failed to
      // load would be noise on top of it.
      .catch(() => undefined);

    return () => controller.abort();
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // Nothing to recover: the banner is hidden for this render either way.
    }
  }, []);

  if (!demo?.enabled || dismissed) {
    return null;
  }

  const minutes = demo.resetIntervalMinutes ?? HOURLY_MINUTES;
  const message =
    minutes === HOURLY_MINUTES ? t('bannerHourly') : t('banner', { minutes: String(minutes) });

  return (
    // Not `role="alert"`: it is present on first paint and describes a standing property of the
    // deployment, so it is read in document order rather than interrupting a screen reader.
    // Colour never carries it alone (design.md §3) - the icon and the sentence say the same thing.
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-3 py-2">
      <Info className="size-4 shrink-0 text-signature" aria-hidden />
      <p className="min-w-0 flex-1 text-small text-foreground">{message}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('dismiss')}
        className="shrink-0 rounded-[var(--radius-sm)] p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
