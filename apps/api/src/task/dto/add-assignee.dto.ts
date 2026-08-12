import { IsNotEmpty } from 'class-validator';
import { IsUuidV7 } from '../../common/uuid';

export class AddAssigneeDto {
  @IsUuidV7()
  @IsNotEmpty()
  userId!: string;
}
