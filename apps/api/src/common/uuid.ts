/**
 * Every id in the product is a UUIDv7 (`CLAUDE.md`) — this module is the single place that
 * spells out what that means, so pipes, DTO validators and ad-hoc constraints cannot drift.
 */

import { IsUUID, type ValidationOptions } from 'class-validator';

/** `class-validator` version argument for UUIDv7. */
export const UUID_VERSION = '7' as const;

/** RFC 9562 layout with the version nibble pinned to 7 and an RFC 4122 variant nibble. */
export const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && UUID_V7_REGEX.test(value);
}

/**
 * DTO field decorator for a UUIDv7 value — the `class-validator` counterpart to the
 * `ParseUuidV7Pipe` used for path params. Wraps `@IsUUID(UUID_VERSION)` so no call site has to
 * spell out the version literal (and risk drifting from it, e.g. to `'4'`).
 */
export const IsUuidV7 = (validationOptions?: ValidationOptions): PropertyDecorator =>
  IsUUID(UUID_VERSION, validationOptions);
