import { describe, expect, it } from 'vitest';
import { Priority } from '@kurul/shared-types';
import {
  resolveDuePreset,
  setDueFilter,
  toggleAssigneeFilter,
  toggleLabelFilter,
  togglePriorityFilter,
} from './board-filter-actions';

describe('board filter actions', () => {
  it('adds a value to an empty list filter', () => {
    expect(togglePriorityFilter({}, Priority.HIGH)).toEqual({ priority: [Priority.HIGH] });
  });

  it('keeps the other filters when toggling one', () => {
    const next = toggleLabelFilter({ q: 'bug', labelId: ['a'] }, 'b');
    expect(next).toEqual({ q: 'bug', labelId: ['a', 'b'] });
  });

  it('drops the key entirely when the last value is removed', () => {
    const next = toggleAssigneeFilter({ q: 'bug', assigneeId: ['null'] }, 'null');
    expect(next.assigneeId).toBeUndefined();
    expect(next.q).toBe('bug');
  });

  it('does not mutate the filters it was given', () => {
    const filters = { priority: [Priority.LOW] };
    togglePriorityFilter(filters, Priority.HIGH);
    expect(filters.priority).toEqual([Priority.LOW]);
  });

  it('replaces the whole due-date trio for every preset', () => {
    const ranged = {
      dueDateGte: '2026-01-01T00:00:00.000Z',
      dueDateLte: '2026-02-01T00:00:00.000Z',
    };

    const none = setDueFilter(ranged, 'none');
    expect(none).toEqual({ dueDateNull: true, dueDateGte: undefined, dueDateLte: undefined });

    const overdue = setDueFilter(none, 'overdue');
    expect(overdue.dueDateNull).toBeUndefined();
    expect(overdue.dueDateGte).toBeUndefined();
    expect(typeof overdue.dueDateLte).toBe('string');

    expect(setDueFilter(overdue, 'clear')).toEqual({
      dueDateNull: undefined,
      dueDateGte: undefined,
      dueDateLte: undefined,
    });
  });

  it('leaves non-due filters alone when clearing the due date', () => {
    expect(setDueFilter({ q: 'bug', dueDateNull: true }, 'clear').q).toBe('bug');
  });

  it('reads back the preset the due-date fields represent', () => {
    expect(resolveDuePreset({})).toBeNull();
    expect(resolveDuePreset({ dueDateNull: true })).toBe('none');
    // `null` wins over a stray bound, matching what the menu checks.
    expect(resolveDuePreset({ dueDateNull: true, dueDateLte: 'x' })).toBe('none');
    expect(resolveDuePreset({ dueDateLte: 'x' })).toBe('overdue');
    expect(resolveDuePreset({ dueDateGte: 'x', dueDateLte: 'y' })).toBe('range');
    expect(resolveDuePreset({ dueDateGte: 'x' })).toBe('range');
  });
});
