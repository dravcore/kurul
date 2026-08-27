import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { DemoConfigDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { fetchInstanceConfig } from '@/lib/instance-config';
import { DemoBanner } from './demo-banner';

vi.mock('@/lib/instance-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/instance-config')>()),
  fetchInstanceConfig: vi.fn(),
}));

const loadConfig = vi.mocked(fetchInstanceConfig);
const copy = messages.app.demo;

function resolveWith(demo: DemoConfigDto): void {
  loadConfig.mockResolvedValue({
    mailEnabled: false,
    attachmentsEnabled: false,
    signUpEnabled: true,
    demo,
    // Nothing here reads the ceilings; the banner needs the document to be complete, not capped.
    planLimits: {
      seatsPerWorkspace: null,
      boardsPerWorkspace: null,
      workspaces: null,
      users: null,
      storageBytesPerWorkspace: null,
      storageBytesPerInstance: null,
    },
  });
}

function renderBanner(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DemoBanner />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  loadConfig.mockReset();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('DemoBanner', () => {
  it('renders nothing on an instance that is not a demo', async () => {
    resolveWith({ enabled: false, resetIntervalMinutes: null, nextResetAt: null });

    renderBanner();

    await waitFor(() => expect(loadConfig).toHaveBeenCalled());
    expect(screen.queryByText(copy.bannerHourly)).toBeNull();
  });

  /**
   * The wording is the point, not just the presence: this sentence is the only warning a
   * visitor gets before an hour of their typing disappears.
   */
  it('says the data is deleted every hour on an hourly demo', async () => {
    resolveWith({
      enabled: true,
      resetIntervalMinutes: 60,
      nextResetAt: '2026-08-22T15:00:00.000Z',
    });

    renderBanner();

    expect(await screen.findByText(copy.bannerHourly)).toBeTruthy();
  });

  /** A demo on any other cadence must not claim "every hour" — the number comes from the API. */
  it('names the interval in minutes when it is not an hour', async () => {
    resolveWith({
      enabled: true,
      resetIntervalMinutes: 15,
      nextResetAt: '2026-08-22T15:00:00.000Z',
    });

    renderBanner();

    expect(await screen.findByText(copy.banner.replace('{minutes}', '15'))).toBeTruthy();
  });

  /**
   * Dismissal is per browser session on purpose (`sessionStorage`, not `localStorage`), so the
   * notice comes back on the next visit — which is also the next visit whose data is already
   * gone. This pins the storage key's *scope*, which is the decision, not the key's spelling.
   */
  it('stays hidden for the rest of the session once dismissed', async () => {
    resolveWith({
      enabled: true,
      resetIntervalMinutes: 60,
      nextResetAt: '2026-08-22T15:00:00.000Z',
    });

    renderBanner();
    const dismiss = await screen.findByRole('button', { name: copy.dismiss });
    dismiss.click();

    await waitFor(() => expect(screen.queryByText(copy.bannerHourly)).toBeNull());

    cleanup();
    renderBanner();
    await waitFor(() => expect(loadConfig).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(copy.bannerHourly)).toBeNull();
  });

  /**
   * `app/globals.css` draws the one focus mark for every keyboard-reachable control in
   * `@layer base`; a `focus-visible:outline-*` utility here would restate it and, being in a
   * later layer, silently win with a value that only happens to match today.
   */
  it('leaves the dismiss control to the one focus mark app/globals.css draws', async () => {
    resolveWith({
      enabled: true,
      resetIntervalMinutes: 60,
      nextResetAt: '2026-08-22T15:00:00.000Z',
    });

    renderBanner();
    const dismiss = await screen.findByRole('button', { name: copy.dismiss });

    expect(dismiss.className).not.toMatch(/focus-visible:outline/);
  });

  /**
   * A reset deletes every session, so the first request after one is a 401. The shell owns the
   * redirect to sign-in; the banner must not turn that into a second, louder failure.
   */
  it('renders nothing when the config request fails', async () => {
    loadConfig.mockRejectedValue(new Error('Unauthorized'));

    renderBanner();

    await waitFor(() => expect(loadConfig).toHaveBeenCalled());
    expect(screen.queryByText(copy.bannerHourly)).toBeNull();
  });
});
