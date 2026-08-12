import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { LabelDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { TaskLabelsSection } from './task-labels-section';

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
