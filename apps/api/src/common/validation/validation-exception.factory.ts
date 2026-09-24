import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { echoedName } from '../echoed-name';

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
 * `message` with every repetition of `property` in it bounded the way `echoedName` bounds a name.
 *
 * class-validator writes the failing property's name into its messages, and for a property the
 * DTO does not declare that name is a key of the client's choosing: `forbidNonWhitelisted` refuses
 * it with `property <name> should not exist`, whatever its length. The name is replaced where it
 * appears rather than the sentence rebuilt from its constraint, so the wording stays
 * class-validator's own, and a name of 64 characters or fewer leaves the message as it was.
 */
function withEchoedName(message: string, property: string): string {
  const echoed = echoedName(property);
  return echoed === property ? message : message.split(property).join(echoed);
}

/**
 * Flattens class-validator's nested error tree into a flat list of `{ field, constraint,
 * message }` entries, with dotted paths for nested objects (`assignee.email`) and bracketed
 * indexes for arrays (`labels[0].name`).
 *
 * The client's own names are bounded where an entry is written, and nowhere earlier: `field` as
 * one string, so a nested path keeps the declared part it starts with (`dispositions[0].`) and
 * loses only the tail of the key that follows, and the name in `message` on its own. Every
 * segment a DTO declares is short; the one a client can make long is a key the DTO does not
 * declare, and until this bound a 20 KiB one came back in `field` and in `message`, a
 * 41,239-byte envelope (measured through the stack `configureApp` installs).
 */
function flattenValidationErrors(
  errors: readonly ValidationError[],
  parentPath = '',
): ValidationDetail[] {
  const details: ValidationDetail[] = [];

  for (const error of errors) {
    const field = joinPath(parentPath, error.property);

    for (const [constraint, message] of Object.entries(error.constraints ?? {})) {
      details.push({
        field: echoedName(field),
        constraint,
        message: withEchoedName(message, error.property),
      });
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
