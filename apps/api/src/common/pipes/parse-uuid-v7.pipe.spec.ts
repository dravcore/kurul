import { BadRequestException } from '@nestjs/common';
import { ParseUuidV7Pipe } from './parse-uuid-v7.pipe';

/**
 * Every `@UuidParam` in the app resolves to this pipe (`../decorators/uuid-param.decorator.ts`),
 * so it is the one place standing between a raw path segment and a Prisma `where: { id }` —
 * every id column in the schema is UUIDv7 (`CLAUDE.md`), and a cuid or a sequential int slipping
 * through would either 500 against Prisma's own validation or, worse, coerce into a query that
 * silently matches nothing instead of failing loudly.
 */
describe('ParseUuidV7Pipe', () => {
  const pipe = new ParseUuidV7Pipe();

  it('passes a genuine UUIDv7 through unchanged', () => {
    const value = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';

    expect(pipe.transform(value)).toBe(value);
  });

  it('rejects a UUIDv4 — a different version, not merely "not a UUID"', () => {
    // Version nibble `4` instead of `7`. A real uuidv4 would otherwise pass any check that
    // only confirms "this parses as *a* UUID" and let a cuid-era id (from a fixture, an old
    // migration, or another system) reach Prisma unchecked.
    const uuidV4 = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

    expect(() => pipe.transform(uuidV4)).toThrow(BadRequestException);
  });

  it('rejects a string that is not a UUID at all', () => {
    expect(() => pipe.transform('not-a-uuid')).toThrow(BadRequestException);
  });

  it('rejects an empty string', () => {
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });

  it('names the expectation in the error, not a generic "invalid" message', () => {
    const thrown = (() => {
      try {
        pipe.transform('nope');
      } catch (error) {
        return error as BadRequestException;
      }
      throw new Error('expected transform to throw');
    })();

    expect(thrown.message).toBe('Validation failed (uuid v7 is expected)');
  });
});
