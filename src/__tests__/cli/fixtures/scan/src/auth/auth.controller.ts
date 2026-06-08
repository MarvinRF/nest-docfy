import { Controller, Get, Post, Body } from '@nestjs/common';
import { LoginResponseDto, RegisterResponseDto, UserDto } from './auth-response.dto';

@Controller('auth')
export class AuthController {
  @Post('register')
  register(@Body() body: unknown): Promise<RegisterResponseDto> {
    return Promise.resolve({ message: 'ok', userId: '1' });
  }

  @Post('login')
  login(@Body() body: unknown): Promise<LoginResponseDto> {
    return Promise.resolve({ accessToken: '', refreshToken: '' });
  }

  @Get('users')
  listUsers(): Promise<UserDto[]> {
    return Promise.resolve([]);
  }

  @Get('me')
  getMe(): Promise<UserDto> {
    return Promise.resolve({ id: '1', email: 'a@b.com', name: 'Test' });
  }
}
