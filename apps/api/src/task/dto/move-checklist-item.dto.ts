import { IsOptional } from 'class-validator';
import { IsUuidV7 } from '../../common/uuid';

export class MoveChecklistItemDto {
  /** Item this one lands after; omitted means "move to the top of the checklist". */
  @IsOptional()
  @IsUuidV7()
  afterId?: string;
}
