import { LabelColorSlot } from '@kurul/shared-types';
import { toLabelColorSlot } from './label-color';

describe('toLabelColorSlot', () => {
  it('passes a known slot through', () => {
    expect(toLabelColorSlot('slot-5')).toBe(LabelColorSlot['slot-5']);
  });

  it.each(['#ff0000', 'red', '', 'slot-99'])('coerces a value that is not a slot (%j)', (value) => {
    expect(toLabelColorSlot(value)).toBe(LabelColorSlot['slot-1']);
  });
});
