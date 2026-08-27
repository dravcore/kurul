import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { MemberRole, type WorkspaceMemberDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import trMessages from '@/messages/tr.json';
import { INLINE_PICKER_MAX } from './searchable-picker';
import { TaskAssigneesSection } from './task-assignees-section';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1f00';

function member(index: number, name: string): WorkspaceMemberDto {
  return {
    id: `m${index + 1}`,
    workspaceId: WORKSPACE_ID,
    userId: `u${index + 1}`,
    role: MemberRole.MEMBER,
    name,
    avatarUrl: null,
  };
}

function members(count: number): WorkspaceMemberDto[] {
  return Array.from({ length: count }, (_, index) => member(index, `Member ${index + 1}`));
}

function renderMembers(
  roster: WorkspaceMemberDto[],
  { assigned = [] as string[], locale = 'en' } = {},
) {
  const onToggle = vi.fn();
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'tr' ? trMessages : messages}>
      <TaskAssigneesSection
        members={roster}
        assignedUserIds={new Set(assigned)}
        disabled={false}
        onToggle={onToggle}
      />
    </NextIntlClientProvider>,
  );
  return { onToggle };
}

function renderSection(count: number, assigned: string[] = []) {
  return renderMembers(members(count), { assigned });
}

const trigger = (): HTMLElement => screen.getByRole('button', { name: /^Assign/ });
// By role rather than by label text: the searchbox and the dialog it sits in are named
// differently now, and this helper only cares about the field.
const search = (): HTMLInputElement =>
  screen.getByRole('searchbox', {
    name: messages.app.board.task.searchMembers,
  }) as HTMLInputElement;
const rows = (): HTMLInputElement[] => screen.queryAllByRole('checkbox') as HTMLInputElement[];

function openPicker(): void {
  fireEvent.click(trigger());
}

afterEach(() => {
  cleanup();
});

/**
 * The threshold, from both sides. A small team assigns in one click, which is what an
 * unconditional popover would have cost them; a large one gets a field to type into instead of a
 * list to scroll.
 */
describe('TaskAssigneesSection under the threshold', () => {
  it(`keeps assignment one click at ${INLINE_PICKER_MAX} members`, () => {
    const { onToggle } = renderSection(INLINE_PICKER_MAX);

    expect(rows()).toHaveLength(INLINE_PICKER_MAX);
    expect(screen.queryByRole('button', { name: /^Assign/ })).toBeNull();

    fireEvent.click(screen.getByLabelText('Member 3'));

    expect(onToggle).toHaveBeenCalledWith('u3', false);
  });
});

describe('TaskAssigneesSection over the threshold', () => {
  it(`hides the list behind a searchable popover at ${INLINE_PICKER_MAX + 1} members`, () => {
    renderSection(INLINE_PICKER_MAX + 1);

    expect(rows()).toHaveLength(0);
    expect(trigger()).toBeDefined();
  });

  it('names who is already on the task next to the trigger', () => {
    renderSection(INLINE_PICKER_MAX + 1, ['u2']);

    expect(screen.getByText('Member 2')).toBeDefined();
  });

  it('draws each assigned name as its own chip, not as a run of words', () => {
    // Two names side by side in a wrapping list read as one string once either of them has a
    // space in it ("Ada Lovelace Alan Turing"), which is what the summary was before: the
    // popover took the checkbox list away and left the names with no boundary of their own.
    // The chip is the same shell the labels beside it wear (`LabelChip`), minus the dot.
    renderSection(INLINE_PICKER_MAX + 1, ['u2', 'u3']);

    const chips = [screen.getByText('Member 2'), screen.getByText('Member 3')];

    for (const chip of chips) {
      expect(chip.className).toContain('border');
      expect(chip.className).toContain('bg-muted');
      expect(chip.className).toContain('rounded-[var(--radius-sm)]');
    }
  });

  it('filters the rows as the reader types', () => {
    renderSection(INLINE_PICKER_MAX + 1);
    openPicker();

    fireEvent.change(search(), { target: { value: 'member 3' } });

    expect(rows()).toHaveLength(1);
    expect(screen.getByLabelText('Member 3')).toBeDefined();
  });

  it('says so when the query matches nobody', () => {
    renderSection(INLINE_PICKER_MAX + 1);
    openPicker();

    fireEvent.change(search(), { target: { value: 'nobody' } });

    expect(rows()).toHaveLength(0);
    expect(screen.getByText(messages.app.board.task.noMatches)).toBeDefined();
  });

  it('leaves ArrowDown alone when the query matches nobody, rather than preventing it into an empty list', () => {
    renderSection(INLINE_PICKER_MAX + 1);
    openPicker();
    fireEvent.change(search(), { target: { value: 'nobody' } });
    search().focus();

    const event = fireEvent.keyDown(search(), { key: 'ArrowDown' });

    // A cancelled event is what a native `<input type="search">` would otherwise have used for
    // its own default `ArrowDown` behaviour; there is nothing here for the picker to steal it
    // for, since there are no rows to step into.
    expect(event).toBe(true);
    expect(document.activeElement).toBe(search());
  });

  it('walks from the search field into the rows and back with the arrow keys', () => {
    renderSection(INLINE_PICKER_MAX + 1);
    openPicker();
    search().focus();

    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows()[0]);

    fireEvent.keyDown(rows()[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows()[1]);

    fireEvent.keyDown(rows()[1]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows()[0]);

    fireEvent.keyDown(rows()[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(search());
  });

  it('toggles the focused row with Enter', () => {
    const { onToggle } = renderSection(INLINE_PICKER_MAX + 1);
    openPicker();

    fireEvent.keyDown(screen.getByLabelText('Member 4'), { key: 'Enter' });

    expect(onToggle).toHaveBeenCalledWith('u4', false);
  });

  it('names the popover surface after the trigger, not the search field, so the two are not announced identically', () => {
    // Without this the reader lands in an unnamed `role="dialog"` and is told nothing about
    // what it holds; naming it the same as the search field inside it would announce both
    // controls identically the moment focus moves from one to the other.
    renderSection(INLINE_PICKER_MAX + 1);
    openPicker();

    const dialogName = messages.app.board.task.assignAction.replace('{count}', '0');
    expect(screen.getByRole('dialog', { name: dialogName })).toBeDefined();
  });

  it('leaves every row reachable as a native checkbox', () => {
    // Space, the focus ring and the checked state all come from the native control; a div-based
    // listbox would have to re-earn all three.
    renderSection(INLINE_PICKER_MAX + 1, ['u1']);
    openPicker();

    const boxes = rows();

    expect(boxes).toHaveLength(INLINE_PICKER_MAX + 1);
    expect(boxes.every((box) => box.tagName === 'INPUT')).toBe(true);
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes.every((box) => box.tabIndex >= 0)).toBe(true);
  });
});

/**
 * Turkish has two `i` letters and two `I` letters, and the pairing crosses the ASCII ones:
 * `İ` folds to `i`, `I` folds to `ı`. A locale-invariant fold breaks both directions, and it
 * breaks them silently, as an empty result the reader can only read as "nobody by that name".
 */
describe('TaskAssigneesSection filtering under tr', () => {
  const turkishRoster = [
    member(0, 'İbrahim Öz'),
    member(1, 'Işıl Kaya'),
    ...Array.from({ length: INLINE_PICKER_MAX - 1 }, (_, index) =>
      member(index + 2, `Üye ${index + 1}`),
    ),
  ];

  function openTurkishPicker(): void {
    fireEvent.click(screen.getByRole('button', { name: /^Ata/ }));
  }

  function typeQuery(value: string): void {
    fireEvent.change(
      screen.getByRole('searchbox', { name: trMessages.app.board.task.searchMembers }),
      { target: { value } },
    );
  }

  it('finds İbrahim from a dotless-typed ibrahim', () => {
    renderMembers(turkishRoster, { locale: 'tr' });
    openTurkishPicker();

    typeQuery('ibrahim');

    expect(rows()).toHaveLength(1);
    expect(screen.getByLabelText('İbrahim Öz')).toBeDefined();
  });

  it('finds Işıl from a dotless-typed ışıl', () => {
    renderMembers(turkishRoster, { locale: 'tr' });
    openTurkishPicker();

    typeQuery('ışıl');

    expect(rows()).toHaveLength(1);
    expect(screen.getByLabelText('Işıl Kaya')).toBeDefined();
  });
});
