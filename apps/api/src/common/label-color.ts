import { LabelColorSlot } from '@kurultay/shared-types';

const SLOTS = new Set<string>(Object.values(LabelColorSlot));

/** Every theme defines slot 1, so it is the safe thing to render an unknown value as. */
const FALLBACK_SLOT = LabelColorSlot['slot-1'];

/**
 * Narrows the stored `Label.color` to a design-token slot.
 *
 * The column is plain text rather than a Postgres enum, so a row seeded by hand or left
 * behind by a retired slot can hold something the client has no class for. Reads coerce
 * instead of asserting: a wrong-coloured chip beats a crashed board.
 */
export function toLabelColorSlot(value: string): LabelColorSlot {
  return SLOTS.has(value) ? (value as LabelColorSlot) : FALLBACK_SLOT;
}
