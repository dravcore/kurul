import { ConflictException } from '@nestjs/common';

/**
 * Deliberately kept even though `AllExceptionsFilter` already maps P2002 to a 409.
 *
 * The global mapping is the safety net and answers with a generic "Resource already exists".
 * Call sites that know which constraint tripped use this to keep the status identical while
 * naming the actual collision ("User is already assigned to this task") — do not collapse the
 * two, the status code is the contract but the message is what a human reads.
 *
 * Lives in the task module because its only callers are the task join-table writes. Move it
 * to `common/` the moment a second module needs it, not before.
 */
export function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  );
}

/**
 * Runs a write that can trip a unique constraint and re-labels only that failure.
 *
 * `message` is the constraint-specific wording the caller wants a human to read; every other
 * error is rethrown untouched so a genuine failure is never disguised as a conflict.
 */
export async function conflictOnUniqueViolation<T>(
  write: () => Promise<T>,
  message: string,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      throw new ConflictException(message);
    }
    throw error;
  }
}
