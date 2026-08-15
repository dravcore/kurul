import type { Readable } from 'node:stream';

/**
 * The attachment-storage port.
 *
 * Everything that stores a file depends on this interface, never on a concrete backend, so a
 * second one is a new class in this folder and nothing else. The shape copies `MailSender`
 * exactly (ADR 0022): a plain interface, plain adapter classes that are not `@Injectable()`, a
 * pure factory, a process-wide singleton with a reset hook, and a narrow `StorageService` as the
 * only thing the module exports.
 *
 * ## The one naming rule in this folder
 *
 * **No error thrown from this module may reuse one of multer's message constants.** Nest's
 * `transformException` switches on `error.message`, not on a type, so an error reading
 * `File too large` reaches the client as a `413` nothing in this code chose. The strings to stay
 * away from are multer's: `File too large`, `Too many files`, `Unexpected field`,
 * `Field name too long`, `Field value too long`, `Too many parts`, `Too many fields`. No
 * compiler notices a collision and no test can pin it, so this paragraph is the rule's only
 * carrier — see ADR 0022 and `audit/phase-3-plan.md` §5.
 */
export interface StorageBackend {
  /** Which backend this is; surfaced for diagnostics, never branched on in logic. */
  readonly backend: 'disk';
  /**
   * Whether a resolved `write` means the bytes are somewhere this deployment can read again.
   *
   * A separate bit rather than `backend === 'disk'`, for the reason `MailSender` keeps
   * `deliversMail` apart from `transport`: the day a second persisting backend exists, every
   * `=== 'disk'` check silently starts answering "no storage here" for a deployment that stores
   * files perfectly well.
   */
  readonly persistsFiles: boolean;
  /** Writes `bytes` at `key`, creating intermediate directories. Overwrites. */
  write(key: string, bytes: Buffer): Promise<void>;
  /** Opens `key` for reading. Rejects — before any stream exists — when the key is absent. */
  createReadStream(key: string): Promise<Readable>;
  /** Deletes `key`. Resolves when it was already absent; this is called from a sweep. */
  remove(key: string): Promise<void>;
  /** Every key currently held, with its mtime. Used only by the orphan sweep. */
  listKeys(): AsyncIterable<{ key: string; modifiedAt: Date }>;
  /** Releases resources. Idempotent. */
  close(): Promise<void>;
}
