import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ChecklistDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { TaskChecklists } from './task-checklists';

const PREP: ChecklistDto = {
  id: 'c1',
  title: 'Preparation',
  position: 1000,
  items: [
    { id: 'i1', content: 'Design', isDone: true, position: 1000 },
    { id: 'i2', content: 'API', isDone: false, position: 2000 },
  ],
};

type Overrides = {
  checklists?: ChecklistDto[];
  canMutate?: boolean;
  pending?: boolean;
  loading?: boolean;
  loadFailed?: boolean;
};

function renderSection(overrides: Overrides = {}) {
  const onToggle = vi.fn();
  const onAddChecklist = vi.fn().mockResolvedValue(true);
  const onRemoveChecklist = vi.fn();
  const onAddItem = vi.fn().mockResolvedValue(true);
  const onRemoveItem = vi.fn();
  const result = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskChecklists
        checklists={overrides.checklists ?? [PREP]}
        canMutate={overrides.canMutate ?? true}
        pending={overrides.pending ?? false}
        loading={overrides.loading ?? false}
        loadFailed={overrides.loadFailed ?? false}
        onToggle={onToggle}
        onAddChecklist={onAddChecklist}
        onRemoveChecklist={onRemoveChecklist}
        onAddItem={onAddItem}
        onRemoveItem={onRemoveItem}
      />
    </NextIntlClientProvider>,
  );
  return { ...result, onToggle, onAddChecklist, onRemoveChecklist, onAddItem, onRemoveItem };
}

afterEach(() => {
  cleanup();
});

describe('TaskChecklists', () => {
  it('shows the progress of each checklist', () => {
    renderSection();

    expect(screen.getByText('1/2')).toBeDefined();
  });

  it('calls onToggle with the item id and the new state', () => {
    const { onToggle } = renderSection();

    fireEvent.click(screen.getByRole('checkbox', { name: 'API' }));

    expect(onToggle).toHaveBeenCalledWith('i2', true);
  });

  it('spells the ratio out for assistive tech instead of leaving a slash to be read aloud', () => {
    renderSection();

    expect(screen.getByText('Checklist: 1 of 2 items done')).toBeDefined();
  });

  it('adds a checklist with the typed title and clears the field', () => {
    const { onAddChecklist } = renderSection();

    const field = screen.getByLabelText('New checklist') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist' }));

    expect(onAddChecklist).toHaveBeenCalledWith('Release');
  });

  it('refuses to send a title that is only whitespace', () => {
    const { onAddChecklist } = renderSection();

    fireEvent.change(screen.getByLabelText('New checklist'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist' }));

    expect(onAddChecklist).not.toHaveBeenCalled();
  });

  it('adds an item to the checklist it was typed under', () => {
    const { onAddItem } = renderSection({
      checklists: [PREP, { id: 'c2', title: 'Release', position: 2000, items: [] }],
    });

    const fields = screen.getAllByLabelText('New item') as HTMLInputElement[];
    fireEvent.change(fields[1]!, { target: { value: 'Tag the release' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add item' })[1]!);

    expect(onAddItem).toHaveBeenCalledWith('c2', 'Tag the release');
  });

  it('renders nothing at all when there is no checklist and the reader cannot add one', () => {
    const { container } = renderSection({ checklists: [], canMutate: false });

    expect(container.innerHTML).toBe('');
  });

  it('still offers the add form to an editor whose task has no checklist yet', () => {
    renderSection({ checklists: [] });

    expect(screen.getByLabelText('New checklist')).toBeDefined();
  });

  it('says the checklists are still loading rather than showing an empty task as checklist-free', () => {
    // `checklists: null` on a TaskDto means "not loaded", never "none" — a board row carries
    // only the summary. Rendering the empty state here would assert something the panel does
    // not yet know.
    renderSection({ checklists: [], loading: true });

    expect(screen.getByText('Loading…')).toBeDefined();
    expect(screen.queryByLabelText('New checklist')).toBeNull();
  });

  it('says the checklists failed to load rather than reporting none', () => {
    renderSection({ checklists: [], loadFailed: true });

    expect(screen.getByText("The checklists couldn't load.")).toBeDefined();
  });

  it('offers no write controls to a reader who cannot mutate the task', () => {
    renderSection({ canMutate: false });

    expect(screen.queryByLabelText('New checklist')).toBeNull();
    expect(screen.queryByLabelText('New item')).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete checklist/ })).toBeNull();
    // The items stay readable — losing write access is not losing the content.
    expect(screen.getByRole('checkbox', { name: 'API' })).toBeDefined();
  });

  it('disables every control while a write is in flight', () => {
    renderSection({ pending: true });

    expect((screen.getByRole('checkbox', { name: 'API' }) as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Add checklist' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('deletes the checklist the button belongs to', () => {
    const { onRemoveChecklist } = renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Delete checklist Preparation' }));

    expect(onRemoveChecklist).toHaveBeenCalledWith('c1');
  });
});
