import { applyDecorators } from '@nestjs/common';
import { IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';

/**
 * PATCH field backed by a non-nullable column: omit it to leave the value unchanged,
 * but an explicit `null` is a client error rather than a clear.
 *
 * Omitting the key skips every validator on the property; sending anything else — `null`
 * included — falls through to `@IsNotEmpty()` and whatever type validators follow.
 */
export function OptionalNonNullable(): PropertyDecorator {
  return applyDecorators(
    ValidateIf((_, value) => value !== undefined),
    IsNotEmpty(),
  );
}

/**
 * PATCH field backed by a nullable column: omit it to leave the value unchanged, or send
 * an explicit `null` to clear it. Both skip the type validators that follow.
 */
export function OptionalNullable(): PropertyDecorator {
  return applyDecorators(IsOptional());
}
