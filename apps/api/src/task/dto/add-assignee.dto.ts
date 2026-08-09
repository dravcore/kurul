import { IsNotEmpty, IsUUID } from 'class-validator';

export class AddAssigneeDto {
  @IsUUID('7')
  @IsNotEmpty()
  userId!: string;
}
