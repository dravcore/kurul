import { displayFilename, safeDisplayName } from './attachment-display-name';

/**
 * The rule on its own. `attachment.service.spec.ts` measures it through `createFile` and
 * `createLink`, and `import/trello-import-planner.spec.ts` through the importer; this file pins
 * the function both of them share, so a change here is seen once rather than inferred twice.
 */
describe('safeDisplayName', () => {
  it.each(['\u202e', '\u202a', '\u2069', '\u200e', '\u061c'])(
    'strips the bidi control %j',
    (control) => {
      expect(safeDisplayName(`invoice${control}gnp.exe`)).toBe('invoicegnp.exe');
    },
  );

  it('strips quotes, backslashes and C0/C1 controls, and trims', () => {
    expect(safeDisplayName(' "a\\b"\r\n\u0000c\u0085 ')).toBe('abc');
  });

  it('clamps to 255 characters after cleaning', () => {
    expect(safeDisplayName('a'.repeat(300))).toHaveLength(255);
    expect(safeDisplayName(`${'\u202e'.repeat(50)}${'b'.repeat(300)}`)).toBe('b'.repeat(255));
  });

  it('leaves an ordinary non-ASCII name intact', () => {
    expect(safeDisplayName('ölçüm.png')).toBe('ölçüm.png');
  });

  it('answers the empty string for a name made only of stripped characters', () => {
    expect(safeDisplayName('\u202e\u202a\u0000')).toBe('');
  });
});

describe('displayFilename', () => {
  it('keeps the basename only', () => {
    expect(displayFilename('../../../../etc/passwd')).toBe('passwd');
    expect(displayFilename('C:\\Users\\me\\report.pdf')).toBe('report.pdf');
  });

  it('falls back to a name when nothing survives cleaning', () => {
    expect(displayFilename('"""')).toBe('attachment');
  });
});
