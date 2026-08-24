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
const require = createRequire(import.meta.url);
const tailwindDir = path.dirname(require.resolve('tailwindcss/package.json'));

type Declaration = { property: string; value: string };

type StyleRule = {
  selector: string;
  layer: string | null;
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

function parseStylesheet(css: string): Stylesheet {
  const rules: StyleRule[] = [];
  const layerOrder: string[] = [];
  const stack: (string | null)[] = [];
  const currentLayer = (): string | null => stack.at(-1) ?? null;
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
        stack.push(name || currentLayer());
        continue;
      }
      if (prelude.startsWith('@')) {
        // @media / @supports / @keyframes: the enclosing layer carries through.
        if (prelude.startsWith('@keyframes')) {
          i = blockEnd(css, i);
          continue;
        }
        stack.push(currentLayer());
        continue;
      }
      const end = blockEnd(css, i);
      rules.push({
        selector: prelude,
        layer: currentLayer(),
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

function requireRule(
  sheet: Stylesheet,
  described: string,
  predicate: (rule: StyleRule) => boolean,
): StyleRule {
  const found = sheet.rules.find(predicate);
  if (found === undefined) throw new Error(`the compiled CSS is missing ${described}`);
  return found;
}

const borderUtilities = {
  'border-border': 'var(--border)',
  'border-input': 'var(--input)',
  'border-signature': 'var(--signature)',
  'border-destructive': 'var(--destructive)',
  'border-ring': 'var(--ring)',
  'border-border-strong': 'var(--border-strong)',
} as const;

/**
 * The state borders the layer move brought back, each with the condition it is supposed to wait
 * for. Their whole risk is drawing at the wrong moment rather than not drawing at all: an
 * `aria-invalid` variant that matched any value of the attribute would put a red edge on every
 * valid field the app marks `aria-invalid="false"`.
 */
const stateVariants = {
  'focus-visible:border-ring': { suffix: ':focus-visible', value: 'var(--ring)' },
  'focus-within:border-ring': { suffix: ':focus-within', value: 'var(--ring)' },
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

describe('globals.css cascade layers', () => {
  let sheet: Stylesheet;
  let css: string;

  beforeAll(async () => {
    css = await compileGlobals([
      ...Object.keys(borderUtilities),
      ...Object.keys(stateVariants),
      'divide-border',
    ]);
    sheet = parseStylesheet(css);
  }, 30_000);

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

  // components/ui/button.tsx still carries `outline-none`, a @layer utilities rule. The
  // :focus-visible outline therefore has to stay unlayered to remain a button's only focus
  // indicator. Phase 4 drops `outline-none` and moves the rule; this guards the gap until then.
  it('keeps the :focus-visible outline above every utility', () => {
    const focus = sheet.rules.filter((rule) => rule.selector === ':focus-visible');
    expect(focus).not.toHaveLength(0);
    for (const rule of focus) {
      expect(layerRank(sheet, rule.layer)).toBeGreaterThan(layerRank(sheet, 'utilities'));
    }
  });
});
