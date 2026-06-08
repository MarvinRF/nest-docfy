import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { LoginResponseDto, RegisterResponseDto, UserDto } from './auth-response.dto';

export class RegisterDto {
  email: string;
  password: string;
}

export class LoginDto {
  email: string;
  password: string;
}

@Controller('auth')
export class AuthController {
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return Promise.resolve({ message: 'ok', userId: '1' });
  }

  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return Promise.resolve({ accessToken: '', refreshToken: '' });
  }

  @Get('users')
  listUsers(@Query('page') page: number, @Query('q') q: string): Promise<UserDto[]> {
    return Promise.resolve([]);
  }

  @Get('users/:id')
  getUser(@Param('id') id: string): Promise<UserDto> {
    return Promise.resolve({ id, email: 'a@b.com', name: 'Test' });
  }

  @Get('me')
  getMe(): Promise<UserDto> {
    return Promise.resolve({ id: '1', email: 'a@b.com', name: 'Test' });
  }
}
