import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { LabelDto, WorkspaceMemberDto } from '@kurul/shared-types';
import { MemberRole, Priority } from '@kurul/shared-types';
import type { BoardTaskFilters } from '@/lib/task-query';
import messages from '@/messages/en.json';
import { BoardFilters } from './board-filters';

const AYSE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';
const LABEL_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d61';

const members: WorkspaceMemberDto[] = [
  {
    id: 'm1',
    workspaceId: 'ws-1',
    userId: AYSE_ID,
    role: MemberRole.MEMBER,
    name: 'Ayşe Yıldız',
    avatarUrl: null,
  },
];

const labels: LabelDto[] = [{ id: LABEL_ID, boardId: 'b1', name: 'Bug', color: 'slot-1' }];

function renderFilters(filters: BoardTaskFilters = {}, boardLabels: LabelDto[] = labels) {
  const onChange = vi.fn<(next: BoardTaskFilters) => void>();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BoardFilters filters={filters} members={members} labels={boardLabels} onChange={onChange} />
    </NextIntlClientProvider>,
  );
  return { onChange };
}

/** Radix opens the menu from the keyboard, which is also the path jsdom can drive. */
function openMenu(): void {
  fireEvent.keyDown(screen.getByRole('button', { name: /Filters/ }), { key: 'Enter' });
}

function searchBox(): HTMLInputElement {
  return screen.getByLabelText('Search tasks');
}

beforeAll(() => {
  // Radix Popper measures its content; jsdom ships neither of these.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  Element.prototype.scrollIntoView ??= vi.fn();
});

afterEach(() => {
  cleanup();
});

describe('BoardFilters search', () => {
  it('commits the trimmed query on Enter', () => {
    const { onChange } = renderFilters({ priority: [Priority.HIGH] });

    fireEvent.change(searchBox(), { target: { value: '  login bug  ' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(searchBox(), { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith({ priority: [Priority.HIGH], q: 'login bug' });
  });

  it('commits on blur and drops an emptied query', () => {
    const { onChange } = renderFilters({ q: 'login' });

    fireEvent.change(searchBox(), { target: { value: '   ' } });
    fireEvent.blur(searchBox());

    expect(onChange).toHaveBeenCalledWith({ q: undefined });
  });

  it('follows the committed query when it changes outside the box', () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BoardFilters
          filters={{ q: 'login' }}
          members={members}
          labels={labels}
          onChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(searchBox().value).toBe('login');

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BoardFilters filters={{}} members={members} labels={labels} onChange={vi.fn()} />
      </NextIntlClientProvider>,
    );

    expect(searchBox().value).toBe('');
  });

  it('keeps focus in the box when the committed query catches up', () => {
    // Re-seeding the draft must not remount the input: the user is still in it after
    // pressing Enter, and a remount would drop focus and the caret.
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BoardFilters filters={{}} members={members} labels={labels} onChange={vi.fn()} />
      </NextIntlClientProvider>,
    );
    const before = searchBox();
    before.focus();
    fireEvent.change(before, { target: { value: 'login' } });
    fireEvent.keyDown(before, { key: 'Enter' });

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BoardFilters
          filters={{ q: 'login' }}
          members={members}
          labels={labels}
          onChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(searchBox()).toBe(before);
    expect(document.activeElement).toBe(searchBox());
    expect(searchBox().value).toBe('login');
  });

  it('keeps a half-typed draft across a re-render that does not change the query', () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BoardFilters
          filters={{ q: 'login' }}
          members={members}
          labels={labels}
          onChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.change(searchBox(), { target: { value: 'login bu' } });

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BoardFilters
          filters={{ q: 'login' }}
          members={members}
          labels={labels}
          onChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(searchBox().value).toBe('login bu');
  });

  it('focuses the box when "/" is pressed on the page', () => {
    renderFilters();

    fireEvent.keyDown(document.body, { key: '/' });

    expect(document.activeElement).toBe(searchBox());
  });

  it('leaves "/" alone while another field has focus', () => {
    renderFilters();
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();

    try {
      fireEvent.keyDown(textarea, { key: '/' });
      expect(document.activeElement).toBe(textarea);
    } finally {
      textarea.remove();
    }
  });

  it('ignores "/" pressed as part of a shortcut', () => {
    renderFilters();

    fireEvent.keyDown(document.body, { key: '/', metaKey: true });

    expect(document.activeElement).not.toBe(searchBox());
  });
});

describe('BoardFilters menu', () => {
  it('counts the active filters on the trigger', () => {
    renderFilters({ q: 'bug', priority: [Priority.HIGH, Priority.LOW], dueDateNull: true });

    expect(screen.getByRole('button', { name: /Filters/ }).textContent).toContain('4');
  });

  it('adds and removes a priority', () => {
    const { onChange } = renderFilters({ priority: [Priority.HIGH] });
    openMenu();

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Low' }));
    expect(onChange).toHaveBeenLastCalledWith({ priority: [Priority.HIGH, Priority.LOW] });

    // Picking an option closes the menu, as it did before the split.
    openMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'High' }));
    expect(onChange).toHaveBeenLastCalledWith({ priority: undefined });
  });

  it('filters by member and by the unassigned bucket', () => {
    const { onChange } = renderFilters();
    openMenu();

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Unassigned' }));
    expect(onChange).toHaveBeenLastCalledWith({ assigneeId: ['null'] });

    openMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Ayşe Yıldız' }));
    expect(onChange).toHaveBeenLastCalledWith({ assigneeId: [AYSE_ID] });
  });

  it('offers the board labels, or says there are none', () => {
    const { onChange } = renderFilters();
    openMenu();

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Bug' }));
    expect(onChange).toHaveBeenLastCalledWith({ labelId: [LABEL_ID] });

    cleanup();
    renderFilters({}, []);
    openMenu();
    expect(screen.getByText('No labels on this board')).toBeTruthy();
  });

  it('replaces a due-date range with the overdue preset', () => {
    const { onChange } = renderFilters({ dueDateGte: '2026-01-01T00:00:00.000Z' });
    openMenu();

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Overdue' }));

    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next?.dueDateGte).toBeUndefined();
    expect(next?.dueDateNull).toBeUndefined();
    expect(typeof next?.dueDateLte).toBe('string');
  });

  it('shows which due-date preset is on and clears it when unchecked', () => {
    const { onChange } = renderFilters({ dueDateNull: true });
    openMenu();

    const noDueDate = screen.getByRole('menuitemcheckbox', { name: 'No due date' });
    expect(noDueDate.getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Overdue' }).getAttribute('aria-checked'),
    ).toBe('false');

    fireEvent.click(noDueDate);

    expect(onChange).toHaveBeenLastCalledWith({
      dueDateNull: undefined,
      dueDateGte: undefined,
      dueDateLte: undefined,
    });
  });

  it('offers "clear filters" only while something is active', () => {
    renderFilters();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Clear filters' })).toBeNull();

    cleanup();
    const { onChange } = renderFilters({ q: 'bug' });
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear filters' }));

    expect(onChange).toHaveBeenLastCalledWith({});
  });
});

describe('BoardFilters chips', () => {
  it('stays out of the way when nothing is filtered', () => {
    renderFilters();

    expect(screen.queryByRole('button', { name: /Remove filter/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('names every active filter, resolving ids to names', () => {
    renderFilters({
      q: 'login',
      priority: [Priority.HIGH],
      assigneeId: ['null', AYSE_ID],
      labelId: [LABEL_ID],
      dueDateNull: true,
    });

    const chips = screen
      .getAllByRole('button', { name: /Remove filter/ })
      .map((chip) => chip.textContent);

    expect(chips).toEqual([
      'Search: loginRemove filter Search: login',
      'HighRemove filter High',
      'UnassignedRemove filter Unassigned',
      'Ayşe YıldızRemove filter Ayşe Yıldız',
      'BugRemove filter Bug',
      'No due dateRemove filter No due date',
    ]);
  });

  it('falls back to the raw id when the member or label is unknown', () => {
    renderFilters({ assigneeId: ['ghost-user'], labelId: ['ghost-label'] });

    expect(screen.getByRole('button', { name: /Remove filter ghost-user/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Remove filter ghost-label/ })).toBeTruthy();
  });

  it('removes only the chip that was clicked', () => {
    const { onChange } = renderFilters({
      q: 'login',
      priority: [Priority.HIGH, Priority.LOW],
    });

    fireEvent.click(screen.getByRole('button', { name: /Remove filter Low/ }));

    expect(onChange).toHaveBeenCalledWith({ q: 'login', priority: [Priority.HIGH] });
  });

  it('clears the due-date trio from a single chip', () => {
    const { onChange } = renderFilters({
      dueDateGte: '2026-01-01T00:00:00.000Z',
      dueDateLte: '2026-02-01T00:00:00.000Z',
    });

    fireEvent.click(screen.getByRole('button', { name: /Remove filter Due date range/ }));

    expect(onChange).toHaveBeenCalledWith({
      dueDateNull: undefined,
      dueDateGte: undefined,
      dueDateLte: undefined,
    });
  });

  it('resets everything from the chip row', () => {
    const { onChange } = renderFilters({ q: 'login', priority: [Priority.HIGH] });

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(onChange).toHaveBeenCalledWith({});
  });

  it('reaches the chips with the keyboard', () => {
    const { onChange } = renderFilters({ priority: [Priority.HIGH] });
    const chip = screen.getByRole('button', { name: /Remove filter High/ });

    chip.focus();
    expect(document.activeElement).toBe(chip);
    // A native button, so Enter activates it without a key handler of its own.
    fireEvent.click(chip);

    expect(onChange).toHaveBeenCalledWith({ priority: undefined });
  });
});
