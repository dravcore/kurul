import { validate } from 'class-validator';
import { IsUuidV7, isUuidV7, UUID_VERSION } from './uuid';

/** UUIDv4 (random) — used to prove `IsUuidV7` rejects the wrong version, not just non-UUIDs. */
const UUID_V4 = '9b2d8f2e-3c1a-4b7d-9e2f-6a1c8d4b5e3f';
/** UUIDv7 (time-ordered) — the only version the product accepts. */
const UUID_V7 = '018f5b3c-7a2e-7c4d-8b6a-1e2f3a4b5c6d';

class TestDto {
  @IsUuidV7()
  id!: string;
}

describe('UUID_VERSION', () => {
  it('is pinned to version 7', () => {
    expect(UUID_VERSION).toBe('7');
  });
});

describe('isUuidV7', () => {
  it('accepts a UUIDv7', () => {
    expect(isUuidV7(UUID_V7)).toBe(true);
  });

  it('rejects a UUIDv4', () => {
    expect(isUuidV7(UUID_V4)).toBe(false);
  });
});

describe('IsUuidV7 decorator', () => {
  it('passes validation for a UUIDv7 value', async () => {
    const dto = Object.assign(new TestDto(), { id: UUID_V7 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails validation for a UUIDv4 value, keyed on UUID_VERSION', async () => {
    const dto = Object.assign(new TestDto(), { id: UUID_V4 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isUuid');
  });

  it('fails validation for a non-UUID string', async () => {
    const dto = Object.assign(new TestDto(), { id: 'not-a-uuid' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });
});
