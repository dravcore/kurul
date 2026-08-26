import { envInt } from '../common/env';

/**
 * Largest Trello export this instance will accept, in bytes. 20971520 = 20 MiB.
 *
 * **Deliberately not `ATTACHMENT_MAX_BYTES`, and deliberately not derived from it.** That one is
 * a *disk* ceiling: bytes land in a file and stay there. This one is a *heap* ceiling: the body
 * is buffered, `JSON.parse`d, and the parsed object graph is several times the size of the bytes
 * that produced it. Two numbers that measure different resources sharing a value would be a
 * coincidence, and coupling them would make raising one silently raise the other.
 *
 * It also has nothing to do with `StorageService`. An import writes `LINK` rows and stores no
 * bytes, so it works on an instance with no `STORAGE_PATH` — where `StorageService.write` answers
 * 503. Resolving this limit through storage would join two features that have no relationship.
 *
 * It must stay below the reverse proxy's body limit with room for the multipart envelope;
 * `storage/two-layer-limit.spec.ts` is what fails the build if it stops doing so.
 */
export const DEFAULT_TRELLO_IMPORT_MAX_BYTES = 20_971_520;

/**
 * How long the import transaction may run.
 *
 * Prisma's interactive-transaction default is **5 seconds** — documented in the generated client
 * (`src/generated/prisma/index.d.ts`, "The default values for transactionOptions … timeout ?=
 * 5000") and never overridden anywhere in this repository: `PrismaService` passes only an
 * adapter. So the limit an import runs into today is an unconfigured default nobody chose, and it
 * is the exact wall a 500-card import walks into — as a `P2028` about a transaction "already
 * closed", which is not a message anyone reads as "your board was too big".
 *
 * 180 s is 1.5× the roadmap's two-minute budget: enough slack that a slow disk fails the
 * *measurement* rather than the *request*, and short enough that a pathological export cannot
 * hold a connection open for the afternoon.
 */
export const TRELLO_IMPORT_TRANSACTION_TIMEOUT_MS = 180_000;

/**
 * How long the call waits for a free connection from the pool before giving up.
 *
 * A different clock from the one above, which is why it is a different number: this one is
 * contention, that one is work. Prisma's default here is 2 s, which is short for a request that
 * has already spent time parsing 20 MiB — but this is still the value that should stay small,
 * because waiting longer for a connection only makes a queued import fail later.
 */
export const TRELLO_IMPORT_TRANSACTION_MAX_WAIT_MS = 10_000;

/**
 * Rows per `createMany` call.
 *
 * Postgres caps a single statement at 65535 bound parameters. `ChecklistItem` carries six
 * columns, so an unbounded `createMany` over a large board's items is the one place that ceiling
 * is reachable — and it would arrive as a driver error nobody could map back to "your board had a
 * lot of checklists". Chunking is cheap and removes the ceiling from the reasoning entirely.
 */
export const IMPORT_CHUNK_SIZE = 1_000;

/**
 * Reads the import size limit from the environment, the same shape `readStorageConfig` uses.
 *
 * Resolved per call rather than at module load, so a test — or an operator restarting the
 * process — gets the value that is actually set rather than the one that was set when this file
 * was first imported.
 */
export function readTrelloImportMaxBytes(): number {
  const maxBytes = envInt('TRELLO_IMPORT_MAX_BYTES', DEFAULT_TRELLO_IMPORT_MAX_BYTES);
  if (maxBytes <= 0) {
    throw new Error(
      `Invalid TRELLO_IMPORT_MAX_BYTES: expected a positive byte count, received "${maxBytes}"`,
    );
  }
  return maxBytes;
}

/**
 * Largest number of Trello cards one import will plan, counted before archived or malformed
 * ones are filtered out.
 *
 * `TRELLO_IMPORT_MAX_BYTES` bounds how large the parsed export can be, not how many rows it can
 * ask this API to write. A 20 MiB export can still be several hundred thousand tiny cards, each
 * one a row `TrelloImportService` would otherwise carry into the transaction (SEC-04): a board
 * nobody can scroll, and a `createMany` sequence sized to match. 50000 is comfortably above any
 * board a person maintains by hand and comfortably below the size that turns the transaction
 * into the resource problem `TRELLO_IMPORT_TRANSACTION_TIMEOUT_MS` exists for.
 */
export const DEFAULT_TRELLO_IMPORT_MAX_CARDS = 50_000;

/**
 * Largest number of Trello lists (`Column` rows) one import will plan, counted the same way
 * `DEFAULT_TRELLO_IMPORT_MAX_CARDS` is: before `closed` or unnamed ones are filtered out.
 */
export const DEFAULT_TRELLO_IMPORT_MAX_LISTS = 5_000;

/** `readTrelloImportMaxBytes`'s own shape, for the card ceiling. */
export function readTrelloImportMaxCards(): number {
  const maxCards = envInt('TRELLO_IMPORT_MAX_CARDS', DEFAULT_TRELLO_IMPORT_MAX_CARDS);
  if (maxCards <= 0) {
    throw new Error(
      `Invalid TRELLO_IMPORT_MAX_CARDS: expected a positive count, received "${maxCards}"`,
    );
  }
  return maxCards;
}

/** `readTrelloImportMaxBytes`'s own shape, for the list ceiling. */
export function readTrelloImportMaxLists(): number {
  const maxLists = envInt('TRELLO_IMPORT_MAX_LISTS', DEFAULT_TRELLO_IMPORT_MAX_LISTS);
  if (maxLists <= 0) {
    throw new Error(
      `Invalid TRELLO_IMPORT_MAX_LISTS: expected a positive count, received "${maxLists}"`,
    );
  }
  return maxLists;
}

/** Splits `rows` into runs of at most `size`. An empty input yields nothing at all. */
export function chunked<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    chunks.push(rows.slice(start, start + size));
  }
  return chunks;
}
