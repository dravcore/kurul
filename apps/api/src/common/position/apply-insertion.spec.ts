import { BadRequestException, NotFoundException } from '@nestjs/common';
import { resolveMoveNeighbors } from './apply-insertion';

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
