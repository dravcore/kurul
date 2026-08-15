import {
  DEFAULT_TRELLO_IMPORT_MAX_BYTES,
  IMPORT_CHUNK_SIZE,
  TRELLO_IMPORT_TRANSACTION_MAX_WAIT_MS,
  TRELLO_IMPORT_TRANSACTION_TIMEOUT_MS,
  chunked,
  readTrelloImportMaxBytes,
} from './import-config';

/**
 * Prisma's interactive-transaction default, quoted from the generated client rather than from
 * memory: `src/generated/prisma/index.d.ts` documents `transactionOptions` as
 * "maxWait ?= 2000 / timeout ?= 5000".
 */
const PRISMA_DEFAULT_TRANSACTION_TIMEOUT_MS = 5_000;

describe('import configuration', () => {
  describe('readTrelloImportMaxBytes', () => {
    const original = process.env.TRELLO_IMPORT_MAX_BYTES;

    afterEach(() => {
      if (original === undefined) delete process.env.TRELLO_IMPORT_MAX_BYTES;
      else process.env.TRELLO_IMPORT_MAX_BYTES = original;
    });

    it('is 20 MiB by default', () => {
      delete process.env.TRELLO_IMPORT_MAX_BYTES;

      expect(readTrelloImportMaxBytes()).toBe(20_971_520);
      expect(DEFAULT_TRELLO_IMPORT_MAX_BYTES).toBe(20_971_520);
    });

    it('reads the environment on every call, not once at import time', () => {
      process.env.TRELLO_IMPORT_MAX_BYTES = '4096';
      expect(readTrelloImportMaxBytes()).toBe(4096);

      // The property the multipart module depends on: a test that sets the variable before
      // building an app has to get the value it set, not the one this file saw first.
      process.env.TRELLO_IMPORT_MAX_BYTES = '8192';
      expect(readTrelloImportMaxBytes()).toBe(8192);
    });

    it('refuses a limit that is not a positive byte count', () => {
      process.env.TRELLO_IMPORT_MAX_BYTES = '0';
      expect(() => readTrelloImportMaxBytes()).toThrow(/positive byte count/);

      process.env.TRELLO_IMPORT_MAX_BYTES = '-1';
      expect(() => readTrelloImportMaxBytes()).toThrow(/positive byte count/);

      process.env.TRELLO_IMPORT_MAX_BYTES = 'plenty';
      expect(() => readTrelloImportMaxBytes()).toThrow(/expected an integer/);
    });

    it('is separate from ATTACHMENT_MAX_BYTES', () => {
      // The two limits measure different resources (disk versus heap). If one ever started
      // reading the other's variable, this is the only place that would notice.
      delete process.env.TRELLO_IMPORT_MAX_BYTES;
      process.env.ATTACHMENT_MAX_BYTES = '1234567';

      expect(readTrelloImportMaxBytes()).toBe(DEFAULT_TRELLO_IMPORT_MAX_BYTES);
      delete process.env.ATTACHMENT_MAX_BYTES;
    });
  });

  describe('the transaction budget', () => {
    it('is far above the Prisma default it exists to replace', () => {
      // 5 s is not a number this repository chose — it is what applies when nobody passes
      // `timeout`, and `PrismaService` passes only an adapter. A 500-card import walks into it.
      expect(TRELLO_IMPORT_TRANSACTION_TIMEOUT_MS).toBe(180_000);
      expect(TRELLO_IMPORT_TRANSACTION_TIMEOUT_MS).toBeGreaterThan(
        PRISMA_DEFAULT_TRANSACTION_TIMEOUT_MS,
      );
    });

    it('gives the work longer than it gives the wait for a connection', () => {
      // Two different clocks: `timeout` measures work, `maxWait` measures contention. Waiting
      // longer for a connection only makes a queued import fail later.
      expect(TRELLO_IMPORT_TRANSACTION_MAX_WAIT_MS).toBeLessThan(
        TRELLO_IMPORT_TRANSACTION_TIMEOUT_MS,
      );
    });
  });

  describe('chunked', () => {
    it('keeps a statement under Postgres 65535 bound parameters for the widest row', () => {
      // `ChecklistItem` is the widest row this import writes at six columns. The chunk size has
      // to leave that under the cap, or the ceiling comes back as an unreadable driver error.
      expect(IMPORT_CHUNK_SIZE * 6).toBeLessThan(65_535);
    });

    it('splits into runs of at most the chunk size', () => {
      const rows = Array.from({ length: 2_500 }, (_unused, index) => index);

      expect(chunked(rows, IMPORT_CHUNK_SIZE).map((chunk) => chunk.length)).toEqual([
        1000, 1000, 500,
      ]);
      expect(chunked(rows, IMPORT_CHUNK_SIZE).flat()).toEqual(rows);
    });

    it('yields nothing for an empty input', () => {
      // `createMany({ data: [] })` is a wasted round trip inside a transaction that is already
      // the longest-lived one in the API.
      expect(chunked([], IMPORT_CHUNK_SIZE)).toEqual([]);
    });
  });
});
