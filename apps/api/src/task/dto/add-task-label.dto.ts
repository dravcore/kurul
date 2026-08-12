import { IsNotEmpty } from 'class-validator';
import { IsUuidV7 } from '../../common/uuid';

export class AddTaskLabelDto {
  @IsUuidV7()
  @IsNotEmpty()
  labelId!: string;
}
