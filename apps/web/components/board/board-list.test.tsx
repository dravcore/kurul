import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** The plan document the screen reads; every test but the ceiling ones leaves it uncapped. */
const plan = vi.hoisted(() => ({
  value: {
    limits: { seats: null as number | null, boards: null as number | null, storageBytes: null },
    usage: { seats: 1, boards: 0, storageBytes: 0 },
  },
}));

vi.mock('@/lib/workspace-boards', () => ({ fetchWorkspaceBoards: vi.fn() }));
vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => workspace.value,
}));
// Only the hook is replaced; `isAtCeiling` stays real, so these tests exercise the comparison
// the screen actually makes rather than a boolean the test decided (ADR 0032).
vi.mock('@/lib/plan-query', async () => ({
  ...(await vi.importActual<typeof import('@/lib/plan-query')>('@/lib/plan-query')),
  useWorkspacePlan: () => plan.value,
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, postForm: vi.fn(), patch: vi.fn() } };
});

const fetchBoards = vi.mocked(fetchWorkspaceBoards);
const postForm = vi.mocked(api.postForm);
const apiPatch = vi.mocked(api.patch);

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

beforeAll(() => {
  // Radix DropdownMenu measures its content; jsdom ships none of the APIs it probes for.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  Element.prototype.scrollIntoView ??= vi.fn();
});

beforeEach(() => {
  fetchBoards.mockReset();
  postForm.mockReset();
  apiPatch.mockReset();
  workspace.value = { activeId: WORKSPACE_ID, activeRole: MemberRole.ADMIN };
  plan.value = {
    limits: { seats: null, boards: null, storageBytes: null },
    usage: { seats: 1, boards: 0, storageBytes: 0 },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Radix opens its menu from the keyboard, which is also the path jsdom can drive. */
async function openBoardMenu(): Promise<void> {
  const trigger = await screen.findByRole('button', { name: messages.app.board.boardMenu });
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

async function openRenameEditor(): Promise<void> {
  await openBoardMenu();
  fireEvent.click(await screen.findByRole('menuitem', { name: messages.app.board.renameAction }));
}

const nameField = (): HTMLInputElement =>
  screen.getByLabelText(messages.app.board.name) as HTMLInputElement;
const descriptionField = (): HTMLInputElement =>
  screen.getByLabelText(messages.app.board.description) as HTMLInputElement;
const saveButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: messages.common.save }) as HTMLButtonElement;

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

  describe('single primary action in zero-board state', () => {
    it('shows exactly one create button in the empty state', async () => {
      fetchBoards.mockResolvedValue([]);
      renderList();

      await screen.findByText(messages.app.board.emptyTitle);
      const createButtons = screen.queryAllByRole('button', {
        name: messages.app.board.createAction,
      });
      expect(createButtons).toHaveLength(1);
    });

    it('hides the empty state and shows the header create button when there are boards', async () => {
      fetchBoards.mockResolvedValue([board('b1')]);
      renderList();

      await screen.findByText('Board b1');
      expect(screen.queryByText(messages.app.board.emptyTitle)).toBeNull();
    });
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

describe('BoardList - the board ceiling (ADR 0032)', () => {
  it('leaves the create control enabled when nothing caps boards', async () => {
    fetchBoards.mockResolvedValue([board('b1')]);
    plan.value = {
      limits: { seats: null, boards: null, storageBytes: null },
      usage: { seats: 1, boards: 40, storageBytes: 0 },
    };

    renderList();

    const create = await screen.findByRole('button', { name: messages.app.board.createAction });
    expect(create.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/boards its plan allows/i)).toBeNull();
  });

  it('disables the create control at the ceiling and says which number was reached', async () => {
    fetchBoards.mockResolvedValue([board('b1'), board('b2')]);
    plan.value = {
      limits: { seats: null, boards: 2, storageBytes: null },
      usage: { seats: 1, boards: 2, storageBytes: 0 },
    };

    renderList();

    const create = await screen.findByRole('button', { name: messages.app.board.createAction });
    expect(create.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/all 2 of the boards its plan allows/i)).toBeDefined();
  });

  it('disables the create control in the empty state too, so the ceiling is not a dead end', async () => {
    fetchBoards.mockResolvedValue([]);
    plan.value = {
      limits: { seats: null, boards: 1, storageBytes: null },
      usage: { seats: 1, boards: 1, storageBytes: 0 },
    };

    renderList();

    await screen.findByText(messages.app.board.emptyTitle);
    for (const create of screen.getAllByRole('button', {
      name: messages.app.board.createAction,
    })) {
      expect(create.hasAttribute('disabled')).toBe(true);
    }
  });
});

describe('BoardList - inline rename (P7 task 6)', () => {
  function boardWithDescription(): BoardDto {
    return {
      id: 'b1',
      workspaceId: WORKSPACE_ID,
      name: 'Roadmap',
      description: 'Where the quarter lives',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as BoardDto;
  }

  beforeEach(() => {
    apiPatch.mockImplementation((_path, body) =>
      Promise.resolve({ ...boardWithDescription(), ...(body as object) } as never),
    );
  });

  it('opens the inline editor with the name selected, and keeps the named menu item', async () => {
    fetchBoards.mockResolvedValue([boardWithDescription()]);
    renderList();

    await openRenameEditor();

    const input = nameField();
    expect(input.value).toBe('Roadmap');
    // Radix's own close-focus for the menu that opened this editor lands asynchronously; the
    // editor's own focus/select has to win the race, but not necessarily on the same tick.
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Roadmap'.length);
    expect(descriptionField().value).toBe('Where the quarter lives');
    // The Link is gone while editing: an `Input` inside it would be a nested interactive
    // element, and this is also the proof Enter in the field cannot navigate.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('saves the trimmed name and description on Enter', async () => {
    fetchBoards.mockResolvedValue([boardWithDescription()]);
    renderList();
    await openRenameEditor();

    fireEvent.change(nameField(), { target: { value: '  Q3 roadmap  ' } });
    fireEvent.keyDown(nameField(), { key: 'Enter' });

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/boards/b1`, {
      name: 'Q3 roadmap',
      description: 'Where the quarter lives',
    });
    expect(await screen.findByText('Q3 roadmap')).toBeDefined();
  });

  it('saves on Enter in the description field too', async () => {
    fetchBoards.mockResolvedValue([boardWithDescription()]);
    renderList();
    await openRenameEditor();

    fireEvent.keyDown(descriptionField(), { key: 'Enter' });

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
  });

  it('saves when the Save button is clicked, the same as Enter', async () => {
    fetchBoards.mockResolvedValue([boardWithDescription()]);
    renderList();
    await openRenameEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
  });

  it('sends null rather than an empty description', async () => {
    fetchBoards.mockResolvedValue([boardWithDescription()]);
    renderList();
    await openRenameEditor();

    fireEvent.change(descriptionField(), { target: { value: '   ' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith(expect.any(String), {
      name: 'Roadmap',
      description: null,
    });
  });

  it('restores the old name and sends nothing when Enter is pressed with an empty name', async () => {
    fetchBoards.mockResolvedValue([boardWithDescription()]);
    renderList();
    await openRenameEditor();

    fireEvent.change(nameField(), { target: { value: '   ' } });
    fireEvent.keyDown(nameField(), { key: 'Enter' });

    expect(apiPatch).not.toHaveBeenCalled();
    expect(await screen.findByText('Roadmap')).toBeDefined();
  });

  it('cancels on Escape without saving, restoring the original values', async () => {
    fetchBoards.mockResolvedValue([boardWithDescription()]);
    renderList();
    await openRenameEditor();

    fireEvent.change(nameField(), { target: { value: 'Half-typed' } });
    fireEvent.keyDown(nameField(), { key: 'Escape' });

    expect(apiPatch).not.toHaveBeenCalled();
    expect(await screen.findByText('Roadmap')).toBeDefined();
    expect(screen.queryByText('Half-typed')).toBeNull();
  });

  it('returns focus to the menu trigger after a save', async () => {
    fetchBoards.mockResolvedValue([boardWithDescription()]);
    renderList();
    const trigger = await screen.findByRole('button', { name: messages.app.board.boardMenu });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: messages.app.board.renameAction }));

    fireEvent.click(saveButton());

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('returns focus to the menu trigger after a cancel', async () => {
    fetchBoards.mockResolvedValue([boardWithDescription()]);
    renderList();
    const trigger = await screen.findByRole('button', { name: messages.app.board.boardMenu });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: messages.app.board.renameAction }));

    fireEvent.keyDown(nameField(), { key: 'Escape' });

    expect(document.activeElement).toBe(trigger);
  });

  it('shows the failure inline and keeps the editor open', async () => {
    apiPatch.mockRejectedValue(new Error('boom'));
    fetchBoards.mockResolvedValue([boardWithDescription()]);
    renderList();
    await openRenameEditor();

    fireEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(nameField()).toBeDefined();
  });
});
