import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { MemberRole, type WorkspaceMemberDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { INLINE_PICKER_MAX } from './searchable-picker';
import { TaskAssigneesSection } from './task-assignees-section';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1f00';

function members(count: number): WorkspaceMemberDto[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    workspaceId: WORKSPACE_ID,
    userId: `u${index + 1}`,
    role: MemberRole.MEMBER,
    name: `Member ${index + 1}`,
    avatarUrl: null,
  }));
}

function renderSection(count: number, assigned: string[] = []) {
  const onToggle = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskAssigneesSection
        members={members(count)}
        assignedUserIds={new Set(assigned)}
        disabled={false}
        onToggle={onToggle}
      />
    </NextIntlClientProvider>,
  );
  return { onToggle };
}

const trigger = (): HTMLElement => screen.getByRole('button', { name: /^Assign/ });
const search = (): HTMLInputElement =>
  screen.getByLabelText(messages.app.board.task.searchMembers) as HTMLInputElement;
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
