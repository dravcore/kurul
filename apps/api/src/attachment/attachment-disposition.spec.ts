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

  it('names something when stripping left nothing behind', () => {
    const value = contentDisposition('application/pdf', '"\\');
    expect(value).toContain('filename="attachment"');
  });
});
