import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The tree-wide half of the cascade-layer repair.
 *
 * Until `app/globals.css` put its `* { border-color: var(--border) }` inside `@layer base`, an
 * unlayered author rule repainted every `border-*` utility Tailwind emits, so a border token
 * written at a call site drew the hairline grey instead. Moving that rule handed each call site
 * its own colour back at once, in forgotten places as much as in intended ones. Every call site
 * was read and decided; this file is that decision table in executable form.
 *
 * `border-border` and `divide-border` are deliberately not pinned to a file list here: they
 * resolve to the same `var(--border)` the wildcard was already painting, so they cannot produce
 * a surprise, and a card hairline is the most ordinary thing a new component adds.
 * `app/globals-css-layers.test.ts` is what proves they still resolve to that value.
 */

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const scanRoots = ['app', 'components', 'lib'];

/** `border-*` / `divide-*` suffixes that set width or style. Everything else names a colour. */
const nonColorSuffixes = new Set([
  '0',
  '2',
  '4',
  '8',
  't',
  'r',
  'b',
  'l',
  'x',
  'y',
  's',
  'e',
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  'none',
  'collapse',
  'separate',
  'reverse',
]);

/**
 * The leading lookbehind admits a variant's `:` and rejects `-`, which is what keeps
 * `var(--border)`, `bg-border` and `--normal-border` out of a scan for border *colours*. It also
 * rejects a leading `,`, which is what keeps the raw CSS property name inside a sibling
 * utility's arbitrary value (`transition-[color,background-color,border-color,box-shadow,
 * opacity]`) from reading as a `border-color` utility of its own: a real call site is never
 * comma-separated.
 */
const utilityPattern =
  /(?<![\w.,/-])(border|divide)-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\/\d+)?(?![\w-])/g;

/**
 * Every colour utility the sweep reviewed. Which token each one resolves to is proved against
 * the compiled stylesheet in `app/globals-css-layers.test.ts`; this list is about what the
 * source tree is allowed to ask for at all.
 */
const reviewedUtilities = [
  'border-border',
  'border-border-strong',
  'border-input',
  'border-signature',
  'border-destructive',
  'divide-border',
];

/**
 * The call sites of every utility whose painted colour actually changed when the wildcard moved
 * into `base`, plus `border-input`. `border-input` is here not because it changed: `--input` and
 * `--border` hold the same value in both themes. It is here because that equality is what makes
 * a wrong call site invisible today and visible the moment §3 moves one of the two.
 */
const stateTokenCallSites: Record<string, string[]> = {
  // Hover on a card or row, and the resting edge of an empty column's drop zone.
  'border-border-strong': [
    'components/board/board-column.tsx',
    'components/board/board-list.tsx',
    'components/board/board-template-picker.tsx',
    'components/task/task-card.tsx',
  ],
  // Selection only.
  'border-signature': [
    'components/board/board-template-picker.tsx',
    'components/task/task-card.tsx',
  ],
  // `aria-invalid="true"` only, and only on the four form primitives.
  'border-destructive': [
    'components/ui/button.tsx',
    'components/ui/input.tsx',
    'components/ui/select.tsx',
    'components/ui/textarea.tsx',
  ],
  // Form controls only: the four primitives and the two bare checkboxes that have no
  // component of their own yet. A read-only surface that merely looks like a field wears
  // `border-border`.
  'border-input': [
    'components/notification/notifications-list.tsx',
    'components/settings/notification-settings.tsx',
    'components/ui/button.tsx',
    'components/ui/input.tsx',
    'components/ui/select.tsx',
    'components/ui/textarea.tsx',
  ],
};

/**
 * A call site is code. Prose that names a token is not one, the comments explaining these very
 * decisions included, so comments come out before the scan. Line comments are only stripped when
 * they open the line, which is what keeps the `http://` inside `select.tsx`'s data URI from
 * swallowing the rest of that class list.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield full;
  }
}

async function collectCallSites(): Promise<Map<string, string[]>> {
  const byUtility = new Map<string, Set<string>>();
  for (const root of scanRoots) {
    for await (const file of sourceFiles(path.join(webRoot, root))) {
      const source = stripComments(await readFile(file, 'utf8'));
      const relative = path.relative(webRoot, file);
      for (const [, prefix = '', suffix = ''] of source.matchAll(utilityPattern)) {
        if (nonColorSuffixes.has(suffix) || /^[trblxyse]-\d+$/.test(suffix)) continue;
        const utility = `${prefix}-${suffix}`;
        const files = byUtility.get(utility) ?? new Set<string>();
        files.add(relative);
        byUtility.set(utility, files);
      }
    }
  }
  return new Map([...byUtility].map(([utility, files]) => [utility, [...files].sort()]));
}

describe('border colour utilities across apps/web', () => {
  let callSites: Map<string, string[]>;

  beforeAll(async () => {
    callSites = await collectCallSites();
  });

  it('draws every border from a reviewed design token', () => {
    expect([...callSites.keys()].sort()).toEqual([...reviewedUtilities].sort());
  });

  it.each(Object.entries(stateTokenCallSites))(
    'confines %s to its reviewed call sites',
    (utility, expected) => {
      expect(callSites.get(utility)).toEqual(expected);
    },
  );
});
