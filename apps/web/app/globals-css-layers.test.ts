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
 * task panel's heading, which a keyboard user reaches by pressing Enter on a task card. The last
 * two each carried a suppressor as a programmatic focus container until the phase keyboard tour
 * measured both of them matching `:focus-visible` in Chromium and Firefox. Both utilities
 * compile into `utilities`, which outranks `base`, so either one leaves the element focusing
 * with nothing drawn at all: in Chromium a `:focus-visible` element under that suppressor
 * computes `outline-style: none`. The scan reads the whole source rather than the class strings
 * alone, so a comment in one of these files names the utility as `outline-*` instead of
 * spelling it.
 */
const singleIndicatorTargets = [
  'components/layout/app-shell.tsx',
  'components/task/task-panel.tsx',
  'components/ui/button.tsx',
  'components/ui/dropdown-menu.tsx',
  'components/ui/input.tsx',
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

  // transition-all also animates the outline; the focus ring must draw instantly.
  it('keeps components/ui/button.tsx off transition-all so its focus outline draws instantly', async () => {
    const source = await readFile(path.join(webRoot, 'components/ui/button.tsx'), 'utf8');
    expect(source).not.toMatch(/\btransition-all\b/);

    const transitionList = source.match(/transition-\[([^\]]*)\]/);
    expect(transitionList).not.toBeNull();
    expect(transitionList![1]).not.toMatch(/\boutline\b/);
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

  it('gives the drop target a Highlight outline in place of its tint, without reflowing it', () => {
    const drop = requireRule(forced, 'the drop target outline', (rule) => {
      return rule.selector === 'section[data-drop-target]';
    });
    expect(drop.declarations).toEqual([
      { property: 'outline', value: '2px solid Highlight' },
      { property: 'outline-offset', value: '-2px' },
    ]);
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
    'section[data-drop-target]',
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
