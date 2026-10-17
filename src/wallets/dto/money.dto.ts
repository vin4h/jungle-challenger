import { IsString } from 'class-validator';

export class MoneyDto {
  @IsString()
  amount!: string;

  @IsString()
  currency!: string;
}
