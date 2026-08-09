import { IsNotEmpty, IsUUID } from 'class-validator';

export class AddTaskLabelDto {
  @IsUUID('7')
  @IsNotEmpty()
  labelId!: string;
}
