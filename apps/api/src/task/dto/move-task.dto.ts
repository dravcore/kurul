import { IsOptional } from 'class-validator';
import { IsUuidV7 } from '../../common/uuid';

export class MoveTaskDto {
  @IsUuidV7()
  columnId!: string;

  @IsOptional()
  @IsUuidV7()
  beforeTaskId?: string | null;

  @IsOptional()
  @IsUuidV7()
  afterTaskId?: string | null;
}
