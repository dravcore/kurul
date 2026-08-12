/**
 * Longest display name the picker will bind into a mention.
 *
 * The bound is what keeps the pattern linear, not a product rule about names. Unbounded,
 * `[^\]]*` rescans to the end of the body from every `@[` that never closes, so a 10 000
 * character comment — the `CreateCommentDto` ceiling — of repeated `@[\` costs on the order
 * of 10^8 character comparisons on the event loop, once per request. Capping the run makes
 * the worst case linear in the body length. 200 is far past any real name and still leaves
 * the scan bounded.
 */
const MAX_MENTION_NAME = 200;

/** UUIDv7 bound inside `@[Name](userId)` mention markup. */
const MENTION_RE = new RegExp(
  `@\\[([^\\]]{0,${MAX_MENTION_NAME}})\\]\\(([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\\)`,
  'gi',
);

/**
 * Extract unique user ids from `@[Name](uuid)` mention tokens in comment bodies.
 * Invalid or non-UUIDv7 ids are ignored by the regex.
 */
export function parseMentions(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(MENTION_RE)) {
    ids.add(match[2]!);
  }
  return [...ids];
}
