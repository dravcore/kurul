import { Module } from '@nestjs/common';
import { LocaleService } from './locale.service';

/**
 * Owns the stored interface language.
 *
 * A module rather than a helper in `common/` because three modules need it and the boundary
 * rule says they depend on the module, not on each other: `AuthModule` serves and updates the
 * preference on `/me`, and `BoardModule` reads it to seed a new board's columns in the
 * creator's language.
 */
@Module({
  providers: [LocaleService],
  exports: [LocaleService],
})
export class LocaleModule {}
