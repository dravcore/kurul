import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isUuidV7 } from '../uuid';

/** Ensures path IDs are UUIDv7 (product standard). */
@Injectable()
export class ParseUuidV7Pipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUuidV7(value)) {
      throw new BadRequestException('Validation failed (uuid v7 is expected)');
    }
    return value;
  }
}
