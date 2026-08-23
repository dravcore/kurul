import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/**
 * A single per-field problem, as documented in `docs/api-conventions.md#errors`.
 *
 * `constraint` is the class-validator rule that failed (`isNotEmpty`, `min`, …), which is
 * what clients branch on; `message` is the human-readable rendering of the same rule.
 */
export interface ValidationDetail {
  field: string;
  constraint?: string;
  message: string;
}

function joinPath(parentPath: string, property: string): string {
  if (parentPath === '') {
    return property;
  }

  // Array children are reported with their index as the property name.
  return /^\d+$/.test(property) ? `${parentPath}[${property}]` : `${parentPath}.${property}`;
}

/**
 * Flattens class-validator's nested error tree into a flat list of `{ field, constraint,
 * message }` entries, with dotted paths for nested objects (`assignee.email`) and bracketed
 * indexes for arrays (`labels[0].name`).
 */
function flattenValidationErrors(
  errors: readonly ValidationError[],
  parentPath = '',
): ValidationDetail[] {
  const details: ValidationDetail[] = [];

  for (const error of errors) {
    const field = joinPath(parentPath, error.property);

    for (const [constraint, message] of Object.entries(error.constraints ?? {})) {
      details.push({ field, constraint, message });
    }

    if (error.children !== undefined && error.children.length > 0) {
      details.push(...flattenValidationErrors(error.children, field));
    }
  }

  return details;
}

/**
 * `ValidationPipe` exception factory that preserves the field name and the failed
 * constraint. The pipe's default factory throws away both, flattening everything into
 * opaque message strings.
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Validation failed',
    details: flattenValidationErrors(errors),
  });
}
