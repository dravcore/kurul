import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Catches the failure mode that let `text-caption` sit in eleven call sites producing no CSS at
 * all (Task 3 of this phase): Tailwind drops an unrecognised utility candidate silently, so a
 * typo'd or never-defined class compiles clean, renders wrong, and fails no type check.
 *
 * The scan walks every `.tsx` under `app/` and `components/`, collects each `text-*`, `bg-*`,
 * `border-*`, `font-*` and `shadow-*` token (variants such as `md:`, `hover:`, `dark:` and
 * stacked combinations of them included), and asks Tailwind's own compiler whether the base
 * utility produces any CSS at all. A hand-maintained list of "Tailwind's known scale" would be
 * exactly the kind of copy that drifts from whatever `tailwindcss` version is actually installed
 * (`vitest.config.ts` pins none of this file's assumptions in code); compiling `app/globals.css`
 * (it already `@import`s Tailwind and declares `@theme inline`) asks the same engine
 * `next build` does, so the answer can never go stale on its own. This is the same technique
 * `app/globals-css-layers.test.ts` uses for the cascade; the compiler plumbing below is a smaller
 * copy of that file's, kept separate because importing one `.test.ts` from another would also
 * re-run its `describe` blocks.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const globalsPath = path.join(here, 'globals.css');

const require = createRequire(import.meta.url);
const tailwindDir = path.dirname(require.resolve('tailwindcss/package.json'));

function resolveStylesheet(id: string, base: string): string {
  if (id === 'tailwindcss') return path.join(tailwindDir, 'index.css');
  if (id.startsWith('tailwindcss/')) return path.join(tailwindDir, id.slice('tailwindcss/'.length));
  return path.resolve(base, id);
}

/** Builds `app/globals.css` and returns the CSS Tailwind emits for `candidates`, dropping every
 * candidate it does not recognise instead of erroring on it: the exact behaviour under test. */
async function compileCandidates(candidates: string[]): Promise<string> {
  const compiler = await compile(await readFile(globalsPath, 'utf8'), {
    base: path.dirname(globalsPath),
    async loadStylesheet(id: string, base: string) {
      let file = resolveStylesheet(id, base);
      if (!path.extname(file)) file += '.css';
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
    async loadModule() {
      throw new Error('globals.css is expected to load no JS plugins');
    },
  });
  return compiler.build(candidates);
}

/**
 * True once `css` contains a rule for the plain (no variant, no opacity) utility `className`.
 * Matches the CSS-escaped selector followed by a non-identifier character, so `.text-title`
 * cannot read as present merely because `.text-title-lg` compiled: one theme name being the
 * literal prefix of another is a real case in this file (`text-title` / `text-title-lg`,
 * `border-border` / `border-border-strong`), not a hypothetical.
 */
function resolves(css: string, className: string): boolean {
  const escaped = `.${className}`.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}(?![\\w-])`).test(css);
}

const SCAN_DIRS = ['app', 'components'];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
      continue;
    }
    // Test files are prose as much as they are code: a test title like "draws the empty column
    // its dashed border-strong outline" (components/board/board-column.test.tsx) names a token
    // in English sentence order, not as a call site, and a scanner that cannot tell the
    // difference would fail on a description instead of a bug.
    if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/**
 * Comments are prose in the same sense test titles are (`board-template-picker.tsx`'s own
 * `// \`border-signature\` is selection and nothing else` explains a decision, it is not a class
 * list).
 * Blanked rather than deleted, character for character with newlines kept, so every match index
 * taken afterwards still lands on its real source line. A `//` is only treated as a comment when
 * it opens the line: `components/ui/select.tsx` carries a data-URI with a literal `http://` in
 * the middle of a class list, and stripping from the first `//` found anywhere would swallow the
 * rest of that line's real classes.
 */
function blankComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(
      /^([ \t]*)\/\/.*$/gm,
      (line, indent: string) => indent + ' '.repeat(line.length - indent.length),
    );
}

/**
 * One `text-*` / `bg-*` / `border-*` / `font-*` / `shadow-*` token, variants (`hover:`, `dark:`,
 * stacked or not) and an optional opacity modifier included. The lookbehind's excluded set is
 * word characters, `.`, `/`, `,` and `-`: it admits `:` (every variant separator) and rejects
 * `-`, which is what keeps `border-border-strong` from also being read as a second, standalone
 * `border-strong` starting after its own first segment. It also rejects a leading `,`, which is
 * what keeps a raw CSS property name inside a sibling utility's arbitrary value (`transition-
 * [color,background-color,border-color,box-shadow,opacity]`) from being read as a `border-color`
 * class of its own: nothing this scanner is meant to catch is ever comma-separated.
 */
const CLASS_TOKEN_RE =
  /(?<![\w.,/-])(text|bg|border|font|shadow)-(\[[^\]]*\]|[a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(\d{1,3}|\[[^\]]*\]))?(?![\w-])/g;

interface Occurrence {
  bareClass: string;
  file: string;
  line: number;
}

/**
 * Every non-arbitrary occurrence in `app/` and `components/`, stripped to the bare utility
 * (variant and opacity modifier dropped) each is being asked to resolve.
 *
 * Arbitrary values (`bg-[length:1rem_1rem]`, `text-[10px]`) are excluded here, not merely allowed to
 * pass: Tailwind compiles them from the literal value the author wrote, so there is no catalogue
 * entry to miss and nothing this test's technique can check. Opacity modifiers (`bg-muted/40`)
 * are handled by dropping the modifier and resolving what remains: `/40` is never itself a
 * catalogue lookup, so keeping it in the candidate would ask the compiler a question this test
 * does not mean to ask.
 */
function collectOccurrences(): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(path.join(webRoot, dir))) {
      const original = readFileSync(file, 'utf8');
      const scannable = blankComments(original);
      const relative = path.relative(webRoot, file);
      for (const match of scannable.matchAll(CLASS_TOKEN_RE)) {
        const [, prefix, suffix] = match;
        if (prefix === undefined || suffix === undefined) continue;
        if (suffix.startsWith('[')) continue; // arbitrary value, exempt
        const line = original.slice(0, match.index).split('\n').length;
        occurrences.push({ bareClass: `${prefix}-${suffix}`, file: relative, line });
      }
    }
  }
  return occurrences;
}

describe('theme-covered utility classes', () => {
  let occurrences: Occurrence[];
  let css: string;

  beforeAll(async () => {
    occurrences = collectOccurrences();
    const candidates = [...new Set(occurrences.map((occurrence) => occurrence.bareClass))];
    css = await compileCandidates(candidates);
  }, 30_000);

  it('scanned at least one call site of every prefix under test', () => {
    // A prefix scoring zero call sites almost certainly means the regex broke, not that the
    // codebase stopped using it: every one of these five is in wide use today.
    const seen = new Set(occurrences.map((occurrence) => occurrence.bareClass.split('-')[0]));
    expect([...seen].sort()).toEqual(['bg', 'border', 'font', 'shadow', 'text']);
  });

  it('resolves every scanned class against @theme inline or Tailwind’s built-in scale', () => {
    const unresolved = occurrences
      .filter((occurrence) => !resolves(css, occurrence.bareClass))
      .map((occurrence) => `${occurrence.file}:${occurrence.line}  ${occurrence.bareClass}`)
      .sort();

    expect(unresolved).toEqual([]);
  });
});

/**
 * This project imports plain `tailwindcss`, with no animation plugin installed, so
 * `animate-in`/`animate-out` and every `fade-in-*`, `fade-out-*`, `zoom-in-*`, `zoom-out-*`,
 * `slide-in-from-*` and `slide-out-to-*` utility compiles to nothing at all: not an unresolved
 * candidate the scan above would catch (those still ask Tailwind to compile the bare prefix,
 * and `fade`/`zoom`/`slide` are not among `text-`/`bg-`/`border-`/`font-`/`shadow-`), just a
 * class string sitting on an element with no rule anywhere in the compiled sheet backing it.
 * P5 Task 1 replaced every real call site with keyframes bound through `data-slot`/`data-state`
 * (see `app/globals.css`); this scan is what stops the dead classes from coming back silently.
 *
 * `animate-spin` and `animate-pulse` are real Tailwind utilities and stay out of this list on
 * purpose: `animate-pulse` is gated in a later task of this phase and `animate-spin` is a later
 * task's own choice of spinner keyframe, neither this scan's concern.
 */
const DEAD_ANIMATION_CLASS_RE =
  /\b(animate-in|animate-out|fade-in-[\w-]+|fade-out-[\w-]+|zoom-in-[\w-]+|zoom-out-[\w-]+|slide-in-from-[\w-]+|slide-out-to-[\w-]+)\b/g;

describe('dead animation utility classes', () => {
  it('finds none of them left under app/ or components/', () => {
    const hits: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(path.join(webRoot, dir))) {
        const original = readFileSync(file, 'utf8');
        const scannable = blankComments(original);
        const relative = path.relative(webRoot, file);
        for (const match of scannable.matchAll(DEAD_ANIMATION_CLASS_RE)) {
          const line = original.slice(0, match.index).split('\n').length;
          hits.push(`${relative}:${line}  ${match[0]}`);
        }
      }
    }

    expect(hits.sort()).toEqual([]);
  });
});
