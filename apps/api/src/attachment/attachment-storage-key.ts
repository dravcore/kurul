/**
 * The storage key for an attachment id.
 *
 * Derived from the row's own UUIDv7 and nothing else — the user's filename never reaches a path
 * segment, which is what makes traversal unexpressible rather than filtered (K9 / ADR 0024).
 *
 * Two levels of fan-out from the id's leading hex so one directory never holds every file on
 * the instance. The prefix comes from the timestamp half of a UUIDv7, so keys written close in
 * time land in the same directory — which is what makes the sweep's `readdir` sequential rather
 * than scattered.
 */
export function storageKeyFor(attachmentId: string): string {
  const hex = attachmentId.replace(/-/g, '');
  return `${hex.slice(0, 2)}/${hex.slice(2, 4)}/${attachmentId}`;
}
