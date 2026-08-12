import { ValidationPipe } from '@nestjs/common';
import { UpdateBoardDto } from '../../board/dto/update-board.dto';
import { UpdateColumnDto } from '../../board/dto/update-column.dto';
import { UpdateWorkspaceDto } from '../../workspace/dto/update-workspace.dto';
import { validationExceptionFactory, type ValidationDetail } from './validation-exception.factory';

/**
 * The two decorators exist to split one PATCH question in half: which fields may be cleared
 * with an explicit `null`, and which may only be omitted. `class-validator`'s own
 * `@IsOptional()` answers "both" — it skips validation for `null` as well as `undefined`, so
 * before this split a `null` sailed past every type validator and reached Prisma, where a
 * non-nullable column turned a client mistake into a 500.
 *
 * These tests are the only mechanical guard that each field is on the side it belongs to;
 * flipping a decorator by hand compiles, passes typecheck, and silently changes the contract
 * in `docs/api-conventions.md` ("sending `null` explicitly clears a nullable field").
 */

type Metatype = new () => object;

// Identical to the production pipe in `common/configure-app.ts`.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});

function transform(metatype: Metatype, body: Record<string, unknown>): Promise<unknown> {
  return pipe.transform(body, { type: 'body', metatype });
}

/** Runs the pipe and returns the accepted DTO, failing the test if it was rejected. */
async function accepted(metatype: Metatype, body: Record<string, unknown>): Promise<unknown> {
  return transform(metatype, body);
}

/** Runs the pipe and returns the 400 payload, failing the test if the body was accepted. */
async function rejected(
  metatype: Metatype,
  body: Record<string, unknown>,
): Promise<{ statusCode: number; details: ValidationDetail[] }> {
  const outcome = await transform(metatype, body).then(
    () => undefined,
    (error: unknown) => error,
  );

  if (outcome === undefined) {
    throw new Error(`Expected ${metatype.name} to reject ${JSON.stringify(body)}`);
  }

  const exception = outcome as { getStatus: () => number; getResponse: () => unknown };
  const response = exception.getResponse() as { details?: ValidationDetail[] };
  return { statusCode: exception.getStatus(), details: response.details ?? [] };
}

function fields(details: ValidationDetail[]): string[] {
  return details.map((detail) => detail.field);
}

describe('PATCH optionality decorators', () => {
  describe('a non-nullable field refuses an explicit null', () => {
    it.each<[string, Metatype, string]>([
      ['UpdateColumnDto.name', UpdateColumnDto, 'name'],
      ['UpdateBoardDto.name', UpdateBoardDto, 'name'],
      ['UpdateWorkspaceDto.name', UpdateWorkspaceDto, 'name'],
      ['UpdateWorkspaceDto.slug', UpdateWorkspaceDto, 'slug'],
    ])('rejects %s: null with 400', async (_label, metatype, field) => {
      const { statusCode, details } = await rejected(metatype, { [field]: null });

      expect(statusCode).toBe(400);
      expect(fields(details)).toContain(field);
    });

    it('names the emptiness, not a type mismatch, as the reason', async () => {
      // `@ValidateIf` lets `null` through to `@IsNotEmpty()` first; a client reading
      // `constraint` should see the rule it actually broke.
      const { details } = await rejected(UpdateBoardDto, { name: null });

      expect(details).toContainEqual(
        expect.objectContaining({ field: 'name', constraint: 'isNotEmpty' }),
      );
    });
  });

  describe('a nullable field still accepts an explicit null', () => {
    it('clears UpdateBoardDto.description', async () => {
      const dto = (await accepted(UpdateBoardDto, { description: null })) as UpdateBoardDto;

      // Not merely "not rejected": the null has to survive the pipe, or the service can
      // never tell "clear this" apart from "leave it alone".
      expect(dto.description).toBeNull();
    });

    it('clears UpdateColumnDto.color', async () => {
      const dto = (await accepted(UpdateColumnDto, { color: null })) as UpdateColumnDto;

      expect(dto.color).toBeNull();
    });

    it('does not run the string validators against the null', async () => {
      // `@IsString()` and `@MaxLength()` follow the decorator; if the clear stopped
      // short-circuiting them, this body would come back as a 400 instead.
      const dto = (await accepted(UpdateBoardDto, {
        name: 'Roadmap',
        description: null,
      })) as UpdateBoardDto;

      expect(dto).toMatchObject({ name: 'Roadmap', description: null });
    });
  });

  describe('omission still means "leave unchanged"', () => {
    it.each<[string, Metatype]>([
      ['UpdateColumnDto', UpdateColumnDto],
      ['UpdateBoardDto', UpdateBoardDto],
      ['UpdateWorkspaceDto', UpdateWorkspaceDto],
    ])('accepts an empty %s body', async (_label, metatype) => {
      const dto = (await accepted(metatype, {})) as Record<string, unknown>;

      expect(dto.name).toBeUndefined();
    });
  });

  describe('the value validators still apply to a real value', () => {
    it('rejects an empty string on a non-nullable field', async () => {
      const { statusCode, details } = await rejected(UpdateColumnDto, { name: '' });

      expect(statusCode).toBe(400);
      expect(fields(details)).toContain('name');
    });

    it('rejects a non-string on a nullable field', async () => {
      const { statusCode, details } = await rejected(UpdateColumnDto, { color: 42 });

      expect(statusCode).toBe(400);
      expect(details).toContainEqual(
        expect.objectContaining({ field: 'color', constraint: 'isString' }),
      );
    });

    it('rejects a slug that is not lowercase-hyphenated', async () => {
      const { details } = await rejected(UpdateWorkspaceDto, { slug: 'Not A Slug' });

      expect(details).toContainEqual(
        expect.objectContaining({ field: 'slug', constraint: 'matches' }),
      );
    });
  });
});
