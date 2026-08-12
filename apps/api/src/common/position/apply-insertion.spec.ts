import { NotFoundException } from '@nestjs/common';
import { resolveCreateNeighbors, resolveMoveNeighbors } from './apply-insertion';

type Item = { id: string; position: number };

const items = (ids: string[]): Item[] =>
  ids.map((id, index) => ({ id, position: (index + 1) * 1000 }));

describe('resolveMoveNeighbors', () => {
  it('appends when neither neighbor is given', () => {
    const remaining = items(['a', 'b']);

    expect(resolveMoveNeighbors(remaining, undefined, undefined)).toEqual({
      insertionIndex: 2,
      prev: remaining[1],
      next: null,
    });
  });

  it('inserts before nextId, so nextId keeps the larger position', () => {
    const remaining = items(['a', 'b', 'c']);

    expect(resolveMoveNeighbors(remaining, undefined, 'a')).toEqual({
      insertionIndex: 0,
      prev: null,
      next: remaining[0],
    });
  });

  it('inserts after prevId, so prevId keeps the smaller position', () => {
    const remaining = items(['a', 'b', 'c']);

    expect(resolveMoveNeighbors(remaining, 'b', undefined)).toEqual({
      insertionIndex: 2,
      prev: remaining[1],
      next: remaining[2],
    });
  });

  it('accepts an adjacent prevId and nextId', () => {
    const remaining = items(['a', 'b', 'c']);

    expect(resolveMoveNeighbors(remaining, 'a', 'b')).toEqual({
      insertionIndex: 1,
      prev: remaining[0],
      next: remaining[1],
    });
  });

  it('throws NotFoundException when a neighbor id is missing', () => {
    const remaining = items(['a', 'b']);

    expect(() => resolveMoveNeighbors(remaining, 'foreign', undefined)).toThrow(NotFoundException);
  });

  it('throws NotFoundException when prevId and nextId are not adjacent', () => {
    const remaining = items(['a', 'b', 'c']);

    expect(() => resolveMoveNeighbors(remaining, 'a', 'c')).toThrow(NotFoundException);
  });
});

describe('resolveCreateNeighbors', () => {
  it('appends when no prevId is given', () => {
    const siblings = items(['a', 'b']);

    expect(resolveCreateNeighbors(siblings, undefined, 'Task not found')).toEqual({
      insertionIndex: 2,
      prev: siblings[1],
      next: null,
    });
  });

  it('opens the very first slot in an empty column', () => {
    expect(resolveCreateNeighbors([], undefined, 'Task not found')).toEqual({
      insertionIndex: 0,
      prev: null,
      next: null,
    });
  });

  it('inserts directly after the named sibling', () => {
    const siblings = items(['a', 'b', 'c']);

    expect(resolveCreateNeighbors(siblings, 'a', 'Task not found')).toEqual({
      insertionIndex: 1,
      prev: siblings[0],
      next: siblings[1],
    });
  });

  it('treats an explicit null prevId as an append', () => {
    const siblings = items(['a', 'b']);

    expect(resolveCreateNeighbors(siblings, null, 'Task not found')).toEqual({
      insertionIndex: 2,
      prev: siblings[1],
      next: null,
    });
  });

  // Same slot semantics as a move, so both rebalance paths read `prev`/`next` alike. This is
  // also where the two DTO vocabularies meet: create's `afterTaskId: 'b'` must land in the
  // same slot as a move asking for prev 'b' / next 'c'.
  it('agrees with resolveMoveNeighbors on the resulting slot', () => {
    const siblings = items(['a', 'b', 'c']);

    expect(resolveCreateNeighbors(siblings, 'b', 'Task not found')).toEqual(
      resolveMoveNeighbors(siblings, 'b', 'c'),
    );
  });

  it('throws NotFoundException with the caller message when prevId is missing', () => {
    const siblings = items(['a', 'b']);

    expect(() => resolveCreateNeighbors(siblings, 'foreign', 'Column not found')).toThrow(
      'Column not found',
    );
  });
});
