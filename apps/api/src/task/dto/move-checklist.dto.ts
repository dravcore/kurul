import { IsOptional } from 'class-validator';
import { IsUuidV7 } from '../../common/uuid';

export class MoveChecklistDto {
  /** Checklist this one lands after; omitted means "move to the front". */
  @IsOptional()
  @IsUuidV7()
  afterId?: string;
}
