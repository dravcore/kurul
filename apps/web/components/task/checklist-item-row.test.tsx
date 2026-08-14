import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ChecklistItemDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { ChecklistItemRow } from './checklist-item-row';

const ITEM: ChecklistItemDto = {
  id: 'i1',
  content: 'Agree the API contract',
  isDone: false,
  position: 1000,
};

function renderRow(
  overrides: { item?: ChecklistItemDto; disabled?: boolean; withRemove?: boolean } = {},
) {
  const onToggle = vi.fn();
  const onRemove = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ul>
        <ChecklistItemRow
          item={overrides.item ?? ITEM}
          disabled={overrides.disabled ?? false}
          onToggle={onToggle}
          onRemove={overrides.withRemove === false ? undefined : onRemove}
        />
      </ul>
    </NextIntlClientProvider>,
  );
  return { onToggle, onRemove };
}

const checkbox = (): HTMLInputElement =>
  screen.getByRole('checkbox', { name: /API contract/ }) as HTMLInputElement;

const deleteButton = (): HTMLButtonElement | null =>
  screen.queryByRole('button', { name: /Delete item/ }) as HTMLButtonElement | null;

afterEach(() => {
  cleanup();
});

describe('ChecklistItemRow', () => {
  it('names the checkbox after the item, so it is addressable without sight', () => {
    renderRow();

    // The <label> is the accessible name. A row that renders the text next to an unlabelled
    // box reads as an anonymous checkbox to a screen reader, and to a test.
    expect(screen.getByRole('checkbox', { name: 'Agree the API contract' })).toBeDefined();
  });

  it('reports the id and the new state when ticked', () => {
    const { onToggle } = renderRow();

    fireEvent.click(checkbox());

    expect(onToggle).toHaveBeenCalledWith('i1', true);
  });

  it('reports the id and the new state when unticked', () => {
    const { onToggle } = renderRow({ item: { ...ITEM, isDone: true } });

    fireEvent.click(checkbox());

    expect(onToggle).toHaveBeenCalledWith('i1', false);
  });

  it('leaves the checkbox and the delete button inert while a write is in flight', () => {
    renderRow({ disabled: true });

    expect(checkbox().disabled).toBe(true);
    expect(deleteButton()?.disabled).toBe(true);
  });

  it('offers no delete control to a reader who cannot mutate the task', () => {
    renderRow({ withRemove: false });

    expect(deleteButton()).toBeNull();
    expect(checkbox()).toBeDefined();
  });
});
