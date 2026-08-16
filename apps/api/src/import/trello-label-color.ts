import { LabelColorSlot } from '@kurul/shared-types';

/**
 * Trello's colour vocabulary, folded onto this repository's eight design-token slots.
 *
 * Lossy, and deliberately so. `slot-N` is not a colour — it is a slot a theme resolves, which is
 * the whole reason `Label.color` stores a slot name and never a hex value (CLAUDE.md). Trello has
 * ten base colours and this repository has eight slots, so two pairs share, and sharing is
 * cheaper than either growing the palette to fit one importer or writing a hex the theme cannot
 * honour.
 *
 * **The slot numbers were read off `apps/web/app/globals.css:40-47`, not chosen:**
 * `slot-1` `#2a78d6` (blue) · `slot-2` `#eb6834` (orange) · `slot-3` `#1baf7a` (green) ·
 * `slot-4` `#eda100` (yellow) · `slot-5` `#e87ba4` (pink) · `slot-6` `#008300` (deep green) ·
 * `slot-7` `#4a3aa7` (purple) · `slot-8` `#e34948` (red). Each slot takes the Trello colour
 * nearest it, and then the two Trello colours left over join the closest slot already taken:
 * `sky` is a cyan with no slot of its own and lands on the blue, and `black` lands on `slot-7`,
 * which is the darkest of the eight by luminance (69, against 94 for the next).
 *
 * The same file defines all eight slot names again under `.dark` at `:95-102` with different hex
 * values. That is not a complication for this table, it is the proof that the table is right to
 * exist: what is being mapped is a *role*, not a colour, so reading the light-theme values to
 * build it costs nothing.
 *
 * This table and the one in `docs/decisions/0025-trello-import-mapping.md` must agree, and no
 * test checks that they do — deliberately. A test that parsed the ADR's markdown would pin the
 * table's *formatting* rather than its content, and the two are meant to come from the same
 * source, not from each other.
 */
export const TRELLO_COLOR_TO_SLOT: Readonly<Record<string, LabelColorSlot>> = {
  blue: LabelColorSlot['slot-1'],
  orange: LabelColorSlot['slot-2'],
  green: LabelColorSlot['slot-3'],
  yellow: LabelColorSlot['slot-4'],
  pink: LabelColorSlot['slot-5'],
  lime: LabelColorSlot['slot-6'],
  purple: LabelColorSlot['slot-7'],
  red: LabelColorSlot['slot-8'],
  sky: LabelColorSlot['slot-1'],
  black: LabelColorSlot['slot-7'],
};

/** Every theme defines slot 1, which is why an unrecognised colour is safe to show as one. */
const FALLBACK_SLOT = LabelColorSlot['slot-1'];

export interface TrelloColorMapping {
  slot: LabelColorSlot;
  /**
   * `true` when the colour was not recognised and `slot-1` was substituted.
   *
   * The planner turns this into a `(label, defaulted)` row. It is a separate flag rather than
   * "the caller can compare against `slot-1`", because a label that really is blue also maps to
   * `slot-1` and must not be reported as a substitution.
   */
  defaulted: boolean;
}

/**
 * A Trello colour name to a design-token slot.
 *
 * **`toLabelColorSlot` is not called here, and that matters.** That function is a *read* rescue
 * (`apps/api/src/common/label-color.ts`): a row seeded by hand or left behind by a retired slot
 * still has to render, and a wrong-coloured chip beats a crashed board. This importer is a
 * *writer*; what it writes has to be valid at the moment it is written, not repaired on the way
 * out. Two functions that return the same value are not the same rule, and collapsing them would
 * turn "the column always holds a slot" into "the column is fixed up when it is read".
 */
export function trelloColorToSlot(color: string | null | undefined): TrelloColorMapping {
  // Trello writes `null` for a label that has a name but no colour, and writes shade suffixes
  // (`purple_dark`, `sky_light`) on newer exports. The suffix is stripped because it is a shade
  // of one colour and this repository has one slot per colour, not one per shade.
  //
  // Case is folded for a narrower reason: an unrecognised colour costs the user a report row, and
  // `Green` is not a colour this repository fails to understand — it is `green` written
  // differently. Reporting it would be noise in a list whose value depends on every row in it
  // meaning something.
  const base = (color ?? '').toLowerCase().split('_')[0] ?? '';
  const slot = TRELLO_COLOR_TO_SLOT[base];

  return slot === undefined ? { slot: FALLBACK_SLOT, defaulted: true } : { slot, defaulted: false };
}
