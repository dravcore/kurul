import { readFileSync } from 'node:fs';
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
 * Exemptions are named lists carrying their measured number and their reason, never a lowered
 * threshold: adding to one is a diff a reviewer sees.
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

/** The smallest ratio at which two neighbouring surfaces still read as two surfaces. */
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

/** The four surfaces copper and destructive text may sit on. See COPPER_AND_DESTRUCTIVE_TEXT. */
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
 * Exempt on `--accent` and `--signature-subtle`, measured light copper 4.28 on accent and 4.11 on
 * the tint, dark destructive 4.13 on accent. The design rule is what makes the exemption safe
 * rather than the number: docs/design.md keeps copper text off the signature tint, and no call
 * site may put copper or destructive text on the hover step, which is a grep, not a measurement.
 */
const COPPER_AND_DESTRUCTIVE_TEXT = ['--primary', '--signature', '--destructive'];

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
 * Label slots are gated at 3:1 because a slot colour is only ever a dot or a chart mark; drawing
 * text in a slot colour is forbidden (docs/design.md §8: text wears text tokens).
 *
 * The four light slots below stay under 3:1 on all six surfaces (worst measured: slot 2
 * 2.61, slot 3 2.29, slot 4 1.76, slot 5 2.19). docs/design.md §8 already records slots 3/4/5 as
 * a contrast WARN and names the relief: the dot is `aria-hidden` and always paired with the
 * label's own name, and every chart offers direct labels plus a table view. The slot palette is
 * a design decision this gate does not own, so the four are listed rather than silently passing.
 */
const SLOT_EXEMPT: Record<Theme, string[]> = {
  light: ['--label-slot-2', '--label-slot-3', '--label-slot-4', '--label-slot-5'],
  dark: [],
};

function belowFloor(
  theme: Theme,
  tokenNames: readonly string[],
  surfaces: readonly string[],
  floor: number,
): string[] {
  const failures: string[] = [];
  for (const token of tokenNames) {
    const foreground = hexOf(theme, token);
    for (const surface of surfaces) {
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

for (const theme of THEMES) {
  describe(`${theme} theme`, () => {
    it('holds every text token at 4.5:1 on every surface', () => {
      expect(belowFloor(theme, TEXT_TOKENS, SURFACES, AA_TEXT)).toEqual([]);
    });

    it('holds --foreground-disabled at 3:1 on every surface', () => {
      expect(belowFloor(theme, ['--foreground-disabled'], SURFACES, AA_NON_TEXT)).toEqual([]);
    });

    it('holds copper and destructive text at 4.5:1 on the surfaces that may carry it', () => {
      expect(belowFloor(theme, COPPER_AND_DESTRUCTIVE_TEXT, NEUTRAL_SURFACES, AA_TEXT)).toEqual([]);
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
      const gated = LABEL_SLOTS.filter((slot) => !SLOT_EXEMPT[theme].includes(slot));
      expect(belowFloor(theme, gated, SURFACES, AA_NON_TEXT)).toEqual([]);
    });
  });
}

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
});

describe('light hover step', () => {
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

  it('reports the Lc of the dark text tokens APCA scores below the body floor', () => {
    const reported = ['--foreground-secondary', '--muted-foreground', '--foreground-disabled'];
    const rows = reported.map((token) => {
      const text = hexOf('dark', token);
      const cells = SURFACES.map(
        (surface) => `${surface.slice(2)} ${lightnessContrast(text, hexOf('dark', surface))}`,
      );
      return `${token} ${text}: ${cells.join(', ')}`;
    });
    // Printed rather than asserted, and visible with `vitest --reporter=verbose`: see the note
    // on the gate above.
    console.log(['APCA Lc, dark theme (reported, not gated):', ...rows].join('\n  '));
    expect(rows).toHaveLength(reported.length);
  });
});
