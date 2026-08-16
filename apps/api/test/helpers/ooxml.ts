import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A real OOXML container, assembled byte by byte, for specs that need one.
 *
 * Here rather than checked in as a binary, and beside `db.ts`/`storage.ts` for the same reason
 * they are: a fixture a spec builds is a fixture a reader can audit. A committed `.docx` is an
 * opaque blob that nobody re-derives, and the one property these tests depend on — that
 * `[Content_Types].xml` is present, well-formed and names the WordprocessingML content type —
 * would be invisible in review.
 *
 * That property is the whole point. `file-type` does not identify an office document by a magic
 * number; every one of them is a ZIP, so `PK\x03\x04` says only "archive". It opens the archive
 * and *parses* `[Content_Types].xml` to find the media type (ADR 0024 cites `core.js:1320-1343`).
 * That is why `@tokenizer/inflate` has to be in both Jest configs' `transformIgnorePatterns`,
 * and it is why a fixture with a deliberately broken `[Content_Types].xml` degrades to a plain
 * `application/zip` instead of failing outright.
 */

const DOCX_MAIN_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  `<Override PartName="/word/document.xml" ContentType="${DOCX_MAIN_TYPE}"/>` +
  '</Types>';

const RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Target="word/document.xml" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>' +
  '</Relationships>';

const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:body><w:p><w:r><w:t>Kurul</w:t></w:r></w:p></w:body>' +
  '</w:document>';

interface ZipEntry {
  name: string;
  content: string;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
/** 2.0 — the minimum that understands the deflate method used below. */
const ZIP_VERSION = 20;
const METHOD_DEFLATE = 8;

/**
 * The smallest ZIP writer that produces an archive `file-type` will open.
 *
 * Deflate rather than stored, because that is what a real producer writes and therefore what
 * `@tokenizer/inflate` actually has to do on the path under test. No data descriptors, no ZIP64,
 * no extra fields: every entry's sizes are known before it is written.
 */
function buildZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.content, 'utf8');
    const compressed = deflateRawSync(raw);
    const checksum = crc32(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    local.writeUInt16LE(ZIP_VERSION, 4);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    central.writeUInt16LE(ZIP_VERSION, 4);
    central.writeUInt16LE(ZIP_VERSION, 6);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

/**
 * A minimal but genuine `.docx`: the three parts a WordprocessingML package cannot omit.
 *
 * `[Content_Types].xml` goes first because that is where a reader looks for it, not because the
 * format requires the order.
 */
export function buildDocx(): Buffer {
  return buildZip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES_XML },
    { name: '_rels/.rels', content: RELS_XML },
    { name: 'word/document.xml', content: DOCUMENT_XML },
  ]);
}

/**
 * The same archive with an unparseable `[Content_Types].xml`.
 *
 * ADR 0024 records this degradation as measured rather than imagined: an office document from
 * an unusual producer whose content-types part cannot be read falls back to a plain
 * `application/zip`, which is why that type being on the allowlist is load-bearing rather than
 * incidental. This fixture is what keeps that sentence honest.
 */
export function buildDocxWithUnreadableContentTypes(): Buffer {
  return buildZip([
    { name: '[Content_Types].xml', content: '<Types><this is not xml at all' },
    { name: '_rels/.rels', content: RELS_XML },
    { name: 'word/document.xml', content: DOCUMENT_XML },
  ]);
}
