import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { rejectedDto } from './dto-test-helpers';

class ItemDto {
  @IsString()
  name!: string;
}

class ProbeDto {
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items?: ItemDto[];
}

/**
 * The factory under the exact `ValidationPipe` configuration `configureApp` installs
 * (`dto-test-helpers.ts`). `forbidNonWhitelisted` names every key the DTO does not declare, in
 * `field` and in `message`, and such a key is as long as the client makes it; a 20 KiB one was a
 * 41,239-byte envelope. The request-level case is in `configure-app.spec.ts`.
 */
describe('validationExceptionFactory', () => {
  describe('a key the DTO does not declare', () => {
    it('is repeated whole up to 64 characters, exactly as class-validator words it', async () => {
      const key = 'k'.repeat(64);

      const { statusCode, details } = await rejectedDto(ProbeDto, { title: 'x', [key]: 1 });

      expect(statusCode).toBe(400);
      expect(details).toEqual([
        {
          field: key,
          constraint: 'whitelistValidation',
          message: `property ${key} should not exist`,
        },
      ]);
    });

    it('is cut after 64 characters past that, in `field` and in `message` alike', async () => {
      const echoed = `${'k'.repeat(64)}[+1 more]`;

      const { details } = await rejectedDto(ProbeDto, { title: 'x', ['k'.repeat(65)]: 1 });

      expect(details).toEqual([
        {
          field: echoed,
          constraint: 'whitelistValidation',
          message: `property ${echoed} should not exist`,
        },
      ]);
    });

    it('keeps a nested path readable by cutting the whole path, not each segment', async () => {
      const key = 'k'.repeat(20 * 1024);

      const { details } = await rejectedDto(ProbeDto, {
        title: 'x',
        items: [{ name: 'a', [key]: 1 }],
      });

      // `items[0].` is nine characters of the 64, so the path keeps its declared start and loses
      // the tail of the key. class-validator names the key alone in its sentence, and that name
      // is cut on its own.
      expect(details).toEqual([
        {
          field: `items[0].${'k'.repeat(55)}[+20425 more]`,
          constraint: 'whitelistValidation',
          message: `property ${'k'.repeat(64)}[+20416 more] should not exist`,
        },
      ]);
    });
  });

  it('leaves every name a DTO declares, and every message about one, as class-validator wrote it', async () => {
    const { details } = await rejectedDto(ProbeDto, { title: '', items: [{ name: 7 }] });

    expect(details).toEqual([
      { field: 'title', constraint: 'isNotEmpty', message: 'title should not be empty' },
      { field: 'items[0].name', constraint: 'isString', message: 'name must be a string' },
    ]);
  });
});
