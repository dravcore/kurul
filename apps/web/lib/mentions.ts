/**
 * Longest display name the picker will bind into a mention.
 *
 * Kept in sync with `apps/api/src/common/mentions/parse-mentions.ts`. Unbounded,
 * `[^\]]*` rescans to the end of the body from every `@[` that never closes, so a
 * 10 000 character comment — the `CreateCommentDto` ceiling — of repeated `@[\`
 * costs on the order of 10^8 character comparisons on the main thread, once per
 * viewer that tokenizes the body. Capping the run makes the worst case linear.
 */
const MAX_MENTION_NAME = 200;

/** UUIDv7 bound inside `@[Name](userId)` mention markup. */
const MENTION_RE = new RegExp(
  `@\\[([^\\]]{0,${MAX_MENTION_NAME}})\\]\\(([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\\)`,
  'gi',
);

export type MentionToken =
  { kind: 'text'; text: string } | { kind: 'mention'; name: string; userId: string };

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

/** Build the stored mention token for a workspace member. */
export function formatMentionMarkup(name: string, userId: string): string {
  return `@[${name}](${userId})`;
}

/**
 * Detect an in-progress `@query` immediately before the caret (not existing markup).
 */
export function getActiveMentionQuery(
  value: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = value.slice(0, cursor);
  const atIndex = before.lastIndexOf('@');
  if (atIndex < 0) return null;
  if (before[atIndex + 1] === '[') return null;
  if (atIndex > 0) {
    const prev = before[atIndex - 1]!;
    if (!/[\s([{]/.test(prev)) return null;
  }
  const query = before.slice(atIndex + 1);
  if (/[\s\n]/.test(query)) return null;
  return { start: atIndex, query };
}

/**
 * Insert `@[Name](userId)` at the caret, replacing an active `@query` when present.
 */
export function insertMentionMarkup(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  name: string,
  userId: string,
): { value: string; cursor: number } {
  const markup = `${formatMentionMarkup(name, userId)} `;
  const active = getActiveMentionQuery(value, selectionStart);
  if (active) {
    const next = `${value.slice(0, active.start)}${markup}${value.slice(selectionEnd)}`;
    return { value: next, cursor: active.start + markup.length };
  }
  const next = `${value.slice(0, selectionStart)}${markup}${value.slice(selectionEnd)}`;
  return { value: next, cursor: selectionStart + markup.length };
}

/** Split a comment body into plain text and mention tokens for chip rendering. */
export function tokenizeMentions(body: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(MENTION_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ kind: 'text', text: body.slice(lastIndex, index) });
    }
    tokens.push({ kind: 'mention', name: match[1] ?? '', userId: match[2]! });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < body.length) {
    tokens.push({ kind: 'text', text: body.slice(lastIndex) });
  }
  return tokens;
}
