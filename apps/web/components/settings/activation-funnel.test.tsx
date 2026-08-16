import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import {
  ACTIVATION_EVENTS,
  ActivationEvent,
  type ActivationFunnelDto,
  type ActivationStepDto,
} from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { ApiError, api } from '@/lib/api';
import { ActivationFunnel } from './activation-funnel';

const copy = messages.app.settings.activation;

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: vi.fn() } };
});

const apiGet = vi.mocked(api.get);

function step(
  event: ActivationEvent,
  count: number,
  overrides: Partial<ActivationStepDto> = {},
): ActivationStepDto {
  return { event, count, unit: 'users', window: 'all-time', ...overrides };
}

function funnel(overrides: Partial<ActivationFunnelDto> = {}): ActivationFunnelDto {
  return {
    generatedAt: '2026-08-14T00:00:00.000Z',
    steps: [
      step(ActivationEvent.UserRegistered, 40),
      step(ActivationEvent.WorkspaceCreated, 20),
      step(ActivationEvent.BoardCreated, 18),
      step(ActivationEvent.FirstTaskCreated, 16),
      step(ActivationEvent.FirstDrag, 12),
      step(ActivationEvent.InviteSent, 6),
      step(ActivationEvent.SmtpConfigured, 1, { unit: 'instance' }),
      step(ActivationEvent.InviteAccepted, 4),
      step(ActivationEvent.DashboardViewed, 9),
      step(ActivationEvent.TaskCompleted, 7),
      step(ActivationEvent.WauBoardView, 10, { window: 'rolling-week' }),
    ],
    northStar: {
      weeklyActiveTeamWorkspaces: 3,
      weeklyActiveWorkspaces: 8,
      teamWorkspaces: 5,
      windowDays: 7,
    },
    ...overrides,
  };
}

function renderFunnel() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ActivationFunnel />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ActivationFunnel', () => {
  /**
   * The default state of every install: nobody is listed in `INSTANCE_ADMIN_EMAILS`, the API
   * answers 403, and the section must leave no trace on the settings screen — not a heading,
   * not an error, not an empty box. A heading over nothing advertises a screen the reader can
   * never open.
   */
  it('renders nothing at all when the instance refuses the request', async () => {
    apiGet.mockRejectedValue(
      new ApiError({ statusCode: 403, error: 'Forbidden', message: 'restricted' }),
    );

    const { container } = renderFunnel();

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  /** And nothing while the answer is still unknown, for the same reason. */
  it('renders nothing while the request is in flight', () => {
    apiGet.mockReturnValue(new Promise(() => {}));

    const { container } = renderFunnel();

    expect(container.textContent).toBe('');
  });

  it('asks the instance-wide route, with no workspace in the path', async () => {
    apiGet.mockResolvedValue(funnel());

    renderFunnel();

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls[0]![0]).toBe('/instance/activation');
  });

  it('lists every step the API returned, in the order it returned them', async () => {
    apiGet.mockResolvedValue(funnel());

    renderFunnel();

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(ACTIVATION_EVENTS.length);
    expect(items[0]!.textContent).toContain(copy.steps.user_registered);
    expect(items.at(-1)!.textContent).toContain(copy.steps.wau_board_view);
  });

  /**
   * The one step whose count is not a headcount. Rendering `1` beside "Outbound email" would
   * read as one person, and drawing it as a bar next to forty would read as a collapse.
   */
  it('renders the SMTP step as a state rather than a number or a bar', async () => {
    apiGet.mockResolvedValue(funnel());

    renderFunnel();

    const items = await screen.findAllByRole('listitem');
    const smtpRow = items.find((item) => item.textContent?.includes(copy.steps.smtp_configured));
    expect(smtpRow?.textContent).toContain(copy.configured);
    expect(smtpRow?.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('says so when outbound email is not configured', async () => {
    apiGet.mockResolvedValue(
      funnel({
        steps: funnel().steps.map((entry) =>
          entry.event === ActivationEvent.SmtpConfigured ? { ...entry, count: 0 } : entry,
        ),
      }),
    );

    renderFunnel();

    const items = await screen.findAllByRole('listitem');
    const smtpRow = items.find((item) => item.textContent?.includes(copy.steps.smtp_configured));
    expect(smtpRow?.textContent).toContain(copy.notConfigured);
  });

  /**
   * Bars are drawn against the widest headcount, so the first step fills its track and a step
   * at a quarter of it fills a quarter. Read off the inline style because that is the only
   * place the proportion exists — there is no accessible name to assert on, by design.
   */
  it('scales each bar against the widest headcount', async () => {
    apiGet.mockResolvedValue(funnel());

    renderFunnel();

    const items = await screen.findAllByRole('listitem');
    const widths = items.map(
      (item) =>
        (item.querySelector('[aria-hidden="true"] > div') as HTMLElement | null)?.style.width,
    );

    // 40 registered is the widest, so it is the 100% track; 20 owners is half of it.
    expect(widths[0]).toBe('100%');
    expect(widths[1]).toBe('50%');
    // The instance-unit step has no bar at all.
    expect(widths[6]).toBeUndefined();
  });

  /** An instance where nobody has signed up yet must not divide by zero and draw a NaN width. */
  it('draws no width when every step is zero', async () => {
    apiGet.mockResolvedValue(
      funnel({ steps: funnel().steps.map((entry) => ({ ...entry, count: 0 })) }),
    );

    renderFunnel();

    const items = await screen.findAllByRole('listitem');
    const first = items[0]!.querySelector('[aria-hidden="true"] > div') as HTMLElement;
    expect(first.style.width).toBe('0%');
  });

  it('leads with the North Star and the two figures that give it a scale', async () => {
    apiGet.mockResolvedValue(funnel());

    renderFunnel();

    expect(await screen.findByText(copy.northStar.activeTeams.replace('{days}', '7'))).toBeTruthy();
    expect(screen.getByText(copy.northStar.activeWorkspaces.replace('{days}', '7'))).toBeTruthy();
    expect(screen.getByText(copy.northStar.teamWorkspaces)).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  /**
   * The promise the section makes to a self-hoster reading their own settings screen. It is a
   * catalogue string rather than a comment because it is the answer to the question the funnel
   * itself provokes: "so where is this being sent?"
   */
  it('states that nothing leaves the instance', async () => {
    apiGet.mockResolvedValue(funnel());

    renderFunnel();

    expect(await screen.findByText(copy.localOnly)).toBeTruthy();
    expect(screen.getByText(copy.description)).toBeTruthy();
  });

  it('marks the one step that only covers the rolling week', async () => {
    apiGet.mockResolvedValue(funnel());

    renderFunnel();

    const items = await screen.findAllByRole('listitem');
    const suffix = copy.windowSuffix.replace('{days}', '7');
    const marked = items.filter((item) => item.textContent?.includes(suffix));
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain(copy.steps.wau_board_view);
  });
});
