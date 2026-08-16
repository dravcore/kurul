import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { ActivityType, type ActivityDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { formatActivitySummary } from './activity-summary';

/**
 * The shape `formatActivitySummary` asks for. `createTranslator` types its `key` against the
 * catalogue, which is stricter than the plain function the helper takes — the cast is at the
 * boundary only, so the messages resolved below are still the real ones from `en.json`.
 */
type Translate = (key: string, values?: Record<string, string | number | Date>) => string;

const t = createTranslator({
  locale: 'en',
  messages,
  namespace: 'app.board.task.activity',
}) as unknown as Translate;

function activity(type: string, payload: Record<string, unknown>): ActivityDto {
  return {
    id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00',
    taskId: null,
    boardId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10',
    type,
    payload,
    createdAt: '2026-01-01T00:00:00.000Z',
    author: { id: 'u1', name: 'Ayşe Yıldız', avatarUrl: null },
  } as unknown as ActivityDto;
}

describe('formatActivitySummary', () => {
  it('names the task a task event is about', () => {
    const summary = formatActivitySummary(
      activity(ActivityType.TaskCreated, { title: 'Fix the login bug' }),
      t,
    );

    expect(summary).toContain('Fix the login bug');
  });

  /**
   * An import writes exactly one activity row (ADR 0025) and it is the only row whose subject
   * lives under `name` rather than `title`. Before this case existed the row fell through to
   * `types.unknown`, which renders the wire value — `board.imported` — in a list of sentences.
   */
  it('reads an imported board as a sentence, not as the wire value', () => {
    const summary = formatActivitySummary(
      activity(ActivityType.BoardImported, {
        boardId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10',
        name: 'Product roadmap',
        source: 'trello',
        skippedTotal: 31,
      }),
      t,
    );

    expect(summary).not.toBe('board.imported');
    expect(summary).toContain('Product roadmap');
    expect(summary).toContain('31 items did not come across');
  });

  it('says so plainly when an import lost nothing', () => {
    const summary = formatActivitySummary(
      activity(ActivityType.BoardImported, { name: 'Product roadmap', skippedTotal: 0 }),
      t,
    );

    expect(summary).toContain('everything came across');
  });

  /**
   * A payload missing `skippedTotal` is a schema drift, not a crash: the sentence still names
   * the board. It reads as "nothing skipped", which is the same thing a zero would say — the
   * alternative was a summary that threw on a row the reader has no control over.
   */
  it('still names the board when the payload carries no skipped count', () => {
    const summary = formatActivitySummary(
      activity(ActivityType.BoardImported, { name: 'Product roadmap' }),
      t,
    );

    expect(summary).toContain('Product roadmap');
    expect(summary).toContain('everything came across');
  });

  it('still falls back to the raw type for an event it has no sentence for', () => {
    expect(formatActivitySummary(activity('board.deleted', {}), t)).toBe('board.deleted');
  });
});
