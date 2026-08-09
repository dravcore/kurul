/** UUIDv7 bound inside `@[Name](userId)` mention markup. */
const MENTION_RE =
  /@\[([^\]]*)\]\(([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\)/gi;

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
