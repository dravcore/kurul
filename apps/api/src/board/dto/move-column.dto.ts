import { IsOptional } from 'class-validator';
import { IsUuidV7 } from '../../common/uuid';

export class MoveColumnDto {
  @IsOptional()
  @IsUuidV7()
  beforeColumnId?: string | null;

  @IsOptional()
  @IsUuidV7()
  afterColumnId?: string | null;
}
