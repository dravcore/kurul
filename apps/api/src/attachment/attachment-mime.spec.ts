import { UnsupportedMediaTypeException } from '@nestjs/common';
import { buildDocx, buildDocxWithUnreadableContentTypes } from '../../test/helpers/ooxml';
import { assertAllowedMimeType, sniffMimeType } from './attachment-mime';

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');
const CSV = Buffer.from('id,name\n1,Ada\n2,Grace\n', 'utf8');
/** GIF89a header — a second allowed image family, so "accepts" is not one format's luck. */
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(10)]);
/** ELF header. Sniffs as `application/x-elf`, which is a real type and not on the allowlist. */
const ELF = Buffer.concat([
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01]),
  Buffer.alloc(32),
]);
/** Windows PE header — the other executable container, sniffed as `application/x-msdownload`. */
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);
/** SVG with an XML prolog. Measured: `file-type@21.3.4` reports `application/xml` for this. */
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('attachment MIME validation', () => {
  it('reads the type from the bytes, not from what the caller declared', async () => {
    expect(await sniffMimeType(PNG)).toBe('image/png');
  });

  it('accepts a real PNG', async () => {
    await expect(assertAllowedMimeType(PNG, 'image/png')).resolves.toBe('image/png');
  });

  it('rejects HTML wearing a .png name, with a 415', async () => {
    await expect(assertAllowedMimeType(HTML, 'image/png')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  it('accepts a GIF, so "allowed" is a list and not one lucky format', async () => {
    await expect(assertAllowedMimeType(GIF, 'image/gif')).resolves.toBe('image/gif');
  });
});

/**
 * The `ALLOWED_MIME_TYPES` membership test, on its own.
 *
 * It needs its own describe because the HTML case above does *not* reach it: `file-type`
 * recognises no signature for HTML, so that upload is refused by the plain-text fallback
 * instead — measured, and the reason these tests exist. Deleting the `ALLOWED_MIME_TYPES.has`
 * check left every other test in this file green. What reaches the membership test is a buffer
 * the sniffer *can* name and the allowlist does not carry.
 */
describe('the allowlist', () => {
  it.each([
    ['an ELF executable', ELF, 'application/x-elf'],
    ['a Windows executable', EXE, 'application/x-msdownload'],
    // K3's most emphatic exclusion. It arrives here rather than at the fallback because a
    // prologued SVG sniffs as `application/xml`, which is a type — just not an accepted one.
    ['an SVG', SVG, 'application/xml'],
  ])('refuses %s, whose sniffed type is real and not on the list', async (_label, bytes, mime) => {
    expect(await sniffMimeType(bytes)).toBe(mime);
    await expect(assertAllowedMimeType(bytes, 'image/png')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  /**
   * And the declaration cannot rescue it either: an executable announced as `text/plain` is
   * still refused, because a buffer the sniffer *did* name never reaches the fallback at all.
   */
  it('refuses a named type even when the caller declares one the fallback would take', async () => {
    await expect(assertAllowedMimeType(ELF, 'text/plain')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });
});

/**
 * Office documents, against a real OOXML container this file builds itself.
 *
 * The most fragile entry on the allowlist, and until this describe existed, the only entirely
 * untested one. Every office format is a ZIP, so `PK\x03\x04` proves nothing: `file-type` opens
 * the archive and *parses* `[Content_Types].xml` to reach the media type. That parse is what
 * `@tokenizer/inflate` is in `transformIgnorePatterns` for, and dropping that package from the
 * list turns every `.docx` upload into a 415 that reads like the MIME rule being wrong. Nothing
 * else in this suite touches that path, so nothing else would go red.
 */
describe('office documents', () => {
  it('reads the OOXML type out of the archive, not out of the ZIP signature', async () => {
    const docx = buildDocx();

    expect(docx.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(await sniffMimeType(docx)).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('accepts a .docx, whatever the browser declared it as', async () => {
    await expect(assertAllowedMimeType(buildDocx(), 'application/octet-stream')).resolves.toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  /**
   * The degradation ADR 0024 records, reproduced rather than assumed: when the content-types
   * part cannot be parsed, `file-type` declines to guess and answers `application/zip`. This is
   * what makes `application/zip` on the allowlist load-bearing — an office document from an
   * unusual producer lands on an accepted type instead of a 415 the user cannot act on.
   */
  it('falls back to application/zip when the content-types part is unreadable, and still accepts it', async () => {
    const broken = buildDocxWithUnreadableContentTypes();

    expect(await sniffMimeType(broken)).toBe('application/zip');
    await expect(assertAllowedMimeType(broken, 'application/octet-stream')).resolves.toBe(
      'application/zip',
    );
  });
});

// The plain-text fallback is its own describe because every one of its four conditions has to be
// able to fail on its own. `file-type` recognises no signature for plain text, so without this
// path a `.csv` — the typical companion of a Trello migration — would be a 415.
describe('the plain-text fallback', () => {
  it('accepts a UTF-8 CSV the sniffer cannot recognise, and keeps its label', async () => {
    expect(await sniffMimeType(CSV)).toBeNull();
    await expect(assertAllowedMimeType(CSV, 'text/csv')).resolves.toBe('text/csv');
  });

  it('accepts a UTF-8 text file', async () => {
    await expect(assertAllowedMimeType(Buffer.from('merhaba\n'), 'text/plain')).resolves.toBe(
      'text/plain',
    );
  });

  it('ignores charset parameters when reading the declaration', async () => {
    await expect(assertAllowedMimeType(CSV, 'TEXT/CSV; charset=UTF-8')).resolves.toBe('text/csv');
  });

  // Condition 1.
  it('refuses when the caller declared something else', async () => {
    await expect(assertAllowedMimeType(CSV, 'application/octet-stream')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  // Condition 1, the case the whole membership test exists for: keeping the declaration does not
  // open a door, because `text/html` never gets through the door in the first place. Note the
  // body here passes conditions 2, 3 and 4 — it is legal UTF-8, has no NUL and starts with a
  // letter — so this test fails the moment condition 1 is loosened to "any text/* declaration".
  it('refuses a text/html declaration even when the body would pass every other condition', async () => {
    await expect(
      assertAllowedMimeType(Buffer.from('hello, not markup at all\n'), 'text/html'),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  // Condition 2.
  it('refuses bytes that are not valid UTF-8', async () => {
    await expect(
      assertAllowedMimeType(Buffer.from([0xc3, 0x28, 0x41]), 'text/plain'),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  // Condition 3. A NUL is the clearest single signal that a buffer is not text, and it is what
  // separates "the sniffer does not know this format" from "this is a binary we have no name for".
  it('refuses a buffer containing a NUL byte', async () => {
    await expect(
      assertAllowedMimeType(Buffer.from('id,name\0\n1,Ada\n'), 'text/csv'),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  // Condition 4. This is the whole point of the fallback being narrow: an `.txt` whose content is
  // markup must not become an accepted upload just because it is legal UTF-8.
  it.each(['<html><body>hi</body></html>', '   \n\t<!doctype html>', '<svg xmlns="…"></svg>'])(
    'refuses text that starts with "<": %s',
    async (content) => {
      await expect(
        assertAllowedMimeType(Buffer.from(content), 'text/plain'),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    },
  );
});
