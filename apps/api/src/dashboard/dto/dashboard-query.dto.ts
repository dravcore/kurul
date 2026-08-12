import { IsOptional } from 'class-validator';
import { IsUuidV7 } from '../../common/uuid';

export class DashboardQueryDto {
  @IsOptional()
  @IsUuidV7()
  boardId?: string;
}
