import { Controller, Get, Post, UseGuards } from '@nestjs/common';

class JwtAuthGuard {}

@Controller('guarded')
@UseGuards(JwtAuthGuard)
export class GuardedController {
  @Get('profile')
  getProfile(): string {
    return 'profile';
  }

  @Post('action')
  doAction(): void {}
}

@Controller('partial')
export class PartialGuardController {
  @Get('public')
  publicRoute(): string {
    return 'public';
  }

  @Get('private')
  @UseGuards(JwtAuthGuard)
  privateRoute(): string {
    return 'private';
  }
}
