import { LabelColorSlot } from '@kurul/shared-types';
import { acceptedDto, dtoFields, rejectedDto } from '../../common/validation/dto-test-helpers';
import { CreateLabelDto } from './create-label.dto';

/**
 * `CLAUDE.md`: `Label.color` stores a theme-resolved slot name, never a raw hex — `@IsEnum` is
 * the one line standing between a client-supplied `#ff0000` and a color column the design system
 * cannot render. This DTO was at 0% before this file (audit's `src/label/dto` finding).
 */
describe('CreateLabelDto', () => {
  it('accepts a valid name and color slot', async () => {
    const dto = await acceptedDto<CreateLabelDto>(CreateLabelDto, {
      name: 'Bug',
      color: LabelColorSlot['slot-1'],
    });

    expect(dto).toMatchObject({ name: 'Bug', color: 'slot-1' });
  });

  it('rejects a raw hex color instead of a design-token slot', async () => {
    const { details } = await rejectedDto(CreateLabelDto, { name: 'Bug', color: '#ff0000' });

    expect(details).toContainEqual(
      expect.objectContaining({ field: 'color', constraint: 'isEnum' }),
    );
  });

  it('rejects a missing name', async () => {
    const { statusCode, details } = await rejectedDto(CreateLabelDto, {
      color: LabelColorSlot['slot-2'],
    });

    expect(statusCode).toBe(400);
    expect(dtoFields(details)).toContain('name');
  });

  it('rejects an empty name', async () => {
    const { details } = await rejectedDto(CreateLabelDto, {
      name: '',
      color: LabelColorSlot['slot-2'],
    });

    expect(dtoFields(details)).toContain('name');
  });

  it('rejects a name over 50 characters', async () => {
    const { details } = await rejectedDto(CreateLabelDto, {
      name: 'a'.repeat(51),
      color: LabelColorSlot['slot-2'],
    });

    expect(details).toContainEqual(
      expect.objectContaining({ field: 'name', constraint: 'maxLength' }),
    );
  });

  it('rejects a missing color', async () => {
    const { statusCode } = await rejectedDto(CreateLabelDto, { name: 'Bug' });

    expect(statusCode).toBe(400);
  });
});
