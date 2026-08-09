import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isUUID } from 'class-validator';

/** Ensures path IDs are UUIDv7 (product standard). */
@Injectable()
export class ParseUuidV7Pipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUUID(value, '7')) {
      throw new BadRequestException('Validation failed (uuid v7 is expected)');
    }
    return value;
  }
}
