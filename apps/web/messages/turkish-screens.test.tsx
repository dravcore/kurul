import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  NextIntlClientProvider,
  createTranslator,
  type NamespaceKeys,
  type NestedKeyOf,
} from 'next-intl';
import { DndContext } from '@dnd-kit/core';
import { toast } from 'sonner';
import {
  ColumnCategory,
  MemberRole,
  NotificationType,
  Priority,
  TrelloImportScope,
  TrelloImportSkipReason,
  type ActivityDto,
  type BoardDto,
  type ColumnDto,
  type CreatedPersonalAccessTokenDto,
  type InvitationDto,
  type NotificationDto,
  type PersonalAccessTokenDto,
  type TaskDto,
  type TrelloImportReportDto,
  type WorkspaceDto,
  type WorkspaceMemberDto,
} from '@kurul/shared-types';
import english from '@/messages/en.json';
import messages from '@/messages/tr.json';
import { ApiError, api } from '@/lib/api';
import { fetchAllWorkspaceMembers, fetchPendingInvitations } from '@/lib/member-query';
import { fetchWorkspaceBoards } from '@/lib/workspace-boards';
import { Toaster } from '@/components/ui/sonner';
import { EmailVerificationLink } from '@/components/auth/email-verification-link';
import { ForgotPasswordView } from '@/components/auth/forgot-password-view';
import { LoginView } from '@/components/auth/login-view';
import { VerifyEmailView } from '@/components/auth/verify-email-view';
import { BoardColumn } from '@/components/board/board-column';
import { BoardList } from '@/components/board/board-list';
import { BoardColumnsEmptyState } from '@/components/board/board-placeholders';
import { ColumnSettingsDialog } from '@/components/board/column-settings-dialog';
import { ImportReportPanel } from '@/components/board/import-report-panel';
import { ImportTrelloDialog } from '@/components/board/import-trello-dialog';
import { RenameBoardDialog } from '@/components/board/rename-board-dialog';
import { AssigneeChart } from '@/components/dashboard/assignee-chart';
import { ChartTableToggle } from '@/components/dashboard/chart-table-toggle';
import { ColumnChart } from '@/components/dashboard/column-chart';
import { DashboardSummary } from '@/components/dashboard/dashboard-summary';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { NotificationUnreadProvider } from '@/components/notification/notification-unread-provider';
import { NotificationsList } from '@/components/notification/notifications-list';
import { CreateTokenDialog } from '@/components/settings/create-token-dialog';
import { DeleteAccountDialog } from '@/components/settings/delete-account-dialog';
import { InviteMemberDialog } from '@/components/settings/invite-member-dialog';
import { MembersSettings } from '@/components/settings/members-settings';
import { RemoveMemberDialog } from '@/components/settings/remove-member-dialog';
import { RenameWorkspaceDialog } from '@/components/settings/rename-workspace-dialog';
import { RevokeTokenDialog } from '@/components/settings/revoke-token-dialog';
import { TokenCreatedDialog } from '@/components/settings/token-created-dialog';
import { TokenSettings } from '@/components/settings/token-settings';
import { AttachmentAddLink } from '@/components/task/attachment-add-link';
import { SortableTaskCard } from '@/components/task/sortable-task-card';
import { TaskActivitySection } from '@/components/task/task-activity-section';
import { TaskCommentsSection } from '@/components/task/task-comments-section';
import { TaskPropertiesPanel } from '@/components/task/task-properties-panel';
import type { UseTaskMetadataResult } from '@/components/task/use-task-metadata';

/**
 * Renders real screens against `tr.json`.
 *
 * `catalog.test.ts` proves the Turkish catalogue has every key and every argument. It cannot
 * prove that what comes out the other side is a sentence: an ICU message can be complete,
 * key-for-key identical to English, and still throw at render time or format a number the way
 * another language would. Turkish is where that matters more than usual — its plural rule has
 * one form where English has two, and its thousands separator is the character English uses
 * for the decimal point.
 *
 * Deliberately a small set of screens rather than a sweep: the point is that the pipeline
 * (provider → catalogue → ICU → DOM) works in Turkish, which one screen per shape establishes.
 */
type Namespace = NamespaceKeys<typeof messages, NestedKeyOf<typeof messages>>;

vi.mock('next-intl/server', () => ({
  getTranslations: (namespace: Namespace) =>
    Promise.resolve(createTranslator({ locale: 'tr', messages, namespace })),
}));

// `vi.hoisted` runs before imports, so the role is spelled out rather than read off the
// `MemberRole` enum this file imports.
const workspace = vi.hoisted(() => ({
  value: {
    activeId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00',
    activeRole: 'OWNER',
    bootstrapped: true,
    workspaces: [] as unknown[],
    onSwitch: vi.fn(),
    onSignOut: vi.fn(),
  },
}));

/** Better Auth's client, as the screens below see it. Every field is set per case. */
const auth = vi.hoisted(() => ({
  session: { data: null, isPending: false } as {
    data: { user: { id: string; email: string; emailVerified: boolean } } | null;
    isPending: boolean;
  },
  sendVerificationEmail: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  getInvitation: vi.fn(),
  setActive: vi.fn(),
}));

const nav = vi.hoisted(() => ({
  pathname: '/dashboard',
  searchParams: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

/**
 * The shared read `TaskPanel` hands to its properties and discussion sections. What the section
 * below *writes* is what the case drives.
 *
 * One frozen object rather than a fresh one per render: the section holds these across renders.
 */
const taskMeta = {
  members: [],
  boardLabels: [],
  setBoardLabels: vi.fn(),
  comments: [],
  setComments: vi.fn(),
  hasMoreComments: false,
  loadingMoreComments: false,
  loadMoreComments: vi.fn().mockResolvedValue(undefined),
  activities: [],
  refreshActivities: vi.fn().mockResolvedValue(undefined),
  loadingMeta: false,
  metaFailed: false,
} satisfies UseTaskMetadataResult;

vi.mock('@/lib/workspace-boards', () => ({ fetchWorkspaceBoards: vi.fn() }));
vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => workspace.value,
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      postForm: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});
vi.mock('@/lib/socket', () => ({ disconnectSocket: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: nav.refresh }),
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.searchParams,
}));
vi.mock('@/lib/auth', () => ({
  authClient: {
    useSession: () => auth.session,
    sendVerificationEmail: auth.sendVerificationEmail,
    requestPasswordReset: auth.requestPasswordReset,
    resetPassword: auth.resetPassword,
    organization: { getInvitation: auth.getInvitation, setActive: auth.setActive },
  },
}));
// Only the two roster fetches are replaced; `member-permissions` and the rest of the module
// stay real, so the screen decides what it draws the way the app does.
vi.mock('@/lib/member-query', async () => {
  const actual = await vi.importActual<typeof import('@/lib/member-query')>('@/lib/member-query');
  return { ...actual, fetchAllWorkspaceMembers: vi.fn(), fetchPendingInvitations: vi.fn() };
});
vi.mock('@/components/notification/use-notification-socket', () => ({
  useNotificationSocket: () => ({ connected: true }),
}));
// The bell needs the unread context the shell provides; the sidebar case below is about the
// collapse control's label, not about the bell.
vi.mock('@/components/notification/notification-bell', () => ({
  NotificationBell: (): React.ReactElement => <div data-testid="notification-bell" />,
}));

const fetchBoards = vi.mocked(fetchWorkspaceBoards);

function tr(children: React.ReactNode): React.ReactElement {
  return (
    <NextIntlClientProvider locale="tr" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

const REPORT: TrelloImportReportDto = {
  boardId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10',
  boardName: 'Product roadmap',
  imported: { columns: 8, tasks: 124, labels: 6, checklists: 0, checklistItems: 0, attachments: 0 },
  skipped: [{ scope: 'card', reason: 'archived', count: 2000, samples: [] }],
};

beforeEach(() => {
  fetchBoards.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the Turkish interface', () => {
  it('renders the board empty state in Turkish', async () => {
    fetchBoards.mockResolvedValue([]);
    // The screen also reads its plan ceilings (ADR 0032). An unconfigured workspace has none,
    // which is the state that leaves the create control enabled.
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({
      limits: { seats: null, boards: null, storageBytes: null },
      usage: { seats: 1, boards: 0, storageBytes: 0 },
    });

    render(tr(<BoardList />));

    await waitFor(() => {
      expect(screen.getByText(messages.app.board.emptyTitle)).toBeDefined();
    });
    expect(screen.getByText(messages.app.board.emptyBody)).toBeDefined();
    // The primary action, and the shortest slot on the screen.
    expect(
      screen.getAllByRole('button', { name: messages.app.board.createAction }).length,
    ).toBeGreaterThan(0);
  });

  it('renders a Trello import report in Turkish, with Turkish plural and number forms', async () => {
    render(tr(<ImportReportPanel report={REPORT} onDismiss={vi.fn()} />));

    const region = screen.getByRole('region', { name: messages.app.board.import.reportRegion });

    // One plural form, not two: Turkish does not inflect a noun after a numeral, so `124 task`
    // is correct and `124 task'lar` is not. This is the assertion that would fail if the
    // English shape had been copied across.
    expect(within(region).getByText('124 task')).toBeDefined();
    expect(within(region).getByText('8 column')).toBeDefined();

    // `#` is formatted by the active locale: 2000 groups with a dot in Turkish, not a comma.
    expect(within(region).getByText(/2\.000 kart/)).toBeDefined();
  });

  /**
   * The account-deletion dialog, and it is here rather than only in its own spec because both
   * of its sentences are ICU plurals over a count — `retained` and `ownedWorkspace` — which is
   * exactly the shape `catalog.test.ts` can prove complete and cannot prove renders.
   */
  it('renders the account-deletion dialog in Turkish, with Turkish plural forms', async () => {
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({
      userId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d20',
      soleOwnedWorkspaces: [
        {
          workspaceId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d21',
          name: 'Kurul',
          slug: 'kurul',
          memberCount: 4,
          boardCount: 2,
          transferCandidates: [],
        },
      ],
      otherWorkspaces: [],
      retainedContent: { comments: 3, tasksCreated: 2, attachments: 0, activities: 9 },
    } as never);

    render(tr(<DeleteAccountDialog open onOpenChange={vi.fn()} email="ada@example.com" />));

    await waitFor(() => {
      expect(screen.getByText(messages.app.settings.account.ownedTitle)).toBeDefined();
    });

    // One plural form, not two: Turkish does not inflect a noun after a numeral, so `4 üye`
    // is correct and `4 üyeler` is not.
    expect(screen.getByText(/4 üye, 2 board/)).toBeDefined();
    expect(screen.getByText(/3 yorum/)).toBeDefined();
    // The "there is nobody to hand this to" line, which is the branch that decides whether
    // deletion is the only option this dialog can offer.
    expect(screen.getByText(messages.app.settings.account.ownedNobodyLeft)).toBeDefined();
  });

  /**
   * The hole this test exists to keep closed, and it is a different door into the one the rest
   * of this file guards.
   *
   * A deleted account's `User.name` holds the English string `Deleted user`, because the
   * database is what an API consumer that is not this app reads. Rendering it verbatim would put
   * two English words in the middle of a Turkish comment thread — and it would only ever be
   * found by a user, because it appears exclusively after somebody has actually left.
   */
  it('calls a deleted comment author by a Turkish name, not by the stored English one', () => {
    render(
      tr(
        <TaskCommentsSection
          comments={[
            {
              id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d30',
              taskId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d31',
              userId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d32',
              body: 'Bu karta bakmıştım',
              createdAt: '2026-01-01T00:00:00.000Z',
              author: {
                id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d32',
                name: 'Deleted user',
                avatarUrl: null,
                deleted: true,
              },
            },
          ]}
          members={[]}
          canMutate={false}
          pending={false}
          loading={false}
          onSubmit={vi.fn().mockResolvedValue(true)}
          onDelete={vi.fn()}
        />,
      ),
    );

    expect(screen.getByText(messages.common.deletedUser)).toBeDefined();
    expect(screen.queryByText('Deleted user')).toBeNull();
    // The comment itself survives, which is the half that makes this anonymisation rather than
    // deleting somebody else's conversation.
    expect(screen.getByText('Bu karta bakmıştım')).toBeDefined();
  });

  it('renders the not-found page in Turkish', async () => {
    const { default: NotFound } = await import('@/app/not-found');

    render(tr(await NotFound()));

    expect(screen.getByRole('heading', { name: messages.app.errors.notFoundTitle })).toBeDefined();
    expect(
      screen.getByRole('link', { name: messages.app.errors.backHome }).getAttribute('href'),
    ).toBe('/dashboard');
  });
});

/* ------------------------------------------------------------------------------------------ */

/**
 * The fifty longest Turkish strings, and the screen each one is drawn on.
 *
 * Measured rather than assumed. `docs/design.md` §7 tells a layout to assume a translation up
 * to 35% longer than the English it was built against; the Turkish catalogue clears that on
 * average (+5.5%) and does not clear it in the tail (p90 +47.6%, max +183.3% at
 * `app.settings.tokens.expiryLabel`, "Expiry" against "Geçerlilik süresi"). So the risk is not
 * the average string, it is the tail, and the tail is what this section pins.
 *
 * The list is written out rather than computed on the fly on purpose: a reviewer has to be able
 * to read which strings were checked and where. `is the list this file writes down` recomputes
 * the same cut from the two catalogues and asserts the two agree, so a Turkish string that grows
 * past the cut fails here instead of quietly landing on a screen nobody re-measured.
 *
 * What a jsdom render can and cannot prove: it lays nothing out, so there is no width, no line
 * box and no overflow to measure, and the phase's browser pass is where clipping is finally
 * seen. What it can prove is that the whole Turkish string reaches the DOM of the screen that
 * shows it, and that is what every case below asserts. Nothing here needed the "cannot be
 * mounted" escape: the three keys that live on a toast are read off a real `Toaster`, and the
 * four that only appear while a route streams are read off the very `Suspense` fallback the
 * page hands React.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');

function flatten(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === 'object') {
      Object.assign(out, flatten(child as Record<string, unknown>, full));
    } else {
      out[full] = String(child);
    }
  }
  return out;
}

/**
 * The cut this file is built on: per-key `tr.length / en.length` over the raw ICU strings, the
 * keys strictly above the 90th percentile of that ratio, and the fifty longest Turkish strings
 * among them.
 *
 * Nearest-rank for the percentile and a codepoint tie-break on the key, so the answer does not
 * move with the host's collation.
 */
function longestAboveP90(count: number): Array<{ key: string; ratio: number }> {
  const en = flatten(english as unknown as Record<string, unknown>);
  const tr = flatten(messages as unknown as Record<string, unknown>);
  const rows = Object.keys(en)
    .filter((key) => key in tr)
    .map((key) => ({
      key,
      tr: tr[key] as string,
      ratio: (tr[key] as string).length / (en[key] as string).length,
    }));

  const ratios = rows.map((row) => row.ratio).sort((a, b) => a - b);
  const p90 = ratios[Math.ceil(0.9 * ratios.length) - 1] as number;

  return rows
    .filter((row) => row.ratio > p90)
    .sort((a, b) => b.tr.length - a.tr.length || (a.key < b.key ? -1 : 1))
    .slice(0, count)
    .map((row) => ({ key: row.key, ratio: Math.round(row.ratio * 100) / 100 }));
}

interface LongString {
  /** Catalogue key path. */
  key: string;
  /** The file that puts this string on screen, and the file a case below renders it through. */
  screen: string;
  /**
   * `tr.length / en.length`, rounded to two decimals, computed the same way `longestAboveP90`
   * computes it. Carried here so a reader sees why a short key still sits on this tail list.
   */
  ratio: number;
}

/** Longest Turkish string first; ties broken by key. Checked against the catalogues below. */
const LONGEST_TURKISH: readonly LongString[] = [
  {
    key: 'app.settings.workspace.renameErrorForbidden',
    screen: 'components/settings/rename-workspace-dialog.tsx',
    ratio: 1.54,
  },
  {
    key: 'app.board.task.labelForbidden',
    screen: 'components/task/task-properties-panel.tsx',
    ratio: 1.5,
  },
  {
    key: 'app.board.column.forbidden',
    screen: 'components/board/board-placeholders.tsx',
    ratio: 1.56,
  },
  {
    key: 'app.board.import.forbidden',
    screen: 'components/board/import-trello-dialog.tsx',
    ratio: 1.48,
  },
  {
    key: 'app.settings.members.inviteErrorForbidden',
    screen: 'components/settings/invite-member-dialog.tsx',
    ratio: 1.47,
  },
  {
    key: 'app.settings.members.changeRoleErrorForbidden',
    screen: 'components/settings/members-settings.tsx',
    ratio: 1.47,
  },
  { key: 'auth.login.subtitle', screen: 'components/auth/login-view.tsx', ratio: 1.48 },
  {
    key: 'app.board.import.setColumnCategories',
    screen: 'components/board/import-report-panel.tsx',
    ratio: 1.69,
  },
  {
    key: 'app.settings.members.seatUsage',
    screen: 'components/settings/members-settings.tsx',
    ratio: 1.57,
  },
  {
    key: 'app.notifications.types.mention',
    screen: 'components/notification/notifications-list.tsx',
    ratio: 1.55,
  },
  {
    key: 'app.dashboard.emptyTitle',
    screen: 'components/dashboard/dashboard-summary.tsx',
    ratio: 1.55,
  },
  {
    key: 'app.notifications.types.dueSoon',
    screen: 'components/notification/notifications-list.tsx',
    ratio: 1.58,
  },
  {
    key: 'app.board.column.useDefaults',
    screen: 'components/board/board-placeholders.tsx',
    ratio: 1.53,
  },
  {
    key: 'app.shell.confirmEmail',
    screen: 'components/auth/email-verification-link.tsx',
    ratio: 1.61,
  },
  { key: 'auth.confirmEmail.loading', screen: 'app/(auth)/verify-email/page.tsx', ratio: 1.53 },
  {
    key: 'auth.confirmEmail.pendingTitle',
    screen: 'components/auth/verify-email-view.tsx',
    ratio: 1.61,
  },
  { key: 'auth.resetPassword.loading', screen: 'app/(auth)/reset-password/page.tsx', ratio: 1.53 },
  {
    key: 'app.settings.tokens.createdAt',
    screen: 'components/settings/token-settings.tsx',
    ratio: 2.0,
  },
  {
    key: 'app.settings.tokens.expiresAt',
    screen: 'components/settings/token-settings.tsx',
    ratio: 2.0,
  },
  {
    key: 'app.settings.tokens.revokeTitle',
    screen: 'components/settings/revoke-token-dialog.tsx',
    ratio: 1.56,
  },
  {
    key: 'app.settings.workspace.renameTitle',
    screen: 'components/settings/rename-workspace-dialog.tsx',
    ratio: 1.75,
  },
  {
    key: 'app.dashboard.assigneeTitle',
    screen: 'components/dashboard/assignee-chart.tsx',
    ratio: 1.59,
  },
  {
    key: 'app.settings.members.copiedLink',
    screen: 'components/settings/members-settings.tsx',
    ratio: 1.5,
  },
  {
    key: 'auth.forgotPassword.submit',
    screen: 'components/auth/forgot-password-view.tsx',
    ratio: 1.8,
  },
  { key: 'app.board.column.emptyDrop', screen: 'components/board/board-column.tsx', ratio: 1.56 },
  {
    key: 'app.board.task.dragHandle',
    screen: 'components/task/sortable-task-card.tsx',
    ratio: 1.67,
  },
  { key: 'app.board.renameTitle', screen: 'components/board/rename-board-dialog.tsx', ratio: 2.0 },
  { key: 'auth.login.loading', screen: 'app/(auth)/login/page.tsx', ratio: 1.5 },
  { key: 'auth.register.loading', screen: 'app/(auth)/register/page.tsx', ratio: 1.5 },
  {
    key: 'app.dashboard.viewChart',
    screen: 'components/dashboard/chart-table-toggle.tsx',
    ratio: 1.77,
  },
  { key: 'app.shell.expandSidebar', screen: 'components/layout/app-sidebar.tsx', ratio: 1.64 },
  {
    key: 'app.dashboard.columnTitle',
    screen: 'components/dashboard/column-chart.tsx',
    ratio: 1.47,
  },
  {
    key: 'app.dashboard.viewTable',
    screen: 'components/dashboard/chart-table-toggle.tsx',
    ratio: 1.69,
  },
  {
    key: 'app.notifications.markAllRead',
    screen: 'components/notification/notifications-list.tsx',
    ratio: 1.69,
  },
  {
    key: 'app.board.column.settingsAction',
    screen: 'components/board/column-settings-dialog.tsx',
    ratio: 1.75,
  },
  {
    key: 'app.notifications.unreadOnly',
    screen: 'components/notification/notifications-list.tsx',
    ratio: 1.91,
  },
  {
    key: 'app.settings.members.removeTitle',
    screen: 'components/settings/remove-member-dialog.tsx',
    ratio: 1.5,
  },
  {
    key: 'app.settings.members.copyLink',
    screen: 'components/settings/members-settings.tsx',
    ratio: 2.0,
  },
  {
    key: 'app.settings.tokens.copied',
    screen: 'components/settings/token-created-dialog.tsx',
    ratio: 1.5,
  },
  { key: 'common.deletedUser', screen: 'components/task/task-activity-section.tsx', ratio: 1.5 },
  {
    key: 'app.notifications.typeDueSoon',
    screen: 'components/notification/notifications-list.tsx',
    ratio: 2.13,
  },
  {
    key: 'app.settings.tokens.expiryLabel',
    screen: 'components/settings/create-token-dialog.tsx',
    ratio: 2.83,
  },
  {
    key: 'app.board.renameAction',
    screen: 'components/board/rename-board-dialog.tsx',
    ratio: 2.67,
  },
  {
    key: 'app.notifications.loadMore',
    screen: 'components/notification/notifications-list.tsx',
    ratio: 1.78,
  },
  {
    key: 'app.settings.tokens.lastUsedNever',
    screen: 'components/settings/token-settings.tsx',
    ratio: 1.6,
  },
  {
    key: 'app.settings.workspace.renameAction',
    screen: 'components/settings/rename-workspace-dialog.tsx',
    ratio: 2.67,
  },
  {
    key: 'app.board.task.attachments.linkUrl',
    screen: 'components/task/attachment-add-link.tsx',
    ratio: 1.88,
  },
  {
    key: 'auth.confirmEmail.registerLink',
    screen: 'components/auth/verify-email-view.tsx',
    ratio: 1.5,
  },
  { key: 'auth.login.registerLink', screen: 'components/auth/login-view.tsx', ratio: 1.5 },
  {
    key: 'app.board.column.categoryOption.CANCELED',
    screen: 'components/board/column-settings-dialog.tsx',
    ratio: 1.5,
  },
];

/**
 * Which of those screens clip anything at all.
 *
 * Only one of the fifty sits on a clipping element: the token row's meta line. Everywhere else
 * the ellipsis is over user data, where the length of a Turkish catalogue string cannot make it
 * worse. `truncate and line-clamp are only where this file recorded them` re-derives this from
 * the sources, so a new `truncate` landing on any of the fifty screens fails rather than passing
 * unread.
 *
 * `messages/en.json` and `messages/tr.json` were deliberately not edited by this pass: no string
 * on the list above was found clipped.
 */
const CLIPPING_SCREENS: readonly string[] = [
  'components/board/board-column.tsx', // the column name, which is user data
  'components/settings/members-settings.tsx', // a member name and an invited address, both user data
  // the token name (user data) and the meta line, which carries app.settings.tokens.createdAt,
  // .lastUsedNever and .expiresAt
  'components/settings/token-settings.tsx',
  'components/task/sortable-task-card.tsx', // the task title in the drag preview, which is user data
];

/** Fills the simple `{name}` placeholders of an ICU message, so expectations stay derived. */
function fill(message: string, values: Readonly<Record<string, string | number>>): string {
  return message.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/** Like `tr`, plus the toast surface the root layout mounts outside every screen. */
function trToasts(children: React.ReactNode): React.ReactElement {
  return tr(
    <>
      {children}
      <Toaster />
    </>,
  );
}

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d11';
const COLUMN_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d12';
const USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d13';

const apiGet = vi.mocked(api.get);
const apiPost = vi.mocked(api.post);
const apiPatch = vi.mocked(api.patch);
const apiDelete = vi.mocked(api.delete);
const apiPostForm = vi.mocked(api.postForm);
const loadMembers = vi.mocked(fetchAllWorkspaceMembers);
const loadInvitations = vi.mocked(fetchPendingInvitations);

/** A 403 from the API, so `resolveApiMessage` picks the same copy the app would. */
function forbidden(): ApiError {
  return new ApiError({
    statusCode: 403,
    error: 'Forbidden',
    message: 'server wording, never shown',
  });
}

/** Routes `api.get` by path prefix; longest-lived first, so a prefix cannot shadow a sibling. */
function routeGet(routes: ReadonlyArray<readonly [string, unknown]>): void {
  apiGet.mockImplementation((requested: string) => {
    for (const [prefix, body] of routes) {
      if (requested.startsWith(prefix)) return Promise.resolve(body as never);
    }
    return Promise.reject(new Error(`no route for GET ${requested}`)) as never;
  });
}

const EMPTY_SUMMARY = {
  totalTasks: 0,
  overdueCount: 0,
  byPriority: [],
  byAssignee: [],
  byColumn: null,
  throughput: [],
};

/** The same screen with work on it: picker, tiles and the four charts instead of the empty mark. */
const BUSY_SUMMARY = {
  totalTasks: 12,
  overdueCount: 2,
  byPriority: [{ priority: Priority.HIGH, count: 4 }],
  byAssignee: [{ userId: USER_ID, name: 'Ayla', count: 3 }],
  byColumn: [{ columnId: COLUMN_ID, name: 'Beklemede', position: 1000, count: 5 }],
  throughput: [{ date: '2026-08-01', created: 2, completed: 1 }],
};

const WORKSPACE: WorkspaceDto = {
  id: WORKSPACE_ID,
  name: 'Kurul',
  slug: 'kurul',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const BOARD = {
  id: BOARD_ID,
  workspaceId: WORKSPACE_ID,
  name: 'Yol haritası',
  description: null,
} as BoardDto;

const COLUMN: ColumnDto = {
  id: COLUMN_ID,
  boardId: BOARD_ID,
  name: 'Beklemede',
  position: 1000,
  color: null,
  category: ColumnCategory.BACKLOG,
  taskCount: 0,
};

const TASK: TaskDto = {
  id: TASK_ID,
  boardId: BOARD_ID,
  columnId: COLUMN_ID,
  title: 'Socket bağlantısını kur',
  description: null,
  position: 1000,
  priority: Priority.MEDIUM,
  dueDate: null,
  estimatedMinutes: null,
  assignees: [],
  labels: [],
  checklistSummary: { total: 0, done: 0 },
  checklists: null,
  attachmentCount: 0,
  createdById: USER_ID,
  createdAt: '2026-08-12T09:00:00.000Z',
  updatedAt: '2026-08-12T09:00:00.000Z',
};

const MEMBER: WorkspaceMemberDto = {
  id: `membership-${USER_ID}`,
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  role: MemberRole.OWNER,
  name: 'Ayla',
  avatarUrl: null,
};

const INVITATION: InvitationDto = {
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d20',
  workspaceId: WORKSPACE_ID,
  email: 'bora@example.com',
  role: MemberRole.MEMBER,
  status: 'pending',
  expiresAt: '2099-01-01T00:00:00.000Z',
  acceptUrl: 'https://kurul.test/invite/0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d20',
};

const TOKEN_CREATED_AT = '2026-08-01T00:00:00.000Z';
const TOKEN_EXPIRES_AT = '2026-12-01T00:00:00.000Z';

const TOKEN: PersonalAccessTokenDto = {
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d30',
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  name: 'CI anahtarı',
  prefix: 'kurul_pat_abc',
  lastUsedAt: null,
  expiresAt: TOKEN_EXPIRES_AT,
  createdAt: TOKEN_CREATED_AT,
};

/** Same format `TokenSettings` builds its dates with, for the same locale the provider sets. */
function trDate(iso: string): string {
  return new Intl.DateTimeFormat('tr', { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(iso),
  );
}

function notification(id: string, type: NotificationDto['type']): NotificationDto {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    type,
    taskId: TASK_ID,
    activityId: null,
    payload: { title: 'Socket bağlantısını kur', boardId: BOARD_ID },
    readAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * The element a page hands React while its client half streams.
 *
 * jsdom resolves that child before a fallback would ever paint, so the fallback is rendered
 * directly. It is still the page's own element, built by the page's own translator.
 */
function suspenseFallback(page: React.ReactElement): React.ReactNode {
  const { fallback } = page.props as { fallback?: React.ReactNode };
  expect(fallback).toBeDefined();
  return fallback;
}

interface ScreenCheck {
  /** Matches the `screen` of every key it covers. */
  screen: string;
  keys: readonly string[];
  run: () => void | Promise<void>;
}

const SCREEN_CHECKS: readonly ScreenCheck[] = [
  {
    screen: 'components/board/board-placeholders.tsx',
    keys: ['app.board.column.useDefaults', 'app.board.column.forbidden'],
    run: () => {
      const props = { defaultsPending: false, onCreateColumn: vi.fn(), onSeedDefaults: vi.fn() };
      render(tr(<BoardColumnsEmptyState canMutateColumns {...props} />));
      expect(
        screen.getByRole('button', { name: messages.app.board.column.useDefaults }),
      ).toBeDefined();

      cleanup();
      render(tr(<BoardColumnsEmptyState canMutateColumns={false} {...props} />));
      expect(screen.getByText(messages.app.board.column.forbidden)).toBeDefined();
    },
  },
  {
    screen: 'components/settings/rename-workspace-dialog.tsx',
    keys: [
      'app.settings.workspace.renameTitle',
      'app.settings.workspace.renameAction',
      'app.settings.workspace.renameErrorForbidden',
    ],
    run: async () => {
      apiPatch.mockRejectedValue(forbidden());
      render(
        tr(
          <RenameWorkspaceDialog
            open
            onOpenChange={vi.fn()}
            workspace={WORKSPACE}
            onRenamed={vi.fn()}
          />,
        ),
      );

      expect(
        screen.getByRole('heading', { name: messages.app.settings.workspace.renameTitle }),
      ).toBeDefined();
      fireEvent.click(
        screen.getByRole('button', { name: messages.app.settings.workspace.renameAction }),
      );

      // The longest string in the catalogue, and it lands in a dialog narrower than the screen.
      await waitFor(() => {
        expect(
          screen.getByText(messages.app.settings.workspace.renameErrorForbidden),
        ).toBeDefined();
      });
    },
  },
  {
    screen: 'components/task/task-properties-panel.tsx',
    keys: ['app.board.task.labelForbidden'],
    run: async () => {
      apiPost.mockRejectedValue(forbidden());
      render(
        trToasts(
          <TaskPropertiesPanel
            workspaceId={WORKSPACE_ID}
            boardId={BOARD_ID}
            task={TASK}
            canMutate
            canManageLabels
            meta={taskMeta}
            onUpdated={vi.fn()}
          />,
        ),
      );

      fireEvent.change(screen.getByLabelText(messages.app.board.task.newLabel), {
        target: { value: 'Acil' },
      });
      fireEvent.click(screen.getByRole('button', { name: messages.app.board.task.createLabel }));

      await waitFor(() => {
        expect(screen.getByText(messages.app.board.task.labelForbidden)).toBeDefined();
      });
    },
  },
  {
    screen: 'components/board/import-report-panel.tsx',
    keys: ['app.board.import.setColumnCategories'],
    run: () => {
      const report: TrelloImportReportDto = {
        boardId: BOARD_ID,
        boardName: 'Yol haritası',
        imported: {
          columns: 8,
          tasks: 12,
          labels: 0,
          checklists: 0,
          checklistItems: 0,
          attachments: 0,
        },
        skipped: [
          {
            scope: TrelloImportScope.Column,
            reason: TrelloImportSkipReason.Defaulted,
            count: 8,
            samples: [],
          },
        ],
      };
      render(tr(<ImportReportPanel report={report} onDismiss={vi.fn()} />));

      expect(
        screen.getByRole('link', { name: messages.app.board.import.setColumnCategories }),
      ).toBeDefined();
    },
  },
  {
    screen: 'components/board/import-trello-dialog.tsx',
    keys: ['app.board.import.forbidden'],
    run: async () => {
      apiPostForm.mockRejectedValue(
        new ApiError({ statusCode: 403, error: 'Forbidden', message: 'forbidden' }),
      );
      render(
        tr(
          <ImportTrelloDialog
            open
            onOpenChange={vi.fn()}
            workspaceId={WORKSPACE_ID}
            onImported={vi.fn()}
          />,
        ),
      );

      const file = new File(['{}'], 'trello.json', { type: 'application/json' });
      fireEvent.change(screen.getByLabelText(messages.app.board.import.file), {
        target: { files: [file] },
      });
      fireEvent.click(screen.getByRole('button', { name: messages.app.board.import.submit }));

      expect(await screen.findByText(messages.app.board.import.forbidden)).toBeDefined();
    },
  },
  {
    screen: 'components/settings/members-settings.tsx',
    keys: [
      'app.settings.members.seatUsage',
      'app.settings.members.copyLink',
      'app.settings.members.copiedLink',
      'app.settings.members.changeRoleErrorForbidden',
    ],
    run: async () => {
      auth.session = {
        data: { user: { id: USER_ID, email: 'ayla@example.com', emailVerified: true } },
        isPending: false,
      };
      const bora: WorkspaceMemberDto = {
        id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d21',
        workspaceId: WORKSPACE_ID,
        userId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d22',
        role: MemberRole.MEMBER,
        name: 'Bora',
        avatarUrl: null,
      };
      loadMembers.mockResolvedValue([MEMBER, bora]);
      loadInvitations.mockResolvedValue([INVITATION]);
      apiPatch.mockRejectedValue(forbidden());
      routeGet([
        ['/config', { mailEnabled: true }],
        [
          `/workspaces/${WORKSPACE_ID}/plan`,
          {
            limits: { seats: 5, boards: null, storageBytes: null },
            usage: { seats: 3, boards: 0, storageBytes: 0 },
          },
        ],
      ]);

      render(trToasts(<MembersSettings />));

      await waitFor(() => {
        expect(
          screen.getByText(fill(messages.app.settings.members.seatUsage, { used: 3, limit: 5 })),
        ).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: messages.app.settings.members.copyLink }));

      // The toast surface lives in the root layout, so it is mounted beside the screen here.
      await waitFor(() => {
        expect(screen.getByText(messages.app.settings.members.copiedLink)).toBeDefined();
      });

      // The roster row's own inline role control, and the one failure copy this case's
      // happy-path assertions above never exercise.
      const row = screen.getByText('Bora').closest('li');
      if (!row) throw new Error('no row for Bora');
      fireEvent.change(within(row).getByLabelText(messages.app.settings.members.inviteRole), {
        target: { value: MemberRole.ADMIN },
      });

      expect(
        await screen.findByText(messages.app.settings.members.changeRoleErrorForbidden),
      ).toBeDefined();
    },
  },
  {
    screen: 'components/notification/notifications-list.tsx',
    keys: [
      'app.notifications.types.mention',
      'app.notifications.types.dueSoon',
      'app.notifications.markAllRead',
      'app.notifications.unreadOnly',
      'app.notifications.typeDueSoon',
      'app.notifications.loadMore',
    ],
    run: async () => {
      routeGet([
        [`/workspaces/${WORKSPACE_ID}/notifications/unread-count`, { count: 2 }],
        [
          `/workspaces/${WORKSPACE_ID}/notifications`,
          {
            items: [
              notification('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d40', NotificationType.Mention),
              notification('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d41', NotificationType.DueSoon),
            ],
            nextCursor: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d41',
          },
        ],
      ]);

      render(
        tr(
          <NotificationUnreadProvider>
            <NotificationsList />
          </NotificationUnreadProvider>,
        ),
      );

      const title = { title: TASK.title };
      await waitFor(() => {
        expect(
          screen.getByText(fill(messages.app.notifications.types.mention, title)),
        ).toBeDefined();
      });
      expect(screen.getByText(fill(messages.app.notifications.types.dueSoon, title))).toBeDefined();
      expect(screen.getByText(messages.app.notifications.unreadOnly)).toBeDefined();
      expect(
        screen.getByRole('button', { name: messages.app.notifications.markAllRead }),
      ).toBeDefined();
      expect(
        screen.getByRole('button', { name: messages.app.notifications.loadMore }),
      ).toBeDefined();
      expect(
        screen.getByRole('option', { name: messages.app.notifications.typeDueSoon }),
      ).toBeDefined();
    },
  },
  {
    screen: 'components/dashboard/dashboard-summary.tsx',
    keys: ['app.dashboard.emptyTitle'],
    run: async () => {
      fetchBoards.mockResolvedValue([BOARD]);
      routeGet([[`/workspaces/${WORKSPACE_ID}/dashboard/summary`, EMPTY_SUMMARY]]);

      render(tr(<DashboardSummary />));

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: messages.app.dashboard.emptyTitle }),
        ).toBeDefined();
      });

      // The other branch of the same screen, because the empty mark is not where a Turkish
      // dashboard is long: the picker, the two tiles and the four chart headings are.
      cleanup();
      routeGet([[`/workspaces/${WORKSPACE_ID}/dashboard/summary`, BUSY_SUMMARY]]);
      render(tr(<DashboardSummary />));

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: messages.app.dashboard.overviewTitle }),
        ).toBeDefined();
      });
      expect(screen.getByText(messages.app.dashboard.totalTasks)).toBeDefined();
      expect(screen.getByText(messages.app.dashboard.overdue)).toBeDefined();

      // Picking a board rewrites the query the rest of the screen reads itself from.
      const picker = screen.getByLabelText(messages.app.dashboard.boardFilter);
      expect(
        within(picker).getByRole('option', { name: messages.app.dashboard.allBoards }),
      ).toBeDefined();
      fireEvent.change(picker, { target: { value: BOARD_ID } });
      await waitFor(() => {
        expect(nav.replace).toHaveBeenCalledWith(`/dashboard?boardId=${BOARD_ID}`, {
          scroll: false,
        });
      });
    },
  },
  {
    screen: 'components/dashboard/assignee-chart.tsx',
    keys: ['app.dashboard.assigneeTitle'],
    run: () => {
      render(tr(<AssigneeChart data={[{ userId: USER_ID, name: 'Ayla', count: 3 }]} />));

      expect(
        screen.getByRole('heading', { name: messages.app.dashboard.assigneeTitle }),
      ).toBeDefined();
    },
  },
  {
    screen: 'components/dashboard/column-chart.tsx',
    keys: ['app.dashboard.columnTitle'],
    run: () => {
      render(
        tr(
          <ColumnChart
            data={[{ columnId: COLUMN_ID, name: 'Yapılacak', position: 1000, count: 3 }]}
          />,
        ),
      );

      expect(
        screen.getByRole('heading', { name: messages.app.dashboard.columnTitle }),
      ).toBeDefined();
    },
  },
  {
    screen: 'components/dashboard/chart-table-toggle.tsx',
    keys: ['app.dashboard.viewTable', 'app.dashboard.viewChart'],
    run: () => {
      render(
        tr(
          <ChartTableToggle
            title="Grafik"
            chart={<div data-testid="chart" />}
            columns={['Ad']}
            rows={[['Ayla']]}
          />,
        ),
      );

      const toggle = screen.getByRole('button', { name: messages.app.dashboard.viewTable });
      fireEvent.click(toggle);
      expect(screen.getByRole('button', { name: messages.app.dashboard.viewChart })).toBeDefined();
    },
  },
  {
    screen: 'components/settings/token-settings.tsx',
    keys: [
      'app.settings.tokens.createdAt',
      'app.settings.tokens.expiresAt',
      'app.settings.tokens.lastUsedNever',
    ],
    run: async () => {
      routeGet([[`/workspaces/${WORKSPACE_ID}/tokens`, [TOKEN]]]);

      render(tr(<TokenSettings />));

      const created = fill(messages.app.settings.tokens.createdAt, {
        when: trDate(TOKEN_CREATED_AT),
      });
      const expires = fill(messages.app.settings.tokens.expiresAt, {
        when: trDate(TOKEN_EXPIRES_AT),
      });
      const never = messages.app.settings.tokens.lastUsedNever;

      await waitFor(() => {
        expect(screen.getByText(created)).toBeDefined();
      });

      // The one clipping element among the fifty. It is a `flex flex-wrap` row, so `truncate`
      // has no inline content to put an ellipsis on and the four facts wrap onto a second line
      // rather than being cut. What `overflow-hidden` can still take is a single span wider
      // than the row, which is the one thing the browser pass has to look at here and the one
      // thing jsdom cannot answer. All three Turkish strings stay whole in the DOM.
      const meta = screen.getByText(created).closest('p');
      expect(meta?.className).toContain('truncate');
      expect(meta?.textContent).toContain(created);
      expect(meta?.textContent).toContain(never);
      expect(meta?.textContent).toContain(expires);
    },
  },
  {
    screen: 'components/settings/create-token-dialog.tsx',
    keys: ['app.settings.tokens.expiryLabel'],
    run: () => {
      render(
        tr(
          <CreateTokenDialog
            open
            onOpenChange={vi.fn()}
            workspaceId={WORKSPACE_ID}
            onCreated={vi.fn()}
          />,
        ),
      );

      // The catalogue's widest gap: "Expiry" against "Geçerlilik süresi", +183%.
      expect(screen.getByLabelText(messages.app.settings.tokens.expiryLabel)).toBeDefined();
    },
  },
  {
    screen: 'components/settings/revoke-token-dialog.tsx',
    keys: ['app.settings.tokens.revokeTitle'],
    run: () => {
      render(
        tr(
          <RevokeTokenDialog
            open
            onOpenChange={vi.fn()}
            workspaceId={WORKSPACE_ID}
            token={TOKEN}
            onRevoked={vi.fn()}
          />,
        ),
      );

      expect(
        screen.getByRole('heading', { name: messages.app.settings.tokens.revokeTitle }),
      ).toBeDefined();
    },
  },
  {
    screen: 'components/settings/token-created-dialog.tsx',
    keys: ['app.settings.tokens.copied'],
    run: async () => {
      const created: CreatedPersonalAccessTokenDto = { ...TOKEN, token: 'kurul_pat_abc.secret' };
      render(trToasts(<TokenCreatedDialog open onOpenChange={vi.fn()} token={created} />));

      fireEvent.click(
        screen.getByRole('button', { name: messages.app.settings.tokens.copyAction }),
      );

      await waitFor(() => {
        expect(screen.getByText(messages.app.settings.tokens.copied)).toBeDefined();
      });
    },
  },
  {
    screen: 'components/settings/remove-member-dialog.tsx',
    keys: ['app.settings.members.removeTitle'],
    run: () => {
      render(
        tr(
          <RemoveMemberDialog
            open
            onOpenChange={vi.fn()}
            workspaceId={WORKSPACE_ID}
            member={MEMBER}
            onRemoved={vi.fn()}
          />,
        ),
      );

      expect(
        screen.getByRole('heading', {
          name: fill(messages.app.settings.members.removeTitle, { name: MEMBER.name }),
        }),
      ).toBeDefined();
    },
  },
  {
    screen: 'components/board/rename-board-dialog.tsx',
    keys: ['app.board.renameTitle', 'app.board.renameAction'],
    run: () => {
      render(
        tr(
          <RenameBoardDialog
            open
            onOpenChange={vi.fn()}
            workspaceId={WORKSPACE_ID}
            board={BOARD}
            onRenamed={vi.fn()}
          />,
        ),
      );

      expect(screen.getByRole('heading', { name: messages.app.board.renameTitle })).toBeDefined();
      expect(screen.getByRole('button', { name: messages.app.board.renameAction })).toBeDefined();
    },
  },
  {
    screen: 'components/board/board-column.tsx',
    keys: ['app.board.column.emptyDrop'],
    run: () => {
      render(
        tr(
          <DndContext>
            <BoardColumn
              column={COLUMN}
              tasks={[]}
              boardId={BOARD_ID}
              workspaceId={WORKSPACE_ID}
              selectedTaskId={null}
              dropIndicatorIndex={null}
              headingTabbable
              canMutateColumns
              canMutateTasks
              canMoveLeft={false}
              canMoveRight={false}
              onOpenSettings={vi.fn()}
              onDelete={vi.fn()}
              onMoveLeft={vi.fn()}
              onMoveRight={vi.fn()}
              composerOpen={false}
              composerFocusNonce={0}
              onComposerOpenChange={vi.fn()}
              onTaskCreated={vi.fn()}
            />
          </DndContext>,
        ),
      );

      expect(screen.getByText(messages.app.board.column.emptyDrop)).toBeDefined();
    },
  },
  {
    screen: 'components/task/sortable-task-card.tsx',
    keys: ['app.board.task.dragHandle'],
    run: () => {
      render(
        tr(
          <DndContext>
            <SortableTaskCard task={TASK} boardId={BOARD_ID} />
          </DndContext>,
        ),
      );

      expect(
        screen.getByRole('button', {
          name: fill(messages.app.board.task.dragHandle, { title: TASK.title }),
        }),
      ).toBeDefined();
    },
  },
  {
    screen: 'components/board/column-settings-dialog.tsx',
    keys: ['app.board.column.settingsAction', 'app.board.column.categoryOption.CANCELED'],
    run: () => {
      render(
        tr(
          <ColumnSettingsDialog
            open
            onOpenChange={vi.fn()}
            workspaceId={WORKSPACE_ID}
            column={COLUMN}
            onSaved={vi.fn()}
          />,
        ),
      );

      expect(
        screen.getByRole('button', { name: messages.app.board.column.settingsAction }),
      ).toBeDefined();
      expect(
        screen.getByRole('option', { name: messages.app.board.column.categoryOption.CANCELED }),
      ).toBeDefined();
    },
  },
  {
    screen: 'components/layout/app-sidebar.tsx',
    keys: ['app.shell.expandSidebar'],
    run: () => {
      window.localStorage.clear();
      auth.session = {
        data: { user: { id: USER_ID, email: 'ayla@example.com', emailVerified: true } },
        isPending: false,
      };

      // Collapsed is the state that names the control "expand"; below 1280px it is the default.
      render(tr(<AppSidebar />));

      expect(screen.getByRole('button', { name: messages.app.shell.expandSidebar })).toBeDefined();
    },
  },
  {
    screen: 'components/auth/email-verification-link.tsx',
    keys: ['app.shell.confirmEmail'],
    run: () => {
      auth.session = {
        data: { user: { id: USER_ID, email: 'ayla@example.com', emailVerified: false } },
        isPending: false,
      };

      render(tr(<EmailVerificationLink collapsed={false} />));

      // The control is a link with a `title`, which is what a rail-width sidebar leaves of it.
      const link = screen.getByRole('link', { name: messages.app.shell.confirmEmail });
      expect(link.getAttribute('title')).toBe(messages.app.shell.confirmEmail);
    },
  },
  {
    screen: 'components/auth/verify-email-view.tsx',
    keys: ['auth.confirmEmail.pendingTitle', 'auth.confirmEmail.registerLink'],
    run: () => {
      auth.session = {
        data: { user: { id: USER_ID, email: 'ayla@example.com', emailVerified: false } },
        isPending: false,
      };
      nav.searchParams = new URLSearchParams({ resend: '1' });
      render(tr(<VerifyEmailView />));
      expect(
        screen.getByRole('heading', { name: messages.auth.confirmEmail.pendingTitle }),
      ).toBeDefined();

      cleanup();
      auth.session = { data: null, isPending: false };
      nav.searchParams = new URLSearchParams({ error: 'USER_NOT_FOUND' });
      render(tr(<VerifyEmailView />));
      expect(
        screen.getByRole('link', { name: messages.auth.confirmEmail.registerLink }),
      ).toBeDefined();
    },
  },
  {
    screen: 'components/settings/invite-member-dialog.tsx',
    keys: ['app.settings.members.inviteErrorForbidden'],
    run: async () => {
      apiPost.mockRejectedValue(forbidden());
      render(
        tr(
          <InviteMemberDialog
            open
            onOpenChange={vi.fn()}
            workspaceId={WORKSPACE_ID}
            onInvited={vi.fn()}
          />,
        ),
      );

      fireEvent.change(screen.getByLabelText(messages.app.settings.members.inviteEmail), {
        target: { value: 'bora@example.com' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: messages.app.settings.members.inviteSubmit }),
      );

      expect(
        await screen.findByText(messages.app.settings.members.inviteErrorForbidden),
      ).toBeDefined();
    },
  },
  {
    screen: 'components/auth/login-view.tsx',
    keys: ['auth.login.registerLink', 'auth.login.subtitle'],
    run: () => {
      render(tr(<LoginView />));

      expect(screen.getByRole('link', { name: messages.auth.login.registerLink })).toBeDefined();
      expect(screen.getByText(messages.auth.login.subtitle)).toBeDefined();
    },
  },
  {
    screen: 'components/auth/forgot-password-view.tsx',
    keys: ['auth.forgotPassword.submit'],
    run: () => {
      render(tr(<ForgotPasswordView />));

      expect(
        screen.getByRole('button', { name: messages.auth.forgotPassword.submit }),
      ).toBeDefined();
    },
  },
  {
    screen: 'components/task/attachment-add-link.tsx',
    keys: ['app.board.task.attachments.linkUrl'],
    run: () => {
      render(tr(<AttachmentAddLink onAddLink={vi.fn().mockResolvedValue(true)} />));

      fireEvent.click(
        screen.getByRole('button', { name: messages.app.board.task.attachments.addLink }),
      );
      expect(screen.getByLabelText(messages.app.board.task.attachments.linkUrl)).toBeDefined();
    },
  },
  {
    screen: 'components/task/task-activity-section.tsx',
    keys: ['common.deletedUser'],
    run: () => {
      const activity: ActivityDto = {
        id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50',
        workspaceId: WORKSPACE_ID,
        taskId: TASK_ID,
        userId: USER_ID,
        type: 'task.created',
        payload: { title: TASK.title },
        createdAt: '2026-01-01T00:00:00.000Z',
        author: { id: USER_ID, name: 'Deleted user', avatarUrl: null, deleted: true },
      };
      render(tr(<TaskActivitySection activities={[activity]} loading={false} />));

      expect(screen.getByText(messages.common.deletedUser)).toBeDefined();
      expect(screen.queryByText('Deleted user')).toBeNull();
    },
  },
  {
    screen: 'app/(auth)/login/page.tsx',
    keys: ['auth.login.loading'],
    run: async () => {
      const { default: LoginPage } = await import('@/app/(auth)/login/page');
      render(tr(suspenseFallback(await LoginPage())));

      expect(screen.getByText(messages.auth.login.loading)).toBeDefined();
    },
  },
  {
    screen: 'app/(auth)/register/page.tsx',
    keys: ['auth.register.loading'],
    run: async () => {
      const { default: RegisterPage } = await import('@/app/(auth)/register/page');
      render(tr(suspenseFallback(await RegisterPage())));

      expect(screen.getByText(messages.auth.register.loading)).toBeDefined();
    },
  },
  {
    screen: 'app/(auth)/verify-email/page.tsx',
    keys: ['auth.confirmEmail.loading'],
    run: async () => {
      const { default: VerifyEmailPage } = await import('@/app/(auth)/verify-email/page');
      render(tr(suspenseFallback(await VerifyEmailPage())));

      expect(screen.getByText(messages.auth.confirmEmail.loading)).toBeDefined();
    },
  },
  {
    screen: 'app/(auth)/reset-password/page.tsx',
    keys: ['auth.resetPassword.loading'],
    run: async () => {
      const { default: ResetPasswordPage } = await import('@/app/(auth)/reset-password/page');
      render(tr(suspenseFallback(await ResetPasswordPage())));

      expect(screen.getByText(messages.auth.resetPassword.loading)).toBeDefined();
    },
  },
];

describe('the fifty longest Turkish strings', () => {
  beforeAll(() => {
    // Four things jsdom does not ship and the screens below ask for: Radix measures and
    // focus-traps its content, Recharts asks for a box, the sidebar and next-themes ask the
    // media query (`true` is the state that collapses the rail), and the two copy controls
    // ask for a clipboard.
    globalThis.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    Element.prototype.scrollIntoView ??= vi.fn();
    window.matchMedia ??= vi.fn().mockImplementation((query: string) => ({
      media: query,
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (): Promise<void> => Promise.resolve() },
    });
  });

  beforeEach(() => {
    workspace.value = {
      ...workspace.value,
      activeId: WORKSPACE_ID,
      activeRole: 'OWNER',
      bootstrapped: true,
      workspaces: [WORKSPACE],
    };
    auth.session = { data: null, isPending: false };
    auth.sendVerificationEmail.mockReset();
    auth.requestPasswordReset.mockReset();
    auth.resetPassword.mockReset();
    auth.getInvitation.mockReset();
    auth.setActive.mockReset().mockResolvedValue(undefined);
    nav.searchParams = new URLSearchParams();
    nav.pathname = '/dashboard';
    for (const mock of [apiGet, apiPost, apiPatch, apiDelete, apiPostForm]) mock.mockReset();
    loadMembers.mockReset().mockResolvedValue([]);
    loadInvitations.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    toast.dismiss();
  });

  // The count is written out rather than read off `LONGEST_TURKISH.length`: sizing the
  // expectation from the list under test would let a deleted row pass, which is the direction a
  // future edit is likeliest to take.
  it('is the list this file writes down', () => {
    expect(LONGEST_TURKISH).toHaveLength(50);
    expect(longestAboveP90(50)).toEqual(LONGEST_TURKISH.map(({ key, ratio }) => ({ key, ratio })));
  });

  it('truncate and line-clamp are only where this file recorded them', () => {
    const screens = Array.from(new Set(LONGEST_TURKISH.map(({ screen: file }) => file)));
    const clipping = screens
      .filter((file) =>
        /\btruncate\b|\bline-clamp-\d/.test(readFileSync(path.join(webRoot, file), 'utf8')),
      )
      .sort();

    expect(clipping).toEqual([...CLIPPING_SCREENS].sort());
  });

  it.each(SCREEN_CHECKS)('are drawn in Turkish on $screen', async ({ run }) => {
    await run();
  });

  it('has a case above for every one of the fifty', () => {
    const drawnBy = new Map<string, string>();
    for (const check of SCREEN_CHECKS) {
      for (const key of check.keys) drawnBy.set(key, check.screen);
    }

    // Two lists rather than a set difference: the failure message then names the key, the screen
    // the list claims and the screen that actually renders it.
    expect(LONGEST_TURKISH.map(({ key }) => `${key} on ${drawnBy.get(key) ?? 'nothing'}`)).toEqual(
      LONGEST_TURKISH.map(({ key, screen: file }) => `${key} on ${file}`),
    );
    expect(
      SCREEN_CHECKS.flatMap(({ keys }) => keys).filter(
        (key) => !LONGEST_TURKISH.some((entry) => entry.key === key),
      ),
    ).toEqual([]);
  });
});
