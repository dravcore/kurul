import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { CommentDto, WorkspaceMemberDto } from '@kurultay/shared-types';
import { MemberRole } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { TaskCommentsSection } from './task-comments-section';

const AYSE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';
const AHMET_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d52';

function member(id: string, userId: string, name: string): WorkspaceMemberDto {
  return { id, workspaceId: 'ws-1', userId, role: MemberRole.MEMBER, name, avatarUrl: null };
}

const members = [
  member('m1', AYSE_ID, 'Ayşe Yıldız'),
  member('m2', AHMET_ID, 'Ahmet Demir'),
  member('m3', '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53', 'Bora Kaya'),
];

function comment(id: string, body: string, author: Partial<CommentDto['author']> = {}): CommentDto {
  return {
    id,
    taskId: 'task-1',
    userId: AYSE_ID,
    body,
    createdAt: '2026-01-01T00:00:00.000Z',
    author: { id: AYSE_ID, name: 'Ayşe Yıldız', avatarUrl: null, deleted: false, ...author },
  };
}

function renderSection(overrides: Partial<Parameters<typeof TaskCommentsSection>[0]> = {}) {
  const onSubmit = vi.fn<(body: string) => Promise<boolean>>().mockResolvedValue(true);
  const onDelete = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaskCommentsSection
        comments={[]}
        members={members}
        canMutate
        pending={false}
        loading={false}
        onSubmit={onSubmit}
        onDelete={onDelete}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
  return { onSubmit, onDelete };
}

/** The composer reads `selectionStart` off the event, so a change has to carry the caret. */
function type(textarea: HTMLTextAreaElement, value: string): void {
  fireEvent.change(textarea, { target: { value, selectionStart: value.length } });
}

function composer(): HTMLTextAreaElement {
  return screen.getByLabelText('Add a comment');
}

beforeAll(() => {
  // jsdom has no layout, so it ships no scrollIntoView — the picker calls it on every move.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe('TaskCommentsSection', () => {
  /**
   * A failed metadata load drops the thread back to `[]`, and an empty `[]` under a failure
   * reads as "nobody has commented" — which invites the author to conclude their comments
   * were deleted. The thread is unknown here, not empty.
   */
  /**
   * A comment survives its author's account, unnamed — the whole reason `Comment.user` is a
   * `Restrict` foreign key and the row is anonymised rather than deleted (ADR 0026).
   *
   * **The fixture's stored name is deliberately not `Deleted user`.** In English the catalogue
   * label and the stored tombstone are the same two words, so seeding the tombstone and
   * asserting it appears is satisfied by a component that never reads the flag — it passed
   * against a mutant `authorLabel` that always returned `author.name`. A different stored name
   * is what makes this assertion mean "the label came from the catalogue".
   */
  it('renders a deleted author from the catalogue, and keeps the comment', () => {
    renderSection({
      comments: [comment('c1', 'Still worth reading', { name: 'Ayşe Yıldız', deleted: true })],
    });

    expect(screen.getByText(messages.common.deletedUser)).toBeDefined();
    expect(screen.queryByText('Ayşe Yıldız')).toBeNull();
    expect(screen.getByText('Still worth reading')).toBeDefined();
  });

  it('reports a failed load instead of showing an empty thread', () => {
    renderSection({ loadFailed: true });

    expect(screen.getByText(messages.app.errors.commentsLoad)).toBeDefined();
    expect(screen.queryByText('No comments yet')).toBeNull();
  });

  it('shows the empty message only once the first fetch has settled', () => {
    renderSection({ loading: true });
    expect(screen.queryByText('No comments yet')).toBeNull();

    cleanup();
    renderSection({ loading: false });
    expect(screen.getByText('No comments yet')).toBeTruthy();
  });

  it('keeps the picker closed until an @ query is typed', () => {
    renderSection();
    const textarea = composer();

    expect(textarea.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();

    type(textarea, 'ship it @Ah');

    expect(textarea.getAttribute('aria-expanded')).toBe('true');
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Ahmet Demir']);
  });

  it('moves the active option with the arrow keys while focus stays on the textarea', () => {
    renderSection();
    const textarea = composer();
    // Matched anywhere in the name, not just as a prefix — "Kaya" qualifies too.
    type(textarea, '@y');

    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Ayşe Yıldız', 'Bora Kaya']);
    expect(textarea.getAttribute('aria-activedescendant')).toBe(options[0]!.id);

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(textarea.getAttribute('aria-activedescendant')).toBe(options[1]!.id);
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true');

    // Wraps rather than sticking at the end.
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(textarea.getAttribute('aria-activedescendant')).toBe(options[0]!.id);

    fireEvent.keyDown(textarea, { key: 'End' });
    expect(textarea.getAttribute('aria-activedescendant')).toBe(options[1]!.id);
  });

  it('replaces the query with mention markup on Enter', () => {
    renderSection();
    const textarea = composer();
    type(textarea, 'nice work @Ahm');

    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(textarea.value).toBe(`nice work @[Ahmet Demir](${AHMET_ID}) `);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('announces an empty result without offering a selectable option', () => {
    renderSection();
    const textarea = composer();
    type(textarea, '@zzz');

    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('No members match');
    // With nothing to select, the textarea must not point at a stale option.
    expect(textarea.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('closes the picker on Escape without letting the panel see the key', () => {
    renderSection();
    const textarea = composer();
    type(textarea, '@y');

    // The task panel closes itself on a window-level Escape, so the picker has to stop it.
    const onWindowEscape = vi.fn();
    window.addEventListener('keydown', onWindowEscape);
    try {
      fireEvent.keyDown(textarea, { key: 'Escape' });
    } finally {
      window.removeEventListener('keydown', onWindowEscape);
    }

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onWindowEscape).not.toHaveBeenCalled();
  });

  it('submits the trimmed body and clears the draft', async () => {
    const { onSubmit } = renderSection();
    const textarea = composer();
    type(textarea, '  looks good  ');

    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    expect(onSubmit).toHaveBeenCalledWith('looks good');
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('keeps the draft when the post fails', async () => {
    const { onSubmit } = renderSection();
    onSubmit.mockResolvedValue(false);
    const textarea = composer();
    type(textarea, 'retry me');

    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(textarea.value).toBe('retry me');
  });

  it('ignores a whitespace-only draft', () => {
    const { onSubmit } = renderSection();
    type(composer(), '   ');

    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('hides the composer and per-comment delete for a read-only member', () => {
    const { onDelete } = renderSection({
      canMutate: false,
      comments: [comment('c1', 'Read only')],
    });

    expect(screen.queryByLabelText('Add a comment')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('offers to load the rest of the thread only while a page is left', () => {
    renderSection({ comments: [comment('c1', 'First')] });
    expect(screen.queryByRole('button', { name: 'Load more comments' })).toBeNull();

    cleanup();
    const onLoadMore = vi.fn();
    renderSection({ comments: [comment('c1', 'First')], hasMore: true, onLoadMore });

    fireEvent.click(screen.getByRole('button', { name: 'Load more comments' }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('disables the load-more button while the next page is in flight', () => {
    const onLoadMore = vi.fn();
    renderSection({
      comments: [comment('c1', 'First')],
      hasMore: true,
      loadingMore: true,
      onLoadMore,
    });

    const button = screen.getByRole('button', { name: 'Loading…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('deletes the comment it was asked to delete', () => {
    const { onDelete } = renderSection({
      comments: [comment('c1', 'First'), comment('c2', 'Second')],
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]!);

    expect(onDelete).toHaveBeenCalledWith('c2');
  });
});
