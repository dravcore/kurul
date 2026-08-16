import { LabelColorSlot } from '@kurul/shared-types';
import { toLabelColorSlot } from '../common/label-color';
import { TRELLO_COLOR_TO_SLOT, trelloColorToSlot } from './trello-label-color';

describe('trelloColorToSlot', () => {
  it.each([
    ['green', LabelColorSlot['slot-3']],
    ['blue', LabelColorSlot['slot-1']],
    ['orange', LabelColorSlot['slot-2']],
    ['yellow', LabelColorSlot['slot-4']],
    ['pink', LabelColorSlot['slot-5']],
    ['lime', LabelColorSlot['slot-6']],
    ['purple', LabelColorSlot['slot-7']],
    ['red', LabelColorSlot['slot-8']],
    ['sky', LabelColorSlot['slot-1']],
    ['black', LabelColorSlot['slot-7']],
  ])('maps %s to %s without reporting a substitution', (color, expected) => {
    expect(trelloColorToSlot(color)).toEqual({ slot: expected, defaulted: false });
  });

  it.each([
    ['purple_dark', LabelColorSlot['slot-7']],
    ['sky_light', LabelColorSlot['slot-1']],
    ['green_dark', LabelColorSlot['slot-3']],
  ])('strips the shade suffix on %s', (color, expected) => {
    // One slot per colour, not one per shade. Without the strip these are unknown colours, so
    // every label on a newer export would arrive as `slot-1` *and* be reported as a substitution.
    expect(trelloColorToSlot(color)).toEqual({ slot: expected, defaulted: false });
  });

  it.each(['GREEN', 'Sky_Light'])('folds case on %s rather than calling it unknown', (color) => {
    // An unrecognised colour costs the user a report row, and a report is only worth reading if
    // every row in it means something. `Green` is not a colour this repo fails to understand.
    expect(trelloColorToSlot(color).defaulted).toBe(false);
  });

  it.each([null, undefined, '', 'tangerine', '#ff0000', 'slot-3'])(
    'falls back to slot-1 and says so for %p',
    (color) => {
      expect(trelloColorToSlot(color)).toEqual({ slot: LabelColorSlot['slot-1'], defaulted: true });
    },
  );

  it('does not report a label that really is blue', () => {
    // The negative half of the flag. If `defaulted` were derived by comparing the result against
    // `slot-1`, every blue and every sky label on the board would be reported as a substitution
    // that never happened — and the user would go looking for a colour change that is not there.
    expect(trelloColorToSlot('blue').defaulted).toBe(false);
    expect(trelloColorToSlot('sky').defaulted).toBe(false);
    expect(trelloColorToSlot('tangerine').slot).toBe(trelloColorToSlot('blue').slot);
    expect(trelloColorToSlot('tangerine').defaulted).toBe(true);
  });

  it('never produces a value outside the slot vocabulary', () => {
    // The rule CLAUDE.md states about this column, asserted as a property rather than a list of
    // cases. Without it a future entry could be typed as a bare `string` and a raw hex would
    // reach `Label.color`, where nothing in Postgres would reject it and the board would render
    // an unstyled chip.
    const slots = new Set<string>(Object.values(LabelColorSlot));
    const inputs = [
      ...Object.keys(TRELLO_COLOR_TO_SLOT),
      'tangerine',
      null,
      undefined,
      '',
      '#ff0000',
      'green_dark',
      'rgb(1,2,3)',
      '__',
    ];

    for (const input of inputs) {
      expect(slots.has(trelloColorToSlot(input).slot)).toBe(true);
    }
  });
});

describe('TRELLO_COLOR_TO_SLOT', () => {
  it("covers Trello's ten base colours and no invented ones", () => {
    // ADR 0025 publishes this table to a human. Nothing makes the two copies agree, and a test
    // that parsed the ADR's markdown would pin its formatting rather than its content — so this
    // pins the half that can be pinned: the set of colours the table claims to know. Dropping
    // `lime` here would not fail anything else; every lime label would quietly become `slot-1`
    // and be reported as a colour this repository has never heard of.
    expect(new Set(Object.keys(TRELLO_COLOR_TO_SLOT))).toEqual(
      new Set([
        'green',
        'yellow',
        'orange',
        'red',
        'purple',
        'blue',
        'sky',
        'lime',
        'pink',
        'black',
      ]),
    );
  });

  it('reaches all eight slots, so the fold is a fold and not a collapse', () => {
    // The claim the table's comment makes: every slot takes a Trello colour first, and only the
    // two left over share. A table that mapped everything onto three slots would satisfy every
    // other test in this file while making an imported board look like it has three labels.
    expect(new Set(Object.values(TRELLO_COLOR_TO_SLOT)).size).toBe(
      Object.values(LabelColorSlot).length,
    );
  });

  it('shares exactly two slots, and no more', () => {
    const slotCounts = new Map<string, number>();
    for (const slot of Object.values(TRELLO_COLOR_TO_SLOT)) {
      slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1);
    }

    const shared = [...slotCounts.entries()].filter(([, count]) => count > 1);
    expect(shared.map(([slot]) => slot).sort()).toEqual(['slot-1', 'slot-7']);
  });
});

describe('the writer and the reader are not the same rule', () => {
  it('does not route an unknown colour through the read-side rescue', () => {
    // `toLabelColorSlot` and `trelloColorToSlot` agree on the answer for an unknown value, which
    // is exactly why this is worth stating: they are one refactor away from being collapsed into
    // each other. The read side exists so a bad row still renders; the write side exists so a bad
    // row is never written, and it has to say that a substitution happened. Only one of them can
    // say that.
    expect(toLabelColorSlot('tangerine')).toBe(LabelColorSlot['slot-1']);
    expect(trelloColorToSlot('tangerine')).toEqual({
      slot: LabelColorSlot['slot-1'],
      defaulted: true,
    });

    // And they disagree on the input that matters: a stored slot name is valid to read back and
    // is not a Trello colour to write.
    expect(toLabelColorSlot('slot-6')).toBe(LabelColorSlot['slot-6']);
    expect(trelloColorToSlot('slot-6')).toEqual({
      slot: LabelColorSlot['slot-1'],
      defaulted: true,
    });
  });
});
