import { IsOptional, IsUUID } from 'class-validator';

export class MoveTaskDto {
  @IsUUID('7')
  columnId!: string;

  @IsOptional()
  @IsUUID('7')
  beforeTaskId?: string | null;

  @IsOptional()
  @IsUUID('7')
  afterTaskId?: string | null;
}
