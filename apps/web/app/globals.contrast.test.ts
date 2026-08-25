import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The contrast gate for `app/globals.css`.
 *
 * Values are read out of the stylesheet instead of being copied here, so a token can only change
 * in one place. A theme is the `:root` declarations with `.dark` layered on top, which is what
 * the cascade does and is also what makes `--input: var(--border-strong)` resolve to the dark
 * hairline in dark mode.
 *
 * No colour is measured against one blessed surface. The same text token lands on the canvas, on
 * a column, on a card, inside a popover, on the hover step and on the signature tint, so the
 * floor has to hold on the worst of the six. WCAG 2.x AA is the binding standard (4.5:1 for text,
 * 3:1 for boundaries and state marks); APCA is a second opinion, reported for the dark theme
 * where the light-on-dark polarity is what the WCAG formula models worst.
 *
 * A token is only half of what a browser paints. The other half is the tree: an alpha derivative
 * (`bg-destructive/60`, `opacity-50`) is a token mixed with whatever is behind it, and a rule
 * that says "never this colour on that ground" is worth what the scan enforcing it is worth. So
 * three scanners rescan every rendered source on each run, and each answers to a list here:
 * every alpha derivative, composited over the surfaces its element can sit on; every call site
 * pairing a risky text colour with a risky ground; and every untokenised colour.
 *
 * Exemptions are named lists carrying their measured number and their reason, never a lowered
 * threshold: adding to one is a diff a reviewer sees. They are read in both directions, because
 * an exemption that has quietly become unnecessary is its own kind of rot: each one is
 * re-measured and fails if it has drifted off its recorded number or has risen past the floor it
 * was excused from.
 */

const globalsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'globals.css');

// Comments are stripped before parsing: a declaration-shaped string inside one (a note naming
// `--input: var(--border-strong)`, say) would otherwise be read as a real declaration.
const css = readFileSync(globalsPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The body of the first top-level block opened by `selector`, brace-matched. Anchored on a line
 * start, so the indented `:root` inside the `max-width: 767px` media query is not mistaken for
 * the token block.
 */
function topLevelBlock(selector: string): string {
  const opener = `\n${selector} {`;
  const start = css.indexOf(opener);
  if (start === -1) throw new Error(`globals.css has no top-level \`${selector}\` block`);
  const open = start + opener.length;
  let depth = 1;
  for (let i = open; i < css.length; i += 1) {
    const character = css.charAt(i);
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open, i);
    }
  }
  throw new Error(`globals.css never closes the \`${selector}\` block`);
}

function declarationsIn(body: string): Map<string, string> {
  const declared = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const [, name, value] = match;
    if (name && value) declared.set(name, value.trim());
  }
  return declared;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** The subset of `declared` that resolves to a six-digit hex, following `var()` aliases. */
function resolveColours(declared: Map<string, string>): Map<string, string> {
  const chase = (name: string, depth: number): string | null => {
    const value = declared.get(name);
    if (value === undefined || depth > 8) return null;
    if (HEX.test(value)) return value.toLowerCase();
    const alias = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(value)?.[1];
    return alias ? chase(alias, depth + 1) : null;
  };
  const colours = new Map<string, string>();
  for (const name of declared.keys()) {
    const colour = chase(name, 0);
    if (colour !== null) colours.set(name, colour);
  }
  return colours;
}

type Theme = 'light' | 'dark';

const THEMES: Theme[] = ['light', 'dark'];

const rootDeclarations = declarationsIn(topLevelBlock(':root'));
const darkDeclarations = new Map([...rootDeclarations, ...declarationsIn(topLevelBlock('.dark'))]);

const tokens: Record<Theme, Map<string, string>> = {
  light: resolveColours(rootDeclarations),
  dark: resolveColours(darkDeclarations),
};

function hexOf(theme: Theme, token: string): string {
  const value = tokens[theme].get(token);
  if (value === undefined) throw new Error(`the ${theme} theme declares no colour for ${token}`);
  return value;
}

function channel(component: number): number {
  const srgb = component / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): { red: number; green: number; blue: number } {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function luminance(hex: string): number {
  const { red, green, blue } = rgb(hex);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * Every comparison below runs on the rounded number the failure message prints, so the value a
 * reader is shown is the value the assertion used. Two decimals for the AA floors, three for the
 * surface steps, which are decided in the third.
 */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/**
 * The smallest ratio at which two neighbouring surfaces still read as two surfaces.
 *
 * It walks the whole chain in dark and gates two steps in light, which is all light has.
 * docs/design.md §3 puts light depth in a white card on a grey canvas plus a hairline, and in a
 * real shadow in the three places that get one (dialog, popover, drag preview): `--card` and
 * `--popover` are one value there on purpose, so there is no light chain to walk. What light is
 * held to is the canvas-to-card step and the hover step, both below.
 */
const SURFACE_STEP = 1.05;

/**
 * Every surface a colour can land on. `--secondary` is absent because it is `--accent`'s twin
 * value, and `--primary` / `--destructive` are covered as fills by their own `-foreground` pair.
 */
const SURFACES = [
  '--background',
  '--muted',
  '--card',
  '--popover',
  '--accent',
  '--signature-subtle',
] as const;

/** The surfaces a control paints itself over: the four a button, field or menu can land on. */
const NEUTRAL_SURFACES = ['--background', '--muted', '--card', '--popover'] as const;

const TEXT_TOKENS = [
  '--foreground',
  '--foreground-secondary',
  '--muted-foreground',
  // Aliases that shadcn primitives read by name. They equal `--foreground` today; measured
  // separately so a future split cannot slip past this gate.
  '--card-foreground',
  '--popover-foreground',
  '--secondary-foreground',
  '--accent-foreground',
];

/**
 * Copper and destructive as *text*, not as a fill or a mark.
 *
 * Measured on all six surfaces, like every other text token. The five pairs that come up short
 * are in `EXEMPT_PAIRS` with their numbers, and they rest on a rule rather than on a number
 * (docs/design.md: no copper text on the signature tint, and no call site puts copper or
 * destructive text on the hover step). A rule nothing reads is a rule nothing keeps, so it is
 * not taken on trust: `PINNED_CALL_SITES` below is the list of call sites that pair one of those
 * grounds with one of those text colours, the tree is scanned against it, and each pin carries
 * the ratio it measures in both themes, so a token moving under a pin fails here instead of
 * passing quietly.
 */
const COPPER_AND_DESTRUCTIVE_TEXT = ['--primary', '--signature', '--destructive'];

/**
 * Status colours drawn as running text rather than as a mark.
 *
 * `BOUNDARY_TOKENS` already holds all four at the 3:1 mark floor, which is the floor for the
 * icon docs/design.md §3 pairs them with. They are gated again at 4.5 because a call site can
 * put one of them in text instead, and one does: the overdue due date on a board card
 * (components/task/task-card.tsx). The checklist ratio was the second until the colour moved to
 * its glyph (components/task/checklist-badge.tsx). Text is text whichever token it wears.
 */
const STATUS_TEXT_TOKENS = [
  '--status-info',
  '--status-good',
  '--status-warning',
  '--status-danger',
];

/**
 * Boundaries and state marks: 3:1 is the floor for anything that draws an edge or a status the
 * user has to see, on every surface it can be drawn over.
 *
 * `--border` is deliberately absent. It is the decorative hairline that separates two areas of
 * one surface and never carries state on its own (light 1.15, dark 1.21 at worst); every edge
 * that means something interactive or selectable wears `--border-strong`, `--input`, `--ring` or
 * `--signature`, all of which are gated here.
 */
const BOUNDARY_TOKENS = [
  '--border-strong',
  '--input',
  '--ring',
  '--signature',
  '--destructive',
  '--status-info',
  '--status-good',
  '--status-warning',
  '--status-danger',
  '--priority-low',
  '--priority-medium',
  '--priority-high',
  '--priority-urgent',
];

const LABEL_SLOTS = Array.from({ length: 8 }, (_, index) => `--label-slot-${index + 1}`);

/**
 * Every pair this file lets through under its floor, carrying the number it measures and the
 * reason it is allowed to.
 *
 * The list is read in both directions. `belowFloor` skips these pairs, so a listed pair cannot
 * fail a gate; `the exemptions` block below re-measures each one and fails if it has drifted off
 * the recorded number *or* has risen past the floor it was excused from. The second half is the
 * point: a token move that quietly fixes an exemption leaves a piece of prose behind claiming a
 * problem nobody has any more, and prose nobody can retire is how a gate turns into decoration.
 */
const EXEMPT_PAIRS: {
  theme: Theme;
  token: string;
  surface: string;
  floor: number;
  measured: number;
  reason: string;
}[] = [
  {
    theme: 'light',
    token: '--primary',
    surface: '--accent',
    floor: AA_TEXT,
    measured: 4.28,
    reason: 'copper text on the hover step, which PINNED_CALL_SITES shows nothing draws',
  },
  {
    theme: 'light',
    token: '--primary',
    surface: '--signature-subtle',
    floor: AA_TEXT,
    measured: 4.11,
    reason: 'copper text on the signature tint, forbidden outright by docs/design.md §3',
  },
  {
    theme: 'light',
    token: '--signature',
    surface: '--accent',
    floor: AA_TEXT,
    measured: 4.28,
    reason: "--primary's twin value under the name link and rail call sites use",
  },
  {
    theme: 'light',
    token: '--signature',
    surface: '--signature-subtle',
    floor: AA_TEXT,
    measured: 4.11,
    reason: "--primary's twin value under the name link and rail call sites use",
  },
  {
    theme: 'dark',
    token: '--destructive',
    surface: '--accent',
    floor: AA_TEXT,
    measured: 4.13,
    reason: 'destructive text on the hover step, which the dropdown variant replaces with a tint',
  },
  {
    theme: 'light',
    token: '--status-good',
    surface: '--signature-subtle',
    floor: AA_TEXT,
    measured: 4.33,
    reason: 'the only call site is the checklist glyph, a mark held to 3:1 and clearing it',
  },
  {
    theme: 'dark',
    token: '--status-danger',
    surface: '--accent',
    floor: AA_TEXT,
    measured: 4.13,
    reason:
      'the overdue date on a hovered card (components/task/task-card.tsx) is text at 4.13; ' +
      'closing it means splitting dark --status-danger from --destructive or giving the date ' +
      'the mark docs/design.md §3 pairs a severity with, neither of which is this gate to make',
  },
];

/**
 * Exemptions that cover a token on every surface rather than one pair, with the surface the
 * token measures worst against and the number it measures there.
 *
 * `--border` is the decorative hairline: it separates two areas of one surface and never carries
 * state on its own, so it is absent from `BOUNDARY_TOKENS` entirely. Every edge that means
 * something interactive or selectable wears `--border-strong`, `--input`, `--ring` or
 * `--signature`, all of which are gated.
 *
 * The four light label slots stay under 3:1 on all six surfaces. docs/design.md §8 already
 * records slots 3/4/5 as a contrast WARN and names the relief: the dot is `aria-hidden` and
 * always paired with the label's own name, and every chart offers direct labels plus a table
 * view. The slot palette is a design decision this gate does not own, so the four are listed
 * rather than silently passing.
 */
const EXEMPT_TOKENS: {
  theme: Theme;
  token: string;
  floor: number;
  surface: string;
  measured: number;
  reason: string;
}[] = [
  {
    theme: 'light',
    token: '--border',
    floor: AA_NON_TEXT,
    surface: '--signature-subtle',
    measured: 1.15,
    reason: 'the decorative hairline, which carries no state of its own',
  },
  {
    theme: 'dark',
    token: '--border',
    floor: AA_NON_TEXT,
    surface: '--accent',
    measured: 1.21,
    reason: 'the decorative hairline, which carries no state of its own',
  },
  {
    theme: 'light',
    token: '--label-slot-2',
    floor: AA_NON_TEXT,
    surface: '--signature-subtle',
    measured: 2.61,
    reason: 'a dot beside the label name, never the only channel (docs/design.md §8)',
  },
  {
    theme: 'light',
    token: '--label-slot-3',
    floor: AA_NON_TEXT,
    surface: '--signature-subtle',
    measured: 2.29,
    reason: 'a dot beside the label name, never the only channel (docs/design.md §8)',
  },
  {
    theme: 'light',
    token: '--label-slot-4',
    floor: AA_NON_TEXT,
    surface: '--signature-subtle',
    measured: 1.76,
    reason: 'a dot beside the label name, never the only channel (docs/design.md §8)',
  },
  {
    theme: 'light',
    token: '--label-slot-5',
    floor: AA_NON_TEXT,
    surface: '--signature-subtle',
    measured: 2.19,
    reason: 'a dot beside the label name, never the only channel (docs/design.md §8)',
  },
];

const exemptPairs = new Set(
  EXEMPT_PAIRS.map((entry) => `${entry.theme}|${entry.token}|${entry.surface}`),
);

function tokenIsExempt(theme: Theme, token: string): boolean {
  return EXEMPT_TOKENS.some((entry) => entry.theme === theme && entry.token === token);
}

function belowFloor(
  theme: Theme,
  tokenNames: readonly string[],
  surfaces: readonly string[],
  floor: number,
): string[] {
  const failures: string[] = [];
  for (const token of tokenNames) {
    if (tokenIsExempt(theme, token)) continue;
    const foreground = hexOf(theme, token);
    for (const surface of surfaces) {
      if (exemptPairs.has(`${theme}|${token}|${surface}`)) continue;
      const background = hexOf(theme, surface);
      const measured = round(contrastRatio(foreground, background), 2);
      if (measured < floor) {
        failures.push(
          `${theme}: ${token} ${foreground} on ${surface} ${background} is ` +
            `${measured.toFixed(2)}:1, below ${floor.toFixed(1)}:1`,
        );
      }
    }
  }
  return failures;
}

/** The surface `token` measures worst against, and the ratio it measures there. */
function worstSurface(theme: Theme, token: string): { surface: string; measured: number } {
  let worst = { surface: SURFACES[0] as string, measured: Number.POSITIVE_INFINITY };
  for (const surface of SURFACES) {
    const measured = round(contrastRatio(hexOf(theme, token), hexOf(theme, surface)), 2);
    if (measured < worst.measured) worst = { surface, measured };
  }
  return worst;
}

for (const theme of THEMES) {
  describe(`${theme} theme`, () => {
    it('holds every text token at 4.5:1 on every surface', () => {
      expect(belowFloor(theme, TEXT_TOKENS, SURFACES, AA_TEXT)).toEqual([]);
    });

    it('holds --foreground-disabled at 3:1 on every surface', () => {
      expect(belowFloor(theme, ['--foreground-disabled'], SURFACES, AA_NON_TEXT)).toEqual([]);
    });

    it('holds copper and destructive text at 4.5:1 on every surface', () => {
      expect(belowFloor(theme, COPPER_AND_DESTRUCTIVE_TEXT, SURFACES, AA_TEXT)).toEqual([]);
    });

    it('holds every status token at 4.5:1 on every surface it is drawn as text on', () => {
      expect(belowFloor(theme, STATUS_TEXT_TOKENS, SURFACES, AA_TEXT)).toEqual([]);
    });

    it('holds each fill against the text it carries at 4.5:1', () => {
      const fills: [string, string][] = [
        ['--primary-foreground', '--primary'],
        ['--destructive-foreground', '--destructive'],
      ];
      const failures = fills.flatMap(([text, fill]) => belowFloor(theme, [text], [fill], AA_TEXT));
      expect(failures).toEqual([]);
    });

    it('holds every boundary and state token at 3:1 on every surface', () => {
      expect(belowFloor(theme, BOUNDARY_TOKENS, SURFACES, AA_NON_TEXT)).toEqual([]);
    });

    it('holds every non-exempt label slot at 3:1 on every surface as a dot', () => {
      expect(belowFloor(theme, LABEL_SLOTS, SURFACES, AA_NON_TEXT)).toEqual([]);
    });
  });
}

describe('the exemptions', () => {
  it('measures each exempt pair at the number it records', () => {
    const drifted = EXEMPT_PAIRS.flatMap((entry) => {
      const measured = round(
        contrastRatio(hexOf(entry.theme, entry.token), hexOf(entry.theme, entry.surface)),
        2,
      );
      return measured === entry.measured
        ? []
        : [
            `${entry.theme}: ${entry.token} on ${entry.surface} measures ` +
              `${measured.toFixed(2)}:1, recorded ${entry.measured.toFixed(2)}:1 (${entry.reason})`,
          ];
    });
    expect(drifted).toEqual([]);
  });

  it('keeps each exempt pair on the exempt side of its floor', () => {
    const retired = EXEMPT_PAIRS.flatMap((entry) => {
      const measured = round(
        contrastRatio(hexOf(entry.theme, entry.token), hexOf(entry.theme, entry.surface)),
        2,
      );
      return measured < entry.floor
        ? []
        : [
            `${entry.theme}: ${entry.token} on ${entry.surface} now measures ` +
              `${measured.toFixed(2)}:1, at or above the ${entry.floor.toFixed(1)}:1 it was ` +
              'excused from: delete the exemption instead of leaving it to explain nothing',
          ];
    });
    expect(retired).toEqual([]);
  });

  it('measures each exempt token worst on the surface it names, at the number it records', () => {
    const drifted = EXEMPT_TOKENS.flatMap((entry) => {
      const worst = worstSurface(entry.theme, entry.token);
      return worst.surface === entry.surface && worst.measured === entry.measured
        ? []
        : [
            `${entry.theme}: ${entry.token} is worst at ${worst.measured.toFixed(2)}:1 on ` +
              `${worst.surface}, recorded ${entry.measured.toFixed(2)}:1 on ${entry.surface} ` +
              `(${entry.reason})`,
          ];
    });
    expect(drifted).toEqual([]);
  });

  it('keeps each exempt token on the exempt side of its floor', () => {
    const retired = EXEMPT_TOKENS.flatMap((entry) => {
      const { measured } = worstSurface(entry.theme, entry.token);
      return measured < entry.floor
        ? []
        : [
            `${entry.theme}: ${entry.token} now measures ${measured.toFixed(2)}:1 at worst, at ` +
              `or above the ${entry.floor.toFixed(1)}:1 it was excused from: gate it instead`,
          ];
    });
    expect(retired).toEqual([]);
  });
});

/**
 * The call-site half of the copper and destructive exemption.
 *
 * Grounds and text colours are named by their utility class, because that is what a call site
 * writes. An alpha derivative counts as its token: `bg-signature-subtle/40` is still the tint,
 * only weaker, so a pairing on it is still the pairing the rule forbids.
 */
const GROUNDS = [
  ['bg-signature-subtle', '--signature-subtle'],
  ['bg-accent', '--accent'],
] as const;

/**
 * The text colours that miss 4.5:1 on one of those two grounds in one of the two themes, so a
 * call site pairing them is the thing worth finding.
 *
 * The four priority tokens are absent on purpose: components/task/priority-icon.tsx is their only
 * consumer and it renders an icon, so they are marks held to 3:1 and they clear it on every
 * surface. The four status tokens are here because two of them have been drawn as running text.
 */
const TEXTS = [
  ['text-signature', '--signature'],
  ['text-primary', '--primary'],
  ['text-destructive', '--destructive'],
  ['text-status-info', '--status-info'],
  ['text-status-good', '--status-good'],
  ['text-status-warning', '--status-warning'],
  ['text-status-danger', '--status-danger'],
] as const;

type GroundClass = (typeof GROUNDS)[number][0];
type TextClass = (typeof TEXTS)[number][0];

const TOKEN_OF = new Map<string, string>([...GROUNDS, ...TEXTS]);

function tokenOf(utility: string): string {
  const token = TOKEN_OF.get(utility);
  if (token === undefined) throw new Error(`no token is mapped to \`${utility}\``);
  return token;
}

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const NOT_RENDERED = new Set(['node_modules', '.next', 'coverage', 'public', 'messages']);

/**
 * Every source a browser renders. Test files are excluded for the same reason `globals.css`
 * keeps them out of Tailwind's scanner: a class-like string inside one is prose, not a painted
 * element.
 */
function renderedSources(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (NOT_RENDERED.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) renderedSources(full, found);
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) found.push(full);
  }
  return found;
}

/**
 * Every `className` value in a source: a quoted string, or the balanced `{ ... }` expression a
 * `cn()` call fills. One value is one painted element, which is the unit the rule is about, and
 * it is why this is not a line grep: the ground and the text colour of one element routinely sit
 * on different lines of the same `cn()`.
 *
 * Comments inside the expression are skipped rather than scanned as code. They are full of prose
 * apostrophes, and one of those read as an opening quote desynchronises the brace matcher for the
 * rest of the file: before this, components/task/task-card.tsx returned a single "value" running
 * from its `cn(` to the last line of the component, which reported the card's hover ground and
 * the overdue date's colour as one painted element when they are two.
 */
function classNameValues(source: string): string[] {
  const values: string[] = [];
  for (const attribute of source.matchAll(/className\s*=\s*/g)) {
    const start = attribute.index + attribute[0].length;
    const opener = source.charAt(start);
    let end = start;
    if (opener === '"' || opener === "'" || opener === '`') {
      end = start + 1;
      while (end < source.length && source.charAt(end) !== opener) {
        end += source.charAt(end) === '\\' ? 2 : 1;
      }
      end += 1;
    } else if (opener === '{') {
      let depth = 0;
      let quote = '';
      while (end < source.length) {
        const character = source.charAt(end);
        const pair = source.slice(end, end + 2);
        if (quote !== '') {
          if (character === '\\') end += 1;
          else if (character === quote) quote = '';
        } else if (pair === '//') {
          const lineEnd = source.indexOf('\n', end);
          end = lineEnd === -1 ? source.length : lineEnd;
        } else if (pair === '/*') {
          const blockEnd = source.indexOf('*/', end + 2);
          end = blockEnd === -1 ? source.length : blockEnd + 1;
        } else if (character === '"' || character === "'" || character === '`') {
          quote = character;
        } else if (character === '{') {
          depth += 1;
        } else if (character === '}') {
          depth -= 1;
          if (depth === 0) {
            end += 1;
            break;
          }
        }
        end += 1;
      }
    } else {
      continue;
    }
    values.push(source.slice(start, end));
  }
  return values;
}

/**
 * The class strings a `cva()` call holds, one string per painted element.
 *
 * `className=` is not the only place an element's classes are written: components/ui/button.tsx
 * spells every variant inside `cva(...)`, so a scan that reads only the attribute is blind to
 * the whole primitive and to the six alpha derivatives it paints.
 */
function variantValues(source: string): string[] {
  const values: string[] = [];
  for (const call of source.matchAll(/\bcva\s*\(/g)) {
    let index = call.index + call[0].length;
    let depth = 1;
    let quote = '';
    let literal = '';
    while (index < source.length && depth > 0) {
      const character = source.charAt(index);
      const pair = source.slice(index, index + 2);
      if (quote !== '') {
        if (character === '\\') {
          literal += source.charAt(index + 1);
          index += 2;
          continue;
        }
        if (character === quote) {
          values.push(literal);
          literal = '';
          quote = '';
        } else {
          literal += character;
        }
      } else if (pair === '//') {
        // Skipped for the reason `classNameValues` skips them: the size variant's doc comment
        // is prose, and its apostrophes are not string delimiters.
        const lineEnd = source.indexOf('\n', index);
        index = lineEnd === -1 ? source.length : lineEnd;
      } else if (pair === '/*') {
        const blockEnd = source.indexOf('*/', index + 2);
        index = blockEnd === -1 ? source.length : blockEnd + 1;
      } else if (character === '"' || character === "'" || character === '`') {
        quote = character;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
      }
      index += 1;
    }
  }
  return values;
}

/** Every class string a source paints an element with, from either place one can be written. */
function paintedValues(source: string): string[] {
  return [...classNameValues(source), ...variantValues(source)];
}

/** A utility is present under any variant prefix (`dark:`, `focus:`) and any alpha suffix. */
function utilityPresent(value: string, utility: string): boolean {
  return new RegExp(`(?<![a-z0-9])${utility}(?![-\\w])`).test(value);
}

function siteLine(file: string, text: string, ground: string): string {
  return `${file}: ${text} on ${ground}`;
}

function relativeToWeb(file: string): string {
  return path.relative(webRoot, file).split(path.sep).join('/');
}

function paintedCallSites(): string[] {
  const found: string[] = [];
  for (const file of renderedSources(webRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const value of paintedValues(source)) {
      for (const [ground] of GROUNDS) {
        if (!utilityPresent(value, ground)) continue;
        for (const [text] of TEXTS) {
          if (!utilityPresent(value, text)) continue;
          found.push(siteLine(relativeToWeb(file), text, ground));
        }
      }
    }
  }
  return [...new Set(found)].sort();
}

/**
 * What the tree paints today, with the ratio each pairing measures and who clears it. The
 * mention chip and the workspace initial used to be here, both below the 4.5 floor in light;
 * both now wear `text-foreground` on the tint instead, so the one entry left is never actually
 * rendered.
 */
const PINNED_CALL_SITES: {
  file: string;
  text: TextClass;
  ground: GroundClass;
  light: number;
  dark: number;
  note: string;
}[] = [
  {
    file: 'components/ui/dropdown-menu.tsx',
    text: 'text-destructive',
    ground: 'bg-accent',
    light: 4.99,
    dark: 4.13,
    // Never rendered: `data-[variant=destructive]:focus:bg-destructive/10` replaces
    // `focus:bg-accent` on exactly the variant that turns the text destructive, so a destructive
    // item's focus ground is never `--accent`. Pinned so that dropping the override shows here.
    note: 'the variant that turns the text destructive replaces the accent focus ground',
  },
];

/**
 * The nesting a per-element scan cannot see.
 *
 * `paintedCallSites()` asks whether one element writes both a ground and a risky text colour,
 * which is the question a single `cn()` call answers. It is not the question the rule asks: a row
 * wearing `hover:bg-accent` puts that ground under every descendant, and a copper link inside it
 * is a different element in a different `className`. Deriving real ancestry from source text
 * means a JSX parser, and a JSX parser inside a contrast gate is a worse bet than a list somebody
 * has actually read.
 *
 * So the cheap half is automated instead: a file that paints one of those grounds anywhere and
 * one of those text colours anywhere has to be listed here with a note saying how the two are
 * kept apart. Seven qualify today and every one of them was read; in six the text is a sibling
 * error branch that renders instead of the list rather than inside it.
 */
const GROUND_AND_TEXT_IN_ONE_FILE: { file: string; note: string }[] = [
  {
    file: 'components/board/board-list.tsx',
    note: 'the destructive line is the load-failure branch, which returns before the card grid',
  },
  {
    file: 'components/notification/notification-menu-content.tsx',
    note:
      'the destructive line replaces the row list on a failed load; unread rows carry no ' +
      'colour but the tint and `text-foreground`',
  },
  {
    file: 'components/notification/notifications-list.tsx',
    note: 'same shape: the destructive line is the branch that renders when the rows did not',
  },
  {
    file: 'components/task/task-card.tsx',
    note:
      'the one real nesting. The overdue date is `text-status-danger` inside a card whose ' +
      'ground is `bg-card` at rest, `bg-accent` on hover and the tint when selected. Worst of ' +
      'the three is the dark hover step at 4.13, which EXEMPT_PAIRS records',
  },
  {
    file: 'components/task/task-comments-section.tsx',
    note:
      'the destructive line is the comments-load failure; the accent ground is the mention ' +
      'suggestion row, which carries no colour of its own',
  },
  {
    file: 'components/ui/button.tsx',
    note:
      '`text-primary` is the link variant, which paints no ground; `hover:bg-accent` is the ' +
      'ghost and outline variants, which paint no colour. cva keeps them in separate strings',
  },
  {
    file: 'components/ui/dropdown-menu.tsx',
    note:
      'the destructive row is the pinned call site below, and the variant that turns the ' +
      'text destructive replaces the accent focus ground with its own tint',
  },
];

/** Every rendered source that paints one of `GROUNDS` and one of `TEXTS`, wherever in the file. */
function filesPairingGroundAndText(): string[] {
  const found: string[] = [];
  for (const file of renderedSources(webRoot)) {
    const values = paintedValues(readFileSync(file, 'utf8'));
    const paints = (utilities: readonly (readonly [string, string])[]): boolean =>
      utilities.some(([utility]) => values.some((value) => utilityPresent(value, utility)));
    if (paints(GROUNDS) && paints(TEXTS)) found.push(relativeToWeb(file));
  }
  return found.sort();
}

describe('the copper and destructive text exemption', () => {
  it('finds no call site the pinned list does not name', () => {
    const pinned = PINNED_CALL_SITES.map((site) =>
      siteLine(site.file, site.text, site.ground),
    ).sort();
    expect(
      paintedCallSites(),
      'copper or destructive text on the signature tint or on the hover step is exempt from the ' +
        '4.5:1 floor only while no call site draws it: move the element to text-foreground, or ' +
        'pin it above with its measured ratio and the task that clears it',
    ).toEqual(pinned);
  });

  it('finds no second file pairing a risky ground with a risky text colour', () => {
    expect(
      filesPairingGroundAndText(),
      'one element writing both is what `paintedCallSites` catches; a ground on an ancestor ' +
        'and the text on a descendant is what this catches. Read the file, and either move the ' +
        'text off the ground or add the file with a note saying how the two are kept apart',
    ).toEqual(GROUND_AND_TEXT_IN_ONE_FILE.map((entry) => entry.file).sort());
  });

  // The one pin above rests on a class still being in the string. `focus:bg-accent` and
  // `data-[variant=destructive]:focus:bg-destructive/10` both land in `@layer utilities`, and the
  // second carries one more attribute selector, so it wins and the destructive row's focus ground
  // is its own tint rather than the hover step. Nine call sites render that variant
  // (components/board/board-column.tsx and components/settings/members-settings.tsx among them),
  // so the row is not hypothetical: drop the override and the pin becomes a 4.13:1 call site
  // while the scan above still reports it as pinned and clean.
  it('keeps the destructive menu row off the accent focus ground', () => {
    const source = readFileSync(path.join(webRoot, 'components/ui/dropdown-menu.tsx'), 'utf8');
    const row = paintedValues(source).find(
      (value) => utilityPresent(value, 'text-destructive') && utilityPresent(value, 'bg-accent'),
    );
    expect(row, 'components/ui/dropdown-menu.tsx no longer paints the pinned row').toBeDefined();
    expect(row).toContain('data-[variant=destructive]:focus:bg-destructive/10');
  });

  it('keeps the ratio each pinned call site measures on record', () => {
    const drifted = PINNED_CALL_SITES.flatMap((site) =>
      THEMES.flatMap((theme) => {
        const text = hexOf(theme, tokenOf(site.text));
        const ground = hexOf(theme, tokenOf(site.ground));
        const measured = round(contrastRatio(text, ground), 2);
        return measured === site[theme]
          ? []
          : [
              `${theme}: ${siteLine(site.file, site.text, site.ground)} measures ` +
                `${measured.toFixed(2)}:1, recorded ${site[theme].toFixed(2)}:1 (${site.note})`,
            ];
      }),
    );
    expect(drifted).toEqual([]);
  });
});

/**
 * Text that is not a token.
 *
 * Every colour here goes through a token so that the two themes move together. `text-white` does
 * not, and a fixed white on a token that flips can only be right in one theme: the unread count
 * wore one on `bg-signature` and measured 5.05 in light against 2.73 in dark, which is a number
 * nobody can read. It now wears `--primary-foreground`, the token that flips with the copper
 * under it.
 *
 * The one left is shadcn's destructive button, and it is the case where the token is the wrong
 * answer: `--destructive-foreground` is dark ink in dark mode and measures 2.83 on the fill that
 * button actually paints there (`dark:bg-destructive/60`), against white's 5.71.
 */
const TEXT_ON_FILL_CALL_SITES: {
  file: string;
  text: string;
  ground: string;
  light: number;
  dark: number;
  note: string;
}[] = [
  {
    file: 'components/ui/button.tsx',
    text: '#ffffff',
    ground: '--destructive',
    light: 5.89,
    dark: 3.11,
    note:
      'the dark 3.11 is the base rule, which `dark:bg-destructive/60` replaces in dark and ' +
      'ALPHA_DERIVATIVES measures at 5.71 there. What is left under the floor is the hover, ' +
      'also in that table at 3.59: P4 owns components/ui/button.tsx',
  },
];

function filesPaintingRawText(): string[] {
  const found: string[] = [];
  for (const file of renderedSources(webRoot)) {
    const values = paintedValues(readFileSync(file, 'utf8'));
    if (values.some((value) => utilityPresent(value, 'text-white')))
      found.push(relativeToWeb(file));
  }
  return found.sort();
}

describe('text that is not a token', () => {
  it('finds no untokenised text colour the pinned list does not name', () => {
    expect(
      filesPaintingRawText(),
      'a raw palette colour cannot flip with the theme: move it to the -foreground token of the ' +
        'fill it sits on, or pin it here with what it measures in both themes',
    ).toEqual(TEXT_ON_FILL_CALL_SITES.map((site) => site.file).sort());
  });

  it('keeps the ratio each untokenised pin measures on record', () => {
    const drifted = TEXT_ON_FILL_CALL_SITES.flatMap((site) =>
      THEMES.flatMap((theme) => {
        const measured = round(contrastRatio(site.text, hexOf(theme, site.ground)), 2);
        return measured === site[theme]
          ? []
          : [
              `${theme}: ${site.file} draws ${site.text} on ${site.ground} at ` +
                `${measured.toFixed(2)}:1, recorded ${site[theme].toFixed(2)}:1 (${site.note})`,
            ];
      }),
    );
    expect(drifted).toEqual([]);
  });
});

/**
 * Alpha derivatives, the half of the tree the token gates cannot see.
 *
 * A colour that clears its floor as a solid can miss it as a wash: `bg-destructive/60` is not
 * `--destructive`, it is `--destructive` mixed with whatever the element happens to be sitting
 * on, and until it is composited over that ground the number means nothing. Whole-element
 * `opacity-*` does the same thing to a colour that was never written with an alpha at all.
 *
 * Each row below carries the utility exactly as a source writes it, every file that writes it,
 * the token the alpha thins, the surfaces the element can sit on, and the ratio the composite
 * measures against `text` on the least forgiving of them. `text: 'self'` marks a ring, an edge
 * or a ghosted element: there the composite *is* what has to be seen, so it is measured against
 * the ground it is drawn over.
 *
 * The inventory is exhaustive by construction. `paintedAlphaDerivatives()` rescans every
 * rendered source, and this list has to name what it finds file by file, so a new alpha utility
 * fails the gate until somebody has worked out what it lands on and measured it there.
 */
type AlphaRow = {
  utility: string;
  files: string[];
  fill: string;
  alpha: number;
  over: readonly string[];
  /** A token name, a literal `#rrggbb`, or `self` for a mark measured against its own ground. */
  text: string;
  floor: number;
  themes: Theme[];
  worst: Partial<Record<Theme, number>>;
  /** Set only where the worst measurement is under the floor. */
  reason?: string;
};

const ALPHA_DERIVATIVES: AlphaRow[] = [
  {
    utility: 'bg-muted/90',
    files: ['components/board/board-column.tsx'],
    fill: '--muted',
    alpha: 0.9,
    // The sticky column header. Its ground is the column itself, which turns into the signature
    // tint while dnd-kit reports the column as the drop target.
    over: ['--muted', '--signature-subtle'],
    text: '--muted-foreground',
    floor: AA_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 5.01, dark: 6.2 },
  },
  {
    utility: 'bg-background/95',
    files: ['components/layout/topbar.tsx'],
    fill: '--background',
    alpha: 0.95,
    over: ['--background'],
    text: '--muted-foreground',
    floor: AA_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 5.29, dark: 6.76 },
  },
  {
    utility: 'bg-muted/40',
    files: ['components/settings/token-created-dialog.tsx'],
    fill: '--muted',
    alpha: 0.4,
    // Inside a dialog, whose surface is `bg-popover` since the dark elevation change.
    over: ['--popover'],
    text: '--foreground',
    floor: AA_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 16.41, dark: 12.85 },
  },
  {
    utility: 'hover:bg-primary/90',
    files: ['components/ui/button.tsx'],
    fill: '--primary',
    alpha: 0.9,
    over: NEUTRAL_SURFACES,
    text: '--primary-foreground',
    floor: AA_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 4.17, dark: 5.6 },
    reason:
      'shadcn hovers a filled button by thinning the fill, which on a light page mixes the ' +
      'copper toward white and takes the white label under 4.5 (4.17 on a card). Hovering the ' +
      'primary action the other way needs a --primary-hover token, which is a palette decision ' +
      'this gate does not own; P4 owns components/ui/button.tsx',
  },
  {
    utility: 'hover:bg-destructive/90',
    files: ['components/ui/button.tsx'],
    fill: '--destructive',
    alpha: 0.9,
    over: NEUTRAL_SURFACES,
    text: '#ffffff',
    floor: AA_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 5.1, dark: 3.59 },
    reason:
      'the same shadcn hover, and in dark it outranks `dark:bg-destructive/60` on specificity, ' +
      'so hovering undoes the one rule that made the dark destructive button readable (5.71 ' +
      'resting, 3.59 hovered). P4 owns components/ui/button.tsx',
  },
  {
    utility: 'dark:bg-destructive/60',
    files: ['components/ui/button.tsx'],
    fill: '--destructive',
    alpha: 0.6,
    over: NEUTRAL_SURFACES,
    // `text-white`, not `--destructive-foreground`: the token is dark ink in dark mode and
    // measures 2.83 on this fill, against white's 5.71. See TEXT_ON_FILL_CALL_SITES.
    text: '#ffffff',
    floor: AA_TEXT,
    themes: ['dark'],
    worst: { dark: 5.71 },
  },
  {
    utility: 'hover:bg-secondary/80',
    files: ['components/ui/button.tsx'],
    fill: '--secondary',
    alpha: 0.8,
    over: NEUTRAL_SURFACES,
    text: '--secondary-foreground',
    floor: AA_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 14.68, dark: 11.07 },
  },
  {
    utility: 'dark:hover:bg-accent/50',
    files: ['components/ui/button.tsx'],
    fill: '--accent',
    alpha: 0.5,
    over: NEUTRAL_SURFACES,
    text: '--accent-foreground',
    floor: AA_TEXT,
    themes: ['dark'],
    worst: { dark: 11.39 },
  },
  {
    utility: 'data-[variant=destructive]:focus:bg-destructive/10',
    files: ['components/ui/dropdown-menu.tsx'],
    fill: '--destructive',
    alpha: 0.1,
    over: ['--popover'],
    text: '--destructive',
    floor: AA_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 5.04, dark: 4.06 },
    reason:
      'a destructive row keeps --destructive as its label, so every point the focus tint gains ' +
      'it loses again underneath. Dark --destructive clears 4.5 on the flat popover (4.62) and ' +
      'on nothing raised above it: the accent hover step measures 4.13 and this tint 4.06. ' +
      'Closing it means a darker dark --destructive, which is a palette decision',
  },
  {
    utility: 'focus-visible:ring-ring/50',
    files: [
      'components/task/sortable-task-card.tsx',
      'components/task/task-card.tsx',
      'components/ui/button.tsx',
      'components/ui/input.tsx',
      'components/ui/select.tsx',
      'components/ui/textarea.tsx',
    ],
    fill: '--ring',
    alpha: 0.5,
    over: SURFACES,
    text: 'self',
    floor: AA_NON_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 1.91, dark: 2.25 },
    reason:
      'a halo, not the focus mark. `:focus-visible` in globals.css is unlayered, so its 2px ' +
      'solid --ring outline outranks every utility including the `outline-none` these same ' +
      'call sites carry, and --ring at full strength is gated at 3:1 on all six surfaces above',
  },
  {
    utility: 'focus-within:ring-ring/50',
    files: ['components/board/board-template-picker.tsx'],
    fill: '--ring',
    alpha: 0.5,
    over: SURFACES,
    text: 'self',
    floor: AA_NON_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 1.91, dark: 2.25 },
    reason:
      'the same halo around a label whose radio child takes the unlayered outline, next to a ' +
      'full-strength `focus-within:border-ring` on the label itself',
  },
  {
    utility: 'aria-invalid:ring-destructive/20',
    files: [
      'components/ui/button.tsx',
      'components/ui/input.tsx',
      'components/ui/select.tsx',
      'components/ui/textarea.tsx',
    ],
    fill: '--destructive',
    alpha: 0.2,
    over: NEUTRAL_SURFACES,
    text: 'self',
    floor: AA_NON_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 1.38, dark: 1.31 },
    reason:
      'a halo beside `aria-invalid:border-destructive`, which draws the same edge at full ' +
      'strength and is gated at 3:1 above',
  },
  {
    utility: 'dark:aria-invalid:ring-destructive/40',
    files: [
      'components/ui/button.tsx',
      'components/ui/input.tsx',
      'components/ui/select.tsx',
      'components/ui/textarea.tsx',
    ],
    fill: '--destructive',
    alpha: 0.4,
    over: NEUTRAL_SURFACES,
    text: 'self',
    floor: AA_NON_TEXT,
    themes: ['dark'],
    worst: { dark: 1.81 },
    reason: 'the dark half of the same halo, beside the same full-strength border',
  },
  {
    utility: 'focus-visible:ring-destructive/20',
    files: ['components/ui/button.tsx'],
    fill: '--destructive',
    alpha: 0.2,
    over: NEUTRAL_SURFACES,
    text: 'self',
    floor: AA_NON_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 1.38, dark: 1.31 },
    reason: 'the destructive variant tinting its focus halo, over the unlayered --ring outline',
  },
  {
    utility: 'dark:focus-visible:ring-destructive/40',
    files: ['components/ui/button.tsx'],
    fill: '--destructive',
    alpha: 0.4,
    over: NEUTRAL_SURFACES,
    text: 'self',
    floor: AA_NON_TEXT,
    themes: ['dark'],
    worst: { dark: 1.81 },
    reason: 'the dark half of the same halo, over the same unlayered outline',
  },
  {
    utility: 'disabled:opacity-50',
    files: [
      'components/ui/button.tsx',
      'components/ui/input.tsx',
      'components/ui/select.tsx',
      'components/ui/textarea.tsx',
    ],
    fill: '--foreground',
    alpha: 0.5,
    over: NEUTRAL_SURFACES,
    text: 'self',
    floor: AA_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 3.21, dark: 4.21 },
    reason:
      'WCAG 1.4.3 exempts text in an inactive control, and docs/design.md §9 holds disabled ' +
      'text to 3:1 anyway, which this clears. It is worth noting rather than hiding that ' +
      '--foreground-disabled exists, is gated at 3:1 above, and no control reads it: a drawn ' +
      'disabled colour would be steadier than an alpha over an unknown ground',
  },
  {
    utility: 'data-[disabled]:opacity-50',
    files: ['components/ui/dropdown-menu.tsx'],
    fill: '--foreground',
    alpha: 0.5,
    over: NEUTRAL_SURFACES,
    text: 'self',
    floor: AA_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 3.21, dark: 4.21 },
    reason: 'the same inactive-control exemption, on a menu row',
  },
  {
    utility: 'peer-disabled:opacity-50',
    files: ['components/ui/label.tsx'],
    fill: '--foreground',
    alpha: 0.5,
    over: NEUTRAL_SURFACES,
    text: 'self',
    floor: AA_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 3.21, dark: 4.21 },
    reason: 'the same exemption, on the label of a disabled field',
  },
  {
    utility: 'group-data-[disabled=true]:opacity-50',
    files: ['components/ui/label.tsx'],
    fill: '--foreground',
    alpha: 0.5,
    over: NEUTRAL_SURFACES,
    text: 'self',
    floor: AA_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 3.21, dark: 4.21 },
    reason: 'the same exemption, on the label of a disabled field group',
  },
  {
    utility: 'opacity-70',
    files: ['components/board/board-filter-chips.tsx', 'components/ui/dialog.tsx'],
    fill: '--foreground',
    alpha: 0.7,
    // The chip's dismiss glyph on the column ground, and the dialog's close glyph on the dialog.
    over: ['--muted', '--popover'],
    text: 'self',
    floor: AA_NON_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 5.98, dark: 6.69 },
  },
  {
    utility: 'opacity-40',
    files: ['components/task/sortable-task-card.tsx'],
    fill: '--foreground',
    alpha: 0.4,
    over: ['--muted'],
    text: 'self',
    floor: AA_TEXT,
    themes: ['light', 'dark'],
    worst: { light: 2.45, dark: 3.35 },
    reason:
      'the hole a card leaves in the column while it is being dragged. What the reader is ' +
      'following is the drag overlay under the pointer, drawn at full strength with the ' +
      '--elevation-drag ring; this is the slot it came from, and a slot that read as strongly ' +
      'as the card would say two cards are in play',
  },
];

/** One 8-bit channel of `fill` at `alpha` over `ground`, the way the compositor mixes them. */
function composite(fill: string, ground: string, alpha: number): string {
  const front = rgb(fill);
  const back = rgb(ground);
  const mix = (over: number, under: number): string =>
    Math.round(over * alpha + under * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(front.red, back.red)}${mix(front.green, back.green)}${mix(front.blue, back.blue)}`;
}

/** The ground `row` measures worst on in `theme`, and the ratio it measures there. */
function worstComposite(theme: Theme, row: AlphaRow): { surface: string; measured: number } {
  let worst = { surface: row.over[0] as string, measured: Number.POSITIVE_INFINITY };
  for (const surface of row.over) {
    const ground = hexOf(theme, surface);
    const mixed = composite(hexOf(theme, row.fill), ground, row.alpha);
    const foreground =
      row.text === 'self' ? mixed : row.text.startsWith('#') ? row.text : hexOf(theme, row.text);
    const background = row.text === 'self' ? ground : mixed;
    const measured = round(contrastRatio(foreground, background), 2);
    if (measured < worst.measured) worst = { surface, measured };
  }
  return worst;
}

/**
 * Every alpha derivative a rendered source paints, as `file: utility`.
 *
 * Read out of the painted class strings rather than the raw file, for the reason
 * `classNameValues` exists: a utility named in a doc comment is prose, and the comment above
 * `DropdownMenuItem` names the one this phase deleted. `opacity-100` is skipped because
 * restoring full opacity cannot thin anything.
 */
const ALPHA_UTILITY =
  /(?<![\w./-])((?:[a-z-]+(?:\[[^\]]*\])?:)*(?:(?:bg|text|border|ring|from|via|to|shadow|fill|stroke|outline|decoration|divide|caret|placeholder)(?:-[a-z0-9]+)*\/\d+|opacity-\d+))/g;

function paintedAlphaDerivatives(): string[] {
  const found: string[] = [];
  for (const file of renderedSources(webRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const value of paintedValues(source)) {
      for (const match of value.matchAll(ALPHA_UTILITY)) {
        const utility = match[1] as string;
        if (utility.endsWith('opacity-100')) continue;
        found.push(`${relativeToWeb(file)}: ${utility}`);
      }
    }
  }
  return [...new Set(found)].sort();
}

describe('alpha derivatives', () => {
  it('names every alpha derivative the tree paints', () => {
    const listed = ALPHA_DERIVATIVES.flatMap((row) =>
      row.files.map((file) => `${file}: ${row.utility}`),
    ).sort();
    expect(
      paintedAlphaDerivatives(),
      'an alpha utility is a colour nothing has measured until it is composited over the ' +
        'ground it lands on: add the row with its fill, its grounds and the ratio it measures',
    ).toEqual(listed);
  });

  it('measures each alpha composite at the number it records', () => {
    const drifted = ALPHA_DERIVATIVES.flatMap((row) =>
      row.themes.flatMap((theme) => {
        const recorded = row.worst[theme];
        const { surface, measured } = worstComposite(theme, row);
        return recorded === measured
          ? []
          : [
              `${theme}: ${row.utility} over ${surface} measures ${measured.toFixed(2)}:1, ` +
                `recorded ${recorded === undefined ? 'nothing' : recorded.toFixed(2)}:1`,
            ];
      }),
    );
    expect(drifted).toEqual([]);
  });

  it('holds every alpha composite at its floor unless the row carries a reason', () => {
    const failures = ALPHA_DERIVATIVES.filter((row) => row.reason === undefined).flatMap((row) =>
      row.themes.flatMap((theme) => {
        const { surface, measured } = worstComposite(theme, row);
        return measured >= row.floor
          ? []
          : [
              `${theme}: ${row.utility} over ${surface} is ${measured.toFixed(2)}:1, below ` +
                `${row.floor.toFixed(1)}:1`,
            ];
      }),
    );
    expect(failures).toEqual([]);
  });

  it('keeps every excused alpha composite on the excused side of its floor', () => {
    const retired = ALPHA_DERIVATIVES.filter((row) => row.reason !== undefined).flatMap((row) =>
      row.themes.every((theme) => worstComposite(theme, row).measured >= row.floor)
        ? [
            `${row.utility} now clears ${row.floor.toFixed(1)}:1 in every theme it applies to: ` +
              'delete its reason and let the gate hold it',
          ]
        : [],
    );
    expect(retired).toEqual([]);
  });
});

describe('dark elevation ramp', () => {
  // Canvas to hover step, each surface one visible step above the last. Dark depth is a lighter
  // surface, not a shadow (docs/design.md §3), so a step that stops reading is the whole
  // hierarchy stopping.
  const RAMP = ['--background', '--muted', '--card', '--popover', '--accent'] as const;

  it('keeps every adjacent surface step distinguishable', () => {
    const failures: string[] = [];
    RAMP.forEach((surface, index) => {
      const next = RAMP[index + 1];
      if (!next) return;
      const lower = hexOf('dark', surface);
      const upper = hexOf('dark', next);
      const measured = round(contrastRatio(lower, upper), 3);
      if (luminance(upper) <= luminance(lower)) {
        failures.push(`dark: ${next} ${upper} is not above ${surface} ${lower} on the ramp`);
      } else if (measured < SURFACE_STEP) {
        failures.push(
          `dark: ${surface} ${lower} to ${next} ${upper} is ` +
            `${measured.toFixed(3)}:1, below ${SURFACE_STEP.toFixed(2)}:1`,
        );
      }
    });
    expect(failures).toEqual([]);
  });

  // The menu ground is `bg-popover` and the highlighted item is `bg-accent`
  // (components/ui/dropdown-menu.tsx), and the items carry `outline-hidden`, so the surface step
  // is the only thing that says which row is focused. Equalising the two tokens would make every
  // dark dropdown highlight 1.000:1.
  it('keeps --popover and --accent two different surfaces', () => {
    const popover = hexOf('dark', '--popover');
    const accent = hexOf('dark', '--accent');
    expect(accent, 'dark --popover and --accent must not be the same value').not.toBe(popover);
    expect(
      round(contrastRatio(popover, accent), 3),
      `dark --popover ${popover} against --accent ${accent}`,
    ).toBeGreaterThanOrEqual(SURFACE_STEP);
  });

  // A blurred shadow does not read on a canvas this dark (a 12% black shadow lands at L* 7.3),
  // so dark elevation carries a 1px --border-strong ring instead; --border-strong's own 3:1
  // floor on every surface is gated above, this only confirms the ring is actually drawn.
  it('carries a 1px --border-strong ring on --elevation-overlay and --elevation-drag', () => {
    for (const token of ['--elevation-overlay', '--elevation-drag']) {
      const value = darkDeclarations.get(token);
      expect(value, `.dark declares no ${token}`).toBeDefined();
      expect(value).toContain('0 0 0 1px var(--border-strong)');
    }
  });
});

describe('light elevation', () => {
  // The five hover surfaces move from `bg-muted/40` to `bg-accent`, so `--accent` has to be a
  // real step away from both grounds it is painted over in light: the white card and the column.
  it('keeps --accent a visible step below --card and --muted', () => {
    const accent = hexOf('light', '--accent');
    for (const ground of ['--card', '--muted'] as const) {
      const surface = hexOf('light', ground);
      expect(
        round(contrastRatio(surface, accent), 3),
        `light ${ground} ${surface} against --accent ${accent}`,
      ).toBeGreaterThanOrEqual(SURFACE_STEP);
    }
  });

  // The other half of what docs/design.md §3 asks of light: the card is lighter than the canvas
  // and far enough from it to read as raised without a shadow. Nothing walks a chain here, and
  // the canvas being a step *down* from the card rather than up is the whole difference from the
  // dark ramp above.
  it('keeps --card a visible step above --background', () => {
    const canvas = hexOf('light', '--background');
    const card = hexOf('light', '--card');
    expect(luminance(card), `light --card ${card} against --background ${canvas}`).toBeGreaterThan(
      luminance(canvas),
    );
    expect(
      round(contrastRatio(canvas, card), 3),
      `light --background ${canvas} against --card ${card}`,
    ).toBeGreaterThanOrEqual(SURFACE_STEP);
  });

  // `--card` and `--popover` hold one value in light (docs/design.md §3), and a popover is told
  // apart by its shadow. Either that stays true or the two part company by a full step: a
  // fraction of one would be a surface change nobody can see and a claim in the docs nobody
  // could check.
  it('keeps --card and --popover one surface or a whole step apart', () => {
    const card = hexOf('light', '--card');
    const popover = hexOf('light', '--popover');
    const measured = round(contrastRatio(card, popover), 3);
    expect(
      card === popover || measured >= SURFACE_STEP,
      `light --card ${card} against --popover ${popover} is ${measured.toFixed(3)}:1, neither ` +
        `one surface nor a ${SURFACE_STEP.toFixed(2)}:1 step`,
    ).toBe(true);
  });
});

/**
 * APCA 0.1.9 (the published SAPC constants), implemented here rather than pulled in as a
 * dependency: it is one formula, and a contrast gate should not grow a supply chain.
 */
const APCA = {
  trc: 2.4,
  red: 0.2126729,
  green: 0.7151522,
  blue: 0.072175,
  normBackground: 0.56,
  normText: 0.57,
  reverseText: 0.62,
  reverseBackground: 0.65,
  blackThreshold: 0.022,
  blackClamp: 1.414,
  scale: 1.14,
  offset: 0.027,
  deltaYMin: 0.0005,
  lowClip: 0.1,
};

function apcaLuminance(hex: string): number {
  const { red, green, blue } = rgb(hex);
  return (
    APCA.red * (red / 255) ** APCA.trc +
    APCA.green * (green / 255) ** APCA.trc +
    APCA.blue * (blue / 255) ** APCA.trc
  );
}

/** Absolute lightness contrast Lc. APCA carries polarity in the sign; the floors are stated on
 *  the magnitude, so the sign is dropped here. */
function lightnessContrast(text: string, background: string): number {
  let textY = apcaLuminance(text);
  let backgroundY = apcaLuminance(background);
  if (textY < APCA.blackThreshold) textY += (APCA.blackThreshold - textY) ** APCA.blackClamp;
  if (backgroundY < APCA.blackThreshold) {
    backgroundY += (APCA.blackThreshold - backgroundY) ** APCA.blackClamp;
  }
  if (Math.abs(backgroundY - textY) < APCA.deltaYMin) return 0;
  const sapc =
    backgroundY > textY
      ? (backgroundY ** APCA.normBackground - textY ** APCA.normText) * APCA.scale
      : (backgroundY ** APCA.reverseBackground - textY ** APCA.reverseText) * APCA.scale;
  if (Math.abs(sapc) < APCA.lowClip) return 0;
  const lc = (sapc > 0 ? sapc - APCA.offset : sapc + APCA.offset) * 100;
  return Math.round(Math.abs(lc) * 10) / 10;
}

describe('APCA on the dark theme', () => {
  const BODY_TEXT_FLOOR = 75;

  // Only `--foreground` is gated. WCAG 2.x AA is this project's binding standard and the three
  // secondary tokens below clear it on every surface; APCA scores them lower because it models
  // light-on-dark polarity, and the values that would satisfy both are outside the ramp this
  // phase settled on. They are reported rather than asserted, and named in the phase report as
  // the APCA / WCAG divergence pairs.
  it('holds --foreground at Lc 75 on every dark surface', () => {
    const foreground = hexOf('dark', '--foreground');
    const failures = SURFACES.flatMap((surface) => {
      const background = hexOf('dark', surface);
      const lc = lightnessContrast(foreground, background);
      return lc >= BODY_TEXT_FLOOR
        ? []
        : [
            `dark: --foreground ${foreground} on ${surface} ${background} is ` +
              `Lc ${lc.toFixed(1)}, below Lc ${BODY_TEXT_FLOOR}`,
          ];
    });
    expect(failures).toEqual([]);
  });

  /**
   * The divergence itself is what is asserted, in both directions.
   *
   * Each token below has to clear the WCAG floor this file gates it at on all six dark surfaces
   * *and* score under Lc 75. Widening the gap fails on the first half; closing it fails on the
   * second, which is the half that matters: the day a token move lifts one of these past Lc 75,
   * this stops being a divergence to report and becomes a pair the gate above can simply hold,
   * and the note explaining the exception should go with it. Asserting only that three rows come
   * back, which is what this test did before, asserts nothing about either.
   */
  it('keeps every reported token AA on WCAG and under the APCA body floor', () => {
    const reported: { token: string; floor: number }[] = [
      { token: '--foreground-secondary', floor: AA_TEXT },
      { token: '--muted-foreground', floor: AA_TEXT },
      // Disabled text is held to 3:1, not 4.5, here and in docs/design.md §9.
      { token: '--foreground-disabled', floor: AA_NON_TEXT },
    ];
    const rows = reported.map(({ token }) => {
      const text = hexOf('dark', token);
      const cells = SURFACES.map(
        (surface) => `${surface.slice(2)} ${lightnessContrast(text, hexOf('dark', surface))}`,
      );
      return `${token} ${text}: ${cells.join(', ')}`;
    });
    // Printed as well as asserted, and visible with `vitest --reporter=verbose`: the phase report
    // quotes this table as the APCA / WCAG divergence list.
    console.log(['APCA Lc, dark theme (divergence from WCAG AA):', ...rows].join('\n  '));

    const broken = reported.flatMap(({ token, floor }) =>
      SURFACES.flatMap((surface) => {
        const text = hexOf('dark', token);
        const background = hexOf('dark', surface);
        const wcag = round(contrastRatio(text, background), 2);
        const lc = lightnessContrast(text, background);
        if (wcag < floor) {
          return [
            `dark: ${token} ${text} on ${surface} ${background} is ${wcag.toFixed(2)}:1, below ` +
              `the ${floor.toFixed(1)}:1 it is reported as clearing`,
          ];
        }
        if (lc >= BODY_TEXT_FLOOR) {
          return [
            `dark: ${token} ${text} on ${surface} ${background} now scores Lc ${lc.toFixed(1)}, ` +
              `at or above Lc ${BODY_TEXT_FLOOR}: it no longer diverges, so gate it instead of ` +
              'reporting it',
          ];
        }
        return [];
      }),
    );
    expect(broken).toEqual([]);
  });
});
