import { BadRequestException, NotFoundException } from '@nestjs/common';
import { resolveCreateNeighbors, resolveMoveNeighbors } from './apply-insertion';

type Item = { id: string; position: number };

const items = (ids: string[]): Item[] =>
  ids.map((id, index) => ({ id, position: (index + 1) * 1000 }));

describe('resolveMoveNeighbors', () => {
  it('appends when neither neighbor is given', () => {
    const remaining = items(['a', 'b']);

    expect(resolveMoveNeighbors(remaining, undefined, undefined, 'moving')).toEqual({
      insertionIndex: 2,
      before: remaining[1],
      after: null,
    });
  });

  it('inserts so afterId sits after the moved item', () => {
    const remaining = items(['a', 'b', 'c']);

    expect(resolveMoveNeighbors(remaining, undefined, 'a', 'moving')).toEqual({
      insertionIndex: 0,
      before: null,
      after: remaining[0],
    });
  });

  it('inserts so beforeId sits before the moved item', () => {
    const remaining = items(['a', 'b', 'c']);

    expect(resolveMoveNeighbors(remaining, 'b', undefined, 'moving')).toEqual({
      insertionIndex: 2,
      before: remaining[1],
      after: remaining[2],
    });
  });

  it('accepts adjacent beforeId and afterId', () => {
    const remaining = items(['a', 'b', 'c']);

    expect(resolveMoveNeighbors(remaining, 'a', 'b', 'moving')).toEqual({
      insertionIndex: 1,
      before: remaining[0],
      after: remaining[1],
    });
  });

  it('throws BadRequestException when a neighbor id is self', () => {
    const remaining = items(['a', 'b']);

    expect(() => resolveMoveNeighbors(remaining, 'moving', undefined, 'moving')).toThrow(
      BadRequestException,
    );
    expect(() => resolveMoveNeighbors(remaining, undefined, 'moving', 'moving')).toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException when a neighbor id is missing', () => {
    const remaining = items(['a', 'b']);

    expect(() => resolveMoveNeighbors(remaining, 'foreign', undefined, 'moving')).toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when beforeId and afterId are not adjacent', () => {
    const remaining = items(['a', 'b', 'c']);

    expect(() => resolveMoveNeighbors(remaining, 'a', 'c', 'moving')).toThrow(NotFoundException);
  });
});

describe('resolveCreateNeighbors', () => {
  it('appends when no afterId is given', () => {
    const siblings = items(['a', 'b']);

    expect(resolveCreateNeighbors(siblings, undefined, 'Task not found')).toEqual({
      insertionIndex: 2,
      before: siblings[1],
      after: null,
    });
  });

  it('opens the very first slot in an empty column', () => {
    expect(resolveCreateNeighbors([], undefined, 'Task not found')).toEqual({
      insertionIndex: 0,
      before: null,
      after: null,
    });
  });

  it('inserts directly after the named sibling', () => {
    const siblings = items(['a', 'b', 'c']);

    expect(resolveCreateNeighbors(siblings, 'a', 'Task not found')).toEqual({
      insertionIndex: 1,
      before: siblings[0],
      after: siblings[1],
    });
  });

  it('treats an explicit null afterId as an append', () => {
    const siblings = items(['a', 'b']);

    expect(resolveCreateNeighbors(siblings, null, 'Task not found')).toEqual({
      insertionIndex: 2,
      before: siblings[1],
      after: null,
    });
  });

  // Same slot semantics as a move, so both rebalance paths can read `before`/`after` alike.
  it('agrees with resolveMoveNeighbors on the resulting slot', () => {
    const siblings = items(['a', 'b', 'c']);

    expect(resolveCreateNeighbors(siblings, 'b', 'Task not found')).toEqual(
      resolveMoveNeighbors(siblings, 'b', 'c', 'moving'),
    );
  });

  it('throws NotFoundException with the caller message when afterId is missing', () => {
    const siblings = items(['a', 'b']);

    expect(() => resolveCreateNeighbors(siblings, 'foreign', 'Column not found')).toThrow(
      'Column not found',
    );
  });
});
