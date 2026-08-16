import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { MemberRole, type BoardDto, type TrelloImportReportDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { fetchWorkspaceBoards } from '@/lib/workspace-boards';
import { BoardList } from './board-list';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

const workspace = vi.hoisted(() => ({
  value: { activeId: '', activeRole: null as MemberRole | null },
}));

vi.mock('@/lib/workspace-boards', () => ({ fetchWorkspaceBoards: vi.fn() }));
vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => workspace.value,
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, postForm: vi.fn() } };
});

const fetchBoards = vi.mocked(fetchWorkspaceBoards);
const postForm = vi.mocked(api.postForm);

const REPORT: TrelloImportReportDto = {
  boardId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10',
  boardName: 'Product roadmap',
  imported: { columns: 8, tasks: 124, labels: 6, checklists: 0, checklistItems: 0, attachments: 0 },
  skipped: [{ scope: 'comment', reason: 'outOfScope', count: 31, samples: [] }],
};

function board(id: string): BoardDto {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    name: `Board ${id}`,
    description: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as BoardDto;
}

function renderList(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BoardList />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  fetchBoards.mockReset();
  postForm.mockReset();
  workspace.value = { activeId: WORKSPACE_ID, activeRole: MemberRole.ADMIN };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BoardList', () => {
  it('lists the boards it loaded', async () => {
    fetchBoards.mockResolvedValue([board('b1')]);
    renderList();

    expect(await screen.findByText('Board b1')).toBeDefined();
  });

  it('shows the empty state when the workspace really has no boards', async () => {
    fetchBoards.mockResolvedValue([]);
    renderList();

    expect(await screen.findByText(messages.app.board.emptyTitle)).toBeDefined();
    expect(screen.queryByText(messages.app.board.listError)).toBeNull();
  });

  it('reports a failed load', async () => {
    fetchBoards.mockRejectedValue(new Error('network'));
    renderList();

    expect(await screen.findByText(messages.app.board.listError)).toBeDefined();
  });

  it('offers a way out of a failed load, not just the news of it', async () => {
    // A load nobody explained is the retryable half of §7: the recovery has to be a control,
    // because there is nothing else on this screen for the user to press.
    fetchBoards.mockRejectedValueOnce(new Error('network'));
    renderList();

    await screen.findByText(messages.app.board.listError);
    fetchBoards.mockResolvedValue([board('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d70')]);
    fireEvent.click(screen.getByRole('button', { name: messages.app.errors.retry }));

    expect(await screen.findByText('Board 0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d70')).toBeDefined();
    expect(screen.queryByText(messages.app.board.listError)).toBeNull();
  });

  /**
   * No active workspace is a moment, not a failure: the shell resolves the roster and, when
   * it is empty, redirects to `/workspaces/new`. Answering "Your boards couldn't load." blames a
   * request that was never made — and it is the one thing on screen while the redirect runs.
   */
  it('waits rather than blaming a load when there is no active workspace yet', () => {
    workspace.value = { activeId: '', activeRole: null };
    renderList();

    expect(screen.queryByText(messages.app.board.listError)).toBeNull();
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(fetchBoards).not.toHaveBeenCalled();
  });

  it('keeps the same waiting shape while the boards are actually loading', async () => {
    fetchBoards.mockImplementation(() => new Promise(() => {}));
    renderList();

    await waitFor(() => expect(fetchBoards).toHaveBeenCalled());
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText(messages.app.board.listError)).toBeNull();
  });

  describe('Trello import', () => {
    async function openImport(): Promise<void> {
      fetchBoards.mockResolvedValue([]);
      renderList();
      fireEvent.click(
        await screen.findByRole('button', { name: messages.app.board.import.action }),
      );
    }

    function submitFixture(): void {
      const file = new File(['{}'], 'trello.json', { type: 'application/json' });
      fireEvent.change(screen.getByLabelText(messages.app.board.import.file), {
        target: { files: [file] },
      });
      fireEvent.click(screen.getByRole('button', { name: messages.app.board.import.submit }));
    }

    /** The endpoint is admin-only, so a MEMBER offered the entry would only ever get a 403. */
    it('offers the entry to an admin', async () => {
      fetchBoards.mockResolvedValue([]);
      renderList();

      expect(
        await screen.findByRole('button', { name: messages.app.board.import.action }),
      ).toBeDefined();
    });

    it('does not offer the entry to a member who could not use it', async () => {
      workspace.value = { activeId: WORKSPACE_ID, activeRole: MemberRole.MEMBER };
      fetchBoards.mockResolvedValue([]);
      renderList();

      await screen.findByText(messages.app.board.emptyTitle);
      expect(screen.queryByRole('button', { name: messages.app.board.import.action })).toBeNull();
    });

    /**
     * The whole reason this is a panel and not a toast. The report exists only in the body of
     * the `201` (ADR 0025), so anything that removes it on a timer removes the only copy — and
     * the refetch the import triggers puts this screen back into `loading`, which is the one
     * moment a panel rendered inside the settled branch would silently disappear.
     */
    it('keeps the report on screen after the import, across the refetch it triggers', async () => {
      await openImport();
      postForm.mockResolvedValue(REPORT);
      // The refetch never settles, so the list stays in its loading state for the rest of the
      // test. The report has to survive that.
      fetchBoards.mockImplementation(() => new Promise(() => {}));

      submitFixture();

      const report = await screen.findByRole('region', { name: /import report/i });
      expect(report.textContent).toContain('124 tasks');
      expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(screen.getByRole('region', { name: /import report/i })).toBeDefined();
    });

    it('shows nothing until an import has actually returned one', async () => {
      fetchBoards.mockResolvedValue([]);
      renderList();

      await screen.findByText(messages.app.board.emptyTitle);
      expect(screen.queryByRole('region', { name: /import report/i })).toBeNull();
    });

    it('removes the report only when the user dismisses it', async () => {
      await openImport();
      postForm.mockResolvedValue(REPORT);
      fetchBoards.mockResolvedValue([]);

      submitFixture();

      await screen.findByRole('region', { name: /import report/i });
      fireEvent.click(screen.getByRole('button', { name: messages.app.board.import.dismiss }));

      await waitFor(() =>
        expect(screen.queryByRole('region', { name: /import report/i })).toBeNull(),
      );
    });

    it('refetches the list so the imported board appears in it', async () => {
      await openImport();
      postForm.mockResolvedValue(REPORT);
      fetchBoards.mockResolvedValue([board('imported-1')]);

      submitFixture();

      expect(await screen.findByText('Board imported-1')).toBeDefined();
    });
  });
});
