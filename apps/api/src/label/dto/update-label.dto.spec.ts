import { LabelColorSlot } from '@kurul/shared-types';
import { acceptedDto, rejectedDto } from '../../common/validation/dto-test-helpers';
import { UpdateLabelDto } from './update-label.dto';

/**
 * `@OptionalNonNullable()` (`common/validation/optional.ts`) means omitting a field leaves it
 * unchanged, but an explicit `null` is refused — a label's name and color are both non-nullable
 * columns, so this DTO does not use `OptionalNullable`. That distinction is exactly the kind of
 * thing `common/validation/optional.spec.ts` warns can be flipped by hand and still typecheck.
 */
describe('UpdateLabelDto', () => {
  it('accepts an empty body — omission means "leave unchanged"', async () => {
    const dto = await acceptedDto<UpdateLabelDto>(UpdateLabelDto, {});

    expect(dto.name).toBeUndefined();
    expect(dto.color).toBeUndefined();
  });

  it('accepts a name-only update', async () => {
    const dto = await acceptedDto<UpdateLabelDto>(UpdateLabelDto, { name: 'Renamed' });

    expect(dto).toMatchObject({ name: 'Renamed' });
    expect(dto.color).toBeUndefined();
  });

  it('accepts a color-only update', async () => {
    const dto = await acceptedDto<UpdateLabelDto>(UpdateLabelDto, {
      color: LabelColorSlot['slot-3'],
    });

    expect(dto).toMatchObject({ color: 'slot-3' });
    expect(dto.name).toBeUndefined();
  });

  it('rejects an explicit null name — the column is not nullable', async () => {
    const { statusCode } = await rejectedDto(UpdateLabelDto, { name: null });

    expect(statusCode).toBe(400);
  });

  it('rejects an explicit null color', async () => {
    const { statusCode } = await rejectedDto(UpdateLabelDto, { color: null });

    expect(statusCode).toBe(400);
  });

  it('rejects a raw hex color', async () => {
    const { details } = await rejectedDto(UpdateLabelDto, { color: '#00ff00' });

    expect(details).toContainEqual(
      expect.objectContaining({ field: 'color', constraint: 'isEnum' }),
    );
  });

  it('rejects an empty-string name', async () => {
    const { statusCode } = await rejectedDto(UpdateLabelDto, { name: '' });

    expect(statusCode).toBe(400);
  });
});
