import { contentDisposition } from './attachment-disposition';

describe('contentDisposition', () => {
  it.each([
    ['image/png', 'inline'],
    ['image/jpeg', 'inline'],
    ['image/gif', 'inline'],
    ['image/webp', 'inline'],
    ['application/pdf', 'attachment'],
    ['application/zip', 'attachment'],
    ['text/plain', 'attachment'],
    ['text/csv', 'attachment'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'attachment'],
  ])('serves %s as %s', (mime, expected) => {
    expect(contentDisposition(mime, 'a.bin')).toMatch(new RegExp(`^${expected};`));
  });

  it('falls back to attachment for a type nothing recognises', () => {
    expect(contentDisposition('application/octet-stream', 'a.bin')).toMatch(/^attachment;/);
  });

  it('cannot be used to inject a second header', () => {
    const value = contentDisposition('application/pdf', 'a\r\nX-Evil: 1.pdf');
    expect(value).not.toContain('\r');
    expect(value).not.toContain('\n');
  });

  it('cannot be used to close the quoted parameter early', () => {
    const value = contentDisposition('application/pdf', 'a".pdf');
    // Exactly one quoted parameter, so the value cannot smuggle a second one.
    expect(value.match(/"/g)).toHaveLength(2);
  });

  it('carries a non-ASCII name in the RFC 5987 parameter', () => {
    const value = contentDisposition('application/pdf', 'sözleşme.pdf');
    expect(value).toContain("filename*=UTF-8''s%C3%B6zle%C5%9Fme.pdf");
    expect(value).toContain('filename="s_zle_me.pdf"');
  });

  it('still names something when the whole filename was non-ASCII', () => {
    const value = contentDisposition('application/pdf', 'ÜÇÖ');
    expect(value).toContain('filename="___"');
    expect(value).toContain("filename*=UTF-8''%C3%9C%C3%87%C3%96");
  });

  /**
   * The one group in `UNSAFE_HEADER_CHARACTERS` that has a single mechanism holding it.
   *
   * U+202E reverses everything after it, so `invoice<RLO>gnp.exe` *renders* as
   * `invoiceexe.png` — in the panel, and in the browser prompt that asks where to save the
   * file. The ASCII parameter cannot catch it (it maps every non-ASCII byte to `_` and would
   * look clean either way); `encodeURIComponent` cannot either, because percent-encoding is
   * exactly what the browser undoes before it draws that prompt. Deleting the bidi range from
   * the class turns this red, which is the difference between it and the CR/LF case above.
   */
  it.each(['\u202e', '\u202d', '\u2066', '\u200f', '\u061c'])(
    'strips the bidi control %j, which the RFC 5987 parameter would otherwise carry intact',
    (control) => {
      const value = contentDisposition('application/pdf', `invoice${control}fdp.exe`);

      const encoded = /filename\*=UTF-8''(.*)$/.exec(value)?.[1] ?? '';
      expect(decodeURIComponent(encoded)).not.toContain(control);
      expect(decodeURIComponent(encoded)).toBe('invoicefdp.exe');
    },
  );

  // The control. Without it the assertion above would pass on an implementation that dropped
  // every non-ASCII character, which would be a different bug wearing the same green tick.
  it('leaves an ordinary non-ASCII name alone in the RFC 5987 parameter', () => {
    const value = contentDisposition('application/pdf', 'ölçüm raporu.pdf');

    const encoded = /filename\*=UTF-8''(.*)$/.exec(value)?.[1] ?? '';
    expect(decodeURIComponent(encoded)).toBe('ölçüm raporu.pdf');
  });

  it('strips the C0 and C1 controls, not only CR and LF', () => {
    const value = contentDisposition('application/pdf', 'a\u0009b\u001bc\u0085d.pdf');

    const encoded = /filename\*=UTF-8''(.*)$/.exec(value)?.[1] ?? '';
    expect(decodeURIComponent(encoded)).toBe('abcd.pdf');
  });
  it('names something when stripping left nothing behind', () => {
    const value = contentDisposition('application/pdf', '"\\');
    expect(value).toContain('filename="attachment"');
  });
});
