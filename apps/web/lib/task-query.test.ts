import { describe, expect, it } from 'vitest';
import { Priority } from '@kurultay/shared-types';
import {
  countActiveFilters,
  hasActiveFilters,
  mergeFiltersIntoSearchParams,
  parseFiltersFromSearchParams,
  serializeFiltersToSearchParams,
  type BoardTaskFilters,
} from './task-query';

describe('task-query filters', () => {
  it('round-trips filter state through search params', () => {
    const filters: BoardTaskFilters = {
      q: 'login',
      priority: [Priority.HIGH, Priority.URGENT],
      assigneeId: ['null', '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53'],
      labelId: ['0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80'],
      dueDateNull: true,
    };

    const params = serializeFiltersToSearchParams(filters);
    expect(params.get('q')).toBe('login');
    expect(params.get('priority')).toBe('HIGH,URGENT');
    expect(params.get('assigneeId')).toBe('null,0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53');
    expect(params.get('dueDate')).toBe('null');

    expect(parseFiltersFromSearchParams(params)).toEqual(filters);
  });

  it('parses due date range bracket keys', () => {
    const params = new URLSearchParams();
    params.set('dueDate[gte]', '2026-01-01T00:00:00.000Z');
    params.set('dueDate[lte]', '2026-12-31T00:00:00.000Z');

    expect(parseFiltersFromSearchParams(params)).toEqual({
      dueDateGte: '2026-01-01T00:00:00.000Z',
      dueDateLte: '2026-12-31T00:00:00.000Z',
    });
  });

  it('counts and detects active filters', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(countActiveFilters({ q: 'x', priority: [Priority.LOW], dueDateNull: true })).toBe(3);
  });

  it('merges filters without dropping unrelated params', () => {
    const current = new URLSearchParams('tab=activity&q=old');
    const merged = mergeFiltersIntoSearchParams(current, { priority: [Priority.HIGH] });
    expect(merged.get('tab')).toBe('activity');
    expect(merged.get('q')).toBeNull();
    expect(merged.get('priority')).toBe('HIGH');
  });
});
