import { IsOptional, IsUUID } from 'class-validator';

export class MoveColumnDto {
  @IsOptional()
  @IsUUID('7')
  beforeColumnId?: string | null;

  @IsOptional()
  @IsUUID('7')
  afterColumnId?: string | null;
}
