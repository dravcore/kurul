'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CommentDto, WorkspaceMemberDto } from '@kurultay/shared-types';
import { getActiveMentionQuery, insertMentionMarkup } from '@/lib/mentions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { CommentBody } from './comment-body';

interface TaskCommentsSectionProps {
  comments: CommentDto[];
  members: WorkspaceMemberDto[];
  canMutate: boolean;
  pending: boolean;
  /** Suppresses the empty message until the first fetch has settled. */
  loading: boolean;
  /** The thread is cursor-paginated: older pages are on screen, newer ones may not be. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Resolves `true` once the comment is posted, which is when the draft is cleared. */
  onSubmit: (body: string) => Promise<boolean>;
  onDelete: (commentId: string) => void;
}

/**
 * The comment thread and its composer, including the `@mention` picker.
 *
 * The picker is an editable combobox: DOM focus never leaves the textarea, so the caret
 * stays where the author is typing and `aria-activedescendant` is what moves instead.
 */
export function TaskCommentsSection({
  comments,
  members,
  canMutate,
  pending,
  loading,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onSubmit,
  onDelete,
}: TaskCommentsSectionProps): React.ReactElement {
  const t = useTranslations('app.board.task');
  const commentId = useId();
  const mentionListId = useId();
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionListRef = useRef<HTMLUListElement | null>(null);

  const [commentBody, setCommentBody] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Focus never leaves the textarea, so the highlighted option has to be scrolled manually.
  useEffect(() => {
    mentionListRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [mentionIndex, mentionQuery]);

  const mentionCandidates =
    mentionQuery === null
      ? []
      : members.filter((member) =>
          member.name.toLocaleLowerCase('en-US').includes(mentionQuery.toLocaleLowerCase('en-US')),
        );
  // Clamped rather than reset on every keystroke, so a shrinking list still has a highlight.
  const activeMentionIndex = Math.min(mentionIndex, Math.max(mentionCandidates.length - 1, 0));
  const mentionOptionId = (index: number): string => `${mentionListId}-option-${index}`;
  const mentionPickerOpen = mentionQuery !== null;

  function syncMentionQuery(value: string, cursor: number): void {
    const active = getActiveMentionQuery(value, cursor);
    setMentionQuery(active ? active.query : null);
    // Any change to what was typed re-ranks the list, so the highlight goes back to the top.
    setMentionIndex(0);
  }

  function closeMentionPicker(): void {
    setMentionQuery(null);
    setMentionIndex(0);
  }

  function applyMention(member: WorkspaceMemberDto): void {
    const el = commentRef.current;
    const start = el?.selectionStart ?? commentBody.length;
    const end = el?.selectionEnd ?? start;
    const next = insertMentionMarkup(commentBody, start, end, member.name, member.userId);
    setCommentBody(next.value);
    closeMentionPicker();
    requestAnimationFrame(() => {
      const textarea = commentRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(next.cursor, next.cursor);
    });
  }

  async function submit(): Promise<void> {
    const body = commentBody.trim();
    if (body.length === 0) return;
    const posted = await onSubmit(body);
    if (!posted) return;
    setCommentBody('');
    closeMentionPicker();
  }

  /** Arrow keys, Home/End, Enter and Escape drive the picker while it is open. */
  function onCommentKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (!mentionPickerOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      // Stop here: the panel's own Escape handler would otherwise close the whole task.
      event.stopPropagation();
      closeMentionPicker();
      return;
    }

    const count = mentionCandidates.length;
    if (count === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMentionIndex((activeMentionIndex + 1) % count);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setMentionIndex((activeMentionIndex - 1 + count) % count);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setMentionIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setMentionIndex(count - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      applyMention(mentionCandidates[activeMentionIndex]!);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-small font-medium text-foreground">{t('comments')}</p>
      <ul className="flex flex-col gap-3">
        {comments.map((comment) => (
          <li key={comment.id} className="rounded-md border border-border px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-small font-medium text-foreground">{comment.author.name}</p>
                <p className="text-micro text-muted-foreground">
                  {new Date(comment.createdAt).toLocaleString()}
                </p>
              </div>
              {canMutate ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => onDelete(comment.id)}
                >
                  {t('deleteComment')}
                </Button>
              ) : null}
            </div>
            <CommentBody body={comment.body} className="mt-1" />
          </li>
        ))}
        {comments.length === 0 && !loading ? (
          <li className="text-small text-muted-foreground">{t('noComments')}</li>
        ) : null}
      </ul>
      {hasMore && onLoadMore ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? t('loadingComments') : t('loadMoreComments')}
          </Button>
        </div>
      ) : null}
      {canMutate ? (
        <div className="relative flex flex-col gap-2">
          <Label htmlFor={commentId}>{t('addComment')}</Label>
          <textarea
            ref={commentRef}
            id={commentId}
            // The implicit `textbox` role does not support `aria-expanded`; the mention
            // picker turns this field into an editable combobox while it is open, so it
            // needs the role that actually owns that state.
            role="combobox"
            aria-haspopup="listbox"
            value={commentBody}
            disabled={pending}
            rows={3}
            aria-describedby={`${commentId}-hint`}
            aria-autocomplete="list"
            aria-expanded={mentionPickerOpen}
            aria-controls={mentionPickerOpen ? mentionListId : undefined}
            aria-activedescendant={
              mentionPickerOpen && mentionCandidates.length > 0
                ? mentionOptionId(activeMentionIndex)
                : undefined
            }
            onChange={(event) => {
              const value = event.target.value;
              setCommentBody(value);
              syncMentionQuery(value, event.target.selectionStart);
            }}
            onSelect={(event) => {
              syncMentionQuery(commentBody, event.currentTarget.selectionStart);
            }}
            onKeyDown={onCommentKeyDown}
            className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-body outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          />
          <p id={`${commentId}-hint`} className="text-micro text-muted-foreground">
            {t('mentions.hint')}
          </p>
          {mentionPickerOpen ? (
            <ul
              ref={mentionListRef}
              id={mentionListId}
              role="listbox"
              aria-label={t('mentions.pickerLabel')}
              className="absolute right-0 bottom-[calc(100%-0.5rem)] left-0 z-20 max-h-40 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-overlay"
            >
              {mentionCandidates.length === 0 ? (
                // Not an option: an empty listbox with a listitem in it would be read as
                // a selectable member. The live status below announces the empty result.
                <li aria-hidden className="px-2 py-1.5 text-small text-muted-foreground">
                  {t('mentions.empty')}
                </li>
              ) : (
                mentionCandidates.map((member, index) => (
                  <li
                    key={member.id}
                    id={mentionOptionId(index)}
                    role="option"
                    // Never part of the tab order — the textarea keeps DOM focus and drives
                    // selection via aria-activedescendant — but still a real keyboard target
                    // so Enter/Space here match the click, not a no-op stub.
                    tabIndex={-1}
                    aria-selected={index === activeMentionIndex}
                    data-active={index === activeMentionIndex || undefined}
                    className={cn(
                      'cursor-pointer rounded-sm px-2 py-1.5 text-body',
                      index === activeMentionIndex && 'bg-accent',
                    )}
                    // Selecting must not blur the textarea, or the caret position the
                    // mention is spliced into would be gone by the time the click lands.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyMention(member)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        applyMention(member);
                      }
                    }}
                  >
                    {member.name}
                  </li>
                ))
              )}
            </ul>
          ) : null}
          <span className="sr-only" role="status">
            {mentionPickerOpen && mentionCandidates.length === 0 ? t('mentions.empty') : ''}
          </span>
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={pending} onClick={() => void submit()}>
              {t('postComment')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
