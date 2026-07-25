import { IsEmail, IsString } from 'class-validator';
import { UserRole } from '../entities/user.entity';

/**
 * No @ApiProperty() anywhere here — nestjs-docfy infers a JSON Schema from
 * these class-validator decorators automatically (see README's
 * "class-validator inference" section) when this DTO is used as a
 * @Body()/return type and the docs file doesn't override it with its own
 * schema/type. `role` has no class-validator decorator here on purpose — the
 * inferred schema only ever reflects what's actually validated; the docs
 * file demonstrates the `enum` feature separately, on `findAll`'s `role`
 * query param instead.
 */
export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  role: UserRole;
}
