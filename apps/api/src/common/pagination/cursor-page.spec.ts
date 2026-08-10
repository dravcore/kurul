import { toCursorPage } from './cursor-page';

type Row = { id: string; title: string };

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({ id: `id-${index}`, title: `Row ${index}` }));

const title = (row: Row): string => row.title;

describe('toCursorPage', () => {
  it('returns an empty page with no cursor', () => {
    expect(toCursorPage([], 10, title)).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it('reports the last page when the probe row is absent', () => {
    const page = toCursorPage(rows(3), 3, title);

    expect(page).toEqual({
      items: ['Row 0', 'Row 1', 'Row 2'],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('drops the probe row and points the cursor at the last delivered row', () => {
    const page = toCursorPage(rows(4), 3, title);

    expect(page.items).toEqual(['Row 0', 'Row 1', 'Row 2']);
    expect(page.hasMore).toBe(true);
    // The cursor is the last row the client received, never the probe it never saw.
    expect(page.nextCursor).toBe('id-2');
  });

  it('keys the cursor on id, not on the mapped DTO', () => {
    const page = toCursorPage(rows(2), 1, (row) => ({ label: row.title }));

    expect(page.items).toEqual([{ label: 'Row 0' }]);
    expect(page.nextCursor).toBe('id-0');
  });

  it('maps every delivered row exactly once', () => {
    const map = jest.fn(title);

    toCursorPage(rows(4), 3, map);

    expect(map).toHaveBeenCalledTimes(3);
  });

  it('never asserts a last row that does not exist', () => {
    // A limit of 0 makes `hasMore` true with nothing to page from; a `page[page.length - 1]!`
    // would hand back `undefined.id` here.
    expect(toCursorPage(rows(1), 0, title)).toEqual({
      items: [],
      nextCursor: null,
      hasMore: true,
    });
  });
});
