import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { LabelDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { INLINE_PICKER_MAX } from './searchable-picker';
import { TaskLabelsSection } from './task-labels-section';

function boardLabels(count: number): LabelDto[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `l${index + 1}`,
    boardId: 'b1',
    name: `Label ${index + 1}`,
    color: 'slot-1' as LabelDto['color'],
  }));
}

function renderSection(
  overrides: {
    taskLabels?: LabelDto[];
    boardLabels?: LabelDto[];
    canMutate?: boolean;
    canManageLabels?: boolean;
    pending?: boolean;
  } = {},
) {
  const onCreateLabel = vi.fn().mockResolvedValue(true);
  const onToggleLabel = vi.fn();
  const onDeleteBoardLabel = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskLabelsSection
        taskLabels={overrides.taskLabels ?? []}
        boardLabels={overrides.boardLabels ?? []}
        canMutate={overrides.canMutate ?? true}
        canManageLabels={overrides.canManageLabels ?? true}
        pending={overrides.pending ?? false}
        onToggleLabel={onToggleLabel}
        onDeleteBoardLabel={onDeleteBoardLabel}
        onCreateLabel={onCreateLabel}
      />
    </NextIntlClientProvider>,
  );
  return { onCreateLabel, onToggleLabel, onDeleteBoardLabel };
}

const picker = (): HTMLSelectElement => screen.getByLabelText('Label color');

afterEach(() => {
  cleanup();
});

describe('TaskLabelsSection colour picker', () => {
  it('never shows a raw slot id to the reader', () => {
    renderSection();

    const rendered = Array.from(picker().options).map((option) => option.textContent);

    expect(rendered).toEqual([
      'Blue',
      'Orange',
      'Aqua',
      'Yellow',
      'Magenta',
      'Green',
      'Violet',
      'Red',
    ]);
    for (const text of rendered) {
      expect(text).not.toMatch(/slot-\d/);
    }
  });

  it('keeps the stored value a slot name even though the reader sees a colour', () => {
    renderSection();

    // The visible text is translated copy; the submitted value stays the design-token slot.
    expect(Array.from(picker().options).map((option) => option.value)).toEqual([
      'slot-1',
      'slot-2',
      'slot-3',
      'slot-4',
      'slot-5',
      'slot-6',
      'slot-7',
      'slot-8',
    ]);
  });

  it('creates a label with the slot behind the chosen colour name', () => {
    const { onCreateLabel } = renderSection();

    fireEvent.change(screen.getByLabelText('New label'), { target: { value: 'Research' } });
    fireEvent.change(picker(), { target: { value: 'slot-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create label' }));

    expect(onCreateLabel).toHaveBeenCalledWith('Research', 'slot-3');
  });

  it('exposes the picker as a focusable native control with an accessible name', () => {
    renderSection();

    // A native <select> is what carries the keyboard model and the focus ring; regressing to a
    // div-based listbox without re-earning both is the failure this guards.
    expect(picker().tagName).toBe('SELECT');
    expect(picker().disabled).toBe(false);
    picker().focus();
    expect(document.activeElement).toBe(picker());
  });

  it('disables the picker while a mutation is in flight', () => {
    renderSection({ pending: true });

    expect(picker().disabled).toBe(true);
  });
});

/**
 * The same threshold the assignee list uses, counted over the board's palette. Both boundaries
 * are their own case: the whole point of the number is that one side of it stays a single click.
 */
describe('TaskLabelsSection palette threshold', () => {
  const trigger = (): HTMLElement => screen.getByRole('button', { name: /^Add label/ });

  it(`keeps the palette a flat list at ${INLINE_PICKER_MAX} board labels`, () => {
    const { onToggleLabel } = renderSection({ boardLabels: boardLabels(INLINE_PICKER_MAX) });

    expect(screen.getAllByRole('checkbox')).toHaveLength(INLINE_PICKER_MAX);
    expect(screen.queryByRole('button', { name: /^Add label/ })).toBeNull();

    fireEvent.click(screen.getByLabelText('Label 3'));

    expect(onToggleLabel).toHaveBeenCalledWith('l3', false);
  });

  it(`moves the palette into a searchable popover at ${INLINE_PICKER_MAX + 1}`, () => {
    renderSection({ boardLabels: boardLabels(INLINE_PICKER_MAX + 1) });

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    fireEvent.click(trigger());

    expect(screen.getAllByRole('checkbox')).toHaveLength(INLINE_PICKER_MAX + 1);
  });

  it('filters the palette as the reader types', () => {
    renderSection({ boardLabels: boardLabels(INLINE_PICKER_MAX + 1) });
    fireEvent.click(trigger());

    fireEvent.change(
      screen.getByRole('searchbox', { name: messages.app.board.task.searchLabels }),
      { target: { value: 'label 8' } },
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByLabelText('Label 8')).toBeDefined();
  });

  it('keeps the per-label delete inside the popover for an admin', () => {
    const { onDeleteBoardLabel } = renderSection({
      boardLabels: boardLabels(INLINE_PICKER_MAX + 1),
    });
    fireEvent.click(trigger());

    fireEvent.click(
      screen.getAllByRole('button', { name: messages.app.board.task.deleteLabel })[1]!,
    );

    expect(onDeleteBoardLabel).toHaveBeenCalledWith('l2');
  });
});

/**
 * `onDeleteBoardLabel` never mutates `boardLabels` itself: the caller does, once the server
 * confirms. These re-render with the shorter list the caller would pass down, the same way
 * `TaskPropertiesPanel` does after a successful delete.
 */
describe('TaskLabelsSection popover deletion keeps focus', () => {
  const trigger = (): HTMLElement => screen.getByRole('button', { name: /^Add label/ });
  const search = (): HTMLInputElement =>
    screen.getByRole('searchbox', {
      name: messages.app.board.task.searchLabels,
    }) as HTMLInputElement;

  function renderPalette(count: number) {
    const props = {
      taskLabels: [] as LabelDto[],
      canMutate: true,
      canManageLabels: true,
      pending: false,
      onToggleLabel: vi.fn(),
      onDeleteBoardLabel: vi.fn(),
      onCreateLabel: vi.fn().mockResolvedValue(true),
    };
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TaskLabelsSection {...props} boardLabels={boardLabels(count)} />
      </NextIntlClientProvider>,
    );
    return {
      deleteFirstAndShrinkTo(remaining: number): void {
        const deleteButton = screen.getAllByRole('button', {
          name: messages.app.board.task.deleteLabel,
        })[0]!;
        deleteButton.focus();
        fireEvent.click(deleteButton);
        rerender(
          <NextIntlClientProvider locale="en" messages={messages}>
            <TaskLabelsSection {...props} boardLabels={boardLabels(count).slice(-remaining)} />
          </NextIntlClientProvider>,
        );
      },
    };
  }

  it(`keeps the popover open and focus inside it when a delete crosses ${INLINE_PICKER_MAX} board labels`, () => {
    // Exactly the boundary: without latching, the shrink from 8 to 7 would flip the palette
    // back to a flat list and unmount the popover the reader is still in.
    const { deleteFirstAndShrinkTo } = renderPalette(INLINE_PICKER_MAX + 1);
    fireEvent.click(trigger());

    deleteFirstAndShrinkTo(INLINE_PICKER_MAX);

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(document.activeElement).toBe(search());
  });

  it(`keeps focus inside the popover when a delete leaves it above ${INLINE_PICKER_MAX} board labels`, () => {
    // No shape change here, only a row disappearing out from under the reader's focus.
    const { deleteFirstAndShrinkTo } = renderPalette(INLINE_PICKER_MAX + 2);
    fireEvent.click(trigger());

    deleteFirstAndShrinkTo(INLINE_PICKER_MAX + 1);

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(document.activeElement).toBe(search());
  });
});
