import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { NextIntlClientProvider } from 'next-intl';
import { Priority, type TaskDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { SortableTaskCard } from './sortable-task-card';
import { TaskCard } from './task-card';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60',
    boardId: 'board-1',
    columnId: 'column-1',
    title: 'Task',
    description: null,
    priority: Priority.MEDIUM,
    position: 1000,
    dueDate: null,
    estimatedMinutes: null,
    createdById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignees: [],
    labels: [],
    checklistSummary: { total: 0, done: 0 },
    checklists: null,
    attachmentCount: 0,
    ...overrides,
  };
}

function renderCard(overrides: Partial<TaskDto> = {}, selected = false) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskCard task={task(overrides)} boardId="board-1" selected={selected} />
    </NextIntlClientProvider>,
  );
}

/** Substring matching cannot tell `border-border` from `hover:border-border-strong`. */
function classesOf(element: Element): Set<string> {
  return new Set(element.className.split(/\s+/).filter(Boolean));
}

afterEach(() => {
  cleanup();
});

describe('TaskCard estimate', () => {
  it('renders 150 minutes as hours and minutes, not as raw minutes', () => {
    renderCard({ estimatedMinutes: 150 });

    expect(screen.getByText('2h 30m')).toBeDefined();
    expect(screen.queryByText('150m')).toBeNull();
  });

  it('drops the minutes on a whole hour', () => {
    renderCard({ estimatedMinutes: 120 });

    expect(screen.getByText('2h')).toBeDefined();
    expect(screen.queryByText('2h 0m')).toBeNull();
  });

  it('stays in minutes under an hour', () => {
    renderCard({ estimatedMinutes: 45 });

    expect(screen.getByText('45m')).toBeDefined();
  });

  it('renders a zero estimate rather than swallowing it', () => {
    renderCard({ estimatedMinutes: 0 });

    expect(screen.getByText('0m')).toBeDefined();
  });

  it('shows no estimate at all when the task has none', () => {
    renderCard({ estimatedMinutes: null });

    expect(screen.queryByText(/\dh|\dm/)).toBeNull();
  });
});

describe('TaskCard selection', () => {
  /**
   * The copper edge is what separates the open task from its neighbours on the board. Until the
   * `*` border rule moved into `@layer base` it was repainted the hairline grey, so the card
   * that carried it looked like every other one, and nothing in the suite would have noticed.
   */
  it('wears the signature rail on its left edge only while it is the selected card', () => {
    renderCard({}, true);
    const selected = screen.getByRole('link');
    const classes = classesOf(selected);

    expect(classes.has('border-l-signature')).toBe(true);
    // The other three edges stay on the plain hairline: `border-signature` would paint all
    // four, which is the whole-card copper edge this rail replaces.
    expect(classes.has('border-signature')).toBe(false);
    expect(classes.has('border-border')).toBe(true);
    expect(selected.getAttribute('data-selected')).toBe('true');
    expect(selected.getAttribute('aria-current')).toBe('true');
  });

  it('leaves an unselected card on the plain hairline', () => {
    renderCard();
    const unselected = screen.getByRole('link');

    expect(classesOf(unselected).has('border-l-signature')).toBe(false);
    expect(classesOf(unselected).has('border-signature')).toBe(false);
    expect(classesOf(unselected).has('border-border')).toBe(true);
    expect(unselected.hasAttribute('data-selected')).toBe(false);
    expect(unselected.hasAttribute('aria-current')).toBe(false);
  });

  /**
   * `border-l-2` has to be unconditional. If only the selected card carried it, opening a task
   * would grow its box by a pixel and shift the title text, since a 1px and a 2px left border
   * measure differently even in the same colour.
   */
  it('keeps the same left border width selected or not, so opening a card does not shift it', () => {
    renderCard({}, true);
    const selectedClasses = classesOf(screen.getByRole('link'));
    cleanup();
    renderCard({}, false);
    const unselectedClasses = classesOf(screen.getByRole('link'));

    expect(selectedClasses.has('border-l-2')).toBe(true);
    expect(unselectedClasses.has('border-l-2')).toBe(true);
  });

  /** Focus is the single `:focus-visible` outline `app/globals.css` draws. A focus utility here
   * would put a second copper mark around that one, on the state where the card already wears a
   * rail. */
  it('draws no focus mark of its own, selected or not', () => {
    for (const selected of [false, true]) {
      cleanup();
      renderCard({}, selected);
      const classes = [...classesOf(screen.getByRole('link'))];

      expect(classes.filter((name) => name.startsWith('focus-visible:'))).toEqual([]);
    }
  });

  it('drops the hover classes from a selected card so hover cannot outrank its tint and rail', () => {
    renderCard({}, true);
    const classes = classesOf(screen.getByRole('link'));

    expect(classes.has('hover:border-border-strong')).toBe(false);
    expect(classes.has('hover:bg-accent')).toBe(false);
    expect(classes.has('border-l-signature')).toBe(true);
    expect(classes.has('bg-signature-subtle')).toBe(true);
  });

  it('keeps the hover classes on an unselected card', () => {
    renderCard();
    const classes = classesOf(screen.getByRole('link'));

    expect(classes.has('hover:border-border-strong')).toBe(true);
    expect(classes.has('hover:bg-accent')).toBe(true);
  });
});

describe('TaskCard checklist badge', () => {
  it('carries checklist progress on a card that has nothing else in its meta row', () => {
    // The meta row is conditional. Before the badge was added to that condition, a task whose
    // only metadata was a checklist rendered no row at all and the badge went missing.
    renderCard({ checklistSummary: { total: 4, done: 1 } });

    expect(screen.getByText('1/4')).toBeDefined();
  });

  it('adds nothing to a card whose task has no checklist', () => {
    renderCard({ checklistSummary: { total: 0, done: 0 } });

    expect(screen.queryByText(/^\d+\/\d+$/)).toBeNull();
  });
});

describe('TaskCard attachment badge', () => {
  it('carries the attachment count on a card that has nothing else in its meta row', () => {
    // The guard on the meta row is the whole test. A card whose only metadata is an attachment
    // renders no row at all unless `attachmentCount` is one of the terms in that condition —
    // and the badge, correct on its own, is then never mounted.
    renderCard({ attachmentCount: 2 });

    expect(screen.getByLabelText('2 attachments')).toBeDefined();
  });

  it('still shows the badge beside other metadata', () => {
    renderCard({ attachmentCount: 1, estimatedMinutes: 45 });

    expect(screen.getByLabelText('1 attachment')).toBeDefined();
    expect(screen.getByText('45m')).toBeDefined();
  });

  it('adds nothing to a card whose task has no attachment', () => {
    renderCard({ attachmentCount: 0 });

    expect(screen.queryByLabelText(/attachment/)).toBeNull();
  });
});

describe('SortableTaskCard drag grip', () => {
  /**
   * `sortable-task-card.tsx` is not one of the seven files `app/globals-css-layers.test.ts`'s
   * `singleIndicatorTargets` scans, so nothing else catches a stray outline or ring utility
   * landing on the grip button; this assertion is what does.
   */
  it('draws no outline or ring utility of its own', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DndContext>
          <SortableTaskCard task={task()} boardId="board-1" />
        </DndContext>
      </NextIntlClientProvider>,
    );

    const grip = screen.getByRole('button', { name: 'Reorder Task' });

    expect(grip.className).not.toMatch(/outline-(none|hidden)|ring-\[3px\]|ring-ring/);
  });
});
