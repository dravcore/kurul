import { readFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

// jsdom computes no Tailwind output and no cascade layers, so a render test cannot see which
// border-color actually wins. This suite compiles app/globals.css with the same Tailwind the
// build uses and resolves the cascade over the real output instead.

// `new URL('./globals.css', import.meta.url)` is not usable here: Vite rewrites that exact
// pattern into an asset reference, which resolves to a non-file URL under the test runner.
const globalsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'globals.css');
const webRoot = path.dirname(path.dirname(globalsPath));
const require = createRequire(import.meta.url);
const tailwindDir = path.dirname(require.resolve('tailwindcss/package.json'));

type Declaration = { property: string; value: string };

type StyleRule = {
  selector: string;
  layer: string | null;
  /** The at-rule preludes this rule is nested inside, outermost first. */
  atRules: string[];
  declarations: Declaration[];
  order: number;
};

type Stylesheet = {
  rules: StyleRule[];
  /** Layer names weakest first. An unlayered rule outranks every entry in this list. */
  layerOrder: string[];
};

function resolveStylesheet(id: string, base: string) {
  if (id === 'tailwindcss') return path.join(tailwindDir, 'index.css');
  if (id.startsWith('tailwindcss/')) return path.join(tailwindDir, id.slice('tailwindcss/'.length));
  return path.resolve(base, id);
}

async function compileGlobals(candidates: string[]): Promise<string> {
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

/** Index of the next character after the block opened by the `{` at `open`. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    const ch = css.charAt(i);
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return css.length - 1;
}

/** Index of the closing quote of the string opened at `start`. */
function skipString(css: string, start: number): number {
  const quote = css.charAt(start);
  for (let i = start + 1; i < css.length; i += 1) {
    if (css.charAt(i) === '\\') i += 1;
    else if (css.charAt(i) === quote) return i;
  }
  return css.length - 1;
}

/** Declarations written directly in `body`, ignoring any nested rule's own declarations. */
function topLevelDeclarations(body: string): Declaration[] {
  const declarations: Declaration[] = [];
  let buffer = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body.charAt(i);
    if (ch === '"' || ch === "'") {
      const end = skipString(body, i);
      buffer += body.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '{') {
      i = blockEnd(body, i);
      buffer = '';
      continue;
    }
    if (ch === ';') {
      const colon = buffer.indexOf(':');
      if (colon > 0) {
        declarations.push({
          property: buffer.slice(0, colon).trim(),
          value: buffer.slice(colon + 1).trim(),
        });
      }
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  return declarations;
}

/** One level of nesting: the `@layer` in force there, and the at-rule that opened it. */
type Frame = { layer: string | null; at: string | null };

function parseStylesheet(css: string): Stylesheet {
  const rules: StyleRule[] = [];
  const layerOrder: string[] = [];
  const stack: Frame[] = [];
  const currentLayer = (): string | null => stack.at(-1)?.layer ?? null;
  const enclosingAtRules = (): string[] =>
    stack.map((frame) => frame.at).filter((at): at is string => at !== null);
  let buffer = '';
  let order = 0;

  for (let i = 0; i < css.length; i += 1) {
    const ch = css.charAt(i);

    if (ch === '"' || ch === "'") {
      const end = skipString(css, i);
      buffer += css.slice(i, end + 1);
      i = end;
      continue;
    }

    if (ch === '{') {
      const prelude = buffer.trim();
      buffer = '';
      if (prelude.startsWith('@layer')) {
        const name = prelude.slice('@layer'.length).trim();
        if (name && !layerOrder.includes(name)) layerOrder.push(name);
        stack.push({ layer: name || currentLayer(), at: null });
        continue;
      }
      if (prelude.startsWith('@')) {
        // @media / @supports / @keyframes: the enclosing layer carries through.
        if (prelude.startsWith('@keyframes')) {
          i = blockEnd(css, i);
          continue;
        }
        stack.push({ layer: currentLayer(), at: prelude });
        continue;
      }
      const end = blockEnd(css, i);
      rules.push({
        selector: prelude,
        layer: currentLayer(),
        atRules: enclosingAtRules(),
        declarations: topLevelDeclarations(css.slice(i + 1, end)),
        order: (order += 1),
      });
      i = end;
      continue;
    }

    if (ch === '}') {
      stack.pop();
      buffer = '';
      continue;
    }

    if (ch === ';') {
      const statement = buffer.trim();
      if (statement.startsWith('@layer')) {
        for (const name of statement.slice('@layer'.length).split(',')) {
          const trimmed = name.trim();
          if (trimmed && !layerOrder.includes(trimmed)) layerOrder.push(trimmed);
        }
      }
      buffer = '';
      continue;
    }

    buffer += ch;
  }

  return { rules, layerOrder };
}

function layerRank(sheet: Stylesheet, layer: string | null): number {
  if (layer === null) return sheet.layerOrder.length;
  const index = sheet.layerOrder.indexOf(layer);
  return index === -1 ? sheet.layerOrder.length : index;
}

/**
 * The declared value that wins for an element whose only class is `className`, following the
 * cascade in the order the spec applies it: layer first, then specificity, then source order.
 */
function winningValue(sheet: Stylesheet, className: string, property: string): string | undefined {
  const applicable = sheet.rules
    .map((rule) => ({
      rule,
      specificity: rule.selector === '*' ? 0 : rule.selector === `.${className}` ? 1 : -1,
    }))
    .filter(({ rule, specificity }) => {
      if (specificity < 0) return false;
      return rule.declarations.some((declaration) => declaration.property === property);
    });

  let winner: (typeof applicable)[number] | undefined;
  for (const candidate of applicable) {
    if (winner === undefined) {
      winner = candidate;
      continue;
    }
    const byLayer = layerRank(sheet, candidate.rule.layer) - layerRank(sheet, winner.rule.layer);
    const bySpecificity = candidate.specificity - winner.specificity;
    const byOrder = candidate.rule.order - winner.rule.order;
    if (
      byLayer > 0 ||
      (byLayer === 0 && (bySpecificity > 0 || (bySpecificity === 0 && byOrder > 0)))
    ) {
      winner = candidate;
    }
  }

  // Last one wins within a rule, so the trailing match is the one that applies.
  return winner?.rule.declarations.filter((declaration) => declaration.property === property).at(-1)
    ?.value;
}

/**
 * The value that wins for `property` on an element carrying every class in `classNames` at once
 * (e.g. `class="text-title font-strong"`), each contributed by its own single-class Tailwind
 * utility rule. Every candidate here has specificity 1 (one class, no combinator), so a tie on
 * layer falls to source order exactly as `winningValue` already resolves it: the later utility
 * in Tailwind's compiled order wins outright, with no signal from either utility's use of a CSS
 * custom-property default to fall back on.
 */
function winningValueAmong(
  sheet: Stylesheet,
  classNames: string[],
  property: string,
): string | undefined {
  const applicable = sheet.rules
    .filter((rule) => classNames.some((className) => rule.selector === `.${className}`))
    .filter((rule) => rule.declarations.some((declaration) => declaration.property === property));

  let winner: StyleRule | undefined;
  for (const candidate of applicable) {
    if (winner === undefined) {
      winner = candidate;
      continue;
    }
    const byLayer = layerRank(sheet, candidate.layer) - layerRank(sheet, winner.layer);
    const byOrder = candidate.order - winner.order;
    if (byLayer > 0 || (byLayer === 0 && byOrder > 0)) {
      winner = candidate;
    }
  }

  return winner?.declarations.filter((declaration) => declaration.property === property).at(-1)
    ?.value;
}

function requireRule(
  sheet: Stylesheet,
  described: string,
  predicate: (rule: StyleRule) => boolean,
): StyleRule {
  const found = sheet.rules.find(predicate);
  if (found === undefined) throw new Error(`the compiled CSS is missing ${described}`);
  return found;
}

/**
 * Every element a keyboard can land on whose own class string could outrank the base outline:
 * the four form primitives, which until Phase 4 each carried an `outline-none` next to a ring
 * pair of their own, the dropdown rows, which carried `outline-hidden` while their `bg-accent`
 * step was read as the indicator, the shell `main`, which is where the skip link lands, and the
 * task panel's heading, which a keyboard user reaches by pressing Enter on a task card, and the
 * popover surface and the picker rows inside it, which a large workspace's assignee and label
 * lists moved behind. The panel heading and the shell `main` each carried a suppressor as a
 * programmatic focus container until the phase keyboard tour measured both of them matching
 * `:focus-visible` in Chromium and Firefox. Both utilities
 * compile into `utilities`, which outranks `base`, so either one leaves the element focusing
 * with nothing drawn at all: in Chromium a `:focus-visible` element under that suppressor
 * computes `outline-style: none`. The scan reads the whole source rather than the class strings
 * alone, so a comment in one of these files names the utility as `outline-*` instead of
 * spelling it.
 */
const singleIndicatorTargets = [
  'components/layout/app-shell.tsx',
  'components/task/searchable-picker.tsx',
  'components/task/task-panel.tsx',
  'components/ui/button.tsx',
  'components/ui/dropdown-menu.tsx',
  'components/ui/input.tsx',
  'components/ui/popover.tsx',
  'components/ui/select.tsx',
  'components/ui/textarea.tsx',
];

const borderUtilities = {
  'border-border': 'var(--border)',
  'border-input': 'var(--input)',
  'border-signature': 'var(--signature)',
  'border-destructive': 'var(--destructive)',
  'border-border-strong': 'var(--border-strong)',
} as const;

/**
 * The state borders the layer move brought back, each with the condition it is supposed to wait
 * for. Their whole risk is drawing at the wrong moment rather than not drawing at all: an
 * `aria-invalid` variant that matched any value of the attribute would put a red edge on every
 * valid field the app marks `aria-invalid="false"`.
 */
const stateVariants = {
  'focus-within:border-border-strong': { suffix: ':focus-within', value: 'var(--border-strong)' },
  'hover:border-border-strong': { suffix: ':hover', value: 'var(--border-strong)' },
  'aria-invalid:border-destructive': {
    suffix: '[aria-invalid="true"]',
    value: 'var(--destructive)',
  },
} as const;

/** The compiled selector for `className`, with Tailwind's `\` before each character a bare
 * class name cannot hold. */
function escapeClass(className: string): string {
  return `.${className.replaceAll(/[:/[\]]/g, (character) => `\\${character}`)}`;
}

/**
 * The body of the sole `@media` block whose prelude is `query`, braces excluded. Counts every
 * textual occurrence of `query` in the compiled sheet rather than taking the first: a candidate
 * list that ever grows a Tailwind-emitted `forced-colors:` or `contrast-more:` variant would
 * compile that variant's own `@media` block under the same prelude text, and the first-match
 * lookup this replaced would silently hand this function whichever of the two came first instead
 * of failing.
 */
function mediaBody(query: string): string {
  let count = 0;
  let start = -1;
  for (let index = css.indexOf(query); index !== -1; index = css.indexOf(query, index + 1)) {
    count += 1;
    if (start === -1) start = index;
  }
  if (count !== 1) {
    throw new Error(
      `the compiled CSS has \`${query}\` ${count} time(s), expected exactly one unambiguous block`,
    );
  }
  const open = css.indexOf('{', start);
  return css.slice(open + 1, blockEnd(css, open));
}

/** The selectors a comma-separated prelude lists, in the order it lists them. */
function selectorParts(rule: StyleRule): string[] {
  return rule.selector.split(',').map((part) => part.trim());
}

/** The body of the sole `@keyframes name` block in the compiled sheet, braces excluded.
 * `parseStylesheet` above deliberately skips over every `@keyframes` block (`blockEnd` on its
 * prelude) rather than parsing its `from`/`to` steps as rules, so reading one back has to go
 * around it and index into the raw compiled text directly, the same way `mediaBody` does for
 * `@media`. */
function keyframeBody(name: string): string {
  const marker = `@keyframes ${name}`;
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`the compiled CSS has no @keyframes ${name}`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, blockEnd(css, open));
}

/** Every `@media (prefers-reduced-motion: reduce)` block's body, concatenated. Unlike `mediaBody`
 * above, this does not demand exactly one: `app/globals.css` carries several, each scoped
 * narrowly to the motion pattern beside it (the global transition-property drop, the column
 * stagger's twin, the drawer's, and the dialog/menu ones this suite checks), so reading "the"
 * reduced-motion block is reading all of them at once. */
function reducedMotionBody(): string {
  const query = '@media (prefers-reduced-motion: reduce)';
  let body = '';
  for (
    let index = css.indexOf(query);
    index !== -1;
    index = css.indexOf(query, index + query.length)
  ) {
    const open = css.indexOf('{', index);
    body += `${css.slice(open + 1, blockEnd(css, open))}\n`;
  }
  return body;
}

/** Every non-test `.ts`/`.tsx` under `dir`, recursively. A test file is prose as much as it is
 * code (a title can name the very class the scan forbids), and Tailwind does not scan them
 * either, so they are not part of what ships. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
      continue;
    }
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

let sheet: Stylesheet;
let css: string;

beforeAll(async () => {
  css = await compileGlobals([
    ...Object.keys(borderUtilities),
    ...Object.keys(stateVariants),
    'divide-border',
    'dark:bg-accent',
    'focus-visible:-outline-offset-2',
    'text-title',
    'text-title-lg',
    'font-semibold',
    'font-strong',
  ]);
  sheet = parseStylesheet(css);
}, 30_000);

describe('globals.css cascade layers', () => {
  it('emits Tailwind utilities into a layer that outranks base', () => {
    expect(sheet.layerOrder).toContain('base');
    expect(sheet.layerOrder).toContain('utilities');
    expect(sheet.layerOrder.indexOf('utilities')).toBeGreaterThan(sheet.layerOrder.indexOf('base'));
  });

  it('keeps the wildcard border-color as the fallback for elements with no border utility', () => {
    const wildcard = requireRule(sheet, 'the `*` border-color fallback', (rule) => {
      return (
        rule.selector === '*' &&
        rule.declarations.some((declaration) => declaration.property === 'border-color')
      );
    });
    expect(wildcard.declarations.at(-1)?.value).toBe('var(--border)');

    // Preflight resets the same property through the `border` shorthand, so the fallback only
    // survives the move into `base` by landing after it in that layer.
    const preflightReset = requireRule(sheet, "preflight's `border` reset", (rule) => {
      return (
        rule.selector.split(',').some((part) => part.trim() === '*') &&
        rule.declarations.some((declaration) => declaration.property === 'border')
      );
    });
    expect(layerRank(sheet, wildcard.layer)).toBeGreaterThanOrEqual(
      layerRank(sheet, preflightReset.layer),
    );
    expect(wildcard.order).toBeGreaterThan(preflightReset.order);
  });

  it.each(Object.entries(borderUtilities))('lets %s draw its own token', (className, expected) => {
    expect(winningValue(sheet, className, 'border-color')).toBe(expected);
  });

  it.each(Object.entries(stateVariants))(
    'draws %s only in its own state, above the wildcard',
    (className, { suffix, value }) => {
      const escaped = escapeClass(className);
      const rule = requireRule(sheet, `a rule for ${className}`, (candidate) => {
        return candidate.selector.startsWith(escaped);
      });

      expect(rule.selector).toBe(`${escaped}${suffix}`);
      expect(rule.declarations.at(-1)).toEqual({ property: 'border-color', value });
      expect(layerRank(sheet, rule.layer)).toBeGreaterThan(layerRank(sheet, 'base'));
    },
  );

  // docs/design.md §5: hover motion and hover-only affordances are gated on a real pointer, so
  // a tapped card does not keep the hover edge until something else is tapped.
  it('gates the hover border behind a hover-capable pointer', () => {
    const open = css.indexOf('{', css.indexOf('@media (hover: hover)'));
    expect(open).toBeGreaterThan(0);

    const gate = css.slice(open, blockEnd(css, open) + 1);
    expect(gate).toContain('.hover\\:border-border-strong:hover');
  });

  // `divide-*` compiles under `:where()`, which zeroes its specificity. Only the layer order
  // keeps it ahead of the wildcard, so it is the one border utility that would still lose if
  // the `*` rule ever went back to being unlayered.
  it('keeps divide-border ahead of the wildcard despite :where() zero specificity', () => {
    const divide = requireRule(sheet, 'a rule for divide-border', (rule) => {
      return rule.selector.includes('.divide-border');
    });

    expect(divide.declarations.at(-1)).toEqual({
      property: 'border-color',
      value: 'var(--border)',
    });
    expect(layerRank(sheet, divide.layer)).toBeGreaterThan(layerRank(sheet, 'base'));
  });

  // The keyboard baseline is one mark: 2px --ring at 2px offset (docs/design.md §5). It is an
  // author rule in `base` like every other, which is only safe because no keyboard-reachable
  // control carries a ring pair or an outline suppressor of its own any more. The utilities that
  // still suppress it sit on containers that take focus by script rather than by Tab, an arrow
  // key or a link; the `it.each` below is what keeps them off everything else.
  it('layers the :focus-visible outline into base', () => {
    const focus = sheet.rules.filter((rule) => rule.selector === ':focus-visible');
    expect(focus).not.toHaveLength(0);
    for (const rule of focus) {
      expect(rule.layer).toBe('base');
      expect(rule.declarations).toContainEqual({
        property: 'outline',
        value: '2px solid var(--ring)',
      });
    }
  });

  // An invalid field that is focused keeps one mark too, recoloured, rather than growing a
  // second one beside it.
  it('recolours that outline for a focused invalid field', () => {
    const rule = requireRule(sheet, 'an aria-invalid focus outline colour', (candidate) => {
      return candidate.selector.replaceAll(/['"]/g, '') === '[aria-invalid=true]:focus-visible';
    });

    expect(rule.layer).toBe('base');
    expect(rule.declarations).toContainEqual({
      property: 'outline-color',
      value: 'var(--destructive)',
    });
  });

  // The skip link's landing (components/layout/app-shell.tsx) is the one focus target that fills
  // the shell, and the row it sits in is `overflow-hidden`, so an outline drawn 2px outside it is
  // clipped away. The utility pulls the same single mark inside the region rather than
  // suppressing it, which only works while it outranks the offset `base` declares.
  it('pulls the shell main outline inside the region instead of suppressing it', () => {
    const escaped = escapeClass('focus-visible:-outline-offset-2');
    const inset = requireRule(sheet, `a rule for ${escaped}`, (rule) => {
      return rule.selector.startsWith(escaped);
    });

    expect(inset.selector).toBe(`${escaped}:focus-visible`);
    expect(inset.declarations.at(-1)).toEqual({
      property: 'outline-offset',
      value: 'calc(2px * -1)',
    });
    expect(layerRank(sheet, inset.layer)).toBeGreaterThan(layerRank(sheet, 'base'));
  });

  /**
   * Why the invalid ring left the four primitives (ledger Ruling 11) instead of being kept as the
   * task brief first wrote it. Both candidates are compiled here precisely because no source file
   * carries them any more: a ring colour is only a custom property in this Tailwind, and the ring
   * is painted by the width utility's `box-shadow`, so the class the primitives kept had nothing
   * left to colour once the width went. This holds that reasoning to the compiler rather than to
   * a report, and a Tailwind release that starts painting a bare ring colour fails here rather
   * than by quietly putting a second mark on a focused invalid field.
   */
  it('paints nothing for a ring colour that has no ring width beside it', async () => {
    const compiled = parseStylesheet(
      await compileGlobals(['aria-invalid:ring-destructive/20', 'ring-[3px]']),
    );
    const rulesFor = (className: string): StyleRule[] =>
      compiled.rules.filter((rule) => rule.selector.startsWith(escapeClass(className)));

    const colourOnly = rulesFor('aria-invalid:ring-destructive/20');
    expect(colourOnly).not.toHaveLength(0);
    for (const rule of colourOnly) {
      expect(rule.declarations.map((declaration) => declaration.property)).toEqual([
        '--tw-ring-color',
      ]);
    }

    const width = rulesFor('ring-[3px]').flatMap((rule) => {
      return rule.declarations.map((declaration) => declaration.property);
    });
    expect(width).toContain('--tw-ring-shadow');
    expect(width).toContain('box-shadow');
  }, 30_000);

  it.each(singleIndicatorTargets)('leaves no outline suppressor on %s', async (file) => {
    expect(await readFile(path.join(webRoot, file), 'utf8')).not.toMatch(
      /\boutline-(none|hidden)\b/,
    );
  });

  /**
   * docs/design.md §5 draws the focus indicator once and instantly, and calls a keyboard-
   * initiated action the one case that gets no motion at all. Tailwind v4 puts `outline-color`
   * inside `transition-colors` (v3 did not), so any element wearing that shortcut fades its
   * outline from `currentColor` to copper over the transition duration while the width and
   * offset appear at once: the browser pass traced eighteen intermediate colours over 150ms on a
   * sidebar nav link in dark. `transition-all` has the same effect for the same reason, which is
   * what this test used to check on `components/ui/button.tsx` alone.
   *
   * The property list is compiled rather than quoted so this stays true against whatever
   * Tailwind is installed: a release that drops `outline-color` from the shortcut again turns
   * the scan below from a rule into dead weight, and this is where that shows up.
   */
  it('still compiles outline-color into transition-colors and transition-all', async () => {
    const compiled = parseStylesheet(await compileGlobals(['transition-colors', 'transition-all']));
    const shortcut = requireRule(compiled, 'a rule for transition-colors', (rule) => {
      return rule.selector === '.transition-colors';
    });
    expect(
      shortcut.declarations.find((entry) => entry.property === 'transition-property')?.value,
    ).toContain('outline-color');

    const all = requireRule(compiled, 'a rule for transition-all', (rule) => {
      return rule.selector === '.transition-all';
    });
    expect(all.declarations.find((entry) => entry.property === 'transition-property')?.value).toBe(
      'all',
    );
  }, 30_000);

  it('names every transitioned property explicitly, and never the outline', () => {
    const offenders: string[] = [];
    for (const directory of ['app', 'components', 'lib']) {
      for (const file of sourceFiles(path.join(webRoot, directory))) {
        const source = readFileSync(file, 'utf8');
        const relative = path.relative(webRoot, file);
        for (const match of source.matchAll(/\btransition-(all|colors|\[([^\]]*)\])/g)) {
          const line = source.slice(0, match.index).split('\n').length;
          if (match[1] === 'all' || match[1] === 'colors' || /\boutline/.test(match[2] ?? '')) {
            offenders.push(`${relative}:${line}  ${match[0]}`);
          }
        }
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  // jsdom never computes `color-scheme` (it lays out nothing), so the only thing a test in this
  // runner can check is that the declaration reaches the compiled stylesheet at all. Whether the
  // browser actually honours it was checked separately, in a real Chromium, against
  // `getComputedStyle(document.documentElement).colorScheme` on this same compiled output.
  it.each([
    ['light', ':root'],
    ['dark', '.dark'],
  ] as const)(
    'declares color-scheme: %s on %s so native controls do not depend on the theme provider default',
    (scheme, selector) => {
      const rule = requireRule(sheet, `a \`${selector}\` rule`, (candidate) => {
        return candidate.selector === selector;
      });
      expect(rule.declarations).toContainEqual({ property: 'color-scheme', value: scheme });
    },
  );

  // The theme is a class (`attribute="class"` in components/layout/theme-provider.tsx) and every
  // dark token is declared on `.dark`, but Tailwind's stock `dark:` variant is
  // `@media (prefers-color-scheme: dark)`. Left at the default the two disagree for any reader
  // whose chosen theme differs from their OS, and the disagreement is measurable: the eight
  // `dark:` utilities in components/ui/ then paint a light-theme surface with dark-theme alpha
  // (`dark:bg-destructive/60` under `text-white` lands at 3.02:1) or leave a dark-theme surface
  // with the light-theme rule (`bg-destructive` at 3.11:1). app/globals.contrast.test.ts measures
  // each theme as its own token set, which is only the truth while this variant follows the class.
  // `.font-display` sets the family on every allowed context, including the 16px sidebar
  // wordmark (docs/design.md §3), where the display cut's carved strokes would read as
  // hairline. Only the 40/44 `display` step is meant to draw with that cut, so the axis lives
  // on the size utility instead of the family one; a rule on `.font-display` would force the
  // wordmark into the same 40pt cut it needs to stay clear of.
  it('scopes the opsz axis to .text-display rather than .font-display', () => {
    const textDisplay = requireRule(sheet, 'the .text-display opsz rule', (rule) => {
      return rule.selector === '.text-display';
    });
    expect(textDisplay.layer).toBe('components');
    expect(textDisplay.declarations).toContainEqual({
      property: 'font-variation-settings',
      value: "'opsz' 40",
    });

    const fontDisplay = requireRule(sheet, 'the .font-display font-family rule', (rule) => {
      return rule.selector === '.font-display';
    });
    expect(
      fontDisplay.declarations.some(
        (declaration) => declaration.property === 'font-variation-settings',
      ),
    ).toBe(false);
  });

  // A theme font stack resolves on :root: `@theme inline` compiles `--font-sans` and its
  // siblings onto `:root, :host` in `@layer theme`, and a custom property's `var()` reference
  // only resolves against the element that defines it, so the next/font variable each stack
  // names has to be defined on :root too, not on a descendant.
  it('points every font-stack property at a next/font variable defined on html', async () => {
    const nextFontVariables = ['--font-archivo', '--font-fraunces', '--font-jetbrains'];
    const fontStackProperties = ['--font-sans', '--font-display', '--font-mono'];

    const themeRule = requireRule(sheet, 'the compiled :root, :host theme block', (rule) => {
      return (
        rule.layer === 'theme' &&
        fontStackProperties.every((property) => {
          return rule.declarations.some((declaration) => declaration.property === property);
        })
      );
    });

    for (const property of fontStackProperties) {
      const declaration = themeRule.declarations.find((entry) => entry.property === property);
      expect(declaration).toBeDefined();
      expect(
        nextFontVariables.some((variable) => declaration!.value.startsWith(`var(${variable})`)),
      ).toBe(true);
    }

    const layoutSource = await readFile(path.join(webRoot, 'app/layout.tsx'), 'utf8');
    for (const variable of nextFontVariables) {
      expect(layoutSource).toContain(`variable: '${variable}'`);
    }

    // `\s` right after `<html` (rather than `\b`) so this cannot match the literal `<html>` that
    // appears earlier in the file's own prose comments.
    const htmlTag = layoutSource.match(/<html\s[\s\S]*?>/)?.[0];
    expect(htmlTag).toBeDefined();
    expect(htmlTag).toContain('archivo.variable');
    expect(htmlTag).toContain('fraunces.variable');
    expect(htmlTag).toContain('jetbrainsMono.variable');
  });

  // `font-strong` writes a direct `font-weight: 550`, so pairing it with `text-title` or
  // `text-title-lg` (whose 600 comes from the `--text-title--font-weight` custom property that
  // `@theme inline` gives those size steps) does not blend the two: Tailwind's compiled order
  // always places `.font-strong` after both title utilities in the same `utilities` layer, so at
  // equal specificity `font-strong`'s direct value wins and silently drops the heading to 550 --
  // `body-strong`'s weight, one step below what docs/design.md:160 specifies for a title. Page
  // and panel headings must pair `text-title`/`text-title-lg` with `font-semibold` instead (or no
  // weight utility at all) to keep the 600 the type-scale table calls for.
  it('drops text-title(-lg) to 550 when paired with font-strong, and documents why', () => {
    expect(winningValueAmong(sheet, ['text-title', 'font-strong'], 'font-weight')).toBe('550');
    expect(winningValueAmong(sheet, ['text-title-lg', 'font-strong'], 'font-weight')).toBe('550');
  });

  it('keeps text-title(-lg) at 600 when paired with font-semibold, unlike font-strong', () => {
    // .font-semibold wins the same source-order tie .font-strong does (it also compiles after
    // the title utilities), but its declared value is `var(--font-weight-semibold)`, which
    // globals.css defines as 600 -- the title utilities' own weight, not font-strong's 550.
    expect(winningValueAmong(sheet, ['text-title', 'font-semibold'], 'font-weight')).toBe(
      'var(--font-weight-semibold)',
    );
    expect(winningValueAmong(sheet, ['text-title-lg', 'font-semibold'], 'font-weight')).toBe(
      'var(--font-weight-semibold)',
    );
    expect(
      requireRule(sheet, 'the --font-weight-semibold custom property', (rule) => {
        return rule.declarations.some(
          (declaration) => declaration.property === '--font-weight-semibold',
        );
      }).declarations,
    ).toContainEqual({ property: '--font-weight-semibold', value: '600' });
  });

  it('binds the dark variant to the theme class rather than the OS preference', () => {
    const rule = requireRule(sheet, 'a compiled `dark:bg-accent` rule', (candidate) => {
      return candidate.selector.startsWith(escapeClass('dark:bg-accent'));
    });
    // Asserted on what the variant appends, not on the class name it is written with: the rule
    // is found by its escaped class `.dark\:bg-accent`, which contains the substring `.dark`
    // whatever the variant compiles to. `:where(.dark` is the class variant's own output, and
    // the at-rule stack is empty for it while the stock variant nests it in a media query.
    expect(rule.selector).toContain(':where(.dark');
    expect(rule.atRules.filter((atRule) => atRule.startsWith('@media'))).toEqual([]);
    expect(css).not.toContain('prefers-color-scheme');
  });
});

/**
 * The border-based twins of the states this phase built out of a surface step or a tint.
 * `forced-colors: active` replaces every author colour with the user's palette, so a hover step,
 * a selection tint and a drop tint all collapse onto the same ground: without these rules the
 * three states below are indistinguishable from a resting card, column or menu row, which is
 * what docs/design.md §9 forbids. jsdom evaluates no media queries, so the compiled stylesheet
 * is where the fallbacks can be checked at all; a real Chromium under forced-colors and
 * prefers-contrast emulation is the phase-level check on top of this one.
 */
describe('globals.css forced-colours and contrast fallbacks', () => {
  let forced: Stylesheet;

  beforeAll(() => {
    forced = parseStylesheet(mediaBody('@media (forced-colors: active)'));
  });

  it('outlines the selected card in Highlight and hands the outline back on focus', () => {
    const selection = requireRule(forced, 'the selected card outline', (rule) => {
      return rule.selector === 'a[data-selected]:not(:focus-visible)';
    });
    expect(selection.declarations).toEqual([
      { property: 'outline', value: '2px solid Highlight' },
      { property: 'outline-offset', value: '2px' },
    ]);

    // Selection and focus are two different states and stay two different marks: the focused
    // card keeps the `:focus-visible` outline, and this border is what still says "selected".
    const border = requireRule(forced, "the selected card's Highlight border", (rule) => {
      return rule.selector === 'a[data-selected]';
    });
    expect(border.declarations).toEqual([{ property: 'border-color', value: 'Highlight' }]);
  });

  /**
   * The remote-change tint is a background colour and nothing else, so the mode leaves the card
   * indistinguishable from a resting one. The twin is a border, and it is dotted rather than
   * solid so a card that is both selected and remotely changed still wears two readable marks.
   */
  it('marks a remotely changed card with a dotted Highlight border', () => {
    const remote = requireRule(forced, 'the remote-change border twin', (rule) => {
      return rule.selector === "a[data-state='remote-changed']";
    });
    expect(remote.declarations).toEqual([
      { property: 'border-color', value: 'Highlight' },
      { property: 'border-style', value: 'dotted' },
    ]);

    // Selection is the state this one has to stay distinct from, and it is solid.
    const selection = requireRule(forced, "the selected card's border", (rule) => {
      return rule.selector === 'a[data-selected]';
    });
    expect(
      selection.declarations.some((declaration) => declaration.property === 'border-style'),
    ).toBe(false);
  });

  it('gives the drop target a Highlight outline in place of its tint, without reflowing it', () => {
    const drop = requireRule(forced, 'the drop target outline', (rule) => {
      return rule.selector === 'section[data-drop-target]';
    });
    expect(drop.declarations).toEqual([
      { property: 'outline', value: '2px solid Highlight' },
      { property: 'outline-offset', value: '-2px' },
    ]);
  });

  /**
   * The rail is a `--signature` ground and nothing else, so the mode replaces it with the same
   * colour it gives every other surface and the drop point disappears. It is the one mark a
   * keyboard drag has, which is why it gets a system colour rather than being left to the wash.
   */
  it('repaints the insertion rail in Highlight so the drop point survives', () => {
    const railRule = requireRule(forced, 'the insertion rail', (rule) => {
      return rule.selector === "[data-slot='drop-indicator']";
    });
    expect(railRule.declarations).toEqual([{ property: 'background', value: 'Highlight' }]);
  });

  it('paints the highlighted menu row with the palette pair the mode provides', () => {
    const row = requireRule(forced, 'the highlighted menu row', (rule) => {
      return selectorParts(rule).includes("[data-slot='dropdown-menu-item'][data-highlighted]");
    });
    expect(selectorParts(row)).toEqual([
      "[data-slot='dropdown-menu-item'][data-highlighted]",
      "[data-slot='dropdown-menu-checkbox-item'][data-highlighted]",
      "[data-slot='dropdown-menu-radio-item'][data-highlighted]",
    ]);
    expect(row.declarations).toEqual([
      { property: 'forced-color-adjust', value: 'none' },
      { property: 'background', value: 'Highlight' },
      { property: 'color', value: 'HighlightText' },
      { property: 'outline-color', value: 'CanvasText' },
    ]);

    // The icon declares its own `color` (`text-muted-foreground`), so the row's `HighlightText`
    // never reaches it and the mode forces that grey to CanvasText, which has no contract
    // against a Highlight ground. A system colour keyword is honoured, so the icon names one.
    const icon = requireRule(forced, "the highlighted row's icon colour", (rule) => {
      return rule.selector.includes('svg');
    });
    expect(icon.declarations).toEqual([{ property: 'color', value: 'HighlightText' }]);
  });

  // Only the highlighted row opts out. Chromium paints a Canvas backplate behind that row's text
  // and nowhere else's, so it is the one rule the opt-out buys anything for; every other
  // fallback in this block names a system colour the mode already honours, and opting those out
  // too would inherit into their descendants and leave author colours literal instead of forced
  // onto the user's palette.
  it('opts only the highlighted menu row out of the forced palette', () => {
    const optOuts = forced.rules.filter((rule) => {
      return rule.declarations.some((declaration) => {
        return declaration.property === 'forced-color-adjust';
      });
    });
    expect(optOuts.map((rule) => selectorParts(rule))).toEqual([
      [
        "[data-slot='dropdown-menu-item'][data-highlighted]",
        "[data-slot='dropdown-menu-checkbox-item'][data-highlighted]",
        "[data-slot='dropdown-menu-radio-item'][data-highlighted]",
      ],
    ]);

    const [row] = optOuts;
    expect(row!.declarations).toEqual([
      { property: 'forced-color-adjust', value: 'none' },
      { property: 'background', value: 'Highlight' },
      { property: 'color', value: 'HighlightText' },
      // The opt-out freezes this row's `:focus-visible` outline at its author copper too. The
      // outline sits at a positive offset, outside the Highlight ground and over the popover,
      // so the system colour it names is the one that ground forces to.
      { property: 'outline-color', value: 'CanvasText' },
    ]);

    // Separate from identifying which rule opts out: no other rule in the block does.
    const others = forced.rules.filter((rule) => rule !== row);
    expect(
      others.every((rule) => {
        return rule.declarations.every(
          (declaration) => declaration.property !== 'forced-color-adjust',
        );
      }),
    ).toBe(true);
  });

  // The tints these rules replace are `@layer utilities` (`bg-signature-subtle`,
  // `border-signature`), so an unlayered fallback is what makes them win without a specificity
  // race against whatever utility a call site adds next.
  it.each([
    'a[data-selected]',
    'a[data-selected]:not(:focus-visible)',
    "a[data-state='remote-changed']",
    'section[data-drop-target]',
    "[data-slot='drop-indicator']",
  ])('keeps %s above every utility', (selector) => {
    const rule = requireRule(sheet, `a rule for ${selector}`, (candidate) => {
      return candidate.selector === selector;
    });
    expect(layerRank(sheet, rule.layer)).toBeGreaterThan(layerRank(sheet, 'utilities'));
  });

  it('raises the hairline to --border-strong under prefers-contrast: more', () => {
    const contrast = parseStylesheet(mediaBody('@media (prefers-contrast: more)'));

    // One rule, one declaration: the request is a darker hairline, not a second palette.
    expect(contrast.rules).toHaveLength(1);
    const [raised] = contrast.rules;
    expect(selectorParts(raised!)).toEqual([':root', '.dark']);
    expect(raised!.declarations).toEqual([{ property: '--border', value: 'var(--border-strong)' }]);
  });

  it('overrides both themes from source order rather than specificity', () => {
    // `:root` and `.dark` are both a single class-or-pseudo-class, so nothing but source order
    // decides which `--border` a dark document ends up with.
    const darkTokens = requireRule(sheet, 'the `.dark` token block', (rule) => {
      return (
        rule.selector === '.dark' &&
        rule.declarations.some((declaration) => declaration.property === '--border')
      );
    });
    const raised = requireRule(sheet, 'the prefers-contrast override', (rule) => {
      return rule.declarations.some((declaration) => {
        return declaration.property === '--border' && declaration.value === 'var(--border-strong)';
      });
    });
    expect(raised.order).toBeGreaterThan(darkTokens.order);
  });
});

/**
 * P5 Task 1: the dialog and dropdown open/close, written as real keyframes bound through
 * `data-slot`/`data-state` because this project imports plain `tailwindcss` with no animation
 * plugin (`animate-in`, `fade-in-0`, `zoom-in-95` and their siblings compile to nothing at all).
 * jsdom never evaluates a `@media` query and never plays a keyframe, so the compiled sheet is
 * the only place either fact is checkable: that each of the four layered surfaces below carries
 * a real `animation-name`, and that `prefers-reduced-motion: reduce` retargets every one of them
 * to a keyframe whose body holds no `transform`, `scale` or `translate` declaration.
 */
describe('globals.css dialog and dropdown motion', () => {
  let reduced: Stylesheet;

  beforeAll(() => {
    reduced = parseStylesheet(reducedMotionBody());
  });

  const layeredSelectors = [
    "[data-slot='dialog-overlay']",
    "[data-slot='dialog-content']",
    "[data-slot='dropdown-menu-content']",
    "[data-slot='dropdown-menu-sub-content']",
    "[data-slot='popover-content']",
  ];

  it.each(layeredSelectors)('gives %s an animation-name in both data-state', (selector) => {
    for (const state of ['open', 'closed']) {
      const target = `${selector}[data-state='${state}']`;
      const rule = requireRule(sheet, target, (candidate) => {
        return selectorParts(candidate).includes(target);
      });
      const name = rule.declarations.find(
        (declaration) => declaration.property === 'animation-name',
      );
      expect(name?.value).toBeTruthy();
    }
  });

  it.each(layeredSelectors)(
    'switches %s to a fade-only keyframe under prefers-reduced-motion: reduce',
    (selector) => {
      for (const state of ['open', 'closed']) {
        const target = `${selector}[data-state='${state}']`;
        const rule = requireRule(
          reduced,
          `${target} inside prefers-reduced-motion: reduce`,
          (candidate) => {
            return selectorParts(candidate).includes(target);
          },
        );
        const name = rule.declarations.find(
          (declaration) => declaration.property === 'animation-name',
        );
        expect(name?.value).toBeTruthy();

        // The fade-only twin never re-declares movement: the reduced keyframe it points at has
        // no transform, scale or translate step of its own to drop.
        const body = keyframeBody(name!.value);
        expect(body).not.toMatch(/\b(transform|scale|translate)\s*:/);
      }
    },
  );
});

/**
 * P5 Task 2: the loading skeleton's own pulse (components/ui/skeleton.tsx), replacing Tailwind's
 * `animate-pulse` (2s, 1.0-0.5, no reduced-motion twin) with docs/design.md §6's 1.6s, 1.0-0.6
 * loop. A board renders dozens of these at once, so `prefers-reduced-motion: reduce` does not
 * retarget the loop to a fade like the dialog and menu above, it removes the animation outright
 * and holds the midpoint opacity instead: nothing left running on a machine that asked for none
 * of it, across however many skeletons are on screen at once.
 */
describe('globals.css skeleton motion', () => {
  const target = "[data-slot='skeleton']";

  it('completes a full 1.6s loop between full and 0.6 opacity', () => {
    const rule = requireRule(sheet, target, (candidate) =>
      selectorParts(candidate).includes(target),
    );
    const name = rule.declarations.find((declaration) => declaration.property === 'animation-name');
    const duration = rule.declarations.find(
      (declaration) => declaration.property === 'animation-duration',
    );
    const direction = rule.declarations.find(
      (declaration) => declaration.property === 'animation-direction',
    );
    expect(name?.value).toBeTruthy();
    expect(duration?.value).toBe('1.6s');
    // `animation-duration` must name the full round-trip period, matching Tailwind's own
    // `pulse` convention (a single mid-loop dip, no alternate). A from/to keyframe combined with
    // `animation-direction: alternate` would instead spend the whole duration on each one-way
    // leg, silently doubling the period to 3.2s while this assertion alone still passed.
    expect(direction?.value ?? 'normal').not.toBe('alternate');

    const body = keyframeBody(name!.value);
    // The dip must sit at the midpoint (50%) of a single normal-direction loop, not at a `to`
    // endpoint that only reaches 0.6 by riding an alternated second leg.
    expect(body).toMatch(/(^|[,\s])0%[,\s].*100%\s*{[^}]*opacity\s*:\s*1\b/s);
    expect(body).toMatch(/50%\s*{[^}]*opacity\s*:\s*0\.6\b/s);
  });

  it('stops moving and holds 0.75 opacity under prefers-reduced-motion: reduce', () => {
    const reduced = parseStylesheet(reducedMotionBody());
    const rule = requireRule(
      reduced,
      `${target} inside prefers-reduced-motion: reduce`,
      (candidate) => selectorParts(candidate).includes(target),
    );

    const animation = rule.declarations.find((declaration) => declaration.property === 'animation');
    const opacity = rule.declarations.find((declaration) => declaration.property === 'opacity');
    expect(animation?.value).toBe('none');
    expect(opacity?.value).toBe('0.75');
  });
});

/**
 * P5 Task 4: the submit spinner covers the button's content instead of joining it.
 *
 * The spinner is positioned out of flex flow (components/ui/button.tsx), and these two rules
 * clear what sits under it. Both halves matter to the geometry: a button with no leading icon
 * would otherwise widen by the spinner's own box plus the flex gap the moment `loading` turns
 * true, sliding its centred label by half that and sliding it back when the response lands, and
 * an icon dropped with `display: none` would leave the flow and shrink the button by the same
 * amount. jsdom computes no Tailwind output, so this is the only place the pair is checkable.
 */
describe('globals.css button spinner cover', () => {
  const target = "[data-slot='button'][data-spinner]";

  /** Selector match, whitespace around a combinator normalised away. */
  function matches(rule: StyleRule, selector: string): boolean {
    const tight = (part: string): string => part.replace(/\s+/g, '');
    return selectorParts(rule).some((part) => tight(part) === tight(selector));
  }

  it('clears the label through text-fill, leaving `color` for the spinner stroke', () => {
    const rule = requireRule(sheet, target, (candidate) => matches(candidate, target));

    const fill = rule.declarations.find(
      (declaration) => declaration.property === '-webkit-text-fill-color',
    );
    expect(fill?.value).toBe('transparent');
    // `color` itself has to stay put: the spinner draws its stroke in `currentColor`, so a
    // `color: transparent` here would hide the spinner along with the label it replaces.
    expect(rule.declarations.some((declaration) => declaration.property === 'color')).toBe(false);
  });

  it('hides a leading icon without taking it out of the flow', () => {
    const icon = `${target} > svg`;
    const rule = requireRule(sheet, icon, (candidate) => matches(candidate, icon));

    const opacity = rule.declarations.find((declaration) => declaration.property === 'opacity');
    expect(opacity?.value).toBe('0');
    expect(rule.declarations.some((declaration) => declaration.property === 'display')).toBe(false);
  });
});

/**
 * P6 Task 6: the two marks a card wears when the board answers back, and the JS timers that
 * decide how long each one's `data-state` stays on the element.
 *
 * The keyframe's duration and the timer's are one figure written twice. Dropped early, the card
 * jumps out of a play that had not finished; dropped late, the element carries a state nothing
 * draws. Neither module exports its constant, since nothing else has a use for it, so the pairing
 * is read out of the source the same way the rest of this file reads the tree.
 */
describe('globals.css task card feedback', () => {
  function timerMs(file: string, name: string): number {
    const source = readFileSync(path.join(webRoot, file), 'utf8');
    const match = new RegExp(`${name} = ([\\d_]+)`).exec(source);
    if (match === null) throw new Error(`${file} no longer declares ${name}`);
    return Number(match[1]!.replaceAll('_', ''));
  }

  function animationOf(target: string): string {
    const rule = requireRule(sheet, target, (candidate) =>
      selectorParts(candidate).includes(target),
    );
    const animation = rule.declarations.find((declaration) => declaration.property === 'animation');
    if (animation === undefined) throw new Error(`${target} declares no animation shorthand`);
    return animation.value;
  }

  it('lands a refused move over the 220ms --ease-in-out docs/design.md §5 gives it', () => {
    const animation = animationOf("[data-slot='task-card'][data-state='returning']");

    expect(animation).toContain('220ms');
    expect(animation).toContain('var(--ease-in-out)');
    expect(timerMs('components/board/use-board-mutations.ts', 'RETURN_ANIMATION_MS')).toBe(220);
  });

  it('fades a remote change over the 1200ms the same section gives it', () => {
    const animation = animationOf("[data-slot='task-card'][data-state='remote-changed']");

    expect(animation).toContain('1200ms');
    expect(timerMs('components/board/use-board-realtime.ts', 'REMOTE_CHANGE_MS')).toBe(1_200);
  });

  /**
   * One keyframe, two grounds. The selected card already sits on `--signature-subtle`, so a fade
   * written from that colour to the card's own ground is a fade from a colour to itself there:
   * the mark exists in the stylesheet and is invisible on exactly the card the reader is looking
   * at. Both ends of the keyframe are therefore variables, and the selected card overrides both.
   */
  it('gives the selected card its own ends for the remote-change fade', () => {
    const resting = requireRule(sheet, 'the task card ground', (rule) => {
      return rule.selector === "[data-slot='task-card']";
    });
    expect(resting.declarations).toEqual([
      { property: '--task-card-ground', value: 'var(--card)' },
      { property: '--task-card-remote-from', value: 'var(--signature-subtle)' },
    ]);

    const selected = requireRule(sheet, "the selected card's grounds", (rule) => {
      return rule.selector === "[data-slot='task-card'][data-selected]";
    });
    expect(selected.declarations).toEqual([
      { property: '--task-card-ground', value: 'var(--signature-subtle)' },
      { property: '--task-card-remote-from', value: 'var(--accent)' },
    ]);

    // The keyframe reads both, which is what makes the pair above a fade rather than two
    // unrelated declarations.
    const frames = keyframeBody('task-card-remote-change');
    expect(frames).toContain('var(--task-card-remote-from)');
    expect(frames).toContain('var(--task-card-ground)');
  });
});

/**
 * P5 Task 5: the adversarial pass over every animated surface under
 * `prefers-reduced-motion: reduce`.
 *
 * The suites above check that a reduced-motion rule *exists* for a surface. Existing is not
 * winning: a reduced twin written with fewer attribute selectors than the movement rule it is
 * meant to replace loses the cascade outright, and no `@media` query changes that. The drawer
 * shipped that way, two attribute selectors
 * (`[data-slot='dialog-drawer-content'][data-state='open']`) against the side-qualified slide
 * rule's three, so a reader who asked for less motion still got the full 320px slide.
 *
 * So this suite resolves the cascade for real instead: for a synthetic element carrying a given
 * set of attributes or classes, it finds the `animation`/`animation-name` declaration that
 * actually wins, once with only the unconditional rules in play and once with the
 * reduced-motion blocks added, exactly as a browser would order them.
 */
describe('globals.css reduced-motion cascade', () => {
  const REDUCED = '@media (prefers-reduced-motion: reduce)';

  type Target = { attrs?: Record<string, string>; classes?: string[] };

  /** One animated surface, the keyframe it plays when nothing is asked for, and whether its
   * reduced twin still has to leave something on screen when it finishes. */
  type Surface = { label: string; target: Target; moving: string; visible: boolean };

  /**
   * The specificity `selector` contributes for `target`, or `null` when it does not match or is
   * not a plain chain of attribute and class parts. Everything this suite targets is written as
   * one such chain, and anything else (a type selector, a pseudo-class, a combinator) is a rule
   * that cannot apply to a bare synthetic element anyway.
   */
  function matchSpecificity(selector: string, target: Target): number | null {
    const parts = selector.match(/\[[^\]]+\]|\.[\w-]+/g);
    if (parts === null) return null;
    if (parts.join('') !== selector.trim()) return null;

    const attrs = target.attrs ?? {};
    const classes = target.classes ?? [];
    for (const part of parts) {
      if (part.startsWith('.')) {
        if (!classes.includes(part.slice(1))) return null;
        continue;
      }
      const inner = part.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq === -1) {
        if (!(inner in attrs)) return null;
        continue;
      }
      const name = inner.slice(0, eq);
      const value = inner.slice(eq + 1).replaceAll(/^['"]|['"]$/g, '');
      if (attrs[name] !== value) return null;
    }
    // Every part is a class or an attribute selector, each worth one unit of the `b` column.
    return parts.length;
  }

  const ANIMATION_PROPERTIES = ['animation', 'animation-name'];

  /**
   * The `animation`/`animation-name` declaration that wins for `target`, following layer, then
   * specificity, then source order. `reduced` decides whether the reduced-motion blocks are in
   * play; every other at-rule (`hover`, `forced-colors`, `prefers-contrast`) is left out either
   * way, since none of them is the condition under test.
   */
  function winningAnimation(target: Target, { reduced }: { reduced: boolean }): Declaration {
    let winner: { rule: StyleRule; specificity: number; declaration: Declaration } | undefined;

    for (const rule of sheet.rules) {
      const conditions = rule.atRules.map((at) => at.replaceAll(/\s+/g, ' '));
      if (!conditions.every((at) => at === REDUCED)) continue;
      if (!reduced && conditions.length > 0) continue;

      const declaration = rule.declarations
        .filter((entry) => ANIMATION_PROPERTIES.includes(entry.property))
        .at(-1);
      if (declaration === undefined) continue;

      for (const part of selectorParts(rule)) {
        const specificity = matchSpecificity(part, target);
        if (specificity === null) continue;
        if (winner === undefined) {
          winner = { rule, specificity, declaration };
          continue;
        }
        const byLayer = layerRank(sheet, rule.layer) - layerRank(sheet, winner.rule.layer);
        const bySpecificity = specificity - winner.specificity;
        const byOrder = rule.order - winner.rule.order;
        if (
          byLayer > 0 ||
          (byLayer === 0 && (bySpecificity > 0 || (bySpecificity === 0 && byOrder > 0)))
        ) {
          winner = { rule, specificity, declaration };
        }
      }
    }

    if (winner === undefined) {
      throw new Error(`nothing in the compiled CSS animates ${JSON.stringify(target)}`);
    }
    return winner.declaration;
  }

  /** The keyframe name a winning `animation` shorthand or `animation-name` resolves to. */
  function keyframeNameOf(declaration: Declaration): string {
    if (declaration.property === 'animation-name') return declaration.value.trim();
    const named = declaration.value
      .split(/\s+/)
      .find((token) => css.includes(`@keyframes ${token}`));
    return named ?? 'none';
  }

  /**
   * Every animated surface in the tree, with the keyframe that must play when nothing is asked
   * for. `visible` marks the layers whose reduced twin still has to *arrive*: an open dialog
   * that ends at anything but full opacity is a state change nobody can see, which is the other
   * half of what reduced motion must not break.
   */
  const surfaces: Surface[] = [
    {
      label: 'drawer, docked left, opening',
      target: {
        attrs: { 'data-slot': 'dialog-drawer-content', 'data-side': 'left', 'data-state': 'open' },
      },
      moving: 'drawer-in-left',
      visible: true,
    },
    {
      label: 'drawer, docked left, closing',
      target: {
        attrs: {
          'data-slot': 'dialog-drawer-content',
          'data-side': 'left',
          'data-state': 'closed',
        },
      },
      moving: 'drawer-out-left',
      visible: false,
    },
    {
      label: 'drawer, docked right, opening',
      target: {
        attrs: { 'data-slot': 'dialog-drawer-content', 'data-side': 'right', 'data-state': 'open' },
      },
      moving: 'drawer-in-right',
      visible: true,
    },
    {
      label: 'drawer, docked right, closing',
      target: {
        attrs: {
          'data-slot': 'dialog-drawer-content',
          'data-side': 'right',
          'data-state': 'closed',
        },
      },
      moving: 'drawer-out-right',
      visible: false,
    },
    {
      label: 'dialog surface, opening',
      target: { attrs: { 'data-slot': 'dialog-content', 'data-state': 'open' } },
      moving: 'dialog-content-in',
      visible: true,
    },
    {
      label: 'dialog surface, closing',
      target: { attrs: { 'data-slot': 'dialog-content', 'data-state': 'closed' } },
      moving: 'dialog-content-out',
      visible: false,
    },
    {
      label: 'dialog scrim, opening',
      target: { attrs: { 'data-slot': 'dialog-overlay', 'data-state': 'open' } },
      moving: 'layer-fade-in',
      visible: true,
    },
    {
      label: 'dialog scrim, closing',
      target: { attrs: { 'data-slot': 'dialog-overlay', 'data-state': 'closed' } },
      moving: 'layer-fade-out',
      visible: false,
    },
    {
      label: 'menu, opening',
      target: { attrs: { 'data-slot': 'dropdown-menu-content', 'data-state': 'open' } },
      moving: 'menu-content-in',
      visible: true,
    },
    {
      label: 'menu, closing',
      target: { attrs: { 'data-slot': 'dropdown-menu-content', 'data-state': 'closed' } },
      moving: 'menu-content-out',
      visible: false,
    },
    {
      label: 'submenu, opening',
      target: { attrs: { 'data-slot': 'dropdown-menu-sub-content', 'data-state': 'open' } },
      moving: 'menu-content-in',
      visible: true,
    },
    {
      label: 'submenu, closing',
      target: { attrs: { 'data-slot': 'dropdown-menu-sub-content', 'data-state': 'closed' } },
      moving: 'menu-content-out',
      visible: false,
    },
    {
      label: 'popover, opening',
      target: { attrs: { 'data-slot': 'popover-content', 'data-state': 'open' } },
      moving: 'menu-content-in',
      visible: true,
    },
    {
      label: 'popover, closing',
      target: { attrs: { 'data-slot': 'popover-content', 'data-state': 'closed' } },
      moving: 'menu-content-out',
      visible: false,
    },
    {
      label: 'loading skeleton',
      target: { attrs: { 'data-slot': 'skeleton' } },
      moving: 'skeleton-pulse',
      visible: false,
    },
    {
      label: 'submit spinner',
      target: { attrs: { 'data-slot': 'button-spinner' } },
      moving: 'spinner',
      visible: false,
    },
    {
      label: 'board column entrance',
      target: { classes: ['board-column-enter'] },
      moving: 'board-column-enter',
      visible: true,
    },
    {
      label: 'card returning from a refused move',
      target: { attrs: { 'data-slot': 'task-card', 'data-state': 'returning' } },
      moving: 'task-card-return',
      visible: true,
    },
    // The only surface here whose resting animation is already movement-free, so `reduce` keeps
    // it rather than retargeting it: it is background colour and nothing else, which is exactly
    // what reduced motion preserves, and it is the sole mark saying a card moved under the
    // reader's hands.
    {
      label: 'card another member just changed',
      target: { attrs: { 'data-slot': 'task-card', 'data-state': 'remote-changed' } },
      moving: 'task-card-remote-change',
      visible: false,
    },
  ];

  it.each(surfaces)('plays $moving on $label when nothing is asked for', ({ target, moving }) => {
    expect(keyframeNameOf(winningAnimation(target, { reduced: false }))).toBe(moving);
  });

  it.each(surfaces)('leaves $label with no movement under reduce', ({ target }) => {
    const name = keyframeNameOf(winningAnimation(target, { reduced: true }));
    if (name === 'none') return;
    expect(keyframeBody(name)).not.toMatch(/\b(transform|scale|translate|rotate)\s*:/);
  });

  it.each(surfaces.filter((surface) => surface.visible))(
    'still lets $label finish fully opaque under reduce',
    ({ target }) => {
      const name = keyframeNameOf(winningAnimation(target, { reduced: true }));
      expect(name).not.toBe('none');
      expect(keyframeBody(name)).toMatch(/\bto\s*\{[^}]*opacity\s*:\s*1\b/);
    },
  );
});
