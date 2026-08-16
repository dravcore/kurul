import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ColumnCategory } from '@kurul/shared-types';
import { IsUuidV7 } from '../../common/uuid';

export class CreateColumnDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsUuidV7()
  afterColumnId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;

  /** Omitted falls through to the schema default (`UNSTARTED`), not to a name-derived guess. */
  @IsOptional()
  @IsEnum(ColumnCategory)
  category?: ColumnCategory;
}
