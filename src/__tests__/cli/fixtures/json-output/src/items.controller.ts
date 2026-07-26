import { Controller, Get, Post } from '@nestjs/common';

@Controller('items')
export class ItemsController {
  @Get()
  findAll() {
    return [];
  }

  @Post()
  create() {
    return {};
  }
}
