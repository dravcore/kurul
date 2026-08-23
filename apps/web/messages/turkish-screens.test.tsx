import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import {
  NextIntlClientProvider,
  createTranslator,
  type NamespaceKeys,
  type NestedKeyOf,
} from 'next-intl';
import type { TrelloImportReportDto } from '@kurul/shared-types';
import messages from '@/messages/tr.json';
import { fetchWorkspaceBoards } from '@/lib/workspace-boards';
import { BoardList } from '@/components/board/board-list';
import { ImportReportPanel } from '@/components/board/import-report-panel';
import { DeleteAccountDialog } from '@/components/settings/delete-account-dialog';
import { TaskCommentsSection } from '@/components/task/task-comments-section';

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
  value: { activeId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00', activeRole: 'OWNER' },
}));

vi.mock('@/lib/workspace-boards', () => ({ fetchWorkspaceBoards: vi.fn() }));
vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => workspace.value,
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, postForm: vi.fn(), get: vi.fn(), delete: vi.fn() } };
});
vi.mock('@/lib/socket', () => ({ disconnectSocket: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
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
