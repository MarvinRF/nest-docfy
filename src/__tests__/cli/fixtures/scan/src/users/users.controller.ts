import { Controller, Get, Post, Param, Body } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Get()
  findAll(): string[] {
    return [];
  }

  @Get(':id')
  findOne(@Param('id') id: string): string {
    return id;
  }

  @Post()
  create(@Body() body: unknown): unknown {
    return body;
  }
}
