import { Param } from '@nestjs/common';
import { ParseUuidV7Pipe } from '../pipes/parse-uuid-v7.pipe';

/**
 * Path parameter that must be a UUIDv7.
 *
 * Every product id is a UUIDv7, so binding the pipe here keeps controllers from having to
 * remember it — a `@Param('taskId')` that slipped through unvalidated would hand a raw
 * string straight to Prisma.
 */
export const UuidParam = (property: string): ParameterDecorator => Param(property, ParseUuidV7Pipe);
